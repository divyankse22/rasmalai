-- Rasmalai 0012 — Would You Rather becomes invitable, and it is scored.
--
-- No new table, no new column, no new index — the fifth time adding a game has needed nothing at
-- all from the schema.
--
--   would-you-rather  social  react  — three dilemmas, one victim, and whoever reads the other best
--
-- Filed under social, scored competitively: the same shape `0009` gave Memory, and for a similar
-- reason. Guess My Answer deliberately refuses to name a winner, because both seats are handed the
-- same question and neither chose it. Here the Asker picks which of three dilemmas to inflict
-- before betting on the answer — they chose the ground to fight on, and calling it three times out
-- of three is beating somebody. `category` is which aisle the catalogue shelves a game in;
-- `scoring_kind` is what a result of it means (P-3, P-4).
--
-- This has to move here as well as in `packages/games/src/would-you-rather/meta.ts`, because the two
-- are read by different halves of the product: the session registry reads the module's
-- `scoringKind` to decide what the results screen says, and the statistics read this column to
-- decide what gets counted. A results screen announcing a winner that the dashboard then declines
-- to record would be the quietest possible bug. `catalogue.test.ts` holds the two against each
-- other, in both directions.

update public.games set enabled = true
 where slug = 'would-you-rather';

update public.games set scoring_kind = 'competitive' where slug = 'would-you-rather';
