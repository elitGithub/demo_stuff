import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { InputError } from '../InputError.mjs';
import { ErrorCode } from '../enums/ErrorCode.mjs';

export class SandboxQueue {
  static #roots = new Map();
  #tail = Promise.resolve();
  /** @param {number} waitMilliseconds */
  constructor(waitMilliseconds) { this.waitMilliseconds = waitMilliseconds; }
  /** @param {string} root @param {number} waitMilliseconds @returns {SandboxQueue} */
  static forRoot(root, waitMilliseconds) {
    if (typeof root !== 'string' || !root || !Number.isSafeInteger(waitMilliseconds) || waitMilliseconds < 1) { throw new TypeError('Invalid sandbox queue.'); }
    const canonical = resolve(root);
    let queue = this.#roots.get(canonical);
    if (!queue) { queue = new SandboxQueue(waitMilliseconds); this.#roots.set(canonical, queue); }
    if (queue.waitMilliseconds !== waitMilliseconds) { throw new TypeError('A runtime root must use one queue timeout.'); }
    return queue;
  }
  /** @template Result @param {()=>Result|Promise<Result>} action @returns {Promise<Result>} */
  run(action) {
    const deadline = performance.now() + this.waitMilliseconds;
    let cancelled = false;
    let started = false;
    let timer;
    const busy = () => new InputError('The demo is busy. Please try again.', 503, ErrorCode.Busy, 2);
    const timeout = new Promise((resolveTimeout, rejectTimeout) => {
      timer = setTimeout(() => { if (!started) { cancelled = true; rejectTimeout(busy()); } }, this.waitMilliseconds);
    });
    const pending = this.#tail.then(async () => {
      if (cancelled || performance.now() >= deadline) { throw busy(); }
      started = true;
      clearTimeout(timer);
      return await action();
    });
    this.#tail = pending.then(() => undefined, () => undefined);
    return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
  }
}
