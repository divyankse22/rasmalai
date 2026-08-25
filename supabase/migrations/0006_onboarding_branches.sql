-- Rasmalai 0006 — onboarding asks each question of exactly one person.
--
-- 0001 made every profile column NOT NULL because onboarding was one form that asked everybody
-- everything. It asked *both* partners for the day they met and where they live, then threw one of
-- the two answers away: 0002's couple record is seeded from a single side, so the loser's answer
-- sat in their row forever, contradicting the couple and visible to nothing. "Days together" is
-- computed from that date, so the headline number on the dashboard came down to which of them
-- happened to send the pairing request.
--
-- Now the questions have an author. Whoever arrives first answers them; whoever arrives holding a
-- partner code is never asked, and their columns stay null. A null here is not missing data — it
-- means "this person was never the author of this fact", and the couple's copy is the only one
-- that counts.
--
-- The same reasoning retires two name columns. A person now gives one name for themselves and one
-- private label for their partner, so `actual_name` and `partner_label_name` stop being collected.
-- Nothing is dropped: existing rows keep what they said, and the columns can go once that history
-- is confirmed unwanted.
--
-- No `check` constraint needs touching. A `check` over a NULL evaluates to NULL, which passes, so
-- the length rules still bind every non-null value exactly as before.

alter table public.users alter column actual_name        drop not null;
alter table public.users alter column partner_label_name drop not null;
alter table public.users alter column first_met_date     drop not null;
alter table public.users alter column location_type      drop not null;

-- public.couples.first_met_date and location_type stay NOT NULL, deliberately.
--
-- That a couple has exactly one agreed first-met date is the entire point of the change above, and
-- this constraint is what enforces it rather than merely hoping for it. The pairing transaction
-- resolves the couple's copy with coalesce(code owner, requester) and refuses to create a couple
-- when neither of them ever answered, so this can only fail if that logic is broken — which is
-- exactly when a loud failure is worth having.
