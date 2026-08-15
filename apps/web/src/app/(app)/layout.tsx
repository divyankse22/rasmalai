import type { ReactNode } from 'react';
import { InvitationCentre } from '@/features/invitations/InvitationCentre';
import { AppNav } from '@/features/navigation/AppNav';
import { ConnectionStatusPill } from '@/realtime/ConnectionStatusPill';
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
          <ConnectionStatusPill />
        </header>

        {children}
      </div>

      <InvitationCentre />
    </RealtimeProvider>
  );
}
