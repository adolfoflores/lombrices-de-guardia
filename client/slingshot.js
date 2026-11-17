// Slingshot aiming on the battlefield: pull back from the worm, release to shoot.
// Pure gesture math in screen pixels, shared by the renderer and its tests.
export const GRAB_RADIUS = 70; // a press this close to the active worm starts the gesture
export const CANCEL_RADIUS = 24; // releasing this close to the press point cancels without a shot
export const TURN_RADIUS = 6; // the direction settles once the finger leaves this jitter zone
export const MIN_POWER = 0.08; // the same floor as a just-started charge
export const MIN_PULL = 20; // pixels (after sensitivity) where the minimum power begins
export const MAX_PULL = 170; // pixels (after sensitivity) for full power

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/** Power grows with the pull; sensitivity shortens the pull a full shot needs. */
export function slingshotPower(length, sensitivity = 1) {
  const pull = Math.max(0, length) * (Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1);
  return MIN_POWER + (1 - MIN_POWER) * clamp((pull - MIN_PULL) / (MAX_PULL - MIN_PULL), 0, 1);
}

/**
 * Angle, power and cancel state for a drag of (dx, dy) screen pixels from the
 * press point. The shot flies opposite to the pull, like a stone in a sling.
 * `previousAngle` is kept while the finger is still inside the jitter zone.
 */
export function slingshot(dx, dy, sensitivity = 1, previousAngle = -Math.PI / 4) {
  const length = Math.hypot(dx, dy);
  const angle = length >= TURN_RADIUS ? Math.atan2(-dy, -dx) : previousAngle;
  return { angle, power: slingshotPower(length, sensitivity), cancel: length < CANCEL_RADIUS, length };
}
