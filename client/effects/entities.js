import { Container, Graphics, Text } from 'pixi.js';
import { createMineArt, createCrateArt } from '../art/weapons.js';
import { clamp } from './primitives.js';

export function updateMines(renderer, mines, now, positionFn, options = {}) {
  const present = new Set();
  for (const mine of mines || []) {
    present.add(mine.id);
    let visual = renderer.mines.get(mine.id);
    if (!visual) {
      const node = new Container();
      const body = createMineArt();
      const fuseBack = new Graphics().roundRect(-14, -7, 28, 14, 4).fill({ color: 0x203542, alpha: 0.93 });
      fuseBack.position.set(0, -18);
      const fuse = new Text({
        text: '',
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 10, fontWeight: '800', fill: 0xffd8a1 },
        resolution: 2,
      });
      fuse.anchor.set(0.5);
      fuse.position.set(0, -18);
      node.addChild(body, fuseBack, fuse);
      renderer.projectileLayer.addChild(node);
      visual = { node, light: body.parts.light, fuse, fuseBack, armed: !!mine.armed };
      renderer.mines.set(mine.id, visual);
    }
    const point = positionFn ? positionFn(mine, now) : mine;
    visual.node.position.set(point.x, point.y);
    const triggering = Number.isFinite(mine.fuse);
    visual.light.tint = triggering ? 0xff8b60 : mine.armed ? 0xc8e18c : 0xb0b8a2;
    visual.light.alpha = options.reducedMotion
      ? 1
      : triggering
        ? 0.6 + Math.sin(now / 52) * 0.4
        : mine.armed
          ? 0.8 + Math.sin(now / 310) * 0.2
          : 0.5;
    const text = triggering ? Math.max(0, mine.fuse).toFixed(1) : '';
    if (visual.fuse.text !== text) visual.fuse.text = text;
    visual.fuse.visible = visual.fuseBack.visible = triggering;
    if (!visual.armed && mine.armed) {
      renderer.spawn(
        'ring',
        now,
        options,
        {
          x: point.x,
          y: point.y,
          color: 0xd8eaa1,
          size: 5,
          endSize: options.reducedMotion ? 11 : 19,
          aspectY: 0.38,
          life: 350,
          alpha: 0.75,
        },
        true,
      );
      if (!options.reducedMotion)
        for (const sign of [-1, 1])
          renderer.spawn(
            'spark',
            now,
            options,
            {
              x: point.x + sign * 5,
              y: point.y - 4,
              color: 0xe5edb4,
              size: 3,
              endSize: 0.2,
              vx: sign * 18,
              vy: -17,
              rotation: sign * 0.8,
              life: 220,
              alpha: 0.85,
            },
            true,
          );
    }
    visual.armed = !!mine.armed;
  }
  for (const [id, visual] of renderer.mines) {
    if (present.has(id)) continue;
    visual.node.destroy({ children: true });
    renderer.mines.delete(id);
  }
}

export function updateCrates(renderer, crates, now, positionFn, options = {}) {
  const present = new Set();
  for (const crate of crates || []) {
    present.add(crate.id);
    let visual = renderer.crates.get(crate.id);
    if (!visual) {
      const node = createCrateArt();
      renderer.projectileLayer.addChild(node);
      visual = {
        node,
        swing: node.parts.swing,
        chute: node.parts.chute,
        parachute: !!crate.parachute,
        foldAt: null,
        phase: renderer.crates.size * 1.7,
      };
      renderer.crates.set(crate.id, visual);
    }
    const point = positionFn ? positionFn(crate, now) : crate;
    visual.node.position.set(point.x, point.y);
    if (visual.parachute && !crate.parachute) visual.foldAt = now;
    visual.parachute = !!crate.parachute;
    // The canopy folds over a quarter second once the authoritative crate has landed.
    const folded =
      visual.foldAt !== null ? clamp((now - visual.foldAt) / 260, 0, 1) : crate.parachute ? 0 : 1;
    visual.chute.visible = folded < 1;
    visual.chute.alpha = 1 - folded;
    visual.chute.scale.set(1 - folded * 0.6, 1 - folded);
    visual.swing.rotation =
      crate.parachute && !options.reducedMotion ? Math.sin(now / 540 + visual.phase) * 0.09 : 0;
  }
  for (const [id, visual] of renderer.crates) {
    if (present.has(id)) continue;
    visual.node.destroy({ children: true });
    renderer.crates.delete(id);
  }
}

export function updateWorms(renderer, worms, now, positionFn, options = {}) {
  const present = new Set();
  for (const worm of worms || []) {
    if (worm.hp <= 0 || (!worm.rope && !worm.jetpack)) continue;
    present.add(worm.id);
    let visual = renderer.wormTools.get(worm.id);
    if (!visual) {
      const node = new Container();
      const hook = new Graphics()
        .moveTo(-8, 0)
        .lineTo(5, 0)
        .stroke({ color: 0x243b45, width: 4.5, cap: 'round' })
        .moveTo(-8, 0)
        .lineTo(5, 0)
        .stroke({ color: 0xc5d4cc, width: 2.1, cap: 'round' })
        .moveTo(1, -1)
        .quadraticCurveTo(9, -8, 7, -10)
        .lineTo(3, -8)
        .moveTo(1, 1)
        .quadraticCurveTo(9, 8, 7, 10)
        .lineTo(3, 8)
        .stroke({ color: 0x253d49, width: 3.2, cap: 'round' })
        .moveTo(1, -1)
        .quadraticCurveTo(9, -8, 7, -10)
        .moveTo(1, 1)
        .quadraticCurveTo(9, 8, 7, 10)
        .stroke({ color: 0xccd7c8, width: 1.4, cap: 'round' })
        .circle(-7, 0, 2.7)
        .fill(0xdfc183)
        .stroke({ color: 0x354c4d, width: 1 });
      node.addChild(hook);
      renderer.projectileLayer.addChild(node);
      visual = { node, hook, lastTrail: now - 140 };
      renderer.wormTools.set(worm.id, visual);
    }
    const point = positionFn ? positionFn(worm, now) : worm;
    visual.hook.visible = !!worm.rope;
    if (worm.rope) {
      visual.node.position.set(worm.rope.x, worm.rope.y);
      visual.hook.rotation = Math.atan2(worm.rope.y - point.y, worm.rope.x - point.x);
    }
    const exhaust = options.actors?.get(worm.id)?.jetExhaust;
    const throttle =
      exhaust?.power ??
      clamp(0.38 + Math.max(0, -(worm.thrustY || 0)) * 0.52 + Math.abs(worm.thrustX || 0) * 0.2, 0.18, 1.1);
    const interval =
      (options.reducedMotion ? 150 : options.quality === 'low' ? 110 : 65) / (0.65 + throttle * 0.5);
    if (worm.jetpack && worm.fuel > 0 && !worm.grounded && now - visual.lastTrail >= interval) {
      const face = worm.facing === -1 ? -1 : 1;
      const count = options.quality === 'low' || options.reducedMotion ? 1 : 2;
      for (let i = 0; i < count; i++)
        renderer.spawn('cloud', now, options, {
          x: (exhaust?.x ?? point.x - face * 11) + i * face * 2,
          y: exhaust?.y ?? point.y + 9,
          color: worm.fuel < 1 ? 0xaab6b2 : 0xc8e1df,
          size: 1.5 + throttle,
          endSize: options.reducedMotion ? 3.5 : 4 + throttle * 3,
          vx: (exhaust?.dx || 0) * (15 + throttle * 30) - (worm.vx || 0) * 0.04,
          vy: options.reducedMotion ? 9 : (exhaust?.dy ?? 1) * (15 + throttle * 30),
          life: options.reducedMotion ? 200 : 300 + throttle * 70,
          alpha: 0.16 + throttle * 0.13,
        });
      visual.lastTrail = now;
    }
  }
  for (const [id, visual] of renderer.wormTools) {
    if (present.has(id)) continue;
    visual.node.destroy({ children: true });
    renderer.wormTools.delete(id);
  }
}
