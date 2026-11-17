import { CONFIG } from '../../shared/config.js';

export const WORLD_W = CONFIG.worldWidth;

export const WORLD_H = CONFIG.worldHeight;

export const TAU = Math.PI * 2;

export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export const lerp = (a, b, t) => a + (b - a) * t;

export const PALETTES = {
  hills: {
    sky: ['#84c8d3', '#e1e4ba'],
    earth: [114, 79, 66],
    top: [208, 183, 76],
    water: '#387c91',
    deep: '#244e6c',
  },
  cavern: {
    sky: ['#101c36', '#254255'],
    earth: [76, 79, 107],
    top: [91, 161, 155],
    water: '#345d83',
    deep: '#1b2e53',
  },
  islands: {
    sky: ['#8cd4d7', '#ffe0b5'],
    earth: [151, 102, 70],
    top: [102, 164, 108],
    water: '#309b9f',
    deep: '#206a83',
  },
};

export const TEAM_MARKS = ['▲', '◆', '●', '■', '✦', '✚'];

export const TEAM_COLORS = ['#f38b63', '#66cacc', '#b4cf77'];

export const FLAG_W = 10;

export const HISTORY_MS = 5000;

export const REPLAY_TAIL_MS = 600;

export const SNAPSHOT_MS = 66.67;

export const BLOW_EVENTS = new Set(['explosion', 'damage', 'death', 'splash', 'shot', 'bat']);

export const PUNCH_ATTACK = 120,
  PUNCH_RELEASE = 350;

export const BEAT_HOLD = 150,
  BEAT_RECOVER = 200,
  BEAT_RATE = 0.35,
  BEAT_PUNCH = 0.2;

export const PERF = {
  window: 2000,
  slowMs: 22,
  fastMs: 17,
  slowFor: 2000,
  fastFor: 10000,
  cooldown: 10000,
  minSamples: 20,
};

export function circle(ctx, x, y, radius, fill) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

export function rounded(ctx, x, y, w, h, r = 5) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export function polygon(ctx, points, fill) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}
