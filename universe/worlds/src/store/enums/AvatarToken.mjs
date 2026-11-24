export const AvatarToken = Object.freeze({
  Sage: 'sage',
  Rose: 'rose',
  Amber: 'amber',
  Slate: 'slate',
  Plum: 'plum',
  Teal: 'teal',
  Indigo: 'indigo',
  Coral: 'coral',

  /**
   * @param {string} value
   * @returns {string}
   * @throws {RangeError}
   */
  label(value) {
    switch (value) {
      case 'sage': {
        return 'Sage';
      }
      case 'rose': {
        return 'Rose';
      }
      case 'amber': {
        return 'Amber';
      }
      case 'slate': {
        return 'Slate';
      }
      case 'plum': {
        return 'Plum';
      }
      case 'teal': {
        return 'Teal';
      }
      case 'indigo': {
        return 'Indigo';
      }
      case 'coral': {
        return 'Coral';
      }
      default: {
        throw new RangeError(`Unknown AvatarToken: ${String(value)}`);
      }
    }
  },
});
