// Banc d'essai des bots : gains en grosses blindes / 100 mains et statistiques de style.
// npx tsx scripts/bot-bench.ts
import type { BotDifficulty, BotMoods, GameState, OpponentStats, PersonalityId } from '../src/lib/poker/index.ts';
import {
  applyAction, botHandEnd, createGame, decideBot, getLegalActions, seededRng, startHand, updateOpponentStats,
} from '../src/lib/poker/index.ts';

interface Seat { diff: BotDifficulty; pers: PersonalityId }

export function session(seats: Seat[], hands: number, seed: number) {
  const rng = seededRng(seed);
  const n = seats.length;
  let s: GameState = createGame({ startingStack: 1000, smallBlind: 5, bigBlind: 10 }, seats.map((_, i) => ({ id: `b${i}`, name: `B${i}` })));
  let stats: OpponentStats = {};
  let moods: BotMoods = {};
  const net = new Array(n).fill(0);
  const kinds: Record<string, number>[] = seats.map(() => ({}));
  const vpip = new Array(n).fill(0);
  const pfr = new Array(n).fill(0);
  let shows = 0;
  let flops = 0;
  let atFlop = 0;
  let walks = 0;
  for (let h = 0; h < hands; h++) {
    // tapis remis à 1000 (cash game) pour mesurer proprement
    for (const p of s.players) { p.stack = 1000; p.status = 'active'; }
    s.phase = 'handOver';
    s = startHand(s, rng);
    const vp = new Set<number>(); const pr = new Set<number>();
    while (s.phase === 'betting') {
      const id = getLegalActions(s)!.playerId;
      const i = Number(id.slice(1));
      const d = decideBot(s, id, seats[i].diff, { rng, stats, personality: seats[i].pers, mood: moods[id] });
      kinds[i][d.kind] = (kinds[i][d.kind] ?? 0) + 1;
      if (s.street === 'preflop' && (d.action.type !== 'fold' && d.action.type !== 'check')) vp.add(i);
      if (s.street === 'preflop' && (d.action.type === 'raise' || d.action.type === 'bet' || d.action.type === 'allin')) pr.add(i);
      s = applyAction(s, id, d.action);
    }
    vp.forEach((i) => vpip[i]++); pr.forEach((i) => pfr[i]++);
    if (s.board.length >= 3) {
      flops++;
      const preFolds = s.log.filter((e) => e.street === 'preflop' && e.kind === 'fold').length;
      atFlop += n - preFolds;
    } else if (s.log.filter((e) => e.street === 'preflop' && e.kind === 'fold').length === n - 1) walks++;
    stats = updateOpponentStats(stats, s);
    s.players.forEach((p, i) => {
      net[i] += p.stack - 1000;
      const r = botHandEnd(s, p.id, seats[i].pers, moods[p.id], rng);
      moods[p.id] = r.mood;
      if (r.show) shows++;
    });
  }
  return seats.map((seat, i) => ({
    ...seat,
    bb100: Math.round((net[i] / 10 / hands) * 100),
    vpip: Math.round((vpip[i] / hands) * 100),
    pfr: Math.round((pfr[i] / hands) * 100),
    bluffs: (kinds[i].bluff ?? 0) + (kinds[i].steal ?? 0),
    semibluffs: kinds[i].semibluff ?? 0,
    traps: kinds[i].trap ?? 0,
    herocalls: kinds[i].herocall ?? 0,
    shows,
    flopPct: Math.round((flops / hands) * 100),
    avgAtFlop: flops ? Math.round((atFlop / flops) * 10) / 10 : 0,
    walkPct: Math.round((walks / hands) * 100),
  }));
}

if (process.argv[1]?.includes('bot-bench')) {
  const mode = process.argv[2] ?? 'hu';
  const hands = Number(process.argv[3] ?? 1500);
  if (mode === 'hu') {
    for (const [a, b] of [['medium', 'easy'], ['hard', 'easy'], ['hard', 'medium']] as [BotDifficulty, BotDifficulty][]) {
      let tot = 0;
      const t0 = Date.now();
      for (const seed of [1, 2]) {
        const r = session([{ diff: a, pers: (process.argv[4] as PersonalityId) ?? undefined! }, { diff: b, pers: (process.argv[5] as PersonalityId) ?? undefined! }].map((x) => ({ ...x, pers: x.pers ?? (x.diff === 'easy' ? 'station' : x.diff === 'medium' ? 'shark' : 'grinder') })), hands, seed);
        tot += r[0].bb100;
      }
      console.log(`${a} vs ${b}: ${tot / 2} bb/100 (${Date.now() - t0} ms)`);
    }
  } else {
    // table à 6 : une personnalité de chaque, difficulté moyenne
    const pers: PersonalityId[] = ['shark', 'maniac', 'rock', 'station', 'bluffer', 'grinder'];
    const r = session(pers.map((p) => ({ diff: (process.argv[4] as BotDifficulty) ?? 'medium', pers: p })), hands, 7);
    console.table(r.map(({ diff: _d, shows: _s, flopPct: _f, avgAtFlop: _a, walkPct: _w, ...x }) => x));
    console.log(`Flop vu : ${r[0].flopPct} % des mains · joueurs au flop : ${r[0].avgAtFlop} · tout le monde se couche avant le flop : ${r[0].walkPct} %`);
  }
}
