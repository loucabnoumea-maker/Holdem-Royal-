-- Hold'em Royal — schéma multijoueur
-- Principe : tout l'état de jeu (paquet compris) vit dans room_secrets, lisible
-- UNIQUEMENT par l'Edge Function (clé service_role). Les clients ne lisent que :
--   • room_public  : état public de la salle (membres uniquement)
--   • hole_cards   : LEURS deux cartes (RLS : player_id = auth.uid())
--   • chat_messages

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.room_secrets (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  data jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.room_public (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  code text not null,
  data jsonb not null,
  version integer not null default 0,
  server_now bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  name text not null,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.hole_cards (
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null,
  hand_number integer not null,
  cards jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (room_id, player_id)
);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  name text not null default '',
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_room_idx on public.chat_messages (room_id, created_at);

-- ---------------------------------------------------------------- RLS
alter table public.rooms enable row level security;
alter table public.room_secrets enable row level security;   -- aucune policy : service_role seulement
alter table public.room_public enable row level security;
alter table public.room_members enable row level security;
alter table public.hole_cards enable row level security;
alter table public.chat_messages enable row level security;

create or replace function public.is_room_member(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.room_members where room_id = rid and user_id = auth.uid());
$$;

drop policy if exists "membres lisent l'état public" on public.room_public;
create policy "membres lisent l'état public" on public.room_public
  for select to authenticated using (public.is_room_member(room_id));

drop policy if exists "chaque joueur ne lit que ses cartes" on public.hole_cards;
create policy "chaque joueur ne lit que ses cartes" on public.hole_cards
  for select to authenticated using (player_id = auth.uid());

drop policy if exists "lire sa propre adhésion" on public.room_members;
create policy "lire sa propre adhésion" on public.room_members
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "membres lisent le chat" on public.chat_messages;
create policy "membres lisent le chat" on public.chat_messages
  for select to authenticated using (public.is_room_member(room_id));

drop policy if exists "membres écrivent dans le chat" on public.chat_messages;
create policy "membres écrivent dans le chat" on public.chat_messages
  for insert to authenticated with check (user_id = auth.uid() and public.is_room_member(room_id));

-- Le pseudo affiché dans le chat vient de room_members (impossible d'usurper un nom).
create or replace function public.chat_set_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  select name into new.name from public.room_members where room_id = new.room_id and user_id = auth.uid();
  if new.name is null then
    raise exception 'Pas membre de la salle';
  end if;
  new.body := left(btrim(new.body), 300);
  return new;
end;
$$;

drop trigger if exists chat_set_name on public.chat_messages;
create trigger chat_set_name before insert on public.chat_messages
  for each row execute function public.chat_set_name();

-- ---------------------------------------------------------------- Droits (API de données)
-- Les règles RLS ci-dessus restent le vrai filtre ; ces droits rendent seulement les tables visibles à l'API.
grant usage on schema public to anon, authenticated;
grant select on public.room_public to authenticated;
grant select on public.hole_cards to authenticated;
grant select on public.room_members to authenticated;
grant select, insert on public.chat_messages to authenticated;
revoke all on public.room_secrets from anon, authenticated;
revoke all on public.rooms from anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------- Temps réel
do $$
begin
  begin alter publication supabase_realtime add table public.room_public; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.hole_cards; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.chat_messages; exception when duplicate_object then null; end;
end $$;

-- Ménage : salles inactives depuis plus de 2 jours (à lancer à la main ou via pg_cron)
create or replace function public.cleanup_old_rooms()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rooms r
  where not exists (
    select 1 from public.room_public p where p.room_id = r.id and p.updated_at > now() - interval '2 days'
  ) and r.created_at < now() - interval '2 days';
$$;
