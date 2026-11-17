import { readdir, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// Install the WebP cwebp utility to regenerate these checked-in files.
// Full-size textures remain pixel-exact; small lobby cards use separate previews.
await mkdir('public/art/previews', { recursive: true });
for (const name of (await readdir('art/source')).filter((name) => name.endsWith('.png')).sort()) {
  const source = `art/source/${name}`;
  const stem = name.slice(0, -4);
  const jobs = [
    ['-lossless', '-q', '100', '-m', '6', source, '-o', `public/art/${stem}.webp`],
    ...(stem.endsWith('-backdrop')
      ? [['-q', '85', '-m', '6', '-resize', '480', '0', source, '-o', `public/art/previews/${stem}.webp`]]
      : []),
  ];
  for (const args of jobs) {
    const result = spawnSync('cwebp', ['-quiet', ...args], { stdio: 'inherit' });
    if (result.error) throw new Error('Instala cwebp para regenerar el arte.', { cause: result.error });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log(`Optimizado: ${stem}`);
}
