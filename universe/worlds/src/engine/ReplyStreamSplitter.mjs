const TAG_SCAN_KIND = Object.freeze({
  None: 'none',
  OutsideOpen: 'outside_open',
  HiddenOpen: 'hidden_open',
  HiddenClose: 'hidden_close',
  VisibleHiddenOpen: 'visible_hidden_open',
  VisibleClose: 'visible_close',
});

/**
 * @param {string} boundaryChar
 * @returns {boolean}
 */
function isTagBoundaryChar(boundaryChar) {
  const settings = ReplyStreamSplitter.Settings;
  return (
    settings.WhitespacePattern.test(boundaryChar) ||
    boundaryChar === settings.Slash ||
    boundaryChar === settings.CloseBracket
  );
}

/**
 * @param {unknown} rawTagName
 * @param {string} fieldName
 * @returns {string}
 * @throws {TypeError | RangeError}
 */
function validateTagName(rawTagName, fieldName) {
  if (typeof rawTagName !== 'string') {
    throw new TypeError(`${fieldName} must be a string.`);
  }
  if (!ReplyStreamSplitter.Settings.TagNamePattern.test(rawTagName)) {
    throw new RangeError(`Invalid ${fieldName}: ${rawTagName}`);
  }
  return rawTagName.toLowerCase();
}

/**
 * @param {string} text
 * @param {number} startIndex
 * @returns {number}
 */
function readTagNameEnd(text, startIndex) {
  const charPattern = ReplyStreamSplitter.Settings.TagNameCharPattern;
  let index = startIndex;
  while (index < text.length && charPattern.test(text[index])) {
    index += 1;
  }
  return index;
}

/**
 * @param {string} buffer
 * @param {number} nameEnd
 * @param {number} startIndex
 * @param {string | null} activeQuote
 * @returns {{found: true, tagEnd: number, selfClosing: boolean} | {found: false, scanIndex: number, quote: string | null}}
 */
function scanOpeningTagEnd(buffer, nameEnd, startIndex, activeQuote) {
  const settings = ReplyStreamSplitter.Settings;
  let index = startIndex;
  let quote = activeQuote;

  while (index < buffer.length) {
    if (quote !== null) {
      const closeQuote = buffer.indexOf(quote, index);
      if (closeQuote === -1) {
        return { found: false, scanIndex: buffer.length, quote };
      }
      quote = null;
      index = closeQuote + 1;
      continue;
    }

    const currentChar = buffer[index];
    if (currentChar === settings.DoubleQuote || currentChar === settings.SingleQuote) {
      quote = currentChar;
      index += 1;
      continue;
    }
    if (currentChar === settings.CloseBracket) {
      const selfClosing = index - 1 >= nameEnd && buffer[index - 1] === settings.Slash;
      return { found: true, tagEnd: index + 1, selfClosing };
    }
    index += 1;
  }

  return { found: false, scanIndex: buffer.length, quote };
}

export class ReplyStreamSplitter {
  static Settings = Object.freeze({
    TagNamePattern: /^[A-Za-z][A-Za-z0-9_-]*$/,
    WhitespacePattern: /^\s$/,
    TagNameCharPattern: /^[A-Za-z0-9_-]$/,
    State: Object.freeze({
      Outside: 'outside',
      Hidden: 'hidden',
      Visible: 'visible',
    }),
    OpenBracket: '<',
    CloseBracket: '>',
    Slash: '/',
    ClosePrefix: '</',
    DoubleQuote: '"',
    SingleQuote: "'",
    EmptyText: '',
  });

  #raw = ReplyStreamSplitter.Settings.EmptyText;
  #visible = ReplyStreamSplitter.Settings.EmptyText;
  #buffer = ReplyStreamSplitter.Settings.EmptyText;
  #state = ReplyStreamSplitter.Settings.State.Outside;
  #hiddenReturnState = ReplyStreamSplitter.Settings.State.Outside;
  #visibleTagLower;
  #hiddenTags;
  #hiddenTagList;
  #allTargetTags;
  #activeHiddenTag = null;
  #hiddenDepth = 0;
  #tagScanKind = TAG_SCAN_KIND.None;
  #tagScanIndex = 0;
  #tagNameEnd = 0;
  #tagMatchedName = null;
  #tagQuote = null;

  /**
   * @param {{visibleTag: string, hiddenTags?: readonly string[]}} [options]
   * @throws {TypeError | RangeError}
   */
  constructor(options = {}) {
    if (
      options === null ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)
    ) {
      throw new TypeError('ReplyStreamSplitter options must be a plain object.');
    }

    const { visibleTag, hiddenTags = [] } = options;
    this.#visibleTagLower = validateTagName(visibleTag, 'visibleTag');

    if (!Array.isArray(hiddenTags)) {
      throw new TypeError('hiddenTags must be an array.');
    }

    const hiddenSet = new Set();
    for (const rawHiddenTag of hiddenTags) {
      const lowerHidden = validateTagName(rawHiddenTag, 'hiddenTags entry');
      if (lowerHidden !== this.#visibleTagLower) {
        hiddenSet.add(lowerHidden);
      }
    }

    this.#hiddenTags = hiddenSet;
    this.#hiddenTagList = Object.freeze([...hiddenSet]);
    this.#allTargetTags = Object.freeze([this.#visibleTagLower, ...hiddenSet]);
  }

  /**
   * @param {string} chunk
   * @returns {string}
   * @throws {TypeError}
   */
  push(chunk) {
    if (typeof chunk !== 'string') {
      throw new TypeError('chunk must be a string.');
    }

    const settings = ReplyStreamSplitter.Settings;
    this.#raw += chunk;
    if (chunk.length === 0) {
      return settings.EmptyText;
    }

    this.#buffer += chunk;
    let emitted = settings.EmptyText;
    let cursor = 0;

    while (cursor < this.#buffer.length) {
      if (this.#state === settings.State.Outside) {
        if (this.#tagScanKind === TAG_SCAN_KIND.OutsideOpen) {
          const scanResult = scanOpeningTagEnd(this.#buffer, this.#tagNameEnd, this.#tagScanIndex, this.#tagQuote);
          if (!scanResult.found) {
            this.#tagScanIndex = scanResult.scanIndex;
            this.#tagQuote = scanResult.quote;
            break;
          }
          const matchedTag = this.#tagMatchedName;
          this.#clearPendingScan();
          cursor = scanResult.tagEnd;
          if (!scanResult.selfClosing) {
            if (this.#hiddenTags.has(matchedTag)) {
              this.#hiddenReturnState = settings.State.Outside;
              this.#state = settings.State.Hidden;
              this.#activeHiddenTag = matchedTag;
              this.#hiddenDepth = 1;
            } else {
              this.#state = settings.State.Visible;
            }
          }
          continue;
        }

        const openPos = this.#buffer.indexOf(settings.OpenBracket, cursor);
        if (openPos === -1) {
          cursor = this.#buffer.length;
          break;
        }
        cursor = openPos;

        const afterOpen = cursor + 1;
        if (afterOpen >= this.#buffer.length) {
          break;
        }

        const nameEnd = readTagNameEnd(this.#buffer, afterOpen);
        if (nameEnd === afterOpen) {
          cursor = afterOpen;
          continue;
        }

        const candidateLower = this.#buffer.slice(afterOpen, nameEnd).toLowerCase();
        if (nameEnd === this.#buffer.length) {
          const hasMatchingPrefix = this.#allTargetTags.some((targetTag) => targetTag.startsWith(candidateLower));
          if (hasMatchingPrefix) {
            break;
          }
          cursor = nameEnd;
          continue;
        }

        const isExactTarget = candidateLower === this.#visibleTagLower || this.#hiddenTags.has(candidateLower);
        if (!isExactTarget) {
          cursor = nameEnd;
          continue;
        }

        if (!isTagBoundaryChar(this.#buffer[nameEnd])) {
          cursor = nameEnd;
          continue;
        }

        const relativeNameEnd = nameEnd - cursor;
        if (cursor > 0) {
          this.#buffer = this.#buffer.slice(cursor);
          cursor = 0;
        }
        this.#tagScanKind = TAG_SCAN_KIND.OutsideOpen;
        this.#tagScanIndex = relativeNameEnd;
        this.#tagNameEnd = relativeNameEnd;
        this.#tagMatchedName = candidateLower;
        this.#tagQuote = null;
        continue;
      }

      if (this.#state === settings.State.Hidden) {
        if (this.#tagScanKind === TAG_SCAN_KIND.HiddenOpen) {
          const scanResult = scanOpeningTagEnd(this.#buffer, this.#tagNameEnd, this.#tagScanIndex, this.#tagQuote);
          if (!scanResult.found) {
            this.#tagScanIndex = scanResult.scanIndex;
            this.#tagQuote = scanResult.quote;
            break;
          }
          this.#clearPendingScan();
          cursor = scanResult.tagEnd;
          if (!scanResult.selfClosing) {
            this.#hiddenDepth += 1;
          }
          continue;
        }

        if (this.#tagScanKind === TAG_SCAN_KIND.HiddenClose) {
          let closePos = this.#tagScanIndex;
          while (closePos < this.#buffer.length && settings.WhitespacePattern.test(this.#buffer[closePos])) {
            closePos += 1;
          }
          if (closePos >= this.#buffer.length) {
            this.#tagScanIndex = closePos;
            break;
          }
          if (this.#buffer[closePos] === settings.CloseBracket) {
            this.#clearPendingScan();
            this.#hiddenDepth -= 1;
            cursor = closePos + 1;
            if (this.#hiddenDepth === 0) {
              this.#activeHiddenTag = null;
              this.#state = this.#hiddenReturnState;
              this.#hiddenReturnState = settings.State.Outside;
            }
            continue;
          }
          this.#clearPendingScan();
          cursor = closePos;
          continue;
        }

        const openPos = this.#buffer.indexOf(settings.OpenBracket, cursor);
        if (openPos === -1) {
          cursor = this.#buffer.length;
          break;
        }
        cursor = openPos;

        const afterOpen = cursor + 1;
        if (afterOpen >= this.#buffer.length) {
          break;
        }

        if (this.#buffer[afterOpen] === settings.Slash) {
          const nameStart = afterOpen + 1;
          if (nameStart >= this.#buffer.length) {
            break;
          }
          const nameEnd = readTagNameEnd(this.#buffer, nameStart);
          if (nameEnd === nameStart) {
            cursor = nameStart;
            continue;
          }
          const candidateLower = this.#buffer.slice(nameStart, nameEnd).toLowerCase();
          if (nameEnd === this.#buffer.length) {
            if (this.#activeHiddenTag.startsWith(candidateLower)) {
              break;
            }
            cursor = nameEnd;
            continue;
          }
          if (candidateLower !== this.#activeHiddenTag) {
            cursor = nameEnd;
            continue;
          }
          const relativeNameEnd = nameEnd - cursor;
          if (cursor > 0) {
            this.#buffer = this.#buffer.slice(cursor);
            cursor = 0;
          }
          this.#tagScanKind = TAG_SCAN_KIND.HiddenClose;
          this.#tagScanIndex = relativeNameEnd;
          this.#tagNameEnd = relativeNameEnd;
          continue;
        }

        const nameEnd = readTagNameEnd(this.#buffer, afterOpen);
        if (nameEnd === afterOpen) {
          cursor = afterOpen;
          continue;
        }
        const candidateLower = this.#buffer.slice(afterOpen, nameEnd).toLowerCase();
        if (nameEnd === this.#buffer.length) {
          if (this.#activeHiddenTag.startsWith(candidateLower)) {
            break;
          }
          cursor = nameEnd;
          continue;
        }
        if (candidateLower !== this.#activeHiddenTag) {
          cursor = nameEnd;
          continue;
        }
        if (!isTagBoundaryChar(this.#buffer[nameEnd])) {
          cursor = nameEnd;
          continue;
        }
        const relativeNameEnd = nameEnd - cursor;
        if (cursor > 0) {
          this.#buffer = this.#buffer.slice(cursor);
          cursor = 0;
        }
        this.#tagScanKind = TAG_SCAN_KIND.HiddenOpen;
        this.#tagScanIndex = relativeNameEnd;
        this.#tagNameEnd = relativeNameEnd;
        this.#tagQuote = null;
        continue;
      }

      if (this.#tagScanKind === TAG_SCAN_KIND.VisibleHiddenOpen) {
        const scanResult = scanOpeningTagEnd(this.#buffer, this.#tagNameEnd, this.#tagScanIndex, this.#tagQuote);
        if (!scanResult.found) {
          this.#tagScanIndex = scanResult.scanIndex;
          this.#tagQuote = scanResult.quote;
          break;
        }
        const matchedHiddenTag = this.#tagMatchedName;
        this.#clearPendingScan();
        cursor = scanResult.tagEnd;
        if (!scanResult.selfClosing) {
          this.#hiddenReturnState = settings.State.Visible;
          this.#activeHiddenTag = matchedHiddenTag;
          this.#hiddenDepth = 1;
          this.#state = settings.State.Hidden;
        }
        continue;
      }

      if (this.#tagScanKind === TAG_SCAN_KIND.VisibleClose) {
        let closePos = this.#tagScanIndex;
        while (closePos < this.#buffer.length && settings.WhitespacePattern.test(this.#buffer[closePos])) {
          closePos += 1;
        }
        if (closePos >= this.#buffer.length) {
          this.#tagScanIndex = closePos;
          break;
        }
        if (this.#buffer[closePos] === settings.CloseBracket) {
          this.#clearPendingScan();
          cursor = closePos + 1;
          this.#state = settings.State.Outside;
          continue;
        }
        this.#clearPendingScan();
        emitted += settings.OpenBracket;
        this.#visible += settings.OpenBracket;
        cursor = 1;
        continue;
      }

      const openPos = this.#buffer.indexOf(settings.OpenBracket, cursor);
      if (openPos === -1) {
        const chunkText = this.#buffer.slice(cursor);
        emitted += chunkText;
        this.#visible += chunkText;
        cursor = this.#buffer.length;
        break;
      }
      if (openPos > cursor) {
        const chunkText = this.#buffer.slice(cursor, openPos);
        emitted += chunkText;
        this.#visible += chunkText;
        cursor = openPos;
      }

      const afterOpen = cursor + 1;
      if (afterOpen >= this.#buffer.length) {
        break;
      }
      if (this.#buffer[afterOpen] !== settings.Slash) {
        if (this.#hiddenTagList.length > 0) {
          const nameEnd = readTagNameEnd(this.#buffer, afterOpen);
          if (nameEnd > afterOpen) {
            const candidateLower = this.#buffer.slice(afterOpen, nameEnd).toLowerCase();
            if (nameEnd === this.#buffer.length) {
              if (this.#hiddenTagList.some((hiddenTag) => hiddenTag.startsWith(candidateLower))) {
                break;
              }
            } else if (
              this.#hiddenTags.has(candidateLower) &&
              isTagBoundaryChar(this.#buffer[nameEnd])
            ) {
              const relativeNameEnd = nameEnd - cursor;
              if (cursor > 0) {
                this.#buffer = this.#buffer.slice(cursor);
                cursor = 0;
              }
              this.#tagScanKind = TAG_SCAN_KIND.VisibleHiddenOpen;
              this.#tagScanIndex = relativeNameEnd;
              this.#tagNameEnd = relativeNameEnd;
              this.#tagMatchedName = candidateLower;
              this.#tagQuote = null;
              continue;
            }
          }
        }
        emitted += settings.OpenBracket;
        this.#visible += settings.OpenBracket;
        cursor = afterOpen;
        continue;
      }

      const nameStart = afterOpen + 1;
      if (nameStart >= this.#buffer.length) {
        break;
      }
      const nameEnd = readTagNameEnd(this.#buffer, nameStart);
      if (nameEnd === nameStart) {
        emitted += settings.OpenBracket;
        this.#visible += settings.OpenBracket;
        cursor = afterOpen;
        continue;
      }

      const candidateLower = this.#buffer.slice(nameStart, nameEnd).toLowerCase();
      if (nameEnd === this.#buffer.length) {
        if (this.#visibleTagLower.startsWith(candidateLower)) {
          break;
        }
        emitted += settings.OpenBracket;
        this.#visible += settings.OpenBracket;
        cursor = afterOpen;
        continue;
      }

      if (candidateLower !== this.#visibleTagLower) {
        emitted += settings.OpenBracket;
        this.#visible += settings.OpenBracket;
        cursor = afterOpen;
        continue;
      }

      const relativeNameEnd = nameEnd - cursor;
      if (cursor > 0) {
        this.#buffer = this.#buffer.slice(cursor);
        cursor = 0;
      }
      this.#tagScanKind = TAG_SCAN_KIND.VisibleClose;
      this.#tagScanIndex = relativeNameEnd;
      this.#tagNameEnd = relativeNameEnd;
    }

    if (cursor >= this.#buffer.length) {
      this.#buffer = settings.EmptyText;
      this.#clearPendingScan();
    } else if (cursor > 0) {
      this.#buffer = this.#buffer.slice(cursor);
    }

    return emitted;
  }

  /**
   * @returns {Readonly<{visible: string, raw: string}>}
   */
  finish() {
    const settings = ReplyStreamSplitter.Settings;
    if (this.#state === settings.State.Visible && this.#buffer.length > 0) {
      const closeStart = `${settings.ClosePrefix}${this.#visibleTagLower}`;
      const lowerBuffer = this.#buffer.toLowerCase();
      const isTruncatedCloseFragment =
        this.#buffer.startsWith(settings.ClosePrefix) &&
        (closeStart.startsWith(lowerBuffer) ||
          (lowerBuffer.startsWith(closeStart) && this.#buffer.slice(closeStart.length).trim().length === 0));
      const candidateHiddenPrefix =
        this.#buffer.length > 1 && !this.#buffer.startsWith(settings.ClosePrefix)
          ? lowerBuffer.slice(1)
          : settings.EmptyText;
      const isTruncatedHiddenPrefix =
        this.#tagScanKind === TAG_SCAN_KIND.VisibleHiddenOpen ||
        (candidateHiddenPrefix.length > 0 &&
          this.#hiddenTagList.some((hiddenTag) => hiddenTag.startsWith(candidateHiddenPrefix)));
      if (!isTruncatedCloseFragment && !isTruncatedHiddenPrefix) {
        this.#visible += this.#buffer;
      }
    }
    this.#buffer = settings.EmptyText;
    this.#clearPendingScan();
    this.#hiddenReturnState = settings.State.Outside;
    this.#activeHiddenTag = null;
    this.#hiddenDepth = 0;
    this.#state = settings.State.Outside;

    return Object.freeze({
      visible: this.#visible,
      raw: this.#raw,
    });
  }

  /**
   * @returns {void}
   */
  #clearPendingScan() {
    this.#tagScanKind = TAG_SCAN_KIND.None;
    this.#tagScanIndex = 0;
    this.#tagNameEnd = 0;
    this.#tagMatchedName = null;
    this.#tagQuote = null;
  }
}
