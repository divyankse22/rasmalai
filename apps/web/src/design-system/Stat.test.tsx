import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Stat, VersusStat } from './Stat';

describe('Stat', () => {
  it('renders the value and its label', () => {
    render(<Stat label="Games played" value={12} />);

    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Games played')).toBeInTheDocument();
  });

  it('renders a hint when given one', () => {
    render(<Stat label="Streak" value={3} hint="best yet" />);
    expect(screen.getByText('best yet')).toBeInTheDocument();
  });

  it('renders no hint when not given one', () => {
    render(<Stat label="Streak" value={3} />);
    expect(screen.queryByText('best yet')).not.toBeInTheDocument();
  });

  it('accepts a node as the value, not only a number', () => {
    render(<Stat label="Together" value={<span>1 year</span>} />);
    expect(screen.getByText('1 year')).toBeInTheDocument();
  });
});

describe('VersusStat', () => {
  it('renders both numbers and the label between them', () => {
    const { container } = render(
      <VersusStat label="wins" you={7} them={4} yourGender="female" theirGender="male" />,
    );

    const row = container.firstElementChild!;
    // DOM order is load-bearing: yours, the label, theirs. A restyle that reflows this row must
    // not swap the two people over.
    expect(within(row as HTMLElement).getAllByText(/^(7|wins|4)$/).map((n) => n.textContent)).toEqual(
      ['7', 'wins', '4'],
    );
  });

  /*
   * The behavioural claim in VersusStat's doc comment: each number takes its OWNER's colour, not
   * the colour of the side it sits on. Asserting the tone class here is deliberate — it is the
   * only way to prove the two are distinguished, and `nameTone` is a pure function whose output
   * is a token name rather than a visual value.
   */
  it('tints each number by its owner, not by its position', () => {
    const { container } = render(
      <VersusStat label="wins" you={7} them={4} yourGender="female" theirGender="male" />,
    );

    expect(screen.getByText('7')).toHaveClass('text-name-female');
    expect(screen.getByText('4')).toHaveClass('text-name-male');
    expect(container).toBeTruthy();
  });

  it('still distinguishes the two when the genders are reversed', () => {
    render(<VersusStat label="wins" you={7} them={4} yourGender="male" theirGender="female" />);

    expect(screen.getByText('7')).toHaveClass('text-name-male');
    expect(screen.getByText('4')).toHaveClass('text-name-female');
  });

  it('falls back to ink when a gender is unknown', () => {
    render(
      <VersusStat label="wins" you={7} them={4} yourGender={undefined} theirGender={undefined} />,
    );

    expect(screen.getByText('7')).toHaveClass('text-ink');
    expect(screen.getByText('4')).toHaveClass('text-ink');
  });
});
