'use client';

import { useEffect, useState } from 'react';

/**
 * Whole seconds remaining until a server-set deadline, or null when there is no deadline.
 *
 * Counts down by subtracting the local clock from the server's moment rather than keeping a clock of
 * its own, so two devices watching the same deadline agree and nothing is decided by either browser
 * (`docs/04` section 5).
 *
 * The clock is held in state and only ever read from a callback, because reading `Date.now()` during
 * render is impure and React's rules forbid it. The zero-delay timer re-syncs the moment a new
 * deadline arrives — without it, a countdown starting after a long wait would briefly render against
 * a clock from whenever the screen was opened.
 *
 * Lives here rather than in one screen because two of them now need it: the play screen counts down
 * a shared 3-2-1, and the session watcher counts down somebody's last two minutes.
 */
export function useCountdown(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;

    const sync = () => setNow(Date.now());
    const immediate = setTimeout(sync, 0);
    const timer = setInterval(sync, 200);

    return () => {
      clearTimeout(immediate);
      clearInterval(timer);
    };
  }, [deadline]);

  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * Seconds as `m:ss`.
 *
 * Two minutes reads as "1:47", not "107s". A bare second count is fine for the three-second things
 * on this screen and unreadable for the two-minute ones, and both now appear on it at once.
 */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
