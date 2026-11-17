/* Browser fixture globals supplied explicitly by the inline harness. */
/* global __touchEvidence */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from '../server/index.js';
import { NetworkClient, waitFor } from './network-smoke.js';

const app = await createServer({ dev: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const guest = await NetworkClient.connect(app.port);
const received = [],
  sent = [];
const report = {
  method:
    'Chrome CDP Input.dispatchTouchEvent with two simultaneous touch points; no mouse events for measured gestures',
  browser: 'chromium',
  version: browser.version(),
  platform: process.platform,
  physicalDevice: false,
  viewport: { width: 844, height: 390 },
  checks: [],
  errors: [],
  doubleTaps: [],
  notes: [
    'Chrome mobile emulation with trusted touch events; not a physical Safari/iPhone verification.',
    'A test-only 120-second turn keeps UI gesture checks in one turn; production turn duration is unchanged.',
  ],
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
page.on('pageerror', (error) => report.errors.push(error.message));
page.on('websocket', (ws) => {
  if (!ws.url().endsWith('/socket')) return;
  ws.on('framereceived', ({ payload }) => {
    try {
      received.push(JSON.parse(String(payload)));
    } catch {}
  });
  ws.on('framesent', ({ payload }) => {
    try {
      sent.push(JSON.parse(String(payload)));
    } catch {}
  });
});
await page.addInitScript(() => {
  window.__touchEvidence = { maxTouches: 0, events: [] };
  document.addEventListener(
    'touchstart',
    (event) => {
      window.__touchEvidence.maxTouches = Math.max(window.__touchEvidence.maxTouches, event.touches.length);
    },
    { passive: true, capture: true },
  );
  for (const type of ['pointerdown', 'pointerup', 'pointercancel'])
    document.addEventListener(
      type,
      (event) => {
        window.__touchEvidence.events.push({
          type,
          trusted: event.isTrusted,
          pointerType: event.pointerType,
          pointerId: event.pointerId,
          target: event.target.id || event.target.dataset.hold || event.target.tagName,
        });
      },
      true,
    );
});
const cdp = await context.newCDPSession(page);
const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
const point = (id, x, y) => ({ id, x: Math.round(x), y: Math.round(y), radiusX: 8, radiusY: 8, force: 1 });
const center = async (selector, id) => {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box && box.width >= 44 && box.height >= 44);
  return point(id, box.x + box.width / 2, box.y + box.height / 2);
};
const moveRight = async (id) => {
  const box = await page.locator('#move-stick').boundingBox();
  return point(id, box.x + box.width - 3, box.y + box.height / 2);
};
const aimDown = async (id) => {
  const box = await page.locator('#aim-stick').boundingBox();
  return point(id, box.x + box.width / 2, box.y + box.height - 3);
};
const tap = async (selector) => {
  await touch('touchStart', [await center(selector, 40)]);
  await pause(70);
  await touch('touchEnd', []);
};
const sourcePaths = [
  'client/style.css',
  'client/main.js',
  'client/renderer.js',
  'client/mobile-controls.js',
  'client/combat-hud.css',
];
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(new URL('../' + file, import.meta.url)))
          .digest('hex'),
      ]),
    ),
  );
const viewportState = () =>
  page.evaluate(() => ({
    scale: visualViewport?.scale ?? 1,
    width: visualViewport?.width,
    height: visualViewport?.height,
    innerWidth,
    zoom: window.__touchRenderer?.cameraGoal.zoom,
    zoomCalls: window.__pinchZooms?.length ?? 0,
    meta: document.querySelector('meta[name="viewport"]')?.content,
  }));
async function doubleTapAt(name, x, y) {
  const before = await viewportState(),
    eventStart = await page.evaluate(() => __touchEvidence.events.length);
  for (let i = 0; i < 2; i++) {
    await touch('touchStart', [point(60 + i, x, y)]);
    await pause(55);
    await touch('touchEnd', []);
    if (i === 0) await pause(85);
  }
  await pause(450);
  const after = await viewportState();
  assert.ok(Math.abs(after.scale - before.scale) < 0.001, name + ' never zooms the page');
  if (before.zoom !== undefined) {
    assert.ok(Math.abs(after.zoom - before.zoom) < 0.0001, name + ' never accidentally zooms the map');
    assert.equal(after.zoomCalls, before.zoomCalls, name + ' does not invoke map zoom');
  }
  const events = await page.evaluate((start) => __touchEvidence.events.slice(start), eventStart);
  assert.equal(
    events.filter((e) => e.type === 'pointerdown' && e.pointerType === 'touch' && e.trusted).length,
    2,
    name + ' two trusted presses',
  );
  assert.equal(
    events.filter((e) => e.type === 'pointerup' && e.pointerType === 'touch' && e.trusted).length,
    2,
    name + ' two trusted releases',
  );
  report.doubleTaps.push({ name, before, after, events });
}
async function doubleTap(selector, name = selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = await page.locator(selector).boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0);
  await doubleTapAt(name, box.x + box.width / 2, box.y + box.height / 2);
}
const latest = () => received.filter((message) => message.type === 'state').at(-1)?.state;
const actions = () => sent.filter((message) => message.type === 'action');
const fireActions = () => actions().filter((message) => message.action.type === 'fire');
try {
  report.sourceSHA256 = await hashes();
  await page.goto(`http://127.0.0.1:${app.port}`);
  await doubleTap('#home-title', 'Home title surface');
  assert.doesNotMatch(
    (await viewportState()).meta,
    /user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:[\s,;]|$)/i,
    'Viewport keeps intentional browser zoom available',
  );
  report.touchAction = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).touchAction,
    body: getComputedStyle(document.body).touchAction,
  }));
  await page.evaluate(async () => {
    const { Renderer } = await import('/client/renderer.js');
    window.__pinchZooms = [];
    const state = Renderer.prototype.setState;
    Renderer.prototype.setState = function (...args) {
      window.__touchRenderer = this;
      return state.apply(this, args);
    };
    const zoom = Renderer.prototype.zoomAt;
    Renderer.prototype.zoomAt = function (...args) {
      const before = this.cameraGoal.zoom,
        result = zoom.apply(this, args);
      window.__pinchZooms.push({ before, after: this.cameraGoal.zoom });
      return result;
    };
  });
  await page.locator('#player-name').fill('Dos pulgares');
  await page.waitForFunction(() => document.querySelector('#connection')?.hidden);
  await page.getByRole('button', { name: 'Crear sala privada →' }).click();
  await page.locator('#ready').waitFor();
  const identity = received.find((message) => message.type === 'welcome');
  await guest.command('join', { code: identity.code, name: 'Rival' });
  await guest.command('ready', { ready: true });
  await page.locator('#ready').click();
  await page.locator('#start').click();
  await waitFor(() => guest.room.phase === 'loading');
  await guest.command('loaded');
  await page.locator('#field').waitFor();
  await page.waitForFunction(() => !document.querySelector('#fire').disabled);
  await waitFor(() => latest());
  const room = app.rooms.get(identity.code);
  room.game.turn.remaining = 120;
  report.fixtureTurnSeconds = 120;
  // Deterministic movement fixture (test only). A random spawn can leave the shooter under a
  // slope that catches the low bazooka shot and knocks it back, so the final movement check
  // would depend on luck. Only the floor and the worm positions are arranged here; the game
  // rules, weapons, input paths and client code are untouched.
  const game = room.game,
    active = game.worms.find((worm) => worm.id === game.turn.wormId),
    others = [];
  let column = 0;
  game.terrain.data.fill(0);
  game.terrain.rect(0, 650, 1600, 250);
  game.terrain.revision++;
  for (const worm of game.worms) {
    Object.assign(worm, {
      x: worm === active ? 800 : 100 + column++ * 90,
      y: 639,
      vx: 0,
      vy: 0,
      grounded: true,
      rope: null,
      jetpack: false,
    });
    if (worm !== active) others.push({ id: worm.id, x: worm.x, y: worm.y });
  }
  report.fixture = {
    turnSeconds: 120,
    floor: { x: 0, y: 650, width: 1600, height: 250 },
    activeWorm: { id: active.id, x: 800, y: 639 },
    otherWorms: others,
    replaced:
      'Only the terrain (flat floor) and the worm positions are arranged for the run; nothing else is replaced.',
  };
  report.notes.push(
    'Test-only fixture: after the real match starts, the terrain is cleared and replaced by a flat floor (y=650) and the worms are placed on it (active worm at x=800, others spaced to the left) so the final movement check does not depend on the random spawn. Nothing else is replaced: rules, weapons, server, client and input paths are the production ones.',
  );
  await waitFor(() => {
    const state = latest();
    const worm = state?.worms.find((w) => w.id === state.turn.wormId);
    return (
      state?.terrainRevision === game.terrain.revision &&
      !!worm &&
      Math.abs(worm.x - 800) < 1 &&
      Math.abs(worm.y - 639) < 4
    );
  });
  const initialX = latest().worms.find((worm) => worm.id === latest().turn.wormId).x;

  await doubleTap('.turn-block', 'Floating HUD surface');
  await doubleTap('#aim-stick', 'Vertical control center');
  const field = await page.locator('#field').boundingBox();
  await doubleTapAt('Battlefield', field.x + field.width * 0.5, field.y + field.height * 0.38);
  await tap('#arsenal');
  await page.locator('.arsenal-dialog[open]').waitFor();
  await doubleTap('.arsenal-heading h2', 'Arsenal title surface');
  const equipped = await page.locator('#equipped-name').textContent();
  await doubleTap('[data-weapon="grenade"]', 'Weapon preview control');
  assert.equal(
    await page.locator('.arsenal-dialog[open]').count(),
    1,
    'Double-tapping a weapon only inspects it',
  );
  assert.equal(
    await page.locator('#equipped-name').textContent(),
    equipped,
    'Double tap does not confirm equipment',
  );
  report.touchAction.dialog = await page.locator('.arsenal-dialog').evaluate((el) => ({
    dialog: getComputedStyle(el).touchAction,
    body: getComputedStyle(el.querySelector('.dialog-body')).touchAction,
  }));
  await tap('.arsenal-close');
  await page.locator('.arsenal-dialog').waitFor({ state: 'detached' });
  assert.equal(fireActions().length, 0, 'Double taps never attack');
  report.checks.push(
    'Trusted rapid double taps on home, HUD, control, battlefield and arsenal surfaces preserve visual viewport scale and map zoom; weapon preview still requires explicit Equipar',
  );

  // A two-finger canvas gesture while a target weapon is selected must only move the camera.
  await page.locator('#arsenal').click();
  await page.locator('[data-weapon=airstrike]').click();
  await page.locator('#arsenal-equip').click();
  const canvas = await page.locator('#field').boundingBox();
  const cy = canvas.y + canvas.height * 0.38;
  let first = point(11, canvas.x + canvas.width * 0.42, cy);
  let second = point(12, canvas.x + canvas.width * 0.58, cy);
  const beforePinch = sent.length,
    pageBeforePinch = await viewportState();
  await touch('touchStart', [first]);
  await touch('touchStart', [first, second]);
  for (let step = 1; step <= 4; step++) {
    first = point(11, canvas.x + canvas.width * (0.42 - step * 0.025), cy);
    second = point(12, canvas.x + canvas.width * (0.58 + step * 0.025), cy);
    await touch('touchMove', [first, second]);
    await pause(35);
  }
  await touch('touchEnd', [second]);
  await touch('touchEnd', []);
  await pause(100);
  const pinchTraffic = sent.slice(beforePinch).filter((message) => message.type === 'action');
  assert.ok(
    pinchTraffic.every(
      (message) =>
        message.action.type === 'input' &&
        message.action.move === 0 &&
        message.action.thrustX === 0 &&
        message.action.thrustY === 0 &&
        message.action.reel === 0,
    ),
  );
  assert.ok(
    Math.abs((await viewportState()).scale - pageBeforePinch.scale) < 0.001,
    'Canvas pinch changes camera, not page scale',
  );
  const zooms = await page.evaluate(() => window.__pinchZooms);
  assert.ok(zooms.some((zoom) => Math.abs(zoom.after - zoom.before) > 0.001));
  await tap('#fire');
  await page.waitForFunction(() =>
    document.querySelector('#toast')?.textContent.includes('Primero toca un destino'),
  );
  assert.equal(fireActions().length, 0);
  report.checks.push(
    'Two real touch pointers pinch the canvas: camera zoom changes, no combat action or destination selected; only neutral periodic input remains',
  );
  report.pinchZoom = { before: zooms[0].before, after: zooms.at(-1).after };
  const beforeButtons = await viewportState();
  await tap('#zoom-in');
  await pause(80);
  const afterIn = await viewportState();
  await tap('#zoom-out');
  await pause(80);
  const afterOut = await viewportState();
  assert.ok(afterIn.zoom > beforeButtons.zoom, 'Zoom-in button still enlarges the map');
  assert.ok(afterOut.zoom < afterIn.zoom, 'Zoom-out button still reduces the map');
  assert.ok(Math.abs(afterOut.scale - beforeButtons.scale) < 0.001, 'Camera buttons preserve page scale');
  report.cameraButtons = { before: beforeButtons, afterIn, afterOut };
  report.checks.push(
    'Canvas two-finger pinch and camera +/− continue to zoom the map while page scale stays unchanged',
  );
  await page.screenshot({ path: new URL('../docs/evidence/touch-map-zoom.png', import.meta.url).pathname });

  await page.locator('#arsenal').click();
  await page.locator('[data-weapon=bazooka]').click();
  await page.locator('#arsenal-equip').click();
  const beforeAim = latest().worms.find((worm) => worm.id === latest().turn.wormId).aim;
  const moveAndAim = [await moveRight(18), await aimDown(19)];
  await touch('touchStart', [moveAndAim[0]]);
  await touch('touchStart', moveAndAim);
  await waitFor(() => latest().worms.find((worm) => worm.id === latest().turn.wormId).aim > beforeAim + 0.12);
  assert.equal(
    actions()
      .filter((message) => message.action.type === 'input')
      .at(-1).action.move,
    1,
  );
  await touch('touchCancel', []);
  await waitFor(
    () =>
      actions()
        .filter((message) => message.action.type === 'input')
        .at(-1).action.move === 0,
  );
  assert.equal(await page.locator('#move-stick.is-held,#aim-stick.is-held').count(), 0);
  assert.equal(fireActions().length, 0);
  report.checks.push(
    'Two trusted contacts independently move with the left joystick and adjust aim with the right; cancelling centers both without a shot',
  );
  let movePoint = await moveRight(21);
  let firePoint = await center('#fire', 22);
  await touch('touchStart', [movePoint]);
  await touch('touchStart', [movePoint, firePoint]);
  await pause(350);
  assert.ok(actions().some((message) => message.action.type === 'input' && message.action.move === 1));
  assert.ok(await page.locator('#fire').evaluate((el) => el.classList.contains('is-charging')));
  await touch('touchCancel', []);
  await pause(180);
  assert.equal(fireActions().length, 0);
  assert.equal(
    actions()
      .filter((message) => message.action.type === 'input')
      .at(-1).action.move,
    0,
  );
  assert.equal(await page.locator('#power-text').textContent(), 'MANTÉN Y SUELTA');
  assert.equal(
    await page
      .locator('#fire')
      .evaluate((el) => el.classList.contains('is-charging') || el.classList.contains('is-fired')),
    false,
  );
  report.checks.push(
    'Movement finger + charge finger work simultaneously; touchCancel clears both without firing',
  );

  movePoint = await moveRight(31);
  firePoint = await center('#fire', 32);
  await touch('touchStart', [movePoint]);
  await touch('touchStart', [movePoint, firePoint]);
  await pause(400);
  const beforeRelease = sent.length;
  // This Chrome CDP version interprets a nonempty touchEnd list as the released contacts.
  // Native pointer-event evidence below verifies that fire lifts while movement stays pressed.
  await touch('touchEnd', [firePoint]);
  await waitFor(() => fireActions().length === 1);
  await pause(200);
  const afterReleaseInput = sent
    .slice(beforeRelease)
    .filter((message) => message.type === 'action' && message.action.type === 'input');
  assert.ok(afterReleaseInput.length > 0 && afterReleaseInput.every((message) => message.action.move === 1));
  assert.equal(room.game.turn.shots, 1);
  await touch('touchCancel', []);
  await pause(160);
  assert.equal(
    actions()
      .filter((message) => message.action.type === 'input')
      .at(-1).action.move,
    0,
  );
  assert.equal(fireActions().length, 1);
  const finalX = room.game.worms.find((worm) => worm.id === room.game.turn.wormId).x;
  assert.ok(finalX > initialX + 10);
  report.checks.push(
    'Release only fire finger: one authoritative shot, movement finger continues during retreat; final cancellation stops movement with no second shot',
  );
  report.movementWorldPixels = Number((finalX - initialX).toFixed(2));
  const evidence = await page.evaluate(() => window.__touchEvidence);
  assert.equal(evidence.maxTouches, 2);
  const touchEvents = evidence.events.filter((event) => event.pointerType === 'touch');
  assert.ok(touchEvents.filter((event) => event.type === 'pointercancel').length >= 3);
  report.maxConcurrentTouches = evidence.maxTouches;
  report.touchPointerEvents = touchEvents;
  assert.deepEqual(report.errors, []);
  report.finalSourceSHA256 = await hashes();
  assert.deepEqual(
    report.finalSourceSHA256,
    report.sourceSHA256,
    'Product sources unchanged during touch run',
  );
  report.passed = true;
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        browser: report.browser,
        version: report.version,
        checks: report.checks,
        errors: report.errors,
        doubleTaps: report.doubleTaps.map((test) => ({
          name: test.name,
          scaleBefore: test.before.scale,
          scaleAfter: test.after.scale,
        })),
        pinchZoom: report.pinchZoom,
      },
      null,
      2,
    ),
  );
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  if (!report.passed) {
    report.debugTouch = await page.evaluate(() => window.__touchEvidence);
    report.debugActions = actions()
      .slice(-20)
      .map((message) => message.action);
    report.debugTurn = latest()?.turn;
  }
  await context.close();
  guest.close();
  await browser.close();
  await app.close();
  const folder = new URL('../docs/evidence/', import.meta.url);
  await mkdir(folder, { recursive: true });
  await writeFile(new URL('touch.json', folder), JSON.stringify(report, null, 2) + '\n');
}
