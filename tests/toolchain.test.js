import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectToolchain } from '../scripts/toolchain.js';

test('release validation rejects stale or missing packages and unsupported Node, then accepts the lockfile', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ldg-toolchain-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { vite: '^7.3.8' } }));
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({ packages: { 'node_modules/vite': { version: '7.3.8' } } }),
  );
  assert.equal((await inspectToolchain({ root, nodeVersion: '22.13.0' })).length, 1);
  const directory = join(root, 'node_modules/vite');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '7.3.6' }));
  assert.match((await inspectToolchain({ root, nodeVersion: '22.13.0' }))[0], /7.3.6/);
  await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '7.3.8' }));
  assert.deepEqual(await inspectToolchain({ root, nodeVersion: '24.0.0' }), []);
  assert.match((await inspectToolchain({ root, nodeVersion: '22.11.0' }))[0], /Node/);
  assert.match((await inspectToolchain({ root, nodeVersion: '22.12.0' }))[0], /Node/);
  assert.match((await inspectToolchain({ root, nodeVersion: '23.0.0' }))[0], /Node/);
  assert.deepEqual(await inspectToolchain({ root, nodeVersion: '22.13.0' }), []);
});
