import { Application, Container, Graphics, Text } from 'pixi.js';
import { WormActor } from './pixi-character.js';
import { CombatEffects, PIXI_PROJECTILE_KINDS } from './pixi-effects.js';

const MARKS = ['▲', '◆', '●', '■', '✦', '✚'];
const TEAM_COLORS = ['#f38b63', '#66cacc', '#b4cf77'];
const INK = 0x182c39,
  PAPER = 0xfff4d8;
const FLAG_W = 10; // one-pixel pole, eight-pixel pennant and a gap before the mark
const BUBBLE_MS = 1300;
const PHRASES = {
  turn: ['Me toca', 'Atentos'],
  hurt: ['¡Ay!', '¡Eso dolió!', '¡Mi banda!'],
  hit: ['¡Toma!', '¡Pum!'],
  miss: ['Ups…', 'Casi'],
  kill: ['¡Hasta luego!'],
  drown: ['¡Glub!'],
};
const MISS_WEAPONS = ['bazooka', 'grenade', 'cluster', 'fragment', 'dynamite', 'airstrike'];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
/** Pennants and bubble borders use the alliance colour; a free-for-all keeps each player's own. */
const badgeColor = (state, worm) =>
  state.mode === 'ffa' ? worm.color || PAPER : TEAM_COLORS[Math.max(0, worm.team || 0) % TEAM_COLORS.length];
/** The active plate names the worm first and its player underneath when they differ. */
const plateNames = (worm, player) => {
  const name = String(worm.name || player?.name || '').slice(0, 14);
  const owner = String(worm.playerName || player?.name || '').slice(0, 14);
  return { name, owner: owner && owner !== name ? owner : '' };
};
const drawFlag = (graphics, color) =>
  graphics.clear().rect(0, 0, 1, 9).fill({ color: PAPER, alpha: 0.85 }).poly([1, 0, 9, 3, 1, 6]).fill(color);

/** GPU presentation only. The existing terrain mask and server own every collision. */
export class CombatLayer {
  constructor(canvas) {
    this.field = canvas;
    this.app = new Application();
    this.world = new Container();
    this.ropes = new Graphics();
    this.characters = new Container();
    this.hud = new Container();
    this.effects = new CombatEffects();
    this.actors = new Map();
    this.labels = new Map();
    this.floating = [];
    this.bubbles = new Map();
    this.destroyed = false;
    this.active = false;
    this.world.addChild(this.ropes, this.characters, this.effects);
    this.app.stage.addChild(this.world, this.hud);
  }
  async init(width, height, resolution) {
    await this.app.init({
      width,
      height,
      resolution,
      autoDensity: true,
      antialias: true,
      preference: 'webgl',
      backgroundAlpha: 0,
      autoStart: false,
      sharedTicker: false,
    });
    if (this.destroyed) {
      this.app.destroy(true, { children: true });
      return false;
    }
    this.app.stage.eventMode = 'none';
    const overlay = this.app.canvas;
    overlay.className = 'pixi-field';
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, { position: 'absolute', pointerEvents: 'none', zIndex: '0' });
    this.field.insertAdjacentElement('afterend', overlay);
    this.active = true;
    this.resize(width, height, resolution);
    // Canvas remains playable during a lost GPU context; Pixi restores its resources.
    this.onLost = () => {
      this.active = false;
      overlay.style.visibility = 'hidden';
    };
    this.onRestored = () => {
      if (!this.destroyed) {
        this.active = true;
        overlay.style.visibility = '';
      }
    };
    overlay.addEventListener('webglcontextlost', this.onLost);
    overlay.addEventListener('webglcontextrestored', this.onRestored);
    return true;
  }
  resize(width, height, resolution) {
    if (!this.app.renderer || this.destroyed) return;
    this.app.renderer.resize(width, height, resolution);
    Object.assign(this.app.canvas.style, {
      left: `${this.field.offsetLeft}px`,
      top: `${this.field.offsetTop}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  }
  sync(state) {
    const ids = new Set(state.worms.map((w) => w.id));
    for (const [id, actor] of this.actors)
      if (!ids.has(id)) {
        actor.destroy({ children: true });
        this.actors.delete(id);
      }
    for (const worm of state.worms)
      if (!this.actors.has(worm.id)) {
        const actor = new WormActor(worm);
        this.actors.set(worm.id, actor);
        this.characters.addChild(actor);
      }
  }
  handlesProjectile(kind) {
    return PIXI_PROJECTILE_KINDS.includes(kind);
  }
  addEvent(event, now, state, view, effectNow = now) {
    if (!state || !this.active) return false;
    this.sync(state);
    if (event.wormId) this.actors.get(event.wormId)?.handleEvent(event, now);
    this.speak(event, now, state, view);
    if (
      ['damage', 'death', 'drown', 'splash', 'cratePickup'].includes(event.type) &&
      Number.isFinite(event.x) &&
      Number.isFinite(event.y)
    ) {
      this.floatText(event, now, view);
      // A collected crate also sparkles in the world layer below its floating text.
      if (event.type !== 'cratePickup') return true;
    }
    const worm = event.wormId ? state.worms.find((w) => w.id === event.wormId) || null : null;
    return this.effects.addEvent(event, effectNow, {
      ...view,
      mapId: state.mapId,
      wind: state.wind || 0,
      worm,
    });
  }
  clear() {
    this.effects.clear();
    for (const actor of this.actors.values()) actor.destroy({ children: true });
    for (const label of this.labels.values()) label.destroy({ children: true });
    for (const item of this.floating) item.node.destroy();
    for (const bubble of this.bubbles.values()) bubble.node.destroy({ children: true });
    this.actors.clear();
    this.labels.clear();
    this.floating = [];
    this.bubbles.clear();
  }
  /** Floating damage and water texts live in the screen-space HUD, above smoke,
   *  debris and characters, so a heavy plume never hides the number that matters. */
  floatText(event, now, view) {
    const label = new Text({
      text: event.text || (event.type === 'damage' ? '¡Ay!' : '¡Al agua!'),
      style: {
        fontFamily: 'system-ui',
        fontWeight: '800',
        fontSize: 17,
        fill: event.type === 'cratePickup' ? 0xd4f5b0 : 0xffe7b3,
        align: 'center',
        stroke: { color: 0x233441, width: 4, join: 'round' },
      },
      resolution: 2,
    });
    label.anchor.set(0.5, 1);
    this.hud.addChild(label);
    this.floating.push({
      node: label,
      x: event.x,
      y: event.y,
      start: now,
      life: 1200,
      rise: view?.reducedMotion ? 5 : 35,
    });
  }
  drawFloating(owner, now) {
    for (let i = this.floating.length - 1; i >= 0; i--) {
      const item = this.floating[i];
      const t = Math.max(0, (now - item.start) / item.life);
      if (t >= 1) {
        item.node.destroy();
        this.floating.splice(i, 1);
        continue;
      }
      const p = owner.screenPoint({ x: item.x, y: item.y - 24 - t * item.rise });
      item.node.position.set(p.x, p.y);
      item.node.scale.set(owner.camera.zoom);
      item.node.alpha = 1 - t;
    }
  }
  /** Short remarks above the characters. Every client derives the same line from
   *  the authoritative event id, so the whole room reads one shared reaction. */
  speak(event, now, state, view) {
    const turn = state.turn;
    const actor = turn ? state.worms.find((w) => w.id === turn.wormId) : null;
    const subject = event.wormId ? state.worms.find((w) => w.id === event.wormId) : null;
    const enemy = !!subject && !!actor && subject.playerId !== actor.playerId;
    const localTurn = state.phase === 'playing' && view?.playerId === turn?.playerId;
    const say = (worm, kind) => {
      // The local shooter's own bubble would sit over the raised weapon while aiming.
      if (!worm || (localTurn && worm.id === turn?.wormId)) return;
      const lines = PHRASES[kind];
      this.showBubble(worm, kind, lines[event.id % lines.length], badgeColor(state, worm), now, view);
    };
    if (event.type === 'turn') say(actor, 'turn');
    else if (event.type === 'damage') {
      say(subject, 'hurt');
      if (enemy) say(actor, 'hit');
    } else if (event.type === 'death') {
      if (enemy) say(actor, 'kill');
    } else if (event.type === 'splash') {
      if (subject) say(subject, 'drown');
    } else if (event.type === 'explosion') {
      // Damage events follow their blast in the same tick, so a blast without one is a miss.
      const hurt = (state.events || []).some((e) => e.id === event.id + 1 && e.type === 'damage');
      if (!hurt && MISS_WEAPONS.includes(event.weapon) && turn?.stage !== 'action') say(actor, 'miss');
    } else if (event.type === 'shot') {
      if (event.hit !== 'worm') say(subject, 'miss');
    } else if (event.type === 'bat') {
      if (!event.hits?.length) say(subject, 'miss');
    }
  }
  /** One bubble per worm: a different remark replaces it, the same kind only repeats after it fades. */
  showBubble(worm, kind, text, color, now, view) {
    const current = this.bubbles.get(worm.id);
    if (current) {
      if (current.kind === kind) return;
      current.node.destroy({ children: true });
      this.bubbles.delete(worm.id);
    }
    const node = new Container();
    const label = new Text({
      text,
      style: { fontFamily: 'system-ui', fontWeight: '800', fontSize: 12, fill: PAPER, align: 'center' },
      resolution: 2,
    });
    label.anchor.set(0.5, 0.5);
    const w = Math.ceil(label.width) + 16,
      h = Math.ceil(label.height) + 8,
      r = 7;
    // One outline for the plate and a tail at its lower inner corner, so the
    // border never crosses the tail. The bubble floats beside the rising damage
    // number rather than under it; drawBubbles mirrors it for the other side.
    const plate = new Graphics()
      .moveTo(r, 0)
      .lineTo(w - r, 0)
      .arcTo(w, 0, w, r, r)
      .lineTo(w, h - r)
      .arcTo(w, h, w - r, h, r)
      .lineTo(r + 10, h)
      .lineTo(-6, h + 7)
      .lineTo(r + 1, h)
      .arcTo(0, h, 0, h - r, r)
      .lineTo(0, r)
      .arcTo(0, 0, r, 0, r)
      .closePath()
      .fill({ color: INK, alpha: 0.94 })
      .stroke({ width: 1.3, color, join: 'round' });
    label.position.set(w / 2, h / 2);
    node.addChild(plate, label);
    node.visible = false;
    this.hud.addChild(node);
    this.bubbles.set(worm.id, {
      node,
      plate,
      kind,
      side: 0,
      start: now,
      life: BUBBLE_MS,
      width: w,
      height: h + 7,
      reduced: !!view?.reducedMotion,
    });
  }
  drawBubbles(owner, now) {
    const { state, camera, width } = owner;
    const localTurn = state.phase === 'playing' && owner.view?.playerId === state.turn?.playerId;
    for (const [id, bubble] of this.bubbles) {
      const worm = state.worms.find((w) => w.id === id);
      const t = (now - bubble.start) / bubble.life;
      if (!worm || t >= 1 || (localTurn && id === state.turn?.wormId)) {
        bubble.node.destroy({ children: true });
        this.bubbles.delete(id);
        continue;
      }
      const p = owner.screenPoint(owner.position(worm, now));
      const label = this.labels.get(id);
      const plateH = label?.visible ? label.boxH : 20;
      // Above the plate on the side the worm faces, flipped when that side runs out of screen.
      const overflow = (side) =>
        side > 0 ? p.x + 24 + bubble.width > width - 4 : p.x - 24 - bubble.width < 4;
      let side = worm.facing === -1 ? -1 : 1;
      if (overflow(side) && !overflow(-side)) side = -side;
      if (side !== bubble.side) {
        bubble.side = side;
        bubble.plate.scale.x = side;
        bubble.plate.x = side > 0 ? 0 : bubble.width;
        bubble.node.pivot.set(side > 0 ? -6 : bubble.width + 6, bubble.height);
      }
      // A quick pop with a slight overshoot and a short lift; reduced motion shows it at rest.
      const k = bubble.reduced ? 1 : Math.min(1, Math.max(0, t) / 0.12);
      const pop = 1 - (1 - k) * (1 - k) * 0.4 + Math.sin(k * Math.PI) * 0.07;
      const lift = bubble.reduced ? 0 : 3 * Math.min(1, Math.max(0, t) * 2);
      const y = p.y - 30 * camera.zoom - plateH - 9 - lift;
      bubble.node.position.set(clamp(p.x + side * 18, 4, width - 4), Math.max(bubble.height + 4, y));
      bubble.node.scale.set(pop);
      bubble.node.alpha = t > 0.78 ? Math.max(0, 1 - (t - 0.78) / 0.22) : 1;
      bubble.node.visible = true;
    }
  }
  draw(owner, now, dt, shakeX, shakeY) {
    if (!this.active || this.destroyed) return;
    const { state, camera } = owner;
    // Characters, labels and snapshot interpolation keep real time; only the
    // effects clock slows during a killing blow, so the world never desyncs.
    const view = owner.effectiveView ? owner.effectiveView() : owner.view;
    const effectNow = owner.effectTime ? owner.effectTime(now) : now;
    this.sync(state);
    this.world.scale.set(camera.zoom);
    this.world.position.set(
      owner.width / 2 + shakeX - camera.x * camera.zoom,
      owner.height / 2 + shakeY - camera.y * camera.zoom,
    );
    this.ropes.clear();
    for (const worm of state.worms) {
      const active = worm.id === state.turn?.wormId;
      const local = active && view.playerId === state.turn?.playerId;
      const actor = this.actors.get(worm.id);
      // The own predicted worm poses from its predicted motion; everyone else from the snapshot.
      actor.update(owner.displayWorm ? owner.displayWorm(worm) : worm, {
        now,
        dt,
        position: owner.position(worm, now),
        active,
        local,
        facing: local ? (view.facing ?? worm.facing) : worm.facing,
        angle: local ? view.angle : (worm.aim ?? (worm.facing < 0 ? (-Math.PI * 3) / 4 : -Math.PI / 4)),
        weapon: active ? (local ? view.weapon : worm.heldWeapon || 'bazooka') : null,
        power: local && view.charging ? view.power : 0,
        reducedMotion: view.reducedMotion,
        quality: view.quality,
      });
      if (worm.hp > 0 && worm.rope) {
        const p = actor.ropeSocket;
        const length = Math.hypot(worm.rope.x - actor.x, worm.rope.y - actor.y);
        const slack = Math.max(0, (worm.rope.length ?? length) - length);
        const sag = Math.min(28, slack * 0.35 + (1 - actor.ropeTension) * Math.min(12, length * 0.06));
        const cx = (p.x + worm.rope.x) / 2,
          cy = (p.y + worm.rope.y) / 2 + sag;
        this.ropes
          .moveTo(p.x, p.y)
          .quadraticCurveTo(cx, cy, worm.rope.x, worm.rope.y)
          .stroke({ color: INK, width: 3 });
        this.ropes
          .moveTo(p.x, p.y)
          .quadraticCurveTo(cx, cy, worm.rope.x, worm.rope.y)
          .stroke({ color: 0xf6df9d, width: 1.5 });
        this.ropes.circle(worm.rope.x, worm.rope.y, 3).fill(0xf6df9d);
      }
    }
    const options = { ...view, mapId: state.mapId, wind: state.wind || 0 };
    const at = (entity) => owner.position(entity, now);
    this.effects.updateMines(state.mines || [], effectNow, at, options);
    this.effects.updateCrates(state.crates || [], effectNow, at, options);
    this.effects.updateWorms(state.worms || [], effectNow, at, { ...options, actors: this.actors });
    this.effects.updateProjectiles(state.projectiles || [], effectNow, at, options);
    this.effects.update(effectNow, dt, options);
    this.drawLabels(owner, now);
    this.drawFloating(owner, now);
    this.drawBubbles(owner, now);
    this.app.render();
  }
  drawLabels(owner, now) {
    for (const label of this.labels.values()) label.visible = false;
    const { state, camera, width, height } = owner;
    const occupied = [];
    const worms = state.worms
      .filter((w) => w.hp > 0)
      .sort((a, b) => Number(b.id === state.turn?.wormId) - Number(a.id === state.turn?.wormId));
    // The acting player's own plate would sit over the raised weapon and the
    // launcher while aiming; the turn block names them and the group status
    // still lists health. Other worms keep their plates for targeting.
    const localTurn = state.phase === 'playing' && owner.view?.playerId === state.turn?.playerId;
    for (const worm of worms) {
      const active = worm.id === state.turn?.wormId;
      if (active && localTurn) continue;
      const p = owner.screenPoint(owner.position(worm, now));
      if (p.x < -10 || p.x > width + 10 || p.y < -30 || p.y > height + 30) continue;
      const player = state.players.find((p) => p.id === worm.playerId);
      const team = state.mode === 'ffa' ? state.players.indexOf(player) : worm.team;
      const flag = badgeColor(state, worm);
      const { name, owner: ownerName } = active ? plateNames(worm, player) : { name: '', owner: '' };
      const text = `${MARKS[Math.max(0, team) % MARKS.length]} ${Math.ceil(worm.hp)}`;
      let label = this.labels.get(worm.id);
      if (!label) {
        label = new Container();
        label.plate = new Graphics();
        label.flag = new Graphics();
        label.name = new Text({
          text: '',
          style: {
            fontFamily: 'system-ui',
            fontWeight: '800',
            fontSize: 11,
            fill: PAPER,
            align: 'center',
            lineHeight: 14,
          },
          resolution: 2,
        });
        label.owner = new Text({
          text: '',
          style: {
            fontFamily: 'system-ui',
            fontWeight: '700',
            fontSize: 9.5,
            fill: PAPER,
            align: 'center',
            lineHeight: 12,
          },
          resolution: 2,
        });
        label.text = new Text({
          text: '',
          style: { fontFamily: 'system-ui', fontWeight: '700', fontSize: 11, fill: PAPER, lineHeight: 14 },
          resolution: 2,
        });
        label.name.anchor.set(0.5, 0);
        label.owner.anchor.set(0.5, 0);
        label.owner.alpha = 0.82;
        label.addChild(label.plate, label.flag, label.name, label.owner, label.text);
        this.hud.addChild(label);
        this.labels.set(worm.id, label);
      }
      const key = `${name}\n${ownerName}\n${text}:${active}:${worm.color}:${flag}`;
      if (label.key !== key) {
        label.key = key;
        label.name.text = name;
        label.name.visible = !!name;
        label.owner.text = ownerName;
        label.owner.visible = !!ownerName;
        label.text.text = text;
        // The health row keeps the pennant, mark and points centred as one group.
        const healthW = FLAG_W + Math.ceil(label.text.width);
        const nameH = name ? 14 : 0,
          ownerH = ownerName ? 12 : 0;
        label.boxW =
          Math.ceil(Math.max(healthW, name ? label.name.width : 0, ownerName ? label.owner.width : 0)) + 16;
        label.boxH = 20 + nameH + ownerH;
        const plate = label.plate
          .clear()
          .roundRect(0, 0, label.boxW, label.boxH, 5)
          .fill({ color: INK, alpha: 0.94 });
        if (active) plate.stroke({ width: 1.3, color: worm.color || PAPER });
        label.name.position.set(label.boxW / 2, 3);
        label.owner.position.set(label.boxW / 2, 3 + nameH);
        const rowLeft = (label.boxW - healthW) / 2,
          rowTop = 3 + nameH + ownerH;
        drawFlag(label.flag, flag);
        label.flag.position.set(rowLeft, rowTop + 2.5);
        label.text.position.set(rowLeft + FLAG_W, rowTop);
      }
      const left = clamp(p.x - label.boxW / 2, 5, width - label.boxW - 5);
      let top = p.y - 30 * camera.zoom - label.boxH - 5;
      let fits = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (
          !occupied.some(
            (b) =>
              left < b.x + b.w + 3 &&
              left + label.boxW + 3 > b.x &&
              top < b.y + b.h + 3 &&
              top + label.boxH + 3 > b.y,
          )
        ) {
          fits = true;
          break;
        }
        top -= label.boxH + 3;
      }
      if (!fits || top < 5) continue;
      occupied.push({ x: left, y: top, w: label.boxW, h: label.boxH });
      label.visible = true;
      label.position.set(left, top);
    }
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.active = false;
    if (this.app.renderer) {
      this.app.canvas.removeEventListener('webglcontextlost', this.onLost);
      this.app.canvas.removeEventListener('webglcontextrestored', this.onRestored);
      this.app.destroy(true, { children: true });
    }
    this.actors.clear();
    this.labels.clear();
    this.floating = [];
    this.bubbles.clear();
  }
}
