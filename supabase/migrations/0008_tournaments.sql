-- Rasmalai 0008 — tournaments.
--
-- A tournament is a locked sequence of games played for points: win 3, draw 1, lose 0.
-- Only competitive games score (P-4); non-competitive games run as unscored rounds.
--
-- Two rules from the architecture proposal:
--   P-4  Only competitive games score 3/1/0. Non-competitive games run as unscored rounds.
--   D-2  Each game slug appears at most once in a tournament.
--   D-5  A paused tournament expires after 48 hours and is abandoned.
--
-- docs/01 §9, docs/03 §tournaments, docs/04 §6, docs/13 §6.

-- ---------------------------------------------------------------------------------------------
-- Tournaments
-- ---------------------------------------------------------------------------------------------

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,

  -- D-4: creator names the tournament.
  name text not null,

  -- 'pending' exists only long enough to insert the games; the first session sets 'active'.
  status text not null check (status in ('pending', 'active', 'paused', 'completed', 'abandoned')),

  created_by_user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,

  -- D-5: when a paused tournament must be resumed by, or null while it is running. Set to
  -- now() + interval '2 days' on pause. The retention sweep abandons rows past this deadline.
  paused_until timestamptz,

  -- The couple's fixed a/b slots, exactly as everywhere else.
  total_points_a integer not null default 0,
  total_points_b integer not null default 0,

  winner_user_id uuid references public.users (id) on delete set null
);

-- One active or paused tournament per couple — the same principle as ADR-009 for sessions.
-- A couple cannot start a second tournament until the first is finished or abandoned.
create unique index if not exists tournaments_one_active_per_couple
  on public.tournaments (couple_id) where status in ('pending', 'active', 'paused');

-- ---------------------------------------------------------------------------------------------
-- Tournament games — the locked game list
-- ---------------------------------------------------------------------------------------------

create table if not exists public.tournament_games (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  game_id uuid not null references public.games (id),

  -- 1-indexed position in the series.
  position integer not null,

  -- Set when the match for this game has been played.
  match_id uuid references public.matches (id) on delete set null,

  -- P-4: derived from games.scoring_kind = 'competitive' at insertion time, so a non-competitive
  -- game never accidentally scores. Kept here rather than joined at read time because the game
  -- list is locked at creation and must not change if the catalogue row is later recategorised.
  scored boolean not null,

  status text not null default 'pending' check (
    status in ('pending', 'active', 'completed', 'skipped')
  ),

  -- 3/1/0 for scored games, 0/0 for unscored (D-6).
  points_a integer not null default 0,
  points_b integer not null default 0,

  -- Each game once (D-2), and positions cannot collide.
  unique (tournament_id, position),
  unique (tournament_id, game_id)
);

-- ---------------------------------------------------------------------------------------------
-- Link matches to their tournament
-- ---------------------------------------------------------------------------------------------

-- Nullable: only tournament matches carry one. Existing individual matches remain null.
alter table public.matches add column if not exists
  tournament_id uuid references public.tournaments (id) on delete set null;

-- ---------------------------------------------------------------------------------------------
-- RLS deny-all backstop, exactly as on every other table (docs/13 section 2).
-- ---------------------------------------------------------------------------------------------

alter table public.tournaments enable row level security;
alter table public.tournament_games enable row level security;
