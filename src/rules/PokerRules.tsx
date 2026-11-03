import { useMemo, useState } from 'react';
import { Table } from '../components/Table.tsx';
import type { SeatMeta } from '../components/Table.tsx';
import { Segmented } from '../components/ui.tsx';
import type { Card } from '../lib/poker/cards.ts';
import { parseCards, shuffledDeck } from '../lib/poker/cards.ts';
import { compareHands, evaluateHand } from '../lib/poker/evaluator.ts';
import { computePots } from '../lib/poker/pots.ts';
import { fmt } from '../lib/prefs.ts';
import { navigate } from '../lib/router.ts';
import { Cards, DemoFrame, Glossary, Note, Prose, Section, StepperControls, useStepper } from './common.tsx';
import { buildPokerDemo, POKER_DEMO_PLAYERS } from './demos.ts';

export const POKER_TOC = [
  ['but', 'Le but du jeu'],
  ['positions', 'Bouton, blindes et ordre de parole'],
  ['main', 'Une main en direct'],
  ['actions', 'Les actions'],
  ['combinaisons', 'Les combinaisons'],
  ['departage', 'Égalités et kickers'],
  ['pots', 'Tapis et pots secondaires'],
  ['debuter', 'Conseils pour débuter'],
  ['lexique', 'Lexique'],
] as const;

export function PokerRules() {
  return (
    <div className="flex flex-col gap-16">
      <Section id="but" title="Le but du jeu" lead="Gagner les jetons des autres joueurs. Pour remporter un pot, il y a deux façons.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="panel rounded-2xl p-4">
            <div className="font-ui text-lg font-bold text-brass-200">1. Avoir la meilleure main</div>
            <p className="mt-1 text-[15px] leading-relaxed text-ivory/75">
              À la fin, les joueurs encore en jeu montrent leurs cartes (l'abattage). La meilleure combinaison de 5 cartes gagne le pot.
            </p>
          </div>
          <div className="panel rounded-2xl p-4">
            <div className="font-ui text-lg font-bold text-brass-200">2. Faire coucher tout le monde</div>
            <p className="mt-1 text-[15px] leading-relaxed text-ivory/75">
              Si tu mises et que tous les autres abandonnent, tu gagnes le pot sans montrer tes cartes, même avec une main faible : c'est le bluff.
            </p>
          </div>
        </div>
        <Prose>
          <p>
            Chaque joueur reçoit <b>2 cartes privées</b>. Cinq <b>cartes communes</b> sont ensuite posées au centre, en trois fois. Ta main finale, ce
            sont les <b>5 meilleures cartes</b> parmi tes 2 cartes et les 5 du tableau : tu peux utiliser 2, 1 ou même 0 de tes cartes.
          </p>
          <p>
            En « No Limit », tu peux miser n'importe quel montant à tout moment, jusqu'à tout ton tapis. La partie s'arrête quand un seul joueur a tous les jetons.
          </p>
        </Prose>
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <div className="font-ui mb-2 text-sm text-ivory/55">Tes 2 cartes</div>
            <Cards cards="Ah Kh" size={22} />
          </div>
          <div>
            <div className="font-ui mb-2 text-sm text-ivory/55">Les 5 cartes communes</div>
            <Cards cards="Qh Jh 2c Th 7s" size={22} />
          </div>
          <div>
            <div className="font-ui mb-2 text-sm text-ivory/55">Ta meilleure main : quinte flush royale</div>
            <Cards cards="Ah Kh Qh Jh Th" size={22} highlight={parseCards('Ah Kh Qh Jh Th')} />
          </div>
        </div>
      </Section>

      <Section
        id="positions"
        title="Bouton, blindes et ordre de parole"
        lead="Le bouton (D) indique le donneur. Il avance d'une place vers la gauche à chaque main, pour que tout le monde passe par chaque position."
      >
        <PositionsDiagram />
        <Note kind="tip" title="Pourquoi la position compte">
          Parler en dernier est un gros avantage : tu sais déjà ce que les autres ont fait avant de décider. C'est pour ça qu'on joue plus de mains
          au bouton qu'en première position.
        </Note>
      </Section>

      <Section
        id="main"
        title="Une main en direct"
        lead="Suis une vraie main jouée par le moteur du jeu, étape par étape. Toutes les cartes sont visibles pour que tu comprennes chaque décision."
      >
        <PokerDemo />
      </Section>

      <Section id="actions" title="Les actions" lead="Quand c'est ton tour, tu as le choix entre ces actions.">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['Se coucher', "Tu abandonnes la main et les jetons déjà misés. Utile quand ta main est faible face à une mise."],
            ['Check', "Tu passes la parole sans miser. Possible seulement si personne n'a misé avant toi dans ce tour."],
            ['Miser', "Tu mets des jetons au pot alors que personne n'a encore misé. Mise minimale : une grosse blinde."],
            ['Suivre', 'Tu égalises la mise la plus haute du tour pour rester dans le coup.'],
            ['Relancer', "Tu augmentes la mise. La relance doit être au moins aussi grande que la précédente : si quelqu'un mise 20 de plus, tu dois relancer d'au moins 20."],
            ['Tapis (all-in)', "Tu mets tous tes jetons. Si tu n'as pas assez pour suivre, tu peux quand même aller à tapis : tu ne joues alors que pour une partie du pot."],
          ].map(([t, d]) => (
            <div key={t} className="panel rounded-2xl p-4">
              <div className="font-ui text-lg font-bold text-brass-200">{t}</div>
              <p className="mt-1 text-[15px] leading-relaxed text-ivory/75">{d}</p>
            </div>
          ))}
        </div>
        <Note kind="example" title="Exemple de relance minimale">
          Blindes 5/10. Max mise 10 (grosse blinde). Nora relance à 30, soit 20 de plus. Pour relancer à son tour, tu dois aller à au moins 50 (30 + 20).
        </Note>
        <Prose>
          <p>
            Un tour d'enchères se termine quand tous les joueurs encore en jeu ont misé la même somme (ou sont à tapis). On passe alors au tour suivant :
          </p>
        </Prose>
        <ol className="grid gap-2 sm:grid-cols-4">
          {[
            ['Préflop', '2 cartes privées, aucune carte commune.'],
            ['Flop', '3 cartes communes retournées.'],
            ['Turn', '4e carte commune.'],
            ['River', '5e et dernière carte, puis l’abattage.'],
          ].map(([t, d], i) => (
            <li key={t} className="panel rounded-2xl p-3">
              <div className="font-ui text-sm text-ivory/50">Tour {i + 1}</div>
              <div className="font-display text-lg font-bold text-brass-200">{t}</div>
              <div className="text-sm text-ivory/70">{d}</div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="combinaisons" title="Les combinaisons" lead="De la plus forte à la plus faible. Une combinaison plus haute bat toujours une plus basse.">
        <HandRankings />
      </Section>

      <Section
        id="departage"
        title="Égalités et kickers"
        lead="Si deux joueurs ont la même combinaison, on compare d'abord la hauteur de la combinaison, puis les cartes restantes (les « kickers »), une par une."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <KickerExample
            title="Même paire, le kicker décide"
            board="Kd 9s 6c 3h 2d"
            a="Ks Ac"
            b="Kh Qc"
            text="Les deux ont une paire de Rois. On compare les cartes suivantes : As contre Dame. Le premier gagne."
          />
          <KickerExample
            title="Le tableau joue : partage"
            board="Ts Js Qs Ks As"
            a="2h 3d"
            b="7c 7h"
            text="La quinte flush royale est sur le tableau et personne ne fait mieux : les deux joueurs jouent les 5 cartes communes et se partagent le pot."
          />
          <KickerExample
            title="La couleur ne départage jamais"
            board="9h 8d 7c 2s 2c"
            a="Th 6h"
            b="Tc 6d"
            text="Mêmes quintes au 10. Il n'y a pas de couleur plus forte qu'une autre au poker : égalité parfaite."
          />
        </div>
        <ShowdownTrainer />
      </Section>

      <Section
        id="pots"
        title="Tapis et pots secondaires"
        lead="Un joueur à tapis ne peut gagner que ce qu'il a pu égaler chez chaque adversaire. Le reste forme un pot secondaire entre les autres."
      >
        <SidePotExample />
      </Section>

      <Section id="debuter" title="Conseils pour débuter">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['Joue moins de mains', 'Les débutants jouent beaucoup trop de mains. Avec 6 joueurs, une main sur quatre suffit largement au début.'],
            ['Relance plutôt que suivre', "Quand tu entres dans un pot, relance avec tes bonnes mains : tu gagnes souvent tout de suite, et tu prends l'initiative."],
            ['Pense position', 'Joue plus de mains au bouton et moins en première position.'],
            ['Calcule ta cote', "Pour suivre 20 dans un pot de 100, tu dois gagner au moins 1 fois sur 6 (20 / 120). Le jeu t'aide : la force de ta main est affichée sous ton tapis."],
            ['Bluffe peu, mais bien', 'Un bluff marche mieux contre peu d’adversaires, quand le tableau fait peur et quand ton histoire tient depuis le début.'],
            ['Observe les autres', "Les bots ont des personnalités : un Roc qui relance a presque toujours une grosse main, une Kamikaze peut avoir n'importe quoi."],
          ].map(([t, d]) => (
            <div key={t} className="panel rounded-2xl p-4">
              <div className="font-ui text-lg font-bold text-brass-200">{t}</div>
              <p className="mt-1 text-[15px] leading-relaxed text-ivory/75">{d}</p>
            </div>
          ))}
        </div>
        <StartingHands />
      </Section>

      <Section id="lexique" title="Lexique">
        <Glossary
          items={[
            ['Abattage', 'Moment où les joueurs encore en jeu montrent leurs cartes pour désigner le gagnant.'],
            ['Blindes', "Mises obligatoires payées avant la distribution par les deux joueurs à gauche du bouton. Elles créent un pot à jouer."],
            ['Bouton (D)', 'Jeton qui indique le donneur. Le joueur au bouton parle en dernier après le flop.'],
            ['Brûler', 'Le croupier écarte une carte face cachée avant le flop, le turn et la river, pour éviter la triche.'],
            ['Kicker', "Carte qui ne fait pas partie de la combinaison mais sert à départager deux mains identiques."],
            ['Limp', 'Entrer dans le pot en suivant simplement la grosse blinde, sans relancer.'],
            ['Nuts', 'La meilleure main possible avec le tableau du moment.'],
            ['Pot secondaire', "Pot créé quand un joueur est à tapis pour moins que les autres ; il ne peut pas le gagner."],
            ['Semi-bluff', 'Miser avec une main encore faible mais qui peut devenir très forte (tirage couleur ou quinte).'],
            ['Tapis', 'Tous les jetons d’un joueur. Aller à tapis = tout miser.'],
            ['Tirage', 'Il te manque une carte pour une couleur ou une quinte.'],
          ]}
        />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- Positions

function PositionsDiagram() {
  const [moment, setMoment] = useState<'pre' | 'post'>('pre');
  const seats = [
    { id: 'BTN', name: 'Bouton', pre: 4, post: 6 },
    { id: 'PB', name: 'Petite blinde', pre: 5, post: 1 },
    { id: 'GB', name: 'Grosse blinde', pre: 6, post: 2 },
    { id: 'UTG', name: 'Première position', pre: 1, post: 3 },
    { id: 'MP', name: 'Milieu', pre: 2, post: 4 },
    { id: 'CO', name: 'Cut-off', pre: 3, post: 5 },
  ];
  // Sens horaire à partir du bas
  const angle = (i: number) => Math.PI / 2 + (i * 2 * Math.PI) / seats.length;
  return (
    <div className="panel rounded-3xl p-4 sm:p-6">
      <div className="mb-4 max-w-xs">
        <Segmented
          value={moment}
          onChange={setMoment}
          options={[
            { value: 'pre', label: 'Avant le flop' },
            { value: 'post', label: 'Après le flop' },
          ]}
        />
      </div>
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative mx-auto aspect-[1.6/1] w-full max-w-md">
          <div className="rail absolute inset-[10%] rounded-[50%]">
            <div className="felt absolute inset-[5%] rounded-[50%]" />
          </div>
          {seats.map((s, i) => {
            const a = angle(i);
            const x = 50 + 44 * Math.cos(a);
            const y = 50 + 40 * Math.sin(a);
            const n = moment === 'pre' ? s.pre : s.post;
            return (
              <div key={s.id} className="absolute -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${x}%`, top: `${y}%` }}>
                <div
                  className={`font-ui mx-auto flex h-11 w-11 items-center justify-center rounded-full text-sm font-extrabold ring-2 transition ${
                    s.id === 'BTN' ? 'bg-ivory text-[#2a1c06] ring-brass-300' : s.id === 'GB' || s.id === 'PB' ? 'bg-brass-300 text-[#2a1c06] ring-brass-500' : 'bg-[#0a1411] text-ivory ring-white/20'
                  }`}
                >
                  {s.id === 'BTN' ? 'D' : s.id}
                </div>
                <div key={moment + n} className="pop-in font-display -mt-1 text-xl font-bold text-brass-200">
                  {n}
                </div>
              </div>
            );
          })}
        </div>
        <Prose>
          <p>
            Les chiffres montrent <b>dans quel ordre on parle</b>. {moment === 'pre' ? (
              <>Avant le flop, les blindes ont déjà « parlé » en posant leur mise obligatoire : on commence donc à gauche de la grosse blinde (UTG), et la grosse blinde parle en dernier.</>
            ) : (
              <>À partir du flop, on commence toujours par le premier joueur encore en jeu à gauche du bouton, et le bouton parle en dernier.</>
            )}
          </p>
          <p>
            <b>Petite blinde</b> : la moitié de la grosse. <b>Grosse blinde</b> : la mise de base (10 avec des blindes 5/10). Dans ce jeu, elles peuvent augmenter toutes les X mains pour accélérer la partie.
          </p>
          <p>
            <b>À deux joueurs</b> (tête-à-tête), c'est différent : le bouton paie la petite blinde et parle en premier avant le flop, puis en dernier après.
          </p>
        </Prose>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Démo

function PokerDemo() {
  const steps = useMemo(() => buildPokerDemo(), []);
  const st = useStepper(steps.length, 5200);
  const step = steps[st.i];
  const meta = useMemo(() => {
    const m: Record<string, SeatMeta> = {};
    for (const p of POKER_DEMO_PLAYERS) m[p.id] = {};
    return m;
  }, []);
  return (
    <DemoFrame label="Démo en direct">
      <div className="h-[340px] sm:h-[440px]">
        <Table view={step.state} heroId="toi" meta={meta} revealAll />
      </div>
      <div className="mt-2">
        <StepperControls st={st} count={steps.length} title={step.title} text={step.text} />
      </div>
    </DemoFrame>
  );
}

// ---------------------------------------------------------------- Combinaisons

const RANKINGS: { name: string; cards: string; desc: string; prob: string }[] = [
  { name: 'Quinte flush royale', cards: 'As Ks Qs Js Ts', desc: "As, Roi, Dame, Valet, 10 de la même couleur. Imbattable.", prob: '1 sur 650 000' },
  { name: 'Quinte flush', cards: '9h 8h 7h 6h 5h', desc: 'Cinq cartes qui se suivent, de la même couleur.', prob: '1 sur 72 000' },
  { name: 'Carré', cards: 'Qs Qh Qd Qc 7s', desc: 'Quatre cartes de même valeur.', prob: '1 sur 4 200' },
  { name: 'Full', cards: 'Ks Kh Kd 4c 4s', desc: 'Un brelan et une paire. On le nomme par le brelan : « Rois par les 4 ».', prob: '1 sur 700' },
  { name: 'Couleur', cards: 'Ad Jd 8d 6d 2d', desc: 'Cinq cartes de la même couleur, dans le désordre.', prob: '1 sur 500' },
  { name: 'Quinte', cards: 'Tc 9d 8s 7h 6c', desc: "Cinq cartes qui se suivent, couleurs mélangées. L'As compte en haut (10-V-D-R-A) ou en bas (A-2-3-4-5).", prob: '1 sur 250' },
  { name: 'Brelan', cards: '8s 8h 8d Kc 3s', desc: 'Trois cartes de même valeur.', prob: '1 sur 47' },
  { name: 'Double paire', cards: 'Js Jh 5d 5c Ah', desc: 'Deux paires différentes.', prob: '1 sur 21' },
  { name: 'Paire', cards: 'Ts Th Ad 7c 4s', desc: 'Deux cartes de même valeur.', prob: '1 sur 2,4' },
  { name: 'Carte haute', cards: 'Ah Qd 9s 6c 3h', desc: 'Rien de tout ça : la carte la plus haute compte.', prob: '1 sur 2' },
];

function HandRankings() {
  return (
    <>
      <ol className="flex flex-col gap-2">
        {RANKINGS.map((r, i) => (
          <li key={r.name} className="panel grid items-center gap-3 rounded-2xl p-3 sm:grid-cols-[2.5rem_minmax(0,15rem)_auto_minmax(0,1fr)] sm:p-4">
            <span className="font-display text-2xl font-bold text-brass-300/70">{i + 1}</span>
            <div>
              <div className="font-ui text-lg font-bold text-ivory">{r.name}</div>
              <div className="font-ui text-sm text-ivory/50">{r.prob} donnes</div>
            </div>
            <Cards cards={r.cards} size={15} />
            <p className="text-[15px] leading-relaxed text-ivory/70">{r.desc}</p>
          </li>
        ))}
      </ol>
      <Note kind="tip">Probabilités pour 5 cartes tirées au hasard. Avec 7 cartes (2 + 5 communes), les combinaisons sont plus fréquentes : on touche une paire ou mieux dans 83 % des cas.</Note>
    </>
  );
}

function KickerExample({ title, board, a, b, text }: { title: string; board: string; a: string; b: string; text: string }) {
  const B = parseCards(board);
  const A = parseCards(a);
  const C = parseCards(b);
  const ha = evaluateHand([...A, ...B]);
  const hb = evaluateHand([...C, ...B]);
  const cmp = compareHands(ha, hb);
  return (
    <div className="panel flex flex-col gap-3 rounded-2xl p-4">
      <div className="font-ui text-lg font-bold text-brass-200">{title}</div>
      <div>
        <div className="font-ui mb-1 text-sm text-ivory/50">Tableau</div>
        <Cards cards={B} size={13} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          ['Joueur 1', A, ha, cmp > 0],
          ['Joueur 2', C, hb, cmp < 0],
        ].map(([label, cards, h, won]) => (
          <div key={label as string}>
            <div className="font-ui mb-1 text-sm text-ivory/50">{label as string}</div>
            <Cards cards={cards as Card[]} size={13} />
            <div className={`font-ui mt-1 text-sm font-semibold ${won ? 'text-[#bdf0d2]' : cmp === 0 ? 'text-brass-200' : 'text-ivory/50'}`}>
              {(h as ReturnType<typeof evaluateHand>).description}
              {won ? ' · gagne' : cmp === 0 ? ' · égalité' : ''}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[15px] leading-relaxed text-ivory/70">{text}</p>
    </div>
  );
}

// ---------------------------------------------------------------- Entraînement « Qui gagne ? »

function dealShowdown() {
  const d = shuffledDeck();
  return { a: d.slice(0, 2), b: d.slice(2, 4), board: d.slice(4, 9) };
}

function ShowdownTrainer() {
  const [hand, setHand] = useState(dealShowdown);
  const [guess, setGuess] = useState<'a' | 'b' | 'tie' | null>(null);
  const [score, setScore] = useState({ ok: 0, total: 0 });
  const ha = evaluateHand([...hand.a, ...hand.board]);
  const hb = evaluateHand([...hand.b, ...hand.board]);
  const cmp = compareHands(ha, hb);
  const answer = cmp > 0 ? 'a' : cmp < 0 ? 'b' : 'tie';
  const choose = (g: 'a' | 'b' | 'tie') => {
    if (guess) return;
    setGuess(g);
    setScore((s) => ({ ok: s.ok + (g === answer ? 1 : 0), total: s.total + 1 }));
  };
  const btn = (g: 'a' | 'b' | 'tie', label: string) => (
    <button
      onClick={() => choose(g)}
      disabled={!!guess}
      className={`btn-lacquer py-3 text-base ${guess && g === answer ? 'btn-call' : guess === g ? 'btn-fold' : 'btn-raise'}`}
    >
      {label}
    </button>
  );
  return (
    <DemoFrame label="À toi de jouer : qui gagne ?">
      <div className="flex flex-col gap-4">
        <div>
          <div className="font-ui mb-2 text-sm text-ivory/55">Tableau</div>
          <Cards cards={hand.board} size={19} highlight={guess ? (answer === 'b' ? hb.cards : ha.cards) : undefined} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {(
            [
              ['Joueur A', hand.a, ha, 'a'],
              ['Joueur B', hand.b, hb, 'b'],
            ] as const
          ).map(([label, cards, h, id]) => (
            <div key={id}>
              <div className="font-ui mb-2 text-sm text-ivory/55">{label}</div>
              <Cards cards={cards} size={19} highlight={guess && answer === id ? h.cards : undefined} />
              {guess && <div className="pop-in font-ui mt-2 text-[15px] font-semibold text-brass-200">{h.description}</div>}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {btn('a', 'Joueur A')}
          {btn('tie', 'Égalité')}
          {btn('b', 'Joueur B')}
        </div>
        {guess && (
          <div className="pop-in flex flex-wrap items-center justify-between gap-3">
            <p className={`font-ui text-[16px] font-bold ${guess === answer ? 'text-[#bdf0d2]' : 'text-[#ffb4bb]'}`}>
              {guess === answer ? 'Bien vu !' : 'Raté.'}{' '}
              <span className="font-normal text-ivory/75">
                {answer === 'tie' ? 'Les deux mains sont exactement égales.' : `Le joueur ${answer === 'a' ? 'A' : 'B'} gagne avec ${(answer === 'a' ? ha : hb).description.toLowerCase()}.`}
              </span>
            </p>
            <button
              onClick={() => {
                setHand(dealShowdown());
                setGuess(null);
              }}
              className="btn-lacquer btn-brass px-5 py-2.5 text-base"
            >
              Nouvelle donne
            </button>
          </div>
        )}
        <div className="font-ui text-sm text-ivory/50">
          Score : {score.ok} / {score.total}
        </div>
      </div>
    </DemoFrame>
  );
}

// ---------------------------------------------------------------- Pots secondaires

function SidePotExample() {
  const players = [
    { id: 'A', name: 'Anaïs', bet: 100, hand: 'Meilleure main (brelan)' },
    { id: 'B', name: 'Bilal', bet: 300, hand: '2e meilleure main (double paire)' },
    { id: 'C', name: 'Chloé', bet: 300, hand: 'Moins bonne main (paire)' },
  ];
  const pots = computePots(players.map((p) => ({ id: p.id, totalBet: p.bet, folded: false })));
  const winners = ['A', 'B'];
  return (
    <div className="panel rounded-3xl p-4 sm:p-6">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="font-ui text-sm text-ivory/55">Trois joueurs à tapis avec des tapis différents</div>
          {players.map((p) => (
            <div key={p.id} className="flex items-center gap-3">
              <span className="font-ui w-16 font-bold text-ivory">{p.name}</span>
              <div className="h-6 rounded-md bg-brass-400/80" style={{ width: `${(p.bet / 300) * 55}%` }} />
              <span className="font-ui text-sm tabular-nums text-brass-200">{p.bet}</span>
            </div>
          ))}
          <p className="text-[15px] leading-relaxed text-ivory/75">
            Anaïs n'a que 100 jetons. Elle ne peut gagner que 100 chez chacun des deux autres : le pot principal fait donc <b className="text-ivory">3 × 100 = 300</b>. Les 200 restants de Bilal et Chloé forment un <b className="text-ivory">pot secondaire de 400</b> qu'Anaïs ne peut pas gagner.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {pots.map((p, i) => (
            <div key={i} className="rounded-2xl bg-black/30 p-4 ring-1 ring-brass-400/25">
              <div className="flex items-baseline justify-between">
                <span className="font-ui font-bold text-brass-200">{i === 0 ? 'Pot principal' : 'Pot secondaire'}</span>
                <span className="font-display text-2xl font-bold text-ivory">{fmt(p.amount)}</span>
              </div>
              <div className="font-ui mt-1 text-sm text-ivory/60">
                Joueurs en lice : {p.eligible.map((id) => players.find((x) => x.id === id)!.name).join(', ')}
              </div>
              <div className="font-ui mt-1 text-sm text-[#bdf0d2]">
                Gagné par {players.find((x) => x.id === winners[i])!.name}
              </div>
            </div>
          ))}
          <p className="text-[15px] leading-relaxed text-ivory/75">
            À l'abattage, Anaïs a la meilleure main : elle gagne le pot principal (300). Entre Bilal et Chloé, Bilal est meilleur : il gagne le pot secondaire (400).
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Mains de départ

function StartingHands() {
  const tiers: { label: string; color: string; hands: string }[] = [
    { label: 'Premium : relance toujours', color: '#d2ad62', hands: 'AA KK QQ JJ AK' },
    { label: 'Fortes : relance presque partout', color: '#5fbf8c', hands: 'TT 99 AQ AJs KQs' },
    { label: 'Jouables en fin de parole', color: '#6fa2d6', hands: '88 77 66 ATs KJs QJs JTs T9s A9s' },
    { label: 'À éviter au début', color: '#8b8b8b', hands: 'K7 Q5 J3 T4 92 72' },
  ];
  return (
    <div className="panel rounded-3xl p-4 sm:p-6">
      <div className="font-ui text-lg font-bold text-brass-200">Quelles mains jouer ?</div>
      <p className="mt-1 max-w-[66ch] text-[15px] text-ivory/70">« s » = assorties (même couleur), ce qui les rend un peu plus fortes. 72 dépareillé est la pire main du jeu.</p>
      <div className="mt-4 flex flex-col gap-3">
        {tiers.map((t) => (
          <div key={t.label} className="flex flex-wrap items-center gap-2">
            <span className="font-ui w-full text-sm font-semibold sm:w-60" style={{ color: t.color }}>
              {t.label}
            </span>
            {t.hands.split(' ').map((h) => (
              <span key={h} className="font-ui rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums ring-1" style={{ color: t.color, borderColor: t.color, boxShadow: `inset 0 0 0 1px ${t.color}55`, background: '#0006' }}>
                {h.replace(/T/g, '10')}
              </span>
            ))}
          </div>
        ))}
      </div>
      <button onClick={() => navigate('/solo')} className="btn-lacquer btn-brass mt-5 px-5 py-3 text-base">
        S'entraîner contre les bots
      </button>
    </div>
  );
}
