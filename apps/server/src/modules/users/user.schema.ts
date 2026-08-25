import { z } from 'zod';
import {
  AVATAR_KEYS,
  EARLIEST_BIRTH_YEAR,
  GENDERS,
  LOCATION_TYPES,
  MINIMUM_AGE,
  NICKNAME_MAX_LENGTH,
} from '@rasmalai/shared';

export {
  AVATAR_KEYS,
  GENDERS,
  LOCATION_TYPES,
  type AvatarKey,
  type Gender,
  type LocationType,
} from '@rasmalai/shared';

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

  const firstMetDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
    .refine(isRealCalendarDate, 'That is not a real date')
    .refine((value) => new Date(`${value}T00:00:00Z`) <= now, 'You cannot have met in the future')
    .refine(
      (value) => Number(value.slice(0, 4)) >= EARLIEST_BIRTH_YEAR,
      'That date looks too far back',
    );

  return z
    .object({
      nickname: trimmed(1, NICKNAME_MAX_LENGTH, 'Name'),
      birthYear: z
        .number()
        .int()
        .min(EARLIEST_BIRTH_YEAR, 'That birth year looks too far back')
        .max(currentYear - MINIMUM_AGE, `You must be at least ${MINIMUM_AGE} to use Rasmalai`),
      // Custom messages: zod's own wording ("Invalid option: expected one of ...") is written for a
      // developer, and these strings are shown directly under the field.
      avatarKey: z.enum(AVATAR_KEYS, { error: 'Pick an avatar' }),
      gender: z.enum(GENDERS, { error: 'Please choose one' }),

      // P-1: this user's own private label for their partner, never shown to the partner.
      partnerLabelNickname: trimmed(1, NICKNAME_MAX_LENGTH, "Partner's name"),

      // Present only for the person who arrived holding their partner's code. Length is checked
      // loosely here because `normalisePairingCode` strips spacing before anything looks it up;
      // whether the code exists is a database question, answered in the same transaction as the
      // insert.
      pairingCode: z.string().min(1).max(32).optional(),

      // P-2: asked of whoever gets here first, and of nobody else. Optional at this level so the
      // refinement below can explain *why* they are missing rather than emitting two bare
      // "required" messages on a branch that never showed the fields.
      firstMetDate: firstMetDate.optional(),
      locationType: z.enum(LOCATION_TYPES, { error: 'Pick where you two are' }).optional(),
    })
    .superRefine((value, ctx) => {
      // Without a code you are the first one here, so the couple's facts have to come from you.
      // With one they come from the person whose code it is — unless they never answered either,
      // which only the database can tell us, so that case is enforced inside the transaction.
      if (value.pairingCode) return;

      if (value.firstMetDate === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['firstMetDate'],
          message: 'Tell us the day you met',
        });
      }
      if (value.locationType === undefined) {
        ctx.addIssue({ code: 'custom', path: ['locationType'], message: 'Pick where you two are' });
      }
    });
}

export type OnboardingInput = z.infer<ReturnType<typeof onboardingSchema>>;
