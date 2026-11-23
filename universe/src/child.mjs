import { spawn } from 'node:child_process';

const killAfterMs = 15_000;
const withheld = /^(?:R2_|AWS_|CLOUDFLARE_|CF_|NODE_OPTIONS$)/i;
const watchdog = new URL('./child-watchdog.mjs', import.meta.url).href;

/**
 * @param {{env: object, dataRoot: string, sillyTavern: string, configPath?: string}} config
 * @returns {{pid: ?number, finished: Promise<{code: ?number, signal: ?string, launchError: ?Error}>, stop: Function}}
 * @throws {TypeError}
 */
export function startChild(config) {
  const args = ['--import', watchdog, 'server.js', '--dataRoot', config.dataRoot];
  if (config.configPath) {
    args.push('--configPath', config.configPath);
  }
  const child = spawn(process.execPath, args, {
    cwd: config.sillyTavern,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: Object.fromEntries(Object.entries(config.env).filter(([name]) => !withheld.test(name))),
  });
  let launchError = null;
  child.on('error', (error) => {
    launchError = error;
  });
  const finished = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal, launchError }));
  });
  return {
    pid: child.pid ?? null,
    finished,
    /**
     * @returns {Promise<{code: ?number, signal: ?string, launchError: ?Error}>}
     */
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
      }
      const deadline = setTimeout(() => child.kill('SIGKILL'), killAfterMs);
      try {
        return await finished;
      } finally {
        clearTimeout(deadline);
      }
    },
  };
}
