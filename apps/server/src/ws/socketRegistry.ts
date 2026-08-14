import type { WebSocket } from 'ws';

/**
 * Tracks which sockets belong to which user.
 *
 * A user may hold several sockets at once - a second tab, or a phone and a laptop - and per
 * `docs/13_ARCHITECTURE_PROPOSAL.md` section 6 that is deliberately allowed. Presence is therefore
 * "at least one socket", which makes a browser refresh a non-event instead of a disconnect.
 */
export class SocketRegistry {
  readonly #byUser = new Map<string, Set<WebSocket>>();

  add(userId: string, socket: WebSocket): void {
    const existing = this.#byUser.get(userId);
    if (existing) {
      existing.add(socket);
      return;
    }
    this.#byUser.set(userId, new Set([socket]));
  }

  remove(userId: string, socket: WebSocket): void {
    const sockets = this.#byUser.get(userId);
    if (!sockets) return;

    sockets.delete(socket);
    if (sockets.size === 0) this.#byUser.delete(userId);
  }

  socketsFor(userId: string): ReadonlySet<WebSocket> {
    return this.#byUser.get(userId) ?? new Set<WebSocket>();
  }

  isOnline(userId: string): boolean {
    return this.#byUser.has(userId);
  }

  /** Number of distinct users currently connected, not the number of sockets. */
  get onlineUserCount(): number {
    return this.#byUser.size;
  }
}
