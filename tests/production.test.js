import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';
import { NetworkClient } from '../scripts/network-smoke.js';

test('production serves compiled client/assets, protects source paths, and accepts online rooms', async (t) => {
  const app = await createServer({ dev: false });
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.close();
    await app.close();
  });
  const base = `http://127.0.0.1:${app.port}`;
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  const html = await home.text();
  assert.match(html, /Lombrices de guardia/);
  assert.doesNotMatch(html, /@vite\/client/);
  const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(assets.some((asset) => /\.js$/.test(asset)));
  assert.ok(assets.some((asset) => /\.css$/.test(asset)));
  const manifestResponse = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assets.push(
    ...manifest.icons.map((icon) => icon.src),
    '/art/hills-earth.webp',
    '/art/hills-backdrop.webp',
    '/art/cavern-rock.webp',
    '/art/cavern-backdrop.webp',
    '/art/islands-earth.webp',
    '/art/islands-backdrop.webp',
    '/art/previews/hills-backdrop.webp',
    '/art/previews/cavern-backdrop.webp',
    '/art/previews/islands-backdrop.webp',
  );
  for (const path of assets) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, `Recurso de producción ausente: ${path}`);
    if (path.endsWith('.js')) assert.match(response.headers.get('content-type'), /javascript/);
    if (path.endsWith('.css')) assert.match(response.headers.get('content-type'), /text\/css/);
    if (path.endsWith('.svg')) assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
    if (path.endsWith('.png')) assert.match(response.headers.get('content-type'), /image\/png/);
    if (path.endsWith('.webp')) assert.match(response.headers.get('content-type'), /image\/webp/);
    if (path.startsWith('/assets/')) assert.match(response.headers.get('cache-control'), /immutable/);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  assert.equal((await fetch(`${base}/?sala=ABC234`)).status, 200);
  assert.equal((await fetch(`${base}/una-ruta-de-sala`)).status, 200);
  assert.equal((await fetch(`${base}/missing.js`)).status, 404);
  for (const path of ['//', '/%', '/%00', '/%5cevil']) {
    assert.equal((await fetch(base + path)).status, 400);
  }
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
  for (const path of ['/LICENSE.txt', '/THIRD_PARTY_NOTICES.txt']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /MIT|Permission/i);
  }
  assert.equal((await fetch(`${base}/server/index.js`)).status, 404);
  assert.equal((await fetch(`${base}/shared/engine.js`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e%2fpackage.json`)).status, 403);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (let i = 0; i < 2; i++) clients.push(await NetworkClient.connect(app.port));
  assert.equal((await clients[0].command('create', { name: 'Producción A' })).ok, true);
  assert.equal(
    (await clients[1].command('join', { code: clients[0].identity.code, name: 'Producción B' })).ok,
    true,
  );
  assert.equal(clients[1].room.players.length, 2);
});
