// Real home-screen UI and socket regression. Run Chromium and WebKit sequentially.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { createServer } from '../server/index.js';

const kind = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const evidence = new URL('../docs/evidence/', import.meta.url);
const report = {
  browser: kind,
  physicalDevice: false,
  startedAt: new Date().toISOString(),
  checks: [],
  layouts: [],
  errors: [],
  notes: [
    'Three independent browser contexts use the real home form, dialogs and WebSocket server.',
    "Busy-state fixture briefly buffers the first connection's outbound server replies. Client handlers and requests are unchanged; a second tap and Enter are trusted browser input.",
    'Viewport and input-focus checks emulate responsive layouts, not an iPhone keyboard or a physical device.',
  ],
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error(message);
    await pause(25);
  }
}
async function hashes() {
  const files = ['index.html'];
  for (const directory of ['client', 'server', 'shared'])
    for (const name of await readdir(new URL(`../${directory}/`, import.meta.url)))
      if (/\.(js|css)$/.test(name)) files.push(`${directory}/${name}`);
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
let app, browser, page;
const contexts = [],
  pages = [],
  streams = [],
  sent = [];
const commands = (index) => sent[index].filter((message) => ['create', 'join'].includes(message.type));
const room = (index) => streams[index].filter((message) => message.type === 'room').at(-1)?.room;
async function capture(name, fullPage = false, target = page) {
  await target.screenshot({
    path: fileURLToPath(new URL(`home-refresh-${kind}-${name}.png`, evidence)),
    fullPage,
  });
}
async function makePage(url) {
  const index = pages.length,
    context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
  contexts.push(context);
  const target = await context.newPage();
  pages.push(target);
  streams.push([]);
  sent.push([]);
  target.on('pageerror', (error) => report.errors.push(error.message));
  target.on('websocket', (ws) => {
    if (!ws.url().endsWith('/socket')) return;
    ws.on('framesent', ({ payload }) => {
      try {
        sent[index].push(JSON.parse(String(payload)));
      } catch {}
    });
    ws.on('framereceived', ({ payload }) => {
      try {
        streams[index].push(JSON.parse(String(payload)));
      } catch {}
    });
  });
  await target.goto(url);
  await target.locator('#entry-form').waitFor();
  await target.waitForFunction(() => document.querySelector('#connection')?.hidden);
  await target.evaluate(() => document.fonts.ready);
  return target;
}
async function mode(value, target = page) {
  await target.locator(`#${value}-tab`).tap();
  assert.equal(await target.locator(`#${value}-tab`).getAttribute('aria-selected'), 'true');
  assert.equal(
    await target.locator(`#${value === 'create' ? 'join' : 'create'}-tab`).getAttribute('aria-selected'),
    'false',
  );
  assert.equal(await target.locator('#room-code').isVisible(), value === 'join');
}
async function closeDialog(target = page) {
  await target.locator('dialog[open] .dialog-head button').tap();
  await until(async () => !(await target.locator('dialog[open]').count()), 'Dialog closes');
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
  page = await makePage(base);
  report.currentCase = 'responsive-home';
  for (const [width, height] of [
    [320, 700],
    [375, 812],
    [414, 896],
    [768, 1024],
    [1280, 800],
    [568, 320],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await pause(80);
    for (const tab of ['create', 'join']) {
      await mode(tab);
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        title: document.querySelector('main h1')?.textContent,
        controls: [...document.querySelectorAll('main button,main a,main input')]
          .filter((el) => el.getClientRects().length)
          .map((el) => ({
            id:
              el.id ||
              el.getAttribute('aria-label') ||
              (el.hasAttribute('data-connect') ? 'connect' : el.tagName),
            tag: el.tagName,
            rect: el.getBoundingClientRect().toJSON(),
            fontSize: getComputedStyle(el).fontSize,
          })),
      }));
      report.layouts.push({ mode: tab, ...layout });
      assert.ok(layout.scrollWidth <= width, `${tab}/${width}: no horizontal scroll`);
      for (const control of layout.controls) {
        assert.ok(
          control.rect.width >= 43.9 && control.rect.height >= 43.9,
          `${tab}/${width}: ${control.id} is a 44px target (${control.rect.width}x${control.rect.height})`,
        );
        assert.ok(
          control.rect.x >= -1 && control.rect.right <= width + 1,
          `${tab}/${width}: ${control.id} fits the width`,
        );
        if (control.tag === 'INPUT')
          assert.ok(
            parseFloat(control.fontSize) >= 16,
            `${control.id}: readable input font avoids iPhone focus zoom`,
          );
      }
      for (const selector of ['#player-name', ...(tab === 'join' ? ['#room-code'] : []), '[data-connect]']) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        const box = await page.locator(selector).boundingBox();
        assert.ok(box.y >= -1 && box.y + box.height <= height + 1, `${selector}: reachable by scrolling`);
        if (selector.startsWith('#')) {
          await page.locator(selector).tap();
          assert.equal(
            await page.evaluate(() => document.activeElement?.id),
            selector.slice(1),
            'Input receives tap focus',
          );
        }
      }
      await page.evaluate(() => {
        document.activeElement?.blur();
        scrollTo(0, 0);
      });
      if ([320, 375, 1280, 844].includes(width)) await capture(`${tab}-${width}`, true);
    }
  }
  report.checks.push(
    'Create and join layouts fit seven mobile/tablet/desktop sizes, including two landscapes; all visible targets are 44px, focused inputs are at least 16px and submission remains reachable',
  );

  report.currentCase = 'drafts-and-escaping';
  await page.setViewportSize({ width: 375, height: 812 });
  const escapedName = 'A"<& Guardia',
    escapedCode = '"><&AB';
  await page.locator('#player-name').fill(escapedName);
  await page.locator('#room-code').fill(escapedCode);
  await mode('create');
  assert.equal(await page.locator('#player-name').inputValue(), escapedName);
  await mode('join');
  assert.equal(await page.locator('#room-code').inputValue(), escapedCode);
  assert.equal(await page.locator('#player-name').inputValue(), escapedName);
  assert.equal(await page.locator('#entry-form input').count(), 2);
  assert.equal(
    await page
      .locator('#entry-form')
      .evaluate((form) =>
        [...form.querySelectorAll('*')].some((el) =>
          [...el.attributes].some((attribute) => attribute.name.startsWith('on')),
        ),
      ),
    false,
    'Drafts do not inject event attributes',
  );
  assert.equal(await page.locator('#player-name').getAttribute('maxlength'), '20');
  assert.equal((await page.locator('#player-name').getAttribute('required')) !== null, true);
  await page.locator('#player-name').fill('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  assert.equal(
    (await page.locator('#player-name').inputValue()).length,
    20,
    'UI enforces the 20-character name limit',
  );
  report.checks.push(
    'Tabs preserve name/code drafts, quotes and angle brackets remain literal input values, and the name retains required/maxlength behavior',
  );

  report.currentCase = 'keyboard-tabs';
  await page.locator('#join-tab').focus();
  for (const [key, selected] of [
    ['ArrowLeft', 'create'],
    ['ArrowRight', 'join'],
    ['Home', 'create'],
    ['End', 'join'],
  ]) {
    await page.keyboard.press(key);
    assert.equal(await page.locator(`#${selected}-tab`).getAttribute('aria-selected'), 'true');
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      `${selected}-tab`,
      `${key} keeps focus on selected tab`,
    );
  }
  assert.equal(await page.locator('#room-code').inputValue(), escapedCode);
  report.checks.push('Arrow keys and Home/End switch tabs with focus restored and drafts preserved');

  report.currentCase = 'required-inputs';
  await mode('create');
  await page.locator('#player-name').fill('');
  const beforeInvalid = commands(0).length;
  await page.locator('[data-connect]').tap();
  assert.equal(await page.locator('#player-name').evaluate((el) => el.validity.valueMissing), true);
  assert.equal(commands(0).length, beforeInvalid);
  await page.locator('#player-name').fill('   ');
  await page.locator('[data-connect]').tap();
  await pause(80);
  assert.equal(commands(0).length, beforeInvalid, 'Whitespace-only names do not reach server');
  await mode('join');
  await page.locator('#player-name').fill('Guardia');
  await page.locator('#room-code').fill('');
  await page.locator('[data-connect]').tap();
  await pause(80);
  assert.equal(commands(0).length, beforeInvalid, 'Missing invite code does not reach server');
  assert.equal(await page.locator('[data-connect]').isEnabled(), true);
  report.checks.push('Empty/whitespace names and missing room code do not submit or leave the form stuck');

  report.currentCase = 'home-dialogs';
  await page.locator('[data-settings]').tap();
  await page.locator('#hand').waitFor();
  await page.locator('#hand').selectOption('left');
  await page.locator('#motion').check();
  await closeDialog();
  const preference = await page.evaluate(() => JSON.parse(localStorage.getItem('ldg-prefs')));
  assert.equal(preference.hand, 'left');
  assert.equal(preference.reducedMotion, true);
  assert.equal(await page.locator('#player-name').inputValue(), 'Guardia');
  await page.locator('#home-rules').tap();
  await page.locator('.rules').waitFor();
  assert.match(await page.locator('.rules').textContent(), /30, 45 o 60/);
  await closeDialog();
  assert.equal(await page.locator('#join-tab').getAttribute('aria-selected'), 'true');
  report.checks.push('Settings persist and help opens/closes without losing the current form or draft');

  report.currentCase = 'busy-create';
  await mode('create');
  await page.locator('#player-name').fill(escapedName);
  const originalSubmitIcons = await page.locator('[data-connect] svg').count();
  const serverSocket = [...app.wss.clients][0],
    originalSend = serverSocket.send;
  const buffered = [];
  let hold = true;
  serverSocket.send = function (...args) {
    if (hold) buffered.push(args);
    else originalSend.apply(this, args);
  };
  try {
    await page.locator('[data-connect]').tap();
    await until(
      async () => await page.locator('[data-connect]').isDisabled(),
      'Create disables while waiting',
    );
    assert.match(await page.locator('[data-connect]').textContent(), /Conectando/i);
    const submitted = commands(0).length;
    assert.equal(submitted, 1);
    for (const selector of ['#create-tab', '#join-tab', '#player-name', '#room-code'])
      assert.equal(
        await page.locator(selector).isDisabled(),
        true,
        `${selector} remains stable during connection`,
      );
    assert.equal(
      await page.locator('[data-connect] svg').count(),
      originalSubmitIcons,
      'Busy state preserves button artwork',
    );
    const button = await page.locator('[data-connect]').boundingBox();
    await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
    await page.locator('#player-name').focus();
    await page.keyboard.press('Enter');
    await pause(80);
    assert.equal(commands(0).length, submitted, 'Busy submit rejects repeated tap and Enter');
    await capture('connecting', true);
    report.busy = {
      bufferedReplies: buffered.length,
      requests: submitted,
      repeatRequests: commands(0).length - submitted,
    };
  } finally {
    hold = false;
    serverSocket.send = originalSend;
    for (const args of buffered) originalSend.apply(serverSocket, args);
  }
  await page.locator('#ready').waitFor();
  const identity = streams[0].find((message) => message.type === 'welcome');
  const code = identity.code;
  assert.equal(room(0).players[0].name, escapedName);
  assert.ok((await page.locator('.lobby-roster').textContent()).includes(escapedName));
  assert.equal(await page.locator('.lobby-roster input,.lobby-roster script').count(), 0);
  report.checks.push(
    'Creating a private room uses one real request; waiting state disables repeated tap/Enter and the escaped player name stays literal in the lobby',
  );

  report.currentCase = 'join-error-and-recovery';
  const guest = await makePage(base);
  await mode('join', guest);
  await guest.locator('#player-name').fill('Segunda guardia');
  const guestSubmitIcons = await guest.locator('[data-connect] svg').count();
  const badCode = ['AAAAAA', 'BBBBBB', 'CCCCCC'].find((value) => !app.rooms.has(value));
  await guest.locator('#room-code').fill(badCode);
  await guest.locator('[data-connect]').tap();
  await until(
    () => streams[1].some((message) => message.type === 'ack' && message.ok === false),
    'Invalid room receives error',
  );
  await until(
    async () => await guest.locator('[data-connect]').isEnabled(),
    'Join recovers from invalid code',
  );
  assert.match(await guest.locator('#toast').textContent(), /No encontramos esa sala/);
  assert.equal(await guest.locator('#room-code').inputValue(), badCode);
  assert.equal(
    await guest.locator('[data-connect] svg').count(),
    guestSubmitIcons,
    'Error recovery preserves button artwork',
  );
  await capture('join-error', true, guest);
  await guest.locator('#room-code').fill(code.toLowerCase());
  await guest.locator('[data-connect]').tap();
  await guest.locator('#ready').waitFor();
  await until(() => room(0)?.players.length === 2, 'Valid manual code joins existing room');
  assert.equal(commands(1).at(-1).code, code);
  report.checks.push(
    'A nonexistent room shows an error and re-enables submission; correcting to a lowercase valid code joins the same room without reload',
  );

  report.currentCase = 'invite-url';
  const invited = await makePage(`${base}/?sala=${code.toLowerCase()}`);
  assert.equal(await invited.locator('#join-tab').getAttribute('aria-selected'), 'true');
  assert.equal(await invited.locator('#room-code').inputValue(), code);
  await invited.locator('#player-name').fill('Por invitación');
  await mode('create', invited);
  await mode('join', invited);
  assert.equal(await invited.locator('#room-code').inputValue(), code);
  assert.equal(await invited.locator('#player-name').inputValue(), 'Por invitación');
  await capture('invite', true, invited);
  await invited.locator('[data-connect]').tap();
  await invited.locator('#ready').waitFor();
  await until(() => room(0)?.players.length === 3, 'Invite joins existing room');
  assert.equal(commands(2).length, 1);
  assert.equal(commands(2)[0].type, 'join');
  await invited.locator('#leave').tap();
  await invited.locator('#entry-form').waitFor();
  assert.equal(await invited.locator('[data-connect]').isEnabled(), true);
  assert.equal(new URL(invited.url()).search, '');
  report.checks.push(
    'Invitation URL preselects Join and uppercase code, survives tab changes, joins the real group and returns to a usable home on leaving',
  );
  report.finalSourceSHA256 = await hashes();
  assert.deepEqual(report.finalSourceSHA256, report.sourceSHA256, 'Product sources unchanged during run');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  if (page) await capture('failure', true).catch(() => {});
  throw error;
} finally {
  if (report.passed) await unlink(new URL(`home-refresh-${kind}-failure.png`, evidence)).catch(() => {});
  await writeFile(new URL(`home-refresh-${kind}.json`, evidence), JSON.stringify(report, null, 2) + '\n');
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
