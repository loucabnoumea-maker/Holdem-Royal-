// Edge Function « poker » : SEUL endroit où l'état secret (paquet, cartes) est lu et modifié.
// Toutes les actions passent ici et sont validées par le moteur (bon tour, mise légale, tapis suffisant).
// Le dossier ../_shared/poker est une copie de src/lib/poker (npm run sync:engine).
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { Db } from './handler.ts';
import { handle } from './handler.ts';

// Clé secrète : ancienne variable (service_role) ou nouveau format (SUPABASE_SECRET_KEYS)
function secretKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? '';
  } catch {
    return '';
  }
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

const iso = () => new Date().toISOString();

const db: Db = {
  async findRoomId(code) {
    const data = check(await admin.from('rooms').select('id').eq('code', code).maybeSingle());
    return (data as { id: string } | null)?.id ?? null;
  },
  async insertRoom(code) {
    const { data, error } = await admin.from('rooms').insert({ code }).select('id').single();
    if (error?.code === '23505') return null; // code déjà utilisé
    if (error) throw error;
    return data.id as string;
  },
  async insertState(roomId, code, secret, pub, serverNow) {
    check(await admin.from('room_secrets').insert({ room_id: roomId, data: secret, version: 1 }));
    check(await admin.from('room_public').insert({ room_id: roomId, code, data: pub, version: 1, server_now: serverNow }));
  },
  async getSecret(roomId) {
    const data = check(await admin.from('room_secrets').select('data, version').eq('room_id', roomId).single());
    return data as { data: never; version: number };
  },
  async casSecret(roomId, version, data) {
    const rows = check(
      await admin
        .from('room_secrets')
        .update({ data, version: version + 1, updated_at: iso() })
        .eq('room_id', roomId)
        .eq('version', version)
        .select('version'),
    );
    return Array.isArray(rows) && rows.length > 0;
  },
  async updatePublic(roomId, data, version, serverNow) {
    check(await admin.from('room_public').update({ data, version, server_now: serverNow, updated_at: iso() }).eq('room_id', roomId));
  },
  async upsertMember(roomId, userId, name) {
    check(await admin.from('room_members').upsert({ room_id: roomId, user_id: userId, name }));
  },
  async deleteMember(roomId, userId) {
    check(await admin.from('room_members').delete().eq('room_id', roomId).eq('user_id', userId));
  },
  async upsertHoleCards(rows) {
    check(await admin.from('hole_cards').upsert(rows.map((r) => ({ ...r, updated_at: iso() }))));
  },
  async deleteHoleCards(roomId, playerId) {
    check(await admin.from('hole_cards').delete().eq('room_id', roomId).eq('player_id', playerId));
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await admin.auth.getUser(jwt);
  const uid = auth?.user?.id;
  if (!uid) return json({ error: 'Session invalide, recharge la page.' }, 401);
  const body = await req.json().catch(() => ({}));
  const res = await handle(db, uid, body);
  return json(res.body, res.status);
});
