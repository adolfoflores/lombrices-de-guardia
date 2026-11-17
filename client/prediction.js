// Local prediction of the own active worm between authoritative snapshots.
// The server stays the only authority: the client integrates its walking and
// jumps with the shared engine step, then reconciles with every snapshot.
import { CONFIG } from '../shared/config.js';
import { stepWorm, applyJump } from '../shared/physics.js';

export const SNAP_DISTANCE = 24; // larger corrections pop to the authoritative position
export const BLEND_MS = 120; // smaller corrections ease out over this time
const STEP_MS = 1000 / CONFIG.tickRate;
const STEP_S = 1 / CONFIG.tickRate;
const HISTORY_MS = 1500; // predicted states kept for latency-aware reconciliation
const CATCH_UP_MS = 250; // a stalled tab never spirals; like the engine's bounded catch-up

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const lerp = (a, b, t) => a + (b - a) * t;

/** Only the local player's active worm, on its own turn, walking or jumping, is predicted. */
export function canPredict(state, playerId) {
  if (
    !state ||
    state.phase !== 'playing' ||
    !state.turn ||
    !playerId ||
    state.turn.playerId !== playerId ||
    state.turn.stage === 'settling'
  )
    return false;
  const worm = state.worms?.find((w) => w.id === state.turn.wormId);
  return !!worm && worm.hp > 0 && !worm.rope && !worm.jetpack;
}

/** The client's decoded collision mask, read exactly like the server's Terrain.solid. */
export function maskTerrain(data, width = CONFIG.worldWidth, height = CONFIG.worldHeight) {
  return {
    solid(x, y) {
      const ix = Math.floor(x),
        iy = Math.floor(y);
      return ix >= 0 && iy >= 0 && ix < width && iy < height && data[iy * width + ix] === 1;
    },
  };
}

export class LocalPrediction {
  constructor() {
    this.terrain = null;
    this.waterY = CONFIG.waterY;
    this.input = { move: 0 };
    this.env = {
      terrain: null,
      waterY: CONFIG.waterY,
      controlled: true,
      // Fall damage and drowning are the server's call; the copy only stops moving.
      onKill: (worm) => {
        worm.hp = 0;
        worm.vx = 0;
        worm.vy = 0;
      },
    };
    this.reset();
  }
  reset() {
    this.worm = null;
    this.wormId = null;
    this.time = 0;
    this.states = [];
    this.previous = null;
    this.offset = null;
    this.pendingJump = null;
  }
  get active() {
    return !!this.worm;
  }
  setTerrain(terrain, waterY) {
    this.terrain = terrain || null;
    if (Number.isFinite(waterY)) this.waterY = waterY;
  }
  setInput(input) {
    const move = clamp(Number(input?.move) || 0, -1, 1);
    if (move !== this.input.move) this.input = { move };
  }
  /** A jump request is applied at the next fixed step if the predicted worm has ground, like the server. */
  jump(back, facing) {
    if (!this.worm) return;
    this.pendingJump = { back: !!back, facing: facing === -1 ? -1 : 1 };
  }
  /**
   * Begin predicting from an authoritative worm received at `now`. The copy is
   * run one round trip ahead of the snapshot stream, so a command applied here
   * at once lands on the server at the same simulated moment.
   */
  start(worm, now, latency = 0) {
    this.worm = {
      id: worm.id,
      x: worm.x,
      y: worm.y,
      vx: worm.vx || 0,
      vy: worm.vy || 0,
      grounded: !!worm.grounded,
      hp: worm.hp,
      facing: worm.facing === -1 ? -1 : 1,
      rope: null,
      jetpack: false,
      fuel: 0,
      thrustX: 0,
      thrustY: 0,
    };
    this.wormId = worm.id;
    this.time = now - clamp(latency || 0, 0, CATCH_UP_MS);
    this.previous = null;
    this.offset = null;
    this.pendingJump = null;
    this.states = [this.record(null)];
    this.advance(now);
  }
  /** A remembered state: the step's input and jump travel with it so a replay repeats them exactly. */
  record(jump, move = this.input.move) {
    const w = this.worm;
    return {
      t: this.time,
      x: w.x,
      y: w.y,
      vx: w.vx,
      vy: w.vy,
      grounded: w.grounded,
      hp: w.hp,
      facing: w.facing,
      move,
      jump,
    };
  }
  step(move, jump) {
    const worm = this.worm;
    if (jump && worm.grounded) {
      worm.facing = jump.facing;
      applyJump(worm, jump.back);
    }
    this.previous = { x: worm.x, y: worm.y };
    this.env.terrain = this.terrain;
    this.env.waterY = this.waterY;
    if (worm.hp > 0) stepWorm(worm, { move }, STEP_S, this.env);
    this.time += STEP_MS;
  }
  /** Integrate fixed steps up to `now`, remembering each state for reconciliation. */
  advance(now) {
    if (!this.worm || !this.terrain) return;
    if (now - this.time > CATCH_UP_MS) this.time = now - CATCH_UP_MS;
    while (now - this.time >= STEP_MS - 1e-6) {
      const jump = this.pendingJump;
      this.pendingJump = null;
      this.step(this.input.move, jump);
      this.states.push(this.record(jump));
    }
    while (this.states.length > 2 && this.states[1].t < now - HISTORY_MS) this.states.shift();
  }
  /** The remembered state nearest to `time`: what a snapshot received one round trip later reflects. */
  stateAt(time) {
    let index = this.states.length - 1;
    while (index > 0 && this.states[index].t > time) index--;
    if (index < this.states.length - 1 && this.states[index + 1].t - time < time - this.states[index].t)
      index++;
    return { index, state: this.states[index] };
  }
  /**
   * Reconcile with an authoritative worm received at `now`. Inputs sent after
   * the state the server reflects are replayed on top of it; a small visual
   * difference eases out over BLEND_MS, a large one snaps.
   */
  reconcile(worm, now, latency = 0) {
    if (!this.worm || this.worm.id !== worm.id) {
      this.start(worm, now, latency);
      return 'start';
    }
    const before = this.position(now);
    const { index, state } = this.stateAt(now - Math.max(0, latency || 0));
    const error = Math.hypot(worm.x - state.x, worm.y - state.y);
    const replay = this.states.slice(index + 1);
    Object.assign(this.worm, {
      x: worm.x,
      y: worm.y,
      vx: worm.vx || 0,
      vy: worm.vy || 0,
      grounded: !!worm.grounded,
      hp: worm.hp,
      facing: worm.facing === -1 ? -1 : 1,
    });
    this.time = state.t;
    this.previous = null;
    this.states.length = index;
    this.states.push(this.record(state.jump, state.move));
    for (const past of replay) {
      this.step(past.move, past.jump);
      this.states.push(this.record(past.jump, past.move));
    }
    this.offset = null;
    if (error > SNAP_DISTANCE) return 'snap';
    const after = this.position(now);
    const dx = before.x - after.x,
      dy = before.y - after.y;
    if (Math.hypot(dx, dy) > 0.25) this.offset = { x: dx, y: dy, at: now };
    return 'blend';
  }
  /** Where the predicted worm is drawn at `now`: the latest step, eased, plus any fading correction. */
  position(now) {
    if (!this.worm) return null;
    const alpha = clamp((now - this.time) / STEP_MS, 0, 1);
    let x = this.previous ? lerp(this.previous.x, this.worm.x, alpha) : this.worm.x;
    let y = this.previous ? lerp(this.previous.y, this.worm.y, alpha) : this.worm.y;
    if (this.offset) {
      const remaining = 1 - (now - this.offset.at) / BLEND_MS;
      if (remaining <= 0) this.offset = null;
      else {
        x += this.offset.x * remaining;
        y += this.offset.y * remaining;
      }
    }
    return { x, y };
  }
  /** Motion fields for the pose of the predicted worm (walk cycle, airborne lean, landing). */
  motion() {
    if (!this.worm) return null;
    return { vx: this.worm.vx, vy: this.worm.vy, grounded: this.worm.grounded };
  }
}
