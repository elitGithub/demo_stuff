export const TurnMode = Object.freeze({
  Normal: 'normal',
  Narrator: 'narrator',
  Encounter: 'encounter',

  /**
   * @param {string} value
   * @returns {string}
   * @throws {RangeError}
   */
  label(value) {
    switch (value) {
      case 'normal': {
        return 'Normal';
      }
      case 'narrator': {
        return 'Narrator';
      }
      case 'encounter': {
        return 'Encounter';
      }
      default: {
        throw new RangeError(`Unknown TurnMode: ${String(value)}`);
      }
    }
  },
});
