import type { ReactNode } from 'react';
import { nameTone, type Gender } from './PersonName';

/**
 * One number with a label under it.
 *
 * Statistics are the bulk of the dashboard, so they get a primitive rather than repeated markup —
 * which is also what keeps every figure the same size and weight regardless of which panel it
 * lands in.
 */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 text-center">
      <span className="font-display text-2xl font-bold text-ink tabular-nums">{value}</span>
      <span className="text-xs text-muted">{label}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

/**
 * The same stat for both of them, side by side.
 *
 * Each number takes its owner's colour, from their real gender rather than from which side of the
 * row it sits on — the viewer is not always the same one of the two.
 */
export function VersusStat({
  label,
  you,
  them,
  yourGender,
  theirGender,
}: {
  label: string;
  you: ReactNode;
  them: ReactNode;
  yourGender: Gender | undefined;
  theirGender: Gender | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`font-display text-lg font-bold tabular-nums ${nameTone(yourGender)}`}>
        {you}
      </span>
      <span className="text-xs text-muted">{label}</span>
      <span className={`font-display text-lg font-bold tabular-nums ${nameTone(theirGender)}`}>
        {them}
      </span>
    </div>
  );
}
