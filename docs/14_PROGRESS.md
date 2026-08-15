# Implementation Progress

Companion to `docs/13_ARCHITECTURE_PROPOSAL.md`. That document records **intent** — the locked
decisions. This one records **state**: what exists, what has actually been verified, and what is
knowingly incomplete.

Update it at the end of every slice.

Last updated: end of slice 7, plus the onboarding rework described under "Onboarding has two
branches" below.

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
| 7b | Four in a Row | next |
| 8 | Results, statistics, retention job | not started |
| 9 | Tournaments | not started |
| 10+ | Remaining games, mobile polish, deployment | not started |

Gate at the time of writing: **285 tests passing**, typecheck, lint and both builds green
(`npm run verify`), plus **49 realtime checks** against real sockets and real Postgres, and a full
match played in a browser against a live partner.

---

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
`games.enabled` is now true for `reaction-speed` only.

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

The entire visual identity is `apps/web/src/design-system/theme.css`. Swap that file to reskin.

One correction to that file, found while measuring the game's own transition: the motion tokens were
named `--duration-*`, and Tailwind resolves `duration-quick` against **`--transition-duration-*`**.
Every animation in the app had been silently falling back to the 150ms default while the theme file
looked like it was in charge. Renamed; `duration-quick` and `duration-soft` now measure 120ms and
240ms in the browser.

---

## Verified, with evidence

Not "it compiles" — these were actually run.

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
6. **Nothing writes the statistics tables yet.** Slice 5 built and proved the read path; the
   formulas are fixed in the comments of `0004_dashboard.sql` so slice 8 has nothing left to
   invent. Every dashboard number is therefore honestly zero until then.
7. **Reaction Speed is the only playable game.** Four in a Row is next, and is the real test of the
   contract: turn ownership, illegal move rejection, full-state restore, and a genuinely different
   renderer, with zero changes to the platform. Until it ships, "the platform is game-agnostic" is a
   claim with one data point.
8. **The reconnect window expiring was verified with fake timers, not in a live browser.** The unit
   tests cover the transition — window expires, both told, session abandoned and forgotten, couple
   free to start again — and the end-to-end run covers the pause and the recovery inside the window,
   but waiting out a real 120 seconds was not done by hand.
9. **Counter-proposals have no UI yet.** The server, the protocol and the transaction are done and
   verified; the picker waits until a second game ships and there is something to counter with.
10. **Score units are not modelled.** A per-game best score renders as a bare number, which is right
   for points and wrong for a duration. The game module that first needs it should declare its own
   formatter rather than the platform guessing.
11. **A finished match is still not written down.** Playing produces an authoritative result on
   screen and nothing in Postgres, so the dashboard stays honestly zero. Slice 8 writes the
   `matches` row and the aggregates together, because they share the formulas already fixed in
   `0004_dashboard.sql`. The end-to-end run asserts the row count is zero, so the day slice 8 lands,
   that check fails loudly rather than the boundary drifting.
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
