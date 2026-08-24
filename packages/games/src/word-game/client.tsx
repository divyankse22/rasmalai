'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameRenderProps } from '../contract';
import { MIN_WORD, type WordGameView, type WordRejection } from './protocol';

/**
 * Word Game, on screen.
 *
 * This component decides nothing. It never checks a word — it cannot, because the dictionary is
 * server-only, which is the whole design. It collects taps into a list of tile ids and sends them;
 * the server turns them into a word and rules on it.
 *
 * Input per `docs/06`: tap a tile to add it, tap it again to take it back — or swipe a finger
 * across a run of tiles to add them in one stroke, Boggle-style. Everything is a full-width or
 * comfortably-sized target, the rack wraps rather than scrolls, and nothing needs a keyboard.
 * Desktop typing is deliberately not implemented — the brief lists it as optional, and mapping
 * typed letters onto specific tile ids when the pool holds two `E`s is a fiddly little problem with
 * no payoff on the device this is actually played on.
 *
 * **The swipe path, and why it needs `elementFromPoint`.** A touch pointer is implicitly captured
 * to whichever element it went down on — the Pointer Events spec's default for touch, not mouse —
 * so `pointerenter`/`pointerover` on the *other* tiles never fire while a finger drags across them;
 * every event still reports the tile the gesture started on. `beginDrag` releases that capture
 * immediately, and `continueDrag` asks the DOM what is actually under the finger right now via
 * `document.elementFromPoint` rather than trusting the event's own target. That is the one piece of
 * this that is not ordinary React event handling.
 *
 * **Do not add `sendSignal` to this game.** The platform relays game events raw and unvalidated
 * without passing through `getView`. There is nothing here worth leaking, but a "they are building
 * a word starting with Q" signal would hand away the only thing worth thinking about.
 */

/** Cute copy for every way the server can say no, per the brief's section 19. */
const REJECTION: Record<WordRejection, string> = {
  NOT_FOUND: 'Hmm… not in our word book 😭',
  TOO_SHORT: 'Three letters at least 🙈',
  TOO_LONG: 'That is a very long word 👀',
  INVALID_CHARACTERS: 'Letters only, please 🙈',
  ALREADY_USED: 'One of you already had that one 😂',
  INSUFFICIENT_LETTERS: 'Those letters are not on the table 👀',
  NOT_YOUR_TURN: 'Not your go yet ❤️',
  TOO_SHORT_TO_RAID: 'Too short to break one of theirs 😡',
  NO_SUCH_TARGET: 'That word is not there any more 👀',
  NO_HINTS_LEFT: 'All out of hints for this match 🙈',
  NO_HINT_AVAILABLE: 'Nothing makeable right now — try a pass 👀',
};

export default function WordGameGame({ view, you, partner, act }: GameRenderProps<WordGameView>) {
  const [picked, setPicked] = useState<number[]>([]);
  const [raiding, setRaiding] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  // The turn's own clock, in whole seconds. `turnEndsAt` is null while frozen (a pause, or the
  // match already over), which is exactly when there is nothing to count down.
  useEffect(() => {
    if (view.turnEndsAt === null) {
      setRemaining(null);
      return;
    }

    const deadline = view.turnEndsAt;
    const read = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));

    read();
    const timer = setInterval(read, 200);
    return () => clearInterval(timer);
  }, [view.turnEndsAt]);

  const letters = useMemo(
    () => picked.map((id) => view.pool.find((tile) => tile.id === id)?.letter ?? '').join(''),
    [picked, view.pool],
  );

  const longEnough = picked.length >= view.yourRaidLength;
  const canRaid = longEnough && view.theirWords.length > 0;

  // A swipe in progress: the tile it started on, whether the finger has actually left that tile
  // yet, and every tile it has crossed so far. Ref rather than state — this changes on every pixel
  // of pointer movement, far too often to re-render on, and nothing on screen reads it directly.
  const dragRef = useRef<{ startId: number; moved: boolean; visited: Set<number> } | null>(null);
  // Tile ids a swipe just added, so the `click` the browser still fires if the finger lifts back
  // over its own start tile does not immediately toggle them back off. Cleared right after.
  const justDraggedRef = useRef<Set<number>>(new Set());

  const toggle = useCallback(
    (id: number) => {
      if (!view.yourTurn || justDraggedRef.current.has(id)) return;
      setPicked((current) =>
        current.includes(id) ? current.filter((held) => held !== id) : [...current, id],
      );
    },
    [view.yourTurn],
  );

  const addTile = useCallback((id: number) => {
    setPicked((current) => (current.includes(id) ? current : [...current, id]));
  }, []);

  const beginDrag = useCallback(
    (id: number) => (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!view.yourTurn) return;
      if (event.pointerType === 'touch') {
        (event.target as Element).releasePointerCapture?.(event.pointerId);
      }
      dragRef.current = { startId: id, moved: false, visited: new Set([id]) };
    },
    [view.yourTurn],
  );

  const continueDrag = useCallback(
    (event: React.PointerEvent<HTMLUListElement>) => {
      const drag = dragRef.current;
      if (!drag || !view.yourTurn) return;

      const underPointer = document.elementFromPoint(event.clientX, event.clientY);
      const tileId = underPointer?.closest<HTMLElement>('[data-tile-id]')?.dataset.tileId;
      if (tileId === undefined) return;
      const id = Number(tileId);
      if (id === drag.startId) return;

      // The first crossing into a second tile is what turns a press into a swipe — the start tile
      // is only added at that point, so a plain tap (down and up with no movement) still goes
      // through `toggle` via the ordinary `click` and can still remove a tile it re-taps.
      if (!drag.moved) {
        drag.moved = true;
        addTile(drag.startId);
      }
      if (!drag.visited.has(id)) {
        drag.visited.add(id);
        addTile(id);
      }
    },
    [addTile, view.yourTurn],
  );

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    if (drag?.moved) {
      justDraggedRef.current = drag.visited;
      setTimeout(() => {
        justDraggedRef.current = new Set();
      }, 0);
    }
    dragRef.current = null;
  }, []);

  // A safety net for a swipe that ends outside the letter rack entirely — released capture means
  // the `pointerup` can land anywhere, and a drag left dangling would corrupt the next gesture.
  useEffect(() => {
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [endDrag]);

  const submit = useCallback(() => {
    if (!view.yourTurn || picked.length < MIN_WORD) return;
    act({ type: 'claim', tiles: picked, steal: canRaid ? raiding : null });
    setPicked([]);
    setRaiding(null);
  }, [act, canRaid, picked, raiding, view.yourTurn]);

  const pass = useCallback(() => {
    if (!view.yourTurn) return;
    act({ type: 'pass' });
    setPicked([]);
    setRaiding(null);
  }, [act, view.yourTurn]);

  const hint = useCallback(() => {
    if (!view.yourTurn || view.yourHintsLeft <= 0) return;
    act({ type: 'hint' });
  }, [act, view.yourTurn, view.yourHintsLeft]);

  const status = view.complete
    ? view.yourScore === view.theirScore
      ? `Dead level, ${view.yourScore} each 💞`
      : view.yourScore > view.theirScore
        ? 'You win 🎯'
        : `${partner.nickname} wins 👀`
    : view.yourTurn
      ? 'Your go'
      : `${partner.nickname} is thinking…`;

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-3" aria-label="Word Game">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {you.nickname} <span className="text-ink">{view.yourScore}</span>
          <span className="ml-1">💡{view.yourHintsLeft}</span>
        </span>
        <span>{view.bagLeft} letters left</span>
        <span>
          <span className="ml-1">💡{view.theirHintsLeft}</span>
          <span className="text-ink">{view.theirScore}</span> {partner.nickname}
        </span>
      </div>

      <p className="text-center font-display text-lg font-semibold text-ink" aria-live="polite">
        {status}
      </p>

      {remaining !== null && !view.complete && (
        <p className="text-center text-xs text-muted" role="status">
          {view.yourTurn ? `${remaining}s to play` : `${partner.nickname}: ${remaining}s`}
        </p>
      )}

      {view.lastRejection && (
        <p className="rounded-soft bg-butter px-3 py-2 text-center text-sm text-ink">
          {REJECTION[view.lastRejection]}
        </p>
      )}

      {view.lastPlay && !view.lastRejection && (
        <p className="text-center text-xs text-muted">
          {view.lastPlay.byYou ? 'You' : partner.nickname} played{' '}
          <span className="text-ink">{view.lastPlay.word.toUpperCase()}</span> for{' '}
          {view.lastPlay.score}
          {view.lastPlay.raided && ' — and broke one of theirs 😈'}
        </p>
      )}

      {/* What is being built. Empty is a real state and says so rather than collapsing. */}
      <p className="min-h-10 rounded-soft bg-cream px-4 py-2 text-center font-display text-2xl font-bold tracking-widest text-ink">
        {letters.toUpperCase() || (
          <span className="text-base text-muted">tap or swipe letters below</span>
        )}
      </p>

      <ul
        className="flex flex-wrap justify-center gap-2"
        aria-label="Letters on the table"
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {view.pool.map((tile) => {
          const held = picked.includes(tile.id);
          return (
            <li key={tile.id}>
              <button
                type="button"
                data-tile-id={tile.id}
                onClick={() => toggle(tile.id)}
                onPointerDown={beginDrag(tile.id)}
                disabled={!view.yourTurn}
                aria-pressed={held}
                aria-label={
                  tile.id === view.hintTileId
                    ? `${tile.letter}, a hint — this can start a word`
                    : tile.golden
                      ? `${tile.letter}, golden, worth double`
                      : tile.letter
                }
                className={`h-11 w-11 touch-none select-none rounded-soft font-display text-lg font-bold uppercase transition-all duration-quick focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry disabled:opacity-50 ${
                  held
                    ? 'bg-berry text-shell'
                    : tile.golden
                      ? 'bg-butter text-ink ring-2 ring-berry'
                      : tile.id === view.hintTileId
                        ? 'bg-mint text-ink ring-2 ring-mint'
                        : 'bg-cream text-ink enabled:hover:bg-blush/60'
                }`}
              >
                {tile.letter}
              </button>
            </li>
          );
        })}
      </ul>

      {/* The raid picker only appears once the word is actually long enough to earn one. */}
      {canRaid && (
        <div className="flex flex-col gap-1 rounded-soft bg-blush/40 px-3 py-2">
          <p className="text-center text-xs text-ink">
            {picked.length} letters — you can break one of {partner.nickname}&apos;s words 😈
          </p>
          <ul className="flex flex-wrap justify-center gap-2">
            {view.theirWords.map((owned, index) => (
              <li key={`${owned.word}-${index}`}>
                <button
                  type="button"
                  onClick={() => setRaiding((current) => (current === index ? null : index))}
                  aria-pressed={raiding === index}
                  className={`rounded-pill px-3 py-1 text-xs font-display uppercase transition-colors duration-quick ${
                    raiding === index ? 'bg-berry text-shell' : 'bg-shell text-ink'
                  }`}
                >
                  {owned.word}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => setPicked([])}
          disabled={picked.length === 0}
          className="rounded-pill bg-cream px-4 py-2 font-display text-sm text-ink transition-colors duration-quick enabled:hover:bg-blush/60 disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!view.yourTurn || picked.length < MIN_WORD}
          className="rounded-pill bg-berry px-6 py-2 font-display font-semibold text-shell transition-colors duration-quick enabled:hover:bg-berry-deep disabled:bg-muted/40"
        >
          {raiding !== null && canRaid ? 'Play & raid 😈' : 'Play'}
        </button>
        <button
          type="button"
          onClick={pass}
          disabled={!view.yourTurn}
          className="rounded-pill bg-cream px-4 py-2 font-display text-sm text-ink transition-colors duration-quick enabled:hover:bg-blush/60 disabled:opacity-40"
        >
          Pass
        </button>
        <button
          type="button"
          onClick={hint}
          disabled={!view.yourTurn || view.yourHintsLeft <= 0}
          className="rounded-pill bg-cream px-4 py-2 font-display text-sm text-ink transition-colors duration-quick enabled:hover:bg-blush/60 disabled:opacity-40"
        >
          Hint 💡
        </button>
      </div>

      {view.passes > 0 && view.bagLeft === 0 && (
        <p className="text-center text-xs text-muted">
          {view.passes === 1 ? 'One more pass ends it.' : 'That is the end.'}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-muted">{you.nickname}</p>
          <ul className="flex flex-wrap gap-1">
            {view.yourWords.map((owned, index) => (
              <li
                key={`${owned.word}-${index}`}
                className={`rounded-pill px-2 py-0.5 uppercase ${owned.golden ? 'bg-butter text-ink' : 'bg-cream text-ink'}`}
              >
                {owned.word} <span className="text-muted">{owned.score}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-muted">{partner.nickname}</p>
          <ul className="flex flex-wrap gap-1">
            {view.theirWords.map((owned, index) => (
              <li
                key={`${owned.word}-${index}`}
                className={`rounded-pill px-2 py-0.5 uppercase ${owned.golden ? 'bg-butter text-ink' : 'bg-cream text-ink'}`}
              >
                {owned.word} <span className="text-muted">{owned.score}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
