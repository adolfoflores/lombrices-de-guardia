const WORLD_W = 1600;
const WORLD_H = 900;
const ART_W = 2400;
const ART_H = 1350;
const OFFSET_X = (ART_W - WORLD_W) / 2;
const OFFSET_Y = (ART_H - WORLD_H) / 2;
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const COLORS = {
  cavern: ['#102a3a', '#234955', '#376163'],
  islands: ['#83c6d0', '#bbd9d1', '#e2d6b6'],
};

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function canvas(width = WORLD_W, height = WORLD_H) {
  const surface = document.createElement('canvas');
  surface.width = width;
  surface.height = height;
  return surface;
}

function gradient(ctx, colors, top = -OFFSET_Y, bottom = ART_H - OFFSET_Y) {
  const fill = ctx.createLinearGradient(0, top, 0, bottom);
  fill.addColorStop(0, colors[0]);
  fill.addColorStop(0.56, colors[1]);
  fill.addColorStop(1, colors[2]);
  return fill;
}

function makeLayer(paint) {
  // Background washes intentionally use a softer resolution than playable art.
  // Each plane is cached at 1600×900; the overscan has no per-frame geometry.
  const surface = canvas();
  const ctx = surface.getContext('2d');
  ctx.scale(WORLD_W / ART_W, WORLD_H / ART_H);
  ctx.translate(OFFSET_X, OFFSET_Y);
  paint(ctx);
  return surface;
}

function glow(ctx, x, y, radius, color) {
  const fill = ctx.createRadialGradient(x, y, 0, x, y, radius);
  fill.addColorStop(0, color);
  fill.addColorStop(1, '#00000000');
  ctx.fillStyle = fill;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function shape(ctx, points, fill) {
  ctx.beginPath();
  points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function crystal(ctx, x, floor, height, width, lean, color, light) {
  const tipX = x + lean,
    tipY = floor - height;
  shape(
    ctx,
    [
      [x - width, floor],
      [x - width * 0.8 + lean, tipY + height * 0.24],
      [tipX, tipY],
      [x + width * 0.75 + lean, tipY + height * 0.19],
      [x + width, floor],
    ],
    color,
  );
  shape(
    ctx,
    [
      [x, floor],
      [tipX, tipY],
      [x + width * 0.75 + lean, tipY + height * 0.19],
      [x + width, floor],
    ],
    light,
  );
}

function cavernFar(ctx) {
  ctx.fillStyle = gradient(ctx, COLORS.cavern);
  ctx.fillRect(-OFFSET_X, -OFFSET_Y, ART_W, ART_H);
  glow(ctx, 755, 380, 700, '#6aaba633');
  glow(ctx, 1300, 430, 470, '#829ecb1f');
  glow(ctx, 280, 630, 420, '#71c6b322');
  // Wide, receding curtains of stone frame a lit chamber, with no strong
  // horizontal ledges that could be mistaken for the actual playable shelves.
  for (const [x, width, depth, color] of [
    [-320, 520, 850, '#172f3c'],
    [120, 230, 650, '#1c3945'],
    [1420, 300, 720, '#1d3b47'],
    [1700, 420, 960, '#172f3c'],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, -OFFSET_Y);
    ctx.lineTo(x + width, -OFFSET_Y);
    ctx.bezierCurveTo(x + width * 0.45, 140, x + width * 1.05, 330, x + width * 0.63, depth);
    ctx.lineTo(x + width * 0.25, ART_H);
    ctx.lineTo(x - width * 0.2, ART_H);
    ctx.bezierCurveTo(x + width * 0.3, 480, x - width * 0.12, 180, x, -OFFSET_Y);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#41616a35';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(x + width * 0.62, -90);
    ctx.bezierCurveTo(x + width * 0.31, 200, x + width * 0.72, 380, x + width * 0.38, depth);
    ctx.stroke();
  }
  const rng = random(247);
  for (let i = 0; i < 38; i++) {
    const x = -100 + rng() * 1800,
      y = 110 + rng() * 860;
    ctx.fillStyle = i % 3 ? '#6a9f9b19' : '#a4b3bf16';
    ctx.beginPath();
    ctx.ellipse(x, y, 15 + rng() * 75, 4 + rng() * 14, -0.4, 0, TAU);
    ctx.fill();
  }
  for (const [x, floor, height] of [
    [230, 820, 106],
    [290, 850, 178],
    [1180, 910, 137],
    [1290, 880, 213],
  ]) {
    glow(ctx, x, floor - height * 0.5, height * 0.85, '#77c5bc18');
    crystal(ctx, x, floor, height, height * 0.16, height * 0.13, '#4c777c', '#58858a');
  }
  const mist = ctx.createLinearGradient(0, 620, 0, 1100);
  mist.addColorStop(0, '#8bc6bb00');
  mist.addColorStop(1, '#6caaa52b');
  ctx.fillStyle = mist;
  ctx.fillRect(-OFFSET_X, 620, ART_W, 540);
}

function cavernMiddle(ctx) {
  const rng = random(489);
  for (const x of [-260, 370, 970, 1740]) {
    const length = 210 + rng() * 200,
      width = 70 + rng() * 70;
    shape(
      ctx,
      [
        [x - width, -OFFSET_Y],
        [x + width, -OFFSET_Y],
        [x + width * 0.52, 43],
        [x + width * 0.25, length * 0.56],
        [x - width * 0.13, length],
        [x - width * 0.4, length * 0.36],
      ],
      '#2a4c56',
    );
    shape(
      ctx,
      [
        [x + width * 0.05, -OFFSET_Y],
        [x + width * 0.52, 43],
        [x + width * 0.25, length * 0.56],
        [x - width * 0.13, length],
        [x, length * 0.2],
      ],
      '#385d65',
    );
  }
  for (const [x, y, height, lean] of [
    [-110, 1100, 405, 65],
    [570, 1100, 250, -39],
    [1490, 1110, 390, -61],
    [1900, 1090, 305, 44],
  ]) {
    crystal(ctx, x, y, height, height * 0.14, lean, '#345d65', '#426d73');
  }
}

function cavernNear(ctx) {
  const rng = random(93);
  for (const [center, floor] of [
    [-260, 980],
    [480, 1120],
    [1220, 1090],
    [1910, 960],
  ]) {
    glow(ctx, center, floor - 90, 260, '#73beb222');
    for (let i = 0; i < 5; i++) {
      const x = center - 80 + rng() * 160,
        height = 72 + rng() * 160;
      crystal(
        ctx,
        x,
        floor,
        height,
        12 + rng() * 17,
        (rng() - 0.5) * 45,
        '#456f75',
        i % 2 ? '#5a8588' : '#527a85',
      );
    }
  }
  for (let i = 0; i < 25; i++) {
    const x = -250 + rng() * 2100,
      y = 80 + rng() * 900;
    ctx.fillStyle = '#99c1b746';
    ctx.beginPath();
    ctx.arc(x, y, 0.7 + rng(), 0, TAU);
    ctx.fill();
  }
}

function cloud(ctx, x, y, width, height, seed) {
  const rng = random(seed);
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-width / 2, height * 0.16);
  for (let i = 0; i < 7; i++) {
    const left = -width / 2 + (width * i) / 7,
      right = left + width / 7;
    const crest = -height * (0.18 + Math.sin((Math.PI * (i + 0.5)) / 7) * 0.61 + rng() * 0.17);
    ctx.bezierCurveTo(
      left + width / 28,
      crest,
      right - width / 28,
      crest,
      right,
      -height * Math.sin((Math.PI * (i + 1)) / 7) * 0.52,
    );
  }
  ctx.bezierCurveTo(width * 0.28, height * 0.17, -width * 0.27, height * 0.31, -width / 2, height * 0.16);
  ctx.fillStyle = '#f5ead1';
  ctx.fill();
  ctx.restore();
}

function island(ctx, x, floor, width, height, seed, color) {
  const rng = random(seed);
  ctx.beginPath();
  ctx.moveTo(x - width / 2, floor);
  ctx.bezierCurveTo(
    x - width * 0.31,
    floor - height * 0.12,
    x - width * 0.29,
    floor - height * 0.77,
    x - width * 0.07,
    floor - height * (0.9 + rng() * 0.16),
  );
  ctx.bezierCurveTo(
    x + width * 0.03,
    floor - height * 1.08,
    x + width * 0.15,
    floor - height * 0.43,
    x + width * 0.28,
    floor - height * 0.36,
  );
  ctx.bezierCurveTo(
    x + width * 0.38,
    floor - height * 0.39,
    x + width * 0.43,
    floor - height * 0.02,
    x + width / 2,
    floor,
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function palm(ctx, x, floor, height, seed) {
  const rng = random(seed),
    bend = (rng() - 0.5) * height * 0.6;
  const topX = x + bend,
    topY = floor - height;
  ctx.strokeStyle = '#7b9e94';
  ctx.lineWidth = 3 + height * 0.022;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, floor);
  ctx.quadraticCurveTo(x + bend * 0.3, floor - height * 0.65, topX, topY);
  ctx.stroke();
  for (let i = 0; i < 7; i++) {
    const direction = i % 2 ? 1 : -1;
    const length = height * (0.35 + rng() * 0.2),
      drop = (i - 2) * height * 0.055;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(
      topX + length * direction * 0.5,
      topY - height * 0.19,
      topX + length * direction,
      topY + drop,
    );
    ctx.quadraticCurveTo(topX + length * direction * 0.5, topY - height * 0.05, topX, topY + height * 0.045);
    ctx.fillStyle = i % 3 ? '#759a8e' : '#8aa79a';
    ctx.fill();
  }
}

function islandsFar(ctx) {
  ctx.fillStyle = gradient(ctx, COLORS.islands);
  ctx.fillRect(-OFFSET_X, -OFFSET_Y, ART_W, ART_H);
  glow(ctx, 240, 100, 400, '#fff0b964');
  ctx.fillStyle = '#f8e6b9';
  ctx.beginPath();
  ctx.arc(240, 100, 45, 0, TAU);
  ctx.fill();
  for (const values of [
    [-160, 215, 330, 42, 73],
    [370, 310, 270, 35, 13],
    [830, 160, 420, 47, 56],
    [1350, 280, 300, 42, 94],
    [1860, 120, 370, 43, 112],
  ])
    cloud(ctx, ...values);
  const sea = ctx.createLinearGradient(0, 665, 0, 1140);
  sea.addColorStop(0, '#aed1c4');
  sea.addColorStop(1, '#72aaab');
  ctx.fillStyle = sea;
  ctx.fillRect(-OFFSET_X, 665, ART_W, 500);
  for (const [x, y, width, height, seed] of [
    [-70, 680, 600, 108, 81],
    [660, 673, 470, 71, 43],
    [1350, 682, 710, 131, 71],
    [1950, 680, 390, 73, 18],
  ])
    island(ctx, x, y, width, height, seed, '#9bbdb4');
  const haze = ctx.createLinearGradient(0, 545, 0, 730);
  haze.addColorStop(0, '#e7e2c700');
  haze.addColorStop(0.7, '#dce1c827');
  haze.addColorStop(1, '#e7e2c700');
  ctx.fillStyle = haze;
  ctx.fillRect(-OFFSET_X, 545, ART_W, 185);
  const rng = random(147);
  for (let i = 0; i < 75; i++) {
    const x = -OFFSET_X + rng() * ART_W,
      y = 680 + rng() * 430;
    ctx.fillStyle = i % 3 ? '#e0e8d020' : '#75a8a213';
    ctx.fillRect(x, y, 20 + rng() * 100, 1 + rng() * 2);
  }
}

function islandsMiddle(ctx) {
  for (const [x, y, width, height, seed] of [
    [-190, 783, 640, 139, 57],
    [800, 777, 360, 59, 39],
    [1640, 794, 670, 153, 91],
  ])
    island(ctx, x, y, width, height, seed, '#85afa5');
  for (const [x, y, height, seed] of [
    [-75, 730, 65, 32],
    [20, 760, 49, 51],
    [1570, 705, 73, 43],
    [1720, 750, 60, 19],
  ])
    palm(ctx, x, y, height, seed);
}

function islandsNear(ctx) {
  for (const [x, y, width, height, seed] of [
    [-240, 975, 780, 172, 73],
    [1120, 1060, 630, 98, 25],
    [1900, 1000, 750, 207, 38],
  ])
    island(ctx, x, y, width, height, seed, '#80a99b');
  for (const [x, y, height, seed] of [
    [-100, 930, 119, 17],
    [70, 960, 83, 93],
    [1725, 935, 125, 52],
    [1860, 850, 100, 62],
  ])
    palm(ctx, x, y, height, seed);
}

/** Background presentation only; all navigable rock and water stay in Renderer. */
export class BiomeBackground {
  constructor(mapId) {
    this.mapId = mapId === 'cavern' ? 'cavern' : 'islands';
    this.destroyed = false;
    this.imageLoaded = false;
    this.sky = canvas(8, WORLD_H);
    const ctx = this.sky.getContext('2d');
    ctx.fillStyle = gradient(ctx, COLORS[this.mapId], 0, WORLD_H);
    ctx.fillRect(0, 0, 8, WORLD_H);
    const painters =
      this.mapId === 'cavern'
        ? [cavernFar, cavernMiddle, cavernNear]
        : [islandsFar, islandsMiddle, islandsNear];
    this.layers = painters.map((paint, index) => ({
      id: ['far', 'middle', 'near'][index],
      factor: [0.15, 0.35, 0.55][index],
      surface: makeLayer(paint),
    }));
    this.lastDraw = {
      mapId: this.mapId,
      layers: this.layers.map((layer) => ({ id: layer.id, factor: layer.factor })),
      reducedMotion: false,
      imageLoaded: false,
    };
  }

  setImage(image) {
    const width = image?.naturalWidth || image?.width,
      height = image?.naturalHeight || image?.height;
    if (this.destroyed || !width || !height) return false;
    const surface = this.layers[0].surface,
      ctx = surface.getContext('2d');
    const scale = Math.max(surface.width / width, surface.height / height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, surface.width, surface.height);
    ctx.drawImage(this.sky, 0, 0, surface.width, surface.height);
    ctx.drawImage(
      image,
      (surface.width - width * scale) / 2,
      (surface.height - height * scale) / 2,
      width * scale,
      height * scale,
    );
    this.imageLoaded = true;
    return true;
  }

  draw(ctx, { width, height, camera = {}, reducedMotion = false } = {}) {
    if (this.destroyed || !(width > 0) || !(height > 0)) return null;
    const base = Math.max(width / WORLD_W, height / WORLD_H);
    const relativeZoom = clamp((camera.zoom || base) / base, 0.5, 4);
    const deltaX = (Number.isFinite(camera.x) ? camera.x : WORLD_W / 2) - WORLD_W / 2;
    const deltaY = (Number.isFinite(camera.y) ? camera.y : WORLD_H / 2) - WORLD_H / 2;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.sky, 0, 0, width, height);
    for (let index = 0; index < this.layers.length; index++) {
      const layer = this.layers[index],
        factor = reducedMotion ? 0.15 : layer.factor;
      const scale = base * (1 + (relativeZoom - 1) * factor * 0.35);
      const drawWidth = ART_W * scale,
        drawHeight = ART_H * scale;
      const centeredX = (width - drawWidth) / 2,
        centeredY = (height - drawHeight) / 2;
      const x = clamp(centeredX - deltaX * scale * factor, width - drawWidth, 0);
      const y = clamp(centeredY - deltaY * scale * factor, height - drawHeight, 0);
      const alpha = !this.imageLoaded || !index ? 1 : index === 1 ? 0.15 : 0.22;
      ctx.globalAlpha = alpha;
      ctx.drawImage(layer.surface, x, y, drawWidth, drawHeight);
      Object.assign(this.lastDraw.layers[index], {
        factor,
        scale,
        x,
        y,
        width: drawWidth,
        height: drawHeight,
        offsetX: x - centeredX,
        offsetY: y - centeredY,
        alpha,
      });
    }
    ctx.restore();
    this.lastDraw.reducedMotion = reducedMotion;
    this.lastDraw.imageLoaded = this.imageLoaded;
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
