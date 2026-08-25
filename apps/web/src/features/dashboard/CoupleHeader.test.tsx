import type { DashboardCouple, DashboardPartner, DashboardViewer } from '@rasmalai/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CoupleHeader } from './CoupleHeader';

const viewer = (over: Partial<DashboardViewer> = {}) =>
  ({
    nickname: 'Mira',
    partnerLabelNickname: 'Bear',
    gender: 'female',
    avatarKey: 'chick',
    ...over,
  }) as DashboardViewer;

const partner = (over: Partial<DashboardPartner> = {}) =>
  ({ gender: 'male', avatarKey: 'fox', nickname: 'Aarav', ...over }) as DashboardPartner;

const couple = (over: Partial<DashboardCouple> = {}) =>
  ({ daysTogether: 412, locationType: 'same_city', ...over }) as DashboardCouple;

describe('CoupleHeader', () => {
  it('names both people in the page heading', () => {
    render(<CoupleHeader viewer={viewer()} partner={partner()} couple={couple()} />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Mira');
    expect(heading).toHaveTextContent('Bear');
  });

  /*
   * P-1, and the most important assertion in this file.
   *
   * The partner is shown by the VIEWER'S OWN private label for them, never by the partner's own
   * nickname. Rendering `partner.nickname` here would leak one person's chosen name to the other,
   * and it would look completely reasonable in a diff.
   */
  it("uses the viewer's private label for the partner, not the partner's own nickname", () => {
    render(
      <CoupleHeader
        viewer={viewer({ partnerLabelNickname: 'Bear' })}
        partner={partner({ nickname: 'Aarav' })}
        couple={couple()}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Bear');
    expect(screen.queryByText('Aarav')).not.toBeInTheDocument();
  });

  it('counts the days together', () => {
    render(<CoupleHeader viewer={viewer()} partner={partner()} couple={couple({ daysTogether: 412 })} />);
    expect(screen.getByText('412')).toBeInTheDocument();
    expect(screen.getByText(/days together/)).toBeInTheDocument();
  });

  it('says "day" rather than "days" on the first one', () => {
    render(<CoupleHeader viewer={viewer()} partner={partner()} couple={couple({ daysTogether: 1 })} />);
    expect(screen.getByText(/\bday together/)).toBeInTheDocument();
  });

  it.each([
    ['same_city', 'same city'],
    ['different_city', 'different cities'],
    ['live_in', 'living together'],
  ])('describes the %s arrangement in words', (locationType, label) => {
    render(
      <CoupleHeader
        viewer={viewer()}
        partner={partner()}
        couple={couple({ locationType: locationType as DashboardCouple['locationType'] })}
      />,
    );
    expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
  });

  it('says nothing about location when they would rather not say', () => {
    render(
      <CoupleHeader
        viewer={viewer()}
        partner={partner()}
        couple={couple({ locationType: 'prefer_not_to_say' as DashboardCouple['locationType'] })}
      />,
    );

    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  // The two faces and the heart are decoration; the heading already names both people.
  it('hides the avatars from assistive technology', () => {
    const { container } = render(
      <CoupleHeader viewer={viewer()} partner={partner()} couple={couple()} />,
    );
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(3);
  });
});
