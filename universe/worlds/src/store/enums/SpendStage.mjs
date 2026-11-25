export const SpendStage = Object.freeze({
  Director: 'director',
  Mind: 'mind',
  Composer: 'composer',
  Scribe: 'scribe',
  Pedant: 'pedant',
  Muse: 'muse',

  /**
   * @param {string} value
   * @returns {string}
   * @throws {RangeError}
   */
  label(value) {
    switch (value) {
      case 'director': {
        return 'Director';
      }
      case 'mind': {
        return 'Brain';
      }
      case 'composer': {
        return 'Narrator';
      }
      case 'scribe': {
        return 'Scribe';
      }
      case 'pedant': {
        return 'Pedant';
      }
      case 'muse': {
        return 'Muse';
      }
      default: {
        throw new RangeError(`Unknown SpendStage: ${String(value)}`);
      }
    }
  },
});
