import { once } from 'node:events';
import { register } from 'node:module';
import { prepareHooks } from './integration/pinned-hooks.mjs';
import { prepare } from './integration/server-bridge.mjs';

if (process.env.UNIVERSE_CHILD_HANDSHAKE === '1') {
  delete process.env.UNIVERSE_CHILD_HANDSHAKE;
  process.once('disconnect', () => {
    if (process.platform !== 'win32') {
      setTimeout(() => process.kill(process.pid, 'SIGKILL'), 30_000).unref();
    }
    process.kill(process.pid, 'SIGTERM');
  });

  const [message] = await once(process, 'message');
  if (message !== 'universe-start' || !process.connected) {
    process.exit(1);
  }
  try {
    const hooks = await prepareHooks(process.cwd());
    register(new URL('./integration/pinned-hooks.mjs', import.meta.url), { data: hooks.loader });
    prepare(hooks.assets);
  } catch (error) {
    process.send({ command: 'capture-unavailable' });
    console.warn('[universe] Live checkpoints unavailable:', error.message);
  }
  process.channel.unref();
}
