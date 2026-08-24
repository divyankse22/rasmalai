'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PAIRING_CODE_LENGTH, type AvatarKey, type Gender } from '@rasmalai/shared';
import { Button } from '@/design-system/Button';
import { Card } from '@/design-system/Card';
import { getFromApi, postToApi } from '@/lib/clientApi';
import { AVATARS } from './avatars';
import {
  EMPTY_ANSWERS,
  buildSteps,
  toPayload,
  type Answers,
  type Step,
  type StepId,
} from './steps';

interface CodeLookup {
  status: 'ok' | 'not_found' | 'self' | 'already_paired';
  needsCoupleDetails: boolean;
  owner: { id: string; nickname: string; avatarKey: string; gender: Gender } | null;
}

const LOOKUP_MESSAGES: Record<Exclude<CodeLookup['status'], 'ok'>, string> = {
  not_found: 'We could not find that code.',
  self: 'That is your own code 🙃',
  already_paired: 'They are already paired with someone.',
};

type CheckState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; owner: NonNullable<CodeLookup['owner']> }
  | { state: 'bad'; message: string };

/** A code we asked about: what came back, or that we could not ask. */
type Verdict = CodeLookup | { unreachable: string };

/** Strips the spacing people paste codes with; the server normalises the same way. */
function normalise(code: string): string {
  return code.replace(/[^0-9a-z]/gi, '').toUpperCase();
}

/**
 * Onboarding, one question at a time.
 *
 * The cards sit in a row and the row slides; each answered card leaves to the left and the next
 * arrives. That is one `translateX` on a flex track rather than mounting and unmounting cards,
 * which keeps every answer alive behind you — going back is free, and nothing is re-fetched or
 * re-typed. `globals.css` already flattens transitions under `prefers-reduced-motion`, so the
 * reduced-motion version of this is the same component with the movement removed.
 *
 * Which cards exist is decided in `steps.ts`. This file only knows how to draw one.
 */
export function OnboardingWizard({ suggestedName }: { suggestedName: string }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>({ ...EMPTY_ANSWERS, nickname: suggestedName });
  const [index, setIndex] = useState(0);
  const [showError, setShowError] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  // Codes already asked about, so correcting a typo and typing the same code back does not spend a
  // second try against a budget shared with actually sending the request.
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});

  const code = normalise(answers.pairingCode);
  const asked = code.length >= PAIRING_CODE_LENGTH ? verdicts[code] : undefined;
  // Derived rather than stored. The check has exactly one input — what has been typed — so keeping
  // a copy in state would only create a second version of the truth to keep in step with it.
  const check: CheckState =
    code.length < PAIRING_CODE_LENGTH
      ? { state: 'idle' }
      : asked
        ? describe(asked)
        : { state: 'checking' };
  const ownerNeedsCoupleDetails =
    asked !== undefined && 'status' in asked && asked.status === 'ok' && asked.needsCoupleDetails;

  const steps = buildSteps(answers, ownerNeedsCoupleDetails);
  const position = Math.min(index, steps.length - 1);
  const step = steps[position]!;
  // Before the first question is answered the list is one card long, which is not the same thing
  // as being finished — offering "All done" there would promise a signup two answers in.
  const isLast = steps.length > 1 && position === steps.length - 1;

  const trackRef = useRef<HTMLDivElement>(null);

  const set = <K extends StepId>(id: K, value: Answers[K]) =>
    setAnswers((current) => ({ ...current, [id]: value }));

  const clearError = (id: StepId) => {
    setShowError(false);
    setServerErrors((current) => {
      if (!(id in current)) return current;
      const rest = { ...current };
      delete rest[id];
      return rest;
    });
  };

  /** Asks about a code once it is long enough to be one, and never asks about the same one twice. */
  useEffect(() => {
    if (step.kind !== 'code' || code.length < PAIRING_CODE_LENGTH || verdicts[code]) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await getFromApi<CodeLookup>(`/api/pairing/codes/${code}`);
      if (cancelled) return;

      setVerdicts((current) => ({
        ...current,
        [code]: result ?? { unreachable: 'We could not check that code just now.' },
      }));
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, step.kind, verdicts]);

  /** Hand focus to the card that just arrived, without yanking the page around on first paint. */
  const firstPaint = useRef(true);
  useEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    const panel = trackRef.current?.querySelector(`[data-panel="${position}"]`);
    panel?.querySelector<HTMLElement>('input, select, button')?.focus({ preventScroll: true });
  }, [position]);

  /**
   * @param candidate the answers to judge. A tap that both answers and advances has to pass its own
   * value in: `answers` still holds the previous one at that point, so validating the state would
   * reject the very choice that was just made and the card would sit there.
   */
  function advance(candidate: Answers = answers) {
    const problem = step.validate(candidate);
    if (problem || (step.kind === 'code' && check.state !== 'ok')) {
      setShowError(true);
      return;
    }
    setShowError(false);
    setIndex(position + 1);
  }

  function back() {
    setShowError(false);
    setIndex(Math.max(0, position - 1));
  }

  async function submit() {
    setSubmitting(true);
    setServerErrors({});
    setFormError(undefined);

    const result = await postToApi<{ request: unknown | null }>(
      '/api/onboarding',
      toPayload(answers, steps),
    );

    if (result.ok) {
      // Somebody who arrived with a code has just asked to pair, and the pairing screen is where
      // that request is waiting to be answered. Everyone else has a code of their own to share.
      router.push(result.data.request ? '/pairing' : '/dashboard');
      router.refresh();
      return;
    }

    setSubmitting(false);

    const fields = result.error.fields;
    if (fields) {
      setServerErrors(fields);
      // Slide back to the card that asked, rather than reporting it under a button five cards
      // away from the answer it is about.
      const culprit = steps.findIndex((candidate) => candidate.id in fields);
      if (culprit >= 0) {
        setIndex(culprit);
        setShowError(true);
      }
      // A code that stopped working between the check and the submit must not stay confirmed:
      // replacing the verdict is what un-confirms it and blocks Next again.
      if ('pairingCode' in fields) {
        setVerdicts((current) => ({ ...current, [code]: { unreachable: fields.pairingCode! } }));
      }
      return;
    }

    setFormError(result.error.message);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLast) void submit();
    else advance();
  }

  const liveError = showError
    ? (serverErrors[step.id] ?? step.validate(answers) ?? codeProblem(check))
    : serverErrors[step.id];

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
      {/* Clipped at the padding edge, so the cards' shadows survive the crop. */}
      <div className="-mx-4 overflow-hidden px-4 py-2">
        <div
          ref={trackRef}
          className="flex transition-transform duration-soft ease-bounce"
          style={{ transform: `translateX(-${position * 100}%)` }}
        >
          {steps.map((candidate, i) => (
            <div
              key={candidate.id}
              data-panel={i}
              className="w-full shrink-0"
              aria-hidden={i === position ? undefined : true}
              {...(i === position ? {} : { inert: true })}
            >
              <Card className="flex min-h-64 flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h2 className="font-display text-xl font-semibold text-ink">
                    {candidate.question}
                  </h2>
                  {candidate.hint && <p className="text-sm text-muted">{candidate.hint}</p>}
                </div>

                <div className="flex flex-1 flex-col justify-center gap-3">
                  {renderInput(candidate, answers, set, clearError, advance, i === position)}
                  {i === position && check.state === 'ok' && candidate.kind === 'code' && (
                    <p className="text-sm text-ink">
                      That’s {avatarGlyphOf(check.owner.avatarKey)} {check.owner.nickname} — is that
                      them?
                    </p>
                  )}
                  {i === position && check.state === 'checking' && candidate.kind === 'code' && (
                    <p className="text-sm text-muted">Checking…</p>
                  )}
                  {i === position && liveError && (
                    <p className="text-sm text-berry" role="alert">
                      {liveError}
                    </p>
                  )}
                </div>
              </Card>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center gap-2" aria-hidden>
        {steps.map((candidate, i) => (
          <span
            key={candidate.id}
            className={`size-2 rounded-pill transition-colors duration-quick ${
              i === position ? 'bg-berry' : i < position ? 'bg-blueberry' : 'bg-blush'
            }`}
          />
        ))}
      </div>

      {formError && (
        <p className="text-center text-sm text-berry" role="alert">
          {formError}
        </p>
      )}

      <div className="flex items-center gap-3">
        {position > 0 && (
          <Button type="button" variant="ghost" onClick={back}>
            ← Back
          </Button>
        )}
        <Button type="submit" className="flex-1" disabled={submitting}>
          {submitting ? 'Saving…' : isLast ? 'All done ❤️' : 'Next →'}
        </Button>
      </div>

      {step.kind === 'code' && (
        <button
          type="button"
          className="text-sm text-muted underline underline-offset-4"
          onClick={() => {
            set('hasCode', 'no');
            set('pairingCode', '');
            setShowError(false);
            setIndex(1);
          }}
        >
          I don’t have it right now
        </button>
      )}
    </form>
  );
}

function describe(verdict: Verdict): CheckState {
  if ('unreachable' in verdict) return { state: 'bad', message: verdict.unreachable };
  return verdict.status === 'ok' && verdict.owner
    ? { state: 'ok', owner: verdict.owner }
    : { state: 'bad', message: LOOKUP_MESSAGES[verdict.status as keyof typeof LOOKUP_MESSAGES] };
}

function codeProblem(check: CheckState): string | undefined {
  if (check.state === 'bad') return check.message;
  if (check.state === 'checking') return 'Just a moment…';
  return undefined;
}

function avatarGlyphOf(key: string): string {
  return AVATARS.find((avatar) => avatar.key === key)?.glyph ?? '🍡';
}

const CONTROL =
  'w-full min-h-11 rounded-soft border border-line bg-cream px-4 text-ink ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry';

function renderInput(
  step: Step,
  answers: Answers,
  set: <K extends StepId>(id: K, value: Answers[K]) => void,
  clearError: (id: StepId) => void,
  advance: (candidate: Answers) => void,
  active: boolean,
) {
  const change = <K extends StepId>(id: K, value: Answers[K]) => {
    set(id, value);
    clearError(id);
  };

  switch (step.kind) {
    case 'choice':
      return (
        <div className="flex flex-col gap-2">
          {step.options?.map((option) => {
            const selected = answers[step.id] === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  const value = option.value as Answers[typeof step.id];
                  change(step.id, value);
                  // A tap is the whole answer, so it moves on by itself — except on the last card,
                  // where the next thing that happens is a submit and a mis-tap would cost more
                  // than the saved gesture.
                  if (active && step.id !== 'locationType') {
                    advance({ ...answers, [step.id]: value });
                  }
                }}
                className={`min-h-11 rounded-soft px-4 py-2 text-left font-display font-semibold transition-transform duration-quick ease-bounce active:scale-95 ${
                  selected ? 'bg-berry text-shell shadow-soft' : 'bg-blush text-ink'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      );

    case 'avatar':
      return (
        <div className="flex flex-wrap gap-2">
          {AVATARS.map((avatar) => {
            const selected = avatar.key === answers.avatarKey;
            return (
              <button
                key={avatar.key}
                type="button"
                onClick={() => change('avatarKey', avatar.key as AvatarKey)}
                aria-pressed={selected}
                aria-label={avatar.label}
                className={`flex size-12 items-center justify-center rounded-pill text-2xl transition-transform duration-quick ease-bounce active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry ${
                  selected ? 'bg-berry shadow-soft' : 'bg-blush'
                }`}
              >
                {avatar.glyph}
              </button>
            );
          })}
        </div>
      );

    case 'code':
      return (
        <input
          className={`${CONTROL} font-display text-lg tracking-[0.3em] uppercase`}
          value={answers.pairingCode}
          onChange={(event) => change('pairingCode', event.target.value)}
          aria-label={step.label}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={16}
          enterKeyHint="next"
        />
      );

    case 'year':
      return (
        <input
          className={CONTROL}
          type="number"
          inputMode="numeric"
          value={answers.birthYear}
          onChange={(event) => change('birthYear', event.target.value)}
          aria-label={step.label}
          min={1900}
          max={new Date().getFullYear()}
          enterKeyHint="next"
        />
      );

    case 'date':
      return (
        <input
          className={CONTROL}
          type="date"
          value={answers.firstMetDate}
          onChange={(event) => change('firstMetDate', event.target.value)}
          aria-label={step.label}
          max={new Date().toISOString().slice(0, 10)}
        />
      );

    default:
      return (
        <input
          className={CONTROL}
          value={String(answers[step.id] ?? '')}
          onChange={(event) => change(step.id, event.target.value as Answers[typeof step.id])}
          aria-label={step.label}
          maxLength={30}
          autoComplete={step.id === 'nickname' ? 'nickname' : 'off'}
          enterKeyHint="next"
        />
      );
  }
}
