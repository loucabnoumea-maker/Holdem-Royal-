import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { PlayingCard } from '../components/PlayingCard.tsx';
import type { Card } from '../lib/poker/cards.ts';
import { parseCards, sameCard } from '../lib/poker/cards.ts';

export function Section({ id, title, children, lead }: { id: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-display text-3xl font-bold text-brass-200 sm:text-4xl" style={{ textWrap: 'balance' }}>
        {title}
      </h2>
      {lead && <p className="mt-2 max-w-[62ch] text-[17px] leading-relaxed text-ivory/75">{lead}</p>}
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </section>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return <div className="flex max-w-[66ch] flex-col gap-3 text-[16px] leading-relaxed text-ivory/80 [&_b]:text-ivory">{children}</div>;
}

/** Encadré : astuce, attention, exemple. */
export function Note({ kind = 'tip', title, children }: { kind?: 'tip' | 'warn' | 'example'; title?: string; children: ReactNode }) {
  const style = {
    tip: 'border-brass-400/50 bg-brass-400/[0.07]',
    warn: 'border-ruby/60 bg-ruby/[0.08]',
    example: 'border-[#2c8a5d]/60 bg-[#0e3a28]/40',
  }[kind];
  const label = { tip: 'Astuce', warn: 'Attention', example: 'Exemple' }[kind];
  return (
    <div className={`max-w-[70ch] rounded-2xl border-l-4 px-4 py-3 ${style}`}>
      <div className="font-ui text-sm font-bold text-ivory/90">{title ?? label}</div>
      <div className="mt-1 text-[15px] leading-relaxed text-ivory/75">{children}</div>
    </div>
  );
}

/** Rangée de cartes à partir d'une notation « As Kd 7c ». */
export function Cards({
  cards,
  size = 18,
  highlight,
  overlap = false,
  dim,
}: {
  cards: string | Card[];
  size?: number;
  highlight?: Card[];
  overlap?: boolean;
  dim?: Card[];
}) {
  const list = typeof cards === 'string' ? parseCards(cards) : cards;
  return (
    <div className="flex flex-wrap items-end" style={{ gap: overlap ? 0 : size * 0.25 }}>
      {list.map((c, i) => (
        <div key={`${c.rank}${c.suit}${i}`} style={{ marginLeft: overlap && i ? -size * 1.1 : 0 }}>
          <PlayingCard
            card={c}
            size={size}
            animateDeal={false}
            highlight={highlight?.some((h) => sameCard(h, c))}
            dim={dim?.some((h) => sameCard(h, c))}
          />
        </div>
      ))}
    </div>
  );
}

/** Lecteur d'étapes : lecture automatique, précédent / suivant, recommencer. */
export function useStepper(count: number, intervalMs = 4500) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (i >= count - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setI((x) => Math.min(count - 1, x + 1)), intervalMs);
    return () => clearTimeout(t);
  }, [playing, i, count, intervalMs]);
  return {
    i,
    playing,
    play: () => {
      if (i >= count - 1) setI(0);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    next: () => {
      setPlaying(false);
      setI((x) => Math.min(count - 1, x + 1));
    },
    prev: () => {
      setPlaying(false);
      setI((x) => Math.max(0, x - 1));
    },
    restart: () => {
      setI(0);
      setPlaying(true);
    },
    goto: (n: number) => {
      setPlaying(false);
      setI(n);
    },
  };
}

export function StepperControls({ st, count, title, text }: { st: ReturnType<typeof useStepper>; count: number; title: string; text: string }) {
  const btn = 'font-ui rounded-full px-4 py-2 text-[15px] font-semibold ring-1 transition disabled:opacity-30';
  return (
    <div className="flex flex-col gap-3">
      <div className="min-h-[5.5em]" aria-live="polite">
        <div className="font-ui text-sm text-ivory/50">
          Étape {st.i + 1} sur {count}
        </div>
        <div className="font-display text-xl font-bold text-brass-200">{title}</div>
        <p className="mt-1 max-w-[70ch] text-[15px] leading-relaxed text-ivory/80">{text}</p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-brass-400 transition-all duration-500" style={{ width: `${((st.i + 1) / count) * 100}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={st.prev} disabled={st.i === 0} className={`${btn} bg-black/30 text-ivory/85 ring-white/15`}>
          Précédent
        </button>
        {st.playing ? (
          <button onClick={st.pause} className={`${btn} btn-brass ring-transparent`}>
            Pause
          </button>
        ) : (
          <button onClick={st.play} className={`${btn} btn-brass ring-transparent`}>
            {st.i >= count - 1 ? 'Revoir' : st.i === 0 ? 'Lancer la démo' : 'Reprendre'}
          </button>
        )}
        <button onClick={st.next} disabled={st.i >= count - 1} className={`${btn} bg-black/30 text-ivory/85 ring-white/15`}>
          Suivant
        </button>
      </div>
    </div>
  );
}

/** Cadre de démonstration. */
export function DemoFrame({ children, label = 'Démonstration' }: { children: ReactNode; label?: string }) {
  return (
    <div className="panel overflow-hidden rounded-3xl p-4 sm:p-6">
      <div className="font-ui mb-3 inline-flex items-center gap-2 rounded-full bg-ruby/90 px-3 py-0.5 text-sm font-bold text-white">
        <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden />
        {label}
      </div>
      {children}
    </div>
  );
}

/** Glossaire en liste de définitions. */
export function Glossary({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid max-w-[72ch] grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[minmax(9rem,auto)_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-ui text-[16px] font-bold text-brass-200">{k}</dt>
          <dd className="text-[15px] leading-relaxed text-ivory/75">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
