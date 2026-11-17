import { CONFIG, WEAPONS, MAPS } from './config.js';
import { applyJump } from './physics.js';
import { aimFacing, aimForFacing, normalizeAngle } from './aim.js';
const W = Object.fromEntries(WEAPONS.map((weapon) => [weapon.id, weapon]));
const R = CONFIG.wormRadius;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function action(game, playerId, action) {
  const fail = (error) => ({ ok: false, error });
  if (game.phase !== 'playing') return fail('La partida ha terminado.');
  if (game.turn.playerId !== playerId) return fail('Espera tu turno.');
  const worm = game._active();
  if (!worm) return fail('Tu gusano ya no puede actuar.');
  if (!action || typeof action !== 'object' || Array.isArray(action)) return fail('Acción inválida.');
  if (action.type === 'release') {
    game._release(worm);
    game._input = {};
    return { ok: true };
  }
  if (game.turn.stage === 'settling') return fail('Espera a que termine la acción.');
  if (action.type === 'input') {
    for (const key of ['move', 'thrustX', 'thrustY', 'reel'])
      if (action[key] !== undefined && (!Number.isFinite(action[key]) || Math.abs(action[key]) > 1))
        return fail('Control inválido.');
    if (action.aim !== undefined && (!Number.isFinite(action.aim) || Math.abs(action.aim) > Math.PI * 4))
      return fail('Ángulo inválido.');
    if (
      action.weapon !== undefined &&
      (typeof action.weapon !== 'string' || !Object.hasOwn(W, action.weapon))
    )
      return fail('Arma desconocida.');
    game._input = {
      move: action.move || 0,
      thrustX: action.thrustX ?? action.move ?? 0,
      thrustY: action.thrustY || 0,
      reel: action.reel || 0,
    };
    // Resolve orientation with the command, before a following jump can use
    // it. Physics ticks move the worm but must not compete with game decision.
    const aim = Number.isFinite(action.aim) ? normalizeAngle(action.aim) : worm.aim;
    if (game._input.move) {
      worm.facing = Math.sign(game._input.move);
      worm.aim = aimForFacing(aim, worm.facing);
    } else if (Number.isFinite(action.aim)) {
      worm.facing = aimFacing(aim, worm.facing);
      worm.aim = aimForFacing(aim, worm.facing);
    }
    if (action.weapon !== undefined) worm.heldWeapon = action.weapon;
    game._inputAt = game.elapsed;
    return { ok: true };
  }
  if (action.type === 'jump') {
    if (!worm.grounded && !worm.rope) return fail('Necesitas suelo para saltar.');
    game._release(worm);
    applyJump(worm, !!action.back);
    game._event('jump', {
      x: worm.x,
      y: worm.y,
      wormId: worm.id,
      back: !!action.back,
      facing: worm.facing,
      vx: worm.vx,
      vy: worm.vy,
    });
    return { ok: true };
  }
  if (action.type === 'end') {
    game._settle();
    return { ok: true };
  }
  if (action.type !== 'fire') return fail('Acción desconocida.');
  if (game.turn.stage !== 'action') return fail('Ya usaste tu ataque; aprovecha para retirarte.');
  if (typeof action.weapon !== 'string' || !Object.hasOwn(W, action.weapon)) return fail('Arma desconocida.');
  const weapon = W[action.weapon];
  if (game.turn.shots && !(weapon.id === 'shotgun' && game.turn.weapon === 'shotgun' && game.turn.shots < 2))
    return fail('Queda el segundo disparo de escopeta.');
  if (game.elapsed - game._lastShotAt < (weapon.id === 'shotgun' ? weapon.cooldown : 0.15))
    return fail('Espera un instante.');
  if (
    !Number.isFinite(action.angle) ||
    Math.abs(action.angle) > Math.PI * 4 ||
    !Number.isFinite(action.power) ||
    action.power < 0 ||
    action.power > 1
  )
    return fail('Ángulo o potencia inválidos.');
  const player = game.players.find((p) => p.id === playerId);
  if (player.ammo[weapon.id] === 0) return fail('No queda munición.');
  if (
    weapon.target &&
    (![action.x, action.y].every(Number.isFinite) ||
      action.x < 0 ||
      action.x > CONFIG.worldWidth ||
      action.y < 0 ||
      action.y >= game.waterY - R)
  )
    return fail('Selecciona un punto válido por encima del agua.');
  const dx = Math.cos(action.angle),
    dy = Math.sin(action.angle);
  const origin = { x: worm.x + dx * (R + 4), y: worm.y + dy * (R + 4) };
  let consume = true;
  if (weapon.id === 'rope') {
    const anchor = game._ray(worm.x, worm.y, dx, dy, CONFIG.ropeRange, false, worm.id);
    if (!anchor.terrain || anchor.distance < CONFIG.ropeMinLength)
      return fail('Apunta a terreno entre 34 y 440 pasos.');
    worm.jetpack = false;
    worm.thrustX = 0;
    worm.thrustY = 0;
    worm.rope = { x: anchor.x, y: anchor.y, length: anchor.distance, reelVelocity: 0, tension: 0 };
    game._event('rope', {
      x: anchor.x,
      y: anchor.y,
      fromX: worm.x,
      fromY: worm.y,
      wormId: worm.id,
      weapon: weapon.id,
      angle: action.angle,
    });
  } else if (weapon.id === 'jetpack') {
    if (worm.jetpack) {
      worm.jetpack = false;
      worm.thrustX = 0;
      worm.thrustY = 0;
      consume = false;
    } else {
      worm.rope = null;
      worm.jetpack = true;
      worm.fuel = CONFIG.jetpackFuel;
      game._event('jetpack', { x: worm.x, y: worm.y, wormId: worm.id, weapon: weapon.id });
    }
  } else if (weapon.id === 'teleport') {
    const dest = game._teleportDestination(action.x, action.y, worm);
    if (!dest) return fail('El destino debe estar libre, cerca del suelo y a menos de 740 pasos.');
    game._event('teleport', { x: worm.x, y: worm.y, wormId: worm.id, weapon: weapon.id, phase: 'depart' });
    worm.x = dest.x;
    worm.y = dest.y;
    worm.vx = 0;
    worm.vy = 0;
    worm.grounded = true;
    game._event('teleport', { x: worm.x, y: worm.y, wormId: worm.id, weapon: weapon.id, phase: 'arrive' });
    game._attackUsed(weapon.id, worm);
  } else if (weapon.id === 'girder') {
    if (!game._validGirder(action.x, action.y, worm))
      return fail('La viga necesita espacio libre a menos de 280 pasos, sin gusanos ni objetos.');
    game.terrain.girder(action.x, action.y);
    game.girders.push({ x: action.x, y: action.y, width: CONFIG.girderWidth, height: CONFIG.girderHeight });
    game._event('girder', {
      x: action.x,
      y: action.y,
      wormId: worm.id,
      weapon: weapon.id,
      width: CONFIG.girderWidth,
      height: CONFIG.girderHeight,
    });
    game._attackUsed(weapon.id, worm);
  } else if (weapon.id === 'shotgun') {
    const hit = game._ray(worm.x, worm.y, dx, dy, weapon.range, true, worm.id);
    const attack = game._beginAttack(player, weapon, worm);
    if (hit.worm) {
      game._damage(hit.worm, weapon.damage, attack);
      hit.worm.vx += dx * 95;
      hit.worm.vy += dy * 95 - 35;
      hit.worm.grounded = false;
    }
    if (hit.terrain) game.terrain.circle(hit.x, hit.y, weapon.radius);
    game._event('shot', {
      x: worm.x,
      y: worm.y,
      endX: hit.x,
      endY: hit.y,
      weapon: weapon.id,
      wormId: worm.id,
      angle: action.angle,
      hit: hit.worm ? 'worm' : hit.terrain ? 'terrain' : 'miss',
    });
    game._attackUsed(weapon.id, worm);
  } else if (weapon.id === 'bat') {
    const targets = game.worms.filter(
      (target) =>
        target.hp > 0 &&
        target.id !== worm.id &&
        distance(worm, target) < weapon.range &&
        (target.x - worm.x) * dx + (target.y - worm.y) * dy > -5,
    );
    const hits = [];
    const attack = game._beginAttack(player, weapon, worm);
    for (const target of targets) {
      const obstruction = game._ray(
        worm.x,
        worm.y,
        (target.x - worm.x) / distance(worm, target),
        (target.y - worm.y) / distance(worm, target),
        Math.max(0, distance(worm, target) - R),
        false,
        worm.id,
      );
      if (obstruction.terrain) continue;
      hits.push({ x: target.x, y: target.y });
      game._damage(target, weapon.damage, attack);
      target.vx += dx * weapon.force;
      target.vy += Math.min(-110, dy * weapon.force - 90);
      target.grounded = false;
    }
    game._event('bat', {
      x: worm.x + dx * 25,
      y: worm.y + dy * 25,
      originX: worm.x,
      originY: worm.y,
      weapon: weapon.id,
      wormId: worm.id,
      angle: action.angle,
      hits,
    });
    game._attackUsed(weapon.id, worm);
  } else if (weapon.id === 'mine') {
    game.mines.push({
      id: `m${++game._id}`,
      kind: 'mine',
      x: worm.x + worm.facing * 16,
      y: worm.y - 2,
      vx: worm.facing * 28,
      vy: -30,
      armed: false,
      armIn: CONFIG.mineArmSeconds,
      attack: game._beginAttack(player, weapon, worm),
    });
    game._attackUsed(weapon.id, worm);
  } else if (weapon.id === 'airstrike') {
    if (!MAPS.find((map) => map.id === game.mapId).airstrike)
      return fail('El techo de la gruta impide los ataques aéreos.');
    const attack = game._beginAttack(player, weapon, worm);
    for (let i = 0; i < weapon.bombs; i++) {
      game.projectiles.push({
        id: `p${++game._id}`,
        kind: 'airstrike',
        x: clamp(action.x + (i - 2) * weapon.spread, 12, CONFIG.worldWidth - 12),
        y: -40 - i * 34,
        vx: 12,
        vy: 160,
        radius: weapon.radius,
        damage: weapon.damage,
        age: 0,
        attack,
      });
    }
    game._attackUsed(weapon.id, worm);
  } else {
    const placed = weapon.id === 'dynamite';
    const power = 0.18 + action.power * 0.82;
    game.projectiles.push({
      id: `p${++game._id}`,
      kind: weapon.id,
      x: placed ? worm.x + worm.facing * 14 : origin.x,
      y: placed ? worm.y - 3 : origin.y,
      vx: placed ? worm.facing * 17 : dx * weapon.speed * power,
      vy: placed ? -22 : dy * weapon.speed * power,
      ...(weapon.fuse ? { fuse: weapon.fuse } : {}),
      radius: weapon.radius,
      damage: weapon.damage,
      bounce: weapon.bounce || 0,
      wind: weapon.wind || 0,
      age: 0,
      ownerWorm: worm.id,
      attack: game._beginAttack(player, weapon, worm),
    });
    game._attackUsed(weapon.id, worm);
  }
  if (consume && player.ammo[weapon.id] > 0) player.ammo[weapon.id]--;
  game._lastShotAt = game.elapsed;
  if (Math.abs(dx) > 0.05) worm.facing = dx < 0 ? -1 : 1;
  worm.aim = action.angle;
  worm.heldWeapon = weapon.id;
  game._event('fire', {
    x: worm.x,
    y: worm.y,
    weapon: weapon.id,
    wormId: worm.id,
    angle: action.angle,
    power: action.power,
    ...(weapon.target ? { targetX: action.x, targetY: action.y } : {}),
    ...(weapon.id === 'jetpack' ? { enabled: worm.jetpack } : {}),
  });
  return { ok: true };
}
