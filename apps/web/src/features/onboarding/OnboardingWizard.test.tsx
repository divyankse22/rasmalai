import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingWizard } from './OnboardingWizard';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  postToApi: vi.fn(),
  getFromApi: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock('@/lib/clientApi', () => ({
  postToApi: mocks.postToApi,
  getFromApi: mocks.getFromApi,
}));

/*
 * Every card stays mounted the whole time (the track slides rather than swapping children), so
 * `getByText` on a question would find it whether or not the wizard actually moved. `heading()`
 * below goes through `getByRole` instead, which — like the game catalogue's swipe tests earlier
 * this session — correctly excludes the `aria-hidden`/`inert` cards that aren't the active one.
 */
function heading(): HTMLElement {
  return screen.getByRole('heading');
}

/** The card track: pointer events on this element are what a real swipe delivers to the page. */
function track(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-panel="0"]')!.parentElement as HTMLElement;
}

async function swipe(container: HTMLElement, deltaX: number) {
  const el = track(container);
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 200 });
  // The move/up handlers are plain `window.addEventListener`, outside React's synthetic event
  // system (the same technique the game catalogue's swipe uses), so their state updates need an
  // explicit `act` the way a synthetic-event `fireEvent` call gets for free. Async so it flushes
  // after a preceding `userEvent.type`'s own internal scheduling, rather than racing it.
  await act(async () => {
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 200 + deltaX });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 200 + deltaX });
  });
}

beforeEach(() => {
  mocks.push.mockClear();
  mocks.refresh.mockClear();
  mocks.postToApi.mockReset().mockResolvedValue({ ok: true, data: { request: null } });
  mocks.getFromApi.mockReset();
});

describe('OnboardingWizard swiping', () => {
  it('advances to the next card on a leftward swipe, same as the Next button', async () => {
    const { container } = render(<OnboardingWizard suggestedName="" />);

    await userEvent.click(screen.getByRole('button', { name: 'Not yet — I’m first' }));
    await userEvent.type(screen.getByLabelText('Your name'), 'Priya');

    await swipe(container, -100);

    expect(heading()).toHaveTextContent('And what do you call them?');
  });

  it('does not advance on a swipe that stays under the threshold', async () => {
    const { container } = render(<OnboardingWizard suggestedName="" />);

    await userEvent.click(screen.getByRole('button', { name: 'Not yet — I’m first' }));
    await userEvent.type(screen.getByLabelText('Your name'), 'Priya');

    await swipe(container, -10);

    expect(heading()).toHaveTextContent('What should we call you?');
  });

  it('refuses to advance on a swipe past an unanswered required field', async () => {
    const { container } = render(<OnboardingWizard suggestedName="" />);

    await userEvent.click(screen.getByRole('button', { name: 'Not yet — I’m first' }));
    // No name typed.

    await swipe(container, -100);

    expect(heading()).toHaveTextContent('What should we call you?');
    expect(screen.getByRole('alert')).toHaveTextContent(/required/i);
  });

  it('goes back to the previous card on a rightward swipe', async () => {
    const { container } = render(<OnboardingWizard suggestedName="" />);

    await userEvent.click(screen.getByRole('button', { name: 'Not yet — I’m first' }));
    expect(heading()).toHaveTextContent('What should we call you?');

    await swipe(container, 100);

    expect(heading()).toHaveTextContent('Do you have their code?');
  });

  /*
   * The exact bug report: reaching "Where are you two?" (the one choice card that deliberately
   * does not auto-advance on tap, so a stray tap cannot accidentally submit the whole signup) and
   * swiping past it did nothing. A swipe there must submit, the same as tapping "All done ❤️" does.
   */
  it('submits on a leftward swipe past the final card', async () => {
    const { container } = render(<OnboardingWizard suggestedName="" />);

    await userEvent.click(screen.getByRole('button', { name: 'Not yet — I’m first' }));
    await userEvent.type(screen.getByLabelText('Your name'), 'Priya');
    await userEvent.click(screen.getByRole('button', { name: 'Next →' }));
    await userEvent.type(screen.getByLabelText('What you call them'), 'Aarav');
    await userEvent.click(screen.getByRole('button', { name: 'Next →' }));
    await userEvent.click(screen.getByRole('button', { name: 'Female' }));
    await userEvent.type(screen.getByLabelText('Your birth year'), '1998');
    await userEvent.click(screen.getByRole('button', { name: 'Next →' }));
    // Avatar already has a valid default — no pick needed.
    await userEvent.click(screen.getByRole('button', { name: 'Next →' }));
    fireEvent.change(screen.getByLabelText('The day you met'), { target: { value: '2020-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Next →' }));

    expect(heading()).toHaveTextContent('Where are you two?');

    await swipe(container, -100);

    expect(mocks.postToApi).toHaveBeenCalledWith(
      '/api/onboarding',
      expect.objectContaining({ locationType: 'different_city' }),
    );
  });

  it('does not fire a stray click on a choice button a real swipe happens to end over', async () => {
    const { container } = render(<OnboardingWizard suggestedName="" />);

    await swipe(container, -100);

    // A stray click on "Not yet — I'm first" would select hasCode and auto-advance past this card.
    expect(heading()).toHaveTextContent('Do you have their code?');
  });

  /*
   * A gesture the page never sees the end of. A mouse gets no implicit pointer capture, so
   * releasing the button anywhere outside the page — past the window edge, over the toolbar, over
   * the native date picker the "when did you two meet?" card opens — delivers neither `pointerup`
   * nor `pointercancel`. Without capture the drag never learns it is over, and the card is left
   * frozen part-way between two questions at whatever offset the pointer reached.
   */
  it('takes pointer capture so the gesture cannot be lost mid-drag', async () => {
    // jsdom implements no pointer capture at all, so the call itself is what we can observe.
    const capture = vi.fn();
    (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture = capture;

    const { container } = render(<OnboardingWizard suggestedName="" />);
    fireEvent.pointerDown(track(container), { pointerId: 7, clientX: 200 });

    expect(capture).toHaveBeenCalledWith(7);
    delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  });

  it('unwedges the card if the gesture is lost anyway', async () => {
    const { container } = render(<OnboardingWizard suggestedName="" />);
    const el = track(container);

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 200 });
    await act(async () => {
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 60 });
    });
    expect(el.style.transform).toContain('-140px');

    // Capture lost with no pointerup and no pointercancel: the only signal the drag will ever get.
    await act(async () => {
      fireEvent.lostPointerCapture(el, { pointerId: 1 });
    });

    expect(el.style.transform).toBe('translateX(calc(-0% + 0px))');
  });
});
