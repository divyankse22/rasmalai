import { EVENTS, RECONNECT_WINDOW_MS } from '@rasmalai/shared';
import {
  opponentOf,
  type GameContext,
  type GameEvent,
  type GameResult,
  type GameRules,
  type PlayerIndex,
  type Transition,
  type ValidationResult,
} from '../contract';
import { anyMakeableFrom, validate as validateWord } from './dictionary';
import { meta } from './meta';
import {
  GOLDEN_MULTIPLIER,
  HINTS_EACH,
  HINT_COST,
  MAX_TURNS_EACH,
  MIN_WORD,
  PASS_LETTERS,
  POOL_MAX,
  POOL_SIZE,
  RAID_BONUS,
  RAID_LETTERS,
  RAID_LETTERS_BEHIND,
  TURN_BONUS_MS,
  TURN_START_MS,
  type OwnedWord,
  type PlayLogEntry,
  type Tile,
  type WordGameAction,
  type WordGameView,
  type WordRejection,
} from './protocol';

/**
 * Word Game — the authoritative rulebook. Pure: no clock, no sockets, no randomness of its own.
 *
 * The shape of a turn: you are dealt a face-up pool of twelve letters, and on your move you either
 * claim a word from them or pass. A word of six letters or more also **breaks** one of your
 * partner's words — its tiles go back into the pool and you take a bonus for it. Whoever is behind
 * needs only five, so a lead is never safe and the game pulls itself back together.
 *
 * Two things are deliberately left as **seams** rather than built, because both are wanted later:
 *
 *   - `raidThreshold` and `applyRaid` are the entire stealing rule. A Snatch-style steal — extend a
 *     word your partner owns using all of its letters plus one from the pool — replaces those two
 *     functions and touches nothing else. `ClaimAction.steal` already names a word rather than a
 *     letter, which is the shape Snatch needs.
 *   - `mayAct` is the entire turn rule. It answers "may this seat move right now", and it is the
 *     only place the answer is decided. Alternating turns is `state.turn === player`; real-time
 *     claiming is `() => true` and a `turn` field nobody reads. Nothing else consults `state.turn`.
 *
 * Neither is implemented twice, and neither is abstracted behind an interface nobody needs yet.
 * They are single functions with a documented contract, which is the cheapest form of "open to
 * extension" that is actually true.
 *
 * **No move clock, on purpose.** `turnOf` returns null, so the platform never puts a thinking
 * player on its 120-second window — hunting for a word in twelve letters legitimately takes longer
 * than that, and since slice 11 a present player who runs out of move clock forfeits. The 120
 * seconds still applies to an actual disconnect, through `reconnectPolicy`, which is a different
 * mechanism entirely. `MAX_TURNS_EACH` is what keeps the match finite in the absence of a clock.
 */

/**
 * The letter bag: sixty tiles, vowel-heavy on purpose.
 *
 * Not Scrabble's distribution. Scrabble's assumes a board, blanks, and seven tiles in hand; twelve
 * face-up letters with no blanks needs more vowels or the pool locks up into consonant sludge that
 * neither player can do anything with. Roughly 42% vowels here against Scrabble's 42/100 — but
 * concentrated, because there are no blanks to rescue a bad pool.
 */
const BAG = [
  ...'aaaaaaaa',
  ...'eeeeeeeeee',
  ...'iiiiii',
  ...'oooooo',
  ...'uuu',
  ...'bb',
  ...'cccc',
  ...'dddd',
  ...'ffff',
  ...'ggg',
  ...'hhhh',
  ...'jk',
  ...'llll',
  ...'mmm',
  ...'nnnnnn',
  ...'pppp',
  ...'q',
  ...'rrrrrr',
  ...'ssssss',
  ...'tttttt',
  ...'vv',
  ...'www',
  ...'xz',
  ...'yy',
];

/** One completed turn, as the server records it. Resolved to the reader's side in `getView`. */
interface LogEntry {
  by: PlayerIndex;
  word: string | null;
  score: number;
  raided: string | null;
  timedOut: boolean;
}

interface WordGameState {
  /** Letters still face-down, in the order they will be dealt. */
  bag: string[];
  pool: Tile[];
  /**
   * How full the pool should be kept. Starts at `POOL_SIZE` and grows to `POOL_MAX` as people pass.
   *
   * One number does the whole dead-end rule: a pass either raises this (and `refill` fills it) or,
   * once it is at the ceiling, swaps letters instead. Nothing else had to change.
   */
  poolTarget: number;
  nextTileId: number;
  /** The one tile currently worth double, or null if the pool is empty. */
  goldenTileId: number | null;
  words: [OwnedWord[], OwnedWord[]];
  /** Bonus points banked from raids. Kept apart from word scores because a word can be broken. */
  raidPoints: [number, number];
  turn: PlayerIndex;
  /** Consecutive passes. Two, with an empty bag, ends it. */
  passes: number;
  /** Every word played this match, by either of them. No repeats. */
  used: string[];
  turnsTaken: [number, number];
  lastRejection: [WordRejection | null, WordRejection | null];
  lastPlay: { word: string; by: PlayerIndex; score: number; raided: boolean } | null;

  /** How long each seat's turns are. Grows by `TURN_BONUS_MS` every time that seat finds a word. */
  turnAllowanceMs: [number, number];
  /** Server epoch ms this turn runs out. Null only while the match is paused. */
  turnEndsAt: number | null;
  /** What was left of the turn when it froze, held across a pause and given back on resume. */
  turnLeftMs: number | null;

  hintsLeft: [number, number];
  /** Points spent on hints, kept apart from word scores because words can be broken. */
  hintPenalty: [number, number];
  /** The tile a hint is currently pointing at, and who paid for it. Cleared when the turn changes. */
  hint: { player: PlayerIndex; tileId: number } | null;

  log: LogEntry[];
  complete: boolean;
}

export type { WordGameState };

/** Fisher-Yates against the platform's seeded RNG, the same loop every other game uses. */
function shuffle<T>(items: readonly T[], context: GameContext): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.min(Math.floor(context.random() * (index + 1)), index);
    [out[index], out[swap]] = [out[swap]!, out[index]!];
  }
  return out;
}

const scoreOf = (word: string, golden: boolean): number =>
  word.length * word.length * (golden ? GOLDEN_MULTIPLIER : 1);

const wordScore = (words: readonly OwnedWord[]): number =>
  words.reduce((total, owned) => total + owned.score, 0);

/**
 * What a seat is worth right now: the words they still hold, plus raid bonuses, minus hints.
 *
 * Note this is also what `raidThreshold` reads, so spending a hint can push you far enough behind
 * to unlock the five-letter raid. That is emergent rather than designed — five points for a
 * situational one-letter discount is a fair trade, and it is written down in `docs/16_WORD_GAME.md`
 * rather than left to be discovered.
 */
const totalOf = (state: WordGameState, player: PlayerIndex): number =>
  wordScore(state.words[player]) + state.raidPoints[player] - state.hintPenalty[player];

/**
 * **Turn seam.** May this seat move right now?
 *
 * The only place the turn rule is decided. Alternating today; a real-time variant returns true here
 * and leaves `state.turn` unread. Nothing else in this file consults `state.turn`, so that swap is
 * genuinely one function.
 */
function mayAct(state: WordGameState, player: PlayerIndex): boolean {
  return state.turn === player;
}

/**
 * **Steal seam, part one.** How long a word this seat needs before it may break one of their
 * partner's.
 *
 * The comeback mechanic lives here and nowhere else: whoever is behind needs one letter fewer. A
 * Snatch-style rule would ignore length entirely and ask a different question — see `applyRaid`.
 */
function raidThreshold(state: WordGameState, player: PlayerIndex): number {
  const behind = totalOf(state, player) < totalOf(state, opponentOf(player));
  return behind ? RAID_LETTERS_BEHIND : RAID_LETTERS;
}

/**
 * **Steal seam, part two.** Break one of the partner's words and return its letters to the pool.
 *
 * "Steal letters" resolved as "take their letters out of their hands and back into play", which is
 * both simpler than moving individual tiles around and harsher: the word is gone, and everything it
 * was worth goes with it. The raider banks `RAID_BONUS` rather than the word's value, so breaking a
 * long word is not worth more than breaking a short one — the damage is the point, not the loot.
 *
 * A Snatch implementation replaces this entire function: it would take the target's tiles into the
 * *raider's* new word rather than back to the pool, and `raidThreshold` would be dropped for a
 * "does the new word contain all of the old one, plus a pool letter" check.
 */
function applyRaid(
  state: WordGameState,
  raider: PlayerIndex,
  target: number,
): { words: [OwnedWord[], OwnedWord[]]; returned: Tile[]; raidPoints: [number, number] } {
  const victim = opponentOf(raider);
  const broken = state.words[victim][target]!;

  const words: [OwnedWord[], OwnedWord[]] = [[...state.words[0]], [...state.words[1]]];
  words[victim] = words[victim].filter((_, index) => index !== target);

  // The letters come back face-up rather than being discarded, so a raid feeds the pool it emptied
  // and the endgame does not starve.
  const returned: Tile[] = [];
  const raidPoints: [number, number] = [...state.raidPoints];
  raidPoints[raider] += RAID_BONUS;

  return { words, returned: returned.concat(lettersOf(broken.word, state)), raidPoints };
}

/** Fresh tiles for the letters of a broken word. New ids: these are not the tiles that made it. */
function lettersOf(word: string, state: WordGameState): Tile[] {
  return [...word].map((letter, offset) => ({
    id: state.nextTileId + offset,
    letter,
    golden: false,
  }));
}

/** Deal the pool back up to size, and make sure exactly one tile is golden. */
function refill(state: WordGameState, context: GameContext): void {
  while (state.pool.length < state.poolTarget && state.bag.length > 0) {
    state.pool.push({ id: state.nextTileId, letter: state.bag.shift()!, golden: false });
    state.nextTileId += 1;
  }

  const stillGolden = state.pool.some((tile) => tile.id === state.goldenTileId);
  if (stillGolden || state.pool.length === 0) {
    if (state.pool.length === 0) state.goldenTileId = null;
    return;
  }

  // The old golden tile was played, so a new one is chosen from what is now on the table. Server
  // randomness, so both screens agree without either being told to agree.
  const pick = Math.min(Math.floor(context.random() * state.pool.length), state.pool.length - 1);
  const chosen = state.pool[pick]!;
  chosen.golden = true;
  state.goldenTileId = chosen.id;
}

function still(state: WordGameState): Transition<WordGameState> {
  return { state, events: [] };
}

const outOfTurns = (state: WordGameState): boolean =>
  state.turnsTaken[0] >= MAX_TURNS_EACH && state.turnsTaken[1] >= MAX_TURNS_EACH;

/** The match is over when the bag is empty and neither of them wants anything, or on the cap. */
const isOver = (state: WordGameState): boolean =>
  (state.bag.length === 0 && state.passes >= 2) || outOfTurns(state);

function withRejection(
  state: WordGameState,
  player: PlayerIndex,
  reason: WordRejection,
): WordGameState {
  const lastRejection: [WordRejection | null, WordRejection | null] = [...state.lastRejection];
  lastRejection[player] = reason;
  return { ...state, lastRejection };
}

export const rules: GameRules<WordGameState, WordGameAction, WordGameView> = {
  meta,

  reconnectPolicy: {
    windowMs: RECONNECT_WINDOW_MS,
    // Nothing is running down — there is no clock in this game at all — so there is nothing to
    // freeze. A claimed word is a fact and the pool does not move while somebody is away.
    pauseOnDisconnect: false,
    // The one place 120 seconds still bites: an actual disconnect. A competitive game, so the
    // platform hands the win to whoever stayed.
    onExpire: 'forfeit',
  },

  createMatch(_now, context) {
    const state: WordGameState = {
      bag: shuffle(BAG, context),
      pool: [],
      nextTileId: 0,
      goldenTileId: null,
      words: [[], []],
      raidPoints: [0, 0],
      turn: context.random() < 0.5 ? 0 : 1,
      passes: 0,
      used: [],
      turnsTaken: [0, 0],
      lastRejection: [null, null],
      lastPlay: null,
      complete: false,
    };

    refill(state, context);
    return state;
  },

  validateAction(state, player, action): ValidationResult<WordGameAction> {
    if (state.complete) {
      return { ok: false, code: 'invalid_game_state', message: 'That game is already over.' };
    }

    const candidate = action as Partial<WordGameAction> | null;
    if (!candidate) {
      return { ok: false, code: 'invalid_action', message: 'That is not a move in this game.' };
    }

    if (!mayAct(state, player)) {
      return { ok: false, code: 'invalid_action', message: 'It is not your turn.' };
    }

    if (candidate.type === 'pass') return { ok: true, action: { type: 'pass' } };

    if (candidate.type !== 'claim') {
      return { ok: false, code: 'invalid_action', message: 'That is not a move in this game.' };
    }

    const tiles = candidate.tiles;
    if (!Array.isArray(tiles) || tiles.length < MIN_WORD) {
      return { ok: false, code: 'invalid_action', message: 'A word is at least three letters.' };
    }
    if (new Set(tiles).size !== tiles.length) {
      return { ok: false, code: 'invalid_action', message: 'You used a letter twice.' };
    }
    // Every tile must be one that is actually face-up. This is what makes "do you possess these
    // letters" structural: the word is built from the pool by the server, never sent by the client.
    for (const id of tiles) {
      if (typeof id !== 'number' || !state.pool.some((tile) => tile.id === id)) {
        return { ok: false, code: 'invalid_action', message: 'Those letters are not on the table.' };
      }
    }

    const steal = candidate.steal ?? null;
    if (steal !== null) {
      if (typeof steal !== 'number' || !Number.isInteger(steal)) {
        return { ok: false, code: 'invalid_action', message: 'That is not one of their words.' };
      }
      if (steal < 0 || steal >= state.words[opponentOf(player)].length) {
        return { ok: false, code: 'invalid_action', message: 'That is not one of their words.' };
      }
      if (tiles.length < raidThreshold(state, player)) {
        return {
          ok: false,
          code: 'invalid_action',
          message: `A raid needs ${raidThreshold(state, player)} letters.`,
        };
      }
    }

    return { ok: true, action: { type: 'claim', tiles: [...tiles], steal } };
  },

  applyAction(state, player, action, _at, context) {
    if (action.type === 'pass') {
      const passes = state.passes + 1;
      const turnsTaken: [number, number] = [...state.turnsTaken];
      turnsTaken[player] += 1;

      const next: WordGameState = {
        ...state,
        passes,
        turnsTaken,
        turn: opponentOf(player),
        lastRejection: [null, null],
      };
      const complete = isOver(next);

      return {
        state: { ...next, complete },
        events: complete
          ? [{ type: EVENTS.game.finished }]
          : [{ type: EVENTS.game.stateUpdated }],
      };
    }

    const chosen = action.tiles.map((id) => state.pool.find((tile) => tile.id === id)!);
    const word = chosen.map((tile) => tile.letter).join('');

    // Everything below this point is a refusal that costs the player their turn only if we let it,
    // and we do not: a bad word is told to them and the turn stays theirs. Only a legal claim or a
    // pass advances the game.
    const verdict = validateWord(word);
    if (!verdict.valid) return still(withRejection(state, player, verdict.reason));
    if (state.used.includes(word)) {
      return still(withRejection(state, player, 'ALREADY_USED'));
    }

    const golden = chosen.some((tile) => tile.golden);
    const score = scoreOf(word, golden);
    const claimed: OwnedWord = { word, golden, score };

    let words: [OwnedWord[], OwnedWord[]] = [[...state.words[0]], [...state.words[1]]];
    let raidPoints: [number, number] = [...state.raidPoints];
    let returned: Tile[] = [];

    const working: WordGameState = { ...state, nextTileId: state.nextTileId };

    if (action.steal !== null) {
      const raid = applyRaid(working, player, action.steal);
      words = raid.words;
      raidPoints = raid.raidPoints;
      returned = raid.returned;
      working.nextTileId += returned.length;
    }

    words[player] = [...words[player], claimed];

    const taken = new Set(action.tiles);
    const turnsTaken: [number, number] = [...state.turnsTaken];
    turnsTaken[player] += 1;

    const next: WordGameState = {
      ...state,
      pool: [...state.pool.filter((tile) => !taken.has(tile.id)), ...returned],
      nextTileId: working.nextTileId,
      words,
      raidPoints,
      turn: opponentOf(player),
      // A claim is somebody wanting something, so the pass count starts again.
      passes: 0,
      used: [...state.used, word],
      turnsTaken,
      lastRejection: [null, null],
      lastPlay: { word, by: player, score, raided: action.steal !== null },
      complete: false,
    };

    refill(next, context);
    next.complete = isOver(next);

    const events: GameEvent[] = [{ type: EVENTS.game.roundEnded }];
    if (next.complete) events.push({ type: EVENTS.game.finished });

    return { state: next, events };
  },

  // No clock of any kind: the game waits on a person, and never on time passing.
  tick(state) {
    return still(state);
  },

  nextTickAt() {
    return null;
  },

  /**
   * Nobody, ever — and that is the point.
   *
   * Naming a seat here would put them on the platform's 120-second move window, and since slice 11
   * a present player who runs it out forfeits. Finding a word in twelve letters legitimately takes
   * longer than two minutes, so this game declines the clock outright. Whose turn it is still
   * reaches the screen, through `yourTurn` on the view; it simply is not enforced with a stopwatch.
   *
   * The 120 seconds that still applies is `reconnectPolicy.windowMs`, for somebody who has actually
   * gone. That is a presence mechanism and has nothing to do with this one.
   */
  turnOf() {
    return null;
  },

  pause(state) {
    return state;
  },

  resume(state) {
    return still(state);
  },

  getView(state, player) {
    const them = opponentOf(player);

    return {
      pool: state.pool.map((tile) => ({ ...tile })),
      bagLeft: state.bag.length,
      yourTurn: mayAct(state, player),
      yourWords: state.words[player].map((owned) => ({ ...owned })),
      theirWords: state.words[them].map((owned) => ({ ...owned })),
      yourScore: totalOf(state, player),
      theirScore: totalOf(state, them),
      yourRaidLength: raidThreshold(state, player),
      passes: state.passes,
      lastRejection: state.lastRejection[player],
      lastPlay: state.lastPlay
        ? {
            word: state.lastPlay.word,
            byYou: state.lastPlay.by === player,
            score: state.lastPlay.score,
            raided: state.lastPlay.raided,
          }
        : null,
      complete: state.complete,
    };
  },

  isComplete(state) {
    return state.complete;
  },

  getResult(state): GameResult {
    const zero = totalOf(state, 0);
    const one = totalOf(state, 1);

    return {
      winner: zero === one ? null : zero > one ? 0 : 1,
      draw: zero === one,
      scores: [zero, one],
    };
  },
};
