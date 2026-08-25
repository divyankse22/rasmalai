-- Rasmalai 0002 — permanent pairing.
--
-- ADR-006: pairing is permanent in V1, which is what lets every couple-scoped query derive its
-- couple from membership rather than from anything the browser sends.

create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),

  -- user_a is always the requester, user_b always the accepter. Fixing the slots means the pair
  -- has a stable a/b ordering for scores and statistics later.
  user_a_id uuid not null references public.users (id) on delete cascade,
  user_b_id uuid not null references public.users (id) on delete cascade,

  -- P-2: seeded from the requester's onboarding answers; either partner may edit later.
  first_met_date date not null,
  location_type text not null check (
    location_type in ('same_city', 'different_city', 'live_in', 'prefer_not_to_say')
  ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint couples_distinct_members check (user_a_id <> user_b_id)
);

-- A person belongs to at most one couple. Two unique indexes are not enough on their own - someone
-- could be user_a in one couple and user_b in another - so users.couple_id below closes that gap
-- by construction, and these make each slot unique within the table.
create unique index if not exists couples_user_a_unique on public.couples (user_a_id);
create unique index if not exists couples_user_b_unique on public.couples (user_b_id);

drop trigger if exists couples_set_updated_at on public.couples;
create trigger couples_set_updated_at
  before update on public.couples
  for each row execute function public.set_updated_at();

-- One nullable column on users is what actually makes "at most one couple" impossible to violate:
-- a single row cannot hold two values.
alter table public.users
  add column if not exists couple_id uuid references public.couples (id) on delete set null;

create index if not exists users_couple_id_idx on public.users (couple_id);

create table if not exists public.pairing_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.users (id) on delete cascade,
  target_user_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,

  constraint pairing_requests_distinct_users check (requester_user_id <> target_user_id)
);

-- Pending requests live forever until answered (docs/01 section 10), so the guard against spamming
-- someone is that only one pending request may exist between a given pair, in either direction.
-- least/greatest normalises the pair so (a -> b) and (b -> a) collide.
create unique index if not exists pairing_requests_one_pending_per_pair
  on public.pairing_requests (
    least(requester_user_id, target_user_id),
    greatest(requester_user_id, target_user_id)
  )
  where status = 'pending';

create index if not exists pairing_requests_target_pending_idx
  on public.pairing_requests (target_user_id) where status = 'pending';

alter table public.couples enable row level security;
alter table public.pairing_requests enable row level security;
