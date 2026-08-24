# Implementation Progress

Companion to `docs/13_ARCHITECTURE_PROPOSAL.md`. That document records **intent** — the locked
decisions. This one records **state**: what exists, what has actually been verified, and what is
knowingly incomplete.

Update it at the end of every slice.

Last updated: after slice 13 — Word Game, and the first dictionary.

---

## Slice status

| Slice | Scope | Status |
|---|---|---|
| 1 | Monorepo, tooling, design tokens, Docker, health endpoint | **done, verified** |
| 2 | Supabase Google auth, guarded routes, authenticated socket | **done, verified** |
| 3 | Onboarding, first migration, profiles, pairing codes | **done, verified** |
| 4 | Pairing: codes, requests, accept/reject, permanent couple | **done, verified** |
| 5 | Couple dashboard, catalogue, statistics read path | **done, verified** |
| 6 | Realtime: invitations, TTL, lobby, ready, countdown, reactions | **done, verified** |
| 7 | Reaction Speed (first game, end to end) | **done, verified** |
| 7b | Four in a Row | **done, verified** |
| 7c | Session clock rework, partner presence, offline gate | **done**, automated gate green; two-account browser run outstanding |
| 8 | Match records, lifetime aggregates, streaks, retention job | **done**, automated gate green; two-account browser run outstanding |
| 9 | Tournaments: create, lock, sequential play, 3/1/0, restart-on-failed-reconnect | **done**, automated gate green; two-account browser run outstanding |
| 10 | Memory, Guess My Answer, Bomb Defusal, Reflex (Phaser), Basketball (Phaser); counter-proposal UI; score units; tournament requests | **done**, automated gate green; two-account browser run outstanding |
| 11 | Integration lane: five games through the real registry against real Postgres; tournament stalling rule | **done, verified** against the live database |
| 12 | Would You Rather: asymmetric ask/answer/predict, 60-dilemma deck, competitive scoring | **done**, automated gate green; two-account browser run outstanding |
| 13 | Word Game: SCOWL dictionary, raid stealing, golden tile, comeback rule | **done**, automated gate green; two-account browser run outstanding |
| 14+ | Boat Escape, mobile polish, deployment | not started |

Gate at the time of writing: **738 tests passing**, typecheck, lint and both builds green
(`npm run verify`), plus **34 integration checks in 8 files** against real Postgres
(`npm run test:integration`) — real matches played through the real session registry by throwaway
Supabase accounts, created, paired and deleted by the run itself.

**Slice 10's four games have now been run against a live database.** Slice 11 put Memory, Guess My
Answer, Bomb Defusal, Reflex and Basketball through `sessionRegistry` against real Postgres, and all
twelve migrations are applied. What is still outstanding for slices 7c and 8–11 alike is the
**two-account browser run**: nobody has played any of these games in two browser profiles. See known
limitations 29–31.

**Give Up, added platform-wide after slice 13.** A player can now concede mid-match — needing
nobody's agreement, unlike `requestLeave`, because the whole point is deciding the match right there
rather than asking. Reuses `forfeit`'s existing walkover machinery (`sessionRegistry.ts`'s new
`concede`): a competitive game awards the other seat the win, but with the real board's *current*
score (`RunningMatch.currentResult`, a new accessor onto each game's pure `getResult`) rather than a
fabricated 1–0 — the match genuinely happened, right up until somebody chose to stop. A game with no
winner to award (P-3) just ends, the same as any other forfeit of that kind, with its own honest
`SessionEndReason` ('gave_up' → "backed off") distinct from a timeout's ('forfeited' → "did not make
it back"). `MatchResultView.byGiveUp` lets `ResultBanner` tell the two walkovers apart on screen.
Every game gets a "Give up" button in `PlayScreen` for free, since the mechanism lives entirely at
the platform layer and no `GameRules` contract changed. Covered by rulebook-adjacent tests in
`sessionRegistry.test.ts` (real board score, forced winner regardless of who is currently ahead,
P-3 split, authorization) and `sessionEnding.test.ts`; not yet through a two-account browser run,
same as everything else on that list.

---

## Slice 13: the first game that needs a dictionary

Nine games. Every rulebook before this one was self-contained — the rules were the whole truth, and
a test could replay a match from first principles. Word Game has to ask something outside itself
whether a word is a word.

**The licence was the gating decision, and it eliminated the obvious answer.** The natural way to
stop a word game feeling broken is to filter a big list by word frequency, and every convenient
frequency source — `google-10000-english` and its forks — derives from the LDC-distributed Google
corpus and claims only *"educational and personal/research use… and US fair use doctrine."* That is
not a licence to redistribute in a product, so none of it is here. **SCOWL** avoided the question
entirely: its size bands are already a commonness ranking, so no second dataset was needed. Its
licence is permissive, the notice is vendored beside the data, and `scripts/dictionary/` rebuilds
the whole thing reproducibly.

Size 50, because SCOWL's own documentation says size 80 is "all the strange and unusual words people
like to use in word games such as Scrabble" — `qat`, `zax`, `cwm`. After filtering to a-z, three to
twelve letters, and excluding the proper-name, abbreviation and contraction lists structurally,
**58,252 words**. Twenty-one more were subtracted by a blocklist: size 50 is mainstream English and
therefore contains slurs, because a spell checker has to know them and a game does not. Mild
profanity was deliberately kept.

**The dictionary ships as a TypeScript module, not a data file.** tsup bundles `@rasmalai/games`
into `apps/server/dist`, so a loose `.txt` would not survive the bundle and reading one at runtime
would need a path that differs between the tests, the dev server and the container. 525KB of words
gzipped and base64-encoded is 204KB of source, decoded once on first use. It sits behind the same
three fences as Would You Rather's deck — no browser-reachable import, the package `exports` map,
and an eslint ban — and the third one proved itself immediately: the integration test's first
attempt to import it by package specifier failed, exactly as intended, and now reaches source by
relative path rather than the fence being widened.

**No move clock, deliberately.** `turnOf` returns null. Naming a seat would put it on the platform's
120-second window, and since slice 11 a present player who runs that out forfeits — but hunting for
a word in twelve letters legitimately takes longer than two minutes. The 120 seconds still governs
an actual disconnect through `reconnectPolicy`, which is a different mechanism; only one of the two
was relaxed. A forty-turn cap is what keeps the match finite in the absence of a clock.

A word that is not a word costs the player **nothing but the attempt** — they are told, and the turn
stays theirs. The pool is public and the dictionary is not, so a player cannot know whether `snarf`
is in it, and losing a turn to a guess would make the game about memorising a word list.

**Two seams were left open on request**, and both are named functions with a documented contract
rather than plugin machinery: `mayAct` is the entire turn rule, so real-time claiming is a one-line
change; `raidThreshold` and `applyRaid` are the entire stealing rule, so a Snatch-style steal
replaces two functions. `ClaimAction.steal` already names a word rather than a letter, which is the
shape Snatch needs. `docs/16_WORD_GAME.md` has the rules, the dictionary pipeline and both seams.

---

## Slice 12: the first game where you choose the question

Eight games now. This one exists because the catalogue had a gap that was not a category — every
game so far hands both seats the same problem. Would You Rather does not: one of them is dealt three
dilemmas and picks which to inflict, and only then bets on the answer.

**It was designed, not implemented.** No specification for any of the ten remaining games existed
in this repository — `docs/01` section 7 and `docs/05` list them as names, and the richest
description anywhere was one line of marketing copy in the `0004` seed. The written spec supplied
for this slice is the first real design input the game has ever had, and it is now a governing
document alongside the numbered ones.

**Two documented product decisions were deliberately reversed, and both are written down.**
`docs/01` section 8 asks for games that feel "cute, playful, chaotic", and `guess-my-answer` files
its own bank as "deliberately gentle — the wrong place for a question that can start an argument".
This game is specified to be psychologically uncomfortable. Rather than pick a winner, the deck is
**banded by difficulty**: rounds 1–2 draw from 1–2, rounds 3–4 from 2–4, rounds 5–6 from 3–5. The
match warms up. Nobody opens with mortality and nobody finishes on whether they like being early,
and `difficulty` stopped being metadata and became the thing that schedules the evening.

The second reversal is scoring. `guess-my-answer/meta.ts` says plainly that "beating your partner at
knowing them is not a thing this product wants to encourage", and that stays true of *that* game,
where neither seat chose the question. Here the Asker picked the ground before placing the bet, so
`scoringKind` is `competitive` while `category` stays `social` — the shape Memory already
established, with `0012` moving `games.scoring_kind` to match.

**The deck lives in `deck.ts`, not `protocol.ts`, and that is the one real architectural call.**
Guess My Answer publishes its fourteen questions to the browser, which is right for a game where
both seats see the same question anyway. Here the Answerer must see exactly one of three, so a deck
in the client bundle would put the other two on their machine and leave the secret resting on the
renderer's manners. Three fences keep it server-side: nothing browser-reachable imports it,
`packages/games/package.json` publishes only three entrypoints so the path does not resolve from
outside the package, and the web app's eslint config now bans `@rasmalai/games/*/deck` alongside the
existing `*/server` rule.

**The hidden information is enforced by the type system, not by discipline.** `getView` returns a
discriminated union, and `AnswererView` has **no `candidates` property** — not a nullable one, none
— so a leak fails the build rather than a test. Every secret is gated on `phase` rather than on
whether a field happens to be filled: `round.answer` is set a whole phase before the Asker may see
it, so "is it null yet" is exactly the wrong question and asking it is how this game would leak. The
view carries no boolean derived from a secret at all, which is a direct consequence of choosing a
sequential machine over a simultaneous one.

One back door is named in the client rather than only here: **`sendSignal` must never be used in
this game.** The platform relays game events raw and unvalidated without passing through `getView`,
so a well-meant "they are hovering over A" would walk around every fence above.

Reconnection needed no work. `getView` is pure and re-derived per frame, the fork is on the seat
rather than anything connection-scoped, and seats are fixed at session creation — so a reconnecting
Answerer gets no candidates for the same reason they never had any. Two tests prove it rather than
the argument being trusted.

---

## Slice 11: proof instead of inference

Slice 10 shipped four games and asserted a great deal about them without ever executing a line of
SQL. Its evidence section was honest about that, and limitation 29 said the quiet part out loud:
nothing had exercised those games through `sessionRegistry` at all. This slice closes that gap by
building the thing the repository had never had — an integration harness — and pointing it at five
games.

**The lane is opt-in, and that is the whole design.** `npm test` still runs 624 unit tests with no
database, no secrets and no network; `vitest.config.ts` excludes `**/*.integration.test.ts` to keep
it that way. `npm run test:integration` runs the other lane against the couple's real Supabase
project, single-threaded on purpose: `matches_one_active_per_couple` and the shared rate limits make
concurrent runs flaky in ways that have nothing to do with the code under test. Timeouts are 60
seconds because a match plus its cleanup crosses the Atlantic several times. A contributor with no
`.env` is not blocked, and CI does not need a database to be useful.

**`apps/server/src/testing/integrationHarness.ts`** seeds a throwaway couple — two real Supabase
auth users, two real `public.users` rows with real generated pairing codes, one real `couples` row —
hands back a live `SessionRegistry`, a real `matchRecorder`, a real pool and a captured record of
every emitted frame, and then deletes every trace of itself on `dispose()`. Only auth users the run
itself created are ever deleted; nothing issues a `delete` against `public.users`, `couples` or
`matches` by any other predicate, because these tests run against the couple's live data.

**What each suite proves that its unit tests could not.** The rulebook tests call
`rules.validateAction` against a `PlayerIndex`. These call `submitAction(sessionId, userId, ...)`
and make the platform resolve that user to a seat, run the clock, and write the result:

- **Memory** — a face-down card the reader has not earned is absent from a frame that actually
  crossed the socket, and a `memory` result lands in `matches` as **competitive** even though the
  catalogue files it under casual. That last one is a platform decision no rulebook test can see.
- **Guess My Answer** — the partner is told *that* an answer landed and not what it was, rounds are
  1-based through the real registry, and a social match is recorded with **no winner and no
  competitive counter incremented**.
- **Bomb Defusal** — the fuse **freezes across a real disconnect** and comes back intact, and role
  enforcement is driven through the real user→seat→role mapping rather than a seat index. That
  mapping is the most fragile in the codebase: roles swap every stage and the first defuser comes
  from a coin flip, so this is the one game where a seat-index test proves the least.
- **Reflex** — both runners get the identical hazard schedule from one server-side seed, and
  **game time stops while somebody is away** and resumes with what was left. The pause is verified
  by re-deriving the rulebook's own `gameTime()` from `originAt`, after forcing real elapsed
  progress, so the assertion cannot pass vacuously.
- **Basketball** — a full twenty-shot match plays to a **completed competitive record**, with an
  explicit check that no shot timed out, which is what separates a real game from a forfeit.

**Two production fixes came out of writing them**, both found because a real clock behaves
differently from a fake one. `sessionRegistry` and `matchRunner` captured `now = Date.now` eagerly
at factory-call time, which is behaviour-identical in production but meant every future test had to
remember to work around it; the lookup is now lazy. And `dispose()` now drains the match recorder
before deleting, so a forgotten drain in a test cannot race cleanup into a foreign-key violation.

**A tournament stall is not a disconnect.** `resolveClock` fired its tournament branch for *any*
expired clock while a session was active, including a player sitting there, connected, declining to
move — it tore the session down before it had even worked out who was at fault. The rule in
`docs/04` §6 exists so that one bad wifi moment cannot hand over points in a standings table. A
present player who stops moving is not that: letting a restart cover them would mean anybody losing
a board could force a replay by sitting on their turn, which is the one thing the move clock exists
to prevent. The branch now requires at least one blamed seat to be **absent**; a present staller
falls through to the ordinary forfeit, identical to an individual match. The two fault modes are
mutually exclusive by construction — `turnSeatNow()` returns `null` the instant any player is away —
so the "one away, the other present and on the move" case is unreachable rather than merely
untested.

---

## Slice 10: four games, and the first one that moves

The catalogue goes from two playable games to **six**, across all four categories and both
renderers. Nothing about the platform changed to accommodate any of them — no new table, no new
column, no new event, no edit to the session registry, the match runner or the socket layer. `0009`
is two `update` statements.

**Each of the four was chosen for a shape the contract had never been asked for.** Two games was one
data point; six is a claim with some weight behind it.

| game | category · scoring | what it exercises that nothing else did |
|---|---|---|
| Memory | casual · **competitive** | the server keeping a secret on a board both players are looking at |
| Guess My Answer | social · social | both seats acting **at once**, in secret, neither waiting on the other |
| Bomb Defusal | cooperative · cooperative | `getView` as a **fork** — two different screens, neither playable alone |
| Reflex | competitive · competitive | continuous motion, a canvas, and game time that stops |

**`pause` turned out to mean four different things**, which is the most useful thing this slice
found out about the contract. Reaction Speed discards what was in flight because a round nobody
could see must not be scored. Four in a Row and Guess My Answer do nothing, because a board and a
locked-in answer are facts. Memory **freezes and then restarts** its peek from the beginning, since
the two cards showing are the only thing the move produced and somebody whose phone dropped never
got their look at them. Bomb Defusal and Reflex freeze and resume **exactly** — a fuse with fifty
seconds left comes back with fifty seconds left. The contract already allowed all four; nothing had
needed more than two of them before.

**Memory is filed under casual and scored competitively.** Turning up more pairs than your partner
is beating them — there is a winner, a loser, a margin and a rematch worth asking for — and P-3
would have filed all of it under "counts towards nothing" purely because of which aisle the game
sits in. `games.category` and `games.scoring_kind` exist separately for exactly this, and the
contract says in as many words that a game may be shelved casual and scored competitively. `0009`
moves the column so the module and the database agree.

That divergence is also what finally put a test behind `playableSlugs()`, which has been documented
since slice 7 as the thing that "keeps the seed honest" without anything holding it to it.
`sessions/catalogue.test.ts` reads the migrations as text and checks both directions: every module
has an enabled row, every enabled row has a module, and the module's `scoringKind`, `category` and
`renderer` match the catalogue's. The third is the one that matters — a mismatch there *works*, and
announces a winner on the results screen that the statistics then decline to record.

**Bomb Defusal has no chat, and needs none.** `docs/01` section 14 rules out voice and text for V1,
which on the face of it rules out the one game in the catalogue that is entirely about telling your
partner something. The game carries the conversation instead: the defuser taps a wire to report its
colour, the expert taps a wire to point at it. Two verbs, and Keep Talking and Nobody Explodes
reduced to something two people can do on two phones in silence.

Its manual lives in `server.ts` and reaches exactly one of the two screens. Not because the rules
are secret from the couple — they will learn them, and getting faster at them is the game — but
because a defuser who can read the manual out of their own bundle defuses the bomb alone, and then
there is no cooperative game left. The built client bundles were grepped for the rule text to check
this rather than assumed.

**Reflex is the first Phaser game, and P-6's first real test.** Up to now "each game picks the
cheapest renderer that works" had only ever resolved to React, because a board is a board. This is
the first thing in the product that genuinely moves. What matters is what the canvas did *not*
change: `reflex/server.ts` is the same pure, timer-free rulebook as every other game's, and the
platform cannot tell which of its games are canvases. `renderer: 'phaser'` reaches one line of
`client.ts`.

- **Phaser is imported inside an effect**, never at module scope: this module is reachable from a
  server render, and a top-level import reaches for `window` the moment it is evaluated.
- **It is 1.2MB and it lands in its own chunk.** Checked in the built output rather than assumed:
  the chunk containing Phaser is reached only through the lazy game loader, and none of the four
  root chunks references it. Somebody reading their dashboard never downloads it.
- **The palette is read out of `theme.css` at runtime** via `getComputedStyle`, so a canvas is not
  the one screen in the product that a reskin would miss.
- **`orientation: 'landscape'`** is the first non-`any` answer in the catalogue. Five lanes with room
  to see what is coming wants width; the renderer copes either way rather than refusing to draw.

The interesting half of Reflex is the timing. Both players run the **same** hazard schedule, so
neither can draw a luckier board. Everything is measured in **game time**, which stops when somebody
drops off — a schedule is a bad thing to try to survive a disconnect by shifting forty-five absolute
deadlines. And a hazard is judged **150ms after it lands**, because a dodge made in time and
delivered late would otherwise be a death caused by wifi, which is the one thing `docs/13` section 8
says a competitive game must never do.

Movement is one lane at a time with a 150ms cooldown, and that number is the entire difficulty of
the game: without it a player could jump anywhere at any time and never be caught. The first
version of it had a real bug — the lane a player is *placed* in was recorded like a move, so the
cooldown ate everybody's very first step. A test that expected somebody one lane over and found them
where they started is what caught it.

**Two deferred items were closed alongside.** Known limitation 10 (score units) became
`GameMeta.formatScore`, which returns a string or **null** — null being a real answer, and the
reason it exists: Four in a Row scores 1–0, and a lifetime best of "1" says only that you have won
once. Reflex is the case that made it necessary at all, since its score is a duration in
milliseconds and "best 28640" on a catalogue card is worse than no card. Known limitation 9
(counter-proposals) became three lines of chips in the invitation sheet — the server, protocol and
transaction have been done since slice 6, and the reason the picker was deferred was that with one
game there was nothing to counter *with*.

**Two things were found and fixed on the way through.**

- `resultView` read `winner === null` as "not the winner", so the first non-competitive game would
  have made **both** players the loser. Nobody beat anybody: `drawn` is the only one of the three
  that is true of a game with no sides. The results banner short-circuits on `competitive` before it
  reads `outcome`, so nothing was on screen — but the field was a lie, and the tournament scoreboard
  reads the same shape.
- **The server's Docker image has not been buildable since slice 7.** `apps/server/Dockerfile` was
  written in slice 1 and copies `packages/shared` only; `packages/games` arrived six slices later
  and tsup lists it in `noExternal`, so the build would fail on a missing workspace. Fixed here
  because Phaser made it worth checking that the browser-only peers stay *out* of the server image —
  they do: the server imports `@rasmalai/games/server`, which reaches no renderer, and an optional
  peer nobody imports is one npm is happy to leave out.

**The `export *` collision predicted in `index.ts` finally happened.** Memory's board is `COLUMNS` ×
`ROWS` and so is Four in a Row's. The comment said the fix was to prefix the newer one, and it was —
every game added in this slice re-exports explicitly under its own prefix, while the two that
predate the collision keep `export *` because renaming their constants would touch working code for
no benefit. Nothing outside `packages/games` imports these constants at all.

**Known limitation 25 is resolved.** D-1 puts the minimum tournament at three games and the
catalogue had two, so the create screen could not reach a legal selection. Seven games, four
categories, and `catalogue.test.ts` asserts the floor so it cannot quietly go back under.

---

## Slice 9: an evening instead of a game

A tournament is a locked run of three to seven games played one after another for points — win 3,
draw 1, lose 0. `0008` adds `tournaments` and `tournament_games`, and one nullable
`matches.tournament_id`.

**The shape of it is one new module and one new seam.** `tournamentRepository` owns the durable
state and every piece of arithmetic; `tournamentEngine` owns the sequence — which game is open,
whose session it is, and what happens when that session ends. The session registry learned exactly
four callbacks (`TournamentHooks`) and nothing else: it does not know what a tournament is, where
one is stored, or how one is scored.

**What each ending means** is the whole of the design, and the table is the specification:

| ending | consequence |
|---|---|
| played to a result | scored; the series advances when **both** ask for the next one |
| reconnect window ran out | the game **restarts** (`docs/04` §6) — a dropped connection is not points |
| ran out twice in a row | the series **pauses** (`docs/13` §6) |
| they agreed to stop mid-match | the series **pauses** (D-5) |
| walked away from the results screen | the series **pauses** (D-5) |

Two of those needed a signal the registry did not have. `matchEnded` is latched to fire once per
session, so a completed game is never re-reported as an abandonment; `sessionClosed` is *not*
latched, because a game can finish perfectly well and then be walked away from, and those are two
different facts. The second one is the only thing that can tell a series has been left sitting
between games, and D-5 hangs on it entirely.

**No rematch inside a series (D-2).** Each game is played once, so both players readying on a
results screen means "on to the next one", not "again" — and the next one is a different game in a
different session. `maybeStartCountdown` refuses to count down there and asks the engine instead,
which closes the finished session (freeing the couple's one slot, ADR-009) and opens the next.

**Decisions queue rather than drop.** The first cut latched the engine while an async decision was
in flight and ignored anything that arrived underneath it. That is wrong in a way tests caught:
both players readying while the previous result was still being written is entirely ordinary, and
refusing it left the series stuck on a results screen with nothing able to move it. They now chain,
exactly like `matchRecorder`'s writes, and each one re-checks where the series actually is when its
turn comes.

**A restart of the process no longer strands a series.** Live sessions are memory-only, so every
`active` tournament at boot is one whose session died with the last process. `sweepStranded` pauses
them, which puts them back on the dashboard with a Resume button and their 48 hours instead of
leaving them unplayable forever.

---

## Slice 8: the numbers become real

Every dashboard figure was honestly zero until now, because nothing wrote a match down. It does
now, and the whole slice is **one new module, no migration, and no new column** — `0004` created
these tables in slice 5 and fixed the formulas in its own comments precisely so this slice would
have nothing left to invent.

**A row is written when a match starts, not when it ends.** Three things want it that way: `status`
has to distinguish the three endings the product cares about (P-8 wants an abandoned match visible
in the seven-day history), the partial unique index on `(couple_id) where status = 'active'` is what
makes ADR-009 true in the database rather than only in memory, and a match nobody was around to
finish still happened.

The cost is an `active` row that outlives the process that owned it, and it is a real one: left
alone, that index would refuse the couple **every future match** until somebody noticed. Live
sessions are memory-only and never survive a restart, so every `active` row at boot is orphaned by
definition, and `abandonOrphanedMatches` closes them on the way up.

**The registry stays synchronous.** It announces a match starting and a match ending to a
`MatchRecorder` and waits for nothing: recording is fire and forget, so the slowest thing in the
system is never on the path of the fastest, and a database blip is a log line rather than something
two people mid-game find out about. Seats become people at that boundary and nowhere else — the game
never learns who played it, and the statistics never learn there were seats.

**Every write goes through one queue.** Two orderings have to hold: a completion after its own
insert, and one match's completion before the next match's insert — or the ADR-009 index refuses
the rematch and it goes unrecorded. A per-match queue gets the first and loses the second. At a
match every few minutes, one FIFO chain costs nothing measurable and cannot get either wrong.

**The arithmetic is TypeScript, not SQL.** `matchStatistics.ts` takes the current row and the match
and returns the next row; the repository reads `for update`, calls it, and writes back inside the
transaction that completes the match. A `case when` inside an `on conflict do update` would have
been fewer lines and untestable, and `docs/09` asks for streak calculation by name — a streak is not
a property of one match, it is what the last few did to each other, so the tests replay whole
histories.

Two product decisions were taken here rather than assumed:

- **A forfeit counts as a win and nothing more.** The 1–0 a walkover is awarded is a flag, not a
  scoreline (`docs/13` section 6), so it feeds games played, wins, win percentage, streaks and that
  game's play count — and never the margin statistics or a best score. Otherwise "your closest ever
  match" could turn out to be the evening one of them shut their laptop, and "most competitive game"
  would start measuring walkouts.
- **Time played is wall clock, start to end**, including any stretch spent waiting for somebody to
  come back. A forfeited match therefore carries the 120 seconds nobody was playing. Rare, harmless,
  and the alternative is threading pause bookkeeping through the registry for a number nobody will
  audit.

**P-3 is enforced from the catalogue, not from the game module.** `games.scoring_kind` decides
whether a match was competitive, because that is the same column the dashboard filters on when it
reads the numbers back. Recording against the module's own metadata instead could write margins no
screen would ever show.

**Retention** is a daily in-process job (T-7) that also sweeps once at startup, so a backend that was
down for a week catches up the moment it returns rather than at the next midnight it happens to be
awake for. Deleting is lossless because P-5 already snapshotted everything into the aggregates —
proved by expiring a match and reading every lifetime number back afterwards, unchanged.

---

## Slice 7c: one clock, and knowing whether they are there

Three things, one area of the code.

**A session could be destroyed by the first player to reach it.** A session is created the moment an
invitation is accepted, and the two of them navigate to it separately — so there is always a window
where one is on the page and the other is still on the games list. `left()` read "my partner is not
present" as "we have both gone" and ended the session outright, which meant a refresh, a phone
waking up, or React's development-mode double mount would end a game before the second player had
loaded it. They arrived to `session_not_found` and the message **"That game is no longer running."**
Every registry test had joined both players first, so the window had no coverage at all.

**Errors were being blamed on the wrong game.** `ProtocolError` carried no session id and one socket
serves the whole app, so a late `session_not_found` — routinely produced by the `lobby.away` a page
sends on its way out — was applied to whatever screen happened to be open. After a rematch that is a
brand new, perfectly healthy game. Errors now name their session and the client ignores the ones
that are not its own. `respondToLeave`'s "they have to agree, not you" also stopped being
`not_authorized`, which the client reads as *this game is not yours* and closes the screen over.

**One clock replaces two half-rules.** Being away and being on the move are now the same 120 seconds
with the same consequence: whoever is at fault when it runs out loses, and if both are at fault
nobody won anything. Games name the seat they are waiting on through a new `turnOf` on the contract
and decide nothing about what being late costs — that is a result, and results belong to the
platform. This closes what was known limitation 17.

The both-away case is the one that changed most. It used to end the session on the spot; it now runs
the window for each of them and resolves at the **later** deadline, so whoever gets back is the last
one in the room and takes it. That is also what makes the first bug above impossible rather than
merely unlikely.

**Presence moved to where it is useful.** The header used to report your own socket status, which
told you something you could already see. It now shows your partner's face with a badge on its
corner. Pressing Play checks the same live value before sending, and the server refuses outright
with `partner_offline` if there is nobody there regardless: an invitation to somebody signed out is
five minutes of waiting for a sheet nobody will ever see, and it holds the couple's one slot the
whole time.

The couple-scoped presence frames were also renamed to `partner.online` / `partner.offline`. They
had been sharing `player.connected` / `player.disconnected` with the session's own presence events
while carrying a completely different payload, and every client listener "handled" them by reading
a `session` field that was not there and dropping the frame.

**Presence became push-only.** `GET /api/presence/partner` and its 15-second frontend backstop poll
are gone. In their place, the server pushes a `partner.snapshot` frame — the whole answer, not just
a transition — right after a socket authenticates, which happens on the first connection and again
on every reconnect. `partner.online` / `partner.offline` cover every transition in between. A
reconnect already re-runs the auth handshake, so it now also re-seeds the snapshot for free, and
there is no longer a separate resync call to make. The frontend hook became a single provider
(`PartnerPresenceProvider`), mounted once in the app layout, so every consumer reads the same live
value instead of each holding its own copy — `InviteButton`'s pre-flight check reads it directly
rather than forcing a fresh request, with the server's own `partner_offline` check as the backstop
that actually matters.

## Onboarding has two branches

Onboarding used to be one page of nine inputs that asked **both** partners when they met and where
they live, then threw one of the two answers away — `couples` keeps a single copy, so the loser's
answer sat in their row contradicting the couple, and "days together" came down to which of them
happened to send the pairing request.

It now opens by asking whether you already have your partner's code:

- **with a code** — 7 cards: the question, the code, your name, what you call them, your gender,
  your birth year, your avatar. Finishing creates the profile **and sends the pairing request in
  one transaction**, landing on the waiting screen. You are never asked the couple's questions.
- **without one** — 8 cards: the same, minus the code, plus the day you met and where you two are.
  You leave with a code to share.

One question per card; each answered card slides left as the next arrives. Off-screen cards are
`inert`, so Tab cannot wander into them. The code card checks the code as it is typed and names its
owner — "That's 🦊 Alice — is that them?" — before Next unlocks; verdicts are remembered per code so
a corrected typo does not spend a second try against the rate limit.

`0006_onboarding_branches.sql` drops `not null` from four `users` columns:

- `first_met_date`, `location_type` — null means "this person was never the author of this fact".
  `couples.first_met_date` stays **not null**; that is what guarantees a couple has exactly one
  agreed date. Accepting resolves it as `coalesce(code owner, requester)`.
- `actual_name`, `partner_label_name` — retired, not dropped. Existing rows keep what they said and
  nothing selects them any more. Each person now gives one name for themselves (`nickname`, which
  is what every screen already rendered) and one label for their partner.

One budget of 10 per 10 minutes is shared by `POST /api/onboarding`, `GET /api/pairing/codes/:code`
and `POST /api/pairing/requests`: all three spend the same secret, and a check cheaper than the
request it precedes would be exactly the grinding oracle the limit exists to stop.

---

## What exists

### Repository

npm workspaces monorepo: `apps/web` (Next.js 16), `apps/server` (Node + Express 5 + ws),
`packages/shared` (protocol), `packages/games` (one folder per game), `supabase/migrations`.

Both packages are source-only — no build step. The server bundles them with tsup; the web app
transpiles them. All relative imports are extensionless, because every consumer is a bundler and
Next's bundler will not resolve `.js` to `.ts`.

Tailwind does not look inside `node_modules`, and a workspace package is a symlink into it, so
`globals.css` declares `@source "../../../../packages/games/src"`. Without it a class the games use
and the web app happens not to is silently never generated, and the game renders *almost* right —
which is a worse failure than a build error.

### Backend

- `/healthz` exposing nothing about the environment, and SIGTERM handling with a 10s grace period.
- `createTokenVerifier` — verifies Supabase access tokens against the project's public JWKS,
  asserting **both** issuer and audience. The audience check is what stops an `anon` token from
  being accepted as a signed-in user.
- WebSocket at `/ws`: identity is proven in the first frame, anonymous sockets are closed after
  10s, multiple sockets per user are allowed, expired tokens are dropped on the next heartbeat.
- `requireUser` middleware: the user id comes from the verified token and nowhere else.
- `GET /api/me`, `POST /api/onboarding`, `GET /api/pairing`, `POST /api/pairing/requests`,
  `POST /api/pairing/requests/:id/respond`, `POST /api/pairing/requests/:id/cancel`,
  `GET /api/dashboard`, `GET /api/invitations`, `POST /api/invitations`,
  `POST /api/invitations/:id/respond`, `POST /api/invitations/:id/cancel`.
- `GET /api/dashboard` answers 200 in all three states — no profile, no partner, paired — because
  the page routes on the difference and "not paired yet" is an ordinary stage of signing up, not a
  failure. The couple's fixed a/b slots are resolved to **you** and **them** in exactly one file,
  `modules/dashboard/dashboardRepository.ts`; nothing downstream knows which slot the viewer is.
- Every SQL column that joins two tables is aliased. `pairing_requests` and `users` both have an
  `id`, and node-postgres lets a later column silently overwrite an earlier one — which handed back
  a user id as a request id and broke accept with a 404.
- In-memory fixed-window rate limiting on pairing code submission, so a code cannot be ground down.
- A notifier that lets HTTP routes push events to a person's open sockets, which is how an accept
  reaches the other partner without polling.
- Migration runner (`npm run db:migrate`): ordered `.sql` files, one transaction each, tracked in
  `public.schema_migrations`. Idempotent.

Slice 6 adds the realtime half:

- **Invitations over HTTP, events over the socket.** Persistent state changes go through a
  transaction and the notifier pushes the result; ephemeral session state travels as socket frames.
  That split follows what pairing already proved, and matches `docs/02` section 5.
- **`modules/sessions/sessionRegistry.ts`** — live sessions in memory, keyed to the *user* rather
  than the socket, so a refresh or a second tab is a non-event. It owns ready state, the
  synchronized countdown, the 120s reconnect window, and the reaction relay. Presence is read from
  the socket registry at the moment of use rather than cached, so the two cannot disagree.
- **Presence** is announced only on the transitions that matter — a person's first socket in and
  last socket out — and only ever to their partner.
- Reactions are rate limited per socket (10 per 5s) and stamped server-side with who sent them, so
  nobody can react as their partner.
- The **expiry sweeper** closes overdue invitations every 20s and tells both partners. It is the
  less important half of expiry: every read already treats a past `expires_at` as expired, because
  an in-process timer dies with the process.

Slice 7 adds the game itself, and the seam it plugs into:

- **`packages/games`** — the contract from `docs/05` and `docs/13` section 7, as code. A game gets
  metadata, a protocol, pure rules and a renderer, and is allowed to know nothing else: no user ids,
  no couples, no sockets, no Postgres. Players are seats `0` and `1`; the platform maps seats to
  people on the way in and out and is the only thing that can.
- The rules are **pure**. They own no timers and never read a clock: every moment arrives as an
  argument and every moment they want back leaves through `nextTickAt`. That is what lets a whole
  match — arming delays, tap timings, latency compensation, five rounds — be replayed exactly in a
  unit test, and it keeps the server the single authority on timing.
- Three entrypoints: `@rasmalai/games` (contract, metadata, protocol — safe anywhere),
  `/server` (rulebooks, **never** in the browser) and `/client` (renderers, dynamically imported so
  a game's code arrives with its session rather than sitting in a dashboard's bundle). An ESLint
  `no-restricted-imports` rule in `apps/web` enforces the first boundary, and the built bundle was
  checked for a server-only string to confirm it.
- **`modules/sessions/matchRunner.ts`** — the platform's whole relationship with a game: it holds
  the authoritative state, owns the single timer the rules ask for, supplies crypto randomness, and
  turns seats back into events. Adding the tenth game does not touch it.
- The runner **always re-arms its timer**, in a `finally`, with a floor of one millisecond. This
  cost a live match during manual testing and is worth writing down: `liveAt` was fractional, timers
  are whole milliseconds, so the tick arrived a fraction *before* its own deadline, found nothing to
  do, and the "don't spin" guard read that as "the game is waiting on a player now" and stopped the
  clock for good. Two players sat watching a round that would never start. The deadlines are whole
  milliseconds now as well, and there is a regression test for a tick that arrives early.
- A session now **outlives the match inside it**. Finishing puts both players on a results screen,
  unready; both readying again starts a fresh match in the same session. That is what makes a
  rematch a rematch rather than a second invitation, and it reuses the ready/countdown machinery
  slice 6 already proved.
- **Latency fairness** (`docs/13` section 8). The socket layer keeps a smoothed half-RTT per socket
  from its own ping/pong — measured, never told to the client — and a tap is scored at
  `receivedAt − min(halfRTT, 150ms) − roundStart`. A socket is pinged the moment it authenticates
  rather than waiting up to a heartbeat, because a game can start seconds after a page loads and
  compensation with no sample yet is no compensation at all.
- **Leaving is not disconnecting.** `lobby.leave` closes the session for both, and the screen asks
  first. A closed tab or dead wifi is still a disconnect and still gets the 120-second window —
  the difference is that somebody who walks away on purpose should not leave their partner watching
  a countdown for a person who is not coming back.
- A lobby both players have walked away from now ends itself. Left alone it would sit in memory
  forever, and ADR-009 would refuse the couple every future invitation until the process restarted.

Slice 7b adds the second game, and the whole point of it is what it did **not** touch:

- **Not one line of the platform changed.** No new table, no new column, no new event, no edit to
  the session registry, the match runner, the socket layer or the web app. Four in a Row is a folder
  under `packages/games`, three lines of registration, and one `update` statement. Until it shipped,
  "the platform is game-agnostic" was a claim with one data point (`docs/13` section 8).
- The two games have **almost nothing in common**, which is what makes the pairing worth something.
  Reaction Speed is timed, secret and restarts a round when somebody drops; Four in a Row is
  turn-based, fully open, and must survive a disconnect with its board untouched.
- **It asks the platform for no clock at all.** `nextTickAt` returns null, so the runner arms no
  timer — asserted directly, with `vi.getTimerCount()` reading zero while a match is live. A game
  that wants nothing from the clock costs nothing, and the timing machinery turns out to be optional
  infrastructure rather than a second set of rules every game has to be fitted to.
- **`pauseOnDisconnect: false`**, the other branch of the reconnect policy, used for the first time.
  A timed game must stop its clock or the absent player loses rounds they never saw; a turn-based
  board must do the opposite, because throwing away a position would punish bad wifi far harder than
  any stopwatch could. The platform still refuses actions while a player is missing, so nobody can
  be played around while they are gone, and one `lobby.joined` restores the whole board.
- **Turn ownership** is this game's answer to "can a client fake an outcome". A drop names a
  *column*, never a square: gravity is applied by the server, so a client that claimed a row would
  be asserting an outcome rather than sending an intent (`docs/04` section 1).
- **One board is one match**, and a rematch is a fresh board with a fresh coin-flip for who starts.
  Best of three with alternating starts would buy away Connect Four's first-move advantage, at the
  cost of tripling how long two people sit still. Chance was chosen over length; there is nothing in
  this game to earn the advantage with, so chance is the fairest answer available.
- **No turn clock.** The game is always waiting on a person, and a countdown that played a random
  column for you is a harsh way to lose a board between two people who like each other. A stalled
  game is escapable — Leave already ends it for both — and a disconnect still gets its 120 seconds.
- A draw scores **0–0 rather than 1–1**. The margin between the scores is what feeds "most
  competitive game", and a draw is as close as a match can get.

Slice 8 adds the half that outlives the evening:

- **`modules/statistics/matchStatistics.ts`** — the formulas, as pure functions. Total games, the
  competitive-only counters, streaks and their high-water marks, the closest match ever played, the
  per-game margin sum and sample count, and the per-game best scores.
- **`modules/statistics/statisticsRepository.ts`** — the SQL. Opening a match, completing it and
  moving every aggregate it touches in one transaction, abandoning it, closing rows orphaned by a
  restart, and deleting expired ones.
- **`modules/statistics/matchRecorder.ts`** — the port the session registry sees. Two announcements,
  one FIFO queue, and a `drain()` the shutdown path awaits before closing the pool, so a match
  ending in the last second is not lost.
- **`modules/retention/retentionJob.ts`** — ADR-008's daily sweep, plus one pass at startup.
- The session registry gained a `matchKey` and four calls. Everything else about it is unchanged:
  the clocks, the presence rules and the leave protocol were not touched.

Slice 10 adds five games and a tournament-request flow to the backend:

- **`packages/games/src/{memory,guess-my-answer,bomb-defusal,reflex,basketball}`** — a folder each,
  registered in three lines apiece. `sessionRegistry`, `matchRunner`, `socketRegistry` and every
  route are untouched by the games themselves.
- **`modules/tournaments/tournamentRequestSweeper.ts`** plus the request branch in
  `http/routes/tournaments.ts` — a tournament is now proposed to the partner and accepted, the same
  shape as an individual invitation, backed by migrations `0010_tournament_requests.sql` and
  `0011_tournament_request_status.sql`. This landed in `acd3c54` alongside Basketball and went
  unrecorded until slice 11.
- **`GameMeta.formatScore`** — the only change to the contract, and an optional one. It returns a
  string or null, and `formatGameScore(slug, score)` in the barrel is what the platform calls when
  it is holding an integer with no units.
- **`modules/sessions/catalogue.test.ts`** — the module registry and the migrations, held against
  each other in both directions. It reads the SQL as text, which is the only copy of the catalogue
  available without a database.
- One platform correction: `resultView` no longer calls both players the loser of a game that had
  no winner to name.

Slice 11 adds no features. It adds a test lane and two corrections:

- **`apps/server/src/testing/integrationHarness.ts`** and `vitest.integration.config.ts` — the
  opt-in real-Postgres lane, plus five `*.integration.test.ts` suites under
  `modules/sessions/games/`. `npm test` excludes them so it still runs with no database.
- **A lazy clock.** `sessionRegistry` and `matchRunner` now resolve `Date.now` at call time rather
  than capturing it when the factory runs. Behaviour-identical in production; it removes a footgun
  that every test with fake timers would otherwise have had to work around.
- **`resolveClock` distinguishes a stall from a disconnect.** In a tournament, only an *absent*
  blamed seat restarts the game; a present player who stops moving forfeits, exactly as in an
  individual match.

### Database

`public.users` (including a required `gender`), `public.couples` and `public.pairing_requests`. Everything is keyed to
`auth.users.id` with `on delete cascade`, and RLS is enabled with **zero policies** — the deny-all
backstop from `docs/13` section 2. The Google subject and email are deliberately *not* duplicated
here; `auth.users` already holds them.

"At most one couple per person" is enforced by `users.couple_id`: a single column cannot hold two
values, which unique indexes on the couples table alone could not guarantee. "One pending request
per pair" is a partial unique index over the normalised pair, so it holds in either direction.

Slice 5 adds `public.games` (the 17-game V1 catalogue, seeded, all `enabled = false` until a module
exists), `public.matches`, `public.lifetime_statistics` and `public.couple_game_stats`. Only reads
exist so far; slice 8 writes them.

Two refinements to `docs/13` section 9, both deliberate:

- **Favourite game and most competitive game are derived, not stored.** `couple_game_stats` holds
  per-couple, per-game counters, and the two "favourites" are computed from the rows the catalogue
  already fetches. A denormalised favourite column has to be recomputed on every match and can
  drift; a counter can only be counted. `margin_total` and `margin_samples` keep the average margin
  exact after the matches themselves have expired.
- **Best score is per game, never global.** A basketball 34 and a five-round win are not the same
  kind of number, so one lifetime "best score" would compare unrelated scales. It lives on
  `couple_game_stats` and is shown on each game's own catalogue card.

`matches.expires_at` defaults at insert rather than being a generated column: `timestamptz +
interval` is only STABLE, so Postgres rejects it in a generated expression. A partial unique index
on `(couple_id) where status = 'active'` is what actually enforces ADR-009.

Slice 6 adds `public.invitations`, with the partial unique index
`(couple_id) where status = 'pending'` that makes ADR-010 unwinnable: invalidating the old row and
inserting the new one share a transaction, so two devices sending different invitations at the same
moment cannot both end up pending. `replaces_invitation_id` links a counter-proposal back to the
invitation it answers, so the exchange reads as a conversation rather than two unrelated rows.

**Slice 8 added no migration at all** — no table, no column, no index. `0004` built `matches`,
`lifetime_statistics` and `couple_game_stats` in slice 5 and wrote the formulas into its own
comments; the write path was the only thing missing, and it turned out to need nothing new to write
into. The one thing worth knowing is that `matches_finished_has_ended_at` means every row that stops
being `active` must be given an `ended_at` in the same statement, including the ones the orphan
sweep closes.

`0009_slice_10_games.sql` is two `update` statements: one flipping `enabled` for the four new games,
one moving `memory.scoring_kind` from `casual` to `competitive`. Four games at once, and still no
table, no column and no index — the fourth slice in a row where adding games needed nothing from the
schema.

The second statement is the interesting one. `0004` seeded every game with `scoring_kind = category`,
which was right with no modules written: nothing had a scoreline yet to be wrong about. Memory has
one, and the two columns exist separately for exactly this — `category` is where the catalogue
shelves a game, `scoring_kind` is what a result of it counts towards. It has to move in the database
as well as in `meta.ts` because the two are read by different halves of the product: the session
registry reads the module to decide what the results screen says, the statistics read the column to
decide what gets recorded. `catalogue.test.ts` is what stops them drifting again.

`0007_four_in_a_row.sql` is a single `update` flipping `games.enabled` for `four-in-a-row`. That is
the entire database footprint of a second game: the catalogue row has existed since `0004`, and
`enabled` means "somebody wrote this game", not "this couple has earned it" — everything is unlocked
in V1. Two games, no new table, no new column, no new index.

### Web

Google sign-in via `@supabase/ssr` with httpOnly cookies, `proxy.ts` for optimistic redirects and
cookie refresh, `getUser()` in pages for the authoritative check, onboarding form, a pairing screen
that updates itself when a request arrives or is answered, and two signed-in sections:

- **`/dashboard`** — couple header with days together, this-week / head-to-head / all-together stat
  panels, and a teaser card into the games.
- **`/games`** — the catalogue grouped by category, a Play button on every game that has a module,
  and a disabled tournament entry point waiting for slice 9.
- **`/play/:sessionId`** — the lobby, ready states, the synchronized countdown, the game, the
  results screen with a rematch, the reaction bar and the reconnect banner.

`src/games/GameMount.tsx` is the only place the web app knows a game exists: it resolves a renderer
by slug and hands it the view the server sent. Adding a game is a folder under `packages/games`, not
an edit here. Every game event reuses the session-state envelope, so a round starting is a change to
the session view like any other — one code path, one state, and no chance of a game update and a
lobby update arriving out of order and disagreeing.

Reaction Speed itself is one enormous target: `TAP!` on berry, `Wait…` on butter, Space or Enter for
a keyboard. The tap is taken on **pointer down** rather than click, because a click does not fire
until you lift your finger and charging someone the time they held the screen would make the game
measure the wrong thing. Your own reaction appears the instant you tap; your partner's is withheld
until the round ends, so nobody plays against their partner's tap instead of the signal. When it is
over the target is replaced by the round-by-round, because "you lost 2–3" is a fact and "you lost
round four by eleven milliseconds" is an argument.

Four in a Row needed **no web changes whatsoever** — not even a glyph, because `gameGlyphs.ts`
already carried one for every seeded game. `GameMount` resolves the renderer by slug, the catalogue
renders whatever the database says is enabled, and the board arrived on screen through both without
either being edited.

The board itself is seven column-shaped buttons rather than forty-two square ones: a thumb anywhere
above a column drops there, which on a phone is the difference between a game and a game of
precision. Tab and Enter work with no help because they are ordinary buttons, and arrow keys walk
along the board the way anyone who has played this expects. Colour is never the only signal — the
two players are a light disc and a dark one, a lightness difference rather than a hue one, so it
survives colour blindness; the legend names both people against their colour; and every column says
its own contents in words for a screen reader. Hovering or focusing a column shows a ghost disc in
the square it would land in, derived from the authoritative board rather than from a second opinion
about the rules.

They share `app/(app)/layout.tsx`: a route group holding the header, the hamburger drawer, the
socket and the invitation centre. The socket lives in the layout rather than on a page so it
survives navigating between sections instead of reconnecting each time, which is what P-7 means by
keeping it open app-wide — and is what lets an invitation arrive wherever the person is standing.

`RealtimeProvider` replaced the old per-component hook. Two components calling that hook opened two
sockets and the server counted them as two devices; one provider means one socket, and it can send
as well as listen. **Frames sent while offline are dropped rather than queued** — replaying a
"ready" from thirty seconds ago into a game that has moved on is worse than losing it, so every
consumer resyncs on reconnect instead.

An arriving invitation takes the whole screen for ten seconds, then steps aside into a sheet that
stays until it is answered: unmissable without holding anyone hostage. An invitation that was
already pending when the page loaded is not an *arrival*, so it goes straight to the sheet.

Statistics render as two separate blocks because P-3 says so — a cooperative win must never look
like it beat anybody. A couple with no history gets a single friendly empty card instead of a wall
of zeroes, which is technically correct and reads as broken.

The catalogue was moved off the dashboard because seventeen game cards buried the part the
dashboard exists to show. Sign out moved into the drawer, which is where account actions belong
once a nav exists, and is why `/games` needs no footer of its own.

`packages/shared` now carries the dashboard DTO, which is what `docs/13` section 1 always intended
for this package. It is the first payload big enough to earn it: hand-copying thirty fields into
the web app would drift the first time a stat changed shape, with the compiler silent. The older
profile and pairing types are still duplicated in `apps/web/src/lib/api.ts` and were left alone.

Routing between them is by state, not by navigation: no profile sends you to `/onboarding`, no
couple sends you to `/pairing`, and a couple sends you to `/dashboard`. `/games` guards itself the
same way — it carries the couple's own record against each game, so it is couple-scoped data and
not reachable a step earlier than the dashboard is.

Slice 10 changed **three lines of the web app** for four games — the catalogue card now asks the
game module how to spell a best score, and that is all. `GameMount` resolved four new renderers by
slug without being edited, and `gameGlyphs.ts` already carried a glyph for every seeded game.

The two things it did add are both deferred items rather than games:

- **The counter-proposal picker.** "Something else instead" opens a row of chips in the invitation
  sheet and in the takeover; picking one declines and re-invites in a single call. Its open state is
  keyed to the invitation's id rather than a boolean, so a picker cannot outlive the invitation it
  is countering.
- **Phaser**, as an optional peer of `packages/games` and a real dependency of `apps/web` — the same
  arrangement `react` already had there, and the reason the server image does not install it.

The entire visual identity is `apps/web/src/design-system/theme.css`. Swap that file to reskin.

One correction to that file, found while measuring the game's own transition: the motion tokens were
named `--duration-*`, and Tailwind resolves `duration-quick` against **`--transition-duration-*`**.
Every animation in the app had been silently falling back to the 150ms default while the theme file
looked like it was in charge. Renamed; `duration-quick` and `duration-soft` now measure 120ms and
240ms in the browser.

---

## Verified, with evidence

Not "it compiles" — these were actually run.

> **On reproducibility.** The real-Postgres runs described below for slices 5–9 were driven by
> scripts that were never committed — 226 files had existed in this repository before slice 11 and
> none of them was an integration harness. Those results were true when they were run and cannot be
> re-run. Slice 11 adds `apps/server/src/testing/integrationHarness.ts` and the
> `*.integration.test.ts` lane, so everything claimed from here on can be checked by anyone with
> `npm run test:integration`.

- **25 integration checks in 6 files against real Postgres** (`npm run test:integration`, 45.7s),
  each one seeding two throwaway Supabase auth users, pairing them into a real couple, playing
  through the real `SessionRegistry` and the real `matchRecorder`, and deleting every trace on the
  way out:
  - the harness itself proves what it claims — two real users in one couple, a clean slate with a
    lifetime row at zero, and **no residue after `dispose()`**, checked on a fresh connection
    opened after the pool was closed;
  - **Memory** withholds an unearned face-down card from a frame that actually crossed the socket,
    reveals a face only to the seat that turned it and only while it is up, and is recorded as
    **competitive** despite being catalogued as casual;
  - **Guess My Answer** names nobody on the move while both are deciding, tells the partner an
    answer landed **without telling them what it was**, and records a social match with no winner
    and no competitive counter;
  - **Bomb Defusal** freezes the fuse across a real disconnect and hands it back intact, enforces
    the expert/defuser split through the real user→seat→role resolution, and records a cooperative
    ending as played and nothing more;
  - **Reflex** gives both runners the identical hazard schedule, **stops game time while somebody is
    away** and resumes with what was left, refuses a move once a partner is away, and records the
    duration score against the right game;
  - **Basketball** refuses an out-of-range angle and an out-of-turn shot, then plays all twenty
    shots to a completed competitive match with **zero timeouts** — which is what rules out a
    forfeit masquerading as a game.
- **The tournament stalling bug was reproduced before it was fixed.** Against the old code the new
  test did not merely record the wrong outcome; it threw `SessionError: That session has ended`,
  because `resolveClock` called `endSession` and forgot the session before working out who was at
  fault. Both halves are now covered: a present staller forfeits (`played: true`, `byForfeit`), and
  a genuine drop still restarts (`played: false`, session torn down).
- **All twelve migrations confirmed applied** by querying `public.schema_migrations` on the live
  project, with seven games `enabled` in Postgres and the other ten catalogue rows deliberately
  `false`.
- **Slice 12: 42 unit checks and 5 integration checks for Would You Rather**, the two security ones
  proven non-vacuous by breaking the code and watching them fail: removing the seat fork in
  `getView` fails four tests including both, and ungating `answer` on the phase fails exactly the
  one that should. Through the real registry against real Postgres: the two seats receive
  structurally different frames, the two unchosen dilemmas never appear in the Answerer's, the
  Asker's carries no answer until their prediction lands, and a match filed `social` records a real
  `winner_user_id` with a 3–0 scoreline and increments `competitive_games` — which is the half
  `catalogue.test.ts` cannot reach, because it compares two strings and this compares behaviour.
- **Slice 13: 41 unit checks and 4 integration checks for Word Game.** Through the real registry
  against real Postgres: the dictionary is enforced **on the server** across a real submission — the
  browser has no dictionary at all, so the decision can only have been the server's — whose turn it
  is survives the registry's user-id-to-seat resolution, and a match the catalogue files `casual`
  records a real `winner_user_id` and increments `competitive_games`.
- Typecheck, lint, **738 tests** and both production builds green (`npm run verify`).
- **Coverage is now measured rather than guessed** (`npm run test:coverage`): 62.6% of lines and
  **91.9% of branches** in the unit lane. The line figure is held down almost entirely by things
  that are deliberately not unit-tested, and the honest reading is the branch number. What is
  genuinely uncovered, across both lanes:
  - the seven `client.tsx` game scenes and `packages/games/src/client.ts` — Phaser and React, with
    no jsdom environment configured. Rendering them is a browser job and belongs with the
    two-account sitting (limitations 29–30);
  - `dashboardRepository`, `pairingRepository`, `invitationsRepository`, `usersRepository` and
    `tournamentRepository` — all SQL, all at 0–11%. `statisticsRepository` is the one exception at
    **85%**, because the slice-11 game suites drive it. The harness exists now, so these five are
    the obvious next slice of integration work and the only remaining place where "verified" still
    rests on runs that were never committed;
  - `index.ts` (the composition root) and `db/pool.ts` — wiring and configuration, where a test
    would assert the wiring back to itself.
- **Four previously untested modules now have tests** (30 new checks). `expirySweeper` and
  `tournamentRequestSweeper` both carried a `runOnce()` documented as existing "so tests do not have
  to wait for a timer", and neither had ever been called by one. The test that matters on both is
  that a rejected sweep is **caught** rather than becoming an unhandled rejection: the sweep runs on
  a bare `setInterval` with nobody awaiting it, so without the `.catch` Node kills the process — a
  backend that dies because Postgres hiccuped would take a live game with it. That test was checked
  against a deliberately broken copy to confirm it fails when the `.catch` is removed.

Slice 10's evidence is thinner than earlier slices' and worth being plain about: there was no
database and no browser available, so what follows is unit coverage, the compiler, and the built
output — not two people playing. Limitations 28–32 say what that leaves.

- **105 new rulebook checks** across the four games, all against the real rules with no timers and
  no sockets:
  - Memory's layout is **never** in a frame the reader has not earned — checked on a board with a
    card turned over, a pair already claimed and a mismatch showing at once, from both seats, and
    checked that the one moment the whole deck is legitimately public is the moment every card has
    been claimed;
  - a matched pair buys another go, a mismatch passes the turn only when the cards actually turn
    back, and a third card cannot be turned over during somebody else's peek;
  - Memory's pause **keeps the two cards showing** and gives the whole peek back on resume, which is
    the opposite of what every other game's pause does and the reason it is written down;
  - Guess My Answer tells your partner **that** you have answered and nothing about what;
    `turnOf` names nobody while both are still deciding and the straggler once one is in; the roles
    alternate so each of them answers three and guesses three; and the last reveal ends the match
    rather than asking them to tap past it;
  - Bomb Defusal's expert sees **six wires and not one colour**, the defuser sees all six and
    **no manual**, neither can play the other's half, and the whole thing swaps when the roles do;
  - every branch of the manual is checked against hand-built wires, and every one of 1,024 boards is
    checked to produce a wire that is actually on the bomb;
  - Reflex judges a hazard from where the player **was when it landed**, counts a dodge whose frame
    arrived late but whose timing beat it, and refuses to let a late frame resurrect somebody
    already judged;
  - Reflex's clock stops on a disconnect and resumes with exactly what was left — three seconds
    remaining comes back as three seconds, not five and not overdue;
  - both Reflex runners get the identical schedule, every wave leaves at least one lane open across
    five different seeds, and the run tightens monotonically to its floor.
- **The catalogue and the module registry agree**, in both directions, checked against the migration
  SQL: every module has a seeded and enabled row, every enabled row has a module, and each game's
  `scoringKind`, `category` and `renderer` match the catalogue's. The guard was mutation-checked —
  removing `0009`'s Memory line makes it fail with `memory scoring_kind: expected 'casual' to be
  'competitive'`, which is the exact silent bug it exists for.
- **No rulebook reaches the browser.** The production client bundles were grepped for Bomb Defusal's
  manual text (`cut the SECOND wire`), Four in a Row's turn refusal, and three server-only function
  names. None appears in any chunk. The manual is the one that matters: a defuser who can read it
  defuses the bomb alone.
- **Phaser is 1.2MB and it is lazy.** In the built output it sits in a single chunk reached only
  through the game loader; none of the four root chunks references it, so a dashboard visitor never
  downloads it.
- Typecheck, lint, **557 tests** and both production builds green. The web build needs the
  `NEXT_PUBLIC_SUPABASE_*` values, which were supplied as throwaway strings for the check rather
  than written to a `.env`.

- **78 statistics checks against real Postgres**, with two throwaway Supabase accounts created,
  paired and deleted by the run itself, playing real Four in a Row matches through the real session
  registry, the real recorder and the real repository:
  - the row appears the moment the match starts, `active`, for the right game, in individual mode,
    expiring exactly seven days after it started (ADR-008) — and **a second active match for the
    same couple is refused by the database** (ADR-009);
  - nothing is counted while it is still being played;
  - finishing **completes that same row rather than writing a second one**, with the winner named
    and the scoreline landing in the correct a/b slots;
  - the winner's streak, longest streak, the couple's totals, the per-game plays, the margin sample
    and both best scores all move exactly once;
  - a **rematch is a match of its own**, inserted only after the first one stopped being active,
    and the streak extends or resets according to who won it;
  - a match the two of them agreed to stop is written as `abandoned` with an `ended_at` and no
    winner, and **counts towards no total, no win, no time played and no play** (P-8);
  - a **forfeit** is counted as a win and a play and feeds **no margin sample and no best score**,
    leaving the closest match a real one;
  - a **draw** counts as a competitive game, ends both streaks, keeps both high-water marks, and is
    the closest a match can get;
  - a **cooperative match** is played and timed and counted by nothing else — no competitive game,
    no draw, no margin, no best score (P-3, read from `games.scoring_kind`);
  - an abandonment arriving after a match has already completed **cannot un-complete it**;
  - the dashboard reads every figure back and **mirrors correctly between the two partners**, names
    the closest match, and shows the plays on the catalogue card;
  - **retention deletes an eight-day-old match and nothing else**, and every lifetime and per-game
    number survives it untouched (P-5);
  - a match orphaned by a restart is closed on the way up, nothing is left claiming to be active,
    every closed row has its `ended_at`, and **the couple can start playing again immediately**;
  - deleting the accounts cascades the matches away.
- The server boots with the retention job and the orphan sweep wired in, answers `/healthz`, and
  exits cleanly on SIGTERM with the recorder drained before the pool closes.
- **Two real sockets against a real session registry** (`ws/server.test.ts`): the first player
  joins, goes away and rejoins before the second arrives — no error, no ending, and the partner
  still finds a game when they get there. This is the reported bug, end to end, across both layers
  that had to be wrong together for it to happen. An error for a session that has ended comes back
  carrying that session's id.
- The move clock, against real Four in a Row rules: two minutes per move, restarted on every move,
  not running while anybody is away, and never armed at all for Reaction Speed. A connected player
  who simply stops moving loses the match.
- Both players away: the session is held, resolves at the later of the two deadlines rather than the
  first, goes to whoever comes back, and goes to nobody when neither does.
- A session neither of them ever opens cleans itself up rather than holding the couple's slot for
  the life of the process.
- A socket is handed a `partner.snapshot` right after authenticating, again on reauthenticate the
  same way a reconnect would see it, and derives the couple from the token's membership so there is
  no way to ask about anybody else.
- `POST /api/invitations` refuses with `partner_offline` and writes nothing when the partner has no
  socket open.

- Docker image builds, runs as non-root (`uid=1000`), reports `healthy`, logs JSON in production,
  and exits 0 on SIGTERM in 0.2s.
- Socket rejects: silent connections (4408), garbage tokens, forged tokens, and actions sent
  before authenticating (4401). A forged-but-well-formed token produced `JWKSNoMatchingKey`,
  which is only reachable *after* the real key set was fetched — proving the JWKS wiring is live.
- Socket **accepts** a genuinely Supabase-signed token and derives the right user id.
- `/dashboard` returns 307 to `/` when signed out.
- `NEXT_PUBLIC_*` values from the single root `.env` are inlined into the client bundle.
- Full onboarding path against the real database: null profile → validation errors with field
  names → 201 with pairing code → read back → 409 on repeat → row confirmed in Postgres →
  cascade-deleted with the auth user.
- **Both onboarding branches, end to end against the real backend and real Postgres**, with two
  throwaway Supabase users: A signs up with no code and authors the couple's answers; the code
  check resolves to A and reports that B need not be asked; B signs up holding the code, gets a
  profile and a pairing request from one call, and has `first_met_date` and `location_type` **null**
  in their own row; A accepts; `couples.first_met_date` is A's date, the only one anybody gave, and
  B's own view of the couple shows it too.
- **Both branches walked in a browser**, one card at a time: the cards slide, the dot counter
  changes from 7 to 8 with the branch, Enter advances and focus follows to the next card, a choice
  tap both answers and advances, and the final card's button reads "All done ❤️" while earlier ones
  read "Next →". `1qj ct7-fy` was accepted as `1QJCT7FY` and confirmed as "That's 🦊 Alice — is that
  them?" before Next unlocked. Finishing with a code landed on "Waiting for Alice to accept…";
  finishing without one landed on the code-sharing screen. After accepting, the dashboard read
  "2,612 days together" — computed from A's date, which is the whole point of the change.
- **`inert` measured in the page, not assumed**: on an 8-card wizard, 7 panels carried `inert` and
  the only focusable controls in the document were the active card's input plus Back and Next.
- Full pairing path with three real users: own code refused, unknown code refused, request
  delivered over the partner's socket, duplicate and reverse-direction requests refused, neither
  the requester nor a stranger able to answer, **two simultaneous accepts resolving to exactly one
  couple (200 and 409)**, both sides agreeing on the partner and the date, and pairing proving
  permanent afterwards.
- Full dashboard path against the real database, with two real accounts pairing through the real
  API — 26 checks, all passing:
  - a fresh couple reads as real zeroes, not nulls or NaN, with the full 17-game catalogue and
    nothing playable;
  - **the 7-day window excludes a 9-day-old match**, and an `abandoned` match is counted by
    nothing (P-8);
  - a cooperative match counts as played and never as a draw (P-3);
  - **every figure mirrors correctly between the two partners** — wins, streaks, tournament wins
    and per-game best scores all swap when the other one looks, which is the a/b slot mapping
    proving itself;
  - win percentages leave room for draws (36% / 7% of 14 competitive games);
  - favourite game is the most played of any category; most competitive is the closest average
    margin among competitive games only;
  - a second `active` match for the same couple is refused by the database (ADR-009), and
    `expires_at` lands exactly 7 days out (ADR-008);
  - an unpaired outsider sees no couple and no statistics;
  - deleting the accounts cascades the matches away.
- The dashboard page itself rendered server-side for a real signed-in couple in all three states —
  empty, with history, and from the partner's side — and was inspected in a 430px-wide browser:
  names coloured by gender, catalogue grouped and greyed as coming-soon, socket reporting
  `connected`.
- **48 realtime checks against real sockets and real Postgres**, with two paired accounts:
  - an invitation reaches the partner's socket with no polling, pointing the right way for each of
    them, carrying a five-minute deadline;
  - **a second invitation invalidates the first** — one pending row survives, the displaced one is
    recorded as `invalidated`, and both partners are told before the new one is announced;
  - the sender cannot answer their own invitation, and an outsider cannot answer or even see it;
  - an expired invitation is refused as `410 Gone`, and **no read ever reports it as live**;
  - accepting opens one session both are pointed at, each seeing themselves as `you`;
  - **an outsider who knows the session id is refused** — knowing an id grants nothing;
  - one ready is not enough; both ready produce **the identical server deadline on both sides**,
    and the session goes active when it runs out;
  - reactions relay with a server-stamped sender, are rate limited, are refused from outsiders,
    and are never persisted;
  - a disconnect mid-game opens a 120-second window; coming back inside it resumes and clears the
    window; **a second device is not a disconnect, and closing one of two sockets is not either**;
  - no new invitation while a game is running (ADR-009);
  - a decline carrying a counter-proposal creates the reply invitation in the same transaction,
    reuses the single active slot, and records what it answers;
  - the sweeper closes an overdue invitation on its own, tells both partners, and frees the couple
    to invite again.
- The whole flow driven in a 430px browser with one partner real and the other on a scripted
  socket: the ten-second takeover, the sheet it collapses into, the lobby, both-ready, the live
  session, a partner's reaction floating on their side of the screen, and the reconnect banner
  counting down from 120.
- **49 realtime checks for the game itself**, against real sockets and real Postgres, with two
  paired accounts and an unpaired third:
  - the arming wait landed inside 1.5–4.0s, and **both players were given the identical start
    moment**;
  - your own reaction appears the moment you tap, and **your partner is told nothing about it**
    until the round ends, when both times are revealed and the two of them agree on both numbers;
  - the quicker tap won; the compensation was applied from the server's own measurement;
  - tapping before the signal ended the round on the spot and lost it, without the other player
    getting to tap into a decided result;
  - a tap carrying a round that has gone is refused, and **somebody who knows the session id can
    neither play in it nor end it**;
  - a disconnect mid-match paused the clock — six seconds passed, enough for a whole round, and
    **nothing was scored**; coming back re-armed a fresh round, and one `lobby.joined` restored the
    entire game for the returning player;
  - five rounds played out, `game.finished` and `match.result` both fired, and **the result mirrors
    between the two of them** — won/lost and the scores swap when the other one looks;
  - the finished game stays on screen and both players are unready; one wanting a rematch is not
    enough, both is, and the new match starts clean in the same session with the old result cleared;
  - leaving ends it for both, **says who did it**, and frees the couple to invite again immediately;
  - **no `matches` row was written** — that is slice 8, and the boundary is asserted rather than
    assumed.
- **41 realtime checks for Four in a Row**, against real sockets, real Postgres and two throwaway
  Supabase accounts created, paired and deleted by the run itself:
  - the catalogue offers exactly two playable games, and nothing else pretends to be;
  - an invitation to the new game reaches the partner over the socket, accepting opens one session,
    and the board arrives **with** the `lobby.started` frame rather than after it;
  - exactly one of them has the first move, and both are told the same story about who it was;
  - **a move out of turn is refused and nothing lands on the board**; so is a column that is not on
    the board;
  - gravity is the server's — the disc landed on the floor, the next one stacked on it, and the
    partner saw the same disc as theirs;
  - **a disconnect mid-board changed nothing**: the window opened, the two discs stayed exactly
    where they were, the absent player could not be played around, and one frame restored the whole
    board for the player who came back;
  - four in a row ended it, the winning line was named and both of them got the same one,
    `game.finished` and `match.result` both fired, and **the result mirrors** — won/lost and 1–0/0–1
    swap when the other one looks;
  - the finished board stayed on screen, both players were unready, one rematch was not enough and
    two was, and the new board came up clean with the old result cleared;
  - leaving ended it for both and said who did it, freeing the couple to invite again immediately;
  - **no `matches` row was written** — the slice 8 boundary, asserted rather than assumed, for the
    second game as well as the first.
- The board **measured in a browser**, not eyeballed: seven column targets of 55×323px on a phone
  viewport, 47px discs, `touch-action: none` and `user-select: none`, no horizontal scroll, and the
  winning line lit up by a ring rather than a shade. A tap emitted exactly one intent —
  `{"type":"drop","column":4}`, a column and nothing else — while the same tap on a decided board
  emitted nothing at all, because every column on it is disabled.
- A full five-round match played in a browser against a live partner on a real socket: the lobby,
  the 3-2-1, the signal, real pointer taps registering as reactions in the 200–1700ms range, the
  round-by-round recap, the results card, a rematch starting a clean match, and the leave
  confirmation ending it for both. The tap surface was measured in the page rather than eyeballed:
  berry at full opacity, a 224px target, `touch-action: none` and `user-select: none`.

---

## Known limitations, accepted for now

1. **Live game sessions do not survive a backend restart.** Invitations and matches persist;
   in-flight match state is memory-only. A restart mid-game returns both players to the dashboard.
   Persisting live state is the complexity `docs/02` tells us not to add yet.
2. **`supabase/prod-ca.crt` is trust-on-first-use.** It was extracted from the live TLS chain
   because Supabase's published CA URL now 404s. Replace it with the copy from the project's
   Connect panel; the SHA-256 fingerprint must be
   `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
   Certificate verification is fully on — `rejectUnauthorized: false` was deliberately not used.
3. **The Email auth provider is still enabled** on the Supabase project, leaving an
   email/password signup path open on a product that is meant to be Google-only and invisible.
   Note that the end-to-end scripts rely on it to mint real tokens.
4. **Gender offers two options only.** Names are coloured by it, so a third option is a product
   decision about what colour it gets, not just a schema change. `GENDERS` and the theme's
   `--color-name-*` tokens are the two places to touch.
5. **`apps/web/AGENTS.md` and `apps/web/CLAUDE.md` are generated by `next dev`**, not hand-written.
   Committing them keeps the working tree clean. `apps/web/next-env.d.ts` is generated too, and its
   contents flip between `.next/types` and `.next/dev/types` depending on whether `build` or `dev`
   ran last — a diff on that file alone is noise.
6. **Resolved in slice 8: the statistics tables are written.** Every dashboard number now comes from
   a real match. What replaces this limitation is narrower: **a failed write is a lost number, not a
   lost match.** Recording is fire and forget, so a database blip while a match is ending leaves the
   couple's totals one behind with only a log line to say so. Deliberate — the alternative is making
   two people mid-game wait on Postgres — and the row is still there to notice, because the match
   itself was inserted when it started.
7. **Resolved in slice 10 as far as it goes: six of the seventeen games exist**, across all four
   categories and both renderers, and the platform did not move for any of the four added. What
   replaces this limitation is narrower: **eleven games remain**, and the eleventh will be the first
   to be added to a contract that has now been asked for every shape it was designed for — server
   secrets, simultaneous secret choices, asymmetric views, continuous motion, and all four meanings
   of `pause`. Nothing left on the list obviously needs a fifth.
8. **The reconnect window expiring was verified with fake timers, not in a live browser.** The unit
   tests cover the transition — window expires, both told, session abandoned and forgotten, couple
   free to start again — and the end-to-end run covers the pause and the recovery inside the window,
   but waiting out a real 120 seconds was not done by hand.
9. **Resolved in slice 10: counter-proposals have a UI.** "Something else instead" opens a row of
   chips in the invitation sheet and in the ten-second takeover, one per playable game, and picking
   one declines and re-invites in the transaction the server has had since slice 6. What replaces
   this limitation is small: the chips come from `GAME_META` rather than from the catalogue the
   server actually checks, because this component sits in the layout and should not start a request
   to draw three buttons. The two agree by construction and `catalogue.test.ts` holds them to it; a
   drift would show as a chip that comes back with a 409 rather than a game.
10. **Resolved in slice 10: score units are the game's to declare.** `GameMeta.formatScore` returns
   a string, or **null** for a score that means nothing on its own. Reflex is why it exists — its
   score is a duration in milliseconds — and Four in a Row is why it can return null. What replaces
   this limitation: only the catalogue card asks. `matches.score_a` and the seven-day history still
   render bare integers, which is correct today because every competitive game so far counts
   something, and will stop being correct the first time a *second* duration-scored game appears in
   a list beside a count.
11. **Resolved in slice 8: a finished match is written down**, together with every aggregate it
   feeds. The earlier end-to-end runs asserted the row count was zero, so this landing broke those
   two assertions loudly rather than letting the boundary drift, which is what they were for.
12. **Latency compensation needs a round trip before it means anything.** A socket that has not
   answered a ping yet is compensated by zero, which is fair but not generous. In practice the
   socket authenticates on page load and is probed immediately, so a game starting seconds later has
   a real sample; a game somehow starting in the first few hundred milliseconds would not.
13. **A first tap tells the tapper only, and that frame is the one thing not idempotent on
   reconnect.** Everything else is restored by asking for the session again. Losing that single
   frame costs a confirmation, not a tap: the server has already recorded it, and the round result
   shows it.
14. **Checking a code reveals its owner's nickname, avatar and gender without telling them.**
   Before, you only learned who a code belonged to *after* sending a request, which they see.
   Deliberate: confirming the right person before committing is most of what the card is for, and
   an 8-character code from a 32-character alphabet behind a shared 10-per-10-minutes limit makes
   fishing for one pointless. If it ever stops feeling right, the endpoint can return bare
   `{ found, needsCoupleDetails }` and the card can just say "Found them ✓".
15. **The both-joined-by-code path was proved by unit test, not by hand.** If two people each
   signed up holding a code and each were turned down, neither ever answered the couple's
   questions; `requestByCode` then refuses with `needs_couple_details` and the pairing panel asks
   for them inline. Reaching that state in a browser needs four accounts and two rejections, so it
   has route- and schema-level coverage only.
16. **Four in a Row's first move is decided by chance, every single match.** Connect Four rewards
   moving first, and a rematch re-flips rather than alternating, so over a short evening one of them
   can genuinely get the advantage more often. Accepted for V1: the alternative is best of three,
   which triples how long a match takes. If it ever grates, the fix is rounds *inside* the game
   module — alternating starts across three boards — and nothing outside that folder has to change.
17. **Resolved in 7c: turn-based games now have a turn clock.** Two minutes per move, the same
   clock and the same consequence as walking out, on the reasoning that from the other side of the
   board the two are indistinguishable. Nothing is ever played on your behalf — the match is
   awarded, not continued. What remains unproved by hand is the *timing*: the expiry is covered by
   unit test with fake timers, and nobody has sat in front of a real board for two real minutes.
18. **Slice 7c has not been through a two-account browser run.** Every path through the new clocks
   — one away, both away, staggered deadlines, a connected player sitting on their move — is covered
   deterministically with fake timers, and the reported bug is covered end to end over two real
   sockets against a real registry. What has *not* happened is the thing the earlier slices all had:
   two Google accounts in two browser profiles, playing it. The bottom sheet's new both-away state,
   the move clock on screen, and the partner dot changing colour have been read, not watched.
19. **The partner dot cannot distinguish "offline" from "signed in on a phone that is asleep".**
   Presence is "at least one socket", so a backgrounded tab that has not yet been reaped by the
   20-second heartbeat still reads as online for up to that long. Pressing Play in that window
   creates an invitation nobody answers, which is exactly the outcome the gate exists to prevent —
   just narrowed from five minutes to twenty seconds rather than removed.
20. **The drawn board and the full column were proved by unit test, not over a socket.** Both are
   covered exactly and deterministically in `four-in-a-row/server.test.ts`, including a real
   forty-two-disc draw found by playing the rules; reaching either through two live sockets means
   scripting forty-odd moves for a path the rules already decide on their own.
21. **A raw match can outlive its seven days by up to a day.** Retention runs daily, so a row whose
   `expires_at` has just passed sits there until the next sweep. Nothing shows it: the seven-day
   dashboard window filters on `started_at` rather than on the row still existing, so the number is
   right even while the row is not gone yet. Sweeping hourly would narrow it; nothing yet justifies
   the extra passes.
22. **Time played counts the waiting.** A forfeited match includes the 120 seconds nobody was
   playing, and a match paused by a disconnect includes the pause. Wall clock, deliberately (slice
   8): the alternative threads pause bookkeeping through the registry for a figure nobody will audit.
23. **A cooperative game's best score has nowhere to go.** P-3 says a non-competitive match touches
   games-played and time-played and nothing else, and the best-score columns are part of "nothing
   else". The first cooperative game with a score worth keeping should say so explicitly rather than
   inherit it by accident — it is a per-game decision, and `couple_game_stats` already has the
   columns.
24. **Slice 8 has not been through a two-account browser run** either. The numbers were proved
   against real Postgres by playing real matches through the real registry, and the dashboard read
   path was proved to mirror them between both partners — but nobody has watched a dashboard change
   after finishing a game in a browser. It shares this with slice 7c, and the two are the same
   sitting: two Google accounts, two browser profiles, one evening.

25. **Resolved in slice 10: seven games have modules**, so the create screen can reach D-1's minimum
   of three and the couple can actually start a tournament. `catalogue.test.ts` asserts the floor so
   it cannot quietly go back under. Still unproved by hand — see limitation 31.
26. **Slice 9 has not been through a two-account browser run.** The sequencing is covered
   deterministically, the routes are covered for status codes and who gets told, and the repository
   was run through create → advance → complete → pause → resume → expire → sweep against the real
   database. What nobody has done is play a real series in two browser profiles — which is blocked
   on the item above anyway. It joins slices 7c and 8 in the same outstanding sitting.
27. **A tournament game restarted by a failed reconnect writes a second `matches` row.** The
   abandoned attempt is recorded under P-8 and counted by nothing, which is correct, but it means a
   series with restarts has more match rows than games. `tournament_games.match_id` resolves to the
   latest attempt, and `matches.tournament_id` is the authoritative link in the direction reads
   actually want.

28. **Resolved in slice 11: all twelve migrations are applied**, confirmed by querying
   `public.schema_migrations` on the live project. Seven games are `enabled` in Postgres —
   Basketball, Bomb Defusal, Four in a Row, Guess My Answer, Memory, Reaction Speed and Reflex — and
   the other ten catalogue entries are deliberately still `false`. One wart survives:
   `0009_basketball.sql` and `0009_slice_10_games.sql` **share a prefix** and are ordered only by
   the runner's alphabetical tie-break (`basketball` sorts before `slice_10`). They are independent,
   so the order does not matter today, but the next migration must not reuse `0009` and any future
   pair that does share a prefix will be ordered by accident rather than intent.

29. **None of the newer games has been played by two people in a browser.** Half of this is fixed:
   slice 11 put Memory, Guess My Answer, Bomb Defusal, Reflex and Basketball through the real
   `sessionRegistry` against real Postgres, so the platform paths this entry used to worry about are
   no longer inferred — `pause`/`resume` on a real disconnect, the move clock reading `turnOf`, and
   `matchRecorder` writing a `memory` result as competitive are each asserted by a test that
   executes SQL. What remains is the other half: **two browser profiles.** Nobody has watched a
   Phaser scene render, tapped a hazard lane with a thumb, or found out whether Reflex's 150ms step
   feels fair. Reaction Speed and Four in a Row still have no integration suite of their own — they
   are the two games the earlier uncommitted scripts covered, so they are the least likely to be
   broken and the most annoying to have no reproducible proof for.

30. **Reflex's canvas has never been rendered.** The scene compiles, Phaser resolves, the chunk is
   confirmed lazy, and the rules it draws are fully tested — but nobody has watched a hazard fall.
   The parts with no coverage at all are the ones only a browser can answer: whether the lanes are
   wide enough for a thumb on a phone, whether 150ms between steps feels tight or unfair, and
   whether the difficulty curve produces a thirty-second game or a five-second one. Those are
   playtesting questions, and the numbers are all constants at the top of `reflex/protocol.ts` for
   that reason.

31. **A tournament still has not been played.** The blocker (limitation 25) is gone, but slice 9's
   own outstanding browser run now has seven games to choose from rather than none. It joins slices
   7c, 8, 10 and 11 in the same sitting: two Google accounts, two browser profiles, one evening.
   Note that the move-clock rule inside a tournament **changed in slice 11**: a player who is
   present and simply stops moving now forfeits, and only a genuine absence still restarts the game.
   Both halves are covered by unit tests, but the evening is what will say whether a 15-second
   move window feels like enough time on a phone.

32. **The Docker image fix has not been rebuilt.** `apps/server/Dockerfile` now copies
   `packages/games`, which is what it needed to build at all since slice 7 — but Docker was not
   available on the machine, so the corrected file has not been through `npm run docker:server:build`.
   The claim under "Verified, with evidence" that the image builds dates from slice 1 and has been
   stale ever since.

33. **Reflex sends its whole schedule in every frame.** Forty-five hazards is about 1.5KB, and a
   session frame goes out on every move — up to about seven a second per player under the cooldown.
   Roughly 65KB/s for a couple mid-run, and about a megabyte over a thirty-second match. Deliberate:
   the schedule never changes, so the alternative is either a windowed slice the client can run out
   of between moves, or caching it separately from the session view — and "every frame carries the
   whole thing rather than a patch" is a platform rule worth more than the bandwidth. Revisit if
   anybody ever plays this on a metered connection.

34. **A cooperative loss reads as "Played together 💞".** P-3 gives a non-competitive match no
   winner, so the results banner says the same friendly thing whether the bomb was defused or went
   off. The game's own view stays on screen underneath and says BOOM, so nothing is actually
   misreported — but the banner is the biggest thing on the screen and it is the least informative.
   Fixing it means a shared outcome on `MatchResultView`, which is a platform change for one
   sentence and was not worth making blind.

35. **Resolved: the gate was load-sensitive and flaked.** 138 tests across eight files build an
   Express app and bind a **real TCP listener per test**, on vitest's default 5-second budget. Two
   runs failed on different tests in `invitations.test.ts` — once under `npm run verify` (which
   runs typecheck first) and once under coverage instrumentation — while the same file passed in
   isolation every time. Not a race in any route: a budget with no headroom. `vitest.config.ts` now
   sets `testTimeout: 20_000`; the suite still finishes in about three seconds, so the higher
   ceiling only costs time when a test is genuinely hung. Verified with three consecutive
   `npm run verify` runs and three coverage runs, all green. The deeper fix — one server per file
   rather than per test — is still available if these ever get slow enough to matter.

---

## Environment notes

- One root `.env` serves both workspaces; `next.config.ts` loads it so the values are not
  duplicated. `.env.example` marks which slice first needs each variable.
- Supabase project is on `ap-south-1`, signing with **ES256** (asymmetric), so no JWT secret
  exists to leak.
- Connection uses the **session** pooler on 5432, not the transaction pooler on 6543: the backend
  is a long-lived process, not a serverless function.
- Testing pairing needs **two Google accounts and two browser profiles**, both added as Test users
  in Google Auth Platform → Audience.
