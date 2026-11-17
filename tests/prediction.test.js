import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, stepWorm, applyJump, clearAt, supportAt } from '../shared/engine.js';
import { Terrain } from '../shared/terrain.js';
import { CONFIG } from '../shared/config.js';
import { LocalPrediction, canPredict, maskTerrain, SNAP_DISTANCE, BLEND_MS } from '../client/prediction.js';
import {
  slingshot,
  slingshotPower,
  CANCEL_RADIUS,
  MIN_POWER,
  MIN_PULL,
  MAX_PULL,
} from '../client/slingshot.js';

const STEP = 1000 / CONFIG.tickRate;
const roster = () =>
  [0, 1].map((i) => ({ id: `p${i}`, name: `Tripulación ${i + 1}`, team: i, color: '#ff7788' }));
/** A flat floor with the active worm alone in the middle; the rest of the roster waits far away. */
function arena() {
  const game = new Game(roster(), { mapId: 'hills', mode: 'ffa', worms: 2 }, { seed: 7 });
  game.terrain.data.fill(0);
  game.terrain.rect(0, 650, 1600, 250);
  game.terrain.revision++;
  const active = game._active();
  game.worms.forEach((worm, index) =>
    Object.assign(worm, {
      x: worm === active ? 400 : 1200 + index * 90,
      y: 639,
      vx: 0,
      vy: 0,
      grounded: true,
      facing: 1,
      aim: -Math.PI / 4,
    }),
  );
  for (let i = 0; i < 6; i++) game.step();
  return game;
}
const motion = (worm) => ({ x: worm.x, y: worm.y, vx: worm.vx, vy: worm.vy, grounded: worm.grounded });
const snapshotOf = (worm) => ({
  id: worm.id,
  x: worm.x,
  y: worm.y,
  vx: worm.vx,
  vy: worm.vy,
  grounded: worm.grounded,
  hp: worm.hp,
  facing: worm.facing,
});
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} ≈ ${expected} ± ${tolerance}`);

test('the shared worm step reproduces the server walk, climb, jump, landing and brake tick by tick', () => {
  const game = arena(),
    worm = game._active(),
    player = game.turn.playerId;
  // A low ledge ahead exercises the climbing path; the copy knows nothing about the game.
  game.terrain.rect(470, 643, 60, 7);
  game.terrain.revision++;
  const copy = { ...worm, rope: null, jetpack: false };
  const env = { terrain: game.terrain, waterY: game.waterY, controlled: true };
  const script = [
    { ticks: 80, move: 1 },
    { jump: false },
    { ticks: 45, move: 1 },
    { ticks: 12, move: 0 },
    { jump: true },
    { ticks: 50, move: -1 },
    { ticks: 30, move: -1 },
    { ticks: 15, move: 0 },
  ];
  let compared = 0,
    climbed = false,
    airborne = false;
  for (const part of script) {
    if (part.jump !== undefined) {
      assert.equal(game.action(player, { type: 'jump', back: part.jump }).ok, true);
      copy.facing = worm.facing;
      applyJump(copy, part.jump);
      assert.deepEqual(motion(copy), motion(worm));
      continue;
    }
    for (let i = 0; i < part.ticks; i++) {
      // The client renews its intention every 100 ms; the server forgets it after 300 ms.
      if (i % 5 === 0) assert.equal(game.action(player, { type: 'input', move: part.move }).ok, true);
      game.step();
      stepWorm(copy, { move: part.move }, 1 / CONFIG.tickRate, env);
      assert.deepEqual(motion(copy), motion(worm), `tick ${compared} of move ${part.move}`);
      compared++;
      if (worm.y < 638 && worm.grounded) climbed = true;
      if (!worm.grounded) airborne = true;
    }
  }
  assert.ok(compared > 200 && climbed && airborne, 'the script walked onto the ledge and left the ground');
  assert.equal(worm.grounded, true);
  assert.equal(worm.vx, 0);
  assert.equal(clearAt(game.terrain, worm.x, worm.y), true);
  assert.equal(supportAt(game.terrain, worm), true);
  assert.equal(clearAt(game.terrain, worm.x, 660), false, 'the floor is solid');
});

test('the shared step reports falls and drowning through callbacks instead of touching a game', () => {
  const terrain = new Terrain('hills');
  terrain.data.fill(0);
  terrain.rect(0, 650, 1600, 250);
  const events = [];
  const env = {
    terrain,
    waterY: CONFIG.waterY,
    onDamage: (worm, amount) => events.push(['damage', amount]),
    onKill: (worm, water) => events.push(['kill', water]),
  };
  const faller = {
    id: 'f',
    x: 300,
    y: 200,
    vx: 0,
    vy: 0,
    grounded: false,
    hp: 100,
    facing: 1,
    rope: null,
    jetpack: false,
    fuel: 0,
  };
  for (let i = 0; i < 180 && !events.length; i++) stepWorm(faller, { move: 0 }, 1 / CONFIG.tickRate, env);
  assert.equal(events[0]?.[0], 'damage');
  assert.ok(events[0][1] > 0);
  assert.equal(faller.hp, 100, "health stays the server's decision");
  assert.equal(faller.grounded, true);
  terrain.data.fill(0);
  const swimmer = { ...faller, y: 700, vy: 0 };
  for (let i = 0; i < 120 && !events.some((e) => e[0] === 'kill'); i++)
    stepWorm(swimmer, { move: 0 }, 1 / CONFIG.tickRate, env);
  assert.deepEqual(events.at(-1), ['kill', true]);
});

test('prediction applies only to the local active worm walking or jumping on its own turn', () => {
  const state = {
    phase: 'playing',
    turn: { playerId: 'me', wormId: 'me:1', stage: 'action' },
    worms: [{ id: 'me:1', hp: 100, rope: null, jetpack: false }],
  };
  assert.equal(canPredict(state, 'me'), true);
  assert.equal(canPredict(state, 'other'), false, 'spectators and rivals watch the snapshots');
  assert.equal(canPredict({ ...state, turn: { ...state.turn, stage: 'settling' } }, 'me'), false);
  assert.equal(canPredict({ ...state, turn: { ...state.turn, stage: 'retreat' } }, 'me'), true);
  assert.equal(
    canPredict({ ...state, worms: [{ ...state.worms[0], rope: { x: 1, y: 1, length: 90 } }] }, 'me'),
    false,
  );
  assert.equal(canPredict({ ...state, worms: [{ ...state.worms[0], jetpack: true }] }, 'me'), false);
  assert.equal(canPredict({ ...state, worms: [{ ...state.worms[0], hp: 0 }] }, 'me'), false);
  assert.equal(canPredict({ ...state, phase: 'finished' }, 'me'), false);
  assert.equal(canPredict(null, 'me'), false);
  const mask = maskTerrain(new Terrain('hills').data);
  assert.equal(mask.solid(800, 899), true);
  assert.equal(mask.solid(800, 10), false);
  assert.equal(mask.solid(-1, 899), false);
});

test('reconciliation eases corrections within the threshold and snaps beyond it', () => {
  const terrain = new Terrain('hills');
  terrain.data.fill(0);
  terrain.rect(0, 650, 1600, 250);
  const prediction = new LocalPrediction();
  prediction.setTerrain(terrain, CONFIG.waterY);
  const worm = { id: 'p0:1', x: 800, y: 639, vx: 0, vy: 0, grounded: true, hp: 100, facing: 1 };
  prediction.start(worm, 1000, 0);
  prediction.setInput({ move: 1 });
  prediction.advance(1300);
  const walked = prediction.position(1300);
  assert.ok(walked.x > 812 && Math.abs(walked.y - 639) < 1, 'the copy walks immediately on the floor');
  // The server agrees with the state it reflects, one round trip (100 ms) before the snapshot arrives.
  const reflected = prediction.stateAt(1200).state;
  assert.equal(prediction.reconcile({ ...worm, x: reflected.x, vx: reflected.vx }, 1300, 100), 'blend');
  assert.equal(prediction.offset, null, 'an agreeing snapshot leaves the display untouched');
  near(prediction.position(1300).x, walked.x, 1e-9, 'agreeing snapshot');
  // Ten pixels behind: the copy is corrected at once but the display eases over BLEND_MS.
  const before = prediction.position(1300),
    simX = prediction.worm.x;
  assert.equal(prediction.reconcile({ ...worm, x: reflected.x - 10, vx: reflected.vx }, 1300, 100), 'blend');
  near(prediction.worm.x, simX - 10, 1e-9, 'the replayed copy already carries the correction');
  near(prediction.position(1300).x, before.x, 0.01, 'the blend starts where the worm was drawn');
  near(prediction.position(1300 + BLEND_MS / 2).x, simX - 5, 0.01, 'half way through the blend');
  near(prediction.position(1300 + BLEND_MS).x, simX - 10, 1e-9, 'the correction is complete after the blend');
  assert.equal(prediction.offset, null);
  // Beyond the threshold the display snaps to the corrected position immediately.
  const latest = prediction.stateAt(1200).state;
  const far = { ...worm, x: latest.x - SNAP_DISTANCE - 20, vx: latest.vx };
  assert.equal(prediction.reconcile(far, 1300, 100), 'snap');
  assert.equal(prediction.offset, null);
  near(
    prediction.position(1300).x,
    before.x - 10 - SNAP_DISTANCE - 20,
    1e-9,
    'snap lands on the replayed authoritative position',
  );
  // A different worm restarts prediction instead of blending across characters.
  assert.equal(prediction.reconcile({ ...worm, id: 'p0:2', x: 300 }, 1300, 100), 'start');
  assert.equal(prediction.wormId, 'p0:2');
});

test('a walk and a jump through a steady round trip reconcile without snapping or visible pulls', () => {
  const ow = 60,
    rtt = ow * 2;
  const game = arena(),
    worm = game._active(),
    player = game.turn.playerId;
  const prediction = new LocalPrediction();
  prediction.setTerrain(game.terrain, game.waterY);
  const toServer = [],
    toClient = []; // messages in flight, each with its arrival time
  const deliver = (queue, time) => {
    const ready = queue.filter((m) => m.at <= time).sort((a, b) => a.at - b.at);
    for (const m of ready) queue.splice(queue.indexOf(m), 1);
    return ready;
  };
  const serverAt = new Map(); // server tick → authoritative position after that tick
  const modes = [],
    offsets = [],
    samples = [];
  let move = 0;
  const sendInput = (t, value) => {
    move = value;
    prediction.setInput({ move: value });
    toServer.push({ at: t + ow, fn: () => game.action(player, { type: 'input', move: value }) });
  };
  const sendJump = (t, back) => {
    prediction.jump(back, 1);
    toServer.push({ at: t + ow, fn: () => game.action(player, { type: 'jump', back }) });
  };
  // The first snapshot of the turn reaches the client one way late and starts prediction.
  prediction.start(snapshotOf(worm), ow, rtt);
  for (let tick = 1; tick <= 150; tick++) {
    const t = tick * STEP;
    // Server side: apply the commands that arrived, integrate, publish every fourth tick.
    for (const m of deliver(toServer, t)) m.fn();
    game.step();
    serverAt.set(tick, { x: worm.x, y: worm.y });
    if (tick % 4 === 0) {
      const snap = snapshotOf(worm);
      toClient.push({
        at: t + ow,
        fn: () => {
          modes.push(prediction.reconcile(snap, t + ow, rtt));
          if (prediction.offset) offsets.push(Math.hypot(prediction.offset.x, prediction.offset.y));
        },
      });
    }
    // Client side: deliveries, then this frame's commands and integration.
    for (const m of deliver(toClient, t)) m.fn();
    if (tick === 12) sendInput(t, 1);
    if (tick === 60) sendJump(t, false);
    if (tick === 120) sendInput(t, 0);
    if (tick % 6 === 0 && tick > 12) sendInput(t, move);
    prediction.advance(t);
    // The copy runs one way ahead of the server: compare with the server's state 60 ms later.
    if (tick >= 20 && tick + ow / STEP <= 150) samples.push({ tick, predicted: prediction.position(t) });
  }
  assert.ok(
    modes.length >= 30 && !modes.includes('snap') && !modes.includes('start'),
    `only blends: ${modes.join(',')}`,
  );
  assert.ok(
    Math.max(0, ...offsets) < 10,
    `corrections stay well under the snap threshold: ${Math.max(0, ...offsets)}`,
  );
  for (const { tick, predicted } of samples) {
    const authoritative = serverAt.get(Math.round(tick + ow / STEP));
    near(predicted.x, authoritative.x, 10, `x at tick ${tick}`);
    near(predicted.y, authoritative.y, 10, `y at tick ${tick}`);
  }
  assert.ok(
    samples.some((s) => s.predicted.y < 630),
    'the predicted worm left the ground for the jump',
  );
  assert.ok(worm.x > 440, 'the server walked and jumped too');
});

test('slingshot geometry: opposite direction, power by pull length and sensitivity, cancel zone near the press', () => {
  assert.deepEqual(slingshot(0, 0, 1, -0.9), { angle: -0.9, power: MIN_POWER, cancel: true, length: 0 });
  const pullLeft = slingshot(-100, 0);
  near(pullLeft.angle, 0, 1e-12, 'pulling left shoots right');
  assert.equal(pullLeft.cancel, false);
  const pullDownLeft = slingshot(-100, 100);
  near(pullDownLeft.angle, -Math.PI / 4, 1e-12, 'pulling down-left shoots up-right');
  near(slingshot(100, 100).angle, (-Math.PI * 3) / 4, 1e-12, 'pulling down-right shoots up-left');
  assert.equal(slingshot(CANCEL_RADIUS - 1, 0).cancel, true);
  assert.equal(slingshot(CANCEL_RADIUS, 0).cancel, false);
  assert.equal(slingshotPower(MIN_PULL), MIN_POWER);
  assert.equal(slingshotPower(MAX_PULL), 1);
  assert.equal(slingshotPower(MAX_PULL + 80), 1);
  near(slingshotPower((MIN_PULL + MAX_PULL) / 2), (MIN_POWER + 1) / 2, 1e-12, 'linear ramp');
  assert.equal(slingshotPower(MAX_PULL / 2, 2), 1, 'double sensitivity halves the pull for full power');
  assert.ok(slingshotPower(60, 0.5) < slingshotPower(60, 1), 'lower sensitivity needs a longer pull');
  assert.equal(slingshotPower(60, NaN), slingshotPower(60, 1));
});
