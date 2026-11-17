import { HillsTerrainPainter } from './hills-terrain.js';
import { HillsBackground } from './hills-background.js';
import { BiomeTerrainPainter } from './biome-terrain.js';
import { BiomeBackground } from './biome-background.js';
import { prepareBiomeArt } from './biome-assets.js';
import { LocalPrediction, canPredict } from './prediction.js';

import {
  WORLD_W,
  WORLD_H,
  clamp,
  lerp,
  PALETTES,
  HISTORY_MS,
  SNAPSHOT_MS,
  BEAT_HOLD,
  BEAT_RECOVER,
  PERF,
} from './rendering/primitives.js';
import {
  prepareReplay,
  replayFinalBlow,
  startReplay,
  skipReplay,
  endReplay,
  _hasBlow,
  _mountSkip,
  stepReplay,
} from './rendering/replay.js';
import {
  updateCamera,
  leadProjectile,
  fitProjectiles,
  punchZoom,
  punchValue,
  killingBlow,
  startBeat,
  beatLag,
  effectTime,
  effectRate,
  drawBeat,
  clampCamera,
  ownTurn,
  followGoal,
  focus,
  overview,
  zoomBy,
  zoomAt,
  localPoint,
  worldPoint,
  screenPoint,
} from './rendering/camera.js';
import {
  canStartAim,
  updateAim,
  endAim,
  cancelAim,
  pointerDown,
  pointerMove,
  pointerUp,
  cancelPointer,
} from './rendering/field-input.js';
import {
  buildTerrain,
  drawGirders,
  buildBackground,
  drawAtmosphere,
  drawWater,
} from './rendering/terrain.js';
import {
  drawWorm,
  drawMine,
  drawCrate,
  drawProjectile,
  drawEffects,
  drawLabels,
  drawEdgeIndicator,
} from './rendering/entities.js';
import { drawAim, drawSlingshot, targetPreview, targetIsPossible } from './rendering/aim.js';

// one-pixel pole, eight-pixel pennant and a gap before the mark
// The final-blow replay keeps a little more than the longest playback window of live snapshots.

// Snapshots arrive at 15 Hz; the replay stretches the interpolation window by its playback rate.

// Impact camera: a quick zoom punch on blasts and a 150 ms "golpe mortal" beat
// that slows only the effects clock. Snapshot interpolation keeps real time.

// Automatic quality: rolling frame-time window, hysteresis band and a switch cooldown.

// Warm local art and GPU presentation during the multiplayer loading barrier.
export const prepareRenderer = (mapId = 'hills') =>
  Promise.all([import('./pixi-combat.js'), prepareBiomeArt(mapId)]).then(([combat]) => combat);

/** Presentation only: collision, turn timing and effects are always server owned. */
export class Renderer {
  constructor(
    canvas,
    {
      onTarget = () => {},
      onCamera = () => {},
      onFrame = () => {},
      onReplayEvent = () => {},
      onAimStart = () => {},
      onAim = () => {},
      onAimEnd = () => {},
      canAim = () => false,
      mapId = 'hills',
    } = {},
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.onTarget = onTarget;
    this.onCamera = onCamera;
    this.onFrame = onFrame;
    this.onReplayEvent = onReplayEvent;
    this.history = [];
    this.replaying = null;
    this.finalBlow = null;
    this.skipButton = null;
    this.snapshotWindow = SNAPSHOT_MS;
    // Slingshot aiming: the owner decides when a press near the worm may aim and receives the result.
    this.onAimStart = onAimStart;
    this.onAim = onAim;
    this.onAimEnd = onAimEnd;
    this.canAim = canAim;
    this.aimDrag = null;
    // Local prediction of the own worm between snapshots; the server remains authoritative.
    this.prediction = new LocalPrediction();
    this.latency = 0;
    this.view = {
      playerId: null,
      angle: -Math.PI / 4,
      power: 0,
      weapon: 'bazooka',
      targeting: false,
      quality: 'high',
      reducedMotion: false,
    };
    // Under quality 'auto' the renderer measures its own frames and picks 'high' or 'low'.
    this.autoQuality = 'high';
    this.perf = {
      samples: [],
      sum: 0,
      lastFrame: null,
      slowSince: null,
      fastSince: null,
      lastSwitch: -Infinity,
    };
    this.zoomPunch = null;
    this.zoomFactor = 1;
    this.fitZoom = null;
    this.beat = null;
    this.lagBase = 0;
    this.state = null;
    this.previous = new Map();
    this.snapshotTime = performance.now();
    this.camera = { x: 800, y: 480, zoom: 0.8 };
    this.cameraGoal = { ...this.camera };
    this.autoFollow = true;
    this.fullView = false;
    this.effects = [];
    this.eventIds = new Set();
    this.pointers = new Map();
    this.target = null;
    this.terrainRevision = null;
    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = WORLD_W;
    this.terrainCanvas.height = WORLD_H;
    this.terrainCtx = this.terrainCanvas.getContext('2d');
    this.background = document.createElement('canvas');
    this.background.width = WORLD_W;
    this.background.height = WORLD_H;
    this.backgroundMap = null;
    this.lastTime = performance.now();
    this.destroyed = false;
    this.listeners = [];
    this.canvas.style.touchAction = 'none';
    this.listen(canvas, 'pointerdown', (e) => this.pointerDown(e));
    this.listen(canvas, 'pointermove', (e) => this.pointerMove(e));
    this.listen(canvas, 'pointerup', (e) => this.pointerUp(e));
    this.listen(canvas, 'pointercancel', (e) => this.cancelPointer(e));
    this.listen(canvas, 'lostpointercapture', (e) => this.cancelPointer(e));
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
    // A held finger on the field (slingshot, camera drag) must never start iOS text selection or a callout.
    this.listen(canvas, 'touchstart', (e) => e.preventDefault(), { passive: false });
    this.listen(
      canvas,
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomAt(Math.exp(-e.deltaY * 0.0015), this.localPoint(e));
      },
      { passive: false },
    );
    this.listen(document, 'visibilitychange', () => {
      this.pointers.clear();
      this.pinch = null;
      this.endAim(false);
      this.prediction.reset();
      this.lastTime = performance.now();
      if (document.hidden) {
        cancelAnimationFrame(this.raf);
        this.raf = null;
      } else if (!this.destroyed && !this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
    });
    this.listen(window, 'blur', () => {
      this.pointers.clear();
      this.pinch = null;
      this.endAim(false);
    });
    this.listen(window, 'resize', () => {
      this.pointers.clear();
      this.pinch = null;
      this.endAim(false);
      this.resize();
    });
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas.parentElement || canvas);
    }
    this.resize();
    this.pixi = null;
    this.hillsTerrain = null;
    this.hillsBackground = null;
    this.hillsAssets = null;
    this.biomeTerrain = null;
    this.biomeBackground = null;
    this.biomeMapId = null;
    this.biomeAssets = null;
    this.artGeneration = 0;
    this.pixiReady = this.initPixi();
    this.loadArt(mapId);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  async initPixi() {
    try {
      const { CombatLayer } = await import('./pixi-combat.js');
      if (this.destroyed) return false;
      const layer = new CombatLayer(this.canvas);
      this.pixi = layer;
      const ready = await layer.init(this.width, this.height, this.dpr);
      if (this.destroyed) {
        layer.destroy();
        return false;
      }
      if (ready) layer.resize(this.width, this.height, this.dpr);
      return ready;
    } catch (error) {
      this.pixi?.destroy();
      this.pixi = null;
      this.pixiError = error.message;
      console.warn('La animación GPU no está disponible; continúa la presentación básica.', error);
      return false;
    }
  }
  loadArt(mapId) {
    this.artMapId = mapId;
    this.artReady = this.initArt(mapId, ++this.artGeneration);
    this.ready = Promise.all([this.pixiReady, this.artReady]).then(([ready]) => ready && !this.destroyed);
  }
  async initArt(mapId, generation) {
    const assets = await prepareBiomeArt(mapId);
    // A previous map may finish downloading after a rematch or departure.
    if (this.destroyed || generation !== this.artGeneration) return;
    if (mapId === 'hills') {
      this.hillsAssets = assets;
      this.hillsTerrain?.setTexture(assets.earth);
      this.hillsBackground?.setImage(assets.backdrop);
      if (this.state?.mapId === mapId && this.terrainData) this.paintHills();
    } else {
      this.biomeAssets = { mapId, ...assets };
      if (this.biomeMapId === mapId) {
        this.biomeTerrain.setTexture(assets.earth);
        this.biomeBackground.setImage(assets.backdrop);
        if (this.state?.mapId === mapId && this.terrainData) this.paintBiome(mapId);
      }
    }
  }
  ensureHills() {
    if (this.hillsTerrain) return;
    this.hillsTerrain = new HillsTerrainPainter();
    this.hillsBackground = new HillsBackground();
    if (this.hillsAssets) {
      this.hillsTerrain.setTexture(this.hillsAssets.earth);
      this.hillsBackground.setImage(this.hillsAssets.backdrop);
    }
  }
  paintHills() {
    this.ensureHills();
    this.hillsTerrain.paint(this.terrainCtx, this.terrainData);
    this.drawGirders();
  }
  ensureBiome(mapId) {
    if (this.biomeMapId === mapId) return;
    this.biomeTerrain?.destroy();
    this.biomeBackground?.destroy();
    this.biomeTerrain = new BiomeTerrainPainter(mapId);
    this.biomeBackground = new BiomeBackground(mapId);
    this.biomeMapId = mapId;
    if (this.biomeAssets?.mapId === mapId) {
      this.biomeTerrain.setTexture(this.biomeAssets.earth);
      this.biomeBackground.setImage(this.biomeAssets.backdrop);
    }
  }
  paintBiome(mapId) {
    this.ensureBiome(mapId);
    this.biomeTerrain.paint(this.terrainCtx, this.terrainData);
    this.drawGirders();
  }
  listen(el, type, fn, options) {
    el.addEventListener(type, fn, options);
    this.listeners.push([el, type, fn, options]);
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width || this.canvas.parentElement?.clientWidth || 800);
    this.height = Math.max(1, rect.height || this.canvas.parentElement?.clientHeight || 450);
    this.followOffsetY =
      Number.parseFloat(getComputedStyle(this.canvas).getPropertyValue('--combat-focus-y')) || 42;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'low' ? 1.25 : 2);
    const width = Math.round(this.width * this.dpr),
      height = Math.round(this.height * this.dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.minZoom = Math.min(this.width / WORLD_W, this.height / WORLD_H);
    this.maxZoom = Math.max(2.8, this.minZoom * 5);
    if (this.fullView) this.overview();
    else {
      this.cameraGoal.zoom = clamp(this.cameraGoal.zoom, this.minZoom, this.maxZoom);
      this.clampCamera(this.cameraGoal);
    }
    this.pixi?.resize(this.width, this.height, this.dpr);
  }
  setState(state) {
    if (!state) return;
    // Live snapshots received during the replay wait for it; the newest one is applied afterwards.
    if (this.replaying) {
      this.replaying.live = state;
      return;
    }
    const now = performance.now();
    const finishing =
      this.state?.phase === 'playing' && state.phase === 'finished' && this.state.mapId === state.mapId;
    this._apply(state, now, 'live');
    if (state.phase === 'playing') {
      this.history.push({ state, at: now });
      while (this.history.length && this.history[0].at < now - HISTORY_MS) this.history.shift();
    } else if (finishing) this.finalBlow = { at: now };
  }
  /** Collects the live snapshots that led to the finish without starting anything, so the
   *  owner can announce the result first. Returns null when there is nothing to replay
   *  (a reconnection into a finished match, a forfeit-only finish, a replay already running). */
  prepareReplay(...args) {
    return prepareReplay(this, ...args);
  }
  /** Plays a prepared window through the ordinary snapshot path at `rate` (0.75 = slow motion)
   *  and resolves after playback or skip. */
  replayFinalBlow(...args) {
    return replayFinalBlow(this, ...args);
  }
  startReplay(...args) {
    return startReplay(this, ...args);
  }
  skipReplay(...args) {
    return skipReplay(this, ...args);
  }
  endReplay(...args) {
    return endReplay(this, ...args);
  }
  _hasBlow(...args) {
    return _hasBlow(this, ...args);
  }
  _mountSkip(...args) {
    return _mountSkip(this, ...args);
  }
  stepReplay(...args) {
    return stepReplay(this, ...args);
  }

  /** mode: 'live' detects new games and records history; 'replay' re-triggers effects of the window;
   *  'restore' returns to the final live state without treating the jump as a new game. */
  _apply(state, now, mode) {
    const live = mode === 'live',
      replay = mode === 'replay';
    const isNewMap = live && this.state?.mapId !== state.mapId;
    const newTurn = !this.state || this.state.turn?.number !== state.turn?.number || isNewMap;
    const oldNumber = this.state?.turn?.number ?? 0;
    const newGame =
      live &&
      (!this.state ||
        isNewMap ||
        (state.turn?.number ?? 0) < oldNumber ||
        state.elapsed < this.state.elapsed - 1);
    const previous = new Map();
    for (const entity of [
      ...(this.state?.worms || []),
      ...(this.state?.projectiles || []),
      ...(this.state?.mines || []),
      ...(this.state?.crates || []),
    ]) {
      previous.set(entity.id, this.position(entity, now));
    }
    this.previous = previous;
    this.snapshotTime = now;
    this.state = state;
    if (this.artMapId !== state.mapId) this.loadArt(state.mapId);
    if (newGame) {
      this.eventIds.clear();
      this.effects = [];
      this.target = null;
      this.beat = null;
      this.zoomPunch = null;
      this.impactFocus = null;
      this.pixi?.clear();
      this.history = [];
      this.finalBlow = null;
    }
    if (isNewMap || this.backgroundMap !== state.mapId) this.buildBackground(state.mapId);
    if (state.terrain && (this.terrainRevision !== state.terrainRevision || newGame)) {
      this.buildTerrain(state.terrain, state.mapId);
      this.terrainRevision = state.terrainRevision;
    }
    this.syncPrediction(state, now);
    for (const event of state.events || []) {
      if (this.eventIds.has(event.id)) continue;
      this.eventIds.add(event.id);
      // Reconnect snapshots carry history: display only events received during live play.
      if (newGame || document.hidden) continue;
      if (replay) this.onReplayEvent(event);
      this.addEffect(event, now);
    }
    if (this.eventIds.size > 192) this.eventIds = new Set((state.events || []).map((e) => e.id));
    if (newTurn) {
      this.target = null;
      this.endAim(false);
      this.focus();
    }
  }
  /** Measured round trip of the player's commands, used to line snapshots up with predicted states. */
  setLatency(ms) {
    if (Number.isFinite(ms) && ms >= 0) this.latency = Math.min(ms, 1000);
  }
  /** The owner's current movement intention ({ move }), the only input the prediction integrates. */
  setInput(input) {
    this.prediction.setInput(input);
  }
  /** A jump the owner just requested; the prediction takes off before the server confirms it. */
  predictJump(back, facing) {
    this.prediction.jump(back, facing);
  }
  syncPrediction(state, now) {
    const worm =
      canPredict(state, this.view.playerId) && this.terrainData
        ? state.worms.find((w) => w.id === state.turn.wormId)
        : null;
    if (!worm) {
      this.prediction.reset();
      return;
    }
    this.prediction.setTerrain(this.prediction.terrain, state.waterY);
    if (this.prediction.active && this.prediction.wormId === worm.id)
      this.prediction.reconcile(worm, now, this.latency);
    else this.prediction.start(worm, now, this.latency);
  }
  /** The worm as drawn: predicted motion fields for the own worm, the snapshot for everyone else. */
  displayWorm(worm) {
    if (!this.prediction.active || worm.id !== this.prediction.wormId) return worm;
    const motion = this.prediction.motion();
    return motion ? { ...worm, ...motion } : worm;
  }
  setView(view) {
    const qualityChanged = view.quality && view.quality !== this.view.quality;
    const targetChanged = view.weapon && view.weapon !== this.view.weapon;
    Object.assign(this.view, view);
    // During the replay the local identity is parked so the recording keeps its spectator framing.
    if (this.replaying && this.view.playerId !== null) {
      this.replaying.playerId = this.view.playerId;
      this.view.playerId = null;
    }
    if (targetChanged || view.targeting === false) this.target = null;
    if (Object.prototype.hasOwnProperty.call(view, 'target')) this.target = view.target;
    if (qualityChanged) {
      this.resetPerf();
      this.autoQuality = 'high';
      this.resize();
    }
    this.canvas.style.cursor = this.view.targeting ? 'crosshair' : this.pointers.size ? 'grabbing' : 'grab';
  }
  /** Effective quality: the manual choice, or the automatic verdict under 'auto'. */
  get quality() {
    return this.view.quality === 'auto' ? this.autoQuality : this.view.quality;
  }
  effectiveView() {
    return this.view.quality === 'auto' ? { ...this.view, quality: this.quality } : this.view;
  }
  resetPerf() {
    Object.assign(this.perf, { samples: [], sum: 0, slowSince: null, fastSince: null });
  }
  position(entity, now) {
    if (this.prediction.active && entity.id === this.prediction.wormId) {
      const predicted = this.prediction.position(now);
      if (predicted) return predicted;
    }
    const old = this.previous.get(entity.id);
    const t = clamp((now - this.snapshotTime) / this.snapshotWindow, 0, 1);
    if (!old || Math.hypot(old.x - entity.x, old.y - entity.y) > 160) return { x: entity.x, y: entity.y };
    return { x: lerp(old.x, entity.x, t), y: lerp(old.y, entity.y, t) };
  }
  buildTerrain(...args) {
    return buildTerrain(this, ...args);
  }
  drawGirders(...args) {
    return drawGirders(this, ...args);
  }
  buildBackground(...args) {
    return buildBackground(this, ...args);
  }
  addEffect(event, now) {
    const type = event.type;
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return;
    const pixiHandled =
      this.pixi?.addEvent(event, now, this.state, this.effectiveView(), this.effectTime(now)) || false;
    event = { ...event, pixiHandled };
    if (type === 'explosion' || type === 'explode') {
      this.effects.push({
        ...event,
        type: 'explosion',
        start: now,
        life: this.view.reducedMotion ? 350 : 820,
        radius: event.radius || 45,
      });
      if (this.autoFollow) {
        this.impactFocus = { x: event.x, y: event.y, until: now + 600 };
      }
      if (!this.view.reducedMotion) this.shake = Math.min(7, (event.radius || 40) / 10);
      // Bigger blasts punch the zoom harder: 8 % for a fragment, 12 % for dynamite.
      this.punchZoom(lerp(0.08, 0.12, clamp(((event.radius || 45) - 30) / 60, 0, 1)), now);
    } else if (
      type === 'damage' ||
      type === 'death' ||
      type === 'drown' ||
      type === 'splash' ||
      type === 'cratePickup'
    ) {
      this.effects.push({
        ...event,
        start: now,
        life: 1200,
        text: event.text || (type === 'damage' ? '¡Ay!' : '¡Al agua!'),
      });
      if (type !== 'damage' && type !== 'cratePickup' && this.killingBlow(event)) this.startBeat(now);
    } else if (
      [
        'teleport',
        'fire',
        'jump',
        'mine',
        'girder',
        'rope',
        'jetpack',
        'shot',
        'bat',
        'mineTrigger',
        'ropeBreak',
        'fuelEmpty',
        'crateLand',
        'crateDestroyed',
      ].includes(type)
    ) {
      this.effects.push({
        ...event,
        start: now,
        life:
          type === 'teleport'
            ? 750
            : type === 'mineTrigger'
              ? 700
              : type === 'shot'
                ? 160
                : type === 'crateDestroyed'
                  ? 420
                  : 250,
      });
      // A launcher kicks the camera slightly; impacts keep their stronger shake.
      if (
        type === 'fire' &&
        (event.weapon === 'bazooka' || event.weapon === 'rocket') &&
        !this.view.reducedMotion
      )
        this.shake = Math.max(this.shake || 0, 2.6);
    }
    if (this.effects.length > 45) this.effects.splice(0, this.effects.length - 45);
  }
  frame(timestamp) {
    this.raf = null;
    if (this.destroyed || document.hidden) return;
    this.sampleFrame(timestamp);
    if (this.width > 1 && this.height > 1 && this.canvas.getClientRects().length) this.draw(timestamp);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  draw(timestamp = performance.now()) {
    const ctx = this.ctx;
    const dt = clamp((timestamp - this.lastTime) / 1000, 0, 0.05);
    this.lastTime = timestamp;
    // Slow motion in the replay also slows the effects clock, so smoke and sparks match the world.
    if (this.replaying) {
      this.lagBase += dt * 1000 * (1 - this.replaying.rate);
      this.stepReplay(timestamp);
    }
    const state = this.state;
    const palette = PALETTES[state?.mapId] || PALETTES.hills;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = palette.sky[0];
    ctx.fillRect(0, 0, this.width, this.height);
    if (!state) return;
    this.onFrame(timestamp, dt);
    if (this.beat && timestamp - this.beat.start >= BEAT_HOLD + BEAT_RECOVER) {
      this.lagBase += this.beatLag(timestamp);
      this.beat = null;
    }
    this.prediction.advance(timestamp);
    this.updateCamera(timestamp, dt);
    let shakeX = 0,
      shakeY = 0;
    if (this.shake > 0.1 && !this.view.reducedMotion) {
      shakeX = Math.sin(timestamp * 0.07) * this.shake;
      shakeY = Math.cos(timestamp * 0.11) * this.shake * 0.6;
      this.shake *= Math.exp(-dt * 14);
    }
    const scenery =
      state.mapId === 'hills'
        ? this.hillsBackground
        : this.biomeMapId === state.mapId
          ? this.biomeBackground
          : null;
    scenery?.draw(ctx, {
      width: this.width,
      height: this.height,
      camera: this.camera,
      reducedMotion: this.view.reducedMotion,
      quality: this.quality,
      time: timestamp,
    });
    ctx.save();
    ctx.translate(this.width / 2 + shakeX, this.height / 2 + shakeY);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);
    if (!scenery) ctx.drawImage(this.background, 0, 0);
    ctx.drawImage(this.terrainCanvas, 0, 0);
    if (this.quality === 'high') this.drawAtmosphere(ctx, timestamp);
    this.drawWater(ctx, timestamp, palette, false);
    if (!this.pixi?.active) for (const mine of state.mines || []) this.drawMine(ctx, mine, timestamp);
    if (!this.pixi?.active) for (const crate of state.crates || []) this.drawCrate(ctx, crate, timestamp);
    if (!this.pixi?.active)
      for (const worm of state.worms || []) if (worm.hp > 0) this.drawWorm(ctx, worm, timestamp);
    for (const projectile of state.projectiles || []) {
      if (this.pixi?.active && this.pixi.handlesProjectile(projectile.kind || projectile.weapon)) continue;
      this.drawProjectile(ctx, projectile, timestamp);
    }
    this.drawAim(ctx, timestamp);
    this.drawEffects(ctx, timestamp);
    this.drawWater(ctx, timestamp, palette, true);
    ctx.restore();
    if (!this.pixi?.active) this.drawLabels(ctx, timestamp);
    this.drawEdgeIndicator(ctx, timestamp);
    this.drawBeat(ctx, timestamp);
    this.pixi?.draw(this, timestamp, dt, shakeX, shakeY);
  }
  drawAtmosphere(...args) {
    return drawAtmosphere(this, ...args);
  }
  drawWater(...args) {
    return drawWater(this, ...args);
  }
  drawWorm(...args) {
    return drawWorm(this, ...args);
  }
  drawMine(...args) {
    return drawMine(this, ...args);
  }
  drawCrate(...args) {
    return drawCrate(this, ...args);
  }
  drawProjectile(...args) {
    return drawProjectile(this, ...args);
  }
  drawAim(...args) {
    return drawAim(this, ...args);
  }
  /** Slingshot preview: the band pulled to the finger, a ghost reticle there and a power arc on the shot side. */
  drawSlingshot(...args) {
    return drawSlingshot(this, ...args);
  }
  targetPreview(...args) {
    return targetPreview(this, ...args);
  }
  targetIsPossible(...args) {
    return targetIsPossible(this, ...args);
  }
  drawEffects(...args) {
    return drawEffects(this, ...args);
  }
  drawLabels(...args) {
    return drawLabels(this, ...args);
  }
  drawEdgeIndicator(...args) {
    return drawEdgeIndicator(this, ...args);
  }
  updateCamera(...args) {
    return updateCamera(this, ...args);
  }
  /** The main shot leads while it flies; among fragments or bombs the one falling fastest lands first. */
  leadProjectile(...args) {
    return leadProjectile(this, ...args);
  }
  /** Zoom out only while live fragments spread past 60 % of the viewport around the followed one. */
  fitProjectiles(...args) {
    return fitProjectiles(this, ...args);
  }
  /** Eases the zoom up by `amount` over 120 ms and back over 350 ms. Overlapping blasts continue from the current value. */
  punchZoom(...args) {
    return punchZoom(this, ...args);
  }
  punchValue(...args) {
    return punchValue(this, ...args);
  }
  /** A worm of another player eliminated during the acting player's turn. */
  killingBlow(...args) {
    return killingBlow(this, ...args);
  }
  /** Golpe mortal: a stronger punch, a warm vignette and the effects clock at 35 % for
   *  150 ms, recovering over 200 ms. Characters and snapshots keep real time. */
  startBeat(...args) {
    return startBeat(this, ...args);
  }
  /** Milliseconds the effects clock has fallen behind real time during the current beat, in closed form. */
  beatLag(...args) {
    return beatLag(this, ...args);
  }
  /** Presentation clock for the Pixi effects only: real time minus everything the beats slowed. */
  effectTime(...args) {
    return effectTime(this, ...args);
  }
  effectRate(...args) {
    return effectRate(this, ...args);
  }
  drawBeat(...args) {
    return drawBeat(this, ...args);
  }
  /** Automatic quality: the average frame time over a rolling 2 s window drops to
   *  'low' after 2 s above 22 ms and returns to 'high' after 10 s under 17 ms, with
   *  the band in between as hysteresis and at most one switch every 10 s. */
  sampleFrame(timestamp) {
    const perf = this.perf,
      previous = perf.lastFrame;
    perf.lastFrame = timestamp;
    if (this.view.quality !== 'auto') {
      if (perf.samples.length) this.resetPerf();
      return;
    }
    if (previous == null) return;
    const delta = timestamp - previous;
    // A hidden tab or a one-off stall is not a frame-time measurement.
    if (delta <= 0 || delta > 250) return;
    perf.samples.push({ t: timestamp, d: delta });
    perf.sum += delta;
    while (perf.samples.length && perf.samples[0].t < timestamp - PERF.window)
      perf.sum -= perf.samples.shift().d;
    if (perf.samples.length < PERF.minSamples || timestamp - perf.samples[0].t < PERF.window * 0.75) return;
    const average = perf.sum / perf.samples.length;
    if (average > PERF.slowMs) {
      perf.slowSince ??= timestamp;
      perf.fastSince = null;
    } else if (average < PERF.fastMs) {
      perf.fastSince ??= timestamp;
      perf.slowSince = null;
    } else perf.slowSince = perf.fastSince = null;
    if (timestamp - perf.lastSwitch < PERF.cooldown) return;
    const next =
      this.autoQuality === 'high' && perf.slowSince != null && timestamp - perf.slowSince >= PERF.slowFor
        ? 'low'
        : this.autoQuality === 'low' && perf.fastSince != null && timestamp - perf.fastSince >= PERF.fastFor
          ? 'high'
          : null;
    if (!next) return;
    this.autoQuality = next;
    perf.lastSwitch = timestamp;
    perf.slowSince = perf.fastSince = null;
    this.resize();
  }
  clampCamera(...args) {
    return clampCamera(this, ...args);
  }
  /** The local player's own turn: the field ahead and above the shooter matters most. */
  ownTurn(...args) {
    return ownTurn(this, ...args);
  }
  followGoal(...args) {
    return followGoal(this, ...args);
  }
  focus(...args) {
    return focus(this, ...args);
  }
  overview(...args) {
    return overview(this, ...args);
  }
  zoomBy(...args) {
    return zoomBy(this, ...args);
  }
  zoomAt(...args) {
    return zoomAt(this, ...args);
  }
  localPoint(...args) {
    return localPoint(this, ...args);
  }
  worldPoint(...args) {
    return worldPoint(this, ...args);
  }
  screenPoint(...args) {
    return screenPoint(this, ...args);
  }
  /** A press within reach of the active worm, on the own turn with a chargeable weapon, aims instead of panning. */
  canStartAim(...args) {
    return canStartAim(this, ...args);
  }
  updateAim(...args) {
    return updateAim(this, ...args);
  }
  /** Finish the gesture: a shot when the finger is clear of the press point, otherwise a plain cancel. */
  endAim(...args) {
    return endAim(this, ...args);
  }
  /** The owner cancels the gesture silently (turn change, dialog, blur); its own state is already reset. */
  cancelAim(...args) {
    return cancelAim(this, ...args);
  }
  pointerDown(...args) {
    return pointerDown(this, ...args);
  }
  pointerMove(...args) {
    return pointerMove(this, ...args);
  }
  pointerUp(...args) {
    return pointerUp(this, ...args);
  }
  cancelPointer(...args) {
    return cancelPointer(this, ...args);
  }
  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.endReplay();
    this.history = [];
    this.aimDrag = null;
    this.prediction.reset();
    this.pixi?.destroy();
    this.hillsTerrain?.destroy();
    this.hillsBackground?.destroy();
    this.hillsAssets = null;
    this.biomeTerrain?.destroy();
    this.biomeBackground?.destroy();
    this.biomeAssets = null;
    this.listeners.forEach(([el, type, fn, options]) => el.removeEventListener(type, fn, options));
    this.pointers.clear();
    this.effects = [];
    this.terrainData = null;
    this.terrainCanvas.width = 0;
    this.background.width = 0;
  }
}
