import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, PlayerAction, PublicRoom } from '../lib/poker/index.ts';
import { call, clockOffset, ensureSession, supabase } from '../lib/online/client.ts';
import { loadName } from '../lib/prefs.ts';
import { play } from '../lib/sound.ts';

export interface ChatMessage {
  id: number;
  user_id: string;
  name: string;
  body: string;
  created_at: string;
}

type Status = 'connecting' | 'ready' | 'needName' | 'error';

export function useOnlineRoom(code: string) {
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [myCards, setMyCards] = useState<{ hand: number; cards: Card[] } | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const versionRef = useRef(0);
  const roomRef = useRef<PublicRoom | null>(null);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  const applyPublic = useCallback((row: { data: PublicRoom; version: number }) => {
    if (row.version < versionRef.current) return;
    versionRef.current = row.version;
    setRoom(row.data);
  }, []);

  const refresh = useCallback(async (rid: string) => {
    const { data } = await supabase().from('room_public').select('data, version').eq('room_id', rid).maybeSingle();
    if (data) applyPublic(data as { data: PublicRoom; version: number });
    else setRoom(null);
  }, [applyPublic]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  // Connexion, adhésion et abonnements temps réel
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    (async () => {
      try {
        const id = await ensureSession();
        if (cancelled) return;
        setUid(id);
        const name = loadName();
        if (name.trim().length < 2) {
          setStatus('needName');
          return;
        }
        let joined;
        try {
          joined = await call('join', { code, name });
        } catch (e) {
          const msg = (e as Error).message;
          if (/pseudo/i.test(msg)) {
            setStatus('needName');
            return;
          }
          throw e;
        }
        if (cancelled) return;
        const rid = joined.roomId;
        setRoomId(rid);
        await refresh(rid);
        const sb = supabase();
        const [{ data: cards }, { data: msgs }] = await Promise.all([
          sb.from('hole_cards').select('hand_number, cards').eq('room_id', rid).eq('player_id', id).maybeSingle(),
          sb.from('chat_messages').select('*').eq('room_id', rid).order('created_at', { ascending: false }).limit(60),
        ]);
        if (cards) setMyCards({ hand: cards.hand_number, cards: cards.cards });
        if (msgs) setChat((msgs as ChatMessage[]).reverse());

        channel = sb
          .channel(`room:${rid}`, { config: { presence: { key: id } } })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'room_public', filter: `room_id=eq.${rid}` }, (p) => {
            const row = p.new as { data: PublicRoom; version: number } | undefined;
            if (row?.data) applyPublic(row);
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'hole_cards', filter: `room_id=eq.${rid}` }, (p) => {
            const row = p.new as { player_id: string; hand_number: number; cards: Card[] } | undefined;
            if (row?.player_id === id) setMyCards({ hand: row.hand_number, cards: row.cards });
          })
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${rid}` }, (p) => {
            const m = p.new as ChatMessage;
            setChat((c) => (c.some((x) => x.id === m.id) ? c : [...c.slice(-99), m]));
            if (m.user_id !== id) play('message');
          })
          .on('presence', { event: 'sync' }, () => {
            setOnline(new Set(Object.keys(channel!.presenceState())));
          })
          .subscribe((s) => {
            if (s === 'SUBSCRIBED') void channel!.track({ at: Date.now() });
          });

        // Filet de sécurité si le temps réel décroche
        poll = setInterval(() => void refresh(rid), 5000);
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      if (channel) void supabase().removeChannel(channel);
    };
  }, [code, refresh, applyPublic]);

  // Exécute les échéances (minuteur, bots, main suivante) : n'importe quel client peut le faire,
  // le serveur vérifie que l'échéance est bien passée.
  useEffect(() => {
    if (status !== 'ready') return;
    let inflight = false;
    let last = 0;
    const id = setInterval(async () => {
      const r = roomRef.current;
      if (!r || r.status !== 'playing' || r.deadline === null || inflight) return;
      const serverNow = Date.now() + clockOffset;
      if (serverNow < r.deadline + 150 || Date.now() - last < 900) return;
      inflight = true;
      last = Date.now();
      try {
        await call('tick', { code });
      } catch {
        /* sera retenté */
      } finally {
        inflight = false;
      }
    }, 250);
    return () => clearInterval(id);
  }, [status, code]);

  const send = useCallback(
    async (op: string, payload: Record<string, unknown> = {}) => {
      try {
        await call(op, { code, ...payload });
        if (roomId) void refresh(roomId);
        return true;
      } catch (e) {
        flash((e as Error).message);
        return false;
      }
    },
    [code, roomId, refresh, flash],
  );

  const act = useCallback((action: PlayerAction) => send('action', { action }), [send]);

  const sendChat = useCallback(
    async (body: string) => {
      const text = body.trim().slice(0, 300);
      if (!text || !roomId) return;
      const { error: e } = await supabase().from('chat_messages').insert({ room_id: roomId, body: text });
      if (e) flash("Message non envoyé.");
    },
    [roomId, flash],
  );

  return { status, error, uid, roomId, room, myCards, chat, online, toast, send, act, sendChat };
}
