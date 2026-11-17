import { Container, Graphics, GraphicsContext } from 'pixi.js';
import {
  EXPLOSIVE_KINDS,
  PARTICLE_GEOMETRY_SCALE,
  scaledPoints,
  clamp,
  mixColor,
} from './effects/primitives.js';
export { PIXI_PROJECTILE_KINDS } from './effects/primitives.js';
import { fire, launchRocket, shotgun, bat, explode, plume } from './effects/attacks.js';
import {
  mineTrigger,
  crateLand,
  crateBreak,
  cratePickup,
  teleport,
  girder,
  rope,
  breakRope,
  ignite,
  airstrikeCall,
} from './effects/tools.js';
import { makeProjectile, updateProjectiles, rocketTrail } from './effects/projectiles.js';
import { updateMines, updateCrates, updateWorms } from './effects/entities.js';

// Pixi tessellates curves at their authored size. Unit-radius circles become
// visibly polygonal when enlarged into a blast, so author reusable geometry
// at a useful resolution and normalize its display scale instead.

// Deterministic jitter keeps smoke organic without Math.random in the frame loop.

/** Original vector art. All gameplay positions and impacts come from the server. */
export class CombatEffects extends Container {
  constructor() {
    super();
    this.label = 'combat-effects';
    this.eventMode = 'none';
    this.trails = new Container();
    this.projectileLayer = new Container();
    this.bursts = new Container();
    this.addChild(this.trails, this.projectileLayer, this.bursts);
    this.projectiles = new Map();
    this.mines = new Map();
    this.crates = new Map();
    this.wormTools = new Map();
    this.particles = [];
    this.pool = [];
    this.serial = 0;
    // Geometry is shared by all particles and never rebuilt inside the frame loop.
    this.shapes = {
      cloud: new GraphicsContext()
        .circle(-13.44, 4.48, 20.8)
        .circle(3.2, -8.96, 25.28)
        .circle(18.24, 5.76, 19.52)
        .fill(0xffffff),
      disc: new GraphicsContext().circle(0, 0, PARTICLE_GEOMETRY_SCALE).fill(0xffffff),
      ring: new GraphicsContext()
        .circle(0, 0, PARTICLE_GEOMETRY_SCALE)
        .stroke({ color: 0xffffff, width: 0.04 * PARTICLE_GEOMETRY_SCALE }),
      shard: new GraphicsContext()
        .poly(scaledPoints([-0.9, -0.4, 0.2, -1, 0.95, 0.15, 0.15, 0.8, -0.65, 0.6]))
        .fill(0xffffff),
      spark: new GraphicsContext().poly(scaledPoints([-1, 0, 0.18, -0.35, 1, 0, 0.18, 0.35])).fill(0xffffff),
      flash: new GraphicsContext()
        .poly(
          scaledPoints([
            -1, 0, -0.28, -0.25, -0.45, -0.75, 0.1, -0.38, 0.3, -1, 0.5, -0.28, 1, 0, 0.5, 0.28, 0.3, 1, 0.1,
            0.38, -0.45, 0.75, -0.28, 0.25,
          ]),
        )
        .fill(0xffffff),
      beam: new GraphicsContext().rect(0, -16, 32, 32).fill(0xffffff),
      arc: new GraphicsContext()
        .arc(0, 0, 32, -1.15, 1.15)
        .stroke({ color: 0xffffff, width: 3.8, cap: 'round' }),
      cross: new GraphicsContext().rect(-4, -25, 8, 50).rect(-25, -4, 50, 8).fill(0xffffff),
      shell: new GraphicsContext()
        .roundRect(-22, -10, 44, 20, 3)
        .fill(0xc8744b)
        .rect(12, -11, 11, 22)
        .fill(0xf4cf7c)
        .rect(-17, -7, 25, 3)
        .fill(0xefaf82),
      nut: new GraphicsContext()
        .poly(scaledPoints([-0.65, -1, 0.65, -1, 1, 0, 0.65, 1, -0.65, 1, -1, 0]))
        .fill(0xffffff)
        .circle(0, 0, 11)
        .cut(),
    };
  }

  /** Returns true only for the events this layer owns, so legacy effects stay intact. */
  addEvent(event, now, options = {}) {
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return false;
    if (event.type === 'explosion' || event.type === 'explode') {
      if (!EXPLOSIVE_KINDS.has(event.weapon)) return false;
      this.explode(event, now, options);
      return true;
    }
    if (event.type === 'fire') {
      if (
        ![
          'bazooka',
          'rocket',
          'grenade',
          'cluster',
          'dynamite',
          'mine',
          'shotgun',
          'bat',
          'airstrike',
          'rope',
          'jetpack',
          'teleport',
          'girder',
        ].includes(event.weapon)
      )
        return false;
      this.fire(event, now, options);
      return true;
    }
    if (event.type === 'shot') {
      this.shotgun(event, now, options);
      return true;
    }
    if (event.type === 'bat') {
      this.bat(event, now, options);
      return true;
    }
    if (event.type === 'mineTrigger') {
      this.mineTrigger(event, now, options);
      return true;
    }
    if (event.type === 'teleport') {
      this.teleport(event, now, options);
      return true;
    }
    if (event.type === 'girder') {
      this.girder(event, now, options);
      return true;
    }
    if (event.type === 'rope') {
      this.rope(event, now, options);
      return true;
    }
    if (event.type === 'jetpack') {
      this.ignite(event, now, options);
      return true;
    }
    if (event.type === 'ropeBreak') {
      this.breakRope(event, now, options);
      return true;
    }
    if (event.type === 'crateLand') {
      this.crateLand(event, now, options);
      return true;
    }
    if (event.type === 'crateDestroyed') {
      this.crateBreak(event, now, options);
      return true;
    }
    if (event.type === 'cratePickup') {
      this.cratePickup(event, now, options);
      return true;
    }
    // The HUD retains the meaningful fuel message; this handles only the visual cue.
    if (event.type === 'fuelEmpty') {
      this.ignite({ ...event, empty: true }, now, options);
      return false;
    }
    return false;
  }

  spawn(shape, now, options, data, foreground = false) {
    const limit = options.reducedMotion ? 36 : options.quality === 'low' ? 100 : 240;
    while (this.particles.length >= limit) this.recycle(this.particles.shift());
    const node = this.pool.pop() || new Graphics(this.shapes[shape]);
    node.context = this.shapes[shape];
    node.tint = data.color ?? 0xffffff;
    node.blendMode = data.blend || 'normal';
    node.visible = true;
    node.alpha = data.alpha ?? 1;
    node.rotation = data.rotation ?? 0;
    node.position.set(data.x, data.y);
    const size = (data.size || 1) / PARTICLE_GEOMETRY_SCALE;
    node.scale.set(size * (data.aspectX ?? 1), size * (data.aspectY ?? 1));
    (foreground ? this.bursts : this.trails).addChild(node);
    this.particles.push({
      node,
      start: now,
      life: 600,
      vx: 0,
      vy: 0,
      gravity: 0,
      drag: 0,
      driftX: 0,
      driftY: 0,
      color: 0xffffff,
      endColor: null,
      size: 1,
      endSize: 1,
      aspectX: 1,
      aspectY: 1,
      alpha: 1,
      spin: 0,
      mode: 'fade',
      ...data,
    });
    return node;
  }

  recycle(particle) {
    if (!particle) return;
    particle.node.removeFromParent();
    particle.node.visible = false;
    if (this.pool.length < 160) this.pool.push(particle.node);
    else particle.node.destroy();
  }

  fire(...args) {
    return fire(this, ...args);
  }

  /** Bazooka launch: muzzle flash, a forward pressure ring and sparks, a cone
   *  of backblast from the breech, dust at the feet and smoke left hanging in
   *  the wind. Every position derives from the authoritative fire event. */
  launchRocket(...args) {
    return launchRocket(this, ...args);
  }

  shotgun(...args) {
    return shotgun(this, ...args);
  }

  bat(...args) {
    return bat(this, ...args);
  }

  mineTrigger(...args) {
    return mineTrigger(this, ...args);
  }

  /** A landing crate puffs a little dust; the folded canopy is handled by updateCrates. */
  crateLand(...args) {
    return crateLand(this, ...args);
  }

  /** A blast breaks the crate into wood chips: a flash, a ring and a brief puff, never a crater of its own. */
  crateBreak(...args) {
    return crateBreak(this, ...args);
  }

  /** Collecting a crate sparkles upward in green for health and gold for ammunition. */
  cratePickup(...args) {
    return cratePickup(this, ...args);
  }

  teleport(...args) {
    return teleport(this, ...args);
  }

  girder(...args) {
    return girder(this, ...args);
  }

  rope(...args) {
    return rope(this, ...args);
  }

  breakRope(...args) {
    return breakRope(this, ...args);
  }

  ignite(...args) {
    return ignite(this, ...args);
  }

  airstrikeCall(...args) {
    return airstrikeCall(this, ...args);
  }

  explode(...args) {
    return explode(this, ...args);
  }

  /** A rocket hit rolls its fireball upward into a dark column and skirts
   *  dust along the ground; everything drifts with the match wind. */
  plume(...args) {
    return plume(this, ...args);
  }

  makeProjectile(...args) {
    return makeProjectile(this, ...args);
  }

  updateProjectiles(...args) {
    return updateProjectiles(this, ...args);
  }

  /** Smoke is laid down by distance travelled rather than by frame, so fast and
   *  slow shots both leave a continuous ribbon that cools, expands and drifts
   *  with the wind. Hot glow and embers mark the nozzle itself. */
  rocketTrail(...args) {
    return rocketTrail(this, ...args);
  }

  updateMines(...args) {
    return updateMines(this, ...args);
  }

  updateCrates(...args) {
    return updateCrates(this, ...args);
  }

  updateWorms(...args) {
    return updateWorms(this, ...args);
  }

  update(now, _dt, options = {}) {
    const limit = options.reducedMotion ? 36 : options.quality === 'low' ? 100 : 240;
    while (this.particles.length > limit) this.recycle(this.particles.shift());
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.node.visible = now >= particle.start;
      if (!particle.node.visible) continue;
      const t = clamp((now - particle.start) / particle.life, 0, 1);
      if (t >= 1) {
        this.recycle(particle);
        this.particles.splice(i, 1);
        continue;
      }
      const seconds = Math.max(0, now - particle.start) / 1000;
      const eased = 1 - (1 - t) ** 2;
      // Drag damps the launch velocity (exhaust, blast) while drift (wind, heat
      // rising) keeps acting; gravity still pulls debris and embers down.
      const travel = particle.drag > 0 ? (1 - Math.exp(-particle.drag * seconds)) / particle.drag : seconds;
      particle.node.position.set(
        particle.x + particle.vx * travel + particle.driftX * seconds,
        particle.y +
          particle.vy * travel +
          particle.driftY * seconds +
          (particle.gravity * seconds * seconds) / 2,
      );
      const size = (particle.size + (particle.endSize - particle.size) * eased) / PARTICLE_GEOMETRY_SCALE;
      particle.node.scale.set(size * particle.aspectX, size * particle.aspectY);
      particle.node.rotation = (particle.rotation || 0) + particle.spin * seconds;
      if (particle.endColor != null) particle.node.tint = mixColor(particle.color, particle.endColor, eased);
      particle.node.alpha =
        particle.alpha *
        (particle.mode === 'flash'
          ? (1 - t) ** 0.65
          : particle.mode === 'smoke'
            ? Math.min(1, t * 8) * (1 - t) ** 0.9
            : (1 - t) ** 1.3);
    }
  }

  clear() {
    for (const visual of this.projectiles.values()) visual.node.destroy({ children: true });
    this.projectiles.clear();
    for (const visual of this.mines.values()) visual.node.destroy({ children: true });
    for (const visual of this.crates.values()) visual.node.destroy({ children: true });
    for (const visual of this.wormTools.values()) visual.node.destroy({ children: true });
    this.mines.clear();
    this.crates.clear();
    this.wormTools.clear();
    for (const particle of this.particles) this.recycle(particle);
    this.particles.length = 0;
  }

  destroy(options) {
    if (this.destroyed) return;
    this.clear();
    for (const node of this.pool) node.destroy();
    this.pool.length = 0;
    for (const shape of Object.values(this.shapes)) shape.destroy();
    super.destroy({ ...options, children: true });
  }
}
