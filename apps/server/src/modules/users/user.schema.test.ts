import { describe, expect, it } from 'vitest';
import { onboardingSchema } from './user.schema';

const NOW = new Date('2026-08-15T00:00:00Z');
const schema = onboardingSchema(NOW);

const VALID = {
  actualName: 'Divyank',
  nickname: 'Div',
  birthYear: 1996,
  avatarKey: 'fox',
  partnerLabelName: 'Anshuman',
  partnerLabelNickname: 'Anshu',
  firstMetDate: '2021-03-14',
  locationType: 'different_city',
};

function parse(overrides: Record<string, unknown> = {}) {
  return schema.safeParse({ ...VALID, ...overrides });
}

describe('onboardingSchema', () => {
  it('accepts a complete profile', () => {
    expect(parse().success).toBe(true);
  });

  it('trims surrounding whitespace rather than rejecting it', () => {
    const result = parse({ actualName: '  Divyank  ', nickname: ' Div ' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.actualName).toBe('Divyank');
    expect(result.data.nickname).toBe('Div');
  });

  it('rejects names that are empty once trimmed', () => {
    expect(parse({ actualName: '   ' }).success).toBe(false);
    expect(parse({ nickname: '' }).success).toBe(false);
    expect(parse({ partnerLabelName: ' ' }).success).toBe(false);
  });

  it('rejects names that are too long', () => {
    expect(parse({ actualName: 'a'.repeat(61) }).success).toBe(false);
    expect(parse({ nickname: 'a'.repeat(31) }).success).toBe(false);
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

  it('reports every problem at once rather than one at a time', () => {
    const result = parse({ actualName: '', birthYear: 2030, locationType: 'mars' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
  });
});
