export const ModelAvailability = Object.freeze({
  Served: 'served',
  Unserved: 'unserved',
  Unchecked: 'unchecked',

  /**
   * @param {string} value
   * @returns {string}
   * @throws {RangeError}
   */
  label(value) {
    switch (value) {
      case 'served': {
        return 'Served';
      }
      case 'unserved': {
        return 'Unserved';
      }
      case 'unchecked': {
        return 'Unchecked';
      }
      default: {
        throw new RangeError(`Unknown ModelAvailability: ${String(value)}`);
      }
    }
  },
});
