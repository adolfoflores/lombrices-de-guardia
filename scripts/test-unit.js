import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const files = (await readdir('tests'))
  .filter((name) => name.endsWith('.test.js') && !['network.test.js', 'production.test.js'].includes(name))
  .sort()
  .map((name) => `tests/${name}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
