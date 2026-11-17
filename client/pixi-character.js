import { Container } from 'pixi.js';
import { CHARACTER_PALETTE as C, outline, stroke, part, createHand } from './art/palette.js';
import { createGrenadeArt, createClusterArt, createToolArt } from './art/weapons.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hash = (value) => {
  let n = 0;
  for (const char of String(value)) n = (n * 31 + char.charCodeAt(0)) >>> 0;
  return n;
};
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const smoothstep = (value) => value * value * (3 - 2 * value);
const TURN_MS = 120;

/** A presentation rig. It never writes into the authoritative worm object. */
export class WormActor extends Container {
  constructor(worm) {
    super();
    this.eventMode = 'none';
    this.wormId = worm.id;
    this.seed = (hash(worm.id) % 10000) / 1000;
    this.previousPosition = { x: worm.x, y: worm.y };
    this.previousGrounded = !!worm.grounded;
    this.previousHealth = worm.hp;
    this.gait = this.seed;
    this.moveBlend = 0;
    this.hurtAt = this.landAt = this.jumpAt = this.firedAt = -Infinity;
    this.deathAt = -Infinity;
    this.lastWeapon = 'bazooka';
    this.lastAim = worm.facing === -1 ? -Math.PI * 0.75 : -Math.PI * 0.25;
    this.displayAim = this.lastAim;
    this.aimReady = false;
    this.requestedFacing = this.visualFacing = worm.facing === -1 ? -1 : 1;
    this.turnFrom = this.visualFacing;
    this.turnAt = -Infinity;
    this.jumpBack = false;
    this.jumpFacing = this.visualFacing;
    this.jumpVelocity = { x: 0, y: 0 };
    this.attachmentStarts = new Map();
    this.ropeBlend = worm.rope ? 1 : 0;
    this.flightBlend = worm.jetpack ? 1 : 0;
    this.fallBlend = !worm.grounded && !worm.rope && !worm.jetpack ? 1 : 0;
    this.ropeTension = clamp(worm.rope?.tension ?? (worm.rope ? 1 : 0), 0, 1);
    this.travelTilt = 0;
    this.thrustLevel = 0;
    this.ropeSocket = { x: worm.x, y: worm.y - 2 };
    this.jetExhaust = { x: worm.x, y: worm.y + 8, dx: 0, dy: 1, power: 0 };
    this.shadow = part(this, (g) => g.ellipse(0, 10.6, 12, 3).fill({ color: C.ink, alpha: 0.2 }));
    this.rig = this.addChild(new Container());
    this.rig.pivot.set(0, 9);
    this.rig.y = 9;
    this.backArm = this.rig.addChild(new Container());
    this.backArm.position.set(-4, -4);
    part(this.backArm, (g) =>
      g
        .moveTo(0, 0)
        .quadraticCurveTo(-4, 2, -5, 6)
        .stroke(stroke(C.outline, 4.5))
        .moveTo(0, 0)
        .quadraticCurveTo(-4, 2, -5, 6)
        .stroke(stroke(C.skinShade, 2.8)),
    );
    createHand(this.backArm, -5, 6, 2.8);
    this.tail = part(this.rig, (g) => {
      g.moveTo(-3, 4)
        .quadraticCurveTo(-9, 8, -15, 5)
        .quadraticCurveTo(-15, 11, -6, 11)
        .lineTo(4, 9)
        .closePath()
        .fill(C.skin)
        .stroke(outline());
      g.moveTo(-11, 6.7)
        .quadraticCurveTo(-10, 9, -7.3, 9.2)
        .moveTo(-7.1, 5.8)
        .quadraticCurveTo(-6.5, 8, -3.8, 8.7)
        .stroke(stroke(C.skinShade, 0.9));
    });
    this.body = part(this.rig, (g) => {
      g.moveTo(-7, 9)
        .bezierCurveTo(-12, 4, -8, 0, -7, -5)
        .bezierCurveTo(-7, -11, -3, -15, 3, -13)
        .bezierCurveTo(10, -12, 10, -6, 6, -1)
        .bezierCurveTo(3, 3, 2, 6, 8, 8)
        .quadraticCurveTo(9, 11, 1, 11)
        .quadraticCurveTo(-4, 11, -7, 9)
        .closePath()
        .fill(C.skin)
        .stroke(outline(1.5));
      g.moveTo(3, -10)
        .quadraticCurveTo(7, -7, 3, 0)
        .quadraticCurveTo(-1, 5, 4, 8)
        .quadraticCurveTo(-4, 10, -4, 4)
        .quadraticCurveTo(-5, -1, 3, -10)
        .closePath()
        .fill(C.skinLight);
      g.moveTo(-7, 1)
        .quadraticCurveTo(-3, 4, 1, 4)
        .moveTo(-7, 5)
        .quadraticCurveTo(-3, 8, 1, 8)
        .stroke(stroke(C.skinShade, 1));
      g.moveTo(-6, -4).quadraticCurveTo(-4, -2, -1, -2).stroke(stroke(C.skinShade, 0.9));
    });
    this.pack = this.rig.addChild(createToolArt('jetpack'));
    this.pack.position.set(-10, -5);
    this.flame = this.pack.parts.flame;
    this.head = this.rig.addChild(new Container());
    this.head.position.set(1, -14);
    // Odd worms of a player wear the knotted band, even ones a helmet, so a pair
    // reads as two characters while the team colour stays on both.
    const index = Number(String(worm.id).split(':').pop());
    this.helmeted = Number.isFinite(index) && index % 2 === 0;
    // Cloth tails trail from the knot behind the head and flap with motion.
    this.bandTails = part(this.head, (g) => {
      g.moveTo(-11, -7.2)
        .quadraticCurveTo(-17.5, -10.5, -22.5, -6.2)
        .quadraticCurveTo(-18.5, -5.6, -15.8, -3.4)
        .quadraticCurveTo(-13.2, -3.2, -11, -4.6)
        .closePath()
        .fill(C.cream)
        .stroke(outline(1));
      g.moveTo(-11, -5.2)
        .quadraticCurveTo(-16.5, -3.4, -20, 1.6)
        .quadraticCurveTo(-15.8, 0.4, -12.8, -1.4)
        .closePath()
        .fill(C.cream)
        .stroke(outline(1));
    });
    part(this.head, (g) => {
      g.ellipse(1, -2, 12.6, 12.8).fill(C.skin).stroke(outline(1.5));
      g.ellipse(4, -8.4, 4.6, 2.2).fill(C.skinLight);
      g.ellipse(10.2, 3.6, 2.6, 1.7).fill(C.cheek);
      g.moveTo(-10, 0).quadraticCurveTo(-9.4, 7, -3, 9).stroke(stroke(C.skinShade, 1.5));
    });
    // The band hugs the crown above the brows; the knot sits at the back.
    this.band = part(this.head, (g) => {
      g.moveTo(-10.8, -6.5)
        .bezierCurveTo(-7, -17.5, 9, -18.5, 11.2, -9.5)
        .lineTo(10.2, -7)
        .bezierCurveTo(8.4, -14.5, -6.4, -13.6, -9.4, -4.2)
        .closePath()
        .fill(C.cream)
        .stroke(outline(1));
      g.circle(-11.4, -6.4, 2.1).fill(C.cream).stroke(outline(1));
    });
    this.bandGlint = part(this.head, (g) =>
      g
        .moveTo(-7, -9.8)
        .quadraticCurveTo(1, -15.2, 8.6, -11.4)
        .stroke({ color: C.cream, width: 0.9, alpha: 0.55 }),
    );
    this.eyes = this.head.addChild(new Container());
    part(this.eyes, (g) => {
      g.ellipse(0.4, -1.2, 3.6, 4.3).fill(C.cream).stroke(outline(0.9));
      g.ellipse(7.4, -0.8, 4.3, 4.9).fill(C.cream).stroke(outline(1));
    });
    this.pupils = part(this.eyes, (g) => {
      g.ellipse(1.4, -0.6, 1.5, 2.1).fill(C.ink);
      g.ellipse(8.6, -0.2, 1.9, 2.6).fill(C.ink);
      g.circle(1.9, -1.4, 0.6).fill(C.cream);
      g.circle(9.3, -1.1, 0.75).fill(C.cream);
    });
    this.brows = part(this.head, (g) => {
      g.moveTo(-2.4, -6.3)
        .quadraticCurveTo(0.4, -7.9, 3.4, -6.4)
        .moveTo(3.8, -6.5)
        .quadraticCurveTo(7.4, -8.2, 10.8, -6.2)
        .stroke(stroke(C.outline, 1.4));
    });
    // A domed helmet with a brim replaces the band on even-numbered worms.
    this.helmet = part(this.head, (g) => {
      g.moveTo(-12.6, -4)
        .bezierCurveTo(-10, -19.5, 11, -20.5, 14, -6)
        .quadraticCurveTo(1, -9.5, -12.6, -4)
        .closePath()
        .fill(C.cream)
        .stroke(outline(1.4));
      g.moveTo(-12.6, -4).quadraticCurveTo(1, -9.5, 14, -6).stroke(stroke(0xb9b9b9, 2.2));
      g.moveTo(-13, -3.7).quadraticCurveTo(1, -9.3, 14.4, -5.7).stroke(outline(1.1));
      g.moveTo(-6, -11)
        .quadraticCurveTo(-1, -16.4, 5, -15.4)
        .stroke({ color: 0xffffff, width: 1.3, alpha: 0.5 });
      g.circle(-8.6, -6.3, 0.75).fill(0xf2f2f2);
      g.circle(9.8, -7.9, 0.75).fill(0xf2f2f2);
      g.star(5.2, -12.2, 5, 2.1, 0.95).fill(0xfafafa).stroke({ color: 0xa6a6a6, width: 0.6 });
    });
    this.helmet.visible = this.helmeted;
    this.band.visible = this.bandGlint.visible = this.bandTails.visible = !this.helmeted;
    this.mouth = part(this.head, (g) => {
      g.moveTo(3.4, 5.4).quadraticCurveTo(7.4, 8.9, 11.4, 5).stroke(stroke(C.skinDeep, 1.2));
      g.roundRect(7.4, 6.5, 1.9, 1.6, 0.4).fill(C.cream);
    });
    this.hurtMouth = part(this.head, (g) => {
      g.ellipse(8, 6.5, 2.8, 2).fill(C.skinDeep).stroke(outline(0.7));
      g.ellipse(8.2, 7.4, 1.5, 0.6).fill(C.cheek);
    });
    this.closedEyes = part(this.head, (g) => {
      g.moveTo(-2.6, -1.4)
        .quadraticCurveTo(0.4, 0.4, 3.6, -1.2)
        .moveTo(3.6, -1)
        .quadraticCurveTo(7.4, 1.2, 11.4, -0.8)
        .stroke(stroke(C.outline, 1.5));
    });
    this.frontArm = this.rig.addChild(new Container());
    this.frontArm.position.set(5, -4);
    // The resting arm bends forward onto the belly instead of hanging straight.
    part(this.frontArm, (g) =>
      g
        .moveTo(0, 0)
        .quadraticCurveTo(2.6, 2.6, 3.4, 6)
        .stroke(stroke(C.outline, 4.6))
        .moveTo(0, 0)
        .quadraticCurveTo(2.6, 2.6, 3.4, 6)
        .stroke(stroke(C.skin, 2.8)),
    );
    createHand(this.frontArm, 3.6, 6.4, 3.2);
    // Attachments follow the body anchor, but never inherit its squash or roll.
    // This keeps the muzzle aligned with the authoritative aim in every pose.
    this.weaponRig = this.addChild(new Container());
    this.weaponRig.position.set(3, -6);
    this.weapons = new Map();
    this.holdHands = this.weaponRig.addChild(new Container());
    this.supportHand = createHand(this.holdHands, 8, 5, 3.1);
    this.gripHand = createHand(this.holdHands, -2, 7, 3.2);
    this.throwRig = this.addChild(new Container());
    this.throwRig.position.set(4, -7);
    part(this.throwRig, (g) =>
      g
        .moveTo(0, 0)
        .quadraticCurveTo(6, -1, 10, -8)
        .stroke(stroke(C.outline, 5))
        .moveTo(0, 0)
        .quadraticCurveTo(6, -1, 10, -8)
        .stroke(stroke(C.skin, 3.2)),
    );
    this.heldGrenade = createGrenadeArt({ scale: 0.83 });
    this.heldGrenade.position.set(10, -13);
    this.throwRig.addChild(this.heldGrenade);
    this.heldCluster = createClusterArt({ scale: 0.83 });
    this.heldCluster.position.set(10, -13);
    this.throwRig.addChild(this.heldCluster);
    createHand(this.throwRig, 10, -8, 3.5);
    this.setTeamColor(worm.color);
  }

  setTeamColor(color) {
    const chosen = color || C.team;
    if (chosen === this.teamColor) return;
    this.teamColor = chosen;
    this.band.tint = chosen;
    this.bandTails.tint = chosen;
    this.helmet.tint = chosen;
  }

  handleEvent(event, now) {
    if (event.wormId && event.wormId !== this.wormId) return;
    if (event.type === 'jetpack' && event.enabled === false) return;
    if (['fire', 'shot', 'bat', 'rope', 'jetpack', 'teleport', 'girder'].includes(event.type)) {
      this.firedAt = now;
      this.lastWeapon =
        event.weapon ||
        (['bat', 'rope', 'jetpack', 'teleport', 'girder'].includes(event.type)
          ? event.type
          : this.lastWeapon);
      if (Number.isFinite(event.angle)) {
        this.lastAim = this.displayAim = event.angle;
        this.aimReady = true;
      }
    } else if (event.type === 'damage') this.hurtAt = now;
    else if (event.type === 'jump') {
      this.jumpAt = now;
      this.jumpBack = !!event.back;
      this.jumpFacing = event.facing === -1 || event.facing === 1 ? event.facing : this.requestedFacing;
      this.jumpVelocity.x = Number.isFinite(event.vx) ? event.vx : 0;
      this.jumpVelocity.y = Number.isFinite(event.vy) ? event.vy : 0;
    } else if (event.type === 'death' || event.type === 'drown') {
      this.deathAt = now;
      this.hurtAt = now;
    }
  }

  update(
    worm,
    {
      now,
      dt = 1 / 60,
      position = worm,
      active = false,
      local = false,
      facing: facingOverride,
      angle,
      weapon = 'bazooka',
      power = 0,
      reducedMotion = false,
    } = {},
  ) {
    now = Number.isFinite(now) ? now : performance.now();
    dt = clamp(dt, 0, 0.08);
    this.position.set(position.x, position.y);
    this.setTeamColor(worm.color);
    const grounded = !!worm.grounded;
    const dx = position.x - this.previousPosition.x;
    const dy = position.y - this.previousPosition.y;
    const travelled = Math.hypot(dx, dy);
    if (!this.previousGrounded && grounded) this.landAt = now;
    if (worm.hp < this.previousHealth) this.hurtAt = now;
    if (worm.hp <= 0 && this.previousHealth > 0) this.deathAt = now;
    this.previousGrounded = grounded;
    this.previousHealth = worm.hp;
    this.previousPosition.x = position.x;
    this.previousPosition.y = position.y;
    const moveTarget = grounded && Math.abs(worm.vx || 0) > 6 ? Math.min(1, Math.abs(worm.vx) / 75) : 0;
    this.moveBlend += (moveTarget - this.moveBlend) * Math.min(1, dt * 16);
    if (grounded && travelled < 50) this.gait += travelled * 0.23;
    const motion = reducedMotion ? 0.15 : 1;
    const step = Math.sin(this.gait),
      bob = (1 - Math.cos(this.gait * 2)) * 0.5;
    const breathe = Math.sin(now / 550 + this.seed) * 0.018 * motion;
    const landAge = (now - this.landAt) / 1000;
    const landing = landAge < 0.3 ? Math.sin((landAge / 0.3) * Math.PI) * Math.exp(-landAge * 5) : 0;
    const fireAge = (now - this.firedAt) / 1000;
    const fireWeapon = this.lastWeapon;
    const recoil =
      ['bazooka', 'shotgun'].includes(fireWeapon) && fireAge < 0.34
        ? Math.exp(-fireAge * 13) * Math.sin((Math.min(1, fireAge / 0.06) * Math.PI) / 2)
        : 0;
    const throwShot = ['grenade', 'cluster'].includes(fireWeapon) && fireAge < 0.55;
    const hurtAge = (now - this.hurtAt) / 1000;
    const hurt = hurtAge < 0.45 ? 1 - hurtAge / 0.45 : 0;
    const moving = this.moveBlend * motion;
    const airborne = !grounded && !worm.rope && !worm.jetpack;
    const rising = (worm.vy || 0) < -25;
    // Pose follows authoritative motion, with a short visual settle when a
    // support is attached/released. World position is never predicted here.
    const poseBlend = 1 - Math.exp(-dt * 10);
    this.ropeBlend += ((worm.rope ? 1 : 0) - this.ropeBlend) * poseBlend;
    this.flightBlend += ((worm.jetpack ? 1 : 0) - this.flightBlend) * poseBlend;
    this.fallBlend += ((airborne ? 1 : 0) - this.fallBlend) * poseBlend;
    this.ropeTension +=
      (clamp(worm.rope?.tension ?? (worm.rope ? 1 : 0), 0, 1) - this.ropeTension) * poseBlend;
    const thrustX = clamp(worm.thrustX || 0, -1, 1),
      thrustY = clamp(worm.thrustY || 0, -1, 1);
    let desiredTilt = grounded ? 0 : clamp((worm.vx || 0) / 900, -0.15, 0.15);
    if (worm.rope) {
      const supportAngle = Math.atan2(worm.rope.x - position.x, position.y - worm.rope.y);
      desiredTilt =
        clamp(supportAngle, -0.7, 0.7) * 0.65 * this.ropeTension + clamp((worm.vx || 0) / 1300, -0.12, 0.12);
    } else if (worm.jetpack) desiredTilt = clamp((worm.vx || 0) / 640 + thrustX * 0.11, -0.42, 0.42);
    this.travelTilt += (desiredTilt - this.travelTilt) * (1 - Math.exp(-dt * 8));
    const powered = !!worm.jetpack && worm.fuel > 0 && !grounded;
    const throttle = powered
      ? clamp(
          0.38 + Math.max(0, -thrustY) * 0.52 + Math.abs(thrustX) * 0.2 - Math.max(0, thrustY) * 0.2,
          0.18,
          1.1,
        )
      : 0;
    this.thrustLevel += (throttle - this.thrustLevel) * (1 - Math.exp(-dt * 14));
    const requestedFacing = (facingOverride ?? worm.facing) === -1 ? -1 : 1;
    const changedFacing = requestedFacing !== this.requestedFacing;
    if (changedFacing) {
      this.turnFrom = this.visualFacing;
      this.turnAt = now;
      this.requestedFacing = requestedFacing;
      for (const node of [this.weaponRig, this.throwRig])
        this.attachmentStarts.set(node, { x: node.x, y: node.y });
    }
    const turnProgress = reducedMotion ? 1 : clamp((now - this.turnAt) / TURN_MS, 0, 1);
    const turnFold = Math.sin(turnProgress * Math.PI);
    // The torso pivots in a compact pose; its width never collapses to zero.
    this.visualFacing = turnProgress < 0.4 ? this.turnFrom : requestedFacing;
    const facing = this.visualFacing;
    const actionDuration = ['airstrike', 'teleport', 'girder', 'bat'].includes(fireWeapon)
      ? 0.9
      : fireWeapon === 'shotgun'
        ? 0.65
        : 0.55;
    const performing = fireAge >= 0 && fireAge < actionDuration;
    const aiming = active || performing;
    if (active && Number.isFinite(angle)) this.lastAim = angle;
    if (local || !this.aimReady || changedFacing || reducedMotion) this.displayAim = this.lastAim;
    else this.displayAim += angleDelta(this.displayAim, this.lastAim) * (1 - Math.exp(-dt * 20));
    this.aimReady = true;
    // Choose the upright artwork from the aim hemisphere, even if an older
    // snapshot has the body facing the other way for a few milliseconds.
    const weaponFacing =
      Math.abs(Math.cos(this.displayAim)) < 0.0001 ? requestedFacing : Math.cos(this.displayAim) < 0 ? -1 : 1;
    const aim = Math.atan2(Math.sin(this.displayAim), Math.cos(this.displayAim) * weaponFacing);
    const faceAim = Math.atan2(Math.sin(this.displayAim), Math.cos(this.displayAim) * facing);
    // Selecting an attack while a mobility tool is active takes effect at
    // once, including during the brief ignition or grappling animation.
    const changingTool =
      active && weapon !== fireWeapon && (fireWeapon === 'rope' || fireWeapon === 'jetpack');
    const selected = performing && !changingTool ? fireWeapon : weapon;
    const attachmentFacing =
      selected === 'rope' && worm.rope && Math.abs(worm.rope.x - position.x) > 0.001
        ? worm.rope.x < position.x
          ? -1
          : 1
        : weaponFacing;
    const charge = active ? clamp(power, 0, 1) : 0;
    const isThrow = selected === 'grenade' || selected === 'cluster';
    const jumpAge = (now - this.jumpAt) / 1000;
    const jumping = airborne && jumpAge >= 0 && jumpAge < 0.85;
    const jumpLaunch = jumping ? Math.exp(-jumpAge * 10) : 0;
    const backTuck = jumping && this.jumpBack ? Math.sin(clamp(jumpAge / 0.8, 0, 1) * Math.PI) : 0;
    this.rig.scale.set(
      facing * (1 + bob * 0.1 * moving + landing * 0.25 * motion - this.fallBlend * 0.05 * motion),
      1 +
        breathe -
        bob * 0.075 * moving -
        landing * 0.22 * motion +
        this.fallBlend * 0.07 * motion +
        this.ropeBlend * this.ropeTension * 0.025 * motion,
    );
    this.rig.y = 9 - bob * 1.4 * moving + recoil * 0.7 * motion;
    this.rig.x = -recoil * 3.5 * facing * motion;
    this.rig.rotation = step * 0.065 * moving + this.travelTilt * motion - facing * recoil * 0.1 * motion;
    this.rig.scale.x *= 1 - turnFold * 0.18 + backTuck * 0.09 * motion;
    this.rig.scale.y *= 1 - turnFold * 0.055 - jumpLaunch * 0.16 * motion - backTuck * 0.09 * motion;
    this.rig.y += turnFold * 0.8;
    this.rig.rotation += requestedFacing * turnFold * 0.045 - this.jumpFacing * backTuck * 0.32 * motion;
    this.tail.scale.x = 1 + step * 0.13 * moving;
    this.tail.rotation = step * 0.06 * moving - facing * this.travelTilt * this.flightBlend * 0.35 * motion;
    this.shadow.visible = grounded;
    this.shadow.scale.set(1 + landing * 0.25, 1 - landing * 0.1);
    this.head.rotation =
      -step * 0.045 * moving -
      (!rising ? this.fallBlend * 0.1 : 0) * motion -
      recoil * 0.12 * motion +
      hurt * 0.12 * motion;
    this.head.rotation -= facing * this.travelTilt * (this.ropeBlend + this.flightBlend) * 0.35 * motion;
    this.head.y = -14 - bob * 0.6 * moving - charge * 0.7 * motion;
    this.head.rotation += turnFold * 0.12 + backTuck * 0.18 * motion;
    this.head.x = 1 + turnFold * 1.1;
    this.bandTails.rotation =
      (step * 0.13 * moving + Math.sin(now / 290 + this.seed) * 0.035) * motion -
      clamp(Math.abs(worm.vx || 0) / 420, 0, 0.3) * motion;
    this.bandTails.scale.x = 1 + moving * 0.12;
    this.pupils.position.set(aiming ? Math.cos(faceAim) * 0.5 : 0.2, aiming ? Math.sin(faceAim) * 1.4 : 0.25);
    const blinkPhase = (now + this.seed * 1300) % 4300;
    const blink = blinkPhase < 115;
    this.eyes.visible = !(blink || hurt > 0.35);
    this.closedEyes.visible = blink || hurt > 0.35;
    this.brows.rotation = aiming && charge > 0.05 ? 0.07 : 0;
    this.brows.y = charge * 0.8;
    this.hurtMouth.visible = hurt > 0.1 || (airborne && (worm.vy || 0) > 190);
    this.mouth.visible = !this.hurtMouth.visible;
    this.mouth.scale.y = 1;
    const armWeight = Math.max(1, this.ropeBlend + this.flightBlend);
    const ropeWeight = this.ropeBlend / armWeight,
      flightWeight = this.flightBlend / armWeight;
    const freeWeight = Math.max(0, 1 - ropeWeight - flightWeight);
    this.frontArm.rotation =
      ((rising ? -0.8 : -1.1) * this.fallBlend + step * 0.45 * moving) * freeWeight * motion -
      (2.15 * ropeWeight + (0.55 + Math.abs(thrustX) * 0.2) * flightWeight) * motion;
    this.backArm.rotation =
      ((rising ? 0.6 : 0.9) * this.fallBlend - step * 0.5 * moving) * freeWeight * motion +
      (1.65 * ropeWeight + 0.55 * flightWeight) * motion;
    this.frontArm.rotation -= backTuck * 0.5 * motion;
    this.backArm.rotation += backTuck * 0.4 * motion;
    const previewPack = aiming && selected === 'jetpack';
    this.pack.visible = this.flightBlend > 0.02 || previewPack;
    this.pack.alpha = worm.jetpack || previewPack ? 1 : this.flightBlend;
    this.pack.parts.fuel.scale.y = clamp((worm.fuel ?? 6) / 6, 0, 1);
    this.pack.parts.light.alpha = worm.jetpack ? 0.7 + Math.sin(now / 170) * 0.25 * motion : 0.65;
    this.flame.visible = powered && this.thrustLevel > 0.02;
    this.flame.scale.y =
      0.18 + this.thrustLevel * 0.85 + (reducedMotion ? 0 : Math.sin(now / 65) * 0.035 * this.thrustLevel);
    this.flame.scale.x = 0.75 + this.thrustLevel * 0.25;
    this.flame.alpha = powered ? 0.7 + Math.min(1, this.thrustLevel) * 0.3 : 0;
    this.weaponRig.visible = aiming && !isThrow && selected !== 'jetpack';
    this.throwRig.visible = aiming && isThrow;
    this.frontArm.visible = !this.weaponRig.visible && !this.throwRig.visible;
    this.backArm.visible = !this.weaponRig.visible;
    if (this.weaponRig.visible) {
      if (!this.weapons.has(selected)) {
        const tool = createToolArt(selected);
        this.weaponRig.addChildAt(tool, 0);
        this.weapons.set(selected, tool);
      }
      for (const [id, tool] of this.weapons) {
        tool.visible = id === selected;
        tool.alpha = 1;
      }
      const tool = this.weapons.get(selected);
      const acting = performing && selected === fireWeapon;
      this.weaponRig.rotation = aim - recoil * 0.07 * motion;
      this.weaponRig.x = 3 - recoil * 3 * motion;
      this.weaponRig.y = -6 + charge * 0.45 * motion;
      this.holdHands.visible = true;
      this.supportHand.visible = this.gripHand.visible = true;
      this.supportHand.position.set(8, 5);
      this.gripHand.position.set(-2, 7);
      if (selected === 'shotgun') {
        const reload =
          acting && fireAge > 0.11 && fireAge < 0.48 ? Math.sin(((fireAge - 0.11) / 0.37) * Math.PI) : 0;
        tool.parts.pump.x = -reload * 4.7;
        tool.parts.chamber.alpha = 1 - reload * 0.85;
        this.supportHand.x = 12 - reload * 4.7;
        this.weaponRig.y += reload * 1.1 * motion;
        this.weaponRig.rotation += reload * 0.1 * motion;
      } else if (selected === 'dynamite' || selected === 'mine') {
        const lower = acting ? Math.sin(clamp(fireAge / 0.5, 0, 1) * Math.PI) : 0;
        this.weaponRig.rotation = -0.1 + lower * 0.6 * motion;
        this.weaponRig.position.set(10 + lower * 3 * motion, -1 + lower * 7 * motion);
        this.rig.scale.y *= 1 - lower * 0.18 * motion;
        this.head.rotation += lower * 0.16 * motion;
        this.supportHand.position.set(-2, 5);
        this.gripHand.visible = false;
        tool.visible = !acting;
        if (tool.parts.ember) tool.parts.ember.visible = false;
        if (tool.parts.light) tool.parts.light.alpha = 0.75;
      } else if (selected === 'bat') {
        const swing = acting ? Math.sin(clamp(fireAge / 0.7, 0, 1) * Math.PI) : 0;
        this.weaponRig.rotation = aim - 0.9 + swing * 2 * motion;
        this.weaponRig.position.set(-5 + swing * 12 * motion, -5);
        this.rig.rotation += facing * swing * 0.17 * motion;
        this.head.rotation -= swing * 0.12 * motion;
        this.supportHand.position.set(-2, 4);
        this.gripHand.position.set(-6, 5);
      } else if (selected === 'airstrike') {
        const call = acting ? Math.sin(clamp(fireAge / 0.9, 0, 1) * Math.PI) : 0;
        this.weaponRig.rotation = -0.14 - call * 0.13 * motion;
        this.weaponRig.position.set(11, -5 - call * 6 * motion);
        this.supportHand.position.set(1, 7);
        this.gripHand.visible = false;
        tool.parts.signal.visible = acting;
        tool.parts.signal.alpha = reducedMotion ? 0.75 : 0.45 + Math.sin(now / 70) * 0.3;
        tool.parts.light.alpha = acting ? 1 : 0.7;
        this.mouth.scale.y = acting ? 0.65 : 1;
      } else if (selected === 'rope') {
        tool.parts.hook.visible = !worm.rope;
        tool.parts.spool.rotation +=
          (worm.rope ? (worm.rope.reelVelocity || 0) / 7 : acting ? 12 : 0) * dt * motion;
        this.supportHand.position.set(-4, 4);
        this.gripHand.position.set(1, 8);
        if (acting) this.weaponRig.x -= Math.exp(-fireAge * 9) * 2.5 * motion;
        if (worm.rope) {
          const ropeAim = Math.atan2(worm.rope.y - position.y, (worm.rope.x - position.x) * attachmentFacing);
          this.weaponRig.rotation = ropeAim;
          this.weaponRig.position.set(2, -7);
        }
      } else if (selected === 'teleport') {
        this.weaponRig.rotation = -0.2;
        this.weaponRig.position.set(11, -5);
        this.supportHand.position.set(-2, 7);
        this.gripHand.visible = false;
        tool.parts.coil.rotation = reducedMotion ? 0 : now / (acting ? 95 : 950);
        tool.parts.light.alpha = acting ? 0.9 : 0.45;
        tool.parts.light.scale.set(
          acting ? 1 + Math.sin(clamp(fireAge / 0.8, 0, 1) * Math.PI) * 0.8 * motion : 1,
        );
        this.head.rotation -= acting ? 0.1 * motion : 0;
      } else if (selected === 'girder') {
        const tighten = acting ? Math.sin(fireAge * 24) * Math.max(0, 1 - fireAge / 0.9) : 0;
        this.weaponRig.rotation = 0.12 + tighten * 0.35 * motion;
        this.weaponRig.position.set(11, -2);
        this.supportHand.position.set(-2, 4);
        this.gripHand.visible = false;
        tool.parts.plan.visible = !acting;
        this.rig.scale.y *= 1 - (acting ? 0.05 : 0) * motion;
      }
    }
    if (this.throwRig.visible) {
      // The charge visibly winds the arm back; the authoritative fire starts the follow-through.
      const swing = throwShot
        ? Math.sin((Math.min(1, fireAge / 0.24) * Math.PI) / 2) *
          1.15 *
          Math.max(0, 1 - Math.max(0, fireAge - 0.22) / 0.33)
        : -charge * 0.65;
      this.throwRig.rotation = swing * motion + Math.sin(aim) * 0.12;
      this.throwRig.position.set(4, -7);
      this.heldGrenade.visible = !throwShot && selected === 'grenade';
      this.heldCluster.visible = !throwShot && selected === 'cluster';
      this.backArm.rotation = -0.35 - charge * 0.3;
    }
    if (worm.rope) {
      this.frontArm.visible = !this.weaponRig.visible;
      this.backArm.visible = !this.weaponRig.visible;
    }
    const deathAge = (now - this.deathAt) / 1000;
    if (worm.hp <= 0 && deathAge < 0.65) {
      this.alpha = Math.max(0, 1 - deathAge / 0.65);
      this.rig.rotation += facing * deathAge * 1.3 * motion;
      this.weaponRig.visible = this.throwRig.visible = false;
    } else this.alpha = worm.hp <= 0 ? 0 : 1;
    if (this.weaponRig.visible) this.attachToBody(this.weaponRig, attachmentFacing, turnProgress);
    if (this.throwRig.visible) this.attachToBody(this.throwRig, weaponFacing, turnProgress);
    this.bodyPoint(0, -4, this.ropeSocket);
    if (worm.rope && selected === 'rope' && this.weaponRig.visible) {
      this.ropeSocket.x =
        this.x + this.weaponRig.x + Math.cos(this.weaponRig.rotation) * 14 * this.weaponRig.scale.x;
      this.ropeSocket.y =
        this.y + this.weaponRig.y + Math.sin(this.weaponRig.rotation) * 14 * this.weaponRig.scale.x;
    }
    this.bodyPoint(-10.5, 5, this.jetExhaust);
    this.jetExhaust.dx = -Math.sin(this.rig.rotation);
    this.jetExhaust.dy = Math.cos(this.rig.rotation);
    this.jetExhaust.power = powered ? this.thrustLevel : 0;
  }

  bodyPoint(x, y, out) {
    const localX = (x - this.rig.pivot.x) * this.rig.scale.x;
    const localY = (y - this.rig.pivot.y) * this.rig.scale.y;
    const cosine = Math.cos(this.rig.rotation),
      sine = Math.sin(this.rig.rotation);
    out.x = this.x + this.rig.x + cosine * localX - sine * localY;
    out.y = this.y + this.rig.y + sine * localX + cosine * localY;
    return out;
  }

  attachToBody(node, facing, turnProgress) {
    // Apply only the anchor translation from the body. Reconstruct the tool's
    // orthogonal transform so walking, landing and turning cannot shear it.
    const x = (node.x - this.rig.pivot.x) * this.rig.scale.x;
    const y = (node.y - this.rig.pivot.y) * this.rig.scale.y;
    const cosine = Math.cos(this.rig.rotation),
      sine = Math.sin(this.rig.rotation);
    let anchorX = this.rig.x + cosine * x - sine * y;
    let anchorY = this.rig.y + sine * x + cosine * y;
    const start = this.attachmentStarts.get(node);
    if (start && turnProgress < 1) {
      const blend = smoothstep(turnProgress);
      anchorX = start.x + (anchorX - start.x) * blend;
      anchorY = start.y + (anchorY - start.y) * blend;
    }
    node.position.set(anchorX, anchorY);
    node.scale.set(facing, 1);
    node.rotation *= facing;
  }
}
