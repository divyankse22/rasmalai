'use client';

import { useCallback } from 'react';
import type { GameRenderProps } from '../contract';
import type { Dilemma, Option, WouldYouRatherView } from './protocol';

/**
 * Would You Rather, on screen.
 *
 * This component decides nothing and knows nothing it should not. The two seats are handed
 * structurally different views — an Answerer's has no `candidates` property at all — so there is no
 * hidden value in the DOM to read out of it, and no branch here that could be got wrong badly
 * enough to leak one.
 *
 * **Do not add `sendSignal` to this game.** The platform relays game events between partners raw and
 * unvalidated, without passing through `getView` — so a well-meant "they are hovering over A"
 * signal would walk straight around every fence the server puts up. There is nothing this game
 * needs it for.
 *
 * Input per `docs/06`: full-width buttons, easy to hit with a thumb, and Tab/Enter for free. No
 * timer anywhere on this screen on purpose — a stopwatch on "which of these would you actually do"
 * would change the answers.
 */

/** The line at the top, which is the only instruction this game ever needs. */
function status(view: WouldYouRatherView, partner: string): string {
  if (view.complete) {
    if (view.yourCorrect === view.theirCorrect) return `Dead even. ${view.yourCorrect} each 💞`;
    return view.yourCorrect > view.theirCorrect
      ? 'You read them better 🎯'
      : `${partner} read you better 👀`;
  }

  if (view.phase === 'revealed') {
    const you = view.yourRole === 'asking';
    if (view.correct) return you ? 'You called it 🎯' : `${partner} called it 👀`;
    return you ? 'Nowhere near 🙈' : `${partner} had no idea 😂`;
  }

  if (view.yourRole === 'asking') {
    if (view.phase === 'selecting') return 'Pick the cruellest one 😈';
    if (view.phase === 'answering') return `${partner} is deciding…`;
    return `They have answered. What did they say? 👀`;
  }

  if (view.phase === 'selecting') return `${partner} is choosing your fate…`;
  if (view.phase === 'answering') return 'Be honest';
  return `Locked in. ${partner} is guessing you now…`;
}

/** One side of a dilemma, as a full-width button. */
function Side({
  label,
  text,
  onClick,
  disabled,
  tone,
  note,
}: {
  label: string;
  text: string;
  onClick?: (() => void) | undefined;
  disabled: boolean;
  tone: 'plain' | 'yours' | 'answer' | 'prediction' | 'both';
  note?: string | undefined;
}) {
  const skin =
    tone === 'both'
      ? 'bg-mint text-ink ring-4 ring-sky'
      : tone === 'answer'
        ? 'bg-mint text-ink ring-4 ring-mint'
        : tone === 'prediction'
          ? 'bg-sky text-ink ring-4 ring-sky'
          : tone === 'yours'
            ? 'bg-blush text-ink'
            : 'bg-cream text-ink enabled:hover:bg-blush/60';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={note ? `${text} — ${note}` : text}
      className={`w-full touch-none select-none rounded-soft px-4 py-3 text-left font-display transition-all duration-quick focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry disabled:cursor-default ${skin}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span>
          <span className="mr-2 text-xs text-muted">{label}</span>
          {text}
        </span>
        {/* Named in words as well as coloured, so a reveal is readable without hue. */}
        {note && <span className="shrink-0 text-xs text-muted">{note}</span>}
      </span>
    </button>
  );
}

export default function WouldYouRatherGame({
  view,
  you,
  partner,
  act,
}: GameRenderProps<WouldYouRatherView>) {
  const round = view.roundNumber;

  const select = useCallback(
    (candidate: number) => {
      if (view.yourRole !== 'asking' || view.phase !== 'selecting') return;
      act({ type: 'select', round, candidate });
    },
    [act, round, view.yourRole, view.phase],
  );

  const answer = useCallback(
    (option: Option) => {
      if (view.yourRole !== 'answering' || view.phase !== 'answering') return;
      act({ type: 'answer', round, option });
    },
    [act, round, view.yourRole, view.phase],
  );

  const predict = useCallback(
    (option: Option) => {
      if (view.yourRole !== 'asking' || view.phase !== 'predicting') return;
      act({ type: 'predict', round, option });
    },
    [act, round, view.yourRole, view.phase],
  );

  const moveOn = useCallback(() => {
    if (view.phase !== 'revealed' || view.youReady || view.complete) return;
    act({ type: 'next', round });
  }, [act, round, view.phase, view.youReady, view.complete]);

  /** The dilemma in play, from whichever field this seat carries it in. */
  const inPlay: Dilemma | null =
    view.yourRole === 'asking'
      ? view.selected === null
        ? null
        : (view.candidates[view.selected] ?? null)
      : view.dilemma;

  const toneFor = (option: Option): 'plain' | 'yours' | 'answer' | 'prediction' | 'both' => {
    if (view.phase !== 'revealed') {
      if (view.yourRole === 'answering' && view.yourAnswer === option) return 'yours';
      if (view.yourRole === 'asking' && view.yourPrediction === option) return 'yours';
      return 'plain';
    }
    const isAnswer = view.answer === option;
    const isPrediction = view.prediction === option;
    if (isAnswer && isPrediction) return 'both';
    if (isAnswer) return 'answer';
    if (isPrediction) return 'prediction';
    return 'plain';
  };

  const noteFor = (option: Option): string | undefined => {
    if (view.phase !== 'revealed') return undefined;
    const isAnswer = view.answer === option;
    const isPrediction = view.prediction === option;
    if (isAnswer && isPrediction) return 'both';
    if (isAnswer) return 'they chose';
    if (isPrediction) return 'the guess';
    return undefined;
  };

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-4" aria-label="Would You Rather">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          Round {round} of {view.rounds}
        </span>
        <span className="rounded-pill bg-butter px-2 py-0.5 text-ink">
          {view.yourRole === 'asking' ? 'you ask' : 'you answer'}
        </span>
      </div>

      <p className="text-center font-display text-lg font-semibold text-ink" aria-live="polite">
        {status(view, partner.nickname)}
      </p>

      {/* Choosing: three dilemmas, and only the Asker ever reaches this branch. */}
      {view.yourRole === 'asking' && view.phase === 'selecting' && (
        <ul className="flex flex-col gap-2">
          {view.candidates.map((dilemma, index) => (
            <li key={`${dilemma.optionA}|${dilemma.optionB}`}>
              <button
                type="button"
                onClick={() => select(index)}
                className="w-full touch-none select-none rounded-soft bg-cream px-4 py-3 text-left font-display text-ink transition-all duration-quick hover:bg-blush/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
              >
                <span className="block text-xs text-muted">{dilemma.prompt}</span>
                <span className="block">{dilemma.optionA}</span>
                <span className="block text-xs text-muted">or</span>
                <span className="block">{dilemma.optionB}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The Answerer, while they are still being chosen for. */}
      {view.yourRole === 'answering' && view.phase === 'selecting' && (
        <p className="rounded-soft bg-cream px-4 py-6 text-center text-sm text-muted">
          Three of them. You will only ever see one.
        </p>
      )}

      {/* Everything after the choice: one dilemma, two sides. */}
      {inPlay && view.phase !== 'selecting' && (
        <>
          <p className="text-center font-display text-xl font-bold text-ink">{inPlay.prompt}</p>
          <div className="flex flex-col gap-2">
            <Side
              label="A"
              text={inPlay.optionA}
              onClick={
                view.yourRole === 'answering' ? () => answer(0) : () => predict(0)
              }
              disabled={
                view.phase === 'revealed' ||
                (view.yourRole === 'answering'
                  ? view.phase !== 'answering'
                  : view.phase !== 'predicting')
              }
              tone={toneFor(0)}
              note={noteFor(0)}
            />
            <p className="text-center text-xs text-muted">or</p>
            <Side
              label="B"
              text={inPlay.optionB}
              onClick={
                view.yourRole === 'answering' ? () => answer(1) : () => predict(1)
              }
              disabled={
                view.phase === 'revealed' ||
                (view.yourRole === 'answering'
                  ? view.phase !== 'answering'
                  : view.phase !== 'predicting')
              }
              tone={toneFor(1)}
              note={noteFor(1)}
            />
          </div>
        </>
      )}

      {view.yourRole === 'asking' && view.phase === 'predicting' && (
        <p className="text-center text-xs text-muted">
          {partner.nickname} has answered. You cannot see it.
        </p>
      )}

      {view.phase === 'revealed' && !view.complete && (
        <button
          type="button"
          onClick={moveOn}
          disabled={view.youReady}
          className="mx-auto rounded-pill bg-berry px-6 py-2 font-display font-semibold text-shell transition-colors duration-quick enabled:hover:bg-berry-deep disabled:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
        >
          {view.youReady ? `Waiting for ${partner.nickname}…` : 'Next one →'}
        </button>
      )}

      <div className="flex items-center justify-center gap-5 text-xs text-muted">
        <span>
          {you.nickname} called <span className="text-ink">{view.yourCorrect}</span> of{' '}
          {view.asksEach}
        </span>
        <span>
          {partner.nickname} called <span className="text-ink">{view.theirCorrect}</span> of{' '}
          {view.asksEach}
        </span>
      </div>

      {view.history.length > 0 && (
        <ol className="flex flex-col gap-1 text-xs text-muted">
          {view.history.map((recap) => (
            <li key={recap.number} className="flex items-start gap-2">
              <span aria-hidden="true">{recap.correct ? '🎯' : '🙈'}</span>
              <span>
                <span className="text-ink">
                  {recap.answer === 0 ? recap.dilemma.optionA : recap.dilemma.optionB}
                </span>{' '}
                — {recap.youAsked ? 'you guessed' : `${partner.nickname} guessed`}{' '}
                {recap.prediction === 0 ? recap.dilemma.optionA : recap.dilemma.optionB}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
