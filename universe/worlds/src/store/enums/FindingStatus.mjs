export const FindingStatus = Object.freeze({
  Open: 'open',
  Dismissed: 'dismissed',
  Ruled: 'ruled',
  Told: 'told',

  /**
   * @param {string} value
   * @returns {string}
   * @throws {RangeError}
   */
  label(value) {
    switch (value) {
      case 'open': {
        return 'Open';
      }
      case 'dismissed': {
        return 'Dismissed';
      }
      case 'ruled': {
        return 'Ruled';
      }
      case 'told': {
        return 'Told';
      }
      default: {
        throw new RangeError(`Unknown FindingStatus: ${String(value)}`);
      }
    }
  },
});
