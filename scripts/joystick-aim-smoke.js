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
import { WEAPONS } from '../shared/config.js';
import { NetworkClient } from './network-smoke.js';

const kind = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const folder = new URL('../docs/evidence/', import.meta.url);
const sources = [
  'client/main.js',
  'client/mobile-controls.js',
  'client/combat-controls.js',
  'client/charge-control.js',
  'client/style.css',
  'client/combat-hud.css',
  'client/combat-hud.js',
  'client/arsenal.js',
  'client/arsenal.css',
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
    'Actual main.js UI → private ephemeral WebSocket server → authoritative Game.action; renderer/state observed without replacing their behavior.',
    'Fixtures reset safe floor/overhead terrain, active turn, worm position and ammunition between isolated cases. Flight cases extend fuel to 60 seconds so automation latency cannot exhaust it; existing mobility-smoke separately checks genuine six-second lifetime.',
    kind === 'chromium'
      ? 'Chrome uses trusted CDP touch including independent horizontal/vertical sticks and a third charge contact.'
      : 'WebKit uses real mouse PointerEvents in a mobile viewport and keyboard+pointer for simultaneous movement/aim/charge. This is not trusted multitouch or a physical iPhone test.',
    'Forced turn expiry may correctly reject an already-in-transit all-zero input while settling; these are recorded and accepted only if the full observed state stays identical. Every other rejection fails.',
    'Mobile aiming uses real joystick drags. No hidden range fill or private aim setter. Arsenal held presses cross multiple live snapshots.',
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
  forcedExpiryTurns = new Set(),
  contacts = new Map();
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
async function cancelPointers() {
  const held = contacts.size > 0;
  contacts.clear();
  if (cdp) {
    if (held) await touch('touchCancel', []);
  } else {
    await page.evaluate(() => {
      for (const selector of ['#move-stick', '#aim-stick', '#fire']) {
        const el = document.querySelector(selector);
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
}
async function tap(selector, holdMs = 45) {
  const box = await bounds(selector),
    id = await pressAt(box.x + box.width / 2, box.y + box.height / 2);
  await pause(holdMs);
  await lift(id);
}
async function dragStick(selector, x, y) {
  const box = await bounds(selector),
    knob = await page.locator(selector + ' .stick-knob').evaluate((el) => el.offsetWidth),
    radius = (Math.min(box.width, box.height) - knob) / 2;
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const id = await pressAt(cx, cy);
  await moveTo(id, cx + x * radius, cy + y * radius);
  return { id, cx, cy, radius, selector };
}
async function stick(x, y) {
  if (x && y) {
    if (cdp) return { sticks: [await dragStick('#move-stick', x, 0), await dragStick('#aim-stick', 0, y)] };
    const key = x < 0 ? 'a' : 'd';
    await page.keyboard.down(key);
    return { ...(await dragStick('#aim-stick', 0, y)), key };
  }
  return dragStick(x ? '#move-stick' : '#aim-stick', x, y);
}
async function stopStick(s) {
  if (s.sticks) {
    for (const part of s.sticks) await lift(part.id);
  } else await lift(s.id);
  if (s.key) await page.keyboard.up(s.key);
  await pause(90);
}
async function stickMode(mode) {
  assert.equal(await page.locator('#move-stick').getAttribute('data-mode'), mode);
  assert.equal(await page.locator('#aim-stick').getAttribute('data-mode'), mode);
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
  await page.screenshot({ path: fileURLToPath(new URL(`joystick-aim-${kind}-${name}.png`, folder)) });
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
  const knobs = await page.locator('#move-stick,#aim-stick').evaluateAll((els) =>
    els.map((el) => ({
      id: el.id,
      x: el.style.getPropertyValue('--stick-x'),
      y: el.style.getPropertyValue('--stick-y'),
      held: el.classList.contains('is-held'),
    })),
  );
  for (const knob of knobs) {
    assert.equal(knob.held, false, label + ' ' + knob.id);
    assert.equal(parseFloat(knob.x), 0, label + ' ' + knob.id);
    assert.equal(parseFloat(knob.y), 0, label + ' ' + knob.id);
  }
  return knobs;
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
          if (e.target.closest('#move-stick')) window.__mobilityPointerId = e.pointerId;
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
  await page.locator('#player-name').fill('Joystick');
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

  const elevation = (a) => Math.atan2(Math.sin(a), Math.abs(Math.cos(a)));
  const local = () =>
    page.evaluate(() => {
      const r = __mobilityRenderer,
        w = r.state.worms.find((w) => w.id === r.state.turn.wormId),
        a = r.pixi?.actors.get(w.id),
        origin = a?.weaponRig.toGlobal({ x: 0, y: 0 }),
        tip = a?.weaponRig.toGlobal({ x: 20, y: 0 });
      return {
        angle: r.view.angle,
        facing: r.view.facing,
        weapon: r.view.weapon,
        target: r.view.target,
        actorVisible: a?.weaponRig.visible,
        barrelAngle: origin ? Math.atan2(tip.y - origin.y, tip.x - origin.x) : null,
        displayAim: a?.displayAim,
        jetpack: w.jetpack,
        rope: w.rope,
      };
    });
  async function resetCase(name, { air = false } = {}) {
    await cancelPointers();
    game._release(owner);
    game.projectiles = [];
    game.mines = [];
    game._pendingDeaths = [];
    game.terrain.data.fill(0);
    game.terrain.rect(0, 650, 1600, 250);
    game.terrain.rect(600, 230, 400, 20);
    game.terrain.revision++;
    Object.assign(owner, {
      x: 800,
      y: air ? 450 : 639,
      vx: 0,
      vy: 0,
      hp: 100,
      grounded: !air,
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
    const player = game.players.find((p) => p.id === owner.playerId);
    for (const w of WEAPONS) player.ammo[w.id] = w.ammo;
    await page.waitForFunction(
      (number) =>
        __mobilityRenderer.state.turn.number === number && !document.querySelector('#fire').disabled,
      game.turn.number,
    );
    await pause(160);
    await camera();
    report.currentCase = name;
  }
  async function indicator() {
    return page.locator('#fire').evaluate((button) => {
      const svg = button.querySelector('.charge-indicator'),
        segments = [...svg.querySelectorAll('.charge-segment')],
        rect = (el) => el.getBoundingClientRect().toJSON(),
        style = getComputedStyle(svg);
      return {
        className: button.className,
        power: Number(button.style.getPropertyValue('--charge-power')),
        visible: style.visibility !== 'hidden' && Number(style.opacity) > 0,
        opacity: style.opacity,
        visibility: style.visibility,
        button: rect(button),
        svg: rect(svg),
        marker: rect(svg.querySelector('.charge-marker')),
        offsetStrings: segments.map((el) => getComputedStyle(el).strokeDashoffset),
        offsets: segments.map((el) =>
          Number(getComputedStyle(el).strokeDashoffset.match(/-?[0-9]+(?:[.][0-9]+)?/)[0]),
        ),
        caption: button.innerText,
      };
    });
  }
  function contained(a, b, label) {
    assert.ok(
      a.x >= b.x - 0.6 && a.y >= b.y - 0.6 && a.right <= b.right + 0.6 && a.bottom <= b.bottom + 0.6,
      label,
    );
  }
  async function beginCharge() {
    const b = await bounds('#fire');
    return pressAt(b.x + b.width / 2, b.y + b.height / 2);
  }
  async function aligned(label) {
    await pause(160);
    const v = await local();
    assert.equal(v.actorVisible, true, label + ' weapon visible');
    const delta = Math.atan2(Math.sin(v.barrelAngle - v.angle), Math.cos(v.barrelAngle - v.angle));
    assert.ok(Math.abs(delta) < 0.03, label + ' barrel follows visible aim');
    return v;
  }
  async function shoot(label) {
    const start = accepted.length,
      p = await beginCharge();
    await pause(190);
    const before = await local();
    await lift(p);
    await until(
      () =>
        accepted
          .slice(start)
          .some((e) => e.action.type === 'fire' && e.action.weapon === 'bazooka' && e.result.ok),
      label + ' accepted shot',
    );
    const event = accepted
      .slice(start)
      .find((e) => e.action.type === 'fire' && e.action.weapon === 'bazooka');
    assert.ok(Math.abs(event.action.angle - before.angle) < 0.08);
    report.cases.push({ name: label, before, event });
    await pause(360);
    assert.equal((await indicator()).visible, false, 'Confirmation is temporary');
  }

  await resetCase('mobile-ui');
  assert.equal(await page.locator('#aim').isVisible(), false);
  assert.equal(await page.locator('#angle-text').count(), 0);
  await stickMode('move');
  assert.equal((await indicator()).visible, false);
  assert.doesNotMatch(await page.locator('.control-deck').innerText(), /[°%]/);
  await capture('idle');
  assert.equal(await page.locator('#move-stick').getAttribute('data-axis'), 'x');
  assert.equal(await page.locator('#aim-stick').getAttribute('data-axis'), 'y');
  for (const [selector, x, y] of [
    ['#move-stick', 0, 0.9],
    ['#aim-stick', 0.9, 0],
  ]) {
    const before = await local(),
      pos = snapshot(),
      s = await dragStick(selector, x, y);
    await pause(260);
    const after = await local(),
      next = snapshot();
    assert.ok(Math.abs(after.angle - before.angle) < 1e-8, selector + ' ignores its forbidden aim axis');
    assert.ok(Math.abs(next.x - pos.x) < 0.1, selector + ' forbidden axis cannot move');
    assert.equal(game._input.move, 0);
    assert.equal(game._input.thrustY, 0);
    const visual = await page.locator(selector).evaluate((el) => ({
      x: parseFloat(el.style.getPropertyValue('--stick-x')),
      y: parseFloat(el.style.getPropertyValue('--stick-y')),
    }));
    assert.equal(visual.x, 0);
    assert.equal(visual.y, 0);
    await stopStick(s);
    report.cases.push({ name: 'ignored-cross-axis-' + selector, before, after, pos, next, visual });
  }
  await setAim(-35);
  let cross = await local(),
    pos = snapshot(),
    raw = await dragStick('#move-stick', 0.8, 0.8);
  await pause(220);
  assert.ok(snapshot().x > pos.x + 5);
  assert.ok(Math.abs(elevation((await local()).angle) - elevation(cross.angle)) < 1e-8);
  assert.equal(
    await page.locator('#move-stick').evaluate((el) => parseFloat(el.style.getPropertyValue('--stick-y'))),
    0,
  );
  await stopStick(raw);
  await until(() => Math.abs(owner.vx) < 0.01, 'Horizontal brake completes before isolated vertical check');
  cross = await local();
  pos = snapshot();
  raw = await dragStick('#aim-stick', 0.8, -0.6);
  await pause(220);
  assert.ok(elevation((await local()).angle) < elevation(cross.angle) - 0.1);
  assert.ok(Math.abs(snapshot().x - pos.x) < 0.1);
  assert.equal(
    await page.locator('#aim-stick').evaluate((el) => parseFloat(el.style.getPropertyValue('--stick-x'))),
    0,
  );
  await stopStick(raw);
  report.checks.push(
    'Each circular stick projects onto its assigned axis: cross-axis-only drags do nothing, diagonal drags cannot leak movement/aim or visual thumb travel',
  );
  if (cdp) {
    for (const releaseFirst of ['horizontal', 'vertical']) {
      await setAim(-20);
      const left = await dragStick('#move-stick', 0.7, 0),
        right = await dragStick('#aim-stick', 0, -0.5);
      await pause(220);
      assert.ok(game._input.move > 0.4);
      const held = await local();
      await stopStick(releaseFirst === 'horizontal' ? left : right);
      const atRelease = await local(),
        atPosition = snapshot();
      await pause(220);
      const after = await local(),
        afterPosition = snapshot();
      if (releaseFirst === 'horizontal') {
        assert.equal(game._input.move, 0);
        assert.ok(elevation(after.angle) < elevation(atRelease.angle) - 0.07);
        assert.equal(
          await page.locator('#aim-stick').evaluate((el) => el.classList.contains('is-held')),
          true,
        );
        await stopStick(right);
      } else {
        assert.ok(afterPosition.x > atPosition.x + 4);
        assert.ok(Math.abs(after.angle - atRelease.angle) < 1e-8);
        assert.equal(
          await page.locator('#move-stick').evaluate((el) => el.classList.contains('is-held')),
          true,
        );
        await stopStick(left);
      }
      await neutral(releaseFirst + ' independent release');
      report.cases.push({
        name: 'independent-release-' + releaseFirst,
        held,
        atRelease,
        after,
        atPosition,
        afterPosition,
      });
    }
    report.checks.push(
      'Two trusted touch contacts remain independent: releasing either stick preserves the other axis until its own release',
    );
  }
  for (const side of [1, -1]) {
    await setAim(-40);
    const before = await local();
    let s = await stick(side, 0);
    await pause(130);
    await stopStick(s);
    const turned = await local();
    assert.equal(turned.facing, side);
    assert.ok(Math.abs(elevation(turned.angle) - elevation(before.angle)) < 0.025);
    s = await stick(0, -0.65);
    await pause(280);
    const up = await local();
    assert.ok(elevation(up.angle) < elevation(turned.angle) - 0.1);
    assert.equal(up.facing, side);
    assert.equal(game._input.thrustY, 0);
    assert.equal(game._input.reel, 0);
    await stopStick(s);
    const released = await local();
    await pause(140);
    assert.ok(Math.abs((await local()).angle - released.angle) < 1e-6);
    s = await stick(0, 0.65);
    await pause(280);
    await stopStick(s);
    const down = await aligned('Facing ' + side);
    assert.ok(elevation(down.angle) > elevation(up.angle) + 0.1);
    assert.equal(owner.facing, side);
    assert.ok(Math.abs(owner.aim - down.angle) < 0.015);
    report.cases.push({ name: 'aim-facing-' + side, before, turned, up, released, down });
  }
  const rates = [];
  for (const amount of [0.45, 1]) {
    await setAim(-20);
    const s = await stick(0, -amount);
    const before = await local(),
      t = Date.now();
    await pause(300);
    const after = await local();
    rates.push({
      amount,
      rate: (elevation(before.angle) - elevation(after.angle)) / ((Date.now() - t) / 1000),
    });
    await stopStick(s);
  }
  assert.ok(rates[1].rate > rates[0].rate * 1.5);
  report.cases.push({ name: 'proportional-aim-rate', rates });
  for (const side of [-1, 1]) {
    await setAim(-30);
    const before = snapshot(),
      a = await local(),
      s = await stick(side * 0.75, -0.75);
    await pause(320);
    const after = snapshot(),
      v = await local();
    assert.ok((after.x - before.x) * side > 5);
    assert.ok(elevation(v.angle) < elevation(a.angle) - 0.15);
    assert.equal(after.facing, side);
    assert.equal(after.input.thrustY, 0);
    await stopStick(s);
    report.cases.push({
      name: (cdp ? 'two-sticks-move-aim-' : 'keyboard-plus-aim-stick-') + side,
      before,
      after,
      view: v,
    });
  }
  report.checks.push(
    'Joystick aims proportionally in both facings, combined horizontal/vertical controls preserve binary facing, release holds aim, visible barrel and authoritative aim agree',
  );

  await resetCase('all-weapons');
  const selected = [];
  for (const weapon of WEAPONS) {
    await setWeapon(weapon.id);
    const view = await local();
    assert.equal(view.weapon, weapon.id);
    await stickMode('move');
    assert.equal((await indicator()).visible, false);
    const s = await stick(0, 0.5),
      before = await local();
    await pause(100);
    await stopStick(s);
    assert.ok(elevation((await local()).angle) > elevation(before.angle));
    if (!weapon.power) {
      const n = fireCount();
      await beginCharge();
      await pause(130);
      assert.equal((await indicator()).visible, false, weapon.id + ' no power ring');
      await cancelPointers();
      assert.equal(fireCount(), n);
    }
    selected.push({ weapon: weapon.id, power: weapon.power });
  }
  report.cases.push({ name: 'twelve-weapon-selection-and-aim', selected });
  for (const id of ['airstrike', 'teleport', 'girder']) {
    await setWeapon(id);
    assert.equal((await local()).target, null);
    const pos = await page.evaluate(() => {
      const r = __mobilityRenderer,
        b = document.querySelector('#field').getBoundingClientRect(),
        p = r.screenPoint({ x: 870, y: 550 });
      return { x: b.x + p.x, y: b.y + p.y };
    });
    const p = await pressAt(pos.x, pos.y);
    await pause(50);
    await lift(p);
    await until(async () => (await local()).target !== null, id + ' retains battlefield target tap');
    report.cases.push({ name: 'target-tap-' + id, target: (await local()).target });
  }
  report.checks.push(
    'All twelve weapon selections remain usable; non-power weapons never show the charge ring; target tools still require a battlefield destination',
  );

  await resetCase('radial-progress');
  await setWeapon('bazooka');
  await beginCharge();
  await pause(170);
  const low = await indicator();
  report.currentIndicator = low;
  assert.equal(low.visible, true);
  assert.ok(
    parseFloat(low.offsets[0]) < 0.1 && parseFloat(low.offsets.at(-1)) > 0.9,
    'Segment progress at partial charge',
  );
  await pause(1400);
  const full = await indicator();
  assert.equal(full.power, 1);
  assert.ok(
    full.offsets.every((value) => Math.abs(parseFloat(value)) < 0.01),
    'All actual SVG segments illuminate at full power',
  );
  assert.match(full.className, /is-full/);
  contained(full.svg, full.button, 'Ring inside button');
  contained(full.marker, full.button, 'Marker inside button');
  assert.doesNotMatch(full.caption, /[°%]/);
  await capture('charging-full');
  await cancelPointers();
  assert.equal((await indicator()).visible, false);
  report.cases.push({ name: 'radial-progress', low, full });

  await resetCase('jetpack-switch', { air: true });
  game.players.find((p) => p.id === owner.playerId).ammo.jetpack = 1;
  await pause(120);
  await setWeapon('jetpack');
  await tap('#fire');
  await until(() => owner.jetpack, 'Jetpack active');
  await arrange({ refill: true });
  await pause(100);
  let s = await stick(0, 1),
    a = await local(),
    before = snapshot();
  await pause(300);
  let during = snapshot();
  assert.ok(during.y > before.y + 8);
  assert.equal(during.input.thrustY, 1);
  assert.ok(Math.abs((await local()).angle - a.angle) < 1e-8);
  await stopStick(s);
  await arrange({ refill: true });
  before = snapshot();
  s = await stick(0.8, -0.8);
  await until(
    () => owner.x > before.x + 8 && owner.y < before.y - 8,
    'Diagonal flight moves the worm right and up',
    2000,
  );
  during = snapshot();
  assert.ok(during.input.thrustX > 0.5 && during.input.thrustY < -0.5);
  assert.ok(Math.hypot(during.thrustX, during.thrustY) <= 1.00001);
  await stopStick(s);
  await neutral('Dual-stick flight release');
  report.cases.push({
    name: cdp ? 'two-stick-diagonal-flight' : 'keyboard-horizontal-vertical-stick-flight',
    before,
    during,
  });
  await setWeapon('bazooka');
  assert.equal(owner.jetpack, true);
  assert.equal(game.players.find((p) => p.id === owner.playerId).ammo.jetpack, 0);
  await setWeapon('jetpack');
  await stickMode('jetpack');
  assert.equal(await page.locator('#fire').isEnabled(), true);
  await setWeapon('bazooka');
  await stickMode('move');
  await setAim(-35);
  s = await stick(0, -0.7);
  a = await local();
  await pause(280);
  const switched = await local();
  assert.ok(elevation(switched.angle) < elevation(a.angle) - 0.12);
  assert.equal(game._input.thrustY, 0);
  assert.equal(game._input.reel, 0);
  await stopStick(s);
  s = await stick(1, 0);
  await pause(220);
  assert.ok(owner.vx > 20);
  await stopStick(s);
  await page.keyboard.down('ArrowDown');
  a = await local();
  await pause(180);
  assert.equal(game._input.thrustY, 0);
  assert.ok(elevation((await local()).angle) > elevation(a.angle));
  await page.keyboard.up('ArrowDown');
  await page.keyboard.down('w');
  await pause(120);
  assert.equal(game._input.thrustY, -1);
  await page.keyboard.up('w');
  await pause(120);
  const jetView = await aligned('Airborne bazooka');
  await capture('jetpack-aim');
  report.cases.push({ name: 'jetpack-vertical-to-weapon-aim', before, during, switched, jetView });
  await shoot('airborne-bazooka');
  assert.equal(owner.jetpack, false);

  await resetCase('rope-switch', { air: true });
  await setWeapon('rope');
  await setAim(-90);
  await tap('#fire');
  await until(() => owner.rope, 'Rope attached');
  await pause(120);
  before = snapshot();
  s = await stick(0, -1);
  await pause(280);
  during = snapshot();
  assert.ok(during.rope.length < before.rope.length - 10);
  await stopStick(s);
  before = snapshot();
  s = await stick(0.7, -0.5);
  await pause(240);
  during = snapshot();
  assert.ok(during.rope.length < before.rope.length - 4);
  assert.ok(during.input.move > 0.4 && during.input.reel < -0.3);
  await stopStick(s);
  await neutral('Dual-stick rope release');
  report.cases.push({
    name: cdp ? 'two-stick-swing-reel' : 'keyboard-swing-vertical-stick-reel',
    before,
    during,
  });
  await setWeapon('bazooka');
  await stickMode('move');
  await setAim(-45);
  const length = owner.rope.length;
  s = await stick(0, 0.65);
  a = await local();
  await pause(260);
  const ropeAim = await local();
  assert.ok(elevation(ropeAim.angle) > elevation(a.angle) + 0.1);
  assert.equal(game._input.reel, 0);
  assert.ok(Math.abs(owner.rope.length - length) < 0.1);
  await stopStick(s);
  s = await stick(-1, 0);
  await pause(220);
  assert.ok(owner.vx < -10);
  await stopStick(s);
  await aligned('Hanging bazooka');
  await capture('rope-aim');
  report.cases.push({ name: 'rope-reel-to-weapon-aim', before, during, ropeAim, length });
  await shoot('hanging-bazooka');
  assert.equal(owner.rope, null);
  report.checks.push(
    'Active selected tools use vertical movement; choosing bazooka restores vertical aiming, neutralizes reel/thrustY, keeps horizontal mobility and visible weapon, and sends an accepted airborne/hanging shot',
  );

  await resetCase('simultaneous-charge');
  await setAim(-20);
  const count = fireCount();
  if (cdp) s = await stick(0.45, -0.45);
  else await page.keyboard.down('ArrowUp');
  const initial = await local(),
    p = await beginCharge();
  await pause(360);
  const charging = await indicator(),
    aiming = await local();
  assert.equal(charging.visible, true);
  assert.ok(elevation(aiming.angle) < elevation(initial.angle) - 0.12);
  await capture('simultaneous-charge');
  await lift(p);
  await until(() => fireCount() === count + 1, 'One shot from independent release');
  if (cdp) await stopStick(s);
  else await page.keyboard.up('ArrowUp');
  await pause(360);
  assert.equal((await indicator()).visible, false);
  report.cases.push({
    name: cdp ? 'trusted-three-contact-move-aim-charge' : 'keyboard-pointer-aim-charge',
    initial,
    aiming,
    charging,
  });

  for (const reason of ['cancel', 'blur', 'dialog', 'orientation', 'out-of-turn']) {
    await resetCase('cancel-' + reason);
    const count = fireCount();
    if (cdp) s = await stick(0.6, -0.3);
    await beginCharge();
    await pause(150);
    assert.equal((await indicator()).visible, true);
    if (reason === 'cancel') await cancelPointers();
    if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (reason === 'dialog') await page.evaluate(() => document.querySelector('#hud-menu').click());
    if (reason === 'orientation') await page.setViewportSize({ width: 390, height: 844 });
    if (reason === 'out-of-turn') {
      // Leave fire held, but let the server acknowledge neutral movement before
      // expiring the turn. A drag still in flight may legitimately arrive too late.
      if (cdp) {
        await stopStick(s);
        await neutral('Movement released while charging');
        assert.equal((await indicator()).visible, true);
      }
      const turnNumber = game.turn.number;
      forcedExpiryTurns.add(turnNumber);
      game.turn.remaining = 0.001;
      await until(
        () => game.turn.number !== turnNumber || game.turn.stage === 'settling',
        'Turn exits',
        2000,
      );
    }
    await pause(160);
    assert.equal((await indicator()).visible, false, reason + ' hides ring');
    assert.equal(fireCount(), count, reason + ' never fires');
    await cancelPointers();
    if (reason === 'dialog') await page.locator('dialog .dialog-head button').click();
    if (reason === 'orientation') await page.setViewportSize({ width: 844, height: 390 });
    if (reason !== 'out-of-turn') await neutral(reason);
    report.cases.push({ name: 'charge-cancel-' + reason, after: snapshot() });
  }
  report.checks.push(
    'Independent horizontal, vertical and charge contacts work in Chrome; release fires exactly once, confirmation expires, and cancel/blur/menu/rotation/turn loss hide the ring without firing',
  );

  await resetCase('layouts');
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
        const rect = (el) => el.getBoundingClientRect().toJSON(),
          controls = [
            ...document.querySelectorAll(
              '.game-top button,.camera-tools button,.control-deck button,.control-deck input',
            ),
          ]
            .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
            .map((el) => {
              const r = rect(el),
                top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return { id: el.id || el.dataset.hold, ...r, hit: top === el || el.contains(top) };
            });
        return {
          width: innerWidth,
          height: innerHeight,
          controls,
          field: rect(document.querySelector('#field')),
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      for (const b of layout.controls) {
        assert.ok(b.width >= 43.9 && b.height >= 43.9, `${hand}/${width}: target ${b.id}`);
        contained(b, { x: 0, y: 0, right: width, bottom: height }, `${hand}/${width}: viewport ${b.id}`);
        assert.equal(b.hit, true, `${hand}/${width}: ${b.id} unobstructed`);
      }
      for (let i = 0; i < layout.controls.length; i++)
        for (let j = i + 1; j < layout.controls.length; j++) {
          const a = layout.controls[i],
            b = layout.controls[j];
          assert.ok(
            Math.min(a.right, b.right) - Math.max(a.x, b.x) < 0.5 ||
              Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) < 0.5,
            `${hand}/${width}: ${a.id}/${b.id} overlap`,
          );
        }
      assert.ok(layout.scrollWidth <= width);
      assert.ok(layout.field.height >= height - 1, 'Battlefield retains full viewport height');
      const move = layout.controls.find((b) => b.id === 'move-stick'),
        aim = layout.controls.find((b) => b.id === 'aim-stick');
      assert.ok(move && aim, 'Both circular controls visible');
      assert.ok(
        hand === 'right' ? move.x < width / 2 && aim.x > width / 2 : move.x > width / 2 && aim.x < width / 2,
        'Handed dual-stick placement',
      );
      assert.equal(await page.locator('#aim').isVisible(), false);
      assert.equal((await indicator()).visible, false);
      if (width === 568) await capture(`${hand}-${width}-idle`);
      await beginCharge();
      await pause(170);
      const ring = await indicator();
      assert.equal(ring.visible, true);
      contained(ring.svg, ring.button, 'Layout ring within button');
      contained(ring.marker, ring.button, 'Layout marker within button');
      if (width === 568 || width === 844) await capture(`${hand}-${width}-charging`);
      await cancelPointers();
      report.layouts.push({ hand, ...layout, ring });
    }
  }
  report.checks.push(
    'Four landscape sizes and both hands retain both axis sticks and 44px nonoverlapping targets; mobile slider/degrees are absent and radial indicator/marker remain inside the fire button',
  );
  report.touchEvents = await page.evaluate(() => __mobilityTouches);
  if (cdp) assert.equal(report.touchEvents.max, 3);
  report.rejectedActions = accepted.filter((entry) => !entry.result.ok);
  report.expectedExpiryNeutralRejections = report.rejectedActions.filter(
    (entry) =>
      entry.action.type === 'input' &&
      ['move', 'thrustX', 'thrustY', 'reel'].every((axis) => entry.action[axis] === 0) &&
      forcedExpiryTurns.has(entry.before.turn.number) &&
      entry.before.turn.stage === 'settling' &&
      entry.result.error === 'Espera a que termine la acción.' &&
      JSON.stringify(entry.before) === JSON.stringify(entry.after),
  );
  assert.deepEqual(
    report.rejectedActions.filter((entry) => !report.expectedExpiryNeutralRejections.includes(entry)),
    [],
    'Only unchanged neutral input already in transit at forced turn expiry can be rejected',
  );
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
    await page
      .screenshot({ path: fileURLToPath(new URL(`joystick-aim-${kind}-failure.png`, folder)) })
      .catch(() => {});
  }
  throw error;
} finally {
  if (report.passed) await unlink(new URL(`joystick-aim-${kind}-failure.png`, folder)).catch(() => {});
  await writeFile(new URL(`joystick-aim-${kind}.json`, folder), JSON.stringify(report, null, 2) + '\n');
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
