// Jeton de casino cliquable (vu de dessus), pour choisir une mise.
import type { MouseEvent } from 'react';
import { fmt } from '../lib/prefs.ts';

export const CHIP_COLORS: Record<number, { body: string; edge: string; text: string }> = {
  1: { body: '#e9e4d6', edge: '#1f4fa3', text: '#1f2a44' },
  5: { body: '#b3232f', edge: '#fbf5e6', text: '#fbf5e6' },
  10: { body: '#1f4fa3', edge: '#fbf5e6', text: '#fbf5e6' },
  25: { body: '#1f8f58', edge: '#fbf5e6', text: '#fbf5e6' },
  100: { body: '#1c1c22', edge: '#e3c681', text: '#e3c681' },
  500: { body: '#5b2f87', edge: '#fbf5e6', text: '#fbf5e6' },
  1000: { body: '#d29a2b', edge: '#3a2508', text: '#2a1c06' },
};

export function chipColor(v: number) {
  return CHIP_COLORS[v] ?? CHIP_COLORS[100];
}

interface Props {
  value: number;
  size?: number;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  label?: string;
}

export function BetChip({ value, size = 56, onClick, disabled, label }: Props) {
  const c = chipColor(value);
  const inner = (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      <circle cx="50" cy="52" r="47" fill="rgba(0,0,0,.45)" />
      <circle cx="50" cy="50" r="47" fill={c.body} />
      <circle cx="50" cy="50" r="47" fill="none" stroke={c.edge} strokeWidth="10" strokeDasharray="14.76 14.76" />
      <circle cx="50" cy="50" r="47.5" fill="none" stroke="rgba(0,0,0,.55)" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="33" fill={c.body} stroke={c.edge} strokeOpacity=".7" strokeWidth="2" />
      <circle cx="50" cy="50" r="28" fill="none" stroke={c.edge} strokeOpacity=".35" strokeWidth="1" strokeDasharray="3 3" />
      <text
        x="50"
        y="51"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Barlow Semi Condensed, Barlow, sans-serif"
        fontWeight="800"
        fontSize={value >= 1000 ? 22 : 28}
        fill={c.text}
      >
        {label ?? fmt(value)}
      </text>
    </svg>
  );
  if (!onClick) return <span className="inline-block">{inner}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Ajouter ${value} à la mise`}
      className="rounded-full transition hover:-translate-y-1 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
      style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.5))' }}
    >
      {inner}
    </button>
  );
}

/** Pile de jetons de mise posée sur la table, avec le montant. */
export function BetPile({ amount, size = 46 }: { amount: number; size?: number }) {
  const parts: number[] = [];
  let rest = amount;
  for (const v of [1000, 500, 100, 25, 10, 5, 1]) {
    while (rest >= v && parts.length < 7) {
      parts.push(v);
      rest -= v;
    }
  }
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size + parts.length * 4 }}>
        {parts.reverse().map((v, i) => (
          <div key={i} className="absolute left-0" style={{ bottom: i * 4 }}>
            <BetChip value={v} size={size} label="" />
          </div>
        ))}
      </div>
      <span className="font-ui mt-1 rounded-md bg-black/65 px-2 text-sm font-bold tabular-nums text-ivory ring-1 ring-white/10">
        {fmt(amount)}
      </span>
    </div>
  );
}
