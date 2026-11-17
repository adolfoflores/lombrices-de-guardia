import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { Game } from '../shared/engine.js';
import { CONFIG } from '../shared/config.js';
import {
  HANDSHAKES,
  COMMANDS,
  nameFrom,
  mergeSettings,
  teamCount,
  normalizeTeams,
  validateComposition,
  validAction,
} from './protocol.js';
import { send, remember, publicRoom } from './messages.js';
import { CommandJournal } from './command-journal.js';
import { TokenBucket, serverLimits } from './limits.js';

const COLORS = ['#f8b84e', '#68d7c4', '#ff839b', '#a5a0ff', '#a8d66d', '#79bdf2'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Room lifecycle and game authority, independent of HTTP and timers. */
export function createRoomService({
  disconnectMs = 120_000,
  emptyRoomMs = 300_000,
  loadingMs = 20_000,
  limits: overrides,
  now = Date.now,
} = {}) {
  const limits = serverLimits(overrides);
  const rooms = new Map();
  const peers = new Set();
  let closing = false;
  const updatePresence = (room, at = now()) => {
    if (!room.players.length) {
      rooms.delete(room.code);
      return;
    }
    const connected = room.players.some((player) => player.ws?.readyState === WebSocket.OPEN);
    room.emptySince = connected ? null : (room.emptySince ?? at);
  };
  const broadcastRoom = (room) => {
    const payload = { type: 'room', room: publicRoom(room) };
    for (const player of room.players) send(player.ws, payload);
  };
  const broadcastState = (room, force = false) => {
    if (!room.game) return;
    let full;
    let partial;
    for (const player of room.players) {
      const ws = player.ws;
      if (ws?.readyState !== WebSocket.OPEN) continue;
      const includeTerrain = force || ws.terrainRevision !== room.game.terrain.revision;
      const state = includeTerrain
        ? (full ||= room.game.snapshot(true))
        : (partial ||= room.game.snapshot(false));
      send(ws, { type: 'state', state });
      ws.terrainRevision = room.game.terrain.revision;
    }
  };
  const transferHost = (room) => {
    if (room.players.find((player) => player.id === room.hostId)?.ws?.readyState === WebSocket.OPEN) return;
    room.hostId =
      (room.players.find((player) => player.ws?.readyState === WebSocket.OPEN) || room.players[0])?.id ||
      null;
  };
  const returnToLobby = (room) => {
    room.phase = 'lobby';
    room.game = null;
    room.loadingAt = null;
    room.rematchRequests.clear();
    for (const player of room.players) {
      player.ready = false;
      player.loaded = false;
    }
    broadcastRoom(room);
  };
  const maybeStart = (room) => {
    if (
      room.phase !== 'loading' ||
      room.players.some((player) => !player.loaded || player.ws?.readyState !== WebSocket.OPEN)
    )
      return;
    room.game = new Game(
      room.players.map(({ id, name, team, color }) => ({ id, name, team, color })),
      room.settings,
    );
    room.phase = 'playing';
    room.loadingAt = null;
    broadcastRoom(room);
    broadcastState(room, true);
  };
  const markFinished = (room) => {
    if (room.phase === 'playing' && room.game?.phase === 'finished') {
      room.phase = 'finished';
      broadcastState(room);
      broadcastRoom(room);
    }
  };
  const attach = (ws, room, player) => {
    const old = player.ws;
    player.ws = ws;
    player.disconnectedAt = null;
    ws.room = room;
    ws.player = player;
    ws.terrainRevision = -1;
    room.emptySince = null;
    if (old && old !== ws) old.close(4001, 'Sesión abierta en otra conexión.');
    send(ws, {
      type: 'welcome',
      playerId: player.id,
      token: player.token,
      code: room.code,
      sequence: player.journal.sequence,
    });
    transferHost(room);
    broadcastRoom(room);
    if (room.game) {
      send(ws, { type: 'state', state: room.game.snapshot(true) });
      ws.terrainRevision = room.game.terrain.revision;
    }
  };
  const makePlayer = (name, index) => ({
    id: randomUUID(),
    token: randomBytes(24).toString('hex'),
    name,
    team: index % 2,
    color: COLORS[index],
    ready: false,
    loaded: false,
    disconnectedAt: null,
    forfeited: false,
    journal: new CommandJournal(),
    ws: null,
  });
  const connect = (ws, ip = 'unknown') => {
    peers.add(ws);
    ws.networkKey = ip;
    ws.connectedAt = now();
    ws.anonymousSince = ws.connectedAt;
    ws.messageRate = new TokenBucket(limits.messageBurst, limits.messagesPerSecond, now);
    ws.handshakeRate = new TokenBucket(limits.handshakeBurst, limits.handshakesPerSecond, now);
    ws.handshakeSeen = new Map();
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('error', () => {});
    ws.on('message', (data) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!ws.messageRate.take()) {
        ws.close(1008, 'Demasiados mensajes. Espera antes de volver a entrar.');
        return;
      }
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        send(ws, { type: 'error', error: 'Mensaje no válido.' });
        return;
      }
      if (
        !message ||
        typeof message !== 'object' ||
        typeof message.id !== 'string' ||
        !message.id.length ||
        message.id.length > 96 ||
        (!HANDSHAKES.has(message.type) && !COMMANDS.has(message.type))
      ) {
        send(ws, { type: 'error', error: 'Mensaje no válido o sin identificador.' });
        return;
      }
      const { id, type } = message;
      const identityAtStart = ws.player;
      const handshake = HANDSHAKES.has(type);
      const isInput = type === 'action' && message.action?.type === 'input';
      if (!handshake && identityAtStart?.ws !== ws) {
        send(ws, { type: 'ack', id, ok: false, error: 'Entra a una sala primero.' });
        return;
      }
      const journal = identityAtStart?.journal;
      const cache = handshake ? ws.handshakeSeen : isInput ? journal?.inputs : journal?.commands;
      const previous = handshake ? cache.get(id) : journal?.lookup(id, message.seq);
      if (previous) {
        send(ws, previous);
        return;
      }
      if (!handshake && journal && !journal.accept(message.seq)) {
        send(ws, {
          type: 'ack',
          id,
          ok: false,
          error: 'Comando antiguo o sin secuencia. Actualiza el juego.',
        });
        return;
      }
      const ack = (ok = true, error) => {
        const response = { type: 'ack', id, ok, ...(error ? { error } : {}) };
        if (handshake) remember(cache, id, response);
        else journal?.remember(id, message.seq, response, isInput);
        send(ws, response);
      };
      if (HANDSHAKES.has(type)) {
        if (!ws.handshakeRate.take()) {
          ws.close(1008, 'Demasiados intentos de entrada.');
          return;
        }
        if (ws.player) {
          ack(false, 'Ya estás dentro de una sala.');
          return;
        }
        if (type === 'create') {
          const name = nameFrom(message.name);
          if (!name) {
            ack(false, 'Escribe tu nombre para entrar.');
            return;
          }
          if (
            rooms.size >= limits.maxRooms ||
            [...rooms.values()].filter((room) => room.creatorIp === ip).length >= limits.maxRoomsPerIp
          ) {
            ack(false, 'El servidor está lleno. Inténtalo más tarde.');
            return;
          }
          let code;
          do {
            code = Array.from(randomBytes(6), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
          } while (rooms.has(code));
          const player = makePlayer(name, 0);
          const room = {
            code,
            creatorIp: ip,
            hostId: player.id,
            phase: 'lobby',
            settings: { mapId: 'hills', mode: 'ffa', worms: 2, turnSeconds: CONFIG.turnSeconds },
            players: [player],
            game: null,
            loadingAt: null,
            emptySince: null,
            rematchRequests: new Set(),
          };
          rooms.set(code, room);
          attach(ws, room, player);
          ack();
          return;
        }
        const code = typeof message.code === 'string' ? message.code.trim().toUpperCase() : '';
        const room = rooms.get(code);
        if (!room) {
          ack(false, 'No encontramos esa sala. Revisa el código.');
          return;
        }
        const existing =
          typeof message.token === 'string'
            ? room.players.find((player) => player.token === message.token)
            : null;
        if (existing) {
          attach(ws, room, existing);
          ack();
          return;
        }
        if (type === 'resume') {
          ack(false, 'La sesión ya no está disponible. Entra de nuevo con tu nombre.');
          return;
        }
        if (room.phase !== 'lobby') {
          ack(false, 'La partida ya empezó. Espera a la siguiente ronda.');
          return;
        }
        if (room.players.length >= 6) {
          ack(false, 'Esta sala está llena (máximo seis participantes).');
          return;
        }
        const name = nameFrom(message.name);
        if (!name) {
          ack(false, 'Escribe tu nombre para entrar.');
          return;
        }
        const player = makePlayer(name, room.players.length);
        // Choose an unused colour when a previous guest has left the lobby.
        player.color = COLORS.find((color) => !room.players.some((p) => p.color === color)) || COLORS[0];
        room.players.push(player);
        attach(ws, room, player);
        ack();
        return;
      }
      const room = ws.room;
      const player = ws.player;
      if (!room || !player || player.ws !== ws || !rooms.has(room.code)) {
        ack(false, 'Entra a una sala primero.');
        return;
      }
      const hostOnly = ['settings', 'start', 'rematch', 'lobby'].includes(type);
      if (hostOnly && room.hostId !== player.id) {
        ack(false, 'Solo quien organiza puede hacer eso.');
        return;
      }
      if (type === 'leave') {
        if (room.game && !player.forfeited) {
          room.game.forfeit(player.id);
          player.forfeited = true;
        }
        room.players = room.players.filter((p) => p !== player);
        room.rematchRequests.delete(player.id);
        ws.room = null;
        ws.player = null;
        ws.anonymousSince = now();
        player.ws = null;
        transferHost(room);
        updatePresence(room);
        if (!room.players.length) rooms.delete(room.code);
        else if (room.phase === 'loading') returnToLobby(room);
        else {
          markFinished(room);
          broadcastRoom(room);
          broadcastState(room);
        }
        ack();
        send(ws, { type: 'left' });
        return;
      }
      if (type === 'settings') {
        if (room.phase !== 'lobby') {
          ack(false, 'La configuración solo cambia en la sala.');
          return;
        }
        const settings = mergeSettings(room.settings, message.settings);
        if (!settings) {
          ack(false, 'Configuración no válida.');
          return;
        }
        room.settings = settings;
        normalizeTeams(room.players, settings.mode);
        for (const member of room.players) member.ready = false;
      } else if (type === 'team') {
        if (
          room.phase !== 'lobby' ||
          !Number.isInteger(message.team) ||
          message.team < 0 ||
          message.team >= teamCount(room.settings.mode)
        ) {
          ack(false, 'Equipo no válido.');
          return;
        }
        player.team = message.team;
        player.ready = false;
      } else if (type === 'ready') {
        if (room.phase !== 'lobby' || typeof message.ready !== 'boolean') {
          ack(false, 'No puedes cambiar el estado de listo ahora.');
          return;
        }
        if (player.ready === message.ready) {
          ack();
          return;
        }
        player.ready = message.ready;
      } else if (type === 'start') {
        if (room.phase !== 'lobby') {
          ack(false, 'La partida ya está en marcha.');
          return;
        }
        const error = validateComposition(room);
        if (error) {
          ack(false, error);
          return;
        }
        room.phase = 'loading';
        room.loadingAt = now();
        for (const member of room.players) member.loaded = false;
      } else if (type === 'loaded') {
        if (room.phase !== 'loading') {
          ack(false, 'La sala no está cargando una partida.');
          return;
        }
        player.loaded = true;
        maybeStart(room);
      } else if (type === 'action') {
        if (room.phase !== 'playing' || player.forfeited) {
          ack(false, 'No puedes actuar ahora.');
          return;
        }
        if (!validAction(message.action)) {
          ack(false, 'Acción no válida.');
          return;
        }
        const result = room.game.action(player.id, message.action);
        ack(result.ok, result.error);
        return;
      } else if (type === 'rematch-request') {
        if (room.phase !== 'finished') {
          ack(false, 'Espera al final de la partida.');
          return;
        }
        if (room.rematchRequests.has(player.id)) {
          ack();
          return;
        }
        room.rematchRequests.add(player.id);
      } else if (type === 'rematch' || type === 'lobby') {
        if (room.phase !== 'finished') {
          ack(false, 'Espera al final de la partida.');
          return;
        }
        for (const member of room.players) member.forfeited = false;
        returnToLobby(room);
        ack();
        return;
      }
      broadcastRoom(room);
      ack();
    });
    ws.on('close', () => {
      peers.delete(ws);
      const { room, player } = ws;
      if (!room || !player || player.ws !== ws) return;
      player.ws = null;
      player.ready = false;
      player.disconnectedAt = now();
      transferHost(room);
      if (room.phase === 'loading') returnToLobby(room);
      updatePresence(room);
      if (!closing) broadcastRoom(room);
    });
  };
  const maintain = (wallNow = now()) => {
    for (const peer of peers)
      if (!peer.player && wallNow - peer.anonymousSince >= limits.handshakeTimeoutMs)
        peer.close(1008, 'Escribe tu nombre para entrar.');
    for (const room of rooms.values()) {
      updatePresence(room, wallNow);
      if (!rooms.has(room.code)) continue;
      if (room.emptySince !== null && wallNow - room.emptySince >= emptyRoomMs) {
        rooms.delete(room.code);
        continue;
      }
      if (room.phase === 'loading' && wallNow - room.loadingAt >= loadingMs) {
        for (const member of room.players)
          send(member.ws, { type: 'error', error: 'La carga tardó demasiado. Pueden intentarlo de nuevo.' });
        returnToLobby(room);
      }
      let changed = false;
      for (const player of [...room.players]) {
        if (player.disconnectedAt === null || wallNow - player.disconnectedAt < disconnectMs) continue;
        if (room.phase === 'lobby') {
          room.players = room.players.filter((member) => member !== player);
          changed = true;
        } else if (room.game && !player.forfeited) {
          room.game.forfeit(player.id);
          player.forfeited = true;
          changed = true;
        }
      }
      if (changed) {
        updatePresence(room, wallNow);
        if (!rooms.has(room.code)) continue;
        transferHost(room);
        markFinished(room);
        broadcastRoom(room);
        broadcastState(room);
      }
    }
  };
  return {
    rooms,
    connect,
    maintain,
    step(dt) {
      for (const room of rooms.values())
        if (room.phase === 'playing') {
          room.game.step(dt);
          markFinished(room);
        }
    },
    broadcast() {
      for (const room of rooms.values()) if (room.phase === 'playing') broadcastState(room);
    },
    close() {
      closing = true;
      for (const peer of peers) peer.terminate();
      peers.clear();
      rooms.clear();
    },
  };
}
