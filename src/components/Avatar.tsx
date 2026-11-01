// Médaillon avec l'initiale du joueur, dans une teinte stable dérivée de son identifiant.
const TINTS = [
  ['#8e1d2b', '#4e0d16'],
  ['#1f4fa3', '#0f2550'],
  ['#17784b', '#073a24'],
  ['#5b2f87', '#2b1446'],
  ['#9a5b1c', '#4a2709'],
  ['#2f6f7a', '#123a40'],
  ['#7a2f5b', '#3d1230'],
  ['#4a5a1e', '#22290b'],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({
  id,
  name,
  size = 40,
  hero = false,
  bot = false,
}: {
  id: string;
  name: string;
  size?: number;
  hero?: boolean;
  bot?: boolean;
}) {
  const [a, b] = hero ? ['#e3c681', '#8a6526'] : TINTS[hash(id) % TINTS.length];
  const letter = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <div
      className="relative flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 35% 30%, ${a}, ${b})`,
        boxShadow: 'inset 0 0 0 2px rgba(241,223,174,.55), inset 0 -3px 6px rgba(0,0,0,.35), 0 3px 8px rgba(0,0,0,.5)',
      }}
    >
      <span
        className="font-display font-bold leading-none"
        style={{ fontSize: size * 0.5, color: hero ? '#2a1c06' : '#fbf5e6', textShadow: hero ? 'none' : '0 1px 2px rgba(0,0,0,.4)' }}
      >
        {letter}
      </span>
      {bot && (
        <span
          className="font-ui absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-sm bg-night px-1 text-[8px] font-bold leading-[12px] text-brass-300 ring-1 ring-brass-500/50"
          aria-label="Bot"
        >
          Bot
        </span>
      )}
    </div>
  );
}
