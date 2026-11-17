/* Browser fixture globals supplied explicitly by the inline harness. */
/* global alpha, craterHashPromise, craterSnapshot, game, girderPixels, girderSnapshot, impact, makeGame, pixelHash, publish, recover, render, renderer, setCamera, snapHashes, stopFrames */
// Original Hills art: real Renderer + authoritative Game, with no UI/network fixture.
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = new URL('../docs/evidence/', import.meta.url);
await mkdir(evidence, { recursive: true });
const browserName = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const baselineOnly = process.argv.includes('--baseline');
const report = {
  browser: browserName,
  startedAt: new Date().toISOString(),
  physicalDevice: false,
  checks: [],
  errors: [],
  requests: [],
  notes: [
    'Real Game snapshots and actions in an isolated Renderer harness; room integration is covered separately.',
    'Desktop Chrome/WebKit measurements are not physical phone performance measurements.',
  ],
};
const source = `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lomas de bronce: terreno</title>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#203542}#stage{position:relative;width:100%;height:100%}#field{display:block;position:absolute;inset:0;width:100%;height:100%}.pixi-field{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}</style>
<div id="stage"><canvas id="field"></canvas></div><script type="module">
import {Renderer} from '/client/renderer.js';
import {Game} from '/shared/engine.js';
import {Terrain} from '/shared/terrain.js';
window.Renderer=Renderer;window.Terrain=Terrain;
window.renderer=new Renderer(document.querySelector('#field'));
window.makeGame=(mapId='hills')=>{
 const roster=[{id:'p0',name:'Anchoa',team:0,color:'#f8b84e'},{id:'p1',name:'Menta',team:1,color:'#68d7c4'}];
 window.game=new Game(roster,{mapId,mode:'ffa',worms:3},{seed:42});
 renderer.state=null;renderer.setState(game.snapshot(true));renderer.setView({playerId:game.turn.playerId,weapon:'bazooka',angle:.8,power:.15,quality:'high',reducedMotion:false});renderer.overview();
 return game.snapshot(false);
};
window.publish=(terrain=false)=>renderer.setState(game.snapshot(terrain));
window.stopFrames=()=>{cancelAnimationFrame(renderer.raf);renderer.raf=null;};
window.render=(offset=0)=>{const time=performance.now()+offset;renderer.draw(time);return time;};
window.setCamera=(x,y,zoom)=>{renderer.fullView=false;renderer.autoFollow=false;renderer.camera={x,y,zoom};renderer.cameraGoal={...renderer.camera};render(100);};
window.alpha=()=>{const pixels=renderer.terrainCtx.getImageData(0,0,1600,900).data;let mismatch=0,solid=0;for(let i=0;i<game.terrain.data.length;i++){solid+=game.terrain.data[i];if(pixels[i*4+3]!==game.terrain.data[i]*255)mismatch++;}return {mismatch,solid};};
window.pixelHash=async(canvas)=>{const pixels=canvas.getContext('2d').getImageData(0,0,1600,900).data;const hash=await crypto.subtle.digest('SHA-256',pixels);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');};
window.snapHashes=async()=>({terrain:await pixelHash(renderer.terrainCanvas),background:await pixelHash(renderer.background)});
window.impact=()=>{const fired=game.action(game.turn.playerId,{type:'fire',weapon:'bazooka',angle:.8,power:.15});let ticks=0;while(ticks++<300&&!game.events.some(e=>e.type==='explosion'))game.step();publish(true);render(100);return {fired,ticks,event:game.events.find(e=>e.type==='explosion'),alpha:alpha()};};
window.recover=async(snapshot)=>{renderer.destroy();renderer=new Renderer(document.querySelector('#field'));const ready=await renderer.ready;renderer.setState({...snapshot,events:[]});renderer.setView({playerId:snapshot.turn.playerId,weapon:'bazooka'});stopFrames();render(100);return {ready,hash:await pixelHash(renderer.terrainCanvas),alpha:alpha(),overlays:document.querySelectorAll('.pixi-field').length};};
makeGame();window.initialized=true;
</script></html>`;
let browser, vite, server;
try {
  server = http.createServer(async (req, res) => {
    if (req.url === '/') {
      try {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(await vite.transformIndexHtml('/', source));
      } catch (error) {
        res.writeHead(500).end(error.message);
      }
    } else vite.middlewares(req, res, () => res.writeHead(404).end());
  });
  vite = await createViteServer({
    root,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: { server } },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  browser = await (browserName === 'webkit' ? webkit : chromium).launch(
    browserName === 'webkit'
      ? { headless: true }
      : { headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' },
  );
  report.version = browser.version();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('response', (response) => {
    if (/hills|terrain.*\.(png|webp|jpg)/.test(response.url()))
      report.requests.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url);
  await page.waitForFunction(() => window.initialized);
  assert.equal(await page.evaluate(() => renderer.ready), true);
  await page.evaluate(() => {
    stopFrames();
    render();
  });
  const capture = async (name) =>
    page.screenshot({ path: fileURLToPath(new URL(`terrain-${browserName}-${name}.png`, evidence)) });
  if (baselineOnly) {
    report.sourceSHA256 = {};
    for (const path of ['client/renderer.js', 'shared/terrain.js', 'shared/engine.js'])
      report.sourceSHA256[path] = createHash('sha256')
        .update(await readFile(new URL('../' + path, import.meta.url)))
        .digest('hex');
    report.maps = {};
    for (const map of ['hills', 'cavern', 'islands'])
      report.maps[map] = await page.evaluate(async (map) => {
        makeGame(map);
        render();
        return { ...(await snapHashes()), alpha: alpha() };
      }, map);
    await page.evaluate(() => {
      makeGame();
      setCamera(800, 510, 0.8);
    });
    await capture('before-art');
    await page.evaluate(() => setCamera(430, 590, 1.6));
    await capture('before-art-close');
    await writeFile(
      new URL(`../tests/fixtures/visual/terrain-${browserName}-baseline.json`, import.meta.url),
      JSON.stringify(report, null, 2) + '\n',
    );
    report.passed = true;
  } else {
    assert.ok(
      await page.evaluate(() => renderer.hillsTerrain && renderer.hillsBackground),
      'Hills art modules are installed',
    );
    report.sourceSHA256 = {};
    for (const path of [
      'client/renderer.js',
      'client/hills-assets.js',
      'client/hills-terrain.js',
      'client/hills-background.js',
      'shared/terrain.js',
      'shared/engine.js',
      'public/art/hills-earth.webp',
      'public/art/hills-backdrop.webp',
    ])
      report.sourceSHA256[path] = createHash('sha256')
        .update(await readFile(new URL('../' + path, import.meta.url)))
        .digest('hex');
    const baseline = JSON.parse(
      await readFile(
        new URL(`../tests/fixtures/visual/terrain-${browserName}-baseline.json`, import.meta.url),
        'utf8',
      ),
    );
    const paintedHillsBaseline = JSON.parse(
      await readFile(
        new URL(`../tests/fixtures/visual/biomes-${browserName}-baseline.json`, import.meta.url),
        'utf8',
      ),
    );
    report.maps = [];
    for (const map of ['hills', 'cavern', 'islands']) {
      const result = await page.evaluate(async (map) => {
        makeGame(map);
        render();
        const before = await snapHashes();
        game.terrain.circle(760, 570, 90);
        game.terrain.girder(900, 480);
        publish(true);
        render(100);
        return { map, before, alpha: alpha() };
      }, map);
      assert.equal(result.alpha.mismatch, 0, 'Collision mask and drawn alpha match at every pixel');
      if (map === 'hills')
        assert.equal(
          result.before.terrain,
          paintedHillsBaseline.maps.hills.terrain,
          'Finished Hills art remains pixel-identical while the other two biomes evolve',
        );
      report.maps.push(result);
    }
    assert.notEqual(
      report.maps[0].before.terrain,
      baseline.maps.hills.terrain,
      'Hills terrain has changed visually',
    );
    report.checks.push(
      'All three maps retain exact collision alpha after destruction/construction; finished Hills art remains pixel-identical to its pre-biome-expansion capture',
    );
    report.notes.push(
      'Cavern and islands now have their own improved art, verified separately by biomes-smoke.js; their old visual baselines are historical rather than regression expectations.',
    );

    await page.evaluate(() => {
      makeGame();
      setCamera(800, 510, 0.8);
    });
    await capture('after-art');
    await page.evaluate(() => setCamera(430, 590, 1.6));
    await capture('after-art-close');
    await page.evaluate(() => setCamera(170, 600, 2));
    await capture('before-crater');
    report.impact = await page.evaluate(() => impact());
    assert.equal(report.impact.fired.ok, true);
    assert.ok(report.impact.event);
    assert.equal(report.impact.alpha.mismatch, 0);
    await page.evaluate(() => {
      render(5000);
      renderer.shake = 0;
      setCamera(170, 600, 2);
    });
    await capture('after-crater');
    report.crater = await page.evaluate(() => {
      const painter = renderer.hillsTerrain,
        data = game.terrain.data,
        original = painter.original,
        pixels = renderer.terrainCtx.getImageData(0, 0, 1600, 900).data;
      let removed = 0,
        newEdges = 0,
        brownEdges = 0;
      const samples = [];
      for (let i = 1601; i < data.length - 1601; i++) {
        if (original[i] && !data[i]) removed++;
        if (!data[i] || painter.grassDepth[i] !== 255) continue;
        if (![i - 1, i + 1, i - 1600, i + 1600].some((n) => original[n] && !data[n])) continue;
        newEdges++;
        const p = i * 4;
        if (pixels[p] > pixels[p + 1] && pixels[p + 1] >= pixels[p + 2]) brownEdges++;
        if (samples.length < 8)
          samples.push({
            x: i % 1600,
            y: Math.floor(i / 1600),
            grassDepth: painter.grassDepth[i],
            rgba: Array.from(pixels.slice(p, p + 4)),
          });
      }
      window.craterSnapshot = game.snapshot(true);
      window.craterHashPromise = pixelHash(renderer.terrainCanvas);
      return { removed, newEdges, brownEdges, samples };
    });
    assert.ok(report.crater.removed > 1000);
    assert.ok(report.crater.newEdges > 30);
    assert.ok(
      report.crater.brownEdges / report.crater.newEdges > 0.9,
      'Newly exposed crater edges are brown earth/scorch, not newly grown green grass',
    );
    const craterBefore = await page.evaluate(() => craterHashPromise);
    report.craterRecovery = await page.evaluate(() => recover(craterSnapshot));
    assert.equal(report.craterRecovery.ready, true);
    assert.equal(
      report.craterRecovery.hash,
      craterBefore,
      'History-free reconstruction has exact same terrain RGBA',
    );
    assert.equal(report.craterRecovery.overlays, 1);
    report.checks.push(
      'Real bazooka impact exposes brown earth instead of new grass; a fresh Renderer reproduces the exact damaged terrain without event history',
    );

    report.girder = await page.evaluate(async () => {
      makeGame();
      const owner = game._active();
      Object.assign(owner, { x: 780, y: 440, vx: 0, vy: 0 });
      const fired = game.action(game.turn.playerId, {
        type: 'fire',
        weapon: 'girder',
        x: 900,
        y: 450,
        angle: 0,
        power: 0.5,
      });
      publish(true);
      const g = game.girders[0];
      if (!g) return { fired };
      const count = () => {
        let n = 0;
        for (let y = g.y - g.height / 2; y < g.y + g.height / 2; y++)
          for (let x = g.x - g.width / 2; x < g.x + g.width / 2; x++) n += game.terrain.solid(x, y);
        return n;
      };
      const before = count();
      game.terrain.circle(g.x + 45, g.y, 24);
      publish(true);
      const after = count();
      window.girderSnapshot = game.snapshot(true);
      const hash = await pixelHash(renderer.terrainCanvas);
      setCamera(880, 470, 2);
      const pixels = renderer.terrainCtx.getImageData(0, 0, 1600, 900).data;
      window.girderPixels = new Uint8ClampedArray(pixels);
      const index = ((g.y - 8) * 1600 + g.x - 40) * 4;
      return {
        fired,
        before,
        after,
        alpha: alpha(),
        hash,
        probe: Array.from(pixels.slice(index, index + 4)),
        girders: game.girders.length,
      };
    });
    assert.equal(report.girder.fired.ok, true);
    assert.ok(report.girder.after > 0 && report.girder.after < report.girder.before);
    assert.equal(report.girder.alpha.mismatch, 0);
    assert.deepEqual(report.girder.probe, [194, 203, 178, 255]);
    await capture('girder-damaged');
    report.girderRecovery = await page.evaluate(() => recover(girderSnapshot));
    assert.equal(report.girderRecovery.alpha.mismatch, 0);
    report.girderRecovery.firstRead = await page.evaluate(() => {
      const pixels = renderer.terrainCtx.getImageData(0, 0, 1600, 900).data,
        g = game.girders[0];
      let channels = 0,
        outsideGirder = 0,
        alphaMismatch = 0,
        maxDelta = 0;
      for (let i = 0; i < pixels.length; i++)
        if (pixels[i] !== girderPixels[i]) {
          channels++;
          if (i % 4 === 3) alphaMismatch++;
          const x = Math.floor(i / 4) % 1600,
            y = Math.floor(i / 6400);
          if (
            x < g.x - g.width / 2 ||
            x >= g.x + g.width / 2 ||
            y < g.y - g.height / 2 ||
            y >= g.y + g.height / 2
          )
            outsideGirder++;
          maxDelta = Math.max(maxDelta, Math.abs(pixels[i] - girderPixels[i]));
        }
      const index = ((g.y - 8) * 1600 + g.x - 40) * 4;
      return {
        channels,
        outsideGirder,
        alphaMismatch,
        maxDelta,
        probe: Array.from(pixels.slice(index, index + 4)),
      };
    });
    assert.equal(report.girderRecovery.firstRead.outsideGirder, 0);
    assert.equal(report.girderRecovery.firstRead.alphaMismatch, 0);
    assert.deepEqual(report.girderRecovery.firstRead.probe, report.girder.probe);
    report.girderRecovery.readbackHashes = [report.girderRecovery.hash];
    for (let i = 0; i < 4 && !report.girderRecovery.readbackHashes.includes(report.girder.hash); i++)
      report.girderRecovery.readbackHashes.push(
        await page.evaluate(async () => {
          renderer.paintHills();
          return pixelHash(renderer.terrainCanvas);
        }),
      );
    assert.ok(
      report.girderRecovery.readbackHashes.includes(report.girder.hash),
      'Girder scene is pixel-identical after matching Canvas readback modes',
    );
    report.notes.push(
      'The inherited metal girder still uses Canvas paths: first-read GPU/CPU antialias differences are measured and must be confined to its rectangle, with exact alpha and flat metal color. Full RGBA must then match after repainting in the same readback mode. The new Hills soil itself reconstructs exactly on the first read.',
    );
    report.checks.push(
      'Real girder placement remains metallic after a controlled partial mask cut and history-free reconnection; construction adds no decorative collision',
    );

    report.parallax = await page.evaluate(() => {
      makeGame();
      setCamera(650, 490, 1.3);
      const from = structuredClone(renderer.hillsBackground.lastDraw);
      setCamera(950, 490, 1.3);
      const to = structuredClone(renderer.hillsBackground.lastDraw);
      const normalHash = pixelHash(renderer.terrainCanvas);
      renderer.setView({ quality: 'low', reducedMotion: true });
      setCamera(650, 490, 1.3);
      const reducedFrom = structuredClone(renderer.hillsBackground.lastDraw);
      setCamera(950, 490, 1.3);
      const reducedTo = structuredClone(renderer.hillsBackground.lastDraw);
      return Promise.all([normalHash, pixelHash(renderer.terrainCanvas)]).then(([normalHash, lowHash]) => ({
        from,
        to,
        reducedFrom,
        reducedTo,
        normalHash,
        lowHash,
        worldShift: -300 * 1.3,
      }));
    });
    assert.equal(
      report.parallax.normalHash,
      report.parallax.lowHash,
      'Quality/motion settings do not modify terrain',
    );
    assert.equal(report.parallax.from.imageLoaded, true, 'Generated scenic image is loaded');
    const shifts = report.parallax.to.layers.map((layer, i) => ({
      id: layer.id,
      factor: layer.factor,
      shift: layer.x - report.parallax.from.layers[i].x,
    }));
    report.parallax.shifts = shifts;
    assert.ok(new Set(shifts.map((layer) => layer.factor)).size >= 3);
    assert.ok(new Set(shifts.map((layer) => Math.round(layer.shift))).size >= 3);
    assert.ok(
      shifts.every((layer) => Math.abs(layer.shift) < Math.abs(report.parallax.worldShift)),
      'Distant layers move less than collision world',
    );
    assert.ok(
      report.parallax.reducedTo.layers.every(
        (layer) => layer.factor === report.parallax.reducedTo.layers[0].factor,
      ),
      'Reduced motion removes relative parallax',
    );
    await page.evaluate(() => {
      renderer.setView({ quality: 'high', reducedMotion: false });
      setCamera(950, 490, 1.3);
    });
    await capture('parallax-pan');
    report.checks.push(
      'Three background layers move at distinct fractions of camera pan; reduced motion removes relative parallax and low quality preserves terrain',
    );

    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => {
      renderer.resize();
      setCamera(800, 520, 0.8);
    });
    await capture('mobile');
    report.mobile = await page.evaluate(() => ({
      width: renderer.width,
      height: renderer.height,
      alpha: alpha(),
      layers: renderer.hillsBackground.lastDraw.layers,
      overlays: document.querySelectorAll('.pixi-field').length,
    }));
    assert.equal(report.mobile.width, 844);
    assert.equal(report.mobile.height, 390);
    assert.equal(report.mobile.alpha.mismatch, 0);
    assert.equal(report.mobile.overlays, 1);
    report.backgroundCoverage = await page.evaluate(() => {
      const results = [];
      for (const [x, y, zoom] of [
        [0, 0, 0.45],
        [1600, 900, 0.45],
        [0, 900, 2.8],
        [1600, 0, 2.8],
      ]) {
        setCamera(x, y, zoom);
        results.push({
          x,
          y,
          zoom,
          layers: renderer.hillsBackground.lastDraw.layers.map((layer) => ({
            id: layer.id,
            coversViewport:
              layer.x <= 0.01 &&
              layer.y <= 0.01 &&
              layer.x + layer.width >= renderer.width - 0.01 &&
              layer.y + layer.height >= renderer.height - 0.01,
          })),
        });
      }
      return results;
    });
    assert.ok(
      report.backgroundCoverage.every((scene) => scene.layers.every((layer) => layer.coversViewport)),
      'Background surfaces cover the viewport at camera/zoom extremes',
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    report.performance = await page.evaluate(async () => {
      renderer.resize();
      makeGame();
      stopFrames();
      setCamera(800, 510, 0.8);
      const rebuild = [];
      for (let i = 0; i < 12; i++) {
        game.terrain.circle(300 + i * 80, 700 + (i % 2) * 15, 15);
        const start = performance.now();
        publish(true);
        rebuild.push(performance.now() - start);
      }
      const originalBuild = renderer.buildTerrain;
      let calls = 0;
      renderer.buildTerrain = function (...args) {
        calls++;
        return originalBuild.apply(this, args);
      };
      for (let i = 0; i < 120; i++) publish(false);
      renderer.buildTerrain = originalBuild;
      const intervals = [],
        cpu = [];
      let previous = performance.now();
      await new Promise((resolve) => {
        const frame = (now) => {
          intervals.push(now - previous);
          previous = now;
          const start = performance.now();
          renderer.draw(now);
          cpu.push(performance.now() - start);
          if (intervals.length < 121) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      intervals.shift();
      const summarize = (values) => {
        values.sort((a, b) => a - b);
        return {
          samples: values.length,
          medianMs: values[Math.floor(values.length * 0.5)],
          p95Ms: values[Math.floor(values.length * 0.95)],
        };
      };
      return {
        rebuild: summarize(rebuild),
        cadence: summarize(intervals),
        drawCpu: summarize(cpu),
        snapshotOnlyRebuilds: calls,
      };
    });
    assert.equal(report.performance.snapshotOnlyRebuilds, 0);
    report.checks.push(
      'Terrain rebuilds occur only when the mask changes; twelve crater rebuilds and 120 frame cadence/CPU samples recorded',
    );

    const normalAssets = report.requests.filter((request) => /\/art\//.test(request.path));
    assert.ok(new Set(normalAssets.map((request) => request.path)).size >= 2);
    assert.ok(normalAssets.every((request) => request.status === 200));
    const fallback = await browser.newPage({ viewport: { width: 844, height: 390 } });
    const fallbackErrors = [];
    fallback.on('pageerror', (error) => fallbackErrors.push(error.message));
    await fallback.route('**/art/hills-*', (route) => route.abort('failed'));
    await fallback.goto(url);
    await fallback.waitForFunction(() => window.initialized);
    report.fallback = await fallback.evaluate(async () => {
      const ready = await renderer.ready;
      stopFrames();
      render();
      return {
        ready,
        alpha: alpha(),
        overlays: document.querySelectorAll('.pixi-field').length,
        lastDraw: renderer.hillsBackground.lastDraw,
      };
    });
    assert.equal(report.fallback.ready, true);
    assert.equal(report.fallback.alpha.mismatch, 0);
    assert.equal(report.fallback.overlays, 1);
    assert.equal(report.fallback.lastDraw.imageLoaded, false);
    assert.deepEqual(fallbackErrors, []);
    await fallback.screenshot({
      path: fileURLToPath(new URL(`terrain-${browserName}-fallback.png`, evidence)),
    });
    await fallback.close();
    const delayed = await browser.newPage();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await delayed.route('**/art/hills-*', async (route) => {
      await gate;
      await route.continue();
    });
    await delayed.goto(url, { waitUntil: 'domcontentloaded' });
    await delayed.waitForFunction(() => window.initialized);
    await delayed.evaluate(() => renderer.destroy());
    release();
    report.lifecycle = await delayed.evaluate(async () => ({
      ready: await renderer.ready,
      destroyed: renderer.destroyed,
      overlays: document.querySelectorAll('.pixi-field').length,
      terrainWidth: renderer.terrainCanvas.width,
    }));
    assert.equal(report.lifecycle.ready, false);
    assert.equal(report.lifecycle.overlays, 0);
    assert.equal(report.lifecycle.terrainWidth, 0);
    await delayed.close();
    report.checks.push(
      'Both local raster assets load successfully; missing assets preserve playable exact-mask fallback; destruction during asset loading leaves no overlay or terrain surface',
    );
    for (const [path, hash] of Object.entries(report.sourceSHA256))
      assert.equal(
        createHash('sha256')
          .update(await readFile(new URL('../' + path, import.meta.url)))
          .digest('hex'),
        hash,
        `${path} did not change during verification`,
      );
    report.passed = true;
  }
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  if (!baselineOnly)
    await writeFile(new URL(`terrain-${browserName}.json`, evidence), JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        browser: report.browser,
        version: report.version,
        checks: report.checks,
        failure: report.failure,
        errors: report.errors,
      },
      null,
      2,
    ),
  );
  await browser?.close();
  await vite?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
