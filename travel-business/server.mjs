import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, extname, sep } from 'node:path';
import { InputError } from './src/InputError.mjs';
import { Catalog } from './src/dto/Catalog.mjs';
import { SandboxConfig } from './src/dto/SandboxConfig.mjs';
import { SandboxRuntime } from './src/sandbox/SandboxRuntime.mjs';
import { ApiController } from './src/ApiController.mjs';
import { ErrorCode } from './src/enums/ErrorCode.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = join(root, 'public');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8089);
const config = SandboxConfig.from(process.env.SANDBOX_CONFIG_FILE ? JSON.parse(await readFile(process.env.SANDBOX_CONFIG_FILE, 'utf8')) : {});
const catalog = Catalog.canonical();
const now = () => Math.floor(Date.now() / 1000);
const runtime = new SandboxRuntime(process.env.SANDBOX_ROOT || join(root, 'storage', 'sandbox-runtime'), config, catalog, now);
let controller;
if (process.env.PUBLIC_ORIGIN) { controller = new ApiController(runtime, catalog, config, process.env.PUBLIC_ORIGIN, now); }
else if (!['127.0.0.1', '::1', 'localhost'].includes(host)) { throw new TypeError('PUBLIC_ORIGIN is required beyond loopback.'); }
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };
/** @param {import('node:http').ServerResponse} res @param {number} status @param {object} body @param {object} extra @returns {void} */
function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
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
      return await controller.handle(req, res);
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
    if (error instanceof InputError) return json(res, error.status, { error: error.message, code: error.code.value });
    console.error('Request failed:', error.message);
    json(res, 500, { error: 'The demo could not complete that request. Please try again.', code: ErrorCode.Internal.value });
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, host, () => {
  const address = server.address();
  const origin = `http://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}`;
  if (!controller) { controller = new ApiController(runtime, catalog, config, origin, now); }
  console.log(`Elsewhere is ready at ${origin}`);
});
let stopping = false;
/** @returns {void} */
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => { process.exit(0); });
  server.closeIdleConnections();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
