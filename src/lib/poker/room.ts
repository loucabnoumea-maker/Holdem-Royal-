// Logique d'une salle multijoueur — PURE et testable.
// Exécutée uniquement côté serveur (Supabase Edge Function) : le client ne reçoit
// que publicRoom() (sans paquet ni cartes privées) et SES cartes via la table protégée par RLS.
import type { Rng } from './cards.ts';
import { cryptoRng } from './cards.ts';
import type { BotDifficulty, BotMoods, BotSpeed, OpponentStats, PersonalityId } from './bots.ts';
import {
  BOT_AVATARS,
  BOT_NAMES,
  botHandEnd,
  decideBot,
  defaultPersonality,
  PERSONALITY_IDS,
  randomPersonalities,
  updateOpponentStats,
} from './bots.ts';
import type { GameState, PlayerAction } from './game.ts';
import { applyAction, createGame, getLegalActions, getPublicView, showCards, startHand, timeoutAction } from './game.ts';

export interface RoomSettings {
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  /** Augmentation des blindes toutes les X mains (null = jamais). */
  blindIncreaseEveryHands: number | null;
  /** Temps de décision, en secondes. */
  turnSeconds: number;
  botSpeed: BotSpeed;
}

export interface RoomPlayer {
  id: string;
  name: string;
  isBot: boolean;
  difficulty?: BotDifficulty;
  /** Style de jeu du bot (Requin, Bluffeur…). */
  personality?: PersonalityId;
  avatar: string;
  /** Absent : ses actions sont jouées automatiquement (check sinon fold). */
  away: boolean;
  kicked?: boolean;
}

export type DeadlineKind = 'turn' | 'bot' | 'nextHand';

export interface Room {
  code: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  settings: RoomSettings;
  players: RoomPlayer[];
  /** Ids exclus définitivement de la salle. */
  banned: string[];
  game: GameState | null;
  deadline: number | null;
  deadlineKind: DeadlineKind | null;
  stats: OpponentStats;
  /** Humeur (tilt) de chaque bot — secret. */
  moods?: BotMoods;
  /** Décision du bot déjà prise, jouée à l'échéance (le temps de réflexion dépend de la décision) — secret. */
  pendingBot?: { playerId: string; handNumber: number; logLength: number; action: PlayerAction; talk?: string } | null;
  /** Dernière petite phrase de chaque joueur (bulle), horodatée. */
  talk?: Record<string, { text: string; at: number }>;
}

export class RoomError extends Error {}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  startingStack: 1000,
  smallBlind: 5,
  bigBlind: 10,
  maxSeats: 6,
  blindIncreaseEveryHands: 10,
  turnSeconds: 30,
  botSpeed: 'normal',
};

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const HUMAN_AVATARS = ['😎', '🤠', '🧐', '😼', '🦄', '👽', '🤖', '🎩', '🐵'];

export function generateRoomCode(rng: Rng = cryptoRng): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return code;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function cleanName(name: string): string {
  const n = name.replace(/\s+/g, ' ').trim().slice(0, 16);
  if (n.length < 2) throw new RoomError('Choisis un pseudo d’au moins 2 caractères.');
  return n;
}

const clone = <T>(x: T): T => structuredClone(x);

function findPlayer(room: Room, id: string) {
  return room.players.find((p) => p.id === id);
}

function requireHost(room: Room, by: string) {
  if (room.hostId !== by) throw new RoomError("Seul l'hôte peut faire ça.");
}

function requireLobby(room: Room) {
  if (room.status !== 'lobby') throw new RoomError('La partie a déjà commencé.');
}

function pickAvatar(room: Room, list: string[], rng: Rng) {
  const used = new Set(room.players.map((p) => p.avatar));
  const free = list.filter((a) => !used.has(a));
  const pool = free.length ? free : list;
  return pool[Math.floor(rng() * pool.length)];
}

// ---------------------------------------------------------------- Salle d'attente

export function createRoom(code: string, host: { id: string; name: string }, rng: Rng = cryptoRng): Room {
  const room: Room = {
    code,
    hostId: host.id,
    status: 'lobby',
    settings: { ...DEFAULT_ROOM_SETTINGS },
    players: [],
    banned: [],
    game: null,
    deadline: null,
    deadlineKind: null,
    stats: {},
    moods: {},
    pendingBot: null,
    talk: {},
  };
  room.players.push({ id: host.id, name: cleanName(host.name), isBot: false, avatar: pickAvatar(room, HUMAN_AVATARS, rng), away: false });
  return room;
}

export interface JoinResult {
  room: Room;
  /** Si le joueur a repris la place d'un joueur absent du même pseudo (autre appareil). */
  replacedId?: string;
}

export function joinRoom(input: Room, user: { id: string; name: string }, rng: Rng = cryptoRng): JoinResult {
  const room = clone(input);
  if (room.banned.includes(user.id)) throw new RoomError("L'hôte t'a exclu de cette partie.");
  const name = cleanName(user.name);
  const existing = findPlayer(room, user.id);
  if (existing) {
    // Retour d'un joueur (même appareil) : on le remet présent.
    existing.away = false;
    if (room.status === 'lobby') existing.name = name;
    return { room };
  }

  if (room.status === 'lobby') {
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new RoomError('Ce pseudo est déjà pris dans cette salle.');
    }
    if (room.players.length >= room.settings.maxSeats) throw new RoomError('La table est complète.');
    room.players.push({ id: user.id, name, isBot: false, avatar: pickAvatar(room, HUMAN_AVATARS, rng), away: false });
    return { room };
  }

  // Partie en cours : on ne peut reprendre que SA place, identifiée par le pseudo, si elle est inoccupée.
  const seat = room.players.find((p) => !p.isBot && !p.kicked && p.away && p.name.toLowerCase() === name.toLowerCase());
  if (!seat) throw new RoomError('La partie a déjà commencé. Utilise le même pseudo pour reprendre ta place.');
  const oldId = seat.id;
  replacePlayerId(room, oldId, user.id);
  findPlayer(room, user.id)!.away = false;
  return { room, replacedId: oldId };
}

function replacePlayerId(room: Room, oldId: string, newId: string) {
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

export function leaveRoom(input: Room, userId: string): Room {
  const room = clone(input);
  const p = findPlayer(room, userId);
  if (!p) return room;
  if (room.status === 'lobby') {
    room.players = room.players.filter((x) => x.id !== userId);
    if (room.hostId === userId) {
      const nextHost = room.players.find((x) => !x.isBot);
      room.hostId = nextHost?.id ?? '';
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

export function kickPlayer(input: Room, by: string, targetId: string): Room {
  requireHost(input, by);
  if (targetId === by) throw new RoomError('Tu ne peux pas t’exclure toi-même.');
  const room = clone(input);
  const p = findPlayer(room, targetId);
  if (!p) throw new RoomError('Joueur introuvable.');
  if (!p.isBot) room.banned.push(targetId);
  if (room.status === 'lobby') {
    room.players = room.players.filter((x) => x.id !== targetId);
  } else {
    p.kicked = true;
    p.away = true;
  }
  return room;
}

export function updateSettings(input: Room, by: string, patch: Partial<RoomSettings>): Room {
  requireHost(input, by);
  requireLobby(input);
  const room = clone(input);
  const s = { ...room.settings, ...patch };
  const int = (v: unknown, min: number, max: number, label: string) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new RoomError(`${label} invalide.`);
  };
  int(s.startingStack, 20, 1_000_000, 'Tapis de départ');
  int(s.smallBlind, 1, 100_000, 'Petite blinde');
  int(s.bigBlind, s.smallBlind, 200_000, 'Grosse blinde');
  int(s.maxSeats, Math.max(2, room.players.length), 9, 'Nombre de places');
  int(s.turnSeconds, 10, 120, 'Temps de décision');
  if (s.blindIncreaseEveryHands !== null) int(s.blindIncreaseEveryHands, 2, 100, 'Augmentation des blindes');
  if (s.botSpeed !== 'fast' && s.botSpeed !== 'normal') throw new RoomError('Vitesse invalide.');
  if (s.startingStack < s.bigBlind * 2) throw new RoomError('Le tapis doit valoir au moins 2 grosses blindes.');
  room.settings = s;
  return room;
}

export function addBot(input: Room, by: string, difficulty: BotDifficulty, rng: Rng = cryptoRng, personality?: PersonalityId): Room {
  requireHost(input, by);
  requireLobby(input);
  if (!['easy', 'medium', 'hard'].includes(difficulty)) throw new RoomError('Difficulté invalide.');
  const room = clone(input);
  if (room.players.length >= room.settings.maxSeats) throw new RoomError('La table est complète.');
  const used = new Set(room.players.map((p) => p.name.toLowerCase()));
  const name = BOT_NAMES.find((n) => !used.has(n.toLowerCase())) ?? `Bot ${room.players.length + 1}`;
  let n = 1;
  while (room.players.some((p) => p.id === `bot-${n}`)) n++;
  if (personality !== undefined && !PERSONALITY_IDS.includes(personality)) throw new RoomError('Style de bot invalide.');
  // Style au hasard, en évitant ceux déjà présents à la table
  const taken = new Set(room.players.map((p) => p.personality));
  const style = personality ?? randomPersonalities(PERSONALITY_IDS.length, rng).find((x) => !taken.has(x)) ?? defaultPersonality(difficulty);
  room.players.push({ id: `bot-${n}`, name, isBot: true, difficulty, personality: style, avatar: pickAvatar(room, BOT_AVATARS, rng), away: false });
  return room;
}

export function removeBot(input: Room, by: string, botId: string): Room {
  requireHost(input, by);
  requireLobby(input);
  const room = clone(input);
  if (!findPlayer(room, botId)?.isBot) throw new RoomError('Bot introuvable.');
  room.players = room.players.filter((p) => p.id !== botId);
  return room;
}

// ---------------------------------------------------------------- Partie

export function startRoomGame(input: Room, by: string, now: number, rng: Rng = cryptoRng): Room {
  requireHost(input, by);
  requireLobby(input);
  if (input.players.length < 2) throw new RoomError('Il faut au moins 2 joueurs (ajoute un bot !).');
  const room = clone(input);
  const s = room.settings;
  room.game = startHand(
    createGame(
      { startingStack: s.startingStack, smallBlind: s.smallBlind, bigBlind: s.bigBlind, blindIncreaseEveryHands: s.blindIncreaseEveryHands },
      room.players.map((p) => ({ id: p.id, name: p.name })),
    ),
    rng,
  );
  room.status = 'playing';
  return schedule(room, now, rng);
}

export function playerAction(input: Room, playerId: string, action: PlayerAction, now: number, rng: Rng = cryptoRng): Room {
  const room = clone(input);
  if (room.status !== 'playing' || !room.game) throw new RoomError("Aucune partie en cours.");
  const p = findPlayer(room, playerId);
  if (!p || p.isBot) throw new RoomError("Tu ne joues pas à cette table.");
  if (p.kicked) throw new RoomError("Tu as été exclu de cette partie.");
  room.game = applyAction(room.game, playerId, action); // valide tour, montant, tapis
  p.away = false;
  return schedule(room, now, rng);
}

export function setBack(input: Room, playerId: string): Room {
  const room = clone(input);
  const p = findPlayer(room, playerId);
  if (p && !p.kicked) p.away = false;
  return room;
}

/**
 * Appelé régulièrement par les clients : exécute ce qui est dû (minuteur écoulé,
 * action d'un bot, main suivante). Sans effet si l'échéance n'est pas atteinte.
 */
export function tick(input: Room, now: number, rng: Rng = cryptoRng): { room: Room; changed: boolean } {
  if (input.status !== 'playing' || !input.game || input.deadline === null || now < input.deadline) {
    return { room: input, changed: false };
  }
  const room = clone(input);
  const g = room.game!;
  if (room.deadlineKind === 'nextHand') {
    if (g.phase === 'handOver') room.game = startHand(g, rng);
  } else {
    const legal = getLegalActions(g);
    if (legal) {
      const p = findPlayer(room, legal.playerId)!;
      if (p.isBot) {
        const pending = room.pendingBot;
        const fresh = pending && pending.playerId === p.id && pending.handNumber === g.handNumber && pending.logLength === g.log.length;
        const d = fresh ? pending : decideBot(g, p.id, p.difficulty ?? 'medium', botOptions(room, p, rng));
        room.game = applyAction(g, p.id, d.action);
        if (d.talk) (room.talk ??= {})[p.id] = { text: d.talk, at: now };
      } else {
        // Temps écoulé : check si possible, sinon fold ; le joueur passe « absent ».
        room.game = applyAction(g, p.id, timeoutAction(g));
        p.away = true;
      }
    }
  }
  return { room: schedule(room, now, rng), changed: true };
}

/** Joue automatiquement pour les absents puis fixe la prochaine échéance. */
function schedule(room: Room, now: number, rng: Rng): Room {
  let g = room.game!;
  let guard = 0;
  for (;;) {
    if (++guard > 500) throw new Error('Boucle de planification');
    if (g.phase === 'betting') {
      const legal = getLegalActions(g)!;
      const p = findPlayer(room, legal.playerId)!;
      if (!p.isBot && p.away) {
        g = applyAction(g, p.id, timeoutAction(g));
        continue;
      }
      room.game = g;
      if (p.isBot) {
        // Le bot décide tout de suite ; il « réfléchit » plus ou moins longtemps selon la décision.
        const d = decideBot(g, p.id, p.difficulty ?? 'medium', botOptions(room, p, rng));
        room.pendingBot = { playerId: p.id, handNumber: g.handNumber, logLength: g.log.length, action: d.action, talk: d.talk };
        room.deadlineKind = 'bot';
        room.deadline = now + d.thinkMs;
      } else {
        room.pendingBot = null;
        room.deadlineKind = 'turn';
        room.deadline = now + room.settings.turnSeconds * 1000;
      }
      return room;
    }
    break;
  }
  room.pendingBot = null;
  // Fin de main (schedule n'est appelé qu'une fois par transition) : profils adverses, humeur, cartes montrées.
  if (g.phase === 'handOver' || g.phase === 'gameOver') {
    room.stats = updateOpponentStats(room.stats, g);
    room.moods ??= {};
    for (const p of room.players) {
      if (!p.isBot) continue;
      const gp = g.players.find((x) => x.id === p.id);
      if (!gp || (gp.status === 'out' && gp.eliminatedAtHand !== g.handNumber)) continue;
      const end = botHandEnd(g, p.id, p.personality ?? defaultPersonality(p.difficulty ?? 'medium'), room.moods[p.id], rng);
      room.moods[p.id] = end.mood;
      if (end.show) g = showCards(g, p.id);
      if (end.talk) (room.talk ??= {})[p.id] = { text: end.talk, at: now };
    }
  }
  room.game = g;
  if (g.phase === 'handOver') {
    room.deadlineKind = 'nextHand';
    room.deadline = now + (g.lastHand?.showdown ? 5000 : 2500);
  } else if (g.phase === 'gameOver') {
    room.status = 'finished';
    room.deadline = null;
    room.deadlineKind = null;
  }
  return room;
}

/** Recommencer une partie dans la même salle (retour en salle d'attente). */
export function backToLobby(input: Room, by: string): Room {
  requireHost(input, by);
  if (input.status !== 'finished') throw new RoomError("La partie n'est pas terminée.");
  const room = clone(input);
  room.status = 'lobby';
  room.game = null;
  room.deadline = null;
  room.deadlineKind = null;
  room.players = room.players.filter((p) => !p.kicked);
  for (const p of room.players) p.away = false;
  return room;
}

// ---------------------------------------------------------------- Vues

export type PublicRoom = Omit<Room, 'banned' | 'stats' | 'moods' | 'pendingBot'>;

function botOptions(room: Room, p: RoomPlayer, rng: Rng) {
  return {
    rng,
    stats: room.stats,
    personality: p.personality ?? defaultPersonality(p.difficulty ?? 'medium'),
    mood: room.moods?.[p.id],
    speed: room.settings.botSpeed,
  };
}

/** Ce que tous les membres de la salle peuvent voir : pas de paquet, pas de cartes privées. */
export function publicRoom(room: Room): PublicRoom {
  const { banned: _b, stats: _s, moods: _m, pendingBot: _p, ...rest } = room;
  return { ...rest, game: room.game ? getPublicView(room.game, null) : null };
}

/** Cartes privées de chaque joueur humain, à écrire dans la table protégée par RLS. */
export function privateHands(room: Room): { playerId: string; handNumber: number; cards: GameState['players'][number]['holeCards'] }[] {
  if (!room.game) return [];
  const g = room.game;
  return g.players
    .filter((p) => !findPlayer(room, p.id)?.isBot && p.holeCards.length > 0)
    .map((p) => ({ playerId: p.id, handNumber: g.handNumber, cards: p.holeCards }));
}
