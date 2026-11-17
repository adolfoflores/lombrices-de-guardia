import { CONFIG } from './config.js';

// Designed, deterministic silhouettes; no generated/procedural maps.
const HILLS = [
  [0, 640],
  [110, 600],
  [230, 510],
  [360, 500],
  [485, 590],
  [610, 635],
  [730, 555],
  [845, 550],
  [970, 620],
  [1100, 560],
  [1250, 490],
  [1380, 510],
  [1510, 600],
  [1600, 650],
];
const ISLANDS = [
  [
    [25, 700],
    [60, 620],
    [115, 580],
    [240, 580],
    [315, 650],
    [335, 800],
  ],
  [
    [365, 800],
    [390, 590],
    [440, 515],
    [545, 515],
    [600, 610],
    [620, 800],
  ],
  [
    [655, 800],
    [690, 650],
    [745, 610],
    [875, 610],
    [930, 680],
    [950, 800],
  ],
  [
    [985, 800],
    [1010, 530],
    [1070, 465],
    [1195, 465],
    [1250, 555],
    [1270, 800],
  ],
  [
    [1305, 800],
    [1330, 650],
    [1390, 575],
    [1510, 575],
    [1550, 650],
    [1585, 800],
  ],
];

export class Terrain {
  constructor(mapId = 'hills') {
    this.width = CONFIG.worldWidth;
    this.height = CONFIG.worldHeight;
    this.data = new Uint8Array(this.width * this.height);
    this.revision = 0;
    this.mapId = mapId;
    if (mapId === 'cavern') {
      this.rect(0, 55, this.width, 88);
      this.polygon([
        [0, 650],
        [130, 590],
        [270, 590],
        [380, 660],
        [540, 680],
        [650, 610],
        [800, 610],
        [930, 695],
        [1100, 650],
        [1190, 590],
        [1390, 590],
        [1600, 665],
        [1600, 900],
        [0, 900],
      ]);
      this.polygon([
        [65, 345],
        [370, 345],
        [410, 370],
        [370, 398],
        [65, 398],
        [40, 375],
      ]);
      this.polygon([
        [580, 395],
        [960, 395],
        [990, 420],
        [960, 447],
        [580, 447],
        [550, 420],
      ]);
      this.polygon([
        [1150, 325],
        [1510, 325],
        [1540, 350],
        [1510, 379],
        [1150, 379],
        [1120, 350],
      ]);
      // Broad passages through the lower shelf create genuine tunnel routes.
      this.rect(180, 710, 490, 80, false);
      this.rect(1010, 715, 420, 75, false);
      this.rect(420, 635, 76, 125, false);
      this.rect(1280, 650, 72, 105, false);
    } else if (mapId === 'islands') {
      for (const points of ISLANDS) this.polygon([...points, [points.at(-1)[0], 900], [points[0][0], 900]]);
      this.rect(705, 405, 210, 26);
    } else {
      this.polygon([...HILLS, [1600, 900], [0, 900]]);
      this.rect(650, 365, 290, 24);
      this.rect(185, 635, 250, 65, false);
      this.rect(1160, 625, 220, 72, false);
    }
    this.revision = 1;
    this._encodedRevision = -1;
  }

  solid(x, y) {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    return ix >= 0 && iy >= 0 && ix < this.width && iy < this.height && this.data[iy * this.width + ix] === 1;
  }

  rect(x, y, width, height, fill = true) {
    let changed = false;
    const left = Math.max(0, Math.floor(x)),
      right = Math.min(this.width, Math.ceil(x + width));
    const top = Math.max(0, Math.floor(y)),
      bottom = Math.min(this.height, Math.ceil(y + height));
    const value = fill ? 1 : 0;
    for (let row = top; row < bottom; row++) {
      const start = row * this.width + left;
      for (let col = 0; col < right - left; col++)
        if (this.data[start + col] !== value) {
          this.data[start + col] = value;
          changed = true;
        }
    }
    if (changed) this.revision++;
    return changed;
  }

  polygon(points) {
    const top = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]))));
    const bottom = Math.min(this.height - 1, Math.ceil(Math.max(...points.map((p) => p[1]))));
    for (let y = top; y <= bottom; y++) {
      const intersections = [];
      for (let a = 0, b = points.length - 1; a < points.length; b = a++) {
        const p = points[a],
          q = points[b];
        if (p[1] > y !== q[1] > y) intersections.push(p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const left = Math.max(0, Math.ceil(intersections[i])),
          right = Math.min(this.width, Math.ceil(intersections[i + 1]));
        this.data.fill(1, y * this.width + left, y * this.width + right);
      }
    }
    this.revision++;
  }

  circle(x, y, radius, fill = false) {
    if (![x, y, radius].every(Number.isFinite) || radius <= 0) return false;
    const value = fill ? 1 : 0;
    let changed = false;
    const top = Math.max(0, Math.floor(y - radius)),
      bottom = Math.min(this.height - 1, Math.ceil(y + radius));
    for (let row = top; row <= bottom; row++) {
      const dy = row - y;
      const span = Math.sqrt(Math.max(0, radius * radius - dy * dy));
      const left = Math.max(0, Math.ceil(x - span)),
        right = Math.min(this.width - 1, Math.floor(x + span));
      for (let col = left; col <= right; col++) {
        const index = row * this.width + col;
        if (this.data[index] !== value) {
          this.data[index] = value;
          changed = true;
        }
      }
    }
    if (changed) this.revision++;
    return changed;
  }

  girder(x, y, width = CONFIG.girderWidth, height = CONFIG.girderHeight) {
    return this.rect(x - width / 2, y - height / 2, width, height);
  }

  encode() {
    if (this._encodedRevision === this.revision) return this._encoded;
    const encoded = [];
    let value = this.data[0],
      count = 0;
    for (const cell of this.data) {
      if (cell === value) count++;
      else {
        encoded.push(value, count);
        value = cell;
        count = 1;
      }
    }
    encoded.push(value, count);
    this._encodedRevision = this.revision;
    this._encoded = encoded;
    return encoded;
  }

  static decode(encoded) {
    const data = new Uint8Array(CONFIG.worldWidth * CONFIG.worldHeight);
    let offset = 0;
    if (!Array.isArray(encoded) || encoded.length % 2) throw new Error('Terreno inválido.');
    for (let i = 0; i < encoded.length; i += 2) {
      const value = encoded[i],
        count = encoded[i + 1];
      if (
        (value !== 0 && value !== 1) ||
        !Number.isSafeInteger(count) ||
        count <= 0 ||
        offset + count > data.length
      )
        throw new Error('Terreno inválido.');
      if (value) data.fill(value, offset, offset + count);
      offset += count;
    }
    if (offset !== data.length) throw new Error('Terreno incompleto.');
    return data;
  }
}
