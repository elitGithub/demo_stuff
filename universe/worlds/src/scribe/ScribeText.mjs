export const ScribeText = Object.freeze({
  Settings: Object.freeze({
    NormalForm: 'NFC',
    DecomposedForm: 'NFD',
    Nothing: '',
    Space: ' ',
    PlainApostrophe: "'",
    FirstCapture: '$1',

    /**
     * @returns {RegExp}
     */
    get StrippedMarks() {
      return /[“”"*`#]/g;
    },

    /**
     * @returns {RegExp}
     */
    get HonorificSuffix() {
      return /[-‐‑‒–—−－](?:san|kun|chan|sama)(?![\p{L}\p{N}])/gu;
    },

    /**
     * @returns {RegExp}
     */
    get Apostrophes() {
      return /[’‘´ʼ]/g;
    },

    /**
     * @returns {RegExp}
     */
    get WrappingQuotes() {
      return /^'\s*(.*?)\s*'$/;
    },

    /**
     * @returns {RegExp}
     */
    get FullStops() {
      return /\./g;
    },

    /**
     * @returns {RegExp}
     */
    get Whitespace() {
      return /\s+/g;
    },

    /**
     * @returns {RegExp}
     */
    get Digits() {
      return /\d/g;
    },

    /**
     * @returns {RegExp}
     */
    get LeadingThe() {
      return /^the /;
    },

    /**
     * @returns {RegExp}
     */
    get LatinAccents() {
      return /(\p{Script=Latin})[\u{300}-\u{333}\u{339}-\u{36F}]+/gu;
    },

    /**
     * @returns {RegExp}
     */
    get WordPattern() {
      return /[\p{L}\p{M}]+|\p{N}+|\p{S}/gu;
    },

    Spellings: Object.freeze([
      Object.freeze({ British: 'grey', American: 'gray' }),
      Object.freeze({ British: 'blonde', American: 'blond' }),
      Object.freeze({ British: 'colour', American: 'color' }),
      Object.freeze({ British: 'armour', American: 'armor' }),
      Object.freeze({ British: 'honour', American: 'honor' }),
      Object.freeze({ British: 'favour', American: 'favor' }),
      Object.freeze({ British: 'flavour', American: 'flavor' }),
      Object.freeze({ British: 'neighbour', American: 'neighbor' }),
      Object.freeze({ British: 'jewellery', American: 'jewelry' }),
      Object.freeze({ British: 'moustache', American: 'mustache' }),
      Object.freeze({ British: 'centre', American: 'center' }),
      Object.freeze({ British: 'metre', American: 'meter' }),
      Object.freeze({ British: 'fibre', American: 'fiber' }),
      Object.freeze({ British: 'lustre', American: 'luster' }),
      Object.freeze({ British: 'ochre', American: 'ocher' }),
      Object.freeze({ British: 'pyjama', American: 'pajama' }),
      Object.freeze({ British: 'dishevelled', American: 'disheveled' }),
      Object.freeze({ British: 'ageing', American: 'aging' }),
    ]),
    ShortestResemblingLength: 4,
    LongNameLength: 8,
    ShortNameDistance: 1,
    LongNameDistance: 2,
    FnvOffset: 0x811c9dc5,
    FnvPrime: 0x01000193,
    HexRadix: 16,
    HexWidth: 8,
    HexPad: '0',
  }),

  /**
   * @param {string} name
   * @returns {string}
   * @throws {TypeError}
   */
  normaliseName(name) {
    if (typeof name !== 'string') {
      throw new TypeError('name must be a string.');
    }
    const settings = ScribeText.Settings;
    return name
      .normalize(settings.NormalForm)
      .replace(settings.StrippedMarks, settings.Nothing)
      .toLowerCase()
      .replace(settings.HonorificSuffix, settings.Nothing)
      .replace(settings.Apostrophes, settings.PlainApostrophe)
      .replace(settings.FullStops, settings.Space)
      .replace(settings.Whitespace, settings.Space)
      .trim()
      .replace(settings.WrappingQuotes, settings.FirstCapture)
      .replace(settings.LeadingThe, settings.Nothing);
  },

  /**
   * @param {string} text
   * @returns {readonly string[]}
   * @throws {TypeError}
   */
  words(text) {
    if (typeof text !== 'string') {
      throw new TypeError('text must be a string.');
    }
    const settings = ScribeText.Settings;
    const folded = text
      .toLowerCase()
      .normalize(settings.DecomposedForm)
      .replace(settings.LatinAccents, settings.FirstCapture)
      .normalize(settings.NormalForm);
    const found = [];
    for (const [matched] of folded.matchAll(settings.WordPattern)) {
      let word = matched;
      for (const spelling of settings.Spellings) {
        word = word.replaceAll(spelling.British, spelling.American);
      }
      found.push(word);
    }
    return Object.freeze(found);
  },

  /**
   * @param {string} first
   * @param {string} second
   * @returns {number}
   * @throws {TypeError}
   */
  distance(first, second) {
    if (typeof first !== 'string' || typeof second !== 'string') {
      throw new TypeError('first and second must be strings.');
    }
    const firstUnits = Array.from(first);
    const secondUnits = Array.from(second);
    let previous = [];
    for (let index = 0; index <= secondUnits.length; index += 1) {
      previous.push(index);
    }
    for (let row = 1; row <= firstUnits.length; row += 1) {
      const current = [row];
      for (let column = 1; column <= secondUnits.length; column += 1) {
        const substitution = previous[column - 1] + (firstUnits[row - 1] === secondUnits[column - 1] ? 0 : 1);
        current.push(Math.min(previous[column] + 1, current[column - 1] + 1, substitution));
      }
      previous = current;
    }
    return previous[secondUnits.length];
  },

  /**
   * @param {string} first
   * @param {string} second
   * @returns {boolean}
   * @throws {TypeError}
   */
  resembles(first, second) {
    if (typeof first !== 'string' || typeof second !== 'string') {
      throw new TypeError('first and second must be strings.');
    }
    const settings = ScribeText.Settings;
    const firstName = ScribeText.normaliseName(first);
    const secondName = ScribeText.normaliseName(second);
    const firstWithoutDigits = firstName.replace(settings.Digits, settings.Nothing);
    const secondWithoutDigits = secondName.replace(settings.Digits, settings.Nothing);
    if (firstName === secondName || firstWithoutDigits === secondWithoutDigits) {
      return false;
    }
    const shorter = Math.min(Array.from(firstName).length, Array.from(secondName).length);
    if (shorter < settings.ShortestResemblingLength) {
      return false;
    }
    const allowed = shorter < settings.LongNameLength ? settings.ShortNameDistance : settings.LongNameDistance;
    return ScribeText.distance(firstName, secondName) <= allowed;
  },

  /**
   * @param {string} text
   * @returns {string}
   * @throws {TypeError}
   */
  fingerprint(text) {
    if (typeof text !== 'string') {
      throw new TypeError('text must be a string.');
    }
    const settings = ScribeText.Settings;
    let hash = settings.FnvOffset;
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), settings.FnvPrime);
    }
    return (hash >>> 0).toString(settings.HexRadix).padStart(settings.HexWidth, settings.HexPad);
  },

  /**
   * @param {string} text
   * @returns {number}
   * @throws {TypeError}
   */
  bytes(text) {
    if (typeof text !== 'string') {
      throw new TypeError('text must be a string.');
    }
    return new TextEncoder().encode(text).length;
  },
});
