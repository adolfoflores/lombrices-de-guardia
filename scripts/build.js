import { copyFile } from 'node:fs/promises';
import { build } from 'vite';

await build();
await copyFile('LICENSE', 'dist/LICENSE.txt');
await copyFile('THIRD_PARTY_NOTICES.md', 'dist/THIRD_PARTY_NOTICES.txt');
