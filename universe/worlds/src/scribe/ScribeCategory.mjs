import { ScribeText } from './ScribeText.mjs';

export const ScribeCategory = Object.freeze({
  Kind: Object.freeze({
    Fixed: 'Fixed',
    Moving: 'Moving',
    List: 'List',
    Passing: 'Passing',
  }),

  SubjectKinds: Object.freeze({
    Character: 'character',
    Group: 'group',
    Place: 'place',
    Item: 'item',
    World: 'world',
  }),

  Settings: Object.freeze({
    Words: Object.freeze({
      Fixed: Object.freeze(['kind', 'age', 'eyes', 'hair', 'build', 'skin']),
      Moving: Object.freeze(['status', 'location', 'role']),
      List: Object.freeze(['aka', 'title', 'appearance', 'ability', 'belonging', 'background', 'trait', 'feature', 'rule']),
      Passing: Object.freeze(['condition']),
    }),
    RelationCategory: 'relation',

    /**
     * @returns {RegExp}
     */
    get RelationPattern() {
      return /^(?:relation\s+(?:to|with|towards?)|towards?)\s+(.+)$/i;
    },
    TargetGroup: 1,
    NumberWords: Object.freeze([
      'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
      'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
    ]),
    Millimeters: Object.freeze({
      mm: 1,
      millimeter: 1,
      cm: 10,
      centimeter: 10,
      meter: 1000,
      km: 1000000,
      kilometer: 1000000,
      in: 25.4,
      inch: 25.4,
      '"': 25.4,
      '″': 25.4,
      ft: 304.8,
      foot: 304.8,
      "'": 304.8,
      '′': 304.8,
      yd: 914.4,
      yard: 914.4,
      ...{ m: 1000 },
    }),
    Grams: Object.freeze({
      gram: 1,
      kg: 1000,
      kilogram: 1000,
      lb: 453.59237,
      pound: 453.59237,
      oz: 28.349523125,
      ounce: 28.349523125,
      ...{ g: 1 },
    }),
  }),

  /**
   * @param {string} raw
   * @returns {Readonly<{category: string, kind: string, target: string | null}> | null}
   * @throws {TypeError}
   */
  parse(raw) {
    if (typeof raw !== 'string') {
      throw new TypeError('raw category must be a string.');
    }
    const settings = ScribeCategory.Settings;
    const trimmed = raw.trim();
    const relation = trimmed.match(settings.RelationPattern);
    if (relation !== null) {
      return Object.freeze({
        category: settings.RelationCategory,
        kind: ScribeCategory.Kind.Moving,
        target: relation[settings.TargetGroup],
      });
    }
    const category = trimmed.toLowerCase();
    for (const [kindName, words] of Object.entries(settings.Words)) {
      if (words.includes(category)) {
        return Object.freeze({ category, kind: ScribeCategory.Kind[kindName], target: null });
      }
    }
    return trimmed && !/[\r\n|]/u.test(trimmed)
      ? Object.freeze({ category: trimmed, kind: ScribeCategory.Kind.List, target: null })
      : null;
  },

  /**
   * @param {object} statement
   * @returns {object}
   */
  scope(statement) {
    if (statement.category !== 'build') {
      return {};
    }
    if ('form' in statement || 'dimension' in statement) {
      const form = statement.form?.trim().toLowerCase().replace(/\s+/g, ' ') || null;
      const dimension = statement.dimension?.trim().toLowerCase() || null;
      return { form, dimension };
    }
    const text = statement.text ?? '';
    const forms = [...text.matchAll(/\b(human|full[- ]dragon|dragon)\s+form\b/gi)];
    const dimensions = new Set();
    if (
      /\b(height|tall)\b/i.test(text) ||
      (
        /\bhuman form\b/i.test(text) &&
        !/\b(length|long)\b/i.test(text) &&
        /\b(?:\d+|four|five|six|seven)\s*(?:foot|feet|ft)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\b/i.test(text)
      )
    ) {
      dimensions.add('height');
    }
    if (/\b(length|long)\b/i.test(text)) {
      dimensions.add('length');
    }
    if (forms.length > 1 || dimensions.size > 1) {
      return {};
    }
    const form = forms[0]?.[1].toLowerCase().replace('-', ' ') ?? null;
    const dimension = [...dimensions][0] ?? null;
    return dimension ? { form, dimension } : {};
  },

  /**
   * @param {object} first
   * @param {object} second
   * @returns {boolean}
   */
  sameScope(first, second) {
    const left = ScribeCategory.scope(first);
    const right = ScribeCategory.scope(second);
    return (left.form ?? null) === (right.form ?? null) && (left.dimension ?? null) === (right.dimension ?? null);
  },

  /**
   * @param {object} fact
   * @returns {string}
   */
  displayValue(fact) {
    const attribute = fact.ruledAttribute;
    if (
      !attribute ||
      !fact.evidence ||
      fact.evidence.attribute !== attribute ||
      fact.evidence.value !== fact.text ||
      ScribeCategory.same(attribute, fact.category) ||
      (' ' + ScribeText.words(fact.text).join(' ') + ' ').includes(' ' + ScribeText.words(attribute).join(' ') + ' ')
    ) {
      return fact.text;
    }
    return attribute + ' ' + fact.text;
  },

  /**
   * @param {object} fact
   * @returns {string}
   * @throws {TypeError}
   */
  value(fact) {
    const { form, dimension } = ScribeCategory.scope(fact);
    const ordinary = ScribeText.words(fact.text).join(' ');
    if (!dimension) {
      return ordinary;
    }
    const settings = ScribeCategory.Settings;
    const words = settings.NumberWords;
    let text = fact.text.trim().toLowerCase().replace(/\b[a-z]+\b/g, (word) => {
      return words.includes(word) ? String(words.indexOf(word)) : word;
    });
    if (form) {
      for (const spelling of new Set([form, form.replaceAll(' ', '-')])) {
        const phrase = spelling + ' form';
        const description = text.replace(/^(?:her|his|their|its|my|our|the)\s+/, '');
        if (description.startsWith(phrase + ' ')) {
          text = description.slice(phrase.length).trimStart();
        }
        for (const determiner of ['', 'her ', 'his ', 'its ', 'their ']) {
          text = text.replace('in ' + determiner + phrase, '');
        }
      }
    }
    text = text.trim().replace(/^(?:(?:she|he|it|they)\s+)?(?:is|was|measures|measured|stands|stood)\s+/, '');
    if (text.startsWith(dimension + ' ') || text.startsWith(dimension + ':')) {
      text = text.slice(dimension.length).replace(/^\s*[:=]?\s*/, '');
    }
    text = text.replace(/[.!]$/, '').trim();
    const endings = {
      height: /\s+(?:tall|in height)$/,
      length: /\s+(?:long|in length)$/,
      width: /\s+(?:wide|in width)$/,
    };
    if (Object.hasOwn(endings, dimension)) {
      text = text.replace(endings[dimension], '');
    }
    const measure = text.match(/^(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*([a-z]+|["″'′])(?:\s*(\d+(?:\.\d+)?)\s*(?:inches|inch|in|["″])?)?$/);
    if (measure) {
      const unit = measure[3].replace('inches', 'inch').replace('feet', 'foot').replace('metre', 'meter').replace(/s$/, '');
      const length = ['height', 'length', 'width', 'wingspan', 'diameter', 'depth'].includes(dimension);
      const mass = ['weight', 'mass'].includes(dimension);
      const scales = length ? settings.Millimeters : settings.Grams;
      if ((length || mass) && Object.hasOwn(scales, unit) && (!measure[4] || ['ft', 'foot', "'", '′'].includes(unit))) {
        const number = Number(measure[1].replaceAll(',', '') + (measure[2] ?? ''));
        const total = number * scales[unit] + Number(measure[4] ?? 0) * settings.Millimeters.in;
        if (Number.isFinite(total)) {
          return (length ? 'mm:' : 'g:') + Number(total.toPrecision(15));
        }
      }
    }
    return fact.text.trim().toLowerCase().replace(/\s+/g, ' ');
  },

  /**
   * @param {string} earlier
   * @param {string} later
   * @returns {boolean}
   */
  same(earlier, later) {
    const earlierWords = ScribeText.words(earlier);
    const laterWords = ScribeText.words(later);
    if (earlierWords.length !== laterWords.length) {
      return false;
    }
    for (let index = 0; index < earlierWords.length; index += 1) {
      if (earlierWords[index] !== laterWords[index]) {
        return false;
      }
    }
    return true;
  },
});
