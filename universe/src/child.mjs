import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { atomicFile } from './story-files.mjs';
import { isId } from './classes/cloud-save.mjs';

/**
 * @param {object} config
 * @param {string} localOwner
 * @returns {object}
 */
export function startChild(config, localOwner) {
  const environment = Object.fromEntries(Object.entries(config.env).filter(([name]) =>
    !/^(?:R2_|AWS_|CLOUDFLARE_|CF_|NODE_OPTIONS$)/i.test(name)));
  const preload = new URL('./child-preload.mjs', import.meta.url);
  const args = ['--import', preload.href, 'server.js', '--dataRoot', config.dataRoot];
  if (config.configPath) {
    args.push('--configPath', config.configPath);
  }
  const child = spawn(process.execPath, args, {
    cwd: config.sillyTavern,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: { ...environment, UNIVERSE_CHILD_HANDSHAKE: '1' },
  });
  let bridgeReady = false;
  const ready = Promise.withResolvers();
  let captureId = null;
  let reply;
  const idleListeners = new Set();
  child.on('message', message => {
    if (message?.command === 'capture-ready') {
      bridgeReady = true;
      ready.resolve(true);
    } else if (message?.command === 'capture-unavailable') {
      ready.resolve(false);
    } else if (message?.command === 'capture-idle') {
      for (const listener of idleListeners) {
        listener();
      }
    } else if (message?.command === 'capture-state' && message.id === captureId) {
      reply?.(message.state);
    }
  });
  child.on('disconnect', () => {
    bridgeReady = false;
    ready.resolve(false);
    reply?.('unavailable');
  });
  const exchange = (command, accepted, timeout) => new Promise(resolve => {
    const finish = state => {
      clearTimeout(timer);
      reply = null;
      resolve(state);
    };
    const timer = setTimeout(() => finish('pending'), timeout);
    reply = state => {
      if (accepted.includes(state) || state === 'unavailable') {
        finish(state);
      }
    };
    if (!child.connected) {
      finish('unavailable');
      return;
    }
    child.send({ command, id: captureId }, error => {
      if (error && reply) {
        finish('unavailable');
      }
    });
  });
  let launchError;
  const finished = new Promise((resolve) => {
    child.on('error', (error) => { launchError = error; });
    child.once('close', (code, signal) => resolve({ code, signal, launchError }));
  });
  return {
    pid: child.pid,
    finished,
    checkpointReady: ready.promise,
    /**
     * @param {Function} listener
     * @returns {Function}
     */
    onCheckpointIdle(listener) {
      idleListeners.add(listener);
      return () => idleListeners.delete(listener);
    },
    /**
     * @param {string} requestId
     * @param {Function} capture
     * @returns {Promise<object>}
     */
    async withCaptureBarrier(requestId, capture) {
      if (!isId(requestId) || typeof capture !== 'function') {
        throw new TypeError('Expected a checkpoint request ID and capture function.');
      }
      if (!bridgeReady || !child.connected) {
        return { state: 'unavailable' };
      }
      if (captureId) {
        return { state: 'pending' };
      }
      captureId = requestId;
      try {
        const state = await exchange('capture-acquire', ['held', 'pending'], 60_000);
        if (state !== 'held') {
          return { state };
        }
        return { state: 'captured', value: await capture() };
      } finally {
        try {
          const state = await exchange('capture-release', ['released'], 5000);
          if (state !== 'released' && child.connected) {
            throw new Error('SillyTavern did not confirm checkpoint release.');
          }
        } finally {
          captureId = null;
        }
      }
    },
    /**
     * @returns {Promise<void>}
     */
    async allowEdits() {
      if (child.pid === undefined) {
        const result = await finished;
        throw result.launchError ?? new Error('SillyTavern process could not start.');
      }
      await atomicFile(join(localOwner, 'child.json'), JSON.stringify(child.pid));
      await new Promise((resolve, reject) => {
        child.send('universe-start', (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
    /**
     * @returns {Promise<object>}
     */
    async stop() {
      let forced = false;
      const deadline = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          forced = true;
          child.kill('SIGKILL');
        }
      }, 30_000);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
      }
      try {
        const result = await finished;
        return { ...result, forced };
      } finally {
        clearTimeout(deadline);
      }
    },
  };
}
