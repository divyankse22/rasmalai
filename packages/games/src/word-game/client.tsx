'use client';

import { useCallback, useMemo, useState } from 'react';
import type { GameRenderProps } from '../contract';
import { MIN_WORD, type WordGameView, type WordRejection } from './protocol';

/**
 * Word Game, on screen.
 *
 * This component decides nothing. It never checks a word — it cannot, because the dictionary is
 * server-only, which is the whole design. It collects taps into a list of tile ids and sends them;
 * the server turns them into a word and rules on it.
 *
 * Input per `docs/06`: tap a tile to add it, tap it again to take it back. Everything is a
 * full-width or comfortably-sized target, the rack wraps rather than scrolls, and nothing needs a
 * keyboard. Desktop typing is deliberately not implemented — the brief lists it as optional, and
 * mapping typed letters onto specific tile ids when the pool holds two `E`s is a fiddly little
 * problem with no payoff on the device this is actually played on.
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
};

export default function WordGameGame({ view, you, partner, act }: GameRenderProps<WordGameView>) {
  const [picked, setPicked] = useState<number[]>([]);
  const [raiding, setRaiding] = useState<number | null>(null);

  const letters = useMemo(
    () => picked.map((id) => view.pool.find((tile) => tile.id === id)?.letter ?? '').join(''),
    [picked, view.pool],
  );

  const longEnough = picked.length >= view.yourRaidLength;
  const canRaid = longEnough && view.theirWords.length > 0;

  const toggle = useCallback(
    (id: number) => {
      if (!view.yourTurn) return;
      setPicked((current) =>
        current.includes(id) ? current.filter((held) => held !== id) : [...current, id],
      );
    },
    [view.yourTurn],
  );

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
        </span>
        <span>{view.bagLeft} letters left</span>
        <span>
          <span className="text-ink">{view.theirScore}</span> {partner.nickname}
        </span>
      </div>

      <p className="text-center font-display text-lg font-semibold text-ink" aria-live="polite">
        {status}
      </p>

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
        {letters.toUpperCase() || <span className="text-base text-muted">tap letters below</span>}
      </p>

      <ul className="flex flex-wrap justify-center gap-2" aria-label="Letters on the table">
        {view.pool.map((tile) => {
          const held = picked.includes(tile.id);
          return (
            <li key={tile.id}>
              <button
                type="button"
                onClick={() => toggle(tile.id)}
                disabled={!view.yourTurn}
                aria-pressed={held}
                aria-label={tile.golden ? `${tile.letter}, golden, worth double` : tile.letter}
                className={`h-11 w-11 touch-none select-none rounded-soft font-display text-lg font-bold uppercase transition-all duration-quick focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry disabled:opacity-50 ${
                  held
                    ? 'bg-berry text-shell'
                    : tile.golden
                      ? 'bg-butter text-ink ring-2 ring-berry'
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
