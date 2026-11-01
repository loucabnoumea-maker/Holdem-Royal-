import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionBar } from '../components/ActionBar.tsx';
import { GameLayout, Modal } from '../components/GameLayout.tsx';
import { HandLog } from '../components/HandLog.tsx';
import type { SeatMeta, TurnTimer } from '../components/Table.tsx';
import { Table } from '../components/Table.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { Field, GhostButton, PageShell, Panel, PrimaryButton, Segmented, Stepper } from '../components/ui.tsx';
import { useGameSounds } from '../hooks/useGameSounds.ts';
import type { ChatMessage } from '../hooks/useOnlineRoom.ts';
import { useOnlineRoom } from '../hooks/useOnlineRoom.ts';
import { clockOffset } from '../lib/online/client.ts';
import type { BotDifficulty, GameState, PublicRoom, RoomSettings } from '../lib/poker/index.ts';
import type { PersonalityId } from '../lib/poker/index.ts';
import { DIFFICULTY_FR, getLegalActions, PERSONALITIES, PERSONALITY_IDS } from '../lib/poker/index.ts';
import { fmt } from '../lib/prefs.ts';
import { navigate } from '../lib/router.ts';

export default function OnlineRoom({ code }: { code: string }) {
  const r = useOnlineRoom(code);

  useEffect(() => {
    if (r.status === 'needName') navigate(`/join/${code}`);
  }, [r.status, code]);

  if (r.status === 'error') {
    return (
      <PageShell onBack={() => navigate('/')} title="Oups">
        <Panel className="flex flex-col gap-4">
          <p className="text-white/75">{r.error}</p>
          <PrimaryButton onClick={() => window.location.reload()}>Réessayer</PrimaryButton>
          <GhostButton onClick={() => navigate('/online/join')}>Entrer un autre code</GhostButton>
        </Panel>
      </PageShell>
    );
  }
  if (r.status !== 'ready' || !r.room || !r.uid) {
    return <div className="flex min-h-dvh items-center justify-center text-white/50">Connexion à la salle {code}…</div>;
  }
  const me = r.room.players.find((p) => p.id === r.uid);
  if (!me) {
    return (
      <PageShell onBack={() => navigate('/')} title="Hors de la salle">
        <Panel className="text-white/75">Tu ne fais plus partie de cette salle.</Panel>
      </PageShell>
    );
  }

  return r.room.status === 'lobby' ? <Lobby r={r} room={r.room} uid={r.uid} /> : <OnlineGame r={r} room={r.room} uid={r.uid} />;
}

type Hook = ReturnType<typeof useOnlineRoom>;

function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="pop-in fixed left-1/2 top-4 z-[70] max-w-[90vw] -translate-x-1/2 rounded-xl bg-red-950/95 px-4 py-2.5 text-sm font-semibold text-red-100 shadow-xl ring-1 ring-red-400/40">
      {text}
    </div>
  );
}

// ------------------------------------------------------------------ Salle d'attente

export function Lobby({ r, room, uid }: { r: Hook; room: PublicRoom; uid: string }) {
  const isHost = room.hostId === uid;
  const s = room.settings;
  const [botDiff, setBotDiff] = useState<BotDifficulty>('medium');
  const [botStyle, setBotStyle] = useState<PersonalityId | ''>('');
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${window.location.pathname}#/join/${room.code}`;
  const setS = (patch: Partial<RoomSettings>) => void r.send('settings', { settings: patch });

  const share = async () => {
    const text = `Rejoins ma table de poker Hold'em Royal ! Code : ${room.code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Hold'em Royal", text, url: link });
        return;
      } catch {
        /* annulé */
      }
    }
    await navigator.clipboard?.writeText(link).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <PageShell
      onBack={() => {
        void r.send('leave');
        navigate('/');
      }}
      title="Salle d'attente"
    >
      <Toast text={r.toast} />
      <div className="flex flex-col gap-4">
        <Panel className="text-center">
          <div className="font-ui text-sm text-ivory/50">Code de la partie</div>
          <div className="mt-1 select-all font-display text-5xl font-bold tracking-[0.18em] text-brass-200">{room.code}</div>
          <div className="mt-4 flex justify-center gap-2">
            <GhostButton onClick={share} className="py-2.5 text-sm">
              {copied ? 'Lien copié' : 'Partager le lien'}
            </GhostButton>
          </div>
        </Panel>

        <Panel>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-bold">Joueurs</h2>
            <span className="text-sm text-white/45">
              {room.players.length} / {s.maxSeats}
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {room.players.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl bg-black/25 px-3 py-2">
                <Avatar id={p.id} name={p.name} size={38} hero={p.id === uid} bot={p.isBot} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate font-semibold">
                    {p.name}
                    {p.id === room.hostId && <span title="Hôte" className="text-brass-300">♛</span>}
                    {p.id === uid && <span className="text-xs text-white/40">(toi)</span>}
                  </div>
                  <div className="text-xs text-white/45">
                    {p.isBot
                      ? `${p.personality ? PERSONALITIES[p.personality].name : 'Bot'} · ${DIFFICULTY_FR[p.difficulty ?? 'medium']}`
                      : r.online.has(p.id)
                        ? '● Connecté'
                        : '○ Hors ligne'}
                  </div>
                </div>
                {isHost && p.id !== uid && (
                  <button
                    onClick={() => void r.send(p.isBot ? 'removeBot' : 'kick', p.isBot ? { botId: p.id } : { playerId: p.id })}
                    className="rounded-lg bg-white/8 px-2.5 py-1 text-xs font-semibold text-white/70 hover:bg-red-500/30"
                  >
                    {p.isBot ? 'Retirer' : 'Expulser'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isHost && room.players.length < s.maxSeats && (
            <div className="mt-4 flex flex-col gap-2">
              <select
                id="bot-style"
                value={botStyle}
                onChange={(e) => setBotStyle(e.target.value as PersonalityId | '')}
                className="font-ui rounded-xl bg-black/40 px-3 py-2.5 text-[15px] font-semibold text-brass-200 outline-none ring-1 ring-brass-400/25 focus:ring-brass-400"
                aria-label="Style du bot"
              >
                <option value="">Style au hasard</option>
                {PERSONALITY_IDS.map((id) => (
                  <option key={id} value={id}>
                    {PERSONALITIES[id].name} : {PERSONALITIES[id].description}
                  </option>
                ))}
              </select>
              <div className="flex-1">
                <Segmented
                  value={botDiff}
                  onChange={setBotDiff}
                  options={[
                    { value: 'easy', label: 'Facile' },
                    { value: 'medium', label: 'Moyen' },
                    { value: 'hard', label: 'Difficile' },
                  ]}
                />
              </div>
              <GhostButton onClick={() => void r.send('addBot', { difficulty: botDiff, personality: botStyle || undefined })} className="py-2.5 text-sm">
                + Ajouter un bot
              </GhostButton>
            </div>
          )}
        </Panel>

        <Panel className="flex flex-col gap-4">
          <h2 className="font-bold">Réglages {isHost ? '' : <span className="text-sm font-normal text-white/40">(fixés par l'hôte)</span>}</h2>
          {isHost ? (
            <>
              <Field label="Tapis de départ">
                <Stepper
                  value={s.startingStack}
                  min={100}
                  max={20000}
                  step={s.startingStack >= 2000 ? 500 : 100}
                  onChange={(v) => setS({ startingStack: v })}
                  format={(v) => `${fmt(v)} jetons`}
                />
              </Field>
              <Field label="Blindes">
                <Stepper
                  value={s.bigBlind}
                  min={2}
                  max={Math.max(2, Math.floor(s.startingStack / 10))}
                  step={s.bigBlind >= 20 ? 10 : 2}
                  onChange={(v) => setS({ bigBlind: v, smallBlind: Math.max(1, Math.floor(v / 2)) })}
                  format={(v) => `${Math.max(1, Math.floor(v / 2))} / ${v}`}
                />
              </Field>
              <Field label="Places maximum">
                <Stepper value={s.maxSeats} min={Math.max(2, room.players.length)} max={9} onChange={(v) => setS({ maxSeats: v })} />
              </Field>
              <Field label="Temps pour jouer">
                <Stepper value={s.turnSeconds} min={10} max={120} step={5} onChange={(v) => setS({ turnSeconds: v })} format={(v) => `${v} s`} />
              </Field>
              <Field label="Augmentation des blindes" hint="toutes les X mains">
                <Segmented
                  value={String(s.blindIncreaseEveryHands ?? 0)}
                  onChange={(v) => setS({ blindIncreaseEveryHands: v === '0' ? null : Number(v) })}
                  options={[
                    { value: '0', label: 'Jamais' },
                    { value: '5', label: '5' },
                    { value: '10', label: '10' },
                    { value: '20', label: '20' },
                  ]}
                />
              </Field>
              <Field label="Vitesse des bots">
                <Segmented
                  value={s.botSpeed}
                  onChange={(v) => setS({ botSpeed: v })}
                  options={[
                    { value: 'normal', label: 'Normale' },
                    { value: 'fast', label: 'Rapide' },
                  ]}
                />
              </Field>
            </>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-white/50">Tapis</dt>
              <dd className="font-semibold">{fmt(s.startingStack)}</dd>
              <dt className="text-white/50">Blindes</dt>
              <dd className="font-semibold">
                {s.smallBlind} / {s.bigBlind}
              </dd>
              <dt className="text-white/50">Places</dt>
              <dd className="font-semibold">{s.maxSeats}</dd>
              <dt className="text-white/50">Temps pour jouer</dt>
              <dd className="font-semibold">{s.turnSeconds} s</dd>
              <dt className="text-white/50">Augmentation</dt>
              <dd className="font-semibold">{s.blindIncreaseEveryHands ? `toutes les ${s.blindIncreaseEveryHands} mains` : 'jamais'}</dd>
            </dl>
          )}
        </Panel>

        {isHost ? (
          <PrimaryButton onClick={() => void r.send('start')} disabled={room.players.length < 2} className="text-lg">
            {room.players.length < 2 ? 'Il faut au moins 2 joueurs' : 'Lancer la partie'}
          </PrimaryButton>
        ) : (
          <div className="animate-pulse py-3 text-center text-white/50">En attente que l'hôte lance la partie…</div>
        )}
        <Panel className="h-64">
          <Chat messages={r.chat} uid={uid} onSend={r.sendChat} />
        </Panel>
      </div>
    </PageShell>
  );
}

// ------------------------------------------------------------------ Partie

export function OnlineGame({ r, room, uid }: { r: Hook; room: PublicRoom; uid: string }) {
  const game = room.game as GameState;
  const meP = room.players.find((p) => p.id === uid)!;
  const isHost = room.hostId === uid;
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [seenChat, setSeenChat] = useState(r.chat.length);

  // Vue = état public + mes cartes (si elles correspondent à la main en cours)
  const view = useMemo<GameState>(() => {
    if (!r.myCards || r.myCards.hand !== game.handNumber) return game;
    return {
      ...game,
      players: game.players.map((p) => (p.id === uid && p.holeCards.length === 0 && p.status !== 'out' ? { ...p, holeCards: r.myCards!.cards } : p)),
    };
  }, [game, r.myCards, uid]);
  useGameSounds(view, uid);

  // Horloge locale pour faire disparaître les bulles de dialogue
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const meta = useMemo(() => {
    const m: Record<string, SeatMeta> = {};
    for (const p of room.players) {
      m[p.id] = {
        avatar: p.avatar,
        isBot: p.isBot,
        difficulty: p.difficulty,
        away: p.away,
        connected: p.isBot ? true : r.online.has(p.id),
        isHost: p.id === room.hostId,
        style: p.personality ? PERSONALITIES[p.personality].name : undefined,
        styleHint: p.personality ? PERSONALITIES[p.personality].description : undefined,
      };
      const said = room.talk?.[p.id];
      if (said && now + clockOffset - said.at < 3500) m[p.id].bubble = { text: said.text, key: said.at };
    }
    return m;
  }, [room, r.online, now]);

  const legal = view.phase === 'betting' ? getLegalActions(view) : null;
  const myLegal = legal && legal.playerId === uid && !meP.away ? legal : null;
  const toActId = legal?.playerId;
  const timer: TurnTimer | null =
    room.deadlineKind === 'turn' && room.deadline && toActId
      ? { playerId: toActId, endsAt: room.deadline - clockOffset, durationMs: room.settings.turnSeconds * 1000 }
      : null;

  const myState = view.players.find((p) => p.id === uid);
  const finished = room.status === 'finished';
  const winner = view.players.find((p) => p.id === view.winnerId);

  let actions;
  if (meP.kicked) actions = <div className="py-4 text-center text-sm text-red-300">L'hôte t'a exclu de la partie.</div>;
  else if (meP.away)
    actions = (
      <div className="flex flex-col items-center gap-2 py-2">
        <span className="text-sm text-white/55">Tu es absent : tes mains sont jouées automatiquement (check ou couché).</span>
        <PrimaryButton onClick={() => void r.send('back')} className="py-2.5">
          Je suis de retour
        </PrimaryButton>
      </div>
    );
  else if (myState?.status === 'out') actions = <div className="py-4 text-center text-sm text-white/45">Tu es éliminé — tu peux regarder la fin de la partie.</div>;
  else
    actions = (
      <ActionBar
        legal={myLegal}
        bigBlind={view.bigBlind}
        onAction={(a) => void r.act(a)}
        waitingText={view.phase === 'betting' ? `${view.players.find((p) => p.id === toActId)?.name ?? '…'} réfléchit…` : 'Prochaine main dans un instant…'}
      />
    );

  let overlay = null;
  if (confirmQuit) {
    overlay = (
      <Modal>
        <h2 className="font-display text-3xl font-bold italic text-brass-200">Quitter la table ?</h2>
        <p className="mt-2 text-sm text-white/60">
          Tu seras marqué absent (tes mains seront couchées). Tu pourras revenir avec le code <b>{room.code}</b>.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <PrimaryButton
            onClick={() => {
              void r.send('leave');
              navigate('/');
            }}
          >
            Quitter
          </PrimaryButton>
          <GhostButton onClick={() => setConfirmQuit(false)}>Rester</GhostButton>
        </div>
      </Modal>
    );
  } else if (finished) {
    overlay = (
      <Modal>
        <h2 className="font-display text-4xl font-bold italic text-brass-200">
          {view.winnerId === uid ? 'Victoire !' : `${winner?.name ?? '?'} gagne !`}
        </h2>
        <p className="mt-2 text-white/65">Partie terminée en {view.handNumber} mains.</p>
        <div className="mt-6 flex flex-col gap-2">
          {isHost ? (
            <PrimaryButton onClick={() => void r.send('lobby')}>Nouvelle partie (même salle)</PrimaryButton>
          ) : (
            <div className="text-sm text-white/50">L'hôte peut relancer une partie dans la même salle.</div>
          )}
          <GhostButton onClick={() => navigate('/')}>Accueil</GhostButton>
        </div>
      </Modal>
    );
  }

  const unread = Math.max(0, r.chat.length - seenChat);
  return (
    <GameLayout
      title={`Salle ${room.code}`}
      subtitle={`Main n°${view.handNumber} · Blindes ${fmt(view.smallBlind)}/${fmt(view.bigBlind)}`}
      onQuit={() => (finished ? navigate('/') : setConfirmQuit(true))}
      table={<Table view={view} heroId={uid} meta={meta} timer={timer} />}
      actions={actions}
      tabs={[
        { id: 'log', label: 'Historique', content: <HandLog log={view.log} handNumber={view.handNumber} /> },
        {
          id: 'chat',
          label: 'Chat',
          badge: unread,
          content: (
            <ChatSeen onSeen={() => setSeenChat(r.chat.length)} count={r.chat.length}>
              <Chat messages={r.chat} uid={uid} onSend={r.sendChat} />
            </ChatSeen>
          ),
        },
        {
          id: 'players',
          label: 'Joueurs',
          content: <PlayersPanel room={room} uid={uid} online={r.online} onKick={(id) => void r.send('kick', { playerId: id })} />,
        },
      ]}
      overlay={
        <>
          <Toast text={r.toast} />
          {overlay}
        </>
      }
    />
  );
}

function ChatSeen({ children, onSeen, count }: { children: ReactNode; onSeen: () => void; count: number }) {
  useEffect(() => onSeen(), [count, onSeen]);
  return <>{children}</>;
}

function PlayersPanel({ room, uid, online, onKick }: { room: PublicRoom; uid: string; online: Set<string>; onKick: (id: string) => void }) {
  const isHost = room.hostId === uid;
  return (
    <ul className="flex flex-col gap-2">
      {room.players.map((p) => {
        const gp = room.game?.players.find((x) => x.id === p.id);
        return (
          <li key={p.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm">
            <Avatar id={p.id} name={p.name} size={30} hero={p.id === uid} bot={p.isBot} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">
                {p.name} {p.id === room.hostId && '♛'}
              </div>
              <div className="text-xs text-white/45">
                {p.isBot
                  ? `${p.personality ? PERSONALITIES[p.personality].name : 'Bot'} · ${DIFFICULTY_FR[p.difficulty ?? 'medium']}`
                  : p.kicked
                    ? 'Exclu'
                    : p.away
                      ? 'Absent'
                      : online.has(p.id)
                        ? 'Connecté'
                        : 'Hors ligne'}
                {gp && ` · ${gp.status === 'out' ? 'éliminé' : fmt(gp.stack)}`}
              </div>
            </div>
            {isHost && !p.isBot && p.id !== uid && !p.kicked && (
              <button onClick={() => onKick(p.id)} className="rounded-lg bg-white/8 px-2 py-1 text-xs hover:bg-red-500/30">
                Expulser
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Chat({ messages, uid, onSend }: { messages: ChatMessage[]; uid: string; onSend: (t: string) => void }) {
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages.length]);
  const submit = () => {
    if (!text.trim()) return;
    onSend(text);
    setText('');
  };
  return (
    <div className="flex h-full flex-col">
      <div ref={box} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1 text-sm">
        {messages.length === 0 && <div className="text-white/35">Pas encore de message.</div>}
        {messages.map((m) => (
          <div key={m.id} className="mb-1 break-words">
            <span className={`font-bold ${m.user_id === uid ? 'text-gold-300' : 'text-emerald-300'}`}>{m.name}</span>{' '}
            <span className="text-white/85">{m.body}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Message…"
          className="min-w-0 flex-1 rounded-xl bg-black/40 px-3 py-2 text-sm outline-none ring-1 ring-white/15 focus:ring-gold-500"
        />
        <button onClick={submit} className="rounded-xl bg-gold-500 px-3 text-sm font-bold text-black">
          Envoyer
        </button>
      </div>
    </div>
  );
}
