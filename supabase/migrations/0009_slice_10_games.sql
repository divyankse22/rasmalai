-- Rasmalai 0009 — four more games become invitable, and Memory starts counting.
--
-- Slice 10's whole database footprint. No new table, no new column, no new index — the fourth time
-- in a row that adding games has needed nothing from the schema, and the first time it has been
-- four at once. `public.games.enabled` means "somebody wrote this game", not "this couple has
-- earned it": everything is unlocked in V1, and a row is flipped here the moment a module exists
-- under `packages/games/src`.
--
-- What ships with this migration:
--
--   memory           casual      react   — a shared board whose faces only the server knows
--   guess-my-answer  social      react   — both of you answer at once, in secret
--   bomb-defusal     cooperative react   — two different screens, neither playable alone
--   reflex           competitive phaser  — the first canvas game
--
-- That takes the catalogue from two playable games to six, which also resolves known limitation 25:
-- D-1 puts the minimum tournament at three games, so until now the create screen could not reach a
-- legal selection. It can now, across all four categories.

update public.games set enabled = true
 where slug in ('memory', 'guess-my-answer', 'bomb-defusal', 'reflex');

-- ---------------------------------------------------------------------------------------------
-- Memory is scored competitively, even though it is filed under casual
-- ---------------------------------------------------------------------------------------------
--
-- `0004` seeded every game with `scoring_kind = category`, which was the right default with no
-- modules written: nothing had a scoreline yet to be wrong about. Memory has one. Turning up more
-- pairs than your partner is beating them — there is a winner, a loser, a margin, and a rematch
-- worth asking for — and P-3 would file all of that under "counts towards nothing" purely because
-- the game sits in the casual aisle.
--
-- The two columns exist separately for exactly this: `category` is where the catalogue shelves a
-- game, `scoring_kind` is what a result of it means (P-3, P-4), and the game contract says in as
-- many words that a game may be shelved casual and scored competitively.
--
-- This has to move here rather than only in `packages/games/src/memory/meta.ts`, because the two
-- are read by different halves of the product and would otherwise disagree: the session registry
-- reads the module's `scoringKind` to decide what the results screen says, and the statistics read
-- this column to decide what gets counted. A game whose result screen announced a winner that the
-- dashboard then declined to record would be the quietest possible bug.
--
-- The other three keep the scoring their category implies. Guess My Answer and Bomb Defusal have no
-- winner by design, and Reflex was already competitive.

update public.games set scoring_kind = 'competitive' where slug = 'memory';
