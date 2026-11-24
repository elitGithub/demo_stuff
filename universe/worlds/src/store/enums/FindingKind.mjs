export const FindingKind = Object.freeze({
  Contradiction: 'contradiction',
  SecretLeak: 'secret_leak',
  NameMismatch: 'name_mismatch',

  /**
   * @param {string} value
   * @returns {string}
   * @throws {RangeError}
   */
  label(value) {
    switch (value) {
      case 'contradiction': {
        return 'Contradiction';
      }
      case 'secret_leak': {
        return 'Secret Leak';
      }
      case 'name_mismatch': {
        return 'Name Mismatch';
      }
      default: {
        throw new RangeError(`Unknown FindingKind: ${String(value)}`);
      }
    }
  },
});
