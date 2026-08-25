import { redirect } from 'next/navigation';
import { PlayScreen } from '@/features/play/PlayScreen';
import { getDashboard } from '@/lib/api';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * A live game session.
 *
 * The id in the URL is not authorization: the socket asks the session registry to hand over this
 * session, and the registry refuses anyone who is not one of its two players. Knowing an id grants
 * nothing (`docs/07_SECURITY_PRIVACY.md`), which is why this page only checks that a signed-in,
 * paired person is asking and leaves the rest to the server.
 */
export default async function PlayPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  const data = await getDashboard();
  if (!data) redirect('/');
  if (!data.viewer) redirect('/onboarding');
  if (!data.couple) redirect('/pairing');

  // Keyed, so moving to the next game of a series is a new screen rather than the old one handed a
  // new id. The play screen holds terminal state — this game is over, here is where you go next —
  // and none of it is true of the game after it.
  return <PlayScreen key={sessionId} sessionId={sessionId} />;
}
