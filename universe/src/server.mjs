import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { LauncherLog } from './LauncherLog.mjs';
import { projectConfiguration, runLauncher } from './launcher.mjs';
import { SyncPhase } from './sync/SyncPhase.mjs';

const host = '127.0.0.1';
const absoluteTarget = /^https?:\/\/[^/?#@\\\s]+(\/status|\/save|\/)?(?:\?(?:[a-z0-9._~!$&'()*+,;=:@/?-]|%[a-f0-9]{2})*)?$/i;
const home = readFileSync(new URL('./wrapper-home.html', import.meta.url), 'utf8');
const admissionWindowMs = 10_000;
const admissionLimit = 12;
const stopSignals = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP']);
const consoleGoneCodes = Object.freeze(['EPIPE', 'EIO']);

/**
 * @param {object} state
 * @param {number} port
 * @param {Function} save
 * @returns {Function}
 * @throws {TypeError}
 */
export function createWrapperHandler(state, port, save) {
  const token = randomUUID();
  const authorities = new Set([host, 'localhost'].map((name) => new URL(`http://${name}:${port}`).host));
  const admissions = [];
  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @returns {void}
   * @throws {Error}
   */
  return (request, response) => {
    const target = request.url;
    const absolute = absoluteTarget.exec(target);
    const pathname = absolute && URL.canParse(target) ? (absolute[1] ?? '/') : target.split('?', 1)[0];
    /**
     * @param {number} code
     * @param {string} body
     * @param {object} headers
     * @returns {void}
     * @throws {Error}
     */
    const send = (code, body = '', headers = {}) => response.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
    }).end(request.method === 'HEAD' ? undefined : body);
    /**
     * @returns {string}
     * @throws {TypeError}
     */
    const status = () => JSON.stringify({ ...state, ok: state.phase === SyncPhase.Running });
    if (!['/', '/status', '/save'].includes(pathname)) {
      return send(404);
    }
    if (pathname === '/save' ? request.method !== 'POST' : !['GET', 'HEAD'].includes(request.method)) {
      return send(405, '', { Allow: pathname === '/save' ? 'POST' : 'GET, HEAD' });
    }
    const authority = request.headers.host;
    const origin = `http://${authority}`;
    if (!authorities.has(authority) || (absolute && new URL(target).origin !== origin)) {
      return send(403);
    }
    if (pathname === '/status') {
      return send(200, status());
    }
    if (pathname === '/') {
      if (request.headers.origin !== undefined && request.headers.origin !== origin) {
        return send(403);
      }
      const nonce = randomUUID();
      const disabled = state.phase === SyncPhase.Disabled;
      const message = disabled ? state.error.replace(/[&<>"']/g, (character) => `&#${character.codePointAt(0)};`) : '';
      const page = home.replaceAll('{{nonce}}', nonce).replace('{{token}}', token)
        .replace('{{disabled}}', disabled ? 'disabled' : '')
        .replace('{{message}}', () => message);
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
    while (admissions.length && admissions[0] <= now - admissionWindowMs) {
      admissions.shift();
    }
    if (admissions.length >= admissionLimit) {
      return send(429, status(), { 'Retry-After': String(admissionWindowMs / 1000) });
    }
    admissions.push(now);
    const started = save();
    return send(started === null ? 503 : 202, status());
  };
}

/**
 * @param {LauncherLog} log
 * @returns {Promise<void>}
 * @throws {Error}
 */
async function main(log) {
  process.stdout.on('error', (error) => {
    if (!consoleGoneCodes.includes(error.code)) {
      throw error;
    }
  });
  const settingsPath = fileURLToPath(new URL('../.env', import.meta.url));
  const unusable = `The Universe settings file ${settingsPath} must be a readable regular file.`;
  let settings = '';
  try {
    if (lstatSync(settingsPath, { throwIfNoEntry: false }) !== undefined) {
      settings = statSync(settingsPath, { throwIfNoEntry: false })?.isFile() ? readFileSync(settingsPath, 'utf8') : null;
    }
  } catch (error) {
    throw new Error(`${unusable} ${error.message}`, { cause: error });
  }
  if (settings === null) {
    throw new Error(unusable);
  }
  const config = projectConfiguration(settings, process.env);
  const state = { phase: SyncPhase.Pulling };
  const stop = new AbortController();
  /**
   * @returns {void}
   */
  const abort = () => stop.abort();
  stopSignals.forEach((name) => process.on(name, abort));
  let requestSave = null;
  const server = createServer(createWrapperHandler(state, config.port,
    /**
     * @returns {?Promise<object|void>}
     * @throws {Error}
     */
    () => (requestSave === null ? null : requestSave())));
  try {
    await new Promise((listening, reject) => {
      server.once('error', reject);
      server.listen(config.port, host, listening);
    });
    log.write(`http://${host}:${config.port}/`);
    await runLauncher(config, stop.signal,
      /**
       * @param {object} next
       * @returns {object}
       */
      (next) => Object.assign(state, next),
      {
        log,
        /**
         * @param {?Function} handler
         * @returns {void}
         */
        onSaveReady(handler) {
          requestSave = handler;
        },
      });
  } finally {
    if (server.listening) {
      await new Promise((done) => server.close(done));
    }
    stopSignals.forEach((name) => process.off(name, abort));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = new LauncherLog(fileURLToPath(new URL('../local/logs/launcher.log', import.meta.url)));
  main(log).catch((error) => {
    if (error.syscall === 'listen') {
      log.write(`Universe launcher failed to listen on ${error.address}:${error.port} (${error.code}).`, console.error);
    } else {
      log.say(error.message, console.error);
    }
    process.exitCode = 1;
  });
}
