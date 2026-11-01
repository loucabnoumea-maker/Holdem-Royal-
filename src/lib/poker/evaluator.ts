// Évaluateur de mains Texas Hold'em : de 5 à 7 cartes → meilleure main de 5 cartes.
import type { Card, Rank } from './cards.ts';
import { RANK_NAMES_FR } from './cards.ts';

export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;
export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory];

export const CATEGORY_NAMES_FR: Record<HandCategory, string> = {
  0: 'Carte haute',
  1: 'Paire',
  2: 'Double paire',
  3: 'Brelan',
  4: 'Quinte',
  5: 'Couleur',
  6: 'Full',
  7: 'Carré',
  8: 'Quinte flush',
};

export interface HandResult {
  category: HandCategory;
  /** Plus grand = meilleur. Deux mains égales ont exactement le même score. */
  score: number;
  /** Rangs de départage dans l'ordre d'importance (catégorie puis kickers). */
  tiebreak: number[];
  /** Les 5 cartes qui composent la main. */
  cards: Card[];
  /** Description lisible en français, ex. « Full : Rois par les Sept ». */
  description: string;
}

function encodeScore(category: number, tiebreak: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 16 + (tiebreak[i] ?? 0);
  return score;
}

/** Hauteur de la quinte présente dans le masque de rangs, ou 0. L'As compte aussi pour 1. */
function straightHigh(mask: number): number {
  const m = mask & (1 << 14) ? mask | (1 << 1) : mask;
  for (let high = 14; high >= 5; high--) {
    const need = 0b11111 << (high - 4);
    if ((m & need) === need) return high;
  }
  return 0;
}

/** Cartes formant la quinte de hauteur `high` (l'As sert de 1 pour la roue). */
function straightCards(cards: Card[], high: number): Card[] {
  const out: Card[] = [];
  for (let r = high; r > high - 5; r--) {
    const wanted = r === 1 ? 14 : r;
    out.push(cards.find((c) => c.rank === wanted)!);
  }
  return out;
}

function sortDesc(cards: Card[]): Card[] {
  return cards.slice().sort((a, b) => b.rank - a.rank);
}

export function evaluateHand(cards: readonly Card[]): HandResult {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`L'évaluateur attend 5 à 7 cartes (reçu ${cards.length})`);
  }
  const sorted = sortDesc(cards as Card[]);

  // Regroupements par couleur et par rang
  const bySuit = new Map<string, Card[]>();
  const byRank = new Map<number, Card[]>();
  let mask = 0;
  for (const c of sorted) {
    (bySuit.get(c.suit) ?? bySuit.set(c.suit, []).get(c.suit)!).push(c);
    (byRank.get(c.rank) ?? byRank.set(c.rank, []).get(c.rank)!).push(c);
    mask |= 1 << c.rank;
  }

  // 1. Couleur / quinte flush
  let flushCards: Card[] | null = null;
  for (const group of bySuit.values()) if (group.length >= 5) flushCards = group;
  if (flushCards) {
    let fmask = 0;
    for (const c of flushCards) fmask |= 1 << c.rank;
    const sfHigh = straightHigh(fmask);
    if (sfHigh) return make(HandCategory.StraightFlush, [sfHigh], straightCards(flushCards, sfHigh));
  }

  // Groupes de rangs triés par (taille desc, rang desc)
  const groups = [...byRank.entries()]
    .map(([rank, cs]) => ({ rank, cards: cs }))
    .sort((a, b) => b.cards.length - a.cards.length || b.rank - a.rank);

  const kickers = (exclude: number[], n: number): Card[] =>
    sorted.filter((c) => !exclude.includes(c.rank)).slice(0, n);

  // 2. Carré
  if (groups[0].cards.length === 4) {
    const q = groups[0];
    const k = kickers([q.rank], 1);
    return make(HandCategory.Quads, [q.rank, k[0].rank], [...q.cards, ...k]);
  }

  // 3. Full
  const trips = groups.filter((g) => g.cards.length === 3);
  const pairs = groups.filter((g) => g.cards.length === 2);
  if (trips.length >= 1 && (trips.length >= 2 || pairs.length >= 1)) {
    const t = trips[0];
    const candidates = [...trips.slice(1), ...pairs].sort((a, b) => b.rank - a.rank);
    const p = candidates[0];
    return make(HandCategory.FullHouse, [t.rank, p.rank], [...t.cards, ...p.cards.slice(0, 2)]);
  }

  // 4. Couleur
  if (flushCards) {
    const five = flushCards.slice(0, 5);
    return make(HandCategory.Flush, five.map((c) => c.rank), five);
  }

  // 5. Quinte
  const sHigh = straightHigh(mask);
  if (sHigh) return make(HandCategory.Straight, [sHigh], straightCards(sorted, sHigh));

  // 6. Brelan
  if (trips.length === 1) {
    const t = trips[0];
    const k = kickers([t.rank], 2);
    return make(HandCategory.Trips, [t.rank, ...k.map((c) => c.rank)], [...t.cards, ...k]);
  }

  // 7. Double paire
  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    const k = kickers([p1.rank, p2.rank], 1);
    return make(
      HandCategory.TwoPair,
      [p1.rank, p2.rank, k[0].rank],
      [...p1.cards, ...p2.cards, ...k],
    );
  }

  // 8. Paire
  if (pairs.length === 1) {
    const p = pairs[0];
    const k = kickers([p.rank], 3);
    return make(HandCategory.Pair, [p.rank, ...k.map((c) => c.rank)], [...p.cards, ...k]);
  }

  // 9. Carte haute
  const five = sorted.slice(0, 5);
  return make(HandCategory.HighCard, five.map((c) => c.rank), five);
}

function make(category: HandCategory, tiebreak: number[], cards: Card[]): HandResult {
  return {
    category,
    tiebreak,
    score: encodeScore(category, tiebreak),
    cards,
    description: describe(category, tiebreak),
  };
}

/** > 0 si a gagne, < 0 si b gagne, 0 en cas d'égalité. */
export function compareHands(a: HandResult, b: HandResult): number {
  return a.score - b.score;
}

// ---------- Descriptions en français ----------

const PLURAL: Partial<Record<Rank, string>> = { 11: 'Valets', 12: 'Dames', 13: 'Rois' };
const name = (r: number) => RANK_NAMES_FR[r as Rank];
const plural = (r: number) => PLURAL[r as Rank] ?? name(r);
const startsWithVowel = (r: number) => r === 14 || r === 8; // As, Huit
const de = (r: number) => (startsWithVowel(r) ? `d'${plural(r)}` : `de ${plural(r)}`);
const au = (r: number) => (r === 14 ? "à l'As" : `au ${name(r)}`);

function describe(category: HandCategory, t: number[]): string {
  switch (category) {
    case HandCategory.StraightFlush:
      return t[0] === 14 ? 'Quinte flush royale' : `Quinte flush ${au(t[0])}`;
    case HandCategory.Quads:
      return `Carré ${de(t[0])}`;
    case HandCategory.FullHouse:
      return `Full : ${plural(t[0])} par les ${plural(t[1])}`;
    case HandCategory.Flush:
      return `Couleur ${au(t[0])}`;
    case HandCategory.Straight:
      return `Quinte ${au(t[0])}`;
    case HandCategory.Trips:
      return `Brelan ${de(t[0])}`;
    case HandCategory.TwoPair:
      return `Double paire : ${plural(t[0])} et ${plural(t[1])}`;
    case HandCategory.Pair:
      return `Paire ${de(t[0])}`;
    default:
      return `Carte haute : ${name(t[0])}`;
  }
}
