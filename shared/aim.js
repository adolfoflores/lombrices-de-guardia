/** World angles use Canvas coordinates: negative vertical components point up. */
export function normalizeAngle(angle) {
  if (angle >= -Math.PI && angle <= Math.PI) return angle;
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Change sides without changing the shot's vertical inclination. */
export function aimForFacing(angle, facing) {
  return Math.atan2(Math.sin(angle), Math.abs(Math.cos(angle)) * (facing < 0 ? -1 : 1));
}

/** A nearly vertical aim keeps the last deliberate horizontal orientation. */
export function aimFacing(angle, fallback = 1) {
  const horizontal = Math.cos(angle);
  return Math.abs(horizontal) > 0.05 ? (horizontal < 0 ? -1 : 1) : fallback < 0 ? -1 : 1;
}
