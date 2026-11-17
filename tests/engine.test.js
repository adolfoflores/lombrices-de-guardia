import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, surfaceAt, groundDepth } from '../shared/engine.js';
import { Terrain } from '../shared/terrain.js';
import { CONFIG, WEAPONS, MAPS, TURN_DURATIONS, CRATE_CONTENTS } from '../shared/config.js';
import { WORM_NAMES, WORM_NAME_LENGTH, pickWormNames } from '../shared/names.js';

const roster = (count = 2, teams) =>
  Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Tripulación ${i + 1}`,
    team: teams?.[i] ?? i % 2,
    color: '#ff7788',
  }));
function advance(game, seconds) {
  for (let i = 0; i < Math.ceil(seconds * CONFIG.tickRate); i++) game.step();
}
function arena({
  count = 2,
  mode = 'ffa',
  teams,
  mapId = 'hills',
  worms = 2,
  turnSeconds = CONFIG.turnSeconds,
} = {}) {
  const game = new Game(roster(count, teams), { mapId, mode, worms, turnSeconds }, { seed: 42 });
  game.terrain.data.fill(0);
  game.terrain.rect(0, 650, 1600, 250);
  game.terrain.revision++;
  game.worms.forEach((worm, index) => {
    worm.x = 160 + index * 130;
    worm.y = 639;
    worm.vx = 0;
    worm.vy = 0;
    worm.grounded = true;
  });
  advance(game, 0.1);
  return game;
}
const fire = (game, weapon, props = {}) =>
  game.action(game.turn.playerId, { type: 'fire', weapon, angle: 0, power: 0.5, ...props });
const next = (game) => {
  assert.equal(game.action(game.turn.playerId, { type: 'end' }).ok, true);
  advance(game, 0.6);
};

test('the product has exactly twelve weapons and three fixed maps', () => {
  assert.equal(WEAPONS.length, 12);
  assert.equal(new Set(WEAPONS.map((w) => w.id)).size, 12);
  assert.equal(MAPS.length, 3);
  for (const basic of ['bazooka', 'grenade', 'shotgun', 'bat', 'rope'])
    assert.equal(WEAPONS.find((w) => w.id === basic).ammo, -1);
});

test('turn duration defaults to thirty seconds and accepts only the three numeric presets', () => {
  assert.deepEqual(TURN_DURATIONS, [30, 45, 60]);
  assert.equal(CONFIG.turnSeconds, 30);
  assert.equal(new Game(roster()).turn.remaining, 30);
  for (const turnSeconds of [undefined, null, '30', true, 25, 0, -30, 31, 30.5, NaN, Infinity, {}, []]) {
    assert.throws(() => new Game(roster(), { turnSeconds }), /Configuración/, String(turnSeconds));
  }
});

for (const turnSeconds of TURN_DURATIONS)
  test(`${turnSeconds}-second turns expire at the selected duration and renew the same budget`, () => {
    const game = arena({ turnSeconds });
    assert.equal(game.turnSeconds, turnSeconds);
    assert.equal(game.snapshot(false).turnSeconds, turnSeconds);
    // Arena preparation already advanced the first tenth of a second.
    advance(game, turnSeconds - 0.2);
    assert.equal(game.turn.number, 1);
    assert.equal(game.turn.stage, 'action');
    assert.ok(game.turn.remaining > 0 && game.turn.remaining < 0.12);
    advance(game, 0.2);
    assert.equal(game.turn.number, 1);
    assert.equal(game.turn.stage, 'settling');
    assert.equal(game.turn.remaining, 0);
    advance(game, CONFIG.settleSeconds);
    assert.equal(game.turn.number, 2);
    assert.equal(game.turn.stage, 'action');
    assert.ok(game.turn.remaining > turnSeconds - 0.2 && game.turn.remaining <= turnSeconds);
    next(game);
    assert.equal(game.turn.number, 3);
    assert.ok(game.turn.remaining > turnSeconds - 0.2 && game.turn.remaining <= turnSeconds);
  });

test('every designed map admits all rosters up to six players × four worms without startup injuries', () => {
  for (const map of MAPS)
    for (const count of [2, 3, 4, 5, 6])
      for (const worms of [2, 3, 4]) {
        const game = new Game(roster(count), { mapId: map.id, mode: 'ffa', worms }, { seed: 1 });
        advance(game, 2);
        assert.equal(game.worms.length, count * worms);
        for (const worm of game.worms) {
          assert.equal(worm.hp, 100, `${map.id}/${count}/${worms}`);
          assert.ok(game._clear(worm.x, worm.y));
          assert.ok(worm.y + 10 < game.waterY);
        }
        for (let i = 0; i < game.worms.length; i++)
          for (let j = i + 1; j < game.worms.length; j++)
            assert.ok(Math.hypot(game.worms[i].x - game.worms[j].x, game.worms[i].y - game.worms[j].y) >= 20);
      }
});

test('the nickname pool holds at least sixty short, distinct names and draws them without repeats', () => {
  assert.ok(WORM_NAMES.length >= 60);
  assert.equal(new Set(WORM_NAMES).size, WORM_NAMES.length);
  for (const name of WORM_NAMES) {
    assert.ok(name.length > 0 && name.length <= WORM_NAME_LENGTH, `${name} fits the nameplate`);
    assert.equal(name.trim(), name);
    assert.doesNotMatch(name, /\d/, `${name} carries no roster number`);
  }
  let seed = 3;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const picked = pickWormNames(24, random);
  assert.equal(picked.length, 24);
  assert.equal(new Set(picked).size, 24);
  assert.ok(picked.every((name) => WORM_NAMES.includes(name)));
  assert.equal(
    new Set(pickWormNames(WORM_NAMES.length, random)).size,
    WORM_NAMES.length,
    'a full lap still never repeats',
  );
});

test('worms receive distinct nicknames per match, reproducible by seed, and keep their player name', () => {
  const setups = [
    { count: 6, mode: 'ffa' },
    { count: 6, mode: '3v3', teams: [0, 0, 0, 1, 1, 1] },
    { count: 4, mode: '2v2', teams: [0, 1, 0, 1] },
  ];
  for (const map of MAPS)
    for (const setup of setups) {
      const create = (seed) =>
        new Game(roster(setup.count, setup.teams), { mapId: map.id, mode: setup.mode, worms: 4 }, { seed });
      const game = create(9),
        twin = create(9),
        other = create(10);
      const names = game.worms.map((worm) => worm.name);
      assert.equal(new Set(names).size, names.length, `${map.id}/${setup.mode} nicknames are unique`);
      assert.ok(names.every((name) => WORM_NAMES.includes(name)));
      assert.deepEqual(
        twin.worms.map((worm) => worm.name),
        names,
        'the same seed names the same roster',
      );
      assert.notDeepEqual(
        other.worms.map((worm) => worm.name),
        names,
        'another seed draws another roster',
      );
      for (const worm of game.worms) {
        const player = game.players.find((p) => p.id === worm.playerId);
        assert.equal(worm.playerName, player.name);
        assert.equal(worm.id, `${player.id}:${worm.id.split(':')[1]}`);
      }
    }
  const game = arena();
  const published = game.snapshot(false).worms[0];
  assert.equal(published.name, game.worms[0].name);
  assert.equal(published.playerName, 'Tripulación 1');
  const victim = game.worms[1];
  game._kill(victim, true);
  assert.equal(game.events.findLast((e) => e.type === 'splash').text, `${victim.name} cayó al agua`);
});

test('terrain RLE exactly preserves collision pixels after craters, tunnels and girders', () => {
  for (const map of MAPS) {
    const terrain = new Terrain(map.id),
      initial = terrain.revision;
    terrain.circle(500, 660, 100);
    terrain.circle(1000, 600, 75);
    terrain.girder(700, 280);
    assert.ok(terrain.revision > initial);
    assert.deepEqual(Terrain.decode(terrain.encode()), terrain.data);
    assert.strictEqual(terrain.encode(), terrain.encode(), 'unchanged RLE is cached');
    assert.equal(terrain.solid(700, 280), true);
    assert.equal(terrain.solid(-1, 10), false);
  }
  assert.throws(() => Terrain.decode([1, 99999999]));
  assert.throws(() => Terrain.decode([0, 1]));
  assert.throws(() => Terrain.decode([2, 1440000]));
});

test('fixed tick integration is deterministic despite different snapshot/request cadence', () => {
  const a = arena(),
    b = arena();
  fire(a, 'grenade', { angle: -0.8, power: 0.7 });
  fire(b, 'grenade', { angle: -0.8, power: 0.7 });
  for (let i = 0; i < 240; i++) a.step(1 / 60);
  for (let i = 0; i < 80; i++) b.step(1 / 20);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('FFA turns rotate players and each player’s live worms predictably', () => {
  const game = arena({ count: 4 });
  const observed = [];
  for (let i = 0; i < 9; i++) {
    observed.push([game.turn.playerId, game.turn.wormId]);
    next(game);
  }
  assert.deepEqual(
    observed.map((t) => t[0]),
    ['p0', 'p1', 'p2', 'p3', 'p0', 'p1', 'p2', 'p3', 'p0'],
  );
  assert.deepEqual([observed[0][1], observed[4][1], observed[8][1]], ['p0:1', 'p0:2', 'p0:1']);
});

for (const [mode, teams, expected] of [
  ['2v2', [0, 0, 1, 1], ['p0', 'p2', 'p1', 'p3', 'p0']],
  ['3v3', [0, 0, 0, 1, 1, 1], ['p0', 'p3', 'p1', 'p4', 'p2', 'p5']],
  ['2v2v2', [0, 0, 1, 1, 2, 2], ['p0', 'p2', 'p4', 'p1', 'p3', 'p5']],
])
  test(`${mode} alternates alliances before rotating their members`, () => {
    const game = arena({ count: teams.length, mode, teams });
    const observed = [];
    for (let i = 0; i < expected.length; i++) {
      observed.push(game.turn.playerId);
      next(game);
    }
    assert.deepEqual(observed, expected);
  });

test('dead players and dead worms are skipped without starving their alliance', () => {
  const game = arena({ count: 4, mode: '2v2', teams: [0, 0, 1, 1] });
  game.forfeit('p2');
  next(game);
  assert.equal(game.turn.playerId, 'p3');
  next(game);
  assert.equal(game.turn.playerId, 'p1');
  next(game);
  next(game);
  assert.equal(game.turn.playerId, 'p0');
  assert.equal(game.turn.wormId, 'p0:2');
});

test('authority rejects out of turn, malformed, nonfinite and out of bounds input', () => {
  const game = arena();
  assert.equal(game.action('p1', { type: 'jump' }).ok, false);
  assert.equal(game.action('p0', null).ok, false);
  for (const key of ['move', 'thrustX', 'thrustY', 'reel'])
    for (const value of [NaN, Infinity, -Infinity, 1.01, -1.01, '1', null, true]) {
      assert.equal(game.action('p0', { type: 'input', [key]: value }).ok, false, `${key}: ${value}`);
    }
  assert.equal(game.action('p0', { type: 'input', aim: Infinity }).ok, false);
  for (const bad of [{ power: NaN }, { angle: Infinity }, { power: 2 }, { angle: 1000 }])
    assert.equal(fire(game, 'bazooka', bad).ok, false);
  assert.equal(fire(game, 'teleport', { x: -1, y: 400 }).ok, false);
  assert.equal(fire(game, 'girder', { x: 400, y: Infinity }).ok, false);
  assert.equal(fire(game, 'invalid').ok, false);
  for (const inherited of ['toString', 'constructor', '__proto__'])
    assert.equal(fire(game, inherited).ok, false);
  assert.equal(
    game.projectiles.length,
    0,
    'unknown and inherited property names must not create invalid projectiles',
  );
  assert.equal(game.turn.shots, 0);
});

test('stale movement input stops after 300 ms, while renewed input continues', () => {
  const game = arena(),
    worm = game._active(),
    initial = worm.x;
  game.action('p0', { type: 'input', move: 1 });
  advance(game, 1.5);
  assert.ok(worm.x > initial + 10 && worm.x < initial + 60);
  assert.equal(worm.vx, 0);
  const after = worm.x;
  for (let i = 0; i < 10; i++) {
    game.action('p0', { type: 'input', move: 1 });
    advance(game, 0.1);
  }
  assert.ok(worm.x > after + 75);
});

test('jump and backflip have distinct directions and require support', () => {
  const a = arena(),
    b = arena();
  a._active().facing = 1;
  b._active().facing = 1;
  assert.equal(a.action('p0', { type: 'jump', back: false }).ok, true);
  assert.equal(b.action('p0', { type: 'jump', back: true }).ok, true);
  assert.ok(a._active().vx > 0 && b._active().vx < 0);
  assert.ok(b._active().vy < a._active().vy);
  assert.equal(a.action('p0', { type: 'jump' }).ok, false);
});

test('bazooka responds to wind, impacts terrain, hurts allies and grants retreat', () => {
  const a = arena(),
    b = arena();
  a.wind = -40;
  b.wind = 40;
  assert.equal(fire(a, 'bazooka', { angle: -1.3, power: 0.5 }).ok, true);
  fire(b, 'bazooka', { angle: -1.3, power: 0.5 });
  advance(a, 0.3);
  advance(b, 0.3);
  assert.ok(b.projectiles[0].x > a.projectiles[0].x);
  assert.equal(a.turn.stage, 'retreat');
  assert.equal(fire(a, 'grenade').ok, false);
  const g = arena({ count: 4, mode: '2v2', teams: [0, 0, 1, 1] });
  const shooter = g._active(),
    ally = g.worms.find((w) => w.playerId === 'p1');
  ally.x = shooter.x + 33;
  const revision = g.terrain.revision;
  assert.equal(fire(g, 'bazooka', { angle: 0.4, power: 0.1 }).ok, true);
  advance(g, 0.2);
  assert.ok(g.terrain.revision > revision);
  assert.ok(ally.hp < 100);
  assert.ok(shooter.hp < 100);
});

test('grenades bounce, keep their fuse, ignore wind and then explode', () => {
  const a = arena(),
    b = arena();
  a.wind = -45;
  b.wind = 45;
  fire(a, 'grenade', { angle: 0.3, power: 0.4 });
  fire(b, 'grenade', { angle: 0.3, power: 0.4 });
  advance(a, 0.1);
  advance(b, 0.1);
  assert.equal(a.projectiles.length, 1);
  assert.ok(a.projectiles[0].vy < 0);
  assert.deepEqual(a.projectiles, b.projectiles);
  assert.ok(a.projectiles[0].fuse > 2.8);
  advance(a, 3.1);
  assert.ok(a.events.some((e) => e.type === 'explosion' && e.weapon === 'grenade'));
});

test('fragmentation produces five live fragments and settles only after they detonate', () => {
  const game = arena();
  fire(game, 'cluster', { angle: -0.8, power: 0.35 });
  advance(game, 3.1);
  assert.equal(game.projectiles.filter((p) => p.kind === 'fragment').length, 5);
  assert.equal(game.turn.number, 1);
  assert.equal(game.turn.stage, 'settling');
  advance(game, 3);
  assert.equal(game.projectiles.length, 0);
  assert.ok(game.events.some((e) => e.type === 'explosion' && e.weapon === 'fragment'));
});

test('shotgun grants exactly two shots, blocks other attacks, and obeys terrain occlusion', () => {
  const game = arena(),
    target = game.worms.find((w) => w.playerId === 'p1');
  assert.equal(fire(game, 'shotgun').ok, true);
  assert.equal(target.hp, 76);
  assert.equal(game.turn.stage, 'action');
  assert.equal(game.turn.shots, 1);
  assert.equal(fire(game, 'bazooka').ok, false);
  assert.equal(fire(game, 'shotgun').ok, false);
  advance(game, 0.55);
  assert.equal(
    fire(game, 'shotgun', { angle: Math.atan2(target.y - game._active().y, target.x - game._active().x) }).ok,
    true,
  );
  assert.equal(game.turn.shots, 2);
  assert.equal(game.turn.stage, 'retreat');
  assert.equal(target.hp, 52);
  assert.equal(fire(game, 'shotgun').ok, false);
  const blocked = arena();
  blocked.terrain.rect(210, 550, 20, 100);
  fire(blocked, 'shotgun');
  assert.equal(blocked.worms.find((w) => w.playerId === 'p1').hp, 100);
});

test('dynamite waits four seconds, consumes inventory, and keeps the turn settling', () => {
  const game = arena(),
    before = game.players[0].ammo.dynamite;
  assert.equal(fire(game, 'dynamite').ok, true);
  assert.equal(game.players[0].ammo.dynamite, before - 1);
  advance(game, 3.3);
  assert.equal(game.turn.number, 1);
  assert.equal(game.turn.stage, 'settling');
  assert.equal(game.projectiles.length, 1);
  advance(game, 1);
  assert.ok(game.events.some((e) => e.type === 'explosion' && e.weapon === 'dynamite'));
});

test('mines arm, detect any nearby worm, and trigger neighboring mines in a chain', () => {
  const game = arena(),
    owner = game._active();
  assert.equal(fire(game, 'mine').ok, true);
  assert.equal(game.mines[0].armed, false);
  advance(game, 1.5);
  assert.equal(game.mines[0].armed, true);
  owner.x = game.mines[0].x - 25;
  game.step();
  assert.ok(Number.isFinite(game.mines[0].fuse));
  const mine = game.mines[0];
  game.mines.push({ id: 'chain', x: mine.x + 45, y: mine.y, vx: 0, vy: 0, armed: true, armIn: 0 });
  advance(game, 1.2);
  assert.equal(game.mines.length, 0);
  assert.ok(game.events.filter((e) => e.type === 'explosion' && e.weapon === 'mine').length >= 2);
  assert.ok(owner.hp < 100);
});

test('a falling or newly planted mine postpones settlement without idle mines blocking turns', () => {
  const game = arena();
  game.mines.push({ id: 'falling', x: 900, y: 180, vx: 0, vy: 0, armed: false, armIn: 1.4 });
  next(game);
  assert.equal(game.turn.number, 1);
  advance(game, 3);
  assert.equal(game.turn.number, 2);
  assert.equal(game.mines.length, 1);
  assert.equal(game.mines[0].armed, true);
  assert.equal(game.mines[0].fuse, undefined);
});

test('a stationary mine on a thin destructible ledge does not stall the turn', () => {
  const game = arena();
  game.terrain.rect(850, 380, 110, 1);
  game.mines.push({ id: 'thin-ledge', x: 900, y: 180, vx: 0, vy: 0, armed: false, armIn: 1.4 });
  game.action('p0', { type: 'end' });
  advance(game, 4);
  assert.equal(game.turn.number, 2);
  assert.ok(game.mines[0].y < 380);
  game.terrain.circle(900, 380, 65);
  game.action('p1', { type: 'end' });
  advance(game, 0.6);
  assert.equal(game.turn.number, 2, 'falling mine must finish its descent');
  advance(game, 3);
  assert.equal(game.turn.number, 3);
});

test('an explosion chains into dynamite later in the same projectile iteration', () => {
  const game = arena();
  game.projectiles.push(
    {
      id: 'burst',
      kind: 'grenade',
      x: 850,
      y: 615,
      vx: 0,
      vy: 0,
      fuse: 0.001,
      radius: 60,
      damage: 20,
      age: 0,
    },
    {
      id: 'later',
      kind: 'dynamite',
      x: 880,
      y: 630,
      vx: 0,
      vy: 0,
      fuse: 4,
      radius: 90,
      damage: 78,
      age: 0,
      bounce: 0.2,
    },
  );
  game.step();
  assert.ok(game.projectiles.find((p) => p.id === 'later').fuse <= 0.12);
  advance(game, 0.2);
  assert.ok(game.events.some((e) => e.type === 'explosion' && e.weapon === 'dynamite'));
});

test('bat applies directional close-range damage and strong knockback', () => {
  const game = arena(),
    owner = game._active(),
    target = game.worms.find((w) => w.playerId === 'p1');
  target.x = owner.x + 35;
  assert.equal(fire(game, 'bat', { angle: -0.25 }).ok, true);
  assert.equal(target.hp, 74);
  assert.ok(target.vx > 400);
  assert.ok(target.vy < -100);
  assert.equal(game.turn.stage, 'retreat');
});

test('airstrike targets five bombs on open maps and is rejected without charge in cavern', () => {
  for (const mapId of ['hills', 'islands']) {
    const game = arena({ mapId });
    assert.equal(fire(game, 'airstrike', { x: 750, y: 550 }).ok, true);
    assert.equal(game.projectiles.length, 5);
    assert.equal(game.players[0].ammo.airstrike, 0);
    advance(game, 3);
    assert.ok(game.events.some((e) => e.type === 'explosion' && e.weapon === 'airstrike'));
  }
  const cave = arena({ mapId: 'cavern' });
  const result = fire(cave, 'airstrike', { x: 750, y: 550 });
  assert.equal(result.ok, false);
  assert.match(result.error, /techo/);
  assert.equal(cave.players[0].ammo.airstrike, 1);
});

test('rope attaches to real terrain, swings, reels, releases and permits a follow-up attack', () => {
  const game = arena(),
    worm = game._active();
  game.terrain.rect(80, 340, 300, 20);
  assert.equal(fire(game, 'rope', { angle: -Math.PI / 2 }).ok, true);
  assert.ok(worm.rope);
  assert.equal(game.turn.shots, 0);
  assert.equal(game.turn.stage, 'action');
  const initialLength = worm.rope.length;
  for (let i = 0; i < 10; i++) {
    game.action('p0', { type: 'input', move: 1, reel: -1 });
    advance(game, 0.1);
  }
  assert.ok(worm.rope.length < initialLength - 70);
  assert.ok(Math.hypot(worm.x - worm.rope.x, worm.y - worm.rope.y) <= worm.rope.length + 0.1);
  assert.ok(worm.x > 170);
  assert.equal(game.action('p0', { type: 'release' }).ok, true);
  assert.equal(worm.rope, null);
  assert.equal(fire(game, 'bazooka', { angle: -0.5 }).ok, true);
});

test('rope anchor breaks when its terrain is destroyed and failed attachment costs nothing', () => {
  const game = arena(),
    worm = game._active();
  assert.equal(fire(game, 'rope', { angle: -Math.PI / 2 }).ok, false);
  game.terrain.rect(80, 340, 300, 20);
  assert.equal(fire(game, 'rope', { angle: -Math.PI / 2 }).ok, true);
  game.terrain.circle(worm.rope.x, worm.rope.y, 25);
  game.step();
  assert.equal(worm.rope, null);
  assert.equal(game.turn.shots, 0);
});

test('jetpack consumes limited fuel and ammunition without consuming the main attack', () => {
  const game = arena(),
    worm = game._active(),
    initialY = worm.y;
  assert.equal(fire(game, 'jetpack').ok, true);
  assert.equal(game.players[0].ammo.jetpack, 1);
  for (let i = 0; i < 10; i++) {
    game.action('p0', { type: 'input', thrustY: -1, thrustX: 1 });
    advance(game, 0.1);
  }
  assert.ok(worm.y < initialY - 100);
  assert.ok(worm.x > 250);
  assert.ok(worm.fuel < 5.1);
  assert.equal(game.turn.shots, 0);
  assert.equal(fire(game, 'grenade', { angle: 0 }).ok, true);
  assert.equal(worm.jetpack, false);
  const depleted = arena();
  fire(depleted, 'jetpack');
  advance(depleted, 6.1);
  assert.equal(depleted._active().jetpack, false);
  assert.equal(depleted._active().fuel, 0);
});

test('teleport validates empty supported destinations, moves instantly and consumes the attack', () => {
  const game = arena(),
    worm = game._active();
  assert.equal(fire(game, 'teleport', { x: 800, y: 200 }).ok, false);
  assert.equal(fire(game, 'teleport', { x: 1500, y: 640 }).ok, false);
  assert.equal(fire(game, 'teleport', { x: 290, y: 640 }).ok, false, 'cannot overlap another worm');
  assert.equal(game.players[0].ammo.teleport, 2);
  assert.equal(fire(game, 'teleport', { x: 730, y: 650 }).ok, true);
  assert.equal(worm.x, 730);
  assert.ok(game._clear(worm.x, worm.y));
  assert.equal(game.players[0].ammo.teleport, 1);
  assert.equal(game.turn.stage, 'retreat');
});

test('girder validates overlap/range, creates collision terrain and consumes the attack', () => {
  const game = arena(),
    worm = game._active();
  assert.equal(fire(game, 'girder', { x: worm.x, y: worm.y }).ok, false);
  assert.equal(fire(game, 'girder', { x: 1000, y: 500 }).ok, false);
  assert.equal(fire(game, 'girder', { x: 220, y: 660 }).ok, false);
  const revision = game.terrain.revision;
  assert.equal(fire(game, 'girder', { x: 270, y: 535 }).ok, true);
  assert.ok(game.terrain.solid(270, 535));
  assert.ok(game.terrain.revision > revision);
  assert.equal(game.players[0].ammo.girder, 2);
  assert.equal(game.turn.stage, 'retreat');
});

test('fall damage and water deaths resolve before a new turn', () => {
  const game = arena(),
    victim = game.worms.find((w) => w.playerId === 'p1');
  victim.y = 300;
  victim.grounded = false;
  next(game); // settling remains until the falling victim lands.
  assert.equal(game.turn.number, 1);
  advance(game, 2);
  assert.ok(victim.hp < 100 && victim.hp > 0);
  assert.equal(game.turn.number, 2);
  game.terrain.circle(victim.x, 700, 190);
  advance(game, 2);
  assert.equal(victim.hp, 0);
});

test('pending projectiles postpone victory and allow a simultaneous elimination draw', () => {
  const game = arena();
  const a = game.worms.find((w) => w.playerId === 'p0'),
    b = game.worms.find((w) => w.playerId === 'p1');
  for (const worm of game.worms)
    if (worm !== a && worm !== b) {
      worm.hp = 0;
      worm._dead = true;
    }
  a.x = 400;
  b.x = 435;
  a.hp = 1;
  b.hp = 1;
  fire(game, 'dynamite');
  advance(game, 3.4);
  assert.equal(game.phase, 'playing');
  assert.equal(game.result, null);
  advance(game, 3);
  assert.equal(game.phase, 'finished');
  assert.equal(game.result.draw, true);
  assert.deepEqual(game.result.winnerIds, []);
});

test('winner includes their entire alliance, including an eliminated teammate', () => {
  const game = arena({ count: 4, mode: '2v2', teams: [0, 0, 1, 1] });
  game.forfeit('p1');
  game.forfeit('p2');
  game.forfeit('p3');
  advance(game, 0.6);
  assert.equal(game.phase, 'finished');
  assert.deepEqual(game.result.winnerIds, ['p0', 'p1']);
  assert.equal(game.action('p0', { type: 'jump' }).ok, false);
});

test('turn timeout releases tools and moves on after physics settles', () => {
  const game = arena();
  advance(game, CONFIG.turnSeconds + 1);
  assert.equal(game.turn.number, 2);
  assert.equal(game.turn.playerId, 'p1');
  assert.ok(game.turn.remaining <= CONFIG.turnSeconds);
});

test('sudden death raises shared water from minute ten and completes every map', () => {
  for (const map of MAPS) {
    const game = new Game(roster(6), { mapId: map.id, mode: 'ffa', worms: 4 }, { seed: 5 });
    game.elapsed = 599.9;
    advance(game, 0.5);
    assert.ok(game.waterY < CONFIG.waterY);
    assert.ok(game.events.some((e) => e.type === 'suddenDeath'));
    advance(game, 310);
    assert.equal(game.phase, 'finished', `${map.id} finishes under rising water`);
    assert.ok(game.result.draw || game.result.winnerIds.length === 1);
  }
});

test('all twelve map/mode combinations complete through real attacks and rising water, including 24-worm rooms', () => {
  const configurations = [
    { mode: 'ffa', count: 6, teams: [0, 1, 2, 3, 4, 5] },
    { mode: '2v2', count: 4, teams: [0, 0, 1, 1] },
    { mode: '3v3', count: 6, teams: [0, 0, 0, 1, 1, 1] },
    { mode: '2v2v2', count: 6, teams: [0, 0, 1, 1, 2, 2] },
  ];
  for (const map of MAPS)
    for (const config of configurations) {
      const game = new Game(
        roster(config.count, config.teams),
        { mapId: map.id, mode: config.mode, worms: 4 },
        { seed: 71 },
      );
      let actedTurn = 0,
        attacks = 0;
      let settlingSeconds = 0;
      for (let tick = 0; tick < 1000 * CONFIG.tickRate && game.phase === 'playing'; tick++) {
        if (game.turn.number !== actedTurn && game.turn.stage === 'action') {
          actedTurn = game.turn.number;
          const shooter = game._active();
          const target = game.worms
            .filter((w) => w.hp > 0 && w.team !== shooter.team)
            .sort((a, b) => Math.abs(a.x - shooter.x) - Math.abs(b.x - shooter.x))[0];
          if (target) {
            const angle = target.x > shooter.x ? -0.65 : -Math.PI + 0.65;
            if (
              fire(game, attacks % 3 ? 'bazooka' : 'grenade', { angle, power: 0.32 + (attacks % 5) * 0.11 })
                .ok
            )
              attacks++;
          }
        }
        game.step();
        settlingSeconds = game.turn.stage === 'settling' ? settlingSeconds + 1 / CONFIG.tickRate : 0;
        assert.ok(
          settlingSeconds < 20,
          `${map.id}/${config.mode}: stationary crater contacts must not stall a turn`,
        );
      }
      assert.equal(game.phase, 'finished', `${map.id}/${config.mode} must finish within design horizon`);
      assert.ok(attacks >= 4, `${map.id}/${config.mode} exercised real actions`);
      assert.ok(game.terrain.revision > 1);
      assert.ok(
        game.result.draw ||
          game.result.winnerIds.length === (config.mode === 'ffa' ? 1 : config.mode === '3v3' ? 3 : 2),
      );
      assert.deepEqual(Terrain.decode(game.snapshot().terrain), game.terrain.data);
      assert.equal(game._hasPending(), false, 'all effects must resolve before final result');
      for (const worm of game.worms)
        assert.ok([worm.x, worm.y, worm.vx, worm.vy, worm.hp].every(Number.isFinite));
    }
});

test('snapshots are serializable and preserve combat state without exposing mutable live objects', () => {
  const game = arena();
  fire(game, 'dynamite');
  const full = JSON.parse(JSON.stringify(game.snapshot()));
  const partial = game.snapshot(false);
  assert.ok(full.terrain);
  assert.equal(partial.terrain, undefined);
  assert.equal(full.terrainRevision, partial.terrainRevision);
  assert.deepEqual(Terrain.decode(full.terrain), game.terrain.data);
  assert.equal(full.projectiles.length, 1);
  assert.equal(full.turn.stage, 'retreat');
  assert.equal(full.players[0].ammo.dynamite, 1);
  partial.players[0].ammo.dynamite = 999;
  partial.worms[0].hp = 999;
  assert.equal(game.players[0].ammo.dynamite, 1);
  assert.equal(game.worms[0].hp, 100);
});

test('visual pose and fire events identify the actor without changing ammunition or damage rules', () => {
  const game = arena();
  const worm = game._active(),
    playerId = game.turn.playerId;
  const before = { hp: worm.hp, ammo: { ...game.players[0].ammo }, shots: game.turn.shots };
  assert.equal(game.action(playerId, { type: 'input', aim: -0.7, weapon: 'grenade' }).ok, true);
  const pose = game.snapshot(false).worms.find((w) => w.id === worm.id);
  assert.equal(pose.aim, -0.7);
  assert.equal(pose.heldWeapon, 'grenade');
  assert.deepEqual({ hp: worm.hp, ammo: game.players[0].ammo, shots: game.turn.shots }, before);
  assert.equal(game.action(playerId, { type: 'input', weapon: '__proto__' }).ok, false);
  assert.equal(game.action('not-the-player', { type: 'input', weapon: 'bazooka' }).ok, false);
  assert.equal(fire(game, 'grenade', { angle: -0.7, power: 0.6 }).ok, true);
  const event = game.snapshot(false).events.findLast((e) => e.type === 'fire');
  assert.equal(event.wormId, worm.id);
  assert.equal(event.weapon, 'grenade');
  assert.equal(event.angle, -0.7);
  assert.equal(event.power, 0.6);
  assert.equal(game.projectiles.length, 1);
  assert.equal(game.turn.shots, 1);
});

test('walking keeps ground contact through movement substeps and permits an immediate jump', () => {
  for (const move of [-1, 1]) {
    const game = arena(),
      worm = game._active();
    game.action(game.turn.playerId, { type: 'input', move });
    for (let i = 0; i < 14; i++) {
      game.step();
      assert.equal(worm.grounded, true, `floor contact after walking tick ${i}`);
    }
    assert.ok(Math.abs(worm.vx) > 60, 'exercise multiple movement substeps');
    assert.equal(game.action(game.turn.playerId, { type: 'jump' }).ok, true);
    assert.equal(worm.grounded, false);
    assert.ok(worm.vy < 0);
  }
  const game = arena(),
    worm = game._active();
  game.terrain.circle(worm.x, worm.y + 25, 65);
  game.step();
  assert.equal(worm.grounded, false, 'destroyed support immediately allows falling');
});

test('movement resolves the facing and shot inclination before either kind of jump, independent of ticks', () => {
  for (const move of [-1, 1])
    for (const back of [false, true])
      for (const ticks of [0, 1, 6]) {
        const game = arena(),
          worm = game._active();
        // Deliberately send the old aim from the opposite side, as can happen when
        // movement and the next jump arrive in the same server update interval.
        const previousAim = move < 0 ? -Math.PI / 4 : (-Math.PI * 3) / 4;
        assert.equal(game.action(game.turn.playerId, { type: 'input', move, aim: previousAim }).ok, true);
        assert.equal(worm.facing, move, 'orientation is resolved before any physics tick');
        assert.equal(Math.sign(Math.cos(worm.aim)), move);
        assert.ok(Math.abs(Math.sin(worm.aim) - Math.sin(previousAim)) < 1e-12);
        for (let i = 0; i < ticks; i++) game.step();
        assert.equal(worm.facing, move);
        assert.equal(game.action(game.turn.playerId, { type: 'jump', back }).ok, true);
        assert.equal(worm.vx, move * (back ? -80 : 118));
        assert.equal(worm.vy, back ? -CONFIG.backJumpSpeed : -CONFIG.jumpSpeed);
        const event = game.events.findLast((event) => event.type === 'jump');
        assert.equal(event.facing, move);
        assert.equal(event.vx, worm.vx);
        assert.equal(event.vy, worm.vy);
      }
});

test('releasing movement preserves orientation and reversing without a new aim preserves elevation', () => {
  for (const initialSide of [-1, 1])
    for (const inclination of [-0.65, 0.65]) {
      const game = arena(),
        worm = game._active();
      game.action(game.turn.playerId, { type: 'input', move: initialSide, aim: inclination });
      const facingAim = worm.aim;
      game.step();
      assert.equal(game.action(game.turn.playerId, { type: 'input', move: 0 }).ok, true);
      for (let i = 0; i < 8; i++) game.step();
      assert.equal(worm.facing, initialSide);
      assert.equal(worm.aim, facingAim);
      assert.equal(game.action(game.turn.playerId, { type: 'input', move: -initialSide }).ok, true);
      assert.equal(worm.facing, -initialSide);
      assert.equal(Math.sign(Math.cos(worm.aim)), -initialSide);
      assert.ok(Math.abs(Math.sin(worm.aim) - Math.sin(inclination)) < 1e-12);
      const reversedAim = worm.aim;
      game.action(game.turn.playerId, { type: 'input', move: 0, aim: reversedAim });
      game.step();
      assert.equal(worm.facing, -initialSide);
      assert.ok(Math.abs(worm.aim - reversedAim) < 1e-12);
    }
});

test('stationary aiming can turn while nearly vertical aim retains the current side', () => {
  const game = arena(),
    worm = game._active();
  for (const side of [-1, 1]) {
    const aimed = side < 0 ? -2.4 : -0.7;
    assert.equal(game.action(game.turn.playerId, { type: 'input', move: 0, aim: aimed }).ok, true);
    assert.equal(worm.facing, side);
    for (const aim of [-Math.PI / 2 - 0.02, -Math.PI / 2, -Math.PI / 2 + 0.02]) {
      game.action(game.turn.playerId, { type: 'input', move: 0, aim });
      assert.equal(worm.facing, side);
      assert.ok(Math.abs(Math.sin(worm.aim) - Math.sin(aim)) < 1e-12);
      if (Math.abs(Math.cos(aim)) > 1e-12) assert.equal(Math.sign(Math.cos(worm.aim)), side);
      game.step();
      assert.equal(worm.facing, side);
    }
  }
});

test('a mirrored accepted aim fires the bazooka on the chosen side without changing vertical trajectory', () => {
  for (const side of [-1, 1]) {
    const game = arena(),
      worm = game._active();
    const oldAim = side < 0 ? -0.65 : -Math.PI + 0.65;
    game.action(game.turn.playerId, { type: 'input', move: side, aim: oldAim });
    const aim = worm.aim,
      x = worm.x,
      y = worm.y;
    assert.equal(fire(game, 'bazooka', { angle: aim, power: 0.5 }).ok, true);
    const rocket = game.projectiles[0];
    assert.ok((rocket.x - x) * side > 0);
    assert.ok(rocket.vx * side > 0);
    assert.ok(rocket.y < y && rocket.vy < 0);
    assert.ok(Math.abs(rocket.vy / Math.hypot(rocket.vx, rocket.vy) - Math.sin(oldAim)) < 1e-12);
    assert.equal(game.events.findLast((event) => event.type === 'fire').angle, aim);
  }
});

test('visual impacts describe accepted hits and tools without inventing impacts on misses', () => {
  const shot = arena();
  assert.equal(fire(shot, 'shotgun').ok, true);
  const hit = shot.snapshot(false).events.findLast((e) => e.type === 'shot');
  assert.equal(hit.hit, 'worm');
  assert.equal(hit.wormId, shot.turn.wormId);
  assert.equal(hit.angle, 0);
  assert.ok(hit.endX > hit.x);
  advance(shot, 0.5);
  assert.equal(fire(shot, 'shotgun', { angle: -Math.PI / 2 }).ok, true);
  assert.equal(shot.events.findLast((e) => e.type === 'shot').hit, 'miss');

  const bat = arena(),
    target = bat.worms[1];
  target.x = bat._active().x + 35;
  assert.equal(fire(bat, 'bat').ok, true);
  const event = bat.snapshot(false).events.findLast((e) => e.type === 'bat');
  assert.deepEqual(event.hits, [{ x: target.x, y: target.y }]);
  event.hits[0].x = -999;
  assert.equal(
    bat.events.findLast((e) => e.type === 'bat').hits[0].x,
    target.x,
    'snapshot hit points are isolated',
  );
  const miss = arena();
  fire(miss, 'bat');
  assert.deepEqual(miss.events.findLast((e) => e.type === 'bat').hits, []);

  const teleport = arena(),
    source = { x: teleport._active().x, y: teleport._active().y };
  assert.equal(fire(teleport, 'teleport', { x: 500, y: 639 }).ok, true);
  const ends = teleport.events.filter((e) => e.type === 'teleport');
  assert.deepEqual(
    ends.map((e) => e.phase),
    ['depart', 'arrive'],
  );
  assert.deepEqual({ x: ends[0].x, y: ends[0].y }, source);
  assert.equal(ends[1].x, teleport._active().x);
  assert.ok(ends.every((e) => e.wormId === teleport.turn.wormId));

  const jet = arena();
  fire(jet, 'jetpack');
  assert.equal(jet.events.findLast((e) => e.type === 'fire').enabled, true);
  advance(jet, 0.2);
  fire(jet, 'jetpack');
  assert.equal(jet.events.findLast((e) => e.type === 'fire').enabled, false);
  assert.equal(jet.players[0].ammo.jetpack, 1, 'switching off has no second cost');
});

test('girder material survives snapshot history eviction while collision remains destructible', () => {
  const game = arena();
  assert.equal(fire(game, 'girder', { x: 240, y: 540 }).ok, true);
  const box = { x: 240, y: 540, width: CONFIG.girderWidth, height: CONFIG.girderHeight };
  assert.deepEqual(game.snapshot().girders, [box]);
  game.snapshot().girders[0].x = -999;
  assert.equal(game.girders[0].x, 240);
  for (let i = 0; i < 40; i++) game._event('turn', { text: 'next' });
  game.terrain.circle(240, 540, 20);
  assert.equal(game.terrain.solid(240, 540), false);
  const reconnect = JSON.parse(JSON.stringify(game.snapshot()));
  assert.deepEqual(reconnect.girders, [box]);
  assert.equal(
    reconnect.events.some((e) => e.type === 'girder'),
    false,
  );
  assert.deepEqual(Terrain.decode(reconnect.terrain), game.terrain.data);
});

function steerFor(game, input, seconds) {
  for (let step = 0; step < Math.ceil(seconds * CONFIG.tickRate); step++) {
    assert.equal(game.action(game.turn.playerId, { type: 'input', ...input }).ok, true);
    game.step();
  }
}
function flyingArena() {
  const game = arena(),
    worm = game._active();
  Object.assign(worm, { x: 800, y: 420, vx: 0, vy: 0, grounded: false });
  assert.equal(fire(game, 'jetpack').ok, true);
  return game;
}
function hangingArena() {
  const game = arena(),
    worm = game._active();
  Object.assign(worm, { x: 800, y: 450, vx: 0, vy: 0, grounded: false });
  game.terrain.rect(600, 230, 400, 20);
  assert.equal(fire(game, 'rope', { angle: -Math.PI / 2 }).ok, true);
  return game;
}

test('analog inputs retain their strength while facing and jump direction stay binary', () => {
  for (const side of [-1, 1]) {
    const slow = arena(),
      fast = arena();
    steerFor(slow, { move: side * 0.25, thrustX: side * 0.4, thrustY: -0.2, reel: 0.3 }, 0.6);
    steerFor(fast, { move: side }, 0.6);
    assert.equal(slow._input.move, side * 0.25);
    assert.equal(slow._input.thrustX, side * 0.4);
    assert.equal(slow._input.thrustY, -0.2);
    assert.equal(slow._input.reel, 0.3);
    assert.equal(slow._active().facing, side);
    assert.ok(Math.abs(slow._active().x - 160) < Math.abs(fast._active().x - 160) * 0.4);
    assert.equal(slow.action('p0', { type: 'jump' }).ok, true);
    assert.equal(slow._active().vx, side * 118);
  }
});

test('jetpack accelerates in all four directions and gives proportional analog control', () => {
  for (const [axis, direction] of [
    ['thrustX', -1],
    ['thrustX', 1],
    ['thrustY', -1],
    ['thrustY', 1],
  ]) {
    const game = flyingArena(),
      worm = game._active();
    const coord = axis === 'thrustX' ? 'x' : 'y',
      velocity = axis === 'thrustX' ? 'vx' : 'vy',
      start = worm[coord];
    steerFor(game, { [axis]: direction }, 1 / CONFIG.tickRate);
    assert.ok(
      worm[velocity] * direction > 0 && Math.abs(worm[velocity]) < 20,
      'acceleration has no instant velocity jump',
    );
    steerFor(game, { [axis]: direction }, 0.6);
    assert.ok((worm[coord] - start) * direction > 65, `${axis}/${direction} moves visibly`);
    assert.ok(worm[velocity] * direction > 170 && Math.abs(worm[velocity]) <= CONFIG.jetpackMaxSpeed);
    assert.equal(worm[axis], direction);
  }
  const quarter = flyingArena(),
    full = flyingArena();
  steerFor(quarter, { thrustX: 0.25 }, 0.6);
  steerFor(full, { thrustX: 1 }, 0.6);
  assert.ok(quarter._active().x - 800 < (full._active().x - 800) * 0.35);
  const diagonal = flyingArena();
  steerFor(diagonal, { thrustX: 1, thrustY: -1 }, 0.6);
  assert.ok(Math.hypot(diagonal._active().vx, diagonal._active().vy) <= CONFIG.jetpackMaxSpeed);
  assert.ok(Math.abs(Math.hypot(diagonal._active().thrustX, diagonal._active().thrustY) - 1) < 1e-12);
});

test('centering the flight control brakes smoothly and descends slowly; reversing responds before stopping', () => {
  const game = flyingArena(),
    worm = game._active();
  steerFor(game, { thrustX: 1, thrustY: -1 }, 0.4);
  const before = { x: worm.x, y: worm.y, vx: worm.vx, vy: worm.vy };
  steerFor(game, {}, 1 / CONFIG.tickRate);
  assert.ok(worm.vx > 0 && worm.vx < before.vx);
  assert.ok(worm.vy < 0 && worm.vy > before.vy);
  assert.ok(worm.x > before.x && worm.y < before.y, 'momentum is retained while braking');
  steerFor(game, {}, 0.8);
  assert.ok(worm.vx < before.vx * 0.1);
  assert.ok(worm.vy > 0 && worm.vy < CONFIG.jetpackIdleDescent);
  assert.equal(worm.jetpack, true);
  assert.equal(worm.thrustX, 0);
  assert.equal(worm.thrustY, 0);
  steerFor(game, { thrustX: -1, thrustY: 1 }, 0.6);
  assert.ok(worm.vx < -120 && worm.vy > 120, 'left and down reverse the preceding ascent/rightward flight');
});

test('flight release and exhausted fuel preserve momentum and return to gravity without extra ammunition', () => {
  const game = flyingArena(),
    worm = game._active();
  steerFor(game, { thrustX: 0.7, thrustY: -0.4 }, 0.4);
  const velocity = { vx: worm.vx, vy: worm.vy },
    fuel = worm.fuel;
  assert.equal(game.action('p0', { type: 'release' }).ok, true);
  assert.equal(worm.vx, velocity.vx);
  assert.equal(worm.vy, velocity.vy);
  assert.equal(worm.jetpack, false);
  assert.equal(worm.thrustX, 0);
  assert.equal(worm.thrustY, 0);
  game.step();
  assert.equal(worm.vx, velocity.vx);
  assert.ok(Math.abs(worm.vy - velocity.vy - CONFIG.gravity / CONFIG.tickRate) < 1e-10);
  assert.equal(worm.fuel, fuel);
  assert.equal(game.players[0].ammo.jetpack, 1);
  assert.equal(game.turn.shots, 0);

  const empty = flyingArena(),
    falling = empty._active();
  steerFor(empty, { thrustY: -1 }, 0.2);
  falling.fuel = 1 / CONFIG.tickRate;
  steerFor(empty, { thrustY: -1 }, 1 / CONFIG.tickRate);
  const lastPoweredVelocity = falling.vy;
  assert.equal(falling.fuel, 0);
  assert.equal(falling.jetpack, false);
  assert.equal(falling.thrustY, 0);
  empty.step();
  assert.ok(Math.abs(falling.vy - lastPoweredVelocity - CONFIG.gravity / CONFIG.tickRate) < 1e-10);
  assert.equal(empty.events.filter((event) => event.type === 'fuelEmpty').length, 1);
  assert.equal(empty.players[0].ammo.jetpack, 1);
});

test('jetpack respects walls, ceilings and floors in every direction', () => {
  for (const input of [{ thrustX: -1 }, { thrustX: 1 }, { thrustY: -1 }, { thrustY: 1 }]) {
    const game = flyingArena(),
      worm = game._active();
    game.terrain.rect(600, 250, 20, 400);
    game.terrain.rect(980, 250, 20, 400);
    game.terrain.rect(600, 250, 400, 20);
    steerFor(game, input, 1.8);
    assert.ok(game._clear(worm.x, worm.y));
    assert.ok(worm.x >= 630 && worm.x <= 970 && worm.y >= 280 && worm.y <= 640);
    assert.equal(worm.hp, 100);
    assert.equal(worm.jetpack, true);
    if (input.thrustX) assert.equal(worm.vx, 0);
    else assert.equal(worm.vy, 0);
  }
});

test('a hanging rope swings under gravity, responds to sideways impulse and releases its tangent velocity', () => {
  for (const side of [-1, 1]) {
    const game = hangingArena(),
      worm = game._active(),
      rope = worm.rope;
    worm.x = rope.x + side * 95;
    worm.y = rope.y + Math.sqrt(rope.length ** 2 - 95 ** 2);
    const x = worm.x;
    steerFor(game, {}, 0.4);
    assert.ok((worm.x - x) * side < -10, 'gravity restores the pendulum toward the anchor');
    assert.ok(worm.vx * side < -40);
    assert.ok(Math.hypot(worm.x - rope.x, worm.y - rope.y) <= rope.length + 0.1);
    assert.ok(rope.tension > 0.2 && rope.tension <= 1);
    steerFor(game, { move: -side * 0.7 }, 0.3);
    const velocity = { vx: worm.vx, vy: worm.vy };
    assert.equal(game.action('p0', { type: 'release' }).ok, true);
    assert.equal(worm.rope, null);
    assert.equal(worm.vx, velocity.vx);
    assert.equal(worm.vy, velocity.vy);
    game.step();
    assert.equal(worm.vx, velocity.vx);
    assert.ok(Math.abs(worm.vy - velocity.vy - CONFIG.gravity / CONFIG.tickRate) < 1e-10);
    assert.equal(fire(game, 'bazooka', { angle: -0.4 }).ok, true);
  }
});

test('rope reeling accelerates, slows when centered and lowers the suspended worm when extended', () => {
  const game = hangingArena(),
    worm = game._active(),
    rope = worm.rope;
  const initial = { length: rope.length, y: worm.y };
  steerFor(game, { reel: -1 }, 1 / CONFIG.tickRate);
  assert.ok(rope.reelVelocity < 0 && rope.reelVelocity > -CONFIG.ropeReelSpeed);
  steerFor(game, { reel: -1 }, 0.6);
  assert.ok(rope.length < initial.length - 40 && worm.y < initial.y - 40);
  const shortened = rope.length;
  steerFor(game, {}, 0.3);
  assert.equal(rope.reelVelocity, 0);
  assert.ok(
    rope.length < shortened && rope.length > shortened - 12,
    'carrete decelerates without a sudden stop',
  );
  const raisedY = worm.y,
    raisedLength = rope.length;
  steerFor(game, { reel: 1 }, 0.8);
  assert.ok(rope.length > raisedLength + 60);
  assert.ok(worm.y > raisedY + 35, 'extending a suspended rope actually descends');
  assert.ok(Math.hypot(worm.x - rope.x, worm.y - rope.y) <= rope.length + 0.1);
  assert.ok(game._clear(worm.x, worm.y));
});

test('a rope cannot pull its worm through a new thin platform, even when the destination is clear', () => {
  const game = hangingArena(),
    worm = game._active();
  game.terrain.rect(750, 320, 100, 2);
  worm.rope.length = 40; // Force a large constraint correction across the inserted platform.
  game.step();
  assert.ok(worm.y >= 332, 'the swept body stops below the intervening platform');
  assert.ok(game._clear(worm.x, worm.y));
  assert.ok(worm.rope.length >= Math.hypot(worm.x - worm.rope.x, worm.y - worm.rope.y) - 0.1);
  assert.equal(worm.rope.reelVelocity, 0);
});

const closestPair = (game) => {
  let best = Infinity;
  for (let i = 0; i < game.worms.length; i++)
    for (let j = i + 1; j < game.worms.length; j++)
      best = Math.min(best, Math.hypot(game.worms[i].x - game.worms[j].x, game.worms[i].y - game.worms[j].y));
  return best;
};

test('start positions keep 120 px from the side walls, reject slopes over 10 px across 28 px and need 24 px of ground', () => {
  const {
    spawnEdgeMargin: margin,
    spawnSlopeSpan: span,
    spawnSlopeTolerance: tolerance,
    spawnGroundDepth: depth,
  } = CONFIG;
  assert.deepEqual([margin, span, tolerance, depth], [120, 14, 10, 24]);
  for (const map of MAPS)
    for (const [count, worms, seed] of [
      [2, 2, 3],
      [3, 3, 11],
      [4, 4, 7],
      [6, 2, 19],
      [6, 4, 23],
    ]) {
      const game = new Game(roster(count), { mapId: map.id, mode: 'ffa', worms }, { seed });
      for (const worm of game.worms) {
        const label = `${map.id} ${count}×${worms} seed ${seed} ${worm.id}`;
        assert.ok(worm.x >= margin && worm.x <= CONFIG.worldWidth - margin, label);
        const feet = surfaceAt(game.terrain, worm.x, worm.y, worm.y + CONFIG.wormRadius + 12);
        assert.notEqual(feet, null, label);
        assert.ok(groundDepth(game.terrain, worm.x, feet) >= depth, `${label}: thin ledge`);
        const left = surfaceAt(game.terrain, worm.x - span, feet - tolerance - 1, feet + tolerance + 2);
        const right = surfaceAt(game.terrain, worm.x + span, feet - tolerance - 1, feet + tolerance + 2);
        assert.ok(
          left !== null && right !== null && Math.abs(left - right) <= tolerance,
          `${label}: slope ${left}/${feet}/${right}`,
        );
      }
    }
  // The hills' outer slopes are steep, so no foothold survives near the walls even inside the margin.
  const hills = new Game(roster(2), { mapId: 'hills', mode: 'ffa', worms: 2 }, { seed: 1 });
  assert.ok(
    hills
      ._footholds()
      .every(
        (spot) =>
          spot.x >= margin &&
          spot.x <= CONFIG.worldWidth - margin &&
          groundDepth(hills.terrain, spot.x, spot.surface) >= depth,
      ),
  );
  assert.ok(
    hills._footholds().some((spot) => spot.surface === 365),
    'the 24 px bridge is exactly thick enough',
  );
});

test('alliances start in separate bands of the map while free-for-all interleaves players along it', () => {
  for (const map of MAPS) {
    for (const [mode, teams, bands] of [
      ['2v2', [0, 0, 1, 1], 2],
      ['3v3', [0, 0, 0, 1, 1, 1], 2],
      ['2v2v2', [0, 0, 1, 1, 2, 2], 3],
    ]) {
      for (const seed of [9, 10]) {
        const game = new Game(roster(teams.length, teams), { mapId: map.id, mode, worms: 2 }, { seed });
        const bandOf = new Map();
        for (const worm of game.worms) {
          const band = Math.floor(worm.x / (CONFIG.worldWidth / bands));
          if (!bandOf.has(worm.team)) bandOf.set(worm.team, band);
          assert.equal(band, bandOf.get(worm.team), `${map.id}/${mode}/${seed}: a team shares one band`);
        }
        assert.equal(
          new Set(bandOf.values()).size,
          bands,
          `${map.id}/${mode}/${seed}: every alliance owns a different band`,
        );
      }
    }
    const ffa = new Game(roster(4), { mapId: map.id, mode: 'ffa', worms: 2 }, { seed: 9 });
    const order = [...ffa.worms].sort((a, b) => a.x - b.x || a.y - b.y).map((worm) => worm.playerId);
    assert.deepEqual(
      order,
      ['p0', 'p1', 'p2', 'p3', 'p0', 'p1', 'p2', 'p3'],
      `${map.id}: players alternate along the map`,
    );
    assert.deepEqual(
      ffa.worms.map((worm) => worm.id),
      ['p0:1', 'p1:1', 'p2:1', 'p3:1', 'p0:2', 'p1:2', 'p2:2', 'p3:2'],
    );
  }
});

test('start spacing holds 90 px for everyday rosters and relaxes deterministically only when a map is saturated', () => {
  assert.deepEqual([CONFIG.spawnSpacing, CONFIG.spawnAttempts], [90, 200]);
  for (const map of MAPS) {
    for (const [count, worms] of [
      [2, 2],
      [3, 2],
      [2, 3],
    ])
      for (const seed of [1, 2, 3, 4, 5]) {
        const game = new Game(roster(count), { mapId: map.id, mode: 'ffa', worms }, { seed });
        assert.ok(
          closestPair(game) >= CONFIG.spawnSpacing,
          `${map.id} ${count}×${worms} seed ${seed}: ${closestPair(game)}`,
        );
        assert.equal(game._relaxedSpawns, 0);
      }
    const crowded = new Game(roster(6), { mapId: map.id, mode: 'ffa', worms: 4 }, { seed: 4 });
    assert.ok(crowded._relaxedSpawns > 0, `${map.id}: 24 worms cannot all keep 90 px`);
    assert.ok(
      closestPair(crowded) >= CONFIG.wormRadius * 2 && closestPair(crowded) < CONFIG.spawnSpacing,
      `${map.id}: ${closestPair(crowded)}`,
    );
    const again = new Game(roster(6), { mapId: map.id, mode: 'ffa', worms: 4 }, { seed: 4 });
    assert.deepEqual(
      again.worms.map((w) => [w.x, w.y]),
      crowded.worms.map((w) => [w.x, w.y]),
      'the seed reproduces the start',
    );
    const other = new Game(roster(6), { mapId: map.id, mode: 'ffa', worms: 4 }, { seed: 5 });
    assert.notDeepEqual(
      other.worms.map((w) => [w.x, w.y]),
      crowded.worms.map((w) => [w.x, w.y]),
    );
  }
});

test('crate settings are coherent with the worm radius and the limited arsenal', () => {
  assert.equal(CONFIG.crateInterval, 3);
  assert.equal(CONFIG.cratePickupRadius, CONFIG.wormRadius + CONFIG.crateSize / 2);
  assert.ok(
    CONFIG.crateFallSpeed > 0 && CONFIG.crateHealth === 25 && CONFIG.crateBlastRadius < W('bazooka').radius,
  );
  assert.deepEqual(
    CRATE_CONTENTS.map((entry) => entry.id),
    ['health', 'cluster', 'dynamite', 'mine', 'airstrike', 'jetpack', 'teleport', 'girder'],
  );
  for (const entry of CRATE_CONTENTS) {
    assert.ok(entry.weight > 0);
    if (entry.id !== 'health') assert.ok(W(entry.id).ammo > 0, `${entry.id} is a limited weapon`);
  }
  assert.ok(Object.isFrozen(CRATE_CONTENTS) && CRATE_CONTENTS.every(Object.isFrozen));
  function W(id) {
    return WEAPONS.find((weapon) => weapon.id === id);
  }
});

test('a supply crate parachutes in every third turn, ignores wind, lands on terrain and never delays the turn', () => {
  const game = arena();
  assert.equal(game.crates.length, 0);
  next(game);
  assert.equal(game.turn.number, 2);
  assert.equal(game.crates.length, 0);
  next(game);
  assert.equal(game.turn.number, 3);
  assert.equal(game.crates.length, 1);
  const crate = game.crates[0];
  const drop = game.events.find((e) => e.type === 'crateDrop');
  assert.deepEqual([drop.crateId, drop.text, drop.x], [crate.id, 'Cae una caja de suministros', crate.x]);
  assert.equal(crate.parachute, true);
  assert.equal(crate.landed, false);
  assert.ok(crate.y < 0, 'an open-sky drop starts above the field');
  assert.ok(crate.x >= CONFIG.spawnEdgeMargin && crate.x <= CONFIG.worldWidth - CONFIG.spawnEdgeMargin);
  assert.ok(
    game.worms.every((worm) => Math.abs(worm.x - crate.x) >= CONFIG.crateSize * 2),
    'never straight above a worm',
  );
  const startY = crate.y,
    x = crate.x;
  game.wind = CONFIG.maxWind;
  advance(game, 1);
  assert.equal(crate.x, x, 'the parachute ignores wind');
  assert.ok(
    Math.abs(crate.y - startY - CONFIG.crateFallSpeed) < 1.5,
    `constant descent: ${crate.y - startY}`,
  );
  assert.equal(game._hasPending(), false, 'a descending crate is not a pending effect');
  next(game);
  assert.equal(game.turn.number, 4);
  advance(game, 14);
  assert.equal(crate.landed, true);
  assert.equal(crate.parachute, false);
  assert.ok(Math.abs(crate.y + CONFIG.crateSize / 2 - 650) <= 1.5, `rests on the floor: ${crate.y}`);
  assert.ok(game.events.some((e) => e.type === 'crateLand' && e.crateId === crate.id));
  assert.deepEqual(game.snapshot(false).crates, [
    { id: crate.id, x: crate.x, y: crate.y, parachute: false, landed: true },
  ]);
  next(game);
  next(game);
  assert.equal(game.turn.number, 6);
  assert.equal(game.crates.length, 2);
  // Blowing the ground away under a resting crate makes it fall again until it finds new support.
  game.terrain.circle(crate.x, 700, 60);
  advance(game, 1.5);
  assert.equal(crate.landed, true);
  assert.ok(crate.y > 700, `fell into the crater: ${crate.y}`);
  const second = game.crates[1];
  advance(game, 30);
  assert.equal(second.landed, true, 'later drops land too');
});

test('the active worm collects crates: health heals up to 100 and a limited weapon restocks one unit below its initial stock', () => {
  const game = arena(),
    worm = game._active(),
    player = game.players[0];
  const give = (x = worm.x, y = worm.y) => {
    game.crates.push({ id: `c${game._id++}`, x, y, vy: 0, parachute: false, landed: true });
    game.step();
    return game.events.findLast((e) => e.type === 'cratePickup');
  };
  worm.hp = 60;
  let pickup = give();
  assert.equal(worm.hp, 85);
  assert.equal(game.crates.length, 0);
  assert.deepEqual(
    [pickup.text, pickup.kind, pickup.amount, pickup.wormId, pickup.playerId, pickup.x],
    ['+25 salud', 'health', 25, worm.id, 'p0', worm.x],
  );
  worm.hp = 90;
  pickup = give();
  assert.equal(worm.hp, 100);
  assert.equal(pickup.text, '+10 salud');
  player.ammo.dynamite = 0;
  pickup = give();
  assert.equal(player.ammo.dynamite, 1);
  assert.deepEqual([pickup.text, pickup.kind, pickup.amount], ['+1 dinamita', 'dynamite', 1]);
  assert.equal(player.ammo.bazooka, -1, 'unlimited weapons are never restocked');
  // Dynamite is still below its stock of two, so refill it before isolating the airstrike.
  player.ammo.dynamite = 2;
  player.ammo.airstrike = 0;
  pickup = give();
  assert.equal(player.ammo.airstrike, 1);
  assert.equal(pickup.text, '+1 ataque aéreo');
  pickup = give();
  assert.equal(pickup.text, 'Salud al máximo');
  assert.equal(worm.hp, 100);
  assert.deepEqual(
    [player.ammo.dynamite, player.ammo.airstrike],
    [2, 1],
    'a full roster is never overstocked',
  );
  // A bystander standing on a crate leaves it where it is, and a crate one pixel out of reach stays too.
  const bystander = game.worms.find((w) => w.playerId === 'p1');
  game.crates.push({ id: 'idle', x: bystander.x, y: bystander.y, vy: 0, parachute: false, landed: true });
  game.crates.push({
    id: 'far',
    x: worm.x + CONFIG.cratePickupRadius + 1,
    y: worm.y + 2.5,
    vy: 0,
    parachute: false,
    landed: true,
  });
  advance(game, 0.5);
  assert.deepEqual(
    game.crates.map((crate) => crate.id),
    ['idle', 'far'],
  );
  // The cavern never hands out an airstrike it cannot use.
  const cavern = arena({ mapId: 'cavern' }),
    miner = cavern._active();
  cavern.players[0].ammo.airstrike = 0;
  cavern.crates.push({ id: 'roof', x: miner.x, y: miner.y, vy: 0, parachute: false, landed: true });
  cavern.step();
  assert.equal(cavern.players[0].ammo.airstrike, 0);
  assert.equal(cavern.events.findLast((e) => e.type === 'cratePickup').text, 'Salud al máximo');
});

test('explosions break nearby crates with a small scuff on the ground, no damage and no push', () => {
  const game = arena();
  game.crates.push({ id: 'spared', x: 1300, y: 641.5, vy: 0, parachute: false, landed: true });
  game.crates.push({ id: 'box', x: 1160, y: 641.5, vy: 0, parachute: false, landed: true });
  game.projectiles.push({
    id: 'near',
    kind: 'grenade',
    x: 1230,
    y: 640,
    vx: 0,
    vy: 0,
    fuse: 0.001,
    radius: 60,
    damage: 20,
    age: 0,
  });
  game.step();
  assert.deepEqual(
    game.crates.map((crate) => crate.id),
    ['spared', 'box'],
    'a blast that ends 70 px away leaves both crates',
  );
  game.projectiles.push({
    id: 'burst',
    kind: 'grenade',
    x: 1100,
    y: 640,
    vx: 0,
    vy: 0,
    fuse: 0.001,
    radius: 60,
    damage: 20,
    age: 0,
  });
  game.step();
  assert.deepEqual(
    game.crates.map((crate) => crate.id),
    ['spared'],
  );
  const broken = game.events.find((e) => e.type === 'crateDestroyed');
  assert.deepEqual(
    [broken.x, broken.y, broken.radius, broken.weapon, broken.crateId],
    [1160, 641.5, CONFIG.crateBlastRadius, 'grenade', 'box'],
  );
  assert.equal(game.terrain.solid(1160, 650), false, 'the crate scuffs its own footprint');
  assert.equal(game.terrain.solid(1160, 658), true, 'beyond the small radius the ground survives');
  assert.ok(game.worms.every((worm) => worm.hp === 100 && worm.vx === 0 && worm.vy === 0));
  assert.ok(!game.events.some((e) => e.type === 'damage'));
  // A crate under the parachute is just as fragile.
  game.crates.push({ id: 'air', x: 800, y: 300, vy: 0, parachute: true, landed: false });
  game.projectiles.push({
    id: 'flak',
    kind: 'grenade',
    x: 820,
    y: 330,
    vx: 0,
    vy: 0,
    fuse: 0.001,
    radius: 60,
    damage: 20,
    age: 0,
  });
  game.step();
  assert.deepEqual(
    game.crates.map((crate) => crate.id),
    ['spared'],
  );
  assert.equal(game.events.filter((e) => e.type === 'crateDestroyed').length, 2);
});

test('crates travel in snapshots and every drop opens in clear air above dry, flat ground', () => {
  const game = arena();
  game.crates.push({ id: 'c1', x: 400, y: 100, vy: 0, parachute: true, landed: false });
  const full = JSON.parse(JSON.stringify(game.snapshot()));
  assert.deepEqual(full.crates, [{ id: 'c1', x: 400, y: 100, parachute: true, landed: false }]);
  const partial = game.snapshot(false);
  partial.crates[0].x = 9;
  assert.equal(game.crates[0].x, 400);
  const half = CONFIG.crateSize / 2;
  for (const map of MAPS)
    for (const seed of [1, 2, 3]) {
      const real = new Game(roster(4), { mapId: map.id, mode: 'ffa', worms: 2 }, { seed });
      for (let i = 0; i < 25; i++) {
        const crate = real._dropCrate();
        const label = `${map.id} seed ${seed} drop ${i}`;
        assert.ok(crate, label);
        assert.ok(
          crate.x >= CONFIG.spawnEdgeMargin && crate.x <= CONFIG.worldWidth - CONFIG.spawnEdgeMargin,
          label,
        );
        assert.equal(real.terrain.solid(crate.x, crate.y), false, `${label}: never inside rock`);
        const landing = surfaceAt(real.terrain, crate.x, Math.max(0, crate.y), real.waterY);
        assert.notEqual(landing, null, `${label}: dry ground below the drop`);
        assert.ok(
          groundDepth(real.terrain, crate.x, landing) >= CONFIG.spawnGroundDepth,
          `${label}: lands on thick ground`,
        );
        assert.ok(
          crate.y < 0 || real.terrain.solid(crate.x, crate.y - half - 3),
          `${label}: opens from the sky or right under a ceiling`,
        );
        if (map.id === 'cavern') assert.ok(crate.y > 143, `${label}: below the cavern roof`);
        assert.ok(
          real.worms.every((worm) => Math.abs(worm.x - crate.x) >= CONFIG.crateSize * 2),
          label,
        );
      }
      assert.equal(real.snapshot(false).crates.length, 25);
    }
  // Rising water swallows a crate instead of letting it float.
  game.crates[0].y = 600;
  game.crates[0].parachute = false;
  game.crates[0].landed = true;
  game.waterY = 600;
  game.step();
  assert.equal(game.crates.length, 0);
  assert.ok(game.events.some((e) => e.type === 'splash' && e.weapon === 'crate'));
});

const damageTo = (game, wormId) =>
  game.events.filter((e) => e.type === 'damage' && e.wormId === wormId).reduce((sum, e) => sum + e.amount, 0);
// Knocked worms need to land before the settling phase can hand over the turn.
const pass = (game) => {
  assert.equal(game.action(game.turn.playerId, { type: 'end' }).ok, true);
  advance(game, 2);
};

test('match statistics credit a direct hit to the shooter and travel only with the finished state', () => {
  const game = arena(),
    target = game.worms.find((w) => w.playerId === 'p1');
  assert.equal(fire(game, 'shotgun').ok, true);
  assert.equal(target.hp, 76);
  assert.deepEqual(game.stats.p0, {
    shots: 1,
    damageDealt: 24,
    friendlyDamage: 0,
    damageTaken: 0,
    kills: 0,
    teamKills: 0,
    bestShot: { damage: 24, weapon: 'shotgun' },
    longestShot: 0,
  });
  assert.deepEqual(game.stats.p1, {
    shots: 0,
    damageDealt: 0,
    friendlyDamage: 0,
    damageTaken: 24,
    kills: 0,
    teamKills: 0,
    bestShot: { damage: 0, weapon: null },
    longestShot: 0,
  });
  const live = game.snapshot(false);
  assert.equal(live.stats, undefined, 'live snapshots do not carry statistics');
  assert.equal(live.result, null);
  assert.equal(JSON.stringify(live).includes('damageDealt'), false);
  assert.equal(
    live.worms.some((worm) => '_lastAttack' in worm),
    false,
  );
  // Mobility and construction are not shots; the second shotgun blast is.
  game.terrain.rect(80, 340, 300, 20);
  advance(game, 0.55);
  assert.equal(fire(game, 'shotgun', { angle: -Math.PI / 2 }).ok, true);
  assert.equal(game.stats.p0.shots, 2);
  assert.equal(game.stats.p0.damageDealt, 24, 'a miss adds nothing');
  const tools = arena();
  tools.terrain.rect(80, 340, 300, 20);
  assert.equal(fire(tools, 'rope', { angle: -Math.PI / 2 }).ok, true);
  assert.equal(tools.action('p0', { type: 'release' }).ok, true);
  advance(tools, 0.2);
  assert.equal(fire(tools, 'jetpack').ok, true);
  advance(tools, 0.2);
  assert.equal(fire(tools, 'girder', { x: 270, y: 535 }).ok, true);
  assert.equal(tools.stats.p0.shots, 0);
});

test('splash damage on several rivals accumulates into one best shot with its impact distance', () => {
  const game = arena({ count: 4 }),
    shooter = game._active();
  const first = game.worms.find((w) => w.playerId === 'p1'),
    second = game.worms.find((w) => w.playerId === 'p2');
  first.x = shooter.x + 40;
  second.x = shooter.x + 68;
  const origin = { x: shooter.x, y: shooter.y };
  assert.equal(fire(game, 'bazooka', { angle: 0.4, power: 0.1 }).ok, true);
  advance(game, 0.3);
  const explosion = game.events.find((e) => e.type === 'explosion' && e.weapon === 'bazooka');
  assert.ok(explosion);
  const toFirst = damageTo(game, first.id),
    toSecond = damageTo(game, second.id),
    toSelf = damageTo(game, shooter.id);
  assert.ok(toFirst > 0 && toSecond > 0 && toSelf > 0, 'two rivals and the shooter stand inside the blast');
  const stats = game.stats.p0;
  assert.equal(stats.shots, 1);
  assert.equal(
    stats.damageDealt,
    toFirst + toSecond,
    'damage to rivals adds up across every worm hit by the attack',
  );
  assert.deepEqual(stats.bestShot, { damage: toFirst + toSecond, weapon: 'bazooka' });
  assert.equal(stats.friendlyDamage, toSelf, 'self damage is friendly fire, not damage dealt');
  assert.equal(stats.damageTaken, toSelf);
  assert.ok(
    Math.abs(stats.longestShot - Math.hypot(explosion.x - origin.x, explosion.y - origin.y)) < 1e-9,
    'longest shot is measured from the shooter to the impact',
  );
  assert.equal(game.stats.p1.damageTaken, toFirst);
  assert.equal(game.stats.p2.damageTaken, toSecond);
  assert.equal(game.stats.p1.damageDealt, 0);
  assert.equal(game.stats.p3.damageTaken, 0);
  // A later, weaker hit does not replace the best shot; a stronger one does.
  advance(game, 3);
  const bigger = stats.bestShot.damage;
  for (const worm of game.worms) worm._lastAttack = null;
  const dynamite = arena({ count: 4 });
  const victim = dynamite.worms.find((w) => w.playerId === 'p1');
  victim.x = dynamite._active().x + 24;
  victim.hp = 100;
  assert.equal(fire(dynamite, 'dynamite').ok, true);
  advance(dynamite, 4.2);
  assert.ok(dynamite.stats.p0.bestShot.damage >= damageTo(dynamite, victim.id));
  assert.equal(dynamite.stats.p0.bestShot.weapon, 'dynamite');
  assert.equal(dynamite.stats.p0.longestShot, 0, 'placed explosives do not count as a long shot');
  assert.ok(bigger > 0);
});

test('friendly fire is kept apart from damage dealt and an eliminated ally counts as a team elimination', () => {
  const game = arena({ count: 4, mode: '2v2', teams: [0, 0, 1, 1] });
  const shooter = game._active(),
    ally = game.worms.find((w) => w.playerId === 'p1');
  ally.x = shooter.x + 33;
  ally.hp = 1;
  assert.equal(fire(game, 'bazooka', { angle: 0.4, power: 0.1 }).ok, true);
  advance(game, 1.2);
  assert.equal(ally.hp, 0);
  assert.ok(
    game.events.some((e) => e.type === 'explosion' && e.weapon === 'death'),
    'the corpse blast resolved',
  );
  const stats = game.stats.p0;
  assert.equal(stats.damageDealt, 0);
  assert.equal(stats.kills, 0);
  assert.equal(stats.teamKills, 1);
  assert.deepEqual(stats.bestShot, { damage: 0, weapon: null });
  assert.equal(stats.longestShot, 0, 'a shot that only hurts allies is not a long shot');
  assert.equal(
    stats.friendlyDamage,
    damageTo(game, shooter.id) + damageTo(game, ally.id),
    'self damage and the ally, including the corpse blast, are friendly fire',
  );
  assert.equal(game.stats.p1.damageTaken, 1);
  assert.equal(game.stats.p2.damageTaken + game.stats.p3.damageTaken, 0);
});

test('a worm knocked into the water during the turn is an elimination for the attacker', () => {
  const game = arena(),
    shooter = game._active(),
    victim = game.worms.find((w) => w.playerId === 'p1');
  victim.x = shooter.x + 40;
  game.terrain.rect(215, 650, 500, 250, false);
  assert.equal(fire(game, 'bazooka', { angle: 0.4, power: 0.1 }).ok, true);
  advance(game, 3);
  assert.equal(victim.hp, 0);
  assert.ok(
    game.events.some((e) => e.type === 'splash' && e.wormId === victim.id),
    'the victim drowned instead of dying from damage',
  );
  assert.equal(game.stats.p0.kills, 1);
  assert.equal(game.stats.p0.damageDealt, damageTo(game, victim.id));
  assert.equal(game.stats.p1.kills, 0);
  // Credit for knockback expires with the turn: a later unrelated fall is nobody's elimination.
  const later = arena(),
    fallen = later.worms.find((w) => w.playerId === 'p1');
  assert.equal(fire(later, 'shotgun').ok, true);
  pass(later);
  assert.equal(later.turn.playerId, 'p1');
  fallen.hp = 1;
  fallen.y = 300;
  fallen.grounded = false;
  advance(later, 3);
  assert.equal(fallen.hp, 0);
  assert.equal(later.stats.p0.kills, 0);
  assert.equal(later.stats.p1.kills, 0);
});

test('the result names the player of the match by damage dealt, then eliminations, and exposes immutable statistics', () => {
  const game = arena({ count: 3 });
  assert.equal(fire(game, 'shotgun').ok, true);
  assert.equal(game.stats.p0.damageDealt, 24);
  pass(game);
  assert.equal(game.turn.playerId, 'p1');
  const prey = game.worms.find((w) => w.playerId === 'p2');
  prey.hp = 24;
  assert.equal(fire(game, 'shotgun').ok, true);
  assert.equal(prey.hp, 0);
  advance(game, 1.5);
  assert.equal(game.stats.p1.damageDealt, 24);
  assert.equal(game.stats.p1.kills, 1);
  assert.equal(game.snapshot(false).stats, undefined);
  game.forfeit('p0');
  game.forfeit('p2');
  advance(game, 1);
  assert.equal(game.phase, 'finished');
  assert.deepEqual(game.result.winnerIds, ['p1']);
  assert.equal(game.result.mvpId, 'p1', 'equal damage dealt is broken by eliminations');
  assert.deepEqual(
    game.result.stats.map((s) => s.playerId),
    ['p0', 'p1', 'p2'],
  );
  const snapshot = JSON.parse(JSON.stringify(game.snapshot()));
  assert.deepEqual(snapshot.stats, game.result.stats);
  assert.deepEqual(snapshot.result.stats, game.result.stats);
  assert.equal(snapshot.result.mvpId, 'p1');
  assert.deepEqual(snapshot.stats[1], {
    playerId: 'p1',
    shots: 1,
    damageDealt: 24,
    friendlyDamage: 0,
    damageTaken: 24,
    kills: 1,
    teamKills: 0,
    bestShot: { damage: 24, weapon: 'shotgun' },
    longestShot: 0,
  });
  const partial = game.snapshot(false);
  partial.stats[1].kills = 99;
  partial.stats[1].bestShot.damage = 99;
  partial.result.stats[0].shots = 99;
  assert.equal(game.stats.p1.kills, 1);
  assert.equal(game.stats.p1.bestShot.damage, 24);
  assert.equal(game.stats.p0.shots, 1);
  assert.equal(game.result.stats[0].shots, 1);
  // Forfeits are not eliminations and a bloodless finish has no player of the match.
  const quiet = arena();
  quiet.forfeit('p1');
  advance(quiet, 1);
  assert.equal(quiet.phase, 'finished');
  assert.equal(quiet.result.mvpId, null);
  assert.ok(quiet.result.stats.every((s) => s.kills === 0 && s.damageDealt === 0 && s.shots === 0));
  // With equal damage and eliminations the roster order decides.
  const tie = arena({ count: 3 });
  assert.equal(fire(tie, 'shotgun').ok, true);
  pass(tie);
  assert.equal(fire(tie, 'shotgun').ok, true);
  advance(tie, 1);
  tie.forfeit('p2');
  tie.forfeit('p1');
  advance(tie, 1);
  assert.equal(tie.result.mvpId, 'p0');
});
