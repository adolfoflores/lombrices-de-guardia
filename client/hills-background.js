const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 900;
const ART_WIDTH = 2400;
const ART_HEIGHT = 1350;
const ART_X = (ART_WIDTH - WORLD_WIDTH) / 2;
const ART_Y = (ART_HEIGHT - WORLD_HEIGHT) / 2;
const CACHE_SCALE = 0.8;
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function canvas(width, height) {
  const surface = document.createElement('canvas');
  surface.width = width;
  surface.height = height;
  return surface;
}

function makeLayer(paint) {
  const surface = canvas(ART_WIDTH * CACHE_SCALE, ART_HEIGHT * CACHE_SCALE);
  const ctx = surface.getContext('2d');
  ctx.scale(CACHE_SCALE, CACHE_SCALE);
  ctx.translate(ART_X, ART_Y);
  paint(ctx);
  return surface;
}

function ridgePath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], ART_HEIGHT - ART_Y);
  ctx.lineTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nextX, nextY] = points[i + 1];
    ctx.quadraticCurveTo(x, y, (x + nextX) / 2, (y + nextY) / 2);
  }
  ctx.lineTo(...points[points.length - 1]);
  ctx.lineTo(points[points.length - 1][0], ART_HEIGHT - ART_Y);
  ctx.closePath();
}

function paintedRidge(ctx, points, color, seed, { light = '#d0c59a', shade = '#597d79', strokes = 90 } = {}) {
  ridgePath(ctx, points);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const rng = random(seed);
  // Long translucent washes and short dry-brush marks are baked once; the
  // hills have broad painted variation without introducing a repeating tile.
  for (let i = 0; i < strokes; i++) {
    const x = -ART_X + rng() * ART_WIDTH;
    const y = 340 + rng() * 730;
    const length = 24 + rng() * 220;
    ctx.globalAlpha = 0.025 + rng() * 0.075;
    ctx.strokeStyle = i % 3 ? light : shade;
    ctx.lineWidth = 2 + rng() * 18;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + length * 0.32, y - 8, x + length * 0.71, y + 15, x + length, y + 4);
    ctx.stroke();
  }
  ctx.restore();
}

function cloud(ctx, x, y, width, height, seed) {
  const rng = random(seed);
  ctx.save();
  ctx.translate(x, y);
  const segments = 7;
  ctx.beginPath();
  ctx.moveTo(-width / 2, 4);
  for (let i = 0; i < segments; i++) {
    const left = -width / 2 + (width * i) / segments;
    const right = -width / 2 + (width * (i + 1)) / segments;
    const profile = Math.sin((Math.PI * (i + 0.5)) / segments);
    const crest = -height * (0.22 + profile * 0.62 + rng() * 0.17);
    const join = -height * Math.sin((Math.PI * (i + 1)) / segments) * 0.57;
    ctx.bezierCurveTo(left + 7, crest, right - 8, crest, right, join);
  }
  ctx.bezierCurveTo(width * 0.42, height * 0.2, -width * 0.32, height * 0.27, -width / 2, 4);
  const wash = ctx.createLinearGradient(0, -height, 0, height * 0.5);
  wash.addColorStop(0, '#f5e7c6');
  wash.addColorStop(0.6, '#ecdfbd');
  wash.addColorStop(1, '#d2d5bc');
  ctx.fillStyle = wash;
  ctx.fill();
  ctx.globalAlpha = 0.27;
  ctx.strokeStyle = '#fff2d2';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-width * 0.37, -height * 0.35);
  ctx.bezierCurveTo(-width * 0.12, -height * 0.42, width * 0.1, -height * 0.13, width * 0.34, -height * 0.24);
  ctx.stroke();
  ctx.restore();
}

function tree(
  ctx,
  x,
  floor,
  height,
  seed,
  { canopy = '#7f967d', light = '#a2aa85', trunk = '#81917c' } = {},
) {
  const rng = random(seed);
  const lean = (rng() - 0.5) * height * 0.16;
  const crown = floor - height * 0.64;
  const width = height * (0.45 + rng() * 0.18);
  ctx.save();
  ctx.strokeStyle = trunk;
  ctx.lineWidth = Math.max(2, height * 0.055);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, floor + 3);
  ctx.bezierCurveTo(
    x - lean * 0.3,
    floor - height * 0.3,
    x + lean,
    crown,
    x + lean * 0.8,
    floor - height * 0.86,
  );
  ctx.stroke();
  for (let branch = 0; branch < 4; branch++) {
    const direction = branch % 2 ? 1 : -1;
    ctx.lineWidth = Math.max(1, height * 0.027);
    ctx.beginPath();
    ctx.moveTo(x + lean * 0.35, floor - height * (0.33 + branch * 0.1));
    ctx.quadraticCurveTo(
      x + direction * width * 0.3,
      crown + height * 0.1,
      x + direction * width * 0.43,
      crown - height * 0.08,
    );
    ctx.stroke();
  }
  // One irregular continuous silhouette per tree, with independently varied
  // lobes and lean: no repeated circles or identical stamped tree sprites.
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const angle = (i / 24) * TAU;
    const radius = 0.82 + rng() * 0.24;
    const px = x + lean + Math.cos(angle) * width * radius;
    const py = crown + Math.sin(angle) * height * 0.38 * radius;
    if (!i) ctx.moveTo(px, py);
    else
      ctx.quadraticCurveTo(
        px,
        py,
        x + lean + Math.cos(angle + 0.11) * width * radius,
        crown + Math.sin(angle + 0.11) * height * 0.38 * radius,
      );
  }
  ctx.closePath();
  ctx.fillStyle = canopy;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.26;
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.ellipse(x + lean + width * 0.2, crown - height * 0.17, width * 0.88, height * 0.24, -0.2, 0, TAU);
  ctx.fill();
  for (let i = 0; i < 18; i++) {
    ctx.globalAlpha = 0.04 + rng() * 0.07;
    ctx.fillStyle = i % 3 ? light : trunk;
    ctx.beginPath();
    ctx.ellipse(
      x - width + rng() * width * 2,
      crown - height * 0.3 + rng() * height * 0.6,
      3 + rng() * 10,
      2 + rng() * 4,
      -0.2,
      0,
      TAU,
    );
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

function paintDistant(ctx) {
  const sky = ctx.createLinearGradient(0, -ART_Y, 0, WORLD_HEIGHT);
  sky.addColorStop(0, '#89b7bc');
  sky.addColorStop(0.47, '#c3d2bc');
  sky.addColorStop(1, '#e1d4ad');
  ctx.fillStyle = sky;
  ctx.fillRect(-ART_X, -ART_Y, ART_WIDTH, ART_HEIGHT);
  const glow = ctx.createRadialGradient(1250, 125, 8, 1250, 125, 370);
  glow.addColorStop(0, '#ffe5a966');
  glow.addColorStop(0.3, '#f8dfb035');
  glow.addColorStop(1, '#f5dfa900');
  ctx.fillStyle = glow;
  ctx.fillRect(850, -ART_Y, 800, 750);
  ctx.fillStyle = '#f8e2af';
  ctx.beginPath();
  ctx.arc(1250, 125, 47, 0, TAU);
  ctx.fill();
  for (const values of [
    [-240, 130, 330, 44, 71],
    [125, 220, 270, 38, 129],
    [510, 105, 360, 47, 96],
    [875, 265, 245, 30, 180],
    [1480, 210, 330, 43, 32],
    [1860, 116, 310, 37, 66],
  ])
    cloud(ctx, ...values);
  paintedRidge(
    ctx,
    [
      [-410, 550],
      [-210, 465],
      [20, 430],
      [190, 560],
      [380, 420],
      [570, 385],
      [760, 490],
      [1030, 350],
      [1210, 450],
      [1390, 408],
      [1590, 520],
      [1810, 410],
      [2010, 480],
    ],
    '#a8b9a5',
    148,
    { strokes: 75 },
  );
  paintedRidge(
    ctx,
    [
      [-410, 700],
      [-200, 575],
      [60, 650],
      [290, 505],
      [520, 590],
      [700, 570],
      [890, 655],
      [1100, 510],
      [1340, 615],
      [1540, 530],
      [1750, 630],
      [2010, 560],
    ],
    '#9eaf97',
    51,
    { strokes: 110 },
  );
  const haze = ctx.createLinearGradient(0, 370, 0, 900);
  haze.addColorStop(0, '#e9d9b300');
  haze.addColorStop(1, '#e4d1a64a');
  ctx.fillStyle = haze;
  ctx.fillRect(-ART_X, 370, ART_WIDTH, 760);
}

function paintMiddle(ctx) {
  const points = [
    [-410, 800],
    [-200, 690],
    [-10, 745],
    [170, 650],
    [360, 625],
    [590, 745],
    [830, 670],
    [1030, 720],
    [1240, 625],
    [1450, 715],
    [1650, 645],
    [1850, 760],
    [2010, 680],
  ];
  paintedRidge(ctx, points, '#91a087', 182, { strokes: 160, light: '#c6b88a', shade: '#728c80' });
  // Broken contour washes read as small farms and meadow folds in the distance.
  ctx.save();
  ridgePath(ctx, points);
  ctx.clip();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = '#cbb68a';
  ctx.lineCap = 'round';
  for (const [x, y, width] of [
    [-170, 760, 330],
    [180, 700, 240],
    [650, 760, 270],
    [1120, 730, 340],
    [1570, 760, 280],
  ]) {
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + width * 0.3, y - 24, x + width * 0.6, y + 25, x + width, y + 20);
    ctx.stroke();
  }
  ctx.restore();
  for (const [x, y, height, seed] of [
    [-190, 718, 55, 61],
    [100, 700, 67, 55],
    [335, 663, 73, 91],
    [775, 704, 65, 15],
    [1190, 670, 86, 49],
    [1550, 696, 59, 23],
    [1870, 740, 70, 54],
  ]) {
    tree(ctx, x, y, height, seed, { canopy: '#8b9d84', light: '#b0b28d', trunk: '#869780' });
  }
}

function paintNear(ctx) {
  const points = [
    [-410, 905],
    [-220, 823],
    [5, 870],
    [200, 820],
    [390, 850],
    [620, 775],
    [790, 845],
    [1040, 790],
    [1250, 855],
    [1460, 790],
    [1690, 870],
    [1870, 805],
    [2010, 860],
  ];
  paintedRidge(ctx, points, '#84987e', 745, { strokes: 125, light: '#b9ac81', shade: '#6b887b' });
  for (const [x, y, height, seed] of [
    [-245, 845, 130, 72],
    [82, 857, 104, 18],
    [462, 835, 95, 32],
    [680, 810, 123, 45],
    [1005, 819, 114, 87],
    [1405, 830, 135, 53],
    [1790, 851, 125, 99],
  ]) {
    tree(ctx, x, y, height, seed);
  }
  // Small shrubs are intentionally confined to the distant valley floor.
  // They never draw around the playable collision edge or look like platforms.
  const rng = random(619);
  for (let i = 0; i < 31; i++) {
    const x = -350 + rng() * 2300;
    const y = 890 + rng() * 120;
    tree(ctx, x, y, 19 + rng() * 24, i * 92 + 8, { canopy: '#81957a', light: '#a1a57e', trunk: '#7d927a' });
  }
}

/** Cached scenery only. It does not read or modify the playable terrain mask. */
export class HillsBackground {
  constructor() {
    this.destroyed = false;
    this.imageLoaded = false;
    this.sky = canvas(8, WORLD_HEIGHT);
    const ctx = this.sky.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
    gradient.addColorStop(0, '#89b7bc');
    gradient.addColorStop(0.55, '#c3d2bc');
    gradient.addColorStop(1, '#d3c8a2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 8, WORLD_HEIGHT);
    this.layers = [
      { id: 'far', factor: 0.15, surface: makeLayer(paintDistant) },
      { id: 'middle', factor: 0.35, surface: makeLayer(paintMiddle) },
      { id: 'vegetation', factor: 0.55, surface: makeLayer(paintNear) },
    ];
    this.lastDraw = null;
  }

  /** Accept an already decoded original panorama; loading remains the caller's. */
  setImage(image) {
    const imageWidth = image?.naturalWidth || image?.width;
    const imageHeight = image?.naturalHeight || image?.height;
    if (this.destroyed || !imageWidth || !imageHeight) return false;
    const surface = this.layers[0].surface;
    const ctx = surface.getContext('2d');
    const scale = Math.max(surface.width / imageWidth, surface.height / imageHeight);
    // Cover the whole oversized cache, so even extreme camera positions cannot
    // expose a transparent bitmap edge. Preserve the panorama's aspect ratio.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, surface.width, surface.height);
    ctx.drawImage(this.sky, 0, 0, surface.width, surface.height);
    ctx.drawImage(
      image,
      (surface.width - imageWidth * scale) / 2,
      (surface.height - imageHeight * scale) / 2,
      imageWidth * scale,
      imageHeight * scale,
    );
    this.imageLoaded = true;
    return true;
  }

  draw(ctx, { width, height, camera = {}, reducedMotion = false } = {}) {
    if (this.destroyed || !(width > 0) || !(height > 0)) return null;
    const base = Math.max(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    const relativeZoom = clamp((camera.zoom || base) / base, 0.5, 4);
    const deltaX = (Number.isFinite(camera.x) ? camera.x : WORLD_WIDTH / 2) - WORLD_WIDTH / 2;
    const deltaY = (Number.isFinite(camera.y) ? camera.y : WORLD_HEIGHT / 2) - WORLD_HEIGHT / 2;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.sky, 0, 0, width, height);
    const layers = [];
    for (const layer of this.layers) {
      // Reduced movement retains ordinary camera navigation while all scenery
      // planes share one transform, eliminating differential parallax entirely.
      const factor = reducedMotion ? 0.15 : layer.factor;
      const scale = base * (1 + (relativeZoom - 1) * factor * 0.35);
      const drawWidth = ART_WIDTH * scale;
      const drawHeight = ART_HEIGHT * scale;
      const centeredX = (width - drawWidth) / 2;
      const centeredY = (height - drawHeight) / 2;
      const x = clamp(centeredX - deltaX * scale * factor, width - drawWidth, 0);
      const y = clamp(centeredY - deltaY * scale * factor, height - drawHeight, 0);
      ctx.globalAlpha = this.imageLoaded && layer.id !== 'far' ? (layer.id === 'middle' ? 0.2 : 0.28) : 1;
      ctx.drawImage(layer.surface, x, y, drawWidth, drawHeight);
      layers.push({
        id: layer.id,
        factor,
        scale,
        x,
        y,
        width: drawWidth,
        height: drawHeight,
        offsetX: x - centeredX,
        offsetY: y - centeredY,
      });
    }
    ctx.restore();
    this.lastDraw = { layers, reducedMotion, imageLoaded: this.imageLoaded };
    return this.lastDraw;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sky.width = this.sky.height = 1;
    for (const layer of this.layers) layer.surface.width = layer.surface.height = 1;
    this.layers = [];
    this.lastDraw = null;
    this.imageLoaded = false;
  }
}
