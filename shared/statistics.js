export const emptyStats = () => ({
  shots: 0,
  damageDealt: 0,
  friendlyDamage: 0,
  damageTaken: 0,
  kills: 0,
  teamKills: 0,
  bestShot: { damage: 0, weapon: null },
  longestShot: 0,
});
export function _beginAttack(game, player, weapon, worm) {
  game.stats[player.id].shots++;
  return {
    id: ++game._attackSeq,
    playerId: player.id,
    team: player.team,
    weapon: weapon.id,
    origin: { x: worm.x, y: worm.y },
    damage: 0,
    impactDistance: null,
  };
}

export function _recordDamage(game, worm, damage, attack) {
  const victim = game.stats[worm.playerId];
  if (victim) victim.damageTaken += damage;
  const dealer = attack && game.stats[attack.playerId];
  if (!dealer) return;
  // A later drowning or lethal fall in the same turn still belongs to game attacker.
  worm._lastAttack = attack;
  if (attack.team === worm.team) {
    dealer.friendlyDamage += damage;
    return;
  }
  dealer.damageDealt += damage;
  attack.damage += damage;
  if (attack.damage > dealer.bestShot.damage)
    dealer.bestShot = { damage: attack.damage, weapon: attack.weapon };
  if (attack.impactDistance !== null && attack.impactDistance > dealer.longestShot)
    dealer.longestShot = attack.impactDistance;
}

export function _recordKill(game, worm, attack) {
  const dealer = attack && game.stats[attack.playerId];
  if (!dealer) return;
  if (attack.team === worm.team) dealer.teamKills++;
  else dealer.kills++;
}

export function _mvp(game) {
  const ranked = [...game.players].sort(
    (a, b) =>
      game.stats[b.id].damageDealt - game.stats[a.id].damageDealt ||
      game.stats[b.id].kills - game.stats[a.id].kills,
  );
  const best = game.stats[ranked[0].id];
  return best.damageDealt > 0 || best.kills > 0 ? ranked[0].id : null;
}

export function _statsSnapshot(game) {
  return game.players.map((player) => {
    const stats = game.stats[player.id];
    return { playerId: player.id, ...stats, bestShot: { ...stats.bestShot } };
  });
}
