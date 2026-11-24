export const CharacterTier = Object.freeze({
  Main: 'main',
  Recurring: 'recurring',

  /**
   * @param {string} value
   * @returns {string}
   * @throws {RangeError}
   */
  label(value) {
    switch (value) {
      case 'main': {
        return 'Main';
      }
      case 'recurring': {
        return 'Recurring';
      }
      default: {
        throw new RangeError(`Unknown CharacterTier: ${String(value)}`);
      }
    }
  },
});
