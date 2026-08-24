'use client';

import { avatarGlyph } from '@/features/onboarding/avatars';
import { usePartnerPresence } from '@/features/presence/usePartnerPresence';

/**
 * Your partner's face, with a badge on its corner saying whether they are here.
 *
 * It replaces the pill that used to report *your own* socket status, which told you something you
 * could already see — the page was working — and left the one genuinely useful fact unsaid. What
 * you actually want to know before pressing Play is whether there is anybody on the other end.
 *
 * Three states, not two. Unknown is its own colour and its own word, because a grey dot that says
 * "offline" about somebody sitting there waiting is worse than admitting we cannot see.
 */

const DOT = {
  online: { className: 'bg-status-online', label: 'online' },
  offline: { className: 'bg-status-offline', label: 'offline' },
  unknown: { className: 'bg-line', label: 'checking' },
} as const;

/**
 * Which of the three states a presence value is in.
 *
 * Shared so the header badge and the drawer row cannot drift apart — two copies of this mapping
 * would eventually disagree about what `null` means, which is the exact distinction the component
 * above exists to preserve.
 */
export function presenceState(online: boolean | null) {
  return online === null ? DOT.unknown : online ? DOT.online : DOT.offline;
}

export function PartnerPresence() {
  const { online, partner } = usePartnerPresence();

  // Nobody to be present or absent yet. The header simply has nothing to say.
  if (!partner) return null;

  const state = presenceState(online);

  return (
    <span
      className="relative inline-flex"
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
        className={`absolute -right-0.5 -bottom-0.5 z-10 size-3 rounded-pill border-2 border-cream transition-colors duration-soft ${state.className}`}
        aria-hidden="true"
      />
    </span>
  );
}

/**
 * The same fact, spelled out, for inside the navigation drawer.
 *
 * The header badge is a glyph and a dot because it has to survive in a 44px strip. The drawer has
 * room to say it properly — the name, the word, and the dot — which answers "is there any point
 * inviting them" before you pick where to go.
 *
 * Deliberately NOT a live region, unlike the badge above. Both are mounted at once whenever the
 * drawer is open, and two polite live regions carrying the same sentence would announce every
 * presence change twice. The badge in the header is the one that announces; this one is read when
 * the reader arrives at it.
 */
export function PartnerPresenceRow() {
  const { online, partner } = usePartnerPresence();

  if (!partner) return null;

  const state = presenceState(online);

  return (
    <div className="flex items-center gap-3 rounded-soft bg-cream px-3 py-3">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-shell text-xl"
        aria-hidden="true"
      >
        {avatarGlyph(partner.avatarKey)}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-display font-semibold text-ink">{partner.nickname}</span>
        {/* The word, not only the colour — docs/06 requires colour never to be the only signal. */}
        <span className="text-xs text-muted">{state.label}</span>
      </span>

      <span
        className={`size-3 shrink-0 rounded-pill transition-colors duration-soft ${state.className}`}
        aria-hidden="true"
      />
    </div>
  );
}
