// Scénarios des démonstrations animées, construits avec les VRAIS moteurs de jeu :
// chaque étape est un état de partie réel, pas une image figée.
import type { Card } from '../lib/poker/cards.ts';
import { parseCards, seededRng } from '../lib/poker/cards.ts';
import type { GameState, PlayerAction } from '../lib/poker/game.ts';
import { applyAction, createGame, getLegalActions, startHand } from '../lib/poker/game.ts';
import type { BJAction, BJState } from '../lib/blackjack/engine.ts';
import { act, createTable, deal, handTotal } from '../lib/blackjack/engine.ts';

// ---------------------------------------------------------------- Poker

export interface PokerStep {
  state: GameState;
  title: string;
  text: string;
}

export const POKER_DEMO_PLAYERS = [
  { id: 'toi', name: 'Toi' },
  { id: 'lea', name: 'Léa' },
  { id: 'max', name: 'Max' },
  { id: 'nora', name: 'Nora' },
];

/**
 * Une main complète à 4 joueurs. Nora a le bouton : Toi = petite blinde, Léa = grosse blinde,
 * Max parle en premier avant le flop.
 */
export function buildPokerDemo(): PokerStep[] {
  // Ordre de distribution : une carte à chacun en partant de la gauche du bouton (Toi, Léa, Max, Nora), deux tours.
  const holes = { toi: 'As Ks', lea: '9d 9c', max: '7c 2d', nora: 'Qh Jh' };
  const order = ['toi', 'lea', 'max', 'nora'] as const;
  const first = order.map((id) => holes[id].split(' ')[0]).join(' ');
  const second = order.map((id) => holes[id].split(' ')[1]).join(' ');
  // puis : brûlée, flop K♦ 9♥ 4♠, brûlée, turn J♣, brûlée, river 2♠
  const preset = parseCards(`${first} ${second} 3d Kd 9h 4s 5c Jc 6h 2s`);

  let s = createGame({ startingStack: 1000, smallBlind: 5, bigBlind: 10 }, POKER_DEMO_PLAYERS);
  s = startHand(s, seededRng(1), { button: 3, deck: preset });
  const steps: PokerStep[] = [];
  const push = (title: string, text: string) => steps.push({ state: s, title, text });
  const play = (id: string, a: PlayerAction, title: string, text: string) => {
    const l = getLegalActions(s);
    if (!l || l.playerId !== id) throw new Error(`Démo poker : ce n'est pas à ${id} de jouer`);
    s = applyAction(s, id, a);
    push(title, text);
  };

  push(
    'Les blindes et la distribution',
    "Nora a le bouton (D). Les deux joueurs à sa gauche paient les blindes obligatoires : toi la petite (5), Léa la grosse (10). Puis chacun reçoit 2 cartes face cachée, une à la fois. Ici, tu vois toutes les cartes pour suivre la démonstration, mais en vrai chacun ne voit que les siennes.",
  );
  play('max', { type: 'fold' }, 'Préflop : Max se couche', "Avant le flop, on parle en commençant à gauche de la grosse blinde. Max a 7-2 dépareillé, la pire main de départ : il se couche et ne perd rien.");
  play('nora', { type: 'call' }, 'Nora suit 10', 'Nora a Dame-Valet de cœur, une main correcte. Elle paie 10 pour égaler la grosse blinde et voir le flop.');
  play('toi', { type: 'raise', amount: 40 }, 'Tu relances à 40', "Avec As-Roi, une très bonne main, tu relances. Ta mise totale devient 40 (tu avais déjà mis 5 de petite blinde). Une relance doit au moins doubler la mise précédente.");
  play('lea', { type: 'call' }, 'Léa suit', 'Léa a une paire de 9 servie. Elle paie 30 de plus pour arriver à 40.');
  play('nora', { type: 'call' }, 'Nora suit aussi', 'Nora complète à 40. Tout le monde a misé pareil : le tour d’enchères est fini. Le pot fait 120.');
  // Le flop arrive automatiquement dans l'état suivant : on l'annonce sur la première action du flop.
  steps[steps.length - 1] = {
    ...steps[steps.length - 1],
    text: steps[steps.length - 1].text + ' Le croupier brûle une carte et retourne le flop : 3 cartes communes, K♦ 9♥ 4♠.',
  };
  play(
    'toi',
    { type: 'bet', amount: 60 },
    'Flop : tu mises 60',
    "Après le flop, on parle en commençant à gauche du bouton (donc toi). Avec le Roi du tableau, tu as une paire de Rois avec le meilleur kicker (As). Tu mises 60.",
  );
  play('lea', { type: 'raise', amount: 180 }, 'Léa relance à 180 !', "Léa a touché un brelan de 9 (deux 9 en main + le 9 du tableau). Elle relance fort pour gonfler le pot.");
  play('nora', { type: 'fold' }, 'Nora se couche', "Nora n'a qu'un tirage à la quinte (il lui faut un 10). C'est trop cher : elle se couche et abandonne les 40 déjà misés.");
  play('toi', { type: 'call' }, 'Tu suis', "Tu paies 120 de plus. Le pot monte à 480. Turn : le croupier brûle une carte et ajoute le Valet de trèfle.");
  play('toi', { type: 'check' }, 'Turn : tu checkes', "Check = parler sans miser, possible seulement si personne n'a misé avant toi dans ce tour. Tu te méfies de la relance de Léa.");
  play('lea', { type: 'bet', amount: 250 }, 'Léa mise 250', 'Léa continue avec son brelan.');
  play('toi', { type: 'call' }, 'Tu suis 250', 'Tu paies pour voir la dernière carte. River : le 2♠, qui ne change rien.');
  play('toi', { type: 'check' }, 'River : tu checkes', 'Dernier tour d’enchères.');
  play('lea', { type: 'bet', amount: 300 }, 'Léa mise 300', 'Léa mise encore pour être payée par une main moins forte.');
  play(
    'toi',
    { type: 'call' },
    'Abattage',
    "Tu paies : on montre les cartes. Chacun garde la meilleure combinaison de 5 cartes parmi ses 2 cartes + les 5 du tableau. Léa a un brelan de Neuf (9-9-9 + K-J), toi une paire de Rois (K-K + A-J-9). Le brelan bat la paire : Léa remporte tout le pot.",
  );
  return steps;
}

// ---------------------------------------------------------------- Blackjack

export interface BJVisual {
  dealer: Card[];
  /** Nombre de cartes du croupier visibles (les autres sont face cachée). */
  dealerShown: number;
  hands: { cards: Card[]; bet: number; active?: boolean; result?: string }[];
  title: string;
  text: string;
}

const t = (cards: Card[]) => handTotal(cards).total;

/**
 * Tour complet : mise 50, paire de 8 contre un 6 du croupier.
 * Séparer → main 1 : 8+3 = 11 → doubler → 21 ; main 2 : 8+10 = 18 → rester.
 * Le croupier retourne un Roi (16), doit tirer, prend un 9 → 25, brûlé.
 */
export function buildBlackjackDemo(): BJVisual[] {
  const preset = parseCards('8s 6d 8h Kc 3c Th Qd 9h');
  let s: BJState = createTable(1000, undefined, seededRng(3));
  s = deal(s, 50, seededRng(3), { preset });
  const v: BJVisual[] = [];
  const P = s.hands[0].cards;
  const D = s.dealer;
  v.push({ dealer: [], dealerShown: 0, hands: [{ cards: [], bet: 50 }], title: 'La mise', text: 'Avant toute carte, tu poses ta mise dans ta case : ici 50 jetons.' });
  v.push({ dealer: [], dealerShown: 0, hands: [{ cards: [P[0]], bet: 50 }], title: 'Distribution', text: 'Le croupier distribue une carte face visible à chaque joueur…' });
  v.push({ dealer: [D[0]], dealerShown: 1, hands: [{ cards: [P[0]], bet: 50 }], title: 'Distribution', text: '…une carte visible pour lui-même…' });
  v.push({ dealer: [D[0]], dealerShown: 1, hands: [{ cards: [P[0], P[1]], bet: 50 }], title: 'Distribution', text: '…ta deuxième carte : tu as une paire de 8 (total 16)…' });
  v.push({
    dealer: [D[0], D[1]],
    dealerShown: 1,
    hands: [{ cards: [P[0], P[1]], bet: 50, active: true }],
    title: 'La carte cachée',
    text: "…et sa deuxième carte, face cachée. Tu vois seulement son 6. Un 6 est une mauvaise carte pour le croupier : il a de bonnes chances de brûler.",
  });
  const run = (a: BJAction) => {
    s = act(s, a);
  };
  run('split');
  v.push({
    dealer: [D[0], D[1]],
    dealerShown: 1,
    hands: s.hands.map((h, i) => ({ cards: h.cards, bet: h.bet, active: i === 0 })),
    title: 'Séparer',
    text: `Deux cartes de même valeur : tu peux les séparer en deux mains, en ajoutant une deuxième mise de 50. Chaque 8 reçoit une nouvelle carte : main 1 = ${t(s.hands[0].cards)}, main 2 = ${t(s.hands[1].cards)}.`,
  });
  run('double');
  v.push({
    dealer: [D[0], D[1]],
    dealerShown: 1,
    hands: s.hands.map((h, i) => ({ cards: h.cards, bet: h.bet, active: i === 1 })),
    title: 'Doubler',
    text: `Avec 11, tu doubles : ta mise passe à 100 et tu reçois une seule carte. Une Dame : 21 ! La main 1 est terminée.`,
  });
  run('stand');
  v.push({
    dealer: [D[0], D[1]],
    dealerShown: 2,
    hands: s.hands.map((h) => ({ cards: h.cards, bet: h.bet })),
    title: 'Rester, puis le croupier retourne sa carte',
    text: `Sur la main 2 (18), tu restes. Le croupier retourne sa carte cachée : un Roi. Il a ${t(D)}.`,
  });
  v.push({
    dealer: s.dealer,
    dealerShown: s.dealer.length,
    hands: s.hands.map((h) => ({ cards: h.cards, bet: h.bet })),
    title: 'Le croupier tire',
    text: `Le croupier n'a pas le choix : en dessous de 17 il doit tirer. Il prend un 9 → ${t(s.dealer)} : il brûle !`,
  });
  v.push({
    dealer: s.dealer,
    dealerShown: s.dealer.length,
    hands: s.hands.map((h) => ({ cards: h.cards, bet: h.bet, result: `Gagné · +${h.payout! - h.bet}` })),
    title: 'Paiement',
    text: `Tes deux mains restent en jeu et gagnent 1 pour 1 : +100 sur la main doublée, +50 sur l'autre. Gain total : +${s.lastNet} jetons.`,
  });
  return v;
}
