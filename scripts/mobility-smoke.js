/* Browser fixture globals supplied explicitly by the inline harness. */
/* global __mobilityRenderer, __mobilityTouches */
// Real mobile UI → WebSocket → authoritative physics regression.
// Fixtures only arrange safe terrain/positions and reset fuel between isolated direction cases.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { createServer } from '../server/index.js';
import { NetworkClient } from './network-smoke.js';

const kind = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const folder = new URL('../docs/evidence/', import.meta.url);
const sources = [
  'client/main.js',
  'client/mobile-controls.js',
  'client/combat-controls.js',
  'client/charge-control.js',
  'client/style.css',
  'client/renderer.js',
  'client/pixi-character.js',
  'client/art/palette.js',
  'client/art/weapons.js',
  'shared/config.js',
  'shared/engine.js',
  'server/index.js',
];
const report = {
  browser: kind,
  physicalDevice: false,
  startedAt: new Date().toISOString(),
  checks: [],
  cases: [],
  layouts: [],
  errors: [],
  sourceSHA256: {},
  notes: [
    'Original main.js and physics through a private ephemeral HTTP/WebSocket server; one mobile browser plus an independent WebSocket guest.',
    'Safe flat floor and overhead attachment platform are test fixtures. Isolated direction cases reposition the active worm and extend fuel to 60 seconds so automation/capture latency cannot exhaust it. This is test-only; configured gameplay fuel remains six seconds.',
    'A separate fresh UI activation verifies the full six-second fuel lifetime without any fixture refill.',
    'Separate minimal WebKit regression: three trusted 80 ms presses yielded zero clicks while the same button textContent was rewritten every 16 ms; keeping the text node stable yielded three clicks. Arsenal and release presses here last 140 ms across multiple live snapshots.',
    'After fuel expiry, one documented test ammunition refill isolates the last-charge primary-button shutdown regression. That case must consume the added charge exactly once and shut down through the UI with zero ammunition remaining.',
    kind === 'chromium'
      ? 'Chrome uses trusted CDP touch events, including simultaneous horizontal/vertical joystick contacts and movement/fire contacts.'
      : 'WebKit uses actual mouse PointerEvents in a mobile layout plus explicit pointercancel/blur events. Diagonal flight combines A/D with the vertical joystick because one real mouse pointer cannot hold two pads. It does not claim trusted multitouch or a physical iPhone.',
    'Renderer.setState and Game.action are observed without replacing their behavior. Releases are compared immediately before/after authoritative action processing.',
  ],
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = (value) => JSON.parse(JSON.stringify(value));
async function until(predicate, message, timeout = 5000) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeout) throw new Error(message);
    await pause(20);
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
  received = [],
  accepted = [],
  contacts = new Map(),
  heldKeys = new Set();
let contactId = 10,
  mouseHeld = false;
const actions = () => sent.filter((message) => message.type === 'action').map((message) => message.action);
const fireCount = () => actions().filter((action) => action.type === 'fire').length;
const snapshot = () => ({
  x: owner.x,
  y: owner.y,
  vx: owner.vx,
  vy: owner.vy,
  hp: owner.hp,
  facing: owner.facing,
  aim: owner.aim,
  jetpack: owner.jetpack,
  fuel: owner.fuel,
  thrustX: owner.thrustX,
  thrustY: owner.thrustY,
  rope: owner.rope ? { ...owner.rope } : null,
  input: { ...game._input },
  elapsed: game.elapsed,
  turn: { ...game.turn },
});
const point = (id, x, y) => ({ id, x: Math.round(x), y: Math.round(y), radiusX: 7, radiusY: 7, force: 1 });
async function bounds(selector) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, selector + ' visible');
  return box;
}
async function touch(type, points) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}
async function pressAt(x, y) {
  const id = ++contactId,
    p = point(id, x, y);
  contacts.set(id, p);
  if (cdp) await touch('touchStart', [...contacts.values()]);
  else {
    assert.equal(mouseHeld, false, 'WebKit one pointer at a time');
    await page.mouse.move(x, y);
    await page.mouse.down();
    mouseHeld = true;
  }
  return id;
}
async function moveTo(id, x, y) {
  contacts.set(id, point(id, x, y));
  if (cdp) await touch('touchMove', [...contacts.values()]);
  else await page.mouse.move(x, y);
}
async function lift(id) {
  const p = contacts.get(id);
  contacts.delete(id);
  if (cdp) await touch('touchEnd', contacts.size ? [p] : []);
  else {
    await page.mouse.up();
    mouseHeld = false;
  }
}
async function releaseKeys() {
  for (const key of heldKeys) await page.keyboard.up(key);
  heldKeys.clear();
}
async function cancelPointers() {
  const held = contacts.size > 0;
  contacts.clear();
  if (cdp) {
    if (held) await touch('touchCancel', []);
  } else {
    await page.evaluate(() => {
      for (const selector of ['#move-stick', '#aim-stick', '#fire']) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const event = __mobilityTouches.pointers.findLast(
          (e) => e.type === 'pointerdown' && e.target === el.id,
        );
        if (event)
          el.dispatchEvent(
            new PointerEvent('pointercancel', { pointerId: event.id, pointerType: 'mouse', bubbles: true }),
          );
      }
    });
    if (mouseHeld) await page.mouse.up();
    mouseHeld = false;
  }
  await releaseKeys();
}
async function tap(selector, holdMs = 45) {
  const box = await bounds(selector),
    id = await pressAt(box.x + box.width / 2, box.y + box.height / 2);
  await pause(holdMs);
  await lift(id);
}
async function axisStick(selector, value) {
  const box = await bounds(selector),
    knob = await page.locator(selector + ' .stick-knob').evaluate((el) => el.offsetWidth),
    radius = (Math.min(box.width, box.height) - knob) / 2;
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2,
    id = await pressAt(cx, cy);
  await moveTo(
    id,
    cx + (selector === '#move-stick' ? value * radius : 0),
    cy + (selector === '#aim-stick' ? value * radius : 0),
  );
  return id;
}
async function stick(x, y) {
  const ids = [];
  if (x && y && !cdp) {
    const key = x < 0 ? 'a' : 'd';
    heldKeys.add(key);
    await page.keyboard.down(key);
  } else if (x) ids.push(await axisStick('#move-stick', x));
  if (y) ids.push(await axisStick('#aim-stick', y));
  return { ids };
}
async function stopStick(s) {
  for (const id of s.ids) await lift(id);
  await releaseKeys();
  await pause(90);
}
async function setWeapon(id) {
  await tap('#arsenal', 140);
  await page.locator(`[data-weapon=${id}]`).click();
  await page.locator('#arsenal-equip').click();
  await page.evaluate(() => document.activeElement?.blur());
  await pause(100);
}
async function openSettings() {
  await page.locator('#hud-menu').click();
  await page.locator('[data-settings]').click();
}
async function setAim(degrees) {
  const target = Math.asin(Math.sin((degrees * Math.PI) / 180));
  const elevation = () => page.evaluate(() => Math.asin(Math.sin(__mobilityRenderer.view.angle)));
  const initial = await elevation();
  if (Math.abs(initial - target) < 0.025) return;
  const direction = Math.sign(target - initial),
    s = await stick(0, direction * 0.65);
  await until(
    async () => direction * ((await elevation()) - target) >= -0.018,
    'Joystick reaches requested elevation',
    5000,
  );
  await stopStick(s);
  await pause(120);
}
async function camera() {
  await page.evaluate(() => {
    const r = __mobilityRenderer,
      w = r.state.worms.find((w) => w.id === r.state.turn.wormId);
    r.autoFollow = false;
    r.fullView = false;
    r.camera = { x: w.x, y: w.y - 35, zoom: 1.35 };
    r.cameraGoal = { ...r.camera };
  });
}
async function capture(name) {
  await camera();
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    __mobilityRenderer.draw(performance.now());
  });
  await page.screenshot({ path: fileURLToPath(new URL(`mobility-${kind}-${name}.png`, folder)) });
}
async function arrange({ air = true, refill = false } = {}) {
  await cancelPointers();
  Object.assign(owner, { x: 800, y: air ? 450 : 639, vx: 0, vy: 0, hp: 100, grounded: !air });
  game._input = {};
  if (refill) {
    owner.fuel = 60;
    report.fixtureRefills = (report.fixtureRefills || 0) + 1;
  }
  await pause(130);
  await camera();
}
async function neutral(label) {
  await until(
    () => ['move', 'thrustX', 'thrustY', 'reel'].every((key) => !game._input[key]),
    label + ' neutral reaches server',
  );
  const knobs = await page.locator('#move-stick,#aim-stick').evaluateAll((elements) =>
    elements.map((el) => ({
      id: el.id,
      x: el.style.getPropertyValue('--stick-x'),
      y: el.style.getPropertyValue('--stick-y'),
      held: el.classList.contains('is-held'),
    })),
  );
  assert.equal(knobs.length, 2);
  for (const knob of knobs) {
    assert.equal(knob.held, false, label + ' ' + knob.id);
    assert.equal(parseFloat(knob.x), 0, label + ' ' + knob.id);
    assert.equal(parseFloat(knob.y), 0, label + ' ' + knob.id);
  }
  return knobs;
}
async function releaseAndCheck(label) {
  const start = accepted.length;
  await tap('#release', 140);
  await until(
    () => accepted.slice(start).some((entry) => entry.action.type === 'release' && entry.result.ok),
    label + ' release accepted',
  );
  const event = accepted.slice(start).find((entry) => entry.action.type === 'release');
  assert.equal(event.before.vx, event.after.vx);
  assert.equal(event.before.vy, event.after.vy);
  assert.equal(event.after.jetpack, false);
  assert.equal(event.after.rope, null);
  report.cases.push({ name: label, event });
}
try {
  await mkdir(folder, { recursive: true });
  report.sourceSHA256 = await hashes();
  app = await createServer({ dev: true });
  browser = await (kind === 'webkit' ? webkit : chromium).launch(
    kind === 'webkit' ? { headless: true } : { headless: true, channel: 'chrome' },
  );
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
    ws.on('framereceived', ({ payload }) => {
      try {
        received.push(JSON.parse(String(payload)));
      } catch {}
    });
  });
  await page.addInitScript(() => {
    window.__mobilityTouches = { max: 0, pointers: [] };
    document.addEventListener(
      'touchstart',
      (e) => (__mobilityTouches.max = Math.max(__mobilityTouches.max, e.touches.length)),
      { capture: true, passive: true },
    );
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click'])
      document.addEventListener(
        type,
        (e) => {
          __mobilityTouches.pointers.push({
            type: e.type,
            id: e.pointerId,
            target: e.target.closest('button')?.id || e.target.id,
            pointerType: e.pointerType,
            trusted: e.isTrusted,
            x: e.clientX,
            y: e.clientY,
          });
        },
        true,
      );
  });
  await page.goto(`http://127.0.0.1:${app.port}/`);
  await page.waitForFunction(() => document.querySelector('#connection')?.hidden);
  await page.evaluate(async () => {
    const { Renderer } = await import('/client/renderer.js');
    const original = Renderer.prototype.setState;
    Renderer.prototype.setState = function (...args) {
      window.__mobilityRenderer = this;
      return original.apply(this, args);
    };
  });
  await page.locator('#player-name').fill('Movilidad');
  await page.getByRole('button', { name: 'Crear sala privada →' }).click();
  await page.locator('#ready').waitFor();
  const identity = received.find((message) => message.type === 'welcome');
  guest = await NetworkClient.connect(app.port);
  await guest.command('join', { code: identity.code, name: 'Observa' });
  await guest.command('ready', { ready: true });
  await page.locator('#ready').click();
  await page.locator('#start').click();
  await until(() => guest.room?.phase === 'loading', 'Guest loading');
  await guest.command('loaded');
  await page.locator('#move-stick').waitFor();
  await page.waitForFunction(
    () => window.__mobilityRenderer?.pixi?.active && !document.querySelector('#fire').disabled,
  );
  game = app.rooms.get(identity.code).game;
  owner = game._active();
  game.terrain.data.fill(0);
  game.terrain.rect(0, 650, 1600, 250);
  game.terrain.rect(600, 230, 400, 20);
  game.terrain.revision++;
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
      thrustX: 0,
      thrustY: 0,
    }),
  );
  game.turn.remaining = 240;
  game._input = {};
  const originalAction = game.action;
  game.action = function (player, action) {
    const before = snapshot(),
      result = originalAction.call(this, player, action);
    accepted.push({ action: clone(action), result: clone(result), before, after: snapshot() });
    return result;
  };
  await until(
    () => received.filter((m) => m.type === 'state').at(-1)?.state.terrainRevision === game.terrain.revision,
    'Fixture arrives',
  );
  await page.bringToFront();
  cdp = kind === 'chromium' ? await context.newCDPSession(page) : null;

  await arrange();
  await setWeapon('jetpack');
  await tap('#fire');
  await until(() => owner.jetpack, 'UI activates jetpack');
  assert.ok(owner.fuel > 5.7 && owner.fuel <= 6);
  await page.waitForFunction(() => document.querySelector('#aim-stick').dataset.mode === 'jetpack');
  for (const [name, x, y] of [
    ['up', 0, -1],
    ['down', 0, 1],
    ['left', -1, 0],
    ['right', 1, 0],
    ['diagonal', 0.8, -0.8],
    ['analog', 0.5, 0],
  ]) {
    await arrange({ refill: true });
    const start = accepted.length,
      s = await stick(x, y);
    Object.assign(owner, { x: 800, y: 450, vx: 0, vy: 0, grounded: false });
    const before = snapshot();
    await pause(550);
    const during = snapshot();
    const axis = x ? 'thrustX' : 'thrustY',
      coordinate = x ? 'x' : 'y',
      sign = Math.sign(x || y);
    assert.ok(
      (during[coordinate] - before[coordinate]) * sign > (name === 'analog' ? 15 : 38),
      name + ' moves',
    );
    assert.ok(
      accepted
        .slice(start)
        .some((e) => e.action.type === 'input' && e.action[axis] * sign > 0.3 && e.result.ok),
      name + ' accepted analog control',
    );
    if (name === 'analog')
      assert.ok(Math.abs(during.input.thrustX) > 0.2 && Math.abs(during.input.thrustX) < 0.7);
    if (name === 'diagonal') {
      assert.ok(during.vx > 60 && during.vy < -60);
      assert.ok(Math.hypot(during.thrustX, during.thrustY) <= 1.00001);
    }
    if (name === 'up' || name === 'diagonal') await capture('jetpack-' + name);
    await stopStick(s);
    await neutral(name);
    report.cases.push({ name: 'jetpack-' + name, before, during, after: snapshot() });
  }
  await arrange({ refill: true });
  let s = await stick(1, 0);
  await pause(350);
  const powered = snapshot();
  await stopStick(s);
  const earlyBrake = snapshot();
  await pause(550);
  const braked = snapshot();
  assert.ok(earlyBrake.vx > 0 && earlyBrake.vx < powered.vx);
  assert.ok(braked.vx < earlyBrake.vx * 0.3);
  assert.equal(braked.jetpack, true);
  report.cases.push({ name: 'flight-neutral-brake', powered, earlyBrake, braked });
  await arrange({ refill: true });
  const beforeKeyboard = await page.evaluate(() => __mobilityRenderer.view.angle);
  for (const [key, sign] of [
    ['ArrowUp', -1],
    ['ArrowDown', 1],
  ]) {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.down(key);
    await pause(400);
    assert.equal(Math.sign(game._input.thrustY), sign);
    await page.keyboard.up(key);
    report.cases.push({ name: 'flight-' + key, after: snapshot() });
  }
  assert.ok(Math.abs((await page.evaluate(() => __mobilityRenderer.view.angle)) - beforeKeyboard) < 1e-8);
  await releaseAndCheck('jetpack-release-momentum');
  await neutral('jetpack-release');
  await arrange({ air: false });
  await setWeapon('jetpack');
  const started = game.elapsed;
  await tap('#fire');
  await until(() => owner.jetpack, 'Second UI activation');
  assert.ok(owner.fuel > 5.7 && owner.fuel <= 6);
  await until(() => !owner.jetpack, 'Six seconds fuel expire', 8000);
  const fuelDuration = game.elapsed - started;
  assert.ok(fuelDuration >= 5.9 && fuelDuration < 6.25);
  assert.equal(owner.fuel, 0);
  assert.ok(game.events.some((event) => event.type === 'fuelEmpty'));
  report.cases.push({ name: 'unmodified-fuel-lifetime', seconds: fuelDuration, after: snapshot() });
  report.checks.push(
    'Jetpack UI activation, separate horizontal/vertical pads, all directions, diagonal/partial input, neutral braking, contextual keyboard, release momentum and unmodified six-second fuel lifetime',
  );

  const player = game.players.find((player) => player.id === game.turn.playerId);
  assert.equal(player.ammo.jetpack, 0);
  player.ammo.jetpack = 1;
  report.fixtureAmmoRefills = 1;
  await pause(150);
  await tap('#fire');
  await until(() => owner.jetpack, 'Last-charge jetpack activation');
  assert.equal(player.ammo.jetpack, 0);
  await page.waitForFunction(
    () =>
      document.querySelector('#fire-text').textContent === 'APAGAR' &&
      !document.querySelector('#fire').disabled,
  );
  const offStart = accepted.length;
  await tap('#fire');
  await until(() => !owner.jetpack, 'Primary button shuts down with zero ammo');
  const shutdown = accepted
    .slice(offStart)
    .find((entry) => entry.action.type === 'release' && entry.result.ok);
  assert.ok(shutdown);
  assert.equal(shutdown.before.vx, shutdown.after.vx);
  assert.equal(shutdown.before.vy, shutdown.after.vy);
  assert.equal(player.ammo.jetpack, 0);
  assert.equal(game.turn.shots, 0);
  report.cases.push({ name: 'last-charge-primary-shutdown', event: shutdown, ammo: player.ammo.jetpack });
  report.checks.push(
    'The primary APAGAR button stays enabled on the last jetpack charge and releases it without another ammunition charge or attack',
  );

  await arrange();
  await setWeapon('rope');
  await setAim(-90);
  await tap('#fire');
  await until(() => owner.rope, 'Rope attaches to actual fixture terrain');
  assert.ok(game.terrain.solid(owner.rope.x, owner.rope.y));
  await page.waitForFunction(() => document.querySelector('#aim-stick').dataset.mode === 'rope');
  let before = snapshot();
  s = await stick(0, -1);
  await pause(650);
  let during = snapshot();
  assert.ok(during.rope.length < before.rope.length - 35 && during.y < before.y - 30);
  await capture('rope-reel-up');
  await stopStick(s);
  report.cases.push({ name: 'rope-reel-up', before, during });
  await pause(180);
  before = snapshot();
  s = await stick(0, 1);
  await pause(800);
  during = snapshot();
  assert.ok(during.rope.length > before.rope.length + 45 && during.y > before.y + 25);
  await capture('rope-reel-down');
  await stopStick(s);
  report.cases.push({ name: 'rope-reel-down', before, during });
  const beforeRopeAim = await page.evaluate(() => __mobilityRenderer.view.angle);
  for (const [key, sign] of [
    ['ArrowUp', -1],
    ['ArrowDown', 1],
  ]) {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.down(key);
    await pause(300);
    assert.equal(Math.sign(game._input.reel), sign);
    await page.keyboard.up(key);
  }
  assert.ok(Math.abs((await page.evaluate(() => __mobilityRenderer.view.angle)) - beforeRopeAim) < 1e-8);
  before = snapshot();
  s = await stick(1, 0);
  await pause(650);
  during = snapshot();
  assert.ok(during.x > before.x + 20 && during.vx > 30);
  await capture('rope-swing');
  await stopStick(s);
  await releaseAndCheck('rope-release-momentum');
  report.cases.push({ name: 'rope-swing', before, during });
  report.checks.push(
    'Real terrain attachment; right joystick shortens and extends rope with visible ascent/descent; contextual arrows reel; left joystick impulse swings; release preserves exact server velocity',
  );

  await arrange({ air: false });
  await setWeapon('bazooka');
  await setAim(-45);
  const aimBefore = await page.evaluate(() => __mobilityRenderer.view.angle);
  await page.keyboard.down('ArrowUp');
  await pause(300);
  await page.keyboard.up('ArrowUp');
  assert.ok((await page.evaluate(() => __mobilityRenderer.view.angle)) < aimBefore - 0.08);
  assert.equal(game._input.thrustY, 0);
  await setAim(-45);
  const noFire = fireCount();
  s = await stick(1, 0);
  if (cdp) {
    const b = await bounds('#fire');
    await pressAt(b.x + b.width / 2, b.y + b.height / 2);
    await pause(180);
    assert.ok(await page.locator('#fire').evaluate((el) => el.classList.contains('is-charging')));
    await cancelPointers();
  } else {
    await cancelPointers();
    await neutral('pointer-cancel');
    const b = await bounds('#fire');
    await pressAt(b.x + b.width / 2, b.y + b.height / 2);
    await pause(180);
    await page.evaluate(() =>
      document
        .querySelector('#fire')
        .dispatchEvent(
          new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true }),
        ),
    );
    await cancelPointers();
  }
  await neutral('cancel');
  assert.equal(fireCount(), noFire);
  assert.equal(await page.locator('#power-text').textContent(), 'MANTÉN Y SUELTA');
  for (const reason of ['blur', 'dialog', 'orientation']) {
    s = await stick(1, 0);
    await pause(100);
    assert.ok(game._input.move > 0.9);
    if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (reason === 'dialog') await page.evaluate(() => document.querySelector('#hud-menu').click());
    if (reason === 'orientation') await page.setViewportSize({ width: 390, height: 844 });
    await neutral(reason);
    assert.equal(fireCount(), noFire);
    await cancelPointers();
    if (reason === 'dialog') await page.locator('dialog .dialog-head button').click();
    if (reason === 'orientation') {
      assert.equal(await page.locator('.rotate-overlay').isVisible(), true);
      await page.setViewportSize({ width: 844, height: 390 });
    }
    await pause(120);
  }
  report.touchEvents = await page.evaluate(() => __mobilityTouches);
  if (cdp) {
    assert.equal(report.touchEvents.max, 2);
    assert.ok(
      report.touchEvents.pointers.some(
        (e) => e.trusted && e.pointerType === 'touch' && e.type === 'pointercancel',
      ),
    );
  }
  report.checks.push(
    'Ordinary arrows still aim; cancel/blur/dialog/orientation center all axes and never fire; Chrome additionally verifies two trusted simultaneous touch contacts',
  );

  for (const hand of ['right', 'left']) {
    await openSettings();
    await page.locator('#hand').selectOption(hand);
    await page.locator('dialog .dialog-head button').click();
    for (const [width, height] of [
      [568, 320],
      [667, 375],
      [844, 390],
      [936, 432],
    ]) {
      await page.setViewportSize({ width, height });
      await pause(160);
      const layout = await page.evaluate(() => {
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        };
        const controls = [...document.querySelectorAll('.control-deck button,.control-deck input')]
          .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
          .map((el) => ({ id: el.id || el.dataset.hold, ...rect(el), disabled: el.disabled }));
        return {
          width: innerWidth,
          height: innerHeight,
          controls,
          field: rect(document.querySelector('#field')),
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      for (const b of layout.controls) {
        assert.ok(
          b.width >= 43.9 && b.height >= 43.9,
          `${hand}/${width}: ${b.id} touch target ${b.width}×${b.height}`,
        );
        assert.ok(
          b.x >= -0.5 && b.y >= -0.5 && b.right <= width + 0.5 && b.bottom <= height + 0.5,
          `${hand}/${width}: ${b.id} inside viewport`,
        );
      }
      for (let i = 0; i < layout.controls.length; i++)
        for (let j = i + 1; j < layout.controls.length; j++) {
          const a = layout.controls[i],
            b = layout.controls[j],
            overlapX = Math.min(a.right, b.right) - Math.max(a.x, b.x),
            overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
          assert.ok(overlapX < 0.5 || overlapY < 0.5, `${hand}/${width}: ${a.id}/${b.id} overlap`);
        }
      assert.ok(layout.scrollWidth <= width);
      assert.ok(layout.field.height >= 140, `${hand}/${width}: useful battlefield height`);
      report.layouts.push({ hand, ...layout });
      await capture(`${hand}-${width}x${height}`);
    }
  }
  report.checks.push(
    'All gameplay touch targets stay at least 44 px, visible and nonoverlapping at 568×320, 667×375, 844×390, 936×432 in both handed layouts',
  );
  report.rejectedActions = accepted.filter((entry) => !entry.result.ok);
  assert.deepEqual(report.rejectedActions, []);
  assert.deepEqual(report.errors, []);
  report.finalSourceSHA256 = await hashes();
  assert.deepEqual(
    report.finalSourceSHA256,
    report.sourceSHA256,
    'Product sources stayed unchanged during final run',
  );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  if (owner) report.lastState = snapshot();
  if (page) {
    report.lastActions = actions().slice(-12);
    report.touchEvents = await page.evaluate(() => __mobilityTouches).catch(() => null);
    report.releaseButton = await page
      .locator('#release')
      .evaluate((el) => ({
        disabled: el.disabled,
        html: el.outerHTML,
        rect: el.getBoundingClientRect().toJSON(),
      }))
      .catch(() => null);
    await page
      .screenshot({ path: fileURLToPath(new URL(`mobility-${kind}-failure.png`, folder)) })
      .catch(() => {});
  }
  throw error;
} finally {
  if (report.passed) await unlink(new URL(`mobility-${kind}-failure.png`, folder)).catch(() => {});
  await writeFile(new URL(`mobility-${kind}.json`, folder), JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        browser: kind,
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
