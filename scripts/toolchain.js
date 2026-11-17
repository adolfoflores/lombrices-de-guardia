import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Detect stale node_modules before accepting a release verification. */
export async function inspectToolchain({ root = process.cwd(), nodeVersion = process.versions.node } = {}) {
  const errors = [];
  const [major, minor] = nodeVersion.split('.').map(Number);
  if (major < 22 || major === 23 || (major === 22 && minor < 13))
    errors.push(`Node ${nodeVersion}: se requiere Node 22.13+ o 24+.`);
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const expected = lock.packages[`node_modules/${name}`]?.version;
    let actual;
    try {
      actual = JSON.parse(
        await readFile(resolve(root, 'node_modules', name, 'package.json'), 'utf8'),
      ).version;
    } catch {
      actual = 'sin instalar';
    }
    if (!expected || actual !== expected)
      errors.push(`${name}: instalado ${actual}; lockfile ${expected || 'ausente'}.`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = await inspectToolchain();
  if (errors.length) {
    console.error(`${errors.join('\n')}\nEjecuta npm ci antes de validar una versión.`);
    process.exitCode = 1;
  } else console.log('Node y dependencias coinciden con el lockfile.');
}
