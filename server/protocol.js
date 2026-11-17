import { CONFIG, MAPS, MODES, WEAPONS, TURN_DURATIONS } from '../shared/config.js';
import { WebSocket } from 'ws';

export const HANDSHAKES = new Set(['create', 'join', 'resume']);
export const COMMANDS = new Set([
  'settings',
  'team',
  'ready',
  'start',
  'loaded',
  'action',
  'rematch',
  'rematch-request',
  'lobby',
  'leave',
]);
const mapIds = new Set(MAPS.map((map) => map.id));
const modeIds = new Set(MODES.map((mode) => mode.id));
const weaponIds = new Set(WEAPONS.map((weapon) => weapon.id));
const settingKeys = new Set(['mapId', 'mode', 'worms', 'turnSeconds']);

/** Apply only supplied fields so concurrent controls cannot restore stale settings. */
export function mergeSettings(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((key) => !settingKeys.has(key))) return null;
  const next = { ...current, ...patch };
  return validSettings(next) ? next : null;
}

export function teamCount(mode) {
  return MODES.find((entry) => entry.id === mode)?.teams || 3;
}

/** Preserve valid alliances and move obsolete ones into the least populated team. */
export function normalizeTeams(players, mode) {
  const count = teamCount(mode);
  const sizes = Array(count).fill(0);
  for (const player of players)
    if (Number.isInteger(player.team) && player.team >= 0 && player.team < count) sizes[player.team]++;
  for (const player of players) {
    if (Number.isInteger(player.team) && player.team >= 0 && player.team < count) continue;
    player.team = sizes.indexOf(Math.min(...sizes));
    sizes[player.team]++;
  }
}

export function nameFrom(value) {
  if (typeof value !== 'string') return null;
  const name = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 24);
  return name || null;
}
export function validSettings(settings) {
  return (
    settings &&
    typeof settings === 'object' &&
    !Array.isArray(settings) &&
    mapIds.has(settings.mapId) &&
    modeIds.has(settings.mode) &&
    [2, 3, 4].includes(settings.worms) &&
    (!Object.hasOwn(settings, 'turnSeconds') || TURN_DURATIONS.includes(settings.turnSeconds))
  );
}
export function validateComposition(room) {
  const count = room.players.length;
  if (count < 2 || count > 6) return 'Se necesitan de 2 a 6 participantes.';
  if (room.players.some((player) => player.ws?.readyState !== WebSocket.OPEN))
    return 'Todos los participantes deben estar conectados.';
  if (room.players.some((player) => !player.ready)) return 'Todos deben marcarse como listos.';
  const mode = room.settings.mode;
  if (mode === 'ffa') return null;
  const required = mode === '2v2' ? [2, 2] : mode === '3v3' ? [3, 3] : [2, 2, 2];
  const actual = [0, 0, 0];
  for (const player of room.players) actual[player.team] += 1;
  if (
    count !== required.reduce((sum, number) => sum + number, 0) ||
    actual.some((size, i) => size !== (required[i] || 0))
  ) {
    return mode === '2v2v2'
      ? 'Forma tres equipos de dos participantes.'
      : `Forma dos equipos de ${mode === '2v2' ? 'dos' : 'tres'} participantes.`;
  }
  return null;
}
export function validAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return false;
  const axis = (value) => value === undefined || (Number.isFinite(value) && Math.abs(value) <= 1);
  const angle = (value) => value === undefined || (Number.isFinite(value) && Math.abs(value) <= Math.PI * 8);
  if (action.type === 'input')
    return (
      axis(action.move) &&
      axis(action.thrustX) &&
      axis(action.thrustY) &&
      axis(action.reel) &&
      angle(action.aim) &&
      (action.weapon === undefined || weaponIds.has(action.weapon))
    );
  if (action.type === 'jump') return action.back === undefined || typeof action.back === 'boolean';
  if (action.type === 'release' || action.type === 'end') return true;
  if (action.type !== 'fire' || !weaponIds.has(action.weapon) || !angle(action.angle)) return false;
  if (action.power !== undefined && (!Number.isFinite(action.power) || action.power < 0 || action.power > 1))
    return false;
  return ['x', 'y'].every(
    (key) =>
      action[key] === undefined ||
      (Number.isFinite(action[key]) &&
        action[key] >= 0 &&
        action[key] <= (key === 'x' ? CONFIG.worldWidth : CONFIG.worldHeight)),
  );
}
