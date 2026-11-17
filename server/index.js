import http from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocketServer } from 'ws';
import { CONFIG } from '../shared/config.js';
import { createHttpHandler, requestPath, rejectUpgrade } from './http.js';
import { ConnectionPolicy, serverLimits } from './limits.js';
import { createRoomService } from './rooms.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Wire transports and clocks; importing this module starts no work. */
export async function createServer({
  port = 0,
  host = '127.0.0.1',
  dev = false,
  trustProxy = false,
  allowedOrigins = [],
  limits: overrides,
  ...roomOptions
} = {}) {
  const limits = serverLimits(overrides);
  const service = createRoomService({ ...roomOptions, limits });
  const policy = new ConnectionPolicy({ limits, trustProxy, allowedOrigins });
  let vite;
  let closing = false;
  const server = http.createServer(createHttpHandler({ root: ROOT, middleware: () => vite?.middlewares }));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    const path = requestPath(request.url);
    if (!path) {
      rejectUpgrade(socket, 400);
      return;
    }
    if (path.pathname !== '/socket') {
      if (!dev || path.pathname !== '/' || request.headers['sec-websocket-protocol'] !== 'vite-hmr') {
        rejectUpgrade(socket, 404);
      }
      return; // Vite handles its own HMR route in development.
    }
    const admission = policy.reserve(request);
    if (admission.status) {
      rejectUpgrade(socket, admission.status);
      return;
    }
    socket.once('close', admission.release);
    try {
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.once('close', admission.release);
        service.connect(ws, admission.ip);
      });
    } catch {
      admission.release();
      socket.destroy();
    }
  });
  try {
    if (dev) {
      const { createServer: createViteServer, normalizePath, version } = await import('vite');
      const [major, minor, patch] = version.split('.').map(Number);
      if (major !== 7 || minor < 3 || (minor === 3 && patch < 8)) {
        throw new Error('Actualiza Vite con npm ci: se requiere 7.3.8 o posterior para desarrollo.');
      }
      const generatedDirs = ['release', 'docs/evidence'].map((dir) => normalizePath(resolve(ROOT, dir)));
      vite = await createViteServer({
        root: ROOT,
        optimizeDeps: { entries: ['index.html'] },
        server: {
          middlewareMode: true,
          hmr: { server },
          watch: { ignored: generatedDirs },
          // Keep Vite 7's default denials when adding project-specific generated files.
          fs: {
            deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', ...generatedDirs.map((dir) => dir + '/**')],
          },
        },
        appType: 'spa',
      });
    }
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        resolveListen();
      });
    });
  } catch (error) {
    service.close();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    if (vite) await vite.close();
    throw error;
  }
  let lastTime = performance.now();
  let accumulator = 0;
  let lastSnapshot = 0;
  let lastMaintenance = 0;
  const interval = setInterval(() => {
    const now = performance.now();
    accumulator += Math.min((now - lastTime) / 1000, 0.25);
    lastTime = now;
    const dt = 1 / CONFIG.tickRate;
    while (accumulator >= dt) {
      service.step(dt);
      accumulator -= dt;
    }
    if (now - lastSnapshot >= 1000 / 15) {
      service.broadcast();
      lastSnapshot = now;
    }
    if (now - lastMaintenance >= 200) {
      service.maintain();
      lastMaintenance = now;
    }
  }, 1000 / CONFIG.tickRate);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15_000);
  return {
    server,
    wss,
    rooms: service.rooms,
    port: server.address().port,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(interval);
      clearInterval(heartbeat);
      service.close();
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolveClose) => wss.close(resolveClose));
      if (vite) await vite.close();
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

export async function startServerFromEnvironment() {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  const app = await createServer({
    port,
    host,
    dev: process.env.NODE_ENV !== 'production',
    trustProxy: process.env.TRUST_PROXY === '1',
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    limits: Object.fromEntries(
      [
        ['MAX_CONNECTIONS', 'maxConnections'],
        ['MAX_CONNECTIONS_PER_IP', 'maxConnectionsPerIp'],
        ['MAX_ROOMS', 'maxRooms'],
        ['MAX_ROOMS_PER_IP', 'maxRoomsPerIp'],
      ]
        .filter(([key]) => process.env[key])
        .map(([key, name]) => [name, Number(process.env[key])]),
    ),
  });
  console.log(
    `Lombrices de guardia: http://localhost:${app.port} (${process.env.NODE_ENV === 'production' ? 'producción' : 'desarrollo'})`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await app.close();
      process.exit(0);
    });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await startServerFromEnvironment();
