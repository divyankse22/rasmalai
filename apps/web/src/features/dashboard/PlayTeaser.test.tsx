import type { CatalogueGame } from '@rasmalai/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlayTeaser } from './PlayTeaser';

const games = (count: number): CatalogueGame[] =>
  Array.from({ length: count }, (_, i) => ({ slug: `game-${i}`, name: `Game ${i}` }) as CatalogueGame);

describe('PlayTeaser', () => {
  it('invites the reader to play', () => {
    render(<PlayTeaser games={games(3)} />);
    expect(
      screen.getByRole('heading', { name: 'Want to play some games?' }),
    ).toBeInTheDocument();
  });

  it('links to the catalogue', () => {
    render(<PlayTeaser games={games(3)} />);
    expect(screen.getByRole('link', { name: 'Play games' })).toHaveAttribute('href', '/games');
  });

  it('counts the games it did not have room to show', () => {
    // PREVIEW is 4, so ten games means six left over.
    render(<PlayTeaser games={games(10)} />);
    expect(screen.getByText('+6 more')).toBeInTheDocument();
  });

  it('counts nothing when every game fits', () => {
    render(<PlayTeaser games={games(4)} />);
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
  });

  it('still offers the way in when there are no games at all', () => {
    render(<PlayTeaser games={[]} />);

    expect(screen.getByRole('link', { name: 'Play games' })).toBeInTheDocument();
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
  });
});
