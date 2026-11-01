import { describe, expect, it } from 'vitest';
import { cardToString, createDeck, parseCards, seededRng, shuffle } from '../cards.ts';
import { compareHands, evaluateHand, HandCategory } from '../evaluator.ts';

const ev = (s: string) => evaluateHand(parseCards(s));
const cmp = (a: string, b: string) => Math.sign(compareHands(ev(a), ev(b)));

describe('paquet', () => {
  it('contient 52 cartes uniques', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardToString)).size).toBe(52);
  });
  it('le mélange garde les 52 cartes et est reproductible avec une graine', () => {
    const a = shuffle(createDeck(), seededRng(42));
    const b = shuffle(createDeck(), seededRng(42));
    expect(a.map(cardToString)).toEqual(b.map(cardToString));
    expect(new Set(a.map(cardToString)).size).toBe(52);
    expect(a.map(cardToString)).not.toEqual(createDeck().map(cardToString));
  });
});

describe('catégories', () => {
  const cases: [string, HandCategory, string][] = [
    ['As Ks Qs Js Ts 2d 3c', HandCategory.StraightFlush, 'Quinte flush royale'],
    ['9h 8h 7h 6h 5h Ad Ac', HandCategory.StraightFlush, 'Quinte flush au Neuf'],
    ['Ad 2d 3d 4d 5d Kc Kh', HandCategory.StraightFlush, 'Quinte flush au Cinq'],
    ['Qs Qh Qd Qc 2s 3s 9d', HandCategory.Quads, 'Carré de Dames'],
    ['Ks Kh Kd 7c 7s 2d 3h', HandCategory.FullHouse, 'Full : Rois par les Sept'],
    ['Ah Kh 9h 5h 2h Ks Kd', HandCategory.Flush, "Couleur à l'As"],
    ['Ts 9h 8d 7c 6s 2h 2d', HandCategory.Straight, 'Quinte au Dix'],
    ['Ah 2c 3d 4s 5h Kc Qd', HandCategory.Straight, 'Quinte au Cinq'],
    ['Js Jh Jd 9c 4s 2h 3d', HandCategory.Trips, 'Brelan de Valets'],
    ['As Ah 8d 8c 4s 2h 3d', HandCategory.TwoPair, "Double paire : As et Huit"],
    ['8s 8h Kd Qc 4s 2h 3d', HandCategory.Pair, "Paire d'Huit"],
    ['As Jh 9d 7c 4s 3h 2d', HandCategory.HighCard, 'Carte haute : As'],
  ];
  it.each(cases)('%s → %s', (hand, cat, desc) => {
    const r = ev(hand);
    expect(r.category).toBe(cat);
    expect(r.description).toBe(desc);
    expect(r.cards).toHaveLength(5);
  });

  it('fonctionne avec 5 et 6 cartes', () => {
    expect(ev('2s 3s 4s 5s 6s').category).toBe(HandCategory.StraightFlush);
    expect(ev('2s 2h 4s 4d 6s 6c').description).toBe('Double paire : Six et Quatre');
  });

  it('refuse moins de 5 ou plus de 7 cartes', () => {
    expect(() => ev('As Ks Qs Js')).toThrow();
    expect(() => ev('As Ks Qs Js Ts 9s 8s 7s')).toThrow();
  });
});

describe('meilleure combinaison parmi 7 cartes', () => {
  it('choisit la quinte flush plutôt que la couleur supérieure', () => {
    const r = ev('9s 8s 7s 6s 5s As Ks');
    expect(r.category).toBe(HandCategory.StraightFlush);
    expect(r.tiebreak[0]).toBe(9);
  });
  it('choisit la quinte la plus haute (6 cartes consécutives)', () => {
    expect(ev('4s 5h 6d 7c 8s 9h 2d').tiebreak[0]).toBe(9);
  });
  it('deux brelans → full avec le plus haut brelan', () => {
    const r = ev('Ks Kh Kd 9c 9s 9h 2d');
    expect(r.category).toBe(HandCategory.FullHouse);
    expect(r.tiebreak).toEqual([13, 9]);
  });
  it('brelan + deux paires → full avec la meilleure paire', () => {
    expect(ev('5s 5h 5d Qc Qs 9h 9d').tiebreak).toEqual([5, 12]);
  });
  it('trois paires → garde les deux meilleures et le meilleur kicker', () => {
    expect(ev('As Ah Ks Kh 7d 7c 2s').tiebreak).toEqual([14, 13, 7]);
  });
  it('carré : kicker = meilleure carte restante (même une paire)', () => {
    expect(ev('7s 7h 7d 7c Ks Kh 2d').tiebreak).toEqual([7, 13]);
  });
  it('couleur avec 6 ou 7 cartes de la couleur : garde les 5 meilleures', () => {
    expect(ev('Ah Kh 9h 7h 5h 3h 2h').tiebreak).toEqual([14, 13, 9, 7, 5]);
  });
});

describe('comparaison et kickers', () => {
  it('ordre des catégories', () => {
    const ladder = [
      'As Jh 9d 7c 4s 3h 2d', // carte haute
      '2s 2h Kd Qc 4s 9h 3d', // paire
      '2s 2h 3d 3c 5s 9h Td', // double paire
      '2s 2h 2d 9c 4s Kh 3d', // brelan
      'Ah 2c 3d 4s 5h Kc Qd', // quinte (roue)
      '2h 4h 6h 8h Th Kc Qd', // couleur
      '2s 2h 2d 3c 3s 9h Td', // full
      '2s 2h 2d 2c 5s 9h Td', // carré
      'Ad 2d 3d 4d 5d Kc Kh', // quinte flush
    ];
    for (let i = 1; i < ladder.length; i++) expect(cmp(ladder[i], ladder[i - 1])).toBe(1);
  });
  it('paire égale départagée par le kicker', () => {
    expect(cmp('As Ah Kd 7c 4s 3h 2d', 'As Ah Qd 7c 4s 3h 2d')).toBe(1);
  });
  it('le 5e kicker compte, pas le 6e', () => {
    expect(cmp('As Kh Qd Jc 9s 3h 2d', 'As Kh Qd Jc 8s 7h 6d')).toBe(1);
    expect(cmp('As Kh Qd Jc 9s 3h 2d', 'As Kh Qd Jc 9h 4c 2c')).toBe(0);
  });
  it('la roue (A-5) perd contre la quinte au Six', () => {
    expect(cmp('Ah 2c 3d 4s 5h', '2c 3d 4s 5h 6d')).toBe(-1);
  });
  it('double paire : la 2e paire puis le kicker départagent', () => {
    expect(cmp('Ks Kh 9d 9c 2s', 'Ks Kh 8d 8c As')).toBe(1);
    expect(cmp('Ks Kh 9d 9c As', 'Kd Kc 9s 9h Qs')).toBe(1);
  });
  it('full : le brelan prime sur la paire', () => {
    expect(cmp('3s 3h 3d 2c 2s', '2s 2h 2d As Ah')).toBe(1);
  });
  it('égalité parfaite quand le tableau joue', () => {
    const board = 'Ts Js Qs Ks As';
    expect(cmp(`${board} 2h 3h`, `${board} 4d 5d`)).toBe(0);
  });
});

describe('cohérence sur des mains aléatoires', () => {
  it('10 000 mains de 7 cartes : 5 cartes distinctes issues de la main, score stable', () => {
    const rng = seededRng(7);
    for (let n = 0; n < 10_000; n++) {
      const seven = shuffle(createDeck(), rng).slice(0, 7);
      const r = evaluateHand(seven);
      expect(r.cards).toHaveLength(5);
      const codes = r.cards.map(cardToString);
      expect(new Set(codes).size).toBe(5);
      for (const c of codes) expect(seven.map(cardToString)).toContain(c);
      // Les 5 cartes retenues donnent exactement la même valeur.
      expect(evaluateHand(r.cards).score).toBe(r.score);
      // Vérification par force brute : max des 21 combinaisons de 5 cartes.
      if (n < 3000) {
        let best = -1;
        for (let i = 0; i < 7; i++)
          for (let j = i + 1; j < 7; j++) {
            const five = seven.filter((_, k) => k !== i && k !== j);
            best = Math.max(best, evaluateHand(five).score);
          }
        expect(r.score).toBe(best);
      }
    }
  });
});
