-- Rasmalai 0010 — tournament requests.
--
-- Starting a tournament now works like a game invitation (docs/06): the creator's row is inserted
-- `pending`, the partner answers, and only an accept opens the session and activates the first
-- game. `pending` was already a legal `tournaments.status` (0008) for exactly this purpose, and the
-- partial unique index on (couple_id) where status in ('pending', 'active', 'paused') already
-- covers a request awaiting an answer the same way it covers a series in progress — nothing there
-- needs to change for a couple to be limited to one live tournament, request or not.

alter table public.tournaments add column if not exists request_expires_at timestamptz;

-- The sweeper's only query: pending rows past their moment, the same shape as
-- invitations_pending_expiry_idx (0005).
create index if not exists tournaments_pending_expiry_idx
  on public.tournaments (request_expires_at) where status = 'pending';
