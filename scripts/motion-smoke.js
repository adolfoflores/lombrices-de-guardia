/* Browser fixture globals supplied explicitly by the inline harness. */
/* global __motionAimPointer, __motionRead, __motionRenderer */
// Focused real-client regression for movement, facing, aiming and presentation.
// The fixture supplies a safe flat arena; every measured command goes through UI → WS → Game.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { createServer } from '../server/index.js';

const kind = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const evidence = new URL('../docs/evidence/', import.meta.url);
await mkdir(evidence, { recursive: true });
const report = {
  browser: kind,
  physicalDevice: false,
  startedAt: new Date().toISOString(),
  checks: [],
  cases: [],
  errors: [],
  sourceSHA256: {},
  notes: [
    'Two isolated real browser clients per scenario, private ephemeral server, original main.js and Renderer. A flat terrain fixture and extended test turn isolate input from map hazards.',
    'Chrome mobile controls use trusted emulated touch events; WebKit mobile layout uses pointer input. No physical phone is claimed.',
    'Renderer instances are observed by wrapping setState; no input or simulation behavior is replaced. Weapon barrel direction is measured through actual Pixi global transforms; reticle direction is measured through drawAim path commands.',
  ],
};
for (const path of [
  'client/main.js',
  'client/mobile-controls.js',
  'client/style.css',
  'client/renderer.js',
  'client/pixi-combat.js',
  'client/pixi-character.js',
  'client/art/palette.js',
  'client/art/weapons.js',
  'shared/engine.js',
  'shared/aim.js',
])
  report.sourceSHA256[path] = createHash('sha256')
    .update(await readFile(new URL('../' + path, import.meta.url)))
    .digest('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const angularDistance = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
async function until(predicate, message, timeout = 5000) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeout) throw new Error(message);
    await pause(15);
  }
}
let browser, app;
const contexts = [];
async function instrument(page) {
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.evaluate(async () => {
    const { Renderer } = await import('/client/renderer.js');
    const original = Renderer.prototype.setState;
    Renderer.prototype.setState = function (...args) {
      window.__motionRenderer = this;
      return original.apply(this, args);
    };
    window.__motionAimPointer = null;
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (event.target.id === 'aim') window.__motionAimPointer = event.pointerId;
      },
      true,
    );
    window.__motionRead = () => {
      const r = window.__motionRenderer,
        world = r.state,
        worm = world.worms.find((w) => w.id === world.turn.wormId),
        actor = r.pixi?.actors.get(worm.id);
      const lines = [];
      let from = null;
      const context = new Proxy(
        {
          moveTo(x, y) {
            from = { x, y };
          },
          lineTo(x, y) {
            if (from) lines.push({ from, to: { x, y } });
            from = { x, y };
          },
        },
        {
          get(target, key) {
            return key in target ? target[key] : () => {};
          },
          set(target, key, value) {
            target[key] = value;
            return true;
          },
        },
      );
      r.drawAim(context, performance.now());
      const line = lines[0];
      const origin = actor?.weaponRig.toGlobal({ x: 0, y: 0 }),
        tip = actor?.weaponRig.toGlobal({ x: 20, y: 0 });
      const axis = origin && tip ? Math.atan2(tip.y - origin.y, tip.x - origin.x) : null;
      return {
        now: performance.now(),
        local: world.turn.playerId === r.view.playerId,
        view: { angle: r.view.angle, facing: r.view.facing, weapon: r.view.weapon },
        worm: {
          id: worm.id,
          x: worm.x,
          y: worm.y,
          vx: worm.vx,
          vy: worm.vy,
          facing: worm.facing,
          aim: worm.aim,
          grounded: worm.grounded,
        },
        actor: actor
          ? {
              requestedFacing: actor.requestedFacing,
              visualFacing: actor.visualFacing,
              displayAim: actor.displayAim,
              bodyScaleX: actor.rig.scale.x,
              bodyRotation: actor.rig.rotation,
              jumpBack: actor.jumpBack,
              jumpFacing: actor.jumpFacing,
              weaponVisible: actor.weaponRig.visible,
              barrelAngle: axis,
            }
          : null,
        reticle: line
          ? { angle: Math.atan2(line.to.y - line.from.y, line.to.x - line.from.x), ...line }
          : null,
      };
    };
  });
}
async function fixture(layout) {
  const pages = [],
    streams = [[], []],
    sent = [[], []];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext(
      i === 0 && layout === 'mobile'
        ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }
        : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    );
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    page.on('websocket', (ws) => {
      if (!ws.url().endsWith('/socket')) return;
      ws.on('framereceived', ({ payload }) => {
        try {
          streams[i].push(JSON.parse(String(payload)));
        } catch {}
      });
      ws.on('framesent', ({ payload }) => {
        try {
          sent[i].push(JSON.parse(String(payload)));
        } catch {}
      });
    });
    await page.goto(`http://127.0.0.1:${app.port}/`);
    await page.locator('#player-name').waitFor();
    await page.waitForFunction(() => document.querySelector('#connection')?.hidden);
    await instrument(page);
    if (i === 0) {
      await page.locator('#player-name').fill('Movimiento');
      await page.getByRole('button', { name: 'Crear sala privada →' }).click();
      await page.locator('#ready').waitFor();
    } else {
      const code = streams[0].find((m) => m.type === 'welcome').code;
      await page.getByRole('tab', { name: 'Tengo un código' }).click();
      await page.locator('#player-name').fill('Observa');
      await page.locator('#room-code').fill(code);
      await page.getByRole('button', { name: 'Entrar a la sala →' }).click();
      await page.locator('#ready').waitFor();
    }
  }
  for (const p of pages) await p.locator('#ready').click();
  await pages[0].locator('#start').click();
  await Promise.all(pages.map((p) => p.locator('#field').waitFor()));
  await pages[0].waitForFunction(
    () =>
      window.__motionRenderer?.pixi?.active &&
      document.querySelector('#fire') &&
      !document.querySelector('#fire').disabled,
  );
  const identity = streams[0].find((m) => m.type === 'welcome'),
    room = app.rooms.get(identity.code),
    game = room.game;
  game.terrain.data.fill(0);
  game.terrain.rect(0, 650, 1600, 250);
  game.terrain.revision++;
  const owner = game._active();
  game.worms.forEach((w, i) =>
    Object.assign(w, {
      x: w.id === owner.id ? 800 : [120, 120, 1400, 1500][i],
      y: 639,
      vx: 0,
      vy: 0,
      hp: 100,
      grounded: true,
      rope: null,
      jetpack: false,
    }),
  );
  game.turn.remaining = 120;
  game._input = {};
  owner.facing = 1;
  owner.aim = -Math.PI / 4;
  await until(
    () =>
      streams[0].filter((m) => m.type === 'state').at(-1)?.state.terrainRevision === game.terrain.revision,
    'Fixture terrain reaches client',
  );
  await pages[0].bringToFront();
  await pause(180);
  await pages[0].evaluate((layout) => {
    const r = __motionRenderer;
    r.autoFollow = false;
    r.fullView = false;
    r.camera = { x: 800, y: layout === 'mobile' ? 620 : 580, zoom: layout === 'mobile' ? 1.8 : 2 };
    r.cameraGoal = { ...r.camera };
  }, layout);
  const cdp =
    kind === 'chromium' && layout === 'mobile' ? await pages[0].context().newCDPSession(pages[0]) : null;
  const actions = () => sent[0].filter((m) => m.type === 'action').map((m) => m.action);
  return {
    layout,
    pages,
    page: pages[0],
    peer: pages[1],
    streams,
    sent,
    room,
    game,
    cdp,
    actions,
    owner: () => game.worms.find((w) => w.id === owner.id),
  };
}
const elevation = (angle) => Math.atan2(Math.sin(angle), Math.abs(Math.cos(angle)));
// Two circular sticks: the horizontal one moves, the vertical one aims. Chrome holds several trusted
// contacts at once; the pointer path (WebKit) drives one stick with the mouse and moves with the keyboard.
const stickFor = (x, y) => (y && !x ? '#aim-stick' : '#move-stick');
async function startStick(f, x, y, id = 11) {
  const selector = stickFor(x, y);
  const box = await f.page.locator(selector).boundingBox();
  assert.ok(box, 'Mobile joystick is visible');
  const knob = await f.page.locator(selector + ' .stick-knob').evaluate((el) => el.offsetWidth);
  const center = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    radius: (Math.min(box.width, box.height) - knob) / 2 + 3,
  };
  const pointer = {
    id,
    x: center.x + x * center.radius,
    y: center.y + y * center.radius,
    radiusX: 8,
    radiusY: 8,
    force: 1,
  };
  f.contacts ||= new Map();
  f.contacts.set(id, { center, pointer });
  f.stickCenter = center;
  f.pointer = pointer;
  if (f.cdp)
    await f.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [...f.contacts.values()].map((c) => c.pointer),
    });
  else {
    assert.equal(f.contacts.size, 1, 'The pointer path holds one stick at a time');
    await f.page.mouse.move(pointer.x, pointer.y);
    await f.page.mouse.down();
  }
}

async function stopStick(f) {
  f.contacts?.clear();
  if (f.cdp) await f.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else await f.page.mouse.up();
}
async function aim(f, degrees) {
  if (f.layout === 'desktop') {
    await f.page.locator('#aim').fill(String(degrees));
    await f.page.evaluate(() => document.activeElement?.blur());
  } else {
    assert.ok(await f.page.locator('#aim').isHidden(), 'Mobile aims with the joystick, without a slider');
    const target = elevation((degrees * Math.PI) / 180),
      before = elevation((await inspect(f)).view.angle),
      direction = Math.sign(target - before);
    if (Math.abs(target - before) > 0.006) {
      await startStick(f, 0, direction, 32);
      try {
        await until(
          async () => {
            const current = elevation((await inspect(f)).view.angle);
            return Math.abs(target) === Math.PI / 2
              ? Math.abs(current - target) < 1e-6
              : direction * (current - target) >= -0.006;
          },
          'Vertical joystick reaches requested elevation',
          7000,
        );
      } finally {
        await stopStick(f);
      }
    }
  }
  await pause(130);
}
async function startMove(f, direction) {
  if (f.layout === 'desktop') await f.page.keyboard.down(direction < 0 ? 'ArrowLeft' : 'ArrowRight');
  else await startStick(f, direction, 0);
}
async function stopMove(f, direction) {
  if (f.layout === 'desktop') await f.page.keyboard.up(direction < 0 ? 'ArrowLeft' : 'ArrowRight');
  else await stopStick(f);
}
async function tap(f, selector) {
  if (f.cdp) {
    const b = await f.page.locator(selector).boundingBox();
    await f.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        {
          id: 20,
          x: Math.round(b.x + b.width / 2),
          y: Math.round(b.y + b.height / 2),
          radiusX: 8,
          radiusY: 8,
          force: 1,
        },
      ],
    });
    await pause(40);
    await f.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else await f.page.locator(selector).click();
}
const inspect = (f) =>
  f.page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return __motionRead();
  });
function aligned(sample, label) {
  assert.ok(sample.actor?.weaponVisible, label + ' weapon visible');
  assert.ok(sample.reticle, label + ' reticle visible');
  assert.ok(angularDistance(sample.reticle.angle, sample.view.angle) < 1e-6, label + ' reticle matches aim');
  const error = (angularDistance(sample.actor.barrelAngle, sample.reticle.angle) * 180) / Math.PI;
  if (error >= 0.1) report.alignmentFailure = sample;
  assert.ok(error < 0.1, label + ' barrel matches reticle within 0.1 degrees; observed ' + error);
}
async function shot(f, name) {
  await f.page.evaluate((layout) => {
    const r = __motionRenderer,
      w = r.state.worms.find((w) => w.id === r.state.turn.wormId);
    r.camera = { x: w.x, y: w.y - (layout === 'mobile' ? 20 : 60), zoom: layout === 'mobile' ? 1.8 : 2 };
    r.cameraGoal = { ...r.camera };
  }, f.layout);
  await inspect(f);
  await f.page.screenshot({
    path: fileURLToPath(new URL(`motion-${kind}-${f.layout}-${name}.png`, evidence)),
  });
}
try {
  app = await createServer({ dev: true });
  browser = await (kind === 'webkit' ? webkit : chromium).launch(
    kind === 'webkit' ? { headless: true } : { headless: true, channel: 'chrome' },
  );
  report.version = browser.version();
  for (const layout of process.env.TEST_LAYOUT ? [process.env.TEST_LAYOUT] : ['desktop', 'mobile']) {
    const f = await fixture(layout),
      data = { layout, moves: [], jumps: [] };
    report.cases.push(data);
    await aim(f, -35);
    const initial = await inspect(f);
    aligned(initial, layout + ' initial');
    for (const direction of [-1, 1]) {
      const before = await inspect(f),
        sentBefore = f.actions().length;
      await startMove(f, direction);
      await pause(45);
      const immediate = await inspect(f);
      assert.equal(immediate.view.facing, direction);
      assert.equal(Math.sign(Math.cos(immediate.view.angle)), direction);
      assert.ok(Math.abs(Math.sin(immediate.view.angle) - Math.sin(before.view.angle)) < 0.001);
      await pause(260);
      const moving = await inspect(f);
      aligned(moving, layout + ' walking ' + direction);
      assert.equal(f.owner().facing, direction);
      assert.equal(Math.sign(f.owner().vx), direction);
      assert.equal(Math.sign(Math.cos(f.owner().aim)), direction);
      await shot(f, direction < 0 ? 'walking-left' : 'walking-right');
      await stopMove(f, direction);
      await pause(420);
      const released = await inspect(f);
      aligned(released, layout + ' stopped ' + direction);
      assert.equal(released.view.facing, direction);
      assert.equal(f.owner().facing, direction);
      assert.equal(f.owner().vx, 0);
      assert.ok(angularDistance(released.view.angle, moving.view.angle) < 0.001);
      const commands = f
        .actions()
        .slice(sentBefore)
        .filter((a) => a.type === 'input');
      assert.ok(commands.some((a) => a.move === direction));
      assert.ok(commands.filter((a) => a.move === direction).every((a) => Math.cos(a.aim) * direction > 0));
      data.moves.push({ direction, before, immediate, moving, released, commands });
    }
    // The observer receives the same accepted orientation, with a bounded smooth presentation.
    await pause(220);
    const remote = await f.peer.evaluate(() => __motionRead());
    assert.equal(remote.worm.facing, f.owner().facing);
    assert.ok(angularDistance(remote.actor.displayAim, f.owner().aim) < 0.03);
    assert.ok(angularDistance(remote.actor.barrelAngle, remote.actor.displayAim) < (0.1 * Math.PI) / 180);
    data.remote = remote;

    await aim(f, -35);
    await startMove(f, -1);
    await pause(200);
    await stopMove(f, -1);
    await pause(350);
    if (layout === 'desktop') {
      await f.page.keyboard.down('ArrowUp');
      const frames = await f.page.evaluate(async () => {
        const frames = [];
        await new Promise((resolve) => {
          const tick = (time) => {
            frames.push({ time, angle: __motionRenderer.view.angle });
            if (frames.length < 46) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        return frames;
      });
      await f.page.keyboard.up('ArrowUp');
      const distinct = new Set(frames.map((p) => p.angle.toFixed(5))).size;
      assert.ok(distinct > 25, 'Aiming updates at render cadence, not network 10 Hz');
      assert.ok(
        Math.sin(frames.at(-1).angle) < Math.sin(frames[0].angle) - 0.15,
        'Up increases elevation when facing left',
      );
      assert.ok(frames.every((p) => Math.cos(p.angle) < 0));
      const stable = await inspect(f);
      await pause(180);
      assert.ok(angularDistance((await inspect(f)).view.angle, stable.view.angle) < 0.001);
      data.continuousAim = { frames, distinct };
      aligned(stable, 'continuous keyboard aim');
    } else {
      const sentBefore = f.actions().length;
      await startStick(f, 0, -1, 31);
      const frames = await f.page.evaluate(async () => {
        const frames = [];
        await new Promise((resolve) => {
          const tick = (time) => {
            frames.push({ time, angle: __motionRenderer.view.angle });
            if (frames.length < 46) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        return frames;
      });
      await stopStick(f);
      const distinct = new Set(frames.map((p) => p.angle.toFixed(5))).size;
      assert.ok(distinct > 25, 'Held vertical joystick aims at frame cadence');
      assert.ok(
        Math.sin(frames.at(-1).angle) < Math.sin(frames[0].angle) - 0.15,
        'Up increases elevation when facing left',
      );
      assert.ok(frames.every((p) => Math.cos(p.angle) < 0));
      const stable = await inspect(f);
      await pause(160);
      assert.ok(
        angularDistance(stable.view.angle, (await inspect(f)).view.angle) < 0.001,
        'Releasing the joystick stops aiming',
      );
      aligned(stable, 'mobile joystick aim');
      const commands = f
        .actions()
        .slice(sentBefore)
        .filter((a) => a.type === 'input');
      assert.ok(commands.length > 2);
      assert.ok(
        commands.every((a) => a.move === 0 && a.thrustY === 0 && a.reel === 0),
        'Aim-only joystick does not send movement or vertical tool commands',
      );
      data.continuousAim = { frames, distinct, stable, commands };
    }
    if (layout === 'desktop') {
      // A direction change while the desktop pointer remains down must rebase its gesture origin.
      await aim(f, -45);
      const slider = await f.page.locator('#aim').boundingBox();
      const pointerStart = {
        id: 61,
        x: Math.round(slider.x + slider.width * 0.45),
        y: Math.round(slider.y + slider.height / 2),
        radiusX: 6,
        radiusY: 6,
        force: 1,
      };
      const pointerMoved = { ...pointerStart, x: Math.round(pointerStart.x + (slider.width * 20) / 360) };
      if (f.cdp) {
        await f.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pointerStart] });
        await f.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pointerMoved] });
        const b = await f.page.locator('#move-stick').boundingBox();
        f.anchorMove = {
          id: 62,
          x: Math.round(b.x + 3),
          y: Math.round(b.y + b.height / 2),
          radiusX: 8,
          radiusY: 8,
          force: 1,
        };
        await f.cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [pointerMoved, f.anchorMove],
        });
      } else {
        await f.page.mouse.move(pointerStart.x, pointerStart.y);
        await f.page.mouse.down();
        await f.page.mouse.move(pointerMoved.x, pointerMoved.y);
        await f.page.keyboard.down('ArrowLeft');
      }
      const anchorBefore = await inspect(f);
      assert.equal(anchorBefore.view.facing, -1);
      assert.ok(Math.cos(anchorBefore.view.angle) < 0);
      // Explicit duplicate pointermove covers devices emitting redundant coordinates.
      const pointerId = await f.page.evaluate(() => __motionAimPointer);
      await f.page.locator('#aim').dispatchEvent('pointermove', {
        pointerId,
        clientX: pointerMoved.x,
        clientY: pointerMoved.y,
        bubbles: true,
      });
      const anchorAfter = await inspect(f);
      assert.ok(
        angularDistance(anchorAfter.view.angle, anchorBefore.view.angle) < 0.0001,
        'Duplicate pointer position after turn preserves rebased angle',
      );
      if (f.cdp) await f.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else {
        await f.page.mouse.up();
        await f.page.keyboard.up('ArrowLeft');
      }
      await pause(180);
      const anchorReleased = await inspect(f);
      assert.ok(
        angularDistance(anchorReleased.view.angle, anchorBefore.view.angle) < 0.0001,
        'Release after rebased gesture is not a tap',
      );
      aligned(anchorReleased, 'rebase after facing turn');
      data.gestureRebase = { before: anchorBefore, after: anchorAfter, released: anchorReleased };
    } else {
      await startMove(f, 1);
      await pause(80);
      await stopMove(f, 1);
      await aim(f, -45);
      // Aim with the vertical stick, then turn with the horizontal one (a second trusted contact in Chrome,
      // the keyboard on the pointer path): the elevation must survive the turn and keep rising.
      await startStick(f, 0, -0.75, 61);
      await pause(70);
      const before = await inspect(f);
      if (f.cdp) await startStick(f, -0.75, 0, 62);
      else await f.page.keyboard.down('a');
      const turned = await inspect(f);
      assert.equal(turned.view.facing, -1);
      assert.ok(Math.cos(turned.view.angle) < 0);
      // The held vertical stick keeps raising the aim (up to 1.35 rad/s × 0.75) between the two samples; the turn itself must add no jump.
      assert.ok(
        Math.abs(elevation(turned.view.angle) - elevation(before.view.angle)) <
          0.08 + (1.1 * (turned.now - before.now)) / 1000,
        'Turning during joystick aim preserves its elevation',
      );
      const frames = await f.page.evaluate(async () => {
        const values = [];
        await new Promise((resolve) => {
          const tick = () => {
            values.push(__motionRead());
            if (values.length < 12) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        return values;
      });
      for (const sample of frames) aligned(sample, 'joystick turns and aims');
      assert.ok(
        elevation(frames.at(-1).view.angle) < elevation(turned.view.angle) - 0.03,
        'Held vertical stick keeps raising aim while moving left',
      );
      await stopStick(f);
      if (!f.cdp) await f.page.keyboard.up('a');
      await pause(180);
      const released = await inspect(f);
      await pause(160);
      assert.ok(
        angularDistance(released.view.angle, (await inspect(f)).view.angle) < 0.001,
        'Joystick neutral does not change aim after turning',
      );
      assert.equal(released.view.facing, -1);
      data.joystickTurn = { before, turned, frames, released };
    }
    await shot(f, 'aim-left');

    // Exactly vertical aim retains the last selected side through an empty release packet.
    await aim(f, -90);
    await pause(140);
    const vertical = await inspect(f);
    aligned(vertical, 'vertical left');
    assert.equal(vertical.view.facing, -1);
    assert.equal(f.owner().facing, -1);
    assert.ok(Math.abs(Math.cos(f.owner().aim)) < 0.001);
    data.vertical = vertical;
    await aim(f, -135);
    await pause(160);
    for (const back of [false, true]) {
      await until(() => f.owner().grounded, 'Worm lands before jump');
      const before = { ...f.owner() },
        startActions = f.actions().length,
        startEvent = f.game.events.at(-1)?.id || 0;
      if (layout === 'desktop') {
        await f.page.evaluate(() => document.activeElement?.blur());
        await f.page.keyboard.press(back ? 'Shift' : 'Enter');
      } else await tap(f, back ? '#backjump' : '#jump');
      await until(
        () =>
          f
            .actions()
            .slice(startActions)
            .some((a) => a.type === 'jump' && a.back === back),
        'Jump action sent',
      );
      await until(
        () =>
          f.streams[0]
            .filter((m) => m.type === 'state')
            .at(-1)
            ?.state.events.some((e) => e.type === 'jump' && e.id > startEvent),
        'Accepted jump reaches browser',
      );
      const jumping = await inspect(f),
        accepted = f.game.events.find((e) => e.type === 'jump' && e.id > startEvent);
      data.lastJumpAttempt = { back, before, jumping, accepted };
      assert.equal(f.owner().facing, -1);
      assert.equal(Math.sign(f.owner().vx), back ? 1 : -1);
      assert.equal(jumping.actor.jumpBack, back);
      assert.equal(jumping.actor.jumpFacing, -1);
      assert.ok(accepted.vy < 0);
      assert.equal(accepted.facing, -1);
      assert.equal(Math.sign(accepted.vx), back ? 1 : -1);
      assert.ok(Math.cos(jumping.view.angle) < 0);
      aligned(jumping, layout + ' jump ' + back);
      await shot(f, back ? 'backjump' : 'jump');
      data.jumps.push({
        back,
        before,
        jumping,
        events: f.game.events.filter((e) => e.type === 'jump').slice(-1),
      });
      await until(() => f.owner().grounded, 'Jump returns to floor', 3500);
      await pause(180);
    }
    // A shot uses the same displayed direction; the server never silently flips it.
    await aim(f, -135);
    const beforeFire = await inspect(f),
      fireCount = f.actions().filter((a) => a.type === 'fire').length;
    if (layout === 'desktop') {
      await f.page.keyboard.down(' ');
      await pause(180);
      await f.page.keyboard.up(' ');
    } else {
      const b = await f.page.locator('#fire').boundingBox();
      if (f.cdp) {
        await f.cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [
            {
              id: 41,
              x: Math.round(b.x + b.width / 2),
              y: Math.round(b.y + b.height / 2),
              radiusX: 8,
              radiusY: 8,
              force: 1,
            },
          ],
        });
        await pause(180);
        await f.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await f.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await f.page.mouse.down();
        await pause(180);
        await f.page.mouse.up();
      }
    }
    await until(
      () => f.actions().filter((a) => a.type === 'fire').length === fireCount + 1,
      'Fire sends once',
    );
    const command = f
      .actions()
      .filter((a) => a.type === 'fire')
      .at(-1);
    assert.ok(angularDistance(command.angle, beforeFire.view.angle) < 0.001);
    await until(() => f.game.events.some((e) => e.type === 'fire'), 'Server accepts shot');
    const event = f.game.events.filter((e) => e.type === 'fire').at(-1);
    assert.ok(angularDistance(event.angle, command.angle) < 0.001);
    data.shot = { beforeFire, command, event };
    await pause(100);
    await shot(f, 'fire-left');
    assert.equal(f.actions().filter((a) => a.type === 'jump').length, 2);
    for (const page of f.pages) await page.context().close();
  }
  report.checks.push(
    'Both directions reflect aim immediately, preserve elevation, align barrel/reticle, and retain facing after release',
  );
  report.checks.push('Observer receives accepted direction; exact vertical aim keeps side');
  report.checks.push(
    'Keyboard and mobile vertical joystick aim update continuously at frame cadence; neutral holds the angle',
  );
  report.checks.push(
    'Desktop aim drag rebases through a turn; mobile diagonal joystick turns and aims without an elevation jump',
  );
  report.checks.push(
    'Normal and backward jumps preserve facing while velocity points in the correct direction',
  );
  report.checks.push(
    'Actual fire angle equals visible reticle and authoritative event in desktop and mobile layouts',
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  await writeFile(new URL(`motion-${kind}.json`, evidence), JSON.stringify(report, null, 2) + '\n');
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
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close();
  await app?.close();
}
