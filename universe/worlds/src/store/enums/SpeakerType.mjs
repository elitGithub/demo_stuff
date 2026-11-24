export const SpeakerType = Object.freeze({
  Narrator: 'narrator',
  Character: 'character',
  Player: 'player',

  /**
   * @param {string} value
   * @returns {string}
   * @throws {RangeError}
   */
  label(value) {
    switch (value) {
      case 'narrator': {
        return 'Narrator';
      }
      case 'character': {
        return 'Character';
      }
      case 'player': {
        return 'Player';
      }
      default: {
        throw new RangeError(`Unknown SpeakerType: ${String(value)}`);
      }
    }
  },
});
