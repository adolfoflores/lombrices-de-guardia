import { readFile, readdir, writeFile } from 'node:fs/promises';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const sections = [
  '# Avisos de terceros\n\nGenerado con `npm run licenses` a partir de las dependencias de producción del lockfile.\nEl proyecto original se distribuye bajo MIT; estos paquetes conservan sus avisos propios.',
];
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev) continue;
  const metadata = JSON.parse(await readFile(`${path}/package.json`, 'utf8'));
  if (metadata.version !== entry.version)
    throw new Error(`La instalación de ${metadata.name} no coincide con el lockfile. Ejecuta npm ci.`);
  const files = (await readdir(path)).filter((name) => /^licen[cs]e(?:\.|$)/i.test(name)).sort();
  if (!files.length && metadata.name !== '@pixi/colord')
    throw new Error(`Falta el aviso de licencia de ${metadata.name}`);
  const notices = files.length
    ? await Promise.all(files.map((file) => readFile(`${path}/${file}`, 'utf8')))
    : [await readFile('docs/licenses/pixi-colord.txt', 'utf8')];
  const notice = notices
    .join('\n')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
  sections.push(
    `## ${metadata.name} ${entry.version}\n\nLicencia: ${entry.license || metadata.license}\n\n\`\`\`text\n${notice}\n\`\`\``,
  );
}
const output = sections.join('\n\n') + '\n';
if (process.argv.includes('--check')) {
  if ((await readFile('THIRD_PARTY_NOTICES.md', 'utf8')) !== output)
    throw new Error('Actualiza THIRD_PARTY_NOTICES.md con npm run licenses.');
} else await writeFile('THIRD_PARTY_NOTICES.md', output);
console.log(`Conservados ${sections.length - 1} avisos de dependencias de producción.`);
