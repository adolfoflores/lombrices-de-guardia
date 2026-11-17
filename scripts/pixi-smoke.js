/* Browser fixture globals supplied explicitly by the inline harness. */
/* global actorEntries, actorNode, bridgeCount, bridgePixels, bridgeSnapshot, effectStats, fireWeapon, game, lossExtension, makeGame, pose, prepareWeapon, publish, render, renderer, restoreRealClock, shapeCounts, step, stopFrames, untilEvent, useSceneClock */
// Focused Pixi presentation regression. Real Game snapshots drive the same Renderer
// used in play; the harness is deliberately separate from the application's UI.
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
const report = {
  browser: browserName,
  startedAt: new Date().toISOString(),
  physicalDevice: false,
  checks: [],
  scenes: [],
  errors: [],
  notes: [
    'Isolated renderer harness with real authoritative Game snapshots and actions; full room/UI integration is tested by scripts/browser-test.js.',
    'Scripted scenes use one monotonic presentation clock for snapshots, events and rendered frames. The real browser clock is restored before frame/CPU measurements and context-loss checks.',
    'Desktop measurements do not predict physical phone thermal or GPU performance.',
    'Girder recovery compares collision alpha exactly at every pixel and flat metal colors exactly. RGB antialias edge differences between repeatedly read canvases and a new GPU canvas are reported, not treated as collision changes.',
  ],
};
report.sourceSHA256 = {};
for (const path of [
  'client/renderer.js',
  'client/pixi-combat.js',
  'client/pixi-character.js',
  'client/art/palette.js',
  'client/art/weapons.js',
  'client/pixi-effects.js',
  'shared/engine.js',
])
  report.sourceSHA256[path] = createHash('sha256')
    .update(await readFile(new URL('../' + path, import.meta.url)))
    .digest('hex');
const source = `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pixi presentation verification</title>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#203542}#stage{position:relative;width:100%;height:100%}#field{display:block;position:absolute;inset:0;width:100%;height:100%}.pixi-field{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}</style>
<div id="stage"><canvas id="field"></canvas></div><script type="module">
import {Renderer} from '/client/renderer.js';
import {Game} from '/shared/engine.js';
const colors=['#f8b84e','#68d7c4','#ff839b','#a5a0ff','#a8d66d','#79bdf2'];
window.renderer=new Renderer(document.querySelector('#field'));
window.makeGame=(mapId='hills',count=6,flat=false)=>{
 const roster=Array.from({length:count},(_,i)=>({id:'p'+i,name:['Anchoa','Menta','Coral','Lila','Lima','Cielo'][i],team:Math.floor(i/2),color:colors[i]}));
 window.game=new Game(roster,{mapId,mode:count===6?'2v2v2':'ffa',worms:count===6?4:2},{seed:42});
 if(flat){game.terrain.data.fill(0);game.terrain.rect(0,650,1600,250);game.terrain.revision++;game.worms.forEach((w,i)=>Object.assign(w,{x:160+i*240,y:639,vx:0,vy:0,grounded:true}));}
 renderer.state=null;renderer.setState(game.snapshot(true));renderer.setView({playerId:game.turn.playerId,weapon:'bazooka',angle:-.65,power:0,quality:'high',reducedMotion:false});renderer.overview();
 return game.snapshot(false);
};
window.publish=(terrain=false)=>renderer.setState(game.snapshot(terrain));
window.step=(seconds)=>{for(let i=0;i<Math.ceil(seconds*60);i++)game.step();publish();};
window.stopFrames=()=>{cancelAnimationFrame(renderer.raf);renderer.raf=null;};
window.realPerformanceNow=performance.now.bind(performance);
window.useSceneClock=()=>{window.sceneClock=realPerformanceNow();Object.defineProperty(performance,'now',{configurable:true,value:()=>sceneClock});renderer.lastTime=sceneClock;};
window.restoreRealClock=()=>{Object.defineProperty(performance,'now',{configurable:true,value:realPerformanceNow});window.sceneClock=null;renderer.lastTime=realPerformanceNow();renderer.snapshotTime=renderer.lastTime;renderer.effects=[];renderer.pixi.effects.clear();};
window.render=(advance=0)=>{const time=window.sceneClock==null?Math.max(realPerformanceNow()+advance,renderer.lastTime+1000/60):(window.sceneClock+=Math.max(advance,1000/60));renderer.draw(time);return time;};
window.effectStats=()=>{
 const fx=renderer.pixi?.effects;
 const sized=v=>Array.isArray(v)?v.length:v instanceof Map||v instanceof Set?v.size:null;
 const collections={};if(fx)for(const [key,value] of Object.entries(fx)){const count=sized(value);if(count!==null)collections[key]=count;}
 return {collections,legacy:renderer.effects.length};
};
window.shapeCounts=()=>{const fx=renderer.pixi.effects,counts={};for(const particle of fx.particles){const name=Object.entries(fx.shapes).find(([,context])=>context===particle.node.context)?.[0]||'other';counts[name]=(counts[name]||0)+1;}return counts;};
window.prepareWeapon=(weapon,options={})=>{makeGame(options.mapId||'hills',2,true);renderer.setView({weapon,angle:options.angle??-.65,power:.65,charging:true,targeting:['airstrike','teleport','girder'].includes(weapon)});renderer.fullView=false;renderer.autoFollow=false;renderer.camera={x:300,y:570,zoom:2};renderer.cameraGoal={...renderer.camera};render(100);return pose();};
window.fireWeapon=(options={},offset=150)=>{const weapon=renderer.view.weapon;const fired=game.action(game.turn.playerId,{type:'fire',weapon,angle:renderer.view.angle,power:.35,...options});publish(true);renderer.setView({charging:false});render(offset);const actor=renderer.pixi.actors.get(game.turn.wormId);const tool=weapon==='grenade'?actor.heldGrenade:weapon==='cluster'?actor.heldCluster:weapon==='jetpack'?actor.pack:actor.weapons.get(weapon);const bounds=tool?.getLocalBounds();return {weapon,fired,events:game.events.map(e=>({...e})),projectiles:game.projectiles.map(p=>({id:p.id,kind:p.kind,fuse:p.fuse})),effects:effectStats(),shapes:shapeCounts(),pose:pose(),actor:{firedAt:actor.firedAt,lastWeapon:actor.lastWeapon,weaponRigY:actor.weaponRig.y,weaponRigRotation:actor.weaponRig.rotation,toolParts:Object.keys(tool?.parts||{}),toolBounds:bounds?{width:bounds.width,height:bounds.height}:null}};};
window.untilEvent=(type,weapon,limit=600)=>{let ticks=0;while(ticks++<limit&&!game.events.some(e=>e.type===type&&(!weapon||e.weapon===weapon))){game.step();if(ticks%4===0)publish();}publish(true);render(180);return {ticks,event:game.events.find(e=>e.type===type&&(!weapon||e.weapon===weapon)),events:game.events.map(e=>({...e})),effects:effectStats(),shapes:shapeCounts()};};
window.actorEntries=()=>Array.from((renderer.pixi?.actors||renderer.pixi?.actorsMap||new Map()).entries());
window.actorNode=(actor)=>actor;
window.pose=()=>{
 const actor=actorEntries().find(([id])=>id===game.turn.wormId)?.[1];
 const visit=(node,depth=0)=>({label:node.label||node.name||node.constructor.name,x:+node.x?.toFixed(4),y:+node.y?.toFixed(4),rotation:+node.rotation?.toFixed(4),sx:+node.scale?.x?.toFixed(4),sy:+node.scale?.y?.toFixed(4),visible:node.visible,alpha:+node.alpha?.toFixed(4),children:depth<3?(node.children||[]).map(child=>visit(child,depth+1)):[]});
 const result=visit(actorNode(actor));delete result.x;delete result.y;return result;
};
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
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.initialized);
  assert.equal(await page.evaluate(() => renderer.ready), true, 'Pixi initializes without Canvas fallback');
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    stopFrames();
    useSceneClock();
    render();
  });
  report.renderer = await page.evaluate(() => {
    const app = renderer.pixi.app;
    return {
      className: app.renderer.constructor.name,
      type: app.renderer.type,
      version: app.renderer.context?.webGLVersion,
      overlays: document.querySelectorAll('.pixi-field').length,
      fields: document.querySelectorAll('#field').length,
      actors: actorEntries().length,
      pointerEvents: getComputedStyle(document.querySelector('.pixi-field')).pointerEvents,
    };
  });
  assert.equal(report.renderer.overlays, 1);
  assert.equal(report.renderer.fields, 1);
  assert.equal(report.renderer.actors, 24);
  assert.equal(report.renderer.pointerEvents, 'none');
  assert.match(report.renderer.className, /WebGL/i, 'Combat uses real Pixi WebGL');
  report.checks.push(
    'One actual Pixi WebGL combat overlay, 24 actors, original terrain canvas, input passes through overlay',
  );

  for (const map of ['hills', 'cavern', 'islands']) {
    const result = await page.evaluate((id) => {
      makeGame(id);
      game.terrain.circle(760, 500, 90);
      game.terrain.girder(900, 480);
      publish(true);
      render(100);
      const alpha = renderer.terrainCtx.getImageData(0, 0, 1600, 900).data;
      let mismatch = 0;
      for (let i = 0; i < game.terrain.data.length; i++)
        if (Boolean(alpha[i * 4 + 3]) !== Boolean(game.terrain.data[i])) mismatch++;
      return { map: id, actors: actorEntries().length, terrainPixelMismatch: mismatch };
    }, map);
    assert.equal(result.actors, 24);
    assert.equal(result.terrainPixelMismatch, 0);
    report.scenes.push(result);
  }
  report.checks.push('All three maps retain exact collision-mask alpha after crater and girder');

  const poses = await page.evaluate(() => {
    makeGame('hills', 2, true);
    renderer.fullView = false;
    renderer.autoFollow = false;
    renderer.camera = { x: 300, y: 570, zoom: 2 };
    renderer.cameraGoal = { ...renderer.camera };
    render(100);
    const idle = pose();
    game.action(game.turn.playerId, { type: 'input', move: 1 });
    step(0.12);
    render(180);
    const walking = pose();
    const jump = game.action(game.turn.playerId, { type: 'jump' });
    step(0.12);
    render(220);
    const airborne = pose();
    return { idle, walking, airborne, jump, grounded: game._active().grounded };
  });
  assert.equal(poses.jump.ok, true);
  assert.equal(poses.grounded, false);
  assert.notDeepEqual(
    poses.walking,
    poses.idle,
    'Walking animates body parts, not only actor world position',
  );
  assert.notDeepEqual(poses.airborne, poses.walking, 'Airborne pose differs from grounded movement');
  report.poses = poses;
  report.checks.push('Actual input and jump actions produce distinct idle, walking and airborne poses');
  await page.screenshot({ path: fileURLToPath(new URL(`pixi-${browserName}-jump-desktop.png`, evidence)) });

  report.weapons = [];
  for (const weapon of ['bazooka', 'grenade']) {
    const shot = await page.evaluate((weapon) => {
      makeGame('hills', 2, true);
      renderer.setView({ weapon, angle: -0.5, power: 0.5 });
      renderer.fullView = false;
      renderer.autoFollow = false;
      renderer.camera = { x: 300, y: 570, zoom: 2 };
      renderer.cameraGoal = { ...renderer.camera };
      render(100);
      const before = pose();
      const fired = game.action(game.turn.playerId, { type: 'fire', weapon, angle: -0.5, power: 0.35 });
      publish();
      render(130);
      const firing = pose();
      const actor = renderer.pixi.actors.get(game.turn.wormId);
      return {
        weapon,
        fired,
        projectiles: game.projectiles.length,
        before,
        firing,
        firedAt: actor.firedAt,
        heldGrenade: actor.heldGrenade.visible,
        recoilX: actor.rig.x,
        effects: effectStats(),
        revision: game.terrain.revision,
      };
    }, weapon);
    assert.equal(shot.fired.ok, true);
    assert.equal(shot.projectiles, 1);
    assert.ok(Number.isFinite(shot.firedAt));
    if (weapon === 'grenade') assert.equal(shot.heldGrenade, false);
    else assert.notEqual(shot.recoilX, 0);
    assert.notDeepEqual(shot.before, shot.firing, `${weapon} has a firing pose`);
    await page.screenshot({
      path: fileURLToPath(new URL(`pixi-${browserName}-${weapon}-fire.png`, evidence)),
    });
    await page.evaluate(() => {
      step(0.18);
      render(100);
    });
    await page.screenshot({
      path: fileURLToPath(new URL(`pixi-${browserName}-${weapon}-flight.png`, evidence)),
    });
    const impact = await page.evaluate(() => {
      const initialRevision = game.terrain.revision;
      let steps = 0;
      while (steps++ < 600 && !game.events.some((e) => e.type === 'explosion')) {
        game.step();
        if (steps % 4 === 0) publish();
      }
      publish(true);
      render(180);
      const event = game.events.find((e) => e.type === 'explosion');
      return {
        steps,
        event,
        revision: game.terrain.revision,
        initialRevision,
        projectiles: game.projectiles.length,
        effects: effectStats(),
      };
    });
    assert.ok(impact.event, `${weapon} authoritative shot actually explodes`);
    assert.ok(impact.revision > impact.initialRevision, `${weapon} actually removes terrain`);
    await page.screenshot({
      path: fileURLToPath(new URL(`pixi-${browserName}-${weapon}-impact.png`, evidence)),
    });
    const cleaned = await page.evaluate(() => {
      render(5000);
      return effectStats();
    });
    report.weapons.push({ weapon, fireEffects: shot.effects, impact, cleaned });
  }
  report.checks.push(
    'Bazooka and grenade use real authoritative fire, projectile, terrain destruction and impact events; weapon poses differ at fire',
  );

  // Full arsenal: each case issues real Game actions in a controlled collision arena.
  // Fixture placement changes only the scene; authoritative action/physics paths remain real.
  report.arsenal = [];
  const capture = async (name) =>
    page.screenshot({ path: fileURLToPath(new URL(`pixi-${browserName}-${name}.png`, evidence)) });
  const record = (weapon, data) => {
    assert.equal(data.fired.ok, true, `${weapon} action accepted`);
    assert.ok(Number.isFinite(data.actor.firedAt), `${weapon} animates its owner`);
    assert.equal(data.actor.lastWeapon, weapon);
    assert.ok(data.actor.toolBounds?.width > 0, `${weapon} has visible tool geometry`);
  };

  const cluster = await page.evaluate(() => {
    prepareWeapon('cluster', { angle: -0.8 });
    return fireWeapon({ power: 0.35 });
  });
  record('cluster', cluster);
  assert.equal(cluster.projectiles[0].kind, 'cluster');
  assert.equal(cluster.effects.collections.projectiles, 1);
  await capture('cluster-throw');
  const fragments = await page.evaluate(() => {
    let ticks = 0;
    while (ticks++ < 240 && !game.projectiles.some((p) => p.kind === 'fragment')) {
      game.step();
      if (ticks % 4 === 0) publish();
    }
    publish(true);
    renderer.camera.x = 450;
    renderer.cameraGoal = { ...renderer.camera };
    render(130);
    return {
      ticks,
      kinds: game.projectiles.map((p) => p.kind),
      visualKinds: Array.from(renderer.pixi.effects.projectiles.values()).map((p) => p.kind),
      effects: effectStats(),
    };
  });
  assert.equal(fragments.kinds.filter((k) => k === 'fragment').length, 5);
  assert.equal(fragments.visualKinds.filter((k) => k === 'fragment').length, 5);
  await capture('cluster-fragments');
  const clusterImpact = await page.evaluate(() => untilEvent('explosion', 'fragment'));
  assert.ok(clusterImpact.event);
  await capture('cluster-impact');
  report.arsenal.push({ weapon: 'cluster', shot: cluster, fragments, impact: clusterImpact });

  const shotgun = await page.evaluate(() => {
    prepareWeapon('shotgun', { angle: 0 });
    const first = fireWeapon({}, 280);
    const actor = renderer.pixi.actors.get(game.turn.wormId);
    return {
      ...first,
      pumpX: actor.weapons.get('shotgun').parts.pump.x,
      chamberAlpha: actor.weapons.get('shotgun').parts.chamber.alpha,
    };
  });
  record('shotgun', shotgun);
  assert.equal(shotgun.events.find((e) => e.type === 'shot').hit, 'worm');
  assert.ok(shotgun.pumpX < 0);
  await capture('shotgun-first');
  const secondShot = await page.evaluate(() => {
    step(0.55);
    const target = game.worms.find((w) => w.playerId === 'p1'),
      owner = game._active();
    const angle = Math.atan2(target.y - owner.y, target.x - owner.x);
    renderer.setView({ angle });
    return fireWeapon({ angle }, 70);
  });
  record('shotgun', secondShot);
  assert.equal(secondShot.events.filter((e) => e.type === 'shot').length, 2);
  assert.ok(secondShot.events.filter((e) => e.type === 'shot').every((e) => e.hit === 'worm'));
  await capture('shotgun-second');
  report.arsenal.push({ weapon: 'shotgun', first: shotgun, second: secondShot });

  const dynamite = await page.evaluate(() => {
    prepareWeapon('dynamite');
    return fireWeapon({}, 250);
  });
  record('dynamite', dynamite);
  assert.equal(dynamite.projectiles[0].fuse, 4);
  assert.equal(dynamite.effects.collections.projectiles, 1);
  await capture('dynamite-place');
  const dynamiteFuse = await page.evaluate(() => {
    step(3.3);
    render(100);
    const visual = Array.from(renderer.pixi.effects.projectiles.values())[0];
    return {
      count: game.projectiles.length,
      fuse: game.projectiles[0]?.fuse,
      label: visual?.fuse?.text,
      kind: visual?.kind,
    };
  });
  assert.equal(dynamiteFuse.count, 1);
  assert.equal(dynamiteFuse.kind, 'dynamite');
  assert.ok(dynamiteFuse.fuse > 0 && dynamiteFuse.fuse < 1);
  assert.ok(dynamiteFuse.label);
  await capture('dynamite-fuse');
  const dynamiteImpact = await page.evaluate(() => untilEvent('explosion', 'dynamite'));
  assert.ok(dynamiteImpact.event);
  await capture('dynamite-impact');
  report.arsenal.push({ weapon: 'dynamite', shot: dynamite, fuse: dynamiteFuse, impact: dynamiteImpact });

  const mine = await page.evaluate(() => {
    prepareWeapon('mine');
    const shot = fireWeapon({}, 250);
    return { ...shot, mines: game.mines.map((m) => ({ id: m.id, armed: m.armed, fuse: m.fuse })) };
  });
  record('mine', mine);
  assert.equal(mine.mines[0].armed, false);
  assert.equal(mine.effects.collections.mines, 1);
  await capture('mine-place');
  const armedMine = await page.evaluate(() => {
    for (let i = 0; i < 15; i++) {
      game.action(game.turn.playerId, { type: 'input', move: -1 });
      step(0.1);
    }
    publish();
    render(100);
    return {
      mine: game.mines[0] && { armed: game.mines[0].armed, fuse: game.mines[0].fuse },
      visual: Array.from(renderer.pixi.effects.mines.values()).map((m) => ({
        armed: m.armed,
        label: m.fuse?.text,
      })),
      ownerX: game._active().x,
    };
  });
  assert.equal(armedMine.mine.armed, true);
  assert.equal(armedMine.mine.fuse, undefined);
  assert.equal(armedMine.visual[0].armed, true);
  await capture('mine-armed');
  const triggeredMine = await page.evaluate(() => {
    let ticks = 0;
    while (ticks++ < 120 && !game.events.some((e) => e.type === 'mineTrigger')) {
      game.action(game.turn.playerId, { type: 'input', move: 1 });
      game.step();
      if (ticks % 4 === 0) publish();
    }
    publish();
    render(100);
    return {
      ticks,
      event: game.events.find((e) => e.type === 'mineTrigger'),
      fuse: game.mines[0]?.fuse,
      label: Array.from(renderer.pixi.effects.mines.values())[0]?.fuse?.text,
    };
  });
  assert.ok(triggeredMine.event);
  assert.ok(triggeredMine.fuse > 0);
  assert.ok(triggeredMine.label);
  await capture('mine-trigger');
  const mineImpact = await page.evaluate(() => untilEvent('explosion', 'mine'));
  assert.ok(mineImpact.event);
  assert.equal(mineImpact.effects.collections.mines, 0);
  await capture('mine-impact');
  report.arsenal.push({
    weapon: 'mine',
    shot: mine,
    armed: armedMine,
    trigger: triggeredMine,
    impact: mineImpact,
  });

  const batMiss = await page.evaluate(() => {
    prepareWeapon('bat', { angle: -0.25 });
    return fireWeapon({}, 80);
  });
  record('bat', batMiss);
  assert.equal(batMiss.events.find((e) => e.type === 'bat').hits.length, 0);
  assert.equal(batMiss.shapes.flash || 0, 0);
  assert.equal(batMiss.shapes.spark || 0, 0);
  assert.ok((batMiss.shapes.arc || 0) > 0);
  await capture('bat-miss');
  const batHit = await page.evaluate(() => {
    prepareWeapon('bat', { angle: -0.25 });
    game.worms.find((w) => w.playerId === 'p1').x = game._active().x + 35;
    publish();
    return fireWeapon({}, 80);
  });
  record('bat', batHit);
  assert.equal(batHit.events.find((e) => e.type === 'bat').hits.length, 1);
  assert.ok((batHit.shapes.flash || 0) > 0);
  assert.ok((batHit.shapes.spark || 0) > 0);
  await capture('bat-hit');
  report.arsenal.push({ weapon: 'bat', miss: batMiss, hit: batHit });

  const airstrike = await page.evaluate(() => {
    prepareWeapon('airstrike');
    renderer.camera = { x: 530, y: 400, zoom: 1 };
    renderer.cameraGoal = { ...renderer.camera };
    return fireWeapon({ x: 530, y: 550 }, 180);
  });
  record('airstrike', airstrike);
  assert.equal(airstrike.projectiles.length, 5);
  assert.ok(airstrike.projectiles.every((p) => p.kind === 'airstrike'));
  assert.equal(airstrike.effects.collections.projectiles, 5);
  await page.evaluate(() => {
    step(1);
    render(100);
  });
  await capture('airstrike-flight');
  const airstrikeImpact = await page.evaluate(() => untilEvent('explosion', 'airstrike'));
  assert.ok(airstrikeImpact.event);
  await capture('airstrike-impact');
  report.arsenal.push({ weapon: 'airstrike', shot: airstrike, impact: airstrikeImpact });

  const rope = await page.evaluate(() => {
    prepareWeapon('rope', { angle: -Math.PI / 2 });
    game.terrain.rect(80, 340, 300, 20);
    game.terrain.revision++;
    publish(true);
    renderer.camera = { x: 300, y: 480, zoom: 1.5 };
    renderer.cameraGoal = { ...renderer.camera };
    return fireWeapon({}, 100);
  });
  record('rope', rope);
  assert.ok(rope.events.find((e) => e.type === 'rope'));
  assert.equal(rope.effects.collections.wormTools, 1);
  await capture('rope-attach');
  const ropeSwing = await page.evaluate(() => {
    const start = game._active().rope.length;
    for (let i = 0; i < 10; i++) {
      game.action(game.turn.playerId, { type: 'input', move: 1, reel: -1 });
      step(0.1);
    }
    render(100);
    return { start, end: game._active().rope.length, x: game._active().x, effects: effectStats() };
  });
  assert.ok(ropeSwing.end < ropeSwing.start - 70);
  assert.ok(ropeSwing.x > 170);
  await capture('rope-swing');
  const ropeRelease = await page.evaluate(() => {
    const action = game.action(game.turn.playerId, { type: 'release' });
    publish();
    render(100);
    return { action, rope: game._active().rope, effects: effectStats() };
  });
  assert.equal(ropeRelease.action.ok, true);
  assert.equal(ropeRelease.rope, null);
  assert.equal(ropeRelease.effects.collections.wormTools, 0);
  report.arsenal.push({ weapon: 'rope', shot: rope, swing: ropeSwing, release: ropeRelease });

  const jetpack = await page.evaluate(() => {
    prepareWeapon('jetpack');
    return fireWeapon({}, 150);
  });
  record('jetpack', jetpack);
  assert.equal(jetpack.events.filter((e) => e.type === 'fire').at(-1).enabled, true);
  const jetFlight = await page.evaluate(() => {
    const samples = [];
    for (let i = 0; i < 10; i++) {
      game.action(game.turn.playerId, { type: 'input', thrustY: -1, thrustX: 1 });
      step(0.1);
      for (let frame = 0; frame < 6; frame++) render(1000 / 60);
      const actor = renderer.pixi.actors.get(game.turn.wormId);
      samples.push({
        time: performance.now(),
        tilt: actor.travelTilt,
        throttle: actor.thrustLevel,
        flameVisible: actor.flame.visible,
      });
    }
    const w = game._active(),
      actor = renderer.pixi.actors.get(w.id);
    return {
      y: w.y,
      fuel: w.fuel,
      jetpack: w.jetpack,
      flameVisible: actor.flame?.visible ?? actor.pack.parts.flame.visible,
      effects: effectStats(),
      samples,
    };
  });
  assert.ok(jetFlight.y < 600);
  assert.equal(jetFlight.jetpack, true);
  assert.equal(jetFlight.flameVisible, true);
  assert.ok(
    jetFlight.samples.every((sample, index) => !index || sample.time > jetFlight.samples[index - 1].time),
  );
  assert.ok(jetFlight.samples.at(-1).throttle > 0.8);
  await capture('jetpack-flight');
  const jetOff = await page.evaluate(() => {
    const shot = fireWeapon({}, 100);
    const actor = renderer.pixi.actors.get(game.turn.wormId);
    return {
      ...shot,
      jetpack: game._active().jetpack,
      flameVisible: actor.flame?.visible ?? actor.pack.parts.flame.visible,
    };
  });
  record('jetpack', jetOff);
  assert.equal(jetOff.jetpack, false);
  assert.equal(jetOff.flameVisible, false);
  assert.equal(jetOff.events.filter((e) => e.type === 'fire').at(-1).enabled, false);
  report.arsenal.push({ weapon: 'jetpack', on: jetpack, flight: jetFlight, off: jetOff });

  const teleport = await page.evaluate(() => {
    prepareWeapon('teleport');
    const beforeX = game._active().x;
    const shot = fireWeapon({ x: 530, y: 620 }, 130);
    return { ...shot, beforeX, afterX: game._active().x };
  });
  record('teleport', teleport);
  assert.deepEqual(
    teleport.events.filter((e) => e.type === 'teleport').map((e) => e.phase),
    ['depart', 'arrive'],
  );
  assert.equal(teleport.beforeX, 160);
  assert.equal(teleport.afterX, 530);
  await capture('teleport-two-ends');
  report.arsenal.push({ weapon: 'teleport', shot: teleport });

  const girder = await page.evaluate(() => {
    prepareWeapon('girder');
    const shot = fireWeapon({ x: 310, y: 540 }, 120);
    return { ...shot, girders: game.snapshot().girders, revision: game.terrain.revision };
  });
  record('girder', girder);
  assert.equal(girder.girders.length, 1);
  assert.ok(girder.events.some((e) => e.type === 'girder' && e.width === 112 && e.height === 16));
  await capture('girder-place');
  const girderDamage = await page.evaluate(() => {
    window.bridgeCount = () => {
      const g = game.girders[0];
      let n = 0;
      for (let y = g.y - g.height / 2; y < g.y + g.height / 2; y++)
        for (let x = g.x - g.width / 2; x < g.x + g.width / 2; x++) if (game.terrain.solid(x, y)) n++;
      return n;
    };
    const before = bridgeCount();
    step(3.8);
    const nextPlayer = game.turn.playerId;
    const fired = game.action(nextPlayer, { type: 'fire', weapon: 'bazooka', angle: -1.95, power: 1 });
    publish();
    const impact = untilEvent('explosion', 'bazooka');
    const after = bridgeCount();
    const pixels = renderer.terrainCtx.getImageData(0, 0, 1600, 900).data;
    let alphaMismatch = 0;
    for (let i = 0; i < game.terrain.data.length; i++)
      if (Boolean(pixels[i * 4 + 3]) !== Boolean(game.terrain.data[i])) alphaMismatch++;
    window.bridgePixels = new Uint8ClampedArray(pixels);
    window.bridgeSnapshot = game.snapshot(true);
    return { before, after, nextPlayer, fired, impact, alphaMismatch };
  });
  assert.equal(girderDamage.fired.ok, true);
  assert.ok(girderDamage.impact.event);
  assert.ok(
    girderDamage.after > 0 && girderDamage.after < girderDamage.before,
    'Real rocket partially destroys placed bridge',
  );
  assert.equal(girderDamage.alphaMismatch, 0);
  await capture('girder-damaged');
  const girderRecovery = await page.evaluate(async () => {
    const { Renderer } = await import('/client/renderer.js');
    renderer.destroy();
    renderer = new Renderer(document.querySelector('#field'));
    const ready = await renderer.ready;
    renderer.setState({ ...bridgeSnapshot, events: [] });
    renderer.setView({ playerId: game.turn.playerId, weapon: 'bazooka' });
    stopFrames();
    renderer.camera = { x: 300, y: 570, zoom: 2 };
    renderer.cameraGoal = { ...renderer.camera };
    renderer.autoFollow = false;
    render(100);
    const pixels = renderer.terrainCtx.getImageData(0, 0, 1600, 900).data;
    let pixelMismatch = 0,
      alphaMismatch = 0,
      maxDelta = 0,
      bridgeMismatch = 0;
    const samples = [];
    for (let i = 0; i < pixels.length; i++)
      if (pixels[i] !== bridgePixels[i]) {
        pixelMismatch++;
        if (i % 4 === 3) alphaMismatch++;
        maxDelta = Math.max(maxDelta, Math.abs(pixels[i] - bridgePixels[i]));
        const x = Math.floor(i / 4) % 1600,
          y = Math.floor(i / 6400);
        if (x >= 254 && x < 366 && y >= 532 && y < 548) bridgeMismatch++;
        if (samples.length < 8)
          samples.push({ x, y, channel: i % 4, before: bridgePixels[i], after: pixels[i] });
      }
    const probes = [
      [266, 532],
      [280, 534],
      [266, 545],
    ].map(([x, y]) => {
      const i = (y * 1600 + x) * 4;
      return {
        x,
        y,
        before: Array.from(bridgePixels.slice(i, i + 4)),
        after: Array.from(pixels.slice(i, i + 4)),
      };
    });
    return {
      ready,
      pixelMismatch,
      alphaMismatch,
      maxDelta,
      bridgeMismatch,
      samples,
      probes,
      girders: renderer.state.girders.length,
      particles: renderer.pixi.effects.particles.length,
    };
  });
  report.girderRecovery = girderRecovery;
  assert.equal(girderRecovery.ready, true);
  assert.equal(girderRecovery.alphaMismatch, 0);
  for (const probe of girderRecovery.probes)
    assert.deepEqual(probe.after, probe.before, 'Solid metal material survives reconnect');
  assert.deepEqual(girderRecovery.probes[0].after, [194, 203, 178, 255]);
  assert.equal(girderRecovery.girders, 1);
  assert.equal(girderRecovery.particles, 0);
  await capture('girder-recovered');
  report.arsenal.push({ weapon: 'girder', shot: girder, damage: girderDamage, recovery: girderRecovery });
  assert.equal(
    new Set([...report.weapons.map((w) => w.weapon), ...report.arsenal.map((w) => w.weapon)]).size,
    12,
  );
  report.projectileKinds = await page.evaluate(async () => {
    const { PIXI_PROJECTILE_KINDS } = await import('/client/pixi-effects.js');
    return Array.from(PIXI_PROJECTILE_KINDS);
  });
  for (const kind of ['bazooka', 'grenade', 'cluster', 'fragment', 'dynamite', 'airstrike'])
    assert.ok(report.projectileKinds.includes(kind));
  report.checks.push(
    'All twelve weapons have original Pixi poses/art and authoritative action-specific effects; bat miss never invents an impact',
  );
  report.checks.push(
    'Cluster five fragments, shotgun two hits, dynamite fuse, mine arm/trigger, five airstrike bombs, rope attach/release, jetpack on/off and teleport endpoints verified',
  );
  report.checks.push(
    'Placed girder survives history-free snapshot recovery and its real rocket crater remains pixel-exact',
  );

  // Supply crate: a real authoritative descent, landing and pickup through the same snapshot path as mines.
  const crateDescent = await page.evaluate(() => {
    makeGame('hills', 2, true);
    renderer.fullView = false;
    renderer.autoFollow = false;
    renderer.camera = { x: 300, y: 540, zoom: 2 };
    renderer.cameraGoal = { ...renderer.camera };
    game.crates.push({ id: 'crate-drop', x: 330, y: 470, vy: 0, parachute: true, landed: false });
    publish();
    render(100);
    const startY = game.crates[0].y;
    step(1);
    render(300);
    const visual = Array.from(renderer.pixi.effects.crates.values())[0];
    return {
      startY,
      y: game.crates[0].y,
      x: game.crates[0].x,
      landed: game.crates[0].landed,
      chute: visual.chute.visible,
      rotation: visual.swing.rotation,
      collections: effectStats().collections,
    };
  });
  assert.equal(crateDescent.collections.crates, 1);
  assert.equal(crateDescent.chute, true);
  assert.equal(crateDescent.x, 330);
  assert.equal(crateDescent.landed, false);
  assert.notEqual(crateDescent.rotation, 0, 'the chute sways while descending');
  assert.ok(
    crateDescent.y > crateDescent.startY + 45 && crateDescent.y < crateDescent.startY + 65,
    'the parachute sinks at the configured pace',
  );
  await capture('crate-descent');
  const crateLanding = await page.evaluate(() => {
    step(3);
    render(100);
    render(400);
    const visual = Array.from(renderer.pixi.effects.crates.values())[0];
    return {
      y: game.crates[0].y,
      landed: game.crates[0].landed,
      parachute: game.crates[0].parachute,
      events: game.events.filter((e) => e.type.startsWith('crate')).map((e) => e.type),
      chute: visual.chute.visible,
      rotation: visual.swing.rotation,
      shapes: shapeCounts(),
    };
  });
  assert.equal(crateLanding.landed, true);
  assert.equal(crateLanding.parachute, false);
  assert.ok(crateLanding.events.includes('crateLand'));
  assert.equal(crateLanding.chute, false);
  assert.equal(crateLanding.rotation, 0);
  assert.ok(Math.abs(crateLanding.y + 8 - 650) <= 1.5);
  await capture('crate-landed');
  const cratePickup = await page.evaluate(() => {
    game.players[0].ammo.dynamite = 0;
    const worm = game._active();
    worm.x = 330;
    publish();
    game.step();
    publish(true);
    render(120);
    return {
      crates: game.crates.length,
      event: game.events.find((e) => e.type === 'cratePickup'),
      ammo: game.players[0].ammo.dynamite,
      floating: renderer.pixi.floating.length,
      collections: effectStats().collections,
      shapes: shapeCounts(),
    };
  });
  assert.equal(cratePickup.crates, 0);
  assert.equal(cratePickup.event?.text, '+1 dinamita');
  assert.equal(cratePickup.event?.playerId, 'p0');
  assert.equal(cratePickup.ammo, 1);
  assert.equal(cratePickup.collections.crates, 0);
  assert.ok(cratePickup.floating >= 1, 'the pickup text floats in the HUD layer');
  assert.ok((cratePickup.shapes.cross || 0) > 0, 'pickup sparkles');
  await capture('crate-pickup');
  report.crate = { descent: crateDescent, landing: crateLanding, pickup: cratePickup };
  report.checks.push(
    'Supply crate parachutes at constant speed, lands with its chute folded, is collected by the active worm with a floating text and leaves no visual behind',
  );

  await page.setViewportSize({ width: 844, height: 390 });
  const alignment = await page.evaluate(() => {
    makeGame('hills');
    renderer.setView({ quality: 'low', reducedMotion: true });
    renderer.fullView = false;
    renderer.autoFollow = false;
    renderer.camera = { x: 500, y: 500, zoom: 1.6 };
    renderer.cameraGoal = { ...renderer.camera };
    render(100);
    const [id, actor] = actorEntries()[0];
    const worm = renderer.state.worms.find((w) => w.id === id);
    const time = render(100);
    const p = renderer.position(worm, time);
    const actual = actorNode(actor).getGlobalPosition();
    const expected = {
      x: renderer.width / 2 + (p.x - renderer.camera.x) * renderer.camera.zoom,
      y: renderer.height / 2 + (p.y - renderer.camera.y) * renderer.camera.zoom,
    };
    const base = document.querySelector('#field').getBoundingClientRect();
    const overlay = document.querySelector('.pixi-field').getBoundingClientRect();
    return {
      actual: { x: actual.x, y: actual.y },
      expected,
      base: { x: base.x, y: base.y, width: base.width, height: base.height },
      overlay: { x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height },
      quality: renderer.view.quality,
      reducedMotion: renderer.view.reducedMotion,
      canvases: document.querySelectorAll('canvas').length,
    };
  });
  assert.deepEqual(alignment.overlay, alignment.base);
  assert.ok(Math.abs(alignment.actual.x - alignment.expected.x) < 0.02);
  assert.ok(Math.abs(alignment.actual.y - alignment.expected.y) < 0.02);
  report.mobile = alignment;
  report.checks.push(
    '844×390 resize, low graphics and reduced motion keep Pixi world/camera aligned with terrain',
  );
  await page.screenshot({ path: fileURLToPath(new URL(`pixi-${browserName}-mobile.png`, evidence)) });

  report.stress = await page.evaluate(() => {
    renderer.setView({ reducedMotion: false, quality: 'high' });
    const time = performance.now();
    for (let i = 0; i < 180; i++)
      renderer.addEffect(
        {
          id: 'bounded-' + i,
          type: 'explosion',
          x: 300 + (i % 20) * 12,
          y: 530,
          radius: 58,
          weapon: i % 2 ? 'bazooka' : 'grenade',
        },
        time,
      );
    render(150);
    const peak = effectStats();
    render(6000);
    return { events: 180, peak, after: effectStats() };
  });
  assert.ok(report.stress.peak.legacy <= 45);
  assert.ok(report.stress.peak.collections.particles <= 240);
  assert.ok(report.stress.peak.collections.pool <= 160);
  assert.equal(report.stress.after.legacy, 0);
  assert.equal(report.stress.after.collections.particles, 0);
  assert.equal(report.stress.after.collections.projectiles, 0);
  report.effectBudgets = await page.evaluate(() => {
    const results = [];
    for (const settings of [
      { quality: 'low', reducedMotion: false, limit: 100 },
      { quality: 'high', reducedMotion: true, limit: 36 },
    ]) {
      renderer.setView(settings);
      const now = performance.now();
      for (let i = 0; i < 40; i++)
        renderer.addEffect(
          { id: 'budget-' + i, type: 'explosion', x: 500, y: 530, radius: 64, weapon: 'grenade' },
          now,
        );
      render(100);
      const particles = effectStats().collections.particles;
      render(6000);
      results.push({ ...settings, particles, remaining: effectStats().collections.particles });
    }
    return results;
  });
  for (const budget of report.effectBudgets) {
    assert.ok(budget.particles <= budget.limit);
    assert.equal(budget.remaining, 0);
  }
  report.checks.push(
    'Burst of 180 impacts stays bounded, low/reduced budgets apply and visual effects expire',
  );

  // Presentation feel on the same renderer paths: impact zoom punch, killing-blow beat clock,
  // cluster follow and automatic quality. Scene clock, real Game snapshots and events.
  report.impactCamera = await page.evaluate(() => {
    makeGame('hills', 2, true);
    renderer.setView({ quality: 'high', reducedMotion: false });
    renderer.fullView = false;
    renderer.autoFollow = true;
    renderer.focus();
    for (let i = 0; i < 150; i++) render(1000 / 60);
    const goal = renderer.cameraGoal.zoom,
      rest = renderer.camera.zoom;
    renderer.addEffect(
      { id: 'punch-test', type: 'explosion', x: 800, y: 600, radius: 58, weapon: 'bazooka' },
      performance.now(),
    );
    const samples = [];
    for (let i = 0; i < 40; i++) {
      render(1000 / 60);
      samples.push(renderer.camera.zoom);
    }
    const peak = Math.max(...samples),
      peakFrame = samples.indexOf(peak);
    for (let i = 0; i < 120; i++) render(1000 / 60);
    const settled = renderer.camera.zoom;
    renderer.setView({ reducedMotion: true });
    renderer.addEffect(
      { id: 'punch-quiet', type: 'explosion', x: 800, y: 600, radius: 58, weapon: 'bazooka' },
      performance.now(),
    );
    const quiet = [];
    for (let i = 0; i < 40; i++) {
      render(1000 / 60);
      quiet.push(renderer.camera.zoom);
    }
    renderer.setView({ reducedMotion: false });
    return { goal, rest, peak, peakFrame, settled, quietPeak: Math.max(...quiet), quietRest: quiet[0] };
  });
  assert.ok(report.impactCamera.peak > report.impactCamera.rest * 1.04, 'Impact punches the zoom in');
  assert.ok(
    report.impactCamera.peakFrame >= 5 && report.impactCamera.peakFrame <= 9,
    'Punch peaks around 120 ms',
  );
  assert.ok(
    Math.abs(report.impactCamera.settled - report.impactCamera.goal) < report.impactCamera.goal * 0.01,
    'Zoom returns to the follow goal',
  );
  assert.ok(
    report.impactCamera.quietPeak <= report.impactCamera.quietRest * 1.001,
    'Reduced motion never punches the zoom',
  );
  report.killingBlow = await page.evaluate(() => {
    const victim = game.worms.find((w) => w.playerId !== game.turn.playerId),
      own = game.worms.find((w) => w.playerId === game.turn.playerId);
    const start = performance.now(),
      fxStart = renderer.effectTime(start);
    renderer.addEffect(
      { id: 'beat-own', type: 'death', x: own.x, y: own.y, wormId: own.id, text: 'propio' },
      start,
    );
    const ownBeat = !!renderer.beat;
    renderer.addEffect(
      { id: 'beat-test', type: 'death', x: victim.x, y: victim.y, wormId: victim.id, text: 'eliminado' },
      start,
    );
    const rateHold = renderer.effectRate(start + 100);
    render(100);
    const fxHold = renderer.effectTime(performance.now()) - fxStart;
    render(150);
    const rateMid = renderer.effectRate(performance.now());
    render(200);
    const rateAfter = renderer.effectRate(performance.now());
    const realAdvance = performance.now() - start,
      fxAdvance = renderer.effectTime(performance.now()) - fxStart;
    render(6000);
    return {
      ownBeat,
      rateHold,
      fxHold,
      rateMid,
      rateAfter,
      realAdvance,
      fxAdvance,
      lag: realAdvance - fxAdvance,
      particles: effectStats().collections.particles,
      legacy: renderer.effects.length,
      beatOpen: !!renderer.beat,
    };
  });
  assert.equal(report.killingBlow.ownBeat, false, 'Losing an own worm is no golpe mortal');
  assert.equal(report.killingBlow.rateHold, 0.35);
  assert.ok(Math.abs(report.killingBlow.fxHold - 35) < 0.5, 'Effects clock runs at 35 % during the beat');
  assert.ok(
    report.killingBlow.rateMid > 0.35 && report.killingBlow.rateMid < 1,
    'Effects clock recovers gradually',
  );
  assert.equal(report.killingBlow.rateAfter, 1);
  assert.equal(report.killingBlow.beatOpen, false);
  assert.ok(
    Math.abs(report.killingBlow.lag - 162.5) < 0.5,
    'The beat slows effects by exactly 162.5 ms in total',
  );
  assert.equal(report.killingBlow.particles, 0);
  assert.equal(report.killingBlow.legacy, 0);
  report.clusterFollow = await page.evaluate(() => {
    prepareWeapon('cluster', { angle: -0.8 });
    fireWeapon({ power: 0.35 });
    let ticks = 0;
    while (ticks++ < 240 && !game.projectiles.some((p) => p.kind === 'fragment')) {
      game.step();
      if (ticks % 4 === 0) publish();
    }
    publish(true);
    renderer.autoFollow = true;
    renderer.fullView = false;
    render(100);
    const fragments = game.projectiles.filter((p) => p.kind === 'fragment'),
      lead = fragments.reduce((a, b) => (b.vy > a.vy ? b : a));
    const expected = {
      x: lead.x,
      y: lead.y - renderer.followOffsetY / renderer.cameraGoal.zoom,
      zoom: renderer.cameraGoal.zoom,
    };
    renderer.clampCamera(expected);
    return {
      fragments: fragments.length,
      lead: { id: lead.id, vy: lead.vy },
      velocities: fragments.map((f) => f.vy),
      goal: { ...renderer.cameraGoal },
      expected,
      fit: renderer.fitZoom,
    };
  });
  assert.equal(report.clusterFollow.fragments, 5);
  assert.ok(
    Math.abs(report.clusterFollow.goal.x - report.clusterFollow.expected.x) < 0.01 &&
      Math.abs(report.clusterFollow.goal.y - report.clusterFollow.expected.y) < 0.01,
    'Camera follows the fragment landing first',
  );
  report.autoQuality = await page.evaluate(() => {
    renderer.setView({ quality: 'auto' });
    let t = performance.now();
    const trace = [];
    const run = (frames, ms) => {
      for (let i = 0; i < frames; i++) {
        t += ms;
        renderer.sampleFrame(t);
      }
      trace.push({ ms, frames, quality: renderer.quality, switches: renderer.perf.lastSwitch });
      return renderer.quality;
    };
    const slow = run(150, 30),
      band = run(300, 20),
      fast = run(850, 16),
      bandAgain = run(300, 20);
    renderer.setView({ quality: 'high' });
    return { slow, band, fast, bandAgain, trace, view: renderer.view.quality, effective: renderer.quality };
  });
  assert.equal(report.autoQuality.slow, 'low', 'Two seconds above 22 ms switch to light quality');
  assert.equal(report.autoQuality.band, 'low', 'Frame times inside the hysteresis band change nothing');
  assert.equal(report.autoQuality.fast, 'high', 'Ten seconds under 17 ms restore full quality');
  assert.equal(report.autoQuality.bandAgain, 'high');
  assert.equal(report.autoQuality.view, 'high');
  assert.equal(report.autoQuality.effective, 'high');
  report.checks.push(
    'Impact zoom punch (none under reduced motion), killing-blow beat slows only the effects clock, cluster follow and automatic quality hysteresis',
  );

  report.collectionCleanup = await page.evaluate(() => {
    prepareWeapon('mine');
    fireWeapon();
    const mines = game.snapshot(false).mines;
    prepareWeapon('jetpack');
    fireWeapon();
    step(0.2);
    const worms = game.snapshot(false).worms;
    prepareWeapon('dynamite');
    fireWeapon();
    const projectiles = game.snapshot(false).projectiles;
    const fx = renderer.pixi.effects,
      now = performance.now(),
      options = { quality: 'high', reducedMotion: false, mapId: 'hills' };
    // Independently produced authoritative entity sets exercise all disposal paths together.
    fx.updateMines(mines, now, (m) => m, options);
    fx.updateWorms(worms, now, (w) => w, options);
    fx.updateProjectiles(projectiles, now, (p) => p, options);
    fx.updateCrates(
      [{ id: 'crate-clean', x: 300, y: 400, parachute: true, landed: false }],
      now,
      (c) => c,
      options,
    );
    const before = effectStats();
    fx.clear();
    return { before, after: effectStats() };
  });
  for (const collection of ['projectiles', 'mines', 'wormTools', 'crates']) {
    assert.ok(report.collectionCleanup.before.collections[collection] > 0);
    assert.equal(report.collectionCleanup.after.collections[collection], 0);
  }
  assert.equal(report.collectionCleanup.after.collections.particles, 0);
  assert.ok(report.collectionCleanup.after.collections.pool <= 160);
  report.checks.push(
    'Clear disposes live projectile, mine, crate and worm-tool collections together without unbounded retained particles',
  );

  report.lifecycle = await page.evaluate(async () => {
    const { Renderer } = await import('/client/renderer.js');
    const { CombatLayer } = await import('/client/pixi-combat.js');
    const canvas = document.querySelector('#field');
    const oldOverlay = document.querySelector('.pixi-field'),
      oldEffects = renderer.pixi.effects;
    renderer.destroy();
    const destroyedCollections = {
      particles: oldEffects.particles.length,
      pool: oldEffects.pool.length,
      projectiles: oldEffects.projectiles.size,
      mines: oldEffects.mines.size,
      crates: oldEffects.crates.size,
      wormTools: oldEffects.wormTools.size,
    };
    const afterDestroy = document.querySelectorAll('.pixi-field').length;
    const early = new Renderer(canvas);
    early.destroy();
    const earlyReady = await early.ready;
    const afterEarlyDestroy = document.querySelectorAll('.pixi-field').length;
    const inFlight = new CombatLayer(canvas);
    const initializing = inFlight.init(844, 390, 1);
    inFlight.destroy();
    const inFlightReady = await initializing;
    const afterInFlight = document.querySelectorAll('.pixi-field').length;
    renderer = new Renderer(canvas);
    const recreated = await renderer.ready;
    makeGame();
    stopFrames();
    render(100);
    return {
      afterDestroy,
      destroyedCollections,
      oldConnected: oldOverlay.isConnected,
      earlyReady,
      afterEarlyDestroy,
      inFlightReady,
      afterInFlight,
      recreated,
      overlays: document.querySelectorAll('.pixi-field').length,
      actors: actorEntries().length,
    };
  });
  assert.equal(report.lifecycle.afterDestroy, 0);
  assert.ok(Object.values(report.lifecycle.destroyedCollections).every((count) => count === 0));
  assert.equal(report.lifecycle.oldConnected, false);
  assert.equal(report.lifecycle.afterEarlyDestroy, 0);
  assert.equal(report.lifecycle.inFlightReady, false);
  assert.equal(report.lifecycle.afterInFlight, 0);
  assert.equal(report.lifecycle.recreated, true);
  assert.equal(report.lifecycle.overlays, 1);
  assert.equal(report.lifecycle.actors, 24);
  report.checks.push('Destroy, destroy-during-initialization and re-create leave no orphan overlay');
  await page.evaluate(() => restoreRealClock());
  report.performance = await page.evaluate(async () => {
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
    intervals.sort((a, b) => a - b);
    cpu.sort((a, b) => a - b);
    return {
      frames: intervals.length,
      actors: actorEntries().length,
      medianMs: intervals[Math.floor(intervals.length * 0.5)],
      p95Ms: intervals[Math.floor(intervals.length * 0.95)],
      drawCpuP95Ms: cpu[Math.floor(cpu.length * 0.95)],
    };
  });
  report.contextLoss = {
    supported: await page.evaluate(() => {
      const gl = renderer.pixi.app.renderer.gl || renderer.pixi.app.renderer.context.gl;
      window.lossExtension = gl.getExtension('WEBGL_lose_context');
      if (lossExtension) lossExtension.loseContext();
      return !!lossExtension;
    }),
  };
  if (report.contextLoss.supported) {
    await page.waitForFunction(() => !renderer.pixi.active);
    await page.evaluate(() => render());
    await page.waitForTimeout(250);
    await page.evaluate(() => lossExtension.restoreContext());
    await page.waitForFunction(() => renderer.pixi.active);
    await page.evaluate(() => render());
    report.contextLoss.restored = true;
    assert.equal(await page.locator('.pixi-field').count(), 1);
    report.checks.push('Real WebGL context loss falls back and restores the same Pixi overlay');
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  await writeFile(new URL(`pixi-${browserName}.json`, evidence), JSON.stringify(report, null, 2) + '\n');
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
