export const PIXI_PROJECTILE_KINDS = Object.freeze([
  'bazooka',
  'rocket',
  'grenade',
  'cluster',
  'fragment',
  'dynamite',
  'airstrike',
]);

export const EXPLOSIVE_KINDS = new Set([...PIXI_PROJECTILE_KINDS, 'mine']);

export const TAU = Math.PI * 2;

export const PARTICLE_GEOMETRY_SCALE = 32;

export const scaledPoints = (points) => points.map((value) => value * PARTICLE_GEOMETRY_SCALE);

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const noise = (n) => {
  const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
};

export const channel = (color, shift) => (color >> shift) & 255;

export const mixColor = (from, to, t) =>
  (Math.round(channel(from, 16) + (channel(to, 16) - channel(from, 16)) * t) << 16) |
  (Math.round(channel(from, 8) + (channel(to, 8) - channel(from, 8)) * t) << 8) |
  Math.round(channel(from, 0) + (channel(to, 0) - channel(from, 0)) * t);

export const COLORS = {
  hills: { earth: 0x796050, dust: 0xc4a47e, stone: 0x534a49 },
  cavern: { earth: 0x656779, dust: 0x9aa8ad, stone: 0x454b62 },
  islands: { earth: 0x9f714d, dust: 0xe0bb87, stone: 0x725644 },
};
