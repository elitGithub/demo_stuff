const exitAfterMs = 15_000;

process.on('disconnect', () => {
  process.kill(process.pid, 'SIGTERM');
  setTimeout(() => process.exit(1), exitAfterMs).unref();
});
process.on('SIGHUP', () => {
  process.kill(process.pid, 'SIGTERM');
});
process.channel?.unref();
