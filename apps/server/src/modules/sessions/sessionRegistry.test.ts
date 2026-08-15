import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARM_MAX_MS,
  ARM_MIN_MS,
  BREATHER_MS,
  ROUNDS,
  TAP_TIMEOUT_MS,
  type ReactionSpeedView,
} from '@rasmalai/games';
import { COUNTDOWN_MS, EVENTS, RECONNECT_WINDOW_MS, type SessionView } from '@rasmalai/shared';
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
  sent = [];
  return view.id;
}

/** Halfway through the arming window, so every round in these tests goes live at a known moment. */
const ARM_MS = ARM_MIN_MS + 0.5 * (ARM_MAX_MS - ARM_MIN_MS);

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
    expect(view.reconnectDeadline).toBeNull();
    expect(typesFor(BOB)).toContain(EVENTS.presence.playerDisconnected);
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
    expect(view.reconnectDeadline).toBe(Date.now() + RECONNECT_WINDOW_MS);
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

    expect(typesFor(BOB)).toContain(EVENTS.presence.playerReconnected);
    expect(sessions.viewFor(id, BOB).reconnectDeadline).toBeNull();

    // And the window must not fire after they are back.
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
    expect(typesFor(BOB)).not.toContain(EVENTS.presence.reconnectWindowExpired);
  });

  it('abandons the session when the window runs out', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);

    online.delete(ALICE);
    sessions.handlePresence(ALICE, false);
    sent = [];
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);

    expect(typesFor(BOB)).toContain(EVENTS.presence.reconnectWindowExpired);
    expect(typesFor(BOB)).toContain(EVENTS.lobby.ended);
    // Forgotten, so the couple can start something new straight away.
    expect(sessions.sessionIdForUser(BOB)).toBeNull();
    expect(sessions.size).toBe(0);
  });

  it('frees the couple to start again after an abandoned session', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);
    online.delete(ALICE);
    sessions.handlePresence(ALICE, false);
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);

    expect(() => startSession()).not.toThrow();
  });

  it('a second device going offline is not a disconnect, because presence is per person', () => {
    const id = startSession();
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    vi.advanceTimersByTime(COUNTDOWN_MS);
    sent = [];

    // ALICE closed one tab but is still online elsewhere, so the socket layer reports online.
    sessions.handlePresence(ALICE, true);

    expect(sessions.viewFor(id, BOB).reconnectDeadline).toBeNull();
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
    expect(mine.result).toEqual({ outcome: 'won', yourScore: 3, theirScore: 2, competitive: true });
    expect(theirs.result).toEqual({
      outcome: 'lost',
      yourScore: 2,
      theirScore: 3,
      competitive: true,
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
  it('ends the game for both, and says who did it', () => {
    const id = startPlaying();
    sessions.leave(id, ALICE);

    const ended = sent.filter((event) => event.type === EVENTS.lobby.ended);
    expect(ended.map((event) => event.userId).sort()).toEqual([ALICE, BOB].sort());
    expect(ended[0]?.payload).toMatchObject({ reason: 'left', byUserId: ALICE });
  });

  it('frees the couple to start something else straight away', () => {
    const id = startPlaying();
    sessions.leave(id, BOB);

    expect(sessions.sessionIdForUser(ALICE)).toBeNull();
    expect(() => startSession()).not.toThrow();
  });

  it('is not something an outsider can do', () => {
    const id = startPlaying();
    expect(() => sessions.leave(id, 'dddddddd-dddd-dddd-dddd-dddddddddddd')).toThrow(
      expect.objectContaining({ code: 'not_authorized' }),
    );
    expect(sessions.sessionIdForUser(ALICE)).toBe(id);
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

    const resumed = gameView(id, ALICE);
    expect(resumed.paused).toBe(false);
    // The round that was in flight is replayed; the one already decided is not.
    expect(resumed.roundNumber).toBe(2);
    expect(resumed.yourRoundsWon).toBe(1);
    expect(sessions.viewFor(id, ALICE).reconnectDeadline).toBeNull();

    vi.advanceTimersByTime(ARM_MS);
    expect(gameView(id, ALICE).current.phase).toBe('live');
  });

  it('drops the match when the window runs out', () => {
    startPlaying();
    online.delete(BOB);
    sessions.handlePresence(BOB, false);
    sent = [];
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);

    const ended = sent.find((event) => event.type === EVENTS.lobby.ended);
    expect(ended?.payload).toMatchObject({ reason: 'abandoned' });
    expect(sessions.sessionIdForUser(ALICE)).toBeNull();
  });

  it('lets go of a lobby both of them have walked away from', () => {
    const id = startSession();

    online.delete(ALICE);
    sessions.handlePresence(ALICE, false);
    expect(sessions.sessionIdForUser(BOB)).toBe(id);

    online.delete(BOB);
    sessions.handlePresence(BOB, false);

    // Nobody is left to hold it open, and a session nobody is in must not block the next invitation.
    expect(sessions.sessionIdForUser(BOB)).toBeNull();
    expect(sessions.size).toBe(0);
  });
});
