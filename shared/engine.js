import { surfaceAt, groundDepth, clearAt, supportAt, stepWorm } from './physics.js';
export { surfaceAt, groundDepth, clearAt, supportAt, applyJump, stepWorm } from './physics.js';
import { action } from './actions.js';
import { emptyStats, _beginAttack, _recordDamage, _recordKill, _mvp, _statsSnapshot } from './statistics.js';
import { CONFIG, WEAPONS, MAPS, MODES, TURN_DURATIONS, CRATE_CONTENTS } from './config.js';
import { Terrain } from './terrain.js';
import { pickWormNames } from './names.js';

const W = Object.fromEntries(WEAPONS.map((weapon) => [weapon.id, weapon]));
const R = CONFIG.wormRadius;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const COLORS = ['#f38b63', '#66cacc', '#b4cf77', '#be9bea', '#f0c56c', '#ed91b7'];
// Only launched projectiles measure a "longest shot": placed, aimed-ray and aerial weapons do not.
const LONG_SHOT_KINDS = new Set(['bazooka', 'grenade', 'cluster']);

/** First solid row of column x inside [top, bottom), or null when it is all air. */

/** Consecutive solid rows from (x, y) downward. */

/** A worm-sized circle fits at (x, y): no terrain pixel on its outline or centre, inside the world. */

/** Ground contact under a worm, swept pixel by pixel so thin slivers and crater edges count. */

/** The takeoff impulse of a normal or backward jump, shared by the server and local prediction. */

/**
 * One fixed step of a worm: tool thrust or rope, walking, gravity, terrain
 * contact, climbing, fall damage and drowning. Pure with respect to the game:
 * it reads `terrain.solid`, mutates only `worm` and reports side effects through
 * the callbacks, so the server and the client's local prediction share one path.
 * `input` is the controlled worm's command ({ move, thrustX, thrustY, reel }).
 */

export class Game {
  constructor(players, settings = {}, { seed = Date.now() } = {}) {
    if (!Array.isArray(players) || players.length < 2 || players.length > 6)
      throw new Error('Se necesitan de dos a seis jugadores.');
    if (
      new Set(players.map((p) => p.id)).size !== players.length ||
      players.some((p) => typeof p.id !== 'string' || !p.id)
    )
      throw new Error('Identidades de jugador inválidas.');
    this.mapId = settings.mapId ?? 'hills';
    this.mode = settings.mode ?? 'ffa';
    this.wormCount = settings.worms ?? 2;
    this.turnSeconds = Object.hasOwn(settings, 'turnSeconds') ? settings.turnSeconds : CONFIG.turnSeconds;
    if (
      !MAPS.some((map) => map.id === this.mapId) ||
      !MODES.some((mode) => mode.id === this.mode) ||
      ![2, 3, 4].includes(this.wormCount) ||
      !TURN_DURATIONS.includes(this.turnSeconds)
    )
      throw new Error('Configuración de partida inválida.');
    const mode = MODES.find((m) => m.id === this.mode);
    if (!mode.players.includes(players.length))
      throw new Error('Número de jugadores incompatible con la modalidad.');
    if (this.mode !== 'ffa') {
      const sizes = new Map();
      for (const p of players) {
        if (!Number.isInteger(p.team) || p.team < 0 || p.team > 2) throw new Error('Equipo inválido.');
        sizes.set(p.team, (sizes.get(p.team) || 0) + 1);
      }
      const requiredSize = this.mode === '3v3' ? 3 : 2;
      const requiredTeams = this.mode === '2v2v2' ? 3 : 2;
      if (sizes.size !== requiredTeams || [...sizes.values()].some((size) => size !== requiredSize))
        throw new Error('La composición de equipos no corresponde a la modalidad.');
    }
    this.players = players.map((player, index) => ({
      id: player.id,
      name: String(player.name || `Jugador ${index + 1}`).slice(0, 24),
      team: this.mode === 'ffa' ? index : player.team,
      color: player.color || COLORS[index],
      ammo: Object.fromEntries(WEAPONS.map((weapon) => [weapon.id, weapon.ammo])),
    }));
    this.terrain = new Terrain(this.mapId);
    this.worms = [];
    this.projectiles = [];
    this.mines = [];
    this.crates = [];
    this.girders = [];
    this.events = [];
    this.phase = 'playing';
    this.result = null;
    this.stats = Object.fromEntries(this.players.map((player) => [player.id, emptyStats()]));
    this.elapsed = 0;
    this.waterY = CONFIG.waterY;
    this.wind = 0;
    this.turn = null;
    this._seed = Number(seed) >>> 0;
    this._id = 0;
    this._attackSeq = 0;
    this._accumulator = 0;
    this._pendingDeaths = [];
    this._input = {};
    this._inputAt = -1;
    this._settledFor = 0;
    this._suddenDeath = false;
    this._lastShotAt = -10;
    this._allianceIndex = -1;
    this._alliances = [...new Set(this.players.map((p) => p.team))];
    this._memberCursors = new Map(this._alliances.map((team) => [team, -1]));
    this._wormCursors = new Map(this.players.map((p) => [p.id, -1]));
    this._spawn();
    this._nextTurn();
  }

  _random() {
    this._seed = (this._seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this._seed ^ (this._seed >>> 15), 1 | this._seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  _event(type, fields = {}) {
    this.events.push({ id: ++this._id, type, ...fields });
    if (this.events.length > 32) this.events.splice(0, this.events.length - 32);
  }

  _clear(x, y, radius = R) {
    return clearAt(this.terrain, x, y, radius);
  }

  _support(worm, offset = 2) {
    return supportAt(this.terrain, worm, offset);
  }

  /** Flat, thick footholds away from the side walls. Every start position and
   *  every crate landing comes from this pool, so nobody begins on a slope lip,
   *  over a thin ledge or against the edge of the world. */
  _footholds() {
    const {
      spawnEdgeMargin: margin,
      spawnSlopeSpan: span,
      spawnSlopeTolerance: tolerance,
      spawnGroundDepth: depth,
    } = CONFIG;
    const spots = [];
    for (let x = margin; x <= CONFIG.worldWidth - margin; x += 4) {
      for (let y = 245; y < this.waterY - 75; y++) {
        if (
          !this.terrain.solid(x, y) ||
          this.terrain.solid(x, y - 1) ||
          groundDepth(this.terrain, x, y) < depth
        )
          continue;
        const left = surfaceAt(this.terrain, x - span, y - tolerance - 1, y + tolerance + 2);
        const right = surfaceAt(this.terrain, x + span, y - tolerance - 1, y + tolerance + 2);
        if (
          left === null ||
          right === null ||
          Math.max(Math.abs(left - right), Math.abs(left - y), Math.abs(right - y)) > tolerance
        )
          continue;
        for (let lift = 1; lift <= 9; lift++) {
          const point = { x, y: y - R - lift, surface: y };
          if (this._clear(point.x, point.y) && this._support(point, lift + 1)) {
            spots.push(point);
            break;
          }
        }
      }
    }
    return spots;
  }

  _spawn() {
    const spots = this._footholds();
    const placed = [];
    this._relaxedSpawns = 0;
    const gap = (point) => placed.reduce((best, other) => Math.min(best, distance(point, other)), Infinity);
    const pick = (pool) => {
      if (!pool.length) return null;
      // Seeded draws keep the full spacing; only a saturated pool relaxes it to the widest gap left.
      let best = null,
        bestGap = -Infinity;
      for (let attempt = 0; attempt < CONFIG.spawnAttempts; attempt++) {
        const point = pool[Math.floor(this._random() * pool.length)];
        const space = gap(point);
        if (space >= CONFIG.spawnSpacing) return point;
        if (space > bestGap) {
          best = point;
          bestGap = space;
        }
      }
      for (const point of pool) {
        const space = gap(point);
        if (space > bestGap) {
          best = point;
          bestGap = space;
        }
      }
      if (bestGap < R * 2) return null;
      this._relaxedSpawns++;
      return best;
    };
    // Team modes hand each alliance its own vertical band (halves or thirds, with
    // the sides shuffled per match). Free-for-all draws from the whole map and
    // interleaves players along it so nobody owns an island.
    const alliances = this.mode === 'ffa' ? [null] : [...this._alliances];
    for (let i = alliances.length - 1; i > 0; i--) {
      const j = Math.floor(this._random() * (i + 1));
      [alliances[i], alliances[j]] = [alliances[j], alliances[i]];
    }
    const band = CONFIG.worldWidth / alliances.length;
    const counts = new Map();
    for (const [index, team] of alliances.entries()) {
      const members = team === null ? this.players : this.players.filter((player) => player.team === team);
      const pool = spots.filter((spot) => spot.x >= index * band && spot.x < (index + 1) * band);
      const chosen = [];
      for (let n = 0; n < members.length * this.wormCount; n++) {
        const point = pick(pool) || pick(spots);
        if (!point) throw new Error('No hay suficientes posiciones de inicio seguras.');
        placed.push(point);
        chosen.push(point);
      }
      chosen.sort((a, b) => a.x - b.x || a.y - b.y);
      for (const [n, point] of chosen.entries()) {
        const player = members[n % members.length];
        const number = (counts.get(player.id) || 0) + 1;
        counts.set(player.id, number);
        const facing = this.worms.length % 2 ? -1 : 1;
        this.worms.push({
          id: `${player.id}:${number}`,
          playerId: player.id,
          name: `${player.name} ${number}`,
          playerName: player.name,
          team: player.team,
          color: player.color,
          x: point.x,
          y: point.y,
          vx: 0,
          vy: 0,
          hp: CONFIG.initialHealth,
          facing,
          aim: facing < 0 ? (-Math.PI * 3) / 4 : -Math.PI / 4,
          grounded: true,
          rope: null,
          jetpack: false,
          fuel: 0,
          thrustX: 0,
          thrustY: 0,
        });
      }
    }
    // Nicknames are drawn after the positions, so the seeded spawn sequence stays
    // intact; a match never repeats one and every client of the same seed agrees.
    const names = pickWormNames(this.worms.length, () => this._random());
    this.worms.forEach((worm, index) => {
      worm.name = names[index];
    });
  }

  _active() {
    return this.worms.find((worm) => worm.id === this.turn?.wormId && worm.hp > 0);
  }

  _release(worm) {
    if (worm) {
      worm.rope = null;
      worm.jetpack = false;
      worm.thrustX = 0;
      worm.thrustY = 0;
    }
  }

  _nextTurn() {
    this._release(this._active());
    // Knockback consequences (drowning, lethal falls) are credited only within the turn that caused them.
    for (const worm of this.worms) worm._lastAttack = null;
    if (this._finishIfWon()) return;
    for (let i = 0; i < this._alliances.length; i++) {
      this._allianceIndex = (this._allianceIndex + 1) % this._alliances.length;
      const team = this._alliances[this._allianceIndex];
      const members = this.players.filter((player) => player.team === team);
      let memberIndex = this._memberCursors.get(team);
      for (let j = 0; j < members.length; j++) {
        memberIndex = (memberIndex + 1) % members.length;
        const player = members[memberIndex];
        const roster = this.worms.filter((worm) => worm.playerId === player.id);
        if (!roster.some((worm) => worm.hp > 0)) continue;
        this._memberCursors.set(team, memberIndex);
        let wormIndex = this._wormCursors.get(player.id);
        do {
          wormIndex = (wormIndex + 1) % roster.length;
        } while (roster[wormIndex].hp <= 0);
        this._wormCursors.set(player.id, wormIndex);
        this.turn = {
          playerId: player.id,
          wormId: roster[wormIndex].id,
          number: (this.turn?.number || 0) + 1,
          remaining: this.turnSeconds,
          stage: 'action',
          shots: 0,
        };
        this._input = {};
        this._inputAt = -1;
        this._settledFor = 0;
        this.wind = Math.round((this._random() * 2 - 1) * CONFIG.maxWind);
        this._event('turn', {
          text: `Turno de ${player.name}`,
          x: roster[wormIndex].x,
          y: roster[wormIndex].y,
        });
        if (this.turn.number % CONFIG.crateInterval === 0) this._dropCrate();
        return;
      }
    }
    this._finishIfWon();
  }

  _finishIfWon() {
    if (this._hasPending()) return false;
    const aliveTeams = new Set(this.worms.filter((worm) => worm.hp > 0).map((worm) => worm.team));
    if (aliveTeams.size > 1) return false;
    const draw = aliveTeams.size === 0;
    const team = [...aliveTeams][0];
    const winners = draw ? [] : this.players.filter((player) => player.team === team);
    const text = draw
      ? '¡Empate! Nadie quedó en pie.'
      : this.mode === 'ffa'
        ? `¡${winners[0].name} gana la partida!`
        : `¡El equipo ${team + 1} gana la partida!`;
    this.result = {
      draw,
      winnerIds: winners.map((player) => player.id),
      text,
      mvpId: this._mvp(),
      stats: this._statsSnapshot(),
    };
    this.phase = 'finished';
    this._event('result', { text });
    return true;
  }

  _hasPending() {
    return (
      this.projectiles.length > 0 ||
      this._pendingDeaths.length > 0 ||
      this.mines.some(
        (mine) =>
          Number.isFinite(mine.fuse) ||
          mine.armIn > 0 ||
          Math.abs(mine.vx) > 5 ||
          Math.abs(mine.vy) > 5 ||
          !this._mineSupported(mine),
      ) ||
      this.worms.some(
        (worm) => worm.hp > 0 && (!this._support(worm, 3) || Math.abs(worm.vx) > 5 || Math.abs(worm.vy) > 5),
      )
    );
  }

  _mineSupported(mine) {
    for (let offset = 4; offset <= 8; offset++) if (this.terrain.solid(mine.x, mine.y + offset)) return true;
    return false;
  }

  _settle() {
    if (this.turn.stage !== 'settling') {
      this.turn.stage = 'settling';
      this.turn.remaining = 0;
      this._input = {};
      this._release(this._active());
      this._settledFor = 0;
    }
  }

  /** One accepted attack groups every explosion, fragment, chained mine and corpse blast it causes. */
  _beginAttack(...args) {
    return _beginAttack(this, ...args);
  }

  _recordDamage(...args) {
    return _recordDamage(this, ...args);
  }

  _recordKill(...args) {
    return _recordKill(this, ...args);
  }

  /** Jugador de la partida: most damage to rivals, then most eliminations, then roster order. */
  _mvp(...args) {
    return _mvp(this, ...args);
  }

  _statsSnapshot(...args) {
    return _statsSnapshot(this, ...args);
  }

  _attackUsed(weapon, worm) {
    this.turn.weapon = weapon;
    this.turn.shots++;
    this._release(worm);
    if (weapon !== 'shotgun' || this.turn.shots >= 2) {
      this.turn.stage = 'retreat';
      this.turn.remaining = CONFIG.retreatSeconds;
    }
  }

  action(...args) {
    return action(this, ...args);
  }

  _ray(x, y, dx, dy, range, hitWorms, excludedId) {
    for (let d = 2; d <= range; d += 2) {
      const px = x + dx * d,
        py = y + dy * d;
      if (px < 0 || px >= CONFIG.worldWidth || py < 0 || py >= CONFIG.worldHeight)
        return { x: px, y: py, distance: d };
      if (this.terrain.solid(px, py)) return { x: px, y: py, distance: d, terrain: true };
      if (hitWorms) {
        const worm = this.worms.find(
          (w) => w.hp > 0 && w.id !== excludedId && Math.hypot(w.x - px, w.y - py) <= R + 1,
        );
        if (worm) return { x: px, y: py, distance: d, worm };
      }
    }
    return { x: x + dx * range, y: y + dy * range, distance: range };
  }

  _teleportDestination(x, y, worm) {
    if (
      Math.hypot(x - worm.x, y - worm.y) > CONFIG.teleportRange ||
      x < R + 2 ||
      x > CONFIG.worldWidth - R - 2
    )
      return null;
    // Tapping the floor or the empty space just above it both select a landing.
    for (let testY = Math.max(R + 1, y - 30); testY <= Math.min(y + 58, this.waterY - R - 4); testY++) {
      const dest = { x, y: testY };
      if (
        this._clear(x, testY) &&
        this._support(dest, 2) &&
        !this.worms.some((other) => other.hp > 0 && other.id !== worm.id && distance(dest, other) < R * 2.5)
      )
        return dest;
    }
    return null;
  }

  _validGirder(x, y, worm) {
    const halfW = CONFIG.girderWidth / 2,
      halfH = CONFIG.girderHeight / 2;
    if (
      distance({ x, y }, worm) > CONFIG.girderRange ||
      x - halfW < 0 ||
      x + halfW >= CONFIG.worldWidth ||
      y - halfH < 0 ||
      y + halfH >= this.waterY - 2
    )
      return false;
    for (let row = Math.floor(y - halfH) - 2; row <= Math.ceil(y + halfH) + 2; row++)
      for (let col = Math.floor(x - halfW) - 2; col <= Math.ceil(x + halfW) + 2; col++)
        if (this.terrain.solid(col, row)) return false;
    return ![...this.worms.filter((w) => w.hp > 0), ...this.projectiles, ...this.mines, ...this.crates].some(
      (other) => Math.abs(other.x - x) < halfW + R + 2 && Math.abs(other.y - y) < halfH + R + 2,
    );
  }

  /** Every crateInterval turns a crate parachutes toward a foothold nobody stands under. */
  _dropCrate() {
    const half = CONFIG.crateSize / 2;
    const spots = this._footholds().filter(
      (spot) => !this.worms.some((worm) => worm.hp > 0 && Math.abs(worm.x - spot.x) < CONFIG.crateSize * 2),
    );
    if (!spots.length) return null;
    const spot = spots[Math.floor(this._random() * spots.length)];
    // The canopy opens under any ceiling above the landing (the cavern roof, a
    // shelf, the bridge), so a crate never starts inside rock or falls through it.
    let top = spot.surface;
    while (top > 0 && !this.terrain.solid(spot.x, top - 1)) top--;
    const crate = {
      id: `c${++this._id}`,
      x: spot.x,
      y: top > 0 ? top + half + 2 : -half - 6,
      vy: 0,
      parachute: true,
      landed: false,
    };
    this.crates.push(crate);
    this._event('crateDrop', {
      x: crate.x,
      y: crate.y,
      crateId: crate.id,
      text: 'Cae una caja de suministros',
    });
    return crate;
  }

  _crateBlocked(x, bottom) {
    const reach = CONFIG.crateSize * 0.35;
    return (
      this.terrain.solid(x, bottom) ||
      this.terrain.solid(x - reach, bottom) ||
      this.terrain.solid(x + reach, bottom)
    );
  }

  _moveCrates(dt) {
    const half = CONFIG.crateSize / 2;
    const current = this.crates;
    this.crates = [];
    for (const crate of current) {
      if (crate.landed && !this._crateBlocked(crate.x, crate.y + half + 1)) crate.landed = false;
      if (!crate.landed) {
        // A parachute sinks at a constant, wind-free pace; a crate whose ground was blown away simply falls.
        crate.vy = crate.parachute ? CONFIG.crateFallSpeed : Math.min(900, crate.vy + CONFIG.gravity * dt);
        const steps = Math.max(1, Math.ceil(crate.vy * dt)),
          delta = dt / steps;
        for (let i = 0; i < steps; i++) {
          const ny = crate.y + crate.vy * delta;
          if (this._crateBlocked(crate.x, ny + half)) {
            crate.landed = true;
            crate.parachute = false;
            crate.vy = 0;
            this._event('crateLand', { x: crate.x, y: crate.y, crateId: crate.id });
            break;
          }
          crate.y = ny;
        }
      }
      if (crate.y + half >= this.waterY) {
        this._event('splash', { x: crate.x, y: this.waterY, weapon: 'crate' });
        continue;
      }
      this.crates.push(crate);
    }
  }

  /** Only the acting worm collects. Health helps a hurt worm and a weapon only
   *  refills below its starting stock; a fully stocked, healthy worm still opens the medkit. */
  _collectCrates(worm) {
    const player = this.players.find((p) => p.id === worm.playerId);
    const map = MAPS.find((map) => map.id === this.mapId);
    for (const crate of this.crates.filter((crate) => distance(worm, crate) <= CONFIG.cratePickupRadius)) {
      this.crates.splice(this.crates.indexOf(crate), 1);
      const useful = CRATE_CONTENTS.filter((entry) =>
        entry.id === 'health'
          ? worm.hp < CONFIG.initialHealth
          : player.ammo[entry.id] < W[entry.id].ammo && (entry.id !== 'airstrike' || map.airstrike),
      );
      const table = useful.length ? useful : CRATE_CONTENTS.filter((entry) => entry.id === 'health');
      let roll = this._random() * table.reduce((sum, entry) => sum + entry.weight, 0);
      const choice = table.find((entry) => (roll -= entry.weight) < 0) || table.at(-1);
      let amount, text;
      if (choice.id === 'health') {
        amount = Math.min(CONFIG.crateHealth, CONFIG.initialHealth - worm.hp);
        worm.hp += amount;
        text = amount > 0 ? `+${amount} salud` : 'Salud al máximo';
      } else {
        amount = 1;
        player.ammo[choice.id] += 1;
        text = `+1 ${W[choice.id].name.toLowerCase()}`;
      }
      this._event('cratePickup', {
        x: crate.x,
        y: crate.y,
        crateId: crate.id,
        wormId: worm.id,
        playerId: player.id,
        kind: choice.id,
        amount,
        text,
      });
    }
  }

  _destroyCrate(crate, weapon) {
    const index = this.crates.indexOf(crate);
    if (index < 0) return;
    this.crates.splice(index, 1);
    // A broken crate only scuffs the ground: a small crater, no damage and no push.
    this.terrain.circle(crate.x, crate.y, CONFIG.crateBlastRadius);
    this._event('crateDestroyed', {
      x: crate.x,
      y: crate.y,
      crateId: crate.id,
      radius: CONFIG.crateBlastRadius,
      weapon,
    });
  }

  step(dt = 1 / CONFIG.tickRate) {
    if (this.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    // A slow server cannot alter integration quality. Catch-up is bounded to avoid spirals.
    this._accumulator += Math.min(dt, 0.25);
    const fixed = 1 / CONFIG.tickRate;
    while (this._accumulator + 1e-9 >= fixed && this.phase === 'playing') {
      this._accumulator -= fixed;
      this._tick(fixed);
    }
  }

  _tick(dt) {
    this.elapsed += dt;
    if (this.elapsed >= CONFIG.suddenDeathSeconds) {
      if (!this._suddenDeath) {
        this._suddenDeath = true;
        this._event('suddenDeath', { text: '¡Muerte súbita! El agua empieza a subir.' });
      }
      this.waterY = Math.max(
        30,
        CONFIG.waterY - (this.elapsed - CONFIG.suddenDeathSeconds) * CONFIG.waterRisePerSecond,
      );
    }
    if (this.elapsed - this._inputAt > CONFIG.inputTimeout) this._input = {};
    const active = this._active();
    for (const worm of this.worms)
      if (worm.hp > 0) this._moveWorm(worm, dt, worm === active && this.turn.stage !== 'settling');
    this._separateWorms();
    this._moveProjectiles(dt);
    this._moveMines(dt);
    this._moveCrates(dt);
    const collector = this._active();
    if (collector) this._collectCrates(collector);
    const deaths = this._pendingDeaths;
    this._pendingDeaths = [];
    for (const death of deaths) {
      death.fuse -= dt;
      if (death.fuse <= 0)
        this._explode(death.x, death.y, CONFIG.deathRadius, CONFIG.deathDamage, 'death', [], death.attack);
      else this._pendingDeaths.push(death);
    }
    if (!this._active()) this._settle();
    if (this.turn.stage !== 'settling') {
      this.turn.remaining = Math.max(0, this.turn.remaining - dt);
      if (this.turn.remaining <= 0) this._settle();
    }
    if (this.turn.stage === 'settling') {
      this._settledFor = this._hasPending() ? 0 : this._settledFor + dt;
      if (this._settledFor >= CONFIG.settleSeconds) this._nextTurn();
    } else if (!this._hasPending()) this._finishIfWon();
  }

  _moveWorm(worm, dt, controlled) {
    // The same integration the client predicts locally; only the side effects stay here.
    const env = (this._wormEnv ||= {
      terrain: this.terrain,
      waterY: this.waterY,
      controlled: true,
      onEvent: (type, fields) => this._event(type, fields),
      onDamage: (target, amount) => this._damage(target, amount),
      onKill: (target, water) => this._kill(target, water),
    });
    env.waterY = this.waterY;
    env.controlled = controlled;
    stepWorm(worm, controlled ? this._input : {}, dt, env);
  }

  _separateWorms() {
    for (let i = 0; i < this.worms.length; i++) {
      const a = this.worms[i];
      if (a.hp <= 0) continue;
      for (let j = i + 1; j < this.worms.length; j++) {
        const b = this.worms[j];
        if (b.hp <= 0) continue;
        const dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy);
        if (d >= R * 1.8) continue;
        const push = (R * 1.8 - d) / 2,
          direction = dx >= 0 ? 1 : -1;
        if (this._clear(a.x - direction * push, a.y)) a.x -= direction * push;
        if (this._clear(b.x + direction * push, b.y)) b.x += direction * push;
      }
    }
  }

  _moveProjectiles(dt) {
    const current = this.projectiles;
    this._movingProjectiles = current;
    this.projectiles = [];
    for (const projectile of current) {
      projectile.age += dt;
      if (Number.isFinite(projectile.fuse)) projectile.fuse -= dt;
      if (projectile.fuse <= 0) {
        this._detonate(projectile);
        continue;
      }
      if (projectile.age > 16) {
        this._detonate(projectile);
        continue;
      }
      projectile.vx += this.wind * (projectile.wind || 0) * dt;
      projectile.vy += CONFIG.gravity * dt;
      let alive = true;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(projectile.vx), Math.abs(projectile.vy)) * dt));
      const delta = dt / steps;
      for (let i = 0; i < steps && alive; i++) {
        const nx = projectile.x + projectile.vx * delta,
          ny = projectile.y + projectile.vy * delta;
        if (ny >= this.waterY || nx < -40 || nx > CONFIG.worldWidth + 40 || ny > CONFIG.worldHeight + 50) {
          this._event('splash', {
            x: clamp(nx, 0, CONFIG.worldWidth),
            y: this.waterY,
            weapon: projectile.kind,
          });
          alive = false;
          break;
        }
        const collision =
          this.terrain.solid(nx, ny) ||
          this.terrain.solid(nx + 3, ny) ||
          this.terrain.solid(nx - 3, ny) ||
          this.terrain.solid(nx, ny + 3);
        const wormHit =
          !projectile.bounce &&
          this.worms.some(
            (worm) =>
              worm.hp > 0 &&
              !(worm.id === projectile.ownerWorm && projectile.age < 0.14) &&
              Math.hypot(worm.x - nx, worm.y - ny) <= R + 3,
          );
        if (collision || wormHit) {
          if (!projectile.bounce) {
            projectile.x = nx;
            projectile.y = ny;
            this._detonate(projectile);
            alive = false;
          } else {
            this._bounce(projectile, nx, ny);
            if (Math.abs(projectile.vx) < 5) projectile.vx = 0;
            if (Math.abs(projectile.vy) < 12) projectile.vy = 0;
          }
          break;
        }
        projectile.x = nx;
        projectile.y = ny;
      }
      if (alive) this.projectiles.push(projectile);
    }
    this._movingProjectiles = null;
  }

  _bounce(object, nx, ny, radius = 3) {
    const bounce = object.bounce ?? 0.3;
    const horizontal = this.terrain.solid(nx + Math.sign(object.vx) * radius, object.y);
    const vertical = this.terrain.solid(object.x, ny + Math.sign(object.vy) * radius);
    if (horizontal) object.vx = -object.vx * bounce;
    if (vertical) {
      object.vy = -object.vy * bounce;
      object.vx *= 0.78;
    }
    if (!horizontal && !vertical) {
      object.vx *= -bounce;
      object.vy *= -bounce;
    }
  }

  _detonate(projectile) {
    const attack = projectile.attack || null;
    if (attack && attack.impactDistance === null && LONG_SHOT_KINDS.has(projectile.kind))
      attack.impactDistance = distance(projectile, attack.origin);
    this._explode(
      projectile.x,
      projectile.y,
      projectile.radius,
      projectile.damage,
      projectile.kind,
      [],
      attack,
    );
    if (projectile.kind === 'cluster') {
      for (let i = 0; i < W.cluster.fragments; i++) {
        const angle = -Math.PI + 0.3 + (i * (Math.PI - 0.6)) / (W.cluster.fragments - 1);
        const speed = 175 + this._random() * 95;
        this.projectiles.push({
          id: `p${++this._id}`,
          kind: 'fragment',
          x: projectile.x + Math.cos(angle) * 5,
          y: projectile.y - 6,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          fuse: W.cluster.fragmentFuse + this._random() * 0.3,
          radius: W.cluster.fragmentRadius,
          damage: W.cluster.fragmentDamage,
          bounce: 0.35,
          wind: 0,
          age: 0,
          attack,
        });
      }
    }
  }

  _moveMines(dt) {
    const current = this.mines;
    this.mines = [];
    for (const mine of current) {
      mine.armIn = Math.max(0, mine.armIn - dt);
      mine.armed = mine.armIn <= 0;
      mine.vy += CONFIG.gravity * dt;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(mine.vx), Math.abs(mine.vy)) * dt));
      const delta = dt / steps;
      let drowned = false,
        collided = false;
      for (let i = 0; i < steps; i++) {
        const nx = mine.x + mine.vx * delta,
          ny = mine.y + mine.vy * delta;
        if (ny >= this.waterY) {
          this._event('splash', { x: nx, y: this.waterY });
          drowned = true;
          break;
        }
        if (this.terrain.solid(nx, ny + 4) || this.terrain.solid(nx + Math.sign(mine.vx) * 4, ny)) {
          this._bounce(mine, nx, ny, 4);
          collided = true;
          break;
        }
        mine.x = clamp(nx, 4, CONFIG.worldWidth - 4);
        mine.y = ny;
      }
      if (drowned) continue;
      if (collided && Math.abs(mine.vx) < 5) mine.vx = 0;
      if (collided && Math.abs(mine.vy) < 12) mine.vy = 0;
      if (
        mine.armed &&
        !Number.isFinite(mine.fuse) &&
        this.worms.some((worm) => worm.hp > 0 && distance(mine, worm) < CONFIG.mineProximity)
      ) {
        mine.fuse = CONFIG.mineFuseSeconds;
        this._event('mineTrigger', { x: mine.x, y: mine.y, weapon: 'mine' });
      }
      if (Number.isFinite(mine.fuse)) {
        mine.fuse -= dt;
        if (mine.fuse <= 0) {
          this._explode(mine.x, mine.y, W.mine.radius, W.mine.damage, 'mine', current, mine.attack);
          continue;
        }
      }
      this.mines.push(mine);
    }
  }

  _explode(x, y, radius, damage, weapon, extraMines = [], attack = null) {
    this.terrain.circle(x, y, radius);
    this._event('explosion', { x, y, radius, weapon });
    for (const worm of this.worms) {
      if (worm.hp <= 0) continue;
      const dx = worm.x - x,
        dy = worm.y - y,
        d = Math.hypot(dx, dy);
      if (d > radius + R) continue;
      const factor = clamp(1 - Math.max(0, d - R) / radius, 0, 1);
      this._damage(worm, Math.max(1, Math.round(damage * factor)), attack);
      const force = 105 + factor * 245;
      worm.vx += (dx / Math.max(d, 1)) * force;
      worm.vy += (dy / Math.max(d, 1)) * force - 105;
      worm.grounded = false;
      this._release(worm);
    }
    for (const mine of new Set([...this.mines, ...extraMines]))
      if (Math.hypot(mine.x - x, mine.y - y) < radius + 5) {
        mine.fuse = Math.min(mine.fuse ?? Infinity, 0.12);
        mine.armed = true;
        mine.armIn = 0;
      }
    for (const crate of [...this.crates])
      if (Math.hypot(crate.x - x, crate.y - y) < radius + CONFIG.crateSize / 2)
        this._destroyCrate(crate, weapon);
    for (const projectile of new Set([...this.projectiles, ...(this._movingProjectiles || [])]))
      if (projectile.kind === 'dynamite' && Math.hypot(projectile.x - x, projectile.y - y) < radius)
        projectile.fuse = Math.min(projectile.fuse, 0.12);
  }

  _damage(worm, amount, attack = null) {
    if (worm.hp <= 0 || amount <= 0) return;
    const damage = Math.min(worm.hp, Math.round(amount));
    worm.hp = Math.max(0, worm.hp - damage);
    this._recordDamage(worm, damage, attack);
    this._event('damage', { x: worm.x, y: worm.y - 20, text: `−${damage}`, amount: damage, wormId: worm.id });
    if (worm.hp <= 0) this._kill(worm, false, attack);
  }

  _kill(worm, water, attack = null) {
    if (worm._dead) return;
    worm.hp = 0;
    worm._dead = true;
    worm.vx = 0;
    worm.vy = 0;
    this._release(worm);
    // Water and fall deaths without a direct cause belong to whoever last hit this worm during the turn.
    const credit = attack || worm._lastAttack || null;
    this._recordKill(worm, credit);
    this._event(water ? 'splash' : 'death', {
      x: worm.x,
      y: water ? this.waterY : worm.y,
      text: water ? `${worm.name} cayó al agua` : `${worm.name} quedó eliminado`,
      wormId: worm.id,
    });
    if (!water) this._pendingDeaths.push({ x: worm.x, y: worm.y, fuse: CONFIG.deathFuse, attack: credit });
  }

  forfeit(playerId) {
    if (this.phase !== 'playing') return;
    const player = this.players.find((player) => player.id === playerId);
    if (!player) return;
    for (const worm of this.worms)
      if (worm.playerId === playerId && worm.hp > 0) {
        worm.hp = 0;
        worm._dead = true;
        worm.vx = 0;
        worm.vy = 0;
        this._release(worm);
      }
    this._event('forfeit', { text: `${player.name} abandonó la partida.` });
    if (this.turn.playerId === playerId) this._settle();
    // The normal fixed tick waits for airborne survivors and every pending blast.
  }

  snapshot(includeTerrain = true) {
    return {
      phase: this.phase,
      mapId: this.mapId,
      mode: this.mode,
      turnSeconds: this.turnSeconds,
      elapsed: this.elapsed,
      waterY: this.waterY,
      wind: this.wind,
      terrainRevision: this.terrain.revision,
      girders: this.girders.map((girder) => ({ ...girder })),
      ...(includeTerrain ? { terrain: this.terrain.encode() } : {}),
      worms: this.worms.map(({ _dead, _lastAttack, ...worm }) => ({
        ...worm,
        rope: worm.rope ? { ...worm.rope } : null,
      })),
      players: this.players.map((player) => ({ ...player, ammo: { ...player.ammo } })),
      projectiles: this.projectiles.map(({ id, kind, x, y, vx, vy, fuse }) => ({
        id,
        kind,
        x,
        y,
        vx,
        vy,
        ...(Number.isFinite(fuse) ? { fuse } : {}),
      })),
      mines: this.mines.map(({ id, x, y, armed, fuse }) => ({
        id,
        x,
        y,
        armed,
        ...(Number.isFinite(fuse) ? { fuse } : {}),
      })),
      crates: this.crates.map(({ id, x, y, parachute, landed }) => ({ id, x, y, parachute, landed })),
      turn: this.turn ? { ...this.turn } : null,
      events: this.events.map((event) => ({
        ...event,
        ...(event.hits ? { hits: event.hits.map((hit) => ({ ...hit })) } : {}),
      })),
      result: this.result
        ? { ...this.result, winnerIds: [...this.result.winnerIds], stats: this._statsSnapshot() }
        : null,
      // Match statistics travel only with the final state: live snapshots stay as small as before.
      ...(this.phase === 'finished' ? { stats: this._statsSnapshot() } : {}),
    };
  }
}
