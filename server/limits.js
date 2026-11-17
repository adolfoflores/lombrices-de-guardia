const DEFAULTS = Object.freeze({
  maxConnections: 256,
  maxConnectionsPerIp: 32,
  maxRooms: 32,
  maxRoomsPerIp: 8,
  messageBurst: 512,
  messagesPerSecond: 60,
  handshakeBurst: 12,
  handshakesPerSecond: 1,
  handshakeTimeoutMs: 15_000,
});

export function serverLimits(overrides = {}) {
  const limits = { ...DEFAULTS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULTS, key) || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Límite inválido: ${key}`);
    }
  }
  return Object.freeze(limits);
}

export class TokenBucket {
  constructor(capacity, perSecond, now = Date.now) {
    this.capacity = capacity;
    this.perSecond = perSecond;
    this.now = now;
    this.tokens = capacity;
    this.at = now();
  }

  take() {
    const at = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + (Math.max(0, at - this.at) * this.perSecond) / 1000);
    this.at = at;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

export function clientIp(request, trustProxy = false) {
  // Only use the last, proxy-added hop, never a client-supplied first hop.
  const forwarded = request.headers['x-forwarded-for'];
  const ip =
    trustProxy && typeof forwarded === 'string'
      ? forwarded.split(',').at(-1).trim()
      : request.socket.remoteAddress;
  return (ip || 'unknown').replace(/^::ffff:/, '');
}

/** Reservations cover incomplete upgrades and are released on every failure path. */
export class ConnectionPolicy {
  constructor({ limits, trustProxy = false, allowedOrigins = [] } = {}) {
    this.limits = serverLimits(limits);
    this.trustProxy = trustProxy;
    this.allowedOrigins = new Set(allowedOrigins);
    this.total = 0;
    this.byIp = new Map();
  }

  reserve(request) {
    const origin = request.headers.origin;
    if (origin) {
      let sameHost = false;
      try {
        const url = new URL(origin);
        sameHost = ['http:', 'https:'].includes(url.protocol) && url.host === request.headers.host;
      } catch {
        /* Invalid origins are refused before allocating a peer. */
      }
      if (!sameHost && !this.allowedOrigins.has(origin)) return { status: 403 };
    }
    const ip = clientIp(request, this.trustProxy);
    const count = this.byIp.get(ip) || 0;
    if (this.total >= this.limits.maxConnections || count >= this.limits.maxConnectionsPerIp)
      return { status: 429 };
    this.total++;
    this.byIp.set(ip, count + 1);
    let released = false;
    return {
      ip,
      release: () => {
        if (released) return;
        released = true;
        this.total--;
        const remaining = this.byIp.get(ip) - 1;
        if (remaining) this.byIp.set(ip, remaining);
        else this.byIp.delete(ip);
      },
    };
  }
}
