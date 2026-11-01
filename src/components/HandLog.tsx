import { useEffect, useRef } from 'react';
import type { LogEntry } from '../lib/poker/index.ts';

const KIND_STYLE: Partial<Record<LogEntry['kind'], string>> = {
  street: 'text-gold-300 font-bold mt-1.5',
  win: 'text-emerald-300 font-semibold',
  showdown: 'text-white/90',
  fold: 'text-white/40',
  eliminated: 'text-red-400 font-semibold',
  return: 'text-white/45 italic',
  blind: 'text-white/50',
  allin: 'text-red-300 font-semibold',
  raise: 'text-amber-200',
  bet: 'text-amber-200',
  show: 'text-brass-200 italic',
};

export function HandLog({ log, handNumber }: { log: LogEntry[]; handNumber: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [log.length]);

  return (
    <div ref={box} className="scrollbar-thin h-full overflow-y-auto pr-1 text-[13px] leading-relaxed">
      {handNumber > 0 && <div className="mb-1 text-xs uppercase tracking-widest text-white/35">Main n°{handNumber}</div>}
      {log.length === 0 && <div className="text-white/35">Aucune action pour l'instant.</div>}
      {log.map((e, i) => (
        <div key={i} className={KIND_STYLE[e.kind] ?? 'text-white/80'}>
          {e.kind === 'street' ? `— ${e.text}` : e.text}
        </div>
      ))}
    </div>
  );
}
