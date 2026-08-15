import type { InvitationView, RecentStats } from '@rasmalai/shared';
import type { TokenVerifier } from '../auth/tokenVerifier';
import type {
  CatalogueRow,
  CoupleScope,
  DashboardRepository,
  LifetimeTotals,
} from '../modules/dashboard/dashboardRepository';
import {
  PairingError,
  type CancelResult,
  type PairingRepository,
  type PairingRequestSummary,
  type PairingState,
  type RespondResult,
} from '../modules/pairing/pairingRepository';
import type { OnboardingInput } from '../modules/users/user.schema';
import {
  PairingCodeTakenError,
  ProfileExistsError,
  type UserProfile,
  type UsersRepository,
} from '../modules/users/usersRepository';
import type {
  CreatedInvitation,
  InvitationError,
  InvitationsRepository,
  RespondedInvitation,
} from '../modules/invitations/invitationsRepository';
import { createSessionRegistry, type SessionRegistry } from '../modules/sessions/sessionRegistry';
import type { RealtimeNotifier } from '../ws/notifier';

/**
 * Test doubles shared by the HTTP tests.
 *
 * Kept out of the test files themselves so every suite uses the same fakes, and out of production
 * paths because nothing imports this at runtime.
 */
export const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
export const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';

export const stubVerifier: TokenVerifier = {
  async verify(token: string) {
    if (token === 'valid') {
      return { userId: TEST_USER_ID, email: 'someone@example.com', expiresAt: Date.now() + 60_000 };
    }
    if (token === 'valid-other') {
      return { userId: OTHER_USER_ID, email: 'other@example.com', expiresAt: Date.now() + 60_000 };
    }
    throw new Error('invalid token');
  },
};

export function createInMemoryUsersRepository(): UsersRepository & {
  seedCodeCollisions(n: number): void;
} {
  const byId = new Map<string, UserProfile>();
  const usedCodes = new Set<string>();
  let forcedCollisions = 0;

  return {
    seedCodeCollisions(n: number) {
      forcedCollisions = n;
    },

    async findById(userId: string) {
      return byId.get(userId) ?? null;
    },

    async create(userId: string, input: OnboardingInput, pairingCode: string) {
      if (byId.has(userId)) throw new ProfileExistsError('profile already exists');

      if (forcedCollisions > 0) {
        forcedCollisions -= 1;
        throw new PairingCodeTakenError('pairing code already taken');
      }
      if (usedCodes.has(pairingCode)) throw new PairingCodeTakenError('pairing code already taken');

      usedCodes.add(pairingCode);
      const profile: UserProfile = {
        id: userId,
        actualName: input.actualName,
        nickname: input.nickname,
        birthYear: input.birthYear,
        avatarKey: input.avatarKey,
        gender: input.gender,
        partnerLabelName: input.partnerLabelName,
        partnerLabelNickname: input.partnerLabelNickname,
        firstMetDate: input.firstMetDate,
        locationType: input.locationType,
        pairingCode,
      };
      byId.set(userId, profile);
      return profile;
    },
  };
}

export interface SentEvent {
  userId: string;
  type: string;
  payload: unknown;
}

export function createRecordingNotifier(): RealtimeNotifier & {
  sent: SentEvent[];
  recipientsOf(type: string): string[];
} {
  const sent: SentEvent[] = [];
  const notifier = {
    sent,
    sendToUser(userId: string, type: string, payload: unknown) {
      sent.push({ userId, type, payload });
    },
    sendToUsers(userIds: readonly string[], type: string, payload: unknown) {
      for (const userId of new Set(userIds)) notifier.sendToUser(userId, type, payload);
    },
    recipientsOf(type: string) {
      return sent.filter((event) => event.type === type).map((event) => event.userId);
    },
  };
  return notifier;
}

const emptyState: PairingState = { couple: null, incoming: [], outgoing: [] };

/**
 * Stands in for the real pairing repository. The genuine transactional behaviour is covered
 * against Postgres; this exists so the routes can be tested for status codes and notifications
 * without a database.
 */
export function createStubPairingRepository(): PairingRepository & {
  failWith(error: PairingError | null): void;
  state: PairingState;
} {
  let failure: PairingError | null = null;
  const stub = {
    state: structuredClone(emptyState) as PairingState,

    failWith(error: PairingError | null) {
      failure = error;
    },

    async getState(): Promise<PairingState> {
      return stub.state;
    },

    async requestByCode(_requesterId: string, code: string): Promise<PairingRequestSummary> {
      if (failure) throw failure;
      if (code !== 'GOODCODE') {
        throw new PairingError('code_not_found', 'We could not find that code.');
      }
      return {
        id: 'request-1',
        status: 'pending',
        createdAt: new Date().toISOString(),
        otherUser: {
          id: OTHER_USER_ID,
          actualName: 'Other Person',
          nickname: 'Other',
          avatarKey: 'fox',
          gender: 'female',
        },
      };
    },

    async cancel(): Promise<CancelResult> {
      if (failure) throw failure;
      return { state: structuredClone(emptyState), otherUserId: OTHER_USER_ID };
    },

    async respond(_userId: string, _requestId: string, accept: boolean): Promise<RespondResult> {
      if (failure) throw failure;
      return {
        state: accept
          ? {
              couple: {
                id: 'couple-1',
                firstMetDate: '2021-03-14',
                locationType: 'different_city',
                partner: {
                  id: OTHER_USER_ID,
                  actualName: 'Other Person',
                  nickname: 'Other',
                  avatarKey: 'fox',
                  gender: 'female',
                },
              },
              incoming: [],
              outgoing: [],
            }
          : structuredClone(emptyState),
        otherUserId: OTHER_USER_ID,
        accepted: accept,
      };
    },
  };

  return stub;
}

/** The couple used by the dashboard tests. The viewer sits in slot A unless a test says otherwise. */
export const TEST_COUPLE_ID = '33333333-3333-3333-3333-333333333333';

const emptyLifetime: LifetimeTotals = {
  totalGames: 0,
  competitiveGames: 0,
  draws: 0,
  totalTimePlayedSeconds: 0,
  you: { wins: 0, currentStreak: 0, longestStreak: 0, tournamentWins: 0 },
  partner: { wins: 0, currentStreak: 0, longestStreak: 0, tournamentWins: 0 },
  closestMatch: null,
};

/**
 * Stands in for the dashboard reads.
 *
 * The zero values are the point: slice 5's whole exit condition is that a couple who has never
 * finished a match sees a correct dashboard rather than blanks, NaNs or a crash.
 */
export function createStubDashboardRepository(): DashboardRepository & {
  scope: CoupleScope | null;
  catalogueRows: CatalogueRow[];
  lifetimeTotals: LifetimeTotals;
  recent: RecentStats;
} {
  const stub = {
    scope: { coupleId: TEST_COUPLE_ID, viewerIsUserA: true } as CoupleScope | null,
    catalogueRows: [] as CatalogueRow[],
    lifetimeTotals: structuredClone(emptyLifetime),
    recent: { gamesPlayed: 0, youWon: 0, partnerWon: 0, draws: 0 } as RecentStats,

    async findCoupleScope() {
      return stub.scope;
    },
    async catalogue() {
      return stub.catalogueRows;
    },
    async lifetime() {
      return stub.lifetimeTotals;
    },
    async lastSevenDays() {
      return stub.recent;
    },
  };

  return stub;
}

/** A catalogue row with everything at zero, so a test only states the fields it cares about. */
export function testCatalogueRow(overrides: Partial<CatalogueRow> & { slug: string }): CatalogueRow {
  return {
    name: overrides.slug,
    description: 'A game.',
    category: 'competitive',
    scoringKind: 'competitive',
    renderer: 'react',
    enabled: false,
    plays: 0,
    yourWins: 0,
    partnerWins: 0,
    draws: 0,
    yourBestScore: null,
    partnerBestScore: null,
    marginTotal: 0,
    marginSamples: 0,
    ...overrides,
  };
}

export const TEST_INVITATION_ID = '44444444-4444-4444-4444-444444444444';

/** An invitation as the given person sees it — which decides its direction and who "they" are. */
export function testInvitationView(viewerId: string, gameSlug = 'reaction-speed'): InvitationView {
  const outgoing = viewerId === TEST_USER_ID;
  return {
    id: TEST_INVITATION_ID,
    gameSlug,
    gameName: 'Reaction Speed',
    status: 'pending',
    direction: outgoing ? 'outgoing' : 'incoming',
    otherUser: {
      id: outgoing ? OTHER_USER_ID : TEST_USER_ID,
      nickname: outgoing ? 'Other' : 'Div',
      avatarKey: 'fox',
      gender: 'female',
    },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}

/**
 * Stands in for the invitations repository.
 *
 * The genuine transactional behaviour — the unique index, lazy expiry, the counter-proposal
 * happening in one transaction — is covered against real Postgres. This exists so the routes can be
 * tested for status codes, authorization and who gets told, without a database.
 */
export function createStubInvitationsRepository(): InvitationsRepository & {
  failWith(error: InvitationError | null): void;
  active: InvitationView | null;
  counterOnReject: boolean;
  created: { userId: string; gameSlug: string }[];
  responded: { userId: string; invitationId: string; accept: boolean }[];
} {
  let failure: InvitationError | null = null;

  const stub = {
    active: null as InvitationView | null,
    counterOnReject: false,
    created: [] as { userId: string; gameSlug: string }[],
    responded: [] as { userId: string; invitationId: string; accept: boolean }[],

    failWith(error: InvitationError | null) {
      failure = error;
    },

    async viewFor(_invitationId: string, userId: string) {
      return testInvitationView(userId);
    },

    async activeFor() {
      return stub.active;
    },

    async create(userId: string, gameSlug: string): Promise<CreatedInvitation> {
      if (failure) throw failure;
      stub.created.push({ userId, gameSlug });
      return {
        invitation: testInvitationView(userId, gameSlug),
        otherUserId: userId === TEST_USER_ID ? OTHER_USER_ID : TEST_USER_ID,
        invalidatedId: null,
      };
    },

    async respond(
      userId: string,
      invitationId: string,
      accept: boolean,
    ): Promise<RespondedInvitation> {
      if (failure) throw failure;
      stub.responded.push({ userId, invitationId, accept });
      return {
        invitationId,
        accepted: accept,
        coupleId: TEST_COUPLE_ID,
        gameSlug: 'reaction-speed',
        gameName: 'Reaction Speed',
        otherUserId: userId === TEST_USER_ID ? OTHER_USER_ID : TEST_USER_ID,
        counterInvitation:
          !accept && stub.counterOnReject ? testInvitationView(userId, 'four-in-a-row') : null,
      };
    },

    async cancel(userId: string) {
      if (failure) throw failure;
      return { otherUserId: userId === TEST_USER_ID ? OTHER_USER_ID : TEST_USER_ID };
    },

    async sweepExpired() {
      return [];
    },
  };

  return stub;
}

/** A real session registry with everybody online, which is what the route tests want. */
export function createTestSessionRegistry(): SessionRegistry {
  return createSessionRegistry(createRecordingNotifier(), { isOnline: () => true });
}
