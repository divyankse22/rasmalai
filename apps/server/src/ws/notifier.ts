import { createEnvelope, serializeEnvelope } from '@rasmalai/shared';
import { logger } from '../logger';
import type { SocketRegistry } from './socketRegistry';

/**
 * Lets HTTP routes push an event to a person's open sockets.
 *
 * This is how an action taken over HTTP - accepting a pairing request, say - reaches the other
 * partner instantly, which is what `docs/02_ARCHITECTURE.md` demands instead of polling.
 */
export interface RealtimeNotifier {
  sendToUser(userId: string, type: string, payload: unknown): void;
  /**
   * Sends to several people at once, de-duplicated.
   *
   * Almost every pairing event concerns both parties, and each person may be signed in on more
   * than one device. Telling only the other person leaves the actor's own second screen showing a
   * request that has already been answered.
   */
  sendToUsers(userIds: readonly string[], type: string, payload: unknown): void;
}

export function createNotifier(registry: SocketRegistry): RealtimeNotifier {
  const notifier: RealtimeNotifier = {
    sendToUser(userId, type, payload) {
      const frame = serializeEnvelope(createEnvelope(type, payload));
      for (const socket of registry.socketsFor(userId)) {
        if (socket.readyState !== socket.OPEN) continue;
        try {
          socket.send(frame);
        } catch (error) {
          // One dying socket must not stop the frame reaching the other player, and must never
          // unwind into whatever asked for the broadcast — mid-game, that caller is holding the
          // match clock. A dropped frame costs nothing: every event carries the whole state, so the
          // next one puts them right, and a reconnect asks for it outright.
          logger.warn({ err: error, userId, type }, 'could not deliver a frame to a socket');
        }
      }
    },

    sendToUsers(userIds, type, payload) {
      for (const userId of new Set(userIds)) notifier.sendToUser(userId, type, payload);
    },
  };

  return notifier;
}

/** Used when nothing is listening, and by tests that do not care about delivery. */
export const noopNotifier: RealtimeNotifier = { sendToUser() {}, sendToUsers() {} };
