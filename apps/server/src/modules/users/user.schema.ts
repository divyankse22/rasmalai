import { z } from 'zod';

export const LOCATION_TYPES = [
  'same_city',
  'different_city',
  'live_in',
  'prefer_not_to_say',
] as const;

export type LocationType = (typeof LOCATION_TYPES)[number];

/** Preset abstract avatars. V1 ships no uploads, per T-6. */
export const AVATAR_KEYS = [
  'chick',
  'fox',
  'octopus',
  'frog',
  'penguin',
  'unicorn',
  'rasmalai',
  'moon',
  'cactus',
  'ghost',
] as const;

export type AvatarKey = (typeof AVATAR_KEYS)[number];

/** Youngest age we will accept, matching Google's own minimum for an account. */
const MINIMUM_AGE = 13;
const EARLIEST_BIRTH_YEAR = 1900;

/**
 * `Date.parse('2021-02-30')` succeeds and silently becomes March 2nd, so parsing alone is not
 * enough: the date only counts as real if it round-trips back to exactly what was typed. Parsed as
 * UTC so a local timezone can never shift the calendar day.
 */
function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(min, `${label} is required`).max(max, `${label} is too long`));

export function onboardingSchema(now: Date = new Date()) {
  const currentYear = now.getFullYear();

  return z.object({
    actualName: trimmed(1, 60, 'Name'),
    nickname: trimmed(1, 30, 'Nickname'),
    birthYear: z
      .number()
      .int()
      .min(EARLIEST_BIRTH_YEAR, 'That birth year looks too far back')
      .max(currentYear - MINIMUM_AGE, `You must be at least ${MINIMUM_AGE} to use Rasmalai`),
    avatarKey: z.enum(AVATAR_KEYS),

    // P-1: this is the user's own private label for their partner, not the partner's real profile.
    partnerLabelName: trimmed(1, 60, "Partner's name"),
    partnerLabelNickname: trimmed(1, 30, "Partner's nickname"),

    // P-2: seeds the couple record when this user is the one who sends the pairing request.
    firstMetDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
      .refine(isRealCalendarDate, 'That is not a real date')
      .refine(
        (value) => new Date(`${value}T00:00:00Z`) <= now,
        'You cannot have met in the future',
      )
      .refine(
        (value) => Number(value.slice(0, 4)) >= EARLIEST_BIRTH_YEAR,
        'That date looks too far back',
      ),
    locationType: z.enum(LOCATION_TYPES),
  });
}

export type OnboardingInput = z.infer<ReturnType<typeof onboardingSchema>>;
