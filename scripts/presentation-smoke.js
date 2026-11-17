/* Browser fixture globals supplied explicitly by the inline harness. */
/* global Game, audio, lastTarget, loadMap, renderer, state, terrain */
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const evidence = new URL('../docs/evidence/', import.meta.url);
await mkdir(evidence, { recursive: true });
const screenshot = (name) => fileURLToPath(new URL(name, evidence));
const pageSource = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#223747}canvas{width:100%;height:100%;display:block}button{position:absolute;top:12px;left:12px;z-index:2}</style><canvas></canvas><button>Audio</button><script type="module">
import { Renderer } from '/client/renderer.js';import { AudioEngine } from '/client/audio.js';import { Terrain } from '/shared/terrain.js';import { Game } from '/shared/engine.js';window.Game=Game;
window.renderer = new Renderer(document.querySelector('canvas'),{onTarget:(x,y)=>window.lastTarget={x,y}});window.audio = new AudioEngine();document.querySelector('button').onclick=()=>audio.unlock();
window.loadMap=(mapId)=>{window.terrain=new Terrain(mapId); const colors=['#f0ca65','#ed927e','#94c0aa','#7bb0cf','#c1a1d3','#ccd17d'];const players=colors.map((color,i)=>({id:'p'+i,name:['Anchoa','Canelo','Menta','Pepino','Chispa','Trufa'][i],team:i%3,color,ammo:{}}));const worms=[];for(let i=0;i<24;i++){let x=50+i*65,y=250;while(y<800&&!terrain.solid(x,y+10))y++; worms.push({id:'w'+i,playerId:'p'+i%6,name:'Gusano',team:i%3,color:colors[i%6],x,y,vx:0,vy:0,hp:100,facing:i%2?1:-1,grounded:true});}window.state={phase:'playing',mapId,mode:'2v2v2',elapsed:0,waterY:820,wind:24,terrainRevision:terrain.revision,terrain:terrain.encode(),worms,players,projectiles:[],mines:[{id:'m1',x:780,y:352,armed:true}],turn:{playerId:'p0',wormId:'w6',number:1,remaining:25,stage:'action'},events:[]};renderer.setState(state);renderer.setView({playerId:'p0',angle:-.65,weapon:'bazooka'});renderer.overview();};loadMap('hills');window.ready=true;
</script>`;
const vite = await createViteServer({ root, server: { middlewareMode: true }, appType: 'custom' });
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml('/', pageSource));
    } else vite.middlewares(req, res);
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch(
    process.env.CHROMIUM_PATH
      ? { headless: true, executablePath: process.env.CHROMIUM_PATH }
      : { headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' },
  );
  const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => window.ready);
  assert.equal(await page.evaluate(() => renderer.ready), true, 'Pixi presentation initializes');
  const output = {
    browser: await browser.version(),
    platform: process.platform,
    physicalDevice: false,
    startedAt: new Date().toISOString(),
    maps: [],
    notes: [
      'Synthetic renderer workload: 24 worms, six player identities; networking and real devices are tested separately.',
      'Draw CPU timings exclude GPU work; frame cadence is measured separately.',
      'Heap measurements exclude canvas/GPU/audio native allocation.',
    ],
  };
  for (const map of ['hills', 'cavern', 'islands']) {
    await page.evaluate((id) => loadMap(id), map);
    await page.waitForTimeout(900);
    await page.screenshot({ path: screenshot('presentation-' + map + '.png') });
    const result = await page.evaluate(() => {
      terrain.circle(760, 500, 90);
      terrain.girder(900, 480);
      const start = performance.now();
      renderer.setState({
        ...state,
        elapsed: 1,
        terrain: terrain.encode(),
        terrainRevision: terrain.revision,
      });
      const rebuild = performance.now() - start;
      const pixels = renderer.terrainCtx.getImageData(0, 0, 1600, 900).data;
      let mismatch = 0;
      for (let i = 0; i < terrain.data.length; i++)
        if (Boolean(pixels[i * 4 + 3]) !== Boolean(terrain.data[i])) mismatch++;
      const samples = [];
      for (let i = 0; i < 60; i++) {
        const now = performance.now();
        renderer.draw(now);
        samples.push(performance.now() - now);
      }
      samples.sort((a, b) => a - b);
      return {
        mismatch,
        rebuildMs: rebuild,
        renderP95: samples[57],
        renderMean: samples.reduce((a, b) => a + b, 0) / samples.length,
      };
    });
    assert.equal(
      result.mismatch,
      0,
      map + ' terrain alpha must match collision data at every pixel after crater and girder',
    );
    const targets = await page.evaluate((id) => {
      const game = new Game(state.players, { mapId: id, mode: '2v2v2', worms: 4 }, { seed: 5 });
      renderer.setState(game.snapshot(true));
      const worm = game.worms.find((w) => w.id === game.turn.wormId);
      let checked = 0,
        mismatches = 0;
      const problems = [];
      for (const weapon of ['teleport', 'girder']) {
        renderer.setView({ weapon, targeting: true });
        for (let x = 40; x < 1600; x += 75)
          for (let y = 300; y < 810; y += 80) {
            const expected =
              weapon === 'teleport' ? !!game._teleportDestination(x, y, worm) : game._validGirder(x, y, worm);
            if (renderer.targetIsPossible(x, y) !== expected) {
              mismatches++;
              problems.push({ weapon, x, y, expected, actual: renderer.targetPreview(x, y), worm });
            }
            checked++;
          }
      }
      return { checked, mismatches, problems };
    }, map);
    if (targets.mismatches) console.log(JSON.stringify(targets, null, 2));
    assert.equal(targets.mismatches, 0, map + ' target preview matches server validation');
    output.maps.push({ map, ...result, targetValidation: targets });
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    loadMap('hills');
    renderer.focus();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: screenshot('presentation-mobile.png') });
  await page.evaluate(() => {
    renderer.setView({ targeting: true, weapon: 'girder', target: { x: 520, y: 420 } });
  });
  await page.mouse.click(650, 170);
  output.target = await page.evaluate(() => lastTarget);
  await page.mouse.move(400, 180);
  await page.mouse.down();
  await page.mouse.move(300, 220, { steps: 4 });
  await page.mouse.up();
  output.pan = await page.evaluate(() => ({ following: renderer.autoFollow, target: lastTarget }));
  assert.equal(output.pan.following, false);
  assert.deepEqual(output.pan.target, output.target);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const heapBefore = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  output.stress = await page.evaluate(async () => {
    const base = state.worms.map((w) => ({ ...w }));
    for (let i = 0; i < 150; i++)
      terrain.circle(30 + ((i * 97) % 1540), 400 + ((i * 71) % 410), 8 + (i % 15));
    renderer.setState({ ...state, elapsed: 1, terrain: terrain.encode(), terrainRevision: terrain.revision });
    const starts = performance.now();
    for (let i = 0; i < 1200; i++) {
      const { terrain: encoded, ...withoutTerrain } = state;
      const worms = base.map((w, n) => ({ ...w, x: w.x + Math.sin(i / 20 + n) * 5 }));
      renderer.setState({ ...withoutTerrain, elapsed: i / 15 + 1, worms });
      if (i % 10 === 0) {
        renderer.addEffect(
          { type: 'explosion', id: 'stress' + i, x: 400 + (i % 500), y: 430, radius: 55 },
          performance.now(),
        );
      }
      renderer.draw(performance.now());
    }
    const snapshotWorkMs = performance.now() - starts;
    const samples = [];
    let previous = performance.now();
    await new Promise((resolve) => {
      const step = (now) => {
        if (samples.length % 18 === 0) {
          renderer.addEffect(
            {
              type: 'explosion',
              id: 'frames' + samples.length,
              x: 400 + samples.length * 2,
              y: 480,
              radius: 65,
            },
            now,
          );
        }
        samples.push(now - previous);
        previous = now;
        if (samples.length < 180) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    samples.shift();
    samples.sort((a, b) => a - b);
    return {
      snapshots: 1200,
      additionalCraters: 150,
      snapshotWorkMs,
      frameMedianMs: samples[Math.floor(samples.length / 2)],
      frameP95Ms: samples[Math.floor(samples.length * 0.95)],
      effects: renderer.effects.length,
      eventIds: renderer.eventIds.size,
    };
  });
  await cdp.send('HeapProfiler.collectGarbage');
  output.stress.heapBeforeBytes = heapBefore;
  output.stress.heapAfterBytes = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  assert.ok(output.stress.effects <= 45);
  assert.ok(output.stress.eventIds <= 192);
  await page.evaluate(() => {
    renderer.pointers.set(99, { x: 10, y: 10 });
    window.dispatchEvent(new Event('resize'));
  });
  assert.equal(await page.evaluate(() => renderer.pointers.size), 0);
  await page.locator('button').click();
  output.audio = await page.evaluate(async () => {
    const before = audio.context?.state;
    audio.setVolumes(0.2, 0.4);
    for (const weapon of [
      'bazooka',
      'grenade',
      'cluster',
      'shotgun',
      'dynamite',
      'mine',
      'bat',
      'airstrike',
      'rope',
      'jetpack',
      'teleport',
      'girder',
    ])
      audio.event({ id: weapon, type: 'fire', weapon });
    await audio.context.suspend();
    await audio.unlock();
    audio.resetEvents();
    return {
      before,
      after: audio.context.state,
      seen: audio.seen.size,
      nodes: audio.nodes.size,
      music: audio.musicVolume,
      sfx: audio.sfxVolume,
    };
  });
  await page.waitForTimeout(1300);
  output.errors = errors;
  output.remainingAudioNodes = await page.evaluate(() => audio.nodes.size);
  assert.deepEqual(errors, []);
  assert.equal(output.audio.before, 'running');
  assert.equal(output.audio.after, 'running');
  assert.equal(output.audio.seen, 0);
  assert.ok(output.remainingAudioNodes < 8);
  output.passed = true;
  await writeFile(new URL('presentation.json', evidence), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser?.close();
  await vite.close();
  await new Promise((r) => server.close(r));
}
