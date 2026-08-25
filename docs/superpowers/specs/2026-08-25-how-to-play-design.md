# How to Play — design

Status: **implemented.** Plan: `docs/superpowers/plans/2026-08-25-how-to-play.md`.

A full-page explanation of the game, shown once when a session opens, dismissed with **Got it**
before the lobby appears. Nine games exist and none of them currently explains itself anywhere: the
catalogue card carries one line of marketing copy from the `0004` seed, and after that a player is
dropped straight onto a board and left to work out what the buttons do. Bomb Defusal is the extreme
case — its two screens are deliberately different and neither is playable alone — but Word Game has
six real rules and Would You Rather has a three-phase round, and both currently teach them by
letting you get them wrong.

---

## Decisions

| # | Decision | Why |
|---|---|---|
| H-1 | Shown on **every fresh session**, skipped on rematch | Costs nothing to implement (see below) and needs no storage, so it cannot differ between a phone and a laptop or be wiped by clearing site data |
| H-2 | **Blocking**: the rules replace the lobby, rather than floating over it | Nobody can be counted down into a game they are still reading about, because the ready button does not exist while the rules are up |
| H-3 | **One shared page per game, describing shape not secrets** | Bomb Defusal's manual reaches exactly one of the two screens on purpose. Per-seat copy would put the burden of not leaking on every future game's prose; a shared page that never carries secret content cannot leak by construction |
| H-4 | The copy describes **the game, never the platform** | The move clock, the 120-second reconnect window, forfeits and Give Up apply to many games and are owned by the platform. Repeating them in nine places is nine places to drift |
| H-5 | `howToPlay` is **required** on `GameMeta` | A game that cannot explain itself should not ship. All nine get copy in this slice, so requiring it costs nothing now and is the only version of this that survives the tenth game |

## The finding that shapes the implementation

**"Do not appear on rematch" is free.** A rematch does not return the session to the `lobby` phase.
`maybeStartCountdown` counts down from `finished` as readily as from `lobby`
(`apps/server/src/modules/sessions/sessionRegistry.ts:882`), and `abandonCountdown` restores
`phaseBeforeCountdown`, which is `finished` for a rematch. So:

> `phase === 'lobby'` occurs **exactly once per session** — before the first match.

That is the whole gate. No `matchesPlayed` counter on the session, no new `SessionView` field, no
migration, and no client-side bookkeeping that could disagree with the server. A tournament game is
a fresh session in `lobby`, so its rules show before it, which is what a nine-game series wants.

**"Blocking" needs no modal machinery either.** Because the rules replace the lobby body rather
than floating above it, there is no dialog, no focus trap, no `inert`, and no `aria-modal`. The
safety property in H-2 falls out of the structure rather than being enforced by an overlay.

---

## 1. Contract change

`packages/games/src/contract.ts`:

```ts
/**
 * How this game explains itself to somebody about to play it for the first time.
 *
 * Describes the game and nothing else: no move clock, no reconnect window, no forfeit rule. Those
 * belong to the platform, apply to several games at once, and would be nine copies to keep in step
 * (H-4).
 *
 * One page, shared by both seats, and therefore never carrying anything one seat is not allowed to
 * know (H-3). Bomb Defusal is the reason this is a rule rather than a habit: its manual reaches one
 * of the two screens on purpose, and a "here are the rules" page that printed it would leave the
 * product with no cooperative game in it.
 */
export interface HowToPlay {
  /** One line: what this game is, and how it is won. Read before the steps, and often instead. */
  tagline: string;
  /** Three to six steps, in order. A rule is allowed to be a step. */
  steps: readonly string[];
}
```

added to `GameMeta` as a required field: `howToPlay: HowToPlay;`

**Why `GameMeta` and not somewhere else.** `docs/05` requires that adding a game does not mean
editing the platform, and `GameMeta` is already the browser-safe entrypoint that the catalogue,
`formatGameScore` and `GameMount` read. Two alternatives were rejected:

- **A slug-keyed map in `apps/web`** — makes adding a game a two-place edit, and drifts silently
  when a game's rules change, with the compiler saying nothing.
- **A `games.how_to_play` column** — a migration for prose that no query filters on, and a second
  copy of the catalogue to keep honest on top of the one `catalogue.test.ts` already polices.

## 2. The screen

New `apps/web/src/features/play/HowToPlayScreen.tsx`:

```tsx
export function HowToPlayScreen({
  howToPlay,
  gameName,
  onDismiss,
}: {
  howToPlay: HowToPlay;
  gameName: string;
  onDismiss: () => void;
}): JSX.Element
```

Named `HowToPlayScreen` rather than `HowToPlay` so it does not collide with the `HowToPlay` type it
takes as a prop, and matching `PlayScreen` / `TournamentScreen` alongside it.

Deliberately dumb: it is handed its content and does no lookup, so it is testable with a literal
and has no opinion about sessions. `PlayScreen` resolves `findGameMeta(session.gameSlug)`.

Structure: an `<h2>` ("How to play"), the tagline, an `<ol>` of steps, and a single `Got it ✨`
button. `<h2>` rather than `<h1>` because `PlayScreen` already renders the game name as the page's
`<h1>` and keeps it visible above the rules — so the reader sees which game this is, and the
existing heading is not duplicated. Built from the existing `Card` and `Button` primitives, so the
restyle reaches it for free.

**Gating in `PlayScreen`.** While the rules are up, `PlayScreen` renders its existing glyph +
game-name header and then the rules, and **nothing else** — no player chips, no ready button, no
reaction bar. Condition:

```ts
const meta = findGameMeta(session.gameSlug);
const showHowToPlay =
  session.phase === 'lobby' && meta !== null && dismissedFor !== session.id;
```

`dismissedFor` is `useState<string | null>(null)`, holding a session id rather than a boolean, so
navigating from one tournament game to the next cannot inherit the previous session's dismissal if
the route reuses the component instance. A game with no registered module (`meta === null`) skips
the gate entirely rather than showing an empty page — that state should be unreachable, since a
session cannot open for a game with no rulebook, but failing open into the lobby is the harmless
direction to fail.

Dismissal is local to the person and the device. A refresh in the pre-match lobby shows the rules
again, which is correct: they arrived at that screen again.

## 3. Copy

Constraints, enforced by test:

- `tagline` non-empty, at most **100** characters.
- `steps` between **3 and 6** entries, each non-empty and at most **140** characters.
- Nothing describing platform behaviour (H-4).
- Nothing one seat is not allowed to know (H-3).

### reaction-speed

> **Five rounds. Tap the moment the screen tells you to — the quicker thumb takes the round.**

1. The screen holds on **Wait…** for a stretch you cannot predict.
2. The instant it turns and says **TAP!**, tap it. Space or Enter works too.
3. Whoever is quicker takes the round. Tapping early loses it outright.
4. Five rounds, every one of them played. Most rounds wins.

### four-in-a-row

> **Line up four of your discs — across, upwards or diagonally.**

1. Tap a column and your disc drops to the bottom of it.
2. You take turns. Who goes first is a coin flip, every board.
3. Four in a row in any direction wins it.
4. A full board with nobody at four is a draw.

### memory

> **Ten pairs face down. Turn over more of them than they do.**

1. Tap a card to turn it over, then tap a second one.
2. A matching pair stays face up, and you go again.
3. No match and both turn back after a moment — then it is their turn.
4. Most pairs once the board is clear wins.

### guess-my-answer

> **Six questions about the two of you. Nobody wins this one — it just tells you something.**

1. Each round, one of you answers about yourself while the other guesses that answer.
2. You both choose at the same time, in secret. Neither of you sees the other's screen.
3. The round opens only when you are both in, so you find out together.
4. Six rounds, three each way, four options every time.

### bomb-defusal

> **One bomb, two of you, and a single fuse. Neither half is playable alone.**

1. One of you is holding the bomb. The other is holding the manual.
2. You cannot see each other's screen, and there is no chat — the taps are how you talk.
3. The defuser taps a wire to report its colour. The expert taps a wire to point at one.
4. Only the defuser can cut, and one cut ends the bomb, right or wrong.
5. Three bombs, one fuse across all of them, three wrong cuts and it is over. You swap jobs each time.

*Contains no manual rule, by design. Guarded by test — see §4.*

### reflex

> **Stay alive longest. The same hazards are coming for both of you, at exactly the same moments.**

1. You are in one of five lanes. Tap a side, swipe, or use the arrow keys to step across.
2. One lane per step, with a beat in between — you cannot jump across the board.
3. Lanes light up just before a hazard lands on them. Be somewhere else.
4. It speeds up, and more lanes close as it goes. One is always left open.
5. Whoever survives longer wins. Best with the phone turned sideways.

### basketball

> **Twenty shots at a hoop that will not stay still.**

1. Drag back and let go to shoot. Arrows and space do the same job.
2. You alternate, one shot each per round, at the identical hoop.
3. The first five rounds the hoop stands still. After that it starts to drift, and keeps getting worse.
4. Fifteen seconds a shot, and shooting from further out is worth more.
5. Most points after twenty shots wins. Best with the phone turned sideways.

### would-you-rather

> **Pick the impossible question — then bet on how they will answer it.**

1. On your turn to ask you are dealt three dilemmas, and you choose which one to inflict.
2. They see only the one you picked, and take a side.
3. Then you call it: which side did they take?
4. Six rounds, three each. Calling it right is the whole game.
5. The dilemmas get harder as the match goes on.

### word-game

> **Build words from the letters on the table. Long words are worth far more than they look.**

1. Tap letters from the pool to build a word, three letters or more.
2. A word scores its length squared — one six-letter word beats four three-letter ones.
3. There is always one golden tile on the table, and a word using it is worth double.
4. Six letters also breaks one of their words and pays a bonus; five is enough while you are behind.
5. Thirty seconds a turn, plus five more for every word you have already made.
6. Stuck? Pass to top the table up, or spend a hint — three each, five points apiece.

## 4. Testing

In this order. The first item is Phase 2b work that this feature needs anyway.

1. **`apps/web/src/features/play/PlayScreen.test.tsx` — characterization, written first.**
   `PlayScreen` is 760 lines, is the largest untested component in the app, and is the file this
   feature edits. Pins current behaviour before anything moves: the five phases (`lobby`,
   `countdown`, `active`, `finished`, `abandoned`), the ready toggle and its two labels, the
   countdown timer's `role="timer"`, the rematch offer versus the rematch *response* (partner ready
   and you not), the tournament series link and the series-over branch, the away/waiting state, the
   leave request, and Give Up. Assertions are roles, accessible names, text and callbacks — never
   class names — per the standing rule in `vitest.config.ts`.

2. **`apps/web/src/features/play/HowToPlayScreen.test.tsx`** — tagline and every step rendered, steps in
   order and inside an `<ol>`, `Got it` has an accessible name and calls `onDismiss` exactly once.

3. **New `PlayScreen` tests** — the rules show in `lobby`; they are absent in the other four
   phases; **absent on a rematch**, driven through the real transition (`finished` → `countdown`,
   which never passes through `lobby`); dismissing reveals the ready button; the ready button is
   genuinely unreachable while the rules are up; and an unknown game slug falls through to the
   lobby rather than rendering an empty page.

4. **`packages/games/src/howToPlay.test.ts`** (node project — `packages/*/src/**/*.test.ts` is
   already included) — every game in `GAME_META` satisfies the §3 constraints, and no step is
   duplicated within a game. This is what makes H-5 real: a tenth game without copy fails the
   suite.

5. **The Bomb Defusal leak guard**, in the same file. Asserts that `bomb-defusal`'s copy contains
   none of the manual's rule strings, imported from the rulebook rather than re-typed, so a future
   copy edit that pastes in a rule fails the build. Same shape as the existing check that the built
   client bundle carries no server-only string.

`npm run verify` (typecheck, lint, test, build) is the gate, as for every slice.

## 5. Files touched

| File | Change |
|---|---|
| `packages/games/src/contract.ts` | `HowToPlay` interface, required `GameMeta.howToPlay` |
| `packages/games/src/*/meta.ts` (×9) | the copy in §3 |
| `packages/games/src/howToPlay.test.ts` | new — constraints and the leak guard |
| `apps/web/src/features/play/HowToPlayScreen.tsx` | new — the screen |
| `apps/web/src/features/play/HowToPlayScreen.test.tsx` | new |
| `apps/web/src/features/play/PlayScreen.tsx` | the gate: resolve meta, `dismissedFor`, render rules instead of the lobby |
| `apps/web/src/features/play/PlayScreen.test.tsx` | new — characterization, then the gate's own tests |

No migration. No change to `packages/shared`, `apps/server`, or any route.

## 6. Non-goals

- **No way to re-read the rules mid-match**, and no "?" on the catalogue card. Both are cheap
  later — the copy is on `GameMeta` and reachable from anywhere — but neither was asked for, and a
  second entry point is a second set of states to get right.
- **No per-seat copy.** H-3.
- **No persistence.** H-1. Somebody who plays Memory every evening reads four lines every evening;
  that is the cost of not putting a row in the database for it, and the page is four lines precisely
  so the cost stays small.
- **No platform rules in the copy.** H-4.

## 7. Risks

- **Copy drifts from rules.** A game's constants can change without its `howToPlay` following.
  Mitigated by rule: **where a number in the copy exists as a constant in that game's
  `protocol.ts`, the copy interpolates it** — `` `${ROUNDS} rounds` `` rather than `five rounds` —
  so changing the constant changes the sentence. Where the number reads as a word rather than a
  digit ("a coin flip", "both turn back"), it is prose and stays prose. Not test-enforced; a test
  that could tell the difference would have to parse English.
- **Five extra taps in a tournament.** A seven-game series now has seven rules pages in it. That is
  the intended behaviour — seven different games — but it is the one place H-1 is felt, and the
  two-account browser run is what will say whether it grates.
