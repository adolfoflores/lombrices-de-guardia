import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const publicFile = (path) => new URL(`../public${path}`, import.meta.url);

test('installed app starts at the lobby without preserving an invitation or forcing landscape', async () => {
  const manifest = JSON.parse(await readFile(publicFile('/manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'es');
  assert.equal(manifest.orientation, undefined);
  assert.equal(manifest.name, 'Lombrices de guardia');
  assert.ok(manifest.short_name);
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((icon) => icon.sizes === `${size}x${size}`);
    assert.ok(icon, `Missing ${size}px install icon`);
    assert.equal(icon.type, 'image/png');
    const png = await readFile(publicFile(icon.src));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

test('Safari receives its own home-screen icon and standalone metadata without disabling page zoom', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="apple-mobile-web-app-title" content="Lombrices"/);
  assert.match(html, /name="apple-mobile-web-app-status-bar-style" content="default"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/icons\/apple-touch-icon\.png"/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
  const png = await readFile(publicFile('/icons/apple-touch-icon.png'));
  assert.equal(png.readUInt32BE(16), 180);
  assert.equal(png.readUInt32BE(20), 180);
});
