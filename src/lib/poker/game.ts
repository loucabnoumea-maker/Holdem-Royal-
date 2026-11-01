// Machine à états d'une partie de Texas Hold'em No Limit.
// Fonctions pures : chaque appel renvoie un NOUVEL état (sérialisable en JSON),
// ce qui permet de l'exécuter tel quel dans le navigateur (solo) ou dans une
// Supabase Edge Function (multijoueur).
import type { Card, Rng } from './cards.ts';
import { cardToDisplay, cryptoRng, sameCard, shuffledDeck } from './cards.ts';
import type { HandResult } from './evaluator.ts';
import { evaluateHand } from './evaluator.ts';
import type { Pot, PotAward } from './pots.ts';
import { computePots, distributePots } from './pots.ts';

// ---------------------------------------------------------------- Types

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Phase = 'waiting' | 'betting' | 'handOver' | 'gameOver';
export type PlayerStatus = 'active' | 'folded' | 'allin' | 'out';

export interface PlayerState {
  id: string;
  name: string;
  stack: number;
  /** Mise engagée sur le tour d'enchères en cours. */
  bet: number;
  /** Total engagé dans la main (tous tours confondus). */
  totalBet: number;
  holeCards: Card[];
  status: PlayerStatus;
  /** A parlé depuis la dernière relance complète de ce tour. */
  hasActed: boolean;
  /** Numéro de la main où le joueur a été éliminé. */
  eliminatedAtHand?: number;
}

export interface GameConfig {
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  /** Augmente les blindes toutes les X mains (null/0 = jamais). */
  blindIncreaseEveryHands?: number | null;
}

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export type PlayerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** `amount` = montant TOTAL de la mise sur ce tour (« relancer à »). */
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number }
  | { type: 'allin' };

export interface LogEntry {
  street: Street;
  kind: 'blind' | ActionType | 'street' | 'showdown' | 'win' | 'return' | 'eliminated' | 'show';
  playerId?: string;
  amount?: number;
  text: string;
}

export interface ShowdownHand {
  playerId: string;
  holeCards: Card[];
  hand: HandResult;
}

export interface HandSummary {
  /** true si la main est allée à l'abattage. */
  showdown: boolean;
  hands: ShowdownHand[];
  pots: Pot[];
  awards: PotAward[];
  /** Cartes montrées volontairement après une main gagnée sans abattage (ex. un bluff). */
  shown?: { playerId: string; holeCards: Card[] }[];
  winnings: Record<string, number>;
}

export interface GameState {
  config: GameConfig;
  players: PlayerState[];
  phase: Phase;
  handNumber: number;
  buttonIndex: number;
  sbIndex: number;
  bbIndex: number;
  smallBlind: number;
  bigBlind: number;
  street: Street;
  board: Card[];
  deck: Card[];
  /** Index du joueur qui doit parler, ou null. */
  toAct: number | null;
  /** Mise la plus haute du tour en cours. */
  currentBet: number;
  /** Taille de la dernière relance complète (relance minimale). */
  lastRaiseSize: number;
  log: LogEntry[];
  lastHand: HandSummary | null;
  winnerId: string | null;
  /** Tapis de chaque joueur au début de la main (avant les blindes). */
  handStartStacks?: Record<string, number>;
}

export class PokerError extends Error {}

export interface LegalActions {
  playerId: string;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Jetons à ajouter pour suivre (plafonné au tapis). */
  callAmount: number;
  /** true : aucune mise ce tour → on « mise » ; sinon on « relance ». */
  isBet: boolean;
  canRaise: boolean;
  /** Montant total minimal (« relancer à ») ; égal à maxRaiseTo si seul le tapis est possible. */
  minRaiseTo: number;
  /** Montant total maximal = tapis complet. */
  maxRaiseTo: number;
  currentBet: number;
  pot: number;
}

// ---------------------------------------------------------------- Création

const BLIND_MULTIPLIERS = [1, 1.5, 2, 3, 4, 6, 8, 10, 15, 20, 30, 40, 60, 80, 100];

export function createGame(config: GameConfig, players: { id: string; name: string }[]): GameState {
  if (players.length < 2 || players.length > 9) throw new PokerError('Il faut entre 2 et 9 joueurs.');
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new PokerError('Identifiants en double.');
  if (config.smallBlind <= 0 || config.bigBlind < config.smallBlind) throw new PokerError('Blindes invalides.');
  if (config.startingStack <= 0) throw new PokerError('Tapis de départ invalide.');

  return {
    config,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      stack: config.startingStack,
      bet: 0,
      totalBet: 0,
      holeCards: [],
      status: 'active',
      hasActed: false,
    })),
    phase: 'waiting',
    handNumber: 0,
    buttonIndex: -1,
    sbIndex: -1,
    bbIndex: -1,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    street: 'preflop',
    board: [],
    deck: [],
    toAct: null,
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    log: [],
    lastHand: null,
    winnerId: null,
  };
}

// ---------------------------------------------------------------- Helpers

const clone = <T>(x: T): T => structuredClone(x);

function nextIndex(s: GameState, from: number, pred: (p: PlayerState) => boolean): number {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n;
    if (pred(s.players[i])) return i;
  }
  return -1;
}

const inGame = (p: PlayerState) => p.status !== 'out';
const inHand = (p: PlayerState) => p.status === 'active' || p.status === 'allin';
const canAct = (p: PlayerState) => p.status === 'active';

export function potTotal(s: GameState): number {
  return s.players.reduce((sum, p) => sum + p.totalBet, 0);
}

/** Ids des joueurs encore en jeu, dans l'ordre en partant de la gauche du bouton. */
function orderFromButton(s: GameState): string[] {
  const n = s.players.length;
  const out: string[] = [];
  for (let k = 1; k <= n; k++) out.push(s.players[(s.buttonIndex + k) % n].id);
  return out;
}

function log(s: GameState, entry: Omit<LogEntry, 'street'>) {
  s.log.push({ street: s.street, ...entry });
}

/** Met des jetons au pot (plafonné au tapis) et passe le joueur à tapis si besoin. */
function commit(p: PlayerState, amount: number): number {
  const paid = Math.min(amount, p.stack);
  p.stack -= paid;
  p.bet += paid;
  p.totalBet += paid;
  if (p.stack === 0) p.status = 'allin';
  return paid;
}

function blindsForHand(config: GameConfig, handNumber: number) {
  const every = config.blindIncreaseEveryHands;
  if (!every || every <= 0) return { sb: config.smallBlind, bb: config.bigBlind };
  const level = Math.min(Math.floor((handNumber - 1) / every), BLIND_MULTIPLIERS.length - 1);
  const m = BLIND_MULTIPLIERS[level];
  return { sb: Math.round(config.smallBlind * m), bb: Math.round(config.bigBlind * m) };
}

// ---------------------------------------------------------------- Nouvelle main

export interface StartHandOptions {
  /** Cartes imposées dans l'ordre de tirage (tests / rejouage). Complétées par le reste du paquet. */
  deck?: Card[];
  /** Force la position du bouton (index du joueur). */
  button?: number;
}

export function startHand(state: GameState, rng: Rng = cryptoRng, options: StartHandOptions = {}): GameState {
  if (state.phase === 'betting') throw new PokerError('Une main est déjà en cours.');
  if (state.phase === 'gameOver') throw new PokerError('La partie est terminée.');
  const s = clone(state);
  const alive = s.players.filter(inGame);
  if (alive.length < 2) throw new PokerError('Pas assez de joueurs pour une nouvelle main.');

  s.handNumber += 1;
  s.handStartStacks = Object.fromEntries(s.players.map((p) => [p.id, p.stack]));
  s.phase = 'betting';
  s.street = 'preflop';
  s.board = [];
  s.log = [];
  s.lastHand = null;
  if (options.deck) {
    const preset = options.deck;
    const rest = shuffledDeck(rng).filter((c) => !preset.some((x) => sameCard(x, c)));
    s.deck = [...rest, ...preset.slice().reverse()]; // on tire avec pop() : la fin du tableau sort en premier
  } else {
    s.deck = shuffledDeck(rng);
  }
  const { sb, bb } = blindsForHand(s.config, s.handNumber);
  s.smallBlind = sb;
  s.bigBlind = bb;

  for (const p of s.players) {
    p.bet = 0;
    p.totalBet = 0;
    p.holeCards = [];
    p.hasActed = false;
    if (p.status !== 'out') p.status = 'active';
  }

  // Bouton : aléatoire à la 1re main, puis joueur suivant encore en jeu.
  if (options.button !== undefined) {
    if (!s.players[options.button] || !inGame(s.players[options.button])) throw new PokerError('Bouton invalide.');
    s.buttonIndex = options.button;
  } else if (s.buttonIndex < 0) {
    const aliveIdx = s.players.map((p, i) => (inGame(p) ? i : -1)).filter((i) => i >= 0);
    s.buttonIndex = aliveIdx[Math.floor(rng() * aliveIdx.length)];
  } else {
    s.buttonIndex = nextIndex(s, s.buttonIndex, inGame);
  }

  // Tête-à-tête : le bouton est petite blinde.
  const headsUp = alive.length === 2;
  s.sbIndex = headsUp ? s.buttonIndex : nextIndex(s, s.buttonIndex, inGame);
  s.bbIndex = nextIndex(s, s.sbIndex, inGame);

  // Distribution : 2 cartes chacun, une à la fois, en commençant à gauche du bouton.
  for (let round = 0; round < 2; round++) {
    let i = s.buttonIndex;
    for (let k = 0; k < alive.length; k++) {
      i = nextIndex(s, i, inGame);
      s.players[i].holeCards.push(s.deck.pop()!);
    }
  }

  // Blindes
  const sbP = s.players[s.sbIndex];
  const bbP = s.players[s.bbIndex];
  const sbPaid = commit(sbP, sb);
  log(s, { kind: 'blind', playerId: sbP.id, amount: sbPaid, text: `${sbP.name} paie la petite blinde (${sbPaid})` });
  const bbPaid = commit(bbP, bb);
  log(s, { kind: 'blind', playerId: bbP.id, amount: bbPaid, text: `${bbP.name} paie la grosse blinde (${bbPaid})` });

  // Même si la grosse blinde est à tapis pour moins, il faut suivre la blinde complète.
  s.currentBet = Math.max(bb, sbPaid);
  s.lastRaiseSize = bb;

  // Premier à parler préflop : à gauche de la grosse blinde (le bouton/PB en tête-à-tête).
  s.toAct = null;
  const first = headsUp ? s.sbIndex : nextIndex(s, s.bbIndex, inGame);
  progress(s, first);
  return s;
}

// ---------------------------------------------------------------- Actions légales

export function getLegalActions(state: GameState): LegalActions | null {
  if (state.phase !== 'betting' || state.toAct === null) return null;
  const p = state.players[state.toAct];
  const toCall = Math.max(0, state.currentBet - p.bet);
  const callAmount = Math.min(toCall, p.stack);
  const maxRaiseTo = p.bet + p.stack;
  const fullMin = state.currentBet === 0 ? state.bigBlind : state.currentBet + state.lastRaiseSize;
  // Un joueur qui a déjà parlé et ne fait face qu'à une relance incomplète (tapis court) ne peut que suivre.
  const reopened = !p.hasActed;
  const canRaise = reopened && maxRaiseTo > state.currentBet && othersCanRespond(state, state.toAct);

  return {
    playerId: p.id,
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount,
    isBet: state.currentBet === 0,
    canRaise,
    minRaiseTo: Math.min(fullMin, maxRaiseTo),
    maxRaiseTo,
    currentBet: state.currentBet,
    pot: potTotal(state),
  };
}

/** Relancer n'a de sens que si au moins un autre joueur peut encore mettre des jetons. */
function othersCanRespond(s: GameState, idx: number): boolean {
  return s.players.some((p, i) => i !== idx && canAct(p));
}

/** Action par défaut quand le minuteur expire : check si possible, sinon fold. */
export function timeoutAction(state: GameState): PlayerAction {
  const legal = getLegalActions(state);
  return legal?.canCheck ? { type: 'check' } : { type: 'fold' };
}

// ---------------------------------------------------------------- Appliquer une action

export function applyAction(state: GameState, playerId: string, action: PlayerAction): GameState {
  const legal = getLegalActions(state);
  if (!legal) throw new PokerError("Aucune action n'est attendue.");
  if (legal.playerId !== playerId) throw new PokerError("Ce n'est pas votre tour.");

  const s = clone(state);
  const idx = s.toAct!;
  const p = s.players[idx];

  switch (action.type) {
    case 'fold': {
      p.status = 'folded';
      log(s, { kind: 'fold', playerId, text: `${p.name} se couche` });
      break;
    }
    case 'check': {
      if (!legal.canCheck) throw new PokerError('Impossible de checker : il y a une mise à suivre.');
      log(s, { kind: 'check', playerId, text: `${p.name} checke` });
      break;
    }
    case 'call': {
      if (!legal.canCall) throw new PokerError('Rien à suivre : utilisez check.');
      const paid = commit(p, legal.callAmount);
      const allin = p.status === 'allin';
      log(s, {
        kind: 'call',
        playerId,
        amount: paid,
        text: `${p.name} suit ${paid}${allin ? ' (tapis)' : ''}`,
      });
      break;
    }
    case 'bet':
    case 'raise':
    case 'allin': {
      const target = action.type === 'allin' ? legal.maxRaiseTo : Math.floor(action.amount);
      // « Tapis » sans pouvoir relancer = simple suivi à tapis.
      if (action.type === 'allin' && (!legal.canRaise || target <= s.currentBet)) {
        if (legal.canCheck) throw new PokerError('Impossible de relancer ici : utilisez check.');
        const paid = commit(p, legal.callAmount);
        log(s, { kind: 'call', playerId, amount: paid, text: `${p.name} suit ${paid} (tapis)` });
        break;
      }
      if (!legal.canRaise) throw new PokerError('Relance impossible : vous pouvez seulement suivre ou vous coucher.');
      if (!Number.isFinite(target)) throw new PokerError('Montant invalide.');
      if (target > legal.maxRaiseTo) throw new PokerError(`Montant supérieur à votre tapis (max ${legal.maxRaiseTo}).`);
      if (target < legal.minRaiseTo) throw new PokerError(`Relance minimale : ${legal.minRaiseTo}.`);

      const raiseSize = target - s.currentBet;
      const wasBet = s.currentBet === 0;
      commit(p, target - p.bet);
      const isFull = raiseSize >= s.lastRaiseSize;
      if (isFull) {
        s.lastRaiseSize = raiseSize;
        // Relance complète : tout le monde doit reparler.
        for (const o of s.players) if (o !== p && canAct(o)) o.hasActed = false;
      }
      s.currentBet = target;
      const allin = p.status === 'allin';
      const kind: ActionType = allin ? 'allin' : wasBet ? 'bet' : 'raise';
      const verb = wasBet ? `mise ${target}` : `relance à ${target}`;
      log(s, { kind, playerId, amount: target, text: `${p.name} ${verb}${allin ? ' (tapis)' : ''}` });
      break;
    }
    default:
      throw new PokerError('Action inconnue.');
  }

  p.hasActed = true;
  progress(s, nextIndex(s, idx, () => true));
  return s;
}

// ---------------------------------------------------------------- Déroulement

function roundComplete(s: GameState): boolean {
  const actors = s.players.filter(canAct);
  if (actors.length === 0) return true;
  if (actors.length === 1) {
    const a = actors[0];
    // Seul joueur à pouvoir parler : fini s'il a égalé la plus haute mise
    // (personne en face ne peut plus miser).
    const maxOther = Math.max(0, ...s.players.filter((p) => p !== a && inHand(p)).map((p) => p.bet));
    if (a.bet >= s.currentBet || (a.hasActed && a.bet >= maxOther)) return true;
    return false;
  }
  return actors.every((p) => p.hasActed && p.bet === s.currentBet);
}

/**
 * Fait avancer la main : désigne le prochain joueur, ou passe au tour suivant,
 * ou termine la main. `from` est l'index à partir duquel chercher (inclus).
 */
function progress(s: GameState, from: number) {
  // Tout le monde s'est couché sauf un.
  if (s.players.filter(inHand).length === 1) {
    finishHand(s, false);
    return;
  }

  if (!roundComplete(s)) {
    const n = s.players.length;
    for (let k = 0; k < n; k++) {
      const i = (from + k) % n;
      const p = s.players[i];
      if (canAct(p) && (!p.hasActed || p.bet < s.currentBet)) {
        s.toAct = i;
        return;
      }
    }
  }

  // Tour d'enchères terminé → tour suivant
  nextStreet(s);
}

function dealBoard(s: GameState, count: number) {
  s.deck.pop(); // carte brûlée
  for (let i = 0; i < count; i++) s.board.push(s.deck.pop()!);
}

const NEXT: Record<Street, Street | null> = { preflop: 'flop', flop: 'turn', turn: 'river', river: null };
const STREET_FR: Record<Street, string> = { preflop: 'Préflop', flop: 'Flop', turn: 'Turn', river: 'River' };

function nextStreet(s: GameState) {
  for (const p of s.players) {
    p.bet = 0;
    p.hasActed = false;
  }
  s.currentBet = 0;
  s.lastRaiseSize = s.bigBlind;
  s.toAct = null;

  const next = NEXT[s.street];
  if (!next) {
    finishHand(s, true);
    return;
  }
  s.street = next;
  dealBoard(s, next === 'flop' ? 3 : 1);
  log(s, {
    kind: 'street',
    text: `${STREET_FR[next]} : ${s.board.map(cardToDisplay).join(' ')}`,
  });

  // Plus personne (ou un seul joueur) ne peut miser → on déroule jusqu'à la river.
  if (s.players.filter(canAct).length <= 1) {
    nextStreet(s);
    return;
  }
  // Postflop : premier joueur actif à gauche du bouton.
  progress(s, nextIndex(s, s.buttonIndex, () => true));
}

/** Rend la partie non suivie de la plus grosse mise. */
function returnUncalled(s: GameState) {
  const sorted = s.players.slice().sort((a, b) => b.totalBet - a.totalBet);
  const [top, second] = sorted;
  const excess = top.totalBet - (second?.totalBet ?? 0);
  if (excess > 0) {
    top.totalBet -= excess;
    top.bet = Math.max(0, top.bet - excess);
    top.stack += excess;
    if (top.status === 'allin') top.status = 'active';
    log(s, { kind: 'return', playerId: top.id, amount: excess, text: `${excess} rendus à ${top.name} (mise non suivie)` });
  }
}

function finishHand(s: GameState, toShowdown: boolean) {
  s.toAct = null;
  returnUncalled(s);
  const contenders = s.players.filter(inHand);
  const pots = computePots(s.players.map((p) => ({ id: p.id, totalBet: p.totalBet, folded: !inHand(p) })));

  let hands: ShowdownHand[] = [];
  let scores: Record<string, number> = {};
  const showdown = toShowdown && contenders.length > 1;
  if (showdown) {
    hands = contenders.map((p) => ({
      playerId: p.id,
      holeCards: p.holeCards,
      hand: evaluateHand([...p.holeCards, ...s.board]),
    }));
    scores = Object.fromEntries(hands.map((h) => [h.playerId, h.hand.score]));
    for (const h of hands) {
      const p = s.players.find((x) => x.id === h.playerId)!;
      log(s, {
        kind: 'showdown',
        playerId: p.id,
        text: `${p.name} montre ${h.holeCards.map(cardToDisplay).join(' ')} — ${h.hand.description}`,
      });
    }
  } else {
    scores = Object.fromEntries(contenders.map((p) => [p.id, 0]));
  }

  const { awards, winnings } = distributePots(pots, scores, orderFromButton(s));
  for (const [id, amount] of Object.entries(winnings)) {
    const p = s.players.find((x) => x.id === id)!;
    p.stack += amount;
    const desc = showdown ? ` avec ${hands.find((h) => h.playerId === id)!.hand.description}` : '';
    log(s, { kind: 'win', playerId: id, amount, text: `${p.name} remporte ${amount}${desc}` });
  }

  s.lastHand = { showdown, hands, pots, awards, winnings };

  // Éliminations
  for (const p of s.players) {
    p.bet = 0;
    p.totalBet = 0; // les jetons ont été redistribués (détail conservé dans lastHand.pots)
    if (p.status !== 'out' && p.stack === 0) {
      p.status = 'out';
      p.eliminatedAtHand = s.handNumber;
      log(s, { kind: 'eliminated', playerId: p.id, text: `${p.name} est éliminé` });
    } else if (p.status === 'allin') {
      p.status = 'active'; // a récupéré des jetons ; « couché » reste visible jusqu'à la main suivante
    }
  }
  s.currentBet = 0;

  const alive = s.players.filter(inGame);
  if (alive.length <= 1) {
    s.phase = 'gameOver';
    s.winnerId = alive[0]?.id ?? null;
  } else {
    s.phase = 'handOver';
  }
}

// ---------------------------------------------------------------- Vue publique (anti-triche)

/**
 * État vu par un joueur : sans le paquet, sans les cartes privées des autres
 * (sauf celles montrées à l'abattage). C'est ce que le serveur enverra au client.
 */
export function getPublicView(state: GameState, viewerId: string | null): GameState {
  const s = clone(state);
  s.deck = [];
  const shown = new Set([
    ...(s.lastHand?.hands.map((h) => h.playerId) ?? []),
    ...(s.lastHand?.shown?.map((h) => h.playerId) ?? []),
  ]);
  for (const p of s.players) {
    if (p.id !== viewerId && !shown.has(p.id)) p.holeCards = [];
  }
  return s;
}

/** Total des jetons en jeu (tapis + mises) — utile pour vérifier qu'aucun jeton ne se crée/perd. */
/**
 * Montrer ses cartes une fois la main finie (autorisé seulement si elles n'ont pas déjà été
 * dévoilées à l'abattage). Sert surtout à exhiber un bluff.
 */
export function showCards(state: GameState, playerId: string): GameState {
  if (state.phase !== 'handOver' && state.phase !== 'gameOver') throw new PokerError('On ne peut montrer ses cartes qu’à la fin de la main.');
  const lh = state.lastHand;
  const p = state.players.find((x) => x.id === playerId);
  if (!lh || !p || p.holeCards.length === 0) throw new PokerError('Aucune carte à montrer.');
  if (lh.hands.some((h) => h.playerId === playerId) || lh.shown?.some((h) => h.playerId === playerId)) return state;
  const s = clone(state);
  s.lastHand!.shown = [...(s.lastHand!.shown ?? []), { playerId, holeCards: p.holeCards }];
  s.log.push({ street: s.street, kind: 'show', playerId, text: `${p.name} montre ${p.holeCards.map(cardToDisplay).join(' ')}` });
  return s;
}

export function totalChips(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.stack + p.totalBet, 0);
}
