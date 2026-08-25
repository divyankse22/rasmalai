import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PartnerPresence } from './PartnerPresence';

/*
 * This is the app's clearest instance of the "colour is never the only signal" rule from docs/06:
 * presence is a coloured dot, and the word for that colour lives in the accessible name. If a
 * restyle ever reduces this to a bare dot, these tests fail rather than the information quietly
 * disappearing for anyone who cannot distinguish the three colours.
 */

const { usePartnerPresence } = vi.hoisted(() => ({ usePartnerPresence: vi.fn() }));

vi.mock('@/features/presence/usePartnerPresence', () => ({ usePartnerPresence }));

const PARTNER = { nickname: 'Aarav', avatarKey: 'fox' } as const;

function presence(online: boolean | null, partner: unknown = PARTNER) {
  usePartnerPresence.mockReturnValue({ online, partner });
}

describe('PartnerPresence', () => {
  it('renders nothing when there is no partner yet', () => {
    presence(null, null);
    const { container } = render(<PartnerPresence />);

    expect(container).toBeEmptyDOMElement();
  });

  it('is a polite live region, so a change is announced without interrupting', () => {
    presence(true);
    render(<PartnerPresence />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('says in words that the partner is online', () => {
    presence(true);
    render(<PartnerPresence />);

    expect(screen.getByRole('status', { name: 'Aarav is online' })).toBeInTheDocument();
  });

  it('says in words that the partner is offline', () => {
    presence(false);
    render(<PartnerPresence />);

    expect(screen.getByRole('status', { name: 'Aarav is offline' })).toBeInTheDocument();
  });

  /*
   * Three states, not two. The component's doc comment is explicit that a grey dot claiming
   * "offline" about somebody sitting there waiting is worse than admitting we cannot see — so
   * `null` must stay its own word and never collapse into "offline".
   */
  it('admits when it cannot tell, rather than guessing offline', () => {
    presence(null);
    render(<PartnerPresence />);

    expect(screen.getByRole('status', { name: 'Aarav is checking' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Aarav is offline' })).not.toBeInTheDocument();
  });

  it('names the partner it is reporting on', () => {
    presence(true, { nickname: 'Mira', avatarKey: 'chick' });
    render(<PartnerPresence />);

    expect(screen.getByRole('status', { name: 'Mira is online' })).toBeInTheDocument();
  });

  it('hides the decorative avatar and dot from assistive technology', () => {
    presence(true);
    const { container } = render(<PartnerPresence />);

    // The status element carries the whole message in its own aria-label; the glyph and the dot
    // beneath it must not be read out a second time.
    const decorative = container.querySelectorAll('[aria-hidden="true"]');
    expect(decorative.length).toBe(2);
  });
});
