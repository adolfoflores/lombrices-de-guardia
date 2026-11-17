// Focused real-UI regression for worm identity: seeded nicknames, team pennants on the
// plates and shared speech bubbles. Chrome by default; TEST_BROWSER=webkit for WebKit.
// Fixtures arrange a flat floor and positions; every reaction comes from authoritative events.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { createServer } from '../server/index.js';
import { NetworkClient } from './network-smoke.js';
import { WORM_NAMES } from '../shared/names.js';
const kind = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const folder = new URL('../docs/evidence/', import.meta.url);
const PHRASES = {
  turn: ['Me toca', 'Atentos'],
  hurt: ['¡Ay!', '¡Eso dolió!', '¡Mi banda!'],
  hit: ['¡Toma!', '¡Pum!'],
  miss: ['Ups…', 'Casi'],
  kill: ['¡Hasta luego!'],
  drown: ['¡Glub!'],
};
const report = {
  browser: kind,
  physicalDevice: false,
  startedAt: new Date().toISOString(),
  checks: [],
  bubbles: [],
  plates: [],
  errors: [],
  notes: [
    'Actual game UI on a private ephemeral server; a WebSocket guest plays the other side and only authoritative events drive the bubbles.',
    'Fixtures provide a flat floor, positions, health values and a long turn. No rule, physics or presentation code is replaced.',
    'Renderer.setState is wrapped only to retain an observation reference. Bubble texts are compared with the phrase each event id selects.',
    'Screenshots are taken while the bubbles are alive, so their pop and fade differ between runs; the texts and plate contents are asserted.',
    'Dimensions emulate a phone landscape. These are not physical-device results.',
  ],
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, message, timeout = 6000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(message);
    await pause(20);
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
let app, browser, context, page, guest, game, owner, guestPlayer, ownerPlayer;
const latest = () => page.evaluate(() => window.__identityRenderer?.state || null);
const bubbles = () =>
  page.evaluate(() =>
    Array.from(window.__identityRenderer.pixi.bubbles, ([id, b]) => ({
      id,
      kind: b.kind,
      text: b.node.children[1].text,
      reduced: b.reduced,
      visible: b.node.visible,
      alpha: +b.node.alpha.toFixed(3),
      scale: +b.node.scale.x.toFixed(3),
      x: Math.round(b.node.x),
      y: Math.round(b.node.y),
      width: b.width,
      height: b.height,
    })),
  );
const plates = () =>
  page.evaluate(() =>
    Array.from(window.__identityRenderer.pixi.labels, ([id, l]) => ({
      id,
      visible: l.visible,
      name: l.name.text,
      owner: l.owner.text,
      health: l.text.text,
      width: l.boxW,
      height: l.boxH,
      healthTextWidth: +l.text.width.toFixed(1),
      flag: { width: +l.flag.width.toFixed(1), height: +l.flag.height.toFixed(1), x: +l.flag.x.toFixed(1) },
      x: Math.round(l.x),
      y: Math.round(l.y),
    })),
  );
async function capture(name) {
  await page.screenshot({ path: fileURLToPath(new URL(`identity-${kind}-${name}.png`, folder)) });
}
async function closeDialog() {
  await page.locator('dialog[open] .dialog-head button').click();
  await until(async () => !(await page.locator('dialog').count()), 'Dialog closes');
}
const phrase = (kindName, event) => PHRASES[kindName][event.id % PHRASES[kindName].length];
const place = (worm, x, extra = {}) =>
  Object.assign(worm, { x, y: 639, vx: 0, vy: 0, grounded: true, rope: null, jetpack: false, ...extra });
async function nextTurn(label) {
  const number = game.turn.number;
  game.turn.remaining = Math.min(game.turn.remaining, 0.05);
  if (game.turn.stage === 'action') game.action(game.turn.playerId, { type: 'end' });
  await until(() => game.turn.number > number, label + ': server turn advances');
  game.turn.remaining = 480;
  await until(
    async () => (await latest())?.turn?.number === game.turn.number,
    label + ': client receives the turn',
  );
}
// Retreats end on their own, so a scenario may already be one turn further along: advance until the wanted player acts.
async function turnOf(playerId, label) {
  for (let i = 0; i < 4 && game.turn.playerId !== playerId; i++) await nextTurn(label);
  assert.equal(game.turn.playerId, playerId, label);
  game.turn.remaining = 480;
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
    deviceScaleFactor: 2,
  });
  page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${app.port}/`);
  await page.waitForFunction(() => document.querySelector('#connection')?.hidden);
  await page.evaluate(async () => {
    const { Renderer } = await import('/client/renderer.js');
    const original = Renderer.prototype.setState;
    Renderer.prototype.setState = function (...args) {
      window.__identityRenderer = this;
      return original.apply(this, args);
    };
  });
  await page.locator('#player-name').fill('Exploradores');
  await page.getByRole('button', { name: 'Crear sala privada →' }).click();
  await page.locator('#ready').waitFor();
  const code = new URL(page.url()).searchParams.get('sala');
  guest = await NetworkClient.connect(app.port);
  await guest.command('join', { code, name: 'Vigías' });
  await guest.command('ready', { ready: true });
  await page.locator('#ready').click();
  await page.locator('#start').click();
  await until(() => guest.room?.phase === 'loading', 'Guest loading');
  await guest.command('loaded');
  await page.waitForFunction(
    () => window.__identityRenderer?.pixi?.active && !document.querySelector('#fire').disabled,
  );
  game = app.rooms.get(code).game;
  owner = game._active();
  ownerPlayer = game.players.find((p) => p.id === owner.playerId);
  guestPlayer = game.players.find((p) => p.id !== owner.playerId);
  const mine = game.worms.filter((w) => w.playerId === ownerPlayer.id),
    theirs = game.worms.filter((w) => w.playerId === guestPlayer.id);
  game.terrain.data.fill(0);
  game.terrain.rect(0, 650, 1600, 250);
  game.terrain.revision++;
  place(owner, 800);
  place(mine[1], 1000);
  place(theirs[0], 680);
  place(theirs[1], 560);
  game.turn.remaining = 480;
  game._input = {};
  await until(
    async () => (await latest())?.terrainRevision === game.terrain.revision,
    'Safe fixture arrives',
  );
  await page.bringToFront();
  await pause(200);

  report.currentCase = 'names';
  const names = game.worms.map((w) => w.name);
  assert.equal(new Set(names).size, names.length, 'Nicknames are unique in the match');
  assert.ok(
    names.every((name) => WORM_NAMES.includes(name)),
    'Nicknames come from the shared pool',
  );
  for (const worm of game.worms)
    assert.equal(
      worm.playerName,
      game.players.find((p) => p.id === worm.playerId).name,
      'Worm keeps its player name',
    );
  const published = (await latest()).worms;
  assert.deepEqual(
    published.map((w) => [w.name, w.playerName]),
    game.worms.map((w) => [w.name, w.playerName]),
    'Snapshots publish nickname and player name',
  );
  await page.locator('#hud-menu').tap();
  await page.locator('.game-menu[open]').waitFor();
  await page.locator('.game-menu #score').tap();
  await page.locator('.score-list').waitFor();
  const status = await page.locator('.score-list').innerText();
  for (const worm of game.worms) assert.ok(status.includes(worm.name), `Group status lists ${worm.name}`);
  assert.ok(
    status.includes('Exploradores') && status.includes('Vigías'),
    'Group status heads each roster with the player',
  );
  await capture('group-status');
  await closeDialog();
  report.names = game.worms.map((w) => ({ id: w.id, name: w.name, playerName: w.playerName }));
  report.checks.push(
    'Twenty-four-name pool: unique seeded nicknames, player name kept on the worm, published in snapshots and listed in the group status',
  );

  report.currentCase = 'own-turn';
  await pause(150);
  let seen = await plates();
  report.plates.push({ moment: 'own-turn', plates: seen });
  assert.equal(
    seen.some((p) => p.id === owner.id && p.visible),
    false,
    'Own active worm shows no plate on the local turn',
  );
  const others = seen.filter((p) => p.visible);
  assert.equal(others.length, 3, 'Three other plates are visible');
  for (const p of others) {
    assert.equal(p.name, '');
    assert.equal(p.height, 20, 'Plain plate height is unchanged');
    assert.ok(
      p.width <= Math.ceil(p.healthTextWidth) + 26,
      'Plate width grows by at most ten pixels for the pennant',
    );
    assert.ok(p.flag.width >= 8.5 && p.flag.height >= 8.5, 'Pennant drawn with its pole');
    assert.match(p.health, /^[▲◆●] \d+$/);
  }
  assert.equal((await bubbles()).length, 0, 'No bubble is shown for the local shooter at start');
  await capture('own-turn');
  report.checks.push(
    'Local turn: own plate hidden, other plates keep their size budget and carry a pennant before the mark, no bubble over the aiming worm',
  );

  report.currentCase = 'turn-bubble';
  await nextTurn('Pass to guest');
  const active = game._active();
  assert.equal(active.playerId, guestPlayer.id);
  let turnEvent = game.events.findLast((e) => e.type === 'turn');
  await until(
    async () => (await bubbles()).some((b) => b.id === active.id && b.kind === 'turn'),
    'Turn bubble appears',
    1500,
  );
  seen = await bubbles();
  const turnBubble = seen.find((b) => b.id === active.id);
  assert.equal(turnBubble.text, phrase('turn', turnEvent), 'Turn remark follows the event id');
  report.bubbles.push({ moment: 'turn', eventId: turnEvent.id, bubbles: seen });
  await pause(120);
  const activePlate = (await plates()).find((p) => p.id === active.id);
  assert.ok(activePlate?.visible, 'Active plate visible to the spectator');
  assert.equal(activePlate.name, active.name.slice(0, 14));
  assert.equal(activePlate.owner, 'Vigías', 'Second line names the player');
  assert.equal(activePlate.height, 46, 'Three-row active plate');
  report.plates.push({ moment: 'turn', plates: await plates() });
  await capture('turn-bubble');
  assert.equal(seen.filter((b) => b.id === active.id).length, 1, 'One bubble per worm');
  report.checks.push(
    'Turn start: the active worm says the line the event id selects, its plate shows nickname, player and health rows',
  );

  report.currentCase = 'hit-bubbles';
  const victim = mine[0] === owner ? mine[0] : mine[0];
  place(active, 800);
  place(victim, 900);
  place(mine[1], 1180);
  place(
    theirs.find((w) => w !== active),
    420,
  );
  await pause(140);
  assert.equal(
    game.action(guestPlayer.id, { type: 'fire', weapon: 'bazooka', angle: -0.25, power: 0.45 }).ok,
    true,
    'Guest fires the bazooka',
  );
  await until(
    () => game.events.some((e) => e.type === 'damage' && e.wormId === victim.id),
    'Bazooka hurts the victim',
    3000,
  );
  const damage = game.events.findLast((e) => e.type === 'damage' && e.wormId === victim.id);
  await until(
    async () => (await bubbles()).some((b) => b.id === victim.id && b.kind === 'hurt'),
    'Victim bubble appears',
    1500,
  );
  seen = await bubbles();
  assert.equal(
    seen.find((b) => b.id === victim.id).text,
    phrase('hurt', damage),
    'Victim remark follows the damage event id',
  );
  assert.equal(seen.find((b) => b.id === active.id)?.kind, 'hit', 'Shooter celebrates the hit');
  assert.equal(seen.find((b) => b.id === active.id).text, phrase('hit', damage));
  report.bubbles.push({ moment: 'hit', eventId: damage.id, bubbles: seen });
  await capture('hit-bubbles');
  const blast = game.events.findLast((e) => e.type === 'explosion');
  assert.equal(
    game.events.some((e) => e.id === blast.id + 1 && e.type === 'damage'),
    true,
    'The blast is followed by its damage event',
  );
  await pause(1500);
  assert.equal(
    (await bubbles()).some((b) => b.id === active.id && b.kind === 'miss'),
    false,
    'A blast that hurt someone never reads as a miss',
  );
  report.checks.push(
    'Hit: the victim complains and the shooter celebrates with lines chosen by the same event id; no miss remark follows a damaging blast',
  );

  report.currentCase = 'kill-and-miss';
  await turnOf(ownerPlayer.id, 'Back to the local player');
  await pause(300);
  assert.equal(
    (await bubbles()).some((b) => b.id === game.turn.wormId),
    false,
    'Local turn start shows no bubble over the own worm',
  );
  await turnOf(guestPlayer.id, 'Second guest worm');
  const shooter = game._active();
  assert.equal(shooter.playerId, guestPlayer.id);
  const doomed = mine.find((w) => w.hp > 0 && w !== victim) || mine.find((w) => w.hp > 0);
  place(shooter, 600);
  place(doomed, 680, { hp: 15 });
  for (const w of game.worms)
    if (w !== shooter && w !== doomed && w.hp > 0) place(w, w.playerId === ownerPlayer.id ? 1300 : 260);
  await until(
    async () => (await latest()).worms.find((w) => w.id === doomed.id).hp === 15,
    'Low health arrives',
  );
  assert.equal(
    game.action(guestPlayer.id, { type: 'fire', weapon: 'shotgun', angle: 0, power: 0 }).ok,
    true,
    'First shotgun shot',
  );
  await until(
    () => game.events.some((e) => e.type === 'death' && e.wormId === doomed.id),
    'Shot eliminates the low-health worm',
    2000,
  );
  const death = game.events.findLast((e) => e.type === 'death' && e.wormId === doomed.id);
  await until(
    async () => (await bubbles()).some((b) => b.id === shooter.id && b.kind === 'kill'),
    'Kill bubble appears',
    1500,
  );
  seen = await bubbles();
  assert.equal(seen.find((b) => b.id === shooter.id).text, phrase('kill', death));
  assert.equal(
    seen.find((b) => b.id === doomed.id)?.kind,
    'hurt',
    'The fallen worm keeps its last complaint',
  );
  report.bubbles.push({ moment: 'kill', eventId: death.id, bubbles: seen });
  await capture('kill-bubble');
  await pause(520);
  assert.equal(
    game.action(guestPlayer.id, { type: 'fire', weapon: 'shotgun', angle: -Math.PI / 2, power: 0 }).ok,
    true,
    'Second shotgun shot into the sky',
  );
  await until(() => game.events.some((e) => e.type === 'shot' && e.hit === 'miss'), 'Shot misses', 2000);
  const missShot = game.events.findLast((e) => e.type === 'shot' && e.hit === 'miss');
  await until(
    async () => (await bubbles()).some((b) => b.id === shooter.id && b.kind === 'miss'),
    'Miss bubble replaces the kill remark',
    1500,
  );
  seen = await bubbles();
  assert.equal(seen.find((b) => b.id === shooter.id).text, phrase('miss', missShot));
  report.bubbles.push({ moment: 'shot-miss', eventId: missShot.id, bubbles: seen });
  await capture('miss-bubble');
  report.checks.push(
    'Kill: the shooter says goodbye once the enemy falls; a following shot into the sky replaces it with a miss remark',
  );

  report.currentCase = 'blast-miss-and-water';
  await turnOf(ownerPlayer.id, 'Local player again');
  await turnOf(guestPlayer.id, 'Guest fires at nothing');
  const gunner = game._active();
  assert.equal(gunner.playerId, guestPlayer.id);
  place(gunner, 500);
  for (const w of game.worms)
    if (w !== gunner && w.hp > 0) place(w, w.playerId === ownerPlayer.id ? 350 : 150);
  await pause(140);
  const before = game.events.filter((e) => e.type === 'explosion').length;
  assert.equal(
    game.action(guestPlayer.id, { type: 'fire', weapon: 'bazooka', angle: -0.3, power: 0.5 }).ok,
    true,
    'Bazooka at the empty floor',
  );
  await until(() => game.events.filter((e) => e.type === 'explosion').length > before, 'Blast lands', 3000);
  const emptyBlast = game.events.findLast((e) => e.type === 'explosion');
  assert.equal(
    game.events.some((e) => e.id === emptyBlast.id + 1 && e.type === 'damage'),
    false,
    'Nobody was in range',
  );
  await until(
    async () => (await bubbles()).some((b) => b.id === gunner.id && b.kind === 'miss'),
    'Blast miss bubble',
    1500,
  );
  seen = await bubbles();
  assert.equal(seen.find((b) => b.id === gunner.id).text, phrase('miss', emptyBlast));
  report.bubbles.push({ moment: 'blast-miss', eventId: emptyBlast.id, bubbles: seen });
  // The guest's idle worm goes under, so both players stay in the match for the remaining cases.
  const swimmer = game.worms.find((w) => w.hp > 0 && w.playerId === guestPlayer.id && w !== gunner);
  Object.assign(swimmer, { y: game.waterY - 6, vy: 60, grounded: false });
  await until(
    () => game.events.some((e) => e.type === 'splash' && e.wormId === swimmer.id),
    'Worm drowns',
    2000,
  );
  const splash = game.events.findLast((e) => e.type === 'splash' && e.wormId === swimmer.id);
  await until(
    async () => (await bubbles()).some((b) => b.id === swimmer.id && b.kind === 'drown'),
    'Drowning bubble',
    1500,
  );
  seen = await bubbles();
  assert.equal(seen.find((b) => b.id === swimmer.id).text, phrase('drown', splash));
  report.bubbles.push({ moment: 'drown', eventId: splash.id, bubbles: seen });
  await capture('water-bubble');
  report.checks.push(
    'A blast that hurts nobody reads as a miss for the shooter and a drowning worm gurgles once',
  );

  report.currentCase = 'reduced-motion-and-canvas';
  await page.locator('#hud-menu').tap();
  await page.locator('.game-menu[open]').waitFor();
  await page.locator('.game-menu [data-settings]').tap();
  await page.locator('#motion').waitFor();
  await page.locator('#motion').check();
  await closeDialog();
  await turnOf(ownerPlayer.id, 'Local player');
  await turnOf(guestPlayer.id, 'Guest with reduced motion');
  const calm = game._active();
  await until(
    async () => (await bubbles()).some((b) => b.id === calm.id && b.kind === 'turn'),
    'Turn bubble under reduced motion',
    1500,
  );
  seen = await bubbles();
  const calmBubble = seen.find((b) => b.id === calm.id);
  assert.equal(calmBubble.reduced, true, 'Bubble knows reduced motion');
  await pause(60);
  const settled = (await bubbles()).find((b) => b.id === calm.id);
  assert.equal(settled.scale, 1, 'No pop animation under reduced motion');
  report.bubbles.push({ moment: 'reduced-motion', bubbles: await bubbles() });
  const canvas = await page.evaluate(() => {
    const r = window.__identityRenderer;
    r.pixi.onLost();
    r.draw(performance.now());
    const data = r.ctx.getImageData(0, 0, r.width * r.dpr, r.height * r.dpr).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
    return {
      active: r.pixi.active,
      overlay: getComputedStyle(document.querySelector('.pixi-field')).visibility,
      opaque,
    };
  });
  assert.equal(canvas.active, false);
  assert.equal(canvas.overlay, 'hidden');
  assert.ok(canvas.opaque > 0, 'Canvas fallback draws frames with the pennant plates');
  await pause(120);
  await capture('canvas-fallback');
  await page.evaluate(() => {
    window.__identityRenderer.pixi.onRestored();
  });
  await pause(100);
  assert.equal(await page.evaluate(() => window.__identityRenderer.pixi.active), true, 'Pixi layer restored');
  report.checks.push(
    'Reduced motion shows bubbles at rest without the pop; the Canvas fallback keeps drawing plates after a lost GPU context',
  );
  assert.deepEqual(report.errors, []);
  report.finalSourceSHA256 = await hashes();
  assert.deepEqual(report.finalSourceSHA256, report.sourceSHA256, 'Sources unchanged during browser run');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  if (page) await capture('failure').catch(() => {});
  throw error;
} finally {
  if (report.passed) await unlink(new URL(`identity-${kind}-failure.png`, folder)).catch(() => {});
  delete report.currentCase;
  await writeFile(new URL(`identity-${kind}.json`, folder), JSON.stringify(report, null, 2) + '\n');
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
