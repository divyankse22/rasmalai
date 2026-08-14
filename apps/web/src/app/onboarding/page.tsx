import { redirect } from 'next/navigation';
import { OnboardingForm } from '@/features/onboarding/OnboardingForm';
import { getMyProfile } from '@/lib/api';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  // Onboarding happens once. Coming back here afterwards just returns you to the dashboard.
  if (await getMyProfile()) redirect('/dashboard');

  const suggestedName =
    typeof user.user_metadata.full_name === 'string' ? user.user_metadata.full_name : '';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1 text-center">
        <h1 className="font-display text-3xl font-bold text-berry">Tell us about you two</h1>
        <p className="text-muted">Only the two of you will ever see any of this.</p>
      </header>

      <OnboardingForm suggestedName={suggestedName} />
    </main>
  );
}
