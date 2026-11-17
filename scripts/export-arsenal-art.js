// Static inventory portraits rendered from the same original vector art as play.
// Run with: node scripts/export-arsenal-art.js (requires local Chrome).
// No runtime Pixi instance, network image service, or extra dependency is needed by the inventory.
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../public/art/arsenal/', import.meta.url);
const evidence = new URL('../docs/evidence/', import.meta.url);
const width = 320,
  height = 192;
const source = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Arsenal portraits</title>
<style>html,body{margin:0;background:transparent}</style><script type="module">
import { Application, Container, Rectangle } from 'pixi.js';
import { createToolArt } from '/client/art/weapons.js';
import { WEAPONS } from '/shared/config.js';
const angles={bazooka:-.19,grenade:.18,cluster:-.12,shotgun:-.22,dynamite:-.17,mine:-.06,bat:-.36,airstrike:.12,rope:-.15,jetpack:-.13,teleport:.14,girder:-.08};
const app=new Application();
await app.init({width:${width},height:${height},resolution:1,antialias:true,backgroundAlpha:0,preference:'webgl',autoStart:false});
window.exportPortraits=async()=>{
 const portraits=[];
 for(const weapon of WEAPONS){
  const frame=new Container();
  const art=createToolArt(weapon.id);
  // These are existing articulated pieces, frozen in a clear inventory pose.
  if(weapon.id==='jetpack'){art.parts.flame.visible=true;art.parts.flame.scale.y=.55;}
  if(weapon.id==='airstrike')art.parts.signal.visible=true;
  if(weapon.id==='girder')art.parts.plan.alpha=1;
  art.rotation=angles[weapon.id]||0;
  frame.addChild(art);app.stage.addChild(frame);
  const bounds=frame.getLocalBounds();
  const scale=Math.min((${width}-36)/bounds.width,(${height}-28)/bounds.height);
  frame.scale.set(scale);
  frame.position.set(${width}/2-(bounds.x+bounds.width/2)*scale,${height}/2-(bounds.y+bounds.height/2)*scale);
  app.renderer.render(app.stage);
  const canvas=app.renderer.extract.canvas({target:app.stage,frame:new Rectangle(0,0,${width},${height}),resolution:1,antialias:true});
  const data=canvas.toDataURL('image/png');
  portraits.push({id:weapon.id,name:weapon.name,data});
  app.stage.removeChild(frame);frame.destroy({children:true});
 }
 // A review sheet is a separate artifact; the shipped portraits remain transparent.
 const sheet=document.createElement('canvas');sheet.width=960;sheet.height=720;
 const ctx=sheet.getContext('2d');ctx.fillStyle='#142c35';ctx.fillRect(0,0,960,720);
 for(let i=0;i<portraits.length;i++){
  const x=(i%4)*240,y=Math.floor(i/4)*240;
  ctx.fillStyle='#203d43';ctx.fillRect(x+8,y+8,224,224);
  const img=new Image();img.src=portraits[i].data;await img.decode();
  ctx.drawImage(img,x+14,y+24,212,127.2);
  ctx.fillStyle='#fff0cd';ctx.font='bold 17px system-ui';ctx.textAlign='center';ctx.fillText(portraits[i].name,x+120,y+190);
  ctx.fillStyle='#8fa99d';ctx.font='12px system-ui';ctx.fillText(portraits[i].id,x+120,y+211);
 }
 return {portraits,sheet:sheet.toDataURL('image/png')};
};
window.ready=true;
</script></html>`;

let server, vite, browser;
const bytes = (data) => Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
try {
  await mkdir(output, { recursive: true });
  await mkdir(evidence, { recursive: true });
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
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.ready);
  const result = await page.evaluate(() => window.exportPortraits());
  if (errors.length) throw new Error(errors.join('\n'));
  let total = 0;
  for (const portrait of result.portraits) {
    const png = bytes(portrait.data);
    total += png.length;
    await writeFile(new URL(`${portrait.id}.png`, output), png);
    console.log(`${portrait.id.padEnd(10)} ${width} × ${height} · ${(png.length / 1024).toFixed(1)} KiB`);
  }
  await writeFile(new URL('arsenal-icons.png', evidence), bytes(result.sheet));
  console.log(
    `${result.portraits.length} transparent portraits · ${(total / 1024).toFixed(1)} KiB total. Contact sheet: docs/evidence/arsenal-icons.png`,
  );
} finally {
  await browser?.close();
  await vite?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
}
