-- Rasmalai 0011 — finishing what 0010 started: tournaments become a real request/accept flow.
--
-- 0010 added `request_expires_at` but nothing ever wrote to it, because `pending` was still only
-- the fleeting mid-transaction value it always was: `createTournament` set `status = 'active'`
-- immediately and nobody ever saw a tournament sit `pending`. From here, `pending` means what it
-- says — a request the other partner has not answered yet — the same way `invitations.status`
-- already works (docs/06). That needs two more terminal outcomes an invitation already has and a
-- tournament never did: the receiver said no (`declined`, kept distinct from `abandoned`, which
-- means a series that was running and got given up on mid-way — not the same event), and nobody
-- answered in time (`expired`, which is the entire reason the sweeper in this same slice exists).
-- `cancelled` covers the third: the creator taking back a request before it was answered, mirroring
-- `invitations.cancel`.

alter table public.tournaments drop constraint tournaments_status_check;
alter table public.tournaments add constraint tournaments_status_check
  check (status in ('pending', 'active', 'paused', 'completed', 'abandoned', 'declined', 'expired', 'cancelled'));
