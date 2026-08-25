import { z } from 'zod';
import type { ProtocolError } from './errors';

/**
 * The single message shape used in both directions over the WebSocket, per
 * `docs/04_REALTIME_AND_WEBSOCKET_PROTOCOL.md`.
 *
 * `ts` is always the *sender's* clock and is used for ordering and diagnostics only. Anything that
 * affects fairness - round timing, scoring, match completion - uses the server's own clock, never
 * this field. See `docs/13_ARCHITECTURE_PROPOSAL.md` section 8.
 */
export interface Envelope<TPayload = unknown> {
  type: string;
  requestId?: string;
  ts: number;
  payload: TPayload;
}

/** Anything larger is rejected before parsing, so a client cannot make us allocate at will. */
export const MAX_ENVELOPE_BYTES = 16 * 1024;

const envelopeSchema = z.object({
  type: z.string().min(1).max(64),
  requestId: z.string().min(1).max(64).optional(),
  ts: z.number().int().nonnegative(),
  // Optional so a payload-less signal such as `connection.ping` is a valid frame.
  payload: z.unknown().optional(),
});

export type ParseResult =
  | { ok: true; envelope: Envelope }
  | { ok: false; error: ProtocolError };

export function createEnvelope<TPayload>(
  type: string,
  payload: TPayload,
  requestId?: string,
): Envelope<TPayload> {
  const base = { type, ts: Date.now(), payload };
  return requestId === undefined ? base : { ...base, requestId };
}

/**
 * Parses an inbound frame. Never throws: a malformed frame from a client is an expected event, not
 * an exception, and the caller answers with an `invalid_payload` error.
 */
export function parseEnvelope(raw: string): ParseResult {
  if (raw.length > MAX_ENVELOPE_BYTES) {
    return { ok: false, error: { code: 'invalid_payload', message: 'Message too large.' } };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: { code: 'invalid_payload', message: 'Message is not valid JSON.' } };
  }

  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: { code: 'invalid_payload', message: 'Message shape is invalid.' } };
  }

  const { type, ts, requestId } = parsed.data;
  const payload = parsed.data.payload ?? {};

  return {
    ok: true,
    envelope: requestId === undefined ? { type, ts, payload } : { type, ts, payload, requestId },
  };
}

export function serializeEnvelope(envelope: Envelope): string {
  return JSON.stringify(envelope);
}
