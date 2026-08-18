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
import { meta } from './meta';
import {
  COLOURS,
  FUSE_MS,
  MAX_STRIKES,
  STAGES,
  WIRES,
  type BombDefusalAction,
  type BombDefusalView,
  type Colour,
  type Role,
  type WireView,
} from './protocol';

/**
 * Bomb Defusal, decided entirely on the server — and, uniquely, **shown** differently to each of
 * them by it.
 *
 * ```text
 * six wires generated server-side → one of you is holding the bomb, the other the manual
 *   → the defuser taps a wire to tell the expert its colour
 *   → the expert reads the manual, works out which one, and points at it
 *   → the defuser cuts
 *   → right: on to the next bomb, roles swapped
 *   → wrong: a strike, and six fresh wires to start over on
 *   → three bombs defused, or three strikes, or the fuse runs out
 * ```
 *
 * **The manual never leaves this file** except as rendered sentences on the expert's screen. A
 * defuser holding the rules could read their own bomb and cut it alone, and a cooperative game one
 * person can win is not a cooperative game.
 *
 * **One fuse for the whole match.** A stage that goes quickly buys time for one that does not,
 * which is what makes the third bomb frightening rather than merely third. The fuse is the only
 * clock: `turnOf` names nobody, because the platform's move clock on top of a burning fuse would be
 * a second deadline that could end the match while the first one still had a minute on it.
 *
 * Nothing here reads a clock, holds a socket, or knows a user id. Seats `0` and `1`, six wires, and
 * which of them is looking at what.
 */

/**
 * The manual, in evaluation order: **the first rule that matches is the one that applies.**
 *
 * Written twice on purpose — once as a predicate the rules evaluate and once as the sentence the
 * expert reads — because the two audiences are different and neither should be derived from the
 * other. A generated sentence would read like a generated sentence, and a parsed sentence would be
 * a rules engine nobody asked for.
 *
 * Rule 3 is safe precisely because rule 1 comes first: reaching it means at least one red wire
 * exists, so "the last red wire" always names a wire.
 */
interface Rule {
  text: string;
  matches(wires: Colour[]): boolean;
  cut(wires: Colour[]): number;
}

const count = (wires: Colour[], colour: Colour) => wires.filter((wire) => wire === colour).length;

const lastIndexOfColour = (wires: Colour[], colour: Colour) => wires.lastIndexOf(colour);

const MANUAL: readonly Rule[] = [
  {
    text: 'If there are no RED wires — cut the SECOND wire.',
    matches: (wires) => count(wires, 'red') === 0,
    cut: () => 1,
  },
  {
    text: 'Otherwise, if the LAST wire is YELLOW and there are no BLUE wires — cut the FIRST wire.',
    matches: (wires) => wires[WIRES - 1] === 'yellow' && count(wires, 'blue') === 0,
    cut: () => 0,
  },
  {
    text: 'Otherwise, if there is exactly one BLUE wire — cut the LAST RED wire.',
    matches: (wires) => count(wires, 'blue') === 1,
    cut: (wires) => lastIndexOfColour(wires, 'red'),
  },
  {
    text: 'Otherwise, if there are two or more YELLOW wires — cut the LAST wire.',
    matches: (wires) => count(wires, 'yellow') >= 2,
    cut: () => WIRES - 1,
  },
  {
    text: 'Otherwise — cut the THIRD wire.',
    matches: () => true,
    cut: () => 2,
  },
];

/** The wire the manual says to cut. Exported for the tests, which check the rules rather than
 * re-implement them. */
export function correctWire(wires: Colour[]): number {
  // `MANUAL` ends in a rule that always matches, so this cannot fall through.
  const rule = MANUAL.find((candidate) => candidate.matches(wires))!;
  return rule.cut(wires);
}

/** What the expert reads. Sentences only — no predicate ever crosses the wire. */
export const MANUAL_TEXT: readonly string[] = MANUAL.map((rule) => rule.text);

interface StageState {
  number: number;
  wires: Colour[];
  /** Which wires the defuser has told the expert about. */
  reported: boolean[];
  /** Where the expert is pointing, or null. */
  pointedAt: number | null;
  /** The wire that ended this stage, once one has. */
  cut: number | null;
  defuser: PlayerIndex;
}

export interface BombDefusalState {
  stage: StageState;
  /** How many bombs have been defused. */
  solved: number;
  strikes: number;
  /** Epoch ms the fuse runs out, or null while it is frozen. */
  explodesAt: number | null;
  /** Milliseconds left on a frozen fuse. Null whenever the fuse is burning. */
  fuseLeftMs: number | null;
  lastCut: { wire: number; correct: boolean } | null;
  defused: boolean;
  exploded: boolean;
  complete: boolean;
}

/** Six wires, from the server's own randomness. Any combination is solvable — the manual's last
 * rule matches everything. */
function wireUp(context: GameContext): Colour[] {
  return Array.from({ length: WIRES }, () => {
    const index = Math.min(Math.floor(context.random() * COLOURS.length), COLOURS.length - 1);
    return COLOURS[index]!;
  });
}

function newStage(number: number, defuser: PlayerIndex, context: GameContext): StageState {
  return {
    number,
    wires: wireUp(context),
    reported: Array.from({ length: WIRES }, () => false),
    pointedAt: null,
    cut: null,
    defuser,
  };
}

function still(state: BombDefusalState): Transition<BombDefusalState> {
  return { state, events: [] };
}

const roleOf = (state: BombDefusalState, player: PlayerIndex): Role =>
  state.stage.defuser === player ? 'defuser' : 'expert';

export const rules: GameRules<BombDefusalState, BombDefusalAction, BombDefusalView> = {
  meta,

  reconnectPolicy: {
    windowMs: RECONNECT_WINDOW_MS,
    // A burning fuse must stop burning: the alternative is losing a bomb to somebody's wifi, and
    // it would take both of them with it, which is the worst way a cooperative game can end.
    pauseOnDisconnect: true,
    // Nobody to award it to (P-3) — the platform simply stops the session. Declared for the
    // contract's sake and because the tournament path reads it.
    onExpire: 'forfeit',
  },

  createMatch(now, context) {
    // The wires first, then the coin-flip, so the two draws are never confused for each other in a
    // test that stubs the sequence.
    const wires = wireUp(context);
    const defuser: PlayerIndex = context.random() < 0.5 ? 0 : 1;

    return {
      stage: {
        number: 1,
        wires,
        reported: Array.from({ length: WIRES }, () => false),
        pointedAt: null,
        cut: null,
        defuser,
      },
      solved: 0,
      strikes: 0,
      explodesAt: now + FUSE_MS,
      fuseLeftMs: null,
      lastCut: null,
      defused: false,
      exploded: false,
      complete: false,
    };
  },

  validateAction(state, player, action): ValidationResult<BombDefusalAction> {
    if (state.complete) {
      return { ok: false, code: 'invalid_game_state', message: 'That game is already over.' };
    }
    if (state.explodesAt === null) {
      return { ok: false, code: 'invalid_game_state', message: 'The game is paused.' };
    }

    const candidate = action as Partial<BombDefusalAction> | null;
    const wire = candidate?.wire;
    if (!candidate || typeof wire !== 'number' || !Number.isInteger(wire)) {
      return { ok: false, code: 'invalid_action', message: 'That is not a move in this game.' };
    }
    if (wire < 0 || wire >= WIRES) {
      return { ok: false, code: 'invalid_action', message: 'That wire is not on this bomb.' };
    }

    const role = roleOf(state, player);

    if (candidate.type === 'point') {
      // The one action the defuser must not have. Somebody who could point at their own bomb would
      // be playing both halves, which is the game solving itself.
      if (role !== 'expert') {
        return {
          ok: false,
          code: 'invalid_action',
          message: 'You are holding the bomb, not the manual.',
        };
      }
      return { ok: true, action: { type: 'point', wire } };
    }

    if (candidate.type === 'report' || candidate.type === 'cut') {
      if (role !== 'defuser') {
        return {
          ok: false,
          code: 'invalid_action',
          message: 'You are holding the manual, not the bomb.',
        };
      }
      if (candidate.type === 'report' && state.stage.reported[wire]) {
        return {
          ok: false,
          code: 'invalid_action',
          message: 'You have already told them that one.',
        };
      }
      return { ok: true, action: { type: candidate.type, wire } };
    }

    return { ok: false, code: 'invalid_action', message: 'That is not a move in this game.' };
  },

  applyAction(state, _player, action, _at, context) {
    const stage = state.stage;

    if (action.type === 'report') {
      const reported = [...stage.reported];
      reported[action.wire] = true;
      return {
        state: { ...state, stage: { ...stage, reported } },
        events: [{ type: EVENTS.game.stateUpdated }],
      };
    }

    if (action.type === 'point') {
      // Replaces rather than queues: an expert who has changed their mind means the new one, and a
      // list of past instructions on the defuser's screen is a way to cut the wrong wire.
      return {
        state: { ...state, stage: { ...stage, pointedAt: action.wire } },
        events: [{ type: EVENTS.game.stateUpdated }],
      };
    }

    const correct = action.wire === correctWire(stage.wires);
    const lastCut = { wire: action.wire, correct };

    if (!correct) {
      const strikes = state.strikes + 1;
      const exploded = strikes >= MAX_STRIKES;

      const events: GameEvent[] = [{ type: EVENTS.game.roundEnded }];
      if (exploded) events.push({ type: EVENTS.game.finished });

      return {
        state: {
          ...state,
          // Fresh wires rather than another go at the same six. Two spare strikes across six wires
          // is a brute force otherwise, and the point of the game is the conversation.
          stage: exploded
            ? { ...stage, cut: action.wire }
            : newStage(stage.number, stage.defuser, context),
          strikes,
          lastCut,
          exploded,
          complete: exploded,
        },
        events,
      };
    }

    const solved = state.solved + 1;
    const defused = solved >= STAGES;

    const events: GameEvent[] = [{ type: EVENTS.game.roundEnded }];
    if (defused) events.push({ type: EVENTS.game.finished });

    return {
      state: {
        ...state,
        // Roles swap every stage, so both of them hold the bomb and both of them read the manual
        // inside one match. Three stages does not divide evenly by two; the coin-flip at the start
        // is what evens it out across an evening.
        stage: defused
          ? { ...stage, cut: action.wire }
          : newStage(stage.number + 1, opponentOf(stage.defuser), context),
        solved,
        lastCut,
        defused,
        complete: defused,
      },
      events,
    };
  },

  tick(state, now) {
    if (state.complete || state.explodesAt === null) return still(state);
    if (now < state.explodesAt) return still(state);

    return {
      state: { ...state, exploded: true, complete: true },
      events: [{ type: EVENTS.game.finished }],
    };
  },

  nextTickAt(state) {
    if (state.complete) return null;
    return state.explodesAt;
  },

  /**
   * Nobody.
   *
   * There is already a clock, and it is the fuse. The platform's 120-second move clock on top of it
   * would be a second deadline running against one of them for no reason the game can justify —
   * both of them are always able to act here, and neither of them is ever the one being waited on.
   */
  turnOf() {
    return null;
  },

  /** Freeze the fuse where it is. A bomb that went off while somebody's phone reconnected would
   * take both of them with it. */
  pause(state, now) {
    if (state.complete || state.explodesAt === null) return state;

    return {
      ...state,
      fuseLeftMs: Math.max(0, state.explodesAt - now),
      explodesAt: null,
    };
  },

  /** Exactly what was left, no more and no less — unlike Memory's peek, there is nothing here that
   * anybody missed by being away. */
  resume(state, now) {
    if (state.complete || state.fuseLeftMs === null) return still(state);

    return {
      state: { ...state, explodesAt: now + state.fuseLeftMs, fuseLeftMs: null },
      events: [{ type: EVENTS.game.stateUpdated }],
    };
  },

  getView(state, player) {
    const role = roleOf(state, player);
    const stage = state.stage;

    const wires: WireView[] = stage.wires.map((colour, index) => ({
      // The fork this whole game is built on. The defuser is looking at the bomb, so they see every
      // wire; the expert sees only what they have been told, and the wires they have not been told
      // about are blank rather than absent — knowing there are six is not knowing what they are.
      colour: role === 'defuser' || stage.reported[index] ? colour : null,
      reported: stage.reported[index] ?? false,
      cut: stage.cut === index,
    }));

    return {
      role,
      stage: stage.number,
      stages: STAGES,
      strikes: state.strikes,
      maxStrikes: MAX_STRIKES,
      // Withheld while frozen: no clock is running, so a countdown on screen would be lying.
      explodesAt: state.explodesAt,
      paused: state.explodesAt === null && !state.complete,
      wires,
      manual: role === 'expert' ? MANUAL_TEXT : null,
      pointedAt: stage.pointedAt,
      lastCut: state.lastCut,
      outcome: !state.complete ? null : state.defused ? 'defused' : 'exploded',
      complete: state.complete,
    };
  },

  isComplete(state) {
    return state.complete;
  },

  getResult(state): GameResult {
    return {
      // P-3: cooperative. Both of them defused it or neither did, and the platform renders
      // "played together" rather than a scoreline.
      winner: null,
      draw: false,
      // The same number twice, deliberately: it is a shared result, and a margin of zero is the
      // truthful thing for "most competitive game" to see if it ever looks (it does not — P-3
      // keeps a cooperative match out of the margin statistics entirely).
      scores: [state.solved, state.solved],
    };
  },
};
