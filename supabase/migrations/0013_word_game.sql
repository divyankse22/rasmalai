-- Rasmalai 0013 — Word Game becomes invitable, and it is scored.
--
-- No new table, no new column, no new index. The sixth game in a row to need nothing from the
-- schema, which is the point of the game contract.
--
--   word-game  casual  react  — twelve letters, one bag, and whoever holds the most at the end
--
-- Filed casual, scored competitively: the third game to split those two fields, after Memory
-- (`0009`) and Would You Rather (`0012`). Casual is the right aisle — it is a light game you can
-- finish in four minutes — but somebody wins it by a margin, on purpose, so a result of it has to
-- count. `category` is where the catalogue shelves a game; `scoring_kind` is what a result means
-- (P-3, P-4).
--
-- The module's `meta.ts` says the same thing, and `catalogue.test.ts` holds the two against each
-- other in both directions. They are read by different halves of the product — the session registry
-- reads the module to decide what the results screen says, the statistics read this column to
-- decide what is counted — so a disagreement would announce a winner and then decline to record
-- them.

update public.games set enabled = true
 where slug = 'word-game';

update public.games set scoring_kind = 'competitive' where slug = 'word-game';
