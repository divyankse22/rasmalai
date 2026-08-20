/**
 * What crosses the wire for Basketball, and the kinematics both ends draw from.
 *
 * Safe for the browser: no rules, no server state, nothing secret. This game keeps no secrets at
 * all — there is no hidden card and no unknown delay, only a hoop that will not sit still — so the
 * split that matters here is not *what the client may know* but *what the client may decide*. The
 * numbers below describe how a ball flies; whether one went in is settled in `server.ts` and
 * nowhere else.
 *
 * Both sides therefore share the arithmetic on purpose. The renderer animates the ball by
 * integrating the same parabola the server solved, from the same release the server was sent, so
 * what a player watches and what the server scored cannot disagree — not "usually agree to within a
 * frame", but cannot, because there is one set of equations and one set of constants.
 *
 * Everything is already resolved to one reader's point of view — `you` and `them` — for the same
 * reason `SessionView` is.
 */

// ---------------------------------------------------------------------------------------------
// The shape of a match
// ---------------------------------------------------------------------------------------------

/**
 * Two levels, five rounds each, one shot each per round: twenty shots in a match.
 *
 * A *round* rather than independent shots is what makes an alternating game fair: the hoop's
 * motion is rolled once per round and both players shoot at the identical hoop, so the pair who
 * face each other on shot 7 and shot 8 are facing the same problem. Rolling it per shot would hand
 * one of them a calm hoop and the other a wild one and call it a competition.
 *
 * The two levels are one match, not two: level one's hoop stands dead still — the arc is the whole
 * problem — and level two's picks up exactly where the original escalation left off, drifting
 * further with every round. Nobody chooses a difficulty; the match teaches the shot before it asks
 * for it.
 */
export const LEVELS = 2;
export const ROUNDS_PER_LEVEL = 5;
export const TOTAL_ROUNDS = LEVELS * ROUNDS_PER_LEVEL;

/** Twenty shots to a match; the number a shot carries so a late frame cannot land on the next one. */
export const TOTAL_SHOTS = TOTAL_ROUNDS * 2;

/**
 * How long you have to take a shot before it is chalked off.
 *
 * This clock is the whole reason the drifting hoop is a game rather than a wait. The hoop passes
 * through its easiest position twice a cycle, so with unlimited time the correct play would always
 * be to sit still until it arrives — fifteen seconds turns that into a real choice between the shot
 * in front of you and the better one that may or may not come back round in time.
 *
 * Deliberately far inside the platform's two-minute move clock (`MOVE_WINDOW_MS`), which therefore
 * never fires during a shot. That clock exists to rescue a match from somebody who has walked out;
 * this one exists to keep a match moving, and a game that can resolve its own turns should not be
 * leaning on the platform's last resort to do it.
 */
export const SHOT_CLOCK_MS = 15_000;

/**
 * The pause after the ball has finished, before the next shot opens.
 *
 * Measured from the moment the ball lands rather than from the release, because the flight is not a
 * fixed length: an ordinary shot is in the air about a second and a deliberate lob is in the air
 * two and a half. A fixed beat generous enough for the lob would idle after every normal shot, and
 * one sized for the normal shot would open the next one while the lob was still in the air.
 *
 * Both players sit through it — the one who shot and the one who watched — because a game that
 * snapped straight to the next shooter would be asking somebody to start aiming while the last ball
 * was still coming down.
 */
export const SETTLE_MS = 1_200;

// ---------------------------------------------------------------------------------------------
// The court, in metres
// ---------------------------------------------------------------------------------------------

/**
 * Real units, because the numbers then sanity-check themselves: a 3.05m rim and a 6.5m arc are the
 * genuine article, so a shot that feels wrong on screen is a physics bug rather than a scale that
 * was never right in the first place.
 */
export const GRAVITY = 9.81;

/** Where the ball leaves the hand: the origin of every trajectory in this game. */
export const RELEASE_X = 0;
export const RELEASE_Y = 1.8;

/** Regulation rim height. */
export const RIM_Y = 3.05;

/** The hoop's resting position; it drifts either side of this. */
export const HOOP_CENTRE_X = 6;

/**
 * How far off centre the ball may cross the rim's height and still drop in.
 *
 * Generous — a real rim forgives about a tenth of a metre and this forgives four times that.
 * `docs/01` section 8 asks for cute and quick rather than serious, and a shooting game that
 * demands centimetre precision on a moving target is a game two people stop playing.
 */
export const MAKE_TOLERANCE = 0.4;

/** Beyond this, a made shot is worth three rather than two. FIBA's own arc, near enough. */
export const THREE_POINT_DISTANCE = 6.5;

export const TWO_POINTS = 2;
export const THREE_POINTS = 3;

/** The aim a player is allowed to send. Below the lower bound is a pass, above it is a lob. */
export const MIN_ANGLE_DEG = 20;
export const MAX_ANGLE_DEG = 80;

/** What `power` 0 and 1 mean, in metres per second. */
export const MIN_SPEED = 4;
export const MAX_SPEED = 11;

/** Enough court to hold every hoop position with room to spare, for the renderer to scale against. */
export const COURT_WIDTH = 10;
export const COURT_HEIGHT = 5.2;

// ---------------------------------------------------------------------------------------------
// The drifting hoop
// ---------------------------------------------------------------------------------------------

/**
 * How the hoop moves for one round.
 *
 * Rolled by the server once per round and sent to both players, which is what `docs/04` section 10
 * means by equal conditions: the same seed produces the same hoop in both browsers at the same
 * millisecond. The client is told the motion rather than the positions because a position is only
 * true for an instant and a description is true for the whole round.
 */
export interface HoopMotion {
  /** Metres either side of `HOOP_CENTRE_X`. */
  amplitude: number;
  /** A full there-and-back, in milliseconds. */
  periodMs: number;
  /** Where in the cycle the round opens, in radians. Rolled so a round cannot be memorised. */
  phase: number;
}

/** Gentle in round one, frantic by round five. */
export const HOOP_AMPLITUDE_FIRST = 0.8;
export const HOOP_AMPLITUDE_LAST = 2.6;
export const HOOP_PERIOD_FIRST_MS = 5_200;
export const HOOP_PERIOD_LAST_MS = 2_600;

/**
 * Where the hoop is, `elapsedMs` into a shot.
 *
 * Measured from the moment *this shot's* clock started rather than from the start of the match, so
 * both players in a round meet the hoop at the same point in its cycle. Whoever shoots second would
 * otherwise inherit whatever position the first one left it in.
 */
export function hoopXAt(motion: HoopMotion, elapsedMs: number): number {
  return (
    HOOP_CENTRE_X +
    motion.amplitude * Math.sin((2 * Math.PI * elapsedMs) / motion.periodMs + motion.phase)
  );
}

// ---------------------------------------------------------------------------------------------
// Ballistics
// ---------------------------------------------------------------------------------------------

/** A shot, resolved into the only two numbers the flight depends on. */
export interface Launch {
  vx: number;
  vy: number;
}

export function launchOf(angleDeg: number, power: number): Launch {
  const speed = MIN_SPEED + power * (MAX_SPEED - MIN_SPEED);
  const radians = (angleDeg * Math.PI) / 180;
  return { vx: speed * Math.cos(radians), vy: speed * Math.sin(radians) };
}

/** Where the ball is `seconds` after release, in court metres. */
export function ballAt(launch: Launch, seconds: number): { x: number; y: number } {
  return {
    x: RELEASE_X + launch.vx * seconds,
    y: RELEASE_Y + launch.vy * seconds - 0.5 * GRAVITY * seconds * seconds,
  };
}

/**
 * Seconds until the ball crosses the rim's height **on the way down**, or null if it never gets
 * that high.
 *
 * The descending root is the only one that can score: a ball still on its way up is under the rim,
 * on its way to somewhere above it, and a shot that goes in on the rise is not a shot anyone has
 * ever taken.
 */
export function timeToRim(launch: Launch): number | null {
  const rise = RIM_Y - RELEASE_Y;
  const discriminant = launch.vy * launch.vy - 2 * GRAVITY * rise;
  if (discriminant < 0) return null;

  return (launch.vy + Math.sqrt(discriminant)) / GRAVITY;
}

/** Seconds until the ball reaches the floor. Always defined — everything comes down. */
export function timeToFloor(launch: Launch): number {
  return (
    (launch.vy + Math.sqrt(launch.vy * launch.vy + 2 * GRAVITY * RELEASE_Y)) / GRAVITY
  );
}

// ---------------------------------------------------------------------------------------------
// Bouncing off anything that is not the hole
// ---------------------------------------------------------------------------------------------

/** How far behind the rim's centre the backboard stands, and how tall it is either side of the rim. */
export const BACKBOARD_X_OFFSET = 0.5;
export const BACKBOARD_BELOW_RIM = 0.2;
export const BACKBOARD_ABOVE_RIM = 1.1;

/** Beyond `MAKE_TOLERANCE` but still this close, a miss is a clip rather than an airball. */
export const RIM_CLIP_MARGIN = 0.5;

/** Energy kept on a bounce. Bouncy enough to read as a ball, not a dropped brick. */
const BOARD_RESTITUTION = 0.5;
const RIM_RESTITUTION = 0.45;
const RIM_VX_DAMPING = 0.7;

/** Two bounces is a rebound; a third would be a pinball table. */
const MAX_BOUNCES = 2;
const SIM_STEP_S = 1 / 60;
/** A safety valve. Nothing a real shot does should ever reach it — gravity always wins eventually. */
const MAX_FLIGHT_MS = 6_000;

/** One unbroken piece of flight: where it starts, at what velocity, and for how long. */
export interface BallSegment {
  /** Ms into the shot clock this piece begins — the same clock `releasedAtMs` is measured from. */
  startMs: number;
  fromX: number;
  fromY: number;
  vx: number;
  vy: number;
  durationMs: number;
}

/**
 * The ball's whole path after a miss, cosmetic bounces included.
 *
 * A pure function of exactly what already decided the shot — the launch, the moment of release, and
 * the hoop's motion — so a renderer can call this itself and land on the identical path the server
 * would, with nothing sent over the wire beyond what `ShotView` already carries. That is also why it
 * is safe for the server to lean on it for timing (`server.ts` sizes the watching beat from the last
 * segment): both ends are solving the same arithmetic, not comparing notes on the result of it.
 *
 * **Purely decorative.** `applyAction` has already scored the shot from the clean parabola before
 * this is ever called — on the descending crossing, against the hoop's position at that instant —
 * and nothing a bounce does here can turn that miss into a make. A near-miss clips the rim and comes
 * back off it; a shot that reaches the backboard bounces off that instead; anything already wide of
 * both just keeps falling, exactly as it did before this existed.
 *
 * Stepped rather than solved in closed form, because the hoop this may collide with keeps moving
 * while the ball is in the air, and a sine wave inside a parabola has no algebraic intersection.
 */
export function computeBallPath(launch: Launch, releasedAtMs: number, hoop: HoopMotion): BallSegment[] {
  const segments: BallSegment[] = [];
  let originX = RELEASE_X;
  let originY = RELEASE_Y;
  let current = launch;
  let segmentStartMs = releasedAtMs;
  let bounces = 0;
  let t = 0;
  let prevX = originX;
  let prevY = originY;

  const finish = (durationMs: number) => {
    segments.push({
      startMs: segmentStartMs,
      fromX: originX,
      fromY: originY,
      vx: current.vx,
      vy: current.vy,
      durationMs,
    });
  };

  const rebound = (x: number, y: number, next: Launch, elapsedMs: number) => {
    finish(t * 1000);
    originX = x;
    originY = y;
    current = next;
    segmentStartMs = elapsedMs;
    bounces += 1;
    t = 0;
    prevX = x;
    prevY = y;
  };

  for (;;) {
    t += SIM_STEP_S;
    const elapsedMs = segmentStartMs + t * 1000;
    if (elapsedMs - releasedAtMs > MAX_FLIGHT_MS) {
      finish(t * 1000);
      break;
    }

    const x = originX + current.vx * t;
    const y = originY + current.vy * t - 0.5 * GRAVITY * t * t;
    const vyNow = current.vy - GRAVITY * t;
    const hoopX = hoopXAt(hoop, elapsedMs);

    if (bounces < MAX_BOUNCES) {
      const backboardX = hoopX + BACKBOARD_X_OFFSET;
      const crossedBoard = current.vx > 0 && prevX < backboardX && x >= backboardX;
      const inBoardBand = y >= RIM_Y - BACKBOARD_BELOW_RIM && y <= RIM_Y + BACKBOARD_ABOVE_RIM;

      if (crossedBoard && inBoardBand) {
        rebound(backboardX, y, { vx: -current.vx * BOARD_RESTITUTION, vy: vyNow }, elapsedMs);
        continue;
      }

      const crossedRimHeight = (prevY - RIM_Y) * (y - RIM_Y) <= 0 && prevY !== y;
      const clipDistance = Math.abs(x - hoopX);
      if (crossedRimHeight && clipDistance > MAKE_TOLERANCE && clipDistance <= MAKE_TOLERANCE + RIM_CLIP_MARGIN) {
        rebound(x, RIM_Y, { vx: current.vx * RIM_VX_DAMPING, vy: -vyNow * RIM_RESTITUTION }, elapsedMs);
        continue;
      }
    }

    if (y <= 0) {
      finish(t * 1000);
      break;
    }

    prevX = x;
    prevY = y;
  }

  return segments;
}

/** Where the ball is along a path a miss has already bounced its way through. */
export function positionAlongPath(path: readonly BallSegment[], elapsedMs: number): { x: number; y: number } {
  const last = path[path.length - 1]!;
  const clamped = clampMs(elapsedMs, path[0]!.startMs, last.startMs + last.durationMs);
  const segment = path.find((candidate) => clamped <= candidate.startMs + candidate.durationMs) ?? last;
  const seconds = (clamped - segment.startMs) / 1000;

  return {
    x: segment.fromX + segment.vx * seconds,
    y: segment.fromY + segment.vy * seconds - 0.5 * GRAVITY * seconds * seconds,
  };
}

/** How long a bounced path actually takes, start to rest — longer or shorter than a clean fall. */
export function pathDurationMs(path: readonly BallSegment[], releasedAtMs: number): number {
  const last = path[path.length - 1]!;
  return last.startMs + last.durationMs - releasedAtMs;
}

function clampMs(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

// ---------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------

export type ShotOutcome = 'made' | 'missed' | 'timeout';

/** A shot that has been taken, as one reader sees it. */
export interface ShotView {
  /** 1-based, and unique across the match: shot 7 is round 4's first. */
  number: number;
  round: number;
  /** Whether this was yours. */
  mine: boolean;
  outcome: ShotOutcome;
  /** 0, 2 or 3. */
  points: number;
  /** Degrees above the horizontal, exactly as sent. Null when the clock ran out instead. */
  angle: number | null;
  /** 0–1 of the power range, exactly as sent. Null on a timeout. */
  power: number | null;
  /**
   * How far into the shot clock the ball left the hand, by the server's own reckoning.
   *
   * The renderer starts the flight from here, so the ball leaves at the moment the hoop was where
   * the shooter was aiming rather than wherever it has drifted to since.
   */
  releasedAtMs: number | null;
  /**
   * How long the ball is in the air, in milliseconds: to the rim when it went in, to the floor when
   * it did not, and zero for a shot never taken.
   *
   * Serialized rather than left to the renderer to work out, for the same reason `landingX` is. The
   * server resolved this shot, and the animation should replay that resolution rather than form a
   * second opinion about it that happens to agree.
   */
  flightMs: number;
  /** Where the ball crossed the rim's height. Null when it never reached it. */
  landingX: number | null;
  /** Where the hoop was when the ball arrived, so a near miss reads as one. */
  hoopXAtArrival: number;
  /** How far the hoop was at release — the distance that decided two points or three. */
  hoopDistanceAtRelease: number;
  wasThree: boolean;
}

export interface BasketballView {
  levels: number;
  /** 1-based: 1 while the hoop is still, 2 once it starts drifting. */
  level: number;
  roundsPerLevel: number;
  /** 1-based, and reset at the start of level two — level one's round 5 is not level two's round 6. */
  roundInLevel: number;
  /** 1-based across the whole match, and the number a shot must carry to be accepted. */
  shotNumber: number;
  phase: 'aiming' | 'watching';
  /** Whether the open shot is yours. False whenever nothing is open to shoot. */
  yourTurn: boolean;
  /** Whether the next shot will be yours, or null once there is no next one. */
  nextIsYours: boolean | null;
  /**
   * Server epoch ms this shot's clock started — the origin the hoop's motion is measured from, and
   * the one the renderer animates against. Still set while the shot is being watched, because the
   * ball in the air belongs to it.
   */
  shotStartedAt: number;
  /** Server epoch ms the shot clock runs out. Null while watching. */
  shotDeadline: number | null;
  /** Server epoch ms the watching beat ends. Null while aiming. */
  watchUntil: number | null;
  hoop: HoopMotion;
  /** The shot in the air, or the last one taken. Null before the first shot of the match. */
  last: ShotView | null;
  /** Every shot taken, oldest first. */
  history: ShotView[];
  yourScore: number;
  theirScore: number;
  yourShotsTaken: number;
  theirShotsTaken: number;
  /** True while a player is missing: the clock is stopped and the shot will restart. */
  paused: boolean;
  complete: boolean;
}

/**
 * The only thing a player can do.
 *
 * An intent — an angle and a strength of throw — never an outcome. The server decides where that
 * puts the ball, where the hoop had drifted to by the time it got there, and whether the two met
 * (`docs/04` section 1). `shot` is the anti-staleness key: a frame carrying a number the match has
 * moved past lost a race and must never land on the shot that replaced it.
 */
export interface ShootAction {
  type: 'shoot';
  shot: number;
  /** Degrees above the horizontal. */
  angle: number;
  /** 0–1. */
  power: number;
}

export type BasketballAction = ShootAction;
