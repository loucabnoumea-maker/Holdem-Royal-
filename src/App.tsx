import { lazy, Suspense, useState } from 'react';
import type { SoloConfig } from './hooks/useSoloGame.ts';
import { DEFAULT_SOLO } from './hooks/useSoloGame.ts';
import { load } from './lib/prefs.ts';
import { navigate, useHashRoute } from './lib/router.ts';
import { Home } from './pages/Home.tsx';
import { SoloGame } from './pages/SoloGame.tsx';
import { SoloSetup } from './pages/SoloSetup.tsx';

// Le mode en ligne (et le client Supabase) n'est chargé que si on en a besoin.
const OnlineEntry = lazy(() => import('./pages/OnlineEntry.tsx'));
const OnlineRoom = lazy(() => import('./pages/OnlineRoom.tsx'));

export default function App() {
  const route = useHashRoute();
  const [soloConfig, setSoloConfig] = useState<SoloConfig | null>(null);
  const [gameKey, setGameKey] = useState(0);

  const [a, b] = route;
  let page;
  if (a === 'solo' && b === 'play') {
    const cfg = soloConfig ?? { ...load('solo', DEFAULT_SOLO), playerName: 'Moi' };
    page = <SoloGame key={gameKey} config={cfg} onRestart={() => setGameKey((k) => k + 1)} />;
  } else if (a === 'solo') {
    page = (
      <SoloSetup
        onStart={(c) => {
          setSoloConfig(c);
          setGameKey((k) => k + 1);
          navigate('/solo/play');
        }}
      />
    );
  } else if (a === 'online' && (b === 'create' || b === 'join')) {
    page = <OnlineEntry mode={b} />;
  } else if (a === 'join' && b) {
    page = <OnlineEntry mode="join" initialCode={b} />;
  } else if (a === 'room' && b) {
    page = <OnlineRoom code={b.toUpperCase()} />;
  } else {
    page = <Home />;
  }

  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-white/50">Chargement…</div>}>
      {page}
    </Suspense>
  );
}
