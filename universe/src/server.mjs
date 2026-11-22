import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { projectConfiguration, runLauncher } from './launcher.mjs';
import { readRegular } from './story-files.mjs';

const host = '127.0.0.1';
const absoluteTarget = /^https?:\/\/[^/?#@\\\s]+(\/status|\/save|\/)?(?:\?(?:[a-z0-9._~!$&'()*+,;=:@/?-]|%[a-f0-9]{2})*)?$/i;
const home = readFileSync(new URL('./wrapper-home.html', import.meta.url), 'utf8');
const saveStatuses = { saved: 200, unchanged: 200, pending: 202, unavailable: 503, failed: 503 };

/**
 * @param {object} state
 * @param {number} port
 * @param {Function} save
 * @returns {Function}
 */
export function createWrapperHandler(state, port, save) {
  const token = randomUUID();
  const authorities = new Set([host, 'localhost'].map(name => new URL(`http://${name}:${port}`).host));
  const admissions = [];
  let outstanding = 0;
  return async (request, response) => {
    const target = request.url;
    const absolute = absoluteTarget.exec(target);
    const pathname = absolute && URL.canParse(target) ? (absolute[1] ?? '/') : target.split('?', 1)[0];
    const send = (code, body = '', headers = {}) => response.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
    }).end(request.method === 'HEAD' ? undefined : body);
    if (!['/', '/status', '/save'].includes(pathname)) {
      return send(404);
    }
    if (pathname === '/save' ? request.method !== 'POST' : !['GET', 'HEAD'].includes(request.method)) {
      return send(405, '', { Allow: pathname === '/save' ? 'POST' : 'GET, HEAD' });
    }
    const authority = request.headers.host;
    const origin = 'http://' + authority;
    if (!authorities.has(authority) || (absolute && new URL(target).origin !== origin)) {
      return send(403);
    }
    if (pathname === '/status') {
      return send(200, JSON.stringify({ ...state, ok: state.phase === 'running' || state.phase === 'standalone' }));
    }
    if (pathname === '/') {
      if (request.headers.origin !== undefined && request.headers.origin !== origin) {
        return send(403);
      }
      const nonce = randomUUID();
      const localOnly = state.syncBackend === 'local-only';
      const page = home.replaceAll('{{nonce}}', nonce).replace('{{token}}', token)
        .replace('{{disabled}}', localOnly ? 'disabled' : '')
        .replace('{{message}}', localOnly ? 'Cloud save is not configured.' : '');
      return send(200, page, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
    }
    if (request.headers.origin !== origin || request.headers['x-universe-csrf'] !== token) {
      return send(403);
    }
    if (request.headers['transfer-encoding'] !== undefined ||
        (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')) {
      return send(400);
    }
    const now = Date.now();
    while (admissions.length && admissions[0] <= now - 10_000) {
      admissions.shift();
    }
    if (outstanding >= 8 || admissions.length >= 12) {
      return send(429, JSON.stringify({ checkpoint: 'rate-limited' }), { 'Retry-After': '10' });
    }
    admissions.push(now);
    if (state.syncBackend === 'local-only') {
      return send(503, JSON.stringify({ checkpoint: 'local-only' }));
    }
    outstanding++;
    let timeout;
    try {
      const deadline = new Promise(resolve => {
        timeout = setTimeout(() => resolve({ checkpoint: 'pending' }), 60_000);
      });
      const outcome = await Promise.race([save(), deadline]);
      return send(saveStatuses[outcome.checkpoint], JSON.stringify(outcome));
    } catch {
      return send(503, JSON.stringify({ checkpoint: 'failed' }));
    } finally {
      clearTimeout(timeout);
      outstanding--;
    }
  };
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const settings = await readRegular(fileURLToPath(new URL('../.env', import.meta.url)));
  const config = projectConfiguration(settings?.toString('utf8') ?? '', process.env);
  const state = {
    phase: 'starting',
    syncBackend: config.credentials ? 'cloudflare-r2' : 'local-only',
    pending: false,
    lastSyncAt: null,
    childPid: null,
  };
  const stop = new AbortController();
  const abort = () => stop.abort();
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  let requestSave;
  const server = createServer(createWrapperHandler(state, config.port,
    () => requestSave ? requestSave() : { checkpoint: 'unavailable' }));
  try {
    await new Promise((listening, reject) => {
      server.once('error', reject);
      server.listen(config.port, host, listening);
    });
    console.log(`http://${host}:${config.port}/`);
    await runLauncher(config, stop.signal, (next) => {
      Object.assign(state, next);
      if (next.phase === 'saved') {
        console.log('[universe] Cloud story save confirmed.');
      }
    }, { onSaveReady(handler) { requestSave = handler; } });
  } finally {
    if (server.listening) {
      await new Promise((done) => server.close(done));
    }
    process.off('SIGINT', abort);
    process.off('SIGTERM', abort);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (error.syscall === 'listen') {
      console.error(`Universe launcher failed to listen on ${error.address}:${error.port} (${error.code}).`);
    } else {
      console.error(`[universe] ${error.message}`);
    }
    process.exitCode = 1;
  });
}
