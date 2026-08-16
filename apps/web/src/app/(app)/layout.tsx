import type { ReactNode } from 'react';
import { InvitationCentre } from '@/features/invitations/InvitationCentre';
import { AppNav } from '@/features/navigation/AppNav';
import { SessionWatch } from '@/features/play/SessionWatch';
import { PartnerPresence } from '@/features/presence/PartnerPresence';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';

/**
 * The shell every signed-in section sits in.
 *
 * One socket for the whole app lives here rather than on a page, so it survives moving between
 * sections instead of reconnecting each time. That is what P-7 means by keeping the connection open
 * app-wide after login, and it is what lets an invitation arrive wherever the person is standing —
 * which is exactly what `InvitationCentre` below is waiting for.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider>
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 py-8">
        <header className="flex items-center justify-between gap-4">
          <AppNav />
          {/* Their face and a dot, rather than a report on your own connection: whether there is
              anybody on the other end is the fact worth carrying on every page. */}
          <PartnerPresence />
        </header>

        {children}
      </div>

      <InvitationCentre />
      {/* Also here rather than on `/play`, and for the sharper version of the same reason: the
          person it most needs to reach is the one who has left that page and is two minutes from
          forfeiting a match they may not realise is still running. */}
      <SessionWatch />
    </RealtimeProvider>
  );
}
