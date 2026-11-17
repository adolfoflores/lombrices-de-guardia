// Rebuild the home-screen icons from the game's original illustration.
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = new URL('../public/icons/', import.meta.url);
const crest = await readFile(new URL('../public/crest.svg', import.meta.url), 'utf8');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size] of [
    ['apple-touch-icon', 180],
    ['icon-192', 192],
    ['icon-512', 512],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    // The original crest's generous margins keep the worms inside icon masks.
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:#172c33}body{display:grid;place-items:center}svg{width:96%;height:auto;display:block}</style>${crest}`,
    );
    await page.screenshot({ path: new URL(`${name}.png`, output).pathname });
  }
} finally {
  await browser.close();
}
