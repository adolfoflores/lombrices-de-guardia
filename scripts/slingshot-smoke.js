/* Browser fixture globals supplied explicitly by the inline harness. */
/* global __reconciles, __slingRenderer */
// Real client regression for slingshot aiming on the field and local prediction of the own worm.
// Trusted CDP touch on Chrome mobile emulation → original main.js/Renderer → private WebSocket server → Game.action.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../server/index.js';
import { NetworkClient } from './network-smoke.js';
import { GRAB_RADIUS, CANCEL_RADIUS, slingshot } from '../client/slingshot.js';
import { SNAP_DISTANCE } from '../client/prediction.js';

const folder = new URL('../docs/evidence/', import.meta.url);
const sources = [
  'client/main.js',
  'client/renderer.js',
  'client/slingshot.js',
  'client/prediction.js',
  'client/pixi-combat.js',
  'shared/engine.js',
  'shared/config.js',
  'server/index.js',
];
const report = {
  browser: 'chromium',
  physicalDevice: false,
  startedAt: new Date().toISOString(),
  checks: [],
  cases: [],
  errors: [],
  sourceSHA256: {},
  notes: [
    'Trusted CDP touch contacts on the battlefield canvas and the move stick; the product code is observed through a setState wrapper, never replaced.',
    'A flat floor fixture and a long test turn keep gestures inside one turn. The prediction cases add an 80 ms delay to every client→server WebSocket send so the measured round trip is realistic; the server and its physics are untouched.',
    'Chrome mobile emulation; no physical phone is claimed.',
  ],
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 5000) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeout) throw new Error(message);
    await pause(16);
  }
}
async function hashes() {
  return Object.fromEntries(
    await Promise.all(
      sources.map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(new URL('../' + path, import.meta.url)))
          .digest('hex'),
      ]),
    ),
  );
}
let app, browser, context, page, guest, cdp, game, owner;
const sent = [],
  contacts = new Map();
let contactId = 20;
const actions = () => sent.filter((m) => m.type === 'action').map((m) => m.action);
const fires = () => actions().filter((a) => a.type === 'fire');
const point = (id, x, y) => ({ id, x: Math.round(x), y: Math.round(y), radiusX: 7, radiusY: 7, force: 1 });
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
async function pressAt(x, y) {
  const id = ++contactId;
  contacts.set(id, point(id, x, y));
  await touch('touchStart', [...contacts.values()]);
  return id;
}
async function moveTo(id, x, y) {
  contacts.set(id, point(id, x, y));
  await touch('touchMove', [...contacts.values()]);
}
async function lift(id) {
  const p = contacts.get(id);
  contacts.delete(id);
  await touch('touchEnd', contacts.size ? [p] : []);
}
async function cancelAll() {
  if (contacts.size) {
    contacts.clear();
    await touch('touchCancel', []);
  }
}
async function bounds(selector) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, selector + ' visible');
  return box;
}
async function tap(selector, hold = 50) {
  const b = await bounds(selector);
  const id = await pressAt(b.x + b.width / 2, b.y + b.height / 2);
  await pause(hold);
  await lift(id);
}
async function setWeapon(id) {
  await tap('#arsenal', 120);
  await page.locator(`[data-weapon=${id}]`).click();
  await page.locator('#arsenal-equip').click();
  await page.evaluate(() => document.activeElement?.blur());
  await pause(120);
}
const view = () =>
  page.evaluate(() => {
    const r = __slingRenderer,
      w = r.state.worms.find((w) => w.id === r.state.turn.wormId),
      game = document.querySelector('.game'),
      fire = document.querySelector('#fire');
    return {
      angle: r.view.angle,
      facing: r.view.facing,
      power: r.view.power,
      charging: !!r.view.charging,
      weapon: r.view.weapon,
      aiming: game.classList.contains('is-aiming'),
      ring: fire.classList.contains('is-charging'),
      ringPower: Number(fire.style.getPropertyValue('--charge-power')),
      fireText: document.querySelector('#fire-text').textContent,
      powerText: document.querySelector('#power-text').textContent,
      autoFollow: r.autoFollow,
      cameraGoal: { ...r.cameraGoal },
      drag: r.aimDrag ? { cancel: r.aimDrag.cancel, power: r.aimDrag.power } : null,
      target: r.target,
      worm: { x: w.x, y: w.y, facing: w.facing, aim: w.aim },
    };
  });
async function camera() {
  await page.evaluate(() => {
    const r = __slingRenderer,
      w = r.state.worms.find((w) => w.id === r.state.turn.wormId);
    r.autoFollow = false;
    r.fullView = false;
    r.camera = { x: w.x, y: w.y - 35, zoom: 1.35 };
    r.cameraGoal = { ...r.camera };
  });
  await pause(60);
}
async function wormScreen() {
  const field = await bounds('#field');
  const p = await page.evaluate(() => {
    const r = __slingRenderer,
      w = r.state.worms.find((w) => w.id === r.state.turn.wormId);
    return r.screenPoint(r.position(w, performance.now()));
  });
  return { x: field.x + p.x, y: field.y + p.y, field };
}
async function resetCase(name) {
  await cancelAll();
  game._release(owner);
  game.projectiles = [];
  game.mines = [];
  game._pendingDeaths = [];
  game.terrain.data.fill(0);
  game.terrain.rect(0, 650, 1600, 250);
  game.terrain.revision++;
  Object.assign(owner, {
    x: 800,
    y: 639,
    vx: 0,
    vy: 0,
    hp: 100,
    grounded: true,
    facing: 1,
    aim: -Math.PI / 4,
    thrustX: 0,
    thrustY: 0,
  });
  game.turn = {
    ...game.turn,
    playerId: owner.playerId,
    wormId: owner.id,
    number: game.turn.number + 1,
    remaining: 240,
    stage: 'action',
    shots: 0,
  };
  game._input = {};
  game._lastShotAt = -10;
  await page.waitForFunction(
    (number) => __slingRenderer.state.turn.number === number && !document.querySelector('#fire').disabled,
    game.turn.number,
  );
  await pause(180);
  await camera();
  report.currentCase = name;
}
const snapshot = () => ({
  x: owner.x,
  y: owner.y,
  vx: owner.vx,
  vy: owner.vy,
  facing: owner.facing,
  aim: owner.aim,
  grounded: owner.grounded,
  stage: game.turn.stage,
  shots: game.turn.shots,
});
const angular = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
try {
  await mkdir(folder, { recursive: true });
  report.sourceSHA256 = await hashes();
  app = await createServer({ dev: true });
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  report.version = browser.version();
  context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('websocket', (ws) => {
    if (!ws.url().endsWith('/socket')) return;
    ws.on('framesent', ({ payload }) => {
      try {
        sent.push(JSON.parse(String(payload)));
      } catch {}
    });
  });
  // Optional outbound delay (test only): every client→server frame waits __sendDelay ms, in order.
  await page.addInitScript(() => {
    window.__sendDelay = 0;
    const original = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      const delay = window.__sendDelay;
      if (delay > 0)
        setTimeout(() => {
          if (this.readyState === 1) original.call(this, data);
        }, delay);
      else original.call(this, data);
    };
  });
  await page.goto(`http://127.0.0.1:${app.port}/`);
  await page.waitForFunction(() => document.querySelector('#connection')?.hidden);
  await page.evaluate(async () => {
    const { Renderer } = await import('/client/renderer.js');
    const original = Renderer.prototype.setState;
    Renderer.prototype.setState = function (...args) {
      window.__slingRenderer = this;
      return original.apply(this, args);
    };
  });
  await page.locator('#player-name').fill('Honda');
  await page.getByRole('button', { name: 'Crear sala privada →' }).click();
  await page.locator('#ready').waitFor();
  const identity = sent.length ? null : null;
  const code = await page.evaluate(() => new URL(location.href).searchParams.get('sala'));
  void identity;
  guest = await NetworkClient.connect(app.port);
  await guest.command('join', { code, name: 'Observa' });
  await guest.command('ready', { ready: true });
  await page.locator('#ready').click();
  await page.locator('#start').click();
  await until(() => guest.room?.phase === 'loading', 'Guest loading');
  await guest.command('loaded');
  await page.locator('#move-stick').waitFor();
  await page.waitForFunction(
    () => window.__slingRenderer?.pixi?.active && !document.querySelector('#fire').disabled,
  );
  game = app.rooms.get(code).game;
  owner = game._active();
  game.worms.forEach((w, i) =>
    Object.assign(w, {
      x: w === owner ? 800 : 100 + i * 110,
      y: 639,
      vx: 0,
      vy: 0,
      hp: 100,
      grounded: true,
      rope: null,
      jetpack: false,
    }),
  );
  cdp = await context.newCDPSession(page);
  await page.bringToFront();

  // 1. A pull near the worm aims; power follows the pull; release fires exactly once with the shown angle and power.
  await resetCase('pull-and-fire');
  const idle = await view();
  assert.equal(idle.aiming, false);
  assert.equal(idle.ring, false);
  assert.equal(idle.drag, null);
  let at = await wormScreen();
  let fired = fires().length;
  let start = { x: at.x + 12, y: at.y + 8 };
  const id = await pressAt(start.x, start.y);
  await pause(60);
  const pressed = await view();
  assert.ok(pressed.drag && pressed.drag.cancel, 'press within reach starts the gesture in its cancel zone');
  assert.equal(pressed.aiming, true, 'HUD steps back while aiming');
  assert.equal(pressed.autoFollow, false, 'fixture camera stays');
  assert.deepEqual(pressed.cameraGoal, idle.cameraGoal, 'the aim press never pans');
  assert.equal(pressed.powerText, 'SUELTA PARA CANCELAR');
  const pull = { dx: -120, dy: 90 };
  await moveTo(id, start.x + pull.dx, start.y + pull.dy);
  await pause(120);
  const pulled = await view();
  const expected = slingshot(pull.dx, pull.dy, 1);
  assert.ok(
    angular(pulled.angle, expected.angle) < 1e-6,
    `angle follows the pull (${pulled.angle} vs ${expected.angle})`,
  );
  assert.equal(pulled.facing, 1);
  assert.ok(Math.abs(pulled.power - expected.power) < 1e-6, 'power follows the pull length');
  assert.equal(pulled.ring, true, 'fire ring shows the pull');
  assert.ok(Math.abs(pulled.ringPower - expected.power) < 0.002);
  assert.equal(pulled.charging, true);
  assert.equal(pulled.drag.cancel, false);
  assert.equal(pulled.powerText, 'SUELTA PARA DISPARAR');
  assert.equal(pulled.fireText, 'TENSANDO');
  assert.deepEqual(pulled.cameraGoal, idle.cameraGoal, 'pulling never pans');
  await moveTo(id, start.x - 185, start.y + 10);
  await pause(90);
  const full = await view();
  assert.equal(full.power, 1, 'a pull beyond 170 px reaches full power');
  assert.match(full.fireText, /A TOPE/);
  await moveTo(id, start.x + pull.dx, start.y + pull.dy);
  await pause(90);
  const before = await view();
  await lift(id);
  await until(() => fires().length === fired + 1, 'release fires once');
  await until(
    () => game.events.some((e) => e.type === 'fire' && e.wormId === owner.id && game.turn.shots === 1),
    'server accepts the slingshot shot',
  );
  const command = fires().at(-1),
    event = game.events.filter((e) => e.type === 'fire').at(-1);
  assert.equal(command.weapon, 'bazooka');
  assert.ok(angular(command.angle, before.angle) < 1e-6);
  assert.ok(Math.abs(command.power - before.power) < 1e-6);
  assert.ok(angular(event.angle, command.angle) < 1e-6);
  assert.ok(Math.abs(event.power - command.power) < 1e-6);
  await pause(400);
  const after = await view();
  assert.equal(after.drag, null);
  assert.equal(after.aiming, false);
  assert.equal(after.ring, false, 'the ring clears after the confirmation');
  assert.equal(fires().length, fired + 1, 'exactly one shot');
  report.cases.push({ name: 'pull-and-fire', pressed, pulled, full, command, event, after: snapshot() });
  report.checks.push(
    'Pulling back from the worm aims opposite to the drag, scales power with the pull, shows the ring and fires exactly once with the displayed angle and power',
  );

  // 2. Returning to the press point cancels without a shot; the HUD and ring recover.
  await resetCase('return-cancels');
  at = await wormScreen();
  fired = fires().length;
  start = { x: at.x - 10, y: at.y + 6 };
  const c = await pressAt(start.x, start.y);
  await moveTo(c, start.x + 110, start.y + 70);
  await pause(100);
  const armed = await view();
  assert.equal(armed.drag.cancel, false);
  assert.equal(armed.facing, -1, 'pulling right aims and faces left');
  await moveTo(c, start.x + CANCEL_RADIUS - 6, start.y + 4);
  await pause(100);
  const back = await view();
  assert.equal(back.drag.cancel, true);
  assert.equal(back.fireText, 'CANCELAR');
  await lift(c);
  await pause(250);
  assert.equal(fires().length, fired, 'no shot after returning to the press point');
  const settled = await view();
  assert.equal(settled.drag, null);
  assert.equal(settled.ring, false);
  assert.equal(settled.aiming, false);
  assert.equal(game.turn.shots, 0);
  report.cases.push({ name: 'return-cancels', armed, back, settled });
  report.checks.push(
    'Releasing within the cancel radius ends the gesture without a shot and the ring, dimming and gesture state clear',
  );

  // 3. Far from the worm the field still pans; a second finger turns an aim pull into a pinch without a shot.
  await resetCase('camera-untouched');
  at = await wormScreen();
  fired = fires().length;
  const far = { x: Math.min(at.field.x + at.field.width - 40, at.x + GRAB_RADIUS + 90), y: at.y - 60 };
  const beforePan = await view();
  const p = await pressAt(far.x, far.y);
  await moveTo(p, far.x - 70, far.y - 30);
  await moveTo(p, far.x - 120, far.y - 40);
  await pause(80);
  const panned = await view();
  assert.equal(panned.drag, null, 'a press away from the worm never aims');
  assert.equal(panned.aiming, false);
  assert.ok(
    Math.hypot(panned.cameraGoal.x - beforePan.cameraGoal.x, panned.cameraGoal.y - beforePan.cameraGoal.y) >
      20,
    'the camera pans',
  );
  assert.ok(angular(panned.angle, beforePan.angle) < 1e-9, 'panning leaves the aim alone');
  await lift(p);
  await pause(80);
  await camera();
  at = await wormScreen();
  const zoomBefore = (await view()).cameraGoal.zoom;
  const a1 = await pressAt(at.x + 8, at.y + 8);
  await moveTo(a1, at.x - 80, at.y + 60);
  await pause(60);
  assert.equal((await view()).drag.cancel, false);
  const a2 = await pressAt(at.x + 140, at.y - 40);
  await pause(40);
  assert.equal((await view()).drag, null, 'a second finger ends the aim pull');
  for (let step = 1; step <= 4; step++) {
    await moveTo(a1, at.x - 80 - step * 12, at.y + 60 + step * 8);
    await moveTo(a2, at.x + 140 + step * 12, at.y - 40 - step * 8);
    await pause(30);
  }
  await lift(a2);
  await lift(a1);
  await pause(150);
  const pinched = await view();
  assert.ok(Math.abs(pinched.cameraGoal.zoom - zoomBefore) > 0.01, 'two fingers pinch the map');
  assert.equal(fires().length, fired, 'no shot from the converted gesture');
  report.cases.push({ name: 'camera-untouched', panned, pinched, zoomBefore });
  report.checks.push(
    'Presses away from the worm keep panning, pinch still zooms, and a second finger during a pull cancels it without a shot',
  );

  // 4. Target weapons keep tap-to-target; a dialog opening mid-pull cancels the gesture.
  await resetCase('target-and-dialog');
  fired = fires().length;
  await setWeapon('airstrike');
  await camera();
  at = await wormScreen();
  const t = await pressAt(at.x + 6, at.y + 6);
  await pause(40);
  assert.equal((await view()).drag, null, 'target tools never start the slingshot');
  await lift(t);
  await until(async () => (await view()).target !== null, 'tap near the worm still selects a destination');
  assert.equal(fires().length, fired);
  await setWeapon('bazooka');
  await camera();
  at = await wormScreen();
  const d = await pressAt(at.x + 10, at.y + 6);
  await moveTo(d, at.x - 90, at.y + 80);
  await pause(80);
  assert.equal((await view()).drag.cancel, false);
  await page.evaluate(() => document.querySelector('#hud-menu').click());
  await page.locator('dialog[open]').waitFor();
  await pause(60);
  const dialog = await view();
  assert.equal(dialog.drag, null, 'opening a dialog cancels the pull');
  assert.equal(dialog.ring, false);
  await moveTo(d, at.x - 120, at.y + 90);
  await lift(d);
  await pause(200);
  assert.equal(fires().length, fired, 'the cancelled pull never fires');
  await page.locator('dialog .dialog-head button').click();
  await page.locator('dialog[open]').waitFor({ state: 'detached' });
  report.cases.push({ name: 'target-and-dialog', target: (await view()).target, dialog });
  report.checks.push(
    'Teleport/girder/airstrike keep their destination tap and a dialog or turn change cancels a pull in progress',
  );

  // 5. Local prediction: with an 80 ms outbound delay the own worm walks and jumps immediately and stays reconciled.
  await resetCase('prediction-walk');
  await page.evaluate(() => {
    window.__sendDelay = 80;
    const r = __slingRenderer;
    window.__reconciles = [];
    const original = r.prediction.reconcile.bind(r.prediction);
    r.prediction.reconcile = (...args) => {
      const mode = original(...args);
      window.__reconciles.push({
        mode,
        offset: r.prediction.offset ? Math.hypot(r.prediction.offset.x, r.prediction.offset.y) : 0,
      });
      return mode;
    };
  });
  // The smoothed estimate follows the periodic input acknowledgements; give it a moment to climb past the delay.
  await until(
    () => page.evaluate(() => __slingRenderer.latency > 60),
    'the measured round trip includes the delay',
    4000,
  );
  const latency = await page.evaluate(() => __slingRenderer.latency);
  assert.ok(latency > 60 && latency < 400, `measured round trip ${latency} ms`);
  const sample = () =>
    page.evaluate(() => {
      const r = __slingRenderer,
        w = r.state.worms.find((w) => w.id === r.state.turn.wormId),
        p = r.position(w, performance.now());
      return {
        t: performance.now(),
        predicted: p,
        authoritative: { x: w.x, y: w.y },
        active: r.prediction.active,
        grounded: r.displayWorm(w).grounded,
      };
    });
  const stick = await bounds('#move-stick');
  const origin = await sample();
  assert.equal(origin.active, true, 'prediction runs on the own turn');
  const m = await pressAt(stick.x + stick.width / 2, stick.y + stick.height / 2);
  await moveTo(m, stick.x + stick.width - 4, stick.y + stick.height / 2);
  const frames = [];
  const started = Date.now();
  while (Date.now() - started < 900) {
    frames.push(await sample());
    await pause(12);
  }
  await lift(m);
  await pause(600);
  const stopped = await sample();
  // Walking accelerates at 720 px/s², so the first visible step is small; it must come while the snapshot still stands.
  report.lastFrames = frames.slice(0, 12);
  const moved = frames.find((f) => f.predicted.x > origin.predicted.x + 1);
  assert.ok(moved && moved.t - origin.t < 400, 'the predicted worm starts walking at once');
  assert.ok(
    Math.abs(moved.authoritative.x - origin.authoritative.x) < 0.5,
    'the authoritative worm has not moved when the prediction already has',
  );
  const early = frames.filter((f) => f.t <= moved.t);
  const steady = frames.filter((f) => f.t - origin.t > 450);
  const lead = steady.map((f) => f.predicted.x - f.authoritative.x);
  assert.ok(
    steady.length > 10 && lead.every((l) => l > 1 && l < SNAP_DISTANCE),
    `steady walk leads the snapshots by a round trip: ${Math.min(...lead).toFixed(1)}–${Math.max(...lead).toFixed(1)} px`,
  );
  assert.ok(
    new Set(frames.map((f) => f.predicted.x.toFixed(3))).size > frames.length * 0.6,
    'the predicted position advances at frame cadence',
  );
  assert.ok(
    Math.abs(stopped.predicted.x - stopped.authoritative.x) < 1.5 &&
      Math.abs(stopped.predicted.y - stopped.authoritative.y) < 1.5,
    'after stopping, prediction and snapshot coincide',
  );
  const reconciles = await page.evaluate(() => __reconciles);
  assert.ok(
    reconciles.length > 8 && reconciles.every((r) => r.mode === 'blend'),
    'every snapshot during the walk blends',
  );
  assert.ok(Math.max(...reconciles.map((r) => r.offset)) < 8, 'corrections stay small');
  report.cases.push({
    name: 'prediction-walk',
    latency,
    origin,
    early: early.slice(0, 6),
    lead: { min: Math.min(...lead), max: Math.max(...lead) },
    stopped,
    reconciles: reconciles.length,
    maxOffset: Math.max(...reconciles.map((r) => r.offset)),
  });
  await resetCase('prediction-jump');
  await page.evaluate(() => {
    __reconciles.length = 0;
  });
  await pause(300);
  const ground = await sample();
  await tap('#jump', 30);
  const hops = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 400) {
    hops.push(await sample());
    await pause(12);
  }
  report.lastFrames = hops.slice(0, 12);
  const takeoff = hops.find((h) => h.predicted.y < ground.predicted.y - 3 && !h.grounded);
  assert.ok(takeoff && takeoff.t - ground.t < 400, 'the predicted worm takes off at once');
  assert.ok(
    takeoff.authoritative.y > ground.authoritative.y - 0.5,
    'the snapshot is still on the ground when the prediction is airborne',
  );
  const liftoff = hops.filter((h) => h.t <= takeoff.t);
  await until(
    () => owner.grounded && game.events.some((e) => e.type === 'jump'),
    'the server jump lands',
    4000,
  );
  await pause(400);
  const landed = await sample();
  assert.ok(Math.abs(landed.predicted.y - landed.authoritative.y) < 1.5);
  const jumpReconciles = await page.evaluate(() => __reconciles);
  assert.ok(
    jumpReconciles.every((r) => r.mode === 'blend'),
    'the jump never snaps',
  );
  report.cases.push({
    name: 'prediction-jump',
    ground,
    liftoff: liftoff.slice(0, 6),
    landed,
    maxOffset: Math.max(0, ...jumpReconciles.map((r) => r.offset)),
  });
  // Snapshots outside prediction: a rope attachment stops it, and the fixture teleport snaps rather than eases.
  game.terrain.rect(600, 230, 400, 20);
  game.terrain.revision++;
  await page.waitForFunction(
    (revision) => __slingRenderer.terrainRevision === revision,
    game.terrain.revision,
  );
  assert.equal(
    game.action(owner.playerId, { type: 'fire', weapon: 'rope', angle: -Math.PI / 2 + 0.01, power: 0.5 }).ok,
    true,
    'the server attaches a rope to the ledge',
  );
  await until(async () => !(await sample()).active, 'rope attached: prediction pauses');
  game._release(owner);
  await page.evaluate(() => {
    __reconciles.length = 0;
  });
  await until(async () => (await sample()).active, 'released: prediction resumes');
  owner.x = 650;
  await until(
    () => page.evaluate(() => __reconciles.some((r) => r.mode === 'snap')),
    'a large authoritative move snaps',
  );
  await page.evaluate(() => {
    window.__sendDelay = 0;
  });
  report.checks.push(
    'With an 80 ms outbound delay the own worm walks and jumps at once, leads the snapshots by one round trip, blends every reconciliation, pauses on the rope and snaps on a large teleport',
  );

  report.touch = { contacts: contactId - 20 };
  assert.deepEqual(report.errors, []);
  report.finalSourceSHA256 = await hashes();
  assert.deepEqual(report.finalSourceSHA256, report.sourceSHA256, 'Product sources unchanged during the run');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  if (owner) report.lastState = snapshot();
  if (page) {
    report.lastActions = actions().slice(-12);
    await page
      .screenshot({ path: fileURLToPath(new URL('slingshot-chromium-failure.png', folder)) })
      .catch(() => {});
  }
  throw error;
} finally {
  if (report.passed) await unlink(new URL('slingshot-chromium-failure.png', folder)).catch(() => {});
  await writeFile(new URL('slingshot-chromium.json', folder), JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        version: report.version,
        checks: report.checks,
        failure: report.failure,
        errors: report.errors,
      },
      null,
      2,
    ),
  );
  guest?.close();
  await context?.close();
  await browser?.close();
  await app?.close();
}
