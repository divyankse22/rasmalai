import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppNav } from './AppNav';

/*
 * The drawer's contract is almost entirely behavioural, and all of it is the kind of thing a
 * restyle can break without any visible sign: focus movement, the scroll lock, `inert`, and the
 * three separate ways out. `AppNav`'s own doc comment calls a drawer you cannot dismiss on a phone
 * a trap — these tests are what stop it becoming one.
 */

let pathname = '/dashboard';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

beforeEach(() => {
  pathname = '/dashboard';
  document.body.style.overflow = '';
});

const openMenu = () => screen.getByRole('button', { name: 'Open menu' });

// `hidden: true` so this finds the drawer in either state. While closed it is deliberately absent
// from the accessibility tree, which is asserted on its own below rather than assumed here.
const drawer = () => screen.getByRole('dialog', { name: 'Sections', hidden: true });

describe('AppNav trigger', () => {
  it('starts closed and points at the drawer it controls', () => {
    render(<AppNav />);

    expect(openMenu()).toHaveAttribute('aria-expanded', 'false');
    expect(openMenu()).toHaveAttribute('aria-controls', 'app-nav-drawer');
    expect(drawer()).toHaveAttribute('id', 'app-nav-drawer');
  });

  it('marks the closed drawer inert and hidden from assistive technology', () => {
    render(<AppNav />);

    const shell = drawer().parentElement!;
    expect(shell).toHaveAttribute('aria-hidden', 'true');
    expect(shell).toHaveAttribute('inert');
  });

  /*
   * The stronger form of the assertion above: the closed drawer is genuinely gone from the
   * accessibility tree, not merely carrying the attributes that should remove it. A screen reader
   * cannot reach it and neither can the tab order.
   */
  it('keeps the closed drawer out of the accessibility tree entirely', () => {
    render(<AppNav />);

    expect(screen.queryByRole('dialog', { name: 'Sections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Dashboard/ })).not.toBeInTheDocument();
  });

  it('puts the drawer into the accessibility tree once open', async () => {
    render(<AppNav />);

    await userEvent.click(openMenu());

    expect(screen.getByRole('dialog', { name: 'Sections' })).toBeInTheDocument();
  });

  it('opens on click, and stops being hidden', async () => {
    render(<AppNav />);

    await userEvent.click(openMenu());

    expect(openMenu()).toHaveAttribute('aria-expanded', 'true');
    const shell = drawer().parentElement!;
    expect(shell).toHaveAttribute('aria-hidden', 'false');
    expect(shell).not.toHaveAttribute('inert');
  });
});

describe('AppNav drawer', () => {
  it('is a modal dialog', () => {
    render(<AppNav />);
    expect(drawer()).toHaveAttribute('aria-modal', 'true');
  });

  it('moves focus into itself when opened', async () => {
    render(<AppNav />);

    await userEvent.click(openMenu());

    expect(drawer()).toHaveFocus();
  });

  // Without this the page behind the drawer scrolls under your finger on iOS.
  it('locks and then restores body scroll', async () => {
    document.body.style.overflow = 'scroll';
    render(<AppNav />);

    await userEvent.click(openMenu());
    expect(document.body.style.overflow).toBe('hidden');

    await userEvent.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('lists every section with its label and blurb', async () => {
    render(<AppNav />);
    await userEvent.click(openMenu());

    const dashboard = screen.getByRole('link', { name: /Dashboard/ });
    const games = screen.getByRole('link', { name: /Games/ });

    expect(dashboard).toHaveAttribute('href', '/dashboard');
    expect(games).toHaveAttribute('href', '/games');
    expect(screen.getByText('The two of you, by the numbers')).toBeInTheDocument();
    expect(screen.getByText('Everything you can play')).toBeInTheDocument();
  });

  it('marks only the current section as the current page', async () => {
    render(<AppNav />);
    await userEvent.click(openMenu());

    expect(screen.getByRole('link', { name: /Dashboard/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: /Games/ })).not.toHaveAttribute('aria-current');
  });

  it('follows the route when deciding which section is current', async () => {
    pathname = '/games';
    render(<AppNav />);
    await userEvent.click(openMenu());

    expect(screen.getByRole('link', { name: /Games/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Dashboard/ })).not.toHaveAttribute('aria-current');
  });
});

/*
 * Three ways out, per the component's own doc comment. Each gets its own test so that losing one
 * is a specific failure rather than a general one.
 */
describe('AppNav dismissal', () => {
  it('closes on Escape', async () => {
    render(<AppNav />);
    await userEvent.click(openMenu());

    await userEvent.keyboard('{Escape}');

    expect(openMenu()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on the close button', async () => {
    render(<AppNav />);
    await userEvent.click(openMenu());

    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));

    expect(openMenu()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when the backdrop is clicked', async () => {
    render(<AppNav />);
    await userEvent.click(openMenu());

    // The backdrop is the drawer's sibling inside the fixed shell, and is deliberately not
    // reachable by role — it is decorative to assistive technology and only exists for the thumb.
    const backdrop = drawer().parentElement!.firstElementChild!;
    await userEvent.click(backdrop);

    expect(openMenu()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when the route changes underneath it', async () => {
    const { rerender } = render(<AppNav />);
    await userEvent.click(openMenu());
    expect(openMenu()).toHaveAttribute('aria-expanded', 'true');

    // A route change can come from anywhere — a link in here, the back button, a redirect.
    pathname = '/games';
    rerender(<AppNav />);

    expect(openMenu()).toHaveAttribute('aria-expanded', 'false');
  });
});
