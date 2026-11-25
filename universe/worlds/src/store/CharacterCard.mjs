export class CharacterCard {
  static AppearanceFields = Object.freeze(['age', 'hair', 'eyes', 'height', 'body', 'face', 'features']);

  static TextFields = Object.freeze([
    'age',
    'hair',
    'eyes',
    'height',
    'body',
    'face',
    'features',
    'traits',
    'habits',
    'behavior',
    'likes',
    'dislikes',
    'sexualityOrientation',
    'sexualityKinks',
    'sexualityLikes',
    'sexualityDislikes',
    'speakingStyle',
    'speakingQuirks',
    'personalitySummary',
    'scenario',
    'characterNote',
  ]);

  /**
   * @param {Record<string, unknown>} values
   * @throws {TypeError}
   */
  constructor(values) {
    if (!CharacterCard.isPlainObject(values)) {
      throw new TypeError('card must be a plain object.');
    }
    const knownFields = new Set([...CharacterCard.TextFields, 'speechExamples', 'filedFactIds']);
    for (const key of Object.keys(values)) {
      if (!knownFields.has(key)) {
        throw new TypeError(`Unsupported card field: ${key}`);
      }
    }

    for (const field of CharacterCard.TextFields) {
      const rawField = values[field];
      const fieldValue = rawField === undefined ? '' : rawField;
      if (typeof fieldValue !== 'string') {
        throw new TypeError(`${field} must be a string.`);
      }
      this[field] = fieldValue;
    }

    const rawExamples = values.speechExamples;
    const speechExamples = rawExamples === undefined ? [] : rawExamples;
    if (!Array.isArray(speechExamples)) {
      throw new TypeError('speechExamples must be an array of strings.');
    }
    const exampleCopy = [...speechExamples];
    for (const entry of exampleCopy) {
      if (typeof entry !== 'string') {
        throw new TypeError('speechExamples must be an array of strings.');
      }
    }

    const rawFiled = values.filedFactIds;
    const filedFactIds = rawFiled === undefined ? {} : rawFiled;
    if (!CharacterCard.isPlainObject(filedFactIds)) {
      throw new TypeError('filedFactIds must be an object.');
    }
    if (Object.getOwnPropertySymbols(filedFactIds).length > 0) {
      throw new TypeError('filedFactIds must not have symbol keys.');
    }
    const filedCopy = { ...filedFactIds };
    for (const [field, factId] of Object.entries(filedCopy)) {
      if (!CharacterCard.AppearanceFields.includes(field)) {
        throw new TypeError(`filedFactIds has an unsupported field: ${field}`);
      }
      if (typeof factId !== 'string' || factId.length === 0) {
        throw new TypeError(`filedFactIds.${field} must be a non-empty string.`);
      }
    }

    this.speechExamples = Object.freeze(exampleCopy);
    this.filedFactIds = Object.freeze(filedCopy);
    Object.freeze(this);
  }

  /**
   * @returns {CharacterCard}
   * @throws {TypeError}
   */
  static empty() {
    return new CharacterCard({});
  }

  /**
   * @param {unknown} value
   * @returns {CharacterCard}
   * @throws {TypeError}
   */
  static fromObject(value) {
    if (value instanceof CharacterCard) {
      return value;
    }
    return new CharacterCard(value);
  }

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  static isPlainObject(value) {
    if (value === null || typeof value !== 'object') {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  /**
   * @returns {Record<string, string | Array<string> | Record<string, string>>}
   */
  toObject() {
    const result = {};
    for (const field of CharacterCard.TextFields) {
      result[field] = this[field];
    }
    result.speechExamples = [...this.speechExamples];
    result.filedFactIds = { ...this.filedFactIds };
    return result;
  }
}
