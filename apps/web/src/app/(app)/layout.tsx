import type { ReactNode } from 'react';
import { AppNav } from '@/features/navigation/AppNav';
import { ConnectionStatusPill } from '@/realtime/ConnectionStatusPill';

/**
 * The shell every signed-in section sits in.
 *
 * The socket lives here rather than on a page, so it survives moving between the dashboard and the
 * games list instead of tearing down and reconnecting on each navigation. That is what P-7 means by
 * keeping the connection open app-wide after login, and it is why an invitation will be able to
 * arrive wherever the person happens to be standing.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 py-8">
      <header className="flex items-center justify-between gap-4">
        <AppNav />
        <ConnectionStatusPill />
      </header>

      {children}
    </div>
  );
}
