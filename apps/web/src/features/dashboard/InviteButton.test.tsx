import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InviteButton } from './InviteButton';

const { usePartnerPresence, postToApi, refresh } = vi.hoisted(() => ({
  usePartnerPresence: vi.fn(),
  postToApi: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/features/presence/usePartnerPresence', () => ({ usePartnerPresence }));
vi.mock('@/lib/clientApi', () => ({ postToApi }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  usePartnerPresence.mockReturnValue({ online: true, partner: { nickname: 'Aarav' } });
  postToApi.mockResolvedValue({ ok: true });
});

const play = () => screen.getByRole('button', { name: 'Ask them to play Basketball' });

describe('InviteButton', () => {
  it('names the game it would invite them to', () => {
    render(<InviteButton gameSlug="basketball" gameName="Basketball" />);
    expect(play()).toBeInTheDocument();
  });

  it('sends the invitation for its own game', async () => {
    render(<InviteButton gameSlug="basketball" gameName="Basketball" />);

    await userEvent.click(play());

    expect(postToApi).toHaveBeenCalledWith('/api/invitations', { gameSlug: 'basketball' });
  });

  it('refreshes the page once the invitation is away', async () => {
    render(<InviteButton gameSlug="basketball" gameName="Basketball" />);

    await userEvent.click(play());

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  /*
   * The rule the component's comment spells out, and it cuts both ways.
   *
   * A known-offline partner is stopped early: the invitation would hold the couple's one slot for
   * five minutes and then die unseen. But `null` means our own connection is down and we simply
   * cannot tell — and not being able to tell is no reason to stop somebody playing. Collapsing
   * those two cases into one `if (!online)` is an easy, plausible-looking mistake.
   */
  it('refuses to spend an invitation on a partner known to be offline', async () => {
    usePartnerPresence.mockReturnValue({ online: false, partner: { nickname: 'Aarav' } });
    render(<InviteButton gameSlug="basketball" gameName="Basketball" />);

    await userEvent.click(play());

    expect(postToApi).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/offline/i);
  });

  it('still invites when presence is unknown', async () => {
    usePartnerPresence.mockReturnValue({ online: null, partner: { nickname: 'Aarav' } });
    render(<InviteButton gameSlug="basketball" gameName="Basketball" />);

    await userEvent.click(play());

    expect(postToApi).toHaveBeenCalledWith('/api/invitations', { gameSlug: 'basketball' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('recovers from an offline refusal so the button still works', async () => {
    usePartnerPresence.mockReturnValue({ online: false, partner: { nickname: 'Aarav' } });
    render(<InviteButton gameSlug="basketball" gameName="Basketball" />);

    await userEvent.click(play());

    // The button must not be left stuck in its busy state after the early return.
    expect(play()).toBeEnabled();
  });

  it('surfaces the reason the server gave', async () => {
    postToApi.mockResolvedValue({
      ok: false,
      error: { message: 'You are already in a game.' },
    });
    render(<InviteButton gameSlug="basketball" gameName="Basketball" />);

    await userEvent.click(play());

    expect(screen.getByRole('alert')).toHaveTextContent('You are already in a game.');
  });

  it('disables itself and says so while asking', async () => {
    let settle: (v: unknown) => void = () => {};
    postToApi.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    render(<InviteButton gameSlug="basketball" gameName="Basketball" />);

    await userEvent.click(play());

    expect(play()).toBeDisabled();
    expect(play()).toHaveTextContent('Asking…');

    settle({ ok: true });
  });
});
