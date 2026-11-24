export class RateLimiter {
  static Bucket = Object.freeze({
    Llm: 'llm',
    Api: 'api',
  });

  #nowProvider;
  #windowMs;
  #llmLimit;
  #apiLimit;
  #entries = new Map();

  /**
   * @param {{nowProvider?: () => number, windowMs?: number, llmLimit?: number, apiLimit?: number}} [options]
   * @throws {TypeError | RangeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('RateLimiter options must be a plain object.');
    }

    const {
      nowProvider = Date.now,
      windowMs = 60_000,
      llmLimit = 30,
      apiLimit = 120,
    } = options;

    if (typeof nowProvider !== 'function') {
      throw new TypeError('nowProvider must be a function.');
    }
    if (!Number.isInteger(windowMs) || windowMs <= 0) {
      throw new RangeError('windowMs must be a positive integer.');
    }
    if (!Number.isInteger(llmLimit) || llmLimit <= 0) {
      throw new RangeError('llmLimit must be a positive integer.');
    }
    if (!Number.isInteger(apiLimit) || apiLimit <= 0) {
      throw new RangeError('apiLimit must be a positive integer.');
    }

    this.#nowProvider = nowProvider;
    this.#windowMs = windowMs;
    this.#llmLimit = llmLimit;
    this.#apiLimit = apiLimit;
  }

  /**
   * @param {'llm' | 'api'} bucketName
   * @param {string} [clientKey]
   * @returns {Readonly<{allowed: boolean, retryAfterSeconds: number, remaining: number}>}
   * @throws {RangeError}
   */
  consume(bucketName, clientKey = '127.0.0.1') {
    if (bucketName !== RateLimiter.Bucket.Llm && bucketName !== RateLimiter.Bucket.Api) {
      throw new RangeError(`Invalid rate limiter bucket: ${String(bucketName)}`);
    }
    if (typeof clientKey !== 'string' || clientKey.trim().length === 0) {
      throw new RangeError('clientKey must be a non-empty string.');
    }

    const now = this.#nowProvider();
    if (typeof now !== 'number' || !Number.isFinite(now)) {
      throw new RangeError('nowProvider must return a finite number.');
    }

    const cutoff = now - this.#windowMs;
    for (const [entryKey, entryTimestamps] of this.#entries.entries()) {
      let firstActiveIndex = 0;
      while (firstActiveIndex < entryTimestamps.length && entryTimestamps[firstActiveIndex] <= cutoff) {
        firstActiveIndex += 1;
      }
      if (firstActiveIndex >= entryTimestamps.length) {
        this.#entries.delete(entryKey);
      } else if (firstActiveIndex > 0) {
        this.#entries.set(entryKey, entryTimestamps.slice(firstActiveIndex));
      }
    }

    const limit = bucketName === RateLimiter.Bucket.Llm ? this.#llmLimit : this.#apiLimit;
    const compositeKey = `${bucketName}\0${clientKey.trim()}`;
    let timestamps = this.#entries.get(compositeKey);
    if (timestamps !== undefined && timestamps.length >= limit) {
      const oldestTimestamp = timestamps[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestTimestamp + this.#windowMs - now) / 1000));
      return Object.freeze({
        allowed: false,
        retryAfterSeconds,
        remaining: 0,
      });
    }

    if (timestamps === undefined) {
      timestamps = [];
      this.#entries.set(compositeKey, timestamps);
    }
    timestamps.push(now);

    return Object.freeze({
      allowed: true,
      retryAfterSeconds: 0,
      remaining: limit - timestamps.length,
    });
  }
}
