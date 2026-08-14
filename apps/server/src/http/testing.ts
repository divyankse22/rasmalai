import type { TokenVerifier } from '../auth/tokenVerifier';
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

export function createRecordingNotifier(): RealtimeNotifier & { sent: SentEvent[] } {
  const sent: SentEvent[] = [];
  return {
    sent,
    sendToUser(userId, type, payload) {
      sent.push({ userId, type, payload });
    },
  };
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
