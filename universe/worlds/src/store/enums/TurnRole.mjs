export const TurnRole = Object.freeze({
  User: 'user',
  Assistant: 'assistant',

  /**
   * @param {string} value
   * @returns {string}
   * @throws {RangeError}
   */
  label(value) {
    switch (value) {
      case 'user': {
        return 'User';
      }
      case 'assistant': {
        return 'Assistant';
      }
      default: {
        throw new RangeError(`Unknown TurnRole: ${String(value)}`);
      }
    }
  },
});
