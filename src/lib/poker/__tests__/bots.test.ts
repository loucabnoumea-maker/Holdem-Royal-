import { describe, expect, it } from 'vitest';
import { parseCards, seededRng } from '../cards.ts';
import type { BotDifficulty, OpponentStats, PersonalityId } from '../bots.ts';
import {
  botHandEnd,
  chenScore,
  decideBot,
  decideBotAction,
  detectDraws,
  estimateEquity,
  PERSONALITY_IDS,
  playStyle,
  randomPersonalities,
  updateOpponentStats,
} from '../bots.ts';
import type { GameState } from '../game.ts';
import { applyAction, createGame, getLegalActions, showCards, startHand, totalChips } from '../game.ts';

describe('force de main', () => {
  it('formule de Chen', () => {
    expect(chenScore(parseCards('As Ad'))).toBe(20);
    expect(chenScore(parseCards('Ks Kd'))).toBe(16);
    expect(chenScore(parseCards('2s 2d'))).toBe(5);
    expect(chenScore(parseCards('As Ks'))).toBe(12);
    expect(chenScore(parseCards('7s 2d'))).toBe(-1);
    expect(chenScore(parseCards('Js Ts'))).toBe(9);
  });

  it('équité Monte Carlo cohérente avec les valeurs connues', () => {
    const rng = seededRng(3);
    const aa = estimateEquity(parseCards('As Ad'), [], 1, 4000, rng);
    expect(aa).toBeGreaterThan(0.82);
    expect(aa).toBeLessThan(0.88);
    const sevenTwo = estimateEquity(parseCards('7s 2d'), [], 1, 4000, rng);
    expect(sevenTwo).toBeGreaterThan(0.31);
    expect(sevenTwo).toBeLessThan(0.38);
    // AA perd de la valeur face à plus d'adversaires
    expect(estimateEquity(parseCards('As Ad'), [], 5, 3000, rng)).toBeLessThan(0.6);
    // Quinte flush max au tableau : 100 %
    expect(estimateEquity(parseCards('As Ks'), parseCards('Qs Js Ts'), 3, 200, rng)).toBe(1);
  });
});

function playGame(diffs: BotDifficulty[], seed: number, maxHands = 300, pers?: PersonalityId[]) {
  const rng = seededRng(seed);
  let s: GameState = createGame(
    { startingStack: 1000, smallBlind: 5, bigBlind: 10, blindIncreaseEveryHands: 15 },
    diffs.map((_, i) => ({ id: `b${i}`, name: `Bot${i}` })),
  );
  const total = totalChips(s);
  let stats: OpponentStats = {};
  for (let h = 0; h < maxHands && s.phase !== 'gameOver'; h++) {
    s = startHand(s, rng);
    while (s.phase === 'betting') {
      const id = getLegalActions(s)!.playerId;
      const i = Number(id.slice(1));
      s = applyAction(s, id, decideBotAction(s, id, diffs[i], { rng, stats, personality: pers?.[i] }));
    }
    stats = updateOpponentStats(stats, s);
    expect(totalChips(s)).toBe(total);
  }
  return { s, stats };
}

describe('bots', () => {
  it('ne jouent que des actions légales (20 parties, Facile et Moyen mélangés)', () => {
    const all: BotDifficulty[] = ['easy', 'medium', 'easy', 'medium', 'easy', 'medium', 'easy', 'easy', 'medium'];
    for (let g = 0; g < 20; g++) {
      const n = 2 + (g % 8);
      playGame(all.slice(0, n), g, 120, randomPersonalities(n, seededRng(g)));
    }
  }, 120_000);

  it('le bot Difficile joue des actions légales en partie à 6', () => {
    playGame(['hard', 'easy', 'medium', 'hard', 'easy', 'medium'], 99, 40);
  }, 60_000);

  it('Moyen bat Facile en tête-à-tête la plupart du temps', () => {
    let wins = 0;
    const games = 24;
    for (let g = 0; g < games; g++) {
      const order: BotDifficulty[] = g % 2 ? ['medium', 'easy'] : ['easy', 'medium'];
      const { s } = playGame(order, 1000 + g, 400);
      const med = s.players[order.indexOf('medium')];
      const easy = s.players[order.indexOf('easy')];
      if (med.stack > easy.stack) wins++;
    }
    expect(wins / games).toBeGreaterThan(0.6);
  }, 120_000);

  it('Difficile bat Facile en tête-à-tête la plupart du temps', () => {
    let wins = 0;
    const games = 8;
    for (let g = 0; g < games; g++) {
      const order: BotDifficulty[] = g % 2 ? ['hard', 'easy'] : ['easy', 'hard'];
      const { s } = playGame(order, 2000 + g, 250);
      const hard = s.players[order.indexOf('hard')];
      const easy = s.players[order.indexOf('easy')];
      if (hard.stack > easy.stack) wins++;
    }
    expect(wins / games).toBeGreaterThanOrEqual(0.6);
  }, 180_000);

  it('profil adverse : détecte un style agressif ou passif', () => {
    expect(playStyle({ hands: 20, vpip: 10, aggressive: 20, passive: 5 })).toBe('aggressive');
    expect(playStyle({ hands: 20, vpip: 10, aggressive: 2, passive: 20 })).toBe('passive');
    expect(playStyle({ hands: 2, vpip: 1, aggressive: 1, passive: 1 })).toBe('unknown');
  });
});

describe('jeu « humain »', () => {
  it('détecte les tirages couleur et quinte', () => {
    expect(detectDraws(parseCards('Ah 7h'), parseCards('2h 9h Kc'))).toMatchObject({ flush: true });
    expect(detectDraws(parseCards('8c 9d'), parseCards('6s 7h Kc'))).toMatchObject({ openEnded: true, gutshot: false });
    expect(detectDraws(parseCards('8c 9d'), parseCards('5s 7h Kc'))).toMatchObject({ openEnded: false, gutshot: true });
    expect(detectDraws(parseCards('8c 9d'), parseCards('2s 3h Kc'))).toEqual({ flush: false, openEnded: false, gutshot: false });
  });

  it('chaque personnalité a son style (mains jouées, agressivité, bluffs)', () => {
    const pers: PersonalityId[] = ['rock', 'shark', 'maniac', 'station', 'bluffer', 'grinder'];
    const rng = seededRng(77);
    let s: GameState = createGame({ startingStack: 1000, smallBlind: 5, bigBlind: 10 }, pers.map((p) => ({ id: p, name: p })));
    const vpip: Record<string, number> = {};
    const raises: Record<string, number> = {};
    const bluffs: Record<string, number> = {};
    const HANDS = 220;
    let flops = 0;
    for (let h = 0; h < HANDS; h++) {
      for (const p of s.players) {
        p.stack = 1000;
        p.status = 'active';
      }
      s.phase = 'handOver';
      s = startHand(s, rng);
      const played = new Set<string>();
      while (s.phase === 'betting') {
        const id = getLegalActions(s)!.playerId;
        const d = decideBot(s, id, 'medium', { rng, personality: id as PersonalityId });
        if (s.street === 'preflop' && d.action.type !== 'fold' && d.action.type !== 'check') played.add(id);
        if (d.action.type === 'raise' || d.action.type === 'bet' || d.action.type === 'allin') raises[id] = (raises[id] ?? 0) + 1;
        if (d.kind === 'bluff' || d.kind === 'semibluff' || d.kind === 'steal') bluffs[id] = (bluffs[id] ?? 0) + 1;
        s = applyAction(s, id, d.action);
      }
      for (const id of played) vpip[id] = (vpip[id] ?? 0) + 1;
      if (s.board.length >= 3) flops++;
    }
    // Tapis profonds (100 blindes) : on voit le flop dans la grande majorité des mains
    expect(flops / HANDS).toBeGreaterThan(0.8);
    expect(vpip.rock).toBeLessThan(vpip.shark);
    expect(vpip.shark).toBeLessThan(vpip.maniac);
    expect(raises.maniac).toBeGreaterThan(raises.station * 2);
    expect(bluffs.bluffer).toBeGreaterThan((bluffs.rock ?? 0) * 3);
    expect(bluffs.maniac).toBeGreaterThan((bluffs.rock ?? 0) * 3);
  }, 120_000);

  it('temps de réflexion humain : évident = rapide, mode rapide plus court', () => {
    const rng = seededRng(3);
    let fast = 0;
    let normal = 0;
    for (let i = 0; i < 40; i++) {
      const s = startHand(createGame({ startingStack: 1000, smallBlind: 5, bigBlind: 10 }, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]), rng);
      const id = getLegalActions(s)!.playerId;
      const d1 = decideBot(s, id, 'easy', { rng, speed: 'normal' });
      const d2 = decideBot(s, id, 'easy', { rng, speed: 'fast' });
      expect(d1.thinkMs).toBeGreaterThan(200);
      expect(d1.thinkMs).toBeLessThan(7000);
      normal += d1.thinkMs;
      fast += d2.thinkMs;
    }
    expect(fast).toBeLessThan(normal * 0.6);
  });

  it('tilt après une grosse perte, puis il redescend', () => {
    let s = startHand(createGame({ startingStack: 1000, smallBlind: 5, bigBlind: 10 }, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]), seededRng(1), { button: 0 });
    while (s.phase === 'betting') {
      const l = getLegalActions(s)!;
      s = applyAction(s, l.playerId, l.canRaise ? { type: 'allin' } : { type: 'call' });
    }
    const loser = s.players.find((p) => p.stack === 0) ?? s.players.reduce((a, b) => (a.stack < b.stack ? a : b));
    const after = botHandEnd(s, loser.id, 'maniac', { tilt: 0 }, seededRng(2));
    expect(after.mood.tilt).toBeGreaterThan(0.2);
    // une main calme ensuite : le tilt baisse
    let calm = startHand(createGame({ startingStack: 1000, smallBlind: 5, bigBlind: 10 }, [{ id: loser.id, name: 'A' }, { id: 'z', name: 'Z' }]), seededRng(4));
    calm = applyAction(calm, getLegalActions(calm)!.playerId, { type: 'fold' });
    expect(botHandEnd(calm, loser.id, 'maniac', after.mood, seededRng(5)).mood.tilt).toBeLessThan(after.mood.tilt);
  });

  it('un bluffeur montre parfois son bluff gagné, le Roc presque jamais', () => {
    const rng = seededRng(9);
    let bluffer = 0;
    let rock = 0;
    for (let i = 0; i < 300; i++) {
      // le bot (b) gagne la main préflop avec 7-2 : l'adversaire se couche (distribution : a, b, a, b)
      const deck = parseCards('Ks 7c Kd 2d');
      let s = startHand(createGame({ startingStack: 1000, smallBlind: 5, bigBlind: 10 }, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]), rng, { button: 1, deck });
      // bouton b = PB parle en premier : il relance, a se couche
      s = applyAction(s, 'b', { type: 'raise', amount: 30 });
      s = applyAction(s, 'a', { type: 'fold' });
      expect(s.players.find((p) => p.id === 'b')!.holeCards.map((c) => c.rank).sort((x, y) => x - y)).toEqual([2, 7]);
      if (botHandEnd(s, 'b', 'bluffer', undefined, rng).show) bluffer++;
      if (botHandEnd(s, 'b', 'rock', undefined, rng).show) rock++;
    }
    expect(bluffer).toBeGreaterThan(120);
    expect(rock).toBeLessThan(25);
  });

  it('montrer ses cartes après la main les rend visibles à tous', () => {
    let s = startHand(createGame({ startingStack: 1000, smallBlind: 5, bigBlind: 10 }, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]), seededRng(1), { button: 0 });
    expect(() => showCards(s, 'a')).toThrow();
    s = applyAction(s, 'a', { type: 'raise', amount: 40 });
    s = applyAction(s, 'b', { type: 'fold' });
    s = showCards(s, 'a');
    expect(s.lastHand!.shown![0].playerId).toBe('a');
    expect(s.log.at(-1)!.kind).toBe('show');
  });

  it('toutes les personnalités existent', () => {
    expect(PERSONALITY_IDS).toHaveLength(6);
    const picks = randomPersonalities(6, seededRng(1));
    expect(new Set(picks).size).toBe(6);
  });
});
