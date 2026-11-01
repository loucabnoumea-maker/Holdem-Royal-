// Tests de l'Edge Function avec une base en mémoire : `deno test supabase/functions/poker`
import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert/strict';
import type { Db, HoleRow } from './handler.ts';
import { handle } from './handler.ts';
import type { PublicRoom, Room } from '../_shared/poker/room.ts';
import { getLegalActions } from '../_shared/poker/game.ts';

function memoryDb() {
  const rooms = new Map<string, string>(); // code -> id
  const secrets = new Map<string, { data: Room; version: number }>();
  const pub = new Map<string, { data: PublicRoom; version: number }>();
  const members = new Map<string, Map<string, string>>();
  const holes = new Map<string, HoleRow>(); // `${room}:${player}`
  const db: Db = {
    findRoomId: async (code) => rooms.get(code) ?? null,
    insertRoom: async (code) => {
      if (rooms.has(code)) return null;
      const id = crypto.randomUUID();
      rooms.set(code, id);
      return id;
    },
    insertState: async (id, _code, secret, p) => {
      secrets.set(id, { data: structuredClone(secret), version: 1 });
      pub.set(id, { data: structuredClone(p), version: 1 });
    },
    getSecret: async (id) => structuredClone(secrets.get(id)!),
    casSecret: async (id, version, data) => {
      const cur = secrets.get(id)!;
      if (cur.version !== version) return false;
      secrets.set(id, { data: structuredClone(data), version: version + 1 });
      return true;
    },
    updatePublic: async (id, data, version) => {
      pub.set(id, { data: structuredClone(data), version });
    },
    upsertMember: async (id, uid, name) => {
      if (!members.has(id)) members.set(id, new Map());
      members.get(id)!.set(uid, name);
    },
    deleteMember: async (id, uid) => {
      members.get(id)?.delete(uid);
    },
    upsertHoleCards: async (rows) => {
      for (const r of rows) holes.set(`${r.room_id}:${r.player_id}`, structuredClone(r));
    },
    deleteHoleCards: async (id, pid) => {
      holes.delete(`${id}:${pid}`);
    },
  };
  return { db, rooms, secrets, pub, members, holes };
}

const HOST = '11111111-1111-1111-1111-111111111111';
const FRIEND = '22222222-2222-2222-2222-222222222222';

Deno.test('partie complète via l’Edge Function : secret jamais exposé, cartes privées par joueur', async () => {
  const realNow = Date.now;
  let fake = 1_700_000_000_000;
  Date.now = () => fake;
  try {
    const m = memoryDb();
    const created = await handle(m.db, HOST, { op: 'create', name: 'Louca' });
    assertEquals(created.status, 200);
    const code = created.body.code as string;
    assert(/^[A-Z0-9]{6}$/.test(code));

    assertEquals((await handle(m.db, FRIEND, { op: 'join', code: code.toLowerCase(), name: 'Hugo' })).status, 200);
    // un non-membre ne peut rien faire
    assertEquals((await handle(m.db, 'intrus', { op: 'start', code })).status, 400);
    // seul l'hôte lance / ajoute des bots
    assertEquals((await handle(m.db, FRIEND, { op: 'addBot', code, difficulty: 'easy' })).status, 400);
    assertEquals((await handle(m.db, HOST, { op: 'addBot', code, difficulty: 'hard' })).status, 200);
    assertEquals(
      (await handle(m.db, HOST, { op: 'settings', code, settings: { startingStack: 300, turnSeconds: 10, botSpeed: 'fast' } })).status,
      200,
    );
    assertEquals((await handle(m.db, HOST, { op: 'start', code })).status, 200);

    const roomId = m.rooms.get(code)!;
    let steps = 0;
    while (m.secrets.get(roomId)!.data.status === 'playing') {
      if (++steps > 5000) throw new Error('partie trop longue');
      const secret = m.secrets.get(roomId)!.data;
      const p = m.pub.get(roomId)!.data;
      const g = secret.game!;

      // L'état public ne contient ni paquet ni cartes privées (hors abattage)
      assertEquals(p.game!.deck.length, 0);
      // Seules exceptions : abattage, ou cartes montrées volontairement par un bot (bluff exhibé)
      const shown = new Set([
        ...(p.game!.lastHand?.hands.map((h) => h.playerId) ?? []),
        ...(p.game!.lastHand?.shown?.map((h) => h.playerId) ?? []),
      ]);
      for (const sh of p.game!.lastHand?.shown ?? []) assert(sh.playerId.startsWith('bot'));
      for (const pl of p.game!.players) if (!shown.has(pl.id)) assertEquals(pl.holeCards.length, 0);
      assert(!JSON.stringify(p).includes('"banned"'));
      assert(!JSON.stringify(p).includes('"pendingBot"') && !JSON.stringify(p).includes('"moods"'));

      // Cartes privées : uniquement pour les humains, et ce sont les bonnes
      for (const pl of g.players) {
        const row = m.holes.get(`${roomId}:${pl.id}`);
        if (pl.id.startsWith('bot')) assertEquals(row, undefined);
        else if (pl.holeCards.length) assertEquals(row!.cards, pl.holeCards);
      }

      const legal = g.phase === 'betting' ? getLegalActions(g) : null;
      if (legal && secret.deadlineKind === 'turn' && steps % 4 !== 0) {
        // mauvais joueur → refusé
        const other = legal.playerId === HOST ? FRIEND : HOST;
        assertEquals((await handle(m.db, other, { op: 'action', code, action: { type: 'call' } })).status, 400);
        const action = legal.canCheck ? { type: 'check' } : { type: 'call' };
        assertEquals((await handle(m.db, legal.playerId, { op: 'action', code, action })).status, 200);
      } else {
        // trop tôt : sans effet
        const before = m.secrets.get(roomId)!.version;
        await handle(m.db, FRIEND, { op: 'tick', code });
        assertEquals(m.secrets.get(roomId)!.version, before);
        fake = secret.deadline! + 1;
        assertEquals((await handle(m.db, FRIEND, { op: 'tick', code })).status, 200);
      }
    }
    assertEquals(m.secrets.get(roomId)!.data.status, 'finished');
    assertEquals((await handle(m.db, HOST, { op: 'lobby', code })).status, 200);
    assertEquals(m.pub.get(roomId)!.data.status, 'lobby');
  } finally {
    Date.now = realNow;
  }
});

Deno.test('reprise de place depuis un autre appareil avec le même pseudo', async () => {
  const m = memoryDb();
  const code = (await handle(m.db, HOST, { op: 'create', name: 'Louca' })).body.code as string;
  await handle(m.db, FRIEND, { op: 'join', code, name: 'Hugo' });
  await handle(m.db, HOST, { op: 'start', code });
  await handle(m.db, FRIEND, { op: 'leave', code });
  const NEW = '33333333-3333-3333-3333-333333333333';
  const res = await handle(m.db, NEW, { op: 'join', code, name: 'hugo' });
  assertEquals(res.status, 200);
  const roomId = m.rooms.get(code)!;
  assert(m.members.get(roomId)!.has(NEW));
  assert(!m.members.get(roomId)!.has(FRIEND));
  assert(m.holes.has(`${roomId}:${NEW}`));
  assert(!m.holes.has(`${roomId}:${FRIEND}`));
});
