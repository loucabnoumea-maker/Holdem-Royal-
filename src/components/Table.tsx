import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BotDifficulty, Card, GameState, LogEntry, PlayerState } from '../lib/poker/index.ts';
import { DIFFICULTY_FR, evaluateHand, sameCard } from '../lib/poker/index.ts';
import { fmt } from '../lib/prefs.ts';
import { Avatar } from './Avatar.tsx';
import { ChipIcon, ChipStack } from './Chips.tsx';
import { CardSlot, PlayingCard } from './PlayingCard.tsx';

export { ChipIcon };

export interface SeatMeta {
  avatar?: string;
  isBot?: boolean;
  difficulty?: BotDifficulty;
  away?: boolean;
  connected?: boolean;
  isHost?: boolean;
  /** Style du bot, ex. « Le Bluffeur ». */
  style?: string;
  styleHint?: string;
  /** Petite phrase à afficher dans une bulle. */
  bubble?: { text: string; key: number };
}

export interface TurnTimer {
  playerId: string;
  endsAt: number;
  durationMs: number;
}

interface Props {
  view: GameState;
  heroId: string | null;
  meta: Record<string, SeatMeta>;
  timer?: TurnTimer | null;
  /** Démonstration : toutes les cartes privées sont visibles. */
  revealAll?: boolean;
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

const inHand = (p: PlayerState) => p.status === 'active' || p.status === 'allin';
const clamp = (min: number, v: number, max: number) => Math.min(max, Math.max(min, v));

const ACTION_LABEL: Partial<Record<LogEntry['kind'], string>> = {
  fold: 'Couché',
  check: 'Check',
  call: 'Suit',
  bet: 'Mise',
  raise: 'Relance',
  allin: 'Tapis',
};

/** Dernière action de chaque joueur sur le tour d'enchères en cours. */
function lastActions(view: GameState): Record<string, LogEntry> {
  const out: Record<string, LogEntry> = {};
  for (const e of view.log) {
    if (e.street !== view.street || !e.playerId || !ACTION_LABEL[e.kind]) continue;
    out[e.playerId] = e;
  }
  return out;
}

interface Pos {
  x: number;
  y: number;
}

/** Toutes les tailles de la table, calculées à partir de la place disponible. */
export interface Scale {
  portrait: boolean;
  avatar: number;
  heroAvatar: number;
  name: number;
  stack: number;
  board: number;
  hero: number;
  opp: number;
  oppShown: number;
  chips: number;
  dealer: number;
  pot: number;
  badge: number;
  plateMin: number;
}

function computeScale(w: number, h: number, portrait: boolean): Scale {
  // u : unité de base (≈ 1 % de la largeur « utile ») ; f : unité de texte
  const u = portrait ? Math.min(w / 62, h / 100) : Math.min(w / 100, h / 52);
  const f = portrait ? u * 1.55 : u;
  return {
    portrait,
    avatar: clamp(34, portrait ? u * 6.4 : u * 4.6, 82),
    heroAvatar: clamp(40, portrait ? u * 7.2 : u * 5.2, 92),
    name: clamp(10, f * 0.92, 17),
    stack: clamp(12, f * 1.12, 21),
    board: portrait ? clamp(14, w * 0.05, 30) : clamp(14, u * 2.3, 38),
    hero: portrait ? clamp(18, w * 0.06, 32) : clamp(18, u * 2.5, 40),
    opp: clamp(10, f * 1.0, 18),
    oppShown: clamp(14, f * 1.3, 24),
    chips: clamp(0.7, f / 12.5, 1.45),
    dealer: clamp(18, f * 1.65, 32),
    pot: clamp(13, f * 1.2, 24),
    badge: clamp(10, f * 0.85, 15),
    plateMin: clamp(64, f * 7.2, 132),
  };
}

export function Table({ view, heroId, meta, timer, revealAll = false }: Props) {
  const [ref, area] = useSize<HTMLDivElement>();
  const portrait = area.w / Math.max(1, area.h) < 1.05;
  // La table remplit toute la zone disponible (proportions bornées)
  const aspect = portrait ? clamp(0.55, area.w / Math.max(1, area.h), 0.85) : clamp(1.45, area.w / Math.max(1, area.h), 2.1);
  const tableW = Math.max(200, Math.min(area.w, area.h * aspect));
  const tableH = tableW / aspect;
  const S = computeScale(tableW, tableH, portrait);

  const n = view.players.length;
  const heroIdx = Math.max(0, view.players.findIndex((p) => p.id === heroId));
  const handOver = view.phase === 'handOver' || view.phase === 'gameOver';
  const showdown = handOver && view.lastHand?.showdown ? view.lastHand : null;
  const winners = new Set(Object.keys(view.lastHand?.winnings ?? {}));

  let winningCards: Card[] = [];
  if (showdown && showdown.awards[0]) {
    const w = showdown.awards[0].winners[0];
    winningCards = showdown.hands.find((h) => h.playerId === w)?.hand.cards ?? [];
  }
  const isWinning = (c: Card) => winningCards.some((x) => sameCard(x, c));

  const potNow = view.players.reduce((s, p) => s + p.totalBet, 0);
  const collected = view.players.reduce((s, p) => s + (p.totalBet - p.bet), 0);
  const potTotal = handOver ? (view.lastHand?.pots.reduce((s, p) => s + p.amount, 0) ?? 0) : potNow;
  const actions = view.phase === 'betting' ? lastActions(view) : {};

  // Ellipse des sièges, le joueur principal toujours en bas au centre
  // Centre un peu remonté : le siège du joueur (en bas) garde de la place pour son nom et son tapis
  const rx = portrait ? 39 : 43.5;
  const ry = portrait ? 39 : 37.5;
  const cy = portrait ? 48 : 47.5;
  const seatPos = (i: number): Pos => {
    const rel = (i - heroIdx + n) % n;
    const a = Math.PI / 2 + (rel * 2 * Math.PI) / n;
    return { x: 50 + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  };
  const toward = (p: Pos, k: number): Pos => ({ x: 50 + (p.x - 50) * k, y: cy + (p.y - cy) * k });

  const firstWinner = view.lastHand?.awards[0]?.winners[0];
  const winnerIdx = firstWinner ? view.players.findIndex((p) => p.id === firstWinner) : -1;

  return (
    <div ref={ref} className="flex h-full w-full items-center justify-center">
      <div className="relative" style={{ width: tableW, height: tableH }}>
        {/* Lumière de la lampe au-dessus de la table */}
        <div
          className="pointer-events-none absolute -inset-[6%] rounded-[50%]"
          style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(255,226,170,.11), transparent 62%)' }}
        />
        {/* Rebord cuir → filet laiton → feutre */}
        <div className={`rail absolute rounded-[50%] ${portrait ? 'inset-x-[6%] inset-y-[5%]' : 'inset-x-[5%] inset-y-[7%]'}`}>
          <div className="brass-rim absolute inset-[2.6%] rounded-[50%] p-[0.35%]">
            <div className="felt relative h-full w-full overflow-hidden rounded-[50%]">
              <div className="betting-line pointer-events-none absolute inset-[12%] rounded-[50%]" />
              <div
                className={`pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center font-display italic text-brass-200/[0.12] ${
                  portrait ? 'top-[26%]' : 'top-[19%]'
                }`}
                style={{ letterSpacing: '0.04em', fontSize: S.pot * 1.5 }}
              >
                Hold'em Royal
              </div>
            </div>
          </div>
        </div>

        {/* Centre : tableau + pot */}
        <div
          className="absolute left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ top: portrait ? '47%' : '48%', gap: S.board * 0.45 }}
        >
          {!handOver && potTotal > 0 && (
            <div className="flex items-center" style={{ gap: S.board * 0.4 }}>
              {collected > 0 && <ChipStack amount={collected} scale={S.chips} label={false} />}
              <div
                className="font-ui rounded-full bg-black/60 font-bold tabular-nums text-brass-200 ring-1 ring-brass-400/35"
                style={{ fontSize: S.pot, padding: `${S.pot * 0.15}px ${S.pot * 0.75}px` }}
              >
                Pot : {fmt(potTotal)}
              </div>
            </div>
          )}
          <div className="relative flex" style={{ gap: S.board * 0.28 }}>
            <span id="deal-origin" className="pointer-events-none absolute left-1/2 top-0 h-px w-px" aria-hidden />
            {Array.from({ length: 5 }, (_, i) => {
              const c = view.board[i];
              return c ? (
                <PlayingCard
                  key={`${view.handNumber}-${i}`}
                  card={c}
                  size={S.board}
                  dealDelay={i < 3 ? i * 160 : 0}
                  highlight={isWinning(c)}
                  dim={!!showdown && winningCards.length > 0 && !isWinning(c)}
                />
              ) : (
                <CardSlot key={`s${i}`} size={S.board} />
              );
            })}
          </div>
          {handOver && view.lastHand && <ResultBanner view={view} S={S} />}
        </div>

        {/* Le pot glisse vers le gagnant */}
        {handOver && winnerIdx >= 0 && potTotal > 0 && (
          <PotToWinner key={`win-${view.handNumber}`} to={toward(seatPos(winnerIdx), 0.6)} amount={potTotal} scale={S.chips} />
        )}

        {view.players.map((p, i) => {
          const pos = seatPos(i);
          const bet = toward(pos, portrait ? 0.6 : 0.63);
          const dealer = toward(pos, 0.74);
          const dOff = portrait ? 8 : 4.5;
          const shown = showdown?.hands.find((h) => h.playerId === p.id);
          const volunteered = handOver ? view.lastHand?.shown?.find((h) => h.playerId === p.id) : undefined;
          return (
            <div key={p.id}>
              {p.bet > 0 && view.phase === 'betting' && (
                <div className="chip-in absolute z-20 -translate-x-1/2 -translate-y-1/2" style={{ left: `${bet.x}%`, top: `${bet.y}%` }}>
                  <ChipStack amount={p.bet} scale={S.chips} />
                </div>
              )}
              {i === view.buttonIndex && view.handNumber > 0 && (
                <div
                  className="absolute z-30 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-display font-extrabold text-[#2a1c06]"
                  style={{
                    left: `${dealer.x + (pos.x >= 50 ? -dOff : dOff)}%`,
                    top: `${dealer.y}%`,
                    width: S.dealer,
                    height: S.dealer,
                    fontSize: S.dealer * 0.5,
                    background: 'radial-gradient(circle at 35% 30%, #fffaf0, #e6dcc2 60%, #b9ad8f)',
                    boxShadow: '0 3px 6px rgba(0,0,0,.55), inset 0 -2px 0 rgba(0,0,0,.15)',
                  }}
                  title="Bouton du donneur"
                >
                  D
                </div>
              )}
              <Seat
                dealOrder={(i - view.buttonIndex - 1 + view.players.length) % view.players.length}
                seats={view.players.length}
                player={p}
                pos={pos}
                S={S}
                board={view.board}
                isHero={p.id === heroId}
                isTurn={view.phase === 'betting' && view.toAct === i}
                isWinner={handOver && winners.has(p.id)}
                meta={meta[p.id] ?? {}}
                handNumber={view.handNumber}
                shownCards={shown?.holeCards ?? volunteered?.holeCards}
                shownLabel={shown?.hand.description ?? (volunteered ? 'Montre ses cartes' : undefined)}
                winningCards={winningCards}
                blind={i === view.sbIndex ? 'PB' : i === view.bbIndex ? 'GB' : null}
                timer={timer && timer.playerId === p.id && view.phase === 'betting' ? timer : null}
                phase={view.phase}
                lastAction={actions[p.id]}
                revealAll={revealAll}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PotToWinner({ to, amount, scale }: { to: Pos; amount: number; scale: number }) {
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMoved(true), 650);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      className="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${moved ? to.x : 50}%`,
        top: `${moved ? to.y : 50}%`,
        transition: 'left .75s cubic-bezier(.3,.7,.2,1), top .75s cubic-bezier(.3,.7,.2,1)',
      }}
    >
      <ChipStack amount={amount} scale={scale * 1.1} label={false} />
    </div>
  );
}

function ResultBanner({ view, S }: { view: GameState; S: Scale }) {
  const lh = view.lastHand!;
  const lines = Object.entries(lh.winnings).map(([id, amount]) => {
    const p = view.players.find((x) => x.id === id);
    const desc = lh.hands.find((h) => h.playerId === id)?.hand.description;
    return { id, name: p?.name ?? '?', amount, desc };
  });
  return (
    <div
      className="pop-in flex max-w-[86vw] flex-col items-center rounded-2xl bg-[#0b1712]/85 text-center ring-1 ring-brass-400/45 backdrop-blur"
      style={{ padding: `${S.pot * 0.3}px ${S.pot * 0.9}px`, gap: 2 }}
    >
      {lines.map((l) => (
        <div key={l.id} className="leading-tight">
          <span className="font-display font-bold text-brass-200" style={{ fontSize: S.pot }}>
            {l.name}
          </span>{' '}
          <span className="font-ui font-semibold text-ivory" style={{ fontSize: S.pot }}>
            +{fmt(l.amount)}
          </span>
          {l.desc && (
            <div className="font-ui text-ivory/70" style={{ fontSize: S.pot * 0.75 }}>
              {l.desc}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface SeatProps {
  /** Rang de distribution (0 = à gauche du bouton) et nombre de sièges. */
  dealOrder: number;
  seats: number;
  player: PlayerState;
  pos: Pos;
  S: Scale;
  board: Card[];
  isHero: boolean;
  isTurn: boolean;
  isWinner: boolean;
  meta: SeatMeta;
  handNumber: number;
  shownCards?: Card[];
  shownLabel?: string;
  winningCards: Card[];
  blind: 'PB' | 'GB' | null;
  timer: TurnTimer | null;
  phase: GameState['phase'];
  lastAction?: LogEntry;
  revealAll: boolean;
}

function Seat(props: SeatProps) {
  const { player: p, pos, S, isHero, isTurn, isWinner, meta, shownCards, shownLabel, lastAction } = props;
  const out = p.status === 'out';
  const folded = p.status === 'folded';
  const hasCards = p.holeCards.length > 0 || (inHand(p) && props.handNumber > 0);
  const cards: (Card | null)[] = shownCards ?? (p.holeCards.length ? p.holeCards : [null, null]);
  const faceUp = !!shownCards || ((isHero || props.revealAll) && p.holeCards.length > 0);
  const cardPx = isHero ? S.hero : shownCards || (props.revealAll && p.holeCards.length) ? S.oppShown : S.opp;
  const isWin = (c: Card | null) => !!c && props.winningCards.some((w) => sameCard(w, c));
  const avatar = isHero ? S.heroAvatar : S.avatar;
  const showCards = hasCards && !out && !(folded && !isHero) && props.phase !== 'waiting';

  // Force actuelle de la main du joueur (aide visuelle)
  let heroHand: string | null = null;
  if (isHero && p.holeCards.length === 2 && props.board.length >= 3 && !folded && !out && !shownLabel) {
    heroHand = evaluateHand([...p.holeCards, ...props.board]).description;
  }

  let status: string | null = null;
  if (out) status = 'Éliminé';
  else if (meta.away) status = 'Absent';
  else if (p.status === 'allin') status = 'Tapis';

  const actionText = lastAction
    ? (ACTION_LABEL[lastAction.kind] ?? '') +
      (lastAction.amount && lastAction.kind !== 'fold' && lastAction.kind !== 'check' ? ` ${fmt(lastAction.amount)}` : '')
    : null;
  const badgeStyle = { fontSize: S.badge, padding: `0 ${S.badge * 0.5}px`, lineHeight: 1.45 };

  return (
    <div
      className={`absolute z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center ${out ? 'opacity-35 grayscale' : ''}`}
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
    >
      {showCards && (
        <div
          className={`relative z-0 flex ${folded ? 'opacity-40' : ''}`}
          style={{ marginBottom: -cardPx * (isHero ? 0.9 : 1.1), gap: isHero ? cardPx * 0.15 : 0 }}
        >
          {cards.slice(0, 2).map((c, k) => (
            <PlayingCard
              key={`${props.handNumber}-${k}`}
              card={c}
              faceUp={faceUp}
              size={cardPx}
              dealDelay={(k * props.seats + props.dealOrder) * 95}
              dealFrom="deal-origin"
              highlight={isWin(c)}
              className={isHero ? (k === 0 ? '-rotate-3' : 'rotate-3') : k === 0 ? '-rotate-[8deg]' : 'rotate-[8deg] -ml-[1em]'}
            />
          ))}
        </div>
      )}

      <div className="relative z-10 flex flex-col items-center">
        <div className={`relative rounded-full ${isTurn ? 'turn-glow' : isWinner ? 'win-glow' : ''}`}>
          <Avatar id={p.id} name={p.name} size={avatar} hero={isHero} />
          {props.timer && <TimerRing timer={props.timer} />}
          {meta.connected === false && !meta.isBot && (
            <span className="absolute -right-0.5 top-0 h-3 w-3 rounded-full bg-ruby ring-2 ring-night" title="Déconnecté" />
          )}
          {props.blind && !out && props.phase === 'betting' && (
            <span
              className={`font-ui absolute -left-1 top-0 rounded-full font-bold ring-1 ring-black/40 ${
                props.blind === 'GB' ? 'bg-brass-300 text-[#2a1c06]' : 'bg-ivory text-[#2a1c06]'
              }`}
              style={badgeStyle}
            >
              {props.blind}
            </span>
          )}
        </div>
        <div
          className={`flex flex-col items-center rounded-xl text-center ${
            isHero ? 'bg-[#2a2112]/95 ring-1 ring-brass-400/60' : 'bg-[#0a1411]/92 ring-1 ring-white/10'
          }`}
          style={{
            marginTop: -avatar * 0.08,
            minWidth: S.plateMin,
            padding: `${S.name * 0.25}px ${S.name * 0.75}px ${S.name * 0.15}px`,
            boxShadow: '0 4px 10px rgba(0,0,0,.5)',
          }}
          title={meta.styleHint}
        >
          <div className="font-ui truncate font-semibold text-ivory/90" style={{ fontSize: S.name, maxWidth: S.plateMin * 1.2 }}>
            {p.name}
            {meta.isHost && <span title="Hôte"> ♛</span>}
          </div>
          <div className="font-ui font-bold tabular-nums leading-tight text-brass-300" style={{ fontSize: S.stack }}>
            {fmt(p.stack)}
          </div>
        </div>
      </div>

      <div className="mt-0.5 flex flex-col items-center gap-0.5" style={{ minHeight: S.badge * 1.5 }}>
        {shownLabel ? (
          <span
            className="pop-in font-ui rounded-md bg-black/80 text-center font-semibold leading-tight text-brass-200 ring-1 ring-brass-400/30"
            style={{ ...badgeStyle, maxWidth: S.plateMin * 1.4 }}
          >
            {shownLabel}
          </span>
        ) : status ? (
          <span className={`font-ui rounded-md font-bold ${status === 'Tapis' ? 'bg-ruby text-white' : 'bg-black/65 text-ivory/70'}`} style={badgeStyle}>
            {status}
          </span>
        ) : actionText ? (
          <span
            key={`${lastAction!.kind}-${lastAction!.amount}`}
            className={`pop-in font-ui rounded-md font-bold ${
              lastAction!.kind === 'fold'
                ? 'bg-black/60 text-ivory/50'
                : lastAction!.kind === 'check' || lastAction!.kind === 'call'
                  ? 'bg-[#0e3a28] text-[#bdf0d2] ring-1 ring-[#2c8a5d]/50'
                  : 'bg-[#3a2a0c] text-brass-200 ring-1 ring-brass-400/50'
            }`}
            style={badgeStyle}
          >
            {actionText}
          </span>
        ) : folded && props.phase === 'betting' ? (
          <span className="font-ui rounded-md bg-black/60 font-bold text-ivory/50" style={badgeStyle}>
            Couché
          </span>
        ) : meta.isBot && meta.difficulty ? (
          <span className="font-ui whitespace-nowrap text-ivory/45" style={{ fontSize: S.badge * 0.95 }} title={meta.styleHint}>
            {meta.style ? `${meta.style} · ${DIFFICULTY_FR[meta.difficulty].toLowerCase()}` : `Bot ${DIFFICULTY_FR[meta.difficulty].toLowerCase()}`}
          </span>
        ) : null}
        {heroHand && (
          <span className="font-ui rounded-md bg-brass-400/15 font-semibold text-brass-200 ring-1 ring-brass-400/35" style={badgeStyle}>
            {heroHand}
          </span>
        )}
      </div>

      {meta.bubble && <SpeechBubble key={meta.bubble.key} text={meta.bubble.text} below={pos.y < 32} size={S.name * 1.1} />}
    </div>
  );
}

/** Bulle de dialogue au-dessus (ou en dessous) d'un joueur. */
function SpeechBubble({ text, below, size }: { text: string; below: boolean; size: number }) {
  return (
    <div
      className={`pop-in pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 ${below ? 'top-full mt-1' : 'bottom-full mb-1'}`}
      role="status"
    >
      <div
        className="font-ui relative whitespace-normal rounded-2xl bg-ivory text-center font-semibold leading-snug text-[#1d1a12]"
        style={{
          boxShadow: '0 6px 16px rgba(0,0,0,.5)',
          width: 'max-content',
          maxWidth: size * 13,
          fontSize: size,
          padding: `${size * 0.35}px ${size * 0.8}px`,
        }}
      >
        {text}
        <span className={`absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-ivory ${below ? '-top-1' : '-bottom-1'}`} aria-hidden />
      </div>
    </div>
  );
}

function TimerRing({ timer }: { timer: TurnTimer }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, timer.endsAt - now);
  const pct = Math.min(1, left / timer.durationMs);
  const secs = Math.ceil(left / 1000);
  const color = pct > 0.5 ? '#e3c681' : pct > 0.2 ? '#f59e0b' : '#ef4444';
  return (
    <>
      <div
        className="pointer-events-none absolute -inset-[4px] rounded-full"
        style={{
          background: `conic-gradient(${color} ${pct * 360}deg, rgba(0,0,0,.4) 0)`,
          WebkitMask: 'radial-gradient(circle, transparent 64%, #000 66%)',
          mask: 'radial-gradient(circle, transparent 64%, #000 66%)',
        }}
      />
      <span className="font-ui absolute -right-2 -top-1 rounded-full bg-black/85 px-1 text-[11px] font-bold tabular-nums" style={{ color }}>
        {secs}
      </span>
    </>
  );
}
