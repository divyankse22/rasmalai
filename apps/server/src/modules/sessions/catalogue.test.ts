import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GAME_META } from '@rasmalai/games';
import { findGameRules, playableSlugs } from '@rasmalai/games/server';

/**
 * The module registry and the catalogue table, held against each other.
 *
 * There are two answers to "what games exist" in this product and they are written in different
 * languages. `packages/games/src/server.ts` decides whether a session can start; `public.games`
 * decides what the dashboard offers and — through `scoring_kind` — what a result of it counts
 * towards (P-3, P-4). Neither can see the other, and every disagreement between them is silent:
 *
 * - a module with no enabled row is a game nobody can be invited to, however finished it is;
 * - an enabled row with no module is a Play button that opens a lobby which never starts;
 * - a `scoring_kind` that disagrees with the module's `scoringKind` is the worst of the three,
 *   because everything works. The results screen reads the module and announces a winner; the
 *   statistics read the column and record nothing. Memory is exactly this shape — filed under
 *   casual, scored competitively — and `0009` moves the column to match on purpose.
 *
 * `playableSlugs()` has always been documented as the thing that "keeps the seed honest". Until now
 * nothing actually held it to that. This is that test, and it reads the migrations as text because
 * that is the only copy of the catalogue available without a database.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, '../../../../../supabase/migrations');

/** Every migration, oldest first — the order Postgres would apply them in. */
function sql(): string {
  return readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(migrations, name), 'utf8'))
    .join('\n');
}

const catalogue = sql();

/** The seeded row for a slug: `('slug', 'Name', 'desc', 'category', 'scoring', 'renderer', n)`. */
function seeded(slug: string): { category: string; scoring: string; renderer: string } | null {
  const row = new RegExp(
    `\\('${slug}',\\s*'(?:[^']|'')*',\\s*'(?:[^']|'')*',\\s*'(\\w+)',\\s*'(\\w+)',\\s*'(\\w+)'`,
  ).exec(catalogue);

  if (!row) return null;
  return { category: row[1]!, scoring: row[2]!, renderer: row[3]! };
}

/** Whether any migration flips this slug on. Both the single-slug and the `in (...)` forms. */
function enabled(slug: string): boolean {
  return new RegExp(`update public\\.games set enabled = true[\\s\\S]{0,200}?'${slug}'`, 'i').test(
    catalogue,
  );
}

/** The last word any migration has on this game's scoring kind. */
function scoringKind(slug: string): string | null {
  const overrides = [
    ...catalogue.matchAll(
      /update public\.games set scoring_kind = '(\w+)'\s+where slug = '([\w-]+)'/gi,
    ),
  ].filter((match) => match[2] === slug);

  const last = overrides.at(-1);
  if (last) return last[1]!;
  return seeded(slug)?.scoring ?? null;
}

describe('the catalogue and the module registry agree', () => {
  const slugs = playableSlugs();

  it('has a module for every slug it lists, and rules behind every module', () => {
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(findGameRules(slug), slug).not.toBeNull();
      // `GAME_META` is the browser-safe half of the same registry. A game in one and not the other
      // renders without rules, or runs without a card.
      expect(GAME_META[slug], slug).toBeDefined();
    }
    expect(Object.keys(GAME_META).sort()).toEqual([...slugs].sort());
  });

  it('has a seeded, enabled catalogue row for every playable game', () => {
    for (const slug of slugs) {
      expect(seeded(slug), `${slug} is not in the 0004 seed`).not.toBeNull();
      expect(enabled(slug), `${slug} has a module but no migration enables it`).toBe(true);
    }
  });

  it('agrees with the database about what a result of each game means (P-3, P-4)', () => {
    for (const slug of slugs) {
      const meta = GAME_META[slug]!;
      // The one that would fail silently: the results screen reads `scoringKind` and the statistics
      // read the column, so a mismatch announces a winner and then declines to record them.
      expect(scoringKind(slug), `${slug} scoring_kind`).toBe(meta.scoringKind);
      expect(seeded(slug)!.category, `${slug} category`).toBe(meta.category);
      expect(seeded(slug)!.renderer, `${slug} renderer`).toBe(meta.renderer);
    }
  });

  it('enables nothing that has no module behind it', () => {
    // The other direction: a Play button that opens a lobby which can never start. Every slug any
    // migration turns on has to be one this build can actually run.
    const turnedOn = [
      ...catalogue.matchAll(/update public\.games set enabled = true([\s\S]{0,300}?);/gi),
    ].flatMap((statement) => [...statement[1]!.matchAll(/'([\w-]+)'/g)].map((match) => match[1]!));

    expect(turnedOn.length).toBeGreaterThan(0);
    for (const slug of new Set(turnedOn)) {
      expect(findGameRules(slug), `${slug} is enabled with no module`).not.toBeNull();
    }
  });

  it('can field a tournament, which needs three games (D-1)', () => {
    // Known limitation 25 until slice 10: the create screen could not reach a legal selection with
    // only two modules written. This is the assertion that says it no longer applies.
    expect(slugs.length).toBeGreaterThanOrEqual(3);
  });
});
