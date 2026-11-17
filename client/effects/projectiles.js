import { Container, Graphics, Text } from 'pixi.js';
import { createClusterArt, createDynamiteArt } from '../art/weapons.js';
import { PIXI_PROJECTILE_KINDS, TAU, clamp, noise, COLORS } from './primitives.js';

export function makeProjectile(renderer, kind, now) {
  const node = new Container();
  const model = new Container();
  node.addChild(model);
  const rocket = kind === 'bazooka' || kind === 'rocket';
  let flame, core, glow, fuse, fuseBack, ember;
  let emberPoint = { x: -8, y: -12 };
  if (rocket) {
    // A soft additive glow behind the exhaust lets the flame light its own smoke.
    glow = new Graphics().circle(0, 0, 9).fill({ color: 0xffa64d, alpha: 0.6 });
    glow.blendMode = 'add';
    glow.position.set(-12, 0);
    flame = new Graphics().poly([-8, -4.2, -18, -6, -34, 0, -18, 6, -8, 4.2]).fill(0xf8993e);
    core = new Graphics().poly([-8, -2.6, -16, -3.2, -25, 0, -16, 3.2, -8, 2.6]).fill(0xffe7a0);
    model.addChild(glow, flame, core);
    const body = new Graphics()
      .poly([-10, -5, 5, -5, 13, 0, 5, 5, -10, 5])
      .fill(0xe5e4cb)
      .stroke({ color: 0x263c47, width: 1.5 })
      .poly([3, -5, 5, -5, 13, 0, 5, 5, 3, 5])
      .fill(0xe77e57)
      .poly([-11, -4, -16, -9, -6, -5])
      .fill(0x587484)
      .stroke({ color: 0x263c47, width: 1 })
      .poly([-11, 4, -16, 9, -6, 5])
      .fill(0x587484)
      .stroke({ color: 0x263c47, width: 1 })
      .rect(-9, -4, 3, 8)
      .fill(0x405e6d)
      .rect(-4, -3.7, 7, 1.8)
      .fill(0xfff8e3)
      .rect(-4, 2, 7, 2)
      .fill(0xa6b5ac)
      .circle(0, -0.2, 0.8)
      .fill(0x51636a);
    model.addChild(body);
  } else if (kind === 'airstrike') {
    const body = new Graphics()
      .poly([-8, -4, -19, -8, -17, 0, -19, 8, -8, 4])
      .fill(0x617a88)
      .stroke({ color: 0x243b47, width: 1.4 })
      .ellipse(1, 0, 13, 7)
      .fill(0x70835a)
      .stroke({ color: 0x233d3e, width: 1.5 })
      .ellipse(6, -1.2, 6, 4.3)
      .fill(0x9da273)
      .rect(-3, -6.5, 3.7, 13)
      .fill(0xe6bd69)
      .moveTo(-7, -3.4)
      .lineTo(6, -3.4)
      .stroke({ color: 0xcbd6ae, width: 1.2 })
      .poly([-19, -8, -23, -8, -23, 8, -19, 8, -17, 0])
      .stroke({ color: 0xa4b6b6, width: 1.8 })
      .circle(12.5, 0, 1.8)
      .fill(0x435761);
    model.addChild(body);
  } else if (kind === 'cluster' || kind === 'dynamite') {
    const body = kind === 'cluster' ? createClusterArt({ pin: false }) : createDynamiteArt();
    model.addChild(body);
    ember = body.parts.ember;
    ember.visible = true;
    if (body.parts.lever) body.parts.lever.visible = false;
    emberPoint = kind === 'cluster' ? { x: 0, y: -8.5 } : { x: 5.7, y: -10 };
  } else if (kind === 'fragment') {
    const body = new Graphics()
      .roundRect(-4.3, -5.6, 8.6, 11.2, 3)
      .fill(0xdd9d4f)
      .stroke({ color: 0x503d34, width: 1.2 })
      .roundRect(-2.9, -4.5, 1.9, 8.5, 0.6)
      .fill(0xffd788)
      .rect(-4, -1.4, 8, 2.8)
      .fill(0x657d72)
      .roundRect(-2, -7.3, 4, 2.4, 0.5)
      .fill(0x354e51);
    ember = new Graphics().star(0, -8, 4, 1.8, 0.6).fill(0xffdf8c);
    emberPoint = { x: 0, y: -8 };
    model.addChild(body, ember);
  } else {
    const body = new Graphics()
      .ellipse(0, 1, 7.3, 8.6)
      .fill(0x4c6b49)
      .stroke({ color: 0x213c38, width: 1.5 })
      .roundRect(-4.5, -5.8, 3.5, 3.8, 0.8)
      .fill(0xa0b46c)
      .roundRect(0.2, -5.8, 3.5, 3.8, 0.8)
      .fill(0x809b59)
      .roundRect(-5.7, -0.8, 4.4, 4, 0.8)
      .fill(0x90a760)
      .roundRect(0, -0.8, 4.8, 4, 0.8)
      .fill(0x6d8c4e)
      .roundRect(-4.2, 4.3, 3.2, 3.1, 0.7)
      .fill(0x7a9853)
      .roundRect(0.2, 4.3, 3, 3.1, 0.7)
      .fill(0x648247)
      .roundRect(-3, -10, 6, 3.6, 0.7)
      .fill(0x59727a)
      .stroke({ color: 0x263e43, width: 1 })
      .poly([-1, -11, 5, -10, 8, 1, 6.2, 1, 3.4, -8, -1, -8])
      .fill(0xc6cbb4)
      .stroke({ color: 0x30474d, width: 0.9 })
      .moveTo(-1, -10)
      .quadraticCurveTo(-5, -15, -8, -12)
      .stroke({ color: 0xc9b58e, width: 1.6 });
    ember = new Graphics().star(0, 0, 4, 3, 1.1).fill(0xffd36c);
    ember.position.set(-8, -12);
    model.addChild(body, ember);
  }
  // Short-lived bomblets keep their fuse spark, but five overlapping countdown
  // labels would hide their spread and the terrain under the cluster burst.
  if (!rocket && kind !== 'airstrike' && kind !== 'fragment') {
    fuseBack = new Graphics().roundRect(-16, -7.5, 32, 15, 5).fill({ color: 0x203542, alpha: 0.94 });
    fuseBack.position.set(0, -27);
    fuse = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fontWeight: '800', fill: 0xfff2d1 },
      resolution: 2,
    });
    fuse.anchor.set(0.5);
    fuse.position.set(0, -27);
    node.addChild(fuseBack, fuse);
  }
  renderer.projectileLayer.addChild(node);
  return {
    node,
    model,
    flame,
    core,
    glow,
    fuse,
    fuseBack,
    ember,
    emberPoint,
    kind,
    start: now,
    lastTrail: now - 80,
    lastSpark: now,
    lastBounce: -Infinity,
    trailDebt: 0,
    vx: 0,
    vy: 0,
    previousX: null,
    previousY: null,
    spin: 0,
  };
}

export function updateProjectiles(renderer, projectiles, now, positionFn, options = {}) {
  const present = new Set();
  for (const projectile of projectiles || []) {
    const kind = projectile.kind || projectile.weapon;
    if (!PIXI_PROJECTILE_KINDS.includes(kind)) continue;
    present.add(projectile.id);
    let visual = renderer.projectiles.get(projectile.id);
    if (!visual || visual.kind !== kind) {
      if (visual) visual.node.destroy({ children: true });
      visual = renderer.makeProjectile(kind, now);
      renderer.projectiles.set(projectile.id, visual);
    }
    const point = positionFn ? positionFn(projectile, now) : projectile;
    visual.node.position.set(point.x, point.y);
    const vx = projectile.vx || 0,
      vy = projectile.vy || 0;
    const angle = Math.atan2(vy, vx || 0.001);
    if (kind === 'bazooka' || kind === 'rocket' || kind === 'airstrike') {
      visual.model.rotation = angle;
      const flicker = options.reducedMotion ? 0.82 : 0.9 + Math.sin(now * 0.066) * 0.15;
      // The exhaust stretches with speed, so a full-power shot reads faster than a lob.
      const stretch = kind === 'airstrike' ? 1 : clamp(0.75 + Math.hypot(vx, vy) / 850, 0.75, 1.5);
      if (visual.flame) visual.flame.scale.set(flicker * stretch, 0.8 + flicker * 0.2);
      if (visual.core) visual.core.scale.set((0.85 + flicker * 0.25) * stretch, 1);
      if (visual.glow) {
        visual.glow.scale.set(0.8 + flicker * 0.35);
        visual.glow.alpha = 0.35 + flicker * 0.3;
      }
      const interval = options.reducedMotion
        ? 120
        : options.quality === 'low'
          ? 70
          : kind === 'airstrike'
            ? 55
            : 28;
      if (kind !== 'airstrike' && !options.reducedMotion)
        renderer.rocketTrail(visual, point, angle, now, options);
      else if (now - visual.lastTrail >= interval) {
        const age = (now - visual.start) / 1000;
        renderer.spawn('cloud', now, options, {
          x: point.x - Math.cos(angle) * 15,
          y: point.y - Math.sin(angle) * 15,
          color: kind === 'airstrike' ? 0xc9d7d5 : 0xe5dfc7,
          size: kind === 'airstrike' ? 1.7 : 2.5,
          endSize: options.reducedMotion ? 4.5 : kind === 'airstrike' ? 5 : 9,
          life: options.reducedMotion ? 170 : kind === 'airstrike' ? 280 : 480,
          alpha: kind === 'airstrike' ? 0.2 : 0.28,
          vx: -vx * 0.035,
          vy: -vy * 0.035 - (options.reducedMotion ? 0 : 8),
          rotation: age * 3,
        });
        visual.lastTrail = now;
      }
    } else {
      const delta =
        visual.previousX == null ? 0 : Math.hypot(point.x - visual.previousX, point.y - visual.previousY);
      if (!options.reducedMotion && kind !== 'dynamite')
        visual.spin += Math.min(delta, 35) * (kind === 'fragment' ? 0.065 : 0.045) * (vx < 0 ? -1 : 1);
      if (kind === 'dynamite') visual.spin = options.reducedMotion ? 0 : clamp(vx * 0.004, -0.2, 0.2);
      visual.model.rotation = visual.spin;
      if (kind === 'grenade') {
        visual.ember.scale.set(options.reducedMotion ? 0.85 : 0.8 + Math.sin(now * 0.042) * 0.25);
        visual.ember.rotation = options.reducedMotion ? 0 : now * 0.012;
      } else visual.ember.alpha = options.reducedMotion ? 1 : 0.7 + Math.sin(now * 0.042) * 0.3;
      if (visual.fuse) {
        const fuseText = Number.isFinite(projectile.fuse) ? Math.max(0, projectile.fuse).toFixed(1) : '';
        if (visual.fuse.text !== fuseText) visual.fuse.text = fuseText;
        visual.fuse.visible = visual.fuseBack.visible = !!fuseText;
        visual.fuse.tint = projectile.fuse < 1 ? 0xffaa7a : 0xffffff;
      }
      if (!options.reducedMotion && now - visual.lastSpark > (options.quality === 'low' ? 160 : 95)) {
        const a = visual.spin;
        const ex = visual.emberPoint.x,
          ey = visual.emberPoint.y;
        renderer.spawn(
          'spark',
          now,
          options,
          {
            x: point.x + ex * Math.cos(a) - ey * Math.sin(a),
            y: point.y + ex * Math.sin(a) + ey * Math.cos(a),
            color: 0xffd270,
            size: 1.9,
            endSize: 0.1,
            life: 180,
            vx: -vx * 0.04,
            vy: -20,
            gravity: 65,
            rotation: a,
          },
          true,
        );
        visual.lastSpark = now;
      }
      const bounced = (visual.vy > 45 && vy < -20) || (Math.abs(visual.vx) > 50 && visual.vx * vx < 0);
      if (bounced && now - visual.lastBounce > 130 && !options.reducedMotion) {
        visual.lastBounce = now;
        renderer.spawn(
          'ring',
          now,
          options,
          { x: point.x, y: point.y + 5, color: 0xf3dfaa, size: 4, endSize: 14, life: 180, alpha: 0.55 },
          true,
        );
        for (let i = 0; i < (options.quality === 'low' ? 2 : 4); i++) {
          renderer.spawn('cloud', now, options, {
            x: point.x,
            y: point.y + 5,
            color: (COLORS[options.mapId] || COLORS.hills).dust,
            size: 1.5,
            endSize: 4,
            life: 250,
            alpha: 0.35,
            vx: (i % 2 ? -1 : 1) * (15 + i * 4),
            vy: -16 - i * 3,
          });
        }
      }
    }
    visual.previousX = point.x;
    visual.previousY = point.y;
    visual.vx = vx;
    visual.vy = vy;
  }
  for (const [id, visual] of renderer.projectiles) {
    if (present.has(id)) continue;
    visual.node.destroy({ children: true });
    renderer.projectiles.delete(id);
  }
}

export function rocketTrail(renderer, visual, point, angle, now, options) {
  const low = options.quality === 'low',
    spacing = low ? 14 : 9;
  const wind = Number.isFinite(options.wind) ? options.wind : 0;
  const dx = Math.cos(angle),
    dy = Math.sin(angle),
    px = -dy,
    py = dx;
  const puff = (ex, ey) => {
    const n = noise(++renderer.serial),
      m = noise(renderer.serial * 1.37 + 5);
    const sx = ex - dx * 15,
      sy = ey - dy * 15;
    renderer.spawn('cloud', now, options, {
      x: sx,
      y: sy,
      color: n < 0.3 ? 0xefe6d3 : 0xdcd8c8,
      endColor: m < 0.4 ? 0x7a8381 : 0x949c98,
      size: 3 + n * 1.5,
      endSize: low ? 8 + m * 4 : 11 + m * 5,
      life: low ? 800 + n * 300 : 1250 + n * 450,
      alpha: 0.55,
      mode: 'smoke',
      vx: -dx * (16 + n * 34) + px * (m - 0.5) * 46,
      vy: -dy * (16 + n * 34) + py * (m - 0.5) * 46,
      drag: 3.2,
      driftX: wind * 1.1,
      driftY: -7,
      rotation: n * TAU,
      spin: (m - 0.5) * 1.6,
    });
    if (!low && renderer.serial % 2 === 0)
      renderer.spawn(
        'disc',
        now,
        options,
        {
          x: sx,
          y: sy,
          color: 0xffb257,
          size: 3.4,
          endSize: 0.6,
          life: 120,
          alpha: 0.55,
          mode: 'flash',
          blend: 'add',
        },
        true,
      );
    if (renderer.serial % (low ? 9 : 5) === 0)
      renderer.spawn(
        'spark',
        now,
        options,
        {
          x: sx,
          y: sy,
          color: 0xffd98a,
          endColor: 0xff7a3c,
          size: 2.2,
          endSize: 0.2,
          vx: -dx * (40 + n * 60) + px * (m - 0.5) * 70,
          vy: -dy * (40 + n * 60) + py * (m - 0.5) * 70,
          gravity: 160,
          drag: 1.2,
          life: 300 + n * 200,
          alpha: 0.9,
          rotation: angle + (m - 0.5) * 0.6,
          spin: (n - 0.5) * 8,
          blend: 'add',
        },
        true,
      );
  };
  if (visual.previousX == null) {
    puff(point.x, point.y);
    visual.trailDebt = 0;
    return;
  }
  const fromX = visual.previousX,
    fromY = visual.previousY;
  const travel = Math.hypot(point.x - fromX, point.y - fromY);
  let at = spacing - visual.trailDebt,
    placed = 0;
  while (at <= travel && placed < 6) {
    const f = travel > 0 ? at / travel : 0;
    puff(fromX + (point.x - fromX) * f, fromY + (point.y - fromY) * f);
    at += spacing;
    placed++;
  }
  visual.trailDebt = Math.min(spacing, travel - (at - spacing));
}
