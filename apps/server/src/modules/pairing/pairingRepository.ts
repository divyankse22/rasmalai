import type { Pool } from 'pg';
import { formatCalendarDate } from '../../db/calendarDate';
import type { Gender, LocationType } from '../users/user.schema';

/**
 * What either partner is allowed to see about the other.
 *
 * `actualName` used to sit here too, and was the one place it was ever rendered. 0006 stopped
 * collecting it — a person now gives one name — so the pairing screen shows that name instead.
 */
export interface PairingPerson {
  id: string;
  nickname: string;
  avatarKey: string;
  gender: Gender;
}

/** Couple facts, which exactly one of the two ever answers. */
export interface CoupleDetails {
  firstMetDate: string;
  locationType: LocationType;
}

/** What the wizard learns about a code before it commits someone to using it. */
export interface PairingCodeLookup {
  status: 'ok' | 'not_found' | 'self' | 'already_paired';
  /**
   * True when the code's owner joined by code themselves and was turned down, so nobody has ever
   * answered the couple's questions. Whoever uses this code has to answer them instead.
   */
  needsCoupleDetails: boolean;
  owner: PairingPerson | null;
}

export interface PairingRequestSummary {
  id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  createdAt: string;
  otherUser: PairingPerson;
}

export interface CoupleSummary {
  id: string;
  firstMetDate: string;
  locationType: LocationType;
  partner: PairingPerson;
}

export interface PairingState {
  couple: CoupleSummary | null;
  incoming: PairingRequestSummary[];
  outgoing: PairingRequestSummary[];
}

export class PairingError extends Error {
  constructor(
    readonly code:
      | 'code_not_found'
      | 'cannot_pair_with_self'
      | 'already_paired'
      | 'partner_already_paired'
      | 'request_already_pending'
      | 'request_incoming_pending'
      | 'request_not_found'
      | 'request_not_pending'
      | 'needs_couple_details',
    message: string,
  ) {
    super(message);
  }
}

export interface RespondResult {
  state: PairingState;
  /** The other party to the request - the one who needs telling, whichever way it went. */
  otherUserId: string;
  accepted: boolean;
}

/** Just enough of the partner to name them and draw their face. */
export interface PartnerProfile {
  id: string;
  nickname: string;
  avatarKey: string;
  gender: Gender;
}

export interface PairingRepository {
  getState(userId: string): Promise<PairingState>;
  /**
   * The one other person this user is allowed to know anything about, or null if unpaired.
   *
   * The narrow read behind every couple-scoped answer that needs the partner and nothing else —
   * presence, the header's face, and deciding whether an invitation has anybody to reach. Derived
   * from `couples` membership, never from anything the browser sends
   * (`docs/03_DATABASE_SCHEMA.md`, important data rules).
   */
  findPartner(userId: string): Promise<PartnerProfile | null>;
  /** Reports on a code without acting on it, so the wizard can confirm the person first. */
  lookupCode(viewerId: string, pairingCode: string): Promise<PairingCodeLookup>;
  /**
   * `details` are only consulted when neither party has ever answered the couple's questions,
   * which happens when both of them joined by code and were turned down.
   */
  requestByCode(
    requesterId: string,
    pairingCode: string,
    details?: CoupleDetails,
  ): Promise<PairingRequestSummary>;
  respond(userId: string, requestId: string, accept: boolean): Promise<RespondResult>;
  /** Withdraws a request the caller sent. Only the requester may do this. */
  cancel(userId: string, requestId: string): Promise<CancelResult>;
}

export interface CancelResult {
  state: PairingState;
  /** The person who was waiting on it, so their screen can be cleared immediately. */
  otherUserId: string;
}

/**
 * Every column is aliased deliberately.
 *
 * `pairing_requests` and `users` both have an `id`, and node-postgres builds each row as a plain
 * object, so a later `id` silently overwrites an earlier one. Selecting `r.id` alongside `u.id`
 * handed back the *user's* id as the request id, and the only symptom was a 404 on accept. Aliasing
 * is not stylistic here; unaliased columns are a correctness bug waiting to happen.
 */
const REQUEST_COLUMNS = `r.id as request_id, r.status, r.created_at,
  u.id as other_id, u.nickname, u.avatar_key, u.gender`;

interface RequestRow {
  request_id: string;
  status: PairingRequestSummary['status'];
  created_at: Date;
  other_id: string;
  nickname: string;
  avatar_key: string;
  gender: Gender;
}

function toRequest(row: RequestRow): PairingRequestSummary {
  return {
    id: row.request_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    otherUser: {
      id: row.other_id,
      nickname: row.nickname,
      avatarKey: row.avatar_key,
      gender: row.gender,
    },
  };
}

export function createPairingRepository(pool: Pool): PairingRepository {
  async function readState(executor: Pick<Pool, 'query'>, userId: string): Promise<PairingState> {
    const couple = await executor.query<{
      id: string;
      first_met_date: Date;
      location_type: LocationType;
      partner_id: string;
      nickname: string;
      avatar_key: string;
      gender: Gender;
    }>(
      `select c.id, c.first_met_date, c.location_type,
              u.id as partner_id, u.nickname, u.avatar_key, u.gender
         from public.couples c
         join public.users u
           on u.id = case when c.user_a_id = $1 then c.user_b_id else c.user_a_id end
        where c.user_a_id = $1 or c.user_b_id = $1`,
      [userId],
    );

    const incoming = await executor.query<RequestRow>(
      `select ${REQUEST_COLUMNS}
         from public.pairing_requests r
         join public.users u on u.id = r.requester_user_id
        where r.target_user_id = $1 and r.status = 'pending'
        order by r.created_at desc`,
      [userId],
    );

    const outgoing = await executor.query<RequestRow>(
      `select ${REQUEST_COLUMNS}
         from public.pairing_requests r
         join public.users u on u.id = r.target_user_id
        where r.requester_user_id = $1 and r.status = 'pending'
        order by r.created_at desc`,
      [userId],
    );

    const coupleRow = couple.rows[0];

    return {
      couple: coupleRow
        ? {
            id: coupleRow.id,
            firstMetDate: formatCalendarDate(coupleRow.first_met_date),
            locationType: coupleRow.location_type,
            partner: {
              id: coupleRow.partner_id,
              nickname: coupleRow.nickname,
              avatarKey: coupleRow.avatar_key,
              gender: coupleRow.gender,
            },
          }
        : null,
      incoming: incoming.rows.map(toRequest),
      outgoing: outgoing.rows.map(toRequest),
    };
  }

  return {
    getState(userId) {
      return readState(pool, userId);
    },

    async findPartner(userId) {
      const { rows } = await pool.query<{
        id: string;
        nickname: string;
        avatar_key: string;
        gender: Gender;
      }>(
        `select u.id, u.nickname, u.avatar_key, u.gender
           from public.couples c
           join public.users u
             on u.id = case when c.user_a_id = $1 then c.user_b_id else c.user_a_id end
          where c.user_a_id = $1 or c.user_b_id = $1`,
        [userId],
      );

      const row = rows[0];
      if (!row) return null;
      return { id: row.id, nickname: row.nickname, avatarKey: row.avatar_key, gender: row.gender };
    },

    async lookupCode(viewerId, pairingCode) {
      const { rows } = await pool.query<{
        id: string;
        couple_id: string | null;
        first_met_date: Date | null;
        nickname: string;
        avatar_key: string;
        gender: Gender;
      }>(
        `select id, couple_id, first_met_date, nickname, avatar_key, gender
           from public.users where pairing_code = $1`,
        [pairingCode],
      );

      const row = rows[0];
      const nothing = { needsCoupleDetails: false, owner: null } as const;

      if (!row) return { status: 'not_found', ...nothing };
      if (row.id === viewerId) return { status: 'self', ...nothing };
      if (row.couple_id !== null) return { status: 'already_paired', ...nothing };

      return {
        status: 'ok',
        needsCoupleDetails: row.first_met_date === null,
        owner: {
          id: row.id,
          nickname: row.nickname,
          avatarKey: row.avatar_key,
          gender: row.gender,
        },
      };
    },

    async requestByCode(requesterId, pairingCode, details) {
      const client = await pool.connect();
      try {
        await client.query('begin');

        const target = await client.query<{
          id: string;
          couple_id: string | null;
          first_met_date: Date | null;
        }>(
          `select id, couple_id, first_met_date from public.users
            where pairing_code = $1 for update`,
          [pairingCode],
        );
        const targetRow = target.rows[0];
        if (!targetRow) {
          throw new PairingError('code_not_found', 'We could not find that code.');
        }
        if (targetRow.id === requesterId) {
          throw new PairingError('cannot_pair_with_self', 'That is your own code.');
        }
        if (targetRow.couple_id !== null) {
          throw new PairingError('partner_already_paired', 'They are already paired with someone.');
        }

        const requester = await client.query<{
          couple_id: string | null;
          first_met_date: Date | null;
        }>('select couple_id, first_met_date from public.users where id = $1 for update', [
          requesterId,
        ]);
        const requesterRow = requester.rows[0];
        // couple_id is a uuid when set, so truthiness covers both null and a missing row.
        if (requesterRow?.couple_id) {
          throw new PairingError('already_paired', 'You are already paired.');
        }

        // Both of them joined by code and were turned down, so neither has ever answered the
        // couple's questions and accepting would have nothing to put in `couples.first_met_date`.
        // Asking now, from the person taking the initiative, is the only moment either of them is
        // here to answer.
        const requesterAnswered =
          requesterRow !== undefined && requesterRow.first_met_date !== null;
        if (targetRow.first_met_date === null && !requesterAnswered) {
          if (!details) {
            throw new PairingError(
              'needs_couple_details',
              'One of you needs to tell us the day you met.',
            );
          }
          await client.query(
            'update public.users set first_met_date = $2, location_type = $3 where id = $1',
            [requesterId, details.firstMetDate, details.locationType],
          );
        }

        // If they already asked us, entering their code is a dead end - the only thing that can
        // happen next is accepting. Saying so is far more useful than "a request already exists".
        const incoming = await client.query<{ id: string }>(
          `select id from public.pairing_requests
            where requester_user_id = $1 and target_user_id = $2 and status = 'pending'`,
          [targetRow.id, requesterId],
        );
        if (incoming.rows.length > 0) {
          throw new PairingError(
            'request_incoming_pending',
            'They already sent you a request — accept it above instead ❤️',
          );
        }

        const inserted = await client.query<{ id: string; created_at: Date }>(
          `insert into public.pairing_requests (requester_user_id, target_user_id)
           values ($1, $2)
           returning id, created_at`,
          [requesterId, targetRow.id],
        );

        const other = await client.query<{
          id: string;
          nickname: string;
          avatar_key: string;
          gender: Gender;
        }>('select id, nickname, avatar_key, gender from public.users where id = $1', [
          targetRow.id,
        ]);

        await client.query('commit');

        const row = inserted.rows[0]!;
        const otherRow = other.rows[0]!;
        return {
          id: row.id,
          status: 'pending',
          createdAt: row.created_at.toISOString(),
          otherUser: {
            id: otherRow.id,
            nickname: otherRow.nickname,
            avatarKey: otherRow.avatar_key,
            gender: otherRow.gender,
          },
        };
      } catch (error) {
        await client.query('rollback');
        // 23505 on the partial index means a pending request between these two already exists.
        if ((error as { code?: string }).code === '23505') {
          throw new PairingError(
            'request_already_pending',
            'You have already asked them — they just need to accept.',
          );
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async cancel(userId, requestId) {
      const client = await pool.connect();
      try {
        await client.query('begin');

        // Only the sender may withdraw, and only while it is still unanswered. Cancelling frees
        // the partial unique index, so either of them can start again straight away.
        const request = await client.query<{ target_user_id: string; status: string }>(
          `select target_user_id, status from public.pairing_requests
            where id = $1 and requester_user_id = $2 for update`,
          [requestId, userId],
        );
        const row = request.rows[0];
        if (!row) {
          throw new PairingError('request_not_found', 'That request no longer exists.');
        }
        if (row.status !== 'pending') {
          throw new PairingError('request_not_pending', 'That request was already answered.');
        }

        await client.query(
          `update public.pairing_requests set status = 'cancelled', responded_at = now()
            where id = $1`,
          [requestId],
        );
        await client.query('commit');

        return { state: await readState(pool, userId), otherUserId: row.target_user_id };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async respond(userId, requestId, accept) {
      const client = await pool.connect();
      try {
        await client.query('begin');

        // Only the target may answer, and only while it is still pending.
        const request = await client.query<{
          requester_user_id: string;
          target_user_id: string;
          status: string;
        }>(
          `select requester_user_id, target_user_id, status
             from public.pairing_requests
            where id = $1 for update`,
          [requestId],
        );
        const row = request.rows[0];
        if (!row || row.target_user_id !== userId) {
          throw new PairingError('request_not_found', 'That request no longer exists.');
        }
        if (row.status !== 'pending') {
          throw new PairingError('request_not_pending', 'That request was already answered.');
        }

        if (!accept) {
          await client.query(
            `update public.pairing_requests set status = 'rejected', responded_at = now()
              where id = $1`,
            [requestId],
          );
          await client.query('commit');
          return {
            state: await readState(pool, userId),
            otherUserId: row.requester_user_id,
            accepted: false,
          };
        }

        // Lock both people before creating the couple, so two simultaneous acceptances cannot
        // both succeed and leave someone in two couples.
        const members = await client.query<{ id: string; couple_id: string | null }>(
          'select id, couple_id from public.users where id in ($1, $2) for update',
          [row.requester_user_id, row.target_user_id],
        );
        if (members.rows.some((member) => member.couple_id !== null)) {
          throw new PairingError('already_paired', 'One of you is already paired.');
        }

        // P-2: the couple's facts have exactly one author, and it is the person whose code was
        // used. They are the one who got here first and was asked; whoever arrived holding their
        // code was never asked at all, and their columns are null.
        //
        // coalesce, rather than reading the target alone, keeps the older path working: two people
        // who both onboarded before either had a code have both answered, and the code's owner
        // still wins. It only falls through when the owner genuinely never said.
        const seed = await client.query<{
          first_met_date: Date | null;
          location_type: LocationType | null;
        }>(
          `select coalesce(owner.first_met_date, joiner.first_met_date) as first_met_date,
                  coalesce(owner.location_type, joiner.location_type)   as location_type
             from public.users owner, public.users joiner
            where owner.id = $1 and joiner.id = $2`,
          [row.target_user_id, row.requester_user_id],
        );
        const seedRow = seed.rows[0]!;
        // `couples.first_met_date` is NOT NULL and stays that way. requestByCode refuses to create
        // a request when neither party has answered, so arriving here without a date means that
        // guard has a hole — worth failing on rather than inventing a day they met.
        if (seedRow.first_met_date === null || seedRow.location_type === null) {
          throw new PairingError(
            'needs_couple_details',
            'One of you needs to tell us the day you met.',
          );
        }

        const couple = await client.query<{ id: string }>(
          `insert into public.couples (user_a_id, user_b_id, first_met_date, location_type)
           values ($1, $2, $3, $4) returning id`,
          [
            row.requester_user_id,
            row.target_user_id,
            seedRow.first_met_date,
            seedRow.location_type,
          ],
        );
        const coupleId = couple.rows[0]!.id;

        await client.query('update public.users set couple_id = $1 where id in ($2, $3)', [
          coupleId,
          row.requester_user_id,
          row.target_user_id,
        ]);

        // The couple's aggregate row, created here so the dashboard never has to cope with its
        // absence (docs/13_ARCHITECTURE_PROPOSAL.md section 4). Inside the same transaction: a
        // couple that exists without somewhere to keep its statistics is not a state worth having.
        await client.query(
          'insert into public.lifetime_statistics (couple_id) values ($1) on conflict do nothing',
          [coupleId],
        );

        await client.query(
          `update public.pairing_requests set status = 'accepted', responded_at = now()
            where id = $1`,
          [requestId],
        );

        // Pairing is permanent, so every other pending request involving either person is moot.
        await client.query(
          `update public.pairing_requests set status = 'cancelled', responded_at = now()
            where status = 'pending'
              and (requester_user_id in ($1, $2) or target_user_id in ($1, $2))`,
          [row.requester_user_id, row.target_user_id],
        );

        await client.query('commit');
        return {
          state: await readState(pool, userId),
          otherUserId: row.requester_user_id,
          accepted: true,
        };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
