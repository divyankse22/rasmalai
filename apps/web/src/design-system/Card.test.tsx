import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Card } from './Card';

/*
 * Card is one div with a class string, so there is almost nothing to characterize except the
 * things a restyle could break by accident: that it still renders what it is given, that it still
 * forwards the props call sites depend on, and that it stays invisible to assistive technology.
 */

describe('Card', () => {
  it('renders its children', () => {
    render(
      <Card>
        <p>Four games played</p>
      </Card>,
    );
    expect(screen.getByText('Four games played')).toBeInTheDocument();
  });

  it('forwards arbitrary div attributes', () => {
    render(
      <Card id="stats" aria-label="Your statistics" data-testid="card">
        content
      </Card>,
    );

    const card = screen.getByTestId('card');
    expect(card).toHaveAttribute('id', 'stats');
    expect(card).toHaveAttribute('aria-label', 'Your statistics');
  });

  it('forwards onClick', async () => {
    const onClick = vi.fn();
    render(
      <Card onClick={onClick} data-testid="card">
        content
      </Card>,
    );

    await userEvent.click(screen.getByTestId('card'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  /*
   * A Card is a visual container, not a landmark. If it ever grew an implicit role — by becoming
   * a <section> with a label, say — every screen would gain a layer of nesting in the
   * accessibility tree that nobody asked for.
   */
  it('adds no implicit role', () => {
    const { container } = render(<Card>content</Card>);
    expect(container.firstElementChild?.tagName).toBe('DIV');
    expect(container.firstElementChild).not.toHaveAttribute('role');
  });

  it('keeps caller classes alongside its own', () => {
    // Not an assertion about *which* classes — only that a caller's className survives at all.
    // Several call sites pass layout utilities and would break silently if it were dropped.
    const { container } = render(<Card className="marker-class">content</Card>);
    expect(container.firstElementChild).toHaveClass('marker-class');
  });
});
