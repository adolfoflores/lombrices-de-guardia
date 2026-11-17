import { CONFIG } from '../shared/config.js';
import { Terrain } from '../shared/terrain.js';

const W = CONFIG.worldWidth;
const H = CONFIG.worldHeight;
const SIZE = W * H;
const FAR = 72;
const TAU = Math.PI * 2;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function canvas() {
  const result = document.createElement('canvas');
  result.width = W;
  result.height = H;
  return result;
}

/**
 * A painted surface for the original Lomas de bronce silhouette. The image is
 * rebuilt on terrain revisions, never in the animation loop. Presentation is
 * derived only from the original map and the current authoritative mask, so a
 * reconnect produces exactly the same grass, exposed soil and scorched cuts.
 */
export class HillsTerrainPainter {
  constructor() {
    this.original = new Terrain('hills').data;
    this.grassDepth = this._grassDepth();
    this.baseCanvas = canvas();
    this.baseCtx = this.baseCanvas.getContext('2d', { willReadFrequently: true });
    this.output = this.baseCtx.createImageData(W, H);
    this.distance = new Uint8Array(SIZE);
    this.damageDistance = new Uint8Array(SIZE);
    this.texture = null;
    this._buildBase();
  }

  setTexture(image) {
    if (!image || !(image.naturalWidth || image.width)) return false;
    if (this.texture === image) return false;
    this.texture = image;
    this._buildBase();
    return true;
  }

  _grassDepth() {
    // Only air connected to the outside can support the original turf. Existing
    // enclosed tunnels retain exposed rock, as do all later blast cavities.
    const outside = new Uint8Array(SIZE);
    const queue = new Uint32Array(SIZE);
    let head = 0,
      tail = 0;
    const seed = (p) => {
      if (!this.original[p] && !outside[p]) {
        outside[p] = 1;
        queue[tail++] = p;
      }
    };
    for (let x = 0; x < W; x++) {
      seed(x);
      seed((H - 1) * W + x);
    }
    for (let y = 1; y < H - 1; y++) {
      seed(y * W);
      seed(y * W + W - 1);
    }
    while (head < tail) {
      const p = queue[head++],
        x = p % W;
      if (x) seed(p - 1);
      if (x < W - 1) seed(p + 1);
      if (p >= W) seed(p - W);
      if (p < SIZE - W) seed(p + W);
    }
    const depth = new Uint8Array(SIZE).fill(255);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const p = y * W + x;
        if (!this.original[p] || (y && (!outside[p - W] || this.original[p - W]))) continue;
        for (let d = 0; d < 22 && y + d < H && this.original[p + d * W]; d++) depth[p + d * W] = d;
      }
    }
    return depth;
  }

  _buildBase() {
    const ctx = this.baseCtx;
    ctx.clearRect(0, 0, W, H);
    const earth = ctx.createLinearGradient(0, 300, 0, H);
    earth.addColorStop(0, '#b87e4e');
    earth.addColorStop(0.3, '#a36d45');
    earth.addColorStop(0.65, '#8e5d40');
    earth.addColorStop(1, '#654738');
    ctx.fillStyle = earth;
    ctx.fillRect(0, 0, W, H);
    if (this.texture) {
      ctx.save();
      ctx.globalAlpha = 0.76;
      ctx.drawImage(this.texture, 0, 0, W, H);
      ctx.restore();
    }

    // Broad, irregular mineral seams give the small texture a deliberate scale.
    // They are permanently in world coordinates, including after destruction.
    for (let band = 0; band < (this.texture ? 0 : 7); band++) {
      const y = 370 + band * 83;
      const wave = (x) =>
        y + Math.sin(x / (115 + band * 17) + band * 1.6) * (9 + (band % 3) * 5) + Math.sin(x / 37 + band) * 3;
      const seam = (offset, width, color) => {
        ctx.beginPath();
        ctx.moveTo(-20, wave(-20) + offset);
        for (let x = 0; x <= W + 20; x += 20) ctx.lineTo(x, wave(x) + offset);
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        ctx.stroke();
      };
      seam(8, 17 + (band % 3) * 4, 'rgba(67,44,34,.11)');
      seam(0, 3 + (band % 2), 'rgba(229,168,99,.17)');
      seam(4, 2, 'rgba(60,42,34,.16)');
    }

    // Roots belong to intact natural turf, including the thin central shelf.
    // Clipping by the final mask naturally cuts them when soil is excavated.
    for (let x = 25; x < W; x += 54 + Math.floor(hash(x) * 61)) {
      for (let y = 1; y < H - 10; y++) {
        if (this.grassDepth[y * W + x] !== 0) continue;
        const length = 19 + hash(x * 73 + y) * (this.texture ? 29 : 45);
        const bend = (hash(x * 7) - 0.5) * 32;
        const branch = (offset, spread, amount, width) => {
          ctx.beginPath();
          ctx.moveTo(x + offset, y + 6);
          ctx.bezierCurveTo(
            x - 7 + offset,
            y + 21,
            x + bend + spread,
            y + length * 0.68,
            x + bend * 0.55 + spread,
            y + length * amount,
          );
          ctx.strokeStyle = this.texture ? 'rgba(79,48,28,.34)' : '#6b4a30';
          ctx.lineWidth = width + 1.1;
          ctx.stroke();
          ctx.strokeStyle = this.texture ? 'rgba(177,134,76,.60)' : '#a58a54';
          ctx.lineWidth = width;
          ctx.stroke();
        };
        branch(0, 0, 1, 1.65);
        branch(0, -12 - hash(x) * 10, 0.63, 0.8);
        branch(2, 13 + hash(x * 3) * 8, 0.82, 0.85);
      }
    }

    // Soft, angular stones with a dark bed, a pale top plane and restrained
    // facets: large enough to read beside a worm, sparse enough to leave air.
    for (let i = 0; i < (this.texture ? 0 : 155); i++) {
      const x = 10 + hash(i * 17 + 5) * (W - 20);
      const y = 375 + hash(i * 43 + 11) * 530;
      const rx = 3.5 + hash(i * 89 + 7) ** 2 * 16;
      const ry = rx * (0.42 + hash(i * 37 + 3) * 0.42);
      const angle = (hash(i * 97 + 2) - 0.5) * 0.85;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(46,34,28,.22)';
      ctx.beginPath();
      ctx.ellipse(2, 3, rx + 2, ry + 1.5, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-rx, 0);
      ctx.quadraticCurveTo(-rx * 0.9, -ry * 0.8, -rx * 0.34, -ry);
      ctx.quadraticCurveTo(rx * 0.22, -ry * 1.2, rx * 0.7, -ry * 0.62);
      ctx.quadraticCurveTo(rx * 1.15, -ry * 0.15, rx * 0.92, ry * 0.4);
      ctx.quadraticCurveTo(rx * 0.56, ry * 1.05, 0, ry * 0.9);
      ctx.quadraticCurveTo(-rx * 0.7, ry, -rx, 0);
      ctx.fillStyle = i % 3 ? '#88745b' : '#a4825b';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-rx * 0.83, -ry * 0.25);
      ctx.lineTo(-rx * 0.3, -ry * 0.83);
      ctx.lineTo(rx * 0.38, -ry * 0.8);
      ctx.lineTo(rx * 0.7, -ry * 0.26);
      ctx.lineTo(-rx * 0.12, -ry * 0.03);
      ctx.closePath();
      ctx.fillStyle = i % 3 ? '#b29b75' : '#c0a078';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(rx * 0.7, -ry * 0.26);
      ctx.lineTo(rx * 0.86, ry * 0.35);
      ctx.lineTo(rx * 0.2, ry * 0.78);
      ctx.lineTo(rx * 0.17, ry * 0.07);
      ctx.closePath();
      ctx.fillStyle = 'rgba(45,44,37,.17)';
      ctx.fill();
      ctx.restore();
    }
    for (let i = 0; i < (this.texture ? 0 : 580); i++) {
      const x = hash(i * 67 + 4) * W,
        y = 365 + hash(i * 113 + 8) * 535;
      ctx.fillStyle = i % 4 ? 'rgba(235,189,122,.13)' : 'rgba(43,32,26,.15)';
      ctx.beginPath();
      ctx.ellipse(x, y, 0.7 + hash(i * 23) * 1.7, 0.5 + hash(i * 13) * 0.9, hash(i) * TAU, 0, TAU);
      ctx.fill();
    }

    const image = ctx.getImageData(0, 0, W, H);
    const pixels = image.data;
    // Turf is painted once against the ORIGINAL exterior. Irregular thickness,
    // overlapping blades and the root shadow all stay inside solid pixels.
    for (let x = 0; x < W; x++) {
      const thickness =
        9 + Math.round(Math.sin(x * 0.21) * 2 + Math.sin(x * 0.79) * 1.4 + hash(Math.floor(x / 3)) * 2);
      for (let y = 0; y < H; y++) {
        const p = y * W + x,
          d = this.grassDepth[p];
        if (d > thickness + 3) continue;
        const offset = p * 4;
        if (d > thickness) {
          const shadow = 0.88 + (d - thickness) * 0.025;
          pixels[offset] *= shadow;
          pixels[offset + 1] *= shadow;
          pixels[offset + 2] *= shadow;
          continue;
        }
        const blade = (x + Math.floor(d * 0.4)) % 7 < 2;
        const tip = d < 2;
        const depth = d / thickness;
        const light = Math.sin(x * 0.13) * 5 + (blade ? 10 : -3);
        pixels[offset] = (tip ? 182 : 128 - depth * 52) + light;
        pixels[offset + 1] = (tip ? 190 : 151 - depth * 50) + light;
        pixels[offset + 2] = (tip ? 109 : 71 - depth * 22) + light * 0.4;
      }
    }
    this.basePixels = pixels;
  }

  _distanceFields(data) {
    const edge = this.distance,
      damage = this.damageDistance,
      original = this.original;
    // A bounded chamfer transform (3/4 weights) measures both the present edge
    // and removed original soil. Two linear scans, with no per-crater buffers.
    for (let y = 0, p = 0; y < H; y++) {
      for (let x = 0; x < W; x++, p++) {
        let e = data[p] ? FAR : 0;
        let d = original[p] && !data[p] ? 0 : FAR;
        if (x) {
          e = Math.min(e, edge[p - 1] + 3);
          d = Math.min(d, damage[p - 1] + 3);
        }
        if (y) {
          e = Math.min(e, edge[p - W] + 3);
          d = Math.min(d, damage[p - W] + 3);
          if (x) {
            e = Math.min(e, edge[p - W - 1] + 4);
            d = Math.min(d, damage[p - W - 1] + 4);
          }
          if (x < W - 1) {
            e = Math.min(e, edge[p - W + 1] + 4);
            d = Math.min(d, damage[p - W + 1] + 4);
          }
        }
        edge[p] = e;
        damage[p] = d;
      }
    }
    for (let y = H - 1, p = SIZE - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--, p--) {
        let e = edge[p],
          d = damage[p];
        if (x < W - 1) {
          e = Math.min(e, edge[p + 1] + 3);
          d = Math.min(d, damage[p + 1] + 3);
        }
        if (y < H - 1) {
          e = Math.min(e, edge[p + W] + 3);
          d = Math.min(d, damage[p + W] + 3);
          if (x) {
            e = Math.min(e, edge[p + W - 1] + 4);
            d = Math.min(d, damage[p + W - 1] + 4);
          }
          if (x < W - 1) {
            e = Math.min(e, edge[p + W + 1] + 4);
            d = Math.min(d, damage[p + W + 1] + 4);
          }
        }
        edge[p] = e;
        damage[p] = d;
      }
    }
  }

  paint(ctx, data, _options = {}) {
    if (!data || data.length !== SIZE) throw new Error('Máscara de Lomas de bronce inválida.');
    this._distanceFields(data);
    const pixels = this.output.data,
      base = this.basePixels;
    const edge = this.distance,
      burn = this.damageDistance;
    pixels.fill(0);
    for (let p = 0; p < SIZE; p++) {
      if (!data[p]) continue;
      const index = p * 4;
      let r = base[index],
        g = base[index + 1],
        b = base[index + 2];
      const distance = edge[p];
      let light = 0;
      if (distance < 36) {
        const x = p % W,
          y = Math.floor(p / W);
        const dx = edge[p + Math.min(3, W - x - 1)] - edge[p - Math.min(3, x)];
        const dy = edge[p + Math.min(3, H - y - 1) * W] - edge[p - Math.min(3, y) * W];
        light = clamp((dx * 0.4 + dy * 0.85) / 15, -1, 1);
        const shade = 1 + (light * 0.24 - 0.075) * (1 - distance / 36);
        r *= shade;
        g *= shade;
        b *= shade;
        if (distance <= 4 && this.grassDepth[p] > 16) {
          r *= 0.75;
          g *= 0.75;
          b *= 0.75;
        }
      }
      // The scorch is a property of missing original soil, not of a particular
      // explosion event. Newly exposed ledges therefore never grow fresh turf.
      const damage = burn[p] / 3;
      if (damage < 18) {
        const x = p % W,
          y = Math.floor(p / W);
        const variation = Math.sin(x * 0.34 + y * 0.19) * 3;
        let red, green, blue, mix;
        if (damage <= 2.5) {
          red = 47 + variation;
          green = 37 + variation * 0.7;
          blue = 31 + variation * 0.5;
          mix = 0.94;
        } else if (damage <= 6) {
          const t = (damage - 2.5) / 3.5;
          red = 91 + t * 56 + variation;
          green = 57 + t * 37;
          blue = 36 + t * 17;
          mix = 0.84;
        } else {
          red = 194 + variation;
          green = 132 + variation;
          blue = 75;
          mix = 0.37 * (1 - (damage - 6) / 12);
        }
        const bevel = 1 + light * 0.16;
        r += (red * bevel - r) * mix;
        g += (green * bevel - g) * mix;
        b += (blue * bevel - b) * mix;
      }
      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
      pixels[index + 3] = 255;
    }
    // putImageData avoids anti-aliased or translucent collision boundaries.
    // The caller may draw constructed metal with source-atop after this pass.
    ctx.putImageData(this.output, 0, 0);
  }

  destroy() {
    this.baseCanvas.width = 0;
    this.baseCanvas.height = 0;
    this.texture = null;
    this.original = null;
    this.grassDepth = null;
    this.basePixels = null;
    this.output = null;
    this.distance = null;
    this.damageDistance = null;
  }
}
