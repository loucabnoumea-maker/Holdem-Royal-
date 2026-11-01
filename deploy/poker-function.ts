// @ts-nocheck

// supabase/functions/poker/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

// supabase/functions/_shared/poker/cards.ts
var SUITS = ["s", "h", "d", "c"];
var RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
var RANK_CHARS = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "T",
  11: "J",
  12: "Q",
  13: "K",
  14: "A"
};
var CHAR_TO_RANK = Object.fromEntries(
  Object.entries(RANK_CHARS).map(([r, c]) => [c, Number(r)])
);
var RANK_NAMES_FR = {
  2: "Deux",
  3: "Trois",
  4: "Quatre",
  5: "Cinq",
  6: "Six",
  7: "Sept",
  8: "Huit",
  9: "Neuf",
  10: "Dix",
  11: "Valet",
  12: "Dame",
  13: "Roi",
  14: "As"
};
var SUIT_SYMBOLS = { s: "\u2660", h: "\u2665", d: "\u2666", c: "\u2663" };
function cardToDisplay(card) {
  return RANK_CHARS[card.rank].replace("T", "10") + SUIT_SYMBOLS[card.suit];
}
function sameCard(a, b) {
  return a.rank === b.rank && a.suit === b.suit;
}
function createDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}
var cryptoRng = () => {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
};
function shuffle(items, rng = cryptoRng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function shuffledDeck(rng = cryptoRng) {
  return shuffle(createDeck(), rng);
}

// supabase/functions/_shared/poker/evaluator.ts
var HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8
};
function encodeScore(category, tiebreak) {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 16 + (tiebreak[i] ?? 0);
  return score;
}
function straightHigh(mask) {
  const m = mask & 1 << 14 ? mask | 1 << 1 : mask;
  for (let high = 14; high >= 5; high--) {
    const need = 31 << high - 4;
    if ((m & need) === need) return high;
  }
  return 0;
}
function straightCards(cards, high) {
  const out = [];
  for (let r = high; r > high - 5; r--) {
    const wanted = r === 1 ? 14 : r;
    out.push(cards.find((c) => c.rank === wanted));
  }
  return out;
}
function sortDesc(cards) {
  return cards.slice().sort((a, b) => b.rank - a.rank);
}
function evaluateHand(cards) {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`L'\xE9valuateur attend 5 \xE0 7 cartes (re\xE7u ${cards.length})`);
  }
  const sorted = sortDesc(cards);
  const bySuit = /* @__PURE__ */ new Map();
  const byRank = /* @__PURE__ */ new Map();
  let mask = 0;
  for (const c of sorted) {
    (bySuit.get(c.suit) ?? bySuit.set(c.suit, []).get(c.suit)).push(c);
    (byRank.get(c.rank) ?? byRank.set(c.rank, []).get(c.rank)).push(c);
    mask |= 1 << c.rank;
  }
  let flushCards = null;
  for (const group of bySuit.values()) if (group.length >= 5) flushCards = group;
  if (flushCards) {
    let fmask = 0;
    for (const c of flushCards) fmask |= 1 << c.rank;
    const sfHigh = straightHigh(fmask);
    if (sfHigh) return make(HandCategory.StraightFlush, [sfHigh], straightCards(flushCards, sfHigh));
  }
  const groups = [...byRank.entries()].map(([rank, cs]) => ({ rank, cards: cs })).sort((a, b) => b.cards.length - a.cards.length || b.rank - a.rank);
  const kickers = (exclude, n) => sorted.filter((c) => !exclude.includes(c.rank)).slice(0, n);
  if (groups[0].cards.length === 4) {
    const q = groups[0];
    const k = kickers([q.rank], 1);
    return make(HandCategory.Quads, [q.rank, k[0].rank], [...q.cards, ...k]);
  }
  const trips = groups.filter((g) => g.cards.length === 3);
  const pairs = groups.filter((g) => g.cards.length === 2);
  if (trips.length >= 1 && (trips.length >= 2 || pairs.length >= 1)) {
    const t = trips[0];
    const candidates = [...trips.slice(1), ...pairs].sort((a, b) => b.rank - a.rank);
    const p = candidates[0];
    return make(HandCategory.FullHouse, [t.rank, p.rank], [...t.cards, ...p.cards.slice(0, 2)]);
  }
  if (flushCards) {
    const five2 = flushCards.slice(0, 5);
    return make(HandCategory.Flush, five2.map((c) => c.rank), five2);
  }
  const sHigh = straightHigh(mask);
  if (sHigh) return make(HandCategory.Straight, [sHigh], straightCards(sorted, sHigh));
  if (trips.length === 1) {
    const t = trips[0];
    const k = kickers([t.rank], 2);
    return make(HandCategory.Trips, [t.rank, ...k.map((c) => c.rank)], [...t.cards, ...k]);
  }
  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    const k = kickers([p1.rank, p2.rank], 1);
    return make(
      HandCategory.TwoPair,
      [p1.rank, p2.rank, k[0].rank],
      [...p1.cards, ...p2.cards, ...k]
    );
  }
  if (pairs.length === 1) {
    const p = pairs[0];
    const k = kickers([p.rank], 3);
    return make(HandCategory.Pair, [p.rank, ...k.map((c) => c.rank)], [...p.cards, ...k]);
  }
  const five = sorted.slice(0, 5);
  return make(HandCategory.HighCard, five.map((c) => c.rank), five);
}
function make(category, tiebreak, cards) {
  return {
    category,
    tiebreak,
    score: encodeScore(category, tiebreak),
    cards,
    description: describe(category, tiebreak)
  };
}
var PLURAL = { 11: "Valets", 12: "Dames", 13: "Rois" };
var name = (r) => RANK_NAMES_FR[r];
var plural = (r) => PLURAL[r] ?? name(r);
var startsWithVowel = (r) => r === 14 || r === 8;
var de = (r) => startsWithVowel(r) ? `d'${plural(r)}` : `de ${plural(r)}`;
var au = (r) => r === 14 ? "\xE0 l'As" : `au ${name(r)}`;
function describe(category, t) {
  switch (category) {
    case HandCategory.StraightFlush:
      return t[0] === 14 ? "Quinte flush royale" : `Quinte flush ${au(t[0])}`;
    case HandCategory.Quads:
      return `Carr\xE9 ${de(t[0])}`;
    case HandCategory.FullHouse:
      return `Full : ${plural(t[0])} par les ${plural(t[1])}`;
    case HandCategory.Flush:
      return `Couleur ${au(t[0])}`;
    case HandCategory.Straight:
      return `Quinte ${au(t[0])}`;
    case HandCategory.Trips:
      return `Brelan ${de(t[0])}`;
    case HandCategory.TwoPair:
      return `Double paire : ${plural(t[0])} et ${plural(t[1])}`;
    case HandCategory.Pair:
      return `Paire ${de(t[0])}`;
    default:
      return `Carte haute : ${name(t[0])}`;
  }
}

// supabase/functions/_shared/poker/pots.ts
function computePots(contributions) {
  const levels = [
    ...new Set(contributions.filter((c) => !c.folded && c.totalBet > 0).map((c) => c.totalBet))
  ].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contributions) amount += Math.max(0, Math.min(c.totalBet, level) - prev);
    const eligible = contributions.filter((c) => !c.folded && c.totalBet >= level).map((c) => c.id);
    const last = pots[pots.length - 1];
    if (last && sameSet(last.eligible, eligible)) last.amount += amount;
    else if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  const leftover = contributions.reduce((s, c) => s + Math.max(0, c.totalBet - prev), 0);
  if (leftover > 0) {
    if (pots.length) pots[pots.length - 1].amount += leftover;
    else pots.push({ amount: leftover, eligible: contributions.filter((c) => !c.folded).map((c) => c.id) });
  }
  return pots;
}
function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}
function distributePots(pots, scores, orderFromButton2) {
  const winnings = {};
  const awards = [];
  pots.forEach((pot, potIndex) => {
    const contenders = pot.eligible.filter((id) => scores[id] !== void 0);
    if (contenders.length === 0) return;
    const best = Math.max(...contenders.map((id) => scores[id]));
    const winners = contenders.filter((id) => scores[id] === best).sort((a, b) => orderFromButton2.indexOf(a) - orderFromButton2.indexOf(b));
    const base = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - base * winners.length;
    const shares = {};
    for (const id of winners) {
      const share = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      shares[id] = share;
      winnings[id] = (winnings[id] ?? 0) + share;
    }
    awards.push({ potIndex, amount: pot.amount, winners, shares });
  });
  return { awards, winnings };
}

// supabase/functions/_shared/poker/game.ts
var PokerError = class extends Error {
};
var BLIND_MULTIPLIERS = [1, 1.5, 2, 3, 4, 6, 8, 10, 15, 20, 30, 40, 60, 80, 100];
function createGame(config, players) {
  if (players.length < 2 || players.length > 9) throw new PokerError("Il faut entre 2 et 9 joueurs.");
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new PokerError("Identifiants en double.");
  if (config.smallBlind <= 0 || config.bigBlind < config.smallBlind) throw new PokerError("Blindes invalides.");
  if (config.startingStack <= 0) throw new PokerError("Tapis de d\xE9part invalide.");
  return {
    config,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      stack: config.startingStack,
      bet: 0,
      totalBet: 0,
      holeCards: [],
      status: "active",
      hasActed: false
    })),
    phase: "waiting",
    handNumber: 0,
    buttonIndex: -1,
    sbIndex: -1,
    bbIndex: -1,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    street: "preflop",
    board: [],
    deck: [],
    toAct: null,
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    log: [],
    lastHand: null,
    winnerId: null
  };
}
var clone = (x) => structuredClone(x);
function nextIndex(s, from, pred) {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const i = ((from + k) % n + n) % n;
    if (pred(s.players[i])) return i;
  }
  return -1;
}
var inGame = (p) => p.status !== "out";
var inHand = (p) => p.status === "active" || p.status === "allin";
var canAct = (p) => p.status === "active";
function potTotal(s) {
  return s.players.reduce((sum, p) => sum + p.totalBet, 0);
}
function orderFromButton(s) {
  const n = s.players.length;
  const out = [];
  for (let k = 1; k <= n; k++) out.push(s.players[(s.buttonIndex + k) % n].id);
  return out;
}
function log(s, entry) {
  s.log.push({ street: s.street, ...entry });
}
function commit(p, amount) {
  const paid = Math.min(amount, p.stack);
  p.stack -= paid;
  p.bet += paid;
  p.totalBet += paid;
  if (p.stack === 0) p.status = "allin";
  return paid;
}
function blindsForHand(config, handNumber) {
  const every = config.blindIncreaseEveryHands;
  if (!every || every <= 0) return { sb: config.smallBlind, bb: config.bigBlind };
  const level = Math.min(Math.floor((handNumber - 1) / every), BLIND_MULTIPLIERS.length - 1);
  const m = BLIND_MULTIPLIERS[level];
  return { sb: Math.round(config.smallBlind * m), bb: Math.round(config.bigBlind * m) };
}
function startHand(state, rng = cryptoRng, options = {}) {
  if (state.phase === "betting") throw new PokerError("Une main est d\xE9j\xE0 en cours.");
  if (state.phase === "gameOver") throw new PokerError("La partie est termin\xE9e.");
  const s = clone(state);
  const alive = s.players.filter(inGame);
  if (alive.length < 2) throw new PokerError("Pas assez de joueurs pour une nouvelle main.");
  s.handNumber += 1;
  s.handStartStacks = Object.fromEntries(s.players.map((p) => [p.id, p.stack]));
  s.phase = "betting";
  s.street = "preflop";
  s.board = [];
  s.log = [];
  s.lastHand = null;
  if (options.deck) {
    const preset = options.deck;
    const rest = shuffledDeck(rng).filter((c) => !preset.some((x) => sameCard(x, c)));
    s.deck = [...rest, ...preset.slice().reverse()];
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
    if (p.status !== "out") p.status = "active";
  }
  if (options.button !== void 0) {
    if (!s.players[options.button] || !inGame(s.players[options.button])) throw new PokerError("Bouton invalide.");
    s.buttonIndex = options.button;
  } else if (s.buttonIndex < 0) {
    const aliveIdx = s.players.map((p, i) => inGame(p) ? i : -1).filter((i) => i >= 0);
    s.buttonIndex = aliveIdx[Math.floor(rng() * aliveIdx.length)];
  } else {
    s.buttonIndex = nextIndex(s, s.buttonIndex, inGame);
  }
  const headsUp = alive.length === 2;
  s.sbIndex = headsUp ? s.buttonIndex : nextIndex(s, s.buttonIndex, inGame);
  s.bbIndex = nextIndex(s, s.sbIndex, inGame);
  for (let round = 0; round < 2; round++) {
    let i = s.buttonIndex;
    for (let k = 0; k < alive.length; k++) {
      i = nextIndex(s, i, inGame);
      s.players[i].holeCards.push(s.deck.pop());
    }
  }
  const sbP = s.players[s.sbIndex];
  const bbP = s.players[s.bbIndex];
  const sbPaid = commit(sbP, sb);
  log(s, { kind: "blind", playerId: sbP.id, amount: sbPaid, text: `${sbP.name} paie la petite blinde (${sbPaid})` });
  const bbPaid = commit(bbP, bb);
  log(s, { kind: "blind", playerId: bbP.id, amount: bbPaid, text: `${bbP.name} paie la grosse blinde (${bbPaid})` });
  s.currentBet = Math.max(bb, sbPaid);
  s.lastRaiseSize = bb;
  s.toAct = null;
  const first = headsUp ? s.sbIndex : nextIndex(s, s.bbIndex, inGame);
  progress(s, first);
  return s;
}
function getLegalActions(state) {
  if (state.phase !== "betting" || state.toAct === null) return null;
  const p = state.players[state.toAct];
  const toCall = Math.max(0, state.currentBet - p.bet);
  const callAmount = Math.min(toCall, p.stack);
  const maxRaiseTo = p.bet + p.stack;
  const fullMin = state.currentBet === 0 ? state.bigBlind : state.currentBet + state.lastRaiseSize;
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
    pot: potTotal(state)
  };
}
function othersCanRespond(s, idx) {
  return s.players.some((p, i) => i !== idx && canAct(p));
}
function timeoutAction(state) {
  const legal = getLegalActions(state);
  return legal?.canCheck ? { type: "check" } : { type: "fold" };
}
function applyAction(state, playerId, action) {
  const legal = getLegalActions(state);
  if (!legal) throw new PokerError("Aucune action n'est attendue.");
  if (legal.playerId !== playerId) throw new PokerError("Ce n'est pas votre tour.");
  const s = clone(state);
  const idx = s.toAct;
  const p = s.players[idx];
  switch (action.type) {
    case "fold": {
      p.status = "folded";
      log(s, { kind: "fold", playerId, text: `${p.name} se couche` });
      break;
    }
    case "check": {
      if (!legal.canCheck) throw new PokerError("Impossible de checker : il y a une mise \xE0 suivre.");
      log(s, { kind: "check", playerId, text: `${p.name} checke` });
      break;
    }
    case "call": {
      if (!legal.canCall) throw new PokerError("Rien \xE0 suivre : utilisez check.");
      const paid = commit(p, legal.callAmount);
      const allin = p.status === "allin";
      log(s, {
        kind: "call",
        playerId,
        amount: paid,
        text: `${p.name} suit ${paid}${allin ? " (tapis)" : ""}`
      });
      break;
    }
    case "bet":
    case "raise":
    case "allin": {
      const target = action.type === "allin" ? legal.maxRaiseTo : Math.floor(action.amount);
      if (action.type === "allin" && (!legal.canRaise || target <= s.currentBet)) {
        if (legal.canCheck) throw new PokerError("Impossible de relancer ici : utilisez check.");
        const paid = commit(p, legal.callAmount);
        log(s, { kind: "call", playerId, amount: paid, text: `${p.name} suit ${paid} (tapis)` });
        break;
      }
      if (!legal.canRaise) throw new PokerError("Relance impossible : vous pouvez seulement suivre ou vous coucher.");
      if (!Number.isFinite(target)) throw new PokerError("Montant invalide.");
      if (target > legal.maxRaiseTo) throw new PokerError(`Montant sup\xE9rieur \xE0 votre tapis (max ${legal.maxRaiseTo}).`);
      if (target < legal.minRaiseTo) throw new PokerError(`Relance minimale : ${legal.minRaiseTo}.`);
      const raiseSize = target - s.currentBet;
      const wasBet = s.currentBet === 0;
      commit(p, target - p.bet);
      const isFull = raiseSize >= s.lastRaiseSize;
      if (isFull) {
        s.lastRaiseSize = raiseSize;
        for (const o of s.players) if (o !== p && canAct(o)) o.hasActed = false;
      }
      s.currentBet = target;
      const allin = p.status === "allin";
      const kind = allin ? "allin" : wasBet ? "bet" : "raise";
      const verb = wasBet ? `mise ${target}` : `relance \xE0 ${target}`;
      log(s, { kind, playerId, amount: target, text: `${p.name} ${verb}${allin ? " (tapis)" : ""}` });
      break;
    }
    default:
      throw new PokerError("Action inconnue.");
  }
  p.hasActed = true;
  progress(s, nextIndex(s, idx, () => true));
  return s;
}
function roundComplete(s) {
  const actors = s.players.filter(canAct);
  if (actors.length === 0) return true;
  if (actors.length === 1) {
    const a = actors[0];
    const maxOther = Math.max(0, ...s.players.filter((p) => p !== a && inHand(p)).map((p) => p.bet));
    if (a.bet >= s.currentBet || a.hasActed && a.bet >= maxOther) return true;
    return false;
  }
  return actors.every((p) => p.hasActed && p.bet === s.currentBet);
}
function progress(s, from) {
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
  nextStreet(s);
}
function dealBoard(s, count) {
  s.deck.pop();
  for (let i = 0; i < count; i++) s.board.push(s.deck.pop());
}
var NEXT = { preflop: "flop", flop: "turn", turn: "river", river: null };
var STREET_FR = { preflop: "Pr\xE9flop", flop: "Flop", turn: "Turn", river: "River" };
function nextStreet(s) {
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
  dealBoard(s, next === "flop" ? 3 : 1);
  log(s, {
    kind: "street",
    text: `${STREET_FR[next]} : ${s.board.map(cardToDisplay).join(" ")}`
  });
  if (s.players.filter(canAct).length <= 1) {
    nextStreet(s);
    return;
  }
  progress(s, nextIndex(s, s.buttonIndex, () => true));
}
function returnUncalled(s) {
  const sorted = s.players.slice().sort((a, b) => b.totalBet - a.totalBet);
  const [top, second] = sorted;
  const excess = top.totalBet - (second?.totalBet ?? 0);
  if (excess > 0) {
    top.totalBet -= excess;
    top.bet = Math.max(0, top.bet - excess);
    top.stack += excess;
    if (top.status === "allin") top.status = "active";
    log(s, { kind: "return", playerId: top.id, amount: excess, text: `${excess} rendus \xE0 ${top.name} (mise non suivie)` });
  }
}
function finishHand(s, toShowdown) {
  s.toAct = null;
  returnUncalled(s);
  const contenders = s.players.filter(inHand);
  const pots = computePots(s.players.map((p) => ({ id: p.id, totalBet: p.totalBet, folded: !inHand(p) })));
  let hands = [];
  let scores = {};
  const showdown = toShowdown && contenders.length > 1;
  if (showdown) {
    hands = contenders.map((p) => ({
      playerId: p.id,
      holeCards: p.holeCards,
      hand: evaluateHand([...p.holeCards, ...s.board])
    }));
    scores = Object.fromEntries(hands.map((h) => [h.playerId, h.hand.score]));
    for (const h of hands) {
      const p = s.players.find((x) => x.id === h.playerId);
      log(s, {
        kind: "showdown",
        playerId: p.id,
        text: `${p.name} montre ${h.holeCards.map(cardToDisplay).join(" ")} \u2014 ${h.hand.description}`
      });
    }
  } else {
    scores = Object.fromEntries(contenders.map((p) => [p.id, 0]));
  }
  const { awards, winnings } = distributePots(pots, scores, orderFromButton(s));
  for (const [id, amount] of Object.entries(winnings)) {
    const p = s.players.find((x) => x.id === id);
    p.stack += amount;
    const desc = showdown ? ` avec ${hands.find((h) => h.playerId === id).hand.description}` : "";
    log(s, { kind: "win", playerId: id, amount, text: `${p.name} remporte ${amount}${desc}` });
  }
  s.lastHand = { showdown, hands, pots, awards, winnings };
  for (const p of s.players) {
    p.bet = 0;
    p.totalBet = 0;
    if (p.status !== "out" && p.stack === 0) {
      p.status = "out";
      p.eliminatedAtHand = s.handNumber;
      log(s, { kind: "eliminated", playerId: p.id, text: `${p.name} est \xE9limin\xE9` });
    } else if (p.status === "allin") {
      p.status = "active";
    }
  }
  s.currentBet = 0;
  const alive = s.players.filter(inGame);
  if (alive.length <= 1) {
    s.phase = "gameOver";
    s.winnerId = alive[0]?.id ?? null;
  } else {
    s.phase = "handOver";
  }
}
function getPublicView(state, viewerId) {
  const s = clone(state);
  s.deck = [];
  const shown = /* @__PURE__ */ new Set([
    ...s.lastHand?.hands.map((h) => h.playerId) ?? [],
    ...s.lastHand?.shown?.map((h) => h.playerId) ?? []
  ]);
  for (const p of s.players) {
    if (p.id !== viewerId && !shown.has(p.id)) p.holeCards = [];
  }
  return s;
}
function showCards(state, playerId) {
  if (state.phase !== "handOver" && state.phase !== "gameOver") throw new PokerError("On ne peut montrer ses cartes qu\u2019\xE0 la fin de la main.");
  const lh = state.lastHand;
  const p = state.players.find((x) => x.id === playerId);
  if (!lh || !p || p.holeCards.length === 0) throw new PokerError("Aucune carte \xE0 montrer.");
  if (lh.hands.some((h) => h.playerId === playerId) || lh.shown?.some((h) => h.playerId === playerId)) return state;
  const s = clone(state);
  s.lastHand.shown = [...s.lastHand.shown ?? [], { playerId, holeCards: p.holeCards }];
  s.log.push({ street: s.street, kind: "show", playerId, text: `${p.name} montre ${p.holeCards.map(cardToDisplay).join(" ")}` });
  return s;
}

// supabase/functions/_shared/poker/bots.ts
var BOT_NAMES = [
  "Max",
  "In\xE8s",
  "Sam",
  "L\xE9a",
  "Hugo",
  "Nora",
  "Enzo",
  "Jade",
  "Tom",
  "Zo\xE9",
  "Malik",
  "Chlo\xE9",
  "Yanis",
  "Lina"
];
var BOT_AVATARS = ["\u{1F98A}", "\u{1F43C}", "\u{1F981}", "\u{1F42F}", "\u{1F438}", "\u{1F419}", "\u{1F989}", "\u{1F43A}", "\u{1F43B}", "\u{1F428}", "\u{1F988}", "\u{1F432}"];
var PERSONALITIES = {
  shark: {
    id: "shark",
    name: "Le Requin",
    description: "Serr\xE9 et agressif : peu de mains, mais jou\xE9es fort. Bluffe au bon moment.",
    loose: 0,
    aggro: 0.75,
    bluff: 0.5,
    sticky: 0.35,
    trap: 0.3,
    tilt: 0.15,
    talk: 0.25,
    showBluff: 0.12,
    pace: 1,
    balanced: true
  },
  maniac: {
    id: "maniac",
    name: "La Kamikaze",
    description: "Joue presque tout, relance sans arr\xEAt, adore les tapis.",
    loose: 0.75,
    aggro: 0.95,
    bluff: 0.85,
    sticky: 0.5,
    trap: 0.05,
    tilt: 0.6,
    talk: 0.8,
    showBluff: 0.5,
    pace: 0.6
  },
  rock: {
    id: "rock",
    name: "Le Roc",
    description: "Ultra-prudent : attend les grosses mains et ne bluffe presque jamais.",
    loose: -0.65,
    aggro: 0.45,
    bluff: 0.08,
    sticky: 0.2,
    trap: 0.45,
    tilt: 0.1,
    talk: 0.15,
    showBluff: 0.02,
    pace: 1.15
  },
  station: {
    id: "station",
    name: "Le Curieux",
    description: "Veut toujours voir les cartes : paie beaucoup, mise peu.",
    loose: 0.5,
    aggro: 0.15,
    bluff: 0.08,
    sticky: 0.9,
    trap: 0.1,
    tilt: 0.3,
    talk: 0.5,
    showBluff: 0.05,
    pace: 0.9
  },
  bluffer: {
    id: "bluffer",
    name: "Le Bluffeur",
    description: "Raconte des histoires : mises sur les cartes qui font peur, gros bluffs \xE0 la river.",
    loose: 0.3,
    aggro: 0.75,
    bluff: 1,
    sticky: 0.3,
    trap: 0.15,
    tilt: 0.4,
    talk: 0.7,
    showBluff: 0.6,
    pace: 1
  },
  grinder: {
    id: "grinder",
    name: "Le Matheux",
    description: "Calcule tout, joue \xE9quilibr\xE9, ne s\u2019\xE9nerve jamais.",
    loose: -0.1,
    aggro: 0.55,
    bluff: 0.4,
    sticky: 0.4,
    trap: 0.25,
    tilt: 0,
    talk: 0.1,
    showBluff: 0.05,
    pace: 1.25,
    balanced: true
  }
};
var PERSONALITY_IDS = Object.keys(PERSONALITIES);
function defaultPersonality(d) {
  return d === "easy" ? "station" : d === "medium" ? "shark" : "grinder";
}
function randomPersonalities(n, rng = Math.random) {
  const out = [];
  while (out.length < n) out.push(...shuffle(PERSONALITY_IDS, rng));
  return out.slice(0, n);
}
function playStyle(s) {
  if (!s || s.aggressive + s.passive < 8) return "unknown";
  const af = s.aggressive / Math.max(1, s.passive);
  if (af >= 0.9) return "aggressive";
  if (af <= 0.4) return "passive";
  return "unknown";
}
function foldToBetRate(s) {
  if (!s || (s.faced ?? 0) < 6) return null;
  return (s.foldsToBet ?? 0) / (s.faced ?? 1);
}
function vpipRate(s) {
  if (!s || s.hands < 8) return null;
  return s.vpip / s.hands;
}
function updateOpponentStats(stats, state) {
  const out = structuredClone(stats);
  const dealt = state.players.filter((p) => p.holeCards.length > 0 || p.status !== "out");
  const vpipThisHand = /* @__PURE__ */ new Set();
  for (const p of dealt) {
    out[p.id] ??= { hands: 0, vpip: 0, aggressive: 0, passive: 0 };
    out[p.id].hands++;
  }
  let betOnStreet = false;
  let street = "";
  for (const e of state.log) {
    if (e.street !== street) {
      street = e.street;
      betOnStreet = false;
    }
    if (e.kind === "street") {
      betOnStreet = false;
      continue;
    }
    if (!e.playerId || !out[e.playerId]) continue;
    const st = out[e.playerId];
    if (e.street !== "preflop" && betOnStreet && (e.kind === "fold" || e.kind === "call" || e.kind === "raise" || e.kind === "allin")) {
      st.faced = (st.faced ?? 0) + 1;
      if (e.kind === "fold") st.foldsToBet = (st.foldsToBet ?? 0) + 1;
    }
    if (e.kind === "bet" || e.kind === "raise" || e.kind === "allin") {
      st.aggressive++;
      betOnStreet = true;
    }
    if (e.kind === "call" || e.kind === "check") st.passive++;
    if (e.street === "preflop" && (e.kind === "call" || e.kind === "raise" || e.kind === "allin" || e.kind === "bet")) {
      vpipThisHand.add(e.playerId);
    }
  }
  for (const id of vpipThisHand) out[id].vpip++;
  return out;
}
function chenScore(hole) {
  const [a, b] = hole[0].rank >= hole[1].rank ? hole : [hole[1], hole[0]];
  const base = (r) => r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2;
  let score = base(a.rank);
  if (a.rank === b.rank) return Math.max(5, score * 2);
  if (a.suit === b.suit) score += 2;
  const gap = a.rank - b.rank - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && a.rank < 12) score += 1;
  return Math.ceil(score);
}
function estimateEquity(hole, board, opponents, iterations = 1e3, rng = Math.random) {
  if (opponents <= 0) return 1;
  const known = [...hole, ...board];
  const deck = createDeck().filter((c) => !known.some((k) => sameCard(k, c)));
  const need = 5 - board.length;
  const draw = need + opponents * 2;
  let total = 0;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < draw; i++) {
      const j = i + Math.floor(rng() * (deck.length - i));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    const fullBoard = need ? board.concat(deck.slice(0, need)) : board;
    const mine = evaluateHand(hole.concat(fullBoard)).score;
    let best = true;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      const k = need + o * 2;
      const theirs = evaluateHand([deck[k], deck[k + 1], ...fullBoard]).score;
      if (theirs > mine) {
        best = false;
        break;
      }
      if (theirs === mine) ties++;
    }
    if (best) total += 1 / (ties + 1);
  }
  return total / iterations;
}
function detectDraws(hole, board) {
  if (board.length < 3 || board.length >= 5) return { flush: false, openEnded: false, gutshot: false };
  const all = [...hole, ...board];
  let flush = false;
  for (const suit of ["s", "h", "d", "c"]) {
    const n = all.filter((c) => c.suit === suit).length;
    if (n === 4 && hole.some((c) => c.suit === suit)) flush = true;
  }
  const ranks = new Set(all.map((c) => c.rank));
  if (ranks.has(14)) ranks.add(1);
  const holeRanks = new Set(hole.flatMap((c) => c.rank === 14 ? [14, 1] : [c.rank]));
  let openEnded = false;
  let gutshot = false;
  for (let low = 1; low <= 10; low++) {
    const window = [low, low + 1, low + 2, low + 3, low + 4];
    const present = window.filter((r) => ranks.has(r));
    if (present.length !== 4 || !present.some((r) => holeRanks.has(r))) continue;
    const missing = window.find((r) => !ranks.has(r));
    if ((missing === low || missing === low + 4) && low > 1 && low + 4 < 14) openEnded = true;
    else gutshot = true;
  }
  return { flush, openEnded, gutshot: gutshot && !openEnded };
}
function scaryBoard(board) {
  if (board.length < 3) return { scary: false, scareCard: false };
  const suitCounts = {};
  for (const c of board) suitCounts[c.suit] = (suitCounts[c.suit] ?? 0) + 1;
  const flushy = Object.values(suitCounts).some((n) => n >= 3);
  const ranks = [...new Set(board.map((c) => c.rank))].sort((a, b) => a - b);
  let straighty = false;
  for (let i = 0; i + 2 < ranks.length; i++) if (ranks[i + 2] - ranks[i] <= 4) straighty = true;
  const last = board[board.length - 1];
  const prev = board.slice(0, -1);
  const overcard = board.length > 3 && last.rank >= 13 && prev.every((c) => c.rank < last.rank);
  const completesFlush = board.length > 3 && suitCounts[last.suit] === 3;
  return { scary: flushy || straighty, scareCard: overcard || completesFlush };
}
var SKILL = {
  easy: { iterations: 120, noise: 0.16, extraSticky: 0.3, positional: 0.25, reads: false, blunder: 0.1, rangeAware: 0, cheapCalls: 1.25 },
  medium: { iterations: 350, noise: 0.05, extraSticky: 0.08, positional: 1, reads: true, blunder: 0.02, rangeAware: 0.7, cheapCalls: 1 },
  hard: { iterations: 1e3, noise: 0, extraSticky: 0, positional: 1, reads: true, blunder: 0, rangeAware: 1, cheapCalls: 0.85 }
};
var clamp01 = (x) => Math.min(1, Math.max(0, x));
var isAggro = (e) => e.kind === "bet" || e.kind === "raise" || e.kind === "allin";
function buildCtx(state, botId, rng, stats, skill, base, tilt) {
  const view = getPublicView(state, botId);
  const legal = getLegalActions(view);
  if (!legal || legal.playerId !== botId) return null;
  const me = view.players.find((p2) => p2.id === botId);
  const inHand2 = view.players.filter((p2) => p2.status === "active" || p2.status === "allin");
  const n = view.players.length;
  const order = [];
  for (let k = 1; k <= n; k++) {
    const p2 = view.players[(view.buttonIndex + k) % n];
    if (p2.status === "active" || p2.status === "allin") order.push(p2.id);
  }
  const rawPos = order.length > 1 ? order.indexOf(botId) / (order.length - 1) : 1;
  const position = 0.5 + (rawPos - 0.5) * skill.positional;
  const biggestOther = Math.max(0, ...inHand2.filter((p2) => p2.id !== botId).map((p2) => p2.stack + p2.bet));
  const eff = Math.min(me.stack + me.bet, biggestOther);
  const streetLog = view.log.filter((e) => e.street === view.street && e.playerId);
  const lastAgg = [...streetLog].reverse().find(isAggro);
  const preLog = view.log.filter((e) => e.street === "preflop");
  const preAgg = [...preLog].reverse().find(isAggro);
  const firstRaise = preLog.findIndex(isAggro);
  const limpers = preLog.filter((e, i) => e.kind === "call" && (firstRaise < 0 || i < firstRaise)).length;
  const othersActive = inHand2.filter((p2) => p2.id !== botId && p2.status === "active");
  const checkedToMe = view.street !== "preflop" && legal.canCheck && othersActive.length > 0 && othersActive.every((p2) => streetLog.some((e) => e.playerId === p2.id && e.kind === "check"));
  const p = {
    ...base,
    loose: base.loose + tilt * 0.6,
    aggro: clamp01(base.aggro + tilt * 0.3),
    bluff: clamp01(base.bluff + tilt * 0.35),
    sticky: clamp01(base.sticky + tilt * 0.25 + skill.extraSticky),
    trap: base.trap * (1 - tilt)
  };
  return {
    view,
    legal,
    me,
    hole: me.holeCards,
    opponents: inHand2.length - 1,
    position,
    bb: view.bigBlind,
    pot: legal.pot,
    toCall: legal.callAmount,
    potOdds: legal.callAmount / Math.max(1, legal.pot + legal.callAmount),
    effBB: eff / view.bigBlind,
    rng,
    stats,
    skill,
    p,
    tilt,
    aggressorId: lastAgg?.playerId ?? null,
    preflopRaiser: preAgg?.playerId ?? null,
    preflopRaises: preLog.filter((e) => e.kind === "raise" || e.kind === "allin").length,
    limpers,
    checkedToMe
  };
}
function raiseTo(c, to, kind) {
  const { legal } = c;
  if (!legal.canRaise) return passive(c);
  const amount = Math.round(Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, to)));
  if (amount >= legal.maxRaiseTo) return { action: { type: "allin" }, kind };
  return { action: { type: legal.isBet ? "bet" : "raise", amount }, kind };
}
function potBet(c, fraction, kind) {
  return raiseTo(c, c.legal.currentBet + (c.pot + c.toCall) * fraction, kind);
}
var passive = (c, kind) => c.legal.canCheck ? { action: { type: "check" }, kind: "check" } : { action: { type: "call" }, kind: kind ?? "call" };
var foldOrCheck = (c) => c.legal.canCheck ? { action: { type: "check" }, kind: "check" } : { action: { type: "fold" }, kind: "fold" };
var pick = (rng, items) => items[Math.floor(rng() * items.length)];
var chance = (c, p) => c.rng() < p;
var balancedBluff = (b) => b / (1 + 2 * b);
function preflop(c, huEq, eq) {
  const { p, rng, legal } = c;
  let hu = huEq;
  const [a, b] = c.hole;
  const suited = a.suit === b.suit;
  const gap = Math.abs(a.rank - b.rank);
  if (suited) hu += 0.025;
  if (gap === 1 && Math.min(a.rank, b.rank) >= 4) hu += 0.02;
  if (c.effBB <= 12) {
    const facing = c.preflopRaises > 0;
    if (!facing) {
      const need = 0.6 - p.loose * 0.05 - c.position * 0.06;
      if (hu > need) return { action: { type: "allin" }, kind: hu > 0.65 ? "value" : "steal" };
      return foldOrCheck(c);
    }
    if (eq > c.potOdds + 0.02 - p.sticky * 0.04) return { action: legal.canRaise && hu > 0.66 ? { type: "allin" } : { type: "call" }, kind: "call", tough: true };
    return foldOrCheck(c);
  }
  const facingRaise = c.preflopRaises > 0;
  const bbSize = (to) => to / c.bb;
  const price = c.toCall / Math.max(1, c.me.stack + c.me.bet);
  const cheap = clamp01(1 - price / 0.1);
  const already = c.view.players.filter((x) => x.id !== c.me.id && x.status === "active" && x.bet > 0).length;
  const flopBonus = cheap * (0.06 + p.sticky * 0.025 + Math.min(already, 4) * 6e-3) * (1 + p.loose * 0.55) * c.skill.cheapCalls;
  if (!facingRaise) {
    const openNeed = 0.63 - c.position * 0.1 - p.loose * 0.08 + c.limpers * 0.01;
    const premium = hu >= 0.67;
    if (premium || hu > openNeed) {
      const raiseFreq = premium ? 0.9 : 0.25 + p.aggro * 0.7;
      if (chance(c, raiseFreq) || premium && !chance(c, p.trap * 0.4)) {
        const mult = p.id === "maniac" ? 3 + rng() * 1.5 : p.id === "rock" ? 3 : 2.3 + rng() * 0.9;
        return raiseTo(c, c.bb * (mult + c.limpers * 0.7), "value");
      }
      return passive(c);
    }
    if (c.position > 0.7 && c.limpers === 0 && chance(c, p.bluff * 0.45 + p.aggro * 0.15)) {
      return raiseTo(c, c.bb * (2.2 + rng() * 0.8), "steal");
    }
    if (legal.canCheck) return { action: { type: "check" }, kind: "check" };
    const limpNeed = openNeed - 0.035 - flopBonus * 0.85 - (c.toCall <= c.bb / 2 ? 0.035 + p.sticky * 0.03 : 0) - c.limpers * 0.01;
    if (hu > limpNeed) return { action: { type: "call" }, kind: "call" };
    return { action: { type: "fold" }, kind: "fold" };
  }
  const raiseBB = bbSize(legal.currentBet);
  const raiser = c.preflopRaiser;
  let looseRaiser = false;
  if (c.skill.reads && raiser) {
    const v = vpipRate(c.stats[raiser]);
    looseRaiser = v !== null && v > 0.4 || playStyle(c.stats[raiser]) === "aggressive";
  }
  const valueNeed = (c.preflopRaises >= 2 ? 0.76 : 0.69) - p.aggro * 0.03 - (looseRaiser ? 0.04 : 0);
  if (hu >= valueNeed) {
    if (c.preflopRaises >= 3 && hu < 0.8) return { action: { type: "call" }, kind: "call", tough: true };
    return raiseTo(c, legal.currentBet * (c.position > 0.6 ? 2.8 + rng() * 0.4 : 3.3 + rng() * 0.4), "value");
  }
  const bluffable = suited && (Math.max(a.rank, b.rank) === 14 || gap <= 1);
  if (c.preflopRaises === 1 && bluffable && c.effBB > 30 && chance(c, p.bluff * 0.14 * (0.5 + c.position))) {
    return raiseTo(c, legal.currentBet * 3.2, "bluff");
  }
  const callNeed = 0.6 + Math.min(raiseBB, 20) * 4e-3 + (c.preflopRaises - 1) * 0.06 - p.sticky * 0.07 - p.loose * 0.04 - c.position * 0.03 - (looseRaiser ? 0.03 : 0) - flopBonus - // déjà des jetons au pot (blinde ou « limp ») : on se couche moins facilement
  (c.me.bet > 0 ? 0.015 + Math.min(c.me.bet / Math.max(1, legal.currentBet), 1) * 0.03 : 0);
  const affordable = price < 0.12 || eq > c.potOdds * 0.8;
  if (hu >= callNeed && affordable) return { action: { type: "call" }, kind: "call", tough: hu - callNeed < 0.03 };
  return foldOrCheck(c);
}
function postflop(c, huEq, rawEq) {
  const { p, rng, legal, view } = c;
  const draws = detectDraws(c.hole, view.board);
  const strongDraw = draws.flush || draws.openEnded;
  const { scary, scareCard } = scaryBoard(view.board);
  const river = view.street === "river";
  const headsUp = c.opponents === 1;
  const multiFactor = headsUp ? 1 : c.opponents === 2 ? 0.5 : 0.25;
  const opps = view.players.filter((x) => x.id !== c.me.id && (x.status === "active" || x.status === "allin"));
  let foldRate = null;
  if (c.skill.reads) {
    const rates = opps.map((o) => foldToBetRate(c.stats[o.id])).filter((x) => x !== null);
    if (rates.length) foldRate = Math.min(...rates);
  }
  let eq = rawEq;
  let hu = huEq - 0.04 * Math.max(0, c.opponents - 1);
  if (c.toCall > 0) {
    const style = c.aggressorId ? playStyle(c.stats[c.aggressorId]) : "unknown";
    const betSize = c.toCall / Math.max(1, c.pot);
    const discount = c.skill.reads ? style === "passive" ? 0.18 : style === "aggressive" ? 0.04 : 0.1 : 0.1;
    const factor = 1 - c.skill.rangeAware * Math.min(0.35, discount * (0.5 + betSize));
    eq *= factor;
    hu *= factor;
  }
  const spr = c.me.stack / Math.max(1, c.pot);
  const monster = hu > 0.88;
  const strong = hu > 0.73;
  const medium = hu > 0.56;
  if (legal.canCheck) {
    if (monster) {
      if (!river && chance(c, p.trap * 0.8)) return { action: { type: "check" }, kind: "trap" };
      if (spr < 1.2) return { action: { type: "allin" }, kind: "value" };
      const size = p.id === "maniac" || p.id === "bluffer" ? pick(rng, [0.75, 1, 1.3]) : pick(rng, [0.6, 0.75, 1]);
      return potBet(c, size, "value");
    }
    if (strong) {
      if (chance(c, 0.5 + p.aggro * 0.45)) return potBet(c, pick(rng, [0.5, 0.66, 0.75]), "value");
      return { action: { type: "check" }, kind: "check" };
    }
    const thinValue = foldRate !== null && foldRate < 0.35 ? 0.4 : 0;
    if (medium && chance(c, p.aggro * 0.45 + thinValue)) return potBet(c, pick(rng, [0.33, 0.5]), "value");
    if (!river && strongDraw && chance(c, (0.2 + p.bluff * 0.45 + p.aggro * 0.15) * (headsUp ? 1 : 0.6))) {
      return potBet(c, pick(rng, [0.5, 0.66, 0.75]), "semibluff");
    }
    if (!river && draws.gutshot && chance(c, p.bluff * 0.25 * multiFactor)) return potBet(c, 0.5, "semibluff");
    if (!medium) {
      let bluffChance = 0;
      const wasRaiser = c.preflopRaiser === c.me.id;
      if (wasRaiser && view.street === "flop") bluffChance = Math.max(bluffChance, 0.25 + p.aggro * 0.4 + p.bluff * 0.15);
      if (scareCard) bluffChance = Math.max(bluffChance, p.bluff * 0.5);
      if (c.checkedToMe) bluffChance = Math.max(bluffChance, p.bluff * 0.45 + p.aggro * 0.1);
      if (river && scary) bluffChance = Math.max(bluffChance, p.bluff * 0.35);
      bluffChance *= multiFactor;
      bluffChance += c.tilt * 0.2;
      const size = p.id === "bluffer" || p.id === "maniac" ? pick(rng, [0.75, 1, 1.25]) : pick(rng, [0.33, 0.5, 0.66]);
      if (p.balanced) bluffChance = Math.min(bluffChance, balancedBluff(size) * 1.4);
      if (foldRate !== null) bluffChance *= foldRate > 0.6 ? 1.5 : foldRate < 0.35 ? 0.3 : 1;
      if (chance(c, bluffChance)) return potBet(c, size, "bluff");
    }
    return { action: { type: "check" }, kind: "check" };
  }
  const betRatio = c.toCall / Math.max(1, c.pot);
  const tough = betRatio > 0.45 && !strong;
  if (monster) {
    if (spr < 1.5) return { action: { type: "allin" }, kind: "value" };
    if (!river && chance(c, p.trap * 0.6)) return { action: { type: "call" }, kind: "trap", tough: true };
    if (chance(c, 0.4 + p.aggro * 0.5)) return raiseTo(c, legal.currentBet * (2.5 + rng() * 0.6), "value");
    return { action: { type: "call" }, kind: "call", tough: true };
  }
  if (strong) {
    if (chance(c, p.aggro * (river ? 0.15 : 0.3))) return raiseTo(c, legal.currentBet * (2.4 + rng() * 0.5), "value");
    return { action: { type: "call" }, kind: "call" };
  }
  if (!river && strongDraw && headsUp && chance(c, p.bluff * 0.25)) {
    return raiseTo(c, legal.currentBet * 2.6, "semibluff");
  }
  const implied = !river && (strongDraw || draws.gutshot) && spr > 3 ? 0.06 : 0;
  let margin = -p.sticky * 0.1;
  if (c.skill.reads && c.aggressorId && playStyle(c.stats[c.aggressorId]) === "aggressive") margin -= 0.04;
  if (eq + implied > c.potOdds + margin + 0.02) {
    const heroCall = river && hu < 0.5 && betRatio > 0.5;
    return { action: { type: "call" }, kind: heroCall ? "herocall" : "call", tough };
  }
  if (!river && headsUp && c.effBB > 25 && chance(c, p.bluff * (p.id === "maniac" ? 0.12 : 0.06))) {
    return raiseTo(c, legal.currentBet * 2.7, "bluff");
  }
  if (view.street === "flop" && headsUp && c.position > 0.6 && betRatio < 0.55 && chance(c, p.bluff * 0.15)) {
    return { action: { type: "call" }, kind: "bluff" };
  }
  return { action: { type: "fold" }, kind: "fold", tough };
}
function humanThinkMs(choice, c, speed) {
  const r = c.rng();
  let ms;
  const a = choice.action.type;
  if (a === "check" && choice.kind === "check" || a === "fold" && !choice.tough) ms = 450 + r * 750;
  else if (choice.kind === "bluff" || choice.kind === "steal") ms = c.rng() < 0.45 ? 900 + r * 900 : 2400 + r * 2200;
  else if (choice.kind === "trap") ms = 2600 + r * 1800;
  else if (choice.tough || a === "allin") ms = 2600 + r * 3e3;
  else ms = 1e3 + r * 1500;
  ms *= c.p.pace * (1 - c.tilt * 0.4);
  return Math.round(speed === "fast" ? ms * 0.35 : ms);
}
var LINES = {
  allin: ["Tapis.", "Je pousse tout.", "All-in. \xC0 toi de voir.", "On va voir si t\u2019as du c\u0153ur."],
  raise: ["Je relance.", "\xC7a co\xFBte plus cher maintenant.", "On monte un peu.", "Tu suis ?"],
  herocall: ["Je te crois pas.", "Je paie pour voir.", "Montre-moi \xE7a.", "Hmm\u2026 ok, je suis."],
  foldBig: ["Bien jou\xE9.", "Je te laisse celle-l\xE0.", "Trop cher pour moi.", "Je passe\u2026 pour cette fois."],
  showBluff: ["Rien du tout \u{1F60F}", "Fallait payer !", "J\u2019avais rien, hein.", "Merci pour le pot."],
  showStrong: ["T\u2019as bien fait de te coucher.", "Bien vu."],
  winBig: ["Merci !", "Je prends.", "\xC7a fait plaisir.", "Belle main, non ?"],
  loseBig: ["S\xE9rieux ?!", "Quelle river\u2026", "Incroyable.", "\xC0 chaque fois\u2026", "Ok. Je respire."],
  tilted: ["Je vais me refaire.", "Plus jamais je me couche.", "Ce jeu est truqu\xE9 !"],
  maniac: ["Allez, on s\u2019amuse !", "Qui veut jouer ?", "Trop facile."],
  rock: ["Hm.", "J\u2019attendais celle-l\xE0."]
};
function maybeLine(rng, p, base, pool) {
  return rng() < p.talk * base ? pick(rng, pool) : void 0;
}
function talkFor(choice, c) {
  const { rng, p } = c;
  const a = choice.action.type;
  if (c.tilt > 0.5 && rng() < 0.25) return pick(rng, LINES.tilted);
  if (a === "allin") return maybeLine(rng, p, 0.7, p.id === "maniac" ? [...LINES.allin, ...LINES.maniac] : LINES.allin);
  if ((a === "raise" || a === "bet") && c.legal.currentBet > 0) return maybeLine(rng, p, 0.3, LINES.raise);
  if (choice.kind === "herocall") return maybeLine(rng, p, 0.6, LINES.herocall);
  if (a === "fold" && choice.tough) return maybeLine(rng, p, 0.35, LINES.foldBig);
  return void 0;
}
function decideBot(state, botId, difficulty, options = {}) {
  const rng = options.rng ?? cryptoRng;
  const skill = SKILL[difficulty];
  const personality = PERSONALITIES[options.personality ?? defaultPersonality(difficulty)];
  const tilt = clamp01(options.mood?.tilt ?? 0);
  const c = buildCtx(state, botId, rng, options.stats ?? {}, skill, personality, tilt);
  if (!c) throw new Error(`Ce n'est pas au bot ${botId} de jouer.`);
  let choice;
  if (rng() < skill.blunder) {
    choice = passive(c);
  } else {
    const err = skill.noise * (rng() * 2 - 1);
    const huEq = clamp01(estimateEquity(c.hole, c.view.board, 1, skill.iterations, rng) + err);
    const eq = c.opponents > 1 ? clamp01(estimateEquity(c.hole, c.view.board, c.opponents, Math.ceil(skill.iterations / 2), rng) + err) : huEq;
    choice = c.view.street === "preflop" ? preflop(c, huEq, eq) : postflop(c, huEq, eq);
  }
  const action = sanitize(c.legal, choice.action);
  const final = { ...choice, action };
  return {
    action,
    kind: final.kind,
    thinkMs: humanThinkMs(final, c, options.speed ?? "normal"),
    talk: talkFor(final, c)
  };
}
function sanitize(legal, a) {
  switch (a.type) {
    case "fold":
      return legal.canCheck ? { type: "check" } : a;
    // ne jamais se coucher gratuitement
    case "check":
      return legal.canCheck ? a : { type: "fold" };
    case "call":
      return legal.canCall ? a : { type: "check" };
    case "allin":
      if (legal.canRaise) return a;
      return legal.canCall ? { type: "call" } : { type: "check" };
    default: {
      if (!legal.canRaise) return legal.canCheck ? { type: "check" } : { type: "call" };
      const amount = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(a.amount)));
      return amount >= legal.maxRaiseTo ? { type: "allin" } : { type: a.type, amount };
    }
  }
}
function botHandEnd(state, botId, personalityId, mood, rng = Math.random) {
  const p = PERSONALITIES[personalityId];
  const me = state.players.find((x) => x.id === botId);
  let tilt = (mood?.tilt ?? 0) * 0.72;
  const lh = state.lastHand;
  if (!me || !lh) return { mood: { tilt }, show: false };
  const start = state.handStartStacks?.[botId] ?? me.stack;
  const net = me.stack - start;
  const bb = state.bigBlind;
  const bigLoss = net <= -Math.max(start * 0.3, bb * 15);
  const bigWin = net >= Math.max(start * 0.4, bb * 20);
  const shownHand = lh.hands.find((h) => h.playerId === botId);
  const badBeat = bigLoss && !!shownHand && shownHand.hand.category >= 2;
  if (bigLoss) tilt += (0.3 + (badBeat ? 0.25 : 0)) * (0.3 + p.tilt);
  if (bigWin) tilt *= 0.5;
  tilt = clamp01(tilt);
  let show = false;
  let talk;
  const wonWithoutShowdown = !lh.showdown && (lh.winnings[botId] ?? 0) > 0;
  if (wonWithoutShowdown && me.holeCards.length === 2) {
    const strength = state.board.length >= 3 ? estimateEquity(me.holeCards, state.board, 1, 200, rng) : chenScore(me.holeCards) / 20;
    const wasBluff = state.board.length >= 3 ? strength < 0.42 : strength < 0.3;
    if (wasBluff && rng() < p.showBluff + tilt * 0.2) {
      show = true;
      talk = rng() < 0.4 + p.talk * 0.6 ? pick(rng, LINES.showBluff) : void 0;
    } else if (!wasBluff && strength > 0.85 && rng() < p.showBluff * 0.3) {
      show = true;
      talk = maybeLine(rng, p, 0.8, LINES.showStrong);
    }
  }
  if (!talk) {
    if (bigLoss) talk = maybeLine(rng, p, badBeat ? 0.9 : 0.5, tilt > 0.5 ? [...LINES.loseBig, ...LINES.tilted] : LINES.loseBig);
    else if (bigWin) talk = maybeLine(rng, p, 0.45, p.id === "rock" ? LINES.rock : LINES.winBig);
  }
  return { mood: { tilt }, show, talk };
}

// supabase/functions/_shared/poker/room.ts
var RoomError = class extends Error {
};
var DEFAULT_ROOM_SETTINGS = {
  startingStack: 1e3,
  smallBlind: 5,
  bigBlind: 10,
  maxSeats: 6,
  blindIncreaseEveryHands: 10,
  turnSeconds: 30,
  botSpeed: "normal"
};
var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
var HUMAN_AVATARS = ["\u{1F60E}", "\u{1F920}", "\u{1F9D0}", "\u{1F63C}", "\u{1F984}", "\u{1F47D}", "\u{1F916}", "\u{1F3A9}", "\u{1F435}"];
function generateRoomCode(rng = cryptoRng) {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return code;
}
function normalizeCode(code) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function cleanName(name2) {
  const n = name2.replace(/\s+/g, " ").trim().slice(0, 16);
  if (n.length < 2) throw new RoomError("Choisis un pseudo d\u2019au moins 2 caract\xE8res.");
  return n;
}
var clone2 = (x) => structuredClone(x);
function findPlayer(room, id) {
  return room.players.find((p) => p.id === id);
}
function requireHost(room, by) {
  if (room.hostId !== by) throw new RoomError("Seul l'h\xF4te peut faire \xE7a.");
}
function requireLobby(room) {
  if (room.status !== "lobby") throw new RoomError("La partie a d\xE9j\xE0 commenc\xE9.");
}
function pickAvatar(room, list, rng) {
  const used = new Set(room.players.map((p) => p.avatar));
  const free = list.filter((a) => !used.has(a));
  const pool = free.length ? free : list;
  return pool[Math.floor(rng() * pool.length)];
}
function createRoom(code, host, rng = cryptoRng) {
  const room = {
    code,
    hostId: host.id,
    status: "lobby",
    settings: { ...DEFAULT_ROOM_SETTINGS },
    players: [],
    banned: [],
    game: null,
    deadline: null,
    deadlineKind: null,
    stats: {},
    moods: {},
    pendingBot: null,
    talk: {}
  };
  room.players.push({ id: host.id, name: cleanName(host.name), isBot: false, avatar: pickAvatar(room, HUMAN_AVATARS, rng), away: false });
  return room;
}
function joinRoom(input, user, rng = cryptoRng) {
  const room = clone2(input);
  if (room.banned.includes(user.id)) throw new RoomError("L'h\xF4te t'a exclu de cette partie.");
  const name2 = cleanName(user.name);
  const existing = findPlayer(room, user.id);
  if (existing) {
    existing.away = false;
    if (room.status === "lobby") existing.name = name2;
    return { room };
  }
  if (room.status === "lobby") {
    if (room.players.some((p) => p.name.toLowerCase() === name2.toLowerCase())) {
      throw new RoomError("Ce pseudo est d\xE9j\xE0 pris dans cette salle.");
    }
    if (room.players.length >= room.settings.maxSeats) throw new RoomError("La table est compl\xE8te.");
    room.players.push({ id: user.id, name: name2, isBot: false, avatar: pickAvatar(room, HUMAN_AVATARS, rng), away: false });
    return { room };
  }
  const seat = room.players.find((p) => !p.isBot && !p.kicked && p.away && p.name.toLowerCase() === name2.toLowerCase());
  if (!seat) throw new RoomError("La partie a d\xE9j\xE0 commenc\xE9. Utilise le m\xEAme pseudo pour reprendre ta place.");
  const oldId = seat.id;
  replacePlayerId(room, oldId, user.id);
  findPlayer(room, user.id).away = false;
  return { room, replacedId: oldId };
}
function replacePlayerId(room, oldId, newId) {
  for (const p of room.players) if (p.id === oldId) p.id = newId;
  if (room.hostId === oldId) room.hostId = newId;
  if (room.game) {
    for (const p of room.game.players) if (p.id === oldId) p.id = newId;
    for (const e of room.game.log) if (e.playerId === oldId) e.playerId = newId;
    if (room.game.winnerId === oldId) room.game.winnerId = newId;
    room.game.lastHand = null;
  }
  if (room.stats[oldId]) {
    room.stats[newId] = room.stats[oldId];
    delete room.stats[oldId];
  }
}
function leaveRoom(input, userId) {
  const room = clone2(input);
  const p = findPlayer(room, userId);
  if (!p) return room;
  if (room.status === "lobby") {
    room.players = room.players.filter((x) => x.id !== userId);
    if (room.hostId === userId) {
      const nextHost = room.players.find((x) => !x.isBot);
      room.hostId = nextHost?.id ?? "";
    }
  } else {
    p.away = true;
    if (room.hostId === userId) {
      const nextHost = room.players.find((x) => !x.isBot && !x.away && !x.kicked);
      if (nextHost) room.hostId = nextHost.id;
    }
  }
  return room;
}
function kickPlayer(input, by, targetId) {
  requireHost(input, by);
  if (targetId === by) throw new RoomError("Tu ne peux pas t\u2019exclure toi-m\xEAme.");
  const room = clone2(input);
  const p = findPlayer(room, targetId);
  if (!p) throw new RoomError("Joueur introuvable.");
  if (!p.isBot) room.banned.push(targetId);
  if (room.status === "lobby") {
    room.players = room.players.filter((x) => x.id !== targetId);
  } else {
    p.kicked = true;
    p.away = true;
  }
  return room;
}
function updateSettings(input, by, patch) {
  requireHost(input, by);
  requireLobby(input);
  const room = clone2(input);
  const s = { ...room.settings, ...patch };
  const int = (v, min, max, label) => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new RoomError(`${label} invalide.`);
  };
  int(s.startingStack, 20, 1e6, "Tapis de d\xE9part");
  int(s.smallBlind, 1, 1e5, "Petite blinde");
  int(s.bigBlind, s.smallBlind, 2e5, "Grosse blinde");
  int(s.maxSeats, Math.max(2, room.players.length), 9, "Nombre de places");
  int(s.turnSeconds, 10, 120, "Temps de d\xE9cision");
  if (s.blindIncreaseEveryHands !== null) int(s.blindIncreaseEveryHands, 2, 100, "Augmentation des blindes");
  if (s.botSpeed !== "fast" && s.botSpeed !== "normal") throw new RoomError("Vitesse invalide.");
  if (s.startingStack < s.bigBlind * 2) throw new RoomError("Le tapis doit valoir au moins 2 grosses blindes.");
  room.settings = s;
  return room;
}
function addBot(input, by, difficulty, rng = cryptoRng, personality) {
  requireHost(input, by);
  requireLobby(input);
  if (!["easy", "medium", "hard"].includes(difficulty)) throw new RoomError("Difficult\xE9 invalide.");
  const room = clone2(input);
  if (room.players.length >= room.settings.maxSeats) throw new RoomError("La table est compl\xE8te.");
  const used = new Set(room.players.map((p) => p.name.toLowerCase()));
  const name2 = BOT_NAMES.find((n2) => !used.has(n2.toLowerCase())) ?? `Bot ${room.players.length + 1}`;
  let n = 1;
  while (room.players.some((p) => p.id === `bot-${n}`)) n++;
  if (personality !== void 0 && !PERSONALITY_IDS.includes(personality)) throw new RoomError("Style de bot invalide.");
  const taken = new Set(room.players.map((p) => p.personality));
  const style = personality ?? randomPersonalities(PERSONALITY_IDS.length, rng).find((x) => !taken.has(x)) ?? defaultPersonality(difficulty);
  room.players.push({ id: `bot-${n}`, name: name2, isBot: true, difficulty, personality: style, avatar: pickAvatar(room, BOT_AVATARS, rng), away: false });
  return room;
}
function removeBot(input, by, botId) {
  requireHost(input, by);
  requireLobby(input);
  const room = clone2(input);
  if (!findPlayer(room, botId)?.isBot) throw new RoomError("Bot introuvable.");
  room.players = room.players.filter((p) => p.id !== botId);
  return room;
}
function startRoomGame(input, by, now, rng = cryptoRng) {
  requireHost(input, by);
  requireLobby(input);
  if (input.players.length < 2) throw new RoomError("Il faut au moins 2 joueurs (ajoute un bot !).");
  const room = clone2(input);
  const s = room.settings;
  room.game = startHand(
    createGame(
      { startingStack: s.startingStack, smallBlind: s.smallBlind, bigBlind: s.bigBlind, blindIncreaseEveryHands: s.blindIncreaseEveryHands },
      room.players.map((p) => ({ id: p.id, name: p.name }))
    ),
    rng
  );
  room.status = "playing";
  return schedule(room, now, rng);
}
function playerAction(input, playerId, action, now, rng = cryptoRng) {
  const room = clone2(input);
  if (room.status !== "playing" || !room.game) throw new RoomError("Aucune partie en cours.");
  const p = findPlayer(room, playerId);
  if (!p || p.isBot) throw new RoomError("Tu ne joues pas \xE0 cette table.");
  if (p.kicked) throw new RoomError("Tu as \xE9t\xE9 exclu de cette partie.");
  room.game = applyAction(room.game, playerId, action);
  p.away = false;
  return schedule(room, now, rng);
}
function setBack(input, playerId) {
  const room = clone2(input);
  const p = findPlayer(room, playerId);
  if (p && !p.kicked) p.away = false;
  return room;
}
function tick(input, now, rng = cryptoRng) {
  if (input.status !== "playing" || !input.game || input.deadline === null || now < input.deadline) {
    return { room: input, changed: false };
  }
  const room = clone2(input);
  const g = room.game;
  if (room.deadlineKind === "nextHand") {
    if (g.phase === "handOver") room.game = startHand(g, rng);
  } else {
    const legal = getLegalActions(g);
    if (legal) {
      const p = findPlayer(room, legal.playerId);
      if (p.isBot) {
        const pending = room.pendingBot;
        const fresh = pending && pending.playerId === p.id && pending.handNumber === g.handNumber && pending.logLength === g.log.length;
        const d = fresh ? pending : decideBot(g, p.id, p.difficulty ?? "medium", botOptions(room, p, rng));
        room.game = applyAction(g, p.id, d.action);
        if (d.talk) (room.talk ??= {})[p.id] = { text: d.talk, at: now };
      } else {
        room.game = applyAction(g, p.id, timeoutAction(g));
        p.away = true;
      }
    }
  }
  return { room: schedule(room, now, rng), changed: true };
}
function schedule(room, now, rng) {
  let g = room.game;
  let guard = 0;
  for (; ; ) {
    if (++guard > 500) throw new Error("Boucle de planification");
    if (g.phase === "betting") {
      const legal = getLegalActions(g);
      const p = findPlayer(room, legal.playerId);
      if (!p.isBot && p.away) {
        g = applyAction(g, p.id, timeoutAction(g));
        continue;
      }
      room.game = g;
      if (p.isBot) {
        const d = decideBot(g, p.id, p.difficulty ?? "medium", botOptions(room, p, rng));
        room.pendingBot = { playerId: p.id, handNumber: g.handNumber, logLength: g.log.length, action: d.action, talk: d.talk };
        room.deadlineKind = "bot";
        room.deadline = now + d.thinkMs;
      } else {
        room.pendingBot = null;
        room.deadlineKind = "turn";
        room.deadline = now + room.settings.turnSeconds * 1e3;
      }
      return room;
    }
    break;
  }
  room.pendingBot = null;
  if (g.phase === "handOver" || g.phase === "gameOver") {
    room.stats = updateOpponentStats(room.stats, g);
    room.moods ??= {};
    for (const p of room.players) {
      if (!p.isBot) continue;
      const gp = g.players.find((x) => x.id === p.id);
      if (!gp || gp.status === "out" && gp.eliminatedAtHand !== g.handNumber) continue;
      const end = botHandEnd(g, p.id, p.personality ?? defaultPersonality(p.difficulty ?? "medium"), room.moods[p.id], rng);
      room.moods[p.id] = end.mood;
      if (end.show) g = showCards(g, p.id);
      if (end.talk) (room.talk ??= {})[p.id] = { text: end.talk, at: now };
    }
  }
  room.game = g;
  if (g.phase === "handOver") {
    room.deadlineKind = "nextHand";
    room.deadline = now + (g.lastHand?.showdown ? 5e3 : 2500);
  } else if (g.phase === "gameOver") {
    room.status = "finished";
    room.deadline = null;
    room.deadlineKind = null;
  }
  return room;
}
function backToLobby(input, by) {
  requireHost(input, by);
  if (input.status !== "finished") throw new RoomError("La partie n'est pas termin\xE9e.");
  const room = clone2(input);
  room.status = "lobby";
  room.game = null;
  room.deadline = null;
  room.deadlineKind = null;
  room.players = room.players.filter((p) => !p.kicked);
  for (const p of room.players) p.away = false;
  return room;
}
function botOptions(room, p, rng) {
  return {
    rng,
    stats: room.stats,
    personality: p.personality ?? defaultPersonality(p.difficulty ?? "medium"),
    mood: room.moods?.[p.id],
    speed: room.settings.botSpeed
  };
}
function publicRoom(room) {
  const { banned: _b, stats: _s, moods: _m, pendingBot: _p, ...rest } = room;
  return { ...rest, game: room.game ? getPublicView(room.game, null) : null };
}
function privateHands(room) {
  if (!room.game) return [];
  const g = room.game;
  return g.players.filter((p) => !findPlayer(room, p.id)?.isBot && p.holeCards.length > 0).map((p) => ({ playerId: p.id, handNumber: g.handNumber, cards: p.holeCards }));
}

// supabase/functions/poker/handler.ts
var ok = (body) => ({ status: 200, body: { ok: true, ...body, serverNow: Date.now() } });
async function load(db2, code) {
  const roomId = await db2.findRoomId(normalizeCode(code));
  if (!roomId) throw new RoomError("Aucune partie avec ce code.");
  const s = await db2.getSecret(roomId);
  return { roomId, room: s.data, version: s.version };
}
async function persist(db2, roomId, before, after, version) {
  if (!await db2.casSecret(roomId, version, after)) return false;
  if (after.game && after.game.handNumber !== before.game?.handNumber) {
    const rows = privateHands(after).map((h) => ({ room_id: roomId, player_id: h.playerId, hand_number: h.handNumber, cards: h.cards }));
    if (rows.length) await db2.upsertHoleCards(rows);
  }
  await db2.updatePublic(roomId, publicRoom(after), version + 1, Date.now());
  return true;
}
async function mutate(db2, code, fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { roomId, room, version } = await load(db2, code);
    const res = fn(room);
    const next = "changed" in res ? res.room : res;
    if ("changed" in res && !res.changed) return { roomId, room };
    if (await persist(db2, roomId, room, next, version)) return { roomId, room: next };
  }
  throw new RoomError("Trop de joueurs agissent en m\xEAme temps, r\xE9essaie.");
}
async function handle(db2, uid, body) {
  try {
    const op = String(body.op ?? "");
    const now = () => Date.now();
    if (op === "create") {
      const room = createRoom("XXXXXX", { id: uid, name: String(body.name ?? "") });
      for (let i = 0; i < 8; i++) {
        const code2 = generateRoomCode();
        const roomId = await db2.insertRoom(code2);
        if (!roomId) continue;
        room.code = code2;
        await db2.insertState(roomId, code2, room, publicRoom(room), Date.now());
        await db2.upsertMember(roomId, uid, room.players[0].name);
        return ok({ code: code2, roomId });
      }
      throw new RoomError("Impossible de g\xE9n\xE9rer un code, r\xE9essaie.");
    }
    const code = normalizeCode(String(body.code ?? ""));
    if (code.length !== 6) throw new RoomError("Le code doit faire 6 caract\xE8res.");
    if (op === "join") {
      let replaced;
      const { roomId, room } = await mutate(db2, code, (r) => {
        const res2 = joinRoom(r, { id: uid, name: String(body.name ?? "") });
        replaced = res2.replacedId;
        return res2.room;
      });
      const me = room.players.find((p) => p.id === uid);
      await db2.upsertMember(roomId, uid, me.name);
      if (replaced) {
        await db2.deleteMember(roomId, replaced);
        await db2.deleteHoleCards(roomId, replaced);
      }
      const mine = privateHands(room).filter((h) => h.playerId === uid);
      if (mine.length) {
        await db2.upsertHoleCards(mine.map((h) => ({ room_id: roomId, player_id: uid, hand_number: h.handNumber, cards: h.cards })));
      }
      return ok({ code, roomId });
    }
    const member = (fn) => (r) => {
      if (!r.players.some((p) => p.id === uid)) throw new RoomError("Tu ne fais pas partie de cette salle.");
      return fn(r);
    };
    let res;
    switch (op) {
      case "tick":
        res = await mutate(db2, code, member((r) => tick(r, now())));
        break;
      case "action":
        res = await mutate(db2, code, member((r) => playerAction(r, uid, body.action, now())));
        break;
      case "back":
        res = await mutate(db2, code, member((r) => setBack(r, uid)));
        break;
      case "leave":
        res = await mutate(db2, code, member((r) => leaveRoom(r, uid)));
        if (res.room.status === "lobby") await db2.deleteMember(res.roomId, uid);
        break;
      case "settings":
        res = await mutate(db2, code, member((r) => updateSettings(r, uid, body.settings ?? {})));
        break;
      case "addBot":
        res = await mutate(db2, code, member(
          (r) => addBot(r, uid, body.difficulty, void 0, body.personality || void 0)
        ));
        break;
      case "removeBot":
        res = await mutate(db2, code, member((r) => removeBot(r, uid, String(body.botId))));
        break;
      case "kick": {
        const target = String(body.playerId);
        res = await mutate(db2, code, member((r) => kickPlayer(r, uid, target)));
        await db2.deleteMember(res.roomId, target);
        await db2.deleteHoleCards(res.roomId, target);
        break;
      }
      case "start":
        res = await mutate(db2, code, member((r) => startRoomGame(r, uid, now())));
        break;
      case "lobby":
        res = await mutate(db2, code, member((r) => backToLobby(r, uid)));
        break;
      default:
        throw new RoomError("Op\xE9ration inconnue.");
    }
    return ok({ code, roomId: res.roomId });
  } catch (e) {
    if (e instanceof RoomError || e instanceof PokerError) return { status: 400, body: { error: e.message } };
    console.error(e);
    return { status: 500, body: { error: "Erreur serveur." } };
  }
}

// supabase/functions/poker/index.ts
function secretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    return keys.default ?? Object.values(keys)[0] ?? "";
  } catch {
    return "";
  }
}
var admin = createClient(Deno.env.get("SUPABASE_URL"), secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false }
});
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
function check(res) {
  if (res.error) throw res.error;
  return res.data;
}
var iso = () => (/* @__PURE__ */ new Date()).toISOString();
var db = {
  async findRoomId(code) {
    const data = check(await admin.from("rooms").select("id").eq("code", code).maybeSingle());
    return data?.id ?? null;
  },
  async insertRoom(code) {
    const { data, error } = await admin.from("rooms").insert({ code }).select("id").single();
    if (error?.code === "23505") return null;
    if (error) throw error;
    return data.id;
  },
  async insertState(roomId, code, secret, pub, serverNow) {
    check(await admin.from("room_secrets").insert({ room_id: roomId, data: secret, version: 1 }));
    check(await admin.from("room_public").insert({ room_id: roomId, code, data: pub, version: 1, server_now: serverNow }));
  },
  async getSecret(roomId) {
    const data = check(await admin.from("room_secrets").select("data, version").eq("room_id", roomId).single());
    return data;
  },
  async casSecret(roomId, version, data) {
    const rows = check(
      await admin.from("room_secrets").update({ data, version: version + 1, updated_at: iso() }).eq("room_id", roomId).eq("version", version).select("version")
    );
    return Array.isArray(rows) && rows.length > 0;
  },
  async updatePublic(roomId, data, version, serverNow) {
    check(await admin.from("room_public").update({ data, version, server_now: serverNow, updated_at: iso() }).eq("room_id", roomId));
  },
  async upsertMember(roomId, userId, name2) {
    check(await admin.from("room_members").upsert({ room_id: roomId, user_id: userId, name: name2 }));
  },
  async deleteMember(roomId, userId) {
    check(await admin.from("room_members").delete().eq("room_id", roomId).eq("user_id", userId));
  },
  async upsertHoleCards(rows) {
    check(await admin.from("hole_cards").upsert(rows.map((r) => ({ ...r, updated_at: iso() }))));
  },
  async deleteHoleCards(roomId, playerId) {
    check(await admin.from("hole_cards").delete().eq("room_id", roomId).eq("player_id", playerId));
  }
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "M\xE9thode non autoris\xE9e." }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(jwt);
  const uid = auth?.user?.id;
  if (!uid) return json({ error: "Session invalide, recharge la page." }, 401);
  const body = await req.json().catch(() => ({}));
  const res = await handle(db, uid, body);
  return json(res.body, res.status);
});
