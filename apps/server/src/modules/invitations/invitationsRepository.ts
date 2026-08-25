import type { Pool, PoolClient } from 'pg';
import type { InvitationView } from '@rasmalai/shared';
import type { Gender } from '../users/user.schema';

/**
 * Game invitations.
 *
 * Two rules do all the work here and both are enforced by the database rather than by remembering
 * to check:
 *
 * - **One active invitation per couple** (ADR-010) is the partial unique index. Invalidating the
 *   old row and inserting the new one share a transaction, so two devices sending different
 *   invitations at the same moment cannot both end up pending — one of them loses on the index.
 * - **Five-minute TTL** is `expires_at`, and *every read treats a past `expires_at` as expired*
 *   regardless of what `status` says. The sweeper writes the row eventually, but a reader must
 *   never be told an invitation is live because a timer has not fired yet — in-process timers die
 *   with the process.
 */

export class InvitationError extends Error {
  constructor(
    readonly code:
      | 'not_paired'
      | 'game_not_found'
      | 'game_not_playable'
      | 'invitation_not_found'
      | 'invitation_not_pending'
      | 'invitation_expired'
      | 'cannot_answer_own'
      | 'not_your_invitation'
      | 'already_in_game',
    message: string,
  ) {
    super(message);
  }
}

export interface CreatedInvitation {
  invitation: InvitationView;
  /** The partner, who needs telling. */
  otherUserId: string;
  /** The invitation this one displaced, if any, so its own screens can be cleared. */
  invalidatedId: string | null;
}

export interface RespondedInvitation {
  invitationId: string;
  accepted: boolean;
  coupleId: string;
  gameSlug: string;
  gameName: string;
  otherUserId: string;
  /** Set only when a decline carried a counter-proposal (P-7). */
  counterInvitation: InvitationView | null;
}

export interface InvitationsRepository {
  /** The couple's one live invitation as this user sees it, or null. */
  activeFor(userId: string): Promise<InvitationView | null>;
  /**
   * One invitation, rendered for one reader.
   *
   * Needed because `direction` and `otherUser` differ per partner: the same row is "incoming, from
   * Rukmini" for one of them and "outgoing, to Kabir" for the other. Every event therefore carries
   * a payload built per recipient rather than one shared object.
   */
  viewFor(invitationId: string, userId: string): Promise<InvitationView | null>;
  create(userId: string, gameSlug: string): Promise<CreatedInvitation>;
  respond(
    userId: string,
    invitationId: string,
    accept: boolean,
    counterGameSlug?: string,
  ): Promise<RespondedInvitation>;
  /** Withdraws an invitation. Only the person who sent it may do this. */
  cancel(userId: string, invitationId: string): Promise<{ otherUserId: string }>;
  /** Marks every overdue pending invitation expired. Returns what it closed, so they can be told. */
  sweepExpired(): Promise<{ id: string; coupleId: string; userIds: string[] }[]>;
}

/**
 * Aliased for the reason the pairing repository documents at length: `invitations`, `games` and
 * `users` all have an `id`, and node-postgres lets a later column silently overwrite an earlier
 * one. Unaliased joins here would hand back a game id as an invitation id.
 */
const VIEW_COLUMNS = `i.id as invitation_id, i.status, i.created_at, i.expires_at,
  i.created_by_user_id, i.couple_id,
  g.slug as game_slug, g.name as game_name,
  o.id as other_id, o.nickname as other_nickname,
  o.avatar_key as other_avatar_key, o.gender as other_gender`;

interface ViewRow {
  invitation_id: string;
  status: InvitationView['status'];
  created_at: Date;
  expires_at: Date;
  created_by_user_id: string;
  couple_id: string;
  game_slug: string;
  game_name: string;
  other_id: string;
  other_nickname: string;
  other_avatar_key: string;
  other_gender: Gender;
}

/**
 * `viewerId` decides which way the invitation points and who "the other person" is, so a single
 * row renders correctly for either partner without the client working anything out.
 */
function toView(row: ViewRow, viewerId: string): InvitationView {
  return {
    id: row.invitation_id,
    gameSlug: row.game_slug,
    gameName: row.game_name,
    status: row.status,
    direction: row.created_by_user_id === viewerId ? 'outgoing' : 'incoming',
    otherUser: {
      id: row.other_id,
      nickname: row.other_nickname,
      avatarKey: row.other_avatar_key,
      gender: row.other_gender,
    },
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

/** Resolves the caller's couple and partner from membership. Never from anything the browser sent. */
async function requireCouple(
  executor: Pick<Pool, 'query'>,
  userId: string,
): Promise<{ coupleId: string; partnerId: string }> {
  const { rows } = await executor.query<{ id: string; partner_id: string }>(
    `select c.id,
            case when c.user_a_id = $1 then c.user_b_id else c.user_a_id end as partner_id
       from public.couples c
      where c.user_a_id = $1 or c.user_b_id = $1`,
    [userId],
  );

  const row = rows[0];
  if (!row) throw new InvitationError('not_paired', 'Pair with your person first.');
  return { coupleId: row.id, partnerId: row.partner_id };
}

async function requirePlayableGame(
  client: PoolClient,
  slug: string,
): Promise<{ id: string; name: string; slug: string }> {
  const { rows } = await client.query<{ id: string; name: string; slug: string; enabled: boolean }>(
    'select id, name, slug, enabled from public.games where slug = $1',
    [slug],
  );

  const row = rows[0];
  if (!row) throw new InvitationError('game_not_found', 'We do not know that game.');
  // The catalogue lists games that have no module yet. They can be looked at, not started.
  if (!row.enabled) {
    throw new InvitationError('game_not_playable', 'That one is not ready to play yet.');
  }
  return { id: row.id, name: row.name, slug: row.slug };
}

/** Reads one invitation back as a view, by id, from the perspective of `viewerId`. */
async function readView(
  executor: Pick<Pool, 'query'>,
  invitationId: string,
  viewerId: string,
): Promise<InvitationView | null> {
  const { rows } = await executor.query<ViewRow>(
    `select ${VIEW_COLUMNS}
       from public.invitations i
       join public.games g on g.id = i.game_id
       join public.couples c on c.id = i.couple_id
       join public.users o
         on o.id = case when i.created_by_user_id = $2
                        then (case when c.user_a_id = $2 then c.user_b_id else c.user_a_id end)
                        else i.created_by_user_id end
      where i.id = $1`,
    [invitationId, viewerId],
  );

  const row = rows[0];
  return row ? toView(row, viewerId) : null;
}

export function createInvitationsRepository(pool: Pool): InvitationsRepository {
  return {
    viewFor(invitationId, userId) {
      return readView(pool, invitationId, userId);
    },

    async activeFor(userId) {
      const { rows } = await pool.query<ViewRow>(
        `select ${VIEW_COLUMNS}
           from public.invitations i
           join public.games g on g.id = i.game_id
           join public.couples c on c.id = i.couple_id
           join public.users o
             on o.id = case when i.created_by_user_id = $1
                            then (case when c.user_a_id = $1 then c.user_b_id else c.user_a_id end)
                            else i.created_by_user_id end
          where (c.user_a_id = $1 or c.user_b_id = $1)
            and i.status = 'pending'
            -- Lazy expiry. The sweeper will get to the row, but a reader must never be handed a
            -- live invitation that is already past its moment.
            and i.expires_at > now()
          order by i.created_at desc
          limit 1`,
        [userId],
      );

      const row = rows[0];
      return row ? toView(row, userId) : null;
    },

    async create(userId, gameSlug) {
      const client = await pool.connect();
      try {
        await client.query('begin');

        const { coupleId, partnerId } = await requireCouple(client, userId);
        const game = await requirePlayableGame(client, gameSlug);

        // Lock the couple's pending row, if any, before displacing it. Without this, two
        // simultaneous sends could both read "nothing pending" and then race the unique index.
        const previous = await client.query<{ id: string }>(
          `select id from public.invitations
            where couple_id = $1 and status = 'pending' for update`,
          [coupleId],
        );

        const displaced = previous.rows[0]?.id ?? null;
        if (displaced) {
          // ADR-010: a new invitation invalidates the previous one immediately.
          await client.query(
            `update public.invitations
                set status = 'invalidated', responded_at = now()
              where id = $1`,
            [displaced],
          );
        }

        const inserted = await client.query<{ id: string }>(
          `insert into public.invitations (couple_id, game_id, created_by_user_id, replaces_invitation_id)
           values ($1, $2, $3, $4) returning id`,
          [coupleId, game.id, userId, displaced],
        );

        const invitationId = inserted.rows[0]!.id;
        const view = await readView(client, invitationId, userId);
        await client.query('commit');

        if (!view) throw new Error('invitation vanished immediately after insert');
        return { invitation: view, otherUserId: partnerId, invalidatedId: displaced };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async respond(userId, invitationId, accept, counterGameSlug) {
      const client = await pool.connect();
      try {
        await client.query('begin');

        const { coupleId, partnerId } = await requireCouple(client, userId);

        const found = await client.query<{
          couple_id: string;
          created_by_user_id: string;
          status: string;
          expired: boolean;
          game_slug: string;
          game_name: string;
        }>(
          `select i.couple_id, i.created_by_user_id, i.status,
                  (i.expires_at <= now()) as expired,
                  g.slug as game_slug, g.name as game_name
             from public.invitations i
             join public.games g on g.id = i.game_id
            where i.id = $1 for update of i`,
          [invitationId],
        );

        const row = found.rows[0];
        // A wrong couple reads as "not found" rather than "not yours": there is no reason to
        // confirm to a stranger that an id exists.
        if (!row || row.couple_id !== coupleId) {
          throw new InvitationError('invitation_not_found', 'That invitation is gone.');
        }
        if (row.created_by_user_id === userId) {
          throw new InvitationError('cannot_answer_own', 'You sent this one — they answer it.');
        }
        if (row.status !== 'pending') {
          throw new InvitationError('invitation_not_pending', 'That was already answered.');
        }
        if (row.expired) {
          // Close it properly on the way past, so the row stops claiming to be pending.
          await client.query(
            `update public.invitations set status = 'expired', responded_at = now() where id = $1`,
            [invitationId],
          );
          await client.query('commit');
          throw new InvitationError('invitation_expired', 'That invitation ran out.');
        }

        await client.query(
          `update public.invitations set status = $2, responded_at = now() where id = $1`,
          [invitationId, accept ? 'accepted' : 'rejected'],
        );

        // P-7: a decline may propose something else. It goes in the same transaction and reuses the
        // single active slot the invitation it answers has just vacated, so the one-invitation rule
        // holds without any extra bookkeeping.
        let counterInvitation: InvitationView | null = null;
        if (!accept && counterGameSlug) {
          const counterGame = await requirePlayableGame(client, counterGameSlug);
          const counter = await client.query<{ id: string }>(
            `insert into public.invitations
               (couple_id, game_id, created_by_user_id, replaces_invitation_id)
             values ($1, $2, $3, $4) returning id`,
            [coupleId, counterGame.id, userId, invitationId],
          );
          counterInvitation = await readView(client, counter.rows[0]!.id, userId);
        }

        await client.query('commit');

        return {
          invitationId,
          accepted: accept,
          coupleId,
          gameSlug: row.game_slug,
          gameName: row.game_name,
          otherUserId: partnerId,
          counterInvitation,
        };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async cancel(userId, invitationId) {
      const client = await pool.connect();
      try {
        await client.query('begin');

        const { partnerId } = await requireCouple(client, userId);

        const found = await client.query<{ status: string }>(
          `select status from public.invitations
            where id = $1 and created_by_user_id = $2 for update`,
          [invitationId, userId],
        );

        const row = found.rows[0];
        if (!row) throw new InvitationError('invitation_not_found', 'That invitation is gone.');
        if (row.status !== 'pending') {
          throw new InvitationError('invitation_not_pending', 'That was already answered.');
        }

        await client.query(
          `update public.invitations set status = 'cancelled', responded_at = now() where id = $1`,
          [invitationId],
        );
        await client.query('commit');

        return { otherUserId: partnerId };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async sweepExpired() {
      // Returns both members so the notifier can clear the invitation from every open screen,
      // including a second device belonging to either of them.
      const { rows } = await pool.query<{
        id: string;
        couple_id: string;
        user_a_id: string;
        user_b_id: string;
      }>(
        `with closed as (
           update public.invitations
              set status = 'expired', responded_at = now()
            where status = 'pending' and expires_at <= now()
            returning id, couple_id
         )
         select closed.id, closed.couple_id, c.user_a_id, c.user_b_id
           from closed join public.couples c on c.id = closed.couple_id`,
      );

      return rows.map((row) => ({
        id: row.id,
        coupleId: row.couple_id,
        userIds: [row.user_a_id, row.user_b_id],
      }));
    },
  };
}
