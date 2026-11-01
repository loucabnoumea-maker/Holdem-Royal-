import { useState } from 'react';
import { Field, GhostButton, PageShell, Panel, PrimaryButton, TextInput } from '../components/ui.tsx';
import { call, ensureSession, getServerConfig, isEnvConfigured, saveServerConfig } from '../lib/online/client.ts';
import { normalizeCode } from '../lib/poker/index.ts';
import { loadName, saveName } from '../lib/prefs.ts';
import { navigate } from '../lib/router.ts';

export default function OnlineEntry({ mode, initialCode = '' }: { mode: 'create' | 'join'; initialCode?: string }) {
  const [configured, setConfigured] = useState(!!getServerConfig());
  const [name, setName] = useState(loadName());
  const [code, setCode] = useState(normalizeCode(initialCode).slice(0, 6));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!configured) return <ServerSetup onDone={() => setConfigured(true)} />;

  const submit = async () => {
    setError(null);
    const n = name.trim();
    if (n.length < 2) return setError('Choisis un pseudo d’au moins 2 caractères.');
    if (mode === 'join' && code.length !== 6) return setError('Le code fait 6 caractères (ex. K7P2QX).');
    setBusy(true);
    try {
      await ensureSession();
      saveName(n);
      const res = mode === 'create' ? await call('create', { name: n }) : await call('join', { code, name: n });
      navigate(`/room/${res.code}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell onBack={() => navigate('/')} title={mode === 'create' ? 'Créer une partie' : 'Rejoindre une partie'}>
      <Panel className="flex flex-col gap-5">
        {mode === 'join' && (
          <Field label="Code de la partie">
            <TextInput
              value={code}
              onChange={(e) => setCode(normalizeCode(e.target.value).slice(0, 6))}
              placeholder="K7P2QX"
              autoCapitalize="characters"
              autoComplete="off"
              inputMode="text"
              className="text-center font-mono text-3xl tracking-[0.4em]"
            />
          </Field>
        )}
        <Field label="Ton pseudo">
          <TextInput
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex. Louca"
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </Field>
        {error && <div className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-200 ring-1 ring-red-400/30">{error}</div>}
        <PrimaryButton onClick={submit} disabled={busy}>
          {busy ? 'Connexion…' : mode === 'create' ? 'Créer la salle' : 'Rejoindre'}
        </PrimaryButton>
        {mode === 'create' ? (
          <p className="text-center text-sm text-white/45">
            Tu recevras un code et un lien à partager. Tu pourras ajouter des bots pour compléter la table.
          </p>
        ) : (
          <p className="text-center text-sm text-white/45">
            Déjà dans la partie et déconnecté ? Remets le même code et le même pseudo pour reprendre ta place.
          </p>
        )}
      </Panel>
      {!isEnvConfigured() && (
        <button onClick={() => setConfigured(false)} className="mt-6 text-center text-xs text-white/35 underline">
          Changer de serveur
        </button>
      )}
    </PageShell>
  );
}

function ServerSetup({ onDone }: { onDone: () => void }) {
  const current = getServerConfig();
  const [url, setUrl] = useState(current?.url ?? '');
  const [key, setKey] = useState(current?.anonKey ?? '');
  const valid = /^https:\/\/.+/.test(url.trim()) && key.trim().length > 20;
  return (
    <PageShell onBack={() => navigate('/')} title="Serveur de jeu">
      <Panel className="flex flex-col gap-5">
        <p className="text-sm leading-relaxed text-white/65">
          Le mode en ligne utilise un projet <b className="text-white">Supabase</b> (gratuit). Une fois le projet
          configuré (voir le guide <code className="text-gold-300">SUPABASE.md</code>), colle ici son URL et sa clé{' '}
          <i>anon</i> publique. Si l'appli est déployée avec les variables <code>VITE_SUPABASE_URL</code> et{' '}
          <code>VITE_SUPABASE_ANON_KEY</code>, cet écran n'apparaît pas.
        </p>
        <Field label="URL du projet">
          <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" />
        </Field>
        <Field label="Clé anon (publique)">
          <TextInput value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJhbGciOi…" />
        </Field>
        <PrimaryButton
          disabled={!valid}
          onClick={() => {
            saveServerConfig({ url: url.trim().replace(/\/$/, ''), anonKey: key.trim() });
            onDone();
          }}
        >
          Enregistrer
        </PrimaryButton>
        <GhostButton onClick={() => navigate('/solo')}>Jouer seul en attendant</GhostButton>
      </Panel>
    </PageShell>
  );
}
