import type { TokenVerifier } from '../auth/tokenVerifier';
import type { OnboardingInput } from '../modules/users/user.schema';
import {
  PairingCodeTakenError,
  ProfileExistsError,
  type UserProfile,
  type UsersRepository,
} from '../modules/users/usersRepository';

/**
 * Test doubles shared by the HTTP tests.
 *
 * Kept out of the test files themselves so both the app and route suites use the same fakes, and
 * out of production paths because nothing imports this at runtime.
 */
export const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';

export const stubVerifier: TokenVerifier = {
  async verify(token: string) {
    if (token === 'valid') {
      return { userId: TEST_USER_ID, email: 'someone@example.com', expiresAt: Date.now() + 60_000 };
    }
    if (token === 'valid-other') {
      return {
        userId: '22222222-2222-2222-2222-222222222222',
        email: 'other@example.com',
        expiresAt: Date.now() + 60_000,
      };
    }
    throw new Error('invalid token');
  },
};

export function createInMemoryUsersRepository(): UsersRepository & { seedCodeCollisions(n: number): void } {
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
