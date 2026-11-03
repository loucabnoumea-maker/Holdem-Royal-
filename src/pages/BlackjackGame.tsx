import type { MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BetChip, BetPile } from '../components/BetChip.tsx';
import { Modal } from '../components/GameLayout.tsx';
import { PlayingCard } from '../components/PlayingCard.tsx';
import { GhostButton, PrimaryButton } from '../components/ui.tsx';
import type { BJAction, BJState, SideBets, SideKind, SideResult } from '../lib/blackjack/engine.ts';
import {
  act,
  ACTION_FR,
  ADVICE_FR,
  createTable,
  deal,
  legalActions,
  OUTCOME_FR,
  recommendedAction,
  SIDE_NAMES,
  takeInsurance,
  totalLabel,
} from '../lib/blackjack/engine.ts';
import { fmt } from '../lib/prefs.ts';
import { navigate } from '../lib/router.ts';
import { isSoundOn, play, setSoundOn } from '../lib/sound.ts';

const START_BALANCE = 1000;
const CHIPS = [5, 25, 100, 500];
const KEY = 'poker.blackjack';
/** Écart entre deux cartes de la distribution initiale (ms). */
const DEAL_GAP = 320;
const SHUFFLE_MS = 900;

type Spot = 'main' | SideKind;
type Bets = Record<Spot, number>;
const NO_BETS: Bets = { main: 0, pairs: 0, plus3: 0 };

interface Saved {
  balance: number;
  coach: boolean;
  lastBet: number;
  lastSide: SideBets;
  stats: { rounds: number; won: number; lost: number; pushes: number; blackjacks: number; best: number; sideWins: number };
}

const DEFAULT_SAVED: Saved = {
  balance: START_BALANCE,
  coach: true,
  lastBet: 25,
  lastSide: { pairs: 0, plus3: 0 },
  stats: { rounds: 0, won: 0, lost: 0, pushes: 0, blackjacks: 0, best: START_BALANCE, sideWins: 0 },
};

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SAVED;
    const x = JSON.parse(raw);
    return { ...DEFAULT_SAVED, ...x, stats: { ...DEFAULT_SAVED.stats, ...x.stats }, lastSide: { ...DEFAULT_SAVED.lastSide, ...x.lastSide } };
  } catch {
    return DEFAULT_SAVED;
  }
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Jeton en vol entre le rack et une case de mise. */
interface Flyer {
  id: number;
  value: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
}

const later = (fn: () => void, ms: number) => window.setTimeout(fn, ms);

export default function BlackjackGame() {
  const [saved, setSaved] = useState<Saved>(loadSaved);
  const [s, setS] = useState<BJState>(() => createTable(saved.balance));
  const [bets, setBets] = useState<Bets>(NO_BETS);
  const [target, setTarget] = useState<Spot>('main');
  const [revealed, setRevealed] = useState(1);
  /** Distribution initiale en cours (cartes en vol). */
  const [dealing, setDealing] = useState(false);
  const [dealBase, setDealBase] = useState(0);
  const [sidesShown, setSidesShown] = useState(false);
  const [resultShown, setResultShown] = useState(false);
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState(isSoundOn());
  const [showStats, setShowStats] = useState(false);
  const [area, size] = useSize<HTMLDivElement>();
  const flyId = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* stockage indisponible */
    }
  }, [saved]);

  // ------------------------------------------------ Croupier : carte cachée retournée, puis une carte à la fois
  const dealerDone = s.phase !== 'settled' || revealed >= s.dealer.length;
  useEffect(() => {
    if (dealing || s.phase !== 'settled' || revealed >= s.dealer.length) return;
    const t = later(
      () => {
        setRevealed((r) => r + 1);
        play(revealed === 1 ? 'flip' : 'card');
      },
      revealed === 1 ? 500 : 820,
    );
    return () => clearTimeout(t);
  }, [s.phase, s.dealer.length, revealed, dealing]);

  // ------------------------------------------------ Fin du tour : résultat, sons, statistiques
  const counted = useRef(0);
  useEffect(() => {
    if (s.phase !== 'settled' || !dealerDone || dealing || counted.current === s.roundNumber) return;
    counted.current = s.roundNumber;
    const allBust = s.hands.every((h) => h.outcome === 'bust');
    later(() => {
      setResultShown(true);
      const staked = s.hands.reduce((a, h) => a + h.bet, 0);
      if (s.hands.some((h) => h.outcome === 'blackjack')) play('blackjack');
      else if (s.lastNet > 0 && s.lastNet >= staked * 2) play('bigwin');
      else if (s.lastNet > 0) play('win');
      else if (s.lastNet === 0) play('push');
      else if (!allBust) play('lose');
      else play('chips');
    }, 420);
    setSaved((x) => {
      const st = { ...x.stats, rounds: x.stats.rounds + 1, best: Math.max(x.stats.best, s.balance) };
      for (const h of s.hands) {
        if (h.outcome === 'blackjack') st.blackjacks++;
        if (h.outcome === 'win' || h.outcome === 'blackjack') st.won++;
        else if (h.outcome === 'push') st.pushes++;
        else st.lost++;
      }
      st.sideWins += s.sideResults.filter((r) => r.hit).length;
      return { ...x, balance: s.balance, stats: st };
    });
  }, [s, dealerDone, dealing]);

  const legal = dealing ? null : legalActions(s);
  const rec = saved.coach && legal ? recommendedAction(s) : null;
  const roundOver = s.phase === 'settled' && dealerDone && resultShown;
  const betting = s.phase === 'betting' || roundOver;
  const totalBet = bets.main + bets.pairs + bets.plus3;
  const available = s.balance - (betting ? totalBet : 0);

  // ------------------------------------------------ Actions
  const run = useCallback((fn: () => BJState, before: BJState) => {
    try {
      const next = fn();
      setS(next);
      setError(null);
      // Nouvelles cartes du joueur : un son par carte, décalé comme l'animation
      const nPrev = before.hands.reduce((a, h) => a + h.cards.length, 0);
      const nNext = next.hands.reduce((a, h) => a + h.cards.length, 0);
      for (let i = 0; i < nNext - nPrev; i++) later(() => play('card'), i * 260);
      const bustNow = next.hands.some((h, i) => h.status === 'bust' && before.hands[i]?.status !== 'bust');
      if (bustNow) later(() => play('bust'), 560);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const startRound = (b: Bets) => {
    if (b.main <= 0) return setError('Pose au moins une mise dans la case principale.');
    let next: BJState;
    try {
      next = deal(s, b.main, undefined, { side: { pairs: b.pairs, plus3: b.plus3 } });
    } catch (e) {
      return setError((e as Error).message);
    }
    const base = next.reshuffled ? SHUFFLE_MS : 0;
    if (next.reshuffled) play('shuffle');
    setS(next);
    setError(null);
    setRevealed(1);
    setResultShown(false);
    setSidesShown(false);
    setDealBase(base);
    setDealing(true);
    setSaved((x) => ({ ...x, lastBet: b.main, lastSide: { pairs: b.pairs, plus3: b.plus3 } }));
    setBets(NO_BETS);
    setTarget('main');
    for (let i = 0; i < 4; i++) later(() => play('card'), base + i * DEAL_GAP);
    later(
      () => {
        setDealing(false);
        setSidesShown(true);
        if (next.sideResults.some((r) => r.hit)) play('side');
        else if (next.sideResults.length) play('chips');
      },
      base + 3 * DEAL_GAP + 640,
    );
  };

  const doAction = (a: BJAction) => {
    if (a === 'double' || a === 'split') play('chip');
    run(() => act(s, a), s);
  };

  const repeat: Bets = (() => {
    const main = Math.min(saved.lastBet, s.balance);
    let rest = s.balance - main;
    const pairs = Math.min(saved.lastSide.pairs, rest);
    rest -= pairs;
    return { main, pairs, plus3: Math.min(saved.lastSide.plus3, rest) };
  })();

  const addChip = (v: number, e: ReactMouseEvent<HTMLButtonElement>) => {
    if (v > available) return;
    const from = e.currentTarget.getBoundingClientRect();
    const to = document.getElementById(`spot-${target}`)?.getBoundingClientRect();
    setBets((b) => ({ ...b, [target]: b[target] + v }));
    if (!to) return play('chip');
    const sz = Math.min(48, from.width);
    const id = ++flyId.current;
    setFlyers((f) => [
      ...f,
      {
        id,
        value: v,
        size: sz,
        x: to.left + to.width / 2 - sz / 2,
        y: to.top + to.height / 2 - sz / 2,
        dx: from.left + from.width / 2 - (to.left + to.width / 2),
        dy: from.top + from.height / 2 - (to.top + to.height / 2),
      },
    ]);
    later(() => play('chip'), 430);
    later(() => setFlyers((f) => f.filter((x) => x.id !== id)), 560);
  };

  // Raccourcis clavier : T tirer, R rester, D doubler, S séparer, Espace distribuer
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (legal) {
        const map: Record<string, BJAction> = { t: 'hit', h: 'hit', r: 'stand', d: 'double', s: 'split' };
        const a = map[k];
        if (a && legal[a]) doAction(a);
      } else if (betting && (k === ' ' || k === 'enter')) {
        e.preventDefault();
        startRound(bets.main > 0 ? bets : repeat);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const broke = betting && s.balance < 5;
  const portrait = size.w / Math.max(1, size.h) < 1.1;
  const cardPx = portrait ? Math.max(17, Math.min(28, size.w / 15, size.h / 21)) : Math.max(19, Math.min(44, size.h / 14, size.w / 30));
  // Pendant la mise, les cartes du tour précédent restent sur la table jusqu'à ce qu'on pose un jeton.
  const inRound = s.hands.length > 0 && !(betting && totalBet > 0);
  const visibleDealer = inRound ? (s.phase === 'settled' ? Math.max(2, revealed) : 2) : 0;
  const dealerTotal = useMemo(() => {
    if (dealing || !inRound) return '';
    const vis = s.dealer.slice(0, s.phase === 'settled' ? revealed : 1);
    return vis.length ? totalLabel(vis) : '';
  }, [s, revealed, dealing, inRound]);
  const hasBJ = roundOver && inRound && s.hands.some((h) => h.outcome === 'blackjack');
  const staked = s.hands.reduce((a, h) => a + h.bet, 0);

  // Ordre de la distribution initiale : joueur, croupier, joueur, croupier
  const playerDelay = (k: number) => (dealing ? dealBase + k * 2 * DEAL_GAP : 0);
  const dealerDelay = (i: number) => (dealing ? dealBase + (i * 2 + 1) * DEAL_GAP : 0);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="relative z-30 flex shrink-0 items-center gap-2 px-[max(12px,env(safe-area-inset-left))] pb-1 pt-[max(6px,env(safe-area-inset-top))]">
        <button
          onClick={() => navigate('/')}
          className="font-ui rounded-full bg-black/35 px-3.5 py-1.5 text-[15px] font-semibold text-ivory/80 ring-1 ring-brass-400/25 hover:text-ivory"
        >
          Quitter
        </button>
        <div className="min-w-0 flex-1 text-center leading-tight">
          <div className="truncate font-display text-lg font-bold text-brass-200">Blackjack</div>
          <div className="font-ui truncate text-xs text-ivory/55 sm:text-sm">
            Solde : <b className="tabular-nums text-brass-200">{fmt(available)}</b> jetons
          </div>
        </div>
        <button
          onClick={() => navigate('/regles/blackjack')}
          className="font-ui rounded-full bg-black/35 px-3 py-1.5 text-[15px] font-semibold text-ivory/80 ring-1 ring-brass-400/25 hover:text-ivory"
        >
          Règles
        </button>
        <button
          onClick={() => {
            setSoundOn(!sound);
            setSound(!sound);
            if (!sound) later(() => play('chip'), 30);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-brass-200 ring-1 ring-brass-400/25"
          aria-label={sound ? 'Couper le son' : 'Activer le son'}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
            {sound ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : <path d="M17 9l5 6M22 9l-5 6" />}
          </svg>
        </button>
      </header>

      {/* ------------------------------------------------ Table */}
      <main ref={area} className="relative min-h-0 flex-1 px-2">
        <div
          className="felt absolute inset-x-[max(8px,2%)] bottom-[-35%] top-[2%] rounded-t-[50%_60%] ring-1 ring-brass-400/30"
          style={{ boxShadow: 'inset 0 0 80px rgba(0,0,0,.6), 0 0 0 10px #4a220e, 0 0 0 13px #b58c42, 0 30px 80px rgba(0,0,0,.6)' }}
        />

        <DealerTray size={portrait ? cardPx * 0.62 : cardPx} cols={portrait ? 4 : 6} />
        <Shoe size={cardPx} dealt={s.dealt} total={s.shoeSize} shuffling={dealing && dealBase > 0} />

        {/* Mentions imprimées sur le tapis */}
        <div className="pointer-events-none absolute inset-x-0 top-[37%] flex flex-col items-center gap-1 px-6 text-center">
          <div className="font-display italic text-brass-200/25" style={{ fontSize: Math.max(15, cardPx * 0.8) }}>
            Le Blackjack paie 3 pour 2
          </div>
          <div className="font-ui text-brass-200/20" style={{ fontSize: Math.max(10, cardPx * 0.4) }}>
            Le croupier reste sur tous les 17 · L'assurance paie 2 pour 1
          </div>
        </div>

        {/* Croupier */}
        <div className="absolute inset-x-0 top-[5%] flex flex-col items-center gap-1.5">
          <div className="font-ui rounded-full bg-black/50 px-3 py-0.5 text-sm font-semibold text-ivory/80 ring-1 ring-white/10">
            Croupier {dealerTotal && <b className="ml-1 text-brass-200">{dealerTotal}</b>}
          </div>
          <div className="flex min-h-[3.7em]" style={{ fontSize: cardPx }}>
            {s.dealer.slice(0, visibleDealer).map((c, i) => (
              <div key={`${s.roundNumber}-${i}`} style={{ marginLeft: i ? '-1em' : 0 }}>
                <PlayingCard
                  card={c}
                  size={cardPx}
                  faceUp={i === 0 || (s.phase === 'settled' && i < revealed)}
                  dealDelay={i < 2 ? dealerDelay(i) : 0}
                  dealFrom="bj-shoe"
                />
              </div>
            ))}
          </div>
        </div>

        {s.reshuffled && dealing && (
          <div className="pop-in font-ui absolute left-1/2 top-[30%] z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 px-4 py-1 text-sm text-ivory/85">
            Nouveau sabot mélangé (6 jeux)
          </div>
        )}

        {/* Résultat global */}
        {roundOver && inRound && (
          <div className="pointer-events-none absolute left-1/2 top-[46%] z-20 -translate-x-1/2 -translate-y-1/2">
            {hasBJ && <Sparks n={22} r={130} />}
            {!hasBJ && s.lastNet > 0 && s.lastNet >= staked * 2 && <Sparks n={14} r={100} />}
            <div
              className={`stamp font-display whitespace-nowrap rounded-2xl px-5 py-1.5 text-2xl font-bold ring-1 sm:text-3xl ${
                s.lastNet > 0
                  ? 'bg-[#0b2a1d]/92 text-[#bdf0d2] ring-[#2c8a5d]/60'
                  : s.lastNet < 0
                    ? 'bg-[#2a0d12]/92 text-[#ffd9dc] ring-ruby/50'
                    : 'bg-black/80 text-ivory ring-white/20'
              }`}
            >
              {hasBJ ? 'Blackjack ! ' : ''}
              {s.lastNet > 0 ? `+${fmt(s.lastNet)}` : s.lastNet < 0 ? fmt(s.lastNet) : 'Égalité'}
            </div>
          </div>
        )}

        {/* Joueur : cases de pari annexe + mains (ou case de mise principale) */}
        <div className="absolute inset-x-0 bottom-[3%] flex items-end justify-center gap-[2vw] px-1">
          <SideSpot
            kind="pairs"
            amount={inRound ? s.sideBets.pairs : bets.pairs}
            result={inRound && sidesShown ? s.sideResults.find((r) => r.kind === 'pairs') : undefined}
            selected={betting && target === 'pairs'}
            onSelect={betting ? () => setTarget('pairs') : undefined}
            size={cardPx}
          />

          <div className="flex min-w-0 items-end justify-center gap-[3vw]">
            {!inRound && (
              <div className="flex flex-col items-center gap-1">
                <button
                  id="spot-main"
                  onClick={() => setTarget('main')}
                  className={`flex items-center justify-center rounded-full border-2 transition ${
                    target === 'main' ? 'border-brass-300/80 bg-brass-400/10 shadow-[0_0_24px_rgba(227,198,129,.35)]' : 'border-dashed border-brass-300/35'
                  }`}
                  style={{ width: cardPx * 3.5, height: cardPx * 3.5 }}
                  aria-label="Case de mise principale"
                >
                  {bets.main > 0 ? (
                    <BetPile amount={bets.main} size={cardPx * 1.6} />
                  ) : (
                    <span className="font-ui text-sm font-semibold text-brass-200/55">Mise</span>
                  )}
                </button>
                <span className="font-ui text-[11px] text-ivory/40">Mise principale</span>
              </div>
            )}
            {inRound &&
              s.hands.map((h, i) => {
                const activeHand = s.phase === 'playing' && !dealing && i === s.active;
                const good = h.outcome === 'win' || h.outcome === 'blackjack';
                const lostChips = h.status === 'bust' || (roundOver && h.outcome === 'lose');
                return (
                  <div
                    key={i}
                    className={`flex flex-col items-center gap-1 transition-opacity duration-300 ${s.phase === 'playing' && !activeHand && !dealing ? 'opacity-55' : ''}`}
                  >
                    <div className="flex min-h-[1.6rem] items-end">
                      {roundOver && h.outcome && (
                        <div
                          className={`stamp font-ui whitespace-nowrap rounded-full px-3 py-0.5 text-sm font-bold ring-1 ${
                            good
                              ? 'bg-[#0e3a28] text-[#bdf0d2] ring-[#2c8a5d]/60'
                              : h.outcome === 'push' || h.outcome === 'surrender'
                                ? 'bg-black/60 text-ivory ring-white/20'
                                : 'bg-[#4a1219] text-[#ffd9dc] ring-ruby/50'
                          }`}
                          style={{ animationDelay: `${i * 120}ms` }}
                        >
                          {OUTCOME_FR[h.outcome]}
                        </div>
                      )}
                    </div>
                    <div
                      className={`flex rounded-xl p-1 ${activeHand ? 'turn-glow' : ''} ${roundOver && good ? 'hand-won' : ''} ${
                        lostChips || (roundOver && h.outcome === 'surrender') ? 'hand-lost' : ''
                      }`}
                      style={{ fontSize: cardPx }}
                    >
                      {h.cards.map((c, k) => (
                        <div key={`${s.roundNumber}-${k}-${c.rank}${c.suit}`} style={{ marginLeft: k ? '-1.15em' : 0, marginTop: `${k * -0.28}em` }}>
                          <PlayingCard
                            card={c}
                            size={cardPx}
                            dealDelay={k < 2 && i === 0 && s.hands.length === 1 ? playerDelay(k) : h.fromSplit && k === 1 ? (i % 2) * 260 : 0}
                            dealFrom="bj-shoe"
                            animateDeal={!(h.fromSplit && k === 0 && i > 0)}
                          />
                        </div>
                      ))}
                    </div>
                    <span
                      className={`font-ui rounded-full bg-black/65 px-2.5 py-0.5 text-sm font-bold text-brass-200 ring-1 ring-brass-400/30 transition-opacity duration-300 ${
                        dealing ? 'opacity-0' : ''
                      }`}
                    >
                      {totalLabel(h.cards)}
                    </span>
                    <div className="relative flex items-end gap-1" style={{ minHeight: cardPx * 1.6 }}>
                      <div className={lostChips ? 'chips-taken' : ''}>
                        <BetPile amount={roundOver && h.outcome === 'surrender' ? Math.floor(h.bet / 2) : h.bet} size={cardPx * 1.1} />
                      </div>
                      {roundOver && good && (h.payout ?? 0) > h.bet && (
                        <div className="chips-paid" style={{ animationDelay: `${i * 140}ms` }}>
                          <BetPile amount={(h.payout ?? 0) - h.bet} size={cardPx * 1.1} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          <SideSpot
            kind="plus3"
            amount={inRound ? s.sideBets.plus3 : bets.plus3}
            result={inRound && sidesShown ? s.sideResults.find((r) => r.kind === 'plus3') : undefined}
            selected={betting && target === 'plus3'}
            onSelect={betting ? () => setTarget('plus3') : undefined}
            size={cardPx}
          />
        </div>
      </main>

      {/* Jetons en vol */}
      {flyers.map((f) => (
        <div
          key={f.id}
          className="chip-fly pointer-events-none fixed z-50"
          style={{ left: f.x, top: f.y, ['--dx' as string]: `${f.dx}px`, ['--dy' as string]: `${f.dy}px`, ['--dur' as string]: '0.5s' }}
        >
          <BetChip value={f.value} size={f.size} />
        </div>
      ))}

      {/* ------------------------------------------------ Commandes */}
      <div className="relative z-40 shrink-0 px-[max(12px,env(safe-area-inset-left))] pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
          {error && <div className="font-ui text-center text-sm text-[#ffb4bb]">{error}</div>}

          {rec && legal && (
            <div className="fade-up font-ui text-center text-sm text-ivory/70">
              Stratégie de base : <b className="text-brass-200">{ADVICE_FR[rec.advice]}</b>
            </div>
          )}

          {s.phase === 'insurance' && !dealing && (
            <div className="fade-up flex flex-col items-center gap-2">
              <p className="font-ui text-center text-[15px] text-ivory/80">
                Le croupier montre un As. Prendre l'assurance pour {fmt(Math.min(Math.floor(s.hands[0].bet / 2), s.balance))} ?
                {saved.coach && <span className="block text-sm text-ivory/55">Conseil : la refuser (elle coûte en moyenne 7 % de sa mise).</span>}
              </p>
              <div className="grid w-full grid-cols-2 gap-2">
                <GhostButton
                  onClick={() => {
                    play('chip');
                    run(() => takeInsurance(s, true), s);
                  }}
                >
                  Prendre l'assurance
                </GhostButton>
                <PrimaryButton onClick={() => run(() => takeInsurance(s, false), s)}>Non merci</PrimaryButton>
              </div>
            </div>
          )}

          {legal && (
            <div className="fade-up grid grid-cols-3 gap-2 sm:grid-cols-5">
              {(['hit', 'stand', 'double', 'split', 'surrender'] as BJAction[]).map((a) => {
                const isRec = rec?.action === a;
                const cls = a === 'hit' ? 'btn-call' : a === 'stand' ? 'btn-fold' : a === 'double' ? 'btn-brass' : 'btn-raise';
                if ((a === 'split' || a === 'surrender') && !legal[a]) return null;
                return (
                  <button
                    key={a}
                    onClick={() => doAction(a)}
                    disabled={!legal[a]}
                    className={`btn-lacquer ${cls} py-3.5 text-lg disabled:opacity-25 ${isRec ? 'ring-2 ring-brass-200 ring-offset-2 ring-offset-night' : ''}`}
                  >
                    {ACTION_FR[a]}
                  </button>
                );
              })}
            </div>
          )}

          {betting && !broke && (
            <div className="flex flex-col gap-2">
              <div className="font-ui text-center text-[13px] text-ivory/55">
                Les jetons vont dans : <b className="text-brass-200">{target === 'main' ? 'la mise principale' : SIDE_NAMES[target]}</b>
                <span className="text-ivory/40"> · touche une case sur la table pour changer</span>
              </div>
              <div className="flex items-center justify-center gap-2 sm:gap-4">
                {CHIPS.map((v) => (
                  <BetChip key={v} value={v} size={portrait ? 52 : 60} disabled={v > available} onClick={(e) => addChip(v, e)} />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <GhostButton
                  onClick={() => {
                    if (totalBet) play('chips');
                    setBets(NO_BETS);
                  }}
                  disabled={totalBet === 0}
                  className="py-3 text-base"
                >
                  Effacer
                </GhostButton>
                <GhostButton onClick={() => startRound(repeat)} className="py-3 text-base" title="Rejouer les mêmes mises">
                  Remiser {fmt(repeat.main + repeat.pairs + repeat.plus3)}
                </GhostButton>
                <PrimaryButton onClick={() => startRound(bets)} disabled={bets.main === 0} className="py-3 text-base">
                  Distribuer
                </PrimaryButton>
              </div>
            </div>
          )}

          {!betting && !legal && s.phase !== 'insurance' && (
            <div className="font-ui py-4 text-center text-ivory/50">{dealing ? 'Distribution…' : 'Le croupier joue…'}</div>
          )}

          <div className="font-ui flex items-center justify-between text-sm text-ivory/55">
            <label className="flex items-center gap-2">
              <input
                id="bj-coach"
                type="checkbox"
                checked={saved.coach}
                onChange={(e) => setSaved((x) => ({ ...x, coach: e.target.checked }))}
                className="h-4 w-4 accent-[#d2ad62]"
              />
              Conseils de stratégie
            </label>
            <button onClick={() => setShowStats(true)} className="underline-offset-4 hover:text-ivory hover:underline">
              Statistiques
            </button>
          </div>
        </div>
      </div>

      {broke && (
        <Modal>
          <h2 className="font-display text-3xl font-bold italic text-brass-200">Plus de jetons</h2>
          <p className="mt-2 text-ivory/65">Ce sont des jetons fictifs : tu peux recharger ton solde gratuitement.</p>
          <div className="mt-6 flex flex-col gap-2">
            <PrimaryButton
              onClick={() => {
                play('chips');
                setS(createTable(START_BALANCE));
                setSaved((x) => ({ ...x, balance: START_BALANCE }));
              }}
            >
              Recharger {fmt(START_BALANCE)} jetons
            </PrimaryButton>
            <GhostButton onClick={() => navigate('/')}>Accueil</GhostButton>
          </div>
        </Modal>
      )}

      {showStats && (
        <Modal>
          <h2 className="font-display text-3xl font-bold italic text-brass-200">Tes statistiques</h2>
          <dl className="font-ui mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-left text-[15px]">
            {(
              [
                ['Mains jouées', saved.stats.rounds],
                ['Gagnées', saved.stats.won],
                ['Perdues', saved.stats.lost],
                ['Égalités', saved.stats.pushes],
                ['Blackjacks', saved.stats.blackjacks],
                ['Paris annexes gagnés', saved.stats.sideWins],
                ['Meilleur solde', saved.stats.best],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ivory/55">{k}</dt>
                <dd className="text-right font-bold tabular-nums">{fmt(v)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-col gap-2">
            <PrimaryButton onClick={() => setShowStats(false)}>Fermer</PrimaryButton>
            <GhostButton
              onClick={() => {
                setSaved({ ...DEFAULT_SAVED, coach: saved.coach });
                setS(createTable(START_BALANCE));
                setBets(NO_BETS);
                setShowStats(false);
              }}
            >
              Tout remettre à zéro
            </GhostButton>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Éléments de table

/** Case de pari annexe, avec son résultat. */
function SideSpot({
  kind,
  amount,
  result,
  selected,
  onSelect,
  size,
}: {
  kind: SideKind;
  amount: number;
  result?: SideResult;
  selected: boolean;
  onSelect?: () => void;
  size: number;
}) {
  const d = size * 2.5;
  const won = !!result?.hit;
  return (
    <div className="flex shrink-0 flex-col items-center gap-1" style={{ width: d + 18 }}>
      <div className="relative flex min-h-[2.6rem] items-end justify-center">
        {result && (
          <div
            className={`stamp font-ui whitespace-nowrap rounded-lg px-2 py-0.5 text-center text-[11px] font-bold leading-tight ring-1 sm:text-xs ${
              won ? 'bg-[#0e3a28] text-[#bdf0d2] ring-[#2c8a5d]/60' : 'bg-black/55 text-ivory/50 ring-white/10'
            }`}
          >
            {won ? (
              <>
                {result.hit}
                <br />
                {result.mult}:1 · +{fmt(result.payout - result.bet)}
              </>
            ) : (
              'Perdu'
            )}
          </div>
        )}
        {won && <Sparks n={12} r={60} />}
      </div>
      <button
        id={`spot-${kind}`}
        onClick={onSelect}
        disabled={!onSelect}
        className={`relative flex items-center justify-center rounded-full border-2 transition ${
          selected ? 'border-brass-300/80 bg-brass-400/10 shadow-[0_0_20px_rgba(227,198,129,.35)]' : 'border-dashed border-brass-300/30'
        }`}
        style={{ width: d, height: d }}
        aria-label={`Case ${SIDE_NAMES[kind]}`}
      >
        {amount > 0 ? (
          <div className={result && !won ? 'chips-taken' : ''}>
            <BetPile amount={amount} size={size * 1.05} />
          </div>
        ) : (
          <span className="font-ui px-1 text-center text-[11px] font-bold leading-tight text-brass-200/50 sm:text-xs">{SIDE_NAMES[kind]}</span>
        )}
        {won && result && (
          <div className="chips-paid absolute -right-4 -top-1">
            <BetPile amount={result.payout - result.bet} size={size * 0.9} />
          </div>
        )}
      </button>
      <span className="font-ui text-center text-[10px] leading-tight text-ivory/40 sm:text-[11px]">{kind === 'pairs' ? "jusqu'à 25:1" : "jusqu'à 100:1"}</span>
    </div>
  );
}

/** Sabot de 6 jeux : la pile diminue au fil des cartes distribuées. */
function Shoe({ size, dealt, total, shuffling }: { size: number; dealt: number; total: number; shuffling: boolean }) {
  const left = Math.max(0, 1 - dealt / Math.max(1, total));
  return (
    <div className="pointer-events-none absolute right-[4%] top-[4%] z-10 flex flex-col items-center gap-1" style={{ fontSize: size * 0.8 }} aria-hidden>
      <div className={`relative ${shuffling ? 'shoe-deal' : ''}`} style={{ width: '3.6em', height: '3em' }}>
        <div
          className="absolute inset-0 rounded-[0.35em]"
          style={{ background: 'linear-gradient(160deg,#3a2410,#1a0f06)', boxShadow: '0 0.25em 0.6em rgba(0,0,0,.6), inset 0 0 0 0.08em #b58c42' }}
        />
        <div
          className="absolute bottom-[0.35em] left-[0.35em] rounded-[0.15em]"
          style={{
            width: `${0.4 + left * 2.4}em`,
            height: '2.2em',
            background: 'repeating-linear-gradient(90deg,#f6efe0 0 1px,#d8cdb4 1px 2px)',
            transition: 'width .6s',
          }}
        />
        <div className="card-back-art absolute right-[-0.5em] top-[0.35em] h-[2.3em] w-[1.65em] rounded-[0.2em]" style={{ transform: 'rotate(-12deg)' }} />
        <span id="bj-shoe" className="absolute right-0 top-1/2 h-px w-px" />
      </div>
      <span className="font-ui rounded bg-black/45 px-1.5 text-[10px] text-ivory/50">Sabot</span>
    </div>
  );
}

/** Rack de jetons du croupier (décor). */
function DealerTray({ size, cols: n }: { size: number; cols: number }) {
  const cols = [500, 100, 25, 5, 100, 25].slice(0, n);
  return (
    <div
      className="pointer-events-none absolute left-[4%] top-[4%] z-10 flex items-end gap-[0.12em] rounded-[0.35em] px-[0.25em] pb-[0.2em] pt-[0.4em]"
      style={{ fontSize: size * 0.8, background: 'linear-gradient(180deg,#1a0f06,#3a2410)', boxShadow: 'inset 0 0.1em 0.3em rgba(0,0,0,.8), 0 0 0 0.06em #b58c42' }}
      aria-hidden
    >
      {cols.map((v, i) => (
        <div key={i} className="flex flex-col-reverse">
          {Array.from({ length: 5 + (i % 3) }, (_, k) => (
            <div key={k} style={{ marginTop: k ? '-0.78em' : 0 }}>
              <BetChip value={v} size={size * 0.8} label="" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Éclats dorés qui partent du centre. */
function Sparks({ n = 14, r = 90 }: { n?: number; r?: number }) {
  const [parts] = useState(() =>
    Array.from({ length: n }, (_, i) => ({ a: (360 / n) * i + Math.random() * 12, r: r * (0.6 + Math.random() * 0.6), d: Math.random() * 180 })),
  );
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2" aria-hidden>
      {parts.map((p, i) => (
        <span key={i} className="spark" style={{ ['--a' as string]: `${p.a}deg`, ['--r' as string]: `-${p.r}px`, animationDelay: `${p.d}ms` }} />
      ))}
    </div>
  );
}
