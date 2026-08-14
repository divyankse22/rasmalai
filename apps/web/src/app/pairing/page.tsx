import { redirect } from 'next/navigation';
import { PairingPanel } from '@/features/pairing/PairingPanel';
import { getMyProfile, getPairingState } from '@/lib/api';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function PairingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  const profile = await getMyProfile();
  if (!profile) redirect('/onboarding');

  const state = await getPairingState();
  if (state?.couple) redirect('/dashboard');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1 text-center">
        <h1 className="font-display text-3xl font-bold text-berry">Find each other</h1>
        <p className="text-muted">One code, one accept, and you are paired for good.</p>
      </header>

      <PairingPanel
        pairingCode={profile.pairingCode}
        incoming={state?.incoming ?? []}
        outgoing={state?.outgoing ?? []}
      />
    </main>
  );
}
