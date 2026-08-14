'use client';

import { useState } from 'react';
import { Button } from '@/design-system/Button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function SignInButton() {
  const [state, setState] = useState<'idle' | 'redirecting' | 'failed'>('idle');

  async function signIn() {
    setState('redirecting');
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    // On success the browser navigates away, so reaching here means it did not work.
    if (error) setState('failed');
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <Button className="w-full" disabled={state === 'redirecting'} onClick={() => void signIn()}>
        {state === 'redirecting' ? 'Taking you to Google…' : 'Continue with Google'}
      </Button>
      {state === 'failed' && (
        <p className="text-sm text-berry">That did not work. Try again in a moment.</p>
      )}
    </div>
  );
}
