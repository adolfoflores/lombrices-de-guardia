// Local integration test: isolated browser contexts are six independent guests.
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from '../server/index.js';
const engine = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const mapId = process.env.TEST_MAP || 'hills';
assert.ok(['hills', 'cavern', 'islands'].includes(mapId), 'Known test map');
let app, browser;
const errors = [],
  contexts = [],
  pages = [],
  streams = [];
const evidence = new URL(`../docs/evidence/browser/${engine}-${mapId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
const report = {
  browser: engine,
  mapId,
  version: null,
  platform: process.platform,
  physicalDevice: false,
  checks: [],
  sizes: [],
  startedAt: new Date().toISOString(),
};
const wait = async (fn, message, ms = 10000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
};
const last = (i) => streams[i].filter((m) => m.type === 'state').at(-1)?.state;
try {
  app = await createServer({ port: 0, dev: process.env.TEST_PRODUCTION !== '1' });
  const url = `http://127.0.0.1:${app.port}`;
  browser = await (engine === 'webkit' ? webkit : chromium).launch(
    engine === 'webkit' ? { headless: true } : { headless: true, channel: 'chrome' },
  );
  report.version = browser.version();
  for (let i = 0; i < 6; i++) {
    const context = await browser.newContext(
      i === 0
        ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }
        : { viewport: { width: 1280, height: 800 } },
    );
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    streams.push([]);
    page.on('pageerror', (e) => errors.push(e.message));
    let sockets = 0;
    page.on('websocket', (ws) => {
      if (!ws.url().includes('/socket')) return;
      sockets++;
      ws.on('framereceived', ({ payload }) => {
        try {
          streams[i].push(JSON.parse(String(payload)));
          if (streams[i].length > 1200) streams[i].splice(0, 300);
        } catch {}
      });
    });
    await page.goto(url);
    await page.locator('#player-name').waitFor();
    if (i === 0) {
      await page.waitForTimeout(16_000);
      assert.equal(sockets, 0, 'an idle home screen opens no socket or reconnect loop');
      report.checks.push('Home stays idle beyond the anonymous admission deadline');
    }
    await wait(() => page.locator('#connection').isHidden(), 'WebSocket connects');
    await page.locator('#player-name').fill(`Prueba ${i + 1}`);
    if (i === 0) {
      await page.getByRole('button', { name: 'Crear sala privada →' }).click();
      await page.locator('#copy-code').waitFor();
    } else {
      const code = (await pages[0].locator('#copy-code').innerText()).split(' ')[0].trim();
      await page.getByRole('tab', { name: 'Tengo un código' }).click();
      await page.locator('#player-name').fill(`Prueba ${i + 1}`);
      await page.locator('#room-code').fill(code);
      await page.getByRole('button', { name: 'Entrar a la sala →' }).click();
      await page.locator('#ready').waitFor();
    }
  }
  assert.equal(await pages[0].locator('.lobby-roster li').count(), 6);
  report.checks.push('Six isolated browser contexts create/join same private room');
  if (mapId !== 'hills') {
    await pages[0].locator(`button[data-map="${mapId}"]`).click();
    await wait(
      () =>
        pages[0]
          .locator(`button[data-map="${mapId}"]`)
          .getAttribute('aria-pressed')
          .then((value) => value === 'true'),
      'Selected map acknowledged',
    );
  }
  await pages[0].screenshot({ path: new URL('lobby-mobile.png', evidence).pathname, fullPage: true });
  for (const p of pages) await p.locator('#ready').click();
  await pages[0].locator('#start').click();
  await Promise.all(pages.map((p) => p.locator('#field').waitFor()));
  await wait(() => streams.every((s) => s.some((m) => m.type === 'state')), 'All six receive game');
  await Promise.all(pages.map((p) => p.locator('.pixi-field').waitFor()));
  for (const p of pages)
    assert.equal(await p.locator('canvas').count(), 2, 'one terrain canvas and one Pixi overlay per client');
  report.checks.push('All six clients initialize Pixi combat with exactly one GPU overlay');
  assert.equal(last(0).worms.length, 12);
  assert.equal(new Set(streams.map((s) => s.find((m) => m.type === 'welcome').playerId)).size, 6);
  await wait(() => pages[0].locator('#fire').isEnabled(), 'First player has action');
  const rect = await pages[0].locator('#field').boundingBox();
  assert.ok(rect.height > 120);
  const fire = await pages[0].locator('#fire').boundingBox();
  assert.ok(fire.width >= 44 && fire.height >= 44);
  const initial = last(0);
  const wormId = initial.turn.wormId;
  const x0 = initial.worms.find((w) => w.id === wormId).x;
  const right = await pages[0].locator('#move-stick').boundingBox();
  await pages[0].mouse.move(right.x + right.width - 3, right.y + right.height / 2);
  await pages[0].mouse.down();
  await new Promise((r) => setTimeout(r, 500));
  await pages[0].mouse.up();
  await wait(
    () => last(0).worms.find((w) => w.id === wormId).x > x0 + 10,
    'Touch-region movement reaches server',
  );
  assert.ok(await pages[0].locator('#aim').isHidden(), 'Mobile aiming does not depend on the desktop slider');
  const aimBefore = last(0).worms.find((w) => w.id === wormId).aim;
  const stick = await pages[0].locator('#aim-stick').boundingBox();
  await pages[0].mouse.move(stick.x + stick.width / 2, stick.y + stick.height - 3);
  await pages[0].mouse.down();
  try {
    await wait(
      () => last(0).worms.find((w) => w.id === wormId).aim >= (65 * Math.PI) / 180,
      'Held right joystick changes authoritative aim',
      7000,
    );
  } finally {
    await pages[0].mouse.up();
  }
  await new Promise((r) => setTimeout(r, 150));
  const aimAfter = last(0).worms.find((w) => w.id === wormId).aim;
  assert.ok(
    aimAfter > aimBefore + 0.5 && aimAfter <= Math.PI / 2,
    'Joystick raises the shot angle within its vertical bound',
  );
  report.mobileAim = { before: aimBefore, after: aimAfter, control: 'separate right vertical joystick' };
  await pages[0].mouse.move(fire.x + fire.width / 2, fire.y + fire.height / 2);
  await pages[0].mouse.down();
  await new Promise((r) => setTimeout(r, 650));
  await pages[0].mouse.up();
  await wait(() => last(0).terrainRevision > initial.terrainRevision, 'UI shot destroys terrain', 12000);
  await wait(() => last(0).turn.number > initial.turn.number, 'Turn resolves after shot', 12000);
  report.checks.push(
    'Left joystick movement and right joystick aiming, held fire, terrain destruction and next turn through UI',
  );
  await pages[0].screenshot({ path: new URL('combat-mobile.png', evidence).pathname });
  const code = streams[0].find((m) => m.type === 'welcome').code;
  const originalId = streams[0].find((m) => m.type === 'welcome').playerId;
  await pages[0].reload();
  await pages[0].locator('#field').waitFor();
  await wait(() => streams[0].filter((m) => m.type === 'welcome').length >= 2, 'Reconnect welcome');
  await pages[0].locator('.pixi-field').waitFor();
  assert.equal(await pages[0].locator('.pixi-field').count(), 1);
  assert.equal(streams[0].filter((m) => m.type === 'welcome').at(-1).playerId, originalId);
  assert.ok(last(0).terrainRevision > 0);
  report.checks.push('Reload resumes same identity and destroyed terrain');
  // Orientation cannot commit a charged shot; do this on the current active browser.
  let current = streams.findIndex(
    (s) => s.find((m) => m.type === 'welcome')?.playerId === last(0).turn.playerId,
  );
  const cp = pages[current];
  await cp.locator('#arsenal').click();
  assert.equal(await cp.locator('[data-weapon]').count(), 12);
  await cp.getByRole('button', { name: 'Cerrar', exact: true }).click();
  report.checks.push('All twelve implemented weapons visible in arsenal');
  await pages[0].setViewportSize({ width: 390, height: 844 });
  assert.ok(await pages[0].locator('.rotate-overlay').isVisible());
  await pages[0].screenshot({ path: new URL('rotate-mobile.png', evidence).pathname });
  await pages[0].setViewportSize({ width: 844, height: 390 });
  await pages[0].locator('#hud-menu').click();
  await pages[0].getByRole('button', { name: 'Ajustes', exact: true }).click();
  await pages[0].locator('#hand').selectOption('left');
  await pages[0].locator('#quality').selectOption('low');
  await pages[0].locator('#motion').check();
  await pages[0].getByRole('button', { name: 'Cerrar', exact: true }).click();
  assert.ok(await pages[0].locator('.game.left-handed').count());
  report.checks.push('Portrait guard, left-handed layout, reduced motion and low graphics');
  const metrics = await pages[1].evaluate(async () => {
    const samples = [];
    let previous = performance.now();
    await new Promise((resolve) => {
      const frame = (now) => {
        samples.push(now - previous);
        previous = now;
        if (samples.length < 120) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    samples.shift();
    samples.sort((a, b) => a - b);
    return {
      frameMedianMs: samples[Math.floor(samples.length / 2)],
      frameP95Ms: samples[Math.floor(samples.length * 0.95)],
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
      loadMs: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd,
    };
  });
  report.renderMeasurement = metrics;
  // End through explicit departures (authoritative, user-facing path), keep original host as winner.
  for (let i = 5; i >= 1; i--) {
    await pages[i].locator('#hud-menu').click();
    await pages[i].getByRole('button', { name: 'Ajustes', exact: true }).click();
    await pages[i].locator('#leave-settings').click();
    await pages[i].locator('#entry-form').waitFor();
  }
  await pages[0].locator('#result-dialog').waitFor({ timeout: 20000 });
  report.checks.push('Explicit departures resolve result without stranded turn');
  await pages[0].locator('#rematch').click();
  await pages[0].locator('#ready').waitFor();
  // A new second guest can join the retained room and launch the rematch.
  await pages[1].getByRole('tab', { name: 'Tengo un código' }).click();
  await pages[1].locator('#player-name').fill('Vuelta');
  await pages[1].locator('#room-code').fill(code);
  await pages[1].getByRole('button', { name: 'Entrar a la sala →' }).click();
  await pages[1].locator('#ready').waitFor();
  await pages[0].locator('#ready').click();
  await pages[1].locator('#ready').click();
  await pages[0].locator('#start').click();
  await pages[0].locator('#field').waitFor();
  await pages[1].locator('#field').waitFor();
  report.checks.push('Result and rematch restart through UI');
  const responsive = pages[5];
  for (const width of [320, 375, 414, 768]) {
    await responsive.setViewportSize({ width, height: 850 });
    await responsive.goto(url);
    const dims = await responsive.evaluate(() => ({
      view: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(dims.document <= dims.view, `overflow at ${width}`);
    report.sizes.push({ width, overflow: false });
  }
  await responsive.setViewportSize({ width: 1280, height: 900 });
  await responsive.screenshot({ path: new URL('home-desktop.png', evidence).pathname, fullPage: true });
  assert.deepEqual(errors, []);
  report.checks.push('No browser runtime errors; home 320/375/414/768 without horizontal overflow');
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = { message: error.message, code: error.code || null };
  throw error;
} finally {
  report.errors = errors;
  await writeFile(new URL(`browser-${engine}.json`, evidence), JSON.stringify(report, null, 2) + '\n');
  await Promise.all(contexts.map((c) => c.close()));
  await browser?.close();
  await app?.close();
}
