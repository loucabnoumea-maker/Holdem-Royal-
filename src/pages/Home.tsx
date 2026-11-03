import { PlayingCard } from '../components/PlayingCard.tsx';
import { navigate } from '../lib/router.ts';
import { parseCards } from '../lib/poker/index.ts';

const ROYAL = parseCards('Ts Js Qs Ks As');

// Version « fichier unique » (aperçu partageable) : le mode en ligne demande la version déployée.
const ONLINE_AVAILABLE = import.meta.env.MODE !== 'single';

export function Home() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center px-[max(20px,env(safe-area-inset-left))] py-10">
      {/* Main de départ : quinte flush royale posée sur un ovale de feutre */}
      <div className="relative mb-8 flex h-56 w-full max-w-sm items-end justify-center sm:h-64">
        <div className="felt absolute inset-x-2 bottom-0 h-40 rounded-[50%] opacity-90 ring-1 ring-brass-400/30 sm:h-44" />
        <div className="relative mb-10 flex">
          {ROYAL.map((c, i) => (
            <div
              key={i}
              className="origin-bottom"
              style={{
                transform: `rotate(${(i - 2) * 9}deg) translateY(${Math.abs(i - 2) * 6}px)`,
                marginLeft: i ? '-2.2rem' : 0,
              }}
            >
              <PlayingCard card={c} size="lg" dealDelay={150 + i * 110} />
            </div>
          ))}
        </div>
      </div>

      <h1 className="fade-up text-center font-display text-6xl font-bold italic leading-none text-brass-200 sm:text-7xl" style={{ textWrap: 'balance' }}>
        Hold'em Royal
      </h1>
      <p className="fade-up font-ui mt-4 text-center text-lg text-ivory/60" style={{ animationDelay: '120ms' }}>
        Poker Texas Hold'em et Blackjack, contre des bots ou entre amis.
      </p>

      <nav className="fade-up mt-10 flex w-full flex-col gap-3" style={{ animationDelay: '220ms' }}>
        <MenuButton suit="♠" title="Jouer seul" text="Contre 1 à 8 bots, de Facile à Difficile" onClick={() => navigate('/solo')} primary />
        {ONLINE_AVAILABLE ? (
          <>
            <MenuButton suit="♥" red title="Créer une partie" text="Un code à 6 caractères à partager avec tes amis" onClick={() => navigate('/online/create')} />
            <MenuButton suit="♦" red title="Rejoindre une partie" text="Entre le code reçu et ton pseudo" onClick={() => navigate('/online/join')} />
          </>
        ) : (
          <div className="panel rounded-2xl p-4 text-sm text-ivory/55">
            <b className="font-ui text-base text-ivory/85">Parties entre amis</b>
            <br />
            Disponibles sur la version déployée avec Supabase (guide SUPABASE.md du projet).
          </div>
        )}
        <MenuButton suit="♣" title="Blackjack" text="Bats le croupier, avec conseils de stratégie" onClick={() => navigate('/blackjack')} />
      </nav>

      <div className="fade-up font-ui mt-6 flex w-full gap-3" style={{ animationDelay: '300ms' }}>
        <button onClick={() => navigate('/regles/poker')} className="flex-1 rounded-2xl bg-white/[0.06] px-4 py-3 text-[15px] font-semibold text-ivory/85 ring-1 ring-white/15 hover:bg-white/10">
          📖 Règles du Hold'em
        </button>
        <button onClick={() => navigate('/regles/blackjack')} className="flex-1 rounded-2xl bg-white/[0.06] px-4 py-3 text-[15px] font-semibold text-ivory/85 ring-1 ring-white/15 hover:bg-white/10">
          📖 Règles du Blackjack
        </button>
      </div>

      <p className="font-ui mt-10 text-center text-sm text-ivory/35">Jetons fictifs uniquement. Aucun argent réel, aucun achat.</p>
    </div>
  );
}

function MenuButton({
  suit,
  red,
  title,
  text,
  onClick,
  primary,
}: {
  suit: string;
  red?: boolean;
  title: string;
  text: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`btn-lacquer group flex items-center gap-4 p-4 text-left ${primary ? 'btn-brass' : 'btn-raise'}`}
    >
      <span
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-display text-3xl leading-none ${
          primary ? 'bg-[#2a1c06]/15' : 'bg-ivory'
        }`}
        style={{ color: primary ? '#2a1c06' : red ? '#c0202c' : '#16181d' }}
        aria-hidden
      >
        {suit}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xl font-bold">{title}</span>
        <span className={`block font-sans text-sm font-medium ${primary ? 'text-[#2a1c06]/70' : 'text-ivory/55'}`}>{text}</span>
      </span>
    </button>
  );
}
