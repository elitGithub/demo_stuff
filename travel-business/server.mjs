import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createStore, InputError } from './src/store.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = join(root, 'public');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8089);
const store = createStore(process.env.DB_PATH || join(root, 'storage', 'demo.sqlite'));
const sessions = new Map(), limits = new Map();
const SESSION_TTL = 4 * 60 * 60 * 1000;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };
function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Please send JSON data.', 415);
  if (Number(req.headers['content-length'] || 0) > 16384) throw new InputError('That submission is too large.', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new InputError('That submission is too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InputError('The submitted data is not valid JSON.'); }
}
function session(req) {
  const token = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('elsewhere_demo='))?.slice('elsewhere_demo='.length);
  if (!token || !sessions.has(token) || sessions.get(token) < Date.now()) throw new InputError('Enter the demo dashboard to continue.', 401);
  return token;
}
function rateLimit(req, kind, max = 50) {
  const key = `${req.socket.remoteAddress}:${kind}`;
  const now = Date.now();
  const current = limits.get(key);
  if (!current || current.until < now) { limits.set(key, { count: 1, until: now + 3600000 }); return; }
  if (current.count >= max) throw new InputError('The demo has received too many requests. Please try again later.', 429);
  current.count++;
}
function cookie(token, req, clear = false) {
  const secure = process.env.PUBLIC_ORIGIN?.startsWith('https:') || req.socket.encrypted;
  return `elsewhere_demo=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_TTL / 1000}${secure ? '; Secure' : ''}`;
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const origin = req.headers.origin;
      const expectedOrigin = process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
      if (origin && origin !== expectedOrigin) throw new InputError('Cross-origin requests are not allowed.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new InputError('Cross-site requests are not allowed.', 403);
      if (req.method === 'POST' && url.pathname === '/api/enquiries') {
        rateLimit(req, 'enquiries');
        return json(res, 201, store.createEnquiry(await body(req)));
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/login') {
        rateLimit(req, 'login'); await body(req);
        if (sessions.size >= 500) throw new InputError('The demo is busy. Please try again later.', 503);
        const token = randomBytes(32).toString('hex'); sessions.set(token, Date.now() + SESSION_TTL);
        return json(res, 200, { ok: true }, { 'Set-Cookie': cookie(token, req) });
      }
      if (url.pathname.startsWith('/api/admin/')) {
        const token = session(req);
        if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
          await body(req); sessions.delete(token);
          return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', req, true) });
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/overview') return json(res, 200, store.overview());
        const match = url.pathname.match(/^\/api\/admin\/enquiries\/(\d+)(\/booking)?$/);
        if (match && !Number.isSafeInteger(Number(match[1]))) throw new InputError('Invalid enquiry ID.');
        if (match && !match[2] && req.method === 'PATCH') return json(res, 200, store.updateStatus(Number(match[1]), (await body(req))?.status));
        if (match?.[2] && req.method === 'POST') { await body(req); return json(res, 201, store.convert(Number(match[1]))); }
      }
      return json(res, 404, { error: 'API route not found.' });
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { throw new InputError('Invalid URL.'); }
    if (pathname === '/') pathname = '/index.html';
    if (pathname.includes('\0') || pathname.includes('\\')) throw new InputError('Invalid path.');
    const file = resolve(publicRoot, `.${pathname}`);
    if (!file.startsWith(publicRoot + sep) || !types[extname(file)] || pathname.split('/').some(segment => segment.startsWith('.'))) throw new InputError('Page not found.', 404);
    let info;
    try { info = await stat(file); } catch { throw new InputError('Page not found.', 404); }
    if (!info.isFile()) throw new InputError('Page not found.', 404);
    res.writeHead(200, { 'Content-Type': types[extname(file)], 'Content-Length': info.size, 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch (error) {
    if (res.headersSent) { res.end(); return; }
    if (error instanceof InputError) return json(res, error.status, { error: error.message });
    console.error('Request failed:', error.message);
    json(res, 500, { error: 'The demo could not complete that request. Please try again.' });
  }
});
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, expires] of sessions) if (expires < now) sessions.delete(key);
  for (const [key, entry] of limits) if (entry.until < now) limits.delete(key);
}, 60000).unref();
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, host, () => console.log(`Elsewhere is ready at http://${host}:${server.address().port}`));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(cleanup);
  server.close(() => { store.close(); process.exit(0); });
  server.closeIdleConnections();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
