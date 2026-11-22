import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { projectConfiguration, runLauncher } from './launcher.mjs';
import { readRegular } from './story-files.mjs';

const host = '127.0.0.1';
const absoluteTarget = /^https?:\/\/[^/?#@\\\s]+(\/status|\/)?(?:\?(?:[a-z0-9._~!$&'()*+,;=:@/?-]|%[a-f0-9]{2})*)?$/i;

/**
 * @param {object} state
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @returns {void}
 */
export function respond(state, request, response) {
  const target = request.url;
  const absolute = absoluteTarget.exec(target);
  const pathname = absolute && URL.canParse(target) ? (absolute[1] ?? '/') : target.split('?', 1)[0];
  if (pathname !== '/' && pathname !== '/status') {
    response.writeHead(404).end();
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const status = pathname === '/status';
  const body = status ? JSON.stringify({
    ...state,
    ok: state.phase === 'running' || state.phase === 'standalone',
  }) : 'Universe launcher is running.\n';
  response.writeHead(200, {
    'Content-Type': status ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  }).end(request.method === 'HEAD' ? undefined : body);
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const settings = await readRegular(fileURLToPath(new URL('./.env', import.meta.url)));
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
  const server = createServer((request, response) => respond(state, request, response));
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
    });
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
