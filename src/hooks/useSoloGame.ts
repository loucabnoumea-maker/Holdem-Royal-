import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BotDifficulty,
  BotMoods,
  BotSpeed,
  GameState,
  OpponentStats,
  PersonalityId,
  PlayerAction,
} from '../lib/poker/index.ts';
import {
  applyAction,
  BOT_AVATARS,
  BOT_NAMES,
  botHandEnd,
  createGame,
  decideBot,
  getLegalActions,
  getPublicView,
  PERSONALITIES,
  PERSONALITY_IDS,
  randomPersonalities,
  showCards,
  shuffle,
  startHand,
  updateOpponentStats,
} from '../lib/poker/index.ts';
import type { SeatMeta } from '../components/Table.tsx';

export type StyleChoice = PersonalityId | 'random';

export interface SoloConfig {
  playerName: string;
  totalPlayers: number;
  globalDifficulty: BotDifficulty;
  /** Difficulté par bot ('global' = suit le réglage global). */
  perBot: (BotDifficulty | 'global')[];
  /** Style de chaque bot ('random' = personnalité tirée au hasard). */
  perBotStyle?: StyleChoice[];
  /** Afficher le style des bots à la table. */
  showStyles?: boolean;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  blindIncrease: boolean;
  blindEvery: number;
  speed: BotSpeed;
}

export const DEFAULT_SOLO: SoloConfig = {
  playerName: '',
  totalPlayers: 6,
  globalDifficulty: 'medium',
  perBot: [],
  perBotStyle: [],
  showStyles: true,
  startingStack: 1000,
  smallBlind: 5,
  bigBlind: 10,
  blindIncrease: true,
  blindEvery: 10,
  speed: 'normal',
};

export const HERO_ID = 'hero';

interface Bot {
  id: string;
  difficulty: BotDifficulty;
  personality: PersonalityId;
  avatar: string;
}

export interface Bubble {
  text: string;
  key: number;
}

export function useSoloGame(config: SoloConfig) {
  const bots = useMemo<Bot[]>(() => {
    const avatars = shuffle(BOT_AVATARS);
    const n = config.totalPlayers - 1;
    const chosen = config.perBotStyle ?? [];
    // Les styles « au hasard » évitent ceux déjà choisis, pour une table variée
    const fixed = new Set(chosen.slice(0, n).filter((x): x is PersonalityId => !!x && x !== 'random'));
    const pool = [...randomPersonalities(PERSONALITY_IDS.length, Math.random).filter((x) => !fixed.has(x)), ...randomPersonalities(n)];
    return Array.from({ length: n }, (_, i) => {
      const d = config.perBot[i];
      const st = chosen[i];
      return {
        id: `bot${i}`,
        difficulty: d && d !== 'global' ? d : config.globalDifficulty,
        personality: st && st !== 'random' ? st : pool.shift()!,
        avatar: avatars[i % avatars.length],
      };
    });
  }, [config]);

  const initial = useMemo(() => {
    const names = shuffle(BOT_NAMES);
    const g = createGame(
      {
        startingStack: config.startingStack,
        smallBlind: config.smallBlind,
        bigBlind: config.bigBlind,
        blindIncreaseEveryHands: config.blindIncrease ? config.blindEvery : null,
      },
      [{ id: HERO_ID, name: config.playerName || 'Moi' }, ...bots.map((b, i) => ({ id: b.id, name: names[i] }))],
    );
    return startHand(g);
  }, [config, bots]);

  const [state, setState] = useState<GameState>(initial);
  const [autoNext, setAutoNext] = useState(true);
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({});
  const statsRef = useRef<OpponentStats>({});
  const moodsRef = useRef<BotMoods>({});
  const handledHand = useRef(0);
  const bubbleKey = useRef(0);

  const say = useCallback((id: string, text: string | undefined) => {
    if (!text) return;
    const key = ++bubbleKey.current;
    setBubbles((b) => ({ ...b, [id]: { text, key } }));
    setTimeout(() => setBubbles((b) => (b[id]?.key === key ? (({ [id]: _gone, ...rest }) => rest)(b) : b)), 3400);
  }, []);

  const meta = useMemo(() => {
    const m: Record<string, SeatMeta> = { [HERO_ID]: {} };
    for (const b of bots) {
      m[b.id] = {
        avatar: b.avatar,
        isBot: true,
        difficulty: b.difficulty,
        style: config.showStyles === false ? undefined : PERSONALITIES[b.personality].name,
        styleHint: PERSONALITIES[b.personality].description,
        bubble: bubbles[b.id],
      };
    }
    return m;
  }, [bots, bubbles, config.showStyles]);

  const hero = state.players.find((p) => p.id === HERO_ID)!;
  const heroOut = hero.status === 'out';
  const legal = state.phase === 'betting' ? getLegalActions(state) : null;
  const heroLegal = legal && legal.playerId === HERO_ID ? legal : null;

  // Tour d'un bot : il décide tout de suite, puis « réfléchit » plus ou moins longtemps selon la décision
  useEffect(() => {
    const l = state.phase === 'betting' ? getLegalActions(state) : null;
    if (!l || l.playerId === HERO_ID) return;
    const bot = bots.find((b) => b.id === l.playerId);
    if (!bot) return;
    const d = decideBot(state, bot.id, bot.difficulty, {
      stats: statsRef.current,
      personality: bot.personality,
      mood: moodsRef.current[bot.id],
      speed: heroOut ? 'fast' : config.speed,
    });
    const hand = state.handNumber;
    const logLen = state.log.length;
    const t = setTimeout(() => {
      setState((s) => {
        const now = getLegalActions(s);
        if (!now || now.playerId !== bot.id || s.handNumber !== hand || s.log.length !== logLen) return s;
        return applyAction(s, bot.id, d.action);
      });
      if (!heroOut) say(bot.id, d.talk);
    }, heroOut ? Math.min(d.thinkMs, 500) : d.thinkMs);
    return () => clearTimeout(t);
  }, [state, bots, config.speed, heroOut, say]);

  // Fin de main : profils adverses, humeur des bots, bluffs montrés, phrases
  useEffect(() => {
    if (state.phase !== 'handOver' && state.phase !== 'gameOver') return;
    if (handledHand.current === state.handNumber) return;
    handledHand.current = state.handNumber;
    statsRef.current = updateOpponentStats(statsRef.current, state);
    const toShow: string[] = [];
    for (const b of bots) {
      const p = state.players.find((x) => x.id === b.id)!;
      if (p.status === 'out' && p.eliminatedAtHand !== state.handNumber) continue;
      const end = botHandEnd(state, b.id, b.personality, moodsRef.current[b.id]);
      moodsRef.current[b.id] = end.mood;
      if (end.show) toShow.push(b.id);
      if (!heroOut) setTimeout(() => say(b.id, end.talk), 500);
    }
    if (toShow.length && !heroOut) {
      setTimeout(() => {
        setState((s) => {
          if (s.handNumber !== state.handNumber || (s.phase !== 'handOver' && s.phase !== 'gameOver')) return s;
          return toShow.reduce((acc, id) => showCards(acc, id), s);
        });
      }, 650);
    }
  }, [state, bots, heroOut, say]);

  // Main suivante automatique
  const handNo = state.handNumber;
  const phase = state.phase;
  const wasShowdown = !!state.lastHand?.showdown;
  const anyShown = !!state.lastHand?.shown?.length;
  const heroWonQuiet = !state.lastHand?.showdown && (state.lastHand?.winnings[HERO_ID] ?? 0) > 0;
  useEffect(() => {
    if (phase !== 'handOver' || !autoNext) return;
    const wait = heroOut ? 700 : wasShowdown ? 4200 : anyShown || heroWonQuiet ? 3600 : 2000;
    const t = setTimeout(() => setState((s) => (s.phase === 'handOver' && s.handNumber === handNo ? startHand(s) : s)), wait);
    return () => clearTimeout(t);
  }, [phase, handNo, autoNext, heroOut, wasShowdown, anyShown, heroWonQuiet]);

  const act = useCallback((a: PlayerAction) => {
    setState((s) => {
      const l = getLegalActions(s);
      if (!l || l.playerId !== HERO_ID) return s;
      try {
        return applyAction(s, HERO_ID, a);
      } catch (e) {
        console.warn(e);
        return s;
      }
    });
  }, []);

  const nextHand = useCallback(() => {
    setState((s) => (s.phase === 'handOver' ? startHand(s) : s));
  }, []);

  /** Montrer ses cartes après avoir gagné sans abattage. */
  const showMine = useCallback(() => {
    setState((s) => {
      try {
        return showCards(s, HERO_ID);
      } catch {
        return s;
      }
    });
  }, []);

  const lh = state.lastHand;
  const canShow =
    state.phase !== 'betting' &&
    !!lh &&
    !lh.showdown &&
    (lh.winnings[HERO_ID] ?? 0) > 0 &&
    !lh.shown?.some((x) => x.playerId === HERO_ID);

  // Classement du joueur s'il est éliminé
  const place = heroOut
    ? 1 + state.players.filter((p) => p.status !== 'out' || (p.eliminatedAtHand ?? 0) > (hero.eliminatedAtHand ?? 0)).length
    : null;

  return {
    view: getPublicView(state, HERO_ID),
    state,
    meta,
    heroLegal,
    act,
    nextHand,
    autoNext,
    setAutoNext,
    heroOut,
    place,
    canShow,
    showMine,
    bots,
  };
}
