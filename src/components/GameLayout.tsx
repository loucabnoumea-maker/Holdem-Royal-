import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { isSoundOn, setSoundOn } from '../lib/sound.ts';

export interface SideTab {
  id: string;
  label: string;
  badge?: number;
  content: ReactNode;
}

interface Props {
  title: string;
  subtitle?: string;
  onQuit: () => void;
  table: ReactNode;
  actions: ReactNode;
  tabs: SideTab[];
  overlay?: ReactNode;
  headerExtra?: ReactNode;
}

/** Grand écran paysage : boutons d'action posés sur la table, en bas à droite. */
function useWide() {
  const read = () => typeof window !== 'undefined' && window.innerWidth >= 1000 && window.innerWidth / window.innerHeight >= 1.2;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    const on = () => setWide(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return wide;
}

export function GameLayout({ title, subtitle, onQuit, table, actions, tabs, overlay, headerExtra }: Props) {
  const [sound, setSound] = useState(isSoundOn());
  const [tab, setTab] = useState(tabs[0]?.id);
  const [drawer, setDrawer] = useState(false);
  const [panel, setPanel] = useState(false);
  const wide = useWide();
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];
  const totalBadge = tabs.reduce((s, t) => s + (t.badge ?? 0), 0);

  const tabBar = (
    <div className="flex gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={`font-ui relative rounded-lg px-3 py-1.5 text-[15px] font-semibold ${
            t.id === active?.id ? 'bg-brass-400/15 text-brass-200' : 'text-ivory/45 hover:text-ivory/80'
          }`}
        >
          {t.label}
          {!!t.badge && <span className="ml-1.5 rounded-full bg-ruby px-1.5 text-[10px] text-white">{t.badge}</span>}
        </button>
      ))}
    </div>
  );

  const iconBtn = 'flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-brass-200 ring-1 ring-brass-400/25 hover:bg-black/55';

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="relative z-30 flex shrink-0 items-center gap-2 px-[max(12px,env(safe-area-inset-left))] pb-1 pt-[max(6px,env(safe-area-inset-top))]">
        <button
          onClick={onQuit}
          className="font-ui rounded-full bg-black/35 px-3.5 py-1.5 text-[15px] font-semibold text-ivory/80 ring-1 ring-brass-400/25 hover:text-ivory"
        >
          Quitter
        </button>
        <div className="min-w-0 flex-1 text-center leading-tight">
          <div className="truncate font-display text-lg font-bold text-brass-200">{title}</div>
          {subtitle && <div className="font-ui truncate text-xs text-ivory/55 sm:text-sm">{subtitle}</div>}
        </div>
        {headerExtra}
        <button
          onClick={() => {
            setSoundOn(!sound);
            setSound(!sound);
          }}
          className={iconBtn}
          aria-label={sound ? 'Couper le son' : 'Activer le son'}
          title={sound ? 'Couper le son' : 'Activer le son'}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
            {sound ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : <path d="M17 9l5 6M22 9l-5 6" />}
          </svg>
        </button>
        <button
          onClick={() => (wide ? setPanel((v) => !v) : setDrawer(true))}
          className={`relative ${iconBtn}`}
          aria-label="Historique et chat"
          aria-expanded={wide ? panel : drawer}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M5 7h14M5 12h14M5 17h9" />
          </svg>
          {totalBadge > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-ruby px-1.5 text-[10px] font-bold">{totalBadge}</span>}
        </button>
      </header>

      <main className="relative min-h-0 flex-1">
        <div className="absolute inset-0 px-1 sm:px-2">{table}</div>

        {wide && (
          <>
            <div className="absolute bottom-4 right-4 z-40 w-[min(460px,34vw)]">{actions}</div>
            {/* Historique / chat repliable, en bas à gauche */}
            {panel ? (
              <div className="panel fade-up absolute bottom-4 left-4 z-40 flex h-[42%] w-[min(360px,28vw)] flex-col rounded-2xl p-3">
                <div className="mb-2 flex items-center justify-between border-b border-brass-400/15 pb-2">
                  {tabBar}
                  <button onClick={() => setPanel(false)} className="ml-2 text-2xl leading-none text-ivory/50 hover:text-ivory" aria-label="Fermer">
                    ×
                  </button>
                </div>
                <div className="min-h-0 flex-1">{active?.content}</div>
              </div>
            ) : (
              <button
                onClick={() => setPanel(true)}
                className="font-ui absolute bottom-4 left-4 z-40 rounded-full bg-black/45 px-4 py-2 text-[15px] font-semibold text-ivory/75 ring-1 ring-brass-400/25 hover:text-ivory"
              >
                {tabs.map((t) => t.label).join(' · ')}
                {totalBadge > 0 && <span className="ml-2 rounded-full bg-ruby px-1.5 text-[11px] text-white">{totalBadge}</span>}
              </button>
            )}
          </>
        )}
      </main>

      {!wide && (
        <div className="relative z-40 shrink-0 px-[max(12px,env(safe-area-inset-left))] pb-[max(10px,env(safe-area-inset-bottom))] pt-1.5">
          {actions}
        </div>
      )}

      {drawer && !wide && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={() => setDrawer(false)}>
          <div
            className="fade-up flex h-[70dvh] flex-col rounded-t-3xl bg-night-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] ring-1 ring-brass-400/20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between border-b border-brass-400/15 pb-2">
              {tabBar}
              <button onClick={() => setDrawer(false)} className="ml-2 text-2xl text-white/50" aria-label="Fermer">
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1">{active?.content}</div>
          </div>
        </div>
      )}
      {overlay}
    </div>
  );
}

export function Modal({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="panel pop-in w-full max-w-sm rounded-3xl p-7 text-center">{children}</div>
    </div>
  );
}
