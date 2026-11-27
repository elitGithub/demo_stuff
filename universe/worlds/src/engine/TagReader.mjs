/**
 * @param {unknown} tagName
 * @returns {string}
 * @throws {TypeError | RangeError}
 */
function assertValidTagName(tagName) {
  if (typeof tagName !== 'string') {
    throw new TypeError('tagName must be a string.');
  }
  if (!TagReader.Settings.TagNamePattern.test(tagName)) {
    throw new RangeError(`Invalid tag name: ${tagName}`);
  }
  return tagName;
}

/**
 * @param {string} text
 * @param {number} nameStart
 * @returns {number}
 */
function readTagNameEnd(text, nameStart) {
  const settings = TagReader.Settings;
  if (nameStart >= text.length || !settings.TagNameStartPattern.test(text[nameStart])) {
    return -1;
  }
  let cursor = nameStart + 1;
  while (cursor < text.length && settings.TagNameContinuePattern.test(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

/**
 * @param {string} text
 * @param {ReadonlySet<string>} targetTagNames
 * @returns {Array<{start: number, end: number, attrStart: number, attrEnd: number, bodyStart: number, bodyEnd: number}>}
 */
function scanTagSpans(text, targetTagNames) {
  const settings = TagReader.Settings;
  const spans = [];
  if (targetTagNames.size === 0) {
    return spans;
  }

  const lastCloseBracket = text.lastIndexOf(settings.CloseBracket);
  const openStacks = new Map();
  const rawSpans = [];
  let deadScanPoints = null;

  let cursor = 0;
  while (cursor < text.length) {
    const openPos = text.indexOf(settings.OpenBracket, cursor);
    if (openPos === -1) {
      break;
    }
    if (openPos + 1 < text.length && text[openPos + 1] === settings.Slash) {
      const closeNameStart = openPos + 2;
      const closeNameEnd = readTagNameEnd(text, closeNameStart);
      if (closeNameEnd !== -1) {
        const candidateLower = text.slice(closeNameStart, closeNameEnd).toLowerCase();
        if (targetTagNames.has(candidateLower)) {
          let closePos = closeNameEnd;
          while (closePos < text.length && settings.WhitespacePattern.test(text[closePos])) {
            closePos += 1;
          }
          if (closePos < text.length && text[closePos] === settings.CloseBracket) {
            const stack = openStacks.get(candidateLower);
            if (stack !== undefined && stack.length > 0) {
              const entry = stack.pop();
              rawSpans.push({
                start: entry.start,
                end: closePos + 1,
                attrStart: entry.attrStart,
                attrEnd: entry.attrEnd,
                bodyStart: entry.bodyStart,
                bodyEnd: openPos,
              });
            }
            cursor = closePos + 1;
            continue;
          }
        }
        cursor = closeNameEnd;
        continue;
      }
      cursor = openPos + 2;
      continue;
    }

    const nameStart = openPos + 1;
    const nameEnd = readTagNameEnd(text, nameStart);
    if (nameEnd === -1) {
      cursor = openPos + 1;
      continue;
    }
    const candidateLower = text.slice(nameStart, nameEnd).toLowerCase();
    if (!targetTagNames.has(candidateLower)) {
      cursor = nameEnd;
      continue;
    }
    if (nameEnd >= text.length || nameEnd > lastCloseBracket) {
      cursor = nameEnd;
      continue;
    }
    const boundaryChar = text[nameEnd];
    if (
      !settings.WhitespacePattern.test(boundaryChar) &&
      boundaryChar !== settings.Slash &&
      boundaryChar !== settings.CloseBracket
    ) {
      cursor = nameEnd;
      continue;
    }

    const visitedPoints = [];
    let openingInfo = null;
    let scanIndex = nameEnd;
    while (scanIndex <= lastCloseBracket) {
      const currentChar = text[scanIndex];
      if (
        currentChar === settings.OpenBracket ||
        currentChar === settings.DoubleQuote ||
        currentChar === settings.SingleQuote
      ) {
        if (deadScanPoints !== null && deadScanPoints.has(scanIndex)) {
          break;
        }
        visitedPoints.push(scanIndex);
      }
      if (currentChar === settings.DoubleQuote || currentChar === settings.SingleQuote) {
        const closeQuote = text.indexOf(currentChar, scanIndex + 1);
        if (closeQuote === -1 || closeQuote > lastCloseBracket) {
          break;
        }
        scanIndex = closeQuote + 1;
        continue;
      }
      if (currentChar === settings.CloseBracket) {
        const selfClosing = scanIndex - 1 >= nameEnd && text[scanIndex - 1] === settings.Slash;
        openingInfo = {
          tagEnd: scanIndex + 1,
          attrStart: nameEnd,
          attrEnd: selfClosing ? scanIndex - 1 : scanIndex,
          selfClosing,
        };
        break;
      }
      scanIndex += 1;
    }
    if (openingInfo === null) {
      if (visitedPoints.length > 0) {
        if (deadScanPoints === null) {
          deadScanPoints = new Set();
        }
        for (const point of visitedPoints) {
          deadScanPoints.add(point);
        }
      }
      cursor = nameEnd;
      continue;
    }
    if (openingInfo.selfClosing) {
      rawSpans.push({
        start: openPos,
        end: openingInfo.tagEnd,
        attrStart: openingInfo.attrStart,
        attrEnd: openingInfo.attrEnd,
        bodyStart: openingInfo.tagEnd,
        bodyEnd: openingInfo.tagEnd,
      });
      cursor = openingInfo.tagEnd;
      continue;
    }

    let stack = openStacks.get(candidateLower);
    if (stack === undefined) {
      stack = [];
      openStacks.set(candidateLower, stack);
    }
    stack.push({
      start: openPos,
      attrStart: openingInfo.attrStart,
      attrEnd: openingInfo.attrEnd,
      bodyStart: openingInfo.tagEnd,
    });
    cursor = openingInfo.tagEnd;
  }

  rawSpans.sort((leftSpan, rightSpan) => leftSpan.start - rightSpan.start || rightSpan.end - leftSpan.end);
  let lastAcceptedEnd = 0;
  for (const span of rawSpans) {
    if (span.start >= lastAcceptedEnd) {
      spans.push(span);
      lastAcceptedEnd = span.end;
    }
  }

  return spans;
}

export const TagReader = Object.freeze({
  Settings: Object.freeze({
    EmptyText: '',
    OpenBracket: '<',
    CloseBracket: '>',
    Slash: '/',
    Equals: '=',
    DoubleQuote: '"',
    SingleQuote: "'",
    ForbiddenAttributes: Object.freeze(['__proto__', 'constructor', 'prototype']),
    TagNamePattern: /^[A-Za-z][A-Za-z0-9_-]*$/,
    TagNameStartPattern: /^[A-Za-z]$/,
    TagNameContinuePattern: /^[A-Za-z0-9_-]$/,
    AttrNameCharPattern: /^[A-Za-z0-9_:-]$/,
    WhitespacePattern: /^\s$/,
  }),

  /**
   * @param {string} text
   * @param {string} tagName
   * @returns {ReadonlyArray<Readonly<{attributes: Readonly<Record<string, string>>, body: string}>>}
   * @throws {TypeError | RangeError}
   */
  read(text, tagName) {
    if (typeof text !== 'string') {
      throw new TypeError('text must be a string.');
    }
    const validTagName = assertValidTagName(tagName);
    const settings = TagReader.Settings;
    const forbiddenSet = new Set(settings.ForbiddenAttributes);
    const spans = scanTagSpans(text, new Set([validTagName.toLowerCase()]));
    const results = [];

    for (const span of spans) {
      const rawAttrText = text.slice(span.attrStart, span.attrEnd);
      const attributes = {};
      let attrCursor = 0;

      while (attrCursor < rawAttrText.length) {
        while (attrCursor < rawAttrText.length && settings.WhitespacePattern.test(rawAttrText[attrCursor])) {
          attrCursor += 1;
        }
        if (attrCursor >= rawAttrText.length) {
          break;
        }
        const nameStart = attrCursor;
        while (attrCursor < rawAttrText.length && settings.AttrNameCharPattern.test(rawAttrText[attrCursor])) {
          attrCursor += 1;
        }
        if (attrCursor === nameStart) {
          const strayChar = rawAttrText[attrCursor];
          if (strayChar === settings.DoubleQuote || strayChar === settings.SingleQuote) {
            const closeStray = rawAttrText.indexOf(strayChar, attrCursor + 1);
            attrCursor = closeStray === -1 ? rawAttrText.length : closeStray + 1;
          } else {
            attrCursor += 1;
          }
          continue;
        }
        const attrName = rawAttrText.slice(nameStart, attrCursor);
        while (attrCursor < rawAttrText.length && settings.WhitespacePattern.test(rawAttrText[attrCursor])) {
          attrCursor += 1;
        }
        if (attrCursor >= rawAttrText.length || rawAttrText[attrCursor] !== settings.Equals) {
          continue;
        }
        attrCursor += 1;
        while (attrCursor < rawAttrText.length && settings.WhitespacePattern.test(rawAttrText[attrCursor])) {
          attrCursor += 1;
        }
        if (attrCursor >= rawAttrText.length) {
          break;
        }
        const valueStartChar = rawAttrText[attrCursor];
        if (valueStartChar === settings.DoubleQuote) {
          const closeDouble = rawAttrText.indexOf(settings.DoubleQuote, attrCursor + 1);
          if (closeDouble === -1) {
            break;
          }
          const lowerAttrName = attrName.toLowerCase();
          if (!forbiddenSet.has(lowerAttrName)) {
            Object.defineProperty(attributes, lowerAttrName, {
              value: rawAttrText.slice(attrCursor + 1, closeDouble),
              enumerable: true,
              configurable: true,
              writable: true,
            });
          }
          attrCursor = closeDouble + 1;
        } else if (valueStartChar === settings.SingleQuote) {
          const closeSingle = rawAttrText.indexOf(settings.SingleQuote, attrCursor + 1);
          if (closeSingle === -1) {
            break;
          }
          attrCursor = closeSingle + 1;
        } else {
          while (attrCursor < rawAttrText.length && !settings.WhitespacePattern.test(rawAttrText[attrCursor])) {
            attrCursor += 1;
          }
        }
      }

      results.push(
        Object.freeze({
          attributes: Object.freeze(attributes),
          body: text.slice(span.bodyStart, span.bodyEnd),
        }),
      );
    }

    return Object.freeze(results);
  },

  /**
   * @param {string} text
   * @param {readonly string[]} tagNames
   * @returns {string}
   * @throws {TypeError | RangeError}
   */
  outside(text, tagNames) {
    if (typeof text !== 'string') {
      throw new TypeError('text must be a string.');
    }
    if (!Array.isArray(tagNames)) {
      throw new TypeError('tagNames must be an array.');
    }
    const targetTagNames = new Set();
    for (const rawTagName of tagNames) {
      targetTagNames.add(assertValidTagName(rawTagName).toLowerCase());
    }
    const spans = scanTagSpans(text, targetTagNames);
    if (spans.length === 0) {
      return text.trim();
    }
    const chunks = [];
    let cursor = 0;
    for (const span of spans) {
      if (span.start > cursor) {
        chunks.push(text.slice(cursor, span.start));
      }
      cursor = span.end;
    }
    if (cursor < text.length) {
      chunks.push(text.slice(cursor));
    }
    return chunks.join(TagReader.Settings.EmptyText).trim();
  },
});
