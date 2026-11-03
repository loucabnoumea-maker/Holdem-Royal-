import { useEffect, useState } from 'react';
import { navigate } from '../lib/router.ts';
import { BLACKJACK_TOC, BlackjackRules } from '../rules/BlackjackRules.tsx';
import { POKER_TOC, PokerRules } from '../rules/PokerRules.tsx';

type Game = 'poker' | 'blackjack';

export default function Rules({ game }: { game: Game }) {
  const toc: readonly (readonly [string, string])[] = game === 'poker' ? POKER_TOC : BLACKJACK_TOC;
  const [active, setActive] = useState<string>(toc[0][0]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    setActive(toc[0][0]);
  }, [game, toc]);

  // Surligne la section visible dans le sommaire.
  useEffect(() => {
    const els = toc.map(([id]) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [game, toc]);

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0b1512]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <button onClick={() => navigate('/')} className="font-ui rounded-full bg-white/[0.07] px-4 py-2 text-[15px] font-semibold text-ivory/85 ring-1 ring-white/15 hover:bg-white/15">
            ← Accueil
          </button>
          <div className="flex rounded-full bg-black/40 p-1 ring-1 ring-white/10">
            {(
              [
                ['poker', "Hold'em"],
                ['blackjack', 'Blackjack'],
              ] as const
            ).map(([g, label]) => (
              <button
                key={g}
                onClick={() => navigate(`/regles/${g}`)}
                className={`font-ui rounded-full px-4 py-1.5 text-[15px] font-bold transition ${game === g ? 'btn-brass' : 'text-ivory/70 hover:text-ivory'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => navigate(game === 'poker' ? '/solo' : '/blackjack')}
            className="btn-lacquer btn-brass ml-auto hidden px-5 py-2 text-[15px] sm:block"
          >
            Jouer
          </button>
        </div>
        {/* Sommaire horizontal sur mobile / tablette */}
        <nav className="flex gap-1.5 overflow-x-auto px-4 pb-2.5 lg:hidden" aria-label="Sommaire">
          {toc.map(([id, label]) => (
            <button
              key={id}
              onClick={() => go(id)}
              className={`font-ui shrink-0 rounded-full px-3 py-1 text-sm font-semibold ring-1 ${active === id ? 'bg-brass-400/20 text-brass-200 ring-brass-400/50' : 'text-ivory/60 ring-white/10'}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-24 pt-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 flex flex-col gap-0.5" aria-label="Sommaire">
            <div className="font-ui mb-2 text-xs font-bold uppercase tracking-widest text-ivory/40">Sommaire</div>
            {toc.map(([id, label]) => (
              <button
                key={id}
                onClick={() => go(id)}
                className={`font-ui rounded-lg border-l-2 px-3 py-1.5 text-left text-[15px] transition ${active === id ? 'border-brass-400 bg-brass-400/10 font-bold text-brass-200' : 'border-transparent text-ivory/60 hover:text-ivory'}`}
              >
                {label}
              </button>
            ))}
          </nav>
        </aside>
        <main className="min-w-0">
          <h1 className="font-display mb-10 text-5xl font-bold italic text-ivory sm:text-6xl">
            Règles du {game === 'poker' ? "Texas Hold'em" : 'Blackjack'}
          </h1>
          {game === 'poker' ? <PokerRules /> : <BlackjackRules />}
        </main>
      </div>
    </div>
  );
}
