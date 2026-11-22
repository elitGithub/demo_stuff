import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { atomicFile } from './story-files.mjs';

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
  let launchError;
  const finished = new Promise((resolve) => {
    child.on('error', (error) => { launchError = error; });
    child.once('close', (code, signal) => resolve({ code, signal, launchError }));
  });
  return {
    pid: child.pid,
    finished,
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
