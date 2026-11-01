import { useState } from 'react';
import { ActionBar } from '../components/ActionBar.tsx';
import { GameLayout, Modal } from '../components/GameLayout.tsx';
import { HandLog } from '../components/HandLog.tsx';
import { Table } from '../components/Table.tsx';
import { GhostButton, PrimaryButton } from '../components/ui.tsx';
import { useGameSounds } from '../hooks/useGameSounds.ts';
import type { SoloConfig } from '../hooks/useSoloGame.ts';
import { HERO_ID, useSoloGame } from '../hooks/useSoloGame.ts';
import { fmt } from '../lib/prefs.ts';
import { navigate } from '../lib/router.ts';

export function SoloGame({ config, onRestart }: { config: SoloConfig; onRestart: () => void }) {
  const g = useSoloGame(config);
  const [watching, setWatching] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  useGameSounds(g.view, HERO_ID);

  const { view } = g;
  const gameOver = view.phase === 'gameOver';
  const heroWon = gameOver && view.winnerId === HERO_ID;
  const winner = view.players.find((p) => p.id === view.winnerId);

  let actions;
  if (view.phase === 'handOver' && !g.heroOut) {
    actions = (
      <div className="flex flex-wrap items-center justify-center gap-3">
        {g.canShow && (
          <GhostButton onClick={g.showMine} className="py-3">
            Montrer mes cartes
          </GhostButton>
        )}
        <PrimaryButton onClick={g.nextHand} className="py-3">
          Main suivante
        </PrimaryButton>
        <label className="flex items-center gap-2 text-xs text-white/50">
          <input type="checkbox" checked={g.autoNext} onChange={(e) => g.setAutoNext(e.target.checked)} />
          automatique
        </label>
      </div>
    );
  } else if (g.heroOut) {
    actions = <div className="py-4 text-center text-sm text-white/45">Tu es éliminé — les bots terminent la partie.</div>;
  } else {
    actions = <ActionBar legal={g.heroLegal} bigBlind={view.bigBlind} onAction={g.act} />;
  }

  let overlay = null;
  if (confirmQuit) {
    overlay = (
      <Modal>
        <h2 className="font-display text-3xl font-bold italic text-brass-200">Quitter la partie ?</h2>
        <p className="mt-2 text-sm text-white/60">La partie en cours sera perdue.</p>
        <div className="mt-6 flex flex-col gap-2">
          <PrimaryButton onClick={() => navigate('/')}>Quitter</PrimaryButton>
          <GhostButton onClick={() => setConfirmQuit(false)}>Continuer à jouer</GhostButton>
        </div>
      </Modal>
    );
  } else if (gameOver) {
    overlay = (
      <Modal>
        <h2 className="font-display text-4xl font-bold italic text-brass-200">
          {heroWon ? 'Victoire !' : 'Partie terminée'}
        </h2>
        <p className="mt-2 text-white/70">
          {heroWon
            ? `Tu as remporté tous les jetons en ${view.handNumber} mains.`
            : `${winner?.name} gagne la partie. Tu termines ${ordinal(g.place ?? 2)}.`}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <PrimaryButton onClick={onRestart}>Rejouer</PrimaryButton>
          <GhostButton onClick={() => navigate('/solo')}>Changer les réglages</GhostButton>
          <GhostButton onClick={() => navigate('/')}>Accueil</GhostButton>
        </div>
      </Modal>
    );
  } else if (g.heroOut && !watching) {
    overlay = (
      <Modal>
        <h2 className="font-display text-4xl font-bold italic text-brass-200">Éliminé</h2>
        <p className="mt-2 text-white/70">Tu termines {ordinal(g.place ?? 2)} sur {view.players.length}.</p>
        <div className="mt-6 flex flex-col gap-2">
          <PrimaryButton onClick={onRestart}>Rejouer</PrimaryButton>
          <GhostButton onClick={() => setWatching(true)}>Regarder la fin (accéléré)</GhostButton>
          <GhostButton onClick={() => navigate('/')}>Accueil</GhostButton>
        </div>
      </Modal>
    );
  }

  const blindsText = `Main n°${view.handNumber} · Blindes ${fmt(view.smallBlind)}/${fmt(view.bigBlind)}`;

  return (
    <GameLayout
      title="Partie solo"
      subtitle={blindsText}
      onQuit={() => (gameOver ? navigate('/') : setConfirmQuit(true))}
      table={<Table view={view} heroId={HERO_ID} meta={g.meta} />}
      actions={actions}
      tabs={[{ id: 'log', label: 'Historique', content: <HandLog log={view.log} handNumber={view.handNumber} /> }]}
      overlay={overlay}
    />
  );
}

function ordinal(n: number) {
  return n === 1 ? '1re' : `${n}e`;
}
