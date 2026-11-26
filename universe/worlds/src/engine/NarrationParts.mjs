export const NarrationParts = Object.freeze({
  Settings: Object.freeze({
    Joiner: '\n\n',
    Nothing: '',

    /**
     * @returns {RegExp}
     */
    get Tag() {
      return /<narration>([\s\S]*?)<\/narration>/gi;
    },
  }),

  /**
   * @param {string} text
   * @param {string | null} [field]
   * @returns {Readonly<{text: string, narration: string}>}
   * @throws {TypeError}
   */
  split(text, field = null) {
    if (typeof text !== 'string') {
      throw new TypeError('text must be a string.');
    }
    if (field !== null && typeof field !== 'string') {
      throw new TypeError('narration must be null or a string.');
    }
    const settings = NarrationParts.Settings;
    const typed = [];
    const remaining = text.replace(settings.Tag, (whole, body) => {
      typed.push(body.trim());
      return settings.Nothing;
    });
    const parts = [...typed, field === null ? settings.Nothing : field.trim()].filter((part) => part.length > 0);
    return Object.freeze({ text: remaining.trim(), narration: parts.join(settings.Joiner) });
  },
});
