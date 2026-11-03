import { describe, expect, it } from 'vitest';
import { cardToString } from '../../lib/poker/cards.ts';
import { buildBlackjackDemo, buildPokerDemo } from '../demos.ts';

describe('démonstrations', () => {
  it('la main de poker de démonstration est légale et se termine comme le texte le dit', () => {
    const steps = buildPokerDemo();
    expect(steps.length).toBeGreaterThan(10);
    const last = steps.at(-1)!.state;
    expect(last.phase).toBe('handOver');
    expect(last.board.map(cardToString)).toEqual(['Kd', '9h', '4s', 'Jc', '2s']);
    expect(Object.keys(last.lastHand!.winnings)).toEqual(['lea']);
    expect(last.lastHand!.hands.find((h) => h.playerId === 'lea')!.hand.description).toBe('Brelan de Neuf');
    expect(last.lastHand!.hands.find((h) => h.playerId === 'toi')!.hand.description).toBe('Paire de Rois');
    // le pot après le préflop vaut 130 comme annoncé
    const afterPre = steps.find((s) => s.state.street === 'flop')!.state;
    expect(afterPre.players.reduce((x, p) => x + p.totalBet, 0)).toBe(120);
    const afterFlop = steps.find((s) => s.state.street === 'turn')!.state;
    expect(afterFlop.players.reduce((x, p) => x + p.totalBet, 0)).toBe(480);
    expect(steps[0].text).not.toContain('130');
  });

  it('le tour de blackjack de démonstration correspond au texte', () => {
    const v = buildBlackjackDemo();
    const last = v.at(-1)!;
    expect(last.hands).toHaveLength(2);
    expect(last.text).toContain('+150');
    expect(last.dealer.length).toBe(3);
  });
});
