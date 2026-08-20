'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Phaser from 'phaser';
import type { GameRenderProps } from '../contract';
import {
  COURT_HEIGHT,
  COURT_WIDTH,
  MAKE_TOLERANCE,
  MAX_ANGLE_DEG,
  MIN_ANGLE_DEG,
  RELEASE_X,
  RELEASE_Y,
  RIM_Y,
  THREE_POINT_DISTANCE,
  ballAt,
  computeBallPath,
  hoopXAt,
  launchOf,
  positionAlongPath,
  type BallSegment,
  type BasketballView,
  type ShotView,
} from './protocol';

/**
 * Basketball, on screen — and the platform's first Phaser renderer.
 *
 * This component decides nothing. It draws the court the server described, animates the ball the
 * server already resolved, and sends back two numbers: an angle and a strength of throw. Whether
 * that went in was settled before this file was told anything about it.
 *
 * **The animation is a replay, not a simulation.** Both ends integrate the same parabola from
 * `protocol.ts`, starting at the release moment the server timed, so the ball on screen and the
 * ball the server scored are the same ball. A renderer running its own physics would drift from the
 * result by a frame or two, which for a game decided by four centimetres either side of a rim is
 * the difference between a swish and an argument. A miss that clips the rim or the backboard bounces
 * off it the same way: `computeBallPath` is the one place that arithmetic lives, and this file and
 * `server.ts` both call it rather than each holding half an opinion about where the ball went.
 *
 * **Phaser draws; React holds the chrome.** The score, the shot clock, the status line and the
 * fallback controls are ordinary DOM — readable by a screen reader, styled by the theme, and alive
 * before the canvas has finished loading. The canvas owns the part that genuinely needs sixty
 * frames a second, and nothing else.
 *
 * Input, per `docs/06`: drag anywhere on the court and let go — the same gesture with a thumb or a
 * mouse, no hover anywhere in it — or set the two sliders and press Shoot, which is the whole game
 * from a keyboard.
 */

/** Logical pixels per court metre. The canvas is scaled to fit whatever it is given. */
const PX_PER_M = 100;
/** A little room left of the release point so the ball is not half off the edge. */
const PADDING_M = 0.7;
/** Floorboards below the court's zero, so the ball has something to be above. */
const FLOOR_PX = 46;
const CANVAS_W = (COURT_WIDTH + PADDING_M) * PX_PER_M;
const CANVAS_H = COURT_HEIGHT * PX_PER_M + FLOOR_PX;

/** How far you have to drag for a full-strength throw. */
const FULL_POWER_PX = 260;

const BALL_RADIUS_M = 0.12;

interface Palette {
  court: number;
  line: number;
  ball: number;
  ink: number;
  hoop: number;
  board: number;
  glow: number;
  mint: number;
}

const FALLBACK: Palette = {
  court: 0xe5dbff,
  line: 0xf1e3ea,
  ball: 0xf2678f,
  ink: 0x3d2b3a,
  hoop: 0xd84972,
  board: 0xfffdfb,
  glow: 0xffeec2,
  mint: 0xc8f0e0,
};

/**
 * The court's colours, read from the theme rather than written down here.
 *
 * `docs/06` asks for one replaceable visual system, and `theme.css` is it — a canvas that hardcoded
 * its own pink would be the one thing in the application that a reskin missed.
 */
function readPalette(): Palette {
  if (typeof window === 'undefined') return FALLBACK;

  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: number): number => {
    const found = /^#([0-9a-f]{6})$/i.exec(styles.getPropertyValue(name).trim());
    return found?.[1] === undefined ? fallback : Number.parseInt(found[1], 16);
  };

  return {
    court: token('--color-lilac', FALLBACK.court),
    line: token('--color-line', FALLBACK.line),
    ball: token('--color-berry', FALLBACK.ball),
    ink: token('--color-ink', FALLBACK.ink),
    hoop: token('--color-berry-deep', FALLBACK.hoop),
    board: token('--color-shell', FALLBACK.board),
    glow: token('--color-butter', FALLBACK.glow),
    mint: token('--color-mint', FALLBACK.mint),
  };
}

/** What the scene reads on every frame. Mutated in place, never swapped, so the scene keeps up. */
interface CourtBridge {
  view: BasketballView;
  aim: { angle: number; power: number };
  palette: Palette;
  reducedMotion: boolean;
  shoot(angle: number, power: number): void;
  /** Reports a drag back, so the sliders show what was actually thrown. */
  onAim(angle: number, power: number): void;
  /**
   * The partner's live aim, while it is their shot and they are still deciding it — an ephemeral
   * platform relay (`docs/04` section 9), not part of `view`, and gone the instant a fresher one
   * replaces it. `null` whenever there is nothing to show, which `readAim` below is what checks.
   */
  partnerSignal: unknown;
  /** Broadcasts this player's own drag, throttled by the caller so a swipe is not sixty frames a second on the wire. */
  sendSignal(signal: unknown): void;
}

/** `partnerSignal` is `unknown` by contract — this is the only place that trusts its shape. */
function readAim(signal: unknown): { angle: number; power: number } | null {
  if (typeof signal !== 'object' || signal === null) return null;
  const candidate = signal as { angle?: unknown; power?: unknown };
  if (typeof candidate.angle !== 'number' || typeof candidate.power !== 'number') return null;
  return { angle: candidate.angle, power: candidate.power };
}

const toX = (metres: number) => (metres + PADDING_M) * PX_PER_M;
const toY = (metres: number) => CANVAS_H - FLOOR_PX - metres * PX_PER_M;
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * Where the ball is right now.
 *
 * Null while nothing is in the air, which is when it sits in the shooter's hands instead. The clamp
 * at both ends is what makes a reconnecting player's screen correct rather than merely close: a
 * client that joins halfway through a flight picks the ball up mid-arc, and one that joins after it
 * has landed finds it already there.
 *
 * A miss walks the bounced path `pathFor` hands it rather than the clean parabola — the same path
 * `server.ts` already timed `flightMs` from, so the two never disagree about when the ball rests.
 */
function ballInFlight(
  view: BasketballView,
  elapsedMs: number,
  pathFor: (shot: ShotView, hoop: BasketballView['hoop']) => readonly BallSegment[],
): { x: number; y: number } | null {
  const shot = view.last;
  if (view.phase !== 'watching' || !shot || shot.releasedAtMs === null || shot.angle === null) {
    return null;
  }
  if (shot.power === null || shot.outcome === 'timeout') return null;

  const clamped = clamp(elapsedMs, shot.releasedAtMs, shot.releasedAtMs + shot.flightMs);
  if (shot.outcome === 'missed') return positionAlongPath(pathFor(shot, view.hoop), clamped);

  const seconds = (clamped - shot.releasedAtMs) / 1000;
  return ballAt(launchOf(shot.angle, shot.power), seconds);
}

/**
 * The scene, as a plain configuration object.
 *
 * Deliberately not a `class extends Phaser.Scene`: Phaser is imported dynamically, so at the moment
 * this module is evaluated there is no base class to extend. A config object needs nothing at
 * module scope and keeps the whole scene inside one closure.
 */
/** How often a drag is allowed onto the wire. Smooth enough to read as live, cheap enough to send. */
const SIGNAL_THROTTLE_MS = 90;

function courtScene(bridge: CourtBridge): Phaser.Types.Scenes.SettingsConfig {
  let paint: Phaser.GameObjects.Graphics;
  let dragFrom: { x: number; y: number } | null = null;
  let dragAim: { angle: number; power: number } | null = null;
  /** The last shot given a celebration, so one make is celebrated once. */
  let cheered = 0;
  /** The bounced path for the shot currently on screen, recomputed once per shot rather than per frame. */
  let cachedPath: { shotNumber: number; path: readonly BallSegment[] } | null = null;
  let lastSignalSentAt = 0;

  const pathFor = (shot: ShotView, hoop: BasketballView['hoop']): readonly BallSegment[] => {
    if (cachedPath?.shotNumber === shot.number) return cachedPath.path;
    const path = computeBallPath(launchOf(shot.angle!, shot.power!), shot.releasedAtMs!, hoop);
    cachedPath = { shotNumber: shot.number, path };
    return path;
  };

  /** The aim being drawn: whatever is under the finger, or whatever the sliders say. */
  const shownAim = () => dragAim ?? bridge.aim;

  function aimFrom(from: { x: number; y: number }, to: { x: number; y: number }) {
    const dx = to.x - from.x;
    // Screen y grows downwards; a throw goes up.
    const dy = from.y - to.y;
    const degrees = (Math.atan2(dy, Math.max(dx, 0.001)) * 180) / Math.PI;

    return {
      angle: clamp(degrees, MIN_ANGLE_DEG, MAX_ANGLE_DEG),
      power: clamp(Math.hypot(dx, dy) / FULL_POWER_PX, 0, 1),
    };
  }

  return {
    key: 'court',

    create(this: Phaser.Scene) {
      paint = this.add.graphics();

      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (!bridge.view.yourTurn) return;
        dragFrom = { x: pointer.x, y: pointer.y };
        dragAim = shownAim();
      });

      this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
        if (!dragFrom || !bridge.view.yourTurn) return;
        dragAim = aimFrom(dragFrom, { x: pointer.x, y: pointer.y });

        // Thrown to the partner too, throttled — they are meant to see the drag itself, not the
        // finished shot a second time. Nothing here is scored or remembered (`docs/04` section 9);
        // the worst a lost frame costs is the line on their screen skipping a beat.
        const now = Date.now();
        if (now - lastSignalSentAt >= SIGNAL_THROTTLE_MS) {
          lastSignalSentAt = now;
          bridge.sendSignal({ angle: dragAim.angle, power: dragAim.power });
        }
      });

      const release = () => {
        if (!dragFrom) return;
        const thrown = dragAim;
        dragFrom = null;
        dragAim = null;
        // A tap with no drag at all is somebody touching the court, not throwing a ball at nothing.
        if (!thrown || thrown.power <= 0.02 || !bridge.view.yourTurn) return;
        bridge.onAim(thrown.angle, thrown.power);
        bridge.shoot(thrown.angle, thrown.power);
      };

      this.input.on('pointerup', release);
      this.input.on('pointerupoutside', release);
    },

    update(this: Phaser.Scene) {
      const view = bridge.view;
      const palette = bridge.palette;
      const elapsed = Date.now() - view.shotStartedAt;

      const hoopX = hoopXAt(view.hoop, Math.max(elapsed, 0));
      const ball = ballInFlight(view, elapsed, pathFor) ?? { x: RELEASE_X, y: RELEASE_Y };

      paint.clear();

      // Floorboards, so the ball is above something rather than adrift in a coloured rectangle.
      paint.fillStyle(palette.board, 1);
      paint.fillRect(0, toY(0), CANVAS_W, FLOOR_PX);
      paint.lineStyle(4, palette.line, 1);
      paint.lineBetween(0, toY(0), CANVAS_W, toY(0));

      // The arc: everything beyond it is worth three, which is the only rule the court has to say
      // out loud. Marked on the floor and carried up as a faint guide, so "am I behind it" is
      // answerable at a glance while the hoop drifts across it.
      paint.lineStyle(4, palette.mint, 0.85);
      paint.lineBetween(toX(THREE_POINT_DISTANCE), toY(0) - 14, toX(THREE_POINT_DISTANCE), toY(0) + 14);
      paint.lineStyle(2, palette.mint, 0.5);
      paint.lineBetween(toX(THREE_POINT_DISTANCE), toY(0), toX(THREE_POINT_DISTANCE), toY(RIM_Y + 0.6));

      // The post, so the hoop reads as a thing standing on the court rather than a floating rim.
      paint.lineStyle(10, palette.ink, 0.22);
      paint.lineBetween(toX(hoopX + 0.62), toY(0), toX(hoopX + 0.62), toY(RIM_Y + 0.5));

      // Backboard, rim and net, all hung off the hoop's current position.
      paint.fillStyle(palette.board, 1);
      paint.lineStyle(3, palette.line, 1);
      paint.fillRoundedRect(toX(hoopX + 0.44), toY(RIM_Y + 0.95), 18, 1.15 * PX_PER_M, 8);
      paint.strokeRoundedRect(toX(hoopX + 0.44), toY(RIM_Y + 0.95), 18, 1.15 * PX_PER_M, 8);

      paint.lineStyle(9, palette.hoop, 1);
      paint.lineBetween(toX(hoopX - MAKE_TOLERANCE), toY(RIM_Y), toX(hoopX + MAKE_TOLERANCE), toY(RIM_Y));
      paint.lineStyle(2, palette.hoop, 0.5);
      for (let strand = 0; strand <= 4; strand += 1) {
        const from = hoopX - MAKE_TOLERANCE + (strand * MAKE_TOLERANCE * 2) / 4;
        paint.lineBetween(toX(from), toY(RIM_Y), toX(hoopX + (from - hoopX) * 0.4), toY(RIM_Y - 0.42));
      }

      // Whoever is shooting: a shadow on the floor and a shape under the ball, so the release point
      // belongs to somebody. Deliberately anonymous — the platform owns who the two players are,
      // and a game that drew a person would be drawing the wrong one half the time.
      paint.fillStyle(palette.ink, 0.08);
      paint.fillEllipse(toX(RELEASE_X), toY(0) + 4, 74, 16);
      paint.fillStyle(palette.ink, 0.18);
      paint.fillRoundedRect(toX(RELEASE_X) - 21, toY(1.42), 42, 1.42 * PX_PER_M, 20);

      // The aim: a direction and a strength, never the arc it would take. Showing the flight path
      // would turn a game of judgement into a game of lining up a dotted line.
      if (view.yourTurn) {
        const aim = shownAim();
        const radians = (aim.angle * Math.PI) / 180;
        const reach = 0.5 + aim.power * 1.6;
        const tipX = RELEASE_X + Math.cos(radians) * reach;
        const tipY = RELEASE_Y + Math.sin(radians) * reach;

        paint.lineStyle(6, palette.hoop, 0.85);
        paint.lineBetween(toX(RELEASE_X), toY(RELEASE_Y), toX(tipX), toY(tipY));
        paint.fillStyle(palette.hoop, 0.9);
        paint.fillCircle(toX(tipX), toY(tipY), 9);
      }

      // The partner's aim, while it is their shot: the same line drawn for your own, in a duller
      // colour so the two are never mistaken for each other, sourced from `partnerSignal` rather
      // than local state because it is not this screen's drag to know.
      const partnerAim =
        !view.yourTurn && view.phase === 'aiming' ? readAim(bridge.partnerSignal) : null;
      if (partnerAim) {
        const radians = (partnerAim.angle * Math.PI) / 180;
        const reach = 0.5 + partnerAim.power * 1.6;
        const tipX = RELEASE_X + Math.cos(radians) * reach;
        const tipY = RELEASE_Y + Math.sin(radians) * reach;

        paint.lineStyle(6, palette.ink, 0.4);
        paint.lineBetween(toX(RELEASE_X), toY(RELEASE_Y), toX(tipX), toY(tipY));
        paint.fillStyle(palette.ink, 0.45);
        paint.fillCircle(toX(tipX), toY(tipY), 9);
      }

      // The ball.
      paint.fillStyle(palette.ball, 1);
      paint.fillCircle(toX(ball.x), toY(ball.y), BALL_RADIUS_M * PX_PER_M);
      paint.lineStyle(2, palette.ink, 0.35);
      paint.strokeCircle(toX(ball.x), toY(ball.y), BALL_RADIUS_M * PX_PER_M);

      // One flash per made shot, when the ball actually gets there rather than when the frame did.
      const shot = view.last;
      if (
        shot &&
        shot.outcome === 'made' &&
        shot.number !== cheered &&
        shot.releasedAtMs !== null &&
        elapsed >= shot.releasedAtMs + shot.flightMs
      ) {
        cheered = shot.number;
        if (!bridge.reducedMotion) {
          const ring = this.add.circle(toX(shot.hoopXAtArrival), toY(RIM_Y), 12, palette.glow, 0.9);
          this.tweens.add({
            targets: ring,
            radius: 70,
            alpha: 0,
            duration: 520,
            onComplete: () => ring.destroy(),
          });
        }
      }
    },
  } as Phaser.Types.Scenes.SettingsConfig;
}

/** What the line above the court says — the only instruction this game ever needs. */
function status(view: BasketballView, partner: string): string {
  if (view.paused) return 'Waiting for the game to pick back up…';
  if (view.complete) return 'That is the match';

  if (view.phase === 'watching' && view.last) {
    const who = view.last.mine ? 'You' : partner;
    if (view.last.outcome === 'timeout') return `${who} ran the shot clock out 😬`;
    if (view.last.outcome === 'made') {
      return `${who} scored ${view.last.points} ${view.last.wasThree ? '— from downtown! 🔥' : '🏀'}`;
    }
    return view.last.mine ? 'Off the rim 😩' : `${partner} missed`;
  }

  return view.yourTurn ? 'Your shot — drag and let go' : `${partner} is lining one up…`;
}

export default function BasketballGame({
  view,
  you,
  partner,
  act,
  partnerSignal,
  sendSignal,
}: GameRenderProps<BasketballView>) {
  const host = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [aim, setAim] = useState({ angle: 52, power: 0.6 });
  const [remaining, setRemaining] = useState<number | null>(null);

  const palette = useMemo(readPalette, []);
  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const shoot = useCallback(
    (angle: number, power: number) => {
      act({ type: 'shoot', shot: view.shotNumber, angle, power });
    },
    // Read through a ref inside the bridge, so the scene never holds a stale shot number.
    [act, view.shotNumber],
  );

  const bridge = useRef<CourtBridge>({
    view,
    aim,
    palette,
    reducedMotion,
    shoot,
    onAim: () => {},
    partnerSignal: null,
    sendSignal: () => {},
  });

  // The scene reads this object every frame; React swaps its contents rather than the object, so
  // the canvas is never rebuilt for a state change.
  bridge.current.view = view;
  bridge.current.aim = aim;
  bridge.current.shoot = shoot;
  bridge.current.onAim = (angle, power) => setAim({ angle, power });
  bridge.current.partnerSignal = partnerSignal;
  bridge.current.sendSignal = sendSignal;

  useEffect(() => {
    let game: Phaser.Game | undefined;
    let cancelled = false;

    void (async () => {
      // Imported here rather than at the top of the file: Phaser reaches for `window` as it loads,
      // and it is by far the largest thing this application ships. Both problems go away if it
      // arrives in the browser, after the game has actually started.
      const phaser = (await import('phaser')).default;
      if (cancelled || !host.current) return;

      game = new phaser.Game({
        type: phaser.AUTO,
        parent: host.current,
        width: CANVAS_W,
        height: CANVAS_H,
        transparent: true,
        banner: false,
        // ADR-011: no sound in V1, so there is no audio context to ask permission for.
        audio: { noAudio: true },
        scale: { mode: phaser.Scale.FIT, autoCenter: phaser.Scale.CENTER_BOTH },
        scene: courtScene(bridge.current),
      });

      setReady(true);
    })();

    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, []);

  // The shot clock, in whole seconds. Only while one is actually running: a ball in the air is not
  // on a clock, and neither is a player waiting for their partner to throw.
  useEffect(() => {
    if (view.shotDeadline === null) {
      setRemaining(null);
      return;
    }

    const deadline = view.shotDeadline;
    const read = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));

    read();
    const timer = setInterval(read, 200);
    return () => clearInterval(timer);
  }, [view.shotDeadline]);

  const pressing = remaining !== null && remaining <= 3;
  const distanceNow = view.yourTurn ? hoopXAt(view.hoop, Date.now() - view.shotStartedAt) : null;

  // Announced once, the moment the match crosses from level one into level two — not on first
  // mount, and not again on a reconnect that simply hands this component the level it is already
  // in. `lastLevel` is the guard: it only fires on a genuine change it watched happen.
  const [levelUp, setLevelUp] = useState(false);
  const lastLevel = useRef(view.level);
  useEffect(() => {
    if (view.level === lastLevel.current) return;
    lastLevel.current = view.level;
    if (view.level <= 1) return;

    setLevelUp(true);
    const timer = setTimeout(() => setLevelUp(false), 2600);
    return () => clearTimeout(timer);
  }, [view.level]);

  return (
    <section className="flex flex-col gap-3" aria-label="Basketball">
      {levelUp && (
        <p
          className="text-center font-display text-sm font-bold text-berry"
          role="status"
          aria-live="polite"
        >
          Level 2 — the hoop is on the move now 🏀💨
        </p>
      )}

      <p className="text-center font-display text-lg font-semibold text-ink" aria-live="polite">
        {status(view, partner.nickname)}
      </p>

      <div className="flex items-center justify-center gap-4 text-sm">
        <span className="flex items-center gap-1.5 font-display font-semibold text-ink">
          <span className="size-3 rounded-pill bg-berry" aria-hidden="true" />
          {you.nickname} {view.yourScore}
        </span>
        <span className="text-muted">
          level {view.level} · round {view.roundInLevel} of {view.roundsPerLevel}
        </span>
        <span className="flex items-center gap-1.5 font-display font-semibold text-ink">
          {partner.nickname} {view.theirScore}
          <span className="size-3 rounded-pill bg-ink" aria-hidden="true" />
        </span>
      </div>

      <div
        ref={host}
        // `touch-none` is what stops a drag across the court scrolling the page instead of throwing
        // the ball, and `select-none` stops a quick second tap selecting the canvas.
        className="mx-auto flex w-full max-w-3xl touch-none select-none items-center justify-center overflow-hidden rounded-card bg-lilac shadow-soft"
        style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
      >
        {!ready && (
          <p className="text-sm text-muted" role="status">
            Setting up the court…
          </p>
        )}
      </div>

      {/* The clock, said in words as well as drawn, because it is the thing that costs you a shot. */}
      <div className="flex items-center justify-center gap-3 text-sm">
        {remaining !== null ? (
          <span
            className={`rounded-pill px-4 py-1 tabular-nums transition-colors duration-soft ${
              pressing ? 'bg-blush font-semibold text-ink' : 'bg-cream text-muted'
            }`}
            role="status"
          >
            {view.yourTurn ? `${remaining}s to shoot` : `${partner.nickname}: ${remaining}s`}
          </span>
        ) : (
          <span className="rounded-pill bg-cream px-4 py-1 text-muted">
            {view.complete ? 'Full time' : 'Ball in the air…'}
          </span>
        )}

        {distanceNow !== null && (
          <span className="text-muted tabular-nums">
            {distanceNow.toFixed(1)}m
            {distanceNow >= THREE_POINT_DISTANCE && <span className="text-berry"> · worth 3</span>}
          </span>
        )}
      </div>

      {/* Everything above works with a thumb. This is the same game from a keyboard, and a steadier
          way to throw for anyone who would rather not drag. */}
      {view.yourTurn && (
        <div className="mx-auto flex w-full max-w-md flex-col gap-2 rounded-card bg-cream p-3">
          <label className="flex items-center gap-3 text-sm text-muted">
            <span className="w-14 shrink-0">Angle</span>
            <input
              type="range"
              className="h-8 flex-1 accent-berry"
              min={MIN_ANGLE_DEG}
              max={MAX_ANGLE_DEG}
              step={1}
              value={aim.angle}
              onChange={(event) => setAim((current) => ({ ...current, angle: event.target.valueAsNumber }))}
            />
            <span className="w-12 shrink-0 text-right tabular-nums text-ink">{aim.angle}°</span>
          </label>

          <label className="flex items-center gap-3 text-sm text-muted">
            <span className="w-14 shrink-0">Power</span>
            <input
              type="range"
              className="h-8 flex-1 accent-berry"
              min={0}
              max={100}
              step={1}
              value={Math.round(aim.power * 100)}
              onChange={(event) =>
                setAim((current) => ({ ...current, power: event.target.valueAsNumber / 100 }))
              }
            />
            <span className="w-12 shrink-0 text-right tabular-nums text-ink">
              {Math.round(aim.power * 100)}%
            </span>
          </label>

          <button
            type="button"
            onClick={() => shoot(aim.angle, aim.power)}
            className="rounded-pill bg-berry py-2 font-display font-bold text-shell transition-transform duration-quick ease-bounce active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
          >
            Shoot 🏀
          </button>
        </div>
      )}

      {/* Your own shots, one by one — the opponent's tally stays a single number in the score row
          above rather than a second shot-by-shot list, so neither of you is reading the other's
          match shot for shot. */}
      {view.history.some((shot) => shot.mine) && (
        <ol className="mx-auto flex max-w-md flex-wrap justify-center gap-1.5" aria-label="Your shots">
          {view.history
            .filter((shot) => shot.mine)
            .map((shot) => (
              <li key={shot.number}>
                <ShotChip shot={shot} />
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}

/** One of your own shots: which one, and what it was worth, said in words rather than a glyph. */
function ShotChip({ shot }: { shot: ShotView }) {
  const made = shot.outcome === 'made';
  const status =
    shot.outcome === 'made'
      ? `${shot.points} pt${shot.points === 1 ? '' : 's'}`
      : shot.outcome === 'timeout'
        ? 'No shot'
        : 'Missed';

  return (
    <span
      className={`rounded-pill px-2.5 py-1 text-xs font-semibold tabular-nums ${
        made ? 'bg-berry text-shell' : 'bg-cream text-muted'
      }`}
    >
      Shot {shot.number}: {status}
    </span>
  );
}
