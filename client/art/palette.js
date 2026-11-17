import { Graphics } from 'pixi.js';

/** Original vector artwork. All positions are world pixels; only transforms animate. */
export const CHARACTER_PALETTE = Object.freeze({
  outline: 0x352e38,
  skin: 0xf6b092,
  skinLight: 0xffd5b3,
  skinShade: 0xd97e78,
  skinDeep: 0x9c585d,
  cheek: 0xef917f,
  cream: 0xfff5db,
  ink: 0x223542,
  metal: 0x617c7b,
  metalDark: 0x354b52,
  metalLight: 0xafc6b5,
  olive: 0x8eaa65,
  oliveLight: 0xc6d68b,
  oliveDark: 0x51683f,
  brass: 0xe1b668,
  red: 0xe77c67,
  wood: 0xbe895f,
  smoke: 0xd3d5be,
  flame: 0xffcc66,
  flameCore: 0xfff1b8,
  team: 0xf3cb66,
  energy: 0x93e5d2,
});

/** Shared drawing helpers for characters, weapons and tools. */
const C = CHARACTER_PALETTE;
export const outline = (width = 1.4) => ({ color: C.outline, width, cap: 'round', join: 'round' });
export const stroke = (color, width = 1) => ({ color, width, cap: 'round', join: 'round' });
export const part = (parent, draw) => {
  const graphic = new Graphics();
  draw(graphic);
  parent.addChild(graphic);
  return graphic;
};

export function createHand(parent, x, y, size = 3.2) {
  const hand = part(parent, (g) => {
    g.ellipse(0, 0, size + 0.6, size)
      .fill(C.skinLight)
      .stroke(outline(1.15));
    g.moveTo(-0.8, 0.3).lineTo(-0.4, 1.5).moveTo(1, 0.2).lineTo(1.3, 1.3).stroke(stroke(C.skinShade, 0.65));
  });
  hand.position.set(x, y);
  return hand;
}
