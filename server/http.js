import { createReadStream, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';

const MIME = {
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

/** Accept origin-form paths only; both HTTP and upgrade share this boundary. */
export function requestPath(target) {
  if (
    typeof target !== 'string' ||
    !target.startsWith('/') ||
    target.startsWith('//') ||
    /[\\\u0000-\u0020\u007f]/.test(target)
  )
    return null;
  try {
    const pathname = new URL(target, 'http://localhost').pathname;
    const decoded = decodeURIComponent(pathname);
    if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return null;
    return { pathname, decoded };
  } catch {
    return null;
  }
}

export function rejectUpgrade(socket, status) {
  if (socket.destroyed) return;
  const reason =
    { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests' }[status] ||
    'Bad Request';
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () =>
    socket.destroy(),
  );
}

export function createHttpHandler({ root, middleware = () => null }) {
  const dist = resolve(root, 'dist');
  return (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    const path = requestPath(req.url);
    if (!path) {
      res.writeHead(400);
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    if (path.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true }));
      return;
    }
    const vite = middleware();
    if (vite) {
      vite(req, res);
      return;
    }
    let file = resolve(dist, `.${path.decoded}`);
    if (file !== dist && !file.startsWith(dist + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
        if (extname(path.pathname)) {
          res.writeHead(404);
          res.end('No encontrado');
          return;
        }
        file = resolve(dist, 'index.html');
      }
      if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Compila el cliente con npm run build o inicia npm run dev.');
        return;
      }
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': path.pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else
      createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res);
  };
}
