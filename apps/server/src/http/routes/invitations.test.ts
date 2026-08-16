import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EVENTS } from '@rasmalai/shared';
import { InvitationError } from '../../modules/invitations/invitationsRepository';
import {
  createSessionRegistry,
  type SessionRegistry,
} from '../../modules/sessions/sessionRegistry';
import { createApp } from '../app';
import {
  OTHER_USER_ID,
  TEST_INVITATION_ID,
  TEST_USER_ID,
  createInMemoryUsersRepository,
  createRecordingNotifier,
  createStubDashboardRepository,
  createStubInvitationsRepository,
  createStubPairingRepository,
  createTestPresence,
  stubVerifier,
  testInvitationView,
} from '../testing';

let server: Server;
let baseUrl: string;
let invitations: ReturnType<typeof createStubInvitationsRepository>;
let realtime: ReturnType<typeof createRecordingNotifier>;
let sessions: SessionRegistry;
let users: ReturnType<typeof createInMemoryUsersRepository>;
/** Who is online. A test that wants a partner out of reach flips this before it acts. */
let online: Set<string>;

/** The shape every refused action comes back as. */
interface ApiError {
  error: { code: string; reason?: string; message: string };
}

const PROFILE = {
  actualName: 'Divyank',
  nickname: 'Div',
  birthYear: 1996,
  avatarKey: 'fox',
  gender: 'female',
  partnerLabelName: 'Anshuman',
  partnerLabelNickname: 'Anshu',
  firstMetDate: '2021-03-14',
  locationType: 'different_city',
} as const;

function request(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  return fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
  });
}

const invite = (gameSlug = 'reaction-speed', token = 'valid') =>
  request('/api/invitations', { method: 'POST', token, body: JSON.stringify({ gameSlug }) });

const respond = (body: unknown, token = 'valid-other') =>
  request(`/api/invitations/${TEST_INVITATION_ID}/respond`, {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  invitations = createStubInvitationsRepository();
  realtime = createRecordingNotifier();
  users = createInMemoryUsersRepository();
  online = new Set([TEST_USER_ID, OTHER_USER_ID]);
  const presence = createTestPresence((userId) => online.has(userId));
  sessions = createSessionRegistry(realtime, presence);

  await users.create(TEST_USER_ID, { ...PROFILE }, 'AAAA1111');
  await users.create(
    OTHER_USER_ID,
    { ...PROFILE, nickname: 'Ansh', gender: 'male', avatarKey: 'penguin' },
    'BBBB2222',
  );

  server = createApp({
    appOrigin: 'http://localhost:3000',
    verifier: stubVerifier,
    users,
    pairing: createStubPairingRepository(),
    dashboard: createStubDashboardRepository(),
    invitations,
    sessions,
    realtime,
    presence,
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('sending an invitation', () => {
  it('refuses anyone without a token', async () => {
    const response = await fetch(`${baseUrl}/api/invitations`, { method: 'POST' });
    expect(response.status).toBe(401);
  });

  it('creates one and tells both partners', async () => {
    const response = await invite();
    expect(response.status).toBe(201);

    // Both, not just the recipient: either may be signed in on a second device.
    expect(realtime.recipientsOf(EVENTS.invitation.created).sort()).toEqual(
      [TEST_USER_ID, OTHER_USER_ID].sort(),
    );
  });

  it('renders the invitation from each recipient’s own side', async () => {
    await invite();

    const events = realtime.sent.filter((event) => event.type === EVENTS.invitation.created);
    const sender = events.find((event) => event.userId === TEST_USER_ID);
    const recipient = events.find((event) => event.userId === OTHER_USER_ID);

    expect((sender?.payload as { invitation: { direction: string } }).invitation.direction).toBe(
      'outgoing',
    );
    expect((recipient?.payload as { invitation: { direction: string } }).invitation.direction).toBe(
      'incoming',
    );
  });

  it('rejects a request with no game', async () => {
    const response = await request('/api/invitations', {
      method: 'POST',
      token: 'valid',
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it('refuses while a game is already running (ADR-009)', async () => {
    sessions.create({
      coupleId: 'couple-1',
      gameSlug: 'reaction-speed',
      gameName: 'Reaction Speed',
      players: [
        { userId: TEST_USER_ID, nickname: 'Div', avatarKey: 'fox', gender: 'female' },
        { userId: OTHER_USER_ID, nickname: 'Ansh', avatarKey: 'penguin', gender: 'male' },
      ],
    });

    const response = await invite();
    expect(response.status).toBe(409);
    expect(((await response.json()) as ApiError).error.reason).toBe('already_in_game');
  });

  it('refuses when the partner is not signed in', async () => {
    online.delete(OTHER_USER_ID);

    // Otherwise this is five minutes of waiting for a sheet nobody will ever see, and it holds the
    // couple's one invitation slot the whole time (ADR-010).
    const response = await invite();
    expect(response.status).toBe(409);

    const body = (await response.json()) as ApiError;
    expect(body.error.reason).toBe('partner_offline');
    expect(body.error.message).toMatch(/offline/i);
  });

  it('refuses server-side, so a browser cannot simply not ask', async () => {
    online.delete(OTHER_USER_ID);
    await invite();

    // Nothing was written. A check the client makes for itself is a check that can be skipped, and
    // the invitation it would have created is a real row that has to expire on its own.
    expect(realtime.recipientsOf(EVENTS.invitation.created)).toEqual([]);
  });

  it('closes the invitation it displaces before announcing the new one', async () => {
    invitations.create = async (userId: string, gameSlug: string) => ({
      invitation: testInvitationView(userId, gameSlug),
      otherUserId: OTHER_USER_ID,
      invalidatedId: 'previous-invitation',
    });

    await invite();

    const order = realtime.sent.map((event) => event.type);
    expect(order.indexOf(EVENTS.invitation.invalidated)).toBeLessThan(
      order.indexOf(EVENTS.invitation.created),
    );
  });

  it('refuses a game that has no module yet', async () => {
    invitations.failWith(new InvitationError('game_not_playable', 'Not ready.'));
    const response = await invite('basketball');
    expect(response.status).toBe(409);
  });

  it('refuses someone who is not paired', async () => {
    invitations.failWith(new InvitationError('not_paired', 'Pair first.'));
    expect((await invite()).status).toBe(409);
  });
});

describe('answering an invitation', () => {
  it('opens a session on accept and points both at it', async () => {
    const response = await respond({ accept: true });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { accepted: boolean; sessionId: string };
    expect(body.accepted).toBe(true);
    expect(sessions.sessionIdForUser(TEST_USER_ID)).toBe(body.sessionId);
    expect(sessions.sessionIdForUser(OTHER_USER_ID)).toBe(body.sessionId);

    const accepted = realtime.sent.filter((event) => event.type === EVENTS.invitation.accepted);
    expect(accepted.map((event) => event.userId).sort()).toEqual(
      [TEST_USER_ID, OTHER_USER_ID].sort(),
    );
    // Both are given the same session, or they would land in different games.
    for (const event of accepted) {
      expect((event.payload as { sessionId: string }).sessionId).toBe(body.sessionId);
    }
  });

  it('puts both players in the lobby, each seeing themselves', async () => {
    const { sessionId } = (await (await respond({ accept: true })).json()) as {
      sessionId: string;
    };

    expect(sessions.viewFor(sessionId, TEST_USER_ID).you.nickname).toBe('Div');
    expect(sessions.viewFor(sessionId, TEST_USER_ID).partner.nickname).toBe('Ansh');
    expect(sessions.viewFor(sessionId, OTHER_USER_ID).you.nickname).toBe('Ansh');
    expect(sessions.viewFor(sessionId, TEST_USER_ID).phase).toBe('lobby');
  });

  it('tells both when it is declined, and opens no session', async () => {
    const response = await respond({ accept: false });
    expect(response.status).toBe(200);

    expect(realtime.recipientsOf(EVENTS.invitation.rejected).sort()).toEqual(
      [TEST_USER_ID, OTHER_USER_ID].sort(),
    );
    expect(sessions.sessionIdForUser(TEST_USER_ID)).toBeNull();
  });

  it('announces a counter-proposal as an invitation in its own right (P-7)', async () => {
    invitations.counterOnReject = true;

    const response = await respond({ accept: false, counterGameSlug: 'four-in-a-row' });
    const body = (await response.json()) as {
      counterInvitation: { gameSlug: string } | null;
    };

    expect(body.counterInvitation?.gameSlug).toBe('four-in-a-row');
    // The decline and the counter are separate events, so a client that only knows about one of
    // them still behaves correctly.
    expect(realtime.recipientsOf(EVENTS.invitation.rejected).length).toBe(2);
    expect(realtime.recipientsOf(EVENTS.invitation.created).length).toBe(2);
  });

  it('refuses to let the sender answer their own invitation', async () => {
    invitations.failWith(new InvitationError('cannot_answer_own', 'You sent this one.'));
    const response = await respond({ accept: true }, 'valid');
    expect(response.status).toBe(403);
  });

  it('reports an expired invitation as gone, not as a generic conflict', async () => {
    invitations.failWith(new InvitationError('invitation_expired', 'It ran out.'));
    const response = await respond({ accept: true });
    expect(response.status).toBe(410);
    expect(((await response.json()) as ApiError).error.reason).toBe('invitation_expired');
  });

  it('reports an already-answered invitation as a conflict', async () => {
    invitations.failWith(new InvitationError('invitation_not_pending', 'Already answered.'));
    expect((await respond({ accept: true })).status).toBe(409);
  });

  it('reports an unknown invitation as not found', async () => {
    invitations.failWith(new InvitationError('invitation_not_found', 'Gone.'));
    expect((await respond({ accept: true })).status).toBe(404);
  });

  it('rejects a body that says neither yes nor no', async () => {
    expect((await respond({})).status).toBe(400);
  });
});

describe('withdrawing an invitation', () => {
  it('clears it from both screens at once', async () => {
    const response = await request(`/api/invitations/${TEST_INVITATION_ID}/cancel`, {
      method: 'POST',
      token: 'valid',
      body: '{}',
    });

    expect(response.status).toBe(200);
    expect(realtime.recipientsOf(EVENTS.invitation.cancelled).sort()).toEqual(
      [TEST_USER_ID, OTHER_USER_ID].sort(),
    );
  });

  it('refuses to withdraw one that was already answered', async () => {
    invitations.failWith(new InvitationError('invitation_not_pending', 'Already answered.'));
    const response = await request(`/api/invitations/${TEST_INVITATION_ID}/cancel`, {
      method: 'POST',
      token: 'valid',
      body: '{}',
    });
    expect(response.status).toBe(409);
  });
});

describe('reading the current invitation', () => {
  it('reports nothing pending and no session for an idle couple', async () => {
    const body = await (await request('/api/invitations', { token: 'valid' })).json();
    expect(body).toEqual({ active: null, activeSessionId: null });
  });

  it('reports a live session, so a reload lands back in the game', async () => {
    const { sessionId } = (await (await respond({ accept: true })).json()) as { sessionId: string };

    const body = (await (await request('/api/invitations', { token: 'valid' })).json()) as {
      activeSessionId: string;
    };
    expect(body.activeSessionId).toBe(sessionId);
  });

  it('reports the pending invitation from the reader’s own side', async () => {
    invitations.active = testInvitationView(OTHER_USER_ID);

    const body = (await (await request('/api/invitations', { token: 'valid' })).json()) as {
      active: { direction: string };
    };
    expect(body.active.direction).toBe('incoming');
  });
});
