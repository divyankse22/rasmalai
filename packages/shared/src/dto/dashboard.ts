/**
 * The couple dashboard payload.
 *
 * `docs/13_ARCHITECTURE_PROPOSAL.md` section 1 puts DTOs in this package, and this is the first
 * payload big enough for that to earn its keep: hand-copying thirty fields into the web app would
 * drift the first time a stat changes shape, and the compiler would say nothing.
 *
 * Everything here is already resolved from the couple's fixed a/b slots into **you** and **them**,
 * so no consumer ever has to know which slot the viewer occupies. Getting that wrong would
 * attribute a win to the wrong partner, which is the one mistake a couple would notice instantly.
 */

export type GameCategory = 'competitive' | 'cooperative' | 'social' | 'casual';
export type GameRenderer = 'react' | 'phaser';

export const GAME_CATEGORIES: readonly GameCategory[] = [
  'competitive',
  'cooperative',
  'social',
  'casual',
];

/** A catalogue entry, carrying this couple's own history with that game. */
export interface CatalogueGame {
  slug: string;
  name: string;
  description: string;
  category: GameCategory;
  /** Drives P-3 and P-4. `category` is only where the catalogue files it. */
  scoringKind: GameCategory;
  renderer: GameRenderer;
  /** False means the module does not exist yet: listed, described, and not invitable. */
  enabled: boolean;

  plays: number;
  yourWins: number;
  partnerWins: number;
  draws: number;
  /** Null until one of you has finished a match of it. Never comparable across games. */
  yourBestScore: number | null;
  partnerBestScore: number | null;
}

export interface DashboardPartner {
  id: string;
  nickname: string;
  avatarKey: string;
  gender: 'male' | 'female';
}

export interface DashboardViewer {
  id: string;
  nickname: string;
  avatarKey: string;
  gender: 'male' | 'female';
  /** P-1: the viewer's own private pet name for their partner. Never shown to the partner. */
  partnerLabelNickname: string;
}

export interface DashboardCouple {
  id: string;
  firstMetDate: string;
  locationType: string;
  /** Computed server-side from the exact first-met date, so both phones agree. */
  daysTogether: number;
}

export interface PlayerRecord {
  wins: number;
  /** Whole percent of completed competitive matches. Both records plus draws total 100. */
  winPercentage: number;
  currentStreak: number;
  longestStreak: number;
  tournamentWins: number;
}

export interface NamedGame {
  gameSlug: string;
  gameName: string;
}

/** P-3's first block: only competitive games reach these numbers. */
export interface CompetitiveStats {
  gamesPlayed: number;
  draws: number;
  you: PlayerRecord;
  partner: PlayerRecord;
  closestMatch: (NamedGame & { margin: number; playedAt: string }) | null;
  /** The competitive game whose finishes land nearest to each other, on average. */
  mostCompetitiveGame: (NamedGame & { averageMargin: number }) | null;
}

/** P-3's second block: every completed match, whatever it scored. */
export interface TogetherStats {
  gamesPlayed: number;
  totalTimePlayedSeconds: number;
  favouriteGame: (NamedGame & { plays: number }) | null;
}

/** The rolling window. Raw matches only exist for seven days anyway (ADR-008). */
export interface RecentStats {
  gamesPlayed: number;
  youWon: number;
  partnerWon: number;
  draws: number;
}

export interface DashboardStats {
  competitive: CompetitiveStats;
  together: TogetherStats;
  lastSevenDays: RecentStats;
}

/**
 * `viewer: null` means onboarding was never completed; `couple: null` means they are not paired
 * yet. The page routes on those two rather than on a status string, so a new field can never be
 * read as "signed in and fine".
 */
export interface DashboardPayload {
  viewer: DashboardViewer | null;
  couple: DashboardCouple | null;
  partner: DashboardPartner | null;
  stats: DashboardStats | null;
  games: CatalogueGame[];
}
