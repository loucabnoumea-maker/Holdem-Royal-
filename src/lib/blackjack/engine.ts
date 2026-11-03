// Moteur de Blackjack — pur, sans React, testable.
// Règles « casino européen-américain » classiques :
//   • sabot de 6 jeux, remélangé quand il reste moins de 25 % des cartes ;
//   • le croupier reste sur tous les 17 (S17), tire jusqu'à 16 ;
//   • blackjack payé 3 pour 2 ; assurance payée 2 pour 1 ;
//   • doubler sur n'importe quelles 2 premières cartes (aussi après séparation) ;
//   • séparer jusqu'à 4 mains ; les As séparés ne reçoivent qu'une carte chacun ;
//   • abandon tardif (rendre la main contre la moitié de la mise) sur les 2 premières cartes ;
//   • 21 obtenu après séparation = 21 ordinaire, pas un blackjack.
import type { Card, Rng } from '../poker/cards.ts';
import { createDeck, cryptoRng, shuffle } from '../poker/cards.ts';

export interface BJRules {
  decks: number;
  /** Proportion du sabot à partir de laquelle on remélange (0,25 = il reste 25 %). */
  reshuffleAt: number;
  dealerHitsSoft17: boolean;
  blackjackPays: number;
  maxHands: number;
  allowSurrender: boolean;
  doubleAfterSplit: boolean;
}

export const DEFAULT_RULES: BJRules = {
  decks: 6,
  reshuffleAt: 0.25,
  dealerHitsSoft17: false,
  blackjackPays: 1.5,
  maxHands: 4,
  allowSurrender: true,
  doubleAfterSplit: true,
};

export type HandStatus = 'playing' | 'stood' | 'bust' | 'blackjack' | 'surrendered' | 'doubled';
export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'surrender';

export interface PlayerHand {
  cards: Card[];
  bet: number;
  status: HandStatus;
  /** Main issue d'une séparation. */
  fromSplit: boolean;
  splitAces: boolean;
  outcome?: Outcome;
  /** Jetons rendus au joueur pour cette main (mise comprise). */
  payout?: number;
}

export type BJPhase = 'betting' | 'insurance' | 'playing' | 'dealer' | 'settled';

export interface BJState {
  rules: BJRules;
  shoe: Card[];
  shoeSize: number;
  /** Nombre de cartes sorties depuis le dernier mélange (pour l'affichage). */
  dealt: number;
  balance: number;
  phase: BJPhase;
  hands: PlayerHand[];
  active: number;
  dealer: Card[];
  /** La carte cachée du croupier est retournée. */
  holeRevealed: boolean;
  insurance: number;
  insuranceResult?: 'won' | 'lost';
  roundNumber: number;
  /** Gain net du dernier tour (positif = gagné). */
  lastNet: number;
  reshuffled: boolean;
  log: string[];
}

export class BlackjackError extends Error {}

// ---------------------------------------------------------------- Valeurs

/** Valeur d'une carte au blackjack : figures = 10, As = 11 (ou 1). */
export function cardValue(c: Card): number {
  if (c.rank === 14) return 11;
  return Math.min(10, c.rank);
}

/** Total d'une main et si elle est « souple » (un As compte encore 11). */
export function handTotal(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 14) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export const isBlackjack = (cards: Card[]) => cards.length === 2 && handTotal(cards).total === 21;

/** Texte du total pour l'affichage : « 7 / 17 » pour une main souple. */
export function totalLabel(cards: Card[]): string {
  if (cards.length === 0) return '';
  const { total, soft } = handTotal(cards);
  if (isBlackjack(cards)) return 'Blackjack';
  if (total > 21) return `${total} · Brûlé`;
  return soft && total < 21 ? `${total - 10} / ${total}` : String(total);
}

// ---------------------------------------------------------------- Création

function newShoe(rules: BJRules, rng: Rng): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < rules.decks; d++) cards.push(...createDeck());
  return shuffle(cards, rng);
}

export function createTable(balance: number, rules: BJRules = DEFAULT_RULES, rng: Rng = cryptoRng): BJState {
  const shoe = newShoe(rules, rng);
  return {
    rules,
    shoe,
    shoeSize: shoe.length,
    dealt: 0,
    balance,
    phase: 'betting',
    hands: [],
    active: 0,
    dealer: [],
    holeRevealed: false,
    insurance: 0,
    roundNumber: 0,
    lastNet: 0,
    reshuffled: false,
    log: [],
  };
}

const clone = <T>(x: T): T => structuredClone(x);

function draw(s: BJState): Card {
  const c = s.shoe.pop();
  if (!c) throw new BlackjackError('Sabot vide.');
  s.dealt++;
  return c;
}

export interface DealOptions {
  /** Cartes imposées dans l'ordre de tirage (tests et démos). */
  preset?: Card[];
}

// ---------------------------------------------------------------- Distribution

export function deal(state: BJState, bet: number, rng: Rng = cryptoRng, opts: DealOptions = {}): BJState {
  if (state.phase !== 'betting' && state.phase !== 'settled') throw new BlackjackError('Un tour est déjà en cours.');
  if (!Number.isInteger(bet) || bet <= 0) throw new BlackjackError('Mise invalide.');
  if (bet > state.balance) throw new BlackjackError('Solde insuffisant pour cette mise.');
  const s = clone(state);
  s.reshuffled = false;
  if (s.shoe.length < s.shoeSize * s.rules.reshuffleAt) {
    s.shoe = newShoe(s.rules, rng);
    s.shoeSize = s.shoe.length;
    s.dealt = 0;
    s.reshuffled = true;
  }
  if (opts.preset) s.shoe.push(...opts.preset.slice().reverse());

  s.roundNumber++;
  s.balance -= bet;
  s.hands = [{ cards: [], bet, status: 'playing', fromSplit: false, splitAces: false }];
  s.dealer = [];
  s.active = 0;
  s.holeRevealed = false;
  s.insurance = 0;
  s.insuranceResult = undefined;
  s.lastNet = 0;
  s.log = [`Mise de ${bet}.`];

  // Ordre réel : joueur, croupier (visible), joueur, croupier (cachée)
  s.hands[0].cards.push(draw(s));
  s.dealer.push(draw(s));
  s.hands[0].cards.push(draw(s));
  s.dealer.push(draw(s));

  if (s.dealer[0].rank === 14 && s.balance > 0) {
    s.phase = 'insurance';
    s.log.push("Le croupier montre un As : assurance proposée.");
    return s;
  }
  return afterInitialChecks(s);
}

/** Vérifie les blackjacks d'entrée (après la décision d'assurance). */
function afterInitialChecks(s: BJState): BJState {
  const dealerBJ = isBlackjack(s.dealer);
  const playerBJ = isBlackjack(s.hands[0].cards);
  const upTen = cardValue(s.dealer[0]) >= 10;
  // Le croupier vérifie sa carte cachée s'il montre un As ou un 10 (« peek »).
  if ((upTen && dealerBJ) || playerBJ) {
    if (playerBJ) s.hands[0].status = 'blackjack';
    s.holeRevealed = true;
    return settle(s);
  }
  s.phase = 'playing';
  return s;
}

export function takeInsurance(state: BJState, take: boolean): BJState {
  if (state.phase !== 'insurance') throw new BlackjackError("L'assurance n'est pas proposée.");
  const s = clone(state);
  if (take) {
    const amount = Math.min(Math.floor(s.hands[0].bet / 2), s.balance);
    if (amount <= 0) throw new BlackjackError("Solde insuffisant pour l'assurance.");
    s.balance -= amount;
    s.insurance = amount;
    s.log.push(`Assurance prise : ${amount}.`);
  } else {
    s.log.push('Assurance refusée.');
  }
  return afterInitialChecks(s);
}

// ---------------------------------------------------------------- Actions du joueur

export interface BJLegal {
  hit: boolean;
  stand: boolean;
  double: boolean;
  split: boolean;
  surrender: boolean;
}

export function legalActions(s: BJState): BJLegal | null {
  if (s.phase !== 'playing') return null;
  const h = s.hands[s.active];
  if (!h || h.status !== 'playing') return null;
  const two = h.cards.length === 2;
  const canAfford = s.balance >= h.bet;
  return {
    hit: !h.splitAces,
    stand: true,
    double: two && canAfford && !h.splitAces && (!h.fromSplit || s.rules.doubleAfterSplit),
    split: two && canAfford && cardValue(h.cards[0]) === cardValue(h.cards[1]) && s.hands.length < s.rules.maxHands,
    surrender: two && s.rules.allowSurrender && s.hands.length === 1 && !h.fromSplit,
  };
}

export type BJAction = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

export const ACTION_FR: Record<BJAction, string> = {
  hit: 'Tirer',
  stand: 'Rester',
  double: 'Doubler',
  split: 'Séparer',
  surrender: 'Abandonner',
};

export function act(state: BJState, action: BJAction): BJState {
  const legal = legalActions(state);
  if (!legal) throw new BlackjackError("Aucune action n'est attendue.");
  if (!legal[action]) throw new BlackjackError(`Impossible de ${ACTION_FR[action].toLowerCase()} maintenant.`);
  const s = clone(state);
  const h = s.hands[s.active];
  const label = s.hands.length > 1 ? ` (main ${s.active + 1})` : '';

  switch (action) {
    case 'hit': {
      const c = draw(s);
      h.cards.push(c);
      const { total } = handTotal(h.cards);
      s.log.push(`Tirer${label} → ${total}.`);
      if (total > 21) {
        h.status = 'bust';
        s.log.push(`Brûlé${label} !`);
      } else if (total === 21) h.status = 'stood';
      break;
    }
    case 'stand':
      h.status = 'stood';
      s.log.push(`Rester${label} sur ${handTotal(h.cards).total}.`);
      break;
    case 'double': {
      s.balance -= h.bet;
      h.bet *= 2;
      h.cards.push(draw(s));
      const { total } = handTotal(h.cards);
      h.status = total > 21 ? 'bust' : 'doubled';
      s.log.push(`Doubler${label} → ${total}${total > 21 ? ' : brûlé' : ''}.`);
      break;
    }
    case 'split': {
      s.balance -= h.bet;
      const aces = h.cards[0].rank === 14;
      const second: PlayerHand = { cards: [h.cards.pop()!], bet: h.bet, status: 'playing', fromSplit: true, splitAces: aces };
      h.fromSplit = true;
      h.splitAces = aces;
      h.cards.push(draw(s));
      second.cards.push(draw(s));
      s.hands.splice(s.active + 1, 0, second);
      s.log.push(`Séparer : deux mains de ${h.bet}.`);
      // As séparés : une seule carte chacun, mains terminées
      if (aces) {
        h.status = 'stood';
        second.status = 'stood';
      }
      for (const x of [h, second]) if (x.status === 'playing' && handTotal(x.cards).total === 21) x.status = 'stood';
      break;
    }
    case 'surrender':
      h.status = 'surrendered';
      s.log.push('Abandon : la moitié de la mise est rendue.');
      break;
  }
  return advance(s);
}

function advance(s: BJState): BJState {
  while (s.active < s.hands.length && s.hands[s.active].status !== 'playing') s.active++;
  if (s.active < s.hands.length) return s;
  s.active = s.hands.length - 1;
  return playDealer(s);
}

// ---------------------------------------------------------------- Croupier et paiement

/** Le croupier doit-il tirer ? */
export function dealerShouldHit(cards: Card[], rules: BJRules): boolean {
  const { total, soft } = handTotal(cards);
  if (total < 17) return true;
  return total === 17 && soft && rules.dealerHitsSoft17;
}

function playDealer(s: BJState): BJState {
  s.holeRevealed = true;
  const alive = s.hands.some((h) => h.status === 'stood' || h.status === 'doubled');
  if (alive) {
    while (dealerShouldHit(s.dealer, s.rules)) s.dealer.push(draw(s));
    const { total } = handTotal(s.dealer);
    s.log.push(total > 21 ? `Le croupier brûle avec ${total}.` : `Le croupier fait ${total}.`);
  }
  return settle(s);
}

function settle(s: BJState): BJState {
  s.phase = 'settled';
  s.holeRevealed = true;
  const dealerBJ = isBlackjack(s.dealer);
  const d = handTotal(s.dealer).total;
  let returned = 0;
  let staked = 0;

  if (s.insurance > 0) {
    staked += s.insurance;
    if (dealerBJ) {
      returned += s.insurance * 3;
      s.insuranceResult = 'won';
      s.log.push(`Assurance gagnée : +${s.insurance * 2}.`);
    } else {
      s.insuranceResult = 'lost';
      s.log.push('Assurance perdue.');
    }
  }

  for (const h of s.hands) {
    staked += h.bet;
    const p = handTotal(h.cards).total;
    const naturalBJ = isBlackjack(h.cards) && !h.fromSplit;
    let outcome: Outcome;
    let payout = 0;
    if (h.status === 'surrendered') {
      outcome = 'surrender';
      payout = Math.floor(h.bet / 2);
    } else if (p > 21) {
      outcome = 'bust';
    } else if (naturalBJ && !dealerBJ) {
      outcome = 'blackjack';
      payout = h.bet + Math.floor(h.bet * s.rules.blackjackPays);
    } else if (dealerBJ) {
      outcome = naturalBJ ? 'push' : 'lose';
      payout = naturalBJ ? h.bet : 0;
    } else if (d > 21 || p > d) {
      outcome = 'win';
      payout = h.bet * 2;
    } else if (p === d) {
      outcome = 'push';
      payout = h.bet;
    } else {
      outcome = 'lose';
    }
    h.outcome = outcome;
    h.payout = payout;
    returned += payout;
  }
  s.balance += returned;
  s.lastNet = returned - staked;
  if (dealerBJ) s.log.unshift('Le croupier a Blackjack.');
  s.log.push(s.lastNet > 0 ? `Gain : +${s.lastNet}.` : s.lastNet < 0 ? `Perte : ${s.lastNet}.` : 'Égalité : mise rendue.');
  return s;
}

export const OUTCOME_FR: Record<Outcome, string> = {
  blackjack: 'Blackjack ! Payé 3 pour 2',
  win: 'Gagné',
  push: 'Égalité',
  lose: 'Perdu',
  bust: 'Brûlé',
  surrender: 'Abandon',
};

// ---------------------------------------------------------------- Stratégie de base (6 jeux, S17, doubler après séparation, abandon)

export type Advice = 'H' | 'S' | 'D' | 'Ds' | 'P' | 'Rh' | 'Rs';
// H = tirer, S = rester, D = doubler sinon tirer, Ds = doubler sinon rester,
// P = séparer, Rh = abandonner sinon tirer, Rs = abandonner sinon rester.

/** Colonnes : carte visible du croupier 2,3,4,5,6,7,8,9,10,A */
export const DEALER_COLS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

const row = (s: string) => s.split(' ') as Advice[];

/** Totaux durs 5 à 17+ */
export const HARD_CHART: Record<number, Advice[]> = {
  8: row('H H H H H H H H H H'),
  9: row('H D D D D H H H H H'),
  10: row('D D D D D D D D H H'),
  11: row('D D D D D D D D D H'),
  12: row('H H S S S H H H H H'),
  13: row('S S S S S H H H H H'),
  14: row('S S S S S H H H H H'),
  15: row('S S S S S H H H Rh H'),
  16: row('S S S S S H H Rh Rh Rh'),
  17: row('S S S S S S S S S S'),
};

/** Mains souples (As + x), clé = total souple 13 (A,2) à 20 (A,9) */
export const SOFT_CHART: Record<number, Advice[]> = {
  13: row('H H H D D H H H H H'),
  14: row('H H H D D H H H H H'),
  15: row('H H D D D H H H H H'),
  16: row('H H D D D H H H H H'),
  17: row('H D D D D H H H H H'),
  18: row('Ds Ds Ds Ds Ds S S H H H'),
  19: row('S S S S Ds S S S S S'),
  20: row('S S S S S S S S S S'),
};

/** Paires, clé = valeur d'une carte (11 = As) */
export const PAIR_CHART: Record<number, Advice[]> = {
  11: row('P P P P P P P P P P'),
  10: row('S S S S S S S S S S'),
  9: row('P P P P P S P P S S'),
  8: row('P P P P P P P P P Rh'),
  7: row('P P P P P P H H H H'),
  6: row('P P P P P H H H H H'),
  5: row('D D D D D D D D H H'),
  4: row('H H H P P H H H H H'),
  3: row('P P P P P P H H H H'),
  2: row('P P P P P P H H H H'),
};

export const ADVICE_FR: Record<Advice, string> = {
  H: 'Tirer',
  S: 'Rester',
  D: 'Doubler (sinon tirer)',
  Ds: 'Doubler (sinon rester)',
  P: 'Séparer',
  Rh: 'Abandonner (sinon tirer)',
  Rs: 'Abandonner (sinon rester)',
};

/** Conseil d'après le seul total (dur ou souple), sans tenir compte d'une paire. */
export function strategyByTotal(cards: Card[], dealerUp: Card): Advice {
  const col = DEALER_COLS.indexOf(cardValue(dealerUp) as (typeof DEALER_COLS)[number]);
  const { total, soft } = handTotal(cards);
  if (soft && total >= 13 && total <= 20) return SOFT_CHART[total][col];
  if (total >= 21) return 'S';
  if (total <= 8) return 'H';
  return HARD_CHART[Math.min(total, 17)][col];
}

/** Conseil de la stratégie de base pour une main et une carte du croupier. */
export function basicStrategy(cards: Card[], dealerUp: Card): Advice {
  if (cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1])) {
    const col = DEALER_COLS.indexOf(cardValue(dealerUp) as (typeof DEALER_COLS)[number]);
    return PAIR_CHART[cardValue(cards[0])][col];
  }
  return strategyByTotal(cards, dealerUp);
}

/** Conseil traduit en action réellement possible maintenant. */
export function recommendedAction(s: BJState): { action: BJAction; advice: Advice } | null {
  const legal = legalActions(s);
  if (!legal) return null;
  const h = s.hands[s.active];
  let advice = basicStrategy(h.cards, s.dealer[0]);
  // Paire qu'on ne peut plus séparer (limite de mains, solde) : on la joue sur son total
  if (advice === 'P' && !legal.split) advice = strategyByTotal(h.cards, s.dealer[0]);
  const map = (a: Advice): BJAction => {
    switch (a) {
      case 'H':
        return 'hit';
      case 'S':
        return 'stand';
      case 'D':
        return legal.double ? 'double' : 'hit';
      case 'Ds':
        return legal.double ? 'double' : 'stand';
      case 'P':
        return 'split';
      case 'Rh':
        return legal.surrender ? 'surrender' : 'hit';
      case 'Rs':
        return legal.surrender ? 'surrender' : 'stand';
    }
  };
  return { action: map(advice), advice };
}
