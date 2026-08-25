import type { DashboardCouple, DashboardPartner, DashboardViewer } from '@rasmalai/shared';
import { Card } from '@/design-system/Card';
import { PersonName } from '@/design-system/PersonName';
import { avatarGlyph } from '@/features/onboarding/avatars';

/** Written out rather than prettifying the enum, so the copy reads like a person wrote it. */
const LOCATION_LABEL: Record<string, string> = {
  same_city: 'same city',
  different_city: 'different cities',
  live_in: 'living together',
  prefer_not_to_say: '',
};

export function CoupleHeader({
  viewer,
  partner,
  couple,
}: {
  viewer: DashboardViewer;
  partner: DashboardPartner;
  couple: DashboardCouple;
}) {
  const location = LOCATION_LABEL[couple.locationType] ?? '';

  return (
    <Card className="flex flex-col items-center gap-3 text-center">
      <div className="flex items-center gap-3">
        <span
          className="flex size-14 items-center justify-center rounded-pill bg-blush text-3xl"
          aria-hidden="true"
        >
          {avatarGlyph(viewer.avatarKey)}
        </span>
        <span className="text-xl" aria-hidden="true">
          ❤️
        </span>
        <span
          className="flex size-14 items-center justify-center rounded-pill bg-sky text-3xl"
          aria-hidden="true"
        >
          {avatarGlyph(partner.avatarKey)}
        </span>
      </div>

      <h1 className="font-display text-2xl font-bold">
        {/* P-1: they are named by the viewer's own private label, in their own colour. */}
        <PersonName name={viewer.nickname} gender={viewer.gender} className="text-2xl" />
        <span className="text-ink"> &amp; </span>
        <PersonName
          name={viewer.partnerLabelNickname}
          gender={partner.gender}
          className="text-2xl"
        />
      </h1>

      <p className="text-muted">
        <span className="font-display font-semibold text-berry">
          {couple.daysTogether.toLocaleString()}
        </span>{' '}
        {couple.daysTogether === 1 ? 'day' : 'days'} together
        {location && <span> · {location}</span>}
      </p>
    </Card>
  );
}
