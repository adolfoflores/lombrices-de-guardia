/* Browser fixture globals supplied explicitly by the inline harness. */
/* global alpha, firstArt, game, girderPixels, makeGame, pixelHash, publish, recover, render, renderer, retiredBackground, retiredPainter, savedSnapshot, setCamera, snapHashes, stopFrames */
// Cavern/islands presentation: real authoritative snapshots and local browser art.
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
    'Isolated real Renderer/Game with two players and three worms each; room integration is tested separately.',
    'Desktop browser measurements do not establish physical phone GPU or thermal performance.',
  ],
};
const source = `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Biomas: presentación</title>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#203542}#stage{position:relative;width:100%;height:100%}#field{display:block;position:absolute;inset:0;width:100%;height:100%}.pixi-field{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}</style><div id="stage"><canvas id="field"></canvas></div><script type="module">
import {Renderer} from '/client/renderer.js';import{Game}from'/shared/engine.js';import{Terrain}from'/shared/terrain.js';
window.Renderer=Renderer;window.Terrain=Terrain;window.initialMap=new URL(location.href).searchParams.get('map')||'hills';window.renderer=new Renderer(document.querySelector('#field'),{mapId:initialMap});
window.makeGame=async(mapId='hills',wait=true)=>{window.game=new Game([{id:'p0',name:'Anchoa',team:0,color:'#f8b84e'},{id:'p1',name:'Menta',team:1,color:'#68d7c4'}],{mapId,mode:'ffa',worms:3},{seed:42});renderer.state=null;renderer.setState(game.snapshot(true));renderer.setView({playerId:game.turn.playerId,weapon:'bazooka',angle:.8,power:.15,quality:'high',reducedMotion:false});renderer.overview();if(wait)await renderer.artReady;return game.snapshot(false);};
window.publish=(terrain=false)=>renderer.setState(game.snapshot(terrain));window.stopFrames=()=>{cancelAnimationFrame(renderer.raf);renderer.raf=null;};window.render=(offset=0)=>renderer.draw(performance.now()+offset);window.setCamera=(x,y,zoom)=>{renderer.fullView=false;renderer.autoFollow=false;renderer.camera={x,y,zoom};renderer.cameraGoal={...renderer.camera};render(100);};
window.alpha=()=>{const pixels=renderer.terrainCtx.getImageData(0,0,1600,900).data;let mismatch=0,solid=0;for(let i=0;i<game.terrain.data.length;i++){solid+=game.terrain.data[i];if(pixels[i*4+3]!==game.terrain.data[i]*255)mismatch++;}return {mismatch,solid};};
window.pixelHash=async canvas=>{const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))].map(x=>x.toString(16).padStart(2,'0')).join('');};
window.backgroundHash=async()=>{const surface=document.createElement('canvas');surface.width=1600;surface.height=900;const ctx=surface.getContext('2d',{willReadFrequently:true});const scene=game.mapId==='hills'?renderer.hillsBackground:renderer.biomeBackground;if(scene)scene.draw(ctx,{width:1600,height:900,camera:{x:800,y:450,zoom:1},time:0,quality:'high',reducedMotion:true});else ctx.drawImage(renderer.background,0,0);return pixelHash(surface);};
window.snapHashes=async()=>({terrain:await pixelHash(renderer.terrainCanvas),background:await backgroundHash()});
window.recover=async snapshot=>{renderer.destroy();renderer=new Renderer(document.querySelector('#field'),{mapId:snapshot.mapId});renderer.setState({...snapshot,events:[]});const ready=await renderer.ready;await renderer.artReady;renderer.setView({playerId:snapshot.turn.playerId,weapon:'bazooka'});stopFrames();render(100);return{ready,hash:await pixelHash(renderer.terrainCanvas),alpha:alpha(),overlays:document.querySelectorAll('.pixi-field').length};};
window.bootstrapped=true;window.gameReady=makeGame(initialMap).then(()=>{window.initialized=true;});
</script></html>`;
let browser, vite, server;
try {
  server = http.createServer(async (req, res) => {
    if (new URL(req.url, 'http://local').pathname === '/') {
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
    if (new URL(response.url()).pathname.startsWith('/art/'))
      report.requests.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  await page.goto(url);
  await page.waitForFunction(() => window.initialized);
  assert.equal(await page.evaluate(() => renderer.ready), true);
  await page.evaluate(() => {
    stopFrames();
    render();
  });
  const capture = async (name) => {
    // A resize changes both the Canvas backing store and the GPU compositor.
    // Give each of two display frames a real draw before recording the surface.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame((now) => {
            renderer.draw(now);
            requestAnimationFrame((next) => {
              renderer.draw(next);
              resolve();
            });
          }),
        ),
    );
    return page.screenshot({
      path: fileURLToPath(new URL('biomes-' + browserName + '-' + name + '.png', evidence)),
    });
  };
  if (baselineOnly) {
    report.sourceSHA256 = {};
    for (const path of [
      'client/renderer.js',
      'client/hills-terrain.js',
      'client/hills-background.js',
      'shared/terrain.js',
      'shared/engine.js',
    ])
      report.sourceSHA256[path] = createHash('sha256')
        .update(await readFile(new URL('../' + path, import.meta.url)))
        .digest('hex');
    report.maps = {};
    for (const map of ['hills', 'cavern', 'islands']) {
      report.maps[map] = await page.evaluate(async (map) => {
        await makeGame(map);
        setCamera(800, 450, 0.8);
        return { ...(await snapHashes()), alpha: alpha() };
      }, map);
      await capture(map + '-before');
    }
    report.passed = true;
    await writeFile(
      new URL('../tests/fixtures/visual/biomes-' + browserName + '-baseline.json', import.meta.url),
      JSON.stringify(report, null, 2) + '\n',
    );
  } else {
    report.sourceSHA256 = {};
    for (const path of [
      'client/renderer.js',
      'client/biome-assets.js',
      'client/biome-terrain.js',
      'client/biome-background.js',
      'client/hills-assets.js',
      'client/hills-terrain.js',
      'client/hills-background.js',
      'shared/terrain.js',
      'shared/engine.js',
      'public/art/hills-earth.webp',
      'public/art/hills-backdrop.webp',
      'public/art/cavern-rock.webp',
      'public/art/cavern-backdrop.webp',
      'public/art/islands-earth.webp',
      'public/art/islands-backdrop.webp',
    ])
      report.sourceSHA256[path] = createHash('sha256')
        .update(await readFile(new URL('../' + path, import.meta.url)))
        .digest('hex');
    const baseline = JSON.parse(
      await readFile(
        new URL('../tests/fixtures/visual/biomes-' + browserName + '-baseline.json', import.meta.url),
        'utf8',
      ),
    );
    report.hills = await page.evaluate(async () => {
      await makeGame('hills');
      render();
      return { ...(await snapHashes()), alpha: alpha() };
    });
    assert.deepEqual(
      { terrain: report.hills.terrain, background: report.hills.background },
      { terrain: baseline.maps.hills.terrain, background: baseline.maps.hills.background },
      'Hills terrain and isolated painted backdrop stay unchanged',
    );
    assert.equal(report.hills.alpha.mismatch, 0);
    report.checks.push(
      'Completed Hills terrain and painted backdrop remain pixel-identical to the pre-expansion baseline',
    );
    report.maps = [];
    for (const map of ['cavern', 'islands']) {
      const scene = { map };
      scene.initial = await page.evaluate(async (map) => {
        await makeGame(map);
        stopFrames();
        setCamera(800, 450, 0.8);
        return {
          ...(await snapHashes()),
          alpha: alpha(),
          painter: renderer.biomeTerrain.mapId,
          backdrop: renderer.biomeBackground.lastDraw.mapId,
          imageLoaded: renderer.biomeBackground.lastDraw.imageLoaded,
          textureLoaded: !!renderer.biomeTerrain.texture,
        };
      }, map);
      assert.equal(scene.initial.alpha.mismatch, 0);
      assert.equal(scene.initial.painter, map);
      assert.equal(scene.initial.backdrop, map);
      assert.equal(scene.initial.imageLoaded, true);
      assert.equal(scene.initial.textureLoaded, true);
      assert.notEqual(scene.initial.terrain, baseline.maps[map].terrain);
      assert.notEqual(scene.initial.background, baseline.maps[map].background);
      await capture(map + '-after');
      await page.evaluate(() => setCamera(420, 590, 1.6));
      await capture(map + '-close');
      scene.impact = await page.evaluate(() => {
        const before = game.terrain.revision,
          fired = game.action(game.turn.playerId, {
            type: 'fire',
            weapon: 'bazooka',
            angle: 0.8,
            power: 0.15,
          });
        let ticks = 0;
        while (ticks++ < 300 && !game.events.some((e) => e.type === 'explosion')) game.step();
        publish(true);
        render(5000);
        renderer.shake = 0;
        const event = game.events.find((e) => e.type === 'explosion');
        setCamera(event?.x || 180, event?.y || 600, 2);
        return {
          fired,
          ticks,
          event,
          revisionBefore: before,
          revisionAfter: game.terrain.revision,
          alpha: alpha(),
        };
      });
      assert.equal(scene.impact.fired.ok, true);
      assert.ok(scene.impact.event);
      assert.ok(scene.impact.revisionAfter > scene.impact.revisionBefore);
      assert.equal(scene.impact.alpha.mismatch, 0);
      await capture(map + '-crater');
      scene.crater = await page.evaluate(async () => {
        const painter = renderer.biomeTerrain,
          data = game.terrain.data,
          pixels = renderer.terrainCtx.getImageData(0, 0, 1600, 900).data;
        let removed = 0,
          newEdges = 0,
          materialEdges = 0;
        const samples = [];
        for (let i = 1601; i < data.length - 1601; i++) {
          if (painter.original[i] && !data[i]) removed++;
          if (
            !data[i] ||
            painter.surfaceDepth[i] !== 255 ||
            ![i - 1, i + 1, i - 1600, i + 1600].some((n) => painter.original[n] && !data[n])
          )
            continue;
          newEdges++;
          const p = i * 4;
          const rightMaterial =
            game.mapId === 'cavern'
              ? pixels[p + 2] >= pixels[p + 1] && pixels[p + 1] >= pixels[p]
              : pixels[p] > pixels[p + 1] && pixels[p + 1] > pixels[p + 2];
          if (rightMaterial) materialEdges++;
          if (samples.length < 6)
            samples.push({
              x: i % 1600,
              y: Math.floor(i / 1600),
              depth: painter.surfaceDepth[i],
              rgba: Array.from(pixels.slice(p, p + 4)),
            });
        }
        window.savedSnapshot = game.snapshot(true);
        return { removed, newEdges, materialEdges, samples, hash: await pixelHash(renderer.terrainCanvas) };
      });
      assert.ok(scene.crater.removed > 1000);
      assert.ok(scene.crater.newEdges > 30);
      assert.ok(
        scene.crater.materialEdges / scene.crater.newEdges > 0.9,
        'Fresh crater exposes the biome material, not a new natural cap',
      );
      scene.recovery = await page.evaluate(() => recover(savedSnapshot));
      assert.equal(scene.recovery.ready, true);
      assert.equal(
        scene.recovery.hash,
        scene.crater.hash,
        'Crater material is history-independent and pixel-exact after reconnection',
      );
      assert.equal(scene.recovery.alpha.mismatch, 0);
      assert.equal(scene.recovery.overlays, 1);

      scene.girder = await page.evaluate(async (map) => {
        await makeGame(map);
        Object.assign(game._active(), { x: 780, y: 260, vx: 0, vy: 0 });
        const fired = game.action(game.turn.playerId, {
          type: 'fire',
          weapon: 'girder',
          x: 900,
          y: 250,
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
        window.savedSnapshot = game.snapshot(true);
        const hash = await pixelHash(renderer.terrainCanvas);
        const pixels = renderer.terrainCtx.getImageData(0, 0, 1600, 900).data;
        window.girderPixels = new Uint8ClampedArray(pixels);
        const index = ((g.y - 8) * 1600 + g.x - 40) * 4;
        setCamera(880, 290, 2);
        return {
          fired,
          before,
          after,
          hash,
          probe: Array.from(pixels.slice(index, index + 4)),
          alpha: alpha(),
        };
      }, map);
      assert.equal(scene.girder.fired.ok, true);
      assert.ok(scene.girder.after > 0 && scene.girder.after < scene.girder.before);
      assert.equal(scene.girder.alpha.mismatch, 0);
      assert.deepEqual(scene.girder.probe, [194, 203, 178, 255]);
      await capture(map + '-girder');
      scene.girderRecovery = await page.evaluate(() => recover(savedSnapshot));
      assert.equal(scene.girderRecovery.alpha.mismatch, 0);
      scene.girderRecovery.firstRead = await page.evaluate(() => {
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
      assert.equal(scene.girderRecovery.firstRead.outsideGirder, 0);
      assert.equal(scene.girderRecovery.firstRead.alphaMismatch, 0);
      assert.deepEqual(scene.girderRecovery.firstRead.probe, scene.girder.probe);
      scene.girderRecovery.readbackHashes = [scene.girderRecovery.hash];
      for (let i = 0; i < 4 && !scene.girderRecovery.readbackHashes.includes(scene.girder.hash); i++)
        scene.girderRecovery.readbackHashes.push(
          await page.evaluate(async () => {
            renderer.buildTerrain(renderer.state.terrain, game.mapId);
            return pixelHash(renderer.terrainCanvas);
          }),
        );
      assert.ok(
        scene.girderRecovery.readbackHashes.includes(scene.girder.hash),
        'Metal scene matches after aligning Canvas readback mode',
      );

      scene.parallax = await page.evaluate(async (map) => {
        await makeGame(map);
        setCamera(650, 490, 1.3);
        const from = structuredClone(renderer.biomeBackground.lastDraw);
        setCamera(950, 490, 1.3);
        const to = structuredClone(renderer.biomeBackground.lastDraw),
          normalHash = await pixelHash(renderer.terrainCanvas);
        renderer.setView({ quality: 'low', reducedMotion: true });
        setCamera(650, 490, 1.3);
        const reducedFrom = structuredClone(renderer.biomeBackground.lastDraw);
        setCamera(950, 490, 1.3);
        return {
          from,
          to,
          reducedFrom,
          reducedTo: structuredClone(renderer.biomeBackground.lastDraw),
          normalHash,
          lowHash: await pixelHash(renderer.terrainCanvas),
          worldShift: -390,
        };
      }, map);
      assert.equal(scene.parallax.normalHash, scene.parallax.lowHash);
      scene.parallax.shifts = scene.parallax.to.layers.map((layer, i) => ({
        id: layer.id,
        factor: layer.factor,
        shift: layer.x - scene.parallax.from.layers[i].x,
      }));
      assert.equal(new Set(scene.parallax.shifts.map((layer) => layer.factor)).size, 3);
      assert.equal(new Set(scene.parallax.shifts.map((layer) => Math.round(layer.shift))).size, 3);
      assert.ok(scene.parallax.shifts.every((layer) => Math.abs(layer.shift) < 390));
      assert.ok(
        scene.parallax.reducedTo.layers.every(
          (layer) => layer.factor === scene.parallax.reducedTo.layers[0].factor,
        ),
      );
      await page.evaluate(() => {
        renderer.setView({ quality: 'high', reducedMotion: false });
        setCamera(950, 490, 1.3);
      });
      await capture(map + '-parallax');
      await page.setViewportSize({ width: 844, height: 390 });
      await page.evaluate(() => {
        renderer.resize();
        setCamera(800, 500, 0.8);
      });
      await capture(map + '-mobile');
      scene.mobile = await page.evaluate(() => {
        renderer.draw(performance.now());
        const overlay = document.querySelector('.pixi-field');
        return {
          width: renderer.width,
          height: renderer.height,
          alpha: alpha(),
          overlays: document.querySelectorAll('.pixi-field').length,
          baseCanvas: {
            width: renderer.canvas.width,
            height: renderer.canvas.height,
            rect: renderer.canvas.getBoundingClientRect().toJSON(),
          },
          overlayCanvas: {
            width: overlay.width,
            height: overlay.height,
            rect: overlay.getBoundingClientRect().toJSON(),
          },
          basePng: renderer.canvas.toDataURL('image/png'),
          overlayPng: overlay.toDataURL('image/png'),
        };
      });
      assert.equal(scene.mobile.width, 844);
      assert.equal(scene.mobile.height, 390);
      assert.equal(scene.mobile.alpha.mismatch, 0);
      assert.equal(scene.mobile.overlays, 1);
      assert.equal(scene.mobile.baseCanvas.width, 844);
      assert.equal(scene.mobile.baseCanvas.height, 390);
      assert.equal(scene.mobile.overlayCanvas.width, 844);
      assert.equal(scene.mobile.overlayCanvas.height, 390);
      assert.deepEqual(scene.mobile.baseCanvas.rect, scene.mobile.overlayCanvas.rect);
      for (const key of ['basePng', 'overlayPng']) {
        await writeFile(
          new URL(
            'biomes-' +
              browserName +
              '-' +
              map +
              '-mobile-' +
              (key === 'basePng' ? 'base' : 'overlay') +
              '.png',
            evidence,
          ),
          Buffer.from(scene.mobile[key].split(',')[1], 'base64'),
        );
        delete scene.mobile[key];
      }
      scene.coverage = await page.evaluate(() => {
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
            layers: renderer.biomeBackground.lastDraw.layers.map((layer) => ({
              id: layer.id,
              covers:
                layer.x <= 0.01 &&
                layer.y <= 0.01 &&
                layer.x + layer.width >= renderer.width - 0.01 &&
                layer.y + layer.height >= renderer.height - 0.01,
            })),
          });
        }
        return results;
      });
      assert.ok(scene.coverage.every((item) => item.layers.every((layer) => layer.covers)));
      await page.setViewportSize({ width: 1280, height: 720 });
      scene.performance = await page.evaluate(async (map) => {
        renderer.resize();
        await makeGame(map);
        stopFrames();
        setCamera(800, 450, 0.8);
        const rebuild = [];
        for (const x of [90, 190, 430, 530, 730, 830, 1070, 1170, 1390, 1490, 240, 870]) {
          game.terrain.circle(x, 830, 15);
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
        const stats = (values) => {
          values.sort((a, b) => a - b);
          return {
            samples: values.length,
            medianMs: values[Math.floor(values.length * 0.5)],
            p95Ms: values[Math.floor(values.length * 0.95)],
          };
        };
        return {
          actors: renderer.state.worms.length,
          rebuild: stats(rebuild),
          cadence: stats(intervals),
          drawCpu: stats(cpu),
          snapshotOnlyRebuilds: calls,
        };
      }, map);
      assert.equal(scene.performance.actors, 6);
      assert.equal(scene.performance.snapshotOnlyRebuilds, 0);
      report.maps.push(scene);
    }
    assert.notEqual(report.maps[0].initial.terrain, report.maps[1].initial.terrain);
    report.checks.push(
      'Both biomes load their own texture/scenery, retain exact mask alpha, expose appropriate crater material and reproduce it exactly without history',
    );
    report.checks.push(
      'Both biomes preserve metal construction through a partial cut/reconnect, parallax/reduced motion, camera extremes, desktop/mobile and 120-frame performance profiles',
    );
    report.notes.push(
      'The inherited metal girder uses Canvas paths. GPU/CPU antialias differences must stay within its rectangle; alpha and flat metal color remain exact and a matched readback mode must reproduce the whole image hash. New rock/earth itself is exact on the first read.',
    );

    const assets = report.requests.filter((request) => /cavern|islands/.test(request.path));
    assert.equal(new Set(assets.map((request) => request.path)).size, 4);
    assert.ok(assets.every((request) => request.status === 200));
    report.fallback = [];
    report.lifecycle = [];
    for (const map of ['cavern', 'islands']) {
      const fallback = await browser.newPage({ viewport: { width: 844, height: 390 } }),
        errors = [];
      fallback.on('pageerror', (error) => errors.push(error.message));
      await fallback.route('**/art/' + map + '-*', (route) => route.abort('failed'));
      await fallback.goto(url + '?map=' + map);
      await fallback.waitForFunction(() => window.initialized);
      const result = await fallback.evaluate(async () => {
        const ready = await renderer.ready;
        await renderer.artReady;
        stopFrames();
        render();
        return {
          map: game.mapId,
          ready,
          alpha: alpha(),
          imageLoaded: renderer.biomeBackground.lastDraw.imageLoaded,
          textureLoaded: !!renderer.biomeTerrain.texture,
          overlays: document.querySelectorAll('.pixi-field').length,
        };
      });
      assert.equal(result.ready, true);
      assert.equal(result.alpha.mismatch, 0);
      assert.equal(result.imageLoaded, false);
      assert.equal(result.textureLoaded, false);
      assert.equal(result.overlays, 1);
      assert.deepEqual(errors, []);
      await fallback.screenshot({
        path: fileURLToPath(new URL('biomes-' + browserName + '-' + map + '-fallback.png', evidence)),
      });
      await fallback.close();
      report.fallback.push(result);
      const delayed = await browser.newPage();
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      await delayed.route('**/art/' + map + '-*', async (route) => {
        await gate;
        await route.continue();
      });
      await delayed.goto(url + '?map=' + map, { waitUntil: 'domcontentloaded' });
      await delayed.waitForFunction(() => window.bootstrapped);
      await delayed.evaluate(() => renderer.destroy());
      release();
      const lifecycle = await delayed.evaluate(async () => {
        const ready = await renderer.ready;
        await renderer.artReady;
        return {
          ready,
          destroyed: renderer.destroyed,
          overlays: document.querySelectorAll('.pixi-field').length,
          terrainWidth: renderer.terrainCanvas.width,
        };
      });
      assert.equal(lifecycle.ready, false);
      assert.equal(lifecycle.overlays, 0);
      assert.equal(lifecycle.terrainWidth, 0);
      await delayed.close();
      report.lifecycle.push({ map, ...lifecycle });
    }
    const switching = await browser.newPage();
    let releaseCavern;
    const cavernGate = new Promise((resolve) => {
      releaseCavern = resolve;
    });
    const switchErrors = [];
    switching.on('pageerror', (error) => switchErrors.push(error.message));
    await switching.route('**/art/cavern-*', async (route) => {
      await cavernGate;
      await route.continue();
    });
    await switching.goto(url + '?map=cavern', { waitUntil: 'domcontentloaded' });
    await switching.waitForFunction(() => window.bootstrapped);
    report.switching = await switching.evaluate(async () => {
      window.firstArt = renderer.artReady;
      window.retiredPainter = renderer.biomeTerrain;
      window.retiredBackground = renderer.biomeBackground;
      await makeGame('islands');
      await renderer.ready;
      stopFrames();
      render();
      return {
        stateMap: renderer.state.mapId,
        biomeMapId: renderer.biomeMapId,
        texture: renderer.biomeTerrain.texture?.src,
        backdrop: renderer.biomeBackground.lastDraw.mapId,
        hash: await pixelHash(renderer.terrainCanvas),
      };
    });
    assert.equal(report.switching.stateMap, 'islands');
    assert.equal(report.switching.biomeMapId, 'islands');
    assert.match(report.switching.texture, /islands-earth/);
    assert.equal(report.switching.backdrop, 'islands');
    releaseCavern();
    report.switching.afterLate = await switching.evaluate(async () => {
      await firstArt;
      render();
      return {
        stateMap: renderer.state.mapId,
        biomeMapId: renderer.biomeMapId,
        texture: renderer.biomeTerrain.texture?.src,
        backdrop: renderer.biomeBackground.lastDraw.mapId,
        hash: await pixelHash(renderer.terrainCanvas),
        retiredSame: retiredPainter === renderer.biomeTerrain,
        retiredLayers: retiredBackground?.layers.length,
      };
    });
    assert.equal(report.switching.afterLate.hash, report.switching.hash);
    assert.equal(report.switching.afterLate.stateMap, 'islands');
    assert.equal(report.switching.afterLate.biomeMapId, 'islands');
    assert.equal(report.switching.afterLate.retiredSame, false);
    assert.equal(report.switching.afterLate.retiredLayers, 0);
    assert.deepEqual(switchErrors, []);
    await switching.close();
    report.checks.push(
      'Four local biome images load successfully; each biome survives missing images and destruction during loading; late cavern images cannot overwrite an already active islands map',
    );
    for (const [path, hash] of Object.entries(report.sourceSHA256))
      assert.equal(
        createHash('sha256')
          .update(await readFile(new URL('../' + path, import.meta.url)))
          .digest('hex'),
        hash,
        path + ' did not change during verification',
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
    await writeFile(
      new URL('biomes-' + browserName + '.json', evidence),
      JSON.stringify(report, null, 2) + '\n',
    );
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
