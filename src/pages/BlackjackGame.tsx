import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BetChip, BetPile } from '../components/BetChip.tsx';
import { Modal } from '../components/GameLayout.tsx';
import { PlayingCard } from '../components/PlayingCard.tsx';
import { GhostButton, PrimaryButton } from '../components/ui.tsx';
import type { BJAction, BJState } from '../lib/blackjack/engine.ts';
import {
  act,
  ACTION_FR,
  ADVICE_FR,
  createTable,
  deal,
  legalActions,
  OUTCOME_FR,
  recommendedAction,
  takeInsurance,
  totalLabel,
} from '../lib/blackjack/engine.ts';
import { fmt } from '../lib/prefs.ts';
import { navigate } from '../lib/router.ts';
import { isSoundOn, play, setSoundOn } from '../lib/sound.ts';

const START_BALANCE = 1000;
const CHIPS = [5, 25, 100, 500];
const KEY = 'poker.blackjack';

interface Saved {
  balance: number;
  coach: boolean;
  lastBet: number;
  stats: { rounds: number; won: number; lost: number; pushes: number; blackjacks: number; best: number };
}

const DEFAULT_SAVED: Saved = {
  balance: START_BALANCE,
  coach: true,
  lastBet: 25,
  stats: { rounds: 0, won: 0, lost: 0, pushes: 0, blackjacks: 0, best: START_BALANCE },
};

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SAVED, ...JSON.parse(raw) } : DEFAULT_SAVED;
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

export default function BlackjackGame() {
  const [saved, setSaved] = useState<Saved>(loadSaved);
  const [s, setS] = useState<BJState>(() => createTable(saved.balance));
  const [bet, setBet] = useState(0);
  const [revealed, setRevealed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState(isSoundOn());
  const [showStats, setShowStats] = useState(false);
  const [area, size] = useSize<HTMLDivElement>();

  // Sauvegarde du solde et des statistiques (jetons fictifs, dans ce navigateur uniquement)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* stockage indisponible */
    }
  }, [saved]);

  // Animation du croupier : retourne la carte cachée puis tire une carte à la fois
  const dealerDone = s.phase !== 'settled' || revealed >= s.dealer.length;
  useEffect(() => {
    if (s.phase === 'betting' || s.phase === 'playing' || s.phase === 'insurance') {
      setRevealed(1);
      return;
    }
    if (revealed < s.dealer.length) {
      const t = setTimeout(() => {
        setRevealed((r) => r + 1);
        play('card');
      }, revealed === 1 ? 450 : 750);
      return () => clearTimeout(t);
    }
  }, [s.phase, s.dealer.length, revealed, s.roundNumber]);

  // Fin de tour : statistiques et sons
  const counted = useRef(0);
  useEffect(() => {
    if (s.phase !== 'settled' || !dealerDone || counted.current === s.roundNumber) return;
    counted.current = s.roundNumber;
    play(s.lastNet > 0 ? 'win' : s.lastNet < 0 ? 'lose' : 'check');
    setSaved((x) => {
      const st = { ...x.stats, rounds: x.stats.rounds + 1, best: Math.max(x.stats.best, s.balance) };
      for (const h of s.hands) {
        if (h.outcome === 'blackjack') st.blackjacks++;
        if (h.outcome === 'win' || h.outcome === 'blackjack') st.won++;
        else if (h.outcome === 'push') st.pushes++;
        else st.lost++;
      }
      return { ...x, balance: s.balance, stats: st };
    });
  }, [s, dealerDone]);

  const legal = legalActions(s);
  const rec = saved.coach ? recommendedAction(s) : null;
  const betting = s.phase === 'betting' || (s.phase === 'settled' && dealerDone);
  const available = s.balance - bet;

  const run = useCallback((fn: () => BJState) => {
    try {
      const next = fn();
      setS(next);
      setError(null);
      play('card');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const doDeal = (amount: number) => {
    if (amount <= 0) return setError('Choisis une mise avec les jetons.');
    run(() => deal(s, amount));
    setSaved((x) => ({ ...x, lastBet: amount }));
    setBet(0);
    play('chip');
  };
  const doAction = (a: BJAction) => run(() => act(s, a));

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
        doDeal(bet || Math.min(saved.lastBet, s.balance));
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const broke = betting && s.balance < 5;
  const portrait = size.w / Math.max(1, size.h) < 1.1;
  const cardPx = portrait ? Math.max(18, Math.min(30, size.w / 15)) : Math.max(20, Math.min(36, size.h / 14));
  const dealerTotal = useMemo(() => {
    const vis = s.dealer.slice(0, s.phase === 'settled' ? revealed : 1);
    return vis.length ? totalLabel(vis) : '';
  }, [s, revealed]);

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
            Solde : <b className="text-brass-200">{fmt(betting ? available : s.balance)}</b> jetons
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

      {/* Table */}
      <main ref={area} className="relative min-h-0 flex-1 px-2">
        <div
          className="felt absolute inset-x-[max(8px,2%)] bottom-[-35%] top-[2%] rounded-t-[50%_60%] ring-1 ring-brass-400/30"
          style={{ boxShadow: 'inset 0 0 80px rgba(0,0,0,.6), 0 0 0 10px #4a220e, 0 0 0 13px #b58c42, 0 30px 80px rgba(0,0,0,.6)' }}
        />
        {/* Mentions imprimées sur le tapis */}
        <div className="pointer-events-none absolute inset-x-0 top-[34%] flex flex-col items-center gap-1 text-center">
          <div className="font-display italic text-brass-200/25" style={{ fontSize: Math.max(16, cardPx * 0.85) }}>
            Le Blackjack paie 3 pour 2
          </div>
          <div className="font-ui text-brass-200/20" style={{ fontSize: Math.max(10, cardPx * 0.42) }}>
            Le croupier reste sur tous les 17 · L'assurance paie 2 pour 1
          </div>
        </div>

        {/* Croupier */}
        <div className="absolute inset-x-0 top-[5%] flex flex-col items-center gap-1.5">
          <div className="font-ui rounded-full bg-black/50 px-3 py-0.5 text-sm font-semibold text-ivory/80 ring-1 ring-white/10">
            Croupier {dealerTotal && <b className="ml-1 text-brass-200">{dealerTotal}</b>}
          </div>
          <div className="flex min-h-[4em]" style={{ fontSize: cardPx }}>
            {s.dealer.map((c, i) => (
              <div key={`${s.roundNumber}-${i}`} style={{ marginLeft: i ? '-0.9em' : 0 }}>
                <PlayingCard
                  card={c}
                  size={cardPx}
                  faceUp={i === 0 || (s.phase === 'settled' && i < revealed)}
                  dealDelay={i < 2 ? i * 260 + 130 : 0}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Joueur */}
        <div className="absolute inset-x-0 bottom-[4%] flex items-end justify-center gap-[3vw] px-2">
          {s.hands.length === 0 && (
            <div className="flex flex-col items-center gap-2 pb-4">
              <div
                className="flex items-center justify-center rounded-full border-2 border-dashed border-brass-300/35"
                style={{ width: cardPx * 3.2, height: cardPx * 3.2 }}
              >
                {bet > 0 ? <BetPile amount={bet} size={cardPx * 1.8} /> : <span className="font-ui text-sm text-brass-200/40">Mise</span>}
              </div>
            </div>
          )}
          {s.hands.map((h, i) => {
            const activeHand = s.phase === 'playing' && i === s.active;
            const showOutcome = s.phase === 'settled' && dealerDone && h.outcome;
            const good = h.outcome === 'win' || h.outcome === 'blackjack';
            return (
              <div key={i} className={`flex flex-col items-center gap-1.5 transition ${s.phase === 'playing' && !activeHand ? 'opacity-55' : ''}`}>
                {showOutcome && (
                  <div
                    className={`pop-in font-ui rounded-full px-3 py-0.5 text-sm font-bold ring-1 ${
                      good
                        ? 'bg-[#0e3a28] text-[#bdf0d2] ring-[#2c8a5d]/60'
                        : h.outcome === 'push'
                          ? 'bg-black/60 text-ivory ring-white/20'
                          : 'bg-[#4a1219] text-[#ffd9dc] ring-ruby/50'
                    }`}
                  >
                    {OUTCOME_FR[h.outcome!]}
                    {h.payout ? ` · +${fmt(h.payout)}` : ''}
                  </div>
                )}
                <div className={`flex rounded-xl p-1 ${activeHand ? 'turn-glow' : ''}`} style={{ fontSize: cardPx }}>
                  {h.cards.map((c, k) => (
                    <div key={k} style={{ marginLeft: k ? '-1.1em' : 0, marginTop: k * -0.25 + 'em' }}>
                      <PlayingCard card={c} size={cardPx} dealDelay={k < 2 && s.hands.length === 1 ? k * 520 : 0} />
                    </div>
                  ))}
                </div>
                <div className="font-ui flex items-center gap-2">
                  <span className="rounded-full bg-black/60 px-2.5 py-0.5 text-sm font-bold text-brass-200 ring-1 ring-brass-400/30">
                    {totalLabel(h.cards)}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-ivory/70">mise {fmt(h.bet)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {s.reshuffled && s.phase !== 'settled' && (
          <div className="pop-in font-ui absolute left-1/2 top-[45%] -translate-x-1/2 rounded-full bg-black/70 px-4 py-1 text-sm text-ivory/80">
            Nouveau sabot mélangé (6 jeux)
          </div>
        )}
        {s.phase === 'settled' && dealerDone && s.lastNet !== 0 && (
          <div
            className={`pop-in font-display absolute left-1/2 top-[44%] -translate-x-1/2 rounded-2xl px-5 py-1.5 text-2xl font-bold ring-1 ${
              s.lastNet > 0 ? 'bg-[#0b2a1d]/90 text-[#bdf0d2] ring-[#2c8a5d]/60' : 'bg-[#2a0d12]/90 text-[#ffd9dc] ring-ruby/50'
            }`}
          >
            {s.lastNet > 0 ? `+${fmt(s.lastNet)}` : fmt(s.lastNet)}
          </div>
        )}
      </main>

      {/* Commandes */}
      <div className="relative z-40 shrink-0 px-[max(12px,env(safe-area-inset-left))] pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
          {error && <div className="font-ui text-center text-sm text-[#ffb4bb]">{error}</div>}

          {rec && legal && (
            <div className="font-ui text-center text-sm text-ivory/70">
              Stratégie de base : <b className="text-brass-200">{ADVICE_FR[rec.advice]}</b>
            </div>
          )}

          {s.phase === 'insurance' && (
            <div className="flex flex-col items-center gap-2">
              <p className="font-ui text-center text-[15px] text-ivory/80">
                Le croupier montre un As. Prendre l'assurance pour {fmt(Math.min(Math.floor(s.hands[0].bet / 2), s.balance))} ?
                {saved.coach && <span className="block text-sm text-ivory/55">Conseil : la refuser (elle coûte en moyenne 7 % de sa mise).</span>}
              </p>
              <div className="grid w-full grid-cols-2 gap-2">
                <GhostButton onClick={() => run(() => takeInsurance(s, true))}>Prendre l'assurance</GhostButton>
                <PrimaryButton onClick={() => run(() => takeInsurance(s, false))}>Non merci</PrimaryButton>
              </div>
            </div>
          )}

          {legal && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {(['hit', 'stand', 'double', 'split', 'surrender'] as BJAction[]).map((a) => {
                const isRec = rec?.action === a;
                const cls =
                  a === 'hit'
                    ? 'btn-call'
                    : a === 'stand'
                      ? 'btn-fold'
                      : a === 'double'
                        ? 'btn-brass'
                        : 'btn-raise';
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
              <div className="flex items-center justify-center gap-2 sm:gap-4">
                {CHIPS.map((v) => (
                  <BetChip
                    key={v}
                    value={v}
                    size={portrait ? 54 : 62}
                    disabled={v > available}
                    onClick={() => {
                      setBet((b) => b + v);
                      play('chip');
                    }}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <GhostButton onClick={() => setBet(0)} disabled={bet === 0} className="py-3 text-base">
                  Effacer
                </GhostButton>
                <GhostButton
                  onClick={() => doDeal(Math.min(saved.lastBet, s.balance))}
                  className="py-3 text-base"
                  title="Rejouer la même mise"
                >
                  Remiser {fmt(Math.min(saved.lastBet, s.balance))}
                </GhostButton>
                <PrimaryButton onClick={() => doDeal(bet)} disabled={bet === 0} className="py-3 text-base">
                  Distribuer
                </PrimaryButton>
              </div>
            </div>
          )}

          {s.phase === 'settled' && !dealerDone && <div className="font-ui py-4 text-center text-ivory/50">Le croupier joue…</div>}

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
            <dt className="text-ivory/55">Mains jouées</dt>
            <dd className="text-right font-bold tabular-nums">{saved.stats.rounds}</dd>
            <dt className="text-ivory/55">Gagnées</dt>
            <dd className="text-right font-bold tabular-nums">{saved.stats.won}</dd>
            <dt className="text-ivory/55">Perdues</dt>
            <dd className="text-right font-bold tabular-nums">{saved.stats.lost}</dd>
            <dt className="text-ivory/55">Égalités</dt>
            <dd className="text-right font-bold tabular-nums">{saved.stats.pushes}</dd>
            <dt className="text-ivory/55">Blackjacks</dt>
            <dd className="text-right font-bold tabular-nums">{saved.stats.blackjacks}</dd>
            <dt className="text-ivory/55">Meilleur solde</dt>
            <dd className="text-right font-bold tabular-nums">{fmt(saved.stats.best)}</dd>
          </dl>
          <div className="mt-6 flex flex-col gap-2">
            <PrimaryButton onClick={() => setShowStats(false)}>Fermer</PrimaryButton>
            <GhostButton
              onClick={() => {
                setSaved({ ...DEFAULT_SAVED, coach: saved.coach });
                setS(createTable(START_BALANCE));
                setBet(0);
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
