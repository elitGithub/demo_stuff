import { CaptureGate } from '../classes/capture-gate.mjs';
import { isId } from '../classes/cloud-save.mjs';

export { CaptureGate };

const gate = new CaptureGate(() => {
  if (process.connected) {
    process.send({ command: 'capture-idle' });
  }
});
let assets;
let enabled = false;

/**
 * @param {Map} sources
 * @returns {void}
 */
export function prepare(sources) {
  assets = sources;
  process.on('message', async message => {
    if (!message || !isId(message.id)) {
      return;
    }
    let state;
    if (message.command === 'capture-acquire') {
      state = enabled ? await gate.acquire(message.id) : 'unavailable';
    } else if (message.command === 'capture-release') {
      gate.release(message.id);
      state = 'released';
    } else {
      return;
    }
    if (process.connected) {
      process.send({ command: 'capture-state', id: message.id, state });
    }
  });
}

/**
 * @param {object} app
 * @returns {void}
 */
export function mountAssets(app) {
  for (const [url, source] of assets) {
    app.get(url, (request, response) => {
      response.set('Cache-Control', 'no-store').type('application/javascript').send(source);
    });
  }
}

/**
 * @param {object} app
 * @returns {void}
 */
export function mountGate(app) {
  app.post('/api/plugins/universe/barrier', (request, response) => {
    const { status, ...state } = gate.control(request.user?.profile?.handle, request.body);
    response.set('Cache-Control', 'no-store').status(status).json(state);
  });
}

/**
 * @param {object} app
 * @returns {void}
 */
export function mountWrites(app) {
  app.use((request, response, next) => {
    if (request.path === '/api/plugins/universe/barrier') {
      next();
    } else {
      void gate.guard(request, response, next).catch(next);
    }
  });
}

/**
 * @param {Function} flush
 * @returns {void}
 */
export function registerFlush(flush) {
  gate.flushes.add(flush);
}

/**
 * @param {Function} work
 * @returns {Promise<unknown>}
 */
export function background(work) {
  return gate.background(work);
}

/**
 * @param {boolean} available
 * @returns {void}
 */
export function ready(available) {
  enabled = available;
  process.send({ command: available ? 'capture-ready' : 'capture-unavailable' });
}
