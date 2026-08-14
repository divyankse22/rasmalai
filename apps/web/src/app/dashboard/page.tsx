import { redirect } from 'next/navigation';
import { Card } from '@/design-system/Card';
import { SignOutButton } from '@/features/auth/SignOutButton';
import { avatarGlyph } from '@/features/onboarding/avatars';
import { getMyProfile, getPairingState } from '@/lib/api';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ConnectionStatusPill } from '@/realtime/ConnectionStatusPill';

/** Days together, computed from the exact first-met date (docs/01_PRODUCT_SPEC.md section 16). */
function daysTogether(firstMetDate: string, today = new Date()): number {
  const met = new Date(`${firstMetDate}T00:00:00Z`);
  const now = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return Math.max(0, Math.round((now.getTime() - met.getTime()) / 86_400_000));
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();

  // The authoritative check. The proxy already redirected optimistically, but authorization
  // decisions are made here, next to the data, never on the strength of a cookie alone.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  const profile = await getMyProfile();
  if (!profile) redirect('/onboarding');

  const state = await getPairingState();
  if (!state?.couple) redirect('/pairing');

  const { couple } = state;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span
            className="flex size-11 items-center justify-center rounded-pill bg-blush text-2xl"
            aria-hidden="true"
          >
            {avatarGlyph(profile.avatarKey)}
          </span>
          <span className="text-xl" aria-hidden="true">
            ❤️
          </span>
          <span
            className="flex size-11 items-center justify-center rounded-pill bg-lilac text-2xl"
            aria-hidden="true"
          >
            {avatarGlyph(couple.partner.avatarKey)}
          </span>
        </div>
        <ConnectionStatusPill />
      </header>

      <Card className="flex flex-col items-center gap-2 text-center">
        <p className="font-display text-2xl font-bold text-berry">
          {profile.nickname} &amp; {profile.partnerLabelNickname}
        </p>
        <p className="text-muted">
          {daysTogether(couple.firstMetDate).toLocaleString()} days together
        </p>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-display text-lg font-semibold text-ink">You are paired 🎉</h2>
        <p className="text-muted">
          Games, invitations and the real dashboard arrive in the next slices.
        </p>
      </Card>

      <div className="mt-auto flex justify-center">
        <SignOutButton />
      </div>
    </main>
  );
}
