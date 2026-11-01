import { describe, expect, it } from 'vitest';
import { computePots, distributePots } from '../pots.ts';

const c = (id: string, totalBet: number, folded = false) => ({ id, totalBet, folded });

describe('computePots', () => {
  it('un seul pot quand tout le monde a mis pareil', () => {
    expect(computePots([c('a', 100), c('b', 100), c('c', 100)])).toEqual([
      { amount: 300, eligible: ['a', 'b', 'c'] },
    ]);
  });

  it('pot principal + pot secondaire avec un tapis court', () => {
    // A tapis 50, B et C mettent 200
    expect(computePots([c('a', 50), c('b', 200), c('c', 200)])).toEqual([
      { amount: 150, eligible: ['a', 'b', 'c'] },
      { amount: 300, eligible: ['b', 'c'] },
    ]);
  });

  it('trois tapis de tailles différentes', () => {
    const pots = computePots([c('a', 100), c('b', 300), c('c', 600), c('d', 600)]);
    expect(pots).toEqual([
      { amount: 400, eligible: ['a', 'b', 'c', 'd'] },
      { amount: 600, eligible: ['b', 'c', 'd'] },
      { amount: 600, eligible: ['c', 'd'] },
    ]);
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(1600);
  });

  it('les jetons des joueurs couchés restent dans le pot sans éligibilité', () => {
    const pots = computePots([c('a', 80, true), c('b', 50), c('c', 200)]);
    expect(pots).toEqual([
      { amount: 150, eligible: ['b', 'c'] },
      { amount: 180, eligible: ['c'] },
    ]);
  });

  it('fusionne les niveaux qui ont les mêmes joueurs éligibles', () => {
    // le joueur couché a mis 30 : crée un niveau intermédiaire mais même ensemble éligible
    expect(computePots([c('a', 30, true), c('b', 100), c('c', 100)])).toEqual([
      { amount: 230, eligible: ['b', 'c'] },
    ]);
  });
});

describe('distributePots', () => {
  it('le tapis court gagne le principal, un autre gagne le secondaire', () => {
    const pots = computePots([c('a', 50), c('b', 200), c('c', 200)]);
    const { winnings } = distributePots(pots, { a: 900, b: 500, c: 100 }, ['a', 'b', 'c']);
    expect(winnings).toEqual({ a: 150, b: 300 });
  });

  it('partage en cas d’égalité, jeton indivisible au premier à gauche du bouton', () => {
    const pots = [{ amount: 101, eligible: ['a', 'b', 'c'] }];
    const { winnings } = distributePots(pots, { a: 5, b: 9, c: 9 }, ['c', 'a', 'b']);
    expect(winnings).toEqual({ c: 51, b: 50 });
  });

  it('partage à trois avec reste de 2 jetons', () => {
    const pots = [{ amount: 302, eligible: ['a', 'b', 'c'] }];
    const { winnings } = distributePots(pots, { a: 1, b: 1, c: 1 }, ['b', 'c', 'a']);
    expect(winnings).toEqual({ b: 101, c: 101, a: 100 });
  });
});
