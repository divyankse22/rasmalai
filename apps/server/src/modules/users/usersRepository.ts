import type { Pool } from 'pg';
import type { AvatarKey, LocationType, OnboardingInput } from './user.schema';

export interface UserProfile {
  id: string;
  actualName: string;
  nickname: string;
  birthYear: number;
  avatarKey: AvatarKey;
  partnerLabelName: string;
  partnerLabelNickname: string;
  firstMetDate: string;
  locationType: LocationType;
  pairingCode: string;
}

export interface UsersRepository {
  findById(userId: string): Promise<UserProfile | null>;
  create(userId: string, input: OnboardingInput, pairingCode: string): Promise<UserProfile>;
}

/** Thrown when the generated pairing code collides with an existing one. */
export class PairingCodeTakenError extends Error {}
/** Thrown when a profile already exists for this user. */
export class ProfileExistsError extends Error {}

interface UserRow {
  id: string;
  actual_name: string;
  nickname: string;
  birth_year: number;
  avatar_key: AvatarKey;
  partner_label_name: string;
  partner_label_nickname: string;
  first_met_date: Date | string;
  location_type: LocationType;
  pairing_code: string;
}

function toProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    actualName: row.actual_name,
    nickname: row.nickname,
    birthYear: row.birth_year,
    avatarKey: row.avatar_key,
    partnerLabelName: row.partner_label_name,
    partnerLabelNickname: row.partner_label_nickname,
    // `date` comes back as a Date in the local timezone; take the calendar day, not an instant.
    firstMetDate:
      row.first_met_date instanceof Date
        ? formatCalendarDate(row.first_met_date)
        : String(row.first_met_date),
    locationType: row.location_type,
    pairingCode: row.pairing_code,
  };
}

function formatCalendarDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const COLUMNS = `id, actual_name, nickname, birth_year, avatar_key, partner_label_name,
  partner_label_nickname, first_met_date, location_type, pairing_code`;

export function createUsersRepository(pool: Pool): UsersRepository {
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
      try {
        const { rows } = await pool.query<UserRow>(
          `insert into public.users (
             id, actual_name, nickname, birth_year, avatar_key,
             partner_label_name, partner_label_nickname,
             first_met_date, location_type, pairing_code
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           returning ${COLUMNS}`,
          [
            userId,
            input.actualName,
            input.nickname,
            input.birthYear,
            input.avatarKey,
            input.partnerLabelName,
            input.partnerLabelNickname,
            input.firstMetDate,
            input.locationType,
            pairingCode,
          ],
        );

        const row = rows[0];
        if (!row) throw new Error('insert returned no row');
        return toProfile(row);
      } catch (error) {
        // 23505 is unique_violation. Which constraint tripped tells us what actually happened.
        if (isUniqueViolation(error, 'users_pairing_code_key')) {
          throw new PairingCodeTakenError('pairing code already taken');
        }
        if (isUniqueViolation(error, 'users_pkey')) {
          throw new ProfileExistsError('profile already exists');
        }
        throw error;
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
