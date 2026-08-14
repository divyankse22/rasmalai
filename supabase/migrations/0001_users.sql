-- Rasmalai 0001 — user profiles.
--
-- Identity itself lives in Supabase's auth.users. This table holds only what Rasmalai adds on top,
-- keyed by the same id, so there is exactly one source of truth for who someone is. We deliberately
-- do NOT copy the Google subject or email here: duplicating an identity key invites drift, and
-- auth.users already stores both.

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,

  -- Profile, collected during onboarding.
  actual_name text not null check (char_length(trim(actual_name)) between 1 and 60),
  nickname text not null check (char_length(trim(nickname)) between 1 and 30),
  birth_year integer not null check (birth_year between 1900 and 2100),
  avatar_key text not null check (char_length(avatar_key) between 1 and 40),

  -- P-1: what THIS user privately calls their partner. Asymmetric and never shown to the partner.
  -- Captured before pairing exists, and never overwritten by the partner's real profile.
  partner_label_name text not null check (char_length(trim(partner_label_name)) between 1 and 60),
  partner_label_nickname text not null check (char_length(trim(partner_label_nickname)) between 1 and 30),

  -- P-2: this user's own answer. On pairing, the requester's values seed the couple record.
  first_met_date date not null,
  location_type text not null check (
    location_type in ('same_city', 'different_city', 'live_in', 'prefer_not_to_say')
  ),

  -- Private pairing code. Random, never sequential (docs/07_SECURITY_PRIVACY.md).
  pairing_code text not null unique check (char_length(pairing_code) = 8),

  onboarding_completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Codes are looked up by exact match during pairing; the unique constraint already indexes it.

create or replace function public.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- Deny-all backstop, per docs/13_ARCHITECTURE_PROPOSAL.md section 2.
-- Every read and write goes through the Node backend, which connects as the postgres role and
-- enforces couple scoping itself. RLS is enabled with no policy at all, so if the publishable key
-- ever ends up somewhere it should not, this table is still unreadable from the browser.
alter table public.users enable row level security;
