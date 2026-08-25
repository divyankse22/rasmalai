import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button, ButtonLink } from './Button';

/*
 * Characterization tests: these describe what Button DOES, never what it looks like.
 *
 * Nothing here may assert on a class name, a radius, a colour or a font. The whole point is that
 * this file stays byte-identical through a restyle — if it needs editing to go green, behaviour
 * moved and that is the bug.
 */

describe('Button', () => {
  it('is a real button, named by its children', () => {
    render(<Button>Send the invite</Button>);
    expect(screen.getByRole('button', { name: 'Send the invite' })).toBeInTheDocument();
  });

  it('calls onClick when pressed', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Ready</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Ready' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick while disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Ready
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Ready' });
    expect(button).toBeDisabled();
    await userEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  // The variant is a purely visual axis. It must never leak into the accessibility tree, or a
  // restyle that reshuffles variants would change what a screen reader announces.
  it.each(['primary', 'soft', 'ghost'] as const)(
    'exposes the %s variant as an identically-named button',
    (variant) => {
      render(<Button variant={variant}>Play again</Button>);
      expect(screen.getByRole('button', { name: 'Play again' })).toBeInTheDocument();
    },
  );

  it('forwards arbitrary button attributes', () => {
    render(
      <Button type="submit" aria-describedby="hint" data-testid="submit">
        Finish
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Finish' });
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toHaveAttribute('aria-describedby', 'hint');
  });
});

describe('ButtonLink', () => {
  /*
   * The load-bearing invariant, called out in Button.tsx's own doc comment: a control that
   * navigates must stay a real link. If a restyle ever collapses these two into one component,
   * this is the test that catches it.
   */
  it('is a link, not a button', () => {
    render(<ButtonLink href="/games">Browse games</ButtonLink>);

    const link = screen.getByRole('link', { name: 'Browse games' });
    expect(link).toHaveAttribute('href', '/games');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(['primary', 'soft', 'ghost'] as const)(
    'exposes the %s variant as an identically-named link',
    (variant) => {
      render(
        <ButtonLink href="/dashboard" variant={variant}>
          Go home
        </ButtonLink>,
      );
      expect(screen.getByRole('link', { name: 'Go home' })).toBeInTheDocument();
    },
  );
});
