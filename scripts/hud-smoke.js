/* Browser fixture globals supplied explicitly by the inline harness. */
/* global __hudRenderer */
// Focused real-UI HUD regression. Run Chrome then WebKit, never simultaneously.
// Fixtures arrange safe terrain and a long turn; actual controls send ordinary WebSocket actions.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { createServer } from '../server/index.js';
import { NetworkClient } from './network-smoke.js';
const kind = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const folder = new URL('../docs/evidence/', import.meta.url);
const report = {
  browser: kind,
  physicalDevice: false,
  startedAt: new Date().toISOString(),
  checks: [],
  layouts: [],
  errors: [],
  notes: [
    'Actual game UI with trusted taps/keyboard and private ephemeral server; game state observed via normal snapshots.',
    'Fixtures provide a flat safe floor, long turn and isolated tool activation. No physics or control behavior is replaced.',
    'Renderer.setState is wrapped only to retain an observation reference; camera buttons use their unmodified handlers.',
    'Portrait dialog cases open in landscape before rotation; the landscape-required game overlay stays behind the native modal.',
    'Dimensions emulate mobile layouts. These are not physical-device or gameplay-soak results.',
  ],
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, message, timeout = 6000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(message);
    await pause(25);
  }
}
async function hashes() {
  const files = (await readdir(new URL('../client/', import.meta.url))).filter((n) => /\.(js|css)$/.test(n));
  return Object.fromEntries(
    await Promise.all(
      files.map(async (name) => [
        name,
        createHash('sha256')
          .update(await readFile(new URL('../client/' + name, import.meta.url)))
          .digest('hex'),
      ]),
    ),
  );
}
const contained = (a, b, message) =>
  assert.ok(a.x >= b.x - 1 && a.y >= b.y - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1, message);
const separated = (a, b) =>
  Math.min(a.right, b.right) - Math.max(a.x, b.x) < 1 ||
  Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) < 1;
let app, browser, context, page, guest, game, owner;
const sent = [],
  received = [],
  accepted = [];
const fires = () => sent.filter((m) => m.type === 'action' && m.action.type === 'fire').length;
const latest = () => received.filter((m) => m.type === 'state').at(-1)?.state;
const menu = () => page.locator('.game-menu[open]');
async function capture(name) {
  await page.screenshot({ path: fileURLToPath(new URL(`hud-${kind}-${name}.png`, folder)) });
}
async function openMenu() {
  await page.locator('#hud-menu').tap();
  await menu().waitFor();
  await pause(180);
}
async function closeDialog() {
  await page.locator('dialog[open] .dialog-head button').tap();
  await until(async () => !(await page.locator('dialog').count()), 'Dialog closes');
}
async function neutral(label) {
  await until(
    () => ['move', 'thrustX', 'thrustY', 'reel'].every((k) => !game._input[k]),
    label + ' neutral input',
  );
}
async function camera() {
  return page.evaluate(() => ({
    fullView: __hudRenderer.fullView,
    autoFollow: __hudRenderer.autoFollow,
    goal: { ...__hudRenderer.cameraGoal },
  }));
}
async function resetWorm() {
  Object.assign(owner, { x: 800, y: 639, vx: 0, vy: 0, grounded: true, rope: null, jetpack: false });
  game._input = {};
  await pause(130);
}
async function settingsHand(hand) {
  await openMenu();
  await page.locator('.game-menu [data-settings]').tap();
  await page.locator('#hand').selectOption(hand);
  await closeDialog();
}
async function inspectLayout(hand, width, height) {
  await page.setViewportSize({ width, height });
  await pause(180);
  const layout = await page.evaluate(() => {
    const rect = (el) => el.getBoundingClientRect().toJSON(),
      visible = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const top = document.querySelector('.game-top'),
      style = getComputedStyle(top);
    const buttons = [
      ...document.querySelectorAll(
        '.game-top button,.camera-tools button,.control-deck button,.control-deck input',
      ),
    ]
      .filter(visible)
      .map((el) => {
        const b = rect(el),
          hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return {
          id: el.id || el.dataset.hold,
          ...b,
          tag: el.tagName,
          disabled: el.disabled,
          hit: hit === el || el.contains(hit),
          label: el.getAttribute('aria-label'),
          svg: !!el.querySelector('svg'),
          img: !!el.querySelector('img'),
        };
      });
    return {
      width: innerWidth,
      height: innerHeight,
      field: rect(document.querySelector('#field')),
      battlefield: rect(document.querySelector('.battlefield')),
      top: rect(top),
      topStyle: {
        background: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        backdropFilter: style.backdropFilter,
        borderBottomWidth: style.borderBottomWidth,
      },
      islands: [...top.children].filter(visible).map((el) => ({ class: el.className, ...rect(el) })),
      buttons,
      scrollWidth: document.documentElement.scrollWidth,
      joystickLabels: [...document.querySelectorAll('.stick-label,.stick-hint')].map((el) => ({
        id: el.id,
        visible:
          visible(el) &&
          getComputedStyle(el).opacity !== '0' &&
          !(
            el.getBoundingClientRect().width <= 1 &&
            el.getBoundingClientRect().height <= 1 &&
            getComputedStyle(el).clipPath !== 'none'
          ),
      })),
    };
  });
  const viewport = { x: 0, y: 0, right: width, bottom: height };
  assert.ok(layout.field.height >= height - 1, 'Full-height battlefield ' + width + ' ' + height);
  assert.ok(layout.field.y <= 1, 'Battlefield starts at top');
  assert.equal(layout.topStyle.backgroundImage, 'none', 'No continuous header background');
  assert.match(
    layout.topStyle.background,
    /rgba\(0, 0, 0, 0\)|transparent/,
    'Header container stays transparent',
  );
  assert.ok(layout.scrollWidth <= width, 'No horizontal document scroll');
  for (const item of layout.islands) contained(item, viewport, 'HUD island fits ' + item.class);
  for (let i = 0; i < layout.islands.length; i++)
    for (let j = i + 1; j < layout.islands.length; j++)
      assert.ok(separated(layout.islands[i], layout.islands[j]), 'HUD islands do not overlap');
  for (const b of layout.buttons) {
    assert.ok(
      b.width >= 43.9 && b.height >= (b.tag === 'INPUT' ? 23.9 : 43.9),
      `${hand}/${width}: ${b.id} touch target ${b.width}x${b.height}`,
    );
    contained(b, viewport, `${hand}/${width}: ${b.id} inside viewport`);
    assert.equal(b.hit, true, `${hand}/${width}: ${b.id} unobstructed`);
  }
  for (let i = 0; i < layout.buttons.length; i++)
    for (let j = i + 1; j < layout.buttons.length; j++)
      assert.ok(
        separated(layout.buttons[i], layout.buttons[j]),
        `${hand}/${width}: ${layout.buttons[i].id}/${layout.buttons[j].id} overlap`,
      );
  if (width < 1000) {
    const horizontal = layout.buttons.find((b) => b.id === 'move-stick'),
      vertical = layout.buttons.find((b) => b.id === 'aim-stick');
    assert.ok(horizontal && vertical, 'Both axis controls visible');
    assert.ok(
      hand === 'right'
        ? horizontal.x < width / 2 && vertical.x > width / 2
        : horizontal.x > width / 2 && vertical.x < width / 2,
      'Handed independent horizontal/vertical sticks',
    );
    assert.equal(await page.locator('#move-stick').getAttribute('data-axis'), 'x');
    assert.equal(await page.locator('#aim-stick').getAttribute('data-axis'), 'y');
    assert.equal(await page.locator('#aim').isVisible(), false, 'Mobile aim slider hidden');
    for (const label of layout.joystickLabels)
      assert.equal(label.visible, false, 'Joystick visual label hidden ' + label.id);
  }
  report.layouts.push({ hand, ...layout });
  if (width === 568 || width === 844 || width === 1280) await capture(`${hand}-${width}`);
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
  await page.goto(`http://127.0.0.1:${app.port}/`);
  await page.waitForFunction(() => document.querySelector('#connection')?.hidden);
  await page.evaluate(async () => {
    const { Renderer } = await import('/client/renderer.js');
    const original = Renderer.prototype.setState;
    Renderer.prototype.setState = function (...args) {
      window.__hudRenderer = this;
      return original.apply(this, args);
    };
  });
  await page.locator('#player-name').fill('Exploradores');
  await page.getByRole('button', { name: 'Crear sala privada →' }).click();
  await page.locator('#ready').waitFor();
  const identity = received.find((m) => m.type === 'welcome');
  guest = await NetworkClient.connect(app.port);
  await guest.command('join', { code: identity.code, name: 'Vigías' });
  await guest.command('ready', { ready: true });
  await page.locator('#ready').click();
  await page.locator('#start').click();
  await until(() => guest.room?.phase === 'loading', 'Guest loading');
  await guest.command('loaded');
  await page.waitForFunction(
    () => window.__hudRenderer?.pixi?.active && !document.querySelector('#fire').disabled,
  );
  game = app.rooms.get(identity.code).game;
  owner = game._active();
  game.terrain.data.fill(0);
  game.terrain.rect(0, 650, 1600, 250);
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
    }),
  );
  game.turn.remaining = 480;
  game._input = {};
  const action = game.action;
  game.action = function (id, a) {
    const result = action.call(this, id, a);
    accepted.push({ action: structuredClone(a), result: structuredClone(result) });
    return result;
  };
  await until(() => latest()?.terrainRevision === game.terrain.revision, 'Safe fixture arrives');
  await page.bringToFront();

  report.currentCase = 'floating-hud';
  assert.equal(
    await page.locator('.game-top button').count(),
    1,
    'Single game menu replaces header action row',
  );
  assert.equal(await page.locator('#hud-menu').count(), 1);
  assert.equal(await page.locator('#arsenal img').count(), 1, 'Equipped weapon has illustrated trigger');
  assert.ok((await page.locator('#arsenal img').getAttribute('src')).includes('bazooka'));
  for (const id of ['hud-menu', 'overview', 'focus', 'zoom-in', 'zoom-out', 'jump', 'backjump', 'release'])
    assert.ok((await page.locator('#' + id + ' svg').count()) >= 1, id + ' drawn icon');
  await inspectLayout('right', 844, 390);
  report.checks.push(
    'Floating turn/timer/wind islands over full-height battlefield; single menu, illustrated weapon selector and drawn action icons',
  );

  report.currentCase = 'menu-controls';
  await page.locator('#hud-menu').focus();
  await page.keyboard.down('d');
  await until(() => game._input.move > 0, 'Held movement reaches game');
  await openMenu();
  await page.keyboard.up('d');
  await neutral('Menu');
  for (const id of ['move-stick', 'aim-stick'])
    assert.equal(await page.locator('#' + id).evaluate((el) => el.classList.contains('is-held')), false);
  await page.locator('#menu-resume').tap();
  await until(async () => !(await menu().count()), 'Resume closes menu');
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'hud-menu',
    'Resume restores menu focus',
  );
  const fireBefore = fires();
  await page.locator('#fire').focus();
  await page.keyboard.down('Space');
  await page.waitForFunction(() => document.querySelector('#fire').classList.contains('is-charging'));
  await openMenu();
  await page.keyboard.up('Space');
  await pause(120);
  assert.equal(fires(), fireBefore, 'Menu cancels held shot without firing');
  assert.equal(await page.locator('#fire').evaluate((el) => el.classList.contains('is-charging')), false);
  await closeDialog();
  for (const [selector, content] of [
    ['#score', '.score-list'],
    ['#game-help', '.rules'],
    ['[data-settings]', '#hand'],
  ]) {
    await openMenu();
    await page.locator('.game-menu ' + selector).tap();
    await page.locator(content).waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 1, 'Nested action replaces menu cleanly');
    await closeDialog();
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      'hud-menu',
      selector + ' restores stable HUD trigger',
    );
  }
  await openMenu();
  await page.keyboard.press('Escape');
  await until(async () => !(await menu().count()), 'Escape closes menu');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'hud-menu');
  report.checks.push(
    'Menu neutralizes movement/charging; resume, Escape, health, controls and settings remain usable and restore focus',
  );

  report.currentCase = 'camera-and-actions';
  await page.locator('#overview').tap();
  assert.equal((await camera()).fullView, true);
  await page.locator('#focus').tap();
  assert.equal((await camera()).fullView, false);
  assert.equal((await camera()).autoFollow, true);
  let before = await camera();
  await page.locator('#zoom-in').tap();
  let after = await camera();
  assert.ok(after.goal.zoom > before.goal.zoom, 'Zoom-in works');
  before = after;
  await page.locator('#zoom-out').tap();
  after = await camera();
  assert.ok(after.goal.zoom < before.goal.zoom, 'Zoom-out works');
  for (const [id, back] of [
    ['jump', false],
    ['backjump', true],
  ]) {
    await resetWorm();
    const start = accepted.length;
    await page.locator('#' + id).tap();
    await until(
      () =>
        accepted.slice(start).some((e) => e.action.type === 'jump' && e.action.back === back && e.result.ok),
      id + ' accepted',
    );
  }
  await resetWorm();
  Object.assign(owner, { jetpack: true, fuel: 60 });
  await until(() => latest()?.worms.find((w) => w.id === owner.id).jetpack, 'Active jetpack arrives');
  await pause(100);
  assert.equal(await page.locator('#release').isEnabled(), true);
  const start = accepted.length;
  await page.locator('#release').tap();
  await until(
    () => accepted.slice(start).some((e) => e.action.type === 'release' && e.result.ok),
    'Release accepted',
  );
  assert.equal(owner.jetpack, false);
  report.checks.push(
    'Overview/focus/zoom, both jumps and active tool release keep their actual camera/authoritative actions',
  );

  report.currentCase = 'responsive-controls';
  for (const hand of ['right', 'left']) {
    await settingsHand(hand);
    for (const [width, height] of [
      [1280, 800],
      [568, 320],
      [667, 375],
      [844, 390],
      [936, 432],
    ])
      await inspectLayout(hand, width, height);
  }
  report.checks.push(
    'Desktop and four mobile landscapes in both hands preserve 44px targets, accessible camera/actions, no collisions or horizontal overflow, and full viewport battlefield',
  );

  report.currentCase = 'portrait-menus';
  for (const [width, height] of [
    [320, 700],
    [375, 812],
    [414, 896],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width: 844, height: 390 });
    await openMenu();
    await page.setViewportSize({ width, height });
    await pause(140);
    const layout = await menu().evaluate((el) => ({
      dialog: el.getBoundingClientRect().toJSON(),
      scrollWidth: document.documentElement.scrollWidth,
      buttons: [...el.querySelectorAll('button')].map((b) => ({
        id: b.id,
        label: b.getAttribute('aria-label'),
        ...b.getBoundingClientRect().toJSON(),
      })),
    }));
    const viewport = { x: 0, y: 0, right: width, bottom: height };
    contained(layout.dialog, viewport, width + ' portrait menu');
    assert.ok(layout.scrollWidth <= width);
    for (const b of layout.buttons) {
      contained(b, viewport, width + ' menu ' + b.id);
      assert.ok(b.width >= 43.9 && b.height >= 43.9);
    }
    if (width === 375) await capture('menu-portrait');
    await closeDialog();
    assert.equal(
      await page.locator('.rotate-overlay').isVisible(),
      true,
      'Portrait orientation requires landscape',
    );
    report.layouts.push({ portraitMenu: true, width, height, ...layout });
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await settingsHand('right');
  await capture('final');
  report.checks.push(
    'Game menu remains fully usable after rotating into four portrait sizes; closing returns to orientation guidance',
  );

  report.currentCase = 'end-turn';
  const oldTurn = game.turn.number;
  assert.equal(await page.locator('#end').count(), 0, 'Deck carries no pass button');
  await openMenu();
  assert.ok((await page.locator('#menu-end svg').count()) >= 1, 'menu-end drawn icon');
  assert.equal(await page.locator('#menu-end').isEnabled(), true, 'Pass turn enabled on own turn');
  await page.locator('#menu-end').tap();
  await until(() => accepted.some((e) => e.action.type === 'end' && e.result.ok), 'Pass turn accepted');
  await until(() => game.turn.number !== oldTurn, 'Pass advances turn');
  report.checks.push(
    'Pass turn from the game menu submits the existing end-turn action and advances the turn',
  );
  assert.equal(fires(), 0, 'HUD tests never fire incidental shot');
  assert.deepEqual(report.errors, []);
  report.finalSourceSHA256 = await hashes();
  assert.deepEqual(report.finalSourceSHA256, report.sourceSHA256, 'Sources unchanged during browser run');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  if (page) {
    await capture('failure').catch(() => {});
    report.focus = await page
      .evaluate(() => ({ id: document.activeElement?.id, tag: document.activeElement?.tagName }))
      .catch(() => null);
  }
  throw error;
} finally {
  if (report.passed) await unlink(new URL(`hud-${kind}-failure.png`, folder)).catch(() => {});
  await writeFile(new URL(`hud-${kind}.json`, folder), JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        browser: kind,
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
