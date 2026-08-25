'use client';

import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { formatGameScore } from '@rasmalai/games';
import { GAME_CATEGORIES, type CatalogueGame, type GameCategory } from '@rasmalai/shared';
import { Card } from '@/design-system/Card';
import { CATEGORY_LABEL, gameGlyph } from './gameGlyphs';
import { InviteButton } from './InviteButton';

/**
 * The catalogue, straight from the database.
 *
 * `enabled` means the game module exists — it is not progression. Everything is unlocked in V1
 * (CLAUDE.md), so an unbuilt game is shown, described and marked as coming rather than hidden:
 * the two of them can see what the product is going to be, and cannot start something that would
 * fail. The 🔒 next to "soon" is a visual accent only — `aria-hidden`, because "soon" already says
 * the same thing to a screen reader.
 */
function GameRow({ game, active }: { game: CatalogueGame; active: boolean }) {
  const played = game.plays > 0;
  // The number is the platform's; the units are the game's. A game that says its score reads as
  // nothing gets no line here rather than a bare integer nobody can interpret.
  const best = game.yourBestScore === null ? null : formatGameScore(game.slug, game.yourBestScore);

  return (
    <li
      className={`w-full shrink-0 flex flex-col gap-4 rounded-soft px-4 py-4 ${
        game.enabled ? 'bg-cream' : 'bg-cream/60'
      }`}
      aria-hidden={active ? undefined : true}
      {...(active ? {} : { inert: true })}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex size-12 shrink-0 items-center justify-center rounded-pill bg-shell text-2xl ${
            game.enabled ? '' : 'grayscale'
          }`}
          aria-hidden="true"
        >
          {gameGlyph(game.slug)}
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-display text-lg font-semibold text-ink">{game.name}</span>
            {!game.enabled && (
              <>
                <span className="rounded-pill bg-butter px-2 py-0.5 text-xs text-muted">soon</span>
                <span className="text-xs" aria-hidden="true">
                  🔒
                </span>
              </>
            )}
          </div>
          <p className="text-sm text-muted">{game.description}</p>

          {played && (
            <p className="text-xs text-muted">
              {game.plays} {game.plays === 1 ? 'play' : 'plays'} · {game.yourWins}–
              {game.partnerWins}
              {game.draws > 0 && ` · ${game.draws} drawn`}
              {/* Best score is per game on purpose: a basketball 34 and a five-round win are not
                  the same kind of number, and one global "best score" would compare them. The game
                  module spells it, because the platform is holding an integer with no units. */}
              {best !== null && ` · best ${best}`}
            </p>
          )}
        </div>
      </div>

      {/* Only a game with a module behind it can be started. The rest are listed, not offered.
          Full width and at the bottom of the card — the one thing to do with the game you're
          looking at, not a small control squeezed beside its description. */}
      {game.enabled && <InviteButton gameSlug={game.slug} gameName={game.name} />}
    </li>
  );
}

/** Built games first, locked ones trailing — a stable sort, so ties keep the database's order. */
function bySwipeOrder(games: CatalogueGame[]): CatalogueGame[] {
  return [...games].sort((a, b) => Number(!a.enabled) - Number(!b.enabled));
}

const ARROW =
  'flex size-9 items-center justify-center rounded-pill bg-blush text-ink transition-transform ' +
  'duration-quick ease-bounce active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 ' +
  'disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry';

/**
 * One category's games, one at a time.
 *
 * Same "cards in a row that slide" technique as `OnboardingWizard`: one `translateX` on a flex
 * track rather than mounting and unmounting cards. That component only advances on a button tap;
 * this one adds an actual drag, since a game catalogue is browsed, not filled in step by step.
 *
 * A drag under an 8px dead zone is left alone entirely — no `preventDefault`, nothing — so a plain
 * tap still reaches `InviteButton` beneath it untouched. Only once a drag is real do we know a
 * swipe happened, and the click that follows the pointer lifting is suppressed once: without that,
 * releasing a swipe over a different game's invite button would send an invitation nobody meant to
 * send. Pointer listeners live on `window` rather than the track itself so the drag keeps tracking
 * even if a fast swipe outruns the element under the finger.
 */
function CategorySwipe({ category, games }: { category: GameCategory; games: CatalogueGame[] }) {
  const label = CATEGORY_LABEL[category];
  const ordered = bySwipeOrder(games);
  const last = ordered.length - 1;

  const [index, setIndex] = useState(0);
  const position = Math.min(index, last);

  const [dragPx, setDragPx] = useState(0);
  const trackRef = useRef<HTMLUListElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; dragged: boolean } | null>(null);
  const suppressClick = useRef(false);

  const clamp = (i: number) => Math.min(Math.max(i, 0), last);

  function cleanupDrag() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    drag.current = null;
    setDragPx(0);
  }

  /** Ignores every pointer but the one that started the drag, so a second finger cannot hijack it. */
  function owned(event: PointerEvent): boolean {
    return drag.current !== null && drag.current.pointerId === event.pointerId;
  }

  function onPointerMove(event: PointerEvent) {
    if (!owned(event)) return;
    const deltaX = event.clientX - drag.current!.startX;
    if (Math.abs(deltaX) > 8) drag.current!.dragged = true;
    setDragPx(deltaX);
  }

  function onPointerUp(event: PointerEvent) {
    if (!owned(event)) return;
    const { startX, dragged } = drag.current!;
    const deltaX = event.clientX - startX;
    cleanupDrag();
    if (!dragged) return;

    suppressClick.current = true;
    const width = trackRef.current?.clientWidth || 0;
    const threshold = Math.max(width * 0.2, 40);
    if (deltaX <= -threshold) setIndex(clamp(position + 1));
    else if (deltaX >= threshold) setIndex(clamp(position - 1));
  }

  function onPointerCancel(event: PointerEvent) {
    if (!owned(event)) return;
    cleanupDrag();
  }

  function onPointerDown(event: ReactPointerEvent<HTMLUListElement>) {
    if (ordered.length < 2 || event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, dragged: false };
    /*
     * Own the pointer for the rest of the gesture. A mouse gets no implicit pointer capture, so a
     * button released past the window edge or over the toolbar delivers neither `pointerup` nor
     * `pointercancel` here, and the drag would never learn it ended — leaving the row frozen
     * part-way between two games at whatever offset the pointer reached, until a reload.
     */
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  /** Capture gone with no `pointerup` to go with it — the gesture is over whether we like it or not. */
  function onLostPointerCapture(event: ReactPointerEvent<HTMLUListElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    cleanupDrag();
  }

  /** Eats the one click a real drag leaves behind, wherever it happens to land. */
  function onClickCapture(event: ReactMouseEvent) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-base font-semibold text-ink">{label?.title}</h2>
        <p className="text-xs text-muted">{label?.blurb}</p>
      </div>

      {/* Clipped at the padding edge, so a card's shadow survives the crop. */}
      <div className="-mx-4 overflow-hidden px-4 py-1">
        <ul
          ref={trackRef}
          className="flex touch-pan-y transition-transform duration-soft ease-bounce"
          style={{ transform: `translateX(calc(${-position * 100}% + ${dragPx}px))` }}
          onPointerDown={onPointerDown}
          onLostPointerCapture={onLostPointerCapture}
          onClickCapture={onClickCapture}
        >
          {ordered.map((entry, i) => (
            <GameRow key={entry.slug} game={entry} active={i === position} />
          ))}
        </ul>
      </div>

      {ordered.length > 1 && (
        <>
          <div className="flex items-center justify-center gap-2" aria-hidden>
            {ordered.map((entry, i) => (
              <span
                key={entry.slug}
                className={`size-2 rounded-pill transition-colors duration-quick ${
                  i === position ? 'bg-berry' : 'bg-blush'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label={`Previous game in ${label?.title}`}
              disabled={position === 0}
              onClick={() => setIndex(clamp(position - 1))}
              className={ARROW}
            >
              <span aria-hidden="true">←</span>
            </button>
            <button
              type="button"
              aria-label={`Next game in ${label?.title}`}
              disabled={position === last}
              onClick={() => setIndex(clamp(position + 1))}
              className={ARROW}
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

export function GameCatalogue({ games }: { games: CatalogueGame[] }) {
  return (
    <div className="flex flex-col gap-5">
      {GAME_CATEGORIES.map((category) => {
        const inCategory = games.filter((game) => game.category === category);
        if (inCategory.length === 0) return null;

        return <CategorySwipe key={category} category={category} games={inCategory} />;
      })}
    </div>
  );
}
