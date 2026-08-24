import { redirect } from 'next/navigation';
import { Card } from '@/design-system/Card';
import { CoupleHeader } from '@/features/dashboard/CoupleHeader';
import { PlayTeaser } from '@/features/dashboard/PlayTeaser';
import { StatsPanels } from '@/features/dashboard/StatsPanels';
import { TournamentCard } from '@/features/dashboard/TournamentCard';
import { getDashboard } from '@/lib/api';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();

  // The authoritative check. The proxy already redirected optimistically, but authorization
  // decisions are made here, next to the data, never on the strength of a cookie alone.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  // One request for the whole page. It answers in all three states, and the two nulls below are
  // what the routing turns on — a missing profile means onboarding, a missing couple means pairing.
  const data = await getDashboard();
  if (!data) redirect('/');
  if (!data.viewer) redirect('/onboarding');
  if (!data.couple || !data.partner || !data.stats) redirect('/pairing');

  const { viewer, couple, partner, stats, games } = data;
  const neverPlayed = stats.together.gamesPlayed === 0;

  return (
    <main className="flex flex-col gap-5">
      <CoupleHeader viewer={viewer} partner={partner} couple={couple} />

      {neverPlayed ? (
        // A wall of zeroes is technically correct and reads as broken. Until there is something to
        // count, the page says so in one line and gets out of the way.
        <Card className="flex flex-col items-center gap-2 text-center">
          <span className="text-2xl" aria-hidden="true">
            🌱
          </span>
          <h2 className="font-display text-base font-semibold text-ink">No games yet</h2>
          <p className="text-sm text-muted">
            Your wins, streaks and terrible defeats all start appearing here after your first match.
          </p>
        </Card>
      ) : (
        <StatsPanels stats={stats} viewer={viewer} partner={partner} />
      )}

      {/* The catalogue itself lives at /games; this is the way in. */}
      <PlayTeaser games={games} />

      {/* Also here and not only on /games: this is the page the app lands you on, so it is the page
          a series has to be visible from — and it is where a tournament game that ended badly sends
          you back to, by the `#tournament` anchor. */}
      <div id="tournament" className="scroll-mt-6">
        <TournamentCard games={games} />
      </div>
    </main>
  );
}
