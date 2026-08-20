import type { GameMeta } from '../contract';

/**
 * Basketball — the third game, and the first one drawn with Phaser.
 *
 * The two games before it were React: a grid of circles and a single enormous button, both of them
 * things the DOM is already good at. This one is a ball on an arc against a hoop that will not stay
 * still, and P-6 says pick the cheapest renderer that *works* — which for sixty frames a second of
 * motion is a canvas, and ADR-002 already chose which canvas library that means.
 *
 * It is also the first game to use every part of the contract at once: the platform's randomness to
 * roll the hoop, its clock to run the shot timer, its latency measurement to decide where the hoop
 * was when the ball actually left, `turnOf` to name the shooter, and `pause`/`resume` to give back
 * a shot somebody lost to their wifi. Reaction Speed and Four in a Row each leaned on about half of
 * that; this leans on all of it, and still adds nothing to the platform.
 *
 * `orientation: 'landscape'` is a preference, not a demand. A court is wider than it is tall, so it
 * is better with a phone turned sideways — but it scales to fit whatever it is given, and nobody is
 * told to rotate anything.
 */
export const meta: GameMeta = {
  slug: 'basketball',
  name: 'Basketball',
  category: 'competitive',
  scoringKind: 'competitive',
  renderer: 'phaser',
  players: 2,
  orientation: 'landscape',
  // Drag and release, with mouse and thumb doing the identical thing; arrows and space for anyone
  // who would rather not drag at all (`docs/05`, input abstraction).
  inputs: ['tap', 'swipe', 'keyboard', 'pointer'],
};
