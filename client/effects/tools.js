import { TAU, COLORS } from './primitives.js';

export function mineTrigger(renderer, event, now, options) {
  for (let i = 0; i < (options.reducedMotion ? 1 : 2); i++) {
    renderer.spawn(
      'ring',
      now + i * 100,
      options,
      {
        x: event.x,
        y: event.y - 2,
        color: 0xff986c,
        size: 9,
        endSize: options.reducedMotion ? 15 : 27,
        aspectY: 0.45,
        life: 380,
        alpha: 0.8,
      },
      true,
    );
  }
  if (!options.reducedMotion)
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i - 1) * 0.65;
      renderer.spawn(
        'spark',
        now,
        options,
        {
          x: event.x + Math.cos(a) * 10,
          y: event.y + Math.sin(a) * 10,
          color: 0xffc07a,
          size: 5,
          endSize: 1,
          rotation: a,
          vx: Math.cos(a) * 15,
          vy: Math.sin(a) * 15,
          life: 360,
          alpha: 0.95,
        },
        true,
      );
    }
}

export function crateLand(renderer, event, now, options) {
  const earth = COLORS[options.mapId] || COLORS.hills;
  renderer.spawn(
    'ring',
    now,
    options,
    {
      x: event.x,
      y: event.y + 7,
      color: earth.dust,
      size: 6,
      endSize: options.reducedMotion ? 14 : 26,
      aspectY: 0.35,
      life: 380,
      alpha: 0.6,
    },
    true,
  );
  if (options.reducedMotion) return;
  for (let i = 0; i < (options.quality === 'low' ? 3 : 6); i++) {
    const sign = i % 2 ? 1 : -1,
      speed = 22 + i * 7;
    renderer.spawn('cloud', now, options, {
      x: event.x + sign * 6,
      y: event.y + 6,
      color: earth.dust,
      size: 2.5,
      endSize: 7 + (i % 3) * 1.5,
      vx: sign * speed,
      vy: -8 - (i % 3) * 4,
      drag: 2.5,
      life: 420 + (i % 3) * 90,
      alpha: 0.32,
      mode: 'smoke',
    });
  }
}

export function crateBreak(renderer, event, now, options) {
  const { x, y } = event;
  renderer.spawn(
    'disc',
    now,
    options,
    {
      x,
      y,
      color: 0xffd98a,
      size: 4,
      endSize: options.reducedMotion ? 14 : 22,
      life: 200,
      alpha: 0.8,
      mode: 'flash',
    },
    true,
  );
  renderer.spawn(
    'ring',
    now,
    options,
    { x, y, color: 0xf2c48b, size: 6, endSize: 30, life: 320, alpha: 0.6 },
    true,
  );
  if (options.reducedMotion) return;
  const chips = options.quality === 'low' ? 6 : 12;
  for (let i = 0; i < chips; i++) {
    const a = -Math.PI + 0.3 + (i * TAU) / chips,
      speed = 60 + (i % 4) * 25;
    renderer.spawn(
      'shard',
      now,
      options,
      {
        x,
        y,
        color: i % 3 ? 0xbe895f : 0xe8c48d,
        size: 2 + (i % 3),
        endSize: 0.6,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 80,
        gravity: 330,
        spin: i % 2 ? 6 : -5,
        rotation: a,
        life: 520 + (i % 3) * 80,
        alpha: 0.95,
      },
      true,
    );
  }
  for (let i = 0; i < 3; i++)
    renderer.spawn('cloud', now, options, {
      x: x + (i - 1) * 5,
      y: y - 2,
      color: 0xd9c9a8,
      size: 3,
      endSize: 11,
      vy: -14,
      life: 520,
      alpha: 0.3,
      mode: 'smoke',
    });
}

export function cratePickup(renderer, event, now, options) {
  const color = event.kind === 'health' ? 0xa9efb3 : 0xffe08a;
  renderer.spawn(
    'ring',
    now,
    options,
    {
      x: event.x,
      y: event.y,
      color,
      size: 5,
      endSize: options.reducedMotion ? 16 : 28,
      life: 360,
      alpha: 0.8,
    },
    true,
  );
  if (options.reducedMotion) return;
  const count = options.quality === 'low' ? 4 : 8;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i / (count - 1) - 0.5) * 2.2;
    renderer.spawn(
      'cross',
      now + i * 20,
      options,
      {
        x: event.x + (i - (count - 1) / 2) * 3,
        y: event.y - 4,
        color,
        size: 2.2,
        endSize: 0.3,
        vx: Math.cos(a) * 28,
        vy: Math.sin(a) * 40 - 20,
        gravity: -40,
        rotation: a,
        spin: 2,
        life: 480,
        alpha: 0.95,
      },
      true,
    );
  }
}

export function teleport(renderer, event, now, options) {
  const arriving = event.phase !== 'depart';
  const color = arriving ? 0xabebcb : 0x86d6dd;
  for (let i = 0; i < 3; i++) {
    renderer.spawn(
      'ring',
      now + (options.reducedMotion ? 0 : i * 35),
      options,
      {
        x: event.x,
        y: event.y - 9 + (i - 1) * 10,
        color,
        size: arriving ? 3 : 20,
        endSize: arriving ? 21 : 3,
        aspectY: 0.3,
        life: options.reducedMotion ? 220 : 480,
        alpha: 0.8 - i * 0.12,
      },
      true,
    );
  }
  renderer.spawn(
    'ring',
    now,
    options,
    {
      x: event.x,
      y: event.y - 7,
      color: 0xd4fff0,
      size: arriving ? 4 : 21,
      endSize: arriving ? 21 : 4,
      aspectX: 0.7,
      aspectY: 1.35,
      life: 330,
      alpha: 0.5,
    },
    true,
  );
  if (options.reducedMotion) return;
  const count = options.quality === 'low' ? 5 : 10;
  for (let i = 0; i < count; i++) {
    const a = i * 2.399;
    const radius = arriving ? 23 : 7;
    renderer.spawn(
      'cross',
      now + (i % 3) * 25,
      options,
      {
        x: event.x + Math.cos(a) * radius,
        y: event.y - 8 + Math.sin(a) * 22,
        color,
        size: 2.2,
        endSize: 0.2,
        life: 450,
        vx: Math.cos(a) * (arriving ? -25 : 30),
        vy: -15,
        rotation: a,
        spin: arriving ? -1 : 1,
        alpha: 0.9,
      },
      true,
    );
  }
}

export function girder(renderer, event, now, options) {
  const width = Number.isFinite(event.width) ? event.width : 112;
  const height = Number.isFinite(event.height) ? event.height : 16;
  renderer.spawn(
    'beam',
    now,
    options,
    {
      x: event.x - width / 2,
      y: event.y,
      color: 0xc9d2be,
      size: width,
      endSize: width,
      aspectY: height / width,
      life: 520,
      alpha: 0.75,
    },
    true,
  );
  for (const sign of [-1, 1]) {
    renderer.spawn(
      'beam',
      now,
      options,
      {
        x: event.x - width / 2,
        y: event.y + sign * height * 0.4,
        color: 0xffe8a2,
        size: width,
        endSize: width,
        aspectY: 1.7 / width,
        life: 570,
        alpha: 0.8,
      },
      true,
    );
  }
  for (let i = 0; i < 4; i++) {
    const x = event.x - width * 0.4 + (i * width * 0.8) / 3;
    renderer.spawn(
      'nut',
      now + (options.reducedMotion ? 0 : i * 35),
      options,
      { x, y: event.y, color: 0xffdb85, size: 2.5, endSize: 2.5, life: 480, alpha: 1 },
      true,
    );
    if (!options.reducedMotion)
      for (let n = 0; n < (options.quality === 'low' ? 2 : 4); n++) {
        const a = -Math.PI + (n * Math.PI) / 3;
        renderer.spawn(
          'spark',
          now + i * 35,
          options,
          {
            x,
            y: event.y,
            color: n % 2 ? 0xffd47b : 0xfff0bc,
            size: 3,
            endSize: 0.1,
            vx: Math.cos(a) * 45,
            vy: Math.sin(a) * 45 - 16,
            gravity: 160,
            rotation: a,
            life: 330,
            alpha: 0.9,
          },
          true,
        );
      }
  }
}

export function rope(renderer, event, now, options) {
  if ([event.fromX, event.fromY].every(Number.isFinite)) {
    const dx = event.x - event.fromX,
      dy = event.y - event.fromY;
    const length = Math.hypot(dx, dy);
    if (length > 0)
      renderer.spawn(
        'beam',
        now,
        options,
        {
          x: event.fromX,
          y: event.fromY,
          color: 0xffe3a0,
          size: length,
          endSize: length,
          aspectY: 2 / length,
          rotation: Math.atan2(dy, dx),
          life: 130,
          alpha: 0.7,
        },
        true,
      );
  }
  renderer.spawn(
    'ring',
    now,
    options,
    {
      x: event.x,
      y: event.y,
      color: 0xcbdac5,
      size: 3,
      endSize: options.reducedMotion ? 8 : 15,
      life: 220,
      alpha: 0.7,
    },
    true,
  );
  if (!options.reducedMotion)
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + 0.3;
      renderer.spawn(
        'spark',
        now,
        options,
        {
          x: event.x,
          y: event.y,
          color: 0xe5d29b,
          size: 3,
          endSize: 0.1,
          vx: Math.cos(a) * 28,
          vy: Math.sin(a) * 28,
          rotation: a,
          life: 200,
          alpha: 0.9,
        },
        true,
      );
    }
}

export function breakRope(renderer, event, now, options) {
  if (options.reducedMotion) return;
  for (const sign of [-1, 1])
    renderer.spawn(
      'spark',
      now,
      options,
      {
        x: event.x,
        y: event.y,
        color: 0xf4d597,
        size: 5,
        endSize: 1,
        vx: sign * 35,
        vy: -20,
        gravity: 120,
        spin: sign * 4,
        rotation: sign * 0.8,
        life: 260,
        alpha: 0.85,
      },
      true,
    );
}

export function ignite(renderer, event, now, options) {
  if (event.enabled === false) return;
  const count = options.reducedMotion ? 2 : 5;
  for (let i = 0; i < count; i++) {
    renderer.spawn('cloud', now, options, {
      x: event.x - 8,
      y: event.y + 8,
      color: event.empty ? 0x7e8b8b : 0xc5dce0,
      size: 2 + (i % 2),
      endSize: 6,
      vx: options.reducedMotion ? 0 : (i - 2) * 8,
      vy: event.empty ? -12 : 15 + i * 6,
      life: 340,
      alpha: 0.4,
    });
  }
}

export function airstrikeCall(renderer, event, now, options) {
  renderer.spawn(
    'ring',
    now,
    options,
    {
      x: event.targetX,
      y: event.targetY,
      color: 0xf5d893,
      size: 19,
      endSize: options.reducedMotion ? 23 : 42,
      aspectY: 0.32,
      life: 700,
      alpha: 0.65,
    },
    true,
  );
  if (options.reducedMotion) return;
  for (let i = 0; i < 3; i++)
    renderer.spawn(
      'arc',
      now + i * 80,
      options,
      {
        x: event.targetX,
        y: event.targetY - 42 - i * 12,
        color: 0xffe2a1,
        size: 8,
        endSize: 8,
        aspectY: 0.65,
        rotation: Math.PI / 2,
        vy: 25,
        life: 500,
        alpha: 0.7,
      },
      true,
    );
}
