import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { parseEnvelope } from '@rasmalai/shared';
import { createNotifier } from './notifier';
import { SocketRegistry } from './socketRegistry';

/** Minimal stand-in for a socket: records what it was sent and what state it claims to be in. */
function fakeSocket(readyState = 1) {
  const sent: string[] = [];
  return {
    sent,
    socket: {
      readyState,
      OPEN: 1,
      send: (frame: string) => sent.push(frame),
    } as unknown as WebSocket,
  };
}

describe('createNotifier', () => {
  it('reaches every device a person has open', () => {
    const registry = new SocketRegistry();
    const phone = fakeSocket();
    const laptop = fakeSocket();
    registry.add('user-a', phone.socket);
    registry.add('user-a', laptop.socket);

    createNotifier(registry).sendToUser('user-a', 'pairing.request.rejected', { requestId: 'r1' });

    for (const device of [phone, laptop]) {
      expect(device.sent).toHaveLength(1);
      const parsed = parseEnvelope(device.sent[0]!);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.envelope.type).toBe('pairing.request.rejected');
      expect(parsed.envelope.payload).toEqual({ requestId: 'r1' });
    }
  });

  it('skips a socket that is not open', () => {
    const registry = new SocketRegistry();
    const closing = fakeSocket(2);
    registry.add('user-a', closing.socket);

    createNotifier(registry).sendToUser('user-a', 'pairing.request.rejected', {});

    expect(closing.sent).toHaveLength(0);
  });

  it('is silent for someone with nothing open', () => {
    const registry = new SocketRegistry();

    expect(() =>
      createNotifier(registry).sendToUser('nobody', 'pairing.request.rejected', {}),
    ).not.toThrow();
  });

  it('sends to several people at once', () => {
    const registry = new SocketRegistry();
    const a = fakeSocket();
    const b = fakeSocket();
    registry.add('user-a', a.socket);
    registry.add('user-b', b.socket);

    createNotifier(registry).sendToUsers(['user-a', 'user-b'], 'pairing.request.cancelled', {});

    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
  });

  it('does not send twice when the same person is listed twice', () => {
    const registry = new SocketRegistry();
    const a = fakeSocket();
    registry.add('user-a', a.socket);

    createNotifier(registry).sendToUsers(['user-a', 'user-a'], 'pairing.request.cancelled', {});

    expect(a.sent).toHaveLength(1);
  });
});
