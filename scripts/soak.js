// Real wall-clock browser soak with a mobile viewport and visible pointer controls.
// Test orchestration only; no bots in the game or physical-device claims.
import { chromium } from 'playwright';
import { createServer } from '../server/index.js';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const duration = Number(process.env.SOAK_SECONDS || 600) * 1000;
const app = await createServer({ port: 0, dev: false });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pages = [],
  contexts = [],
  states = [],
  identities = [],
  errors = [],
  samples = [];
const wait = async (fn, ms = 10000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Soak wait timeout');
};
const report = {
  browser: browser.version(),
  physicalDevice: false,
  durationRequestedSeconds: duration / 1000,
  kind: 'real wall-clock production client, six isolated mobile viewports with pointer controls',
  shots: 0,
  completedMatches: 0,
  samples,
};
async function aimWithJoystick(page, index, wormId, side) {
  const box = await page.locator('#move-stick').boundingBox();
  assert.ok(box, 'Visible mobile joystick');
  const worm = () => states[index]?.worms.find((w) => w.id === wormId);
  // Turn toward the center with the same horizontal control used for walking.
  await page.mouse.move(box.x + (side < 0 ? 3 : box.width - 3), box.y + box.height / 2);
  await page.mouse.down();
  try {
    await wait(() => worm()?.facing === side, 3000);
  } finally {
    await page.mouse.up();
  }
  // Both original 50°/130° shots have a 50° downward elevation. Observe
  // accepted snapshots rather than writing the hidden desktop range input.
  const elevation = () => {
    const angle = worm()?.aim;
    return Math.atan2(Math.sin(angle), Math.abs(Math.cos(angle)));
  };
  const target = (50 * Math.PI) / 180,
    direction = Math.sign(target - elevation());
  if (Math.abs(target - elevation()) > 0.02) {
    await page.mouse.move(box.x + box.width / 2, box.y + (direction < 0 ? 3 : box.height - 3));
    await page.mouse.down();
    try {
      await wait(() => direction * (elevation() - target) >= 0, 7000);
    } finally {
      await page.mouse.up();
    }
  }
  assert.equal(worm().facing, side, 'Vertical aiming keeps the chosen side');
}
try {
  for (let i = 0; i < 6; i++) {
    const ctx = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
    });
    contexts.push(ctx);
    const p = await ctx.newPage();
    pages.push(p);
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('websocket', (ws) => {
      if (ws.url().includes('/socket'))
        ws.on('framereceived', ({ payload }) => {
          const m = JSON.parse(String(payload));
          if (m.type === 'state') states[i] = m.state;
          if (m.type === 'welcome') identities[i] = m.playerId;
        });
    });
    await p.goto(`http://127.0.0.1:${app.port}`);
    await wait(() => p.locator('#connection').isHidden());
    if (i) {
      await p.locator('#join-tab').click();
      await p.locator('#room-code').fill((await pages[0].locator('#copy-code').innerText()).split(' ')[0]);
    }
    await p.locator('#player-name').fill('Resistencia ' + (i + 1));
    await p.locator('[data-connect]').click();
    await p.locator('#ready').waitFor();
  }
  await pages[0].locator('#worms').selectOption('4');
  async function start() {
    for (const p of pages) await p.locator('#ready').click();
    await pages[0].locator('#start').click();
    await Promise.all(pages.map((p) => p.locator('#field').waitFor()));
  }
  await start();
  const startTime = Date.now();
  let lastTurn = '',
    lastSample = 0;
  while (Date.now() - startTime < duration) {
    const s = states[0];
    if (!s) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    if (s.phase === 'finished') {
      report.completedMatches++;
      await pages[0].locator('#rematch').click();
      await pages[0].locator('#ready').waitFor();
      await start();
      lastTurn = '';
      continue;
    }
    const key = `${s.turn.number}-${s.turn.playerId}`;
    const i = identities.indexOf(s.turn.playerId);
    if (i >= 0 && key !== lastTurn && s.turn.stage === 'action') {
      const p = pages[i];
      await p.bringToFront();
      await wait(() => p.locator('#fire').isEnabled());
      const a = s.worms.find((w) => w.id === s.turn.wormId);
      await aimWithJoystick(p, i, a.id, a.x < 800 ? 1 : -1);
      const r = await p.locator('#fire').boundingBox();
      await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      await p.mouse.down();
      await new Promise((r) => setTimeout(r, 650));
      await p.mouse.up();
      lastTurn = key;
      report.shots++;
    }
    if (Date.now() - lastSample > 15000) {
      const sample = await pages[0].evaluate(() => ({
        heapBytes: performance.memory?.usedJSHeapSize ?? null,
        canvasCount: document.querySelectorAll('canvas').length,
        pixiCount: document.querySelectorAll('.pixi-field').length,
      }));
      samples.push({
        wallSeconds: Math.round((Date.now() - startTime) / 1000),
        gameSeconds: s.elapsed,
        terrainRevision: s.terrainRevision,
        turn: s.turn.number,
        stage: s.turn.stage,
        rssBytes: process.memoryUsage().rss,
        ...sample,
      });
      lastSample = Date.now();
      if (samples.length % 4 === 0)
        console.log(
          `Soak ${samples.at(-1).wallSeconds}s, ${report.shots} shots, ${report.completedMatches} matches, terrain ${s.terrainRevision}`,
        );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  report.wallSeconds = (Date.now() - startTime) / 1000;
  report.errors = errors;
  assert.deepEqual(errors, []);
  assert.ok(samples.every((s) => s.canvasCount === 2 && s.pixiCount === 1));
  report.passed = true;
} finally {
  await mkdir(new URL('../docs/evidence/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('../docs/evidence/soak.json', import.meta.url),
    JSON.stringify(report, null, 2) + '\n',
  );
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close();
  await app.close();
  console.log(JSON.stringify({ ...report, samples: report.samples.length }));
}
