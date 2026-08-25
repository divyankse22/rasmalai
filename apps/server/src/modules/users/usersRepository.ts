import type { Pool, PoolClient } from 'pg';
import { formatCalendarDate } from '../../db/calendarDate';
import type { AvatarKey, Gender, LocationType, OnboardingInput } from './user.schema';

export interface UserProfile {
  id: string;
  nickname: string;
  birthYear: number;
  avatarKey: AvatarKey;
  gender: Gender;
  partnerLabelNickname: string;
  /**
   * Null for whoever arrived holding their partner's code: they were never asked, because the
   * couple's copy comes from the person who was. See `0006_onboarding_branches.sql`.
   */
  firstMetDate: string | null;
  locationType: LocationType | null;
  pairingCode: string;
}

/** What `create` did besides making the profile, when a partner code came with it. */
export interface CreatedPairingRequest {
  requestId: string;
  targetUserId: string;
}

export interface CreateResult {
  profile: UserProfile;
  request: CreatedPairingRequest | null;
}

export interface UsersRepository {
  findById(userId: string): Promise<UserProfile | null>;
  create(userId: string, input: OnboardingInput, pairingCode: string): Promise<CreateResult>;
}

/** Thrown when the generated pairing code collides with an existing one. */
export class PairingCodeTakenError extends Error {}
/** Thrown when a profile already exists for this user. */
export class ProfileExistsError extends Error {}

/** Why an otherwise valid sign-up could not also send the pairing request it asked to send. */
export class OnboardingPairingError extends Error {
  constructor(
    readonly code: 'code_not_found' | 'partner_already_paired' | 'needs_couple_details',
    message: string,
  ) {
    super(message);
  }
}

interface UserRow {
  id: string;
  nickname: string;
  birth_year: number;
  avatar_key: AvatarKey;
  gender: Gender;
  partner_label_nickname: string;
  first_met_date: Date | string | null;
  location_type: LocationType | null;
  pairing_code: string;
}

function toProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    nickname: row.nickname,
    birthYear: row.birth_year,
    avatarKey: row.avatar_key,
    gender: row.gender,
    partnerLabelNickname: row.partner_label_nickname,
    firstMetDate: row.first_met_date === null ? null : formatCalendarDate(row.first_met_date),
    locationType: row.location_type,
    pairingCode: row.pairing_code,
  };
}

/**
 * `actual_name` and `partner_label_name` are deliberately absent.
 *
 * 0006 stopped collecting them and left the columns in place so existing rows keep what they said.
 * Not selecting them is what makes that a retirement rather than a half-migration: no code path can
 * quietly start depending on a value that nobody will ever supply again.
 */
const COLUMNS = `id, nickname, birth_year, avatar_key, gender,
  partner_label_nickname, first_met_date, location_type, pairing_code`;

export function createUsersRepository(pool: Pool): UsersRepository {
  async function insertProfile(
    executor: Pick<PoolClient, 'query'>,
    userId: string,
    input: OnboardingInput,
    pairingCode: string,
  ): Promise<UserProfile> {
    const { rows } = await executor.query<UserRow>(
      `insert into public.users (
         id, nickname, birth_year, avatar_key, gender,
         partner_label_nickname, first_met_date, location_type, pairing_code
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning ${COLUMNS}`,
      [
        userId,
        input.nickname,
        input.birthYear,
        input.avatarKey,
        input.gender,
        input.partnerLabelNickname,
        input.firstMetDate ?? null,
        input.locationType ?? null,
        pairingCode,
      ],
    );

    const row = rows[0];
    if (!row) throw new Error('insert returned no row');
    return toProfile(row);
  }

  return {
    async findById(userId) {
      const { rows } = await pool.query<UserRow>(
        `select ${COLUMNS} from public.users where id = $1`,
        [userId],
      );
      const row = rows[0];
      return row ? toProfile(row) : null;
    },

    async create(userId, input, pairingCode) {
      const client = await pool.connect();
      try {
        await client.query('begin');

        let request: CreatedPairingRequest | null = null;

        if (input.pairingCode) {
          // Locked before the profile is written, so a partner cannot pair with somebody else in
          // the gap between us reading their row and asking to pair with them.
          const owner = await client.query<{
            id: string;
            couple_id: string | null;
            first_met_date: Date | null;
          }>(
            `select id, couple_id, first_met_date from public.users
              where pairing_code = $1 for update`,
            [input.pairingCode],
          );
          const ownerRow = owner.rows[0];

          if (!ownerRow) {
            throw new OnboardingPairingError('code_not_found', 'We could not find that code.');
          }
          if (ownerRow.couple_id !== null) {
            throw new OnboardingPairingError(
              'partner_already_paired',
              'They are already paired with someone.',
            );
          }
          // They joined by code too and were turned down, so nobody has ever answered the couple's
          // questions. The wizard asks them of this person instead; reaching here means the check
          // it ran beforehand raced with the other person's rejection.
          if (ownerRow.first_met_date === null && input.firstMetDate === undefined) {
            throw new OnboardingPairingError(
              'needs_couple_details',
              'We still need the day you two met.',
            );
          }

          const profile = await insertProfile(client, userId, input, pairingCode);

          // The guards `pairingRepository.requestByCode` performs are all unreachable here. This
          // user's row was created two statements ago, so they cannot already be paired, their code
          // was generated seconds ago so it cannot be the one they typed, and nobody can have sent
          // them a request against a code that did not exist yet.
          const inserted = await client.query<{ id: string }>(
            `insert into public.pairing_requests (requester_user_id, target_user_id)
             values ($1, $2) returning id`,
            [userId, ownerRow.id],
          );

          request = { requestId: inserted.rows[0]!.id, targetUserId: ownerRow.id };
          await client.query('commit');
          return { profile, request };
        }

        const profile = await insertProfile(client, userId, input, pairingCode);
        await client.query('commit');
        return { profile, request };
      } catch (error) {
        await client.query('rollback');
        // 23505 is unique_violation. Which constraint tripped tells us what actually happened.
        if (isUniqueViolation(error, 'users_pairing_code_key')) {
          throw new PairingCodeTakenError('pairing code already taken');
        }
        if (isUniqueViolation(error, 'users_pkey')) {
          throw new ProfileExistsError('profile already exists');
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505' &&
    (error as { constraint?: string }).constraint === constraint
  );
}
