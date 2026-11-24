'use client';

import { useState } from 'react';
import { Button } from '@/design-system/Button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function SignInButton() {
  const [state, setState] = useState<'idle' | 'redirecting' | 'failed'>('idle');

  async function signIn() {
    setState('redirecting');
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) setState('failed');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <Button className="w-full" disabled={state === 'redirecting'} onClick={() => void signIn()}>
        {state === 'redirecting' ? 'Taking you to Google…' : 'Continue with Google'}
      </Button>
      {state === 'failed' && (
        <p className="text-sm text-berry" role="alert">
          That did not work. Try again in a moment.
        </p>
      )}
    </div>
  );
}
