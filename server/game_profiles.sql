-- ============================================================
-- Inkogniflix Spiel-Konto: im Supabase-Dashboard unter "SQL Editor" einmal ausführen.
-- Gleiche Konten wie auf der Website (profiles / auth). Neu ist nur diese Tabelle.
-- Sicherheitsidee: Der Browser darf NUR seine Einstellungen ändern.
--   Coins, Siege, Avatar-Käufe usw. kann ausschließlich der Spielserver (service_role) verändern.
-- ============================================================

create table if not exists public.game_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  coins      integer     not null default 0 check (coins >= 0),
  wins       integer     not null default 0 check (wins >= 0),
  games      integer     not null default 0 check (games >= 0),
  avatar     jsonb       not null default '{}'::jsonb check (pg_column_size(avatar) < 4096),
  unlocked   jsonb       not null default '[]'::jsonb check (pg_column_size(unlocked) < 8192),
  settings   jsonb       not null default '{}'::jsonb check (pg_column_size(settings) < 4096),
  created_at timestamptz not null default now()
);

alter table public.game_profiles enable row level security;

-- Alle Rechte erst einmal entziehen, dann gezielt vergeben
revoke all on public.game_profiles from anon, authenticated;
grant select on public.game_profiles to authenticated;
grant update (settings) on public.game_profiles to authenticated;   -- nur diese eine Spalte!

drop policy if exists "game_profiles_select_own" on public.game_profiles;
create policy "game_profiles_select_own" on public.game_profiles
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "game_profiles_update_own" on public.game_profiles;
create policy "game_profiles_update_own" on public.game_profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Eigenes Spiel-Konto mit Startwerten anlegen (der Browser kann nichts anderes einfügen)
create or replace function public.game_init() returns void
language sql security definer set search_path = public as $$
  insert into public.game_profiles (user_id) values (auth.uid()) on conflict do nothing;
$$;
revoke all on function public.game_init() from public, anon;
grant execute on function public.game_init() to authenticated;

-- Coins/Siege vergeben: darf NUR der Spielserver (service_role), nie ein Browser
create or replace function public.game_award(p_user uuid, p_coins integer, p_win boolean) returns void
language sql security definer set search_path = public as $$
  update public.game_profiles
     set coins = coins + greatest(p_coins, 0),
         wins  = wins + (case when p_win then 1 else 0 end),
         games = games + 1
   where user_id = p_user;
$$;
revoke all on function public.game_award(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.game_award(uuid, integer, boolean) to service_role;
