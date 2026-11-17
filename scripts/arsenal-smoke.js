// Focused real UI regression for the illustrated arsenal. Run browsers sequentially:
// node scripts/arsenal-smoke.js; TEST_BROWSER=webkit node scripts/arsenal-smoke.js
// Server-side fixtures only arrange a safe turn, ammunition and tool state.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { createServer } from '../server/index.js';
import { WEAPONS } from '../shared/config.js';
import { NetworkClient } from './network-smoke.js';

const kind = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
// macOS WebKit's default Tab preference skips native buttons. Option+Tab includes them,
// as verified independently with ordinary native buttons in a minimal HTML document.
const navigationKey = kind === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
const folder = new URL('../docs/evidence/', import.meta.url);
const report = {
  browser: kind,
  physicalDevice: false,
  startedAt: new Date().toISOString(),
  checks: [],
  layouts: [],
  errors: [],
  notes: [
    'Real main.js UI, native dialog, trusted taps/keyboard and private ephemeral HTTP/WebSocket server.',
    'Fixtures arrange safe terrain and a long active turn; unavailable ammunition, cavern map and active jetpack are server state changes delivered by ordinary snapshots.',
    'Portrait cases open the inventory in landscape before resizing; the game itself correctly requires landscape.',
    navigationKey === 'Alt+Tab'
      ? 'Keyboard selection uses Option+Tab, macOS WebKit default full-control navigation; ordinary Tab skips native buttons in this environment.'
      : 'Keyboard selection uses ordinary Tab navigation.',
    'No weapon effects or physics are replaced. This is focused inventory verification, not a physical-device or general game soak test.',
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
  const paths = (await readdir(new URL('../client/', import.meta.url)))
    .filter((name) => /\.(js|css)$/.test(name))
    .map((name) => `client/${name}`);
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(new URL('../' + path, import.meta.url)))
          .digest('hex'),
      ]),
    ),
  );
}
const contained = (a, b, label) =>
  assert.ok(a.x >= b.x - 1 && a.y >= b.y - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1, label);
let app, browser, context, page, guest, game, owner, player;
const sent = [],
  received = [];
const latest = () => received.filter((m) => m.type === 'state').at(-1)?.state;
const fires = () => sent.filter((m) => m.type === 'action' && m.action.type === 'fire').length;
const dialog = () => page.locator('.arsenal-dialog[open]');
const card = (id) => page.locator(`[data-weapon="${id}"]`);
async function capture(name) {
  await page.screenshot({ path: fileURLToPath(new URL(`arsenal-${kind}-${name}.png`, folder)) });
}
async function open() {
  await page.locator('#arsenal').tap();
  await dialog().waitFor();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.arsenal-dialog [data-weapon] img')].length === 12 &&
      [...document.querySelectorAll('.arsenal-dialog [data-weapon] img')].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
  );
  await pause(220);
}
async function close(method = 'close') {
  if (method === 'escape') await page.keyboard.press('Escape');
  else if (method === 'backdrop') {
    const box = await dialog().boundingBox();
    assert.ok(box.x > 2 || box.y > 2, 'Dialog keeps a tappable backdrop');
    await page.touchscreen.tap(
      box.x > 2 ? 1 : Math.round(box.x + box.width / 2),
      box.y > 2 ? 1 : Math.round(box.y + box.height / 2),
    );
  } else await dialog().getByRole('button', { name: 'Cerrar', exact: true }).tap();
  await until(async () => !(await page.locator('.arsenal-dialog').count()), method + ' removes inventory');
}
async function select(id) {
  await open();
  const prior = await page.locator('#equipped-name').textContent();
  await card(id).tap();
  assert.equal(await dialog().getAttribute('data-inspected'), id, id + ' previews');
  assert.equal(
    await page.locator('#equipped-name').textContent(),
    prior,
    id + ' preview does not change HUD',
  );
  assert.equal(
    await page.locator('#arsenal-detail .arsenal-description').textContent(),
    WEAPONS.find((w) => w.id === id).description,
  );
  await page.locator('#arsenal-equip').tap();
  await until(
    async () => !(await page.locator('.arsenal-dialog').count()),
    id + ' explicit equip closes inventory',
  );
  await until(
    async () =>
      (await page.locator('#arsenal').textContent()).includes(WEAPONS.find((w) => w.id === id).name),
    id + ' selected HUD',
  );
  assert.ok(
    (await page.locator('#equipped-art').getAttribute('src')).includes('/' + id + '.png'),
    id + ' HUD illustration updates after equip',
  );
}
async function snapshotArrives(check, label) {
  await until(() => latest() && check(latest()), label);
  await pause(60);
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
  await page.locator('#player-name').fill('Arsenal');
  await page.getByRole('button', { name: 'Crear sala privada →' }).click();
  await page.locator('#ready').waitFor();
  const identity = received.find((m) => m.type === 'welcome');
  guest = await NetworkClient.connect(app.port);
  await guest.command('join', { code: identity.code, name: 'Observa' });
  await guest.command('ready', { ready: true });
  await page.locator('#ready').click();
  await page.locator('#start').click();
  await until(() => guest.room?.phase === 'loading', 'Guest loads');
  await guest.command('loaded');
  await page.locator('#field').waitFor();
  await page.waitForFunction(
    () => document.querySelector('.pixi-field') && !document.querySelector('#fire').disabled,
  );
  game = app.rooms.get(identity.code).game;
  owner = game._active();
  player = game.players.find((p) => p.id === owner.playerId);
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
  await snapshotArrives((s) => s.terrainRevision === game.terrain.revision, 'Safe terrain arrives');
  await page.bringToFront();

  report.currentCase = 'illustrated-content';
  await open();
  assert.equal(await card('bazooka').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-weapon]').count(), 12);
  report.weapons = [];
  for (const w of WEAPONS) {
    const button = card(w.id),
      image = button.locator('img');
    assert.equal(await image.count(), 1, w.id + ' has exactly one illustration');
    const loaded = await image.evaluate((img) => ({
      src: img.currentSrc,
      width: img.naturalWidth,
      height: img.naturalHeight,
      complete: img.complete,
    }));
    assert.ok(loaded.complete && loaded.width > 0 && loaded.height > 0, w.id + ' illustration loaded');
    assert.ok((await button.innerText()).includes(w.name), w.id + ' correct Spanish name');
    assert.equal(
      (await button.locator('.ammo b').textContent()).trim(),
      w.ammo === -1 ? '∞' : String(w.ammo),
      w.id + ' correct ammunition',
    );
    assert.equal(await button.getAttribute('aria-pressed'), String(w.id === 'bazooka'));
    report.weapons.push({ id: w.id, name: w.name, ammo: w.ammo, image: loaded });
  }
  assert.equal(new Set(report.weapons.map((w) => w.image.src)).size, 12, 'Each weapon has its own image');
  await card('grenade').focus();
  assert.equal(
    await page.locator('#arsenal-detail strong').textContent(),
    'Granada',
    'Focused card exposes its name in the briefing',
  );
  assert.equal(
    await page.locator('#arsenal-detail .arsenal-description').textContent(),
    WEAPONS.find((w) => w.id === 'grenade').description,
  );
  await card('bazooka').focus();
  await card('grenade').tap();
  await page.mouse.move(1, 1);
  await pause(140);
  assert.equal(
    await dialog().getAttribute('data-inspected'),
    'grenade',
    'Tapped preview survives pointerleave and snapshots',
  );
  await card('bazooka').focus();
  await capture('mobile');
  await close();
  for (const w of WEAPONS) {
    await select(w.id);
    await open();
    assert.equal(
      await card(w.id).getAttribute('aria-pressed'),
      'true',
      w.id + ' inspected state starts at equipped weapon',
    );
    assert.equal(await page.locator('[data-weapon][aria-pressed="true"]').count(), 1);
    await close();
  }
  report.checks.push(
    'Twelve loaded illustrations and ammunition counts; tapping previews full description, only explicit equip updates HUD and closes',
  );

  report.currentCase = 'live-inventory';
  await open();
  const stableCard = await card('mine').elementHandle();
  player.ammo.mine = 0;
  await card('mine').tap();
  await until(
    async () => (await card('mine').getAttribute('data-unavailable')) === 'true',
    'Live ammunition updates an open inventory',
  );
  assert.equal(await card('mine').isDisabled(), false, 'Unavailable weapon remains inspectable');
  assert.equal(await page.locator('#arsenal-equip').isDisabled(), true, 'Unavailable preview cannot equip');
  assert.equal(
    await dialog().getAttribute('data-inspected'),
    'mine',
    'Preview persists across live snapshots',
  );
  assert.equal(await card('mine').locator('.ammo b').textContent(), '0');
  assert.equal(
    await stableCard.evaluate(
      (el) => el.isConnected && el === document.querySelector('[data-weapon="mine"]'),
    ),
    true,
    'Live snapshots preserve interactive card nodes',
  );
  game.turn.remaining = 3.8;
  await until(
    async () => (await page.locator('.arsenal-clock').getAttribute('class')).includes('urgent'),
    'Live turn clock enters urgency',
  );
  game.turn.remaining = 480;
  player.ammo.mine = 3;
  await until(
    async () => await page.locator('#arsenal-equip').isEnabled(),
    'Ammunition recovery updates the same open inventory',
  );
  await close();
  report.checks.push(
    'Focused weapons expose their description; open inventory updates ammunition and urgent turn clock without replacing card nodes',
  );

  report.currentCase = 'restrictions';
  player.ammo.cluster = 0;
  player.ammo.jetpack = 0;
  game.mapId = 'cavern';
  await snapshotArrives(
    (s) => s.mapId === 'cavern' && s.players.find((p) => p.id === player.id).ammo.cluster === 0,
    'Unavailable state arrives',
  );
  await open();
  for (const id of ['cluster', 'airstrike', 'jetpack']) {
    assert.equal(await card(id).isEnabled(), true, id + ' remains inspectable');
    await card(id).tap();
    assert.equal(await page.locator('#arsenal-equip').isDisabled(), true, id + ' cannot equip');
    assert.equal(
      await page.locator('#arsenal-detail .arsenal-description').textContent(),
      WEAPONS.find((w) => w.id === id).description,
    );
    assert.equal(await page.locator('.arsenal-restriction').isVisible(), true, id + ' restriction explained');
  }
  report.unavailable = {
    cluster: await card('cluster').innerText(),
    airstrike: await card('airstrike').innerText(),
    jetpack: await card('jetpack').innerText(),
  };
  await capture('unavailable');
  await close();
  Object.assign(owner, { jetpack: true, fuel: 60 });
  await snapshotArrives((s) => s.worms.find((w) => w.id === owner.id).jetpack, 'Active last jetpack arrives');
  await open();
  assert.equal(await card('jetpack').isEnabled(), true, 'An active last-use jetpack stays selectable');
  await card('jetpack').tap();
  assert.equal(await page.locator('#arsenal-equip').isEnabled(), true);
  await page.locator('#arsenal-equip').tap();
  await until(async () => !(await dialog().count()), 'Active jetpack selected with zero stock');
  assert.equal(await page.locator('#fire').isEnabled(), true, 'Active jetpack can be switched off');
  game._release(owner);
  game.mapId = 'hills';
  for (const w of WEAPONS) player.ammo[w.id] = w.ammo;
  await snapshotArrives(
    (s) => s.mapId === 'hills' && !s.worms.find((w) => w.id === owner.id).jetpack,
    'Normal state restored',
  );
  report.checks.push(
    'Empty stock and cavern airstrike are unavailable; the active last-use jetpack remains selectable and usable',
  );

  report.currentCase = 'neutralize-and-focus';
  await select('bazooka');
  await page.locator('#arsenal').focus();
  await page.keyboard.down('d');
  await until(() => game._input.move > 0, 'Held movement reaches authoritative game');
  await page.keyboard.press('e');
  await dialog().waitFor();
  await page.keyboard.up('d');
  await until(
    () => !game._input.move && !game._input.thrustX && !game._input.thrustY && !game._input.reel,
    'Inventory neutralizes movement',
  );
  await close('escape');
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'arsenal',
    'Escape restores trigger focus',
  );
  const before = fires(),
    fire = await page.locator('#fire').boundingBox();
  await page.mouse.move(fire.x + fire.width / 2, fire.y + fire.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => document.querySelector('#fire').classList.contains('is-charging'));
  await page.keyboard.press('e');
  await dialog().waitFor();
  await page.mouse.up();
  await pause(160);
  assert.equal(fires(), before, 'Opening arsenal cancels a held shot without firing');
  assert.equal(
    await page.locator('#fire').evaluate((el) => el.classList.contains('is-charging')),
    false,
    'Power indication cancels with arsenal',
  );
  await close();
  for (const method of ['escape', 'backdrop', 'close']) {
    await open();
    await card('grenade').tap();
    await close(method);
    assert.equal(
      await page.locator('#equipped-name').textContent(),
      'Bazuca',
      method + ' discards pending inspection',
    );
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      'arsenal',
      method + ' returns focus to trigger',
    );
  }
  await open();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.weapon), 'bazooka');
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.weapon),
    'grenade',
    'Arrow navigation previews next weapon',
  );
  await page.keyboard.press('Enter');
  assert.equal(await dialog().count(), 1, 'Keyboard activation previews, remains open to read');
  assert.equal(await page.locator('#equipped-name').textContent(), 'Bazuca');
  await page.keyboard.press(navigationKey);
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'arsenal-equip',
    'Tab goes directly from inspected card to confirmation',
  );
  await page.keyboard.press('Enter');
  await until(
    async () => !(await page.locator('.arsenal-dialog').count()),
    'Keyboard explicit equip selects and closes',
  );
  assert.match(await page.locator('#arsenal').textContent(), /Granada/);
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'arsenal',
    'Selection returns focus to trigger',
  );
  report.checks.push(
    'Opening inventory neutralizes held movement and charging without a shot; Escape/backdrop/close restore focus; ' +
      navigationKey +
      '/Enter previews then explicitly equips a weapon',
  );

  report.currentCase = 'responsive-layouts';
  for (const [width, height] of [
    [1280, 800],
    [568, 320],
    [667, 375],
    [844, 390],
    [936, 432],
    [320, 700],
    [375, 812],
    [414, 896],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width: 844, height: 390 });
    await open();
    await page.setViewportSize({ width, height });
    await pause(180);
    const layout = await page.evaluate(() => {
      const d = document.querySelector('.arsenal-dialog'),
        rect = (el) => el.getBoundingClientRect().toJSON();
      return {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        dialog: rect(d),
        footer: rect(d.querySelector('.arsenal-footer')),
        equip: rect(d.querySelector('#arsenal-equip')),
        description: rect(d.querySelector('.arsenal-description')),
        close: rect(d.querySelector('[aria-label="Cerrar"]')),
        cards: [...d.querySelectorAll('[data-weapon]')].map((el) => ({ id: el.dataset.weapon, ...rect(el) })),
      };
    });
    const viewport = { x: 0, y: 0, right: width, bottom: height };
    contained(layout.dialog, viewport, `${width}: inventory fits viewport`);
    contained(layout.close, viewport, `${width}: close remains visible`);
    contained(layout.footer, viewport, `${width}: persistent description/equip footer visible`);
    contained(layout.equip, viewport, `${width}: equip remains visible`);
    assert.ok(layout.equip.width >= 43.9 && layout.equip.height >= 43.9, `${width}: equip touch target`);
    assert.ok(layout.close.width >= 43.9 && layout.close.height >= 43.9, `${width}: close touch target`);
    assert.ok(layout.scrollWidth <= width, `${width}: no horizontal page scroll`);
    for (const a of layout.cards) {
      assert.ok(a.width >= 43.9 && a.height >= 43.9, `${width}: ${a.id} touch target`);
      for (const b of layout.cards)
        if (a.id !== b.id)
          assert.ok(
            Math.min(a.right, b.right) - Math.max(a.x, b.x) < 1 ||
              Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) < 1,
            `${width}: ${a.id}/${b.id} do not overlap`,
          );
    }
    if (width === 1280 || width === 568 || width === 375) await capture(String(width));
    layout.reachable = [];
    for (const w of WEAPONS) {
      await card(w.id).scrollIntoViewIfNeeded();
      const hit = await card(w.id).evaluate((el) => {
        const b = el.getBoundingClientRect(),
          x = b.x + b.width / 2,
          y = b.y + b.height / 2,
          top = document.elementFromPoint(x, y);
        const name = el.querySelector('strong');
        return {
          id: el.dataset.weapon,
          x,
          y,
          hit: top?.closest('[data-weapon]')?.dataset.weapon,
          titleWidth: name?.clientWidth,
          titleScrollWidth: name?.scrollWidth,
        };
      });
      report.currentHit = { width, height, ...hit };
      assert.equal(hit.hit, w.id, `${width}: ${w.id} scrolls to an unobstructed target`);
      assert.ok(hit.titleScrollWidth <= hit.titleWidth + 1, `${width}: ${w.id} title fits`);
      await card(w.id).tap();
      assert.equal(
        await page.locator('.arsenal-description').textContent(),
        w.description,
        `${width}: ${w.id} full description`,
      );
      const footer = await page.locator('.arsenal-footer').evaluate((el) => {
        const desc = el.querySelector('.arsenal-description'),
          r = desc.getBoundingClientRect(),
          equip = el.querySelector('#arsenal-equip'),
          b = equip.getBoundingClientRect();
        return {
          desc: r.toJSON(),
          clipped: desc.scrollHeight > desc.clientHeight + 1 || desc.scrollWidth > desc.clientWidth + 1,
          equip: b.toJSON(),
          hit: document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('button')?.id,
        };
      });
      contained(footer.desc, viewport, `${width}: ${w.id} entire description in viewport`);
      assert.equal(footer.clipped, false, `${width}: ${w.id} description not truncated`);
      assert.equal(footer.hit, 'arsenal-equip', `${width}: ${w.id} equip unobstructed`);
      layout.reachable.push({ ...hit, footer });
    }
    report.layouts.push(layout);
    await close();
  }
  report.checks.push(
    'Desktop, four landscape and four portrait dimensions keep the dialog bounded, all twelve weapons inspectable with full persistent descriptions, reachable equip action, fitted labels and controls at least 44px',
  );

  report.currentCase = 'small-blocked-description';
  await page.setViewportSize({ width: 568, height: 320 });
  game.mapId = 'cavern';
  await snapshotArrives((s) => s.mapId === 'cavern', 'Cavern layout fixture arrives');
  await open();
  await card('airstrike').tap();
  const blockedFooter = await page.locator('.arsenal-footer').evaluate((el) => ({
    rect: el.getBoundingClientRect().toJSON(),
    texts: [...el.querySelectorAll('.arsenal-description,.arsenal-restriction')].map((p) => ({
      rect: p.getBoundingClientRect().toJSON(),
      overflow: p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1,
    })),
  }));
  contained(blockedFooter.rect, { x: 0, y: 0, right: 568, bottom: 320 }, 'Small blocked footer visible');
  for (const p of blockedFooter.texts) {
    contained(
      p.rect,
      { x: 0, y: 0, right: 568, bottom: 320 },
      'Small blocked description and reason visible',
    );
    assert.equal(p.overflow, false, 'Small blocked text is complete');
  }
  assert.equal(await page.locator('#arsenal-equip').isDisabled(), true);
  await capture('blocked-568');
  await close();
  game.mapId = 'hills';
  await snapshotArrives((s) => s.mapId === 'hills', 'Hills restored');
  report.checks.push(
    'At 568x320 blocked airstrike keeps complete weapon description and additional restriction visible with disabled confirmation',
  );

  report.currentCase = 'reduced-motion';
  await page.setViewportSize({ width: 844, height: 390 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open();
  report.reducedMotion = await dialog().evaluate((d) =>
    [d, ...d.querySelectorAll('*')]
      .map((el) => ({
        class: el.className,
        animation: getComputedStyle(el).animationName,
        transition: getComputedStyle(el).transitionDuration,
      }))
      .filter((s) => s.animation !== 'none' || s.transition.split(',').some((t) => parseFloat(t) > 0.01)),
  );
  assert.deepEqual(report.reducedMotion, [], 'Reduced motion suppresses inventory animations/transitions');
  await capture('reduced-motion');
  await close();
  report.checks.push('System reduced-motion preference suppresses inventory animations and transitions');
  assert.equal(fires(), 0, 'Inventory interactions never submit an attack');
  assert.deepEqual(report.errors, []);
  report.finalSourceSHA256 = await hashes();
  assert.deepEqual(
    report.finalSourceSHA256,
    report.sourceSHA256,
    'Product sources unchanged during browser run',
  );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  if (page) {
    report.focus = await page
      .evaluate(() => ({
        tag: document.activeElement?.tagName,
        id: document.activeElement?.id,
        weapon: document.activeElement?.dataset.weapon,
      }))
      .catch(() => null);
    await capture('failure').catch(() => {});
  }
  throw error;
} finally {
  if (report.passed) await unlink(new URL(`arsenal-${kind}-failure.png`, folder)).catch(() => {});
  await writeFile(new URL(`arsenal-${kind}.json`, folder), JSON.stringify(report, null, 2) + '\n');
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
