import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { nameTone, PersonName } from './PersonName';

/*
 * `nameTone` is the one place in the app where a colour decision is a pure function, so it can be
 * asserted directly. Everything else here sticks to text.
 *
 * Note this file tests the token NAMES, not the colours behind them — `theme.test.ts` owns the
 * values. A restyle may repaint `--color-name-male`; it may not stop distinguishing the two people.
 */

describe('nameTone', () => {
  it('gives each gender its own tone', () => {
    expect(nameTone('male')).toBe('text-name-male');
    expect(nameTone('female')).toBe('text-name-female');
  });

  it('falls back to ordinary ink rather than guessing', () => {
    expect(nameTone(undefined)).toBe('text-ink');
  });

  it('never gives two different people the same tone', () => {
    expect(nameTone('male')).not.toBe(nameTone('female'));
  });
});

describe('PersonName', () => {
  it('renders the name', () => {
    render(<PersonName name="Aarav" gender="male" />);
    expect(screen.getByText('Aarav')).toBeInTheDocument();
  });

  it('renders when the gender is unknown', () => {
    render(<PersonName name="Mira" gender={undefined} />);
    expect(screen.getByText('Mira')).toBeInTheDocument();
  });

  it('keeps a caller class', () => {
    render(<PersonName name="Aarav" gender="male" className="marker-class" />);
    expect(screen.getByText('Aarav')).toHaveClass('marker-class');
  });
});
