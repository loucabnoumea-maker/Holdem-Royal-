// Démo console du moteur : joue quelques mains et affiche l'historique.
// Lancer : npm run demo
import {
  applyAction, cardToDisplay, createDeck, createGame, evaluateHand, getLegalActions,
  seededRng, shuffle, startHand, type PlayerAction,
} from '../src/lib/poker/index.ts';

const rng = seededRng(Number(process.argv[2] ?? 11));
let s = createGame({ startingStack: 1000, smallBlind: 5, bigBlind: 10 }, [
  { id: 'louca', name: 'Louca' }, { id: 'b1', name: 'Max' }, { id: 'b2', name: 'Inès' }, { id: 'b3', name: 'Sam' },
]);

for (let h = 0; h < 3 && s.phase !== 'gameOver'; h++) {
  s = startHand(s, rng);
  console.log(`\n══════ Main n°${s.handNumber} — blindes ${s.smallBlind}/${s.bigBlind} — bouton : ${s.players[s.buttonIndex].name}`);
  for (const p of s.players) console.log(`  ${p.name.padEnd(6)} ${p.holeCards.map(cardToDisplay).join(' ')}`);
  while (s.phase === 'betting') {
    const l = getLegalActions(s)!;
    const r = rng();
    const a: PlayerAction =
      r < 0.12 && !l.canCheck ? { type: 'fold' }
      : r < 0.8 || !l.canRaise ? (l.canCheck ? { type: 'check' } : { type: 'call' })
      : { type: 'raise', amount: Math.min(l.maxRaiseTo, Math.max(l.minRaiseTo, Math.round(l.pot * 0.75 + l.currentBet))) };
    s = applyAction(s, l.playerId, a);
  }
  for (const e of s.log) console.log(`  [${e.street.padEnd(7)}] ${e.text}`);
  console.log('  Tapis :', s.players.map((p) => `${p.name} ${p.stack}`).join(' | '));
}

// Mini benchmark de l'évaluateur (important pour les bots Difficile en Monte Carlo)
const hands = Array.from({ length: 2000 }, () => shuffle(createDeck(), rng).slice(0, 7));
const N = 300_000;
const t0 = performance.now();
for (let i = 0; i < N; i++) evaluateHand(hands[i % hands.length]);
const ms = performance.now() - t0;
console.log(`\nÉvaluateur : ${Math.round(N / (ms / 1000)).toLocaleString('fr-FR')} mains de 7 cartes / seconde`);
