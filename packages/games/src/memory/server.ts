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
  CARDS,
  COLUMNS,
  FACES,
  PAIRS,
  PEEK_MS,
  ROWS,
  type MemoryAction,
  type MemoryCard,
  type MemoryView,
} from './protocol';

/**
 * Memory, decided entirely on the server — and, more to the point, **known** only by the server.
 *
 * ```text
 * deck shuffled server-side → server coin-flips who goes first
 *   → the player whose turn it is turns one card over, then another
 *   → a pair is theirs and they go again
 *   → a mismatch shows for 1.6s and the turn passes
 *   → all ten pairs found → whoever has more of them wins
 * ```
 *
 * The layout never leaves this file. `getView` fills in a card's face for exactly two reasons — it
 * is turned over right now, or somebody has already claimed it — so the frame on the wire carries no
 * more than the screen does. Both previous games could have leaked their whole state to a client
 * and lost nothing by it; this one could be beaten with a network tab, which is why the contract
 * separates `State` from `View` at all.
 *
 * The one clock it asks for is the peek: the pause where a mismatched pair is visible before it
 * turns back. That is server-owned like everything else, so neither player gets a longer look than
 * the other for having a better connection.
 *
 * Nothing here reads a clock, holds a socket, or knows a user id. Seats `0` and `1`, twenty cards,
 * and whose turn it is.
 */

export interface MemoryState {
  /**
   * The face on each card, by card index. **The secret**, and the only reason this game is not
   * trivial. Nothing outside this file ever sees it whole.
   */
  faces: number[];
  /** Who claimed each card, or null while it is still in play. */
  matchedBy: (PlayerIndex | null)[];
  /** The cards turned over as part of the move in progress: none, one, or a pair being judged. */
  faceUp: number[];
  turn: PlayerIndex;
  startedBy: PlayerIndex;
  pairsWon: [number, number];
  /** Epoch ms a mismatched pair turns back over, or null when nothing is being looked at. */
  peekUntil: number | null;
  /** Whether the pair that last completed a move matched. Null before the first pair is judged. */
  lastFlipMatched: boolean | null;
  paused: boolean;
  complete: boolean;
}

/**
 * A shuffled deck: each of the ten faces twice, in a server-decided order.
 *
 * Fisher–Yates over the platform's randomness rather than `Math.random`, for the same reason
 * Reaction Speed's arming delay is: this is the one thing standing between the game and a client
 * that can work out the layout for itself.
 */
function shuffledDeck(context: GameContext): number[] {
  const deck: number[] = [];
  for (let face = 0; face < PAIRS; face += 1) deck.push(face, face);

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(context.random() * (index + 1));
    // `random()` is documented as [0, 1), but a stub that returns exactly 1 would index off the end
    // and put an `undefined` in the deck. Cheaper to clamp than to debug.
    const target = Math.min(swap, index);
    [deck[index], deck[target]] = [deck[target]!, deck[index]!];
  }

  return deck;
}

function still(state: MemoryState): Transition<MemoryState> {
  return { state, events: [] };
}

export const rules: GameRules<MemoryState, MemoryAction, MemoryView> = {
  meta,

  reconnectPolicy: {
    windowMs: RECONNECT_WINDOW_MS,
    // Yes, and for the opposite reason a timed game says yes. There is no score running down here —
    // there is a pair of cards *showing*, and the peek is the only chance either of them gets to
    // learn where those two are. Letting it expire into an empty screen while somebody's phone
    // reconnects would take away the one thing the move was worth.
    pauseOnDisconnect: true,
    // Two minutes is long enough that this is walking out, not bad wifi.
    onExpire: 'forfeit',
  },

  createMatch(_now, context) {
    // The deck first, then the coin-flip, so the two draws are never confused for each other in a
    // test that stubs the sequence.
    const faces = shuffledDeck(context);
    const startedBy: PlayerIndex = context.random() < 0.5 ? 0 : 1;

    return {
      faces,
      matchedBy: Array.from({ length: CARDS }, () => null),
      faceUp: [],
      turn: startedBy,
      startedBy,
      pairsWon: [0, 0],
      peekUntil: null,
      lastFlipMatched: null,
      paused: false,
      complete: false,
    };
  },

  validateAction(state, player, action): ValidationResult<MemoryAction> {
    if (state.complete) {
      return { ok: false, code: 'invalid_game_state', message: 'That game is already over.' };
    }
    if (state.paused) {
      return { ok: false, code: 'invalid_game_state', message: 'The game is paused.' };
    }

    const candidate = action as Partial<MemoryAction> | null;
    const card = candidate?.card;
    if (
      !candidate ||
      candidate.type !== 'flip' ||
      typeof card !== 'number' ||
      !Number.isInteger(card)
    ) {
      return { ok: false, code: 'invalid_action', message: 'That is not a move in this game.' };
    }

    if (card < 0 || card >= CARDS) {
      return { ok: false, code: 'invalid_action', message: 'That card is not on the table.' };
    }

    // Turn ownership, which is this game's answer to "can a client play out of order". A frame that
    // arrives out of turn is refused whether it was sent early, twice, or on purpose.
    if (state.turn !== player) {
      return { ok: false, code: 'invalid_action', message: 'It is not your turn.' };
    }

    // The peek belongs to both of them. A third flip landing inside it would turn a card over that
    // the other player is still trying to memorise, and it would do it from the keyboard of the
    // person who just missed.
    if (state.peekUntil !== null) {
      return { ok: false, code: 'invalid_action', message: 'Wait for those to turn back.' };
    }

    if (state.matchedBy[card] !== null) {
      return { ok: false, code: 'invalid_action', message: 'That pair has already gone.' };
    }

    // Turning the same card over twice would otherwise "match" it with itself, which is the one
    // free pair in the game.
    if (state.faceUp.includes(card)) {
      return { ok: false, code: 'invalid_action', message: 'That one is already face up.' };
    }

    return { ok: true, action: { type: 'flip', card } };
  },

  applyAction(state, player, action, at, _context) {
    const faceUp = [...state.faceUp, action.card];

    // The first of a pair: turn it over and wait. Both of them are told — unlike Reaction Speed,
    // there is nothing secret about *which* card was chosen, and watching your partner search is
    // most of what makes this game fun to lose.
    if (faceUp.length < 2) {
      return {
        state: { ...state, faceUp, lastFlipMatched: null },
        events: [{ type: EVENTS.game.stateUpdated }],
      };
    }

    const [first, second] = faceUp as [number, number];
    const matched = state.faces[first] === state.faces[second];

    if (!matched) {
      // Left face up until the peek runs out. The turn does **not** pass here — it passes when the
      // cards turn back, so the board and whose turn it is never disagree on screen.
      return {
        state: { ...state, faceUp, peekUntil: at.receivedAt + PEEK_MS, lastFlipMatched: false },
        events: [{ type: EVENTS.game.stateUpdated }],
      };
    }

    const matchedBy = [...state.matchedBy];
    matchedBy[first] = player;
    matchedBy[second] = player;

    const pairsWon: [number, number] = [...state.pairsWon];
    pairsWon[player] += 1;

    const complete = pairsWon[0] + pairsWon[1] === PAIRS;

    const events: GameEvent[] = [{ type: EVENTS.game.stateUpdated }];
    if (complete) events.push({ type: EVENTS.game.finished });

    return {
      state: {
        ...state,
        matchedBy,
        // Cleared rather than left showing: a matched pair stays visible through `matchedBy`, and
        // leaving it in `faceUp` as well would make the next flip look like the third of a triple.
        faceUp: [],
        pairsWon,
        // Finding a pair buys another go, which is the whole reason to remember anything.
        turn: state.turn,
        lastFlipMatched: true,
        complete,
      },
      events,
    };
  },

  tick(state, now, _context) {
    if (state.complete || state.paused) return still(state);
    if (state.peekUntil === null || now < state.peekUntil) return still(state);

    // The peek is over: the cards go back and so does the turn.
    return {
      state: {
        ...state,
        faceUp: [],
        peekUntil: null,
        turn: opponentOf(state.turn),
      },
      events: [{ type: EVENTS.game.stateUpdated }],
    };
  },

  nextTickAt(state) {
    if (state.complete || state.paused) return null;
    return state.peekUntil;
  },

  // Always waiting on a person, except while a peek is running down — the platform's move clock
  // should not tick against somebody who is being made to wait by the rules.
  turnOf(state) {
    if (state.complete || state.peekUntil !== null) return null;
    return state.turn;
  },

  /**
   * Freeze, rather than discard.
   *
   * Every other game's `pause` throws away what was in flight, because what was in flight was a
   * round nobody could see. Here it is the opposite: two cards are **visible**, and they are the
   * only thing the move produced. Clearing them would silently spend the player's turn and take the
   * information with it.
   */
  pause(state) {
    if (state.complete) return state;
    return { ...state, paused: true };
  },

  /**
   * A full fresh peek, measured from now.
   *
   * Not the remainder: the point of the peek is that both of them get a look, and somebody whose
   * connection dropped halfway through it did not get one. Restarting it cannot be gamed — the
   * cards are the same two cards, both players are looking at them, and dropping a connection to
   * see them longer costs 120 seconds of a clock that ends the match.
   */
  resume(state, now) {
    if (state.complete) return still(state);

    return {
      state: {
        ...state,
        paused: false,
        peekUntil: state.peekUntil === null ? null : now + PEEK_MS,
      },
      events: [{ type: EVENTS.game.stateUpdated }],
    };
  },

  getView(state, player) {
    const cards: MemoryCard[] = state.faces.map((face, index) => {
      const owner = state.matchedBy[index] ?? null;
      const faceUp = state.faceUp.includes(index);
      // The whole secret, kept in one expression: a face is filled in for a card that is turned
      // over or already claimed, and for no other card at any time.
      const visible = faceUp || owner !== null;

      return {
        face: visible ? (FACES[face] ?? null) : null,
        matched: owner === null ? null : owner === player ? 'you' : 'them',
        faceUp,
      };
    });

    const [minePairs, theirsPairs] = [state.pairsWon[player], state.pairsWon[opponentOf(player)]];

    const outcome = !state.complete
      ? null
      : minePairs === theirsPairs
        ? ('drawn' as const)
        : minePairs > theirsPairs
          ? ('won' as const)
          : ('lost' as const);

    return {
      columns: COLUMNS,
      rows: ROWS,
      pairs: PAIRS,
      cards,
      yourTurn: !state.complete && state.peekUntil === null && state.turn === player,
      yourPairs: minePairs,
      theirPairs: theirsPairs,
      peeking: state.peekUntil !== null,
      // Withheld while paused: the clock is not running, so a countdown on screen would be lying.
      peekEndsAt: state.paused ? null : state.peekUntil,
      lastFlipMatched: state.lastFlipMatched,
      youStarted: state.startedBy === player,
      paused: state.paused,
      outcome,
      complete: state.complete,
    };
  },

  isComplete(state) {
    return state.complete;
  },

  getResult(state): GameResult {
    const [pairsA, pairsB] = state.pairsWon;
    return {
      winner: pairsA === pairsB ? null : pairsA > pairsB ? 0 : 1,
      draw: pairsA === pairsB,
      // Pairs, which is both the scoreline and the margin: five apiece is a draw and 9–1 is a
      // rout, and "most competitive game" gets a real distribution out of this one.
      scores: [pairsA, pairsB],
    };
  },
};
