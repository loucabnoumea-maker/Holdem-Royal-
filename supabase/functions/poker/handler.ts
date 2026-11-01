// Cœur de l'Edge Function, indépendant de Supabase (testable avec une base en mémoire).
import { PokerError } from '../_shared/poker/game.ts';
import type { Card } from '../_shared/poker/cards.ts';
import type { PlayerAction } from '../_shared/poker/game.ts';
import type { BotDifficulty, PersonalityId } from '../_shared/poker/bots.ts';
import type { PublicRoom, Room, RoomSettings } from '../_shared/poker/room.ts';
import {
  addBot,
  backToLobby,
  createRoom,
  generateRoomCode,
  joinRoom,
  kickPlayer,
  leaveRoom,
  normalizeCode,
  playerAction,
  privateHands,
  publicRoom,
  removeBot,
  RoomError,
  setBack,
  startRoomGame,
  tick,
  updateSettings,
} from '../_shared/poker/room.ts';

export interface HoleRow {
  room_id: string;
  player_id: string;
  hand_number: number;
  cards: Card[];
}

/** Accès aux données dont le handler a besoin (implémenté par Supabase ou en mémoire). */
export interface Db {
  findRoomId(code: string): Promise<string | null>;
  /** Crée la salle ; renvoie null si le code existe déjà. */
  insertRoom(code: string): Promise<string | null>;
  insertState(roomId: string, code: string, secret: Room, pub: PublicRoom, serverNow: number): Promise<void>;
  getSecret(roomId: string): Promise<{ data: Room; version: number }>;
  /** Écrit seulement si la version n'a pas changé (verrou optimiste). */
  casSecret(roomId: string, version: number, data: Room): Promise<boolean>;
  updatePublic(roomId: string, data: PublicRoom, version: number, serverNow: number): Promise<void>;
  upsertMember(roomId: string, userId: string, name: string): Promise<void>;
  deleteMember(roomId: string, userId: string): Promise<void>;
  upsertHoleCards(rows: HoleRow[]): Promise<void>;
  deleteHoleCards(roomId: string, playerId: string): Promise<void>;
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const ok = (body: Record<string, unknown>): HandlerResult => ({ status: 200, body: { ok: true, ...body, serverNow: Date.now() } });

async function load(db: Db, code: string) {
  const roomId = await db.findRoomId(normalizeCode(code));
  if (!roomId) throw new RoomError('Aucune partie avec ce code.');
  const s = await db.getSecret(roomId);
  return { roomId, room: s.data, version: s.version };
}

async function persist(db: Db, roomId: string, before: Room, after: Room, version: number) {
  if (!(await db.casSecret(roomId, version, after))) return false;
  // Cartes privées AVANT l'état public : le client a ses cartes quand la nouvelle main s'affiche.
  if (after.game && after.game.handNumber !== before.game?.handNumber) {
    const rows = privateHands(after).map((h) => ({ room_id: roomId, player_id: h.playerId, hand_number: h.handNumber, cards: h.cards }));
    if (rows.length) await db.upsertHoleCards(rows);
  }
  await db.updatePublic(roomId, publicRoom(after), version + 1, Date.now());
  return true;
}

type Step = (room: Room) => Room | { room: Room; changed: boolean };

async function mutate(db: Db, code: string, fn: Step) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { roomId, room, version } = await load(db, code);
    const res = fn(room);
    const next = 'changed' in res ? res.room : res;
    if ('changed' in res && !res.changed) return { roomId, room };
    if (await persist(db, roomId, room, next, version)) return { roomId, room: next };
  }
  throw new RoomError('Trop de joueurs agissent en même temps, réessaie.');
}

export async function handle(db: Db, uid: string, body: Record<string, unknown>): Promise<HandlerResult> {
  try {
    const op = String(body.op ?? '');
    const now = () => Date.now();

    if (op === 'create') {
      const room = createRoom('XXXXXX', { id: uid, name: String(body.name ?? '') });
      for (let i = 0; i < 8; i++) {
        const code = generateRoomCode();
        const roomId = await db.insertRoom(code);
        if (!roomId) continue; // code déjà pris
        room.code = code;
        await db.insertState(roomId, code, room, publicRoom(room), Date.now());
        await db.upsertMember(roomId, uid, room.players[0].name);
        return ok({ code, roomId });
      }
      throw new RoomError('Impossible de générer un code, réessaie.');
    }

    const code = normalizeCode(String(body.code ?? ''));
    if (code.length !== 6) throw new RoomError('Le code doit faire 6 caractères.');

    if (op === 'join') {
      let replaced: string | undefined;
      const { roomId, room } = await mutate(db, code, (r) => {
        const res = joinRoom(r, { id: uid, name: String(body.name ?? '') });
        replaced = res.replacedId;
        return res.room;
      });
      const me = room.players.find((p) => p.id === uid)!;
      await db.upsertMember(roomId, uid, me.name);
      if (replaced) {
        await db.deleteMember(roomId, replaced);
        await db.deleteHoleCards(roomId, replaced);
      }
      // (re)donne au joueur ses cartes de la main en cours
      const mine = privateHands(room).filter((h) => h.playerId === uid);
      if (mine.length) {
        await db.upsertHoleCards(mine.map((h) => ({ room_id: roomId, player_id: uid, hand_number: h.handNumber, cards: h.cards })));
      }
      return ok({ code, roomId });
    }

    const member = (fn: Step): Step => (r) => {
      if (!r.players.some((p) => p.id === uid)) throw new RoomError('Tu ne fais pas partie de cette salle.');
      return fn(r);
    };

    let res: { roomId: string; room: Room };
    switch (op) {
      case 'tick':
        res = await mutate(db, code, member((r) => tick(r, now())));
        break;
      case 'action':
        res = await mutate(db, code, member((r) => playerAction(r, uid, body.action as PlayerAction, now())));
        break;
      case 'back':
        res = await mutate(db, code, member((r) => setBack(r, uid)));
        break;
      case 'leave':
        res = await mutate(db, code, member((r) => leaveRoom(r, uid)));
        if (res.room.status === 'lobby') await db.deleteMember(res.roomId, uid);
        break;
      case 'settings':
        res = await mutate(db, code, member((r) => updateSettings(r, uid, (body.settings ?? {}) as Partial<RoomSettings>)));
        break;
      case 'addBot':
        res = await mutate(db, code, member((r) =>
          addBot(r, uid, body.difficulty as BotDifficulty, undefined, (body.personality || undefined) as PersonalityId | undefined),
        ));
        break;
      case 'removeBot':
        res = await mutate(db, code, member((r) => removeBot(r, uid, String(body.botId))));
        break;
      case 'kick': {
        const target = String(body.playerId);
        res = await mutate(db, code, member((r) => kickPlayer(r, uid, target)));
        await db.deleteMember(res.roomId, target);
        await db.deleteHoleCards(res.roomId, target);
        break;
      }
      case 'start':
        res = await mutate(db, code, member((r) => startRoomGame(r, uid, now())));
        break;
      case 'lobby':
        res = await mutate(db, code, member((r) => backToLobby(r, uid)));
        break;
      default:
        throw new RoomError('Opération inconnue.');
    }
    return ok({ code, roomId: res.roomId });
  } catch (e) {
    if (e instanceof RoomError || e instanceof PokerError) return { status: 400, body: { error: e.message } };
    console.error(e);
    return { status: 500, body: { error: 'Erreur serveur.' } };
  }
}
