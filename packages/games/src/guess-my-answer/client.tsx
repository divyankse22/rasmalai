'use client';

import { useCallback } from 'react';
import type { GameRenderProps } from '../contract';
import type { GuessMyAnswerView } from './protocol';

/**
 * Guess My Answer, on screen.
 *
 * This component decides nothing and knows nothing it should not: a partner's choice is not in the
 * view until the round opens, so there is no hidden value in the DOM to read out of it.
 *
 * Input, per `docs/06`: the options are four full-width buttons, which is the easiest thing in the
 * world to hit with a thumb and works with Tab and Enter for nothing. There is no timer anywhere on
 * this screen on purpose — a stopwatch on a question about yourself would change what people
 * answer.
 */

/** The line at the top, which is the only instruction this game ever needs. */
function status(view: GuessMyAnswerView, partner: string): string {
  if (view.complete) return 'That is all six 💞';
  if (view.revealed) {
    if (view.correct) return view.yourRole === 'guessing' ? 'You knew it 🎯' : 'They knew you 🎯';
    return view.yourRole === 'guessing' ? 'Not this time 🙈' : 'They did not see that coming 🙈';
  }
  if (view.yourChoice !== null) return `Waiting for ${partner}…`;
  if (view.theyHaveChosen) return `${partner} is in — your turn`;
  return view.yourRole === 'answering' ? 'Answer honestly' : `Guess what ${partner} said`;
}

export default function GuessMyAnswerGame({
  view,
  you,
  partner,
  act,
}: GameRenderProps<GuessMyAnswerView>) {
  const choose = useCallback(
    (option: number) => {
      if (view.revealed || view.yourChoice !== null) return;
      act({ type: 'choose', round: view.roundNumber, option });
    },
    [act, view.revealed, view.yourChoice, view.roundNumber],
  );

  const moveOn = useCallback(() => {
    if (!view.revealed || view.youReady || view.complete) return;
    act({ type: 'next', round: view.roundNumber });
  }, [act, view.revealed, view.youReady, view.complete, view.roundNumber]);

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-4" aria-label="Guess My Answer">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          Question {view.roundNumber} of {view.rounds}
        </span>
        <span className="rounded-pill bg-butter px-2 py-0.5 text-ink">
          {view.yourRole === 'answering' ? 'you answer' : 'you guess'}
        </span>
      </div>

      <p className="text-center font-display text-lg font-semibold text-ink" aria-live="polite">
        {status(view, partner.nickname)}
      </p>

      <p className="text-center font-display text-xl font-bold text-ink">{view.prompt}</p>

      <ul className="flex flex-col gap-2">
        {view.options.map((option, index) => {
          const yours = view.yourChoice === index;
          const isAnswer = view.revealed && view.answer === index;
          const isGuess = view.revealed && view.guess === index;

          return (
            <li key={option}>
              <button
                type="button"
                onClick={() => choose(index)}
                disabled={view.revealed || view.yourChoice !== null}
                aria-pressed={yours}
                aria-label={
                  view.revealed
                    ? `${option}${isAnswer ? ' — the real answer' : ''}${
                        isGuess ? ' — the guess' : ''
                      }`
                    : option
                }
                className={`w-full touch-none select-none rounded-soft px-4 py-3 text-left font-display transition-all duration-quick focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry ${
                  isAnswer
                    ? 'bg-mint text-ink ring-4 ring-mint'
                    : isGuess
                      ? 'bg-sky text-ink ring-4 ring-sky'
                      : yours
                        ? 'bg-blush text-ink'
                        : 'bg-cream text-ink enabled:hover:bg-blush/60'
                } disabled:cursor-default`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span>{option}</span>
                  {/* Named in words as well as coloured, so the reveal is readable without hue. */}
                  {view.revealed && (isAnswer || isGuess) && (
                    <span className="shrink-0 text-xs text-muted">
                      {isAnswer && isGuess ? 'both' : isAnswer ? 'the answer' : 'the guess'}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {view.revealed && !view.complete && (
        <button
          type="button"
          onClick={moveOn}
          disabled={view.youReady}
          className="mx-auto rounded-pill bg-berry px-6 py-2 font-display font-semibold text-shell transition-colors duration-quick enabled:hover:bg-berry-deep disabled:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
        >
          {view.youReady ? `Waiting for ${partner.nickname}…` : 'Next question →'}
        </button>
      )}

      {!view.revealed && view.theyHaveChosen && view.yourChoice === null && (
        <p className="text-center text-xs text-muted">
          {partner.nickname} has locked theirs in. You cannot see it.
        </p>
      )}

      <div className="flex items-center justify-center gap-5 text-xs text-muted">
        <span>
          {you.nickname} read them right · <span className="text-ink">{view.yourCorrect}</span>
        </span>
        <span>
          {partner.nickname} read you right · <span className="text-ink">{view.theirCorrect}</span>
        </span>
      </div>

      {view.history.length > 0 && (
        <ol className="flex flex-col gap-1 text-xs text-muted">
          {view.history.map((recap) => (
            <li key={recap.number} className="flex items-start gap-2">
              <span aria-hidden="true">{recap.correct ? '🎯' : '🙈'}</span>
              <span>
                <span className="text-ink">{recap.question}</span> {recap.answer}
                {!recap.correct && (
                  <>
                    {' '}
                    — {recap.youGuessed ? 'you said' : `${partner.nickname} said`} {recap.guess}
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
