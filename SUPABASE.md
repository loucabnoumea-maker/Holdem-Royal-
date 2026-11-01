# Mettre en ligne le mode multijoueur (Supabase)

Compte 15 minutes. Tout est gratuit avec l'offre Free de Supabase.

## 1. Créer le projet

1. Va sur [supabase.com](https://supabase.com), crée un compte puis **New project** (région : Paris / `eu-west-3`).
2. **Authentication → Sign In / Providers → Anonymous sign-ins** : active-le (les joueurs se connectent juste avec un pseudo).

## 2. Créer les tables (avec la sécurité RLS)

**SQL Editor → New query**, colle tout le contenu de `supabase/migrations/20261027000000_poker.sql`, puis **Run**.

Ça crée :

| Table | Qui peut la lire |
|---|---|
| `room_secrets` | personne côté client (paquet + toutes les cartes) — seulement l'Edge Function |
| `room_public` | les membres de la salle (état sans paquet ni cartes privées) |
| `hole_cards` | **chaque joueur ne lit que ses propres cartes** (`player_id = auth.uid()`) |
| `chat_messages` | les membres de la salle |

Le temps réel (Realtime) est activé sur `room_public`, `hole_cards` et `chat_messages`.

## 3. Déployer l'Edge Function

Sur ton ordinateur, dans le dossier du projet :

```bash
npm install
npx supabase login
npx supabase link --project-ref TON_ID_DE_PROJET   # visible dans l'URL du dashboard
npm run deploy:functions                             # copie le moteur puis déploie « poker »
```

Pas besoin de configurer de secret : `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis automatiquement à la fonction.

## 4. Brancher l'application

**Project Settings → API** : récupère l'URL du projet et la clé `anon` publique.

- **En local** : crée un fichier `.env.local` à la racine :
  ```
  VITE_SUPABASE_URL=https://xxxx.supabase.co
  VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
  ```
  puis `npm run dev`.
- **Sur Netlify / Vercel** : ajoute ces deux variables dans les réglages du site, commande de build `npm run build`, dossier publié `dist`.
- **Sans variables** : l'appli affiche un écran « Serveur de jeu » où coller l'URL et la clé (enregistrées dans le navigateur).

La clé `anon` est faite pour être publique : la sécurité repose sur les règles RLS et sur l'Edge Function. Ne mets **jamais** la clé `service_role` dans l'appli.

## Comment fonctionne l'anti-triche

- Le paquet est mélangé et distribué **dans l'Edge Function** (générateur crypto), jamais dans le navigateur.
- Chaque action (`fold`, `check`, `call`, `raise`, `allin`) est revalidée par le moteur côté serveur : bon joueur, bon tour, montant légal, tapis suffisant.
- Les bots des parties en ligne jouent dans l'Edge Function et ne voient que leurs propres cartes.
- Chaque client reçoit l'état public + ses deux cartes, rien d'autre. Les cartes adverses n'apparaissent qu'à l'abattage.
- Le minuteur est contrôlé par le serveur : quand l'échéance est passée, n'importe quel client « réveille » le serveur (`tick`) qui vérifie l'heure lui-même et joue check ou fold à la place du joueur, qui passe « absent ».
- Écritures concurrentes protégées par un verrou optimiste (colonne `version`).

## Vérifier

```bash
npm test                                     # moteur, bots, logique des salles (Vitest)
deno test supabase/functions/poker           # Edge Function avec une base en mémoire
```

## Ménage (optionnel)

`select public.cleanup_old_rooms();` supprime les salles inactives depuis 2 jours. Tu peux la planifier avec l'extension `pg_cron`.
