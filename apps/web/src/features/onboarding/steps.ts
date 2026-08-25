import {
  EARLIEST_BIRTH_YEAR,
  GENDERS,
  LOCATION_TYPES,
  MINIMUM_AGE,
  NICKNAME_MAX_LENGTH,
  type AvatarKey,
  type Gender,
  type LocationType,
} from '@rasmalai/shared';

/**
 * Onboarding, as a list of questions rather than a form.
 *
 * The cards are data because the sequence is not fixed: somebody who arrives holding their
 * partner's code is never asked the couple's questions, because their partner already answered
 * them and the couple keeps exactly one answer (`0006_onboarding_branches.sql`). Expressing that as
 * two arrays rather than two JSX branches means the wizard renders one list and the difference
 * between the two people lives in one function you can read top to bottom.
 *
 * Nothing here imports React: these rules are the same ones the server enforces, and keeping them
 * renderer-free is what lets them be read straight from `@rasmalai/shared` instead of retyped.
 */

export interface Answers {
  hasCode: 'yes' | 'no' | null;
  pairingCode: string;
  nickname: string;
  partnerLabelNickname: string;
  gender: Gender | '';
  birthYear: string;
  avatarKey: AvatarKey;
  firstMetDate: string;
  locationType: LocationType | '';
}

export type StepId = keyof Answers;

export interface Step {
  /** Doubles as the field name the server reports errors against. */
  id: StepId;
  kind: 'choice' | 'code' | 'text' | 'year' | 'date' | 'avatar';
  question: string;
  hint?: string;
  label: string;
  options?: readonly { value: string; label: string }[];
  /** A message when this answer is not usable yet, or undefined when it is. */
  validate: (answers: Answers) => string | undefined;
}

export const GENDER_OPTIONS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
] as const satisfies readonly { value: Gender; label: string }[];

export const LOCATION_OPTIONS = [
  { value: 'same_city', label: 'Same city' },
  { value: 'different_city', label: 'Different cities' },
  { value: 'live_in', label: 'We live together' },
  { value: 'prefer_not_to_say', label: 'Rather not say' },
] as const satisfies readonly { value: LocationType; label: string }[];

const required = (label: string) => (value: string) =>
  value.trim().length === 0
    ? `${label} is required`
    : value.trim().length > NICKNAME_MAX_LENGTH
      ? `${label} is too long`
      : undefined;

function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

const HAS_CODE: Step = {
  id: 'hasCode',
  kind: 'choice',
  question: 'Do you have their code?',
  hint: 'If they signed up first, they have an eight-character code to share with you.',
  label: 'Do you have their code?',
  options: [
    { value: 'yes', label: 'Yes, I have it' },
    { value: 'no', label: 'Not yet — I’m first' },
  ],
  validate: (answers) => (answers.hasCode === null ? 'Pick one to carry on' : undefined),
};

const PAIRING_CODE: Step = {
  id: 'pairingCode',
  kind: 'code',
  question: 'What’s their code?',
  hint: 'Eight characters. Spaces and dashes do not matter.',
  label: 'Their code',
  // Only shape is checked here. Whether it belongs to anybody is the server's to answer, and the
  // card waits for that answer before it will advance.
  validate: (answers) =>
    answers.pairingCode.replace(/[^0-9a-z]/gi, '').length === 0 ? 'Enter their code' : undefined,
};

const PERSONAL: Step[] = [
  {
    id: 'nickname',
    kind: 'text',
    question: 'What should we call you?',
    hint: 'This is the name they will see all over Rasmalai.',
    label: 'Your name',
    validate: (answers) => required('Your name')(answers.nickname),
  },
  {
    id: 'partnerLabelNickname',
    kind: 'text',
    question: 'And what do you call them?',
    hint: 'Just for you. They never see it, and they pick their own name for you.',
    label: 'What you call them',
    validate: (answers) => required('Their name')(answers.partnerLabelNickname),
  },
  {
    id: 'gender',
    kind: 'choice',
    question: 'How do you identify?',
    hint: 'Names are coloured by this.',
    label: 'Your gender',
    options: GENDER_OPTIONS,
    validate: (answers) =>
      GENDERS.includes(answers.gender as Gender) ? undefined : 'Please choose one',
  },
  {
    id: 'birthYear',
    kind: 'year',
    question: 'Which year were you born?',
    label: 'Your birth year',
    validate: (answers) => {
      const year = Number(answers.birthYear);
      if (!/^\d{4}$/.test(answers.birthYear.trim())) return 'Use four digits';
      if (year < EARLIEST_BIRTH_YEAR) return 'That birth year looks too far back';
      if (year > new Date().getFullYear() - MINIMUM_AGE) {
        return `You must be at least ${MINIMUM_AGE} to use Rasmalai`;
      }
      return undefined;
    },
  },
  {
    id: 'avatarKey',
    kind: 'avatar',
    question: 'Pick a face',
    label: 'Your avatar',
    validate: () => undefined,
  },
];

const COUPLE: Step[] = [
  {
    id: 'firstMetDate',
    kind: 'date',
    question: 'When did you two meet?',
    hint: 'Every “days together” count comes from this, so it is worth getting right.',
    label: 'The day you met',
    validate: (answers) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(answers.firstMetDate)) return 'Use the date picker';
      if (!isRealCalendarDate(answers.firstMetDate)) return 'That is not a real date';
      if (new Date(`${answers.firstMetDate}T00:00:00Z`) > new Date()) {
        return 'You cannot have met in the future';
      }
      if (Number(answers.firstMetDate.slice(0, 4)) < EARLIEST_BIRTH_YEAR) {
        return 'That date looks too far back';
      }
      return undefined;
    },
  },
  {
    id: 'locationType',
    kind: 'choice',
    question: 'Where are you two?',
    label: 'Where you are',
    options: LOCATION_OPTIONS,
    validate: (answers) =>
      LOCATION_TYPES.includes(answers.locationType as LocationType)
        ? undefined
        : 'Pick where you two are',
  },
];

/**
 * @param ownerNeedsCoupleDetails the code's owner joined by code themselves and was turned down, so
 * nobody has ever answered the couple's questions and this person has to.
 */
export function buildSteps(answers: Answers, ownerNeedsCoupleDetails: boolean): Step[] {
  if (answers.hasCode === null) return [HAS_CODE];
  if (answers.hasCode === 'no') return [HAS_CODE, ...PERSONAL, ...COUPLE];

  return [HAS_CODE, PAIRING_CODE, ...PERSONAL, ...(ownerNeedsCoupleDetails ? COUPLE : [])];
}

export const EMPTY_ANSWERS: Answers = {
  hasCode: null,
  pairingCode: '',
  nickname: '',
  partnerLabelNickname: '',
  gender: '',
  birthYear: '',
  avatarKey: 'rasmalai',
  firstMetDate: '',
  locationType: 'different_city',
};

/** What `POST /api/onboarding` expects, with the questions this person was never asked left out. */
export function toPayload(answers: Answers, steps: readonly Step[]): Record<string, unknown> {
  const asked = new Set(steps.map((step) => step.id));

  return {
    nickname: answers.nickname.trim(),
    partnerLabelNickname: answers.partnerLabelNickname.trim(),
    gender: answers.gender,
    birthYear: Number(answers.birthYear),
    avatarKey: answers.avatarKey,
    ...(asked.has('pairingCode') ? { pairingCode: answers.pairingCode } : {}),
    ...(asked.has('firstMetDate')
      ? { firstMetDate: answers.firstMetDate, locationType: answers.locationType }
      : {}),
  };
}
