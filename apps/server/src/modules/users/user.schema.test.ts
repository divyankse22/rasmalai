import { describe, expect, it } from 'vitest';
import { onboardingSchema } from './user.schema';

const NOW = new Date('2026-08-15T00:00:00Z');
const schema = onboardingSchema(NOW);

/** Somebody who got here first: no code, so the couple's questions are theirs to answer. */
const FIRST = {
  nickname: 'Div',
  birthYear: 1996,
  avatarKey: 'fox',
  gender: 'female',
  partnerLabelNickname: 'Anshu',
  firstMetDate: '2021-03-14',
  locationType: 'different_city',
};

/** Somebody arriving with their partner's code, who is never asked the couple's questions. */
const JOINER = {
  nickname: 'Anshu',
  birthYear: 1995,
  avatarKey: 'chick',
  gender: 'male',
  partnerLabelNickname: 'Div',
  pairingCode: 'GOODCODE',
};

function parse(overrides: Record<string, unknown> = {}) {
  return schema.safeParse({ ...FIRST, ...overrides });
}

describe('onboardingSchema', () => {
  it('accepts a complete profile', () => {
    expect(parse().success).toBe(true);
  });

  it('trims surrounding whitespace rather than rejecting it', () => {
    const result = parse({ nickname: ' Div ', partnerLabelNickname: '  Anshu  ' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.nickname).toBe('Div');
    expect(result.data.partnerLabelNickname).toBe('Anshu');
  });

  it('rejects names that are empty once trimmed', () => {
    expect(parse({ nickname: '   ' }).success).toBe(false);
    expect(parse({ partnerLabelNickname: ' ' }).success).toBe(false);
  });

  it('rejects names that are too long', () => {
    expect(parse({ nickname: 'a'.repeat(31) }).success).toBe(false);
    expect(parse({ partnerLabelNickname: 'a'.repeat(31) }).success).toBe(false);
  });

  it('enforces the minimum age', () => {
    expect(parse({ birthYear: 2013 }).success).toBe(true);
    expect(parse({ birthYear: 2014 }).success).toBe(false);
  });

  it('rejects implausible birth years', () => {
    expect(parse({ birthYear: 1899 }).success).toBe(false);
    expect(parse({ birthYear: 2030 }).success).toBe(false);
  });

  it('refuses a first-met date in the future', () => {
    expect(parse({ firstMetDate: '2026-08-14' }).success).toBe(true);
    expect(parse({ firstMetDate: '2026-08-16' }).success).toBe(false);
  });

  it('refuses a malformed or impossible first-met date', () => {
    expect(parse({ firstMetDate: '14-03-2021' }).success).toBe(false);
    expect(parse({ firstMetDate: '2021-02-30' }).success).toBe(false);
    expect(parse({ firstMetDate: 'yesterday' }).success).toBe(false);
  });

  it('only accepts known avatars and location types', () => {
    expect(parse({ avatarKey: 'dragon' }).success).toBe(false);
    expect(parse({ locationType: 'mars' }).success).toBe(false);
    expect(parse({ locationType: 'prefer_not_to_say' }).success).toBe(true);
  });

  it('requires a gender, and only a known one', () => {
    const { gender: _omitted, ...withoutGender } = FIRST;
    expect(schema.safeParse(withoutGender).success).toBe(false);

    expect(parse({ gender: '' }).success).toBe(false);
    expect(parse({ gender: 'unspecified' }).success).toBe(false);
    expect(parse({ gender: 'male' }).success).toBe(true);
    expect(parse({ gender: 'female' }).success).toBe(true);
  });

  it('reports every problem at once rather than one at a time', () => {
    const result = parse({ nickname: '', birthYear: 2030, locationType: 'mars' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
  });

  describe('the two branches', () => {
    it('demands the couple’s questions from whoever has no code', () => {
      const { firstMetDate: _date, locationType: _location, ...withoutCouple } = FIRST;
      const result = schema.safeParse(withoutCouple);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
        expect.arrayContaining(['firstMetDate', 'locationType']),
      );
    });

    it('asks neither of them of somebody holding a code', () => {
      const result = schema.safeParse(JOINER);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.firstMetDate).toBeUndefined();
      expect(result.data.locationType).toBeUndefined();
    });

    it('still validates couple answers a code-holder does supply', () => {
      // The wizard sends them when the code's owner never answered either.
      expect(schema.safeParse({ ...JOINER, firstMetDate: '2021-03-14' }).success).toBe(true);
      expect(schema.safeParse({ ...JOINER, firstMetDate: '2999-01-01' }).success).toBe(false);
      expect(schema.safeParse({ ...JOINER, locationType: 'mars' }).success).toBe(false);
    });

    it('drops a retired field rather than choking on one', () => {
      // An old client still posting actualName gets a profile, not a 400.
      const result = parse({ actualName: 'Divyank', partnerLabelName: 'Anshuman' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).not.toHaveProperty('actualName');
    });
  });
});
