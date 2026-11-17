import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../client/renderer.js';
import { CombatEffects } from '../client/pixi-effects.js';
import { bindKeyboard } from '../client/keyboard.js';

function camera() {
  return Object.assign(Object.create(Renderer.prototype), {
    width: 800,
    height: 400,
    minZoom: 0.5,
    maxZoom: 3,
    camera: { x: 800, y: 450, zoom: 1 },
    cameraGoal: { x: 800, y: 450, zoom: 1 },
    view: { playerId: 'p', facing: 1, reducedMotion: false },
    onCamera() {},
  });
}

test('camera zoom preserves the cursor world point and clamps panning to the world', () => {
  const renderer = camera();
  const cursor = { x: 500, y: 170 };
  const before = renderer.worldPoint(cursor, renderer.cameraGoal);
  renderer.zoomAt(1.5, cursor);
  const after = renderer.worldPoint(cursor, renderer.cameraGoal);
  assert.ok(Math.abs(before.x - after.x) < 1e-10);
  assert.ok(Math.abs(before.y - after.y) < 1e-10);
  renderer.cameraGoal.x = -1000;
  renderer.cameraGoal.y = 5000;
  renderer.clampCamera(renderer.cameraGoal);
  assert.ok(renderer.cameraGoal.x >= renderer.width / renderer.cameraGoal.zoom / 2);
  assert.ok(renderer.cameraGoal.y <= 900 - renderer.height / renderer.cameraGoal.zoom / 2);
});

test('replay advances recorded states at the selected rate and restores live identity and events', async () => {
  const renderer = camera();
  const first = { phase: 'playing', events: [{ id: 1, type: 'turn' }] };
  const last = { phase: 'finished', events: [{ id: 2, type: 'explosion' }] };
  const applied = [];
  Object.assign(renderer, {
    state: last,
    finalBlow: { at: 1000 },
    history: [{ state: first, at: 0 }],
    eventIds: new Set([1, 2]),
    effects: [],
    focus() {},
    _mountSkip() {},
    _apply(state, _now, mode) {
      applied.push({ state, mode });
    },
  });
  const run = renderer.prepareReplay();
  assert.ok(run);
  const done = renderer.startReplay(run, { rate: 0.5 });
  assert.equal(renderer.view.playerId, null);
  renderer.stepReplay(0);
  renderer.stepReplay(1000);
  assert.equal(applied.length, 1, 'a second of playback advances only half a second of recording');
  renderer.stepReplay(2000);
  assert.equal(applied.at(-1).state, last);
  renderer.skipReplay();
  await done;
  assert.equal(renderer.view.playerId, 'p');
  assert.deepEqual(renderer.eventIds, new Set([1, 2]));
  assert.equal(applied.at(-1).mode, 'restore');
  assert.equal(renderer.replaying, null);
  assert.equal(renderer.prepareReplay(), null, 'the final blow cannot replay twice');
});

test('weapon effects retain bounded finite particles across maps, tools, impacts and cleanup', () => {
  for (const mapId of ['hills', 'cavern', 'islands']) {
    const effects = new CombatEffects();
    const options = { quality: 'low', reducedMotion: false, mapId };
    const events = [
      ...['bazooka', 'grenade', 'cluster', 'dynamite', 'mine', 'airstrike'].map((weapon) => ({
        type: 'fire',
        weapon,
        angle: -0.6,
        targetX: 400,
        targetY: 500,
      })),
      ...['bazooka', 'grenade', 'cluster', 'mine'].map((weapon) => ({
        type: 'explosion',
        weapon,
        radius: 60,
      })),
      { type: 'shot', angle: -0.6, hits: [] },
      { type: 'bat', angle: -0.6, hits: [] },
      { type: 'mineTrigger' },
      { type: 'teleport', fromX: 100, fromY: 100 },
      { type: 'girder', width: 112, height: 16 },
      { type: 'rope', fromX: 100, fromY: 100 },
      { type: 'crateLand' },
      { type: 'crateBreak' },
    ];
    for (const event of events) effects.addEvent({ x: 200, y: 300, ...event }, 0, options);
    effects.update(50, 0.05, options);
    assert.ok(effects.particles.length > 0 && effects.particles.length <= 100);
    for (const { node } of effects.particles)
      assert.ok(
        [node.x, node.y, node.alpha, node.rotation, node.scale.x, node.scale.y].every(Number.isFinite),
      );
    effects.clear();
    assert.equal(effects.particles.length, 0);
    assert.equal(effects.projectiles.size, 0);
    effects.destroy({ children: true });
  }
});

test('keyboard focus guards typing and menus, limits repeated jumps, and always releases movement', () => {
  const target = new EventTarget(),
    keys = new Set(),
    jumps = [];
  let element = null,
    allowed = true,
    changes = 0,
    charges = 0;
  const unbind = bindKeyboard({
    target,
    focus: () => element,
    hasDialog: () => false,
    isGame: () => true,
    canAct: () => allowed,
    keys,
    onChange() {
      changes++;
    },
    onArsenal() {},
    onFocus() {},
    onJump(back) {
      jumps.push(back);
    },
    onRelease() {},
    onChargeStart() {
      charges++;
    },
    onChargeEnd() {
      charges--;
    },
  });
  const press = (type, key, repeat = false) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { key, repeat });
    target.dispatchEvent(event);
  };
  element = { tagName: 'INPUT' };
  press('keydown', 'Enter');
  assert.deepEqual(jumps, []);
  element = null;
  press('keydown', 'Enter');
  press('keydown', 'Enter', true);
  assert.deepEqual(jumps, [false]);
  press('keydown', 'ArrowLeft');
  assert.ok(keys.has('ArrowLeft'));
  allowed = false;
  press('keyup', 'ArrowLeft');
  assert.equal(keys.has('ArrowLeft'), false);
  allowed = true;
  element = { tagName: 'BUTTON', id: 'fire' };
  press('keydown', 'Enter');
  assert.equal(charges, 1);
  press('keyup', 'Enter');
  assert.equal(charges, 0);
  const before = changes;
  unbind();
  press('keydown', 'ArrowRight');
  assert.equal(changes, before);
});
