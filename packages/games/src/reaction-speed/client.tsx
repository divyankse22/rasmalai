'use client';

import { useCallback, type KeyboardEvent } from 'react';
import type { GameRenderProps } from '../contract';
import { ROUNDS, type ReactionSpeedView, type RoundView } from './protocol';

/**
 * Reaction Speed, on screen.
 *
 * This component decides nothing. It draws the view the server sent and reports taps back as
 * intents; every time, every winner and every score in it was computed on the server.
 *
 * Input, per `docs/06`: one enormous target that works with a thumb, and Space or Enter for anyone
 * on a keyboard. The tap is taken on **pointer down** rather than click — a click does not fire
 * until you lift your finger, and charging someone the time they held the screen would make the
 * game measure the wrong thing.
 */

const PIP_STYLE: Record<'won' | 'lost' | 'drawn' | 'pending', string> = {
  won: 'bg-berry text-shell',
  lost: 'bg-cream text-muted',
  drawn: 'bg-lilac text-ink',
  pending: 'bg-cream/60 text-muted/60',
};

function Pips({ history, roundNumber }: { history: RoundView[]; roundNumber: number }) {
  return (
    <ol className="flex justify-center gap-1.5" aria-label="Rounds so far">
      {Array.from({ length: ROUNDS }, (_, index) => {
        const round = history[index];
        const state = round?.outcome ?? 'pending';
        const current = index + 1 === roundNumber && !round;

        return (
          <li
            key={index}
            className={`flex size-7 items-center justify-center rounded-pill font-display text-xs font-bold ${
              PIP_STYLE[state]
            } ${current ? 'ring-2 ring-berry ring-offset-1' : ''}`}
          >
            <span className="sr-only">
              Round {index + 1}:{' '}
              {state === 'pending' ? (current ? 'playing now' : 'not played yet') : state}
            </span>
            <span aria-hidden="true">{index + 1}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The line under the big target: what just happened, in words. */
function roundSummary(round: RoundView): string {
  if (round.ending === 'false-start') {
    return round.yourFalseStart ? 'You went too early 🙈' : 'They went too early 🙈';
  }
  if (round.ending === 'nobody-tapped') return 'Neither of you moved 😴';
  if (round.outcome === 'won') return 'Yours 🎉';
  if (round.outcome === 'lost') return 'Theirs 😤';
  return 'Dead heat 😳';
}

function time(ms: number | null): string {
  return ms === null ? '—' : `${ms}ms`;
}

/**
 * The round-by-round, once it is all over.
 *
 * The finished game stays on screen under the result, because "you lost 2–3" is a fact and
 * "you lost round four by eleven milliseconds" is an argument.
 */
function Recap({ history, partner }: { history: RoundView[]; partner: string }) {
  return (
    <ol className="flex flex-col gap-1">
      {history.map((round) => (
        <li
          key={round.number}
          className={`flex items-center gap-3 rounded-soft px-3 py-2 text-sm ${
            round.outcome === 'won' ? 'bg-blush' : 'bg-cream'
          }`}
        >
          <span className="w-4 shrink-0 font-display font-semibold text-muted tabular-nums">
            {round.number}
          </span>
          <span className="flex-1 tabular-nums text-ink">
            {round.ending === 'tapped'
              ? `You ${time(round.yourReactionMs)} · ${partner} ${time(round.theirReactionMs)}`
              : roundSummary(round)}
          </span>
          <span className="shrink-0 text-xs text-muted">
            {round.outcome === 'won' ? 'you' : round.outcome === 'lost' ? 'them' : 'tie'}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function ReactionSpeedGame({
  view,
  you,
  partner,
  act,
}: GameRenderProps<ReactionSpeedView>) {
  const round = view.current;
  const live = round.phase === 'live';
  const armed = round.phase === 'arming';
  const canTap = !view.paused && !view.complete && !view.youTapped && (live || armed);

  const tap = useCallback(() => {
    if (!canTap) return;
    act({ type: 'tap', round: view.roundNumber });
  }, [act, canTap, view.roundNumber]);

  // Space and Enter both count, and both have their default suppressed so the browser does not
  // also fire a click on the way back up and send the tap twice.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      if (event.repeat) return;
      tap();
    },
    [tap],
  );

  const surface = view.paused
    ? 'bg-cream text-muted'
    : live
      ? 'bg-berry text-shell'
      : armed
        ? 'bg-butter text-ink'
        : 'bg-cream text-ink';

  const headline = view.paused
    ? 'Paused'
    : live
      ? view.youTapped
        ? time(round.yourReactionMs)
        : 'TAP!'
      : armed
        ? view.youTapped
          ? 'Too early!'
          : 'Wait…'
        : roundSummary(round);

  // Only a round that both of them answered has two times worth printing. A false start or a
  // round nobody touched is better described than measured.
  const bothTapped =
    round.yourReactionMs !== null && round.theirReactionMs !== null && round.ending === 'tapped';

  const caption = view.paused
    ? 'The round restarts when they are back.'
    : live
      ? view.youTapped
        ? 'Locked in. Waiting for them…'
        : 'Now! Now! Now!'
      : armed
        ? 'Do not flinch. Tapping early loses the round.'
        : bothTapped
          ? `You ${time(round.yourReactionMs)} · ${partner.nickname} ${time(round.theirReactionMs)}`
          : `${view.yourRoundsWon}–${view.theirRoundsWon}`;

  const scoreline = (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-display font-semibold text-ink">
        {view.yourRoundsWon} <span className="text-muted">— you</span>
      </span>
      <span className="text-xs text-muted">
        Round {Math.min(view.roundNumber, view.rounds)} of {view.rounds}
      </span>
      <span className="font-display font-semibold text-ink">
        <span className="text-muted">them —</span> {view.theirRoundsWon}
      </span>
    </div>
  );

  // Once it is over the big target has nothing left to do, and a screen-filling slab you cannot
  // press is worse than the thing the two of them actually want: the round-by-round.
  if (view.complete) {
    return (
      <section className="flex flex-col gap-3" aria-label="How it went">
        {scoreline}
        <Recap history={view.history} partner={partner.nickname} />
      </section>
    );
  }

  return (
    <section className="flex flex-1 flex-col gap-3" aria-label="Reaction Speed">
      {scoreline}

      <Pips history={view.history} roundNumber={view.roundNumber} />

      <button
        type="button"
        onPointerDown={tap}
        onKeyDown={onKeyDown}
        disabled={!canTap}
        aria-label={live ? 'Tap now' : 'Wait for the signal, then tap'}
        // `touch-none` keeps a fast double tap from being read as a zoom, which would swallow the
        // second round's tap on a phone.
        className={`flex min-h-56 flex-1 touch-none select-none flex-col items-center justify-center gap-2 rounded-card px-6 text-center transition-colors duration-quick disabled:cursor-default disabled:opacity-100 ${surface}`}
      >
        <span
          className="font-display text-5xl font-bold tabular-nums"
          // Assertive: the whole game is this one word changing, and a screen reader user needs it
          // at the same moment everyone else gets it.
          aria-live="assertive"
        >
          {headline}
        </span>
        <span className="text-sm opacity-80">{caption}</span>
      </button>

      <p className="text-center text-xs text-muted">
        {view.yourBestMs !== null
          ? `Your best tonight: ${view.yourBestMs}ms`
          : `${you.nickname} vs ${partner.nickname} · fastest thumb wins the round`}
      </p>
    </section>
  );
}
