import { TAU, clamp, TEAM_MARKS, TEAM_COLORS, FLAG_W, circle, rounded, polygon } from './primitives.js';

export function drawWorm(renderer, ctx, worm, time) {
  const p = renderer.position(worm, time);
  worm = renderer.displayWorm(worm);
  const active = worm.id === renderer.state.turn?.wormId;
  const moving = Math.abs(worm.vx || 0) > 8 && worm.grounded;
  const wiggle = renderer.view.reducedMotion
    ? 0
    : Math.sin(time / (moving ? 55 : 400) + worm.x) * (moving ? 1.8 : 0.45);
  if (worm.rope) {
    ctx.strokeStyle = '#132d39';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 2);
    ctx.lineTo(worm.rope.x, worm.rope.y);
    ctx.stroke();
    ctx.strokeStyle = '#f6df9d';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    circle(ctx, worm.rope.x, worm.rope.y, 3, '#f6df9d');
  }
  ctx.save();
  ctx.translate(p.x, p.y);
  const face =
    active && renderer.view.playerId === renderer.state.turn?.playerId && renderer.view.facing
      ? renderer.view.facing
      : worm.facing === -1
        ? -1
        : 1;
  ctx.scale(face, 1);
  if (worm.jetpack) {
    rounded(ctx, -14, -8, 8, 16, 3);
    ctx.fillStyle = '#536673';
    ctx.fill();
    ctx.strokeStyle = '#1e3242';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (worm.fuel > 0 && !worm.grounded) {
      const flame = renderer.view.reducedMotion ? 13 : 11 + Math.sin(time / 40) * 6;
      polygon(
        ctx,
        [
          [-13, 8],
          [-7, 8],
          [-10, 8 + flame],
        ],
        '#f4cb64',
      );
      polygon(
        ctx,
        [
          [-12, 8],
          [-8, 8],
          [-10, 15],
        ],
        '#f28065',
      );
    }
  }
  ctx.strokeStyle = '#553e41';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = '#f3b497';
  ctx.beginPath();
  ctx.moveTo(-10, 9);
  ctx.bezierCurveTo(-14, 3, -9, 1, -7, -4);
  ctx.bezierCurveTo(-6 + wiggle, -16, 8 + wiggle, -16, 10, -5);
  ctx.bezierCurveTo(11, 1, 6, 3, 5, 6);
  ctx.bezierCurveTo(3, 10, 9, 10, 10, 11);
  ctx.bezierCurveTo(3, 14, -6, 13, -10, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#ce8c7d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-9, 5);
  ctx.lineTo(-1, 7);
  ctx.moveTo(-10, 8);
  ctx.lineTo(-3, 10);
  ctx.stroke();
  // A knotted headband makes each player recognizable even without a nameplate.
  ctx.fillStyle = worm.color || '#f3cb66';
  ctx.beginPath();
  ctx.moveTo(-7, -9);
  ctx.quadraticCurveTo(1, -15, 10, -8);
  ctx.lineTo(10, -4);
  ctx.quadraticCurveTo(2, -9, -7, -5);
  ctx.closePath();
  ctx.fill();
  polygon(
    ctx,
    [
      [-7, -8],
      [-17, -10 - wiggle],
      [-13, -4],
      [-7, -5],
    ],
    worm.color || '#f3cb66',
  );
  ctx.fillStyle = '#fff7e4';
  ctx.beginPath();
  ctx.ellipse(6, -3, 4, 4.6, -0.2, 0, TAU);
  ctx.fill();
  circle(ctx, 7.5, -2.7, 1.65, '#1d2d38');
  ctx.strokeStyle = '#774e47';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(5, 4);
  ctx.quadraticCurveTo(8, 5.5, 10, 2.5);
  ctx.stroke();
  if (active && renderer.view.playerId === renderer.state.turn?.playerId && !renderer.view.targeting) {
    const angle = renderer.view.angle;
    ctx.save();
    ctx.scale(face, 1);
    ctx.rotate(angle);
    ctx.fillStyle = renderer.view.weapon === 'bat' ? '#c9a36c' : '#36566a';
    rounded(ctx, 6, -3, renderer.view.weapon === 'bat' ? 25 : 20, 6, 2);
    ctx.fill();
    ctx.fillStyle = '#172c3a';
    ctx.fillRect(23, -4, 4, 8);
    ctx.restore();
  }
  ctx.restore();
}

export function drawMine(renderer, ctx, mine, time) {
  ctx.fillStyle = '#253a43';
  ctx.beginPath();
  ctx.ellipse(mine.x, mine.y + 2, 8, 4, 0, 0, TAU);
  ctx.fill();
  rounded(ctx, mine.x - 5, mine.y - 3, 10, 5, 2);
  ctx.fillStyle = '#7f8e68';
  ctx.fill();
  circle(
    ctx,
    mine.x,
    mine.y - 3,
    2,
    mine.fuse != null
      ? '#ff8b69'
      : mine.armed
        ? Math.sin(time / 220) > 0
          ? '#f5cf73'
          : '#8d594f'
        : '#c6cc9f',
  );
  if (mine.fuse != null) {
    ctx.fillStyle = '#f8eed0';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(Math.max(0, mine.fuse).toFixed(1), mine.x, mine.y - 13);
  }
}

export function drawCrate(renderer, ctx, crate, time) {
  const p = renderer.position(crate, time);
  ctx.save();
  ctx.translate(p.x, p.y);
  if (crate.parachute) {
    // The chute and the box swing together around the canopy, like the Pixi art.
    const sway = renderer.view.reducedMotion ? 0 : Math.sin(time / 540 + p.x) * 0.09;
    ctx.translate(0, -30);
    ctx.rotate(sway);
    ctx.translate(0, 30);
    ctx.beginPath();
    ctx.moveTo(-19, -24);
    ctx.arc(0, -24, 19, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = '#e77c67';
    ctx.fill();
    ctx.fillStyle = '#fff5db';
    for (const [from, to] of [
      [0.5, 0.95],
      [1.35, 1.8],
      [2.2, 2.65],
    ]) {
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.arc(0, -24, 19, Math.PI + from, Math.PI + to);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(-19, -24);
    ctx.arc(0, -24, 19, Math.PI, 0);
    ctx.closePath();
    ctx.strokeStyle = '#352e38';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.fillStyle = '#9c585d';
    ctx.fillRect(-19, -25.4, 38, 1.9);
    ctx.strokeStyle = '#223542';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (const [x, tx] of [
      [-18.5, -7],
      [-7, -5.5],
      [7, 5.5],
      [18.5, 7],
    ]) {
      ctx.moveTo(x, -23.6);
      ctx.lineTo(tx, -8);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#35303848';
  ctx.beginPath();
  ctx.ellipse(0, 8.6, 9.5, 3, 0, 0, TAU);
  ctx.fill();
  rounded(ctx, -8, -8, 16, 16, 1.8);
  ctx.fillStyle = '#be895f';
  ctx.fill();
  ctx.strokeStyle = '#352e38';
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.fillStyle = '#ffd5b3';
  ctx.fillRect(-7, -6.6, 14, 1);
  ctx.fillStyle = '#9c585d';
  ctx.fillRect(-7, -3, 14, 1.3);
  ctx.fillRect(-7, 1.9, 14, 1.3);
  ctx.fillStyle = '#617c7b';
  ctx.fillRect(-5.4, -8, 1.7, 16);
  ctx.fillRect(3.7, -8, 1.7, 16);
  rounded(ctx, -3.4, -3.4, 6.8, 6.8, 1);
  ctx.fillStyle = '#fff5db';
  ctx.fill();
  polygon(
    ctx,
    Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 ? 1.3 : 2.9,
        a = -Math.PI / 2 + (i * Math.PI) / 5;
      return [Math.cos(a) * r, 0.2 + Math.sin(a) * r];
    }),
    '#e1b668',
  );
  ctx.restore();
}

export function drawProjectile(renderer, ctx, projectile, time) {
  const p = renderer.position(projectile, time),
    kind = projectile.kind || projectile.weapon;
  ctx.save();
  ctx.translate(p.x, p.y);
  if (['bazooka', 'airstrike', 'rocket'].includes(kind)) {
    ctx.rotate(Math.atan2(projectile.vy || 0, projectile.vx || 1));
    if (!renderer.view.reducedMotion)
      polygon(
        ctx,
        [
          [-8, -3],
          [-20 - Math.sin(time / 30) * 5, 0],
          [-8, 3],
        ],
        '#f4c66d',
      );
    polygon(
      ctx,
      [
        [-9, -4],
        [6, -4],
        [12, 0],
        [6, 4],
        [-9, 4],
      ],
      '#eef1dc',
    );
    ctx.fillStyle = '#db7866';
    ctx.fillRect(4, -4, 3, 8);
  } else if (kind === 'dynamite') {
    rounded(ctx, -8, -5, 16, 10, 2);
    ctx.fillStyle = '#e47564';
    ctx.fill();
    ctx.strokeStyle = '#71484c';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ebce91';
    ctx.fillRect(-2, -5, 4, 10);
    circle(ctx, 10, -7, 2, '#f7d371');
  } else {
    ctx.rotate(time / 170);
    circle(ctx, 0, 0, kind === 'fragment' ? 3 : 6, kind === 'cluster' ? '#f5bd65' : '#a5bc82');
    ctx.strokeStyle = '#223f45';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#334a4c';
    ctx.fillRect(-2, -9, 4, 4);
  }
  ctx.restore();
  if (projectile.fuse != null) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px system-ui';
    ctx.fillStyle = '#203542';
    rounded(ctx, p.x - 13, p.y - 27, 26, 15, 5);
    ctx.fill();
    ctx.fillStyle = '#fff2d1';
    ctx.fillText(Math.max(0, projectile.fuse).toFixed(1), p.x, p.y - 16);
  }
}

export function drawEffects(renderer, ctx, time) {
  renderer.effects = renderer.effects.filter((e) => time - e.start < e.life);
  for (const e of renderer.effects) {
    if (e.pixiHandled && renderer.pixi?.active) continue;
    const t = clamp((time - e.start) / e.life, 0, 1);
    ctx.save();
    ctx.globalAlpha = 1 - t;
    if (e.type === 'explosion') {
      const radius = e.radius * Math.min(1, t * 5);
      circle(ctx, e.x, e.y, radius, t < 0.4 ? '#f5cc74' : '#d18b7050');
      circle(ctx, e.x, e.y, radius * 0.7, t < 0.3 ? '#fff0c4' : '#f2bc7180');
      ctx.strokeStyle = '#fff2bc';
      ctx.lineWidth = 3;
      circle(ctx, e.x, e.y, e.radius * (0.5 + t * 0.7));
      ctx.stroke();
      if (!renderer.view.reducedMotion)
        for (let i = 0; i < (renderer.quality === 'low' ? 6 : 20); i++) {
          const a = i * 2.399,
            dist = e.radius * (0.5 + t * (1.5 + (i % 3) * 0.2));
          circle(
            ctx,
            e.x + Math.cos(a) * dist,
            e.y + Math.sin(a) * dist + t * t * 45,
            (1 - t) * (2 + (i % 4)),
            i % 2 ? '#ffc97a' : '#735b58',
          );
        }
    } else if (e.type === 'shot' && Number.isFinite(e.endX) && Number.isFinite(e.endY)) {
      ctx.strokeStyle = '#fff0b7';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.endX, e.endY);
      ctx.stroke();
      circle(ctx, e.endX, e.endY, 5 + t * 8, '#f7d08e');
    } else if (e.type === 'bat') {
      ctx.strokeStyle = '#ffe1a1';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 22 + t * 12, -0.9, 1.3);
      ctx.stroke();
    } else if (e.type === 'mineTrigger') {
      ctx.strokeStyle = '#f89a70';
      ctx.lineWidth = 2;
      circle(ctx, e.x, e.y, 10 + t * 20);
      ctx.stroke();
      ctx.font = 'bold 16px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff0c4';
      ctx.fillText('!', e.x, e.y - 14);
    } else if (e.type === 'teleport') {
      ctx.strokeStyle = '#b9e4ce';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y, 15 + t * 30, 25 + t * 12, 0, 0, TAU);
      ctx.stroke();
    } else if (e.text) {
      ctx.textAlign = 'center';
      ctx.font = '800 17px system-ui';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#233441';
      ctx.fillStyle = '#ffe7b3';
      const y = e.y - 24 - t * (renderer.view.reducedMotion ? 5 : 35);
      ctx.strokeText(e.text, e.x, y);
      ctx.fillText(e.text, e.x, y);
    } else {
      ctx.strokeStyle = '#fce7b4';
      ctx.lineWidth = 2;
      circle(ctx, e.x, e.y, 5 + t * 15);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function drawLabels(renderer, ctx, time) {
  const worms = renderer.state.worms
    .filter((w) => w.hp > 0)
    .sort(
      (a, b) => Number(b.id === renderer.state.turn?.wormId) - Number(a.id === renderer.state.turn?.wormId),
    );
  const occupied = [];
  const localTurn =
    renderer.state.phase === 'playing' && renderer.view.playerId === renderer.state.turn?.playerId;
  for (const worm of worms) {
    const active = worm.id === renderer.state.turn?.wormId;
    if (active && localTurn) continue;
    const p = renderer.screenPoint(renderer.position(worm, time));
    if (p.x < -10 || p.x > renderer.width + 10 || p.y < -30 || p.y > renderer.height + 30) continue;
    const player = renderer.state.players.find((p) => p.id === worm.playerId);
    const team = renderer.state.mode === 'ffa' ? renderer.state.players.indexOf(player) : worm.team;
    const mark = TEAM_MARKS[Math.max(0, team) % TEAM_MARKS.length];
    const flag =
      renderer.state.mode === 'ffa'
        ? worm.color || '#f4d275'
        : TEAM_COLORS[Math.max(0, worm.team || 0) % TEAM_COLORS.length];
    const text = `${mark} ${Math.ceil(worm.hp)}`;
    // The active plate names the worm first and its player underneath when they differ.
    const name = active ? String(worm.name || player?.name || '').slice(0, 14) : '';
    const ownerName = active ? String(worm.playerName || player?.name || '').slice(0, 14) : '';
    const owner = ownerName && ownerName !== name ? ownerName : '';
    ctx.font = `${active ? '800' : '700'} 11px system-ui`;
    const healthW = FLAG_W + ctx.measureText(text).width;
    let width = healthW + 15;
    if (name) width = Math.max(width, ctx.measureText(name).width + 16);
    if (owner) {
      ctx.font = '700 9.5px system-ui';
      width = Math.max(width, ctx.measureText(owner).width + 16);
    }
    const nameH = name ? 14 : 0,
      ownerH = owner ? 12 : 0;
    const height = 18 + nameH + ownerH;
    const left = clamp(p.x - width / 2, 5, renderer.width - width - 5);
    let top = p.y - 21 * renderer.camera.zoom - height - 4;
    let fits = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (
        !occupied.some(
          (b) =>
            left < b.x + b.w + 3 && left + width + 3 > b.x && top < b.y + b.h + 3 && top + height + 3 > b.y,
        )
      ) {
        fits = true;
        break;
      }
      top -= height + 3;
    }
    if (!fits || top < 5) continue;
    occupied.push({ x: left, y: top, w: width, h: height });
    ctx.fillStyle = active ? '#182c39' : '#203441df';
    rounded(ctx, left, top, width, height, 5);
    ctx.fill();
    if (active) {
      ctx.strokeStyle = worm.color || '#f4d275';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff4d8';
    if (name) {
      ctx.font = '800 11px system-ui';
      ctx.fillText(name, left + width / 2, top + 12);
    }
    if (owner) {
      ctx.font = '700 9.5px system-ui';
      ctx.fillStyle = '#fff4d8d1';
      ctx.fillText(owner, left + width / 2, top + nameH + 11);
    }
    // Health row: a pennant on a one-pixel pole, then the mark and the points, centred as one group.
    const rowLeft = left + (width - healthW) / 2,
      baseline = top + nameH + ownerH + 12.5;
    ctx.fillStyle = '#fff4d8d9';
    ctx.fillRect(rowLeft, baseline - 9, 1, 9);
    polygon(
      ctx,
      [
        [rowLeft + 1, baseline - 9],
        [rowLeft + 9, baseline - 6],
        [rowLeft + 1, baseline - 3],
      ],
      flag,
    );
    ctx.font = `${active ? '800' : '700'} 11px system-ui`;
    ctx.textAlign = 'left';
    ctx.fillStyle = active ? worm.color || '#f4d275' : '#fff4d8';
    ctx.fillText(text, rowLeft + FLAG_W, baseline);
    ctx.textAlign = 'center';
    if (active)
      polygon(
        ctx,
        [
          [p.x - 4, top + height + 3],
          [p.x + 4, top + height + 3],
          [p.x, top + height + 8],
        ],
        '#f3d276',
      );
  }
}

export function drawEdgeIndicator(renderer, ctx, time) {
  const worm = renderer.state.worms.find((w) => w.id === renderer.state.turn?.wormId && w.hp > 0);
  if (!worm) return;
  const p = renderer.screenPoint(renderer.position(worm, time));
  // A visible worm needs no indicator: on short mobile fields, an inner
  // margin would paint the arrow directly over the active character.
  if (p.x >= 0 && p.x <= renderer.width && p.y >= 0 && p.y <= renderer.height) return;
  const x = clamp(p.x, 26, renderer.width - 26),
    y = clamp(p.y, 26, renderer.height - 26);
  circle(ctx, x, y, 16, '#203441');
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(p.y - renderer.height / 2, p.x - renderer.width / 2));
  polygon(
    ctx,
    [
      [-5, -6],
      [7, 0],
      [-5, 6],
    ],
    '#f1ca6a',
  );
  ctx.restore();
}
