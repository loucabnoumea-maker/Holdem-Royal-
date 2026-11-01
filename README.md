# Hold'em Royal — poker Texas Hold'em No Limit

**Jouer en ligne : https://loucabnoumea-maker.github.io/Holdem-Royal-/**

Application web en français, responsive (ordinateur, iPad, mobile). Jetons fictifs uniquement : aucun argent réel, aucun achat.

- **Jouer seul** contre 1 à 8 bots (Facile / Moyen / Difficile, réglable globalement ou bot par bot)
- **Créer / rejoindre une partie** entre amis avec un code à 6 caractères (Supabase)

## Démarrer

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # tests du moteur, des bots et des salles
npm run build        # version de production dans dist/
npm run build:single # un seul fichier HTML autonome dans dist-single/ (mode solo)
```

Le mode en ligne demande un projet Supabase : voir **[SUPABASE.md](SUPABASE.md)**.

## Structure

```
src/lib/poker/        moteur pur, sans React (partagé avec le serveur)
  cards.ts            paquet, mélange crypto
  evaluator.ts        évaluateur de mains (quinte flush royale → carte haute)
  pots.ts             pots secondaires, partages
  game.ts             règles : blindes, ordre de parole, relances, abattage
  bots.ts             IA : niveau (Facile / Moyen / Difficile) × personnalité (Requin, Kamikaze, Roc, Curieux, Bluffeur, Matheux)
  room.ts             logique des salles en ligne (code, salle d'attente, minuteur, absents, exclusion)
src/components/       table, cartes, barre d'action, historique
src/pages/            accueil, solo, salle d'attente, partie en ligne
supabase/migrations/  tables + règles RLS
supabase/functions/   Edge Function « poker » (seul endroit qui voit le paquet)
```

## Des bots qui jouent comme des humains

Chaque bot combine un **niveau** (précision du calcul, erreurs, lecture des adversaires) et une **personnalité** :

| Style | Jeu |
|---|---|
| Le Requin | serré-agressif, bluffs bien choisis |
| La Kamikaze | joue presque tout, relance sans arrêt |
| Le Roc | attend les grosses mains, ne bluffe presque jamais |
| Le Curieux | paie beaucoup, mise peu |
| Le Bluffeur | continuation bets, bluffs sur les cartes qui font peur, gros bluffs à la river |
| Le Matheux | équilibré, ne s'énerve jamais |

Types de bluff : continuation bet, vol des blindes, semi-bluff avec tirage, bluff quand une carte fait peur,
bluff quand tout le monde a checké, relance-bluff, « float », 3-bet bluff. Les bots tendent aussi des pièges
(slowplay), partent en **tilt** après une grosse perte, réfléchissent plus ou moins longtemps selon la difficulté
de la décision, parlent à table et montrent parfois leur bluff après avoir remporté le pot.

`npm run bench` mesure les styles (mains jouées, relances, bluffs) et les écarts de niveau.

## Raccourcis clavier (ordinateur)

`F` se coucher · `C` check / suivre · `R` ouvrir la relance · `Entrée` valider la relance
