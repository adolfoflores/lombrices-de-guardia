// End-of-match summary and final-blow replay in the real UI (Chrome, 844×390, touch).
// The page is the host; a WebSocket bot is the rival. Fixtures only arrange a flat floor,
// positions and health: the fatal shot is an ordinary bazooka action and every number
// shown comes from the authoritative snapshot.
import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { createServer } from '../server/index.js';
import { NetworkClient } from './network-smoke.js';
import { WEAPONS } from '../shared/config.js';

const kind = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const folder = new URL('../docs/evidence/', import.meta.url);
const report = {
  browser: kind,
  physicalDevice: false,
  startedAt: new Date().toISOString(),
  checks: [],
  errors: [],
  notes: [
    'Real page UI (host) against an ephemeral server and one WebSocket rival; the fatal bazooka is a normal action.',
    'Fixtures arrange a flat floor, two live worms, a 20 PV victim and no wind. No physics, statistics or presentation code is replaced.',
    'Renderer.setState is wrapped only to keep an observation reference.',
  ],
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, message, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(message);
    await pause(25);
  }
}
const hexToRgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const inside = (box, width, height) =>
  box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1;
let app, browser, context, page, guest, room, game;
const received = [];
const latest = () => received.filter((m) => m.type === 'state').at(-1)?.state;
const capture = (name) =>
  page.screenshot({ path: fileURLToPath(new URL(`result-replay-${kind}-${name}.png`, folder)) });

async function arrangeFinalBlow(pageId, botId) {
  game = room.game;
  game.terrain.data.fill(0);
  game.terrain.rect(0, 650, 1600, 250);
  game.terrain.revision++;
  const shooter = game.worms.find((w) => w.playerId === botId),
    victim = game.worms.find((w) => w.playerId === pageId);
  for (const worm of game.worms) {
    Object.assign(worm, { y: 639, vx: 0, vy: 0, grounded: true, rope: null, jetpack: false });
    if (worm !== shooter && worm !== victim) {
      worm.hp = 0;
      worm._dead = true;
    }
  }
  Object.assign(shooter, { x: 800, hp: 100 });
  Object.assign(victim, { x: 840, hp: 20 });
  game.wind = 0;
  game.turn.remaining = 480;
  game._input = {};
  await until(() => latest()?.terrainRevision === game.terrain.revision, 'Fixture terrain reaches the page');
  assert.equal(game.turn.playerId, pageId, 'the host acts first');
  // The host passes through the real menu; the rival then fires an ordinary bazooka at close range.
  await page.locator('#hud-menu').tap();
  await page.locator('#menu-end').waitFor();
  await page.locator('#menu-end').tap();
  await until(() => game.turn.playerId === botId && game.turn.stage === 'action', 'Rival receives the turn');
  await pause(150);
  const fired = await guest.command('action', {
    action: { type: 'fire', weapon: 'bazooka', angle: 0.4, power: 0.1 },
  });
  assert.equal(fired.ok, true, 'rival fires');
  await until(() => room.phase === 'finished', 'Match finishes after the blow', 10000);
  return { shooter, victim };
}

try {
  await mkdir(folder, { recursive: true });
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
    if (ws.url().endsWith('/socket'))
      ws.on('framereceived', ({ payload }) => {
        try {
          received.push(JSON.parse(String(payload)));
        } catch {}
      });
  });
  // Install on the loaded game document. WebKit can run an init script before the
  // page has a base URL for module imports. Reloading creates a new module instance.
  const observeRenderer = () =>
    page.evaluate(async () => {
      const { Renderer } = await import('/client/renderer.js');
      const original = Renderer.prototype.setState;
      Renderer.prototype.setState = function (...args) {
        window.__renderer = this;
        return original.apply(this, args);
      };
    });
  await page.goto(`http://127.0.0.1:${app.port}/`);
  await page.waitForFunction(() => document.querySelector('#connection')?.hidden);
  await observeRenderer();
  await page.locator('#player-name').fill('Exploradores');
  await page.getByRole('button', { name: 'Crear sala privada →' }).click();
  await page.locator('#ready').waitFor();
  const identity = received.find((m) => m.type === 'welcome');
  room = app.rooms.get(identity.code);
  guest = await NetworkClient.connect(app.port);
  await guest.command('join', { code: identity.code, name: 'Vigías' });
  await guest.command('ready', { ready: true });
  const botId = guest.identity.playerId,
    pageId = identity.playerId;
  const startMatch = async (botHosts = false) => {
    await page.locator('#ready').click();
    if (botHosts) {
      await until(() => room.players.every((p) => p.ready), 'Both ready');
      assert.equal((await guest.command('start')).ok, true);
    } else await page.locator('#start').click();
    await until(() => guest.room?.phase === 'loading', 'Guest loading');
    await guest.command('loaded');
    await page.waitForFunction(
      () =>
        window.__renderer?.pixi?.active &&
        document.querySelector('#fire') &&
        !document.querySelector('#fire').disabled,
    );
  };
  await startMatch();

  report.currentCase = 'replay-then-summary';
  const finishedAt = Date.now();
  await arrangeFinalBlow(pageId, botId);
  await page.locator('#finale[data-phase="verdict"]').waitFor({ timeout: 4000 });
  const verdict = await page.evaluate(() => ({
    tone: document.querySelector('#finale')?.dataset.tone,
    title: document.querySelector('.finale-title')?.textContent,
    dialog: !!document.querySelector('#result-dialog'),
    skip: document.querySelectorAll('#replay-skip').length,
  }));
  assert.equal(verdict.tone, 'loss');
  assert.equal(verdict.title, 'HAS PERDIDO EN GRANDE');
  assert.equal(verdict.dialog, false, 'the verdict precedes the summary');
  assert.equal(verdict.skip, 0, 'playback has not started during the verdict');
  await capture('verdict');
  await page.locator('#finale[data-phase="intro"]').waitFor({ timeout: 4000 });
  assert.equal(await page.locator('#finale .finale-replay strong').textContent(), 'REPETICIÓN');
  await capture('intro');
  await page.locator('#replay-skip').waitFor({ timeout: 4000 });
  const replayStart = Date.now();
  const during = await page.evaluate(() => ({
    replaying: !!window.__renderer.replaying,
    frames: window.__renderer.replaying?.frames.length,
    spanMs: window.__renderer.replaying
      ? window.__renderer.replaying.frames.at(-1).at - window.__renderer.replaying.frames[0].at
      : null,
    dialog: !!document.querySelector('#result-dialog'),
    viewPlayer: window.__renderer.view.playerId,
    skipLabel: document.querySelector('#replay-skip')?.getAttribute('aria-label'),
    skipBox: document.querySelector('#replay-skip').getBoundingClientRect().toJSON(),
  }));
  assert.equal(during.replaying, true);
  assert.equal(during.dialog, false, 'the summary waits for the replay');
  assert.ok(during.frames >= 10, `the buffer holds live snapshots (${during.frames})`);
  assert.ok(
    during.spanMs > 1500 && during.spanMs <= 4100,
    `the window spans up to four seconds (${during.spanMs} ms)`,
  );
  assert.equal(during.viewPlayer, null, 'the viewer watches as a spectator');
  assert.equal(during.skipLabel, 'Saltar la repetición');
  assert.ok(
    during.skipBox.width >= 43.9 && during.skipBox.height >= 43.9 && inside(during.skipBox, 844, 390),
    'skip button is a reachable touch target',
  );
  await pause(Math.max(0, 2500 - (Date.now() - replayStart)));
  await capture('replay');
  const badge = await page.evaluate(() => ({
    phase: document.querySelector('#finale')?.dataset.phase,
    label: document.querySelector('#finale .finale-replay strong')?.textContent,
    speed: document.querySelector('#finale .finale-replay small')?.textContent,
    rate: window.__renderer.replaying?.rate,
    bars: getComputedStyle(document.querySelector('#finale'), '::before').height,
  }));
  assert.equal(badge.phase, 'playing');
  assert.equal(badge.label, 'REPETICIÓN');
  assert.equal(badge.rate, 0.75, 'playback runs at three-quarter speed');
  report.badge = badge;
  await page.locator('#result-dialog').waitFor({ timeout: 11000 });
  const after = await page.evaluate(() => ({
    replaying: window.__renderer.replaying,
    skip: document.querySelectorAll('#replay-skip').length,
    viewPlayer: window.__renderer.view.playerId,
    phase: window.__renderer.state.phase,
    eventIds: window.__renderer.eventIds.size,
  }));
  assert.equal(after.replaying, null);
  assert.equal(after.skip, 0, 'skip button leaves with the replay');
  assert.equal(after.viewPlayer, pageId, 'local identity restored');
  assert.equal(after.phase, 'finished');
  report.replay = { ...during, elapsedMs: Date.now() - replayStart, totalMs: Date.now() - finishedAt };
  assert.ok(report.replay.elapsedMs >= 3300, 'playback ran at three-quarter speed');
  assert.equal(await page.locator('#finale').count(), 0, 'the finale overlay leaves with the summary');
  report.checks.push(
    'A live finish shows the verdict, then the REPETICIÓN title, then replays the buffered final blow at 0.75× between letterbox bars with the badge, a 44px Saltar button and spectator framing before the summary opens',
  );

  report.currentCase = 'summary-content';
  const stats = latest().result.stats,
    result = latest().result;
  assert.equal(result.mvpId, botId, 'the rival is the player of the match');
  const summary = await page.evaluate(() => {
    const dialog = document.querySelector('#result-dialog');
    const rows = [...dialog.querySelectorAll('.result-table tbody tr')].map((tr) => ({
      player: tr.dataset.player,
      classes: tr.className,
      name: tr.querySelector('th').textContent.trim(),
      chip: getComputedStyle(tr.querySelector('.result-chip')).backgroundColor,
      cells: [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()),
    }));
    return {
      title: dialog.querySelector('#dialog-title').textContent,
      mvp: dialog.querySelector('.result-mvp strong')?.textContent,
      mvpNote: dialog.querySelector('.result-mvp small')?.textContent,
      swatch: getComputedStyle(dialog.querySelector('.result-swatch')).backgroundColor,
      heads: [...dialog.querySelectorAll('.result-table thead th')].map((th) => th.textContent),
      rows,
      note: dialog.querySelector('.context-note').textContent,
      buttons: [...dialog.querySelectorAll('button')].map((b) => b.id || b.textContent.trim()),
    };
  });
  const botPlayer = latest().players.find((p) => p.id === botId),
    pagePlayer = latest().players.find((p) => p.id === pageId);
  assert.equal(summary.mvp, 'Vigías');
  assert.equal(summary.swatch, hexToRgb(botPlayer.color), 'standout player shows the worm colour');
  const botStats = stats.find((s) => s.playerId === botId),
    pageStats = stats.find((s) => s.playerId === pageId);
  assert.equal(summary.mvpNote, `${botStats.damageDealt} PV infligidos · ${botStats.kills} baja`);
  assert.deepEqual(summary.heads, [
    'Jugador',
    'Daño hecho',
    'Bajas',
    'Disparos',
    'Mejor tiro',
    'Tiro más largo',
  ]);
  assert.equal(summary.rows.length, 2);
  const botRow = summary.rows.find((r) => r.player === botId),
    pageRow = summary.rows.find((r) => r.player === pageId);
  assert.equal(botRow.name, 'Vigías');
  assert.ok(pageRow.name.startsWith('Exploradores'));
  assert.ok(pageRow.classes.includes('is-self'));
  assert.ok(botRow.classes.includes('is-winner'));
  assert.equal(botRow.chip, hexToRgb(botPlayer.color));
  assert.equal(pageRow.chip, hexToRgb(pagePlayer.color));
  assert.ok(
    botStats.damageDealt === 20 &&
      botStats.kills === 1 &&
      botStats.shots === 1 &&
      botStats.bestShot.weapon === 'bazooka' &&
      botStats.longestShot > 0,
    JSON.stringify(botStats),
  );
  assert.deepEqual(botRow.cells, [
    String(botStats.damageDealt),
    String(botStats.kills),
    String(botStats.shots),
    `${botStats.bestShot.damage} ${WEAPONS.find((w) => w.id === 'bazooka').name}`,
    `${Math.round(botStats.longestShot / 10)} m`,
  ]);
  assert.deepEqual(pageRow.cells, ['0', '0', '0', '—', '—']);
  assert.equal(pageStats.damageTaken, 20);
  assert.match(summary.note, /turnos?/);
  assert.deepEqual(summary.buttons.slice(1), ['rematch', 'back-lobby', 'leave-result']);
  report.summary = { ...summary, stats };
  report.checks.push(
    'Summary names the player of the match with their colour and lists damage, eliminations, shots, best shot (weapon) and longest shot in metres from the authoritative statistics',
  );

  report.currentCase = 'summary-layout';
  const layout = await page.evaluate(async () => {
    const dialog = document.querySelector('#result-dialog');
    // The field menu opens with a 150 ms scale animation; measure the settled layout, not a frame of it.
    await Promise.all(
      dialog.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})),
    );
    const rect = dialog.getBoundingClientRect().toJSON();
    const table = dialog.querySelector('.result-table');
    const scrollable = dialog.scrollHeight > dialog.clientHeight;
    const buttons = [];
    for (const button of dialog.querySelectorAll('.dialog-body button')) {
      button.scrollIntoView({ block: 'nearest' });
      await new Promise((r) => requestAnimationFrame(r));
      const b = button.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      buttons.push({ id: button.id, ...b.toJSON(), hit: hit === button || button.contains(hit) });
    }
    return {
      dialog: rect,
      scrollable,
      tableOverflow: table.scrollWidth - table.clientWidth,
      docOverflow: document.documentElement.scrollWidth - innerWidth,
      buttons,
    };
  });
  assert.ok(inside(layout.dialog, 844, 390), 'dialog fits the 844×390 viewport');
  assert.ok(layout.tableOverflow <= 0, 'table fits the dialog width');
  assert.ok(layout.docOverflow <= 0);
  for (const b of layout.buttons) {
    assert.ok(inside(b, 844, 390), `${b.id} reachable by scrolling`);
    assert.ok(b.height >= 43.9, `${b.id} touch height`);
    assert.equal(b.hit, true, `${b.id} unobstructed`);
  }
  report.layout = layout;
  await capture('summary');
  report.checks.push(
    `Summary dialog fits 844×390${layout.scrollable ? ' and scrolls' : ''}; rematch, lobby and leave buttons stay reachable and unobstructed`,
  );

  report.currentCase = 'reconnect-skips-replay';
  const before = received.length;
  await page.reload();
  await observeRenderer();
  const reloadAt = Date.now();
  await page.locator('#result-dialog').waitFor({ timeout: 6000 });
  assert.equal(
    await page.locator('#replay-skip').count(),
    0,
    'no replay after reconnecting into a finished match',
  );
  await until(() => received.length > before, 'Reconnect snapshot');
  assert.equal(await page.evaluate(() => window.__renderer?.replaying ?? null), null);
  // The disconnect handed the room to the rival, so the reopened summary is the guest variant.
  await page.locator('#ask-rematch').waitFor();
  report.reconnect = {
    dialogAfterMs: Date.now() - reloadAt,
    rows: await page.locator('.result-table tbody tr').count(),
    hostId: room.hostId === botId ? 'rival' : 'page',
  };
  assert.ok(report.reconnect.dialogAfterMs < 4500, 'the summary opens after the verdict alone');
  assert.equal(report.reconnect.rows, 2);
  assert.equal(await page.locator('.result-mvp strong').textContent(), 'Vigías');
  await capture('reconnect');
  report.checks.push('Reconnecting into a finished match opens the summary at once, without a replay');

  report.currentCase = 'skip-and-reduced-motion';
  assert.equal((await guest.command('rematch')).ok, true);
  await page.locator('#ready').waitFor();
  received.length = 0;
  guest.state = null;
  await guest.command('ready', { ready: true });
  await startMatch(true);
  await page.locator('#hud-menu').tap();
  await page.locator('.game-menu [data-settings]').tap();
  await page.locator('#motion').check();
  await page.locator('dialog[open] .dialog-head button').tap();
  await until(async () => !(await page.locator('dialog').count()), 'Settings closed');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ldg-prefs')).reducedMotion), true);
  await arrangeFinalBlow(pageId, botId);
  await page.locator('#replay-skip').waitFor({ timeout: 6000 });
  const reduced = await page.evaluate(() => ({
    spanMs: window.__renderer.replaying.frames.at(-1).at - window.__renderer.replaying.frames[0].at,
    frames: window.__renderer.replaying.frames.length,
  }));
  assert.ok(
    reduced.spanMs <= 2100 && reduced.spanMs > 800,
    `reduced motion keeps two seconds (${reduced.spanMs} ms)`,
  );
  const skipAt = Date.now();
  await page.locator('#replay-skip').tap();
  await page.locator('#result-dialog').waitFor({ timeout: 2000 });
  report.skip = { ...reduced, dialogAfterMs: Date.now() - skipAt };
  assert.ok(report.skip.dialogAfterMs < 1200, 'Saltar opens the summary at once');
  assert.equal(await page.locator('#replay-skip').count(), 0);
  assert.equal(await page.evaluate(() => window.__renderer.replaying), null);
  assert.equal(await page.locator('.result-mvp strong').textContent(), 'Vigías');
  report.checks.push(
    'With reduced motion the replay window is two seconds; Saltar ends it and opens the summary immediately',
  );

  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  if (page) await capture('failure').catch(() => {});
  throw error;
} finally {
  if (report.passed) await unlink(new URL(`result-replay-${kind}-failure.png`, folder)).catch(() => {});
  await writeFile(new URL(`result-replay-${kind}.json`, folder), JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        browser: kind,
        checks: report.checks,
        replay: report.replay,
        skip: report.skip,
        failure: report.failure?.message,
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
