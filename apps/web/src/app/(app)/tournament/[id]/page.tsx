import { redirect } from 'next/navigation';
import { TournamentScreen } from '@/features/tournament/TournamentScreen';
import { getDashboard } from '@/lib/api';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * One tournament's own page, kept separate from the live game it may have been reached from
 * (`docs/06_UX_AND_STATE_FLOWS.md`, `/play/[sessionId]`). The id in the URL is not authorization:
 * the backend only ever answers with a tournament belonging to the caller's own couple.
 */
export default async function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  const data = await getDashboard();
  if (!data) redirect('/');
  if (!data.viewer) redirect('/onboarding');
  if (!data.couple) redirect('/pairing');

  return <TournamentScreen key={id} tournamentId={id} />;
}
