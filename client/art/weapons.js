import { Container } from 'pixi.js';
import { CHARACTER_PALETTE as C, outline, stroke, part } from './palette.js';

export function createGrenadeArt({ scale = 1, pin = true } = {}) {
  const art = new Container();
  part(art, (g) => g.roundRect(-4.7, -5.7, 9.4, 12.5, 4).fill(C.oliveDark).stroke(outline(1.3)));
  // Six raised plates stay readable at the normal play zoom.
  part(art, (g) => {
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 2; col++) {
        g.roundRect(-3.6 + col * 4, -4.8 + row * 3.6, 3.1, 2.8, 0.6).fill(col ? C.olive : C.oliveLight);
      }
    g.roundRect(-2.7, -8, 5.3, 3, 0.9).fill(C.metalDark).stroke(outline(0.8));
    g.moveTo(-1.5, -8).lineTo(4.6, -7.2).lineTo(6, 3.5).stroke(stroke(C.metalLight, 1.7));
    if (pin) g.circle(-4.5, -8, 2.3).stroke(stroke(C.brass, 1.1));
  });
  art.scale.set(scale);
  return art;
}

export function createBazookaArt() {
  const art = new Container();
  part(art, (g) => {
    g.moveTo(-15, -5)
      .lineTo(-12, -6.8)
      .lineTo(-9, -5)
      .lineTo(-9, 5)
      .lineTo(-13, 6.3)
      .lineTo(-15, 4.6)
      .closePath()
      .fill(C.metalDark)
      .stroke(outline());
    g.roundRect(-12, -4.8, 31, 9.6, 2.2).fill(C.olive).stroke(outline());
    g.roundRect(-10.5, -3.8, 28, 2.4, 1).fill(C.oliveLight);
    g.rect(-10.5, 2.5, 29, 1.3).fill(C.oliveDark);
    g.roundRect(-7, -5.4, 3.1, 10.8, 0.9).fill(C.metal).stroke(outline(0.7));
    g.roundRect(10, -5.5, 3.4, 11, 0.8).fill(C.metal).stroke(outline(0.7));
    g.roundRect(17.5, -6.1, 5, 12.2, 1.6).fill(C.metalDark).stroke(outline());
    g.ellipse(22.2, 0, 1.7, 4.6).fill(C.ink).stroke(stroke(C.metalLight, 0.8));
    g.moveTo(2, 5).lineTo(1, 10).lineTo(5.1, 10).lineTo(6.1, 5).closePath().fill(C.wood).stroke(outline(1));
    g.roundRect(3.5, -8, 5.7, 2.8, 0.8).fill(C.metalDark).stroke(outline(0.8));
    g.rect(5.1, -7.6, 2.3, 1).fill(C.brass);
    g.moveTo(-0.4, -1.3).lineTo(3.7, 0).lineTo(-0.4, 1.3).closePath().fill(C.cream);
  });
  return art;
}

export function createClusterArt({ scale = 1, pin = true } = {}) {
  const art = new Container();
  art.parts = {};
  part(art, (g) => {
    g.ellipse(0, 1, 7.2, 7.3).fill(C.metalDark).stroke(outline(1.3));
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
      g.ellipse(Math.cos(a) * 3.8, 1 + Math.sin(a) * 3.8, 2.6, 2.8)
        .fill(i % 2 ? C.brass : C.flame)
        .stroke(outline(0.7));
    }
    g.circle(0, 1, 2.2).fill(C.metal).stroke(outline(0.8));
    g.moveTo(-1, 1).lineTo(1, 1).moveTo(0, 0).lineTo(0, 2).stroke(stroke(C.cream, 0.65));
    g.roundRect(-2.4, -8.2, 4.8, 3.2, 0.7).fill(C.metalDark).stroke(outline(0.8));
    if (pin) g.circle(-4.8, -7.5, 2.3).stroke(stroke(C.brass, 1));
  });
  art.parts.lever = part(art, (g) =>
    g.moveTo(-1.5, -8).lineTo(5.3, -7).lineTo(7.7, 2.7).stroke(stroke(C.metalLight, 1.6)),
  );
  art.parts.ember = part(art, (g) => g.circle(0, -8.5, 1.3).fill(C.flameCore));
  art.parts.ember.visible = false;
  art.scale.set(scale);
  return art;
}

export function createDynamiteArt({ scale = 1 } = {}) {
  const art = new Container();
  art.parts = {};
  part(art, (g) => {
    for (let i = 0; i < 3; i++) {
      g.roundRect(-6.8 + i * 4.6, -6, 4.8, 13, 1.5)
        .fill(i === 1 ? C.red : C.skinDeep)
        .stroke(outline(0.85));
      g.roundRect(-5.8 + i * 4.6, -4.8, 1.1, 10.5, 0.5).fill(C.skinLight);
      g.ellipse(-4.4 + i * 4.6, -5.5, 1.6, 0.7).fill(C.skinShade);
    }
    g.roundRect(-7, -2.7, 14.5, 2.4, 0.4).fill(C.brass).stroke(outline(0.7));
    g.roundRect(-7, 3, 14.5, 2.1, 0.4).fill(C.brass).stroke(outline(0.7));
    g.roundRect(-2.4, -0.8, 5, 4.2, 0.6).fill(C.metalDark).stroke(outline(0.7));
    g.moveTo(-1.2, 0.5).lineTo(0.4, 0.5).lineTo(-0.1, 2).lineTo(1.3, 2).stroke(stroke(C.cream, 0.7));
    g.moveTo(0, -6).quadraticCurveTo(1, -12, 5.7, -10).stroke(stroke(C.outline, 2));
    g.moveTo(0, -6).quadraticCurveTo(1, -12, 5.7, -10).stroke(stroke(C.brass, 1));
  });
  art.parts.ember = part(art, (g) =>
    g.star(5.7, -10, 5, 2.4, 1).fill(C.flame).circle(5.7, -10, 1).fill(C.flameCore),
  );
  art.scale.set(scale);
  return art;
}

export function createMineArt({ scale = 1 } = {}) {
  const art = new Container();
  art.parts = {};
  part(art, (g) => {
    g.ellipse(0, 2.2, 9, 3.8).fill(C.metalDark).stroke(outline(1.2));
    g.moveTo(-8, 1)
      .quadraticCurveTo(-7, -5.2, 0, -5.4)
      .quadraticCurveTo(7, -5.2, 8, 1)
      .quadraticCurveTo(0, 5.2, -8, 1)
      .closePath()
      .fill(C.olive)
      .stroke(outline(1.1));
    g.ellipse(0, -2, 4.8, 2.2).fill(C.oliveLight).stroke(outline(0.7));
    g.moveTo(-6, 0.2).lineTo(-5, 0.6).moveTo(5, 0.6).lineTo(6, 0.2).stroke(stroke(C.metalLight, 1.4));
    g.circle(-6, 1.5, 0.8).fill(C.brass);
    g.circle(6, 1.5, 0.8).fill(C.brass);
    g.roundRect(-2.8, 0.8, 5.6, 2.1, 0.7).fill(C.metalDark);
  });
  art.parts.light = part(art, (g) => g.circle(0, 1.8, 1.05).fill(C.cream));
  art.parts.light.tint = C.red;
  art.scale.set(scale);
  return art;
}

/** Supply crate under a striped canopy. `parts.swing` pivots at the canopy so a
 *  descending crate sways like a pendulum; `parts.chute` folds away after landing. */
export function createCrateArt({ scale = 1 } = {}) {
  const art = new Container();
  art.parts = {};
  const swing = new Container();
  swing.pivot.set(0, -30);
  swing.position.set(0, -30);
  const chute = new Container();
  part(chute, (g) => {
    g.moveTo(-19, -24).arc(0, -24, 19, Math.PI, 0).closePath().fill(C.red);
    for (const [from, to] of [
      [0.5, 0.95],
      [1.35, 1.8],
      [2.2, 2.65],
    ]) {
      g.moveTo(0, -24)
        .arc(0, -24, 19, Math.PI + from, Math.PI + to)
        .closePath()
        .fill(C.cream);
    }
    g.moveTo(-19, -24).arc(0, -24, 19, Math.PI, 0).closePath().stroke(outline(1.3));
    g.rect(-19, -25.4, 38, 1.9).fill(C.skinDeep);
    g.circle(0, -43.4, 1.7).fill(C.cream).stroke(outline(0.8));
    for (const [x, tx] of [
      [-18.5, -7],
      [-7, -5.5],
      [7, 5.5],
      [18.5, 7],
    ])
      g.moveTo(x, -23.6).lineTo(tx, -8).stroke(stroke(C.ink, 0.9));
  });
  swing.addChild(chute);
  const box = part(swing, (g) => {
    g.ellipse(0, 8.6, 9.5, 3).fill({ color: C.outline, alpha: 0.28 });
    g.roundRect(-8, -8, 16, 16, 1.8).fill(C.wood).stroke(outline(1.3));
    g.rect(-7, -6.6, 14, 1).fill(C.skinLight);
    g.rect(-7, -3, 14, 1.3).fill(C.skinDeep);
    g.rect(-7, 1.9, 14, 1.3).fill(C.skinDeep);
    g.rect(-5.4, -8, 1.7, 16).fill(C.metal);
    g.rect(3.7, -8, 1.7, 16).fill(C.metal);
    for (const y of [-6, 6]) {
      g.circle(-4.55, y, 0.75).fill(C.brass);
      g.circle(4.55, y, 0.75).fill(C.brass);
    }
    g.roundRect(-3.4, -3.4, 6.8, 6.8, 1).fill(C.cream).stroke(outline(0.7));
    g.star(0, 0.2, 5, 2.9, 1.3, 0).fill(C.brass);
  });
  art.addChild(swing);
  art.parts = { swing, chute, box };
  art.scale.set(scale);
  return art;
}

/** Each tool owns reusable articulated pieces; factories never start a ticker. */
export function createToolArt(weapon) {
  if (weapon === 'bazooka') return createBazookaArt();
  if (weapon === 'grenade') return createGrenadeArt();
  if (weapon === 'cluster') return createClusterArt();
  if (weapon === 'dynamite') return createDynamiteArt();
  if (weapon === 'mine') return createMineArt();
  const art = new Container();
  art.parts = {};
  if (weapon === 'shotgun') {
    part(art, (g) => {
      g.moveTo(-13, -3)
        .lineTo(-4, -3)
        .lineTo(2, 1)
        .lineTo(-5, 6)
        .lineTo(-13, 4)
        .closePath()
        .fill(C.wood)
        .stroke(outline());
      g.moveTo(-11, -1)
        .quadraticCurveTo(-8, 0, -5, 2)
        .moveTo(-11, 2)
        .lineTo(-8, 3)
        .stroke(stroke(C.brass, 0.8));
      g.roundRect(-1, -5, 26, 4.8, 1.1).fill(C.metalDark).stroke(outline());
      g.rect(4, -4.4, 19.3, 1.1).fill(C.metalLight);
      g.roundRect(1, -0.4, 21, 2.3, 0.7).fill(C.metal).stroke(outline(0.7));
      g.roundRect(-3.5, -4.7, 10, 7, 1.4).fill(C.metal).stroke(outline(1));
      g.roundRect(-0.8, -3.2, 4.8, 1.9, 0.4).fill(C.ink);
      g.moveTo(1, 2).quadraticCurveTo(6, 6, 1, 7).lineTo(-2, 5).closePath().stroke(outline(1));
      g.moveTo(0.6, 2).lineTo(0.3, 4.7).stroke(stroke(C.brass, 0.9));
      g.roundRect(23, -5.7, 2.3, 6, 0.5).fill(C.metalDark).stroke(outline(0.7));
      g.rect(20.4, -7, 1.7, 2).fill(C.brass);
    });
    art.parts.pump = part(art, (g) => {
      g.roundRect(7, -0.7, 9.7, 5, 1.4).fill(C.wood).stroke(outline(0.9));
      for (let i = 0; i < 4; i++)
        g.moveTo(8.6 + i * 2, 0.1)
          .lineTo(8.6 + i * 2, 3.5)
          .stroke(stroke(C.skinDeep, 0.7));
      g.moveTo(8.4, 0.2).lineTo(15.5, 0.2).stroke(stroke(C.brass, 0.6));
    });
    art.parts.chamber = part(art, (g) => g.roundRect(-0.3, -2.9, 3.9, 1.3, 0.3).fill(C.brass));
  } else if (weapon === 'bat') {
    part(art, (g) => {
      g.moveTo(-7, 1.3)
        .quadraticCurveTo(4, -0.7, 10, -3.7)
        .quadraticCurveTo(20, -8.3, 23, -2.5)
        .quadraticCurveTo(25, 2.7, 13, 4.5)
        .lineTo(-6, 5.3)
        .closePath()
        .fill(C.wood)
        .stroke(outline(1.3));
      g.moveTo(6, 1)
        .quadraticCurveTo(14, -2.7, 20, -1.6)
        .moveTo(10, 2.1)
        .quadraticCurveTo(16, 0.3, 20, 0.7)
        .stroke(stroke(C.brass, 0.8));
      g.ellipse(17, -0.5, 2.5, 1.2).stroke(stroke(C.skinDeep, 0.6));
      g.moveTo(-5.3, 1.5)
        .lineTo(-4, 4.9)
        .moveTo(-3.2, 1.2)
        .lineTo(-2, 4.8)
        .moveTo(-1, 0.8)
        .lineTo(0.2, 4.5)
        .moveTo(1.1, 0.4)
        .lineTo(2.2, 4.2)
        .stroke(stroke(C.cream, 1));
      g.roundRect(-8, 0.7, 2.6, 5.1, 1).fill(C.brass).stroke(outline(0.8));
    });
  } else if (weapon === 'rope') {
    part(art, (g) => {
      g.roundRect(-6, -3.7, 20, 7.4, 2).fill(C.metal).stroke(outline(1.2));
      g.roundRect(8, -4.8, 5.8, 9.6, 1.1).fill(C.metalDark).stroke(outline(0.8));
      g.rect(-3, -2.4, 10, 1.1).fill(C.metalLight);
      g.moveTo(-2, 3.2)
        .lineTo(-3, 9)
        .lineTo(2, 8.8)
        .lineTo(4, 3.2)
        .closePath()
        .fill(C.wood)
        .stroke(outline(1));
    });
    art.parts.spool = part(art, (g) => {
      g.circle(-4, 0, 5.1).fill(C.brass).stroke(outline(1));
      g.circle(-4, 0, 3.2).stroke(stroke(C.wood, 0.9));
      g.moveTo(-7, 0).lineTo(-1, 0).moveTo(-4, -3).lineTo(-4, 3).stroke(stroke(C.cream, 0.7));
      g.circle(-4, 0, 1.1).fill(C.metalDark);
    });
    art.parts.spool.pivot.set(-4, 0);
    art.parts.spool.position.set(-4, 0);
    art.parts.hook = part(art, (g) => {
      g.moveTo(13, 0)
        .lineTo(23, 0)
        .moveTo(20, 0)
        .quadraticCurveTo(24, -6, 18, -6)
        .moveTo(20, 0)
        .quadraticCurveTo(24, 6, 18, 6)
        .stroke(stroke(C.outline, 3));
      g.moveTo(13, 0)
        .lineTo(23, 0)
        .moveTo(20, 0)
        .quadraticCurveTo(24, -6, 18, -6)
        .moveTo(20, 0)
        .quadraticCurveTo(24, 6, 18, 6)
        .stroke(stroke(C.metalLight, 1.5));
    });
  } else if (weapon === 'jetpack') {
    part(art, (g) => {
      g.roundRect(-7, -8, 12, 18, 3.2).fill(C.metalDark).stroke(outline(1.2));
      for (const x of [-6, 0]) {
        g.roundRect(x, -10, 5, 18.5, 2.3).fill(C.metal).stroke(outline(0.9));
        g.roundRect(x + 0.8, -8, 1.2, 12, 0.6).fill(C.metalLight);
        g.roundRect(x - 0.4, 4.5, 5.8, 2.2, 0.6)
          .fill(C.brass)
          .stroke(outline(0.7));
        g.roundRect(x, 7, 5, 3.2, 0.7).fill(C.metalDark).stroke(outline(0.8));
        g.moveTo(x + 0.7, -8.9)
          .lineTo(x + 4, -8.9)
          .stroke(stroke(C.cream, 0.7));
      }
      g.moveTo(4, -4).quadraticCurveTo(11, -6, 12, 1).stroke(stroke(C.outline, 3));
      g.moveTo(4, -4).quadraticCurveTo(11, -6, 12, 1).stroke(stroke(C.brass, 1.5));
      g.roundRect(-1.7, -5.7, 2.6, 8.7, 0.8).fill(C.ink);
    });
    art.parts.fuel = part(art, (g) => g.roundRect(-1.15, -4.8, 1.5, 7, 0.4).fill(C.oliveLight));
    art.parts.fuel.pivot.set(0, 2.2);
    art.parts.fuel.y = 2.2;
    art.parts.flame = part(art, (g) => {
      for (const x of [-3.6, 2.5]) {
        g.moveTo(x - 2, 10)
          .quadraticCurveTo(x - 3, 18, x, 25)
          .quadraticCurveTo(x + 3, 18, x + 2, 10)
          .closePath()
          .fill(C.red);
        g.moveTo(x - 1.4, 10)
          .quadraticCurveTo(x - 2, 17, x, 21)
          .quadraticCurveTo(x + 2, 16, x + 1.4, 10)
          .closePath()
          .fill(C.flame);
        g.moveTo(x - 0.8, 10)
          .lineTo(x, 17)
          .lineTo(x + 0.8, 10)
          .closePath()
          .fill(C.flameCore);
      }
    });
    art.parts.flame.pivot.set(0, 10);
    art.parts.flame.y = 10;
    art.parts.flame.visible = false;
    art.parts.light = part(art, (g) => g.circle(-4, -6.5, 1.2).fill(C.oliveLight));
  } else if (weapon === 'airstrike') {
    part(art, (g) => {
      g.roundRect(-7, -8, 14, 18, 2.5).fill(C.oliveDark).stroke(outline(1.3));
      g.roundRect(-5.4, -6.4, 10.8, 5.6, 1).fill(C.metalDark).stroke(outline(0.7));
      g.moveTo(-5, -8).lineTo(-7.5, -19).stroke(stroke(C.outline, 2.8));
      g.moveTo(-5, -8).lineTo(-7.5, -19).stroke(stroke(C.metalLight, 1.2));
      g.roundRect(1, -10.5, 4, 3, 0.6).fill(C.metal).stroke(outline(0.7));
      for (let i = 0; i < 3; i++)
        g.moveTo(-3.5, 2.4 + i * 2)
          .lineTo(2, 2.4 + i * 2)
          .stroke(stroke(C.ink, 1));
      g.circle(4, 6, 1.6).fill(C.red).stroke(outline(0.6));
      g.moveTo(-7, -2).lineTo(-9, -2).lineTo(-9, 4).lineTo(-7, 4).stroke(stroke(C.brass, 1.5));
    });
    art.parts.light = part(art, (g) => {
      g.roundRect(-4.3, -5.4, 8.6, 3.7, 0.5).fill(C.oliveLight);
      g.moveTo(-2.5, -3.5)
        .lineTo(2.2, -3.5)
        .moveTo(-0.3, -5)
        .lineTo(1, -3.5)
        .lineTo(-0.3, -2)
        .stroke(stroke(C.oliveDark, 0.6));
    });
    art.parts.signal = part(art, (g) => {
      g.arc(-7.5, -19, 4, -0.9, 0.8).stroke(stroke(C.cream, 1));
      g.arc(-7.5, -19, 7, -0.9, 0.8).stroke(stroke(C.brass, 0.9));
    });
    art.parts.signal.visible = false;
  } else if (weapon === 'teleport') {
    part(art, (g) => {
      g.moveTo(-3, 3)
        .lineTo(-5, 10)
        .lineTo(0, 11)
        .lineTo(4, 4)
        .closePath()
        .fill(C.metalDark)
        .stroke(outline(1));
      g.ellipse(1, -1, 8.2, 8.9).fill(C.metal).stroke(outline(1.2));
      g.ellipse(1, -1, 5.7, 6.4).fill(C.ink).stroke(stroke(C.brass, 1));
      for (const [x, y] of [
        [1, -9],
        [-6, -1],
        [8, -1],
        [1, 7],
      ])
        g.circle(x, y, 1.1).fill(C.brass).stroke(outline(0.4));
      g.roundRect(-5.8, -0.3, 3.1, 3.2, 0.7).fill(C.metalLight).stroke(outline(0.5));
    });
    art.parts.coil = part(art, (g) => {
      g.ellipse(1, -1, 4.2, 4.8).stroke(stroke(C.energy, 1.3));
      g.moveTo(-2, -1).lineTo(4, -1).moveTo(1, -4).lineTo(1, 2).stroke(stroke(C.cream, 0.9));
    });
    art.parts.coil.pivot.set(1, -1);
    art.parts.coil.position.set(1, -1);
    art.parts.light = part(art, (g) => g.ellipse(1, -1, 3, 3.4).fill({ color: C.energy, alpha: 0.24 }));
  } else if (weapon === 'girder') {
    part(art, (g) => {
      g.moveTo(-4, 6)
        .lineTo(9, -7)
        .lineTo(7, -11)
        .lineTo(10, -15)
        .lineTo(11, -10)
        .lineTo(15, -8)
        .lineTo(18, -11)
        .lineTo(17, -5)
        .lineTo(12, -3)
        .lineTo(-1, 10)
        .closePath()
        .fill(C.metalLight)
        .stroke(outline(1.2));
      g.moveTo(-2, 6).lineTo(7, -3).stroke(stroke(C.metal, 1.5));
      g.roundRect(-7, -2, 10, 8, 1.5).fill(C.wood).stroke(outline(1));
      g.rect(-5.5, -0.7, 7, 1.3).fill(C.brass);
      g.circle(-3, 3, 1.1).fill(C.metalDark);
    });
    art.parts.plan = part(art, (g) => {
      g.roundRect(-12, -19, 23, 10, 1.5)
        .fill({ color: C.metalDark, alpha: 0.85 })
        .stroke(stroke(C.metalLight, 0.7));
      g.moveTo(-9, -16)
        .lineTo(8, -16)
        .moveTo(-9, -12)
        .lineTo(8, -12)
        .moveTo(-7, -16)
        .lineTo(-2, -12)
        .lineTo(3, -16)
        .lineTo(7, -12)
        .stroke(stroke(C.oliveLight, 0.8));
    });
    art.parts.plan.alpha = 0.8;
    art.parts.plan.position.set(15, 1);
  }
  return art;
}
