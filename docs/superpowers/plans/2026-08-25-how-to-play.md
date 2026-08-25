# How to Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a full-page explanation of a game the first time a session opens, dismissed with **Got it** before the lobby appears, never on a rematch.

**Architecture:** `GameMeta` gains a required `howToPlay: { tagline, steps }`, so the copy lives with the game and adding the tenth game does not mean editing `apps/web`. `PlayScreen` renders that copy instead of the lobby while `phase === 'lobby'` and the reader has not dismissed it for this session id. No server change, no migration, no `SessionView` field: a rematch counts down from `finished` rather than returning to `lobby`, so `phase === 'lobby'` already means "before the first match of this session".

**Tech Stack:** TypeScript, React 19 / Next 16 (`apps/web`), Vitest 3 with two projects (`node` for `*.test.ts`, `jsdom` for `*.test.tsx`), Testing Library, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-25-how-to-play-design.md`

## Global Constraints

- **Copy limits, test-enforced.** `tagline` non-empty, ≤ **100** characters. `steps` **3–6** entries, each non-empty and ≤ **140** characters.
- **H-3 — no secrets.** The copy is one shared page for both seats and must never carry anything one seat is not allowed to know. Bomb Defusal's manual (`MANUAL_TEXT` in `packages/games/src/bomb-defusal/server.ts`) must not appear in its copy, in whole or in part.
- **H-4 — the copy describes the game, never the platform.** No move clock, no 120-second reconnect window, no forfeit, no Give Up, no reactions. Those are the platform's and apply to many games at once.
- **H-5 — `howToPlay` is required on `GameMeta`.** All nine games get copy in this task set; a tenth without copy must fail typecheck and the suite.
- **Interpolate constants.** Where a number in the copy exists as a constant in that game's `protocol.ts`, the copy interpolates it (`` `${ROUNDS} rounds` ``) rather than spelling it out, so changing the constant changes the sentence. Numbers that read as prose ("a coin flip") stay prose.
- **Test file extension routes the environment.** `*.test.ts` → node project, `*.test.tsx` → jsdom project. A misnamed file is collected by neither and runs silently never.
- **Component tests assert roles, accessible names, text, state and callbacks — never class names, inline styles or computed colours.** These files must survive the restyle byte-identical; a test that needs editing to go green means behaviour moved. (Standing rule, documented in `vitest.config.ts`.)
- **Do not touch `apps/web/src/features/play/sessionEnding.ts`** — its copy is asserted verbatim elsewhere.
- **Gate:** `npm run verify` (typecheck → lint → test → build) must be green before the last commit of each task. Baseline at the start of this plan: **52 test files, 914 tests, all green.**

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/test/sessionFixture.ts` | **new** — `player()` and `sessionView()` builders, so every `PlayScreen` test starts from one valid `SessionView` and overrides only what it is about |
| `apps/web/src/features/play/PlayScreen.test.tsx` | **new** — characterization of today's behaviour (Tasks 1–2), then the gate's own tests (Task 5) |
| `packages/games/src/contract.ts` | `HowToPlay` interface; `GameMeta.howToPlay` required |
| `packages/games/src/<slug>/meta.ts` (×9) | each game's own copy |
| `packages/games/src/howToPlay.test.ts` | **new** — copy constraints across `GAME_META`, and the Bomb Defusal leak guard |
| `apps/web/src/features/play/HowToPlayScreen.tsx` | **new** — the screen. Dumb: handed its content, resolves nothing |
| `apps/web/src/features/play/HowToPlayScreen.test.tsx` | **new** |
| `docs/14_PROGRESS.md` | the restyle folded in as a slice, and this feature recorded |
| `ui-clone-workspace/PROGRESS.md` | Phase 2b's `PlayScreen` item marked done |

Task order is TDD throughout, and Tasks 1–2 come first for a reason beyond ceremony: `PlayScreen` is 760 lines and the largest untested component in the app, and Task 5 edits it. The characterization tests are also the top item on the restyle's own Phase 2b list, so writing them now serves both jobs.

---

### Task 1: `PlayScreen` test harness and the three screen states

**Files:**
- Create: `apps/web/src/test/sessionFixture.ts`
- Create: `apps/web/src/features/play/PlayScreen.test.tsx`
- Read for reference: `apps/web/src/features/play/PlayScreen.tsx:175-250` (component top), `:452-485` (the `ended` and `!session` early returns)

**Interfaces:**
- Produces: `player(over?: Partial<SessionPlayer>): SessionPlayer` and `sessionView(over?: Partial<SessionView>): SessionView` from `@/test/sessionFixture`. Tasks 2 and 5 import both.
- Produces: the mock shape below. Tasks 2 and 5 copy it verbatim into their own additions to the same file — it is module-scope in `PlayScreen.test.tsx`, written once in this task.

**Why this harness.** `PlayScreen` does not take a session as a prop. It takes `{ sessionId }` and receives its `SessionView` over the socket, through `useRealtimeEvent`. So a test drives it by mocking `@/realtime/RealtimeProvider`, capturing the listener the component registers, and calling it with an envelope. Three modules must be mocked: the realtime provider (no real WebSocket — `apps/web/src/test/setup.ts` already installs an inert one, but the provider would still need a React context), `next/navigation` (`useRouter`), and `@/games/GameMount` (it resolves renderers through a dynamic import).

- [ ] **Step 1: Write the fixture builders**

Create `apps/web/src/test/sessionFixture.ts`:

```ts
import type { SessionPlayer, SessionView } from '@rasmalai/shared';

/**
 * A valid `SessionPlayer`, overridable field by field.
 *
 * Defaults to somebody present and unready, which is the ordinary state at the top of a lobby and
 * the one most tests want to start from.
 */
export function player(over: Partial<SessionPlayer> = {}): SessionPlayer {
  return {
    userId: 'you',
    nickname: 'Divs',
    avatarKey: 'fox',
    gender: 'female',
    online: true,
    present: true,
    awayUntil: null,
    ready: false,
    ...over,
  };
}

/** A valid `SessionView` in the lobby, overridable field by field. */
export function sessionView(over: Partial<SessionView> = {}): SessionView {
  return {
    id: 'session-1',
    gameSlug: 'memory',
    gameName: 'Memory',
    phase: 'lobby',
    you: player({ userId: 'you', nickname: 'Divs', gender: 'female' }),
    partner: player({ userId: 'them', nickname: 'Sam', gender: 'male', avatarKey: 'frog' }),
    game: null,
    result: null,
    startsAt: null,
    turnUserId: null,
    turnDeadline: null,
    leaveRequest: null,
    tournament: null,
    ...over,
  };
}
```

- [ ] **Step 2: Write the failing test file**

Create `apps/web/src/features/play/PlayScreen.test.tsx`:

```tsx
import { EVENTS, type Envelope, type SessionView } from '@rasmalai/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { player, sessionView } from '@/test/sessionFixture';
import { PlayScreen } from './PlayScreen';

/**
 * `PlayScreen` receives its session over the socket rather than as a prop, so a test drives it by
 * holding the listener the component registers and calling it with a frame.
 *
 * `useRealtimeEvent` keeps only the latest listener: the component re-registers on every render,
 * and calling a stale closure would assert against a render that is no longer on screen.
 */
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  routerPush: vi.fn(),
  status: 'connected' as 'connecting' | 'connected' | 'offline',
  listener: null as ((envelope: Envelope) => void) | null,
}));

vi.mock('@/realtime/RealtimeProvider', () => ({
  useRealtime: () => ({ status: mocks.status, send: mocks.send, subscribe: () => () => {} }),
  useRealtimeEvent: (listener: (envelope: Envelope) => void) => {
    mocks.listener = listener;
  },
  useResyncOnReconnect: () => {},
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

// The real one resolves a renderer through a dynamic import. Here it only has to be identifiable.
vi.mock('@/games/GameMount', () => ({
  GameMount: ({ snapshot }: { snapshot: { slug: string } }) => (
    <div data-testid="game-mount">{snapshot.slug}</div>
  ),
}));

/** Hands the screen a session frame, exactly as `lobby.joined` does. */
function push(session: SessionView): void {
  act(() => {
    mocks.listener?.({ type: EVENTS.lobby.joined, ts: Date.now(), payload: { session } });
  });
}

beforeEach(() => {
  mocks.send.mockClear();
  mocks.routerPush.mockClear();
  mocks.status = 'connected';
  mocks.listener = null;
});

describe('PlayScreen before a session arrives', () => {
  it('says it is looking, as a live region', () => {
    render(<PlayScreen sessionId="session-1" />);

    expect(screen.getByRole('status')).toHaveTextContent('Finding your game…');
  });

  it('asks the server where things stand as soon as it is connected', () => {
    render(<PlayScreen sessionId="session-1" />);

    expect(mocks.send).toHaveBeenCalledWith(EVENTS.lobby.join, { sessionId: 'session-1' });
  });

  it('ignores a frame for a different session', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ id: 'someone-elses' }));

    expect(screen.getByRole('status')).toHaveTextContent('Finding your game…');
  });
});

describe('PlayScreen in the lobby', () => {
  it('names the game as the page heading', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameName: 'Memory' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Memory' })).toBeInTheDocument();
  });

  it('offers to mark you ready, and says so when they already are', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ partner: player({ userId: 'them', nickname: 'Sam', ready: true }) }));

    expect(screen.getByText('They are ready and waiting for you.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I'm ready ✨" })).toBeInTheDocument();
  });

  it('asks you to tell them when the partner is not ready yet', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView());

    expect(screen.getByText('Tell them when you are ready.')).toBeInTheDocument();
  });

  it('sends ready, and offers to take it back once you are', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView());

    await user.click(screen.getByRole('button', { name: "I'm ready ✨" }));
    expect(mocks.send).toHaveBeenCalledWith(EVENTS.lobby.playerReady, { sessionId: 'session-1' });

    push(sessionView({ you: player({ userId: 'you', ready: true }) }));
    expect(screen.getByRole('button', { name: 'Not ready after all' })).toBeInTheDocument();
  });

  it('shows both people while nothing is being played', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView());

    expect(screen.getByText('Divs')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });

  it('offers the reactions', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView());

    expect(screen.getByRole('button', { name: 'React with ❤️' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

```bash
npx vitest run apps/web/src/features/play/PlayScreen.test.tsx
```

Expected: the file fails to resolve `@/test/sessionFixture` if Step 1 was skipped, otherwise the tests run. **If any test fails on an assertion, do not change `PlayScreen.tsx` — change the test.** These are characterization tests: they record what the code does today, and today's behaviour is by definition correct for them. Read the source at the line references above and correct the expectation.

- [ ] **Step 4: Run the whole suite**

```bash
npm test
```

Expected: 53 files, 914 + however many tests this file added, all green. The node project must still report exactly the same count it did before — a `.tsx` file must not be collected by it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/test/sessionFixture.ts apps/web/src/features/play/PlayScreen.test.tsx
git commit -m "test(restyle): characterization harness and lobby tests for PlayScreen"
```

---

### Task 2: `PlayScreen` characterization — the other four phases

**Files:**
- Modify: `apps/web/src/features/play/PlayScreen.test.tsx` (append describe blocks)
- Read for reference: `apps/web/src/features/play/PlayScreen.tsx:496-700`

**Interfaces:**
- Consumes: `player`, `sessionView`, `push`, `mocks` from Task 1, all already in this file.
- Produces: nothing new. Task 5 appends to the same file.

**What this covers, and why each one.** The countdown (a synchronized server deadline the client only renders), the active phase handing off to `GameMount`, the finished phase and its three different endings, the **rematch response** branch (partner ready and you not — a different UI from the rematch *offer*, and the one a naive refactor collapses), the tournament series link, and the away state. These are the branches a restyle is most likely to break silently because they are hard to reach by hand.

- [ ] **Step 1: Append the failing tests**

Append to `apps/web/src/features/play/PlayScreen.test.tsx`:

```tsx
import type { MatchResultView, TournamentView } from '@rasmalai/shared';

const tournament = (over: Partial<TournamentView> = {}): TournamentView =>
  ({
    id: 'tour-1',
    name: 'Sunday series',
    status: 'active',
    games: [],
    currentPosition: 0,
    yourTotalPoints: 3,
    partnerTotalPoints: 1,
    winner: null,
    pausedUntil: null,
    expiresAt: null,
    ...over,
  }) as TournamentView;

const result = (over: Partial<MatchResultView> = {}): MatchResultView =>
  ({
    competitive: true,
    outcome: 'won',
    yourScore: 3,
    partnerScore: 2,
    byForfeit: false,
    byGiveUp: false,
    ...over,
  }) as MatchResultView;

describe('PlayScreen counting down', () => {
  it('renders the countdown as a live timer and says why', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ phase: 'countdown', startsAt: Date.now() + 3_000 }));

    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(screen.getByText('Both ready — here we go')).toBeInTheDocument();
  });

  it('offers no ready button while it is counting down', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ phase: 'countdown', startsAt: Date.now() + 3_000 }));

    expect(screen.queryByRole('button', { name: "I'm ready ✨" })).not.toBeInTheDocument();
  });
});

describe('PlayScreen while a match is running', () => {
  const active = () =>
    sessionView({
      phase: 'active',
      game: { slug: 'memory', view: {} } as SessionView['game'],
    });

  it('hands the game to the mount', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(active());

    expect(screen.getByTestId('game-mount')).toHaveTextContent('memory');
  });

  it('puts the two player chips away once the game has the screen', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(active());

    expect(screen.queryByText('Divs')).not.toBeInTheDocument();
  });

  it('names whose move it is, with a timer, when the game has turns', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(
      sessionView({
        phase: 'active',
        game: { slug: 'four-in-a-row', view: {} } as SessionView['game'],
        turnUserId: 'you',
        turnDeadline: Date.now() + 60_000,
      }),
    );

    expect(screen.getByText('Your move')).toBeInTheDocument();
    expect(screen.getAllByRole('timer').length).toBeGreaterThan(0);
  });

  it('says nothing about a move for a game with no turns', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(active());

    expect(screen.queryByText('Your move')).not.toBeInTheDocument();
  });
});

describe('PlayScreen on the results screen', () => {
  it('offers a rematch when neither of you has asked yet', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ phase: 'finished', result: result() }));

    expect(screen.getByRole('button', { name: 'Rematch ✨' })).toBeInTheDocument();
    expect(screen.getByText('A rematch needs both of you to say so.')).toBeInTheDocument();
  });

  it('turns the offer into an answer when they asked first', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(
      sessionView({
        phase: 'finished',
        result: result(),
        partner: player({ userId: 'them', nickname: 'Sam', gender: 'male', ready: true }),
      }),
    );

    expect(screen.getByRole('button', { name: 'Accept the rematch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline the rematch' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rematch ✨' })).not.toBeInTheDocument();
  });

  it('declining a rematch leaves the session and says so', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(
      sessionView({
        phase: 'finished',
        result: result(),
        partner: player({ userId: 'them', nickname: 'Sam', gender: 'male', ready: true }),
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Decline the rematch' }));

    expect(mocks.send).toHaveBeenCalledWith(EVENTS.lobby.leave, { sessionId: 'session-1' });
    expect(screen.getByText('No rematch — heading back.')).toBeInTheDocument();
  });

  it('keeps the finished game on screen so the round-by-round is still there', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(
      sessionView({
        phase: 'finished',
        result: result(),
        game: { slug: 'memory', view: {} } as SessionView['game'],
      }),
    );

    expect(screen.getByTestId('game-mount')).toBeInTheDocument();
  });

  it('says "next game" rather than "rematch" inside a series', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ phase: 'finished', result: result(), tournament: tournament() }));

    expect(screen.getByRole('button', { name: 'Next game →' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rematch ✨' })).not.toBeInTheDocument();
  });
});

describe('PlayScreen inside a tournament', () => {
  it('links to the series with the running score', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ tournament: tournament({ yourTotalPoints: 3, partnerTotalPoints: 1 }) }));

    const link = screen.getByRole('link', { name: /Series/ });
    expect(link).toHaveAttribute('href', '/tournament/tour-1');
    expect(link).toHaveTextContent('3–1');
  });

  it('drops the running link once the series is over', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ tournament: tournament({ status: 'completed' }) }));

    expect(screen.queryByRole('link', { name: /Series/ })).not.toBeInTheDocument();
  });
});

describe('PlayScreen when the partner is away', () => {
  it('stops offering the lobby while they are gone', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(
      sessionView({
        partner: player({
          userId: 'them',
          nickname: 'Sam',
          gender: 'male',
          present: false,
          awayUntil: Date.now() + 120_000,
        }),
      }),
    );

    expect(screen.queryByRole('button', { name: "I'm ready ✨" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and reconcile**

```bash
npx vitest run apps/web/src/features/play/PlayScreen.test.tsx
```

Expected: green. **Any failure is a wrong expectation, not a bug** — same rule as Task 1. Two are likely to need adjusting against the real source and are worth reading first: `GameSnapshot`'s actual field names (`PlayScreen.tsx:655` shows how `session.game` is passed to `GameMount`), and `MatchResultView`'s fields (`PlayScreen.tsx:87-160`, the `ResultBanner`). Fix the fixture casts to match the real types and drop the `as` where it turns out not to be needed.

- [ ] **Step 3: Run the whole suite and the typechecker**

```bash
npm test && npm run typecheck
```

Expected: both green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/play/PlayScreen.test.tsx
git commit -m "test(restyle): characterization tests for PlayScreen's countdown, match, results and series"
```

---

### Task 3: `HowToPlay` on the contract, and copy for all nine games

**Files:**
- Modify: `packages/games/src/contract.ts` (the `GameMeta` interface, around line 36)
- Modify: `packages/games/src/reaction-speed/meta.ts`, `four-in-a-row/meta.ts`, `memory/meta.ts`, `guess-my-answer/meta.ts`, `bomb-defusal/meta.ts`, `reflex/meta.ts`, `basketball/meta.ts`, `would-you-rather/meta.ts`, `word-game/meta.ts`
- Create: `packages/games/src/howToPlay.test.ts`

**Interfaces:**
- Produces: `export interface HowToPlay { tagline: string; steps: readonly string[] }` from `packages/games/src/contract.ts`, re-exported by `@rasmalai/games` through the existing `export * from './contract'` in `index.ts`. Tasks 4 and 5 import the type from `@rasmalai/games`.
- Produces: `GameMeta.howToPlay: HowToPlay`, required. Task 5 reads it as `findGameMeta(slug)?.howToPlay`.

**One task, not two,** because the field is required: adding it to the interface without the nine copies is a state where nothing typechecks, and a commit that does not typecheck is not a commit this repo makes.

- [ ] **Step 1: Write the failing test**

Create `packages/games/src/howToPlay.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { GAME_META } from './index';
import { MANUAL_TEXT } from './bomb-defusal/server';

const TAGLINE_MAX = 100;
const STEP_MAX = 140;
const STEPS_MIN = 3;
const STEPS_MAX = 6;

const games = Object.entries(GAME_META);

describe('every game explains itself', () => {
  it('has every registered game', () => {
    // Not an exact count: game ten should fail this file for having no copy, not for existing.
    expect(games.length).toBeGreaterThanOrEqual(9);
  });

  it.each(games)('%s has a tagline within budget', (_slug, meta) => {
    expect(meta.howToPlay.tagline.trim()).not.toBe('');
    expect(meta.howToPlay.tagline.length).toBeLessThanOrEqual(TAGLINE_MAX);
  });

  it.each(games)('%s has between three and six steps', (_slug, meta) => {
    expect(meta.howToPlay.steps.length).toBeGreaterThanOrEqual(STEPS_MIN);
    expect(meta.howToPlay.steps.length).toBeLessThanOrEqual(STEPS_MAX);
  });

  it.each(games)('%s has no empty or overlong step', (_slug, meta) => {
    for (const step of meta.howToPlay.steps) {
      expect(step.trim()).not.toBe('');
      expect(step.length).toBeLessThanOrEqual(STEP_MAX);
    }
  });

  it.each(games)('%s repeats no step', (_slug, meta) => {
    expect(new Set(meta.howToPlay.steps).size).toBe(meta.howToPlay.steps.length);
  });
});

/**
 * H-3, as a build failure rather than a habit.
 *
 * Bomb Defusal's manual reaches the expert's screen and nobody else's — a defuser who can read it
 * defuses the bomb alone, and then there is no cooperative game left. The rules are imported from
 * the rulebook rather than re-typed here, so a rule that is reworded stays guarded.
 *
 * Compared on distinctive fragments rather than whole sentences: the leak this is guarding against
 * is somebody paraphrasing a rule into the copy, which a whole-sentence match would sail past.
 */
describe('Bomb Defusal does not hand over the manual', () => {
  const copy = [
    GAME_META['bomb-defusal']!.howToPlay.tagline,
    ...GAME_META['bomb-defusal']!.howToPlay.steps,
  ]
    .join(' ')
    .toUpperCase();

  it('quotes no rule from the manual', () => {
    for (const rule of MANUAL_TEXT) {
      expect(copy).not.toContain(rule.toUpperCase());
    }
  });

  it.each(['SECOND WIRE', 'FIRST WIRE', 'LAST RED', 'THIRD WIRE', 'LAST WIRE'])(
    'does not name the wire a rule points at (%s)',
    (fragment) => {
      expect(copy).not.toContain(fragment);
    },
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run packages/games/src/howToPlay.test.ts
```

Expected: FAIL — `Property 'howToPlay' does not exist on type 'GameMeta'`, or at runtime `Cannot read properties of undefined (reading 'tagline')`.

- [ ] **Step 3: Add the type to the contract**

In `packages/games/src/contract.ts`, add above `GameMeta`:

```ts
/**
 * How this game explains itself to somebody about to play it for the first time.
 *
 * Describes the game and nothing else: no move clock, no reconnect window, no forfeit rule. Those
 * belong to the platform, apply to several games at once, and would be nine copies to keep in step.
 *
 * One page, shared by both seats, and therefore never carrying anything one seat is not allowed to
 * know. Bomb Defusal is why that is a rule rather than a habit: its manual reaches one of the two
 * screens on purpose, and a "here are the rules" page that printed it would leave the product with
 * no cooperative game in it. `howToPlay.test.ts` holds it to that.
 */
export interface HowToPlay {
  /** One line: what this game is, and how it is won. Read before the steps, and often instead. */
  tagline: string;
  /** Three to six steps, in order. A rule is allowed to be a step. */
  steps: readonly string[];
}
```

and inside `GameMeta`, after `inputs`:

```ts
  /** Shown once, full screen, before the first match of a session. Required: a game that cannot
   * explain itself should not ship. */
  howToPlay: HowToPlay;
```

- [ ] **Step 4: Write the copy, one game at a time**

Each block below goes into that game's `meta.ts` as a `howToPlay` property on the exported `meta`. Where a constant is named, import it from that game's `protocol.ts` and interpolate it — the import list is given per game.

Two taglines open on a spelled-out number — Reaction Speed's "Five rounds" and Guess My Answer's "Six questions" — where the same figure is interpolated further down. That is the prose exemption in the Global Constraints, not an oversight: a sentence that opens `5 rounds.` reads like a spreadsheet. Leave them as written.

**`reaction-speed/meta.ts`** — `import { ROUNDS } from './protocol';`

```ts
  howToPlay: {
    tagline: 'Five rounds. Tap the moment the screen tells you to — the quicker thumb takes the round.',
    steps: [
      'The screen holds on Wait… for a stretch you cannot predict.',
      'The instant it turns and says TAP!, tap it. Space or Enter works too.',
      'Whoever is quicker takes the round. Tapping early loses it outright.',
      `${ROUNDS} rounds, every one of them played. Most rounds wins.`,
    ],
  },
```

**`four-in-a-row/meta.ts`** — no constants to interpolate.

```ts
  howToPlay: {
    tagline: 'Line up four of your discs — across, upwards or diagonally.',
    steps: [
      'Tap a column and your disc drops to the bottom of it.',
      'You take turns. Who goes first is a coin flip, every board.',
      'Four in a row in any direction wins it.',
      'A full board with nobody at four is a draw.',
    ],
  },
```

**`memory/meta.ts`** — `import { PAIRS } from './protocol';`

```ts
  howToPlay: {
    tagline: `${PAIRS} pairs face down. Turn over more of them than they do.`,
    steps: [
      'Tap a card to turn it over, then tap a second one.',
      'A matching pair stays face up, and you go again.',
      'No match and both turn back after a moment — then it is their turn.',
      'Most pairs once the board is clear wins.',
    ],
  },
```

**`guess-my-answer/meta.ts`** — `import { OPTIONS, ROUNDS } from './protocol';`

```ts
  howToPlay: {
    tagline: 'Six questions about the two of you. Nobody wins this one — it just tells you something.',
    steps: [
      'Each round, one of you answers about yourself while the other guesses that answer.',
      'You both choose at the same time, in secret. Neither of you sees the other’s screen.',
      'The round opens only when you are both in, so you find out together.',
      `${ROUNDS} rounds, three each way, ${OPTIONS} options every time.`,
    ],
  },
```

**`bomb-defusal/meta.ts`** — `import { MAX_STRIKES, STAGES } from './protocol';`

```ts
  howToPlay: {
    tagline: 'One bomb, two of you, and a single fuse. Neither half is playable alone.',
    steps: [
      'One of you is holding the bomb. The other is holding the manual.',
      'You cannot see each other’s screen, and there is no chat — the taps are how you talk.',
      'The defuser taps a wire to report its colour. The expert taps a wire to point at one.',
      'Only the defuser can cut, and one cut ends the bomb, right or wrong.',
      `${STAGES} bombs, one fuse across all of them, ${MAX_STRIKES} wrong cuts and it is over. You swap jobs each time.`,
    ],
  },
```

Nothing here names a rule. Do not add one.

**`reflex/meta.ts`** — `import { LANES } from './protocol';`

```ts
  howToPlay: {
    tagline: 'Stay alive longest. The same hazards are coming for both of you, at the same moments.',
    steps: [
      `You are in one of ${LANES} lanes. Tap a side, swipe, or use the arrow keys to step across.`,
      'One lane per step, with a beat in between — you cannot jump across the board.',
      'Lanes light up just before a hazard lands on them. Be somewhere else.',
      'It speeds up, and more lanes close as it goes. One is always left open.',
      'Whoever survives longer wins. Best with the phone turned sideways.',
    ],
  },
```

**`basketball/meta.ts`** — `import { ROUNDS_PER_LEVEL, SHOT_CLOCK_MS, TOTAL_SHOTS } from './protocol';`

```ts
  howToPlay: {
    tagline: `${TOTAL_SHOTS} shots at a hoop that will not stay still.`,
    steps: [
      'Drag back and let go to shoot. Arrows and space do the same job.',
      'You alternate, one shot each per round, at the identical hoop.',
      `The first ${ROUNDS_PER_LEVEL} rounds the hoop stands still. After that it drifts, and keeps getting worse.`,
      `${SHOT_CLOCK_MS / 1000} seconds a shot, and shooting from further out is worth more.`,
      `Most points after ${TOTAL_SHOTS} shots wins. Best with the phone turned sideways.`,
    ],
  },
```

**`would-you-rather/meta.ts`** — `import { ASKS_EACH, CANDIDATES, ROUNDS } from './protocol';`

```ts
  howToPlay: {
    tagline: 'Pick the impossible question — then bet on how they will answer it.',
    steps: [
      `On your turn to ask you are dealt ${CANDIDATES} dilemmas, and you choose which one to inflict.`,
      'They see only the one you picked, and take a side.',
      'Then you call it: which side did they take?',
      `${ROUNDS} rounds, ${ASKS_EACH} each. Calling it right is the whole game.`,
      'The dilemmas get harder as the match goes on.',
    ],
  },
```

**`word-game/meta.ts`** — `import { HINTS_EACH, HINT_COST, MIN_WORD, RAID_LETTERS, RAID_LETTERS_BEHIND, TURN_BONUS_MS, TURN_START_MS } from './protocol';`

```ts
  howToPlay: {
    tagline: 'Build words from the letters on the table. Long words are worth far more than they look.',
    steps: [
      `Tap letters from the pool to build a word, ${MIN_WORD} letters or more.`,
      'A word scores its length squared — one six-letter word beats four three-letter ones.',
      'There is always one golden tile on the table, and a word using it is worth double.',
      `${RAID_LETTERS} letters also breaks one of their words and pays a bonus; ${RAID_LETTERS_BEHIND} is enough while you are behind.`,
      `${TURN_START_MS / 1000} seconds a turn, plus ${TURN_BONUS_MS / 1000} more for every word you have already made.`,
      `Stuck? Pass to top the table up, or spend a hint — ${HINTS_EACH} each, ${HINT_COST} points apiece.`,
    ],
  },
```

- [ ] **Step 5: Run the test and the typechecker**

```bash
npx vitest run packages/games/src/howToPlay.test.ts && npm run typecheck
```

Expected: both PASS. If a step now exceeds 140 characters because an interpolated number is longer than the word it replaced, shorten the sentence rather than raising the limit.

- [ ] **Step 6: Run the whole suite**

```bash
npm test
```

Expected: green, with the node project's count up by this file's tests.

- [ ] **Step 7: Commit**

```bash
git add packages/games/src/contract.ts packages/games/src/*/meta.ts packages/games/src/howToPlay.test.ts
git commit -m "feat(games): every game explains itself, and Bomb Defusal still keeps its manual"
```

---

### Task 4: The `HowToPlayScreen` component

**Files:**
- Create: `apps/web/src/features/play/HowToPlayScreen.tsx`
- Create: `apps/web/src/features/play/HowToPlayScreen.test.tsx`
- Read for reference: `apps/web/src/design-system/Card.tsx`, `apps/web/src/design-system/Button.tsx`

**Interfaces:**
- Consumes: `HowToPlay` from `@rasmalai/games` (Task 3).
- Produces: `HowToPlayScreen({ howToPlay, gameName, onDismiss }: { howToPlay: HowToPlay; gameName: string; onDismiss: () => void })`. Task 5 renders it.

Named `HowToPlayScreen`, not `HowToPlay`, so it does not collide with the type it takes as a prop — and it sits alongside `PlayScreen` and `TournamentScreen`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/play/HowToPlayScreen.test.tsx`:

```tsx
import type { HowToPlay } from '@rasmalai/games';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HowToPlayScreen } from './HowToPlayScreen';

const rules: HowToPlay = {
  tagline: 'Ten pairs face down. Turn over more of them than they do.',
  steps: [
    'Tap a card to turn it over, then tap a second one.',
    'A matching pair stays face up, and you go again.',
    'Most pairs once the board is clear wins.',
  ],
};

describe('HowToPlayScreen', () => {
  it('introduces itself under its own heading', () => {
    render(<HowToPlayScreen howToPlay={rules} gameName="Memory" onDismiss={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'How to play' })).toBeInTheDocument();
  });

  it('leads with the tagline', () => {
    render(<HowToPlayScreen howToPlay={rules} gameName="Memory" onDismiss={vi.fn()} />);

    expect(screen.getByText(rules.tagline)).toBeInTheDocument();
  });

  it('renders the steps as an ordered list, in order', () => {
    render(<HowToPlayScreen howToPlay={rules} gameName="Memory" onDismiss={vi.fn()} />);

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([...rules.steps]);
  });

  it('offers one way out, and takes it once', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<HowToPlayScreen howToPlay={rules} gameName="Memory" onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: 'Got it ✨' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders however many steps it is given', () => {
    const six: HowToPlay = { tagline: 'x', steps: ['a', 'b', 'c', 'd', 'e', 'f'] };
    render(<HowToPlayScreen howToPlay={six} gameName="Word Game" onDismiss={vi.fn()} />);

    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run apps/web/src/features/play/HowToPlayScreen.test.tsx
```

Expected: FAIL — cannot resolve `./HowToPlayScreen`.

- [ ] **Step 3: Write the component**

Create `apps/web/src/features/play/HowToPlayScreen.tsx`:

```tsx
'use client';

import type { HowToPlay } from '@rasmalai/games';
import { Button } from '@/design-system/Button';
import { Card } from '@/design-system/Card';

/**
 * A game's rules, shown once before the first match of a session.
 *
 * Deliberately dumb: it is handed its copy and resolves nothing, so it has no opinion about
 * sessions and can be tested with a literal. `PlayScreen` decides whether it is on screen.
 *
 * `<h2>` rather than `<h1>`, because `PlayScreen` keeps the game's name as the page's `<h1>` above
 * this — the reader can already see which game they are about to play.
 *
 * There is no dialog role and no focus trap, and there should not be: this replaces the lobby
 * rather than floating over it, so there is nothing behind it to trap focus away from.
 */
export function HowToPlayScreen({
  howToPlay,
  gameName,
  onDismiss,
}: {
  howToPlay: HowToPlay;
  gameName: string;
  onDismiss: () => void;
}) {
  return (
    <Card className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="font-display text-lg font-bold text-blueberry-deep">How to play</h2>
        <p className="text-sm text-ink">{howToPlay.tagline}</p>
      </div>

      <ol className="flex flex-col gap-3">
        {howToPlay.steps.map((step, index) => (
          <li key={step} className="flex items-start gap-3 text-sm text-muted">
            <span
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-pill bg-sky font-display text-xs font-bold text-ink tabular-nums"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <Button className="mt-auto w-full" onClick={onDismiss} aria-label={`Got it ✨`}>
        Got it ✨
      </Button>
    </Card>
  );
}
```

Note the step number lives in an `aria-hidden` span: the `<ol>` already numbers the list for a screen reader, and reading "1" twice is worse than not styling it. `gameName` is accepted for the heading's benefit and is currently unused in the markup — if lint objects to an unused prop, render it as the `aria-label` of the list (`aria-label={`How to play ${gameName}`}` on the `<ol>`) rather than deleting the prop, since Task 5 passes it.

- [ ] **Step 4: Run the test**

```bash
npx vitest run apps/web/src/features/play/HowToPlayScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Lint and typecheck**

```bash
npm run typecheck && npm run lint
```

Expected: both green. `--color-blueberry-deep` and `--color-sky` both exist in `theme.css` (added in `6527d2a`); if lint or the build says otherwise, use `text-ink` and `bg-blush` instead and note it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/play/HowToPlayScreen.tsx apps/web/src/features/play/HowToPlayScreen.test.tsx
git commit -m "feat(play): a full-page rules screen for a game about to start"
```

---

### Task 5: Gate the lobby behind the rules

**Files:**
- Modify: `apps/web/src/features/play/PlayScreen.tsx`
- Modify: `apps/web/src/features/play/PlayScreen.test.tsx` (append)

**Interfaces:**
- Consumes: `HowToPlayScreen` (Task 4), `findGameMeta` from `@rasmalai/games` (existing), `player`/`sessionView`/`push`/`mocks` (Task 1), and the `result()` fixture helper defined in **Task 2** — the `.each` block below calls it, so Task 2 must land first.
- Produces: nothing downstream.

- [ ] **Step 1: Append the failing tests**

Append to `apps/web/src/features/play/PlayScreen.test.tsx`:

```tsx
describe('PlayScreen shows the rules before the first match', () => {
  it('opens on the rules rather than the lobby', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'memory', gameName: 'Memory' }));

    expect(screen.getByRole('heading', { name: 'How to play' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "I'm ready ✨" })).not.toBeInTheDocument();
  });

  it('still says which game this is', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'memory', gameName: 'Memory' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Memory' })).toBeInTheDocument();
  });

  it('holds back the reactions and the player chips too', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'memory' }));

    expect(screen.queryByRole('button', { name: 'React with ❤️' })).not.toBeInTheDocument();
    expect(screen.queryByText('Divs')).not.toBeInTheDocument();
  });

  it('reveals the lobby once they have read it', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'memory' }));

    await user.click(screen.getByRole('button', { name: 'Got it ✨' }));

    expect(screen.queryByRole('heading', { name: 'How to play' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I'm ready ✨" })).toBeInTheDocument();
  });

  it('stays out of the way once dismissed, even as frames keep arriving', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'memory' }));
    await user.click(screen.getByRole('button', { name: 'Got it ✨' }));

    push(sessionView({ gameSlug: 'memory', partner: player({ userId: 'them', ready: true }) }));

    expect(screen.queryByRole('heading', { name: 'How to play' })).not.toBeInTheDocument();
  });

  it.each(['countdown', 'active', 'finished', 'abandoned'] as const)(
    'is absent in the %s phase',
    (phase) => {
      render(<PlayScreen sessionId="session-1" />);
      push(
        sessionView({
          gameSlug: 'memory',
          phase,
          startsAt: phase === 'countdown' ? Date.now() + 3_000 : null,
          result: phase === 'finished' ? result() : null,
        }),
      );

      expect(screen.queryByRole('heading', { name: 'How to play' })).not.toBeInTheDocument();
    },
  );

  /**
   * The whole reason there is no stored "seen" flag: a rematch counts down from `finished` and
   * never passes back through `lobby`, so the phase alone already means "before the first match".
   */
  it('does not come back for a rematch', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'memory', phase: 'finished', result: result() }));
    push(sessionView({ gameSlug: 'memory', phase: 'countdown', startsAt: Date.now() + 3_000 }));

    expect(screen.queryByRole('heading', { name: 'How to play' })).not.toBeInTheDocument();
  });

  it('falls through to the lobby for a game with no module', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'boat-escape', gameName: 'Boat Escape' }));

    expect(screen.queryByRole('heading', { name: 'How to play' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I'm ready ✨" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run apps/web/src/features/play/PlayScreen.test.tsx
```

Expected: the new `describe` block fails ("Unable to find an accessible element with the role heading and name `How to play`"). The Task 1 and 2 blocks must still pass — several of them push a `lobby` session and will start failing in Step 3 for exactly the reason this feature exists.

- [ ] **Step 3: Add the gate**

In `apps/web/src/features/play/PlayScreen.tsx`:

Add to the imports:

```tsx
import { findGameMeta } from '@rasmalai/games';
import { HowToPlayScreen } from '@/features/play/HowToPlayScreen';
```

Add beside the other `useState` calls near line 187:

```tsx
  /**
   * The session whose rules this reader has dismissed, or null.
   *
   * A session id rather than a boolean: the next game of a tournament is a different session at the
   * same route, and a boolean would carry the last game's dismissal into it.
   */
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
```

Extract the existing title block (currently `PlayScreen.tsx:498-505`) into a local component above `PlayScreen`, so both branches render one copy of it:

```tsx
function GameTitle({ slug, name }: { slug: string; name: string }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <span className="text-2xl" aria-hidden="true">
        {gameGlyph(slug)}
      </span>
      <h1 className="font-display text-xl font-bold text-ink">{name}</h1>
    </div>
  );
}
```

and use `<GameTitle slug={session.gameSlug} name={session.gameName} />` where that markup was.

Then, immediately after the existing `if (!session) { … }` early return (around line 484):

```tsx
  /**
   * The rules, once per session, before anything else.
   *
   * `phase === 'lobby'` is the whole condition and needs nothing stored: a rematch counts down from
   * `finished` and never returns here, so this phase already means "before the first match". A game
   * with no module registered falls through to the lobby rather than rendering an empty page —
   * unreachable in practice, since a session cannot open without a rulebook, but the harmless
   * direction to fail.
   */
  const gameMeta = findGameMeta(session.gameSlug);
  if (session.phase === 'lobby' && gameMeta && dismissedFor !== session.id) {
    return (
      <main className="relative flex flex-1 flex-col gap-4">
        <GameTitle slug={session.gameSlug} name={session.gameName} />
        <HowToPlayScreen
          howToPlay={gameMeta.howToPlay}
          gameName={session.gameName}
          onDismiss={() => setDismissedFor(session.id)}
        />
      </main>
    );
  }
```

- [ ] **Step 4: Run the file and fix the characterization tests that this deliberately broke**

```bash
npx vitest run apps/web/src/features/play/PlayScreen.test.tsx
```

Expected: the new block passes; several Task 1 lobby tests now fail because the lobby is behind the rules.

**This is the one place in the plan where editing a characterization test is correct** — the behaviour genuinely moved, on purpose, and that is exactly what the tests were there to make visible. Fix them by dismissing the rules first. Add this helper next to `push` and use it in the Task 1 `describe('PlayScreen in the lobby')` block and anywhere else a `lobby` session is pushed:

```tsx
/** Gets past the rules screen, which now opens every session. */
async function dismissRules(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Got it ✨' }));
}
```

Tests in that block that had no `userEvent.setup()` will need one. Do not weaken any assertion to make it pass — only add the dismissal.

- [ ] **Step 5: Run the full gate**

```bash
npm run verify
```

Expected: typecheck, lint, all tests and both builds green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/play/PlayScreen.tsx apps/web/src/features/play/PlayScreen.test.tsx
git commit -m "feat(play): read the rules before the first match, once per session"
```

---

### Task 6: Records

**Files:**
- Modify: `docs/14_PROGRESS.md`
- Modify: `ui-clone-workspace/PROGRESS.md`
- Modify: `docs/superpowers/specs/2026-08-25-how-to-play-design.md` (status line)

The restyle has shipped real work — self-hosted fonts, the token diff, the pink/blue rebalance, the wordmark, the swipeable catalogue — and `docs/14_PROGRESS.md` does not mention any of it. That was the second half of the decision this plan came from.

- [ ] **Step 1: Fold the restyle into the numbered progress log**

In `docs/14_PROGRESS.md`, add a row to the slice table after slice 13:

```markdown
| R | Restyle: fonts, tokens, palette rebalance, swipeable catalogue, DOM test harness | **in progress**, automated gate green; Chrome walkthrough outstanding |
```

and add a section after "Slice 13", in the voice of the surrounding sections, covering: the jsdom project and why the extension routes the environment; the self-hosted Poppins/Inter and the zero references to Google's font hosts in the build output; the radius and shadow token diff and its **known intended side-effect** on `packages/games` via `rounded-soft`; the six-digit-hex constraint the two Phaser clients impose on every colour token; the `--transition-duration-*` naming trap; and the pink/blue rebalance including `--color-blueberry`. Cross-reference `ui-clone-workspace/PROGRESS.md` as the working log rather than duplicating it.

- [ ] **Step 2: Record How to Play**

Add a short section to `docs/14_PROGRESS.md` covering the feature and, specifically, the two findings that made it cheap: `phase === 'lobby'` occurring exactly once per session, and the gate needing no modal machinery because it replaces the lobby rather than floating over it. Note the H-3 leak guard by name.

- [ ] **Step 3: Update the restyle log**

In `ui-clone-workspace/PROGRESS.md`, move `PlayScreen` out of the "Still to write" list into a completed batch with its test count, and refresh the `⏸️ RESUME HERE` block with the new totals and the next file to characterize (`OnboardingWizard`, 444 lines).

- [ ] **Step 4: Mark the spec approved**

Change the spec's status line from `approved in chat, awaiting spec review` to `implemented`.

- [ ] **Step 5: Verify the counts you are about to write down**

```bash
npm test 2>&1 | tail -5
```

Use the real numbers. Do not write a count you have not just seen.

- [ ] **Step 6: Commit**

```bash
git add docs/14_PROGRESS.md ui-clone-workspace/PROGRESS.md docs/superpowers/specs/2026-08-25-how-to-play-design.md
git commit -m "docs: record the restyle and the how-to-play screen"
```

---

## Out of scope

Named here so nobody adds them on the way past:

- **No way to re-read the rules mid-match**, and no "?" on the catalogue card. The copy is on `GameMeta` and reachable from anywhere, so both are cheap later.
- **No per-seat copy.** H-3.
- **No persistence of "seen".** H-1 — no column, no table, no `localStorage`.
- **No platform rules in the copy.** H-4.
- **The rest of Phase 2b** (`OnboardingWizard`, `InvitationCentre`, `PairingPanel`, `StatsPanels`, the tournament screens, `GameMount`, `GameErrorBoundary`, `RealtimeProvider`) and **Phase 5's component edits**. This plan takes only the `PlayScreen` characterization tests, because this feature edits that file.
