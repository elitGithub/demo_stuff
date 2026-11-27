/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export const RequestBudget = Object.freeze({
  StartingCharsPerToken: 3,

  /**
   * @param {{store: {lowestCharsPerToken: (model: string) => number | null, lowestCharsPerTokenOverall: () => number | null}, model: string}} [options]
   * @returns {number}
   * @throws {TypeError | RangeError | Error}
   */
  charsPerToken(options = {}) {
    if (!isPlainObject(options)) {
      throw new TypeError('RequestBudget.charsPerToken options must be a plain object.');
    }
    const { store, model } = options;
    if (
      store === null ||
      typeof store !== 'object' ||
      Array.isArray(store) ||
      typeof store.lowestCharsPerToken !== 'function' ||
      typeof store.lowestCharsPerTokenOverall !== 'function'
    ) {
      throw new TypeError('store must provide lowestCharsPerToken() and lowestCharsPerTokenOverall().');
    }
    if (typeof model !== 'string') {
      throw new TypeError('model must be a non-empty string.');
    }
    const trimmedModel = model.trim();
    if (trimmedModel.length === 0) {
      throw new RangeError('model must be a non-empty string.');
    }
    const modelRatio = store.lowestCharsPerToken(trimmedModel);
    if (typeof modelRatio === 'number' && Number.isFinite(modelRatio) && modelRatio > 0) {
      return modelRatio;
    }
    const overallRatio = store.lowestCharsPerTokenOverall();
    if (typeof overallRatio === 'number' && Number.isFinite(overallRatio) && overallRatio > 0) {
      return overallRatio;
    }
    return RequestBudget.StartingCharsPerToken;
  },

  /**
   * @param {{contextLength: number | null, replyReserve: number, charsPerToken: number}} [options]
   * @returns {Readonly<{limitTokens: number | null, estimate: (text: string) => number, fits: (usedTokens: number, text: string) => boolean}>}
   * @throws {TypeError | RangeError}
   */
  create(options = {}) {
    if (!isPlainObject(options)) {
      throw new TypeError('RequestBudget.create options must be a plain object.');
    }
    const { contextLength, replyReserve, charsPerToken } = options;
    if (contextLength !== null) {
      if (typeof contextLength !== 'number') {
        throw new TypeError('contextLength must be null or a positive integer.');
      }
      if (!Number.isInteger(contextLength) || contextLength <= 0) {
        throw new RangeError('contextLength must be null or a positive integer.');
      }
    }
    if (typeof replyReserve !== 'number') {
      throw new TypeError('replyReserve must be a positive integer.');
    }
    if (!Number.isInteger(replyReserve) || replyReserve <= 0) {
      throw new RangeError('replyReserve must be a positive integer.');
    }
    if (typeof charsPerToken !== 'number') {
      throw new TypeError('charsPerToken must be a finite positive number.');
    }
    if (!Number.isFinite(charsPerToken) || charsPerToken <= 0) {
      throw new RangeError('charsPerToken must be a finite positive number.');
    }

    const limitTokens = contextLength === null ? null : Math.max(0, contextLength - replyReserve);

    /**
     * @param {string} text
     * @returns {number}
     * @throws {TypeError}
     */
    const estimate = (text) => {
      if (typeof text !== 'string') {
        throw new TypeError('text must be a string.');
      }
      if (text.length === 0) {
        return 0;
      }
      return Math.ceil(text.length / charsPerToken);
    };

    /**
     * @param {number} usedTokens
     * @param {string} text
     * @returns {boolean}
     * @throws {TypeError | RangeError}
     */
    const fits = (usedTokens, text) => {
      if (typeof usedTokens !== 'number') {
        throw new TypeError('usedTokens must be a finite non-negative number.');
      }
      if (!Number.isFinite(usedTokens) || usedTokens < 0) {
        throw new RangeError('usedTokens must be a finite non-negative number.');
      }
      const neededTokens = estimate(text);
      if (limitTokens === null) {
        return true;
      }
      return usedTokens + neededTokens <= limitTokens;
    };

    return Object.freeze({ limitTokens, estimate, fits });
  },
});
