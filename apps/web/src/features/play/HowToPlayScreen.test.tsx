import type { HowToPlay } from '@rasmalai/games';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HowToPlayScreen } from './HowToPlayScreen';

const rules: HowToPlay = {
  tagline: 'Ten pairs face down. Turn over more of them than they do.',
  steps: [
    'Tap a card to turn it over, then tap a second one.',
    'A matching pair stays face up, and you go again.',
    'Most pairs once the board is clear wins.',
  ],
};

describe('HowToPlayScreen', () => {
  it('introduces itself under its own heading', () => {
    render(<HowToPlayScreen howToPlay={rules} gameName="Memory" onDismiss={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'How to play' })).toBeInTheDocument();
  });

  it('leaves the page heading to PlayScreen, and stays a level below it', () => {
    render(<HowToPlayScreen howToPlay={rules} gameName="Memory" onDismiss={vi.fn()} />);

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'How to play' })).toBeInTheDocument();
  });

  it('leads with the tagline', () => {
    render(<HowToPlayScreen howToPlay={rules} gameName="Memory" onDismiss={vi.fn()} />);

    expect(screen.getByText(rules.tagline)).toBeInTheDocument();
  });

  it('renders the steps as an ordered list, in order', () => {
    render(<HowToPlayScreen howToPlay={rules} gameName="Memory" onDismiss={vi.fn()} />);

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(rules.steps.length);
    // Substring rather than equality: each item also carries a drawn numeral, which is decoration.
    rules.steps.forEach((step, index) => expect(items[index]).toHaveTextContent(step));
  });

  it('names the game on the list, so the steps are not an unlabelled list', () => {
    render(<HowToPlayScreen howToPlay={rules} gameName="Memory" onDismiss={vi.fn()} />);

    expect(screen.getByRole('list', { name: 'How to play Memory' })).toBeInTheDocument();
  });

  it('offers one way out, and takes it once', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<HowToPlayScreen howToPlay={rules} gameName="Memory" onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: 'Got it ✨' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders however many steps it is given', () => {
    const six: HowToPlay = {
      tagline: 'Build words from the letters on the table.',
      steps: ['a', 'b', 'c', 'd', 'e', 'f'],
    };
    render(<HowToPlayScreen howToPlay={six} gameName="Word Game" onDismiss={vi.fn()} />);

    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(6);
  });

  it('keeps the drawn step numbers out of the accessibility tree', () => {
    render(<HowToPlayScreen howToPlay={rules} gameName="Memory" onDismiss={vi.fn()} />);

    // The <ol> already numbers the list for a screen reader. Announcing the drawn numeral too
    // would read every step twice — the same rule PartnerPresence follows for its dot.
    for (const numeral of ['1', '2', '3']) {
      expect(screen.getByText(numeral)).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
