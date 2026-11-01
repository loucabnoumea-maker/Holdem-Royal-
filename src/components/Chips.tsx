// Piles de jetons de casino dessinées en SVG, réparties par valeur.
import { fmt } from '../lib/prefs.ts';

const DENOMS = [
  { v: 25000, body: '#5a3a1e', edge: '#f1dfae' },
  { v: 5000, body: '#7a5a24', edge: '#fbf5e6' },
  { v: 1000, body: '#d29a2b', edge: '#3a2508' },
  { v: 500, body: '#5b2f87', edge: '#fbf5e6' },
  { v: 100, body: '#1c1c22', edge: '#e3c681' },
  { v: 25, body: '#17784b', edge: '#fbf5e6' },
  { v: 5, body: '#b3232f', edge: '#fbf5e6' },
  { v: 1, body: '#e9e4d6', edge: '#1f4fa3' },
];

/** Décompose un montant en colonnes de jetons (3 colonnes, 8 jetons max chacune). */
function breakdown(amount: number) {
  const cols: { body: string; edge: string; n: number }[] = [];
  let rest = amount;
  for (const d of DENOMS) {
    if (rest < d.v) continue;
    const n = Math.floor(rest / d.v);
    rest -= n * d.v;
    cols.push({ body: d.body, edge: d.edge, n: Math.min(n, 8) });
    if (cols.length === 3) break;
  }
  if (!cols.length) cols.push({ body: DENOMS[DENOMS.length - 1].body, edge: DENOMS[DENOMS.length - 1].edge, n: 1 });
  return cols;
}

function Stack({ body, edge, n, x }: { body: string; edge: string; n: number; x: number }) {
  const chips = [];
  for (let i = 0; i < n; i++) {
    const y = 34 - i * 3.4;
    chips.push(
      <g key={i}>
        <path d={`M${x - 10} ${y} v3.4 a10 4 0 0 0 20 0 v-3.4`} fill={body} />
        <path d={`M${x - 10} ${y} v3.4 a10 4 0 0 0 20 0 v-3.4`} fill="rgba(0,0,0,.28)" />
        <rect x={x - 6.5} y={y + 2.4} width="2.6" height="3.2" fill={edge} opacity=".9" />
        <rect x={x - 1.3} y={y + 3.2} width="2.6" height="3.2" fill={edge} opacity=".9" />
        <rect x={x + 3.9} y={y + 2.4} width="2.6" height="3.2" fill={edge} opacity=".9" />
        <ellipse cx={x} cy={y} rx="10" ry="4" fill={body} />
        {i === n - 1 && (
          <>
            <ellipse cx={x} cy={y} rx="8.6" ry="3.3" fill="none" stroke={edge} strokeWidth="1.2" strokeDasharray="2.2 2.4" />
            <ellipse cx={x} cy={y} rx="5.2" ry="2" fill="rgba(255,255,255,.12)" stroke={edge} strokeOpacity=".6" strokeWidth=".5" />
          </>
        )}
      </g>,
    );
  }
  return <>{chips}</>;
}

export function ChipStack({ amount, scale = 1, label = true }: { amount: number; scale?: number; label?: boolean }) {
  const cols = breakdown(amount);
  const width = cols.length * 21 + 2;
  return (
    <div className="flex items-center gap-1">
      <svg viewBox={`0 0 ${width} 42`} width={width * scale} height={42 * scale} aria-hidden className="drop-shadow-[0_3px_3px_rgba(0,0,0,.55)]">
        {cols.map((c, i) => (
          <Stack key={i} {...c} x={11 + i * 21} />
        ))}
      </svg>
      {label && (
        <span className="font-ui rounded-md bg-black/60 px-1.5 py-px text-[11px] font-bold tabular-nums text-ivory ring-1 ring-white/10 sm:text-xs">
          {fmt(amount)}
        </span>
      )}
    </div>
  );
}

/** Petit jeton isolé (icône). */
export function ChipIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="11" fill="#8e1d2b" />
      <circle cx="12" cy="12" r="11" fill="none" stroke="#fbf5e6" strokeWidth="3" strokeDasharray="4.3 4.3" />
      <circle cx="12" cy="12" r="6.5" fill="#6e1621" stroke="#e3c681" strokeWidth="1" />
    </svg>
  );
}
