/* Browser fixture globals supplied explicitly by the inline harness. */
/* global __lobbyRenderer */
// Integrated lobby, iPhone layout and install-metadata checks. Run engines sequentially.
// This uses the normal UI/socket path; safe terrain and finished-match fixtures isolate layout checks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { createServer } from '../server/index.js';
import { WEAPONS } from '../shared/config.js';

const kind = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const evidence = new URL('../docs/evidence/', import.meta.url);
const report = {
  browser: kind,
  physicalDevice: false,
  startedAt: new Date().toISOString(),
  checks: [],
  lobby: [],
  fire: [],
  rotation: [],
  errors: [],
  notes: [
    'Two independent browser contexts use the actual lobby, controls and WebSocket service.',
    'After verifying the selected initial turn duration, a flat floor and long turn isolate UI checks. Jetpack activation and finished-match fixtures test labels and rematch without waiting for a full game.',
    'Text is measured using DOM Range rectangles, including glyph-layout bounds, not only element boxes. iOS text autosizing is checked through computed text-size-adjust and viewport policy.',
    'Mobile dimensions and WebKit emulate layout, not a physical iPhone or Home Screen installation. No offline capability is claimed.',
  ],
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 10000) {
  const end = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error(message);
    await pause(25);
  }
}
async function hashes() {
  const files = ['index.html', 'public/manifest.webmanifest'];
  for (const dir of ['client', 'shared', 'server'])
    for (const name of await readdir(new URL(`../${dir}/`, import.meta.url)))
      if (/\.(js|css)$/.test(name)) files.push(`${dir}/${name}`);
  return Object.fromEntries(
    await Promise.all(
      files.sort().map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(new URL(`../${path}`, import.meta.url)))
          .digest('hex'),
      ]),
    ),
  );
}
function contained(rect, container, label) {
  assert.ok(
    rect.x >= container.x - 1 &&
      rect.y >= container.y - 1 &&
      rect.right <= container.right + 1 &&
      rect.bottom <= container.bottom + 1,
    `${label}: ${JSON.stringify(rect)} inside ${JSON.stringify(container)}`,
  );
}
let app, browser, game, hostId, roomCode;
const contexts = [],
  pages = [],
  enteredNames = [],
  streams = [[], []],
  sent = [[], []];
const latest = (index) => streams[index].filter((m) => m.type === 'state').at(-1)?.state;
const latestRoom = (index) => streams[index].filter((m) => m.type === 'room').at(-1)?.room;
const fires = () => sent.flat().filter((m) => m.type === 'action' && m.action.type === 'fire').length;
const host = () => pages[0];
async function capture(name, fullPage = false) {
  await host().screenshot({
    path: fileURLToPath(new URL(`lobby-mobile-${kind}-${name}.png`, evidence)),
    fullPage,
  });
}
async function closeDialog() {
  await host().locator('dialog[open] .dialog-head button').tap();
  await until(async () => !(await host().locator('dialog[open]').count()), 'Dialog closes');
}
async function openMenu() {
  await host().locator('#hud-menu').tap();
  await host().locator('.game-menu[open]').waitFor();
}
async function hand(value) {
  await openMenu();
  await host().locator('.game-menu [data-settings]').tap();
  await host().locator('#hand').selectOption(value);
  await closeDialog();
}
async function equip(id) {
  await host().locator('#arsenal').tap();
  await host().locator(`[data-weapon="${id}"]`).tap();
  await host().locator('#arsenal-equip').tap();
  await until(async () => !(await host().locator('dialog[open]').count()), 'Arsenal closes');
}
async function setViewport(width, height) {
  await host().setViewportSize({ width, height });
  await pause(120);
}
async function fireBounds(label, weapon, handed) {
  const data = await host().evaluate(() => {
    const button = document.querySelector('#fire'),
      b = button.getBoundingClientRect();
    return {
      width: innerWidth,
      height: innerHeight,
      button: b.toJSON(),
      textSizeAdjustSupported:
        CSS.supports('-webkit-text-size-adjust', '100%') || CSS.supports('text-size-adjust', '100%'),
      textSizeAdjust:
        getComputedStyle(button).getPropertyValue('-webkit-text-size-adjust') ||
        getComputedStyle(button).getPropertyValue('text-size-adjust'),
      labels: ['fire-text', 'power-text'].map((id) => {
        const element = document.getElementById(id),
          range = document.createRange();
        range.selectNodeContents(element);
        const style = getComputedStyle(element);
        return {
          id,
          text: element.textContent,
          fontSize: style.fontSize,
          rect: range.getBoundingClientRect().toJSON(),
        };
      }),
    };
  });
  report.fire.push({ state: label, weapon, hand: handed, ...data });
  if (data.textSizeAdjustSupported)
    assert.equal(data.textSizeAdjust, '100%', 'Combat text autosizing fixed at 100%');
  else
    assert.match(
      await readFile(new URL('../client/combat-hud.css', import.meta.url), 'utf8'),
      /\.game\s*\{\s*-webkit-text-size-adjust:\s*100%;\s*text-size-adjust:\s*100%;\s*\}/,
      'iPhone text-size policy is authored even when the desktop engine has no autosizing implementation',
    );
  contained(data.button, { x: 0, y: 0, right: data.width, bottom: data.height }, 'Fire button fits');
  const cx = data.button.x + data.button.width / 2,
    cy = data.button.y + data.button.height / 2;
  const radius = data.button.width / 2 - 1;
  for (const text of data.labels) {
    const r = text.rect;
    contained(r, data.button, `${label}/${weapon}/${handed}: ${text.text}`);
    assert.ok(
      Math.abs((r.x + r.right) / 2 - cx) <= 1,
      `Centered text: ${text.text}, offset=${(r.x + r.right) / 2 - cx}px, width=${r.width}px, button=${data.button.width}px`,
    );
    for (const x of [r.x, r.right])
      for (const y of [r.y, r.bottom])
        assert.ok(
          Math.hypot(x - cx, y - cy) <= radius + 1,
          `${data.button.width}px circle contains actual text ${text.text}`,
        );
  }
}

try {
  await mkdir(evidence, { recursive: true });
  report.sourceSHA256 = await hashes();
  app = await createServer({ dev: true });
  browser = await (kind === 'webkit' ? webkit : chromium).launch(
    kind === 'webkit' ? { headless: true } : { headless: true, channel: 'chrome' },
  );
  report.version = browser.version();
  const base = `http://127.0.0.1:${app.port}`;
  report.currentCase = 'install-metadata';
  const manifestResponse = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, undefined);
  for (const icon of [...manifest.icons, { src: '/icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const response = await fetch(base + icon.src);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/png/);
    const data = Buffer.from(await response.arrayBuffer());
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(data.readUInt32BE(16), size);
    assert.equal(data.readUInt32BE(20), size);
  }
  report.checks.push(
    'HTTP manifest and three PNG icons resolve with correct MIME and dimensions; installed entry point omits room invitations and does not lock portrait',
  );
  for (let index = 0; index < 2; index++) {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 1,
    });
    contexts.push(context);
    await context.addInitScript(() =>
      localStorage.setItem(
        'ldg-prefs',
        JSON.stringify({ quality: 'low', music: 0, sfx: 0, reducedMotion: true }),
      ),
    );
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('websocket', (ws) => {
      if (!ws.url().endsWith('/socket')) return;
      ws.on('framereceived', ({ payload }) => {
        try {
          streams[index].push(JSON.parse(String(payload)));
        } catch {}
      });
      ws.on('framesent', ({ payload }) => {
        try {
          sent[index].push(JSON.parse(String(payload)));
        } catch {}
      });
    });
    await page.goto(index ? `${base}/?sala=${roomCode}` : base);
    await page.waitForFunction(() => document.querySelector('#connection')?.hidden);
    await page.locator('#player-name').fill(index ? 'Exploradores del coral 02' : 'Capitana de largo nombre');
    enteredNames.push(await page.locator('#player-name').inputValue());
    await page.locator('[data-connect]').tap();
    await page.locator('#ready').waitFor();
    if (!index) {
      const identity = streams[0].find((m) => m.type === 'welcome');
      roomCode = identity.code;
      hostId = identity.playerId;
    }
  }
  await host().bringToFront();
  await until(() => latestRoom(0)?.players.length === 2, 'Both players join');
  assert.equal(await pages[1].locator('#turn-seconds').isDisabled(), true, 'Guest cannot change timer');
  assert.deepEqual(
    await host()
      .locator('#turn-seconds option')
      .evaluateAll((nodes) => nodes.map((n) => Number(n.value))),
    [30, 45, 60],
  );
  report.currentCase = 'lobby-layouts';
  for (const [width, height] of [
    [320, 700],
    [375, 812],
    [414, 896],
    [768, 1024],
    [844, 390],
    [1280, 800],
  ]) {
    await setViewport(width, height);
    const layout = await host().evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      buttons: [...document.querySelectorAll('main button,main select')]
        .filter((el) => el.getClientRects().length)
        .map((el) => ({
          id: el.id || el.dataset.map,
          rect: el.getBoundingClientRect().toJSON(),
          text: el.textContent.trim(),
          minHeight: getComputedStyle(el).minHeight,
          appearance: getComputedStyle(el).appearance,
        })),
      names: [...document.querySelectorAll('.lobby-player-copy strong')].map((el) => ({
        text: el.textContent,
        rect: el.getBoundingClientRect().toJSON(),
      })),
    }));
    report.lobby.push(layout);
    assert.ok(layout.scrollWidth <= width, `${width}px lobby does not overflow horizontally`);
    assert.equal(layout.names.length, 2);
    for (const name of enteredNames)
      assert.ok(
        layout.names.some((item) => item.text.includes(name)),
        `Roster preserves entered name: ${name}`,
      );
    for (const b of layout.buttons) {
      assert.ok(
        b.rect.width >= 43.9 && b.rect.height >= 43.9,
        `${width}px touch target ${b.id} is ${b.rect.width}x${b.rect.height}`,
      );
      assert.ok(b.rect.x >= -1 && b.rect.right <= width + 1, `${b.id} fits lobby width`);
    }
    await host().locator('#ready').scrollIntoViewIfNeeded();
    const ready = await host().locator('#ready').boundingBox();
    assert.ok(ready.y >= 0 && ready.y + ready.height <= height + 1, 'Ready is reachable by scrolling');
    await host().evaluate(() => scrollTo(0, 0));
    if ([375, 1280].includes(width)) await capture(`lobby-${width}`, true);
  }
  report.checks.push(
    'Lobby fits 320/375/414/768 portrait, 844 landscape and desktop; long player names, touch targets and scroll-to-ready remain usable',
  );
  report.currentCase = 'settings-sync';
  await setViewport(844, 390);
  for (const mapId of ['cavern', 'islands', 'hills']) {
    await host().locator(`button[data-map="${mapId}"]`).tap();
    await until(() => latestRoom(1)?.settings.mapId === mapId, 'Map sync');
    assert.equal(await pages[1].locator(`button[data-map="${mapId}"]`).getAttribute('aria-pressed'), 'true');
  }
  for (const seconds of [30, 45, 60]) {
    for (let index = 0; index < 2; index++)
      if (
        !latestRoom(index).players.find(
          (p) => p.id === streams[index].find((m) => m.type === 'welcome').playerId,
        ).ready
      )
        await pages[index].locator('#ready').tap();
    await until(() => latestRoom(0).players.every((p) => p.ready), 'Everyone ready before changing timer');
    await host().locator('#turn-seconds').selectOption(String(seconds));
    await until(
      () => latestRoom(1)?.settings.turnSeconds === seconds && latestRoom(1).players.every((p) => !p.ready),
      'Timer sync resets ready',
    );
    assert.equal(await pages[1].locator('#turn-seconds').inputValue(), String(seconds));
    assert.equal(await host().locator('#start').isDisabled(), true);
  }
  report.checks.push(
    'All three maps and 30/45/60-second choices synchronize to guest; timer changes clear ready state and block premature start',
  );
  await host().evaluate(async () => {
    const { Renderer } = await import('/client/renderer.js');
    const setState = Renderer.prototype.setState;
    Renderer.prototype.setState = function (...args) {
      window.__lobbyRenderer = this;
      return setState.apply(this, args);
    };
  });
  for (const page of pages) {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator('#ready').tap();
  }
  await until(() => latestRoom(0).players.every((p) => p.ready), 'Ready to start');
  await host().locator('#start').tap();
  await host().waitForFunction(
    () => window.__lobbyRenderer?.pixi?.active && !document.querySelector('#fire').disabled,
    { timeout: 20000 },
  );
  game = app.rooms.get(roomCode).game;
  assert.equal(game.turnSeconds, 60);
  assert.ok(game.turn.remaining > 45 && game.turn.remaining <= 60, 'Selected 60-second turn starts');
  assert.equal(latest(1).turnSeconds, 60);
  report.initialBudget = {
    configured: game.turnSeconds,
    remaining: game.turn.remaining,
    display: await host().locator('#timer').textContent(),
  };
  report.checks.push('The real first turn starts with the selected 60-second action budget on both clients');
  game.terrain.data.fill(0);
  game.terrain.rect(0, 650, 1600, 250);
  game.terrain.revision++;
  game.worms.forEach((w, index) =>
    Object.assign(w, {
      x: w.id === game.turn.wormId ? 800 : 100 + index * 110,
      y: 639,
      vx: 0,
      vy: 0,
      hp: 100,
      grounded: true,
      rope: null,
      jetpack: false,
    }),
  );
  game.turn.remaining = 600;
  await until(() => latest(0)?.terrainRevision === game.terrain.revision, 'Safe layout fixture arrives');
  await host().bringToFront();
  assert.doesNotMatch(
    await host().locator('meta[name=viewport]').getAttribute('content'),
    /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i,
  );
  report.currentCase = 'fire-text';
  const landscapes = [
    [568, 320, 72],
    [844, 390, 76],
    [1280, 800, 92],
  ];
  for (const handed of ['right', 'left']) {
    await setViewport(844, 390);
    await hand(handed);
    for (const weapon of WEAPONS) {
      await setViewport(844, 390);
      await equip(weapon.id);
      for (const [width, height, diameter] of landscapes) {
        await setViewport(width, height);
        assert.equal(Math.round((await host().locator('#fire').boundingBox()).width), diameter);
        await fireBounds('idle', weapon.id, handed);
        if (weapon.id === 'bazooka') {
          await host().locator('#fire').focus();
          await host().keyboard.down('Space');
          await host().waitForFunction(() =>
            document.querySelector('#fire').classList.contains('is-charging'),
          );
          await fireBounds('charging', weapon.id, handed);
          await host().waitForFunction(() => document.querySelector('#fire').classList.contains('is-full'));
          await fireBounds('full', weapon.id, handed);
          if (width === 844 && handed === 'right') await capture('fire-charged');
          await openMenu();
          await host().keyboard.up('Space');
          await closeDialog();
        }
      }
      if (weapon.id === 'jetpack') {
        Object.assign(game._active(), { jetpack: true, fuel: 600 });
        await until(
          async () => (await host().locator('#fire-text').textContent()) === 'APAGAR',
          'Active jetpack label',
        );
        for (const [width, height] of landscapes) {
          await setViewport(width, height);
          await fireBounds('active', weapon.id, handed);
        }
        Object.assign(game._active(), { jetpack: false, vx: 0, vy: 0, y: 639, grounded: true });
      }
    }
  }
  assert.equal(fires(), 0, 'Text measurements and canceled charges never submit a shot');
  report.checks.push(
    'Actual text Range bounds fit centered inside 72/76/92px circular fire buttons: every weapon, charging/full power and active jetpack, with both handed layouts',
  );
  report.currentCase = 'rotation';
  await setViewport(844, 390);
  await hand('right');
  await equip('bazooka');
  for (const [width, height] of [
    [320, 568],
    [375, 812],
    [414, 896],
    [768, 1024],
  ]) {
    await host().locator('#fire').focus();
    await host().keyboard.down('Space');
    await host().waitForFunction(() => document.querySelector('#fire').classList.contains('is-charging'));
    await setViewport(width, height);
    await host().keyboard.up('Space');
    assert.equal(await host().locator('.rotate-overlay').isVisible(), true);
    assert.equal(
      await host()
        .locator('#fire')
        .evaluate((el) => el.classList.contains('is-charging')),
      false,
    );
    const data = await host().evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      card: document.querySelector('.rotate-card').getBoundingClientRect().toJSON(),
      button: document.querySelector('#rotate-menu').getBoundingClientRect().toJSON(),
      text: document.querySelector('.rotate-card').innerText,
    }));
    contained(data.card, { x: 0, y: 0, right: width, bottom: height }, 'Portrait orientation card fits');
    assert.ok(data.scrollWidth <= width);
    assert.ok(data.button.width >= 44 && data.button.height >= 44);
    await host().locator('#rotate-menu').tap();
    await host().locator('.game-menu[open]').waitFor();
    await host().locator('#menu-resume').tap();
    await until(async () => !(await host().locator('dialog[open]').count()), 'Portrait menu returns');
    assert.equal(await host().locator('.rotate-overlay').isVisible(), true);
    assert.equal(
      await host().evaluate(() => document.activeElement?.id),
      'rotate-menu',
      'Portrait menu returns focus to visible trigger',
    );
    report.rotation.push(data);
    if (width === 375) await capture('rotate-375');
    await setViewport(844, 390);
    assert.equal(await host().locator('.rotate-overlay').isVisible(), false);
    await fireBounds('after-rotation', 'bazooka', 'right');
  }
  assert.equal(fires(), 0);
  report.checks.push(
    'Four portrait rotation guides fit, cancel held charge, open the menu and return safely; landscape resumes with correctly sized text and no incidental fire',
  );
  report.currentCase = 'camera-and-baseline-joysticks';
  const camera = () => host().evaluate(() => ({ ...__lobbyRenderer.cameraGoal }));
  await host().locator('#focus').tap();
  let before = await camera();
  await host().locator('#zoom-in').tap();
  let after = await camera();
  assert.ok(after.zoom > before.zoom);
  await host().locator('#zoom-out').tap();
  assert.ok((await camera()).zoom < after.zoom);
  const owner = game._active(),
    startX = owner.x,
    startAim = owner.aim;
  for (const [selector, axis] of [
    ['#move-stick', 'x'],
    ['#aim-stick', 'y'],
  ]) {
    const b = await host().locator(selector).boundingBox();
    await host().mouse.move(
      b.x + b.width * (axis === 'x' ? 0.85 : 0.5),
      b.y + b.height * (axis === 'y' ? 0.85 : 0.5),
    );
    await host().mouse.down();
    await pause(250);
    await host().mouse.up();
  }
  await until(() => owner.x > startX + 5 && owner.aim > startAim + 0.05, 'Baseline movement and aim respond');
  assert.equal(fires(), 0);
  report.checks.push(
    'Map zoom buttons and restored independent horizontal-movement/vertical-aim joysticks work without accidental shooting',
  );
  await capture('combat-final');
  report.currentCase = 'rematch';
  game.worms.filter((w) => w.playerId !== hostId).forEach((w) => (w.hp = 0));
  game._finishIfWon();
  await host().locator('#result-dialog').waitFor();
  await host().locator('#rematch').tap();
  await host().locator('#turn-seconds').waitFor();
  assert.equal(await host().locator('#turn-seconds').inputValue(), '60');
  await until(() => latestRoom(1)?.phase === 'lobby', 'Guest returns to retained room');
  assert.equal(latestRoom(1).settings.turnSeconds, 60);
  report.checks.push('Preparing a rematch retains the selected 60-second setting and group');
  report.finalSourceSHA256 = await hashes();
  assert.deepEqual(report.finalSourceSHA256, report.sourceSHA256, 'Sources unchanged during run');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  if (pages[0]) await capture('failure', report.currentCase === 'lobby-layouts').catch(() => {});
  throw error;
} finally {
  if (report.passed) await unlink(new URL(`lobby-mobile-${kind}-failure.png`, evidence)).catch(() => {});
  await writeFile(new URL(`lobby-mobile-${kind}.json`, evidence), JSON.stringify(report, null, 2) + '\n');
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
  for (const context of contexts) await context.close();
  await browser?.close();
  await app?.close();
}
