// Intelligence des bots — module pur, exécutable dans le navigateur (solo)
// comme dans une Supabase Edge Function (parties en ligne).
// Un bot ne voit JAMAIS les cartes des autres : il décide à partir de getPublicView().
//
// Deux axes indépendants :
//   • la DIFFICULTÉ = le niveau technique (précision du calcul, erreurs, lecture des adversaires) ;
//   • la PERSONNALITÉ = le style humain (mains jouées, agressivité, bluffs, pièges, tilt, bavardage).
import type { Card, Rng } from './cards.ts';
import { createDeck, cryptoRng, sameCard, shuffle } from './cards.ts';
import { evaluateHand } from './evaluator.ts';
import type { GameState, LegalActions, LogEntry, PlayerAction } from './game.ts';
import { getLegalActions, getPublicView } from './game.ts';

export type BotDifficulty = 'easy' | 'medium' | 'hard';
export type BotSpeed = 'fast' | 'normal';

export const DIFFICULTY_FR: Record<BotDifficulty, string> = {
  easy: 'Facile',
  medium: 'Moyen',
  hard: 'Difficile',
};

export const BOT_NAMES = [
  'Max', 'Inès', 'Sam', 'Léa', 'Hugo', 'Nora', 'Enzo', 'Jade', 'Tom', 'Zoé', 'Malik', 'Chloé', 'Yanis', 'Lina',
];
export const BOT_AVATARS = ['🦊', '🐼', '🦁', '🐯', '🐸', '🐙', '🦉', '🐺', '🐻', '🐨', '🦈', '🐲'];

// ---------------------------------------------------------------- Personnalités

export type PersonalityId = 'shark' | 'maniac' | 'rock' | 'station' | 'bluffer' | 'grinder';

export interface Personality {
  id: PersonalityId;
  /** Nom affiché, ex. « Le Requin ». */
  name: string;
  description: string;
  /** -1 très serré … +1 joue presque tout. */
  loose: number;
  /** 0 passif … 1 mise et relance tout le temps. */
  aggro: number;
  /** 0 ne bluffe jamais … 1 bluffe dès qu'il peut. */
  bluff: number;
  /** 0 se couche facilement … 1 paie jusqu'au bout. */
  sticky: number;
  /** Tendance à cacher une grosse main (slowplay). */
  trap: number;
  /** Sensibilité au tilt après une grosse perte. */
  tilt: number;
  /** Fréquence des petites phrases à table. */
  talk: number;
  /** Probabilité de montrer un bluff gagné. */
  showBluff: number;
  /** Rythme de jeu (multiplie le temps de réflexion). */
  pace: number;
  /** Bluffe dans des proportions mathématiquement équilibrées. */
  balanced?: boolean;
}

export const PERSONALITIES: Record<PersonalityId, Personality> = {
  shark: {
    id: 'shark', name: 'Le Requin', description: 'Serré et agressif : peu de mains, mais jouées fort. Bluffe au bon moment.',
    loose: 0, aggro: 0.75, bluff: 0.5, sticky: 0.35, trap: 0.3, tilt: 0.15, talk: 0.25, showBluff: 0.12, pace: 1, balanced: true,
  },
  maniac: {
    id: 'maniac', name: 'La Kamikaze', description: 'Joue presque tout, relance sans arrêt, adore les tapis.',
    loose: 0.75, aggro: 0.95, bluff: 0.85, sticky: 0.5, trap: 0.05, tilt: 0.6, talk: 0.8, showBluff: 0.5, pace: 0.6,
  },
  rock: {
    id: 'rock', name: 'Le Roc', description: 'Ultra-prudent : attend les grosses mains et ne bluffe presque jamais.',
    loose: -0.65, aggro: 0.45, bluff: 0.08, sticky: 0.2, trap: 0.45, tilt: 0.1, talk: 0.15, showBluff: 0.02, pace: 1.15,
  },
  station: {
    id: 'station', name: 'Le Curieux', description: 'Veut toujours voir les cartes : paie beaucoup, mise peu.',
    loose: 0.5, aggro: 0.15, bluff: 0.08, sticky: 0.9, trap: 0.1, tilt: 0.3, talk: 0.5, showBluff: 0.05, pace: 0.9,
  },
  bluffer: {
    id: 'bluffer', name: 'Le Bluffeur', description: 'Raconte des histoires : mises sur les cartes qui font peur, gros bluffs à la river.',
    loose: 0.3, aggro: 0.75, bluff: 1, sticky: 0.3, trap: 0.15, tilt: 0.4, talk: 0.7, showBluff: 0.6, pace: 1,
  },
  grinder: {
    id: 'grinder', name: 'Le Matheux', description: 'Calcule tout, joue équilibré, ne s’énerve jamais.',
    loose: -0.1, aggro: 0.55, bluff: 0.4, sticky: 0.4, trap: 0.25, tilt: 0, talk: 0.1, showBluff: 0.05, pace: 1.25, balanced: true,
  },
};

export const PERSONALITY_IDS = Object.keys(PERSONALITIES) as PersonalityId[];

/** Personnalité par défaut quand rien n'est précisé. */
export function defaultPersonality(d: BotDifficulty): PersonalityId {
  return d === 'easy' ? 'station' : d === 'medium' ? 'shark' : 'grinder';
}

/** Tire `n` personnalités variées (pas deux fois la même avant d'avoir fait le tour). */
export function randomPersonalities(n: number, rng: Rng = Math.random): PersonalityId[] {
  const out: PersonalityId[] = [];
  while (out.length < n) out.push(...shuffle(PERSONALITY_IDS, rng));
  return out.slice(0, n);
}

/** Humeur d'un bot : le tilt monte après une grosse perte et redescend petit à petit. */
export interface BotMood {
  tilt: number;
}
export type BotMoods = Record<string, BotMood>;

// ---------------------------------------------------------------- Statistiques adverses

export interface PlayerStats {
  hands: number;
  /** Mains où le joueur a mis volontairement des jetons préflop. */
  vpip: number;
  /** Mises + relances. */
  aggressive: number;
  /** Suivis + checks. */
  passive: number;
  /** Fois où il a fait face à une mise après le flop… */
  faced?: number;
  /** … et s'est couché. */
  foldsToBet?: number;
}
export type OpponentStats = Record<string, PlayerStats>;

export type PlayStyle = 'aggressive' | 'passive' | 'unknown';

export function playStyle(s: PlayerStats | undefined): PlayStyle {
  if (!s || s.aggressive + s.passive < 8) return 'unknown';
  const af = s.aggressive / Math.max(1, s.passive);
  if (af >= 0.9) return 'aggressive';
  if (af <= 0.4) return 'passive';
  return 'unknown';
}

/** Probabilité observée qu'un joueur se couche face à une mise (null si pas assez de données). */
export function foldToBetRate(s: PlayerStats | undefined): number | null {
  if (!s || (s.faced ?? 0) < 6) return null;
  return (s.foldsToBet ?? 0) / (s.faced ?? 1);
}

/** Part des mains jouées volontairement (null si pas assez de données). */
export function vpipRate(s: PlayerStats | undefined): number | null {
  if (!s || s.hands < 8) return null;
  return s.vpip / s.hands;
}

/** Met à jour les stats avec le journal d'une main terminée. Renvoie un nouvel objet. */
export function updateOpponentStats(stats: OpponentStats, state: GameState): OpponentStats {
  const out: OpponentStats = structuredClone(stats);
  const dealt = state.players.filter((p) => p.holeCards.length > 0 || p.status !== 'out');
  const vpipThisHand = new Set<string>();
  for (const p of dealt) {
    out[p.id] ??= { hands: 0, vpip: 0, aggressive: 0, passive: 0 };
    out[p.id].hands++;
  }
  let betOnStreet = false;
  let street = '';
  for (const e of state.log) {
    if (e.street !== street) {
      street = e.street;
      betOnStreet = false;
    }
    if (e.kind === 'street') {
      betOnStreet = false;
      continue;
    }
    if (!e.playerId || !out[e.playerId]) continue;
    const st = out[e.playerId];
    if (e.street !== 'preflop' && betOnStreet && (e.kind === 'fold' || e.kind === 'call' || e.kind === 'raise' || e.kind === 'allin')) {
      st.faced = (st.faced ?? 0) + 1;
      if (e.kind === 'fold') st.foldsToBet = (st.foldsToBet ?? 0) + 1;
    }
    if (e.kind === 'bet' || e.kind === 'raise' || e.kind === 'allin') {
      st.aggressive++;
      betOnStreet = true;
    }
    if (e.kind === 'call' || e.kind === 'check') st.passive++;
    if (e.street === 'preflop' && (e.kind === 'call' || e.kind === 'raise' || e.kind === 'allin' || e.kind === 'bet')) {
      vpipThisHand.add(e.playerId);
    }
  }
  for (const id of vpipThisHand) out[id].vpip++;
  return out;
}

// ---------------------------------------------------------------- Force de main

/** Formule de Chen : force d'une main de départ, de -1 (7-2) à 20 (A-A). */
export function chenScore(hole: Card[]): number {
  const [a, b] = hole[0].rank >= hole[1].rank ? hole : [hole[1], hole[0]];
  const base = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  let score = base(a.rank);
  if (a.rank === b.rank) return Math.max(5, score * 2);
  if (a.suit === b.suit) score += 2;
  const gap = a.rank - b.rank - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && a.rank < 12) score += 1;
  return Math.ceil(score);
}

/**
 * Équité par simulation Monte Carlo : probabilité de gagner (égalités partagées)
 * contre `opponents` mains aléatoires, en complétant le tableau.
 */
export function estimateEquity(
  hole: Card[],
  board: Card[],
  opponents: number,
  iterations = 1000,
  rng: Rng = Math.random,
): number {
  if (opponents <= 0) return 1;
  const known = [...hole, ...board];
  const deck = createDeck().filter((c) => !known.some((k) => sameCard(k, c)));
  const need = 5 - board.length;
  const draw = need + opponents * 2;
  let total = 0;

  for (let it = 0; it < iterations; it++) {
    // Fisher-Yates partiel : seules les `draw` premières cartes nous intéressent.
    for (let i = 0; i < draw; i++) {
      const j = i + Math.floor(rng() * (deck.length - i));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    const fullBoard = need ? board.concat(deck.slice(0, need)) : board;
    const mine = evaluateHand(hole.concat(fullBoard)).score;
    let best = true;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      const k = need + o * 2;
      const theirs = evaluateHand([deck[k], deck[k + 1], ...fullBoard]).score;
      if (theirs > mine) {
        best = false;
        break;
      }
      if (theirs === mine) ties++;
    }
    if (best) total += 1 / (ties + 1);
  }
  return total / iterations;
}

/** Tirages : couleur (4 cartes d'une couleur) et quinte (ventrale ou par les deux bouts). */
export function detectDraws(hole: Card[], board: Card[]) {
  if (board.length < 3 || board.length >= 5) return { flush: false, openEnded: false, gutshot: false };
  const all = [...hole, ...board];
  let flush = false;
  for (const suit of ['s', 'h', 'd', 'c']) {
    const n = all.filter((c) => c.suit === suit).length;
    if (n === 4 && hole.some((c) => c.suit === suit)) flush = true;
  }
  const ranks = new Set<number>(all.map((c) => c.rank));
  if (ranks.has(14)) ranks.add(1);
  const holeRanks = new Set<number>(hole.flatMap((c) => (c.rank === 14 ? [14, 1] : [c.rank])));
  let openEnded = false;
  let gutshot = false;
  for (let low = 1; low <= 10; low++) {
    const window = [low, low + 1, low + 2, low + 3, low + 4];
    const present = window.filter((r) => ranks.has(r));
    if (present.length !== 4 || !present.some((r) => holeRanks.has(r))) continue;
    const missing = window.find((r) => !ranks.has(r))!;
    if ((missing === low || missing === low + 4) && low > 1 && low + 4 < 14) openEnded = true;
    else gutshot = true;
  }
  return { flush, openEnded, gutshot: gutshot && !openEnded };
}

/** Le tableau fait peur : couleur ou quinte possible, ou grosse carte qui vient de tomber. */
function scaryBoard(board: Card[]): { scary: boolean; scareCard: boolean } {
  if (board.length < 3) return { scary: false, scareCard: false };
  const suitCounts: Record<string, number> = {};
  for (const c of board) suitCounts[c.suit] = (suitCounts[c.suit] ?? 0) + 1;
  const flushy = Object.values(suitCounts).some((n) => n >= 3);
  const ranks = [...new Set(board.map((c) => c.rank))].sort((a, b) => a - b);
  let straighty = false;
  for (let i = 0; i + 2 < ranks.length; i++) if (ranks[i + 2] - ranks[i] <= 4) straighty = true;
  const last = board[board.length - 1];
  const prev = board.slice(0, -1);
  const overcard = board.length > 3 && last.rank >= 13 && prev.every((c) => c.rank < last.rank);
  const completesFlush = board.length > 3 && suitCounts[last.suit] === 3;
  return { scary: flushy || straighty, scareCard: overcard || completesFlush };
}

// ---------------------------------------------------------------- Niveau technique

interface Skill {
  iterations: number;
  /** Erreur d'appréciation de la force de la main (±). */
  noise: number;
  /** Paie trop (débutant). */
  extraSticky: number;
  /** Tient compte de la position. */
  positional: number;
  /** Lit le style des adversaires. */
  reads: boolean;
  /** Erreur grossière occasionnelle. */
  blunder: number;
  /** Ajuste la force de sa main selon la mise adverse. */
  rangeAware: number;
  /** Envie de payer pour voir le flop quand c'est bon marché. */
  cheapCalls: number;
}

const SKILL: Record<BotDifficulty, Skill> = {
  easy: { iterations: 120, noise: 0.16, extraSticky: 0.3, positional: 0.25, reads: false, blunder: 0.1, rangeAware: 0, cheapCalls: 1.25 },
  medium: { iterations: 350, noise: 0.05, extraSticky: 0.08, positional: 1, reads: true, blunder: 0.02, rangeAware: 0.7, cheapCalls: 1 },
  hard: { iterations: 1000, noise: 0, extraSticky: 0, positional: 1, reads: true, blunder: 0, rangeAware: 1, cheapCalls: 0.85 },
};

// ---------------------------------------------------------------- Contexte de décision

interface Ctx {
  view: GameState;
  legal: LegalActions;
  me: GameState['players'][number];
  hole: Card[];
  opponents: number;
  /** 0 = parle en premier, 1 = parle en dernier (bouton). */
  position: number;
  bb: number;
  pot: number;
  toCall: number;
  potOdds: number;
  effBB: number;
  rng: Rng;
  stats: OpponentStats;
  skill: Skill;
  /** Personnalité ajustée par le tilt. */
  p: Personality;
  tilt: number;
  aggressorId: string | null;
  preflopRaiser: string | null;
  preflopRaises: number;
  limpers: number;
  /** Tous les autres ont checké ce tour (on peut « voler » le pot). */
  checkedToMe: boolean;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const isAggro = (e: LogEntry) => e.kind === 'bet' || e.kind === 'raise' || e.kind === 'allin';

function buildCtx(state: GameState, botId: string, rng: Rng, stats: OpponentStats, skill: Skill, base: Personality, tilt: number): Ctx | null {
  const view = getPublicView(state, botId);
  const legal = getLegalActions(view);
  if (!legal || legal.playerId !== botId) return null;
  const me = view.players.find((p) => p.id === botId)!;
  const inHand = view.players.filter((p) => p.status === 'active' || p.status === 'allin');
  const n = view.players.length;
  const order: string[] = [];
  for (let k = 1; k <= n; k++) {
    const p = view.players[(view.buttonIndex + k) % n];
    if (p.status === 'active' || p.status === 'allin') order.push(p.id);
  }
  const rawPos = order.length > 1 ? order.indexOf(botId) / (order.length - 1) : 1;
  const position = 0.5 + (rawPos - 0.5) * skill.positional;
  const biggestOther = Math.max(0, ...inHand.filter((p) => p.id !== botId).map((p) => p.stack + p.bet));
  const eff = Math.min(me.stack + me.bet, biggestOther);
  const streetLog = view.log.filter((e) => e.street === view.street && e.playerId);
  const lastAgg = [...streetLog].reverse().find(isAggro);
  const preLog = view.log.filter((e) => e.street === 'preflop');
  const preAgg = [...preLog].reverse().find(isAggro);
  const firstRaise = preLog.findIndex(isAggro);
  const limpers = preLog.filter((e, i) => e.kind === 'call' && (firstRaise < 0 || i < firstRaise)).length;
  const othersActive = inHand.filter((p) => p.id !== botId && p.status === 'active');
  const checkedToMe =
    view.street !== 'preflop' &&
    legal.canCheck &&
    othersActive.length > 0 &&
    othersActive.every((p) => streetLog.some((e) => e.playerId === p.id && e.kind === 'check'));

  // Le tilt rend plus large, plus agressif, plus bluffeur et plus têtu.
  const p: Personality = {
    ...base,
    loose: base.loose + tilt * 0.6,
    aggro: clamp01(base.aggro + tilt * 0.3),
    bluff: clamp01(base.bluff + tilt * 0.35),
    sticky: clamp01(base.sticky + tilt * 0.25 + skill.extraSticky),
    trap: base.trap * (1 - tilt),
  };

  return {
    view,
    legal,
    me,
    hole: me.holeCards,
    opponents: inHand.length - 1,
    position,
    bb: view.bigBlind,
    pot: legal.pot,
    toCall: legal.callAmount,
    potOdds: legal.callAmount / Math.max(1, legal.pot + legal.callAmount),
    effBB: eff / view.bigBlind,
    rng,
    stats,
    skill,
    p,
    tilt,
    aggressorId: lastAgg?.playerId ?? null,
    preflopRaiser: preAgg?.playerId ?? null,
    preflopRaises: preLog.filter((e) => e.kind === 'raise' || e.kind === 'allin').length,
    limpers,
    checkedToMe,
  };
}

// ---------------------------------------------------------------- Actions

export type DecisionKind = 'fold' | 'check' | 'call' | 'value' | 'bluff' | 'semibluff' | 'trap' | 'steal' | 'herocall';

interface Choice {
  action: PlayerAction;
  kind: DecisionKind;
  /** Décision difficile (le bot « réfléchit » longtemps). */
  tough?: boolean;
}

function raiseTo(c: Ctx, to: number, kind: DecisionKind): Choice {
  const { legal } = c;
  if (!legal.canRaise) return passive(c);
  const amount = Math.round(Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, to)));
  if (amount >= legal.maxRaiseTo) return { action: { type: 'allin' }, kind };
  return { action: { type: legal.isBet ? 'bet' : 'raise', amount }, kind };
}

/** Mise d'une fraction du pot (en tenant compte de ce qu'il faut suivre). */
function potBet(c: Ctx, fraction: number, kind: DecisionKind): Choice {
  return raiseTo(c, c.legal.currentBet + (c.pot + c.toCall) * fraction, kind);
}

const passive = (c: Ctx, kind?: DecisionKind): Choice =>
  c.legal.canCheck ? { action: { type: 'check' }, kind: 'check' } : { action: { type: 'call' }, kind: kind ?? 'call' };
const foldOrCheck = (c: Ctx): Choice =>
  c.legal.canCheck ? { action: { type: 'check' }, kind: 'check' } : { action: { type: 'fold' }, kind: 'fold' };
const pick = <T>(rng: Rng, items: T[]): T => items[Math.floor(rng() * items.length)];
const chance = (c: Ctx, p: number) => c.rng() < p;

/** Fréquence de bluff « équilibrée » pour une mise de `b` × pot : b / (1 + 2b). */
const balancedBluff = (b: number) => b / (1 + 2 * b);


// ---------------------------------------------------------------- Préflop

function preflop(c: Ctx, huEq: number, eq: number): Choice {
  const { p, rng, legal } = c;
  // huEq : équité contre UNE main au hasard (échelle des tableaux de mains de départ)
  let hu = huEq;
  const [a, b] = c.hole;
  const suited = a.suit === b.suit;
  const gap = Math.abs(a.rank - b.rank);
  // Mains « spéculatives » (assorties, connectées) : plus jouables en fin de parole
  if (suited) hu += 0.025;
  if (gap === 1 && Math.min(a.rank, b.rank) >= 4) hu += 0.02;

  // Tapis court : tapis ou couché
  if (c.effBB <= 12) {
    const facing = c.preflopRaises > 0;
    if (!facing) {
      const need = 0.6 - p.loose * 0.05 - c.position * 0.06;
      if (hu > need) return { action: { type: 'allin' }, kind: hu > 0.65 ? 'value' : 'steal' };
      return foldOrCheck(c);
    }
    if (eq > c.potOdds + 0.02 - p.sticky * 0.04) return { action: legal.canRaise && hu > 0.66 ? { type: 'allin' } : { type: 'call' }, kind: 'call', tough: true };
    return foldOrCheck(c);
  }

  const facingRaise = c.preflopRaises > 0;
  const bbSize = (to: number) => to / c.bb;

  // Voir le flop pas cher : quand payer ne coûte qu'une petite part du tapis, on suit bien plus
  // volontiers (cotes implicites : si on touche, on peut gagner gros). 2 % du tapis → très tentant,
  // 5 % → encore jouable, 10 % ou plus → seulement avec une vraie main.
  const price = c.toCall / Math.max(1, c.me.stack + c.me.bet);
  const cheap = clamp01(1 - price / 0.1);
  const already = c.view.players.filter((x) => x.id !== c.me.id && x.status === 'active' && x.bet > 0).length;
  const flopBonus =
    cheap * (0.06 + p.sticky * 0.025 + Math.min(already, 4) * 0.006) * (1 + p.loose * 0.55) * c.skill.cheapCalls;

  if (!facingRaise) {
    const openNeed = 0.63 - c.position * 0.1 - p.loose * 0.08 + c.limpers * 0.01;
    const premium = hu >= 0.67;
    if (premium || hu > openNeed) {
      const raiseFreq = premium ? 0.9 : 0.25 + p.aggro * 0.7;
      if (chance(c, raiseFreq) || (premium && !chance(c, p.trap * 0.4))) {
        const mult = p.id === 'maniac' ? 3 + rng() * 1.5 : p.id === 'rock' ? 3 : 2.3 + rng() * 0.9;
        return raiseTo(c, c.bb * (mult + c.limpers * 0.7), 'value');
      }
      return passive(c);
    }
    // Vol des blindes depuis les dernières positions
    if (c.position > 0.7 && c.limpers === 0 && chance(c, p.bluff * 0.45 + p.aggro * 0.15)) {
      return raiseTo(c, c.bb * (2.2 + rng() * 0.8), 'steal');
    }
    if (legal.canCheck) return { action: { type: 'check' }, kind: 'check' };
    // Payer juste la blinde pour voir le flop (petite blinde, mains spéculatives, table qui « limpe »)
    const limpNeed = openNeed - 0.035 - flopBonus * 0.85 - (c.toCall <= c.bb / 2 ? 0.035 + p.sticky * 0.03 : 0) - c.limpers * 0.01;
    if (hu > limpNeed) return { action: { type: 'call' }, kind: 'call' };
    return { action: { type: 'fold' }, kind: 'fold' };
  }

  // Face à une relance
  const raiseBB = bbSize(legal.currentBet);
  const raiser = c.preflopRaiser;
  let looseRaiser = false;
  if (c.skill.reads && raiser) {
    const v = vpipRate(c.stats[raiser]);
    looseRaiser = (v !== null && v > 0.4) || playStyle(c.stats[raiser]) === 'aggressive';
  }
  const valueNeed = (c.preflopRaises >= 2 ? 0.76 : 0.69) - p.aggro * 0.03 - (looseRaiser ? 0.04 : 0);
  if (hu >= valueNeed) {
    if (c.preflopRaises >= 3 && hu < 0.8) return { action: { type: 'call' }, kind: 'call', tough: true };
    return raiseTo(c, legal.currentBet * (c.position > 0.6 ? 2.8 + rng() * 0.4 : 3.3 + rng() * 0.4), 'value');
  }
  // 3-bet bluff avec une main qui a du potentiel (As assorti, connecteurs assortis)
  const bluffable = suited && (Math.max(a.rank, b.rank) === 14 || gap <= 1);
  if (c.preflopRaises === 1 && bluffable && c.effBB > 30 && chance(c, p.bluff * 0.14 * (0.5 + c.position))) {
    return raiseTo(c, legal.currentBet * 3.2, 'bluff');
  }
  const callNeed =
    0.6 + Math.min(raiseBB, 20) * 0.004 + (c.preflopRaises - 1) * 0.06 - p.sticky * 0.07 - p.loose * 0.04 - c.position * 0.03 - (looseRaiser ? 0.03 : 0) - flopBonus -
    // déjà des jetons au pot (blinde ou « limp ») : on se couche moins facilement
    (c.me.bet > 0 ? 0.015 + Math.min(c.me.bet / Math.max(1, legal.currentBet), 1) * 0.03 : 0);
  // Garde-fou de cote du pot seulement quand ça coûte cher
  const affordable = price < 0.12 || eq > c.potOdds * 0.8;
  if (hu >= callNeed && affordable) return { action: { type: 'call' }, kind: 'call', tough: hu - callNeed < 0.03 };
  return foldOrCheck(c);
}

// ---------------------------------------------------------------- Après le flop

function postflop(c: Ctx, huEq: number, rawEq: number): Choice {
  const { p, rng, legal, view } = c;
  const draws = detectDraws(c.hole, view.board);
  const strongDraw = draws.flush || draws.openEnded;
  const { scary, scareCard } = scaryBoard(view.board);
  const river = view.street === 'river';
  const headsUp = c.opponents === 1;
  const multiFactor = headsUp ? 1 : c.opponents === 2 ? 0.5 : 0.25;

  // Lecture des adversaires (niveau Difficile)
  const opps = view.players.filter((x) => x.id !== c.me.id && (x.status === 'active' || x.status === 'allin'));
  let foldRate: number | null = null;
  if (c.skill.reads) {
    const rates = opps.map((o) => foldToBetRate(c.stats[o.id])).filter((x): x is number => x !== null);
    if (rates.length) foldRate = Math.min(...rates);
  }

  let eq = rawEq;
  let hu = huEq - 0.04 * Math.max(0, c.opponents - 1); // à plusieurs, il faut une meilleure main
  if (c.toCall > 0) {
    // Une grosse mise, surtout d'un joueur prudent, annonce souvent une vraie main.
    const style = c.aggressorId ? playStyle(c.stats[c.aggressorId]) : 'unknown';
    const betSize = c.toCall / Math.max(1, c.pot);
    const discount = c.skill.reads ? (style === 'passive' ? 0.18 : style === 'aggressive' ? 0.04 : 0.1) : 0.1;
    const factor = 1 - c.skill.rangeAware * Math.min(0.35, discount * (0.5 + betSize));
    eq *= factor;
    hu *= factor;
  }
  const spr = c.me.stack / Math.max(1, c.pot);

  const monster = hu > 0.88;
  const strong = hu > 0.73;
  const medium = hu > 0.56;

  if (legal.canCheck) {
    if (monster) {
      if (!river && chance(c, p.trap * 0.8)) return { action: { type: 'check' }, kind: 'trap' };
      if (spr < 1.2) return { action: { type: 'allin' }, kind: 'value' };
      const size = p.id === 'maniac' || p.id === 'bluffer' ? pick(rng, [0.75, 1, 1.3]) : pick(rng, [0.6, 0.75, 1]);
      return potBet(c, size, 'value');
    }
    if (strong) {
      if (chance(c, 0.5 + p.aggro * 0.45)) return potBet(c, pick(rng, [0.5, 0.66, 0.75]), 'value');
      return { action: { type: 'check' }, kind: 'check' };
    }
    // Face à quelqu'un qui paie tout : on mise plus souvent pour la valeur
    const thinValue = foldRate !== null && foldRate < 0.35 ? 0.4 : 0;
    if (medium && chance(c, p.aggro * 0.45 + thinValue)) return potBet(c, pick(rng, [0.33, 0.5]), 'value');

    // Semi-bluff avec un tirage
    if (!river && strongDraw && chance(c, (0.2 + p.bluff * 0.45 + p.aggro * 0.15) * (headsUp ? 1 : 0.6))) {
      return potBet(c, pick(rng, [0.5, 0.66, 0.75]), 'semibluff');
    }
    if (!river && draws.gutshot && chance(c, p.bluff * 0.25 * multiFactor)) return potBet(c, 0.5, 'semibluff');

    if (!medium) {
      // Les différentes occasions de bluffer, comme un vrai joueur
      let bluffChance = 0;
      const wasRaiser = c.preflopRaiser === c.me.id;
      if (wasRaiser && view.street === 'flop') bluffChance = Math.max(bluffChance, 0.25 + p.aggro * 0.4 + p.bluff * 0.15); // continuation bet
      if (scareCard) bluffChance = Math.max(bluffChance, p.bluff * 0.5); // une carte qui fait peur tombe
      if (c.checkedToMe) bluffChance = Math.max(bluffChance, p.bluff * 0.45 + p.aggro * 0.1); // tout le monde a checké
      if (river && scary) bluffChance = Math.max(bluffChance, p.bluff * 0.35); // l'histoire tient à la river
      bluffChance *= multiFactor;
      bluffChance += c.tilt * 0.2;
      const size = p.id === 'bluffer' || p.id === 'maniac' ? pick(rng, [0.75, 1, 1.25]) : pick(rng, [0.33, 0.5, 0.66]);
      if (p.balanced) bluffChance = Math.min(bluffChance, balancedBluff(size) * 1.4);
      if (foldRate !== null) bluffChance *= foldRate > 0.6 ? 1.5 : foldRate < 0.35 ? 0.3 : 1; // on ne bluffe pas un « curieux »
      if (chance(c, bluffChance)) return potBet(c, size, 'bluff');
    }
    return { action: { type: 'check' }, kind: 'check' };
  }

  // ---- Face à une mise
  const betRatio = c.toCall / Math.max(1, c.pot);
  const tough = betRatio > 0.45 && !strong;

  if (monster) {
    if (spr < 1.5) return { action: { type: 'allin' }, kind: 'value' };
    if (!river && chance(c, p.trap * 0.6)) return { action: { type: 'call' }, kind: 'trap', tough: true };
    if (chance(c, 0.4 + p.aggro * 0.5)) return raiseTo(c, legal.currentBet * (2.5 + rng() * 0.6), 'value');
    return { action: { type: 'call' }, kind: 'call', tough: true };
  }
  if (strong) {
    if (chance(c, p.aggro * (river ? 0.15 : 0.3))) return raiseTo(c, legal.currentBet * (2.4 + rng() * 0.5), 'value');
    return { action: { type: 'call' }, kind: 'call' };
  }

  // Semi-bluff relance avec un gros tirage
  if (!river && strongDraw && headsUp && chance(c, p.bluff * 0.25)) {
    return raiseTo(c, legal.currentBet * 2.6, 'semibluff');
  }

  const implied = !river && (strongDraw || draws.gutshot) && spr > 3 ? 0.06 : 0;
  let margin = -p.sticky * 0.1;
  if (c.skill.reads && c.aggressorId && playStyle(c.stats[c.aggressorId]) === 'aggressive') margin -= 0.04;
  if (eq + implied > c.potOdds + margin + 0.02) {
    const heroCall = river && hu < 0.5 && betRatio > 0.5;
    return { action: { type: 'call' }, kind: heroCall ? 'herocall' : 'call', tough };
  }

  // Relance-bluff (check-raise ou relance sur une mise faible)
  if (!river && headsUp && c.effBB > 25 && chance(c, p.bluff * (p.id === 'maniac' ? 0.12 : 0.06))) {
    return raiseTo(c, legal.currentBet * 2.7, 'bluff');
  }
  // « Float » : payer en position pour voler plus tard
  if (view.street === 'flop' && headsUp && c.position > 0.6 && betRatio < 0.55 && chance(c, p.bluff * 0.15)) {
    return { action: { type: 'call' }, kind: 'bluff' };
  }
  return { action: { type: 'fold' }, kind: 'fold', tough };
}

// ---------------------------------------------------------------- Temps de réflexion humain

/** Délai simple (compatibilité). */
export function botThinkMs(speed: BotSpeed, rng: Rng = Math.random): number {
  return speed === 'fast' ? 250 + rng() * 450 : 800 + rng() * 1600;
}

function humanThinkMs(choice: Choice, c: Ctx, speed: BotSpeed): number {
  const r = c.rng();
  let ms: number;
  const a = choice.action.type;
  if ((a === 'check' && choice.kind === 'check') || (a === 'fold' && !choice.tough)) ms = 450 + r * 750; // décision évidente
  else if (choice.kind === 'bluff' || choice.kind === 'steal') ms = c.rng() < 0.45 ? 900 + r * 900 : 2400 + r * 2200; // vite… ou long
  else if (choice.kind === 'trap') ms = 2600 + r * 1800; // fait mine d'hésiter
  else if (choice.tough || a === 'allin') ms = 2600 + r * 3000;
  else ms = 1000 + r * 1500;
  ms *= c.p.pace * (1 - c.tilt * 0.4);
  return Math.round(speed === 'fast' ? ms * 0.35 : ms);
}

// ---------------------------------------------------------------- Petites phrases

const LINES = {
  allin: ['Tapis.', 'Je pousse tout.', 'All-in. À toi de voir.', 'On va voir si t’as du cœur.'],
  raise: ['Je relance.', 'Ça coûte plus cher maintenant.', 'On monte un peu.', 'Tu suis ?'],
  herocall: ['Je te crois pas.', 'Je paie pour voir.', 'Montre-moi ça.', 'Hmm… ok, je suis.'],
  foldBig: ['Bien joué.', 'Je te laisse celle-là.', 'Trop cher pour moi.', 'Je passe… pour cette fois.'],
  showBluff: ['Rien du tout 😏', 'Fallait payer !', 'J’avais rien, hein.', 'Merci pour le pot.'],
  showStrong: ['T’as bien fait de te coucher.', 'Bien vu.'],
  winBig: ['Merci !', 'Je prends.', 'Ça fait plaisir.', 'Belle main, non ?'],
  loseBig: ['Sérieux ?!', 'Quelle river…', 'Incroyable.', 'À chaque fois…', 'Ok. Je respire.'],
  tilted: ['Je vais me refaire.', 'Plus jamais je me couche.', 'Ce jeu est truqué !'],
  maniac: ['Allez, on s’amuse !', 'Qui veut jouer ?', 'Trop facile.'],
  rock: ['Hm.', 'J’attendais celle-là.'],
};

function maybeLine(rng: Rng, p: Personality, base: number, pool: string[]): string | undefined {
  return rng() < p.talk * base ? pick(rng, pool) : undefined;
}

function talkFor(choice: Choice, c: Ctx): string | undefined {
  const { rng, p } = c;
  const a = choice.action.type;
  if (c.tilt > 0.5 && rng() < 0.25) return pick(rng, LINES.tilted);
  if (a === 'allin') return maybeLine(rng, p, 0.7, p.id === 'maniac' ? [...LINES.allin, ...LINES.maniac] : LINES.allin);
  if ((a === 'raise' || a === 'bet') && c.legal.currentBet > 0) return maybeLine(rng, p, 0.3, LINES.raise);
  if (choice.kind === 'herocall') return maybeLine(rng, p, 0.6, LINES.herocall);
  if (a === 'fold' && choice.tough) return maybeLine(rng, p, 0.35, LINES.foldBig);
  return undefined;
}

// ---------------------------------------------------------------- Point d'entrée

export interface BotOptions {
  rng?: Rng;
  stats?: OpponentStats;
  personality?: PersonalityId;
  mood?: BotMood;
  speed?: BotSpeed;
}

export interface BotDecision {
  action: PlayerAction;
  kind: DecisionKind;
  /** Temps de réflexion « humain » conseillé avant de jouer (ms). */
  thinkMs: number;
  /** Petite phrase à afficher (bulle), parfois. */
  talk?: string;
}

/** Décision complète du bot `botId` (doit être le joueur qui a la parole). L'action est toujours légale. */
export function decideBot(state: GameState, botId: string, difficulty: BotDifficulty, options: BotOptions = {}): BotDecision {
  const rng = options.rng ?? cryptoRng;
  const skill = SKILL[difficulty];
  const personality = PERSONALITIES[options.personality ?? defaultPersonality(difficulty)];
  const tilt = clamp01(options.mood?.tilt ?? 0);
  const c = buildCtx(state, botId, rng, options.stats ?? {}, skill, personality, tilt);
  if (!c) throw new Error(`Ce n'est pas au bot ${botId} de jouer.`);

  let choice: Choice;
  if (rng() < skill.blunder) {
    // Erreur de débutant : suit ou checke sans réfléchir
    choice = passive(c);
  } else {
    // Force « en tête-à-tête » (pour classer la main) + équité réelle contre tous (pour la cote du pot)
    const err = skill.noise * (rng() * 2 - 1);
    const huEq = clamp01(estimateEquity(c.hole, c.view.board, 1, skill.iterations, rng) + err);
    const eq = c.opponents > 1 ? clamp01(estimateEquity(c.hole, c.view.board, c.opponents, Math.ceil(skill.iterations / 2), rng) + err) : huEq;
    choice = c.view.street === 'preflop' ? preflop(c, huEq, eq) : postflop(c, huEq, eq);
  }
  const action = sanitize(c.legal, choice.action);
  const final: Choice = { ...choice, action };
  return {
    action,
    kind: final.kind,
    thinkMs: humanThinkMs(final, c, options.speed ?? 'normal'),
    talk: talkFor(final, c),
  };
}

/** Choisit seulement l'action (API historique). */
export function decideBotAction(state: GameState, botId: string, difficulty: BotDifficulty, options: BotOptions = {}): PlayerAction {
  return decideBot(state, botId, difficulty, options).action;
}

/** Filet de sécurité : transforme toute décision en action légale. */
function sanitize(legal: LegalActions, a: PlayerAction): PlayerAction {
  switch (a.type) {
    case 'fold':
      return legal.canCheck ? { type: 'check' } : a; // ne jamais se coucher gratuitement
    case 'check':
      return legal.canCheck ? a : { type: 'fold' };
    case 'call':
      return legal.canCall ? a : { type: 'check' };
    case 'allin':
      if (legal.canRaise) return a;
      return legal.canCall ? { type: 'call' } : { type: 'check' };
    default: {
      if (!legal.canRaise) return legal.canCheck ? { type: 'check' } : { type: 'call' };
      const amount = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(a.amount)));
      return amount >= legal.maxRaiseTo ? { type: 'allin' } : { type: a.type, amount };
    }
  }
}

// ---------------------------------------------------------------- Fin de main : humeur, phrases, cartes montrées

export interface BotHandEnd {
  mood: BotMood;
  /** Le bot montre ses cartes (souvent pour exhiber un bluff). */
  show: boolean;
  talk?: string;
}

/**
 * Réaction d'un bot à la fin d'une main (état complet, côté « serveur ») :
 * mise à jour du tilt, envie de montrer un bluff, petite phrase.
 */
export function botHandEnd(
  state: GameState,
  botId: string,
  personalityId: PersonalityId,
  mood: BotMood | undefined,
  rng: Rng = Math.random,
): BotHandEnd {
  const p = PERSONALITIES[personalityId];
  const me = state.players.find((x) => x.id === botId);
  let tilt = (mood?.tilt ?? 0) * 0.72; // l'énervement retombe main après main
  const lh = state.lastHand;
  if (!me || !lh) return { mood: { tilt }, show: false };

  const start = state.handStartStacks?.[botId] ?? me.stack;
  const net = me.stack - start;
  const bb = state.bigBlind;
  const bigLoss = net <= -Math.max(start * 0.3, bb * 15);
  const bigWin = net >= Math.max(start * 0.4, bb * 20);
  const shownHand = lh.hands.find((h) => h.playerId === botId);
  const badBeat = bigLoss && !!shownHand && shownHand.hand.category >= 2; // perdu avec double paire ou mieux

  if (bigLoss) tilt += (0.3 + (badBeat ? 0.25 : 0)) * (0.3 + p.tilt);
  if (bigWin) tilt *= 0.5;
  tilt = clamp01(tilt);

  let show = false;
  let talk: string | undefined;
  const wonWithoutShowdown = !lh.showdown && (lh.winnings[botId] ?? 0) > 0;
  if (wonWithoutShowdown && me.holeCards.length === 2) {
    const strength =
      state.board.length >= 3
        ? estimateEquity(me.holeCards, state.board, 1, 200, rng)
        : chenScore(me.holeCards) / 20;
    const wasBluff = state.board.length >= 3 ? strength < 0.42 : strength < 0.3;
    if (wasBluff && rng() < p.showBluff + tilt * 0.2) {
      show = true;
      talk = rng() < 0.4 + p.talk * 0.6 ? pick(rng, LINES.showBluff) : undefined;
    } else if (!wasBluff && strength > 0.85 && rng() < p.showBluff * 0.3) {
      show = true;
      talk = maybeLine(rng, p, 0.8, LINES.showStrong);
    }
  }
  if (!talk) {
    if (bigLoss) talk = maybeLine(rng, p, badBeat ? 0.9 : 0.5, tilt > 0.5 ? [...LINES.loseBig, ...LINES.tilted] : LINES.loseBig);
    else if (bigWin) talk = maybeLine(rng, p, 0.45, p.id === 'rock' ? LINES.rock : LINES.winBig);
  }
  return { mood: { tilt }, show, talk };
}
