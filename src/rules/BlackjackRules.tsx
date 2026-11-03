import { useMemo, useState } from 'react';
import { BetPile } from '../components/BetChip.tsx';
import { PlayingCard } from '../components/PlayingCard.tsx';
import type { Advice } from '../lib/blackjack/engine.ts';
import {
  ADVICE_FR,
  basicStrategy,
  cardValue,
  DEALER_COLS,
  dealerShouldHit,
  DEFAULT_RULES,
  evalPairs,
  evalPlus3,
  PAIRS_TABLE,
  PLUS3_TABLE,
  HARD_CHART,
  handTotal,
  isBlackjack,
  PAIR_CHART,
  SOFT_CHART,
  totalLabel,
} from '../lib/blackjack/engine.ts';
import type { Card, Rank } from '../lib/poker/cards.ts';
import { navigate } from '../lib/router.ts';
import { Cards, DemoFrame, Glossary, Note, Prose, Section, StepperControls, useStepper } from './common.tsx';
import { buildBlackjackDemo } from './demos.ts';

export const BLACKJACK_TOC = [
  ['but', 'Le but du jeu'],
  ['valeurs', 'La valeur des cartes'],
  ['tour', 'Un tour en direct'],
  ['actions', 'Tes options'],
  ['croupier', 'Les règles du croupier'],
  ['paiements', 'Les paiements'],
  ['paris-annexes', 'Les paris annexes'],
  ['calculateur', 'Calculateur de main'],
  ['strategie', 'La stratégie de base'],
  ['lexique', 'Lexique'],
] as const;

const ADVICE_STYLE: Record<Advice, { bg: string; fg: string; short: string }> = {
  H: { bg: '#1f6b47', fg: '#eafff3', short: 'T' },
  S: { bg: '#8e1d2b', fg: '#fff0f1', short: 'R' },
  D: { bg: '#d2ad62', fg: '#2a1c06', short: 'D' },
  Ds: { bg: '#e8cf8c', fg: '#2a1c06', short: 'Dr' },
  P: { bg: '#3f5fb0', fg: '#eef2ff', short: 'S' },
  Rh: { bg: '#6b6b6b', fg: '#ffffff', short: 'Ab' },
  Rs: { bg: '#6b6b6b', fg: '#ffffff', short: 'Ab' },
};

export function BlackjackRules() {
  return (
    <div className="flex flex-col gap-16">
      <Section id="but" title="Le but du jeu" lead="Battre le croupier : avoir un total plus proche de 21 que lui, sans jamais dépasser 21.">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['Tu gagnes si…', 'ton total est plus haut que celui du croupier, ou si le croupier dépasse 21.'],
            ['Tu perds si…', 'tu dépasses 21 (tu « brûles »), même si le croupier brûle ensuite, ou si son total est plus haut.'],
            ['Égalité si…', "vous avez le même total : ta mise t'est rendue."],
          ].map(([t, d]) => (
            <div key={t} className="panel rounded-2xl p-4">
              <div className="font-ui text-lg font-bold text-brass-200">{t}</div>
              <p className="mt-1 text-[15px] leading-relaxed text-ivory/75">{d}</p>
            </div>
          ))}
        </div>
        <Prose>
          <p>
            Tu ne joues <b>que contre le croupier</b>, pas contre les autres joueurs. Le croupier n'a aucun choix : il suit des règles fixes. C'est ce qui rend le blackjack
            mathématique : avec la bonne stratégie, l'avantage du casino tombe à environ <b>0,5 %</b>, le plus faible de tous les jeux de casino.
          </p>
          <p>
            Ici, on joue avec un <b>sabot de 6 jeux</b> de 52 cartes, remélangé quand il reste moins d'un quart des cartes. Les jetons sont fictifs.
          </p>
        </Prose>
      </Section>

      <Section id="valeurs" title="La valeur des cartes" lead="La couleur ne compte pas. Seule la valeur compte.">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="panel flex flex-col items-center gap-3 rounded-2xl p-4 text-center">
            <Cards cards="2c 5d 9h" size={17} />
            <div className="font-ui text-lg font-bold text-ivory">2 à 10</div>
            <div className="text-[15px] text-ivory/70">Leur valeur faciale.</div>
          </div>
          <div className="panel flex flex-col items-center gap-3 rounded-2xl p-4 text-center">
            <Cards cards="Jc Qh Ks" size={17} />
            <div className="font-ui text-lg font-bold text-ivory">Valet, Dame, Roi</div>
            <div className="text-[15px] text-ivory/70">Valent 10 chacun.</div>
          </div>
          <div className="panel flex flex-col items-center gap-3 rounded-2xl p-4 text-center">
            <Cards cards="As" size={17} />
            <div className="font-ui text-lg font-bold text-ivory">As</div>
            <div className="text-[15px] text-ivory/70">Vaut 1 ou 11, au mieux pour toi.</div>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <HandExample cards="Ah 6c" title="Main « souple »" text="As + 6 = 7 ou 17. L'As peut encore compter 1 : tu peux tirer sans risque de brûler." />
          <HandExample cards="Ah 6c Tc" title="L'As redevient 1" text="As + 6 + 10 : avec l'As à 11 ça ferait 27, donc il compte 1. Total : 17 « dur »." />
          <HandExample cards="As Kd" title="Blackjack !" text="As + une carte qui vaut 10, dès les 2 premières cartes. C'est la meilleure main, payée 3 pour 2." />
        </div>
      </Section>

      <Section id="tour" title="Un tour en direct" lead="Suis un tour complet avec séparation et double, joué par le moteur du jeu.">
        <BlackjackDemo />
      </Section>

      <Section id="actions" title="Tes options" lead="Après la distribution, tu joues ta main jusqu'à ce que tu restes, que tu atteignes 21 ou que tu brûles.">
        <div className="grid gap-3 sm:grid-cols-2">
          <ActionCard name="Tirer" cards="9c 4d 5h" text="Tu demandes une carte de plus. Tu peux tirer autant de fois que tu veux, tant que tu ne dépasses pas 21." />
          <ActionCard name="Rester" cards="Tc 8s" text="Tu gardes ton total et c'est au croupier de jouer. Ici tu restes sur 18." />
          <ActionCard
            name="Doubler"
            cards="6c 5d Th"
            text="Seulement sur tes 2 premières cartes : tu doubles ta mise et tu reçois exactement une carte. Idéal avec 10 ou 11 contre une carte faible du croupier."
          />
          <ActionCard
            name="Séparer"
            cards="8s 8h"
            text="Avec deux cartes de même valeur, tu fais deux mains avec une deuxième mise égale. Jusqu'à 4 mains. Deux As séparés ne reçoivent qu'une carte chacun."
          />
          <ActionCard
            name="Assurance"
            cards="Ah"
            text="Quand le croupier montre un As, tu peux miser la moitié de ta mise sur le fait qu'il a blackjack. Payée 2 pour 1. Elle perd de l'argent sur la durée : mieux vaut la refuser."
          />
          <ActionCard
            name="Abandonner"
            cards="Tc 6d"
            text="Sur tes 2 premières cartes, tu rends ta main et récupères la moitié de ta mise. Utile avec 16 contre un 10 du croupier, une situation très défavorable."
          />
        </div>
        <Note kind="warn" title="Le piège de la séparation">
          Ne sépare jamais deux 10 (20, c'est excellent) ni deux 5 (traite-les comme 10 et double). Sépare toujours les As et les 8.
        </Note>
      </Section>

      <Section id="croupier" title="Les règles du croupier" lead="Le croupier ne décide rien : tant qu'il a 16 ou moins il tire, à partir de 17 il reste.">
        <DealerSimulator />
      </Section>

      <Section id="paiements" title="Les paiements">
        <div className="panel overflow-x-auto rounded-2xl">
          <table className="font-ui w-full min-w-[30rem] text-left text-[15px]">
            <thead>
              <tr className="text-ivory/55">
                <th className="px-4 py-3 font-semibold">Résultat</th>
                <th className="px-4 py-3 font-semibold">Paiement</th>
                <th className="px-4 py-3 font-semibold">Mise de 100 : tu récupères</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Blackjack', '3 pour 2', '250 (100 + 150)'],
                ['Main gagnante', '1 pour 1', '200 (100 + 100)'],
                ['Égalité', 'Mise rendue', '100'],
                ['Abandon', 'Moitié rendue', '50'],
                ['Assurance gagnante', '2 pour 1 sur l’assurance', '150 sur une assurance de 50'],
                ['Main perdante ou brûlée', 'Mise perdue', '0'],
              ].map(([a, b, c]) => (
                <tr key={a} className="border-t border-white/10">
                  <td className="px-4 py-3 font-semibold text-ivory">{a}</td>
                  <td className="px-4 py-3 text-brass-200">{b}</td>
                  <td className="px-4 py-3 tabular-nums text-ivory/75">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Note kind="tip">Un 21 fait avec 3 cartes ou après une séparation n'est pas un blackjack : il est payé 1 pour 1.</Note>
      </Section>

      <Section
        id="paris-annexes"
        title="Les paris annexes"
        lead="Deux paris facultatifs, posés avant la distribution dans les petites cases à gauche et à droite de ta mise. Ils se jouent uniquement sur les premières cartes, indépendamment du résultat de ta main."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <PayTable
            title="Perfect Pairs"
            sub="Tes 2 premières cartes forment-elles une paire ?"
            rows={PAIRS_TABLE.map((r) => [r.name, r.desc, r.mult, r.example])}
          />
          <PayTable
            title="21+3"
            sub="Tes 2 cartes + la carte visible du croupier forment une main de poker à 3 cartes."
            rows={PLUS3_TABLE.map((r) => [r.name, r.desc, r.mult, r.example])}
          />
        </div>
        <SideBetSimulator />
        <Note kind="warn" title="À savoir">
          Ces paris paient gros mais tombent rarement : le casino y garde un avantage d'environ 3 à 6 %, bien plus que sur la main principale (0,5 % avec la
          stratégie de base). Joue-les petit, pour le fun. Pour 21+3, l'As compte en haut (D-R-A) et en bas (A-2-3).
        </Note>
      </Section>

      <Section id="calculateur" title="Calculateur de main" lead="Compose une main et choisis la carte du croupier : le total et le meilleur coup s'affichent en direct.">
        <HandCalculator />
      </Section>

      <Section
        id="strategie"
        title="La stratégie de base"
        lead="Le meilleur coup pour chaque situation, calculé par simulation sur des millions de mains (6 jeux, le croupier reste sur 17). En jeu, active « Conseils de stratégie » pour l'avoir sous les yeux."
      >
        <StrategyCharts />
      </Section>

      <Section id="lexique" title="Lexique">
        <Glossary
          items={[
            ['Brûler', 'Dépasser 21. La main est perdue immédiatement.'],
            ['Main dure', "Main sans As, ou dont l'As compte forcément 1 (ex. As + 6 + 10 = 17 dur)."],
            ['Main souple', "Main où l'As compte 11 sans dépasser 21 (ex. As + 6 = 17 souple). On peut tirer sans risque."],
            ['Sabot', 'Boîte qui contient les jeux de cartes mélangés (ici 6 jeux).'],
            ['Carte cachée', 'La deuxième carte du croupier, retournée seulement à la fin.'],
            ['S17', 'Règle où le croupier reste sur tous les 17, même souples. Elle est favorable au joueur.'],
            ['Pousser', 'Égalité : la mise est rendue.'],
          ]}
        />
        <button onClick={() => navigate('/blackjack')} className="btn-lacquer btn-brass self-start px-6 py-3 text-lg">
          Jouer au Blackjack
        </button>
      </Section>
    </div>
  );
}

function HandExample({ cards, title, text }: { cards: string; title: string; text: string }) {
  return (
    <div className="panel flex flex-col gap-3 rounded-2xl p-4">
      <Cards cards={cards} size={17} />
      <div className="font-ui text-lg font-bold text-brass-200">{title}</div>
      <p className="text-[15px] leading-relaxed text-ivory/70">{text}</p>
    </div>
  );
}

function ActionCard({ name, cards, text }: { name: string; cards: string; text: string }) {
  return (
    <div className="panel flex gap-4 rounded-2xl p-4">
      <div className="shrink-0">
        <Cards cards={cards} size={12} overlap />
      </div>
      <div>
        <div className="font-ui text-lg font-bold text-brass-200">{name}</div>
        <p className="mt-1 text-[15px] leading-relaxed text-ivory/75">{text}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Démo animée

function BlackjackDemo() {
  const steps = useMemo(() => buildBlackjackDemo(), []);
  const st = useStepper(steps.length, 4200);
  const v = steps[st.i];
  const shown = v.dealer.slice(0, v.dealerShown);
  return (
    <DemoFrame label="Démo en direct">
      <div className="felt relative flex min-h-[320px] flex-col items-center justify-between gap-6 rounded-[2rem_2rem_45%_45%] px-3 py-5 ring-1 ring-brass-400/30 sm:min-h-[360px]">
        <div className="flex flex-col items-center gap-2">
          <span className="font-ui rounded-full bg-black/50 px-3 py-0.5 text-sm font-semibold text-ivory/85">
            Croupier {shown.length ? <b className="text-brass-200">{totalLabel(shown)}</b> : ''}
          </span>
          <div className="flex min-h-[5.2rem]">
            {v.dealer.map((c, i) => (
              <div key={i} style={{ marginLeft: i ? -18 : 0 }}>
                <PlayingCard card={c} size={22} faceUp={i < v.dealerShown} />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-center gap-8">
          {v.hands.map((h, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              {h.result && <span className="pop-in font-ui rounded-full bg-[#0e3a28] px-3 py-0.5 text-sm font-bold text-[#bdf0d2] ring-1 ring-[#2c8a5d]/60">{h.result}</span>}
              <div className={`flex min-h-[5.6rem] rounded-xl p-1 ${h.active ? 'turn-glow' : ''}`}>
                {h.cards.length === 0 ? (
                  <BetPile amount={h.bet} size={44} />
                ) : (
                  h.cards.map((c, k) => (
                    <div key={`${k}-${c.rank}${c.suit}`} style={{ marginLeft: k ? -22 : 0 }}>
                      <PlayingCard card={c} size={22} />
                    </div>
                  ))
                )}
              </div>
              {h.cards.length > 0 && (
                <span className="font-ui flex items-center gap-2 text-sm">
                  <b className="rounded-full bg-black/60 px-2.5 py-0.5 text-brass-200">{totalLabel(h.cards)}</b>
                  <span className="text-ivory/70">mise {h.bet}</span>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <StepperControls st={st} count={steps.length} title={v.title} text={v.text} />
      </div>
    </DemoFrame>
  );
}

// ---------------------------------------------------------------- Simulateur du croupier

const SAMPLE_DECK: Card[] = (() => {
  const out: Card[] = [];
  for (const suit of ['s', 'h', 'd', 'c'] as const) for (let r = 2; r <= 14; r++) out.push({ rank: r as Rank, suit });
  return out;
})();

function randomDealerHand(): Card[] {
  const pick = () => SAMPLE_DECK[Math.floor(Math.random() * SAMPLE_DECK.length)];
  const cards = [pick(), pick()];
  while (dealerShouldHit(cards, DEFAULT_RULES)) cards.push(pick());
  return cards;
}

function DealerSimulator() {
  const [hand, setHand] = useState<Card[]>(() => randomDealerHand());
  const [round, setRound] = useState(0);
  const steps = hand.map((_, i) => hand.slice(0, i + 1)).slice(1);
  const final = handTotal(hand).total;
  return (
    <DemoFrame label="Simulateur du croupier">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {steps.map((cards, i) => {
            const { total, soft } = handTotal(cards);
            const hit = dealerShouldHit(cards, DEFAULT_RULES);
            return (
              <div key={`${round}-${i}`} className="fade-up flex items-center gap-4" style={{ animationDelay: `${i * 450}ms` }}>
                <Cards cards={cards} size={13} overlap />
                <div className="font-ui text-[15px]">
                  <b className="text-ivory">{total > 21 ? `${total} : brûlé` : `${soft && total < 21 ? 'souple ' : ''}${total}`}</b>
                  <span className={`ml-2 ${hit ? 'text-[#bdf0d2]' : 'text-brass-200'}`}>{total > 21 ? '' : hit ? '→ doit tirer' : '→ reste'}</span>
                </div>
              </div>
            );
          })}
          <button
            onClick={() => {
              setHand(randomDealerHand());
              setRound((r) => r + 1);
            }}
            className="btn-lacquer btn-brass mt-2 self-start px-5 py-2.5 text-base"
          >
            Nouvelle main du croupier
          </button>
        </div>
        <Prose>
          <p>
            Résultat de cette main : <b>{final > 21 ? `le croupier brûle (${final})` : `le croupier fait ${final}`}</b>.
          </p>
          <p>
            Comme il doit tirer jusqu'à 17, le croupier <b>brûle environ 28 % du temps</b>. Avec un 5 ou un 6 visible, c'est plus de 40 % : c'est pour ça qu'on reste souvent sur 12 à 16 contre ces cartes, et qu'on double volontiers.
          </p>
          <p>À l'inverse, avec un 10 ou un As visible, le croupier fait souvent 20 ou 21 : il faut alors améliorer sa main.</p>
        </Prose>
      </div>
    </DemoFrame>
  );
}

// ---------------------------------------------------------------- Calculateur

const PICKS: { label: string; rank: Rank }[] = [
  { label: 'A', rank: 14 },
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => ({ label: String(r), rank: r as Rank })),
  { label: 'V', rank: 11 },
  { label: 'D', rank: 12 },
  { label: 'R', rank: 13 },
];
const SUITS = ['s', 'h', 'd', 'c'] as const;

function HandCalculator() {
  const [hand, setHand] = useState<Card[]>([
    { rank: 14, suit: 'h' },
    { rank: 7, suit: 'c' },
  ]);
  const [up, setUp] = useState<Card>({ rank: 9, suit: 's' });
  const add = (rank: Rank) => setHand((h) => (h.length >= 8 ? h : [...h, { rank, suit: SUITS[h.length % 4] }]));
  const { total, soft } = handTotal(hand);
  const bust = total > 21;
  const advice = hand.length >= 2 && !bust && !isBlackjack(hand) && total < 21 ? basicStrategy(hand, up) : null;
  const sty = advice ? ADVICE_STYLE[advice] : null;
  const keyBtn = 'font-ui h-10 w-10 rounded-lg bg-white/[0.07] text-[15px] font-bold text-ivory ring-1 ring-white/15 hover:bg-white/15 active:scale-95';
  return (
    <DemoFrame label="Essaie toi-même">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div>
            <div className="font-ui mb-2 text-sm text-ivory/55">Ta main (touche les valeurs pour ajouter des cartes)</div>
            <div className="flex min-h-[5.4rem] items-end">
              {hand.length ? <Cards cards={hand} size={19} overlap /> : <span className="text-ivory/40">Aucune carte</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PICKS.map((p) => (
                <button key={p.label} onClick={() => add(p.rank)} className={keyBtn}>
                  {p.label}
                </button>
              ))}
              <button onClick={() => setHand((h) => h.slice(0, -1))} className={`${keyBtn} w-auto px-3`}>
                Retirer
              </button>
              <button onClick={() => setHand([])} className={`${keyBtn} w-auto px-3`}>
                Vider
              </button>
            </div>
          </div>
          <div>
            <div className="font-ui mb-2 text-sm text-ivory/55">Carte visible du croupier</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {PICKS.filter((p) => p.rank <= 10 || p.rank === 14).map((p) => (
                <button
                  key={p.label}
                  onClick={() => setUp({ rank: p.rank, suit: 's' })}
                  className={`${keyBtn} ${cardValue(up) === cardValue({ rank: p.rank, suit: 's' }) ? '!bg-brass-400 !text-[#2a1c06]' : ''}`}
                >
                  {p.label === '10' ? '10' : p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col justify-center gap-3 rounded-2xl bg-black/30 p-5 ring-1 ring-brass-400/20">
          <div className="font-ui text-sm text-ivory/55">Total</div>
          <div className="font-display text-5xl font-bold text-ivory">
            {hand.length === 0 ? '0' : isBlackjack(hand) ? 'Blackjack' : bust ? `${total}` : soft && total < 21 ? `${total - 10} / ${total}` : total}
          </div>
          <div className="font-ui text-[15px] text-ivory/70">
            {hand.length === 0
              ? 'Ajoute des cartes.'
              : bust
                ? 'Plus de 21 : la main est brûlée.'
                : isBlackjack(hand)
                  ? 'As + carte à 10 dès les 2 premières cartes : payé 3 pour 2.'
                  : soft
                    ? `Main souple : l'As compte 11. S'il le faut, il redescendra à 1.`
                    : 'Main dure.'}
          </div>
          {advice && sty && (
            <div className="pop-in mt-2" key={`${advice}-${total}-${cardValue(up)}`}>
              <div className="font-ui text-sm text-ivory/55">Meilleur coup contre {cardValue(up) === 11 ? 'un As' : `un ${cardValue(up)}`}</div>
              <div className="font-ui mt-1 inline-block rounded-xl px-4 py-2 text-xl font-extrabold" style={{ background: sty.bg, color: sty.fg }}>
                {ADVICE_FR[advice]}
              </div>
            </div>
          )}
          {total === 21 && !isBlackjack(hand) && <div className="font-ui text-brass-200">21 : tu restes forcément.</div>}
        </div>
      </div>
    </DemoFrame>
  );
}

// ---------------------------------------------------------------- Grilles

function StrategyCharts() {
  const [tab, setTab] = useState<'hard' | 'soft' | 'pairs'>('hard');
  const rows: { label: string; cells: Advice[] }[] =
    tab === 'hard'
      ? [8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((t) => ({ label: t === 8 ? '8 et moins' : t === 17 ? '17 et plus' : String(t), cells: HARD_CHART[t] }))
      : tab === 'soft'
        ? [13, 14, 15, 16, 17, 18, 19, 20].map((t) => ({ label: `A + ${t - 11}`, cells: SOFT_CHART[t] }))
        : [11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((v) => ({ label: v === 11 ? 'A + A' : `${v} + ${v}`, cells: PAIR_CHART[v] }));
  return (
    <div className="panel rounded-3xl p-4 sm:p-6">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['hard', 'Totaux durs'],
            ['soft', 'Mains souples'],
            ['pairs', 'Paires'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`font-ui rounded-full px-4 py-2 text-[15px] font-semibold ring-1 ${tab === id ? 'btn-brass ring-transparent' : 'bg-black/30 text-ivory/75 ring-white/15'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="font-ui min-w-[34rem] border-separate border-spacing-[3px] text-center text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-ivory/55">Ta main</th>
              {DEALER_COLS.map((c) => (
                <th key={c} className="w-10 rounded-md bg-black/40 py-1 text-ivory">
                  {c === 11 ? 'A' : c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th className="whitespace-nowrap px-2 py-1 text-left font-bold text-ivory/85">{r.label}</th>
                {r.cells.map((a, i) => (
                  <td key={i} className="rounded-md py-1.5 font-extrabold" style={{ background: ADVICE_STYLE[a].bg, color: ADVICE_STYLE[a].fg }} title={ADVICE_FR[a]}>
                    {ADVICE_STYLE[a].short}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="font-ui mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-ivory/75">
        <span className="text-ivory/50">Carte visible du croupier en haut.</span>
        {(['H', 'S', 'D', 'Ds', 'P', 'Rh'] as Advice[]).map((a) => (
          <span key={a} className="flex items-center gap-1.5">
            <span className="inline-block rounded px-1.5 font-extrabold" style={{ background: ADVICE_STYLE[a].bg, color: ADVICE_STYLE[a].fg }}>
              {ADVICE_STYLE[a].short}
            </span>
            {ADVICE_FR[a]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Paris annexes

function PayTable({ title, sub, rows }: { title: string; sub: string; rows: [string, string, number, string][] }) {
  return (
    <div className="panel rounded-2xl p-4 sm:p-5">
      <div className="font-display text-2xl font-bold text-brass-200">{title}</div>
      <p className="mt-1 text-[15px] text-ivory/65">{sub}</p>
      <div className="mt-3 flex flex-col divide-y divide-white/10">
        {rows.map(([name, desc, mult, ex]) => (
          <div key={name} className="flex items-center gap-3 py-2.5">
            <div className="shrink-0">
              <Cards cards={ex} size={9} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-ui font-bold text-ivory">{name}</div>
              <div className="text-sm text-ivory/60">{desc}</div>
            </div>
            <div className="font-ui shrink-0 rounded-lg bg-black/40 px-2.5 py-1 text-lg font-extrabold tabular-nums text-brass-200">{mult}:1</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function randomCard(): Card {
  return SAMPLE_DECK[Math.floor(Math.random() * SAMPLE_DECK.length)];
}

function SideBetSimulator() {
  const [n, setN] = useState(0);
  const [cards, setCards] = useState<Card[]>(() => [randomCard(), randomCard(), randomCard()]);
  const [tally, setTally] = useState({ draws: 0, pairs: 0, plus3: 0 });
  const pairs = evalPairs(cards[0], cards[1]);
  const plus3 = evalPlus3(cards);
  const drawOnce = (force?: 'pairs' | 'plus3') => {
    let c: Card[];
    let tries = 0;
    do {
      c = [randomCard(), randomCard(), randomCard()];
      tries++;
    } while (force && tries < 5000 && !(force === 'pairs' ? evalPairs(c[0], c[1]) : evalPlus3(c)));
    setCards(c);
    setN((x) => x + 1);
    if (!force) setTally((t) => ({ draws: t.draws + 1, pairs: t.pairs + (evalPairs(c[0], c[1]) ? 1 : 0), plus3: t.plus3 + (evalPlus3(c) ? 1 : 0) }));
  };
  const badge = (r: { name: string; mult: number } | null) =>
    r ? (
      <span className="pop-in font-ui rounded-full bg-[#0e3a28] px-3 py-1 font-bold text-[#bdf0d2] ring-1 ring-[#2c8a5d]/60">
        {r.name} · {r.mult}:1
      </span>
    ) : (
      <span className="font-ui rounded-full bg-black/40 px-3 py-1 text-ivory/50">Perdu</span>
    );
  return (
    <DemoFrame label="Simulateur de paris annexes">
      <div className="grid items-center gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex items-end gap-6" key={n}>
          <div className="flex flex-col items-center gap-2">
            <div className="flex" style={{ fontSize: 18 }}>
              {cards.slice(0, 2).map((c, i) => (
                <div key={i} style={{ marginLeft: i ? '-0.9em' : 0 }}>
                  <PlayingCard card={c} size={18} dealDelay={i * 180} />
                </div>
              ))}
            </div>
            <span className="font-ui text-sm text-ivory/55">Tes 2 cartes</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <PlayingCard card={cards[2]} size={18} dealDelay={360} />
            <span className="font-ui text-sm text-ivory/55">Croupier</span>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-ui w-28 font-bold text-ivory">Perfect Pairs</span>
            {badge(pairs)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-ui w-28 font-bold text-ivory">21+3</span>
            {badge(plus3)}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => drawOnce()} className="btn-lacquer btn-brass px-5 py-2.5 text-base">
              Distribuer
            </button>
            <button onClick={() => drawOnce('pairs')} className="font-ui rounded-full bg-black/30 px-4 py-2 text-[15px] font-semibold text-ivory/85 ring-1 ring-white/15">
              Montre une paire
            </button>
            <button onClick={() => drawOnce('plus3')} className="font-ui rounded-full bg-black/30 px-4 py-2 text-[15px] font-semibold text-ivory/85 ring-1 ring-white/15">
              Montre un 21+3
            </button>
          </div>
          {tally.draws > 0 && (
            <p className="font-ui text-sm text-ivory/60">
              Sur tes {tally.draws} distributions : {tally.pairs} paire{tally.pairs > 1 ? 's' : ''} ({Math.round((tally.pairs / tally.draws) * 100)} %), {tally.plus3} 21+3 (
              {Math.round((tally.plus3 / tally.draws) * 100)} %). En moyenne : une paire 1 fois sur 13, un 21+3 environ 1 fois sur 10.
            </p>
          )}
        </div>
      </div>
    </DemoFrame>
  );
}
