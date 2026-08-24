import type { CatalogueGame } from '@rasmalai/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GameCatalogue } from './GameCatalogue';

// InviteButton owns its own test file and needs a router, the API and presence. Here it only has
// to be identifiable, so the catalogue's own decision — offer it, or don't — can be asserted.
vi.mock('./InviteButton', () => ({
  InviteButton: ({ gameName }: { gameName: string }) => (
    <button type="button">{`invite:${gameName}`}</button>
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
  it('lists an unbuilt game, marked as coming', () => {
    render(<GameCatalogue games={[game({ enabled: false, name: 'Drawing' })]} />);

    expect(screen.getByText('Drawing')).toBeInTheDocument();
    expect(screen.getByText('soon')).toBeInTheDocument();
  });

  it('offers no way to start an unbuilt game', () => {
    render(<GameCatalogue games={[game({ enabled: false, name: 'Drawing' })]} />);

    expect(screen.queryByRole('button', { name: 'invite:Drawing' })).not.toBeInTheDocument();
  });

  it('offers a built game', () => {
    render(<GameCatalogue games={[game({ enabled: true, name: 'Basketball' })]} />);

    expect(screen.getByRole('button', { name: 'invite:Basketball' })).toBeInTheDocument();
    expect(screen.queryByText('soon')).not.toBeInTheDocument();
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
