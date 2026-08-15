-- Rasmalai 0005 — game invitations.
--
-- Invitations are persisted rather than kept in memory (docs/13_ARCHITECTURE_PROPOSAL.md section 5)
-- for two reasons: a partner who is offline when one is sent still finds it waiting, and a backend
-- restart cannot lose one. Live *sessions* stay in memory; the invitation that started them does
-- not.

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  game_id uuid not null references public.games (id),

  -- The sender. The other partner is derived from the couple, never sent by the browser.
  created_by_user_id uuid not null references public.users (id) on delete cascade,

  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'rejected', 'expired', 'cancelled', 'invalidated')
  ),

  -- P-7: a decline may carry a counter-proposal, which is a new invitation in the opposite
  -- direction created in the same transaction. This is the link back to the one it answers, so the
  -- exchange can be read as a conversation rather than two unrelated rows.
  replaces_invitation_id uuid references public.invitations (id) on delete set null,

  created_at timestamptz not null default now(),

  -- Five minutes (docs/01 section 10). Set at insert for the same reason as matches.expires_at:
  -- `timestamptz + interval` is only STABLE, so Postgres will not have it in a generated column.
  expires_at timestamptz not null default (now() + interval '5 minutes'),

  responded_at timestamptz,

  constraint invitations_answered_has_responded_at check (
    status = 'pending' or responded_at is not null
  )
);

-- ADR-010, and the whole of "one active invitation per couple".
--
-- This index is what actually enforces it. Invalidating the previous row and inserting the new one
-- happen inside one transaction, and the index makes the race unwinnable — two devices sending
-- different invitations at the same moment cannot both end up pending.
create unique index if not exists invitations_one_active_per_couple
  on public.invitations (couple_id) where status = 'pending';

-- Reading a couple's invitation history, newest first.
create index if not exists invitations_couple_created_idx
  on public.invitations (couple_id, created_at desc);

-- The sweeper's only query: pending rows that are past their moment.
create index if not exists invitations_pending_expiry_idx
  on public.invitations (expires_at) where status = 'pending';

-- No updated_at trigger: an invitation is written once and then answered once. `responded_at` is
-- the only mutation it ever sees, and it says more than a generic timestamp would.
alter table public.invitations enable row level security;

-- Reaction Speed becomes invitable.
--
-- Its rules land in slice 7; until then accepting an invitation reaches a placeholder session that
-- says so. Enabling it now is what lets the invitation, lobby, countdown and reconnect machinery be
-- exercised end to end against the game they were designed around, rather than against a throwaway
-- row that would need removing later.
update public.games set enabled = true where slug = 'reaction-speed';
