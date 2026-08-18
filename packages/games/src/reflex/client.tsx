'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { GameRenderProps } from '../contract';
import type { ReflexView } from './protocol';

/**
 * Reflex, on screen — the first thing in Rasmalai drawn on a canvas.
 *
 * **Phaser is imported inside an effect and nowhere else.** A top-level `import 'phaser'` reaches
 * for `window` the moment the module is evaluated, and this module is reachable from a server
 * render, so that import would break the page rather than the game. Loading it here also means the
 * ~1MB of it arrives with this game's session and never sits in the bundle of somebody reading
 * their dashboard, which is exactly what the lazy loader in `client.ts` exists for.
 *
 * **The scene decides nothing.** It reads the view through a ref and draws it; every death is the
 * server's, judged from the schedule both players were sent. What the canvas is for is the one
 * thing a React tree is bad at — forty hazards moving continuously for thirty seconds.
 *
 * **The palette is read out of the theme at runtime**, so `design-system/theme.css` really is the
 * whole visual identity (`docs/01` section 13). A canvas with hex codes baked into it would be the
 * one screen in the product that a reskin missed.
 *
 * Input, per `docs/06`: arrow keys, tap either side of the screen, or swipe. A game about moving
 * quickly should not insist on one way of doing it.
 */

/** How far ahead a hazard is drawn — its whole fall takes this long. */
const LEAD_MS = 2_400;

/** A swipe has to cover this much of the screen to count, so a tap is never mistaken for one. */
const SWIPE_FRACTION = 0.06;

/** One CSS custom property from the theme, as a Phaser colour. */
function themeColour(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const match = /^#([0-9a-f]{6})$/i.exec(raw);
  return match ? Number.parseInt(match[1]!, 16) : fallback;
}

interface Palette {
  ground: number;
  lane: number;
  hazard: number;
  you: number;
  them: number;
  ink: number;
}

function readPalette(): Palette {
  return {
    ground: themeColour('--color-lilac', 0xe5dbff),
    lane: themeColour('--color-cream', 0xfff8f2),
    hazard: themeColour('--color-ink', 0x3d2b3a),
    you: themeColour('--color-berry', 0xf2678f),
    them: themeColour('--color-sky', 0xcfe6ff),
    ink: themeColour('--color-ink', 0x3d2b3a),
  };
}

export default function ReflexGame({ view, you, partner, act }: GameRenderProps<ReflexView>) {
  const host = useRef<HTMLDivElement | null>(null);
  // The scene reads both of these every frame rather than being re-created when they change; a
  // canvas that was torn down and rebuilt on every state frame would flicker forty times a match.
  const latest = useRef(view);
  const send = useRef(act);
  latest.current = view;
  send.current = act;

  const step = useCallback((direction: 'left' | 'right') => {
    const current = latest.current;
    if (current.complete || current.paused || !current.you.alive) return;
    send.current({ type: 'move', direction });
  }, []);

  // Keyboard lives on the window rather than inside the scene, so it works before the canvas has
  // focus — nobody clicks a game to start playing it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const direction =
        event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A'
          ? 'left'
          : event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D'
            ? 'right'
            : null;
      if (!direction) return;
      event.preventDefault();
      step(direction);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    let game: Phaser.Game | undefined;
    // The effect is async and React may unmount before the import lands — in development it does
    // exactly that, twice, on every mount. Without this the second scene is orphaned in the DOM.
    let dropped = false;

    void (async () => {
      const Phaser = (await import('phaser')).default;
      if (dropped) return;

      const palette = readPalette();

      class RunScene extends Phaser.Scene {
        private board!: Phaser.GameObjects.Graphics;
        private swipeFrom: number | null = null;

        create(): void {
          this.board = this.add.graphics();

          // Tap either side, or swipe across. Both are read from the same two events, which is why
          // a swipe has to be a real distance: otherwise every tap would also be a swipe of zero.
          this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            this.swipeFrom = pointer.x;
          });

          this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            const from = this.swipeFrom;
            this.swipeFrom = null;
            if (from === null) return;

            const travelled = pointer.x - from;
            if (Math.abs(travelled) > this.scale.width * SWIPE_FRACTION) {
              step(travelled < 0 ? 'left' : 'right');
              return;
            }

            step(pointer.x < this.scale.width / 2 ? 'left' : 'right');
          });
        }

        override update(): void {
          const current = latest.current;
          const { width, height } = this.scale;
          const board = this.board;

          board.clear();

          // From the view, not the constant: the renderer draws what the server sent, and a board
          // whose width came from a different copy of the number is a board that can disagree.
          const lanes = current.lanes;
          const laneWidth = width / lanes;
          const runnerY = height * 0.8;
          const blockHeight = Math.max(18, height * 0.07);
          const radius = Math.min(laneWidth * 0.28, height * 0.05);

          // Game time, from the server's own origin. A client clock a little out draws a little
          // early or late and decides nothing by it — the deaths were judged elsewhere.
          const clock =
            current.originAt === null ? current.elapsedMs : Date.now() - current.originAt;

          board.fillStyle(palette.lane, 1);
          board.fillRect(0, 0, width, height);

          // The lanes, as gaps rather than lines: a strip of ground with seams between them.
          board.fillStyle(palette.ground, 1);
          for (let lane = 0; lane < lanes; lane += 1) {
            board.fillRect(lane * laneWidth + 2, 0, laneWidth - 4, height);
          }

          // The line the hazards land on, which is the only thing on screen that matters.
          board.fillStyle(palette.ink, 0.12);
          board.fillRect(0, runnerY - blockHeight / 2, width, blockHeight);

          for (const wave of current.waves) {
            const progress = 1 - (wave.at - clock) / LEAD_MS;
            // Off the top, or long since past. Drawn a little beyond the line so a hazard that
            // just caught somebody is still visible when the frame announcing it arrives.
            if (progress < 0 || progress > 1.25) continue;

            const y = -blockHeight + progress * (runnerY + blockHeight);
            board.fillStyle(palette.hazard, progress > 1 ? 0.35 : 0.9);

            for (const lane of wave.blocked) {
              board.fillRoundedRect(
                lane * laneWidth + 4,
                y - blockHeight / 2,
                laneWidth - 8,
                blockHeight,
                8,
              );
            }
          }

          const runner = (lane: number, colour: number, alive: boolean, offset: number) => {
            board.fillStyle(colour, alive ? 1 : 0.25);
            board.fillCircle(lane * laneWidth + laneWidth / 2 + offset, runnerY, radius);
            if (alive) return;
            // Out: a ring rather than only a fade, so it reads without relying on opacity.
            board.lineStyle(3, colour, 0.6);
            board.strokeCircle(lane * laneWidth + laneWidth / 2 + offset, runnerY, radius * 1.5);
          };

          // Offset from each other so two players in the same lane are two circles, not one.
          runner(current.them.lane, palette.them, current.them.alive, -radius * 0.55);
          runner(current.you.lane, palette.you, current.you.alive, radius * 0.55);
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        transparent: true,
        scale: {
          // The canvas follows its container, so portrait and landscape both work without the game
          // being told which one it is in.
          mode: Phaser.Scale.RESIZE,
          width: '100%',
          height: '100%',
        },
        // Nothing here has physics, gravity or collision: the server decided all three.
        scene: [RunScene],
      });
    })();

    return () => {
      dropped = true;
      game?.destroy(true);
    };
  }, [step]);

  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  return (
    <section className="flex flex-col gap-2" aria-label="Reflex">
      <p className="text-center font-display text-lg font-semibold text-ink" aria-live="polite">
        {view.complete
          ? view.outcome === 'won'
            ? 'You lasted longer 🎉'
            : view.outcome === 'lost'
              ? `${partner.nickname} lasted longer 😤`
              : 'Out at the very same moment 🤝'
          : view.paused
            ? 'Held — waiting for them…'
            : view.you.alive
              ? 'Dodge. One lane at a time.'
              : `Out. ${partner.nickname} is still going…`}
      </p>

      {/* The canvas. `touch-none` is not optional here — without it a swipe scrolls the page
          instead of moving, which on a phone makes the game unplayable rather than awkward. */}
      <div
        ref={host}
        className="mx-auto aspect-[4/3] w-full max-w-lg touch-none select-none overflow-hidden rounded-card shadow-soft sm:aspect-[16/10]"
        role="application"
        aria-label="Dodge the falling blocks. Left and right arrow keys, or tap either side."
      />

      <div className="flex items-center justify-center gap-5 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-pill bg-berry" aria-hidden="true" />
          {you.nickname} ·{' '}
          <span className="tabular-nums text-ink">{seconds(view.you.survivedMs)}</span>
          {!view.you.alive && <span className="text-muted/70">· out</span>}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-pill bg-sky" aria-hidden="true" />
          {partner.nickname} ·{' '}
          <span className="tabular-nums text-ink">{seconds(view.them.survivedMs)}</span>
          {!view.them.alive && <span className="text-muted/70">· out</span>}
        </span>
      </div>

      {/* The canvas cannot be read by a screen reader, so the state it shows is also stated here. */}
      <p className="sr-only" aria-live="polite">
        {view.you.alive
          ? `You are in lane ${view.you.lane + 1} of ${view.lanes}.`
          : `You are out after ${seconds(view.you.survivedMs)}.`}
      </p>
    </section>
  );
}
