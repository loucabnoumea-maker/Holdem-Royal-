// Cartes, paquet et mélange — aucune dépendance à l'interface.

export const SUITS = ['s', 'h', 'd', 'c'] as const; // pique, cœur, carreau, trèfle
export type Suit = (typeof SUITS)[number];

/** Rang de 2 à 14 (11 = Valet, 12 = Dame, 13 = Roi, 14 = As). */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export interface Card {
  rank: Rank;
  suit: Suit;
}

/** Générateur aléatoire injectable : renvoie un nombre dans [0, 1). */
export type Rng = () => number;

const RANK_CHARS: Record<Rank, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
const CHAR_TO_RANK: Record<string, Rank> = Object.fromEntries(
  Object.entries(RANK_CHARS).map(([r, c]) => [c, Number(r) as Rank]),
);

export const RANK_NAMES_FR: Record<Rank, string> = {
  2: 'Deux', 3: 'Trois', 4: 'Quatre', 5: 'Cinq', 6: 'Six', 7: 'Sept', 8: 'Huit',
  9: 'Neuf', 10: 'Dix', 11: 'Valet', 12: 'Dame', 13: 'Roi', 14: 'As',
};
export const SUIT_SYMBOLS: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

/** "As" → As de pique, "Th" → Dix de cœur. */
export function parseCard(code: string): Card {
  if (code.length !== 2) throw new Error(`Carte invalide : ${code}`);
  const rank = CHAR_TO_RANK[code[0].toUpperCase()];
  const suit = code[1].toLowerCase() as Suit;
  if (!rank || !SUITS.includes(suit)) throw new Error(`Carte invalide : ${code}`);
  return { rank, suit };
}

/** "As Kd 7c" → tableau de cartes. */
export function parseCards(codes: string): Card[] {
  return codes.trim().split(/\s+/).filter(Boolean).map(parseCard);
}

export function cardToString(card: Card): string {
  return RANK_CHARS[card.rank] + card.suit;
}

export function cardToDisplay(card: Card): string {
  return RANK_CHARS[card.rank].replace('T', '10') + SUIT_SYMBOLS[card.suit];
}

export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

/** RNG cryptographique (navigateur, Node et Edge Functions Deno). */
export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 0x1_0000_0000;
};

/** RNG déterministe (mulberry32) — pour les tests et les rejouages. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mélange de Fisher-Yates, renvoie un nouveau tableau. */
export function shuffle<T>(items: readonly T[], rng: Rng = cryptoRng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function shuffledDeck(rng: Rng = cryptoRng): Card[] {
  return shuffle(createDeck(), rng);
}
