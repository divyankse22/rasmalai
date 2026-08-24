import type { SessionEndedPayload, TournamentView } from '@rasmalai/shared';

/**
 * What a session that has stopped says, and where it puts you afterwards.
 *
 * Plain functions rather than anything React-shaped, because the interesting part is the decision
 * and not the rendering: which of several true sentences to say, and which page to return to. That
 * is testable without a DOM, and this is the only part of the play screen that is.
 */

/** How long the ending stays on screen before it takes you back. */
export const RETURN_DELAY_MS = 2_000;

/**
 * Where a finished session sends you.
 *
 * A tournament game returns to the series rather than the top of the dashboard — after a game ends
 * badly the next thing anybody wants is the standings and the way back in, both of which are on the
 * tournament card. Once the series itself is over there is no game left to return to, so this goes
 * to the tournament's own page instead — where the finale lives — rather than a dashboard card that
 * has nothing left to offer but "start another".
 */
export function returnPathFor(tournament: TournamentView | null | undefined): string {
  if (!tournament) return '/dashboard';
  return tournament.status === 'completed' ? `/tournament/${tournament.id}` : '/dashboard#tournament';
}

/**
 * The one true sentence about how this ended, from the reader's side of it.
 *
 * `byUserId` is what stops both partners reading the same frame and each concluding the other one
 * walked out, so every branch that has it uses it.
 */
export function endingMessage({ session, reason, byUserId }: SessionEndedPayload): string {
  const them = session?.partner.nickname ?? 'They';
  const mine = byUserId !== undefined && byUserId === session?.you.userId;

  if (reason === 'server_stopped') {
    return 'Rasmalai restarted, so the game stopped. Nothing was lost but this round.';
  }

  // One of them was gone for the whole 120 seconds. Only reaches here for games with no winner to
  // award (P-3) — a competitive forfeit ends as a result instead, and never as an ending.
  if (reason === 'forfeited') {
    return mine ? 'You did not make it back in time.' : `${them} did not make it back in time.`;
  }

  // A deliberate concession, present the whole time — the opposite of `forfeited` above, and worth
  // a different sentence: nobody was missing, they just stopped. Only reaches here for games with
  // no winner to award (P-3); a competitive give-up ends as a result instead, same as a forfeit.
  if (reason === 'gave_up') {
    return mine ? 'You backed off.' : `${them} backed off.`;
  }

  if (reason !== 'left') {
    return 'Neither of you made it back in time, so this one goes to nobody.';
  }

  /**
   * A declined rematch, which has no event of its own.
   *
   * There is no rematch protocol: offering one is readying up on a `finished` session, and refusing
   * one is leaving it. So a leave from the results screen, while the *other* player was ready, is a
   * decline — and saying "they left the game" to somebody who just asked for another go is both
   * true and the wrong sentence.
   *
   * Never inside a series (D-2). There each game is played once, so readying up on a results screen
   * means "on to the next one" and the other one leaving is a pause, not a refusal.
   */
  const declined =
    session?.phase === 'finished' &&
    session.tournament === null &&
    (mine ? session.partner.ready : session.you.ready);

  if (declined) {
    return mine ? 'No rematch — heading back.' : `${them} would rather not play again.`;
  }

  return mine ? 'You left the game.' : `${them} left the game.`;
}
