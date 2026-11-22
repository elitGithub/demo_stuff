import { once } from 'node:events';

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
  process.channel.unref();
}
