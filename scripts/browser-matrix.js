import { spawnSync } from 'node:child_process';

let failed = false;
for (const browser of ['chromium', 'webkit']) {
  for (const map of ['hills', 'cavern', 'islands']) {
    console.log(`\nBrowser: ${browser}; map: ${map}`);
    const result = spawnSync(process.execPath, ['scripts/browser-test.js'], {
      stdio: 'inherit',
      timeout: 180_000,
      env: { ...process.env, TEST_PRODUCTION: '1', TEST_BROWSER: browser, TEST_MAP: map },
    });
    if (result.status !== 0) {
      failed = true;
      console.error(result.error?.message || `Falló ${browser}/${map}.`);
    }
  }
}
process.exitCode = failed ? 1 : 0;
