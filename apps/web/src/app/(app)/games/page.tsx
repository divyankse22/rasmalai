import { redirect } from 'next/navigation';
import { GameCatalogue } from '@/features/dashboard/GameCatalogue';
import { TournamentCard } from '@/features/dashboard/TournamentCard';
import { getDashboard } from '@/lib/api';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Everything the two of them can play.
 *
 * Same authorization and the same routing as the dashboard — a game list is couple-scoped data
 * (it carries their own record with each game), so it is not reachable a step earlier than the
 * dashboard is.
 */
export default async function GamesPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  const data = await getDashboard();
  if (!data) redirect('/');
  if (!data.viewer) redirect('/onboarding');
  if (!data.couple) redirect('/pairing');

  return (
    <main className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="font-display text-2xl font-bold text-berry">Games</h1>
        <p className="text-sm text-muted">
          Everything is unlocked. The ones marked <em>soon</em> are still being built.
        </p>
      </div>

      <GameCatalogue games={data.games} />

      {/* The same catalogue the list above renders, so a series can only be built from games that
          actually exist. The card filters it down to the ones with a module behind them. */}
      <div id="tournament" className="scroll-mt-6">
        <TournamentCard games={data.games} />
      </div>
    </main>
  );
}
