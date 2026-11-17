import { CONFIG, WEAPONS } from '../../shared/config.js';
import { WORLD_W, WORLD_H, circle } from './primitives.js';

export function drawAim(renderer, ctx, time) {
  const worm = renderer.state.worms.find((w) => w.id === renderer.state.turn?.wormId);
  if (
    !worm ||
    worm.hp <= 0 ||
    renderer.state.turn?.playerId !== renderer.view.playerId ||
    renderer.state.turn.stage !== 'action'
  )
    return;
  const p = renderer.position(worm, time);
  if (renderer.view.targeting) {
    if (!renderer.target) return;
    const preview = renderer.targetPreview(renderer.target.x, renderer.target.y);
    const { x, y, valid } = preview;
    ctx.strokeStyle = valid ? '#fff2bc' : '#ff8b78';
    ctx.lineWidth = 2 / renderer.camera.zoom;
    if (renderer.view.weapon === 'girder') {
      const half = CONFIG.girderWidth / 2,
        h = CONFIG.girderHeight / 2;
      ctx.fillStyle = valid ? '#e9cc8066' : '#f1717166';
      ctx.fillRect(x - half, y - h, half * 2, h * 2);
      ctx.strokeRect(x - half, y - h, half * 2, h * 2);
      for (let i = -half; i < half; i += 20) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + h);
        ctx.lineTo(x + Math.min(half, i + 20), y - h);
        ctx.stroke();
      }
    } else {
      const r = renderer.view.weapon === 'airstrike' ? 35 : 18;
      circle(ctx, x, y, r);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r - 9, y);
      ctx.lineTo(x - r + 5, y);
      ctx.moveTo(x + r - 5, y);
      ctx.lineTo(x + r + 9, y);
      ctx.moveTo(x, y - r - 9);
      ctx.lineTo(x, y - r + 5);
      ctx.moveTo(x, y + r - 5);
      ctx.lineTo(x, y + r + 9);
      ctx.stroke();
    }
    ctx.font = `bold ${13 / renderer.camera.zoom}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillStyle = valid ? '#fff2bc' : '#ff8b78';
    ctx.strokeStyle = '#19313f';
    ctx.lineWidth = 3 / renderer.camera.zoom;
    ctx.strokeText(valid ? '✓' : '×', x, y + 4 / renderer.camera.zoom);
    ctx.fillText(valid ? '✓' : '×', x, y + 4 / renderer.camera.zoom);
    return;
  }
  const angle = renderer.view.angle,
    dx = Math.cos(angle),
    dy = Math.sin(angle);
  ctx.strokeStyle = '#183541';
  ctx.lineWidth = 4 / renderer.camera.zoom;
  ctx.beginPath();
  ctx.moveTo(p.x + dx * 30, p.y + dy * 30);
  ctx.lineTo(p.x + dx * 78, p.y + dy * 78);
  ctx.stroke();
  ctx.strokeStyle = '#f8e7ac';
  ctx.lineWidth = 1.5 / renderer.camera.zoom;
  ctx.setLineDash([4 / renderer.camera.zoom, 4 / renderer.camera.zoom]);
  ctx.stroke();
  ctx.setLineDash([]);
  circle(ctx, p.x + dx * 81, p.y + dy * 81, 3 / renderer.camera.zoom, '#fff4ce');
  if (
    renderer.view.charging &&
    WEAPONS.find((w) => w.id === renderer.view.weapon)?.power &&
    renderer.view.power > 0.01
  ) {
    ctx.strokeStyle = '#f0c65f';
    ctx.lineWidth = 4 / renderer.camera.zoom;
    ctx.beginPath();
    ctx.moveTo(p.x + dx * 30, p.y + dy * 30);
    ctx.lineTo(p.x + dx * (30 + 48 * renderer.view.power), p.y + dy * (30 + 48 * renderer.view.power));
    ctx.stroke();
  }
  if (renderer.aimDrag) renderer.drawSlingshot(ctx, p, angle);
}

export function drawSlingshot(renderer, ctx, p, angle) {
  const drag = renderer.aimDrag,
    z = renderer.camera.zoom,
    finger = renderer.worldPoint({ x: drag.x, y: drag.y });
  const tone = drag.cancel ? '#ff8b78' : '#fff2bc';
  ctx.save();
  ctx.strokeStyle = tone;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5 / z;
  ctx.setLineDash([3 / z, 5 / z]);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(finger.x, finger.y);
  ctx.stroke();
  ctx.setLineDash([]);
  const r = 14 / z;
  ctx.globalAlpha = drag.cancel ? 0.9 : 0.7;
  ctx.lineWidth = 2 / z;
  circle(ctx, finger.x, finger.y, r);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(finger.x - r - 6 / z, finger.y);
  ctx.lineTo(finger.x - r + 4 / z, finger.y);
  ctx.moveTo(finger.x + r - 4 / z, finger.y);
  ctx.lineTo(finger.x + r + 6 / z, finger.y);
  ctx.moveTo(finger.x, finger.y - r - 6 / z);
  ctx.lineTo(finger.x, finger.y - r + 4 / z);
  ctx.moveTo(finger.x, finger.y + r - 4 / z);
  ctx.lineTo(finger.x, finger.y + r + 6 / z);
  ctx.stroke();
  if (drag.cancel) {
    ctx.font = `bold ${13 / z}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillStyle = tone;
    ctx.strokeStyle = '#19313f';
    ctx.lineWidth = 3 / z;
    ctx.strokeText('×', finger.x, finger.y + 4 / z);
    ctx.fillText('×', finger.x, finger.y + 4 / z);
  } else {
    // The arc grows from the aim direction outward, so direction and power read at a glance.
    const radius = 40 / z,
      span = Math.PI * 0.62,
      sweep = span * drag.power;
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#18354199';
    ctx.lineWidth = 7 / z;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, angle - span / 2, angle + span / 2);
    ctx.stroke();
    ctx.strokeStyle = drag.power >= 0.8 ? '#ff9a7a' : '#f0c65f';
    ctx.lineWidth = 4 / z;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, angle - sweep / 2, angle + sweep / 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function targetPreview(renderer, x, y) {
  const result = (valid) => ({ x, y, valid });
  const worm = renderer.state.worms.find((w) => w.id === renderer.state.turn?.wormId);
  if (!worm || !Number.isFinite(x) || !Number.isFinite(y)) return result(false);
  const solid = (sx, sy) =>
    sx >= 0 &&
    sx < WORLD_W &&
    sy >= 0 &&
    sy < WORLD_H &&
    !!renderer.terrainData?.[Math.floor(sy) * WORLD_W + Math.floor(sx)];
  if (renderer.view.weapon === 'airstrike')
    return result(renderer.state.mapId !== 'cavern' && x >= 0 && x < WORLD_W);
  const radius = CONFIG.wormRadius;
  if (renderer.view.weapon === 'teleport') {
    if (
      Math.hypot(x - worm.x, y - worm.y) > CONFIG.teleportRange ||
      x < radius + 2 ||
      x > WORLD_W - radius - 2
    )
      return result(false);
    const clearAt = (ty) => {
      if (ty < radius || solid(x, ty)) return false;
      for (let i = 0; i < 16; i++)
        if (solid(x + Math.cos((i * Math.PI) / 8) * radius, ty + Math.sin((i * Math.PI) / 8) * radius))
          return false;
      return true;
    };
    for (
      let ty = Math.max(radius + 1, y - 30);
      ty <= Math.min(y + 58, renderer.state.waterY - radius - 4);
      ty++
    ) {
      if (!clearAt(ty)) continue;
      const support = !clearAt(ty + 1) || !clearAt(ty + 2);
      if (
        support &&
        !renderer.state.worms.some(
          (w) => w.hp > 0 && w.id !== worm.id && Math.hypot(w.x - x, w.y - ty) < radius * 2.5,
        )
      )
        return { x, y: ty, valid: true };
    }
    return result(false);
  }
  if (renderer.view.weapon === 'girder') {
    const half = CONFIG.girderWidth / 2,
      h = CONFIG.girderHeight / 2;
    if (
      Math.hypot(x - worm.x, y - worm.y) > CONFIG.girderRange ||
      x - half < 0 ||
      x + half >= WORLD_W ||
      y - h < 0 ||
      y + h >= renderer.state.waterY - 2
    )
      return result(false);
    for (let sy = Math.floor(y - h) - 2; sy <= Math.ceil(y + h) + 2; sy++)
      for (let sx = Math.floor(x - half) - 2; sx <= Math.ceil(x + half) + 2; sx++)
        if (solid(sx, sy)) return result(false);
    const objects = [
      ...renderer.state.worms.filter((w) => w.hp > 0),
      ...(renderer.state.projectiles || []),
      ...(renderer.state.mines || []),
      ...(renderer.state.crates || []),
    ];
    return result(
      !objects.some((o) => Math.abs(o.x - x) < half + radius + 2 && Math.abs(o.y - y) < h + radius + 2),
    );
  }
  return result(true);
}

export function targetIsPossible(renderer, x, y) {
  return renderer.targetPreview(x, y).valid;
}
