-- Rasmalai 0007 — Four in a Row becomes invitable.
--
-- The whole of slice 7b's database footprint is this one line, and that is the point of it. The
-- catalogue row itself has existed since 0004, with `enabled = false` because the module behind it
-- did not: `public.games.enabled` means "somebody wrote this game", not "this couple has earned it"
-- (everything is unlocked in V1). Now that `packages/games/src/four-in-a-row` exists, the row can
-- stop lying.
--
-- Nothing else in the schema moved. A second game needed no new table, no new column and no new
-- index, which is the claim docs/13 section 8 makes about the game contract, checked against the
-- only thing that cannot be argued with.

update public.games set enabled = true where slug = 'four-in-a-row';
