import { createEnvelope, serializeEnvelope } from '@rasmalai/shared';
import type { SocketRegistry } from './socketRegistry';

/**
 * Lets HTTP routes push an event to a person's open sockets.
 *
 * This is how an action taken over HTTP - accepting a pairing request, say - reaches the other
 * partner instantly, which is what `docs/02_ARCHITECTURE.md` demands instead of polling.
 */
export interface RealtimeNotifier {
  sendToUser(userId: string, type: string, payload: unknown): void;
}

export function createNotifier(registry: SocketRegistry): RealtimeNotifier {
  return {
    sendToUser(userId, type, payload) {
      const frame = serializeEnvelope(createEnvelope(type, payload));
      for (const socket of registry.socketsFor(userId)) {
        if (socket.readyState === socket.OPEN) socket.send(frame);
      }
    },
  };
}

/** Used when nothing is listening, and by tests that do not care about delivery. */
export const noopNotifier: RealtimeNotifier = { sendToUser() {} };
