import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARM_MAX_MS,
  ARM_MIN_MS,
  BREATHER_MS,
  ROUNDS,
  TAP_TIMEOUT_MS,
  type FourInARowView,
  type ReactionSpeedView,
} from '@rasmalai/games';
import { findGameRules } from '@rasmalai/games/server';
import {
  COUNTDOWN_MS,
  EVENTS,
  LEAVE_REQUEST_TTL_MS,
  MOVE_WINDOW_MS,
  RECONNECT_WINDOW_MS,
  type SessionView,
} from '@rasmalai/shared';
import { SessionError, createSessionRegistry, type SessionRegistry } from './sessionRegistry';

const ALICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COUPLE = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

interface Sent {
  userId: string;
  type: string;
  payload: unknown;
}

let sent: Sent[];
let online: Set<string>;
let sessions: SessionRegistry;

/** Every event a given person received, in order. */
const typesFor = (userId: string) =>
  sent.filter((event) => event.userId === userId).map((event) => event.type);

const lastViewFor = (userId: string): SessionView => {
  const event = [...sent].reverse().find((candidate) => candidate.userId === userId);
  return (event?.payload as { session: SessionView }).session;
};

/**
 * The moment this session resolves: the **latest** of the away clocks, not the earliest.
 *
 * The same arithmetic the registry and the bottom sheet both do. Two people who walked off a minute
 * apart are each on their own two minutes, and the one who left second still has time on theirs
 * after the first has run out.
 */
const awayDeadline = (view: SessionView): number | null =>
  view.you.awayUntil === null && view.partner.awayUntil === null
    ? null
    : Math.max(view.you.awayUntil ?? 0, view.partner.awayUntil ?? 0);

/**
 * Creates a session and puts both of them on its page, which is what a real client does the moment
 * it mounts. Presence is "socket **and** page", so without the join neither of them is in the room
 * and nothing that needs both of them present can start.
 */
function startSession(): string {
  const view = sessions.create({
    coupleId: COUPLE,
    gameSlug: 'reaction-speed',
    gameName: 'Reaction Speed',
    players: [
      { userId: ALICE, nickname: 'Ali', avatarKey: 'fox', gender: 'female' },
      { userId: BOB, nickname: 'Bo', avatarKey: 'penguin', gender: 'male' },
    ],
  });
  sessions.join(view.id, ALICE);
  sessions.join(view.id, BOB);
  sent = [];
  return view.id;
}

/** Halfway through the arming window, so every round in these tests goes live at a known moment. */
const ARM_MS = ARM_MIN_MS + 0.5 * (ARM_MAX_MS - ARM_MIN_MS);

/**
 * Reaction Speed with its scoring kind swapped, standing in for a cooperative game.
 *
 * Real rules rather than a hand-rolled fake, because the only thing under test is what the platform
 * does with `scoringKind` — and P-3 says statistics and results branch on that field alone.
 */
const competitiveRules = findGameRules('reaction-speed')!;
const cooperativeRules = {
  ...competitiveRules,
  meta: { ...competitiveRules.meta, scoringKind: 'cooperative' as const },
};

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  online = new Set([ALICE, BOB]);
  sessions = createSessionRegistry(
    {
      sendToUser(userId, type, payload) {
        sent.push({ userId, type, payload });
      },
    },
    { isOnline: (userId) => online.has(userId) },
    // The real Reaction Speed rules, with the one unpredictable thing about them pinned down. These
    // tests are about the platform's half of the arrangement, played against a genuine game.
    { random: () => 0.5 },
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('starting a session', () => {
  it('opens in the lobby with nobody ready', () => {
    const id = startSession();
    const view = sessions.viewFor(id, ALICE);

    expect(view.phase).toBe('lobby');
    expect(view.you.ready).toBe(false);
    expect(view.partner.ready).toBe(false);
    expect(view.startsAt).toBeNull();
  });

  it('shows each player as "you" from their own side', () => {
    const id = startSession();

    expect(sessions.viewFor(id, ALICE).you.userId).toBe(ALICE);
    expect(sessions.viewFor(id, ALICE).partner.userId).toBe(BOB);
    expect(sessions.viewFor(id, BOB).you.userId).toBe(BOB);
    expect(sessions.viewFor(id, BOB).partner.userId).toBe(ALICE);
  });

  it('refuses a second session for the same couple (ADR-009)', () => {
    startSession();

    expect(() =>
      sessions.create({
        coupleId: COUPLE,
        gameSlug: 'four-in-a-row',
        gameName: 'Four in a Row',
        players: [
          { userId: ALICE, nickname: 'Ali', avatarKey: 'fox', gender: 'female' },
          { userId: BOB, nickname: 'Bo', avatarKey: 'penguin', gender: 'male' },
        ],
      }),
    ).toThrow(SessionError);
  });

  it('refuses to show a session to somebody who is not in it', () => {
    const id = startSession();
    expect(() => sessions.viewFor(id, 'dddddddd-dddd-dddd-dddd-dddddddddddd')).toThrow(
      SessionError,
    );
  });
});

describe('ready and the countdown', () => {
  it('waits for both, and tells both who is ready', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);

    expect(typesFor(BOB)).toEqual([EVENTS.lobby.playerReady]);
    expect(sessions.viewFor(id, BOB).partner.ready).toBe(true);
    expect(sessions.viewFor(id, BOB).phase).toBe('lobby');
  });

  it('starts a countdown on a server deadline once both are ready', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);

    const view = sessions.viewFor(id, ALICE);
    expect(view.phase).toBe('countdown');
    expect(view.startsAt).toBe(Date.now() + COUNTDOWN_MS);
    expect(typesFor(ALICE)).toContain(EVENTS.lobby.starting);
    expect(typesFor(BOB)).toContain(EVENTS.lobby.starting);
  });

  it('both players are told the same deadline, so the countdown is shared', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);

    expect(lastViewFor(ALICE).startsAt).toBe(lastViewFor(BOB).startsAt);
  });

  it('goes active when the countdown runs out', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);

    expect(sessions.viewFor(id, ALICE).phase).toBe('active');
    expect(sessions.viewFor(id, ALICE).startsAt).toBeNull();
    expect(typesFor(ALICE)).toContain(EVENTS.lobby.started);
  });

  it('unreadying during the countdown puts everyone back in the lobby', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    sessions.setReady(id, BOB, false);

    expect(sessions.viewFor(id, ALICE).phase).toBe('lobby');
    expect(sessions.viewFor(id, ALICE).startsAt).toBeNull();

    // And the cancelled countdown must not fire later.
    vi.advanceTimersByTime(COUNTDOWN_MS * 2);
    expect(typesFor(ALICE)).not.toContain(EVENTS.lobby.started);
  });

  it('treats a duplicate ready as a duplicate, not a state change', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sent = [];
    sessions.setReady(id, ALICE, true);

    // Acknowledged to the sender only; the partner is not told something they already know.
    expect(typesFor(ALICE)).toEqual([EVENTS.lobby.joined]);
    expect(typesFor(BOB)).toEqual([]);
  });

  it('refuses a stale ready sent after the game has started', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);

    expect(() => sessions.setReady(id, ALICE, false)).toThrow(
      expect.objectContaining({ code: 'invalid_game_state' }),
    );
  });

  it('refuses a ready from somebody who is not in the session', () => {
    const id = startSession();
    expect(() => sessions.setReady(id, 'dddddddd-dddd-dddd-dddd-dddddddddddd', true)).toThrow(
      expect.objectContaining({ code: 'not_authorized' }),
    );
  });

  it('refuses anything at all for a session that has ended', () => {
    expect(() => sessions.setReady('nope', ALICE, true)).toThrow(
      expect.objectContaining({ code: 'session_not_found' }),
    );
  });
});

describe('disconnect and reconnect', () => {
  it('in the lobby, a disconnect just clears their ready — nothing is running to hold open', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);

    online.delete(ALICE);
    sessions.handlePresence(ALICE, false);

    const view = sessions.viewFor(id, BOB);
    expect(view.partner.online).toBe(false);
    expect(view.partner.ready).toBe(false);
    // On a clock, but not one with anything at stake: it exists so a lobby both of them walk away
    // from stops holding the couple's one session slot, not so anybody can lose a game they were
    // not playing.
    expect(view.partner.awayUntil).toBe(Date.now() + RECONNECT_WINDOW_MS);
    expect(typesFor(BOB)).toContain(EVENTS.presence.playerDisconnected);
    expect(typesFor(BOB)).not.toContain(EVENTS.presence.reconnectWindowStarted);
  });

  it('opens a 120-second window when somebody drops mid-game', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);
    sent = [];

    online.delete(ALICE);
    sessions.handlePresence(ALICE, false);

    const view = sessions.viewFor(id, BOB);
    expect(view.partner.awayUntil).toBe(Date.now() + RECONNECT_WINDOW_MS);
    expect(awayDeadline(view)).toBe(Date.now() + RECONNECT_WINDOW_MS);
    expect(typesFor(BOB)).toContain(EVENTS.presence.reconnectWindowStarted);
  });

  it('resumes when they come back inside the window', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);

    online.delete(ALICE);
    sessions.handlePresence(ALICE, false);

    vi.advanceTimersByTime(RECONNECT_WINDOW_MS - 1000);
    sent = [];
    online.add(ALICE);
    sessions.handlePresence(ALICE, true);
    // A socket coming back is not the same as being back at the table, so the client re-joins —
    // which every real one does, on every transition into `connected`. Until it does, the person is
    // signed in and standing somewhere else.
    expect(awayDeadline(sessions.viewFor(id, BOB))).not.toBeNull();
    sessions.join(id, ALICE);

    expect(typesFor(BOB)).toContain(EVENTS.presence.playerReconnected);
    expect(awayDeadline(sessions.viewFor(id, BOB))).toBeNull();

    // And the window must not fire after they are back.
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
    expect(typesFor(BOB)).not.toContain(EVENTS.presence.reconnectWindowExpired);
  });

  it('forfeits the match when the window runs out, and says so to both of them', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);

    online.delete(ALICE);
    sessions.handlePresence(ALICE, false);
    sent = [];
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);

    expect(typesFor(BOB)).toContain(EVENTS.presence.reconnectWindowExpired);
    expect(typesFor(BOB)).toContain(EVENTS.results.matchResult);

    // Two minutes is long enough that this is walking out, not bad wifi. Scored 1-0 like a
    // walkover rather than freezing whatever the game happened to show.
    expect(sessions.viewFor(id, BOB).result).toEqual({
      outcome: 'won',
      yourScore: 1,
      theirScore: 0,
      competitive: true,
      byForfeit: true,
    });
    expect(sessions.viewFor(id, ALICE).result).toEqual({
      outcome: 'lost',
      yourScore: 0,
      theirScore: 1,
      competitive: true,
      byForfeit: true,
    });
  });

  it('leaves the forfeited session on its results screen, so the one who walked off finds out', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);
    online.delete(ALICE);
    sessions.handlePresence(ALICE, false);
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);

    // Not torn down: the person who wandered off learns why when they come back, and the two of
    // them can rematch from here like any other finished match.
    expect(sessions.viewFor(id, BOB).phase).toBe('finished');
    expect(awayDeadline(sessions.viewFor(id, BOB))).toBeNull();

    // It cleans itself up once nobody is left in it — after the same two minutes, because BOB
    // walking off a results screen is no more final than anybody else walking off anything.
    online.delete(BOB);
    sessions.handlePresence(BOB, false);
    expect(sessions.size).toBe(1);

    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
    expect(sessions.size).toBe(0);
  });

  it('does not forfeit a cooperative game, because there is no winner to award (P-3)', () => {
    // Real rules with one field changed: nobody beats anybody in a cooperative game, so walking
    // out cannot hand the other person a win. The session simply stops and says who did not come
    // back.
    const registry = createSessionRegistry(
      {
        sendToUser(userId, type, payload) {
          sent.push({ userId, type, payload });
        },
      },
      { isOnline: (userId) => online.has(userId) },
      { random: () => 0.5, findRules: () => cooperativeRules },
    );

    const coop = registry.create({
      coupleId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      gameSlug: 'boat-escape',
      gameName: 'Boat Escape',
      players: [
        { userId: ALICE, nickname: 'Ali', avatarKey: 'fox', gender: 'female' },
        { userId: BOB, nickname: 'Bo', avatarKey: 'penguin', gender: 'male' },
      ],
    }).id;

    registry.join(coop, ALICE);
    registry.join(coop, BOB);
    registry.setReady(coop, ALICE, true);
    registry.setReady(coop, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);

    online.delete(ALICE);
    registry.handlePresence(ALICE, false);
    sent = [];
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);

    const ended = sent.find((event) => event.type === EVENTS.lobby.ended);
    expect(ended?.payload).toMatchObject({ reason: 'forfeited', byUserId: ALICE });
    expect(registry.sessionIdForUser(BOB)).toBeNull();
  });

  it('a second device going offline is not a disconnect, because presence is per person', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);
    sent = [];

    // ALICE closed one tab but is still online elsewhere, so the socket layer reports online.
    sessions.handlePresence(ALICE, true);

    expect(awayDeadline(sessions.viewFor(id, BOB))).toBeNull();
    expect(typesFor(BOB)).not.toContain(EVENTS.presence.reconnectWindowStarted);
  });

  it('restarts the countdown rather than resuming it mid-flight', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);

    // Drop out with 1s of countdown left.
    vi.advanceTimersByTime(COUNTDOWN_MS - 1000);
    online.delete(BOB);
    sessions.handlePresence(BOB, false);
    expect(sessions.viewFor(id, ALICE).phase).toBe('lobby');

    online.add(BOB);
    sessions.handlePresence(BOB, true);
    // They come back unready, so nothing starts behind their back.
    expect(sessions.viewFor(id, ALICE).phase).toBe('lobby');
    expect(sessions.viewFor(id, ALICE).partner.ready).toBe(false);
  });
});

describe('reactions', () => {
  it('relays to both, stamped with who sent it', () => {
    const id = startSession();
    sessions.react(id, ALICE, '❤️');

    const delivered = sent.filter((event) => event.type === EVENTS.reaction.sent);
    expect(delivered.map((event) => event.userId).sort()).toEqual([ALICE, BOB].sort());
    expect(delivered[0]?.payload).toEqual({ reaction: '❤️', fromUserId: ALICE });
  });

  it('refuses a reaction from somebody outside the session', () => {
    const id = startSession();
    expect(() => sessions.react(id, 'dddddddd-dddd-dddd-dddd-dddddddddddd', '😂')).toThrow(
      expect.objectContaining({ code: 'not_authorized' }),
    );
  });

  it('is never stored — the registry keeps no record of it', () => {
    const id = startSession();
    sessions.react(id, ALICE, '😡');
    // Nothing about a reaction reaches the session view.
    expect(JSON.stringify(sessions.viewFor(id, ALICE))).not.toContain('😡');
  });
});

describe('shutdown', () => {
  it('ends live sessions so nobody is left staring at a dead lobby', () => {
    const id = startSession();
    sessions.closeAll();

    expect(typesFor(ALICE)).toContain(EVENTS.lobby.ended);
    expect(sessions.sessionIdForUser(ALICE)).toBeNull();
    expect(() => sessions.viewFor(id, ALICE)).toThrow();
  });

  it('says why, so the screen can explain itself', () => {
    startSession();
    sessions.closeAll();

    const ended = sent.find((event) => event.type === EVENTS.lobby.ended);
    expect(ended?.payload).toMatchObject({ reason: 'server_stopped' });
  });
});

// -------------------------------------------------------------------------------------------
// The game itself, played through the platform. Slice 7.
// -------------------------------------------------------------------------------------------

const gameView = (id: string, userId: string): ReactionSpeedView =>
  sessions.viewFor(id, userId).game?.state as ReactionSpeedView;

/** Takes a session from the lobby to a live first round. */
function startPlaying(): string {
  const id = startSession();
  sessions.setReady(id, ALICE, true);
  sessions.setReady(id, BOB, true);
  vi.advanceTimersByTime(COUNTDOWN_MS);
  sent = [];
  return id;
}

function tap(id: string, userId: string, round: number): void {
  sessions.submitAction(
    id,
    userId,
    { type: 'tap', round },
    { receivedAt: Date.now(), compensationMs: 0 },
  );
}

/**
 * Plays one round out at exact reaction times, then waits out the breather.
 *
 * Times are milliseconds after the round goes live, so `[200, 300]` means Alice was a hundred
 * milliseconds quicker.
 */
function playRound(id: string, aliceMs: number, bobMs: number): void {
  const round = gameView(id, ALICE).roundNumber;
  vi.advanceTimersByTime(ARM_MS);

  const liveAt = Date.now();
  const order: [string, number][] = [
    [ALICE, aliceMs],
    [BOB, bobMs],
  ];
  order.sort((left, right) => left[1] - right[1]);

  for (const [userId, offset] of order) {
    vi.advanceTimersByTime(liveAt + offset - Date.now());
    tap(id, userId, round);
  }

  vi.advanceTimersByTime(BREATHER_MS);
}

describe('starting the game', () => {
  it('hands the session to the game module when the countdown runs out', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);

    const view = sessions.viewFor(id, ALICE);
    expect(view.phase).toBe('active');
    expect(view.game?.slug).toBe('reaction-speed');
    expect(gameView(id, ALICE).roundNumber).toBe(1);

    // The frame announcing the start already carries the game, so there is no moment where the
    // session is active and the client has nothing to draw.
    const started = sent.find((event) => event.type === EVENTS.lobby.started);
    expect((started?.payload as { session: SessionView }).session.game).not.toBeNull();
  });

  it('ends the session rather than stranding two people in a lobby with no rules', () => {
    const registry = createSessionRegistry(
      {
        sendToUser(userId, type, payload) {
          sent.push({ userId, type, payload });
        },
      },
      { isOnline: (userId) => online.has(userId) },
      { findRules: () => null },
    );

    const id = registry.create({
      coupleId: COUPLE,
      gameSlug: 'not-built-yet',
      gameName: 'Not Built Yet',
      players: [
        { userId: ALICE, nickname: 'Ali', avatarKey: 'fox', gender: 'female' },
        { userId: BOB, nickname: 'Bo', avatarKey: 'penguin', gender: 'male' },
      ],
    }).id;

    registry.join(id, ALICE);
    registry.join(id, BOB);
    registry.setReady(id, ALICE, true);
    registry.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);

    expect(typesFor(ALICE)).toContain(EVENTS.lobby.ended);
    expect(registry.sessionIdForUser(ALICE)).toBeNull();
  });

  it('starts the first round on the server clock, not on either browser', () => {
    const id = startPlaying();

    expect(gameView(id, ALICE).current.phase).toBe('arming');
    vi.advanceTimersByTime(ARM_MS);

    // Both were told at the same instant, and both see the same start.
    expect(typesFor(ALICE)).toContain(EVENTS.game.roundStarted);
    expect(typesFor(BOB)).toContain(EVENTS.game.roundStarted);
    expect(gameView(id, ALICE).current.startedAt).toBe(gameView(id, BOB).current.startedAt);
  });
});

describe('actions', () => {
  it('refuses an action from somebody who is not in the session', () => {
    const id = startPlaying();
    vi.advanceTimersByTime(ARM_MS);

    expect(() => tap(id, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 1)).toThrow(
      expect.objectContaining({ code: 'not_authorized' }),
    );
  });

  it('refuses an action before the game is running', () => {
    const id = startSession();
    expect(() => tap(id, ALICE, 1)).toThrow(
      expect.objectContaining({ code: 'invalid_game_state' }),
    );
  });

  it('refuses an action the game itself rejects', () => {
    const id = startPlaying();
    vi.advanceTimersByTime(ARM_MS);
    tap(id, ALICE, 1);

    // A second tap in the same round is the game's call, and the platform passes the refusal on.
    expect(() => tap(id, ALICE, 1)).toThrow(expect.objectContaining({ code: 'invalid_action' }));
  });

  it('tells only the tapper that their own tap landed', () => {
    const id = startPlaying();
    vi.advanceTimersByTime(ARM_MS);
    sent = [];
    tap(id, ALICE, 1);

    expect(typesFor(ALICE)).toEqual([EVENTS.game.stateUpdated]);
    expect(typesFor(BOB)).toEqual([]);
    expect(gameView(id, BOB).current.theirReactionMs).toBeNull();
  });

  it('scores a round on the server, from its own arrival times', () => {
    const id = startPlaying();
    playRound(id, 200, 320);

    expect(gameView(id, ALICE).yourRoundsWon).toBe(1);
    expect(gameView(id, BOB).yourRoundsWon).toBe(0);
    expect(gameView(id, ALICE).history[0]?.yourReactionMs).toBe(200);
    expect(gameView(id, BOB).history[0]?.theirReactionMs).toBe(200);
  });

  it('forgives a slow connection, from the server’s own measurement', () => {
    const id = startPlaying();
    vi.advanceTimersByTime(ARM_MS);
    const liveAt = Date.now();

    vi.advanceTimersByTime(300);
    sessions.submitAction(
      id,
      ALICE,
      { type: 'tap', round: 1 },
      { receivedAt: Date.now(), compensationMs: 120 },
    );

    expect(Date.now() - liveAt).toBe(300);
    expect(gameView(id, ALICE).current.yourReactionMs).toBe(180);
  });

  it('gives up on a round neither of them answers', () => {
    const id = startPlaying();
    vi.advanceTimersByTime(ARM_MS + TAP_TIMEOUT_MS);

    expect(typesFor(ALICE)).toContain(EVENTS.game.roundEnded);
    expect(gameView(id, ALICE).history[0]?.ending).toBe('nobody-tapped');
    expect(gameView(id, ALICE).yourRoundsWon).toBe(0);
  });
});

describe('finishing and rematching', () => {
  /** Alice takes three rounds, Bob two. */
  function playFullMatch(id: string): void {
    for (const [alice, bob] of [
      [200, 300],
      [200, 300],
      [200, 300],
      [400, 300],
      [400, 300],
    ] as const) {
      playRound(id, alice, bob);
    }
  }

  it('puts the session on a results screen the two of them agree on', () => {
    const id = startPlaying();
    playFullMatch(id);

    const mine = sessions.viewFor(id, ALICE);
    const theirs = sessions.viewFor(id, BOB);

    expect(mine.phase).toBe('finished');
    expect(mine.result).toEqual({
      outcome: 'won',
      yourScore: 3,
      theirScore: 2,
      competitive: true,
      // Won on the board, which is the only kind of win worth printing a scoreline for.
      byForfeit: false,
    });
    expect(theirs.result).toEqual({
      outcome: 'lost',
      yourScore: 2,
      theirScore: 3,
      competitive: true,
      byForfeit: false,
    });
    expect(typesFor(ALICE)).toContain(EVENTS.game.finished);
    expect(typesFor(ALICE)).toContain(EVENTS.results.matchResult);
  });

  it('keeps the session alive, and both of them unready', () => {
    const id = startPlaying();
    playFullMatch(id);

    expect(sessions.sessionIdForUser(ALICE)).toBe(id);
    expect(sessions.viewFor(id, ALICE).you.ready).toBe(false);
    expect(sessions.viewFor(id, ALICE).partner.ready).toBe(false);
    // The finished game stays on screen, so the round-by-round is still there afterwards.
    expect(sessions.viewFor(id, ALICE).game?.state).toMatchObject({ complete: true });
  });

  it('needs both of them to want another go', () => {
    const id = startPlaying();
    playFullMatch(id);

    sessions.setReady(id, ALICE, true);
    expect(sessions.viewFor(id, ALICE).phase).toBe('finished');

    sessions.setReady(id, BOB, true);
    expect(sessions.viewFor(id, ALICE).phase).toBe('countdown');
  });

  it('starts a clean match, and clears the last one’s result', () => {
    const id = startPlaying();
    playFullMatch(id);

    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);

    const view = sessions.viewFor(id, ALICE);
    expect(view.phase).toBe('active');
    expect(view.result).toBeNull();
    expect(gameView(id, ALICE).roundNumber).toBe(1);
    expect(gameView(id, ALICE).yourRoundsWon).toBe(0);
    expect(gameView(id, ALICE).history).toHaveLength(0);
  });

  it('returns to the results screen if a rematch countdown is called off', () => {
    const id = startPlaying();
    playFullMatch(id);

    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    sessions.setReady(id, BOB, false);

    // Back to the results, not to an empty lobby that has forgotten the game they just played.
    expect(sessions.viewFor(id, ALICE).phase).toBe('finished');
    expect(sessions.viewFor(id, ALICE).result).not.toBeNull();
  });

  it('plays every round, and never a sixth', () => {
    const id = startPlaying();
    playFullMatch(id);

    expect(gameView(id, ALICE).history).toHaveLength(ROUNDS);
    vi.advanceTimersByTime(60_000);
    expect(gameView(id, ALICE).history).toHaveLength(ROUNDS);
  });
});

describe('leaving on purpose', () => {
  it('ends the game for both from the lobby, and says who did it', () => {
    const id = startSession();
    sessions.leave(id, ALICE);

    const ended = sent.filter((event) => event.type === EVENTS.lobby.ended);
    expect(ended.map((event) => event.userId).sort()).toEqual([ALICE, BOB].sort());
    expect(ended[0]?.payload).toMatchObject({ reason: 'left', byUserId: ALICE });
  });

  it('frees the couple to start something else straight away', () => {
    const id = startSession();
    sessions.leave(id, BOB);

    expect(sessions.sessionIdForUser(ALICE)).toBeNull();
    expect(() => startSession()).not.toThrow();
  });

  it('is not something an outsider can do', () => {
    const id = startSession();
    expect(() => sessions.leave(id, 'dddddddd-dddd-dddd-dddd-dddddddddddd')).toThrow(
      expect.objectContaining({ code: 'not_authorized' }),
    );
    expect(sessions.sessionIdForUser(ALICE)).toBe(id);
  });

  it('closes a finished match without asking anybody', () => {
    const id = startPlaying();
    for (let round = 0; round < ROUNDS; round += 1) playRound(id, 200, 300);

    // The result already stands, so there is nothing left to protect.
    expect(sessions.viewFor(id, ALICE).phase).toBe('finished');
    expect(() => sessions.leave(id, ALICE)).not.toThrow();
    expect(sessions.size).toBe(0);
  });

  it('refuses to walk out of a live match while the other one is still there', () => {
    const id = startPlaying();

    // The whole point of the forfeit rule: if leaving were free, nobody would ever forfeit.
    expect(() => sessions.leave(id, ALICE)).toThrow(
      expect.objectContaining({ code: 'invalid_action' }),
    );
    expect(sessions.viewFor(id, BOB).phase).toBe('active');
  });

  it('lets somebody out of a match their partner has already walked away from', () => {
    const id = startPlaying();
    sessions.markAway(id, BOB);
    sent = [];

    // Giving up a forfeit they were two minutes from winning is entirely their right, and there is
    // nobody left to ask.
    sessions.leave(id, ALICE);
    expect(sessions.size).toBe(0);
    expect(sent.find((event) => event.type === EVENTS.lobby.ended)?.payload).toMatchObject({
      reason: 'left',
      byUserId: ALICE,
    });
  });
});

describe('asking to stop', () => {
  it('puts it to the other one rather than just ending it', () => {
    const id = startPlaying();
    sessions.requestLeave(id, ALICE);

    expect(typesFor(BOB)).toContain(EVENTS.lobby.leaveRequested);
    expect(sessions.viewFor(id, BOB).leaveRequest).toEqual({
      byUserId: ALICE,
      expiresAt: Date.now() + LEAVE_REQUEST_TTL_MS,
    });
    // Still running until they agree.
    expect(sessions.viewFor(id, BOB).phase).toBe('active');
  });

  it('closes with no result once they agree', () => {
    const id = startPlaying();
    sessions.requestLeave(id, ALICE);
    sent = [];
    sessions.respondToLeave(id, BOB, true);

    const ended = sent.find((event) => event.type === EVENTS.lobby.ended);
    expect(ended?.payload).toMatchObject({ reason: 'left', byUserId: ALICE });
    // Agreed, so nobody lost: no result at all, and it counts towards nothing (P-8).
    expect(sent.some((event) => event.type === EVENTS.results.matchResult)).toBe(false);
    expect(sessions.size).toBe(0);
  });

  it('carries on when they say no', () => {
    const id = startPlaying();
    sessions.requestLeave(id, ALICE);
    sessions.respondToLeave(id, BOB, false);

    expect(typesFor(ALICE)).toContain(EVENTS.lobby.leaveResolved);
    expect(sessions.viewFor(id, ALICE).phase).toBe('active');
    expect(sessions.viewFor(id, ALICE).leaveRequest).toBeNull();
  });

  it('lapses after 30 seconds, changing nothing', () => {
    const id = startPlaying();
    sessions.requestLeave(id, ALICE);
    sent = [];
    vi.advanceTimersByTime(LEAVE_REQUEST_TTL_MS);

    const resolved = sent.find((event) => event.type === EVENTS.lobby.leaveResolved);
    expect(resolved?.payload).toMatchObject({ outcome: 'expired' });
    // Ignoring a request must never be how somebody loses a match they were winning.
    expect(sessions.viewFor(id, ALICE).phase).toBe('active');
    expect(sessions.viewFor(id, ALICE).leaveRequest).toBeNull();
  });

  it('cannot be accepted by the person who asked', () => {
    const id = startPlaying();
    sessions.requestLeave(id, ALICE);

    // `invalid_action` and deliberately not `not_authorized`: they belong in this session, they
    // just cannot agree with themselves. The client closes a game outright on `not_authorized`, and
    // this is nowhere near grounds for that.
    expect(() => sessions.respondToLeave(id, ALICE, true)).toThrow(
      expect.objectContaining({ code: 'invalid_action' }),
    );
    expect(sessions.viewFor(id, BOB).leaveRequest).not.toBeNull();
  });

  it('can be withdrawn by the person who asked', () => {
    const id = startPlaying();
    sessions.requestLeave(id, ALICE);
    sessions.respondToLeave(id, ALICE, false);

    expect(sessions.viewFor(id, BOB).leaveRequest).toBeNull();
    expect(sessions.viewFor(id, BOB).phase).toBe('active');
  });

  it('allows only one at a time', () => {
    const id = startPlaying();
    sessions.requestLeave(id, ALICE);

    expect(() => sessions.requestLeave(id, BOB)).toThrow(
      expect.objectContaining({ code: 'invalid_action' }),
    );
  });

  it('is not something an outsider can ask or answer', () => {
    const id = startPlaying();
    const stranger = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

    expect(() => sessions.requestLeave(id, stranger)).toThrow(
      expect.objectContaining({ code: 'not_authorized' }),
    );
    sessions.requestLeave(id, ALICE);
    expect(() => sessions.respondToLeave(id, stranger, true)).toThrow(
      expect.objectContaining({ code: 'not_authorized' }),
    );
    expect(sessions.size).toBe(1);
  });

  it('is dropped when the person who asked walks out anyway', () => {
    const id = startPlaying();
    sessions.requestLeave(id, ALICE);
    sent = [];
    sessions.markAway(id, ALICE);

    expect(sessions.viewFor(id, BOB).leaveRequest).toBeNull();
    expect(sent.find((event) => event.type === EVENTS.lobby.leaveResolved)?.payload).toMatchObject({
      outcome: 'withdrawn',
    });
    // And the clock is now running on them.
    expect(sessions.viewFor(id, BOB).partner.awayUntil).not.toBeNull();
  });
});

describe('navigating away from the game', () => {
  it('starts the clock even though the socket is still open', () => {
    const id = startPlaying();
    sent = [];

    // Routing to the dashboard. Presence is socket **and** page, so this is as much of a walkout as
    // closing the tab — and without it, it would be completely invisible.
    sessions.markAway(id, BOB);

    expect(typesFor(ALICE)).toContain(EVENTS.presence.reconnectWindowStarted);
    expect(sessions.viewFor(id, ALICE).partner.awayUntil).toBe(Date.now() + RECONNECT_WINDOW_MS);
    // Both are told, because one of them is about to lose and deserves to know it is them.
    expect(sessions.viewFor(id, BOB).you.awayUntil).toBe(Date.now() + RECONNECT_WINDOW_MS);
    expect(sessions.viewFor(id, BOB).partner.awayUntil).toBeNull();
    expect(sessions.viewFor(id, ALICE).partner.present).toBe(false);
    // Still signed in, just not at the table.
    expect(sessions.viewFor(id, ALICE).partner.online).toBe(true);
  });

  it('stops the clock when they come back to the page', () => {
    const id = startPlaying();
    sessions.markAway(id, BOB);
    vi.advanceTimersByTime(60_000);
    sessions.join(id, BOB);

    expect(awayDeadline(sessions.viewFor(id, ALICE))).toBeNull();
    expect(sessions.viewFor(id, ALICE).partner.present).toBe(true);

    // The window must not fire behind them. (The match itself plays on and may well finish inside
    // two minutes of ticking — what matters is that it was never forfeited.)
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
    expect(sessions.viewFor(id, ALICE).result?.byForfeit ?? false).toBe(false);
  });

  it('forfeits if they never come back', () => {
    const id = startPlaying();
    sessions.markAway(id, BOB);
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);

    expect(sessions.viewFor(id, ALICE).result).toMatchObject({
      outcome: 'won',
      byForfeit: true,
    });
  });

  it('holds the game open for both of them when both wander off', () => {
    const id = startPlaying();
    sessions.markAway(id, BOB);
    sent = [];
    sessions.markAway(id, ALICE);

    // Nothing is decided yet. Both are on their own clock, and either of them can still come back
    // and claim it — which is the point: the person who left first has not lost anything until the
    // moment the last clock runs out.
    expect(sessions.size).toBe(1);
    expect(sent.some((event) => event.type === EVENTS.lobby.ended)).toBe(false);
    expect(sessions.viewFor(id, ALICE).you.awayUntil).not.toBeNull();
    expect(sessions.viewFor(id, ALICE).partner.awayUntil).not.toBeNull();
  });

  it('gives it to whoever comes back, because they are the last one in the room', () => {
    const id = startPlaying();
    sessions.markAway(id, BOB);
    vi.advanceTimersByTime(30_000);
    sessions.markAway(id, ALICE);

    // BOB left first and comes back first. ALICE is on a later clock and never returns, so the
    // resolution waits for hers — and finds only him here.
    vi.advanceTimersByTime(30_000);
    sessions.join(id, BOB);
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);

    expect(sessions.viewFor(id, BOB).result).toMatchObject({ outcome: 'won', byForfeit: true });
  });

  it('gives it to nobody when neither of them comes back', () => {
    const id = startPlaying();
    sessions.markAway(id, BOB);
    sessions.markAway(id, ALICE);
    sent = [];
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);

    // Nobody was there to win it. Counts towards nothing (P-8), and the couple is free to start
    // something else immediately (ADR-009).
    const ended = sent.find((event) => event.type === EVENTS.lobby.ended);
    expect(ended?.payload).toMatchObject({ reason: 'abandoned' });
    expect(sent.some((event) => event.type === EVENTS.results.matchResult)).toBe(false);
    expect(sessions.size).toBe(0);
  });

  it('waits for the later clock, not the first one to run out', () => {
    const id = startPlaying();
    sessions.markAway(id, BOB);
    vi.advanceTimersByTime(60_000);
    sessions.markAway(id, ALICE);

    // BOB's own two minutes are up, but ALICE still has a minute of hers. Deciding here would end
    // the match while somebody could still come back and take it.
    vi.advanceTimersByTime(60_000);
    expect(sessions.size).toBe(1);
    expect(sessions.viewFor(id, ALICE).phase).toBe('active');

    vi.advanceTimersByTime(60_000);
    expect(sessions.size).toBe(0);
  });

  it('is not a forfeit before the match has started', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.markAway(id, ALICE);

    // Nothing to forfeit in a lobby, and their ready goes with them so no countdown fires at a
    // player who is not there to see it.
    expect(sessions.viewFor(id, BOB).phase).toBe('lobby');
    expect(sessions.viewFor(id, BOB).partner.ready).toBe(false);

    // The clock runs — a lobby nobody is in has to clean itself up — but running it out with
    // somebody still sitting there costs that person nothing at all.
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
    expect(sessions.viewFor(id, BOB).result).toBeNull();
    expect(sessions.viewFor(id, BOB).phase).toBe('lobby');
    expect(awayDeadline(sessions.viewFor(id, BOB))).toBeNull();
  });

  it('does not start a match for somebody who is not looking at it', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.markAway(id, BOB);
    sessions.setReady(id, BOB, true);

    expect(sessions.viewFor(id, ALICE).phase).toBe('lobby');
  });
});

describe('a game interrupted', () => {
  it('stops the clock rather than scoring rounds nobody could see', () => {
    const id = startPlaying();
    vi.advanceTimersByTime(ARM_MS);

    online.delete(BOB);
    sessions.handlePresence(BOB, false);

    // Two whole rounds' worth of time passes with nobody there to play them.
    vi.advanceTimersByTime((TAP_TIMEOUT_MS + BREATHER_MS + ARM_MS) * 2);

    expect(gameView(id, ALICE).history).toHaveLength(0);
    expect(gameView(id, ALICE).yourRoundsWon).toBe(0);
    expect(gameView(id, ALICE).paused).toBe(true);
  });

  it('picks up with a fresh round when they make it back', () => {
    const id = startPlaying();
    playRound(id, 200, 300);
    vi.advanceTimersByTime(ARM_MS);

    online.delete(BOB);
    sessions.handlePresence(BOB, false);
    vi.advanceTimersByTime(30_000);
    online.add(BOB);
    sessions.handlePresence(BOB, true);
    // The socket is back; being at the table is a separate claim, and the client makes it by
    // re-joining the moment it reconnects.
    sessions.join(id, BOB);

    const resumed = gameView(id, ALICE);
    expect(resumed.paused).toBe(false);
    // The round that was in flight is replayed; the one already decided is not.
    expect(resumed.roundNumber).toBe(2);
    expect(resumed.yourRoundsWon).toBe(1);
    expect(awayDeadline(sessions.viewFor(id, ALICE))).toBeNull();

    vi.advanceTimersByTime(ARM_MS);
    expect(gameView(id, ALICE).current.phase).toBe('live');
  });

  it('forfeits the match when the window runs out', () => {
    const id = startPlaying();
    online.delete(BOB);
    sessions.handlePresence(BOB, false);
    sent = [];
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);

    // A closed tab and a walk to the dashboard are the same event, and after two minutes both are
    // a forfeit rather than a shrug.
    expect(sent.some((event) => event.type === EVENTS.results.matchResult)).toBe(true);
    expect(sessions.viewFor(id, ALICE).result).toMatchObject({
      outcome: 'won',
      byForfeit: true,
    });
  });

  it('lets go of a lobby both of them have walked away from', () => {
    const id = startSession();

    online.delete(ALICE);
    sessions.handlePresence(ALICE, false);
    expect(sessions.sessionIdForUser(BOB)).toBe(id);

    online.delete(BOB);
    sessions.handlePresence(BOB, false);

    // Held, not dropped: either of them can still come back to it, and the one who blinked out
    // first has done nothing wrong. This is what stops the first person to open a lobby from
    // destroying it with a refresh before the second one has even loaded the page.
    expect(sessions.size).toBe(1);

    // But it does not outlive them. Nobody is left to hold it open, and a session nobody is in
    // must not block the next invitation (ADR-009).
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
    expect(sessions.sessionIdForUser(BOB)).toBeNull();
    expect(sessions.size).toBe(0);
  });

  it('survives the first player to arrive refreshing before the second one gets there', () => {
    // The bug this is here for: a session is created the moment an invitation is accepted, and
    // both of them navigate to it separately. Whoever loads it first used to be able to end it for
    // both — a refresh, a phone waking up, a development-mode double mount — because their partner
    // was "not present" for the perfectly ordinary reason that they were still on the games list.
    const view = sessions.create({
      coupleId: COUPLE,
      gameSlug: 'reaction-speed',
      gameName: 'Reaction Speed',
      players: [
        { userId: ALICE, nickname: 'Ali', avatarKey: 'fox', gender: 'female' },
        { userId: BOB, nickname: 'Bo', avatarKey: 'penguin', gender: 'male' },
      ],
    });

    sessions.join(view.id, ALICE);
    sessions.markAway(view.id, ALICE);
    sessions.join(view.id, ALICE);

    expect(sessions.size).toBe(1);
    // And BOB, arriving late, finds a game rather than a `session_not_found`.
    expect(() => sessions.join(view.id, BOB)).not.toThrow();
    expect(sessions.viewFor(view.id, BOB).phase).toBe('lobby');
  });

  it('gives up on a session neither of them ever opens', () => {
    sessions.create({
      coupleId: COUPLE,
      gameSlug: 'reaction-speed',
      gameName: 'Reaction Speed',
      players: [
        { userId: ALICE, nickname: 'Ali', avatarKey: 'fox', gender: 'female' },
        { userId: BOB, nickname: 'Bo', avatarKey: 'penguin', gender: 'male' },
      ],
    });

    // An accepted invitation neither of them acts on. Left alone it would hold the couple's one
    // session slot for the life of the process.
    expect(sessions.size).toBe(1);
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
    expect(sessions.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// A second game, through the same platform
// ---------------------------------------------------------------------------------------------

/**
 * The point of these is what they do **not** contain: not one line of the session registry, the
 * match runner or the socket layer changed to make Four in a Row work. A game with no clock, no
 * secrets and a board that must survive a disconnect intact runs through exactly the machinery
 * built around a game that was none of those things.
 */

const boardView = (id: string, userId: string): FourInARowView =>
  sessions.viewFor(id, userId).game?.state as FourInARowView;

/** Takes a Four in a Row session from nothing to a live board. */
function startBoard(): string {
  const id = sessions.create({
    coupleId: COUPLE,
    gameSlug: 'four-in-a-row',
    gameName: 'Four in a Row',
    players: [
      { userId: ALICE, nickname: 'Ali', avatarKey: 'fox', gender: 'female' },
      { userId: BOB, nickname: 'Bo', avatarKey: 'penguin', gender: 'male' },
    ],
  }).id;

  sessions.join(id, ALICE);
  sessions.join(id, BOB);
  sessions.setReady(id, ALICE, true);
  sessions.setReady(id, BOB, true);
  vi.advanceTimersByTime(COUNTDOWN_MS);
  sent = [];
  return id;
}

/** Whoever the coin-flip is currently pointing at. */
const toMove = (id: string): string => (boardView(id, ALICE).yourTurn ? ALICE : BOB);

function dropDisc(id: string, userId: string, column: number): void {
  sessions.submitAction(id, userId, { type: 'drop', column }, {
    receivedAt: Date.now(),
    compensationMs: 0,
  });
}

/** Plays the columns in order, always by the player whose turn it is. */
function playColumns(id: string, columns: number[]): void {
  for (const column of columns) dropDisc(id, toMove(id), column);
}

/** The player who goes first takes the bottom row while the other stacks a column. */
const FIRST_PLAYER_WINS = [0, 6, 1, 6, 2, 6, 3];

describe('a second game, on the same platform', () => {
  it('starts a board with nobody having moved, and asks the clock for nothing itself', () => {
    const id = startBoard();

    expect(sessions.viewFor(id, ALICE).phase).toBe('active');
    expect(sessions.viewFor(id, ALICE).game?.slug).toBe('four-in-a-row');
    expect(boardView(id, ALICE).discsPlaced).toBe(0);

    // Reaction Speed leaves a timer running at every moment of a match. This game asks for none:
    // the single timer standing is the platform's own move clock, which every game gets whether it
    // wants anything from the clock or not.
    expect(vi.getTimerCount()).toBe(1);
    expect(sessions.viewFor(id, ALICE).turnDeadline).toBe(Date.now() + MOVE_WINDOW_MS);
  });

  it('gives whoever is to move two minutes, and starts them over on every move', () => {
    const id = startBoard();
    const first = toMove(id);

    expect(sessions.viewFor(id, first).turnUserId).toBe(first);
    expect(sessions.viewFor(id, first).turnDeadline).toBe(Date.now() + MOVE_WINDOW_MS);

    vi.advanceTimersByTime(90_000);
    dropDisc(id, first, 0);

    // The clock changes hands with the turn, and the person who now has to move gets all of it —
    // not what was left of their partner's.
    const second = first === ALICE ? BOB : ALICE;
    expect(sessions.viewFor(id, first).turnUserId).toBe(second);
    expect(sessions.viewFor(id, first).turnDeadline).toBe(Date.now() + MOVE_WINDOW_MS);
  });

  it('loses the match for whoever sits on their move, connected the whole time', () => {
    const id = startBoard();
    const stalling = toMove(id);
    const waiting = stalling === ALICE ? BOB : ALICE;

    // Nobody has disconnected and nobody has navigated anywhere. From the other side of the board
    // that is no different from a partner who dropped off, and it is waited on the same way.
    vi.advanceTimersByTime(MOVE_WINDOW_MS);

    expect(sessions.viewFor(id, waiting).result).toMatchObject({ outcome: 'won', byForfeit: true });
    expect(sessions.viewFor(id, stalling).result).toMatchObject({ outcome: 'lost' });
  });

  it('does not run a move clock while somebody is away, because no move is allowed', () => {
    const id = startBoard();
    sessions.markAway(id, toMove(id));

    // Their partner is refused every action in this state, so putting them under a clock would be
    // timing them out for obeying the rules.
    expect(sessions.viewFor(id, ALICE).turnUserId).toBeNull();
    expect(sessions.viewFor(id, ALICE).turnDeadline).toBeNull();
  });

  it('leaves a reaction test off the move clock entirely', () => {
    // Both players are waiting on the same stimulus rather than on each other, so there is no move
    // to be late with and nobody to blame for one.
    const id = startPlaying();

    expect(sessions.viewFor(id, ALICE).turnUserId).toBeNull();
    expect(sessions.viewFor(id, ALICE).turnDeadline).toBeNull();
  });

  it('gives exactly one of them the first move', () => {
    const id = startBoard();
    const alice = boardView(id, ALICE);
    const bob = boardView(id, BOB);

    expect(alice.yourTurn).toBe(!bob.yourTurn);
    expect(alice.youStarted).toBe(!bob.youStarted);
  });

  it('refuses a move from the player whose turn it is not', () => {
    const id = startBoard();
    const waiting = toMove(id) === ALICE ? BOB : ALICE;

    expect(() => dropDisc(id, waiting, 3)).toThrow(SessionError);
    expect(boardView(id, ALICE).discsPlaced).toBe(0);
  });

  it('refuses an outsider who knows the session id', () => {
    const id = startBoard();
    expect(() => dropDisc(id, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 3)).toThrow(SessionError);
    expect(boardView(id, ALICE).discsPlaced).toBe(0);
  });

  it('shows both of them the same board from their own side', () => {
    const id = startBoard();
    const first = toMove(id);
    dropDisc(id, first, 4);

    const mover = boardView(id, first);
    const other = boardView(id, first === ALICE ? BOB : ALICE);

    expect(mover.board[0]?.[4]).toBe('you');
    expect(other.board[0]?.[4]).toBe('them');
    // Nothing here is secret, so one frame goes to both of them rather than one each.
    expect(typesFor(ALICE)).toContain(EVENTS.game.stateUpdated);
    expect(typesFor(BOB)).toContain(EVENTS.game.stateUpdated);
  });

  it('keeps the board while a player is missing, rather than restarting it', () => {
    const id = startBoard();
    playColumns(id, [3, 3, 4]);

    online.delete(BOB);
    sessions.handlePresence(BOB, false);
    vi.advanceTimersByTime(60_000);

    // A turn-based board must survive a dropped connection: this game sets `pauseOnDisconnect`
    // false precisely so the platform leaves its state alone.
    expect(boardView(id, ALICE).discsPlaced).toBe(3);
    // And the absent player cannot be played around while they are gone.
    expect(() => dropDisc(id, ALICE, 5)).toThrow(SessionError);

    online.add(BOB);
    sessions.handlePresence(BOB, true);
    sessions.join(id, BOB);

    const restored = boardView(id, BOB);
    expect(restored.discsPlaced).toBe(3);
    expect(restored.board[0]?.[3]).toBe('you');
    expect(awayDeadline(sessions.viewFor(id, BOB))).toBeNull();
  });

  it('plays a whole match out and mirrors the result', () => {
    const id = startBoard();
    const winner = toMove(id);
    const loser = winner === ALICE ? BOB : ALICE;

    playColumns(id, FIRST_PLAYER_WINS);

    expect(sessions.viewFor(id, winner).phase).toBe('finished');
    expect(sessions.viewFor(id, winner).result).toEqual({
      outcome: 'won',
      yourScore: 1,
      theirScore: 0,
      competitive: true,
      byForfeit: false,
    });
    expect(sessions.viewFor(id, loser).result).toEqual({
      outcome: 'lost',
      yourScore: 0,
      theirScore: 1,
      competitive: true,
      byForfeit: false,
    });

    expect(typesFor(winner)).toEqual(
      expect.arrayContaining([EVENTS.game.finished, EVENTS.results.matchResult]),
    );
    // The finished board stays on screen with its winning line, for the same reason Reaction
    // Speed's round-by-round does.
    expect(boardView(id, winner).winningLine).toHaveLength(4);
  });

  it('starts a clean board when both of them want another go', () => {
    const id = startBoard();
    playColumns(id, FIRST_PLAYER_WINS);

    expect(sessions.viewFor(id, ALICE).you.ready).toBe(false);
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);

    const rematch = sessions.viewFor(id, ALICE);
    expect(rematch.phase).toBe('active');
    expect(rematch.result).toBeNull();
    expect(boardView(id, ALICE).discsPlaced).toBe(0);
    expect(boardView(id, ALICE).complete).toBe(false);
  });
});
