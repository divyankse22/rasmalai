-- Rasmalai 0004 — the couple dashboard: game catalogue, matches, and lifetime aggregates.
--
-- Slice 5 only ever READS these tables; every write lands in slice 8, when matches start being
-- recorded. They are created together because the dashboard's numbers have to come from real
-- queries against real tables to be trustworthy at zero — a dashboard that hardcodes zeros is not
-- a dashboard that has been tested.
--
-- Two rules from docs/13_ARCHITECTURE_PROPOSAL.md shape everything below:
--
--   P-3  Win statistics are competitive-only. A cooperative, social or casual match increments
--        games-played and time-played and touches nothing else.
--   P-8  An abandoned match never counts. The row exists and is visible in the 7-day history, but
--        every aggregate and every dashboard counter filters `status = 'completed'`.

-- ---------------------------------------------------------------------------------------------
-- Game catalogue
-- ---------------------------------------------------------------------------------------------

-- docs/03_DATABASE_SCHEMA.md: "Game catalogue data should not be hardcoded in the UI." The web app
-- renders whatever is in this table, so shipping a game is a seed row plus a module, not a UI edit.
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  description text not null,

  -- How the catalogue groups it on screen.
  category text not null check (category in ('competitive', 'cooperative', 'social', 'casual')),

  -- What it does to statistics and to tournament points. Kept separate from `category` because
  -- docs/13 section 7 makes this the single field P-3 and P-4 branch on: a game could one day sit
  -- in the casual aisle and still be scored competitively, and statistics must not have to care
  -- where the catalogue files it.
  scoring_kind text not null check (
    scoring_kind in ('competitive', 'cooperative', 'social', 'casual')
  ),

  -- P-6: each game picks the cheapest renderer that works.
  renderer text not null check (renderer in ('react', 'phaser')),

  -- Everything is unlocked in V1 (CLAUDE.md) — this is not progression, it is "the module exists".
  -- An unbuilt game is listed as coming soon and cannot be invited to.
  enabled boolean not null default false,

  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- The V1 catalogue, transcribed from docs/01_PRODUCT_SPEC.md section 7. `enabled` starts false for
-- every one of them: not a single game module exists yet, and a catalogue that offered a game it
-- cannot start would be lying. Slice 7 flips reaction-speed, and each later game flips its own row.
insert into public.games (slug, name, description, category, scoring_kind, renderer, sort_order)
values
  ('reaction-speed',   'Reaction Speed',   'Wait for the signal. Tap first. Do not flinch early.',        'competitive', 'competitive', 'react',  10),
  ('four-in-a-row',    'Four in a Row',    'Drop, block, and sneak a diagonal past them.',                 'competitive', 'competitive', 'react',  20),
  ('reflex',           'Reflex',           'Dodge everything for as long as your nerves hold.',            'competitive', 'competitive', 'phaser', 30),
  ('basketball',       'Basketball',       'Flick, arc, swish. Trash talk optional.',                      'competitive', 'competitive', 'phaser', 40),

  ('bomb-defusal',     'Bomb Defusal',     'One of you sees the wires. The other has the manual.',         'cooperative', 'cooperative', 'react',  50),
  ('puzzle-solving',   'Puzzle Solving',   'Two halves of one puzzle, and no way to solve it alone.',      'cooperative', 'cooperative', 'react',  60),
  ('boat-escape',      'Boat Escape',      'Row together or sink together.',                               'cooperative', 'cooperative', 'phaser', 70),
  ('survival',         'Survival',         'Keep each other alive until the sun comes up.',                'cooperative', 'cooperative', 'phaser', 80),

  ('whos-more-likely', 'Who''s More Likely','Point at each other and find out who was right.',             'social',      'social',      'react',  90),
  ('never-have-i-ever','Never Have I Ever','Confess. Gently.',                                             'social',      'social',      'react', 100),
  ('would-you-rather', 'Would You Rather', 'Two terrible options. Choose. Explain yourself later.',        'social',      'social',      'react', 110),
  ('guess-my-answer',  'Guess My Answer',  'How well do you actually know them?',                          'social',      'social',      'react', 120),
  ('couple-trivia',    'Couple Trivia',    'Questions about the two of you. No googling.',                 'social',      'social',      'react', 130),
  ('truth-or-dare',    'Truth or Dare',    'The classic, scaled down to two people and one screen.',       'social',      'social',      'react', 140),

  ('drawing',          'Drawing',          'Draw badly. Be understood anyway.',                            'casual',      'casual',      'phaser',150),
  ('word-game',        'Word Game',        'Make words, steal letters, feel clever.',                      'casual',      'casual',      'react', 160),
  ('memory',           'Memory',           'Flip cards. Remember. Blame each other for forgetting.',       'casual',      'casual',      'react', 170)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Matches — raw history, 7 days only (ADR-008)
-- ---------------------------------------------------------------------------------------------

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  game_id uuid not null references public.games (id),

  mode text not null default 'individual' check (mode in ('individual', 'tournament')),

  -- P-8 lives here: 'abandoned' rows are written and shown, and counted by nothing.
  status text not null check (status in ('active', 'completed', 'abandoned')),

  -- Null on a draw, on a cooperative/social/casual match, and on anything unfinished. The server
  -- decides this; a client never sends it (docs/02 section 8).
  winner_user_id uuid references public.users (id) on delete set null,

  -- Scores follow the couple's fixed a/b slots, so a score can never be attributed to the wrong
  -- person. Higher is always better: this is the authoritative match score, not a raw measurement,
  -- so a game where lower is faster reports rounds won rather than milliseconds.
  score_a integer,
  score_b integer,

  started_at timestamptz not null default now(),
  ended_at timestamptz,

  -- Retention clock. Set at insert rather than generated, because `timestamptz + interval` is only
  -- STABLE (it depends on the session's timezone) and Postgres will not accept it in a generated
  -- column.
  expires_at timestamptz not null default (now() + interval '7 days'),

  constraint matches_finished_has_ended_at check (status = 'active' or ended_at is not null)
);

-- ADR-009: one active game session per couple. Enforced where it cannot be raced, rather than by
-- remembering to check first.
create unique index if not exists matches_one_active_per_couple
  on public.matches (couple_id) where status = 'active';

-- The 7-day dashboard query: couple, then window, newest first.
create index if not exists matches_couple_started_idx
  on public.matches (couple_id, started_at desc);

-- The retention job's only query.
create index if not exists matches_expires_at_idx on public.matches (expires_at);

-- ---------------------------------------------------------------------------------------------
-- Lifetime aggregates — the half that survives retention (P-5)
-- ---------------------------------------------------------------------------------------------

-- One row per couple, snapshotted at match completion, so deleting a 7-day-old match loses nothing.
--
-- Formulas, fixed here so slice 8 has nothing left to invent:
--   total_games          every completed match, any category (P-3)
--   competitive_games    completed matches whose game has scoring_kind = 'competitive'
--   wins / draws         competitive only; a draw is a completed competitive match with no winner
--   current_streak       consecutive competitive wins by that person; a loss OR a draw resets it
--                        to zero, because a draw is not a win
--   longest_streak       the high-water mark of the above
--   closest_match        the smallest |score_a - score_b| ever recorded in a completed competitive
--                        match, kept with the game and date so it can be named on screen
create table if not exists public.lifetime_statistics (
  couple_id uuid primary key references public.couples (id) on delete cascade,

  total_games integer not null default 0,
  competitive_games integer not null default 0,

  user_a_wins integer not null default 0,
  user_b_wins integer not null default 0,
  draws integer not null default 0,

  user_a_current_streak integer not null default 0,
  user_b_current_streak integer not null default 0,
  user_a_longest_streak integer not null default 0,
  user_b_longest_streak integer not null default 0,

  total_time_played_seconds bigint not null default 0,

  closest_match_margin integer,
  closest_match_game_id uuid references public.games (id) on delete set null,
  closest_match_at timestamptz,

  tournament_wins_a integer not null default 0,
  tournament_wins_b integer not null default 0,

  updated_at timestamptz not null default now(),

  constraint lifetime_statistics_counts_are_sane check (
    total_games >= competitive_games
    and competitive_games >= user_a_wins + user_b_wins + draws
  )
);

-- Per-couple, per-game counters.
--
-- "Favourite game" and "most competitive game" are DERIVED from these rows rather than stored as
-- columns on lifetime_statistics: a denormalised favourite has to be recomputed on every match and
-- can silently drift out of step, whereas a counter table can only ever be counted. Best score is
-- per game for the same reason it is shown per game — a basketball 34 and a five-round win are not
-- the same kind of number and must never be compared.
create table if not exists public.couple_game_stats (
  couple_id uuid not null references public.couples (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,

  plays integer not null default 0,
  user_a_wins integer not null default 0,
  user_b_wins integer not null default 0,
  draws integer not null default 0,

  -- Running sum of |score_a - score_b| and the number of matches that fed it. Keeping both means
  -- the average margin stays exact after the matches themselves have expired, which is what makes
  -- "most competitive game" survive retention.
  margin_total bigint not null default 0,
  margin_samples integer not null default 0,

  user_a_best_score integer,
  user_b_best_score integer,

  total_time_played_seconds bigint not null default 0,
  updated_at timestamptz not null default now(),

  primary key (couple_id, game_id)
);

drop trigger if exists lifetime_statistics_set_updated_at on public.lifetime_statistics;
create trigger lifetime_statistics_set_updated_at
  before update on public.lifetime_statistics
  for each row execute function public.set_updated_at();

drop trigger if exists couple_game_stats_set_updated_at on public.couple_game_stats;
create trigger couple_game_stats_set_updated_at
  before update on public.couple_game_stats
  for each row execute function public.set_updated_at();

-- Couples paired before this migration existed still need somewhere for their numbers to live.
-- New couples get their row inside the accept transaction (docs/13 section 4).
insert into public.lifetime_statistics (couple_id)
select id from public.couples
on conflict (couple_id) do nothing;

-- Deny-all backstop, exactly as on every other table (docs/13 section 2). The catalogue is not
-- secret, but it is still only ever read through the backend, so it gets no policy either.
alter table public.games enable row level security;
alter table public.matches enable row level security;
alter table public.lifetime_statistics enable row level security;
alter table public.couple_game_stats enable row level security;
