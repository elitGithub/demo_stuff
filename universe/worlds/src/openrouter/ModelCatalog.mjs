import fs from 'node:fs';
import path from 'node:path';

export class ModelCatalog {
  static #DefaultSlots = Object.freeze(['director', 'composer', 'main', 'recurring', 'scribe']);

  #defaultSlots;
  #recommended;
  #fetchImpl;
  #apiUrl;
  #cacheTtlMs;
  #timeoutMs;
  #nowProvider;
  #cachedModels = null;
  #cachedAtMs = 0;
  #cachedAtIso = null;

  /**
   * @param {{catalogPath?: string, fetchImpl?: typeof fetch, apiUrl?: string, cacheTtlMs?: number, timeoutMs?: number, nowProvider?: () => number}} [options]
   * @throws {TypeError | RangeError | Error}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('ModelCatalog options must be a plain object.');
    }

    const {
      catalogPath = path.resolve(import.meta.dirname, 'recommended-models.json'),
      fetchImpl = fetch,
      apiUrl = 'https://openrouter.ai/api/v1/models',
      cacheTtlMs = 300_000,
      timeoutMs = 10_000,
      nowProvider = Date.now,
    } = options;

    if (typeof catalogPath !== 'string' || catalogPath.trim().length === 0) {
      throw new RangeError('catalogPath must be a non-empty string.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('fetchImpl must be a function.');
    }
    if (typeof apiUrl !== 'string' || apiUrl.trim().length === 0) {
      throw new RangeError('apiUrl must be a non-empty string.');
    }
    const parsedUrl = new URL(apiUrl.trim());
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new RangeError(`apiUrl must use http or https protocol: ${apiUrl}`);
    }
    if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 0) {
      throw new RangeError('cacheTtlMs must be a non-negative integer.');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive integer.');
    }
    if (typeof nowProvider !== 'function') {
      throw new TypeError('nowProvider must be a function.');
    }

    const rawCatalog = fs.readFileSync(catalogPath, 'utf8');
    const parsedCatalog = JSON.parse(rawCatalog);
    if (parsedCatalog === null || typeof parsedCatalog !== 'object' || Array.isArray(parsedCatalog)) {
      throw new TypeError('Recommended models catalog must be a JSON object.');
    }
    if (
      parsedCatalog.defaultSlots === null ||
      typeof parsedCatalog.defaultSlots !== 'object' ||
      Array.isArray(parsedCatalog.defaultSlots)
    ) {
      throw new TypeError('Recommended models catalog must define defaultSlots object.');
    }

    const defaultSlots = {};
    for (const slotKey of ModelCatalog.#DefaultSlots) {
      const slotValue = parsedCatalog.defaultSlots[slotKey];
      if (typeof slotValue !== 'string' || slotValue.trim().length === 0) {
        throw new RangeError(`defaultSlots.${slotKey} must be a non-empty string.`);
      }
      defaultSlots[slotKey] = slotValue.trim();
    }

    if (!Array.isArray(parsedCatalog.recommended) || parsedCatalog.recommended.length === 0) {
      throw new RangeError('Recommended models catalog must include a non-empty recommended array.');
    }
    const recommended = parsedCatalog.recommended.map((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new TypeError('Each recommended model entry must be an object.');
      }
      if (typeof entry.id !== 'string' || entry.id.trim().length === 0) {
        throw new RangeError('Each recommended model entry must include a non-empty id.');
      }
      if (typeof entry.name !== 'string' || entry.name.trim().length === 0) {
        throw new RangeError('Each recommended model entry must include a non-empty name.');
      }
      return Object.freeze({
        id: entry.id.trim(),
        name: entry.name.trim(),
        recommendedFor: typeof entry.recommendedFor === 'string' ? entry.recommendedFor.trim() : '',
        notes: typeof entry.notes === 'string' ? entry.notes.trim() : '',
        uncensored: Boolean(entry.uncensored),
      });
    });

    this.#defaultSlots = Object.freeze(defaultSlots);
    this.#recommended = Object.freeze(recommended);
    this.#fetchImpl = fetchImpl;
    this.#apiUrl = apiUrl.trim();
    this.#cacheTtlMs = cacheTtlMs;
    this.#timeoutMs = timeoutMs;
    this.#nowProvider = nowProvider;
  }

  /**
   * @returns {Readonly<{director: string, composer: string, main: string, recurring: string, scribe: string}>}
   */
  getDefaults() {
    return this.#defaultSlots;
  }

  /**
   * @returns {ReadonlyArray<Readonly<{id: string, name: string, recommendedFor: string, notes: string, uncensored: boolean}>>}
   */
  getRecommended() {
    return this.#recommended;
  }

  /**
   * @param {{includeAll?: boolean, refresh?: boolean, signal?: AbortSignal | null}} [options]
   * @returns {Promise<Readonly<{defaults: Readonly<{director: string, composer: string, main: string, recurring: string, scribe: string}>, recommended: ReadonlyArray<object>, openrouter: ReadonlyArray<object> | null, fetchedAt: string | null}>>}
   * @throws {Error}
   */
  async listModels({ includeAll = false, refresh = false, signal = null } = {}) {
    if (typeof includeAll !== 'boolean') {
      throw new TypeError('includeAll must be a boolean.');
    }
    if (typeof refresh !== 'boolean') {
      throw new TypeError('refresh must be a boolean.');
    }
    if (signal !== null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
      throw new TypeError('signal must be null or an AbortSignal.');
    }
    if (signal?.aborted) {
      const abortError = new Error('Model catalog request aborted.');
      abortError.name = 'AbortError';
      throw abortError;
    }

    if (!includeAll) {
      return Object.freeze({
        defaults: this.#defaultSlots,
        recommended: this.#recommended,
        openrouter: null,
        fetchedAt: null,
      });
    }

    const nowMs = this.#nowProvider();
    if (!refresh && this.#cachedModels !== null && nowMs - this.#cachedAtMs < this.#cacheTtlMs) {
      return Object.freeze({
        defaults: this.#defaultSlots,
        recommended: this.#recommended,
        openrouter: this.#cachedModels,
        fetchedAt: this.#cachedAtIso,
      });
    }

    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
    const requestSignal = signal !== null
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    let response;
    try {
      response = await this.#fetchImpl(this.#apiUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: requestSignal,
      });
    } catch (fetchError) {
      if (signal?.aborted) {
        const abortError = new Error('Model catalog request aborted.');
        abortError.name = 'AbortError';
        throw abortError;
      }
      if (timeoutSignal.aborted || (fetchError instanceof Error && fetchError.name === 'TimeoutError')) {
        const timeoutError = new Error('Timed out fetching OpenRouter models catalog.');
        timeoutError.statusCode = 504;
        throw timeoutError;
      }
      const networkError = new Error(
        `Failed to fetch OpenRouter models catalog: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
      );
      networkError.statusCode = 502;
      throw networkError;
    }

    if (!response.ok) {
      const httpError = new Error(`OpenRouter models catalog returned HTTP ${response.status}.`);
      httpError.statusCode = 502;
      throw httpError;
    }

    let parsedBody;
    try {
      parsedBody = await response.json();
    } catch {
      const malformedError = new Error('OpenRouter models catalog returned malformed JSON.');
      malformedError.statusCode = 502;
      throw malformedError;
    }

    if (parsedBody === null || typeof parsedBody !== 'object' || !Array.isArray(parsedBody.data)) {
      const shapeError = new Error('OpenRouter models catalog response is missing data array.');
      shapeError.statusCode = 502;
      throw shapeError;
    }

    const normalized = [];
    const seenIds = new Set();
    for (const rawEntry of parsedBody.data) {
      if (rawEntry === null || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
        continue;
      }
      if (typeof rawEntry.id !== 'string' || rawEntry.id.trim().length === 0) {
        continue;
      }
      const modelId = rawEntry.id.trim();
      if (seenIds.has(modelId)) {
        continue;
      }
      seenIds.add(modelId);

      const displayName = typeof rawEntry.name === 'string' && rawEntry.name.trim().length > 0
        ? rawEntry.name.trim()
        : modelId;
      const contextLength = Number.isInteger(rawEntry.context_length) && rawEntry.context_length > 0
        ? rawEntry.context_length
        : null;
      const promptCostPerMillion = this.#parseCostPerMillion(rawEntry.pricing?.prompt);
      const completionCostPerMillion = this.#parseCostPerMillion(rawEntry.pricing?.completion);
      const isModerated = typeof rawEntry.top_provider?.is_moderated === 'boolean'
        ? rawEntry.top_provider.is_moderated
        : null;
      const supportedParams = Array.isArray(rawEntry.supported_parameters)
        ? rawEntry.supported_parameters
        : [];
      const supportsStructuredOutput =
        supportedParams.includes('response_format') || supportedParams.includes('structured_outputs');

      normalized.push(
        Object.freeze({
          id: modelId,
          name: displayName,
          contextLength,
          promptCostPerMillion,
          completionCostPerMillion,
          isModerated,
          supportsStructuredOutput,
        }),
      );
    }

    normalized.sort((leftModel, rightModel) => leftModel.id.localeCompare(rightModel.id));
    const frozenModels = Object.freeze(normalized);
    const fetchedAtIso = new Date(this.#nowProvider()).toISOString();

    this.#cachedModels = frozenModels;
    this.#cachedAtMs = this.#nowProvider();
    this.#cachedAtIso = fetchedAtIso;

    return Object.freeze({
      defaults: this.#defaultSlots,
      recommended: this.#recommended,
      openrouter: frozenModels,
      fetchedAt: fetchedAtIso,
    });
  }

  /**
   * @param {unknown} rawCostPerToken
   * @returns {number | null}
   */
  #parseCostPerMillion(rawCostPerToken) {
    if (rawCostPerToken === undefined || rawCostPerToken === null || rawCostPerToken === '') {
      return null;
    }
    const numeric = typeof rawCostPerToken === 'number'
      ? rawCostPerToken
      : typeof rawCostPerToken === 'string'
        ? Number(rawCostPerToken.trim())
        : Number.NaN;
    if (!Number.isFinite(numeric) || numeric < 0) {
      return null;
    }
    return Math.round(numeric * 1_000_000 * 10_000) / 10_000;
  }
}
