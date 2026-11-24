export class WorldsApi {
  #baseUrl;
  #csrfToken;
  #fetchImpl;
  #documentRef;

  /**
   * @param {{baseUrl?: string, csrfToken?: string | null, fetchImpl?: typeof fetch | null, documentRef?: Document | null}} [options]
   * @throws {TypeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('WorldsApi options must be a plain object.');
    }

    const {
      baseUrl = '',
      csrfToken = null,
      fetchImpl = null,
      documentRef = null,
    } = options;

    if (typeof baseUrl !== 'string') {
      throw new TypeError('baseUrl must be a string.');
    }
    if (csrfToken !== null && typeof csrfToken !== 'string') {
      throw new TypeError('csrfToken must be null or a string.');
    }
    if (fetchImpl !== null && typeof fetchImpl !== 'function') {
      throw new TypeError('fetchImpl must be null or a function.');
    }

    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#csrfToken = csrfToken;
    this.#documentRef = documentRef ?? (typeof document !== 'undefined' ? document : null);
    this.#fetchImpl = fetchImpl ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    if (this.#fetchImpl === null) {
      throw new TypeError('fetch implementation is required.');
    }
  }

  /**
   * @param {Response} response
   * @param {{onEvent: (payload: {event: string, data: unknown}) => void | Promise<void>, signal?: AbortSignal | null}} options
   * @returns {Promise<void>}
   * @throws {Error}
   */
  static async consumeSseStream(response, options = {}) {
    if (response === null || typeof response !== 'object') {
      throw new TypeError('SSE response object is required.');
    }
    if (response.body === null || response.body === undefined || typeof response.body.getReader !== 'function') {
      throw new TypeError('SSE response must expose a ReadableStream body.');
    }
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('consumeSseStream options must be a plain object.');
    }

    const { onEvent, signal = null } = options;
    if (typeof onEvent !== 'function') {
      throw new TypeError('onEvent callback function is required.');
    }
    if (signal !== null && signal !== undefined) {
      if (typeof signal !== 'object' || typeof signal.aborted !== 'boolean') {
        throw new TypeError('signal must be null or an AbortSignal.');
      }
    }

    if (signal?.aborted) {
      const abortError = new Error('Stream aborted.');
      abortError.name = 'AbortError';
      throw abortError;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let readerClosed = false;
    let readerCancelled = false;
    let lineBuffer = '';
    let pendingCr = false;
    let currentEvent = 'message';
    let hasExplicitEvent = false;
    let dataLines = [];

    /**
     * @param {string} lineText
     * @returns {Promise<void>}
     */
    const handleLine = async (lineText) => {
      if (lineText === '') {
        if (dataLines.length === 0 && !hasExplicitEvent) {
          return;
        }
        const eventName = currentEvent || 'message';
        const rawPayload = dataLines.join('\n');
        currentEvent = 'message';
        hasExplicitEvent = false;
        dataLines = [];

        let parsedData = null;
        if (rawPayload.length > 0) {
          try {
            parsedData = JSON.parse(rawPayload);
          } catch (parseError) {
            throw new Error(`Malformed SSE JSON payload for event "${eventName}": ${parseError.message}`);
          }
        }

        if (eventName === 'error') {
          const errorMessage =
            parsedData !== null &&
            typeof parsedData === 'object' &&
            typeof parsedData.message === 'string' &&
            parsedData.message.trim().length > 0
              ? parsedData.message
              : 'Turn pipeline failed.';
          const streamError = new Error(errorMessage);
          if (
            parsedData !== null &&
            typeof parsedData === 'object' &&
            Number.isInteger(parsedData.statusCode)
          ) {
            streamError.statusCode = parsedData.statusCode;
          }
          streamError.payload = parsedData;
          throw streamError;
        }

        await onEvent({ event: eventName, data: parsedData });
        return;
      }

      if (lineText.startsWith(':')) {
        return;
      }

      const colonIndex = lineText.indexOf(':');
      const fieldName = colonIndex === -1 ? lineText : lineText.slice(0, colonIndex);
      let fieldValue = colonIndex === -1 ? '' : lineText.slice(colonIndex + 1);
      if (fieldValue.startsWith(' ')) {
        fieldValue = fieldValue.slice(1);
      }

      if (fieldName === 'event') {
        currentEvent = fieldValue;
        hasExplicitEvent = true;
      } else if (fieldName === 'data') {
        dataLines.push(fieldValue);
      }
    };

    /**
     * @param {string} decodedChunk
     * @returns {Promise<void>}
     */
    const feedDecodedText = async (decodedChunk) => {
      if (decodedChunk.length === 0) {
        return;
      }
      let cursor = 0;
      if (pendingCr) {
        pendingCr = false;
        if (decodedChunk[0] === '\n') {
          cursor = 1;
        }
      }
      let lineStart = cursor;
      while (cursor < decodedChunk.length) {
        const currentChar = decodedChunk[cursor];
        if (currentChar === '\r' || currentChar === '\n') {
          const completedLine = lineBuffer + decodedChunk.slice(lineStart, cursor);
          lineBuffer = '';
          if (currentChar === '\r') {
            if (cursor + 1 < decodedChunk.length) {
              if (decodedChunk[cursor + 1] === '\n') {
                cursor += 1;
              }
            } else {
              pendingCr = true;
            }
          }
          cursor += 1;
          lineStart = cursor;
          await handleLine(completedLine);
        } else {
          cursor += 1;
        }
      }
      if (lineStart < decodedChunk.length) {
        lineBuffer += decodedChunk.slice(lineStart);
      }
    };

    /**
     * @returns {void}
     */
    const onAbort = () => {
      if (!readerClosed && !readerCancelled) {
        readerCancelled = true;
        void reader.cancel(signal.reason).catch(() => {});
      }
    };

    if (signal !== null && signal !== undefined) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      while (true) {
        if (signal?.aborted) {
          const abortError = new Error('Stream aborted.');
          abortError.name = 'AbortError';
          throw abortError;
        }

        const readResult = await reader.read();
        if (signal?.aborted) {
          const abortError = new Error('Stream aborted.');
          abortError.name = 'AbortError';
          throw abortError;
        }

        if (readResult.done) {
          readerClosed = true;
          const tailText = decoder.decode();
          if (tailText.length > 0) {
            await feedDecodedText(tailText);
          }
          if (lineBuffer.length > 0) {
            const finalLine = lineBuffer;
            lineBuffer = '';
            await handleLine(finalLine);
          }
          if (dataLines.length > 0 || hasExplicitEvent) {
            await handleLine('');
          }
          break;
        }

        if (readResult.value !== undefined) {
          const decodedChunk = decoder.decode(readResult.value, { stream: true });
          await feedDecodedText(decodedChunk);
        }
      }
    } catch (streamError) {
      if (!readerClosed && !readerCancelled) {
        readerCancelled = true;
        try {
          await reader.cancel(streamError);
        } catch {
        }
      }
      throw streamError;
    } finally {
      if (signal !== null && signal !== undefined) {
        signal.removeEventListener('abort', onAbort);
      }
      reader.releaseLock();
    }
  }

  /**
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<{status: string, sync: object, dailySpend: {totalUsd: number, unpricedCount: number, callCount: number}}>}
   * @throws {Error}
   */
  async getHealth({ signal = null } = {}) {
    return await this.#requestJson('GET', '/api/health', { signal });
  }

  /**
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<{models: Record<string, string>, publicOdds: number, privateOdds: number, scribeInterval: number, pedantEnabled: boolean, dailyWarnUsd: number | null, apiKey: {configured: boolean, source: string}}>}
   * @throws {Error}
   */
  async getSettings({ signal = null } = {}) {
    return await this.#requestJson('GET', '/api/settings', { signal });
  }

  /**
   * @param {Record<string, unknown>} patch
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<object>}
   * @throws {Error}
   */
  async updateSettings(patch, { signal = null } = {}) {
    return await this.#requestJson('PUT', '/api/settings', { body: patch, signal });
  }

  /**
   * @param {{limit?: number, after?: string | null, signal?: AbortSignal | null}} [options]
   * @returns {Promise<{items: Array<object>, total: number, nextCursor: string | null}>}
   * @throws {Error}
   */
  async listCampaigns({ limit = 25, after = null, signal = null } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (typeof after === 'string' && after.length > 0) {
      params.set('after', after);
    }
    return await this.#requestJson('GET', `/api/campaigns?${params.toString()}`, { signal });
  }

  /**
   * @param {Record<string, unknown>} payload
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<object>}
   * @throws {Error}
   */
  async createCampaign(payload, { signal = null } = {}) {
    return await this.#requestJson('POST', '/api/campaigns', { body: payload, signal });
  }

  /**
   * @param {string} campaignId
   * @param {Record<string, unknown>} patch
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<object>}
   * @throws {Error}
   */
  async updateCampaign(campaignId, patch, { signal = null } = {}) {
    return await this.#requestJson('PATCH', `/api/campaigns/${encodeURIComponent(campaignId)}`, {
      body: patch,
      signal,
    });
  }

  /**
   * @param {string} campaignId
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<{deleted: boolean}>}
   * @throws {Error}
   */
  async deleteCampaign(campaignId, { signal = null } = {}) {
    return await this.#requestJson('DELETE', `/api/campaigns/${encodeURIComponent(campaignId)}`, { signal });
  }

  /**
   * @param {string} campaignId
   * @param {{includeArchived?: boolean, limit?: number, after?: string | null, signal?: AbortSignal | null}} [options]
   * @returns {Promise<{items: Array<object>, total: number, nextCursor: string | null}>}
   * @throws {Error}
   */
  async listCharacters(campaignId, { includeArchived = false, limit = 25, after = null, signal = null } = {}) {
    const params = new URLSearchParams({
      includeArchived: includeArchived ? 'true' : 'false',
      limit: String(limit),
    });
    if (typeof after === 'string' && after.length > 0) {
      params.set('after', after);
    }
    return await this.#requestJson(
      'GET',
      `/api/campaigns/${encodeURIComponent(campaignId)}/characters?${params.toString()}`,
      { signal },
    );
  }

  /**
   * @param {string} campaignId
   * @param {Record<string, unknown>} payload
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<object>}
   * @throws {Error}
   */
  async createCharacter(campaignId, payload, { signal = null } = {}) {
    return await this.#requestJson('POST', `/api/campaigns/${encodeURIComponent(campaignId)}/characters`, {
      body: payload,
      signal,
    });
  }

  /**
   * @param {string} campaignId
   * @param {string} characterId
   * @param {Record<string, unknown>} patch
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<object>}
   * @throws {Error}
   */
  async updateCharacter(campaignId, characterId, patch, { signal = null } = {}) {
    return await this.#requestJson(
      'PATCH',
      `/api/campaigns/${encodeURIComponent(campaignId)}/characters/${encodeURIComponent(characterId)}`,
      { body: patch, signal },
    );
  }

  /**
   * @param {string} campaignId
   * @param {string} characterId
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<{deleted: boolean}>}
   * @throws {Error}
   */
  async deleteCharacter(campaignId, characterId, { signal = null } = {}) {
    return await this.#requestJson(
      'DELETE',
      `/api/campaigns/${encodeURIComponent(campaignId)}/characters/${encodeURIComponent(characterId)}`,
      { signal },
    );
  }

  /**
   * @param {string} campaignId
   * @param {{limit?: number, beforeSeq?: number | null, signal?: AbortSignal | null}} [options]
   * @returns {Promise<{items: Array<object>, total: number, nextCursor: number | null}>}
   * @throws {Error}
   */
  async listTurns(campaignId, { limit = 50, beforeSeq = null, signal = null } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (Number.isInteger(beforeSeq) && beforeSeq > 0) {
      params.set('beforeSeq', String(beforeSeq));
    }
    return await this.#requestJson(
      'GET',
      `/api/campaigns/${encodeURIComponent(campaignId)}/turns?${params.toString()}`,
      { signal },
    );
  }

  /**
   * @param {string} campaignId
   * @param {{text: string, mode?: 'normal' | 'narrator' | 'encounter', oocNudge?: string | null}} payload
   * @param {{onEvent: (payload: {event: string, data: unknown}) => void | Promise<void>, signal?: AbortSignal | null}} options
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async runTurn(campaignId, { text, mode = 'normal', oocNudge = null }, { onEvent, signal = null } = {}) {
    await this.#openSse('POST', `/api/campaigns/${encodeURIComponent(campaignId)}/turns`, {
      body: { text, mode, oocNudge },
      onEvent,
      signal,
    });
  }

  /**
   * @param {string} campaignId
   * @param {{onEvent: (payload: {event: string, data: unknown}) => void | Promise<void>, signal?: AbortSignal | null}} options
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async regenerateLastTurn(campaignId, { onEvent, signal = null } = {}) {
    await this.#openSse('POST', `/api/campaigns/${encodeURIComponent(campaignId)}/turns/regenerate`, {
      onEvent,
      signal,
    });
  }

  /**
   * @param {string} campaignId
   * @param {string} turnId
   * @param {{text: string, beatId?: string | null}} payload
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<object>}
   * @throws {Error}
   */
  async editTurn(campaignId, turnId, { text, beatId = null }, { signal = null } = {}) {
    const body = beatId !== null ? { text, beatId } : { text };
    return await this.#requestJson(
      'PATCH',
      `/api/campaigns/${encodeURIComponent(campaignId)}/turns/${encodeURIComponent(turnId)}`,
      { body, signal },
    );
  }

  /**
   * @param {string} campaignId
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<{deletedUserTurnId: string, deletedAssistantTurnId: string, deletedSeqs: [number, number], restoredSceneState: object}>}
   * @throws {Error}
   */
  async deleteLastTurnPair(campaignId, { signal = null } = {}) {
    return await this.#requestJson(
      'DELETE',
      `/api/campaigns/${encodeURIComponent(campaignId)}/turns/last`,
      { signal },
    );
  }

  /**
   * @param {string} campaignId
   * @param {{section?: string, query?: string, limit?: number, after?: string | null, signal?: AbortSignal | null}} [options]
   * @returns {Promise<{section: string, items: Array<object>, total: number, nextCursor: string | null, dirty: boolean, lastTurnSeq: number, turnsSinceScribe: number, counts: Record<string, number>}>}
   * @throws {Error}
   */
  async getMemory(campaignId, { section = 'subjects', query = '', limit = 25, after = null, signal = null } = {}) {
    const params = new URLSearchParams({
      section,
      query,
      limit: String(limit),
    });
    if (typeof after === 'string' && after.length > 0) {
      params.set('after', after);
    }
    return await this.#requestJson(
      'GET',
      `/api/campaigns/${encodeURIComponent(campaignId)}/memory?${params.toString()}`,
      { signal },
    );
  }

  /**
   * @param {string} campaignId
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<{updated: boolean, lastTurnSeq: number, scenesAdded: number, operationsAdded: number, dirty: boolean}>}
   * @throws {Error}
   */
  async updateMemory(campaignId, { signal = null } = {}) {
    return await this.#requestJson('POST', `/api/campaigns/${encodeURIComponent(campaignId)}/memory/update`, {
      signal,
    });
  }

  /**
   * @param {string} campaignId
   * @param {string} instruction
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<{operations: Array<object>, refused: Array<unknown>, changes: Array<string>}>}
   * @throws {Error}
   */
  async tellPreview(campaignId, instruction, { signal = null } = {}) {
    return await this.#requestJson('POST', `/api/campaigns/${encodeURIComponent(campaignId)}/memory/tell`, {
      body: { action: 'preview', instruction },
      signal,
    });
  }

  /**
   * @param {string} campaignId
   * @param {Array<object>} operations
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<{state: object, changes: Array<string>}>}
   * @throws {Error}
   */
  async tellCommit(campaignId, operations, { signal = null } = {}) {
    return await this.#requestJson('POST', `/api/campaigns/${encodeURIComponent(campaignId)}/memory/tell`, {
      body: { action: 'commit', operations },
      signal,
    });
  }

  /**
   * @param {string} campaignId
   * @param {{excludeThreadIds?: Array<string>, signal?: AbortSignal | null}} [options]
   * @returns {Promise<{suggestion: {threadId: string, threadTitle: string, text: string} | null}>}
   * @throws {Error}
   */
  async museSuggest(campaignId, { excludeThreadIds = [], signal = null } = {}) {
    return await this.#requestJson('POST', `/api/campaigns/${encodeURIComponent(campaignId)}/memory/muse`, {
      body: { excludeThreadIds },
      signal,
    });
  }

  /**
   * @param {string} campaignId
   * @param {{status?: string, limit?: number, after?: string | null, signal?: AbortSignal | null}} [options]
   * @returns {Promise<{items: Array<object>, total: number, nextCursor: string | null}>}
   * @throws {Error}
   */
  async listFindings(campaignId, { status = 'open', limit = 25, after = null, signal = null } = {}) {
    const params = new URLSearchParams({
      status,
      limit: String(limit),
    });
    if (typeof after === 'string' && after.length > 0) {
      params.set('after', after);
    }
    return await this.#requestJson(
      'GET',
      `/api/campaigns/${encodeURIComponent(campaignId)}/findings?${params.toString()}`,
      { signal },
    );
  }

  /**
   * @param {string} campaignId
   * @param {string} findingId
   * @param {{action: 'ruled' | 'told' | 'dismissed', replacementText?: string | null}} payload
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<object>}
   * @throws {Error}
   */
  async resolveFinding(campaignId, findingId, { action, replacementText = null }, { signal = null } = {}) {
    const body = replacementText !== null && replacementText !== undefined
      ? { action, replacementText }
      : { action };
    return await this.#requestJson(
      'POST',
      `/api/campaigns/${encodeURIComponent(campaignId)}/findings/${encodeURIComponent(findingId)}/resolve`,
      { body, signal },
    );
  }

  /**
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<{status: string, saved: boolean, message?: string}>}
   * @throws {Error}
   */
  async saveSync({ signal = null } = {}) {
    return await this.#requestJson('POST', '/api/sync/save', { signal });
  }

  /**
   * @param {string} method
   * @param {string} routePath
   * @param {{body?: unknown, signal?: AbortSignal | null}} [options]
   * @returns {Promise<unknown>}
   * @throws {Error}
   */
  async #requestJson(method, routePath, { body, signal = null } = {}) {
    const hasBody = body !== undefined;
    const init = {
      method,
      headers: this.#buildHeaders(method, hasBody),
    };
    if (hasBody) {
      init.body = JSON.stringify(body);
    }
    if (signal !== null && signal !== undefined) {
      init.signal = signal;
    }

    const response = await this.#fetchImpl(this.#buildUrl(routePath), init);
    if (!response.ok) {
      await this.#throwResponseError(response);
    }
    return await response.json();
  }

  /**
   * @param {string} method
   * @param {string} routePath
   * @param {{body?: unknown, onEvent: (payload: {event: string, data: unknown}) => void | Promise<void>, signal?: AbortSignal | null}} options
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async #openSse(method, routePath, { body, onEvent, signal = null }) {
    const hasBody = body !== undefined;
    const init = {
      method,
      headers: this.#buildHeaders(method, hasBody),
    };
    if (hasBody) {
      init.body = JSON.stringify(body);
    }
    if (signal !== null && signal !== undefined) {
      init.signal = signal;
    }

    const response = await this.#fetchImpl(this.#buildUrl(routePath), init);
    if (!response.ok) {
      await this.#throwResponseError(response);
    }
    await WorldsApi.consumeSseStream(response, { onEvent, signal });
  }

  /**
   * @param {string} routePath
   * @returns {string}
   */
  #buildUrl(routePath) {
    return `${this.#baseUrl}${routePath}`;
  }

  /**
   * @param {string} method
   * @param {boolean} hasBody
   * @returns {Record<string, string>}
   * @throws {Error}
   */
  #buildHeaders(method, hasBody) {
    const headers = {};
    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }
    if (method !== 'GET' && method !== 'HEAD') {
      let token = this.#csrfToken;
      if ((typeof token !== 'string' || token.length === 0) && this.#documentRef !== null) {
        const metaElement = this.#documentRef.querySelector('meta[name="worlds-csrf"]');
        token = metaElement?.getAttribute('content') ?? null;
        if (typeof token === 'string' && token.length > 0 && token !== '__CSRF_TOKEN__') {
          this.#csrfToken = token;
        }
      }
      if (typeof token !== 'string' || token.trim().length === 0 || token === '__CSRF_TOKEN__') {
        throw new Error('Missing CSRF token. Reload the page to continue.');
      }
      headers['X-Worlds-CSRF'] = token;
    }
    return headers;
  }

  /**
   * @param {Response} response
   * @returns {Promise<never>}
   * @throws {Error}
   */
  async #throwResponseError(response) {
    let payload = null;
    let message = `Request failed with status ${response.status}.`;
    try {
      const rawText = await response.text();
      if (rawText.trim().length > 0) {
        try {
          payload = JSON.parse(rawText);
          if (payload !== null && typeof payload === 'object') {
            if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
              message = payload.error;
            } else if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
              message = payload.message;
            }
          }
        } catch {
          message = rawText.trim();
        }
      }
    } catch (readError) {
      if (readError instanceof Error && readError.name === 'AbortError') {
        throw readError;
      }
    }
    const requestError = new Error(message);
    requestError.statusCode = response.status;
    requestError.payload = payload;
    throw requestError;
  }
}
