const HANDSHAKES = new Set(['create', 'join', 'resume']);

/** Socket ownership, sequencing, bounded acknowledgements and reconnect backoff. */
export function createTransport({
  url,
  onOpen = () => {},
  onMessage = () => {},
  onAck = () => {},
  onDisconnect = () => {},
  onReplaced = () => {},
  onError = () => {},
  onStatus = () => {},
  WebSocketClass = globalThis.WebSocket,
  now = () => performance.now(),
  uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let socket,
    retry,
    tries = 0,
    stopped = false,
    sequence = 0;
  const outstanding = new Map();
  const callbacks = new Map();
  const api = {
    get isOpen() {
      return socket?.readyState === 1;
    },
    send(type, data = {}, quiet = false) {
      if (!api.isOpen) return null;
      for (const [id, request] of outstanding) {
        if (now() - request.at > 10_000) {
          cancel(request.timeout);
          outstanding.delete(id);
          callbacks.delete(id);
        }
      }
      if (outstanding.size >= 256) {
        socket.close(1013, 'Sin confirmaciones del servidor.');
        return null;
      }
      const id = uid();
      const envelope = { ...data, type, id, ...(HANDSHAKES.has(type) ? {} : { seq: ++sequence }) };
      const timeout = schedule(() => {
        if (outstanding.has(id)) socket?.close(1013, 'Sin confirmación del servidor.');
      }, 10_000);
      outstanding.set(id, { at: now(), quiet, type, timeout });
      try {
        socket.send(JSON.stringify(envelope));
      } catch {
        cancel(timeout);
        outstanding.delete(id);
        return null;
      }
      return id;
    },
    expect(id, callback) {
      if (id && outstanding.has(id)) callbacks.set(id, callback);
    },
    connect() {
      cancel(retry);
      if (stopped) return;
      if (socket && socket.readyState < 2) return;
      onStatus(tries ? 'Recuperando conexión… El turno continúa.' : 'Conectando con la sala…');
      const current = new WebSocketClass(url);
      socket = current;
      current.addEventListener('open', () => {
        if (socket !== current || stopped) return;
        tries = 0;
        onStatus('');
        onOpen();
      });
      current.addEventListener('message', ({ data }) => {
        if (socket !== current || stopped) return;
        let message;
        try {
          message = JSON.parse(data);
        } catch {
          return;
        }
        if (!message || typeof message !== 'object') return;
        if (message.type === 'welcome')
          sequence = Number.isSafeInteger(message.sequence) ? message.sequence : 0;
        if (message.type === 'ack') {
          const request = outstanding.get(message.id);
          cancel(request?.timeout);
          outstanding.delete(message.id);
          const callback = callbacks.get(message.id);
          callbacks.delete(message.id);
          if (request) onAck(message, { ...request, rtt: now() - request.at });
          callback?.(message);
        } else onMessage(message);
      });
      current.addEventListener('close', (event) => {
        if (socket !== current) return;
        for (const request of outstanding.values()) cancel(request.timeout);
        outstanding.clear();
        callbacks.clear();
        onDisconnect();
        if (stopped) return;
        if (event.code === 4001 || event.code === 4002) {
          stopped = true;
          onReplaced();
          return;
        }
        onStatus('Sin conexión. Reconectando… El turno continúa.');
        retry = schedule(() => api.connect(), Math.min(10_000, 700 * 2 ** Math.min(tries++, 5)));
      });
      current.addEventListener('error', onError);
    },
    disconnect() {
      cancel(retry);
      for (const request of outstanding.values()) cancel(request.timeout);
      outstanding.clear();
      callbacks.clear();
      const current = socket;
      socket = null;
      current?.close();
    },
    close() {
      stopped = true;
      api.disconnect();
    },
  };
  return api;
}
