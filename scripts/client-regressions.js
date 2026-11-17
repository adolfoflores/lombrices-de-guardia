import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from '../server/index.js';
import { NetworkClient, waitFor } from './network-smoke.js';

const kind = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const browser = await (kind === 'webkit' ? webkit : chromium).launch(
  kind === 'webkit' ? { headless: true } : { headless: true, channel: 'chrome' },
);
const report = {
  browser: kind,
  version: browser.version(),
  platform: process.platform,
  physicalDevice: false,
  checks: [],
  errors: [],
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const resources = [];
async function fixture(options = {}) {
  const app = await createServer({ dev: true, ...options });
  const net = [];
  const contexts = [];
  resources.push(async () => {
    for (const context of contexts) await context.close();
    for (const client of net) client.close();
    await app.close();
  });
  const host = await NetworkClient.connect(app.port);
  net.push(host);
  await host.command('create', { name: 'Organiza' });
  const room = app.rooms.get(host.identity.code);
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  contexts.push(context);
  const page = await context.newPage();
  const received = [],
    sent = [];
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
  await page.goto(`http://127.0.0.1:${app.port}/?sala=${host.identity.code}`);
  await page.locator('#player-name').fill('Invitada');
  await page.waitForFunction(() => document.querySelector('#connection')?.hidden);
  await page.getByRole('button', { name: 'Entrar a la sala →' }).click();
  await page.locator('#ready').waitFor();
  const identity = received.find((message) => message.type === 'welcome');
  return {
    app,
    host,
    room,
    page,
    net,
    identity,
    received,
    sent,
    latest: () => received.filter((message) => message.type === 'state').at(-1)?.state,
  };
}
async function start(f) {
  await f.host.command('ready', { ready: true });
  await f.page.locator('#ready').click();
  await waitFor(() => f.room.players.every((player) => player.ready));
  await f.host.command('start');
  await f.host.command('loaded');
  await f.page.locator('#field').waitFor();
  await waitFor(() => f.latest());
  await f.host.command('action', { action: { type: 'end' } });
  await waitFor(() => f.room.game.turn.playerId === f.identity.playerId);
  await f.page.locator('#fire').waitFor();
  await f.page.waitForFunction(() => !document.querySelector('#fire').disabled);
}
try {
  {
    const f = await fixture({ disconnectMs: 80 });
    const player = f.room.players.find((player) => player.id === f.identity.playerId);
    player.ws.terminate();
    await waitFor(() => !f.room.players.some((player) => player.id === f.identity.playerId));
    await f.page.locator('#entry-form').waitFor({ timeout: 8000 });
    assert.equal(await f.page.evaluate(() => JSON.parse(localStorage.getItem('ldg-session'))), null);
    assert.ok(
      f.received.some((message) => message.type === 'ack' && !message.ok && message.error.includes('sesión')),
    );
    report.checks.push(
      'Expired reserved slot: rejected resume clears stale room and returns to usable entry screen',
    );
  }
  {
    const f = await fixture();
    const secondHost = await NetworkClient.connect(f.app.port);
    f.net.push(secondHost);
    await secondHost.command('create', { name: 'Otra sala' });
    await f.page.locator('#leave').click();
    await f.page.locator('#entry-form').waitFor();
    await f.page.locator('#room-code').fill(secondHost.identity.code);
    await f.page.locator('#player-name').fill('Invitada B');
    await f.page.getByRole('button', { name: 'Entrar a la sala →' }).click();
    await f.page.locator('#ready').waitFor();
    const second = f.received.filter((message) => message.type === 'welcome').at(-1);
    assert.equal(second.code, secondHost.identity.code);
    f.app.rooms
      .get(second.code)
      .players.find((player) => player.id === second.playerId)
      .ws.terminate();
    await waitFor(
      () =>
        f.received.filter((message) => message.type === 'welcome' && message.playerId === second.playerId)
          .length === 2,
      8000,
    );
    assert.equal(f.app.rooms.get(second.code).players.length, 2);
    assert.ok(f.sent.some((message) => message.type === 'resume' && message.code === second.code));
    report.checks.push('Invite A → leave → join B → disconnect resumes selected B with same identity');
  }
  {
    const f = await fixture();
    await start(f);
    const fireCount = () =>
      f.sent.filter((message) => message.type === 'action' && message.action.type === 'fire').length;
    const before = fireCount();
    let fire = await f.page.locator('#fire').boundingBox();
    await f.page.mouse.move(fire.x + fire.width / 2, fire.y + fire.height / 2);
    await f.page.mouse.down();
    await pause(200);
    await f.page.setViewportSize({ width: 390, height: 844 });
    await f.page.mouse.up();
    await pause(150);
    assert.equal(fireCount(), before);
    assert.ok(await f.page.locator('.rotate-overlay').isVisible());
    await f.page.setViewportSize({ width: 844, height: 390 });
    fire = await f.page.locator('#fire').boundingBox();
    await f.page.mouse.move(fire.x + fire.width / 2, fire.y + fire.height / 2);
    await f.page.mouse.down();
    await pause(150);
    await f.page.locator('#fire').dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
    await f.page.mouse.up();
    await pause(100);
    assert.equal(fireCount(), before);
    report.checks.push(
      'Charged shot is cancelled by landscape→portrait resize and pointercancel; neither sends fire',
    );
    await f.page.locator('#hud-menu').click();
    await f.page.locator('#menu-end').click();
    await waitFor(() => f.room.game.turn.stage === 'settling');
    f.room.game._settledFor = -1.5;
    await waitFor(() => f.latest()?.turn.stage === 'settling');
    const sentBefore = f.sent.length;
    const receivedBefore = f.received.length;
    await pause(550);
    assert.equal(
      f.sent
        .slice(sentBefore)
        .filter((message) => message.type === 'action' && message.action.type === 'input').length,
      0,
    );
    assert.equal(
      f.received.slice(receivedBefore).filter((message) => message.type === 'ack' && !message.ok).length,
      0,
    );
    report.checks.push('Settling snapshot stops periodic movement input and rejected-action toast spam');
    f.room.game.forfeit(f.host.identity.playerId);
    await f.page.locator('#result-dialog').waitFor({ timeout: 8000 });
    await f.page.locator('#ask-rematch').click();
    await waitFor(() => f.host.room.rematchRequests.includes(f.identity.playerId));
    assert.equal(f.room.phase, 'finished');
    // The server-side request precedes the page's room broadcast by a few milliseconds.
    await f.page.waitForFunction(() => document.querySelector('#ask-rematch')?.disabled, null, {
      timeout: 3000,
    });
    assert.ok(await f.page.locator('#ask-rematch').isDisabled());
    f.host.close();
    await f.page.locator('#rematch').waitFor({ timeout: 5000 });
    assert.equal(f.room.hostId, f.identity.playerId);
    await f.page.locator('#rematch').click();
    await f.page.locator('#ready').waitFor();
    assert.equal(f.room.phase, 'lobby');
    assert.equal(f.room.players.length, 2);
    assert.equal(f.room.rematchRequests.size, 0);
    report.checks.push(
      'Guest requests rematch; result dialog updates after host disconnect; new host prepares retained group',
    );
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const close of resources.reverse()) await close();
  await browser.close();
  const evidence = new URL('../docs/evidence/', import.meta.url);
  await mkdir(evidence, { recursive: true });
  await writeFile(
    new URL(`client-regressions-${kind}.json`, evidence),
    JSON.stringify(report, null, 2) + '\n',
  );
}
