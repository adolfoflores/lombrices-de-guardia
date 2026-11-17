import test from 'node:test';
import assert from 'node:assert/strict';
import { WormActor } from '../client/pixi-character.js';

const base = () => ({
  id: 'motion:1',
  x: 100,
  y: 300,
  vx: 0,
  vy: 0,
  hp: 100,
  facing: 1,
  grounded: true,
  color: '#e4936e',
});
const difference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const axes = (actor) => {
  const p = actor.weaponRig.toGlobal({ x: 0, y: 0 });
  const x = actor.weaponRig.toGlobal({ x: 1, y: 0 });
  const y = actor.weaponRig.toGlobal({ x: 0, y: 1 });
  return { x: { x: x.x - p.x, y: x.y - p.y }, y: { x: y.x - p.x, y: y.y - p.y } };
};
const checkAim = (actor, angle) => {
  const a = axes(actor);
  assert.ok(Math.abs(difference(Math.atan2(a.x.y, a.x.x), angle)) < 1e-8, 'barrel follows the exact aim');
  assert.ok(Math.abs(Math.hypot(a.x.x, a.x.y) - 1) < 1e-8, 'barrel is not stretched');
  assert.ok(Math.abs(Math.hypot(a.y.x, a.y.y) - 1) < 1e-8, 'weapon keeps a uniform scale');
  assert.ok(Math.abs(a.x.x * a.y.x + a.x.y * a.y.y) < 1e-8, 'weapon axes stay perpendicular');
  return a;
};

test('weapon stays aligned and rigid while walking, jumping and landing in both directions', () => {
  for (const facing of [1, -1])
    for (const angle of facing === 1
      ? [-1.1, -0.4, 0, 0.5, Math.PI / 2]
      : [-2.7, -Math.PI, 2.3, -Math.PI / 2]) {
      const worm = { ...base(), facing };
      const actor = new WormActor(worm);
      try {
        for (let i = 0; i < 80; i++) {
          const airborne = i >= 30 && i < 50;
          const snapshot = {
            ...worm,
            x: worm.x + facing * i * 1.5,
            vx: facing * 94,
            grounded: !airborne,
            vy: airborne ? (i < 40 ? -180 : 190) : 0,
          };
          actor.update(snapshot, {
            now: 1000 + i * 16,
            dt: 0.016,
            active: true,
            local: true,
            angle,
            weapon: 'bazooka',
          });
          checkAim(actor, angle);
        }
      } finally {
        actor.destroy({ children: true });
      }
    }
});

test('tool remains upright even while a stale body snapshot faces away from the aim', () => {
  const actor = new WormActor(base());
  try {
    for (const facing of [-1, 1])
      for (const angle of [-Math.PI / 4, (-Math.PI * 3) / 4, Math.PI / 4, (Math.PI * 3) / 4]) {
        actor.update(
          { ...base(), facing },
          { now: 2000, active: true, local: true, angle, weapon: 'bazooka', reducedMotion: true },
        );
        const a = checkAim(actor, angle);
        assert.ok(a.y.y > 0, 'grip remains below the barrel on either aim hemisphere');
      }
  } finally {
    actor.destroy({ children: true });
  }
});

test('local aim and facing override apply immediately while the body finishes its compact turn', () => {
  const actor = new WormActor(base());
  const options = { active: true, local: true, weapon: 'bazooka', dt: 0.016 };
  try {
    actor.update(base(), { ...options, now: 1000, facing: 1, angle: -0.6 });
    actor.update(base(), { ...options, now: 1016, facing: -1, angle: -Math.PI + 0.6 });
    assert.equal(actor.requestedFacing, -1);
    assert.equal(
      actor.visualFacing,
      1,
      'body starts a brief turn instead of disappearing through scale zero',
    );
    checkAim(actor, -Math.PI + 0.6);
    for (const now of [1032, 1048, 1064, 1080, 1096, 1112, 1140]) {
      actor.update(base(), { ...options, now, facing: -1, angle: -Math.PI + 0.6 });
      assert.ok(Math.abs(actor.rig.scale.x) >= 0.75);
      checkAim(actor, -Math.PI + 0.6);
    }
    assert.equal(actor.visualFacing, -1);
    actor.update(base(), { ...options, now: 1156, facing: -1, angle: -Math.PI + 0.2 });
    checkAim(actor, -Math.PI + 0.2);
  } finally {
    actor.destroy({ children: true });
  }
});

test('remote aim interpolates through the short angular arc without delaying local aim', () => {
  const worm = { ...base(), facing: -1 };
  const actor = new WormActor(worm);
  const before = Math.PI - 0.04,
    after = -Math.PI + 0.04;
  try {
    actor.update(worm, { now: 1000, active: true, angle: before, weapon: 'bazooka' });
    actor.update(worm, { now: 1016, dt: 0.016, active: true, angle: after, weapon: 'bazooka' });
    const progress = difference(actor.displayAim, before);
    assert.ok(progress > 0 && progress < 0.08, 'remote takes a small step across ±pi');
    assert.ok(Math.abs(difference(actor.displayAim, after)) > 0.01, 'remote is interpolated');
    actor.update(worm, { now: 1032, dt: 0.016, active: true, local: true, angle: after, weapon: 'bazooka' });
    assert.ok(Math.abs(difference(actor.displayAim, after)) < 1e-10, 'local input has no interpolation lag');
  } finally {
    actor.destroy({ children: true });
  }
});

test('back jump has a distinct deterministic tuck and keeps the accepted takeoff facing', () => {
  const forward = new WormActor(base()),
    back = new WormActor(base()),
    repeat = new WormActor(base());
  try {
    const common = { type: 'jump', wormId: base().id, facing: 1, vx: -80, vy: -285 };
    forward.handleEvent({ ...common, back: false }, 1000);
    back.handleEvent({ ...common, back: true }, 1000);
    repeat.handleEvent({ ...common, back: true }, 1000);
    const worm = { ...base(), grounded: false, vx: -80, vy: -160 };
    for (const actor of [forward, back, repeat])
      actor.update(worm, {
        now: 1250,
        dt: 0.016,
        facing: -1,
        active: true,
        local: true,
        angle: -2.4,
        weapon: 'bazooka',
      });
    assert.equal(back.jumpBack, true);
    assert.equal(back.jumpFacing, 1, 'later turning does not rewrite the jump event direction');
    assert.notEqual(back.rig.rotation, forward.rig.rotation);
    assert.notEqual(back.rig.scale.y, forward.rig.scale.y);
    assert.deepEqual(
      [back.rig.rotation, back.rig.scale.x, back.rig.scale.y, back.head.rotation],
      [repeat.rig.rotation, repeat.rig.scale.x, repeat.rig.scale.y, repeat.head.rotation],
    );
    checkAim(back, -2.4);
    back.update({ ...worm, grounded: true, vy: 0 }, { now: 1500, active: true, local: true, angle: -2.4 });
    back.update({ ...worm, grounded: true, vy: 0 }, { now: 1580, active: true, local: true, angle: -2.4 });
    assert.equal(back.landAt, 1500);
    assert.ok(back.rig.scale.y < 1, 'contact produces a short landing compression');
    checkAim(back, -2.4);
  } finally {
    for (const actor of [forward, back, repeat]) actor.destroy({ children: true });
  }
});

test('reduced motion turns immediately and preserves finite transforms across all attachments', () => {
  const actor = new WormActor(base());
  try {
    actor.update(base(), { now: 1000, active: true, local: true, facing: 1, angle: -0.4 });
    for (const [i, weapon] of [
      'bazooka',
      'grenade',
      'cluster',
      'shotgun',
      'dynamite',
      'mine',
      'bat',
      'airstrike',
      'rope',
      'jetpack',
      'teleport',
      'girder',
    ].entries()) {
      actor.update(base(), {
        now: 1016 + i * 16,
        active: true,
        local: true,
        facing: -1,
        angle: -Math.PI + 0.4,
        weapon,
        reducedMotion: true,
      });
      assert.equal(actor.visualFacing, -1);
      const nodes = [actor];
      while (nodes.length) {
        const node = nodes.pop();
        assert.ok(
          [node.x, node.y, node.scale.x, node.scale.y, node.rotation, node.alpha].every(Number.isFinite),
        );
        nodes.push(...node.children);
      }
    }
    actor.update(base(), { now: 2000, active: false, weapon: null, reducedMotion: true });
    assert.equal(actor.weaponRig.visible, false);
    assert.equal(actor.throwRig.visible, false);
  } finally {
    actor.destroy({ children: true });
  }
});

test('attached grappling tool follows an anchor behind the body without turning upside down', () => {
  const actor = new WormActor(base());
  try {
    for (const x of [20, 180]) {
      const worm = { ...base(), grounded: false, rope: { x, y: 200 }, vx: 70 };
      const aim = Math.atan2(worm.rope.y - worm.y, worm.rope.x - worm.x);
      actor.update(worm, { now: 2000, active: true, local: true, angle: -0.4, facing: 1, weapon: 'rope' });
      assert.ok(checkAim(actor, aim).y.y > 0);
    }
  } finally {
    actor.destroy({ children: true });
  }
});

test('rope release and landing ease the body pose without moving the authoritative position or aim', () => {
  const actor = new WormActor(base());
  const attached = {
    ...base(),
    grounded: false,
    vx: 140,
    vy: 35,
    rope: { x: 0, y: 100, length: 225, tension: 1, reelVelocity: 0 },
  };
  const options = { dt: 0.016, active: true, local: true, angle: -0.65, weapon: 'bazooka' };
  try {
    for (let i = 0; i < 40; i++) actor.update(attached, { ...options, now: 1000 + i * 16 });
    const tilt = actor.rig.rotation,
      height = actor.rig.scale.y;
    const released = { ...attached, rope: null };
    actor.update(released, { ...options, now: 1640 });
    assert.ok(Math.abs(actor.rig.rotation - tilt) < 0.08, 'release retains the preceding body lean briefly');
    assert.ok(
      Math.abs(actor.rig.scale.y - height) < 0.03,
      'support release does not pop between body scales',
    );
    assert.deepEqual([actor.x, actor.y], [released.x, released.y]);
    checkAim(actor, options.angle);
    for (let i = 1; i < 20; i++) actor.update(released, { ...options, now: 1640 + i * 16 });
    const airborneTilt = actor.rig.rotation;
    actor.update({ ...released, grounded: true, vx: 0, vy: 0 }, { ...options, now: 2000 });
    assert.ok(Math.abs(actor.rig.rotation - airborneTilt) < 0.08);
    assert.equal(actor.landAt, 2000);
    checkAim(actor, options.angle);
  } finally {
    actor.destroy({ children: true });
  }
});

test('jetpack lean and exhaust respond smoothly to real thrust, braking and fuel loss', () => {
  const actor = new WormActor(base());
  const flying = {
    ...base(),
    jetpack: true,
    fuel: 6,
    grounded: false,
    vx: 0,
    vy: 18,
    thrustX: 0,
    thrustY: 0,
  };
  const options = { dt: 0.016, active: true, local: true, angle: -0.6, weapon: 'jetpack' };
  try {
    for (let i = 0; i < 40; i++) actor.update(flying, { ...options, now: 1000 + i * 16 });
    const neutralFlame = actor.flame.scale.y;
    const thrust = { ...flying, vx: 170, vy: -100, thrustX: 0.7, thrustY: -0.7 };
    for (let i = 0; i < 40; i++) actor.update(thrust, { ...options, now: 1700 + i * 16 });
    assert.ok(
      actor.flame.scale.y > neutralFlame + 0.3,
      'upward thrust is visibly stronger than neutral hover',
    );
    assert.ok(actor.rig.rotation > 0.2, 'body leans into rightward powered flight');
    assert.ok(
      actor.jetExhaust.dx < -0.15 && actor.jetExhaust.power > 0.8,
      'exhaust follows the tilted nozzles',
    );
    const beforeBrake = actor.rig.rotation;
    actor.update({ ...thrust, vx: -170, thrustX: -0.7 }, { ...options, now: 2340 });
    assert.ok(Math.abs(actor.rig.rotation - beforeBrake) < 0.11, 'direction reversal does not snap the body');
    const beforeRelease = actor.rig.rotation;
    actor.update(
      { ...thrust, jetpack: false, fuel: 0, thrustX: 0, thrustY: 0 },
      { ...options, now: 2356, weapon: 'bazooka' },
    );
    assert.ok(Math.abs(actor.rig.rotation - beforeRelease) < 0.08);
    assert.equal(actor.flame.visible, false);
    assert.equal(actor.jetExhaust.power, 0);
    assert.ok(
      actor.pack.visible && actor.pack.alpha > 0.7,
      'pack fades briefly while the body enters free fall',
    );
    checkAim(actor, options.angle);
  } finally {
    actor.destroy({ children: true });
  }
});

test('rope tension changes support pose and the reel turns only when server reeling changes length', () => {
  const actor = new WormActor(base());
  const worm = {
    ...base(),
    grounded: false,
    vx: 0,
    rope: { x: -40, y: 100, length: 250, tension: 0, reelVelocity: 0 },
  };
  const options = { dt: 0.016, active: true, local: true, angle: -2.1, weapon: 'rope' };
  try {
    for (let i = 0; i < 40; i++) actor.update(worm, { ...options, now: 1000 + i * 16 });
    const slackTilt = actor.rig.rotation;
    const spool = actor.weapons.get('rope').parts.spool;
    const stationaryReel = spool.rotation;
    for (let i = 0; i < 40; i++)
      actor.update(
        { ...worm, vx: 120, rope: { ...worm.rope, tension: 1 } },
        { ...options, now: 1700 + i * 16 },
      );
    assert.ok(Math.abs(actor.rig.rotation - slackTilt) > 0.1);
    assert.equal(spool.rotation, stationaryReel, 'swing velocity alone does not spin the reel');
    actor.update(
      { ...worm, rope: { ...worm.rope, tension: 1, reelVelocity: -92 } },
      { ...options, now: 2340 },
    );
    assert.ok(spool.rotation < stationaryReel);
    assert.ok([actor.ropeSocket.x, actor.ropeSocket.y].every(Number.isFinite));
    const barrelEnd = actor.weaponRig.toGlobal({ x: 14, y: 0 });
    assert.ok(
      Math.hypot(barrelEnd.x - actor.ropeSocket.x, barrelEnd.y - actor.ropeSocket.y) < 1e-8,
      'cable starts at the tool barrel',
    );
  } finally {
    actor.destroy({ children: true });
  }
});

test('tool locomotion poses are deterministic and reduced motion damps lean without losing propulsion cues', () => {
  const a = new WormActor(base()),
    b = new WormActor(base()),
    reduced = new WormActor(base());
  try {
    for (let i = 0; i < 40; i++) {
      const worm = {
        ...base(),
        grounded: false,
        jetpack: true,
        fuel: 5,
        vx: 160,
        vy: -90,
        thrustX: 0.8,
        thrustY: -0.5,
      };
      const options = {
        now: 1000 + i * 16,
        dt: 0.016,
        active: true,
        local: true,
        angle: -0.5,
        weapon: 'jetpack',
      };
      a.update(worm, options);
      b.update(worm, options);
      reduced.update(worm, { ...options, reducedMotion: true });
    }
    assert.deepEqual(
      [a.rig.rotation, a.flame.scale.y, a.jetExhaust.x, a.jetExhaust.y],
      [b.rig.rotation, b.flame.scale.y, b.jetExhaust.x, b.jetExhaust.y],
    );
    assert.ok(Math.abs(reduced.rig.rotation) < Math.abs(a.rig.rotation) * 0.2);
    assert.ok(reduced.flame.visible && reduced.jetExhaust.power > 0.7);
  } finally {
    for (const actor of [a, b, reduced]) actor.destroy({ children: true });
  }
});

test('selecting a weapon during powered flight shows it immediately and preserves local aim', () => {
  for (const facing of [-1, 1])
    for (const weapon of ['bazooka', 'grenade', 'shotgun']) {
      const worm = {
        ...base(),
        facing,
        grounded: false,
        jetpack: true,
        fuel: 5,
        vx: facing * 150,
        vy: -65,
        thrustX: facing * 0.7,
        thrustY: -0.3,
      };
      const actor = new WormActor(worm);
      try {
        const angle = facing < 0 ? -2.5 : -0.64;
        const options = { dt: 0.016, active: true, local: true, facing, angle, power: 0.6 };
        actor.handleEvent({ type: 'fire', wormId: worm.id, weapon: 'jetpack', angle, enabled: true }, 1000);
        actor.update(worm, { ...options, now: 1016, weapon: 'jetpack' });
        actor.update(worm, { ...options, now: 1032, weapon });
        assert.ok(
          actor.pack.visible && actor.flame.visible && actor.jetExhaust.power > 0,
          'selecting an attack retains the active pack and propulsion',
        );
        assert.equal(actor.displayAim, angle, 'local aim remains immediate');
        if (weapon === 'grenade') {
          assert.ok(
            actor.throwRig.visible && actor.heldGrenade.visible,
            'throw is visible while charging in flight',
          );
          assert.equal(actor.weaponRig.visible, false);
          const origin = actor.throwRig.toGlobal({ x: 0, y: 0 }),
            unit = actor.throwRig.toGlobal({ x: 1, y: 0 });
          assert.ok(
            Math.abs(Math.hypot(unit.x - origin.x, unit.y - origin.y) - 1) < 1e-8,
            'throw art does not inherit the leaning body scale',
          );
        } else {
          assert.ok(
            actor.weaponRig.visible && actor.weapons.get(weapon).visible,
            'chosen weapon replaces the tool without waiting for ignition',
          );
          checkAim(actor, angle);
          const nextAngle = facing < 0 ? -2.2 : -0.94;
          actor.update(worm, { ...options, now: 1048, weapon, angle: nextAngle });
          checkAim(actor, nextAngle);
        }
      } finally {
        actor.destroy({ children: true });
      }
    }
});
