import { aimForFacing } from '../shared/aim.js';

// Vertical input controls an equipped, deployed tool. Selecting another weapon
// restores aiming while the rope/jetpack continues its authoritative physics.
export function controlMode(worm, weapon) {
  if (worm?.jetpack && weapon === 'jetpack') return 'jetpack';
  if (worm?.rope && weapon === 'rope') return 'rope';
  return 'move';
}

export function advanceAim(angle, facing, stickY, keyboardY, dt, sensitivity = 1) {
  const velocity = Math.max(-1.35, Math.min(1.35, stickY * 1.35 + keyboardY * 0.6));
  const elevation = Math.atan2(Math.sin(angle), Math.abs(Math.cos(angle)));
  const next = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, elevation + velocity * sensitivity * dt));
  return aimForFacing(next, facing);
}
