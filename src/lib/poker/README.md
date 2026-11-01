# Moteur de poker — `/lib/poker`

Texas Hold'em No Limit, TypeScript pur, aucune dépendance (ni React, ni Supabase).
Toutes les fonctions sont **pures** : elles renvoient un nouvel état sérialisable en JSON,
donc le même code tourne dans le navigateur (mode solo) et dans une Supabase Edge Function (multijoueur).

## Fichiers

| Fichier | Rôle |
|---|---|
| `cards.ts` | Cartes, paquet, mélange Fisher-Yates (RNG crypto par défaut, RNG à graine pour les tests) |
| `evaluator.ts` | Meilleure main de 5 à 7 cartes, score comparable, kickers, description en français |
| `pots.ts` | Pot principal + pots secondaires, partage, jetons indivisibles |
| `game.ts` | Machine à états : blindes, ordre de parole, mises, relances, abattage, éliminations |

## Utilisation

```ts
import { createGame, startHand, getLegalActions, applyAction, timeoutAction, getPublicView } from './lib/poker';

let s = createGame({ startingStack: 1000, smallBlind: 5, bigBlind: 10, blindIncreaseEveryHands: 10 },
  [{ id: 'louca', name: 'Louca' }, { id: 'bot1', name: 'Max' }]);

s = startHand(s);                       // nouvelle main (bouton, blindes, distribution)
const legal = getLegalActions(s);       // { playerId, canCheck, callAmount, minRaiseTo, maxRaiseTo, ... }
s = applyAction(s, legal!.playerId, { type: 'raise', amount: 30 }); // amount = « relancer à »
// s.phase : 'betting' | 'handOver' | 'gameOver' ; s.lastHand : abattage, pots, gains
const vue = getPublicView(s, 'louca');  // sans le paquet ni les cartes adverses (à envoyer au client)
```

Actions : `fold`, `check`, `call`, `bet`/`raise` (avec `amount` total), `allin`.
Une action illégale lève une `PokerError` avec un message en français.

## Règles couvertes

- Bouton aléatoire puis rotation (saute les éliminés), PB/GB, tête-à-tête (bouton = PB, parle en premier préflop et en dernier ensuite)
- Option de la grosse blinde, GB à tapis court (on suit quand même la blinde complète)
- Relance minimale = mise actuelle + dernière relance complète ; un tapis inférieur à la relance minimale ne rouvre pas les enchères pour ceux qui ont déjà parlé
- Mise non suivie rendue, déroulement automatique du tableau quand tout le monde est à tapis
- Side pots, partage des égalités, jeton indivisible au premier gagnant à gauche du bouton
- Éliminations, fin de partie, augmentation des blindes

Simplifications assumées : pas de « bouton mort » (le bouton avance simplement au joueur suivant),
pas de cumul de plusieurs tapis courts pour former une relance complète, toutes les mains sont montrées à l'abattage.

## Tests

```bash
npm test        # 60 tests, dont 10 000 mains vérifiées et 2 000 parties aléatoires complètes
npm run demo    # quelques mains jouées dans la console + benchmark de l'évaluateur
```
