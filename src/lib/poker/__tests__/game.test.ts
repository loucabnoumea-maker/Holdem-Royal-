import { describe, expect, it } from 'vitest';
import type { Card } from '../cards.ts';
import { cardToString, createDeck, parseCards, seededRng } from '../cards.ts';
import type { GameConfig, GameState, PlayerAction } from '../game.ts';
import {
  applyAction,
  createGame,
  getLegalActions,
  getPublicView,
  PokerError,
  startHand,
  timeoutAction,
  totalChips,
} from '../game.ts';

const CONFIG: GameConfig = { startingStack: 1000, smallBlind: 5, bigBlind: 10 };

function newGame(n: number, stacks?: number[], config: GameConfig = CONFIG): GameState {
  const g = createGame(config, Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `J${i}` })));
  if (stacks) stacks.forEach((s, i) => (g.players[i].stack = s));
  return g;
}

/**
 * Construit l'ordre de tirage : `holes` = cartes privées dans l'ordre de distribution
 * (en partant de la gauche du bouton), `board` = 5 cartes du tableau. Les brûlées sont complétées.
 */
function stackDeck(holes: string[], board: string): Card[] {
  const h = holes.map(parseCards);
  const b = parseCards(board);
  const used = new Set([...h.flat(), ...b].map(cardToString));
  const fillers = createDeck().filter((c) => !used.has(cardToString(c)));
  const burn = () => fillers.shift()!;
  return [
    ...h.map((x) => x[0]),
    ...h.map((x) => x[1]),
    burn(), b[0], b[1], b[2],
    burn(), b[3],
    burn(), b[4],
  ];
}

const act = (s: GameState, id: string, a: PlayerAction) => applyAction(s, id, a);
const toActId = (s: GameState) => s.players[s.toAct!].id;
/** Tout le monde checke ou suit jusqu'à la fin de la main. */
function checkDown(s: GameState): GameState {
  while (s.phase === 'betting') {
    const l = getLegalActions(s)!;
    s = act(s, l.playerId, l.canCheck ? { type: 'check' } : { type: 'call' });
  }
  return s;
}

describe('blindes et ordre de parole', () => {
  it('3 joueurs : PB à gauche du bouton, GB ensuite, le bouton parle en premier préflop', () => {
    const s = startHand(newGame(3), seededRng(1), { button: 0 });
    expect(s.sbIndex).toBe(1);
    expect(s.bbIndex).toBe(2);
    expect(s.players[1].bet).toBe(5);
    expect(s.players[2].bet).toBe(10);
    expect(s.players[1].stack).toBe(995);
    expect(s.toAct).toBe(0);
    expect(s.players.every((p) => p.holeCards.length === 2)).toBe(true);
  });

  it('6 joueurs : UTG (à gauche de la GB) parle en premier, la PB parle en premier au flop', () => {
    let s = startHand(newGame(6), seededRng(1), { button: 2 });
    expect([s.sbIndex, s.bbIndex, s.toAct]).toEqual([3, 4, 5]);
    // tout le monde suit, la GB checke
    for (const id of ['p5', 'p0', 'p1', 'p2', 'p3']) s = act(s, id, { type: 'call' });
    expect(toActId(s)).toBe('p4');
    s = act(s, 'p4', { type: 'check' });
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
    expect(toActId(s)).toBe('p3');
  });

  it('tête-à-tête : le bouton est PB et parle en premier préflop, en dernier après', () => {
    let s = startHand(newGame(2), seededRng(1), { button: 0 });
    expect(s.sbIndex).toBe(0);
    expect(s.bbIndex).toBe(1);
    expect(s.toAct).toBe(0);
    s = act(s, 'p0', { type: 'call' });
    expect(toActId(s)).toBe('p1'); // option de la GB
    s = act(s, 'p1', { type: 'check' });
    expect(s.street).toBe('flop');
    expect(toActId(s)).toBe('p1'); // la GB parle en premier postflop
  });

  it('la grosse blinde garde son option de relancer quand tout le monde suit', () => {
    let s = startHand(newGame(3), seededRng(1), { button: 0 });
    s = act(s, 'p0', { type: 'call' });
    s = act(s, 'p1', { type: 'call' });
    const l = getLegalActions(s)!;
    expect(l.playerId).toBe('p2');
    expect(l.canCheck).toBe(true);
    expect(l.canRaise).toBe(true);
    expect(l.minRaiseTo).toBe(20);
  });

  it('le bouton tourne et saute les joueurs éliminés', () => {
    let s = newGame(3);
    s.players[1].status = 'out';
    s.players[1].stack = 0;
    s = startHand(s, seededRng(1), { button: 0 });
    s = act(s, toActId(s), { type: 'fold' });
    expect(s.phase).toBe('handOver');
    s = startHand(s, seededRng(2));
    expect(s.buttonIndex).toBe(2);
  });

  it('les blindes augmentent toutes les X mains', () => {
    let s = newGame(2, undefined, { ...CONFIG, blindIncreaseEveryHands: 2 });
    const seen: number[] = [];
    for (let h = 0; h < 5; h++) {
      s = startHand(s, seededRng(h));
      seen.push(s.bigBlind);
      s = act(s, toActId(s), { type: 'fold' });
    }
    expect(seen).toEqual([10, 10, 15, 15, 20]);
  });
});

describe('mises et relances', () => {
  it('relance minimale = mise actuelle + dernière relance', () => {
    let s = startHand(newGame(3), seededRng(1), { button: 0 });
    expect(() => act(s, 'p0', { type: 'raise', amount: 15 })).toThrow(/Relance minimale : 20/);
    s = act(s, 'p0', { type: 'raise', amount: 50 }); // relance de 40
    expect(getLegalActions(s)!.minRaiseTo).toBe(90);
    expect(() => act(s, 'p1', { type: 'raise', amount: 80 })).toThrow(PokerError);
    s = act(s, 'p1', { type: 'raise', amount: 90 });
    expect(s.currentBet).toBe(90);
    expect(getLegalActions(s)!.callAmount).toBe(80);
  });

  it('refuse les actions hors tour, check illégal et montant > tapis', () => {
    const s = startHand(newGame(3), seededRng(1), { button: 0 });
    expect(() => act(s, 'p1', { type: 'call' })).toThrow("Ce n'est pas votre tour.");
    expect(() => act(s, 'p0', { type: 'check' })).toThrow(/checker/);
    expect(() => act(s, 'p0', { type: 'raise', amount: 5000 })).toThrow(/tapis/);
  });

  it('au flop, la première mise minimale vaut la grosse blinde', () => {
    let s = startHand(newGame(2), seededRng(1), { button: 0 });
    s = act(s, 'p0', { type: 'call' });
    s = act(s, 'p1', { type: 'check' });
    const l = getLegalActions(s)!;
    expect(l.isBet).toBe(true);
    expect(l.minRaiseTo).toBe(10);
    s = act(s, 'p1', { type: 'bet', amount: 30 });
    expect(getLegalActions(s)!.minRaiseTo).toBe(60);
  });

  it('un tapis inférieur à la relance minimale est autorisé mais ne rouvre pas les enchères', () => {
    // bouton p0, PB p1, GB p2 (130 jetons)
    let s = startHand(newGame(3, [1000, 1000, 130]), seededRng(1), { button: 0 });
    s = act(s, 'p0', { type: 'raise', amount: 100 }); // relance de 90
    s = act(s, 'p1', { type: 'call' });
    s = act(s, 'p2', { type: 'allin' }); // 130 : relance incomplète de 30
    expect(s.currentBet).toBe(130);
    const l = getLegalActions(s)!;
    expect(l.playerId).toBe('p0');
    expect(l.callAmount).toBe(30);
    expect(l.canRaise).toBe(false);
    expect(() => act(s, 'p0', { type: 'raise', amount: 400 })).toThrow(/seulement suivre/);
    s = act(s, 'p0', { type: 'call' });
    expect(getLegalActions(s)!.canRaise).toBe(false);
    s = act(s, 'p1', { type: 'call' });
    expect(s.street).toBe('flop');
  });

  it('un petit tapis qui relance au moins de la taille minimale compte comme relance complète', () => {
    // 4 joueurs, bouton p0, PB p1, GB p2, UTG p3 (tapis 25)
    let s = startHand(newGame(4, [1000, 1000, 1000, 25]), seededRng(1), { button: 0 });
    s = act(s, 'p3', { type: 'allin' }); // relance de 15 ≥ 10 → complète, relance mini suivante = 40
    expect(getLegalActions(s)!.minRaiseTo).toBe(40);
    s = act(s, 'p0', { type: 'call' });
    expect(getLegalActions(s)!.canRaise).toBe(true);
  });

  it('la GB à tapis pour moins que la blinde : il faut tout de même suivre la blinde complète', () => {
    const s = startHand(newGame(3, [1000, 1000, 4]), seededRng(1), { button: 0 });
    expect(s.players[2].status).toBe('allin');
    expect(s.currentBet).toBe(10);
    expect(getLegalActions(s)!.callAmount).toBe(10);
  });
});

describe('fin de main', () => {
  it('tout le monde se couche : la GB remporte les blindes', () => {
    let s = startHand(newGame(3), seededRng(1), { button: 0 });
    s = act(s, 'p0', { type: 'fold' });
    s = act(s, 'p1', { type: 'fold' });
    expect(s.phase).toBe('handOver');
    expect(s.lastHand!.showdown).toBe(false);
    expect(s.players.map((p) => p.stack)).toEqual([1000, 995, 1005]);
  });

  it('la mise non suivie est rendue', () => {
    let s = startHand(newGame(2), seededRng(1), { button: 0 });
    s = act(s, 'p0', { type: 'raise', amount: 300 });
    s = act(s, 'p1', { type: 'fold' });
    expect(s.players.map((p) => p.stack)).toEqual([1010, 990]);
    expect(s.log.some((e) => e.kind === 'return' && e.amount === 290)).toBe(true);
  });

  it("abattage : la meilleure main gagne et la combinaison est affichée", () => {
    // bouton p0 → distribution : p1, p2, p0
    const deck = stackDeck(['Ah Kh', '7c 2d', 'Qs Qd'], 'Ad 9s 4c 3h 2c');
    let s = startHand(newGame(3), seededRng(1), { button: 0, deck });
    s = checkDown(s);
    expect(s.lastHand!.showdown).toBe(true);
    expect(s.lastHand!.winnings).toEqual({ p1: 30 });
    expect(s.log.find((e) => e.kind === 'win')!.text).toBe("J1 remporte 30 avec Paire d'As");
    expect(s.players.map((p) => p.stack)).toEqual([990, 1020, 990]);
  });

  it('pot partagé quand le tableau joue', () => {
    const deck = stackDeck(['2c 3d', '2d 3c'], 'As Ks Qs Js Ts');
    let s = startHand(newGame(2), seededRng(1), { button: 0, deck });
    s = checkDown(s);
    expect(s.lastHand!.winnings).toEqual({ p0: 10, p1: 10 });
    expect(s.players.map((p) => p.stack)).toEqual([1000, 1000]);
  });

  it('pots secondaires : le tapis court gagne le principal, un autre le secondaire', () => {
    // bouton p0, distribution p1, p2, p0. p0 = 100 jetons (meilleure main), p1 = 300, p2 = 300
    const deck = stackDeck(['Ks Kd', 'Qs Qd', 'As Ad'], '2c 7h 9d Jc 3s');
    let s = startHand(newGame(3, [100, 300, 300]), seededRng(1), { button: 0, deck });
    s = act(s, 'p0', { type: 'allin' });
    s = act(s, 'p1', { type: 'allin' });
    s = act(s, 'p2', { type: 'call' });
    expect(s.phase).toBe('handOver');
    expect(s.board).toHaveLength(5); // tableau déroulé automatiquement
    expect(s.lastHand!.pots).toEqual([
      { amount: 300, eligible: ['p0', 'p1', 'p2'] },
      { amount: 400, eligible: ['p1', 'p2'] },
    ]);
    expect(s.lastHand!.winnings).toEqual({ p0: 300, p1: 400 });
    expect(s.players.map((p) => p.stack)).toEqual([300, 400, 0]);
    expect(s.players[2].status).toBe('out');
  });

  it("élimination et fin de partie quand il ne reste qu'un joueur", () => {
    const deck = stackDeck(['As Ah', '7c 2d'], 'Kd 9s 4c 3h 8c');
    // bouton p0 (PB) parle en premier ; la distribution commence par p1 (paire d'As)
    let s = startHand(newGame(2, [300, 500]), seededRng(1), { button: 0, deck });
    s = act(s, 'p0', { type: 'allin' });
    s = act(s, 'p1', { type: 'call' });
    expect(s.phase).toBe('gameOver');
    expect(s.winnerId).toBe('p1');
    expect(s.players[0].status).toBe('out');
    expect(s.players[0].eliminatedAtHand).toBe(1);
    expect(s.players.map((p) => p.stack)).toEqual([0, 800]);
    expect(() => startHand(s)).toThrow(/terminée/);
  });
});

describe('outils', () => {
  it("minuteur écoulé : check si possible, sinon fold", () => {
    let s = startHand(newGame(3), seededRng(1), { button: 0 });
    expect(timeoutAction(s)).toEqual({ type: 'fold' });
    s = act(s, 'p0', { type: 'call' });
    s = act(s, 'p1', { type: 'call' });
    expect(timeoutAction(s)).toEqual({ type: 'check' });
  });

  it('vue publique : pas de paquet, pas de cartes adverses', () => {
    const s = startHand(newGame(3), seededRng(1), { button: 0 });
    const v = getPublicView(s, 'p1');
    expect(v.deck).toEqual([]);
    expect(v.players[1].holeCards).toHaveLength(2);
    expect(v.players[0].holeCards).toEqual([]);
    expect(v.players[2].holeCards).toEqual([]);
    expect(s.players[0].holeCards).toHaveLength(2); // l'état d'origine n'est pas modifié
  });
});

describe('simulation aléatoire (fuzz)', () => {
  it('2 000 parties complètes avec actions aléatoires : aucun jeton créé ou perdu', () => {
    const rng = seededRng(2026);
    let hands = 0;
    for (let game = 0; game < 2000; game++) {
      const n = 2 + Math.floor(rng() * 8);
      const stacks = Array.from({ length: n }, () => 20 + Math.floor(rng() * 2000));
      let s = newGame(n, stacks, { ...CONFIG, blindIncreaseEveryHands: 10 });
      const total = totalChips(s);

      for (let h = 0; h < 400 && s.phase !== 'gameOver'; h++) {
        s = startHand(s, rng);
        hands++;
        let guard = 0;
        while (s.phase === 'betting') {
          if (++guard > 500) throw new Error('Boucle infinie');
          const l = getLegalActions(s)!;
          const me = s.players[s.toAct!];
          expect(me.status).toBe('active');
          const r = rng();
          let a: PlayerAction;
          if (r < 0.15 && !l.canCheck) a = { type: 'fold' };
          else if (r < 0.55) a = l.canCheck ? { type: 'check' } : { type: 'call' };
          else if (r < 0.9 && l.canRaise) {
            const amt = l.minRaiseTo + Math.floor(rng() * (l.maxRaiseTo - l.minRaiseTo + 1));
            a = { type: 'raise', amount: amt };
          } else if (l.canRaise || l.canCall) a = { type: 'allin' };
          else a = { type: 'check' };
          s = act(s, l.playerId, a);
          expect(totalChips(s)).toBe(total);
          expect(s.players.every((p) => p.stack >= 0)).toBe(true);
        }
        expect(totalChips(s)).toBe(total);
        expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(total);
        // Les gains distribués = somme des pots
        const potSum = s.lastHand!.pots.reduce((x, p) => x + p.amount, 0);
        const won = Object.values(s.lastHand!.winnings).reduce((x, v) => x + v, 0);
        expect(won).toBe(potSum);
        // 52 cartes uniques en jeu
        const cards = [...s.board, ...s.players.flatMap((p) => p.holeCards), ...s.deck].map(cardToString);
        expect(new Set(cards).size).toBe(cards.length);
      }
    }
    expect(hands).toBeGreaterThan(5000);
  });
});
