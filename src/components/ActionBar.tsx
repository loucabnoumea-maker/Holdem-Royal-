import { useEffect, useState } from 'react';
import type { LegalActions, PlayerAction } from '../lib/poker/index.ts';
import { fmt } from '../lib/prefs.ts';

interface Props {
  legal: LegalActions | null;
  bigBlind: number;
  onAction: (a: PlayerAction) => void;
  /** Texte affiché quand ce n'est pas au joueur de parler. */
  waitingText?: string;
}

export function ActionBar({ legal, bigBlind, onAction, waitingText = 'En attente des autres joueurs…' }: Props) {
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [amount, setAmount] = useState(0);

  // Réinitialise le montant à chaque nouvelle décision
  const key = legal ? `${legal.playerId}-${legal.currentBet}-${legal.pot}` : 'none';
  useEffect(() => {
    if (legal) setAmount(legal.minRaiseTo);
    setRaiseOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Raccourcis clavier (ordinateur) : F = se coucher, C = check/suivre, R = relancer
  useEffect(() => {
    if (!legal) return;
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === 'f' && !legal.canCheck) onAction({ type: 'fold' });
      else if (k === 'c') onAction(legal.canCheck ? { type: 'check' } : { type: 'call' });
      else if (k === 'r' && legal.canRaise) setRaiseOpen((o) => !o);
      else if (k === 'enter' && raiseOpen) confirmRaise();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  if (!legal) {
    return (
      <div className="flex h-16 items-center justify-center text-sm text-white/45">
        <span className="animate-pulse">{waitingText}</span>
      </div>
    );
  }

  const base = legal.currentBet;
  const potAfterCall = legal.pot + legal.callAmount;
  const clamp = (v: number) => Math.round(Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, v)));
  const presets: { label: string; value: number }[] = [
    { label: 'Min', value: legal.minRaiseTo },
    { label: '½ pot', value: clamp(base + potAfterCall / 2) },
    { label: '¾ pot', value: clamp(base + (potAfterCall * 3) / 4) },
    { label: 'Pot', value: clamp(base + potAfterCall) },
    { label: 'Tapis', value: legal.maxRaiseTo },
  ];
  const onlyAllIn = legal.minRaiseTo >= legal.maxRaiseTo;
  const isAllIn = amount >= legal.maxRaiseTo;
  const pct = legal.maxRaiseTo > legal.minRaiseTo ? ((amount - legal.minRaiseTo) / (legal.maxRaiseTo - legal.minRaiseTo)) * 100 : 100;

  function confirmRaise() {
    if (!legal) return;
    const v = clamp(amount);
    onAction(v >= legal.maxRaiseTo ? { type: 'allin' } : { type: legal.isBet ? 'bet' : 'raise', amount: v });
  }

  const raiseVerb = legal.isBet ? 'Miser' : 'Relancer';
  const step = Math.max(1, Math.round(bigBlind / 2));

  return (
    <div className="fade-up relative mx-auto w-full max-w-2xl">
      {raiseOpen && legal.canRaise && !onlyAllIn && (
        <div className="panel pop-in absolute inset-x-0 bottom-full z-40 mb-2 rounded-2xl p-3 shadow-2xl">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-ui text-sm text-ivory/60">{raiseVerb === 'Miser' ? 'Mise' : 'Relance à'}</span>
            <span className="font-display text-2xl font-bold tabular-nums text-brass-200">{fmt(amount)}</span>
          </div>
          <div className="mb-2 grid grid-cols-5 gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => setAmount(p.value)}
                className={`font-ui rounded-lg py-2 text-sm font-bold transition ${
                  amount === p.value ? 'btn-brass' : 'bg-white/[0.07] text-ivory/85 ring-1 ring-white/10 hover:bg-white/[0.12]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAmount((a) => clamp(a - step))}
              className="h-9 w-9 shrink-0 rounded-full bg-white/10 text-lg font-bold text-ivory ring-1 ring-white/10"
              aria-label="Diminuer"
            >
              −
            </button>
            <input
              type="range"
              className="raise-slider w-full"
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              step={1}
              value={amount}
              style={{ ['--pct' as string]: `${pct}%` }}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
            <button
              onClick={() => setAmount((a) => clamp(a + step))}
              className="h-9 w-9 shrink-0 rounded-full bg-white/10 text-lg font-bold text-ivory ring-1 ring-white/10"
              aria-label="Augmenter"
            >
              +
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => onAction({ type: 'fold' })}
          disabled={legal.canCheck}
          className="btn-lacquer btn-fold py-4 text-lg disabled:opacity-30"
        >
          Se coucher
        </button>
        <button
          onClick={() => onAction(legal.canCheck ? { type: 'check' } : { type: 'call' })}
          className="btn-lacquer btn-call py-4 text-lg"
        >
          {legal.canCheck ? 'Check' : `Suivre ${fmt(legal.callAmount)}`}
        </button>
        {legal.canRaise ? (
          onlyAllIn ? (
            <button
              onClick={() => onAction({ type: 'allin' })}
              className="btn-lacquer btn-brass py-4 text-lg"
            >
              Tapis {fmt(legal.maxRaiseTo)}
            </button>
          ) : raiseOpen ? (
            <button
              onClick={confirmRaise}
              className="btn-lacquer btn-brass py-4 text-lg"
            >
              {isAllIn ? `Tapis ${fmt(amount)}` : `${raiseVerb} ${fmt(amount)}`}
            </button>
          ) : (
            <button
              onClick={() => setRaiseOpen(true)}
              className="btn-lacquer btn-raise py-4 text-lg"
            >
              {raiseVerb}
            </button>
          )
        ) : (
          <button disabled className="btn-lacquer btn-raise py-4 text-lg opacity-30">
            {raiseVerb}
          </button>
        )}
      </div>
      {raiseOpen && (
        <button onClick={() => setRaiseOpen(false)} className="font-ui mt-1.5 w-full text-center text-sm text-ivory/45 hover:text-ivory/70">
          Annuler la relance
        </button>
      )}
    </div>
  );
}
