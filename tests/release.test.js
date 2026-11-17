import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('release keeps its name, includes licenses and locks a corrected Vite version', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url)));
  assert.equal(pkg.name, 'lombrices-de-guardia');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.devDependencies.vite, lock.packages[''].devDependencies.vite);
  const vite = lock.packages['node_modules/vite'];
  const [major, minor, patch] = vite.version.split('.').map(Number);
  assert.ok(major === 7 && (minor > 3 || (minor === 3 && patch >= 8)));
  assert.match(vite.integrity, /^sha512-/);
  for (const path of [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    '.github/workflows/ci.yml',
  ])
    await access(resolve(root, path));
});

test('public entry-point documentation contains no broken local links', async () => {
  for (const path of [
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'docs/PLAYING.md',
    'docs/TESTING.md',
    'docs/ASSETS.md',
    'docs/ART-PROMPTS.md',
    'docs/ARCHITECTURE.md',
    'docs/DEPLOYMENT.md',
  ]) {
    const full = resolve(root, path);
    const markdown = await readFile(full, 'utf8');
    for (const match of markdown.matchAll(/\]\(([^\s)]+)\)/g)) {
      const target = match[1];
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      await assert.doesNotReject(access(resolve(dirname(full), target.split('#')[0])), `${path}: ${target}`);
    }
  }
});
