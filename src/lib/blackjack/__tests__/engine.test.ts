import { describe, expect, it } from 'vitest';
import { parseCards, seededRng } from '../../poker/cards.ts';
import type { BJState } from '../engine.ts';
import {
  act,
  basicStrategy,
  createTable,
  deal,
  evalPairs,
  evalPlus3,
  handTotal,
  isBlackjack,
  legalActions,
  recommendedAction,
  takeInsurance,
  totalLabel,
} from '../engine.ts';

const rng = seededRng(42);
/** Ordre de tirage : joueur, croupier visible, joueur, croupier caché, puis les cartes suivantes. */
const start = (cards: string, bet = 100, balance = 1000): BJState =>
  deal(createTable(balance, undefined, rng), bet, rng, { preset: parseCards(cards) });

describe('valeurs des mains', () => {
  it('totaux durs et souples', () => {
    expect(handTotal(parseCards('Kh 7c'))).toEqual({ total: 17, soft: false });
    expect(handTotal(parseCards('Ah 6c'))).toEqual({ total: 17, soft: true });
    expect(handTotal(parseCards('Ah 6c Tc'))).toEqual({ total: 17, soft: false });
    expect(handTotal(parseCards('Ah Ad 9c'))).toEqual({ total: 21, soft: true });
    expect(handTotal(parseCards('Ah Ad Ac Ah'))).toEqual({ total: 14, soft: true });
    expect(isBlackjack(parseCards('As Qd'))).toBe(true);
    expect(isBlackjack(parseCards('7s 7d 7c'))).toBe(false);
    expect(totalLabel(parseCards('Ah 6c'))).toBe('7 / 17');
    expect(totalLabel(parseCards('Kh Qc 5d'))).toBe('25 · Brûlé');
  });
});

describe('déroulement', () => {
  it('gagner contre le croupier qui brûle', () => {
    // joueur T,9 = 19 ; croupier 6 + T = 16, tire un 8 → 24
    let s = start('Th 6c 9d Ts 8h');
    expect(s.phase).toBe('playing');
    expect(s.balance).toBe(900);
    s = act(s, 'stand');
    expect(s.phase).toBe('settled');
    expect(handTotal(s.dealer).total).toBe(24);
    expect(s.hands[0].outcome).toBe('win');
    expect(s.balance).toBe(1100);
    expect(s.lastNet).toBe(100);
  });

  it('blackjack payé 3 pour 2', () => {
    const s = start('Ah 9c Kd 7s');
    expect(s.phase).toBe('settled');
    expect(s.hands[0].outcome).toBe('blackjack');
    expect(s.balance).toBe(1150);
  });

  it('le croupier reste sur 17 souple (S17) et tire sur 16', () => {
    let s = start('Th 6c 8d As');
    s = act(s, 'stand'); // 18 contre A,6 = 17 souple : le croupier reste
    expect(s.dealer).toHaveLength(2);
    expect(s.hands[0].outcome).toBe('win');
  });

  it('brûler en tirant', () => {
    let s = start('Th 9c 6d 8s Kd');
    s = act(s, 'hit');
    expect(s.hands[0].status).toBe('bust');
    expect(s.phase).toBe('settled');
    expect(s.dealer).toHaveLength(2); // le croupier ne joue pas si toutes les mains ont brûlé
    expect(s.balance).toBe(900);
  });

  it('doubler : une seule carte, mise doublée', () => {
    let s = start('6h 5c 5d Ts Th 7c');
    // joueur 6,5 = 11 ; croupier 5,T = 15
    expect(legalActions(s)!.double).toBe(true);
    s = act(s, 'double'); // tire T → 21 ; croupier 15 + 7 = 22
    expect(s.hands[0].bet).toBe(200);
    expect(s.hands[0].cards).toHaveLength(3);
    expect(s.hands[0].outcome).toBe('win');
    expect(s.balance).toBe(1200);
  });

  it('séparer deux 8 puis jouer chaque main', () => {
    let s = start('8h 6c 8d Ts 3h Tc 9h');
    // mains : 8,3 et 8,T ; croupier 6,T = 16
    s = act(s, 'split');
    expect(s.hands).toHaveLength(2);
    expect(s.balance).toBe(800);
    expect(s.hands[0].cards.map((c) => c.rank)).toEqual([8, 3]);
    s = act(s, 'double'); // 8,3 + 9 = 20 (doubler après séparation)
    expect(s.active).toBe(1);
    s = act(s, 'stand'); // 8,T = 18
    // croupier 16 tire… (carte suivante du sabot mélangé) — on vérifie juste la cohérence des paiements
    const total = s.hands.reduce((x, h) => x + (h.payout ?? 0), 0);
    expect(s.balance).toBe(1000 - 300 + total);
    expect(s.phase).toBe('settled');
  });

  it('As séparés : une carte chacun, et 21 ne compte pas comme blackjack', () => {
    let s = start('Ah 9c Ad 8s Kh 5c');
    s = act(s, 'split');
    expect(s.hands.every((h) => h.cards.length === 2 && h.status !== 'playing')).toBe(true);
    // main 1 : A,K = 21 (pas blackjack) ; main 2 : A,5 = 16 ; croupier 9,8 = 17
    expect(s.hands[0].outcome).toBe('win');
    expect(s.hands[0].payout).toBe(200);
    expect(s.hands[1].outcome).toBe('lose');
  });

  it('abandon : la moitié de la mise est rendue', () => {
    let s = start('Th Ac 6d 9s');
    // croupier montre un As → assurance proposée
    expect(s.phase).toBe('insurance');
    s = takeInsurance(s, false);
    s = act(s, 'surrender');
    expect(s.hands[0].outcome).toBe('surrender');
    expect(s.balance).toBe(950);
  });

  it('assurance gagnée quand le croupier a blackjack', () => {
    let s = start('Th Ac 9d Ks');
    s = takeInsurance(s, true);
    expect(s.phase).toBe('settled');
    expect(s.insuranceResult).toBe('won');
    // mise 100 perdue, assurance 50 payée 2:1 → net 0
    expect(s.lastNet).toBe(0);
    expect(s.balance).toBe(1000);
  });

  it('égalité de blackjacks', () => {
    let s = start('Ah Ac Kd Qs');
    s = takeInsurance(s, false);
    expect(s.hands[0].outcome).toBe('push');
    expect(s.balance).toBe(1000);
  });

  it('refuse une mise supérieure au solde et les actions illégales', () => {
    expect(() => deal(createTable(50, undefined, rng), 100, rng)).toThrow(/Solde insuffisant/);
    const s = start('Th 6c 9d Ts');
    expect(legalActions(s)!.split).toBe(false);
    expect(() => act(s, 'split')).toThrow();
  });

  it('remélange le sabot quand il est presque vide', () => {
    let s = createTable(1_000_000, undefined, rng);
    let reshuffles = 0;
    for (let i = 0; i < 400; i++) {
      s = deal(s, 10, rng);
      if (s.reshuffled) reshuffles++;
      while (s.phase === 'insurance' || s.phase === 'playing') {
        s = s.phase === 'insurance' ? takeInsurance(s, false) : act(s, recommendedAction(s)!.action);
      }
    }
    expect(reshuffles).toBeGreaterThan(2);
  });
});

describe('stratégie de base', () => {
  const up = (c: string) => parseCards(c)[0];
  it('quelques décisions classiques', () => {
    expect(basicStrategy(parseCards('Th 6c'), up('Th'))).toBe('Rh'); // 16 contre 10 : abandon
    expect(basicStrategy(parseCards('Th 2c'), up('4h'))).toBe('S'); // 12 contre 4 : rester
    expect(basicStrategy(parseCards('6h 5c'), up('Ah'))).toBe('H'); // 11 contre As : tirer (S17)
    expect(basicStrategy(parseCards('8h 8c'), up('Th'))).toBe('P'); // toujours séparer les 8
    expect(basicStrategy(parseCards('Th Tc'), up('6h'))).toBe('S'); // jamais séparer les 10
    expect(basicStrategy(parseCards('Ah 7c'), up('9h'))).toBe('H'); // 18 souple contre 9 : tirer
    expect(basicStrategy(parseCards('Ah 7c'), up('3h'))).toBe('Ds');
  });

  it('jouer la stratégie de base perd peu sur la durée (environ 0,5 %)', () => {
    const r = seededRng(7);
    let s = createTable(10_000_000, undefined, r);
    let wagered = 0;
    const start0 = s.balance;
    for (let i = 0; i < 40_000; i++) {
      s = deal(s, 10, r);
      while (s.phase === 'insurance' || s.phase === 'playing') {
        s = s.phase === 'insurance' ? takeInsurance(s, false) : act(s, recommendedAction(s)!.action);
      }
      wagered += s.hands.reduce((x, h) => x + h.bet, 0);
    }
    const edge = (s.balance - start0) / wagered;
    expect(edge).toBeGreaterThan(-0.025);
    expect(edge).toBeLessThan(0.015);
  }, 120_000);
});

describe('paris annexes', () => {
  const pc = (s: string) => parseCards(s);
  it('Perfect Pairs : parfaite, couleur, mixte', () => {
    const [a, b, c, d] = pc('8h 8h 8d 8s');
    expect(evalPairs(a, b)?.mult).toBe(25);
    expect(evalPairs(a, c)?.mult).toBe(12);
    expect(evalPairs(a, d)?.mult).toBe(6);
    expect(evalPairs(a, pc('9h')[0])).toBeNull();
  });
  it('21+3 : toutes les combinaisons', () => {
    expect(evalPlus3(pc('7s 7s 7s'))?.mult).toBe(100);
    expect(evalPlus3(pc('9h Th Jh'))?.mult).toBe(40);
    expect(evalPlus3(pc('7s 7d 7c'))?.mult).toBe(30);
    expect(evalPlus3(pc('4c 6s 5d'))?.mult).toBe(10);
    expect(evalPlus3(pc('Ac 2s 3d'))?.mult).toBe(10);
    expect(evalPlus3(pc('Qc Ks Ad'))?.mult).toBe(10);
    expect(evalPlus3(pc('Kc As 2d'))).toBeNull();
    expect(evalPlus3(pc('2d 9d Kd'))?.mult).toBe(5);
    expect(evalPlus3(pc('2d 9c Kd'))).toBeNull();
  });
  it('les gains des paris annexes entrent dans le solde et le net', () => {
    // joueur 8h 8d, croupier 8s (visible) puis 9c ; 21+3 = brelan 8 (30:1), paires = couleur (12:1)
    let s = createTable(1000, undefined, seededRng(1));
    s = deal(s, 10, seededRng(1), { preset: pc('8h 8s 8d 9c'), side: { pairs: 5, plus3: 5 } });
    expect(s.balance).toBe(980);
    expect(s.sideResults.map((r) => r.mult)).toEqual([12, 30]);
    s = act(s, 'stand'); // 16 contre 17 : perdu
    expect(s.phase).toBe('settled');
    // mise 10 perdue, paires +60, 21+3 +150
    expect(s.lastNet).toBe(-10 + 60 + 150);
    expect(s.balance).toBe(1000 + s.lastNet);
  });
  it('refuse un total de mises supérieur au solde', () => {
    const s = createTable(20, undefined, seededRng(1));
    expect(() => deal(s, 10, seededRng(1), { side: { pairs: 6, plus3: 5 } })).toThrow();
  });
});
