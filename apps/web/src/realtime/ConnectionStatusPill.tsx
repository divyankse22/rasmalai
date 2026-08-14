'use client';

import { useRealtimeConnection } from './useRealtimeConnection';

const LABELS = {
  connecting: { text: 'connecting…', dot: 'bg-butter', tone: 'text-muted' },
  connected: { text: 'connected', dot: 'bg-mint', tone: 'text-muted' },
  offline: { text: 'offline', dot: 'bg-blush', tone: 'text-muted' },
} as const;

export function ConnectionStatusPill() {
  const status = useRealtimeConnection();
  const { text, dot, tone } = LABELS[status];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-pill bg-cream px-3 py-1 text-sm ${tone}`}
      role="status"
      aria-live="polite"
    >
      <span className={`size-2 rounded-pill ${dot}`} aria-hidden="true" />
      {text}
    </span>
  );
}
