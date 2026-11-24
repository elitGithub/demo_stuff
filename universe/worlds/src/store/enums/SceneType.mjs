export const SceneType = Object.freeze({
  Public: 'public',
  Private: 'private',

  /**
   * @param {string} value
   * @returns {string}
   * @throws {RangeError}
   */
  label(value) {
    switch (value) {
      case 'public': {
        return 'Public';
      }
      case 'private': {
        return 'Private';
      }
      default: {
        throw new RangeError(`Unknown SceneType: ${String(value)}`);
      }
    }
  },
});
