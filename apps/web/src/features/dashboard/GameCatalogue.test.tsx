import type { CatalogueGame } from '@rasmalai/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GameCatalogue } from './GameCatalogue';

// InviteButton owns its own test file and needs a router, the API and presence. Here it only has
// to be identifiable, so the catalogue's own decision — offer it, or don't — can be asserted.
const inviteClicks = vi.hoisted(() => vi.fn());
vi.mock('./InviteButton', () => ({
  InviteButton: ({ gameName }: { gameName: string }) => (
    <button type="button" onClick={() => inviteClicks(gameName)}>{`invite:${gameName}`}</button>
  ),
}));

const game = (over: Partial<CatalogueGame> = {}): CatalogueGame =>
  ({
    slug: 'basketball',
    name: 'Basketball',
    description: 'Sink more than they do.',
    category: 'competitive',
    enabled: true,
    plays: 0,
    yourWins: 0,
    partnerWins: 0,
    draws: 0,
    yourBestScore: null,
    ...over,
  }) as CatalogueGame;

const basketball = game({ slug: 'basketball', name: 'Basketball', category: 'competitive' });
const fourInARow = game({ slug: 'four-in-a-row', name: 'Four in a Row', category: 'competitive' });

describe('GameCatalogue grouping', () => {
  it('introduces each category it has games for', () => {
    render(<GameCatalogue games={[game()]} />);

    expect(screen.getByRole('heading', { name: 'Competitive' })).toBeInTheDocument();
  });

  it('omits a category with nothing in it', () => {
    render(<GameCatalogue games={[game({ category: 'competitive' })]} />);

    expect(screen.queryByRole('heading', { name: 'Cooperative' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Social' })).not.toBeInTheDocument();
  });

  it('files each game under its own category', () => {
    render(
      <GameCatalogue
        games={[
          game({ slug: 'basketball', name: 'Basketball', category: 'competitive' }),
          game({ slug: 'memory', name: 'Memory', category: 'casual' }),
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Competitive' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Casual' })).toBeInTheDocument();
    expect(screen.getByText('Basketball')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
  });
});

describe('GameCatalogue swipe order', () => {
  /*
   * `enabled: false` is the only thing V1 calls "locked" — a game with no module behind it yet.
   * It trails every built game in its category regardless of where the database happened to list
   * it, so swiping through a category always reaches the built games first.
   */
  it('moves a locked game to the end of its category regardless of input order', () => {
    render(
      <GameCatalogue
        games={[
          game({ slug: 'drawing', name: 'Drawing', category: 'casual', enabled: false }),
          game({ slug: 'word-game', name: 'Word Game', category: 'casual', enabled: true }),
        ]}
      />,
    );

    expect(within(screen.getByRole('listitem')).getByText('Word Game')).toBeInTheDocument();
  });
});

describe('GameCatalogue rows', () => {
  it('names and describes every game', () => {
    render(<GameCatalogue games={[game()]} />);

    expect(screen.getByText('Basketball')).toBeInTheDocument();
    expect(screen.getByText('Sink more than they do.')).toBeInTheDocument();
  });

  /*
   * `enabled` means the module exists — it is not progression. Everything is unlocked in V1, so an
   * unbuilt game is listed and described rather than hidden, and simply cannot be started.
   */
  it('lists an unbuilt game, marked as coming, with a lock', () => {
    render(<GameCatalogue games={[game({ enabled: false, name: 'Drawing' })]} />);

    expect(screen.getByText('Drawing')).toBeInTheDocument();
    expect(screen.getByText('soon')).toBeInTheDocument();
    expect(screen.getByText('🔒')).toBeInTheDocument();
  });

  it('offers no way to start an unbuilt game', () => {
    render(<GameCatalogue games={[game({ enabled: false, name: 'Drawing' })]} />);

    expect(screen.queryByRole('button', { name: 'invite:Drawing' })).not.toBeInTheDocument();
  });

  it('offers a built game with no lock', () => {
    render(<GameCatalogue games={[game({ enabled: true, name: 'Basketball' })]} />);

    expect(screen.getByRole('button', { name: 'invite:Basketball' })).toBeInTheDocument();
    expect(screen.queryByText('soon')).not.toBeInTheDocument();
    expect(screen.queryByText('🔒')).not.toBeInTheDocument();
  });
});

describe('GameCatalogue history', () => {
  it('says nothing about history before the first play', () => {
    render(<GameCatalogue games={[game({ plays: 0 })]} />);

    expect(screen.queryByText(/play·|plays/)).not.toBeInTheDocument();
  });

  it('reports the head-to-head once they have played', () => {
    render(<GameCatalogue games={[game({ plays: 6, yourWins: 4, partnerWins: 2 })]} />);

    const row = screen.getByRole('listitem');
    expect(within(row).getByText(/6 plays/)).toBeInTheDocument();
    expect(within(row).getByText(/4–2/)).toBeInTheDocument();
  });

  it('says "play" rather than "plays" for a single one', () => {
    render(<GameCatalogue games={[game({ plays: 1, yourWins: 1 })]} />);

    expect(screen.getByText(/1 play\b/)).toBeInTheDocument();
  });

  it('mentions draws only when there were any', () => {
    render(<GameCatalogue games={[game({ plays: 3, draws: 0 })]} />);
    expect(screen.queryByText(/drawn/)).not.toBeInTheDocument();
  });

  it('counts the draws when there were some', () => {
    render(<GameCatalogue games={[game({ plays: 3, draws: 2 })]} />);
    expect(screen.getByText(/2 drawn/)).toBeInTheDocument();
  });

  /*
   * The number is the platform's, the units are the game's. A game whose score reads as nothing
   * gets no line at all rather than a bare integer nobody can interpret — which is why this is
   * `null`-checked rather than falsy-checked, since zero is a real score.
   */
  it('omits the best score when the game has none to show', () => {
    render(<GameCatalogue games={[game({ plays: 3, yourBestScore: null })]} />);
    expect(screen.queryByText(/best/)).not.toBeInTheDocument();
  });
});

describe('GameCatalogue swipe controls', () => {
  it('shows no swipe controls when a category has only one game', () => {
    render(<GameCatalogue games={[basketball]} />);

    expect(screen.queryByRole('button', { name: /previous game/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next game/i })).not.toBeInTheDocument();
  });

  it('exposes only the active game in a category to assistive tech', () => {
    const { container } = render(<GameCatalogue games={[basketball, fourInARow]} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('moves to the next and previous game on tap, disabled at each end', async () => {
    render(<GameCatalogue games={[basketball, fourInARow]} />);

    const prev = screen.getByRole('button', { name: 'Previous game in Competitive' });
    const next = screen.getByRole('button', { name: 'Next game in Competitive' });
    expect(prev).toBeDisabled();
    expect(next).not.toBeDisabled();
    expect(within(screen.getByRole('listitem')).getByText('Basketball')).toBeInTheDocument();

    await userEvent.click(next);

    expect(within(screen.getByRole('listitem')).getByText('Four in a Row')).toBeInTheDocument();
    expect(next).toBeDisabled();
    expect(prev).not.toBeDisabled();

    await userEvent.click(prev);

    expect(within(screen.getByRole('listitem')).getByText('Basketball')).toBeInTheDocument();
  });

  it('advances to the next game when dragged past the threshold', () => {
    const { container } = render(<GameCatalogue games={[basketball, fourInARow]} />);
    const track = container.querySelector('ul')!;

    fireEvent.pointerDown(track, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100 });

    expect(within(screen.getByRole('listitem')).getByText('Four in a Row')).toBeInTheDocument();
  });

  it('snaps back when a drag does not cross the threshold', () => {
    const { container } = render(<GameCatalogue games={[basketball, fourInARow]} />);
    const track = container.querySelector('ul')!;

    fireEvent.pointerDown(track, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 190 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 190 });

    expect(within(screen.getByRole('listitem')).getByText('Basketball')).toBeInTheDocument();
  });

  it('does not fire the invite button a real drag happens to end over', () => {
    const { container } = render(<GameCatalogue games={[basketball, fourInARow]} />);
    const track = container.querySelector('ul')!;

    fireEvent.pointerDown(track, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100 });
    fireEvent.click(screen.getByRole('button', { name: 'invite:Four in a Row' }));

    expect(inviteClicks).not.toHaveBeenCalled();
  });
});
