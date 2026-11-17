import {
  WORLD_W,
  WORLD_H,
  clamp,
  lerp,
  PUNCH_ATTACK,
  PUNCH_RELEASE,
  BEAT_HOLD,
  BEAT_RECOVER,
  BEAT_RATE,
  BEAT_PUNCH,
} from './primitives.js';

export function updateCamera(renderer, time, dt) {
  let fit = null;
  if (renderer.autoFollow && !renderer.fullView) {
    const projectiles = renderer.state.projectiles || [];
    const projectile = renderer.leadProjectile(projectiles);
    const worm = renderer.state.worms.find((w) => w.id === renderer.state.turn?.wormId && w.hp > 0);
    const target = projectile || (renderer.impactFocus?.until > time ? renderer.impactFocus : worm);
    if (target) renderer.followGoal(target, worm);
    if (projectile) fit = renderer.fitProjectiles(projectile, projectiles);
  }
  renderer.fitZoom = fit;
  renderer.clampCamera(renderer.cameraGoal);
  const ease = renderer.view.reducedMotion ? 1 : 1 - Math.exp(-dt * (renderer.pointers.size ? 30 : 7));
  renderer.camera.x = lerp(renderer.camera.x, renderer.cameraGoal.x, ease);
  renderer.camera.y = lerp(renderer.camera.y, renderer.cameraGoal.y, ease);
  // The impact punch rides on top of the smoothed zoom; folded into the goal it
  // would be swallowed by the camera's own easing. Dividing out the previous
  // factor recovers the smoothed value exactly, even where maxZoom clamped it.
  const base = lerp(
    renderer.camera.zoom / renderer.zoomFactor,
    fit ? Math.min(renderer.cameraGoal.zoom, fit) : renderer.cameraGoal.zoom,
    ease,
  );
  const punch = renderer.view.reducedMotion ? 0 : renderer.punchValue(time);
  renderer.camera.zoom = punch > 0 ? clamp(base * (1 + punch), renderer.minZoom, renderer.maxZoom) : base;
  renderer.zoomFactor = renderer.camera.zoom / base;
}

export function leadProjectile(renderer, projectiles) {
  if (!projectiles.length) return null;
  const main = projectiles.find((p) => ['bazooka', 'grenade', 'cluster', 'rocket'].includes(p.kind));
  if (main) return main;
  let lead = projectiles[0];
  for (const p of projectiles) if ((p.vy || 0) > (lead.vy || 0)) lead = p;
  return lead;
}

export function fitProjectiles(renderer, lead, projectiles) {
  if (projectiles.length < 2) return null;
  let dx = 0,
    dy = 0;
  for (const p of projectiles) {
    dx = Math.max(dx, Math.abs(p.x - lead.x));
    dy = Math.max(dy, Math.abs(p.y - lead.y));
  }
  const zoom = renderer.cameraGoal.zoom,
    spanX = renderer.width * 0.6,
    spanY = renderer.height * 0.6;
  if (dx * 2 * zoom <= spanX && dy * 2 * zoom <= spanY) return null;
  return clamp(Math.min(spanX / Math.max(1, dx * 2), spanY / Math.max(1, dy * 2)), renderer.minZoom, zoom);
}

export function punchZoom(renderer, amount, now) {
  if (!renderer.autoFollow || renderer.fullView || renderer.view.reducedMotion) return;
  const current = renderer.punchValue(now);
  if (current >= amount) return;
  renderer.zoomPunch = { start: now - PUNCH_ATTACK * (1 - Math.sqrt(1 - current / amount)), amount };
}

export function punchValue(renderer, now) {
  const punch = renderer.zoomPunch;
  if (!punch) return 0;
  const t = now - punch.start;
  if (t <= 0) return 0;
  if (t < PUNCH_ATTACK) {
    const u = t / PUNCH_ATTACK;
    return punch.amount * (1 - (1 - u) ** 2);
  }
  const r = (t - PUNCH_ATTACK) / PUNCH_RELEASE;
  if (r >= 1) {
    renderer.zoomPunch = null;
    return 0;
  }
  return punch.amount * (1 - r * r * (3 - 2 * r));
}

export function killingBlow(renderer, event) {
  if (!event.wormId || !renderer.state?.turn) return false;
  const victim = renderer.state.worms.find((w) => w.id === event.wormId);
  return !!victim && victim.playerId !== renderer.state.turn.playerId;
}

export function startBeat(renderer, now) {
  if (renderer.view.reducedMotion) return;
  renderer.lagBase += renderer.beatLag(now);
  renderer.beat = { start: now };
  renderer.punchZoom(BEAT_PUNCH, now);
}

export function beatLag(renderer, now) {
  if (!renderer.beat) return 0;
  const t = clamp(now - renderer.beat.start, 0, BEAT_HOLD + BEAT_RECOVER),
    lost = 1 - BEAT_RATE;
  if (t <= BEAT_HOLD) return t * lost;
  const r = t - BEAT_HOLD;
  return BEAT_HOLD * lost + lost * (r - (r * r) / (2 * BEAT_RECOVER));
}

export function effectTime(renderer, now = performance.now()) {
  return now - renderer.lagBase - renderer.beatLag(now);
}

export function effectRate(renderer, now = performance.now()) {
  if (!renderer.beat) return renderer.replaying ? renderer.replaying.rate : 1;
  const t = now - renderer.beat.start;
  if (t < BEAT_HOLD) return BEAT_RATE;
  return t >= BEAT_HOLD + BEAT_RECOVER ? 1 : lerp(BEAT_RATE, 1, (t - BEAT_HOLD) / BEAT_RECOVER);
}

export function drawBeat(renderer, ctx, time) {
  if (!renderer.beat) return;
  const t = time - renderer.beat.start;
  const alpha = t < 40 ? t / 40 : t < BEAT_HOLD ? 1 : 1 - clamp((t - BEAT_HOLD) / BEAT_RECOVER, 0, 1);
  if (alpha <= 0) return;
  const cx = renderer.width / 2,
    cy = renderer.height / 2,
    radius = Math.hypot(cx, cy);
  const glow = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
  glow.addColorStop(0, 'rgba(255,176,96,0)');
  glow.addColorStop(0.6, `rgba(255,150,80,${(0.22 * alpha).toFixed(3)})`);
  glow.addColorStop(1, `rgba(150,50,30,${(0.55 * alpha).toFixed(3)})`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, renderer.width, renderer.height);
}

export function clampCamera(renderer, camera) {
  const halfW = renderer.width / camera.zoom / 2,
    halfH = renderer.height / camera.zoom / 2;
  camera.x = halfW >= WORLD_W / 2 ? WORLD_W / 2 : clamp(camera.x, halfW, WORLD_W - halfW);
  camera.y = halfH >= WORLD_H / 2 ? WORLD_H / 2 : clamp(camera.y, halfH, WORLD_H - halfH);
}

export function ownTurn(renderer) {
  return (
    !!renderer.state &&
    renderer.state.phase === 'playing' &&
    renderer.state.turn?.playerId === renderer.view.playerId
  );
}

export function followGoal(renderer, target, worm) {
  const zoom = renderer.cameraGoal.zoom;
  if (target === worm && worm && renderer.ownTurn()) {
    // Sit the shooter in the lower third and lead toward its facing, so the
    // shot's arc and landing zone stay on screen instead of the ground behind.
    const facing = renderer.view.facing === -1 ? -1 : 1;
    renderer.cameraGoal.x = worm.x + (facing * clamp(renderer.width * 0.1, 40, 110)) / zoom;
    renderer.cameraGoal.y = worm.y - (renderer.height * 0.12) / zoom;
    return;
  }
  renderer.cameraGoal.x = target.x;
  renderer.cameraGoal.y = target.y - renderer.followOffsetY / zoom;
}

export function focus(renderer) {
  renderer.autoFollow = true;
  renderer.fullView = false;
  // The acting player sees a little more field; spectators keep the closer follow.
  renderer.cameraGoal.zoom = clamp(
    Math.max(renderer.width / 930, renderer.height / 530) * (renderer.ownTurn() ? 0.88 : 1),
    renderer.minZoom || 0.2,
    renderer.maxZoom || 2.8,
  );
  const worm = renderer.state?.worms.find((w) => w.id === renderer.state.turn?.wormId && w.hp > 0);
  if (worm) renderer.followGoal(worm, worm);
  renderer.clampCamera(renderer.cameraGoal);
  renderer.onCamera();
}

export function overview(renderer) {
  renderer.autoFollow = false;
  renderer.fullView = true;
  renderer.cameraGoal = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: renderer.minZoom || 0.5 };
  renderer.onCamera();
}

export function zoomBy(renderer, factor) {
  renderer.zoomAt(factor, { x: renderer.width / 2, y: renderer.height / 2 });
}

export function zoomAt(renderer, factor, point) {
  if (!Number.isFinite(factor) || factor <= 0) return;
  renderer.autoFollow = false;
  renderer.fullView = false;
  const before = renderer.worldPoint(point, renderer.cameraGoal);
  renderer.cameraGoal.zoom = clamp(renderer.cameraGoal.zoom * factor, renderer.minZoom, renderer.maxZoom);
  const after = renderer.worldPoint(point, renderer.cameraGoal);
  renderer.cameraGoal.x += before.x - after.x;
  renderer.cameraGoal.y += before.y - after.y;
  renderer.clampCamera(renderer.cameraGoal);
  renderer.onCamera();
}

export function localPoint(renderer, event) {
  const r = renderer.canvas.getBoundingClientRect();
  return { x: event.clientX - r.left, y: event.clientY - r.top };
}

export function worldPoint(renderer, point, camera = renderer.camera) {
  return {
    x: camera.x + (point.x - renderer.width / 2) / camera.zoom,
    y: camera.y + (point.y - renderer.height / 2) / camera.zoom,
  };
}

export function screenPoint(renderer, point) {
  return {
    x: (point.x - renderer.camera.x) * renderer.camera.zoom + renderer.width / 2,
    y: (point.y - renderer.camera.y) * renderer.camera.zoom + renderer.height / 2,
  };
}
