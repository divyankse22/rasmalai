'use client';

import { avatarGlyph } from '@/features/onboarding/avatars';
import { usePartnerPresence } from '@/features/presence/usePartnerPresence';

/**
 * Your partner's face, with a dot under it saying whether they are here.
 *
 * It replaces the pill that used to report *your own* socket status, which told you something you
 * could already see — the page was working — and left the one genuinely useful fact unsaid. What
 * you actually want to know before pressing Play is whether there is anybody on the other end.
 *
 * Three states, not two. Unknown is its own colour and its own word, because a grey dot that says
 * "offline" about somebody sitting there waiting is worse than admitting we cannot see.
 */

const DOT = {
  online: { className: 'bg-mint', label: 'online' },
  offline: { className: 'bg-blush', label: 'offline' },
  unknown: { className: 'bg-line', label: 'checking' },
} as const;

export function PartnerPresence() {
  const { online, partner } = usePartnerPresence();

  // Nobody to be present or absent yet. The header simply has nothing to say.
  if (!partner) return null;

  const state = online === null ? DOT.unknown : online ? DOT.online : DOT.offline;

  return (
    <span
      className="flex flex-col items-center gap-1"
      role="status"
      aria-live="polite"
      aria-label={`${partner.nickname} is ${state.label}`}
    >
      <span
        className="flex size-9 items-center justify-center rounded-pill bg-cream text-xl"
        aria-hidden="true"
      >
        {avatarGlyph(partner.avatarKey)}
      </span>
      <span
        className={`size-2 rounded-pill transition-colors duration-soft ${state.className}`}
        aria-hidden="true"
      />
    </span>
  );
}
