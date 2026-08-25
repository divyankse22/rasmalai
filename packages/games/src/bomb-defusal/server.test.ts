import { describe, expect, it } from 'vitest';
import { EVENTS } from '@rasmalai/shared';
import type { GameContext, PlayerIndex, Transition } from '../contract';
import { FUSE_MS, MAX_STRIKES, STAGES, WIRES, type Colour } from './protocol';
import { correctWire, MANUAL_TEXT, rules, type BombDefusalState } from './server';

/**
 * The rules are pure, so a whole bomb is defused here with no timers and no sockets.
 *
 * Two things in this file matter more than the rest. One is the manual: it decides the game, and
 * every branch of it is checked against a hand-built set of wires rather than against itself. The
 * other is the fork in `getView` — the expert must not be able to see the bomb, the defuser must
 * not be able to read the manual, and neither may act as the other. A single leak either way and
 * this stops being a game two people have to play together.
 */

/** Zeroes: every wire red, and seat 0 holding the bomb. */
const context: GameContext = { random: () => 0 };

const ALICE: PlayerIndex = 0;
const BOB: PlayerIndex = 1;

const AT = { receivedAt: 0, compensationMs: 0 };

/** A bomb with wires we chose, so a test can name the rule it is exercising. */
function bomb(wires: Colour[], overrides: Partial<BombDefusalState> = {}): BombDefusalState {
  return {
    stage: {
      number: 1,
      wires,
      reported: Array.from({ length: WIRES }, () => false),
      pointedAt: null,
      cut: null,
      defuser: ALICE,
    },
    solved: 0,
    strikes: 0,
    explodesAt: FUSE_MS,
    fuseLeftMs: null,
    lastCut: null,
    defused: false,
    exploded: false,
    complete: false,
    ...overrides,
  };
}

function act(
  state: BombDefusalState,
  player: PlayerIndex,
  action: unknown,
): Transition<BombDefusalState> {
  const validation = rules.validateAction(state, player, action);
  if (!validation.ok) throw new Error(`refused: ${validation.code} — ${validation.message}`);
  return rules.applyAction(state, player, validation.action, AT, context);
}

const refusal = (state: BombDefusalState, player: PlayerIndex, action: unknown) => {
  const result = rules.validateAction(state, player, action);
  if (result.ok) throw new Error('expected the move to be refused');
  return result;
};

const types = (transition: Transition<BombDefusalState>) =>
  transition.events.map((event) => event.type);

/** Who is holding the manual on this bomb. */
const expertOf = (state: BombDefusalState): PlayerIndex => (state.stage.defuser === 0 ? 1 : 0);

const R: Colour = 'red';
const B: Colour = 'blue';
const Y: Colour = 'yellow';
const W: Colour = 'white';

describe('the manual', () => {
  it('cuts the second wire when there are no red wires', () => {
    expect(correctWire([B, W, B, Y, W, B])).toBe(1);
  });

  it('cuts the first wire when the last is yellow and there are no blues', () => {
    expect(correctWire([R, W, W, R, W, Y])).toBe(0);
    // …but only when rule 1 did not already fire. No reds means rule 1 wins, even here.
    expect(correctWire([W, W, W, W, W, Y])).toBe(1);
  });

  it('cuts the last red wire when there is exactly one blue', () => {
    expect(correctWire([R, B, W, R, W, W])).toBe(3);
    // Reaching rule 3 guarantees a red exists, because rule 1 catches the boards with none.
    expect(correctWire([W, B, W, W, R, W])).toBe(4);
  });

  it('cuts the last wire when two or more are yellow', () => {
    expect(correctWire([R, Y, W, Y, B, B])).toBe(WIRES - 1);
  });

  it('falls through to the third wire', () => {
    expect(correctWire([R, W, W, B, B, W])).toBe(2);
  });

  it('always names a wire that is actually on the bomb, for every board', () => {
    // The rules are ordered and the last one matches everything, so no combination can fall
    // through — but "no combination" is a claim worth checking rather than asserting.
    const colours: Colour[] = [R, B, Y, W];
    let checked = 0;

    for (const a of colours)
      for (const b of colours)
        for (const c of colours)
          for (const d of colours) {
            // The first four vary; the last two sweep separately, which is enough to reach every
            // rule without enumerating four thousand boards.
            for (const tail of [
              [R, R],
              [Y, Y],
              [B, W],
              [W, Y],
            ] as Colour[][]) {
              const wires = [a, b, c, d, tail[0]!, tail[1]!];
              const answer = correctWire(wires);
              expect(Number.isInteger(answer)).toBe(true);
              expect(answer).toBeGreaterThanOrEqual(0);
              expect(answer).toBeLessThan(WIRES);
              checked += 1;
            }
          }

    expect(checked).toBe(4 ** 4 * 4);
  });
});

describe('the two of them are looking at different screens', () => {
  it('shows the defuser every wire and the expert none of them', () => {
    const state = bomb([R, B, Y, W, R, B]);

    const defuser = rules.getView(state, ALICE);
    const expert = rules.getView(state, BOB);

    expect(defuser.role).toBe('defuser');
    expect(expert.role).toBe('expert');

    expect(defuser.wires.map((wire) => wire.colour)).toEqual([R, B, Y, W, R, B]);
    // Six wires, and not one colour among them. The expert knows how many there are and nothing
    // else, which is exactly as much as somebody on the other end of a phone would know.
    expect(expert.wires).toHaveLength(WIRES);
    expect(expert.wires.every((wire) => wire.colour === null)).toBe(true);
  });

  it('gives the manual to the expert and never to the defuser', () => {
    const state = bomb([R, B, Y, W, R, B]);

    expect(rules.getView(state, BOB).manual).toEqual(MANUAL_TEXT);
    // The single most important null in this game: a defuser holding the manual defuses it alone.
    expect(rules.getView(state, ALICE).manual).toBeNull();
  });

  it('sends a colour across only when the defuser reports it', () => {
    const state = bomb([R, B, Y, W, R, B]);
    const told = act(state, ALICE, { type: 'report', wire: 2 }).state;

    const expert = rules.getView(told, BOB);
    expect(expert.wires[2]!.colour).toBe(Y);
    expect(expert.wires[2]!.reported).toBe(true);
    // And still nothing about the other five.
    expect(expert.wires.filter((wire) => wire.colour !== null)).toHaveLength(1);

    // Both of them can see that it has been reported — that is the shared half of the channel.
    expect(rules.getView(told, ALICE).wires[2]!.reported).toBe(true);
  });

  it('swaps who sees what when the roles swap', () => {
    const state = bomb([B, W, B, Y, W, B]);
    const solved = act(state, ALICE, { type: 'cut', wire: correctWire(state.stage.wires) }).state;

    expect(solved.stage.defuser).toBe(BOB);
    expect(rules.getView(solved, BOB).role).toBe('defuser');
    expect(rules.getView(solved, BOB).manual).toBeNull();
    expect(rules.getView(solved, ALICE).manual).toEqual(MANUAL_TEXT);
    expect(rules.getView(solved, ALICE).wires.every((wire) => wire.colour === null)).toBe(true);
  });
});

describe('neither of them can play the other half', () => {
  it('refuses a cut or a report from the expert', () => {
    const state = bomb([R, B, Y, W, R, B]);
    expect(refusal(state, BOB, { type: 'cut', wire: 0 }).message).toBe(
      'You are holding the manual, not the bomb.',
    );
    expect(refusal(state, BOB, { type: 'report', wire: 0 }).code).toBe('invalid_action');
  });

  it('refuses the defuser pointing at their own bomb', () => {
    const state = bomb([R, B, Y, W, R, B]);
    expect(refusal(state, ALICE, { type: 'point', wire: 3 }).message).toBe(
      'You are holding the bomb, not the manual.',
    );
  });

  it('refuses a wire that is not on the bomb, and anything that is not a move', () => {
    const state = bomb([R, B, Y, W, R, B]);
    expect(refusal(state, ALICE, { type: 'cut', wire: WIRES }).code).toBe('invalid_action');
    expect(refusal(state, ALICE, { type: 'cut', wire: -1 }).code).toBe('invalid_action');
    expect(refusal(state, ALICE, { type: 'cut', wire: 1.5 }).code).toBe('invalid_action');
    expect(refusal(state, ALICE, { type: 'defuse', wire: 1 }).code).toBe('invalid_action');
    expect(refusal(state, ALICE, null).code).toBe('invalid_action');
  });

  it('refuses reporting the same wire twice', () => {
    const told = act(bomb([R, B, Y, W, R, B]), ALICE, { type: 'report', wire: 1 }).state;
    expect(refusal(told, ALICE, { type: 'report', wire: 1 }).message).toBe(
      'You have already told them that one.',
    );
  });
});

describe('pointing', () => {
  it('shows both of them where the expert is pointing', () => {
    const state = bomb([R, B, Y, W, R, B]);
    const pointed = act(state, BOB, { type: 'point', wire: 4 }).state;

    expect(rules.getView(pointed, ALICE).pointedAt).toBe(4);
    expect(rules.getView(pointed, BOB).pointedAt).toBe(4);
  });

  it('replaces the instruction rather than queueing another one', () => {
    let state = bomb([R, B, Y, W, R, B]);
    state = act(state, BOB, { type: 'point', wire: 4 }).state;
    state = act(state, BOB, { type: 'point', wire: 1 }).state;
    expect(state.stage.pointedAt).toBe(1);
  });

  it('does not stop the defuser cutting something else entirely', () => {
    // It is their bomb. The expert advises; nobody overrules the person holding the cutters.
    const wires: Colour[] = [B, W, B, Y, W, B];
    const answer = correctWire(wires);
    const pointed = act(bomb(wires), BOB, { type: 'point', wire: (answer + 1) % WIRES }).state;

    const cut = act(pointed, ALICE, { type: 'cut', wire: answer });
    expect(cut.state.solved).toBe(1);
  });
});

describe('cutting', () => {
  it('moves to the next bomb, with fresh wires and the roles swapped', () => {
    const wires: Colour[] = [B, W, B, Y, W, B];
    const state = act(bomb(wires), ALICE, { type: 'cut', wire: correctWire(wires) });

    expect(types(state)).toEqual([EVENTS.game.roundEnded]);
    expect(state.state.solved).toBe(1);
    expect(state.state.strikes).toBe(0);
    expect(state.state.stage.number).toBe(2);
    expect(state.state.stage.defuser).toBe(BOB);
    expect(state.state.stage.pointedAt).toBeNull();
    expect(state.state.stage.reported.filter(Boolean)).toHaveLength(0);
    expect(state.state.lastCut).toEqual({ wire: correctWire(wires), correct: true });
  });

  it('takes a strike and rebuilds the bomb on a wrong cut', () => {
    const wires: Colour[] = [B, W, B, Y, W, B];
    const wrong = (correctWire(wires) + 1) % WIRES;

    let state = bomb(wires);
    state = act(state, ALICE, { type: 'report', wire: 0 }).state;
    state = act(state, BOB, { type: 'point', wire: wrong }).state;

    const struck = act(state, ALICE, { type: 'cut', wire: wrong });

    expect(struck.state.strikes).toBe(1);
    expect(struck.state.solved).toBe(0);
    expect(struck.state.complete).toBe(false);
    expect(struck.state.lastCut).toEqual({ wire: wrong, correct: false });
    // Same stage, same defuser, brand new bomb — and everything they had established about the old
    // one is gone with it, which is what stops two spare strikes being a brute force.
    expect(struck.state.stage.number).toBe(1);
    expect(struck.state.stage.defuser).toBe(ALICE);
    expect(struck.state.stage.reported.filter(Boolean)).toHaveLength(0);
    expect(struck.state.stage.pointedAt).toBeNull();
  });

  it('goes off on the third strike', () => {
    const wires: Colour[] = [B, W, B, Y, W, B];
    const state = bomb(wires, { strikes: MAX_STRIKES - 1 });
    const wrong = (correctWire(wires) + 1) % WIRES;

    const boom = act(state, ALICE, { type: 'cut', wire: wrong });

    expect(types(boom)).toEqual([EVENTS.game.roundEnded, EVENTS.game.finished]);
    expect(boom.state.exploded).toBe(true);
    expect(boom.state.complete).toBe(true);
    expect(rules.isComplete(boom.state)).toBe(true);
    expect(rules.getView(boom.state, ALICE).outcome).toBe('exploded');
    expect(rules.getView(boom.state, BOB).outcome).toBe('exploded');
    expect(refusal(boom.state, ALICE, { type: 'cut', wire: 0 }).code).toBe('invalid_game_state');
  });

  it('is defused when the third bomb goes', () => {
    const wires: Colour[] = [B, W, B, Y, W, B];
    const state = bomb(wires, {
      solved: STAGES - 1,
      stage: { ...bomb(wires).stage, number: STAGES },
    });

    const done = act(state, ALICE, { type: 'cut', wire: correctWire(wires) });

    expect(types(done)).toEqual([EVENTS.game.roundEnded, EVENTS.game.finished]);
    expect(done.state.defused).toBe(true);
    expect(done.state.solved).toBe(STAGES);
    expect(rules.getView(done.state, ALICE).outcome).toBe('defused');
    expect(rules.getView(done.state, BOB).outcome).toBe('defused');
    // The wire that ended it stays on screen, cut.
    expect(rules.getView(done.state, ALICE).wires.filter((wire) => wire.cut)).toHaveLength(1);
  });
});

describe('the fuse', () => {
  it('is the only clock the game asks for', () => {
    const state = bomb([R, B, Y, W, R, B]);
    expect(rules.nextTickAt(state)).toBe(FUSE_MS);
    // And nobody is on the platform's move clock underneath it.
    expect(rules.turnOf(state)).toBeNull();
  });

  it('does nothing until it runs out, then goes off', () => {
    const state = bomb([R, B, Y, W, R, B]);
    expect(rules.tick(state, FUSE_MS - 1, context).state).toBe(state);

    const boom = rules.tick(state, FUSE_MS, context);
    expect(types(boom)).toEqual([EVENTS.game.finished]);
    expect(boom.state.exploded).toBe(true);
    expect(boom.state.complete).toBe(true);
    expect(rules.nextTickAt(boom.state)).toBeNull();
  });

  it('freezes where it is when somebody drops, and refuses moves meanwhile', () => {
    const state = bomb([R, B, Y, W, R, B], { explodesAt: 100_000 });
    const paused = rules.pause(state, 40_000);

    expect(paused.explodesAt).toBeNull();
    expect(paused.fuseLeftMs).toBe(60_000);
    expect(rules.nextTickAt(paused)).toBeNull();
    // No clock is running, so nothing may be cut and the screen shows no deadline.
    expect(refusal(paused, ALICE, { type: 'cut', wire: 0 }).code).toBe('invalid_game_state');
    expect(rules.getView(paused, ALICE).explodesAt).toBeNull();
    expect(rules.getView(paused, ALICE).paused).toBe(true);

    // And a tick while frozen cannot detonate it.
    expect(rules.tick(paused, 9_999_999, context).state).toBe(paused);
  });

  it('gives back exactly what was left when they come back', () => {
    const state = bomb([R, B, Y, W, R, B], { explodesAt: 100_000 });
    const back = rules.resume(rules.pause(state, 40_000), 500_000, context);

    expect(back.state.explodesAt).toBe(560_000);
    expect(back.state.fuseLeftMs).toBeNull();
    expect(types(back)).toEqual([EVENTS.game.stateUpdated]);
    expect(rules.getView(back.state, ALICE).paused).toBe(false);
  });
});

describe('what it is worth', () => {
  it('names no winner and reports the same score to both of them (P-3)', () => {
    const wires: Colour[] = [B, W, B, Y, W, B];
    const state = bomb(wires, {
      solved: STAGES - 1,
      stage: { ...bomb(wires).stage, number: STAGES },
    });
    const done = act(state, ALICE, { type: 'cut', wire: correctWire(wires) }).state;

    expect(rules.getResult(done)).toEqual({ winner: null, draw: false, scores: [STAGES, STAGES] });
  });

  it('counts the bombs that were defused when it goes off', () => {
    const wires: Colour[] = [B, W, B, Y, W, B];
    const state = bomb(wires, { solved: 1, strikes: MAX_STRIKES - 1 });
    const boom = act(state, ALICE, { type: 'cut', wire: (correctWire(wires) + 1) % WIRES }).state;

    expect(rules.getResult(boom)).toEqual({ winner: null, draw: false, scores: [1, 1] });
  });

  it('files itself as cooperative', () => {
    expect(rules.meta.category).toBe('cooperative');
    expect(rules.meta.scoringKind).toBe('cooperative');
  });
});

describe('a fresh bomb', () => {
  it('starts the fuse from now and coin-flips who is holding it', () => {
    const started = rules.createMatch(1_000, { random: () => 0 });
    expect(started.explodesAt).toBe(1_000 + FUSE_MS);
    expect(started.stage.defuser).toBe(ALICE);
    expect(started.stage.number).toBe(1);
    expect(started.strikes).toBe(0);
    expect(expertOf(started)).toBe(BOB);

    expect(rules.createMatch(0, { random: () => 0.9 }).stage.defuser).toBe(BOB);
  });

  it('wires it from the server’s randomness, six wires of real colours', () => {
    const sequence = (values: number[]): GameContext => {
      let index = 0;
      return { random: () => values[index++ % values.length]! };
    };

    const state = rules.createMatch(0, sequence([0.05, 0.3, 0.55, 0.8, 0.99, 0.4, 0.1]));
    expect(state.stage.wires).toHaveLength(WIRES);
    expect(state.stage.wires.every((wire) => [R, B, Y, W].includes(wire))).toBe(true);
  });
});
