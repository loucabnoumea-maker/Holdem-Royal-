import { useState } from 'react';
import { Field, PageShell, Panel, PrimaryButton, Segmented, Stepper, TextInput } from '../components/ui.tsx';
import type { SoloConfig, StyleChoice } from '../hooks/useSoloGame.ts';
import { DEFAULT_SOLO } from '../hooks/useSoloGame.ts';
import type { BotDifficulty } from '../lib/poker/index.ts';
import { PERSONALITIES, PERSONALITY_IDS } from '../lib/poker/index.ts';
import { fmt, load, loadName, save, saveName } from '../lib/prefs.ts';
import { navigate } from '../lib/router.ts';

const DIFFS: { value: BotDifficulty; label: string }[] = [
  { value: 'easy', label: 'Facile' },
  { value: 'medium', label: 'Moyen' },
  { value: 'hard', label: 'Difficile' },
];
const BLINDS = [
  { sb: 1, bb: 2 },
  { sb: 5, bb: 10 },
  { sb: 10, bb: 20 },
  { sb: 25, bb: 50 },
  { sb: 50, bb: 100 },
];
const STACKS = [200, 500, 1000, 1500, 2000, 5000, 10000];

export function SoloSetup({ onStart }: { onStart: (c: SoloConfig) => void }) {
  const [c, setC] = useState<SoloConfig>(() => ({ ...load('solo', DEFAULT_SOLO), playerName: loadName() }));
  const [perBotOpen, setPerBotOpen] = useState(
    c.perBot.some((d) => d !== 'global') || (c.perBotStyle ?? []).some((x) => x !== 'random'),
  );
  const set = <K extends keyof SoloConfig>(k: K, v: SoloConfig[K]) => setC((x) => ({ ...x, [k]: v }));
  const blindIdx = Math.max(0, BLINDS.findIndex((b) => b.sb === c.smallBlind && b.bb === c.bigBlind));
  const stackIdx = Math.max(0, STACKS.indexOf(c.startingStack));
  const bots = c.totalPlayers - 1;

  const start = () => {
    const cfg = {
      ...c,
      playerName: c.playerName.trim().slice(0, 16) || 'Moi',
      perBot: c.perBot.slice(0, bots),
      perBotStyle: (c.perBotStyle ?? []).slice(0, bots),
    };
    save('solo', { ...cfg, playerName: '' });
    saveName(cfg.playerName);
    onStart(cfg);
  };

  return (
    <PageShell onBack={() => navigate('/')} title="Partie solo">
      <div className="flex flex-col gap-4">
        <Panel className="flex flex-col gap-5">
          <Field label="Ton pseudo">
            <TextInput
              value={c.playerName}
              maxLength={16}
              placeholder="Ex. Louca"
              onChange={(e) => set('playerName', e.target.value)}
            />
          </Field>
          <Field label="Joueurs à la table" hint={`toi + ${bots} bot${bots > 1 ? 's' : ''}`}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={2}
                max={9}
                value={c.totalPlayers}
                onChange={(e) => set('totalPlayers', Number(e.target.value))}
                className="raise-slider flex-1"
                style={{ ['--pct' as string]: `${((c.totalPlayers - 2) / 7) * 100}%` }}
              />
              <span className="font-ui w-8 text-center text-2xl font-bold text-brass-200">{c.totalPlayers}</span>
            </div>
          </Field>
        </Panel>

        <Panel className="flex flex-col gap-4">
          <Field label="Difficulté des bots">
            <Segmented value={c.globalDifficulty} options={DIFFS} onChange={(v) => set('globalDifficulty', v)} />
          </Field>
          <div className="flex flex-col gap-2">
            <span className="font-ui text-[15px] font-semibold text-ivory/85">Personnalités</span>
            <p className="text-sm leading-relaxed text-ivory/55">
              Chaque bot a son propre style, comme de vrais joueurs : certains bluffent, d’autres attendent les grosses mains,
              s’énervent après une mauvaise passe ou te parlent à table.
            </p>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {PERSONALITY_IDS.map((id) => (
                <li key={id} className="rounded-xl bg-black/25 px-3 py-2 ring-1 ring-white/[0.06]">
                  <div className="font-ui text-sm font-bold text-brass-200">{PERSONALITIES[id].name}</div>
                  <div className="text-xs leading-snug text-ivory/55">{PERSONALITIES[id].description}</div>
                </li>
              ))}
            </ul>
            <label className="mt-1 flex items-center gap-2 text-sm text-ivory/70">
              <input
                id="show-styles"
                type="checkbox"
                checked={c.showStyles !== false}
                onChange={(e) => set('showStyles', e.target.checked)}
                className="h-4 w-4 accent-[#d2ad62]"
              />
              Afficher le style de chaque bot à la table
            </label>
          </div>
          <button
            type="button"
            onClick={() => setPerBotOpen((o) => !o)}
            className="font-ui self-start text-[15px] font-semibold text-brass-300/90 underline-offset-4 hover:underline"
            aria-expanded={perBotOpen}
          >
            {perBotOpen ? 'Masquer le réglage bot par bot' : 'Choisir la difficulté et le style de chaque bot'}
          </button>
          {perBotOpen && (
            <div className="flex flex-col gap-2.5">
              {Array.from({ length: bots }, (_, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-2xl bg-black/25 p-3 ring-1 ring-white/[0.06]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-ui text-sm font-semibold text-ivory/70">Bot {i + 1}</span>
                    <select
                      id={`bot-style-${i}`}
                      value={c.perBotStyle?.[i] ?? 'random'}
                      onChange={(e) => {
                        const next = [...(c.perBotStyle ?? [])];
                        while (next.length < bots) next.push('random');
                        next[i] = e.target.value as StyleChoice;
                        set('perBotStyle', next);
                      }}
                      className="font-ui min-w-0 rounded-lg bg-black/40 px-2 py-1.5 text-sm font-semibold text-brass-200 outline-none ring-1 ring-brass-400/25 focus:ring-brass-400"
                      aria-label={`Style du bot ${i + 1}`}
                    >
                      <option value="random">Style au hasard</option>
                      {PERSONALITY_IDS.map((id) => (
                        <option key={id} value={id}>
                          {PERSONALITIES[id].name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Segmented
                    value={(c.perBot[i] ?? 'global') as BotDifficulty | 'global'}
                    options={[{ value: 'global', label: 'Global' }, ...DIFFS]}
                    onChange={(v) => {
                      const next = [...c.perBot];
                      while (next.length < bots) next.push('global');
                      next[i] = v;
                      set('perBot', next);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          <Field label="Vitesse des bots">
            <Segmented
              value={c.speed}
              options={[
                { value: 'normal', label: 'Normale' },
                { value: 'fast', label: 'Rapide' },
              ]}
              onChange={(v) => set('speed', v)}
            />
          </Field>
        </Panel>

        <Panel className="flex flex-col gap-5">
          <Field label="Tapis de départ">
            <Stepper
              value={stackIdx}
              min={0}
              max={STACKS.length - 1}
              onChange={(i) => set('startingStack', STACKS[i])}
              format={(i) => `${fmt(STACKS[i])} jetons`}
            />
          </Field>
          <Field label="Blindes" hint={`${Math.round(c.startingStack / c.bigBlind)} grosses blindes de tapis`}>
            <Stepper
              value={blindIdx}
              min={0}
              max={BLINDS.length - 1}
              onChange={(i) => setC((x) => ({ ...x, smallBlind: BLINDS[i].sb, bigBlind: BLINDS[i].bb }))}
              format={(i) => `${BLINDS[i].sb} / ${BLINDS[i].bb}`}
            />
          </Field>
          <Field label="Augmentation des blindes">
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                value={c.blindIncrease ? 'on' : 'off'}
                options={[
                  { value: 'off', label: 'Non' },
                  { value: 'on', label: 'Oui' },
                ]}
                onChange={(v) => set('blindIncrease', v === 'on')}
              />
              {c.blindIncrease && (
                <div className="flex items-center gap-2 text-sm text-white/60">
                  toutes les
                  <Stepper value={c.blindEvery} min={3} max={50} onChange={(v) => set('blindEvery', v)} />
                  mains
                </div>
              )}
            </div>
          </Field>
        </Panel>

        <PrimaryButton onClick={start} className="mt-2 text-lg">
          Lancer la partie
        </PrimaryButton>
      </div>
    </PageShell>
  );
}
