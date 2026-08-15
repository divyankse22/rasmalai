import { Button } from '@/design-system/Button';
import { Card } from '@/design-system/Card';

/**
 * The tournament entry point.
 *
 * Present and disabled rather than absent: the engine lands in slice 9, and having its place on the
 * dashboard settled now means that slice fills a card in instead of rearranging the page. Disabled
 * and labelled, so it never looks like something that ought to work.
 */
export function TournamentCard() {
  return (
    <Card className="flex flex-col items-center gap-2 text-center">
      <span className="text-2xl" aria-hidden="true">
        🏆
      </span>
      <h2 className="font-display text-base font-semibold text-ink">Tournaments</h2>
      <p className="text-sm text-muted">
        Pick a run of games, lock them in, and play for points. Win 3, draw 1, lose 0.
      </p>
      <Button variant="soft" disabled>
        Coming soon
      </Button>
    </Card>
  );
}
