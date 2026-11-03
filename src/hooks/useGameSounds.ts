import { useEffect, useRef } from 'react';
import type { GameState } from '../lib/poker/index.ts';
import { play } from '../lib/sound.ts';

/** Joue les sons correspondant aux nouvelles entrées du journal. */
export function useGameSounds(view: GameState | null, heroId: string | null) {
  const prev = useRef<{ hand: number; logLen: number; toAct: number | null }>({ hand: -1, logLen: 0, toAct: null });

  useEffect(() => {
    if (!view) return;
    const p = prev.current;
    const newHand = view.handNumber !== p.hand;
    const from = newHand ? 0 : p.logLen;
    const fresh = view.log.slice(from);

    if (newHand && view.phase === 'betting') {
      // Distribution : une carte par joueur, deux tours
      const n = Math.min(18, view.players.filter((x) => x.stack > 0 || x.bet > 0).length * 2);
      for (let i = 0; i < n; i++) setTimeout(() => play('card'), i * 95);
    }
    let delay = 0;
    for (const e of fresh) {
      const t = delay;
      delay += 60;
      setTimeout(() => {
        switch (e.kind) {
          case 'street':
            play('card');
            setTimeout(() => play('flip'), 260);
            break;
          case 'call':
          case 'bet':
          case 'raise':
          case 'allin':
            play('chip');
            break;
          case 'check':
            play('check');
            break;
          case 'fold':
            play('fold');
            break;
          case 'win':
            play(e.playerId === heroId ? 'win' : 'chips');
            break;
          case 'eliminated':
            if (e.playerId === heroId) play('lose');
            break;
        }
      }, t);
    }

    const heroIdx = view.players.findIndex((x) => x.id === heroId);
    if (view.phase === 'betting' && view.toAct === heroIdx && heroIdx >= 0 && (p.toAct !== heroIdx || newHand)) {
      setTimeout(() => play('turn'), delay + 80);
    }
    prev.current = { hand: view.handNumber, logLen: view.log.length, toAct: view.toAct };
  }, [view, heroId]);
}
