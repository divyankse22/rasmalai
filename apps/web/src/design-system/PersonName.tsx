export type Gender = 'male' | 'female';

const TONE: Record<Gender, string> = {
  male: 'text-name-male',
  female: 'text-name-female',
};

/**
 * The text colour belonging to one person.
 *
 * Exported so a number that belongs to somebody — their wins, their streak — can be tinted the
 * same way their name is, without a second copy of the mapping. Falls back to ordinary ink rather
 * than guessing.
 */
export function nameTone(gender: Gender | undefined): string {
  return gender ? TONE[gender] : 'text-ink';
}

/**
 * Renders somebody's name in their colour.
 *
 * Every place a person is named goes through here, so the mapping lives in exactly one file and
 * the colours themselves stay in the theme.
 */
export function PersonName({
  name,
  gender,
  className = '',
}: {
  name: string;
  gender: Gender | undefined;
  className?: string;
}) {
  // Falls back to the ordinary ink colour rather than guessing when gender is unknown.
  const tone = gender ? TONE[gender] : 'text-ink';
  return <span className={`font-display font-semibold ${tone} ${className}`}>{name}</span>;
}
