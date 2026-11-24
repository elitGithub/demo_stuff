import { SpeakerType } from '../store/enums/SpeakerType.mjs';

export class BeatParser {
  #validSlugSet;
  #nameMap;
  #slugToName;
  #playerSlug;
  #buffer = '';
  #awaitingPostTagNewline = null;
  #pendingSpeaker = {
    speakerType: SpeakerType.Narrator,
    slug: 'narrator',
    speakerName: 'Narrator',
  };
  #currentSegment = null;
  #pendingParagraphBreak = false;
  #segments = [];
  #playerBeatRemapped = false;

  /**
   * @param {{validSlugs?: ReadonlyArray<string>, nameToSlug?: Record<string, string>, slugToName?: Record<string, string>, playerSlug?: string | null}} [options]
   * @throws {TypeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('BeatParser options must be a plain object.');
    }

    const {
      validSlugs = [],
      nameToSlug = {},
      slugToName = {},
      playerSlug = null,
    } = options;

    if (!Array.isArray(validSlugs)) {
      throw new TypeError('validSlugs must be an array.');
    }
    if (nameToSlug === null || typeof nameToSlug !== 'object' || Array.isArray(nameToSlug)) {
      throw new TypeError('nameToSlug must be a plain object.');
    }
    if (slugToName === null || typeof slugToName !== 'object' || Array.isArray(slugToName)) {
      throw new TypeError('slugToName must be a plain object.');
    }
    if (playerSlug !== null && typeof playerSlug !== 'string') {
      throw new TypeError('playerSlug must be null or a string.');
    }

    const normalizedPlayerSlug = typeof playerSlug === 'string' && playerSlug.trim().length > 0
      ? playerSlug.trim().toLowerCase()
      : null;
    this.#playerSlug = normalizedPlayerSlug;

    this.#validSlugSet = new Set();
    for (const rawSlug of validSlugs) {
      if (typeof rawSlug !== 'string') {
        throw new TypeError('validSlugs entries must be strings.');
      }
      const normalizedSlug = rawSlug.trim().toLowerCase();
      if (normalizedSlug.length > 0 && normalizedSlug !== 'narrator' && normalizedSlug !== normalizedPlayerSlug) {
        this.#validSlugSet.add(normalizedSlug);
      }
    }

    this.#slugToName = new Map();
    for (const [rawSlug, rawName] of Object.entries(slugToName)) {
      const normalizedSlug = rawSlug.trim().toLowerCase();
      if (this.#validSlugSet.has(normalizedSlug) && typeof rawName === 'string' && rawName.trim().length > 0) {
        this.#slugToName.set(normalizedSlug, rawName.trim());
      }
    }

    this.#nameMap = new Map();
    for (const [rawName, rawTargetSlug] of Object.entries(nameToSlug)) {
      if (typeof rawTargetSlug !== 'string') {
        continue;
      }
      const normalizedKey = rawName.trim().toLowerCase();
      const normalizedSlug = rawTargetSlug.trim().toLowerCase();
      if (normalizedKey.length === 0) {
        continue;
      }
      if (normalizedSlug === normalizedPlayerSlug || this.#validSlugSet.has(normalizedSlug)) {
        this.#nameMap.set(normalizedKey, normalizedSlug);
      }
    }
  }

  /**
   * @param {string} chunk
   * @returns {Array<{beatIndex: number, speakerType: string, slug: string, speakerName: string, delta: string}>}
   * @throws {TypeError}
   */
  push(chunk) {
    if (typeof chunk !== 'string') {
      throw new TypeError('chunk must be a string.');
    }
    const emitted = [];
    if (chunk.length === 0) {
      return emitted;
    }

    this.#buffer += chunk;

    while (this.#buffer.length > 0) {
      if (this.#awaitingPostTagNewline === 'start') {
        if (this.#buffer[0] === '\n') {
          this.#buffer = this.#buffer.slice(1);
          this.#awaitingPostTagNewline = null;
          continue;
        }
        if (this.#buffer[0] === '\r') {
          this.#buffer = this.#buffer.slice(1);
          this.#awaitingPostTagNewline = 'seen_cr';
          continue;
        }
        this.#awaitingPostTagNewline = null;
      }

      if (this.#awaitingPostTagNewline === 'seen_cr') {
        if (this.#buffer[0] === '\n') {
          this.#buffer = this.#buffer.slice(1);
          this.#awaitingPostTagNewline = null;
          continue;
        }
        this.#awaitingPostTagNewline = null;
        this.#emitText('\r', emitted);
        continue;
      }

      const openIndex = this.#buffer.indexOf('[');
      if (openIndex === -1) {
        this.#emitText(this.#buffer, emitted);
        this.#buffer = '';
        break;
      }
      if (openIndex > 0) {
        this.#emitText(this.#buffer.slice(0, openIndex), emitted);
        this.#buffer = this.#buffer.slice(openIndex);
        continue;
      }

      const tagMatch = /^\[\[\s*beat\s*:([\s\S]*?)\]\]/i.exec(this.#buffer);
      if (
        tagMatch !== null &&
        tagMatch[0].length <= 128 &&
        !tagMatch[1].includes('[[') &&
        !/[\r\n]/.test(tagMatch[1])
      ) {
        const rawTarget = tagMatch[1].trim().toLowerCase();
        this.#buffer = this.#buffer.slice(tagMatch[0].length);
        this.#awaitingPostTagNewline = 'start';

        let resolvedSpeaker = {
          speakerType: SpeakerType.Narrator,
          slug: 'narrator',
          speakerName: 'Narrator',
        };
        if (rawTarget.length > 0 && rawTarget !== 'narrator') {
          if (this.#playerSlug !== null && rawTarget === this.#playerSlug) {
            this.#playerBeatRemapped = true;
          } else {
            const mappedByName = this.#nameMap.get(rawTarget);
            if (mappedByName !== undefined) {
              if (this.#playerSlug !== null && mappedByName === this.#playerSlug) {
                this.#playerBeatRemapped = true;
              } else if (this.#validSlugSet.has(mappedByName)) {
                resolvedSpeaker = {
                  speakerType: SpeakerType.Character,
                  slug: mappedByName,
                  speakerName: this.#slugToName.get(mappedByName) ?? mappedByName,
                };
              }
            } else if (this.#validSlugSet.has(rawTarget)) {
              resolvedSpeaker = {
                speakerType: SpeakerType.Character,
                slug: rawTarget,
                speakerName: this.#slugToName.get(rawTarget) ?? rawTarget,
              };
            }
          }
        }

        const lastSegment = this.#segments.at(-1);
        if (
          lastSegment !== undefined &&
          lastSegment.speakerType === resolvedSpeaker.speakerType &&
          lastSegment.slug === resolvedSpeaker.slug
        ) {
          this.#currentSegment = lastSegment;
          this.#pendingParagraphBreak = true;
        } else {
          this.#currentSegment = null;
          this.#pendingParagraphBreak = false;
        }
        this.#pendingSpeaker = resolvedSpeaker;
        continue;
      }

      let isPartialPrefix = false;
      if (this.#buffer.length < 128) {
        if (this.#buffer === '[') {
          isPartialPrefix = true;
        } else if (this.#buffer.startsWith('[[')) {
          const afterDouble = this.#buffer.slice(2).replace(/^[ \t]+/, '');
          if (afterDouble.length === 0) {
            isPartialPrefix = true;
          } else if (afterDouble.length <= 4) {
            isPartialPrefix = 'beat'.startsWith(afterDouble.toLowerCase());
          } else if (afterDouble.slice(0, 4).toLowerCase() === 'beat') {
            const afterWord = afterDouble.slice(4).replace(/^[ \t]+/, '');
            if (afterWord.length === 0) {
              isPartialPrefix = true;
            } else if (afterWord[0] === ':') {
              const targetBody = afterWord.slice(1);
              isPartialPrefix = !targetBody.includes('[[') && !/[\r\n]/.test(targetBody);
            }
          }
        }
      }

      if (isPartialPrefix) {
        break;
      }

      const nextOpen = this.#buffer.indexOf('[', 1);
      const emitLength = nextOpen === -1 ? this.#buffer.length : nextOpen;
      this.#emitText(this.#buffer.slice(0, emitLength), emitted);
      this.#buffer = this.#buffer.slice(emitLength);
    }

    return emitted;
  }

  /**
   * @returns {Array<{beatIndex: number, speakerType: string, slug: string, speakerName: string, delta: string}>}
   */
  flush() {
    const emitted = [];
    if (this.#awaitingPostTagNewline === 'seen_cr') {
      this.#awaitingPostTagNewline = null;
      this.#emitText('\r', emitted);
    } else {
      this.#awaitingPostTagNewline = null;
    }
    if (this.#buffer.length > 0) {
      this.#emitText(this.#buffer, emitted);
      this.#buffer = '';
    }
    return emitted;
  }

  /**
   * @returns {ReadonlyArray<Readonly<{speakerType: string, slug: string, speakerName: string, text: string}>>}
   */
  getBeats() {
    const beats = [];
    for (const segment of this.#segments) {
      const trimmedText = segment.text.trim();
      if (trimmedText.length === 0) {
        continue;
      }
      beats.push(
        Object.freeze({
          speakerType: segment.speakerType,
          slug: segment.slug,
          speakerName: segment.speakerName,
          text: trimmedText,
        }),
      );
    }
    return Object.freeze(beats);
  }

  /**
   * @returns {boolean}
   */
  wasPlayerBeatRemapped() {
    return this.#playerBeatRemapped;
  }

  /**
   * @param {string} deltaText
   * @param {Array<{beatIndex: number, speakerType: string, slug: string, speakerName: string, delta: string}>} emitted
   * @returns {void}
   */
  #emitText(deltaText, emitted) {
    if (deltaText.length === 0) {
      return;
    }

    if (this.#currentSegment === null) {
      const firstNonWhitespace = deltaText.search(/\S/);
      if (firstNonWhitespace === -1) {
        return;
      }
      const cleanStart = deltaText.slice(firstNonWhitespace);
      this.#currentSegment = {
        beatIndex: this.#segments.length,
        speakerType: this.#pendingSpeaker.speakerType,
        slug: this.#pendingSpeaker.slug,
        speakerName: this.#pendingSpeaker.speakerName,
        text: cleanStart,
      };
      this.#pendingParagraphBreak = false;
      this.#segments.push(this.#currentSegment);
      emitted.push({
        beatIndex: this.#currentSegment.beatIndex,
        speakerType: this.#currentSegment.speakerType,
        slug: this.#currentSegment.slug,
        speakerName: this.#currentSegment.speakerName,
        delta: cleanStart,
      });
      return;
    }

    if (this.#pendingParagraphBreak) {
      const firstNonWhitespace = deltaText.search(/\S/);
      if (firstNonWhitespace === -1) {
        return;
      }
      this.#pendingParagraphBreak = false;
      const cleanStart = deltaText.slice(firstNonWhitespace);
      const trailingBreaksMatch = /(?:\r?\n)+$/.exec(this.#currentSegment.text);
      const existingBreakCount = trailingBreaksMatch === null
        ? 0
        : trailingBreaksMatch[0].split('\n').length - 1;
      const separator = existingBreakCount >= 2
        ? ''
        : existingBreakCount === 1
          ? '\n'
          : '\n\n';
      const trimmedPrevious = this.#currentSegment.text.replace(/\s+$/, '');
      this.#currentSegment.text = `${trimmedPrevious}\n\n${cleanStart}`;
      emitted.push({
        beatIndex: this.#currentSegment.beatIndex,
        speakerType: this.#currentSegment.speakerType,
        slug: this.#currentSegment.slug,
        speakerName: this.#currentSegment.speakerName,
        delta: `${separator}${cleanStart}`,
      });
      return;
    }

    this.#currentSegment.text += deltaText;
    emitted.push({
      beatIndex: this.#currentSegment.beatIndex,
      speakerType: this.#currentSegment.speakerType,
      slug: this.#currentSegment.slug,
      speakerName: this.#currentSegment.speakerName,
      delta: deltaText,
    });
  }
}
