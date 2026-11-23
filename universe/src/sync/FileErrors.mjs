const missingCodes = Object.freeze(['ENOENT', 'ENOTDIR']);

export const FileErrors = Object.freeze({
  /**
   * @param {Promise} pending
   * @param {string[]} codes
   * @returns {Promise}
   * @throws {Error}
   */
  async tolerate(pending, codes) {
    try {
      return await pending;
    } catch (error) {
      if (codes.includes(error.code)) {
        return null;
      }
      throw error;
    }
  },

  /**
   * @param {Promise} pending
   * @returns {Promise}
   * @throws {Error}
   */
  missing(pending) {
    return FileErrors.tolerate(pending, missingCodes);
  },
});
