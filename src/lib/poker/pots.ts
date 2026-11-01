// Calcul du pot principal, des pots secondaires (side pots) et de leur distribution.

export interface PotContribution {
  id: string;
  /** Total des jetons engagés par ce joueur dans la main. */
  totalBet: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Joueurs (non couchés) pouvant remporter ce pot. */
  eligible: string[];
}

/**
 * Découpe les mises en pot principal + pots secondaires.
 * Les jetons des joueurs couchés restent dans les pots mais ils ne sont éligibles à aucun.
 */
export function computePots(contributions: readonly PotContribution[]): Pot[] {
  const levels = [
    ...new Set(contributions.filter((c) => !c.folded && c.totalBet > 0).map((c) => c.totalBet)),
  ].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contributions) amount += Math.max(0, Math.min(c.totalBet, level) - prev);
    const eligible = contributions.filter((c) => !c.folded && c.totalBet >= level).map((c) => c.id);
    const last = pots[pots.length - 1];
    if (last && sameSet(last.eligible, eligible)) last.amount += amount;
    else if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }

  // Jetons de joueurs couchés au-delà du plus haut niveau (cas limite) → dernier pot.
  const leftover = contributions.reduce((s, c) => s + Math.max(0, c.totalBet - prev), 0);
  if (leftover > 0) {
    if (pots.length) pots[pots.length - 1].amount += leftover;
    else pots.push({ amount: leftover, eligible: contributions.filter((c) => !c.folded).map((c) => c.id) });
  }
  return pots;
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export interface PotAward {
  potIndex: number;
  amount: number;
  winners: string[];
  /** Gain de chaque gagnant pour ce pot. */
  shares: Record<string, number>;
}

/**
 * Distribue chaque pot au(x) meilleur(s) score(s) parmi les éligibles.
 * En cas d'égalité, le pot est partagé ; les jetons indivisibles vont d'abord
 * aux gagnants les plus proches à gauche du bouton (`orderFromButton`).
 */
export function distributePots(
  pots: readonly Pot[],
  scores: Readonly<Record<string, number>>,
  orderFromButton: readonly string[],
): { awards: PotAward[]; winnings: Record<string, number> } {
  const winnings: Record<string, number> = {};
  const awards: PotAward[] = [];

  pots.forEach((pot, potIndex) => {
    const contenders = pot.eligible.filter((id) => scores[id] !== undefined);
    if (contenders.length === 0) return;
    const best = Math.max(...contenders.map((id) => scores[id]));
    const winners = contenders
      .filter((id) => scores[id] === best)
      .sort((a, b) => orderFromButton.indexOf(a) - orderFromButton.indexOf(b));

    const base = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - base * winners.length;
    const shares: Record<string, number> = {};
    for (const id of winners) {
      const share = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      shares[id] = share;
      winnings[id] = (winnings[id] ?? 0) + share;
    }
    awards.push({ potIndex, amount: pot.amount, winners, shares });
  });

  return { awards, winnings };
}
