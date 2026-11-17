import { CONFIG } from '../shared/config.js';
import { Terrain } from '../shared/terrain.js';

const W = CONFIG.worldWidth,
  H = CONFIG.worldHeight,
  SIZE = W * H;
const FAR = 72,
  TAU = Math.PI * 2;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const hash = (value) => {
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

/**
 * Cached material painting for Gruta luminosa and Archipiélago coral. Every
 * visible pixel is clipped to the server mask. Natural surface deposits belong
 * only to the original map; newly excavated ledges cannot grow moss or beaches.
 */
export class BiomeTerrainPainter {
  constructor(mapId) {
    if (!['cavern', 'islands'].includes(mapId)) throw new Error('Bioma de terreno inválido.');
    this.mapId = mapId;
    this.original = new Terrain(mapId).data;
    this.surfaceDepth = this._surfaceDepth();
    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.width = W;
    this.baseCanvas.height = H;
    this.baseCtx = this.baseCanvas.getContext('2d', { willReadFrequently: true });
    this.output = this.baseCtx.createImageData(W, H);
    this.distance = new Uint8Array(SIZE);
    this.damageDistance = new Uint8Array(SIZE);
    this.texture = null;
    this._buildBase();
  }

  setTexture(image) {
    if (!image || !(image.naturalWidth || image.width) || this.texture === image) return false;
    this.texture = image;
    this._buildBase();
    return true;
  }

  _surfaceDepth() {
    const depth = new Uint8Array(SIZE).fill(255);
    // Both maps have deliberately authored upper ledges. Cave moss may belong
    // to an original tunnel floor, but never to a floor made by an explosion.
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const p = y * W + x;
        if (!this.original[p] || (y && this.original[p - W])) continue;
        for (let d = 0; d < 24 && y + d < H && this.original[p + d * W]; d++) depth[p + d * W] = d;
      }
    }
    return depth;
  }

  _buildBase() {
    const ctx = this.baseCtx,
      cavern = this.mapId === 'cavern';
    ctx.clearRect(0, 0, W, H);
    const fill = ctx.createLinearGradient(0, 0, W * 0.2, H);
    if (cavern) {
      fill.addColorStop(0, '#62667e');
      fill.addColorStop(0.48, '#4a586b');
      fill.addColorStop(1, '#354653');
    } else {
      fill.addColorStop(0, '#dfbb80');
      fill.addColorStop(0.43, '#c6a16d');
      fill.addColorStop(1, '#99704d');
    }
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, W, H);
    if (this.texture) {
      ctx.save();
      ctx.globalAlpha = cavern ? 0.82 : 0.79;
      ctx.drawImage(this.texture, 0, 0, W, H);
      ctx.restore();
    } else if (cavern) this._fallbackRock(ctx);
    else this._fallbackSand(ctx);

    const pixels = ctx.getImageData(0, 0, W, H).data;
    // These thin caps supply a clear playable edge at the worm's scale without
    // putting vegetation, shell sprites, or protruding rocks outside the mask.
    for (let x = 0; x < W; x++) {
      const thickness = cavern
        ? 4 + Math.round(Math.sin(x * 0.16) + hash(Math.floor(x / 4)) * 2)
        : 10 + Math.round(Math.sin(x * 0.18) * 1.5 + Math.sin(x * 0.63) + hash(Math.floor(x / 3)) * 2);
      for (let y = 0; y < H; y++) {
        const p = y * W + x,
          d = this.surfaceDepth[p];
        if (d > thickness + 3) continue;
        const index = p * 4;
        if (d > thickness) {
          const shadow = 0.9 + (d - thickness) * 0.025;
          pixels[index] *= shadow;
          pixels[index + 1] *= shadow;
          pixels[index + 2] *= shadow;
          continue;
        }
        const t = d / thickness;
        const variation = Math.sin(x * 0.29 + y * 0.07) * 4;
        let r, g, b, mix;
        if (cavern) {
          const moss = Math.sin(x / 67 + y / 41) + Math.cos(x / 31) > 1.1 && d < thickness - 1;
          r = moss ? 66 + variation : 126 - t * 36 + variation;
          g = moss ? 112 + variation : 152 - t * 39 + variation;
          b = moss ? 106 + variation : 165 - t * 42 + variation;
          mix = moss ? 0.74 : 0.52 * (1 - t * 0.55);
        } else {
          const grass =
            Math.sin(x * 0.019 + y * 0.004) + Math.sin(x * 0.071) * 0.45 > 1.08 && d < thickness * 0.56;
          const blade = (x + Math.floor(d * 0.5)) % 6 < 2;
          r = grass ? 91 - t * 23 + (blade ? 10 : 0) : 239 - t * 52 + variation;
          g = grass ? 137 - t * 29 + (blade ? 9 : 0) : 214 - t * 55 + variation;
          b = grass ? 99 - t * 25 : 155 - t * 52 + variation;
          mix = grass ? 0.94 : 0.85 - t * 0.24;
        }
        pixels[index] += (r - pixels[index]) * mix;
        pixels[index + 1] += (g - pixels[index + 1]) * mix;
        pixels[index + 2] += (b - pixels[index + 2]) * mix;
      }
    }
    this.basePixels = pixels;
  }

  _fallbackRock(ctx) {
    // Faceted slate, broad lavender seams and occasional embedded quartz.
    for (let i = 0; i < 110; i++) {
      const x = hash(i * 31 + 3) * W,
        y = hash(i * 79 + 7) * H;
      const rx = 21 + hash(i * 17 + 9) * 78,
        ry = 14 + hash(i * 53 + 1) * 39;
      ctx.beginPath();
      ctx.moveTo(x - rx, y - ry * 0.16);
      ctx.lineTo(x - rx * 0.32, y - ry);
      ctx.lineTo(x + rx * 0.7, y - ry * 0.64);
      ctx.lineTo(x + rx, y + ry * 0.26);
      ctx.lineTo(x + rx * 0.15, y + ry);
      ctx.lineTo(x - rx * 0.8, y + ry * 0.58);
      ctx.closePath();
      ctx.fillStyle = i % 3 ? 'rgba(136,142,168,.10)' : 'rgba(20,36,48,.15)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(171,176,193,.10)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    for (let i = 0; i < 13; i++) {
      ctx.beginPath();
      const baseY = i * 81 - 45;
      for (let x = -20; x <= W + 20; x += 20) {
        const y = baseY + x * 0.08 + Math.sin(x / 123 + i * 1.4) * 20;
        if (x === -20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(30,41,62,.25)';
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(158,149,182,.20)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
    for (let i = 0; i < 38; i++) {
      const x = 20 + hash(i * 101 + 12) * (W - 40),
        y = 30 + hash(i * 41 + 3) * (H - 60);
      const size = 5 + hash(i * 67 + 7) * 13;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((hash(i * 13) - 0.5) * 1.2);
      ctx.beginPath();
      ctx.moveTo(-size * 0.3, size);
      ctx.lineTo(-size * 0.42, -size * 0.45);
      ctx.lineTo(0, -size);
      ctx.lineTo(size * 0.37, -size * 0.4);
      ctx.lineTo(size * 0.27, size);
      ctx.closePath();
      ctx.fillStyle = i % 3 ? '#659591' : '#8888ae';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.37, -size * 0.4);
      ctx.lineTo(size * 0.27, size);
      ctx.lineTo(0, size * 0.8);
      ctx.closePath();
      ctx.fillStyle = i % 3 ? '#8eb6af' : '#aba9c5';
      ctx.fill();
      ctx.restore();
    }
  }

  _fallbackSand(ctx) {
    // Calm sandstone bands and fossils keep the archipelago lighter than hills.
    for (let i = 0; i < 12; i++) {
      const offset = i * 78 + 14;
      ctx.beginPath();
      for (let x = -10; x <= W + 10; x += 15) {
        const y = offset + Math.sin(x / (112 + i * 4) + i) * 14 + Math.sin(x / 39 + i) * 3;
        if (x === -10) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(109,76,46,.11)';
      ctx.lineWidth = 15;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(241,204,141,.23)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    for (let i = 0; i < 90; i++) {
      const x = hash(i * 37 + 3) * W,
        y = 300 + hash(i * 109 + 7) * 600;
      const size = 3 + hash(i * 29 + 1) * 10;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(hash(i * 17) * TAU);
      if (i % 3) {
        ctx.beginPath();
        ctx.moveTo(0, size * 0.6);
        ctx.arc(0, 0, size, Math.PI * 1.05, Math.PI * 1.95);
        ctx.closePath();
        ctx.fillStyle = i % 2 ? '#c8af88' : '#b99674';
        ctx.fill();
        ctx.strokeStyle = 'rgba(239,219,174,.45)';
        ctx.lineWidth = 0.8;
        for (let ray = 0; ray < 5; ray++) {
          const angle = Math.PI * (1.12 + ray * 0.19);
          ctx.beginPath();
          ctx.moveTo(0, size * 0.42);
          ctx.lineTo(Math.cos(angle) * size * 0.83, Math.sin(angle) * size * 0.83);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = '#c5a482';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, size);
        ctx.lineTo(-size * 0.12, -size);
        ctx.moveTo(0, size * 0.3);
        ctx.lineTo(-size * 0.7, -size * 0.45);
        ctx.moveTo(-size * 0.05, -size * 0.2);
        ctx.lineTo(size * 0.55, -size * 0.7);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (let i = 0; i < 1100; i++) {
      ctx.fillStyle = i % 3 ? 'rgba(243,219,169,.17)' : 'rgba(104,71,43,.13)';
      ctx.fillRect(
        hash(i * 53 + 2) * W,
        hash(i * 89 + 4) * H,
        0.7 + hash(i * 17) * 1.8,
        0.6 + hash(i * 71) * 1.1,
      );
    }
  }

  _distanceFields(data) {
    const edge = this.distance,
      damage = this.damageDistance,
      original = this.original;
    // Bounded 3/4 chamfer distances: two linear scans, constant-size buffers.
    for (let y = 0, p = 0; y < H; y++) {
      for (let x = 0; x < W; x++, p++) {
        let e = data[p] ? FAR : 0,
          d = original[p] && !data[p] ? 0 : FAR;
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

  paint(ctx, data) {
    if (!data || data.length !== SIZE) throw new Error('Máscara de bioma inválida.');
    this._distanceFields(data);
    const pixels = this.output.data,
      base = this.basePixels;
    const edge = this.distance,
      burn = this.damageDistance;
    const cavern = this.mapId === 'cavern';
    pixels.fill(0);
    for (let p = 0; p < SIZE; p++) {
      if (!data[p]) continue;
      const index = p * 4,
        distance = edge[p];
      let r = base[index],
        g = base[index + 1],
        b = base[index + 2],
        light = 0;
      if (distance < 39) {
        const x = p % W,
          y = Math.floor(p / W);
        const dx = edge[p + Math.min(3, W - x - 1)] - edge[p - Math.min(3, x)];
        const dy = edge[p + Math.min(3, H - y - 1) * W] - edge[p - Math.min(3, y) * W];
        light = clamp((dx * 0.45 + dy * 0.85) / 15, -1, 1);
        const shade = 1 + (light * (cavern ? 0.3 : 0.24) - 0.08) * (1 - distance / 39);
        r *= shade;
        g *= shade;
        b *= shade;
        if (distance <= 4 && this.surfaceDepth[p] > 16) {
          r *= cavern ? 0.69 : 0.77;
          g *= cavern ? 0.73 : 0.77;
          b *= cavern ? 0.79 : 0.77;
        }
        // A restrained wet rim on original rock catches cool ambient light.
        if (cavern && burn[p] === FAR && distance > 3 && distance < 12) {
          const wet = 0.1 * Math.max(0, light + 0.35) * (1 - distance / 15);
          r += (114 - r) * wet;
          g += (177 - g) * wet;
          b += (182 - b) * wet;
        }
      }
      const damage = burn[p] / 3;
      if (damage < 18) {
        const x = p % W,
          y = Math.floor(p / W);
        const grain = Math.sin(x * 0.31 + y * 0.23) * 3;
        let red, green, blue, mix;
        if (cavern) {
          if (damage <= 2.5) {
            red = 27 + grain;
            green = 32 + grain;
            blue = 40 + grain;
            mix = 0.96;
          } else if (damage <= 7) {
            const t = (damage - 2.5) / 4.5;
            red = 58 + t * 36 + grain;
            green = 65 + t * 39;
            blue = 79 + t * 44;
            mix = 0.88;
          } else {
            red = 153 + grain;
            green = 157 + grain;
            blue = 178;
            mix = 0.31 * (1 - (damage - 7) / 11);
          }
        } else if (damage <= 2.5) {
          red = 57 + grain;
          green = 43 + grain * 0.7;
          blue = 31 + grain * 0.5;
          mix = 0.95;
        } else if (damage <= 6) {
          const t = (damage - 2.5) / 3.5;
          red = 113 + t * 53 + grain;
          green = 75 + t * 44;
          blue = 45 + t * 30;
          mix = 0.87;
        } else {
          red = 209 + grain;
          green = 158 + grain;
          blue = 99;
          mix = 0.36 * (1 - (damage - 6) / 12);
        }
        const bevel = 1 + light * 0.17;
        r += (red * bevel - r) * mix;
        g += (green * bevel - g) * mix;
        b += (blue * bevel - b) * mix;
      }
      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
      pixels[index + 3] = 255;
    }
    // No antialiasing or material overlay may add partially solid boundary pixels.
    ctx.putImageData(this.output, 0, 0);
  }

  destroy() {
    this.baseCanvas.width = 0;
    this.baseCanvas.height = 0;
    this.texture = null;
    this.original = null;
    this.surfaceDepth = null;
    this.basePixels = null;
    this.output = null;
    this.distance = null;
    this.damageDistance = null;
  }
}
