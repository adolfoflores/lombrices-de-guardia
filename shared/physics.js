import { CONFIG } from './config.js';

const R = CONFIG.wormRadius;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approach = (value, target, delta) =>
  value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);
const CIRCLE = Array.from({ length: 16 }, (_, i) => [
  Math.cos((i * Math.PI) / 8),
  Math.sin((i * Math.PI) / 8),
]);
const NOOP = () => {};

export function surfaceAt(terrain, x, top, bottom) {
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(terrain.height, bottom); y++)
    if (terrain.solid(x, y)) return y;
  return null;
}

export function groundDepth(terrain, x, y) {
  let depth = 0;
  while (terrain.solid(x, y + depth)) depth++;
  return depth;
}

export function clearAt(terrain, x, y, radius = R) {
  if (x < radius + 1 || x > CONFIG.worldWidth - radius - 1 || y < radius) return false;
  if (terrain.solid(x, y)) return false;
  return CIRCLE.every(([cx, cy]) => !terrain.solid(x + cx * radius, y + cy * radius));
}

export function supportAt(terrain, worm, offset = 2) {
  // Sweep the exact movement contour, including diagonal crater contacts and
  // one-pixel remnants. Looking only at the far probe can skip a thin sliver
  // and leave a physically resting worm "unsettled" forever.
  for (let shift = 1; shift <= Math.ceil(offset); shift++)
    if (!clearAt(terrain, worm.x, worm.y + shift)) return true;
  return false;
}

export function applyJump(worm, back = false) {
  worm.vy = back ? -CONFIG.backJumpSpeed : -CONFIG.jumpSpeed;
  worm.vx = worm.facing * (back ? -80 : 118);
  worm.grounded = false;
}

export function stepWorm(
  worm,
  input,
  dt,
  { terrain, waterY = CONFIG.waterY, controlled = true, onEvent = NOOP, onDamage = NOOP, onKill = NOOP },
) {
  if (worm.rope && !terrain.solid(worm.rope.x, worm.rope.y)) {
    worm.rope = null;
    onEvent('ropeBreak', { x: worm.x, y: worm.y, wormId: worm.id, weapon: 'rope' });
  }
  input = controlled && input ? input : {};
  const move = input.move || 0;
  worm.grounded = worm.vy >= 0 && supportAt(terrain, worm);
  let gravity = CONFIG.gravity;
  worm.thrustX = 0;
  worm.thrustY = 0;
  if (worm.jetpack && controlled && worm.fuel > 0) {
    worm.fuel = Math.max(0, worm.fuel - dt);
    const x = input.thrustX || 0,
      y = input.thrustY || 0,
      magnitude = Math.max(1, Math.hypot(x, y));
    worm.thrustX = x / magnitude;
    worm.thrustY = y / magnitude;
    // Powered flight balances gravity. The stick asks for a velocity, while
    // limited acceleration and a softer neutral brake retain visible inertia.
    gravity = 0;
    const steer = (velocity, axis, idle = 0) => {
      const target = axis ? axis * CONFIG.jetpackMaxSpeed : idle;
      const response = axis ? CONFIG.jetpackResponse : CONFIG.jetpackBrakeResponse;
      const change = (target - velocity) * (1 - Math.exp(-response * dt));
      return velocity + clamp(change, -CONFIG.jetpackAcceleration * dt, CONFIG.jetpackAcceleration * dt);
    };
    worm.vx = steer(worm.vx, worm.thrustX);
    worm.vy = steer(worm.vy, worm.thrustY, CONFIG.jetpackIdleDescent);
    if (worm.fuel <= 0) {
      worm.jetpack = false;
      worm.thrustX = 0;
      worm.thrustY = 0;
      onEvent('fuelEmpty', {
        x: worm.x,
        y: worm.y,
        wormId: worm.id,
        weapon: 'jetpack',
        text: 'Sin combustible',
      });
    }
  } else if (worm.rope) {
    const rope = worm.rope,
      rx = worm.x - rope.x,
      ry = worm.y - rope.y,
      length = Math.hypot(rx, ry);
    const drag = Math.exp(-CONFIG.ropeDrag * dt);
    worm.vx *= drag;
    worm.vy *= drag;
    if (length >= rope.length - 1 && length > 0) {
      // A taut rope accepts the tangential part of the swing impulse. Its
      // radial component cannot stretch the rope or create extra lift.
      const tx = ry / length,
        ty = -rx / length;
      const impulse = move * CONFIG.ropeSwingAcceleration * tx * dt;
      worm.vx += tx * impulse;
      worm.vy += ty * impulse;
    } else worm.vx += move * CONFIG.ropeSwingAcceleration * dt;
    const oldLength = rope.length;
    rope.reelVelocity = approach(
      rope.reelVelocity || 0,
      (input.reel || 0) * CONFIG.ropeReelSpeed,
      CONFIG.ropeReelAcceleration * dt,
    );
    rope.length = clamp(oldLength + rope.reelVelocity * dt, CONFIG.ropeMinLength, CONFIG.ropeRange);
    rope.reelVelocity = (rope.length - oldLength) / dt;
    rope.tension = 0;
  } else if (worm.grounded) {
    worm.vx = approach(worm.vx, move * CONFIG.walkSpeed, (move ? CONFIG.walkAcceleration : 450) * dt);
  } else if (controlled) worm.vx += move * CONFIG.airAcceleration * dt;
  worm.vy = Math.min(900, worm.vy + gravity * dt);
  worm.vx = clamp(worm.vx, -700, 700);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(worm.vx), Math.abs(worm.vy)) * dt));
  const delta = dt / steps;
  for (let i = 0; i < steps; i++) {
    let nx = clamp(worm.x + worm.vx * delta, R + 1, CONFIG.worldWidth - R - 1);
    if (clearAt(terrain, nx, worm.y)) worm.x = nx;
    else {
      let climbed = false;
      if (controlled && move && worm.grounded && Math.abs(worm.vx) <= CONFIG.walkSpeed + 5) {
        for (let lift = 1; lift <= 8; lift++)
          if (clearAt(terrain, nx, worm.y - lift)) {
            worm.x = nx;
            worm.y -= lift;
            climbed = true;
            break;
          }
      }
      if (!climbed) worm.vx = 0;
    }
    const ny = worm.y + worm.vy * delta;
    if (clearAt(terrain, worm.x, ny)) {
      worm.y = ny;
      worm.grounded = false;
    } else {
      const fallSpeed = worm.vy;
      // Resolve to the last free pixel instead of leaving a visual gap at the floor.
      let lo = worm.y,
        hi = ny;
      for (let refine = 0; refine < 6; refine++) {
        const mid = (lo + hi) / 2;
        if (clearAt(terrain, worm.x, mid)) lo = mid;
        else hi = mid;
      }
      worm.y = lo;
      worm.grounded = fallSpeed > 0;
      worm.vy = 0;
      if (fallSpeed > CONFIG.fallSafeSpeed && !worm.jetpack && !worm.rope)
        onDamage(worm, Math.floor((fallSpeed - CONFIG.fallSafeSpeed) * CONFIG.fallDamageScale));
    }
    if (worm.y + R >= waterY) {
      onKill(worm, true);
      break;
    }
  }
  if (worm.rope && worm.hp > 0) {
    const rope = worm.rope;
    const rx = worm.x - rope.x,
      ry = worm.y - rope.y;
    const length = Math.hypot(rx, ry);
    if (length > rope.length && length > 0) {
      const nx = rx / length,
        ny = ry / length;
      // Sweep the pull too: checking only its destination could reel a worm
      // straight through a thin platform or the corner of a wall.
      const pull = length - rope.length,
        steps = Math.max(1, Math.ceil(pull));
      const fromX = worm.x,
        fromY = worm.y;
      let blocked = false;
      for (let step = 1; step <= steps; step++) {
        const amount = (pull * step) / steps,
          x = fromX - nx * amount,
          y = fromY - ny * amount;
        if (!clearAt(terrain, x, y)) {
          blocked = true;
          break;
        }
        worm.x = x;
        worm.y = y;
      }
      if (blocked) {
        rope.length = Math.min(Math.hypot(worm.x - rope.x, worm.y - rope.y), CONFIG.ropeRange);
        rope.reelVelocity = 0;
      }
      const radial = worm.vx * nx + worm.vy * ny;
      const excess = radial - (rope.reelVelocity || 0);
      if (excess > 0) {
        worm.vx -= excess * nx;
        worm.vy -= excess * ny;
        rope.tension = clamp(excess / (CONFIG.gravity * dt), 0, 1);
      }
    }
  }
  // Later substeps may move horizontally with vy=0 after landing. Recheck the
  // final support instead of publishing an airborne pose while on the floor.
  worm.grounded = worm.hp > 0 && worm.vy >= 0 && supportAt(terrain, worm);
  if (Math.abs(worm.vx) < 0.2) worm.vx = 0;
}
