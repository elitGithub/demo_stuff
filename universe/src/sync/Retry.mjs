import { SyncSettings } from './SyncSettings.mjs';

export const Retry = Object.freeze({
  /**
   * @param {Error} error
   * @returns {boolean}
   */
  retryable(error) {
    return error.status === undefined ?
      (error instanceof TypeError && error.cause !== undefined) || error.name === 'TimeoutError' :
      error.status >= 500 || error.status === 429;
  },

  /**
   * @param {Function} operation
   * @param {{giveUpMs: number, clock: {now: Function, sleep: Function}, onWait: Function, signal?: AbortSignal, window?: {failedAt: ?number}}} options
   * @returns {Promise<*>}
   * @throws {Error}
   */
  async run(operation, { giveUpMs, clock, onWait, signal, window = { failedAt: null } }) {
    if (!Number.isFinite(giveUpMs) || giveUpMs <= 0 || typeof clock?.now !== 'function' || typeof clock?.sleep !== 'function' ||
        typeof window !== 'object' || window === null) {
      throw new TypeError('Retry.run needs a positive finite giveUpMs, a clock with now and sleep, and a window object.');
    }
    let failure = null;
    for (let attempt = 1; ; attempt += 1) {
      signal?.throwIfAborted();
      if (failure !== null && window.failedAt !== null && clock.now() - window.failedAt >= giveUpMs) {
        throw failure;
      }
      try {
        const value = await operation({ signal });
        window.failedAt = null;
        return value;
      } catch (error) {
        signal?.throwIfAborted();
        if (!Retry.retryable(error)) {
          throw error;
        }
        window.failedAt ??= clock.now();
        const remainingMs = giveUpMs - (clock.now() - window.failedAt);
        if (remainingMs <= 0) {
          throw error;
        }
        failure = error;
        const delays = SyncSettings.RetryDelaysMs;
        const nextMs = Math.min(delays[Math.min(attempt, delays.length) - 1], remainingMs);
        onWait({ attempt, error, nextMs });
        signal?.throwIfAborted();
        await new Promise((resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal?.addEventListener('abort', abort, { once: true });
          clock.sleep(nextMs, signal).then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
        });
      }
    }
  },
});
