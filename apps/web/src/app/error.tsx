'use client';

import { Button } from '@/design-system/Button';
import { Card } from '@/design-system/Card';
import { SignOutButton } from '@/features/auth/SignOutButton';

export default function PageError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-6">
      <Card className="flex w-full flex-col items-center gap-4 text-center">
        <h1 className="font-display text-xl font-semibold text-ink">We couldn’t load this page</h1>
        <p className="text-muted">Give it a moment, then try again.</p>
        <Button onClick={retry}>Try again</Button>
        <SignOutButton />
      </Card>
    </main>
  );
}
