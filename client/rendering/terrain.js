import { Terrain } from '../../shared/terrain.js';
import { maskTerrain } from '../prediction.js';
import { WORLD_W, WORLD_H, TAU, PALETTES, circle, polygon } from './primitives.js';

export function buildTerrain(renderer, encoded, mapId) {
  const data = Terrain.decode(encoded);
  renderer.terrainData = data;
  renderer.prediction.setTerrain(maskTerrain(data), renderer.state?.waterY);
  if (mapId === 'hills') {
    renderer.paintHills();
    return;
  }
  if (mapId === 'cavern' || mapId === 'islands') {
    renderer.paintBiome(mapId);
    return;
  }
  const image = renderer.terrainCtx.createImageData(WORLD_W, WORLD_H);
  const pixels = image.data;
  const palette = PALETTES[mapId] || PALETTES.hills;
  for (let p = 0; p < data.length; p++) {
    if (!data[p]) continue;
    const x = p % WORLD_W,
      y = Math.floor(p / WORLD_W);
    const surface = y < 5 || !data[p - WORLD_W * 5];
    const edge = x === 0 || x === WORLD_W - 1 || !data[p - 1] || !data[p + 1] || !data[p + WORLD_W];
    const band = (y + Math.sin(x / 77) * 13) % 69 < 3 ? -10 : 0;
    const noise = ((x * 37 + y * 101) % 19) - 9;
    const color = surface ? palette.top : palette.earth;
    const shade = (edge ? -23 : 0) + (surface ? 0 : -y / 100) + band + noise * 0.35;
    const index = p * 4;
    pixels[index] = color[0] + shade;
    pixels[index + 1] = color[1] + shade;
    pixels[index + 2] = color[2] + shade;
    pixels[index + 3] = 255;
  }
  renderer.terrainCtx.putImageData(image, 0, 0);
  const ctx = renderer.terrainCtx;
  ctx.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 340; i++) {
    const x = (i * 193 + 29) % WORLD_W,
      y = (i * 137 + 71) % WORLD_H;
    ctx.fillStyle = i % 3 ? 'rgba(255,228,184,.09)' : 'rgba(13,26,44,.14)';
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + (i % 11), 2 + (i % 4), i, 0, TAU);
    ctx.fill();
  }
  if (mapId === 'cavern')
    for (let i = 0; i < 23; i++) {
      const x = (i * 173 + 61) % WORLD_W,
        y = 90 + ((i * 131) % 710);
      polygon(
        ctx,
        [
          [x - 5, y + 14],
          [x, y - 13],
          [x + 7, y + 10],
        ],
        i % 2 ? '#79bcb6' : '#9c91bb',
      );
      polygon(
        ctx,
        [
          [x, y - 13],
          [x + 2, y + 10],
          [x + 7, y + 10],
        ],
        '#5e899a',
      );
    }
  renderer.drawGirders();
}

export function drawGirders(renderer) {
  const ctx = renderer.terrainCtx;
  ctx.globalCompositeOperation = 'source-atop';
  // Construction remains clipped by the authoritative collision mask, including
  // partial destruction and reconnects. No visual strut creates extra ground.
  for (const girder of renderer.state?.girders || []) {
    const left = Math.floor(girder.x - girder.width / 2),
      top = Math.floor(girder.y - girder.height / 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, girder.width, girder.height);
    ctx.clip();
    ctx.fillStyle = '#516d75';
    ctx.fillRect(left, top, girder.width, girder.height);
    ctx.fillStyle = '#304853';
    ctx.fillRect(left, top + 4, girder.width, girder.height - 7);
    ctx.strokeStyle = '#a2b3a3';
    ctx.lineWidth = 2;
    for (let x = left + 6; x < left + girder.width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, top + girder.height - 4);
      ctx.lineTo(x + 9, top + 4);
      ctx.lineTo(x + 18, top + girder.height - 4);
      ctx.stroke();
    }
    ctx.fillStyle = '#c2cbb2';
    ctx.fillRect(left, top, girder.width, 2);
    ctx.fillStyle = '#78938e';
    ctx.fillRect(left, top + 2, girder.width, 2);
    ctx.fillStyle = '#283d48';
    ctx.fillRect(left, top + girder.height - 3, girder.width, 3);
    for (let x = left + 5; x < left + girder.width - 2; x += 17) {
      ctx.fillStyle = '#e1b668';
      ctx.beginPath();
      ctx.arc(x, top + 3, 1.3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#a2b3a3';
      ctx.beginPath();
      ctx.arc(x, top + girder.height - 3, 1, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function buildBackground(renderer, mapId) {
  renderer.backgroundMap = mapId;
  if (mapId === 'hills') {
    renderer.ensureHills();
    return;
  }
  if (mapId === 'cavern' || mapId === 'islands') {
    renderer.ensureBiome(mapId);
    return;
  }
  const ctx = renderer.background.getContext('2d');
  const palette = PALETTES[mapId] || PALETTES.hills;
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  sky.addColorStop(0, palette.sky[0]);
  sky.addColorStop(1, palette.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  if (mapId === 'cavern') {
    for (let i = 0; i < 9; i++) {
      const x = i * 210 - 40;
      polygon(
        ctx,
        [
          [x, 0],
          [x + 150, 0],
          [x + 65, 220 + (i % 3) * 90],
        ],
        '#15243d',
      );
      polygon(
        ctx,
        [
          [x - 80, 900],
          [x + 180, 900],
          [x + 60, 530 + (i % 4) * 40],
        ],
        '#294a5d',
      );
    }
    for (let i = 0; i < 13; i++) {
      const x = (i * 137 + 75) % WORLD_W,
        y = 120 + ((i * 107) % 620);
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 120);
      glow.addColorStop(0, 'rgba(89,200,184,.12)');
      glow.addColorStop(1, 'rgba(89,200,184,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 120, y - 120, 240, 240);
      circle(ctx, x, y, 1.8, '#94c6bd');
    }
    return;
  }
  circle(ctx, mapId === 'islands' ? 1260 : 1240, 155, 68, '#f8d176');
  circle(ctx, mapId === 'islands' ? 1260 : 1240, 155, 87, '#f8d17625');
  for (let i = 0; i < 7; i++) {
    const x = i * 270 - 80,
      y = 170 + (i % 3) * 46;
    ctx.fillStyle = '#f7f0d9';
    ctx.beginPath();
    ctx.ellipse(x, y, 82, 15, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x - 15, y - 12, 43, 20, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 27, y - 8, 39, 16, 0, 0, TAU);
    ctx.fill();
  }
  if (mapId === 'islands') {
    polygon(
      ctx,
      [
        [0, 700],
        [230, 560],
        [345, 620],
        [590, 480],
        [780, 710],
        [1110, 560],
        [1350, 650],
        [1600, 530],
        [1600, 900],
        [0, 900],
      ],
      '#82bbb0',
    );
    polygon(
      ctx,
      [
        [0, 770],
        [230, 680],
        [520, 760],
        [870, 640],
        [1080, 710],
        [1380, 620],
        [1600, 720],
        [1600, 900],
        [0, 900],
      ],
      '#60a8a4',
    );
  } else {
    ctx.fillStyle = '#9eae87';
    ctx.beginPath();
    ctx.moveTo(0, 900);
    ctx.lineTo(0, 640);
    for (let x = 0; x <= 1600; x += 10) ctx.lineTo(x, 625 + Math.sin(x / 190) * 95 + Math.cos(x / 90) * 21);
    ctx.lineTo(1600, 900);
    ctx.fill();
    ctx.fillStyle = '#7e9b7a';
    ctx.beginPath();
    ctx.moveTo(0, 900);
    ctx.lineTo(0, 710);
    for (let x = 0; x <= 1600; x += 10) ctx.lineTo(x, 710 + Math.sin(x / 130 + 1) * 45);
    ctx.lineTo(1600, 900);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      const x = 140 + i * 197,
        y = 660 + Math.sin(x / 130 + 1) * 45;
      ctx.fillStyle = '#617c6c';
      ctx.fillRect(x - 3, y, 6, 55);
      circle(ctx, x - 13, y + 2, 21, '#718b70');
      circle(ctx, x + 12, y - 5, 27, '#718b70');
    }
  }
  ctx.strokeStyle = '#31536555';
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const x = 490 + i * 27,
      y = 230 + (i % 3) * 15;
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 3);
    ctx.quadraticCurveTo(x - 3, y - 3, x, y);
    ctx.quadraticCurveTo(x + 4, y - 3, x + 8, y + 2);
    ctx.stroke();
  }
}

export function drawAtmosphere(renderer, ctx, time) {
  if (renderer.state.mapId !== 'cavern') return;
  const n = renderer.view.reducedMotion ? 8 : 20;
  for (let i = 0; i < n; i++) {
    const t = renderer.view.reducedMotion ? 0 : time / 3500;
    const x = ((i * 173 + 65) % WORLD_W) + Math.sin(t + i) * 11;
    const y = 100 + ((i * 113) % 620) + Math.cos(t * 0.7 + i) * 15;
    circle(ctx, x, y, 1.3, `rgba(136,235,210,${0.2 + Math.sin(t + i) * 0.15})`);
  }
}

export function drawWater(renderer, ctx, time, palette, front) {
  const y = renderer.state.waterY ?? 820;
  if (!front) {
    const grad = ctx.createLinearGradient(0, y, 0, WORLD_H + 100);
    grad.addColorStop(0, palette.water);
    grad.addColorStop(1, palette.deep);
    ctx.fillStyle = grad;
    ctx.fillRect(-WORLD_W, y, WORLD_W * 3, WORLD_H + 200);
    return;
  }
  ctx.strokeStyle = '#c6ece3';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= WORLD_W; x += 8) {
    const v = renderer.view.reducedMotion ? 0 : Math.sin(x / 31 + time / 760) * 1.5;
    if (x === 0) ctx.moveTo(x, y + v);
    else ctx.lineTo(x, y + v);
  }
  ctx.stroke();
  if (renderer.quality !== 'low') {
    ctx.strokeStyle = '#d5f0df30';
    ctx.lineWidth = 2;
    for (let i = 0; i < 28; i++) {
      const x = (i * 137 + (renderer.view.reducedMotion ? 0 : time / 90)) % WORLD_W;
      const sy = y + 13 + ((i * 17) % 90);
      ctx.beginPath();
      ctx.moveTo(x, sy);
      ctx.lineTo(x + 17 + (i % 18), sy);
      ctx.stroke();
    }
  }
}
