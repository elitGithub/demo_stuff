import { ReplyRetry } from './ReplyRetry.js';

window.fetch = ReplyRetry.wrap(window.fetch.bind(window), {
  /**
   * @param {number} milliseconds
   * @param {AbortSignal} [signal]
   * @returns {Promise<void>}
   * @throws {*}
   */
  wait(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      /**
       * @returns {void}
       */
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, milliseconds);
      signal?.addEventListener('abort', abort, { once: true });
    });
  },
  notify: toastr.warning,
});
