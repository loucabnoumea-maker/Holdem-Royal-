import * as deckModule from '@letele/playing-cards';
import type { ComponentType, SVGProps } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Card } from '../lib/poker/index.ts';
import { SUIT_SYMBOLS } from '../lib/poker/index.ts';

// Jeu anglais classique d'Adrian Kennard (domaine public, CC0) — www.me.uk/cards
const DECK = deckModule as unknown as Record<string, ComponentType<SVGProps<SVGSVGElement>>>;

/** Taille nommée, ou taille de police en pixels (la carte fait 2,6 × 3,64 fois cette taille). */
export type CardSize = 'xs' | 'sm' | 'md' | 'lg' | number;
const SIZE_PX: Record<string, number> = { xs: 9, sm: 12, md: 16, lg: 21 };
const px = (s: CardSize) => (typeof s === 'number' ? s : SIZE_PX[s]);
const RANK_KEY: Record<number, string> = { 14: 'a', 13: 'k', 12: 'q', 11: 'j' };
const RANK_EN: Record<number, string> = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J' };

function cardKey(c: Card) {
  return `${c.suit.toUpperCase()}${RANK_KEY[c.rank] ?? c.rank}`;
}

interface Props {
  card?: Card | null;
  faceUp?: boolean;
  size?: CardSize;
  highlight?: boolean;
  dim?: boolean;
  /** Délai de l'animation de distribution (ms). */
  dealDelay?: number;
  animateDeal?: boolean;
  /** Classes appliquées au conteneur extérieur (rotation, décalage…). */
  className?: string;
  /** id d'un élément d'où part la carte (sabot, centre de la table…). */
  dealFrom?: string;
  /** La carte arrive face cachée puis se retourne une fois posée (par défaut : oui si elle est distribuée). */
  flipOnLand?: boolean;
}

const FLY_MS = 520;

/**
 * Carte à jouer. En grand : le dessin complet (figures comprises).
 * En petit : on recadre sur l'index du coin (rang + couleur) pour rester lisible.
 */
export function PlayingCard({
  card,
  faceUp = true,
  size = 'md',
  highlight,
  dim,
  dealDelay = 0,
  animateDeal = true,
  className = '',
  dealFrom,
  flipOnLand = true,
}: Props) {
  const fly = useRef<HTMLDivElement>(null);
  // Point de départ réel de la carte : on mesure l'écart avant le premier affichage.
  useLayoutEffect(() => {
    if (!animateDeal || !dealFrom || !fly.current) return;
    const o = document.getElementById(dealFrom)?.getBoundingClientRect();
    const me = fly.current.getBoundingClientRect();
    if (!o || !me.width) return;
    fly.current.style.setProperty('--from-x', `${o.left + o.width / 2 - (me.left + me.width / 2)}px`);
    fly.current.style.setProperty('--from-y', `${o.top + o.height / 2 - (me.top + me.height / 2)}px`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [landed, setLanded] = useState(!(animateDeal && flipOnLand));
  useEffect(() => {
    if (landed) return;
    const t = setTimeout(() => setLanded(true), dealDelay + FLY_MS - 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const showFace = faceUp && !!card && landed;
  const everHidden = useRef(false);
  if (!showFace) everHidden.current = true;
  const Svg = card ? DECK[cardKey(card)] : null;
  // Petites cartes : on recadre sur l'index du coin pour rester lisible
  const compact = px(size) < 14;
  const label = card ? `${RANK_EN[card.rank] ?? card.rank}${SUIT_SYMBOLS[card.suit]}` : '';

  return (
    <div
      className={`relative shrink-0 select-none ${className}`}
      style={{ fontSize: px(size), width: '2.6em', height: '3.64em' }}
      aria-label={showFace ? label : 'Carte cachée'}
      role="img"
    >
      <div ref={fly} className={`h-full w-full ${animateDeal ? 'deal-in' : ''}`} style={{ animationDelay: `${dealDelay}ms` }}>
        <div
          className="h-full w-full"
          style={{
            perspective: '800px',
            transform: highlight ? 'translateY(-0.4em)' : undefined,
            transition: 'transform .35s, filter .35s',
            filter: dim ? 'brightness(.42) saturate(.5)' : undefined,
          }}
        >
          <div className={`card-inner ${showFace ? (everHidden.current ? 'lift' : '') : 'flipped'}`}>
            <div
              className="card-face card-front"
              style={
                highlight
                  ? { boxShadow: '0 0 0 0.12em #f1dfae, 0 0 1.1em rgba(241,223,174,.85), 0 .3em .6em rgba(0,0,0,.5)' }
                  : undefined
              }
            >
              {Svg &&
                (compact ? (
                  <Svg
                    viewBox="-121 -168 33 68"
                    preserveAspectRatio="xMidYMid meet"
                    style={{ width: '100%', height: '100%', padding: '0.18em 0.32em' }}
                  />
                ) : (
                  <Svg preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }} />
                ))}
            </div>
            <div className="card-face card-back" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Emplacement vide pour une carte du tableau à venir. */
export function CardSlot({ size = 'md' }: { size?: CardSize }) {
  return (
    <div
      className="shrink-0 rounded-[0.32em] border border-brass-300/15 bg-black/10"
      style={{ fontSize: px(size), width: '2.6em', height: '3.64em' }}
    />
  );
}
