import type { DashboardPartner, DashboardStats, DashboardViewer } from '@rasmalai/shared';
import { Card } from '@/design-system/Card';
import { PersonName } from '@/design-system/PersonName';
import { Stat, VersusStat } from '@/design-system/Stat';

/** Minutes up to an hour, then hours. Nobody wants to read "7,240 seconds together". */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function PanelHeading({ children }: { children: string }) {
  return <h2 className="font-display text-base font-semibold text-ink">{children}</h2>;
}

export function StatsPanels({
  stats,
  viewer,
  partner,
}: {
  stats: DashboardStats;
  viewer: DashboardViewer;
  partner: DashboardPartner;
}) {
  const { competitive, together, lastSevenDays } = stats;

  // Everything below is competitive-only or everything-together, never mixed: P-3 renders the two
  // as separate blocks precisely so a cooperative win never looks like it beat anybody.
  const you = <PersonName name={viewer.nickname} gender={viewer.gender} className="text-sm" />;
  const them = (
    <PersonName name={viewer.partnerLabelNickname} gender={partner.gender} className="text-sm" />
  );

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4">
        <PanelHeading>This week</PanelHeading>
        {lastSevenDays.gamesPlayed === 0 ? (
          <p className="text-sm text-muted">
            Nothing yet this week. Pick something below and start the clock ✨
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="games played" value={lastSevenDays.gamesPlayed} />
              <Stat label="draws" value={lastSevenDays.draws} />
            </div>
            <VersusStat
              label="won this week"
              you={lastSevenDays.youWon}
              them={lastSevenDays.partnerWon}
              yourGender={viewer.gender}
              theirGender={partner.gender}
            />
          </>
        )}
        <p className="text-xs text-muted">
          Match history is kept for seven days. The totals below are forever.
        </p>
      </Card>

      <Card className="flex flex-col gap-4">
        <PanelHeading>Head to head</PanelHeading>
        {competitive.gamesPlayed === 0 ? (
          <p className="text-sm text-muted">
            No competitive games finished yet, so there is nothing to gloat about. Yet.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-muted">
              <span>{you}</span>
              <span>
                {competitive.gamesPlayed} played · {competitive.draws} drawn
              </span>
              <span>{them}</span>
            </div>
            <VersusStat
              label="wins"
              you={competitive.you.wins}
              them={competitive.partner.wins}
              yourGender={viewer.gender}
              theirGender={partner.gender}
            />
            <VersusStat
              label="win rate"
              you={`${competitive.you.winPercentage}%`}
              them={`${competitive.partner.winPercentage}%`}
              yourGender={viewer.gender}
              theirGender={partner.gender}
            />
            <VersusStat
              label="streak now"
              you={competitive.you.currentStreak}
              them={competitive.partner.currentStreak}
              yourGender={viewer.gender}
              theirGender={partner.gender}
            />
            <VersusStat
              label="best streak"
              you={competitive.you.longestStreak}
              them={competitive.partner.longestStreak}
              yourGender={viewer.gender}
              theirGender={partner.gender}
            />
            <VersusStat
              label="tournaments"
              you={competitive.you.tournamentWins}
              them={competitive.partner.tournamentWins}
              yourGender={viewer.gender}
              theirGender={partner.gender}
            />

            {competitive.mostCompetitiveGame && (
              <p className="text-sm text-muted">
                Closest rivalry:{' '}
                <span className="font-display font-semibold text-ink">
                  {competitive.mostCompetitiveGame.gameName}
                </span>{' '}
                — {competitive.mostCompetitiveGame.averageMargin} apart on average.
              </p>
            )}
            {competitive.closestMatch && (
              <p className="text-sm text-muted">
                Closest match ever:{' '}
                <span className="font-display font-semibold text-ink">
                  {competitive.closestMatch.gameName}
                </span>
                , decided by {competitive.closestMatch.margin}.
              </p>
            )}
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <PanelHeading>All together</PanelHeading>
        <div className="grid grid-cols-2 gap-4">
          {/* Every category counts here, competitive or not (P-3). */}
          <Stat label="games played" value={together.gamesPlayed} />
          <Stat label="time played" value={formatDuration(together.totalTimePlayedSeconds)} />
        </div>
        <p className="text-sm text-muted">
          {together.favouriteGame ? (
            <>
              You two keep coming back to{' '}
              <span className="font-display font-semibold text-ink">
                {together.favouriteGame.gameName}
              </span>{' '}
              — {together.favouriteGame.plays}{' '}
              {together.favouriteGame.plays === 1 ? 'time' : 'times'}.
            </>
          ) : (
            'Your favourite game will show up here once you have one.'
          )}
        </p>
      </Card>
    </div>
  );
}
