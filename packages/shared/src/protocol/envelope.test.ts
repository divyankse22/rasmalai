import { describe, expect, it } from 'vitest';
import {
  MAX_ENVELOPE_BYTES,
  createEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from './envelope';

describe('createEnvelope', () => {
  it('omits requestId entirely when none is given', () => {
    const envelope = createEnvelope('lobby.joined', { sessionId: 'abc' });

    expect(envelope.type).toBe('lobby.joined');
    expect(envelope.payload).toEqual({ sessionId: 'abc' });
    expect('requestId' in envelope).toBe(false);
  });

  it('keeps the requestId so a client can correlate its own request', () => {
    const envelope = createEnvelope('game.action.request', { tap: true }, 'req-1');

    expect(envelope.requestId).toBe('req-1');
  });
});

describe('parseEnvelope', () => {
  it('round-trips a serialized envelope', () => {
    const result = parseEnvelope(serializeEnvelope(createEnvelope('reaction.sent', { emoji: '❤️' })));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.type).toBe('reaction.sent');
    expect(result.envelope.payload).toEqual({ emoji: '❤️' });
  });

  it('defaults a missing payload to an empty object', () => {
    const result = parseEnvelope(JSON.stringify({ type: 'connection.ping', ts: 0 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.payload).toEqual({});
  });

  it.each([
    ['not json at all', 'Message is not valid JSON.'],
    ['{"ts":1,"payload":{}}', 'Message shape is invalid.'],
    ['{"type":"","ts":1,"payload":{}}', 'Message shape is invalid.'],
    ['{"type":"x","ts":-1,"payload":{}}', 'Message shape is invalid.'],
    ['{"type":"x","ts":"soon","payload":{}}', 'Message shape is invalid.'],
  ])('rejects %s', (raw, message) => {
    const result = parseEnvelope(raw);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_payload');
    expect(result.error.message).toBe(message);
  });

  it('rejects an oversized frame before parsing it', () => {
    const oversized = JSON.stringify({
      type: 'game.action.request',
      ts: 1,
      payload: { blob: 'x'.repeat(MAX_ENVELOPE_BYTES) },
    });

    const result = parseEnvelope(oversized);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('Message too large.');
  });

  it('does not leak internals in its error messages', () => {
    const result = parseEnvelope('{"type":123}');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).not.toMatch(/zod|expected|received/i);
  });
});
