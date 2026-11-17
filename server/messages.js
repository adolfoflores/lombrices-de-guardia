import { WebSocket } from 'ws';

export function send(ws, payload) {
  if (ws?.readyState !== WebSocket.OPEN) return;
  // Slow clients reconnect to a full snapshot instead of accumulating stale frames.
  if (ws.bufferedAmount > 2 * 1024 * 1024) {
    ws.close(1013, 'Conexión lenta; vuelve a entrar.');
    return;
  }
  ws.send(JSON.stringify(payload));
}
export function remember(cache, id, response, limit = 256) {
  cache.set(id, response);
  if (cache.size > limit) cache.delete(cache.keys().next().value);
}
export function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    settings: { ...room.settings },
    rematchRequests: [...room.rematchRequests],
    players: room.players.map(({ id, name, team, color, ready, loaded, ws }) => ({
      id,
      name,
      team,
      color,
      ready,
      loaded,
      connected: ws?.readyState === WebSocket.OPEN,
    })),
  };
}
