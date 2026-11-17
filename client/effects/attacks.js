import { TAU, clamp, noise, COLORS } from './primitives.js';

export function fire(renderer, event, now, options) {
  const angle = Number.isFinite(event.angle) ? event.angle : -Math.PI / 4;
  const dx = Math.cos(angle),
    dy = Math.sin(angle);
  const rocket = event.weapon === 'bazooka' || event.weapon === 'rocket';
  if (['shotgun', 'bat', 'rope', 'jetpack', 'teleport', 'girder'].includes(event.weapon)) return;
  if (event.weapon === 'airstrike') {
    if (Number.isFinite(event.targetX) && Number.isFinite(event.targetY))
      renderer.airstrikeCall(event, now, options);
    return;
  }
  if (event.weapon === 'dynamite' || event.weapon === 'mine') {
    const facing = Math.cos(angle) < 0 ? -1 : 1;
    renderer.spawn(
      'ring',
      now,
      options,
      {
        x: event.x + facing * 15,
        y: event.y + 5,
        color: event.weapon === 'mine' ? 0xb8cc8b : 0xf2bd7c,
        size: 5,
        endSize: options.reducedMotion ? 8 : 17,
        aspectY: 0.28,
        life: 280,
        alpha: 0.65,
      },
      true,
    );
    return;
  }
  const x = event.x + dx * (rocket ? 31 : 20),
    y = event.y + dy * (rocket ? 31 : 20);
  if (!rocket) {
    // A tiny release accent; a thrown grenade never gets a firearm muzzle flash.
    if (!options.reducedMotion)
      for (let i = 0; i < 3; i++) {
        renderer.spawn(
          'spark',
          now,
          options,
          {
            x: x - dx * i * 4,
            y: y - dy * i * 4,
            color: 0xffe7b0,
            size: 2.5,
            endSize: 0.2,
            life: 160,
            rotation: angle,
            vx: -dx * 12,
            vy: -dy * 12,
            alpha: 0.65,
          },
          true,
        );
      }
    return;
  }
  renderer.launchRocket(event, x, y, dx, dy, angle, now, options);
}

export function launchRocket(renderer, event, x, y, dx, dy, angle, now, options) {
  const reduced = !!options.reducedMotion,
    low = options.quality === 'low';
  const wind = Number.isFinite(options.wind) ? options.wind : 0;
  const earth = COLORS[options.mapId] || COLORS.hills;
  const px = -dy,
    py = dx;
  renderer.spawn(
    'flash',
    now,
    options,
    {
      x,
      y,
      color: 0xffc461,
      size: 16,
      endSize: reduced ? 17 : 34,
      life: 120,
      alpha: 0.95,
      rotation: angle,
      mode: 'flash',
      blend: 'add',
    },
    true,
  );
  renderer.spawn(
    'disc',
    now,
    options,
    { x, y, color: 0xfff4d6, size: 6.5, endSize: 1.5, life: 90, alpha: 0.95, mode: 'flash' },
    true,
  );
  renderer.spawn(
    'disc',
    now,
    options,
    {
      x,
      y,
      color: 0xff9640,
      size: 9,
      endSize: reduced ? 12 : 24,
      life: 170,
      alpha: 0.45,
      mode: 'flash',
      blend: 'add',
    },
    true,
  );
  renderer.spawn(
    'ring',
    now,
    options,
    {
      x: x + dx * 5,
      y: y + dy * 5,
      color: 0xffe9bb,
      size: 5,
      endSize: reduced ? 14 : 30,
      aspectY: 0.5,
      rotation: angle,
      life: 210,
      alpha: 0.6,
    },
    true,
  );
  const bx = event.x - dx * 15,
    by = event.y - dy * 15;
  if (reduced) {
    for (let i = 0; i < 3; i++)
      renderer.spawn('cloud', now, options, {
        x: bx + px * (i - 1) * 4,
        y: by + py * (i - 1) * 4,
        color: 0xd9d6c3,
        size: 3,
        endSize: 8,
        life: 320,
        alpha: 0.3,
        vy: -7,
      });
    return;
  }
  const sparks = low ? 3 : 5;
  for (let i = 0; i < sparks; i++) {
    const a = angle + (i - (sparks - 1) / 2) * 0.16,
      v = 200 + (i % 3) * 55;
    renderer.spawn(
      'spark',
      now,
      options,
      {
        x,
        y,
        color: 0xffe09a,
        endColor: 0xff7d3b,
        size: 3 + (i % 2),
        endSize: 0.2,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        gravity: 230,
        drag: 1.5,
        rotation: a,
        life: 240 + i * 45,
        alpha: 0.95,
        blend: 'add',
      },
      true,
    );
  }
  // Backblast: hot gas vents from the breech and cools into grey smoke.
  const clouds = low ? 5 : 9;
  for (let i = 0; i < clouds; i++) {
    const spread = (i - (clouds - 1) / 2) * 0.12,
      a = angle + Math.PI + spread;
    const v = 105 + (i % 3) * 32 - Math.abs(spread) * 160;
    renderer.spawn('cloud', now + (i % 3) * 12, options, {
      x: bx + px * spread * 14,
      y: by + py * spread * 14,
      color: i % 2 ? 0xffcf9a : 0xeadfca,
      endColor: i % 3 === 0 ? 0x7f8886 : 0xb1b6b0,
      size: 4 + (i % 3),
      endSize: 13 + (i % 3) * 4,
      life: 800 + i * 50,
      alpha: 0.55,
      mode: 'smoke',
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 10,
      drag: 3.4,
      driftX: wind * 0.9,
      driftY: -14,
      rotation: a,
      spin: i % 2 ? 0.55 : -0.55,
    });
  }
  renderer.spawn(
    'disc',
    now,
    options,
    {
      x: bx,
      y: by,
      color: 0xffb066,
      size: 7,
      endSize: 16,
      life: 140,
      alpha: 0.4,
      mode: 'flash',
      blend: 'add',
    },
    true,
  );
  for (let i = 0; i < 3; i++) {
    const a = angle + Math.PI + (i - 1) * 0.3,
      v = 150 + i * 40;
    renderer.spawn(
      'spark',
      now,
      options,
      {
        x: bx,
        y: by,
        color: 0xffcf8a,
        endColor: 0xff8a4a,
        size: 2.6,
        endSize: 0.2,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        gravity: 170,
        drag: 1.8,
        rotation: a,
        life: 300 + i * 50,
        alpha: 0.9,
        blend: 'add',
      },
      true,
    );
  }
  // The blast kicks dust from the ground behind a standing shooter.
  if (options.worm?.grounded !== false) {
    const back = dx < 0 ? 1 : -1,
      puffs = low ? 3 : 6;
    for (let i = 0; i < puffs; i++) {
      const n = noise(++renderer.serial);
      renderer.spawn('cloud', now + i * 18, options, {
        x: event.x + back * (4 + i * 3),
        y: event.y + 9,
        color: earth.dust,
        size: 2 + n * 1.5,
        endSize: 7 + n * 5,
        life: 560 + n * 260,
        alpha: 0.42,
        vx: back * (55 + n * 95),
        vy: -(8 + n * 26),
        drag: 3,
        driftX: wind * 0.6,
        driftY: -5,
        rotation: n * TAU,
        spin: back * 0.4,
      });
    }
  }
  // Muzzle smoke lingers after the shot and drifts with the wind.
  for (let i = 0; i < (low ? 1 : 3); i++) {
    const n = noise(++renderer.serial);
    renderer.spawn('cloud', now + 40 + i * 30, options, {
      x: x - dx * i * 4,
      y: y - dy * i * 4,
      color: 0xe0dccb,
      endColor: 0x9ca29e,
      size: 3,
      endSize: 13 + n * 5,
      life: 1100 + n * 400,
      alpha: 0.38,
      mode: 'smoke',
      vx: dx * 30 + px * (n - 0.5) * 30,
      vy: dy * 30 + py * (n - 0.5) * 30,
      drag: 2.5,
      driftX: wind,
      driftY: -13,
      rotation: n * TAU,
      spin: (n - 0.5) * 1.2,
    });
  }
}

export function shotgun(renderer, event, now, options) {
  if (![event.endX, event.endY].every(Number.isFinite)) return;
  const dx = event.endX - event.x,
    dy = event.endY - event.y;
  const angle = Number.isFinite(event.angle) ? event.angle : Math.atan2(dy, dx);
  const distance = Math.hypot(dx, dy);
  const muzzle = Math.min(32, distance);
  const x = event.x + Math.cos(angle) * muzzle,
    y = event.y + Math.sin(angle) * muzzle;
  const length = Math.max(0, distance - muzzle);
  if (length > 0)
    renderer.spawn(
      'beam',
      now,
      options,
      {
        x,
        y,
        color: 0xffedb4,
        size: length,
        endSize: length,
        aspectY: 1.7 / length,
        rotation: angle,
        life: options.reducedMotion ? 65 : 100,
        alpha: 0.8,
      },
      true,
    );
  renderer.spawn(
    'flash',
    now,
    options,
    { x, y, color: 0xffd474, size: 9, endSize: 16, aspectY: 0.65, rotation: angle, life: 100, alpha: 0.95 },
    true,
  );
  renderer.spawn('cloud', now, options, {
    x,
    y,
    color: 0xe2dfca,
    size: 2,
    endSize: 8,
    vx: Math.cos(angle) * 15,
    vy: -10,
    life: 360,
    alpha: 0.3,
  });
  if (!options.reducedMotion)
    renderer.spawn(
      'shell',
      now,
      options,
      {
        x: event.x + Math.cos(angle) * 13,
        y: event.y + Math.sin(angle) * 13,
        size: 3.7,
        endSize: 3.7,
        vx: -Math.cos(angle) * 50,
        vy: -75,
        gravity: 290,
        spin: 9,
        rotation: angle,
        life: 650,
        alpha: 1,
      },
      true,
    );
  const hit = event.hit === 'worm' || event.hit === 'terrain';
  if (!hit) return;
  const color = event.hit === 'worm' ? 0xffd995 : (COLORS[options.mapId] || COLORS.hills).dust;
  const count = options.reducedMotion ? 2 : options.quality === 'low' ? 5 : 9;
  for (let i = 0; i < count; i++) {
    const a = angle + Math.PI + (i - (count - 1) / 2) * 0.25;
    renderer.spawn(
      event.hit === 'worm' ? 'spark' : 'shard',
      now,
      options,
      {
        x: event.endX,
        y: event.endY,
        color,
        size: 2 + (i % 2),
        endSize: 0.1,
        vx: options.reducedMotion ? 0 : Math.cos(a) * (30 + i * 5),
        vy: options.reducedMotion ? 0 : Math.sin(a) * (30 + i * 5) - 13,
        gravity: options.reducedMotion ? 0 : 90,
        rotation: a,
        life: 150 + (i % 3) * 45,
        alpha: 0.85,
      },
      true,
    );
  }
}

export function bat(renderer, event, now, options) {
  const angle = Number.isFinite(event.angle) ? event.angle : 0;
  const x = event.originX ?? event.x - Math.cos(angle) * 25;
  const y = event.originY ?? event.y - Math.sin(angle) * 25;
  renderer.spawn(
    'arc',
    now,
    options,
    {
      x,
      y,
      color: 0xffe7ab,
      size: 28,
      endSize: options.reducedMotion ? 31 : 45,
      rotation: angle,
      life: 180,
      alpha: 0.72,
    },
    true,
  );
  if (!options.reducedMotion)
    renderer.spawn(
      'arc',
      now + 25,
      options,
      { x, y, color: 0xcda477, size: 24, endSize: 38, rotation: angle - 0.14, life: 160, alpha: 0.42 },
      true,
    );
  // A swing can miss; only confirmed contact positions get impact stars.
  for (const hit of event.hits || []) {
    if (![hit.x, hit.y].every(Number.isFinite)) continue;
    renderer.spawn(
      'flash',
      now,
      options,
      {
        x: hit.x,
        y: hit.y,
        color: 0xffe7a3,
        size: 7,
        endSize: 20,
        rotation: angle + 0.3,
        life: 190,
        alpha: 0.9,
      },
      true,
    );
    if (!options.reducedMotion)
      for (let i = 0; i < 4; i++) {
        const a = angle + (i - 1.5) * 0.55;
        renderer.spawn(
          'spark',
          now,
          options,
          {
            x: hit.x,
            y: hit.y,
            color: 0xffd778,
            size: 4,
            endSize: 1,
            vx: Math.cos(a) * 100,
            vy: Math.sin(a) * 100,
            rotation: a,
            life: 260,
            alpha: 0.85,
          },
          true,
        );
      }
  }
}

export function explode(renderer, event, now, options) {
  const earth = COLORS[options.mapId] || COLORS.hills;
  const radius = clamp(event.radius || 45, 12, 150);
  const reduced = !!options.reducedMotion;
  const budget = options.quality === 'low' ? 0.5 : 1;
  const { x, y } = event;
  const seed = ++renderer.serial * 2.399;
  const style = {
    cluster: { outer: 0xe2a14e, inner: 0xffdc81, heart: 0xfff1c1, smoke: earth.dust, upward: 18 },
    fragment: { outer: 0xcb874c, inner: 0xffc365, heart: 0xffedb1, smoke: earth.dust, upward: 20 },
    dynamite: { outer: 0xdc6545, inner: 0xffb14e, heart: 0xfff2c9, smoke: earth.earth, upward: 60 },
    mine: { outer: 0xd9844d, inner: 0xf7d47a, heart: 0xfaffc6, smoke: earth.earth, upward: 65 },
    airstrike: { outer: 0xdd7e47, inner: 0xffd878, heart: 0xfff6d2, smoke: 0x85908d, upward: 45 },
    bazooka: {
      outer: 0xee7a42,
      inner: 0xffc65e,
      heart: 0xfff2ba,
      smoke: earth.dust,
      upward: 34,
      plume: true,
    },
    rocket: {
      outer: 0xee7a42,
      inner: 0xffc65e,
      heart: 0xfff2ba,
      smoke: earth.dust,
      upward: 34,
      plume: true,
    },
  }[event.weapon] || { outer: 0xe97746, inner: 0xffc65e, heart: 0xfff2ba, smoke: earth.dust, upward: 28 };
  // Warm outer bloom, bright heart, then exposed crater and soft earth-colored dust.
  renderer.spawn(
    'disc',
    now,
    options,
    {
      x,
      y,
      color: style.outer,
      size: radius * 0.25,
      endSize: radius * (reduced ? 0.8 : 1.06),
      life: reduced ? 180 : 280,
      alpha: reduced ? 0.55 : 0.85,
      mode: 'flash',
    },
    true,
  );
  renderer.spawn(
    'flash',
    now,
    options,
    {
      x,
      y,
      color: style.inner,
      size: radius * 0.18,
      endSize: radius * (reduced ? 0.62 : 0.91),
      life: 180,
      alpha: 0.9,
      mode: 'flash',
      rotation: seed,
    },
    true,
  );
  renderer.spawn(
    'disc',
    now,
    options,
    {
      x,
      y,
      color: style.heart,
      size: radius * 0.12,
      endSize: radius * 0.55,
      life: 135,
      alpha: 0.95,
      mode: 'flash',
    },
    true,
  );
  if (!reduced) {
    renderer.spawn(
      'ring',
      now,
      options,
      { x, y, color: 0xffe5a2, size: radius * 0.3, endSize: radius * 1.48, life: 410, alpha: 0.7 },
      true,
    );
  }
  const clouds = reduced ? 3 : Math.round(9 * budget);
  for (let i = 0; i < clouds; i++) {
    const a = seed + (i * TAU) / clouds;
    const offset = reduced ? radius * 0.18 : radius * 0.34;
    renderer.spawn('cloud', now, options, {
      x: x + Math.cos(a) * offset,
      y: y + Math.sin(a) * offset,
      color: i % 3 === 0 ? earth.earth : style.smoke,
      size: radius * 0.14,
      endSize: radius * (reduced ? 0.32 : 0.44),
      life: reduced ? 430 : 630 + (i % 3) * 110,
      alpha: reduced ? 0.24 : 0.43,
      vx: reduced ? 0 : Math.cos(a) * (28 + (i % 4) * 12),
      vy: reduced ? -8 : Math.sin(a) * 30 - style.upward,
      spin: reduced ? 0 : i % 2 ? 0.2 : -0.2,
      rotation: a,
    });
  }
  if (reduced) return;
  if (style.plume) renderer.plume(x, y, radius, earth, seed, now, options);
  if (event.weapon === 'cluster')
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI + 0.3 + (i * (Math.PI - 0.6)) / 4;
      renderer.spawn(
        'spark',
        now,
        options,
        {
          x,
          y,
          color: 0xffedb1,
          size: 9,
          endSize: 1,
          vx: Math.cos(a) * 110,
          vy: Math.sin(a) * 110,
          rotation: a,
          life: 240,
          alpha: 0.9,
        },
        true,
      );
    }
  if (event.weapon === 'dynamite')
    renderer.spawn(
      'ring',
      now + 70,
      options,
      {
        x,
        y,
        color: 0xf2be85,
        size: radius * 0.7,
        endSize: radius * 1.65,
        aspectY: 0.75,
        life: 430,
        alpha: 0.45,
      },
      true,
    );
  const debris = Math.round(15 * budget);
  for (let i = 0; i < debris; i++) {
    const a = seed + i * 2.399;
    const velocity = 80 + (i % 5) * 29;
    renderer.spawn(
      'shard',
      now,
      options,
      {
        x: x + Math.cos(a) * radius * 0.15,
        y: y + Math.sin(a) * radius * 0.15,
        color: i % 2 ? earth.earth : earth.stone,
        size: 2 + (i % 4),
        endSize: 0.5,
        life: 550 + (i % 4) * 90,
        vx: Math.cos(a) * velocity,
        vy: Math.sin(a) * velocity - (event.weapon === 'mine' ? 125 : 65),
        gravity: 330,
        spin: i % 2 ? 5 : -4,
        rotation: a,
        alpha: 0.92,
      },
      true,
    );
  }
  const sparks = Math.round(10 * budget);
  for (let i = 0; i < sparks; i++) {
    const a = seed + (i * TAU) / sparks;
    renderer.spawn(
      'spark',
      now,
      options,
      {
        x,
        y,
        color: i % 2 ? 0xffd96a : 0xfff0b1,
        size: 4 + (i % 3) * 2,
        endSize: 0.2,
        life: 220 + (i % 3) * 50,
        vx: Math.cos(a) * (145 + (i % 4) * 25),
        vy: Math.sin(a) * (145 + (i % 4) * 25),
        rotation: a,
        alpha: 0.9,
      },
      true,
    );
  }
}

export function plume(renderer, x, y, radius, earth, seed, now, options) {
  const low = options.quality === 'low',
    budget = low ? 0.5 : 1;
  const wind = Number.isFinite(options.wind) ? options.wind : 0;
  renderer.spawn(
    'disc',
    now,
    options,
    {
      x,
      y,
      color: 0xffb259,
      size: radius * 0.3,
      endSize: radius * 1.25,
      life: 230,
      alpha: 0.55,
      mode: 'flash',
      blend: 'add',
    },
    true,
  );
  const tongues = Math.round(5 * budget);
  for (let i = 0; i < tongues; i++) {
    const a = seed * 1.3 + (i * TAU) / tongues,
      offset = radius * 0.22;
    renderer.spawn(
      'disc',
      now + i * 15,
      options,
      {
        x: x + Math.cos(a) * offset,
        y: y + Math.sin(a) * offset,
        color: 0xff9a3c,
        endColor: 0xff4a1c,
        size: radius * 0.16,
        endSize: radius * 0.42,
        life: 310 + (i % 2) * 90,
        alpha: 0.55,
        mode: 'flash',
        blend: 'add',
        vx: Math.cos(a) * 70,
        vy: Math.sin(a) * 70 - 95,
        drag: 2.4,
        rotation: a,
        spin: i % 2 ? 0.9 : -0.9,
      },
      true,
    );
  }
  // Many soft, overlapping clouds read as one rolling column rather than discs.
  const columns = Math.round(10 * budget);
  for (let i = 0; i < columns; i++) {
    const n = noise(seed + i * 3.1),
      m = noise(seed * 2.7 + i);
    const a = -Math.PI / 2 + (n - 0.5) * 1.3,
      v = 50 + m * 70;
    renderer.spawn('cloud', now + 40 + i * 40, options, {
      x: x + (n - 0.5) * radius * 0.6,
      y: y - radius * 0.1,
      color: 0x5f6563,
      endColor: 0xa6aba7,
      size: radius * 0.2,
      endSize: radius * (0.6 + m * 0.4),
      life: 1700 + n * 800,
      alpha: 0.36,
      mode: 'smoke',
      vx: Math.cos(a) * v * 0.6,
      vy: Math.sin(a) * v,
      drag: 1.3,
      driftX: wind * 1.2,
      driftY: -14,
      rotation: n * TAU,
      spin: (m - 0.5) * 0.8,
    });
  }
  renderer.spawn(
    'ring',
    now,
    options,
    {
      x,
      y: y + radius * 0.2,
      color: earth.dust,
      size: radius * 0.4,
      endSize: radius * 2.1,
      aspectY: 0.28,
      life: 520,
      alpha: 0.4,
    },
    true,
  );
  const puffs = Math.round(6 * budget);
  for (let i = 0; i < puffs; i++) {
    const side = i % 2 ? 1 : -1,
      n = noise(seed * 1.9 + i);
    renderer.spawn('cloud', now + i * 20, options, {
      x: x + side * radius * 0.25,
      y: y + radius * 0.18,
      color: earth.dust,
      size: radius * 0.12,
      endSize: radius * 0.42,
      life: 700 + n * 300,
      alpha: 0.42,
      vx: side * (90 + n * 90),
      vy: -(15 + n * 25),
      drag: 2.8,
      driftX: wind,
      driftY: -6,
      rotation: n * TAU,
      spin: side * 0.4,
    });
  }
}
