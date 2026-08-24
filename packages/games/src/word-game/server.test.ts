import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerIndex, Transition } from '../contract';
import {
  GOLDEN_MULTIPLIER,
  HINT_COST,
  MAX_TURNS_EACH,
  PASS_LETTERS,
  POOL_MAX,
  POOL_SIZE,
  RAID_BONUS,
  RAID_LETTERS,
  RAID_LETTERS_BEHIND,
  TURN_BONUS_MS,
  TURN_START_MS,
  type WordGameAction,
} from './protocol';
import { rules, type WordGameState } from './server';

const context: GameContext = { random: () => 0 };
const AT = { receivedAt: 0, compensationMs: 0 };

const fresh = (draw: GameContext = context) => rules.createMatch(0, draw);

function act(
  state: WordGameState,
  player: PlayerIndex,
  action: unknown,
): Transition<WordGameState> {
  const validation = rules.validateAction(state, player, action);
  if (!validation.ok) throw new Error(`refused: ${validation.code} — ${validation.message}`);
  return rules.applyAction(state, player, validation.action as WordGameAction, AT, context);
}

function refusal(state: WordGameState, player: PlayerIndex, action: unknown): string {
  const validation = rules.validateAction(state, player, action);
  if (validation.ok) throw new Error('that was allowed, and should not have been');
  return validation.message;
}

/**
 * Puts an exact pool on the table.
 *
 * The bag is shuffled from a seeded RNG, so which letters come up is not something a test should
 * depend on. Every test that cares about a specific word sets the pool by hand and says so.
 */
function withPool(
  state: WordGameState,
  letters: string,
  options: { golden?: number; bag?: string[]; poolTarget?: number } = {},
): WordGameState {
  const pool = [...letters].map((letter, index) => ({
    id: 1000 + index,
    letter,
    golden: options.golden === index,
  }));
  return {
    ...state,
    pool,
    // Matches the hand-built pool by default, not whatever `fresh()` happened to deal — a custom
    // pool is meant to stand on its own, and a test asserting on refill/growth math should not have
    // to know POOL_SIZE to avoid a phantom mismatch between "how many tiles are here" and "how many
    // the state thinks belong here". Overridable for the handful of tests specifically about that
    // mismatch (a pool mid-growth, or already sitting at POOL_MAX).
    poolTarget: options.poolTarget ?? pool.length,
    goldenTileId: options.golden === undefined ? null : pool[options.golden]!.id,
    bag: options.bag ?? [],
  };
}

/** Tile ids for a word, taken left to right out of the pool as laid down by `withPool`. */
const idsFor = (state: WordGameState, word: string): number[] => {
  const remaining = [...state.pool];
  return [...word].map((letter) => {
    const at = remaining.findIndex((tile) => tile.letter === letter);
    if (at === -1) throw new Error(`the test pool has no '${letter}'`);
    return remaining.splice(at, 1)[0]!.id;
  });
};

const turnOf = (state: WordGameState): PlayerIndex => (state.turn === 0 ? 0 : 1);

describe('a new match', () => {
  it('deals a full pool with exactly one golden tile', () => {
    const state = fresh();
    expect(state.pool).toHaveLength(POOL_SIZE);
    expect(state.pool.filter((tile) => tile.golden)).toHaveLength(1);
    expect(state.goldenTileId).not.toBeNull();
  });

  it('leaves the rest of the letters in the bag, and nobody with anything', () => {
    const state = fresh();
    expect(state.bag.length).toBeGreaterThan(30);
    expect(state.words).toEqual([[], []]);
    expect(rules.getResult(state).scores).toEqual([0, 0]);
  });

  it('coin-flips who starts, and gives every tile a distinct id', () => {
    expect(fresh({ random: () => 0 }).turn).toBe(0);
    expect(fresh({ random: () => 0.9 }).turn).toBe(1);
    const ids = fresh().pool.map((tile) => tile.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declines the platform move clock, but starts its own turn clock', () => {
    const state = fresh();
    // Deliberate: the platform's 120-second window would forfeit somebody for thinking, and twelve
    // letters legitimately takes longer than that. Whose turn it is still reaches the screen
    // through the view — it is simply not enforced by the platform's own clock.
    expect(rules.turnOf(state)).toBeNull();
    // The game's own clock is a different mechanism, and does apply from the first turn.
    expect(state.turnEndsAt).toBe(TURN_START_MS);
    expect(rules.nextTickAt(state)).toBe(state.turnEndsAt);
    expect(rules.tick(state, state.turnEndsAt! - 1, context).state).toBe(state);
  });
});

describe('claiming a word', () => {
  it('takes the letters off the table and pays length squared', () => {
    const start = withPool(fresh(), 'coastxyzabcd');
    const player = turnOf(start);
    const next = act(start, player, {
      type: 'claim',
      tiles: idsFor(start, 'coast'),
      steal: null,
    }).state;

    expect(next.words[player]).toEqual([{ word: 'coast', golden: false, score: 25 }]);
    expect(next.pool.map((tile) => tile.letter).join('')).toBe('xyzabcd');
    expect(rules.getResult(next).scores[player]).toBe(25);
  });

  it('doubles a word that used the golden tile', () => {
    // Golden is the 'c' at index 0, so `coast` uses it and `oats` does not.
    const start = withPool(fresh(), 'coastxyzabcd', { golden: 0 });
    const player = turnOf(start);
    const next = act(start, player, {
      type: 'claim',
      tiles: idsFor(start, 'coast'),
      steal: null,
    }).state;

    expect(next.words[player][0]).toMatchObject({ golden: true, score: 25 * GOLDEN_MULTIPLIER });
  });

  it('moves the golden tile onto a new one once it has been played', () => {
    const start = withPool(fresh(), 'coastxyzabcd', { golden: 0 });
    const player = turnOf(start);
    const next = act(start, player, {
      type: 'claim',
      tiles: idsFor(start, 'coast'),
      steal: null,
    }).state;

    // Exactly one, always — and not the one that just left.
    expect(next.pool.filter((tile) => tile.golden)).toHaveLength(1);
    expect(next.goldenTileId).not.toBe(start.goldenTileId);
  });

  it('refills the pool from the bag, and stops when the bag runs out', () => {
    const start = withPool(fresh(), 'coastxyzabcd', { bag: ['q', 'r', 'v'] });
    const player = turnOf(start);
    const next = act(start, player, {
      type: 'claim',
      tiles: idsFor(start, 'coast'),
      steal: null,
    }).state;

    // Seven left after `coast`, plus three from a bag that then runs dry.
    expect(next.pool).toHaveLength(10);
    expect(next.bag).toHaveLength(0);
  });

  it('hands the turn over', () => {
    const start = withPool(fresh(), 'coastxyzabcd');
    const player = turnOf(start);
    const next = act(start, player, {
      type: 'claim',
      tiles: idsFor(start, 'coast'),
      steal: null,
    }).state;
    expect(next.turn).toBe(1 - player);
  });
});

describe('what the server refuses', () => {
  it('refuses a move from the seat whose turn it is not', () => {
    const start = withPool(fresh(), 'coastxyzabcd');
    const other = (1 - turnOf(start)) as PlayerIndex;
    expect(refusal(start, other, { type: 'pass' })).toBe('It is not your turn.');
  });

  it('refuses letters that are not on the table', () => {
    const start = withPool(fresh(), 'coastxyzabcd');
    expect(refusal(start, turnOf(start), { type: 'claim', tiles: [9999, 9998, 9997], steal: null })).toBe(
      'Those letters are not on the table.',
    );
  });

  it('refuses the same tile used twice', () => {
    const start = withPool(fresh(), 'coastxyzabcd');
    const id = start.pool[0]!.id;
    expect(refusal(start, turnOf(start), { type: 'claim', tiles: [id, id, id], steal: null })).toBe(
      'You used a letter twice.',
    );
  });

  it('refuses anything shorter than three letters, before it looks at the dictionary', () => {
    const start = withPool(fresh(), 'coastxyzabcd');
    const tiles = idsFor(start, 'co');
    expect(refusal(start, turnOf(start), { type: 'claim', tiles, steal: null })).toBe(
      'A word is at least three letters.',
    );
  });

  it('refuses nonsense actions', () => {
    const start = withPool(fresh(), 'coastxyzabcd');
    const player = turnOf(start);
    expect(refusal(start, player, null)).toBe('That is not a move in this game.');
    expect(refusal(start, player, { type: 'nope' })).toBe('That is not a move in this game.');
  });

  /**
   * A word that is not a word costs the player nothing but the attempt.
   *
   * This is a product decision rather than an oversight: the pool is public and the dictionary is
   * not, so a player genuinely cannot know whether `snarf` is in it. Losing your turn to a guess
   * would make the game about memorising a word list, which is exactly what it is trying not to be.
   */
  it('tells a player their word is not a word, and leaves the turn with them', () => {
    const start = withPool(fresh(), 'zxqvwjkfmbgy');
    const player = turnOf(start);
    const next = act(start, player, {
      type: 'claim',
      tiles: idsFor(start, 'zxq'),
      steal: null,
    }).state;

    expect(next.lastRejection[player]).toBe('NOT_FOUND');
    expect(next.turn).toBe(player);
    expect(next.words[player]).toEqual([]);
    expect(next.pool).toHaveLength(12);
  });

  it('refuses a word either of them has already played', () => {
    let state = withPool(fresh(), 'coastxyzabcd', { bag: [...'coast'] });
    const first = turnOf(state);
    state = act(state, first, { type: 'claim', tiles: idsFor(state, 'coast'), steal: null }).state;

    // The refill dealt the same five letters back, so the second player can try the same word.
    const second = turnOf(state);
    const next = act(state, second, {
      type: 'claim',
      tiles: idsFor(state, 'coast'),
      steal: null,
    }).state;

    expect(next.lastRejection[second]).toBe('ALREADY_USED');
    expect(next.words[second]).toEqual([]);
    expect(next.turn).toBe(second);
    void first;
  });
});

describe('raiding', () => {
  /** Gives `victim` one word to lose, and leaves it on `raider`'s turn. */
  function withVictimWord(raider: PlayerIndex, word: string, pool: string): WordGameState {
    const base = withPool(fresh(), pool);
    const victim = (1 - raider) as PlayerIndex;
    const words: WordGameState['words'] = [[], []];
    words[victim] = [{ word, golden: false, score: word.length * word.length }];
    return { ...base, words, turn: raider };
  }

  it('refuses a raid from a word that is too short', () => {
    // The raider must be AHEAD for the ordinary six-letter threshold to apply — a trailing player
    // gets the discount, and five letters would be enough for them. That is the comeback rule
    // doing its job, and it is asserted directly further down.
    const base = withVictimWord(0, 'cat', 'coastxyzabcd');
    const state: WordGameState = {
      ...base,
      words: [[{ word: 'jigsaw', golden: false, score: 36 }], base.words[1]],
    };
    expect(refusal(state, 0, { type: 'claim', tiles: idsFor(state, 'coast'), steal: 0 })).toBe(
      `A raid needs ${RAID_LETTERS} letters.`,
    );
  });

  it('refuses a raid at a word that is not there', () => {
    const state = withVictimWord(0, 'cat', 'coasterxyzab');
    expect(refusal(state, 0, { type: 'claim', tiles: idsFor(state, 'coaster'), steal: 3 })).toBe(
      'That is not one of their words.',
    );
  });

  it('breaks the word, banks the bonus, and puts the letters back on the table', () => {
    const state = withVictimWord(0, 'jigsaw', 'coasterxyzab');
    const before = state.pool.length;

    const next = act(state, 0, { type: 'claim', tiles: idsFor(state, 'coaster'), steal: 0 }).state;

    // Theirs is gone, and everything it was worth with it.
    expect(next.words[1]).toEqual([]);
    expect(next.raidPoints[0]).toBe(RAID_BONUS);
    // Seven letters left with the claim, six came back from `jigsaw`.
    expect(next.pool).toHaveLength(before - 7 + 6);
    expect(next.lastPlay).toMatchObject({ word: 'coaster', raided: true });
  });

  it('gives the returned letters fresh ids, so nothing collides with a tile in play', () => {
    const state = withVictimWord(0, 'jigsaw', 'coasterxyzab');
    const next = act(state, 0, { type: 'claim', tiles: idsFor(state, 'coaster'), steal: 0 }).state;
    const ids = next.pool.map((tile) => tile.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The comeback mechanic, and the whole reason it is the existing rule rather than a new one:
   * being behind makes you more dangerous, and taking the lead takes it away again.
   */
  it('lets whoever is behind raid one letter sooner', () => {
    const state = withVictimWord(0, 'jigsaw', 'coasterxyzab');
    // Player 0 has nothing and player 1 holds a 36-point word, so 0 is behind.
    expect(rules.getView(state, 0).yourRaidLength).toBe(RAID_LETTERS_BEHIND);
    expect(rules.getView(state, 1).yourRaidLength).toBe(RAID_LETTERS);

    // Six letters is over the discounted threshold, so this is allowed for the trailing player.
    const next = act(state, 0, { type: 'claim', tiles: idsFor(state, 'coaster'), steal: 0 }).state;
    expect(next.words[1]).toEqual([]);
  });

  it('takes the discount away the moment the trailing player is no longer behind', () => {
    const state = withVictimWord(0, 'cat', 'coasterxyzab');
    // 0 has nothing, 1 has a 9-point word: 0 is behind and gets the shorter threshold.
    expect(rules.getView(state, 0).yourRaidLength).toBe(RAID_LETTERS_BEHIND);
    const ahead: WordGameState = {
      ...state,
      words: [[{ word: 'jigsaw', golden: false, score: 36 }], state.words[1]],
    };
    expect(rules.getView(ahead, 0).yourRaidLength).toBe(RAID_LETTERS);
  });
});

describe('passing, and the end of the match', () => {
  it('ends when the bag is empty and both of them pass in a row', () => {
    let state = withPool(fresh(), 'zxqvwjkfmbgy', { bag: [] });
    const first = turnOf(state);

    const once = act(state, first, { type: 'pass' }).state;
    expect(once.complete).toBe(false);
    expect(once.passes).toBe(1);

    state = act(once, (1 - first) as PlayerIndex, { type: 'pass' }).state;
    expect(state.passes).toBe(2);
    expect(state.complete).toBe(true);
  });

  it('does not end on two passes while there are still letters to come', () => {
    // A pass also grows the pool toward POOL_MAX (see 'the pool on a pass' below), which now
    // draws from this same bag — ten letters is comfortably more than the six two passes can
    // consume, so there is still something left when the second one lands.
    let state = withPool(fresh(), 'zxqvwjkfmbgy', { bag: [...'abcdefghij'] });
    const first = turnOf(state);
    state = act(state, first, { type: 'pass' }).state;
    state = act(state, (1 - first) as PlayerIndex, { type: 'pass' }).state;
    expect(state.complete).toBe(false);
    expect(state.bag.length).toBeGreaterThan(0);
  });

  it('starts the pass count again when somebody actually plays', () => {
    let state = withPool(fresh(), 'coastxyzabcd', { bag: [] });
    const first = turnOf(state);
    state = act(state, first, { type: 'pass' }).state;
    expect(state.passes).toBe(1);
    state = act(state, (1 - first) as PlayerIndex, {
      type: 'claim',
      tiles: idsFor(state, 'coast'),
      steal: null,
    }).state;
    expect(state.passes).toBe(0);
    expect(state.complete).toBe(false);
  });

  it('stops on the turn cap even if neither of them ever passes', () => {
    // The backstop for having no move clock: without it, two players who never pass and never
    // exhaust the bag could sit in a match forever.
    // Enough letters that this one pass's pool growth (up to PASS_LETTERS of them) does not drain
    // the bag outright — the point of this test is the turn cap, not the bag.
    const base = withPool(fresh(), 'zxqvwjkfmbgy', { bag: [...'abcde'] });
    // Player 0 has already used their allowance; player 1 is one short. The bag is not empty, so
    // the ordinary both-passed ending cannot fire — only the cap can.
    const state: WordGameState = {
      ...base,
      turn: 1,
      turnsTaken: [MAX_TURNS_EACH, MAX_TURNS_EACH - 1],
    };
    const next = act(state, 1, { type: 'pass' }).state;
    expect(next.turnsTaken).toEqual([MAX_TURNS_EACH, MAX_TURNS_EACH]);
    expect(next.bag.length).toBeGreaterThan(0);
    expect(next.complete).toBe(true);
  });

  it('refuses everything once it is over', () => {
    let state = withPool(fresh(), 'zxqvwjkfmbgy', { bag: [] });
    const first = turnOf(state);
    state = act(state, first, { type: 'pass' }).state;
    state = act(state, (1 - first) as PlayerIndex, { type: 'pass' }).state;
    expect(refusal(state, first, { type: 'pass' })).toBe('That game is already over.');
  });
});

describe('the result', () => {
  it('names whoever holds the most, counting raid bonuses', () => {
    const state = fresh();
    const finished: WordGameState = {
      ...state,
      words: [[{ word: 'coast', golden: false, score: 25 }], [{ word: 'cat', golden: false, score: 9 }]],
      raidPoints: [0, RAID_BONUS],
      complete: true,
    };
    // 25 against 9 + 15: the raid bonus is what turns it round, which is the point of having it.
    const result = rules.getResult(finished);
    expect(result.scores).toEqual([25, 24]);
    expect(result.winner).toBe(0);
    expect(result.draw).toBe(false);
  });

  it('calls a level scoreline a draw', () => {
    const state = fresh();
    const level: WordGameState = {
      ...state,
      words: [[{ word: 'cat', golden: false, score: 9 }], [{ word: 'dog', golden: false, score: 9 }]],
      complete: true,
    };
    expect(rules.getResult(level)).toMatchObject({ draw: true, winner: null });
  });

  it('files itself casual, and scores competitive', () => {
    expect(rules.meta.category).toBe('casual');
    expect(rules.meta.scoringKind).toBe('competitive');
    expect(rules.meta.formatScore?.(1)).toBe('1 point');
    expect(rules.meta.formatScore?.(25)).toBe('25 points');
  });
});

describe('somebody drops', () => {
  it('keeps the table exactly as it was', () => {
    const start = withPool(fresh(), 'coastxyzabcd');
    const player = turnOf(start);
    const played = act(start, player, {
      type: 'claim',
      tiles: idsFor(start, 'coast'),
      steal: null,
    }).state;

    const resumed = rules.resume(rules.pause(played, 5_000), 9_000, context).state;
    expect(resumed.pool).toEqual(played.pool);
    expect(resumed.words).toEqual(played.words);
    expect(resumed.turn).toBe(played.turn);
  });
});

describe('the view', () => {
  it('shows each reader their own side, and both scores', () => {
    const start = withPool(fresh(), 'coastxyzabcd');
    const player = turnOf(start);
    const played = act(start, player, {
      type: 'claim',
      tiles: idsFor(start, 'coast'),
      steal: null,
    }).state;

    const mine = rules.getView(played, player);
    const theirs = rules.getView(played, (1 - player) as PlayerIndex);

    expect(mine.yourWords.map((word) => word.word)).toEqual(['coast']);
    expect(theirs.theirWords.map((word) => word.word)).toEqual(['coast']);
    expect(mine.yourScore).toBe(theirs.theirScore);
    // The turn is on the view even though the platform is not policing it with a clock.
    expect(mine.yourTurn).toBe(false);
    expect(theirs.yourTurn).toBe(true);
  });

  it('carries no dictionary, and no letter that is not on the table', () => {
    const view = rules.getView(withPool(fresh(), 'coastxyzabcd'), 0);
    expect(view.pool).toHaveLength(12);
    // A serialized frame is small: if the dictionary ever leaked into a view this would explode.
    expect(JSON.stringify(view).length).toBeLessThan(2_000);
  });
});

describe('the turn clock', () => {
  it('grows the finder allowance by TURN_BONUS_MS every time they find a word', () => {
    const state = withPool(fresh(), 'coastxyzabcd');
    const player = turnOf(state);
    const next = act(state, player, { type: 'claim', tiles: idsFor(state, 'coast'), steal: null }).state;

    expect(next.turnAllowanceMs[player]).toBe(TURN_START_MS + TURN_BONUS_MS);
    // The bonus is theirs alone — it says nothing about how long the other seat's turns are.
    expect(next.turnAllowanceMs[1 - player]).toBe(TURN_START_MS);
  });

  it('runs out, hands the turn over as a timeout rather than a chosen pass, and starts a fresh clock', () => {
    const state = withPool(fresh(), 'zxqvwjkfmbgy', { bag: [...'abc'] });
    const first = turnOf(state);

    const next = rules.tick(state, state.turnEndsAt!, context).state;

    expect(next.turn).toBe(1 - first);
    expect(next.passes).toBe(1);
    expect(next.log.at(-1)).toMatchObject({ by: first, word: null, timedOut: true });
    expect(next.turnEndsAt).toBe(state.turnEndsAt! + TURN_START_MS);
  });

  it('freezes on pause and hands back exactly what was left on resume', () => {
    const state = withPool(fresh(), 'coastxyzabcd');
    const paused = rules.pause(state, state.turnEndsAt! - 4_000);

    expect(paused.turnEndsAt).toBeNull();
    expect(paused.turnLeftMs).toBe(4_000);

    const resumed = rules.resume(paused, 100_000, context).state;
    expect(resumed.turnEndsAt).toBe(100_000 + 4_000);
    expect(resumed.turnLeftMs).toBeNull();
  });
});

describe('hints', () => {
  it('spends one, points at a real tile, and costs HINT_COST off the score', () => {
    const state = withPool(fresh(), 'catxyzqjkvbw');
    const player = turnOf(state);
    const before = state.hintsLeft[player];

    const next = act(state, player, { type: 'hint' }).state;

    expect(next.hintsLeft[player]).toBe(before - 1);
    expect(next.hintPenalty[player]).toBe(HINT_COST);
    expect(next.hint?.player).toBe(player);
    expect(state.pool.some((tile) => tile.id === next.hint?.tileId)).toBe(true);
    // It does not cost the turn.
    expect(next.turn).toBe(player);
  });

  it('emits an event, or the platform never pushes the new tile to either screen', () => {
    const state = withPool(fresh(), 'catxyzqjkvbw');
    const player = turnOf(state);

    const transition = act(state, player, { type: 'hint' });

    expect(transition.events.length).toBeGreaterThan(0);
  });

  it('is visible only to whoever paid for it', () => {
    const state = withPool(fresh(), 'catxyzqjkvbw');
    const player = turnOf(state);
    const next = act(state, player, { type: 'hint' }).state;

    expect(rules.getView(next, player).hintTileId).toBe(next.hint?.tileId);
    expect(rules.getView(next, (1 - player) as PlayerIndex).hintTileId).toBeNull();
  });

  it('refuses once none are left, without spending anything', () => {
    const base = withPool(fresh(), 'catxyzqjkvbw');
    const player = turnOf(base);
    const hintsLeft: [number, number] = [0, 0];
    const state: WordGameState = { ...base, hintsLeft };

    const next = act(state, player, { type: 'hint' }).state;
    expect(next.lastRejection[player]).toBe('NO_HINTS_LEFT');
    expect(next.hintPenalty[player]).toBe(0);
  });

  it('refuses when nothing on the table can make a word', () => {
    const state = withPool(fresh(), 'qqqqqqqqqqqq');
    const player = turnOf(state);

    const next = act(state, player, { type: 'hint' }).state;
    expect(next.lastRejection[player]).toBe('NO_HINT_AVAILABLE');
    expect(next.hintsLeft[player]).toBe(state.hintsLeft[player]);
  });

  it('is cleared the moment the turn changes', () => {
    const state = withPool(fresh(), 'coastxyzabcd');
    const player = turnOf(state);
    const hinted = act(state, player, { type: 'hint' }).state;
    expect(hinted.hint).not.toBeNull();

    const passed = act(hinted, player, { type: 'pass' }).state;
    expect(passed.hint).toBeNull();
  });
});

describe('the pool on a pass', () => {
  it('grows toward POOL_MAX before it starts swapping', () => {
    // Padded to POOL_SIZE rather than a bare literal, so this stays a pool "already at the normal
    // size" if that constant ever moves.
    const state = withPool(fresh(), 'coastxyzabcd'.padEnd(POOL_SIZE, 'e'), { bag: [...'aaaaaa'] });
    const player = turnOf(state);

    const next = act(state, player, { type: 'pass' }).state;

    expect(next.poolTarget).toBe(POOL_SIZE + PASS_LETTERS);
    expect(next.pool.length).toBe(POOL_SIZE + PASS_LETTERS);
    expect(next.bag.length).toBe(6 - PASS_LETTERS);
  });

  it('swaps PASS_LETTERS for fresh ones once the pool is already at POOL_MAX', () => {
    const base: WordGameState = withPool(fresh(), 'coastxyzabcdefghij'.padEnd(POOL_MAX, 'e'), {
      bag: [...'aaaaaa'],
      poolTarget: POOL_MAX,
    });
    const player = turnOf(base);
    const before = new Set(base.pool.map((tile) => tile.id));

    const next = act(base, player, { type: 'pass' }).state;

    expect(next.poolTarget).toBe(POOL_MAX);
    expect(next.pool).toHaveLength(POOL_MAX);
    const freshIds = next.pool.map((tile) => tile.id).filter((id) => !before.has(id));
    expect(freshIds).toHaveLength(PASS_LETTERS);
  });
});
