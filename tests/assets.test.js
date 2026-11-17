import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MAPS } from '../shared/config.js';

test('full-size art remains lossless at source dimensions and lobby previews respect the download budget', async () => {
  let total = 0;
  for (const name of [
    'hills-earth',
    'hills-backdrop',
    'cavern-rock',
    'cavern-backdrop',
    'islands-earth',
    'islands-backdrop',
  ]) {
    const original = await readFile(new URL(`../art/source/${name}.png`, import.meta.url));
    const data = await readFile(new URL(`../public/art/${name}.webp`, import.meta.url));
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    assert.equal(data.toString('ascii', 8, 16), 'WEBPVP8L', `${name}: preserve lossless encoding`);
    assert.equal(data[20], 0x2f);
    const dimensions = data.readUInt32LE(21);
    assert.equal((dimensions & 0x3fff) + 1, original.readUInt32BE(16));
    assert.equal(((dimensions >>> 14) & 0x3fff) + 1, original.readUInt32BE(20));
    total += data.length;
  }
  assert.ok(total < 12 * 1024 * 1024, 'six full-size lossless images must remain below 12 MiB');
  for (const map of MAPS) {
    const data = await readFile(new URL(`../public/art/previews/${map.id}-backdrop.webp`, import.meta.url));
    assert.ok(data.length < 30 * 1024, `${map.id}: preview download exceeds 30 KiB`);
    assert.equal(data.toString('ascii', 12, 16), 'VP8 ');
    assert.equal(data.readUInt16LE(26) & 0x3fff, 480);
    assert.equal(data.readUInt16LE(28) & 0x3fff, 320);
  }
});
