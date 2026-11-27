import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ModelAvailability } from './ModelAvailability.mjs';

export class ModelCatalog {
  static #DefaultSlots = Object.freeze(['director', 'composer', 'main', 'recurring', 'scribe']);
  static #ModelIdPattern = /^~?[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/;
  static #CacheVersion = 2;
  static #ProviderConcurrency = 10;
  static #HttpNotFound = 404;
  static #MalformedReason = 'malformed response';
  static #NoModels = Object.freeze([]);
  static #Outcomes = new Set([
    ModelAvailability.Served,
    ModelAvailability.Unserved,
    ModelAvailability.Unchecked,
  ]);
  static #Failure = Object.freeze({
    Timeout: 'timeout',
    Network: 'network',
    Malformed: 'malformed',
  });

  #defaultSlots;
  #fetchImpl;
  #apiUrl;
  #endpointsUrlFor;
  #configuredIdsProvider;
  #cachePath;
  #cacheTtlMs;
  #timeoutMs;
  #nowProvider;
  #controller = new AbortController();
  #closed = false;
  #refreshPromise = null;
  #cachedModels = null;
  #cachedAtMs = null;
  #cachedAtIso = null;
  #servedIds = new Set();
  #unservedIds = new Set();
  #uncheckedIds = new Set();
  #verdicts = new Map();
  #contextLengths = new Map();
  #refreshVerdicts = null;

  /**
   * @param {{catalogPath?: string, cachePath?: string | null, fetchImpl?: typeof fetch, apiUrl?: string, endpointsUrlFor?: (modelId: string) => string, configuredIdsProvider?: () => string[], cacheTtlMs?: number, timeoutMs?: number, nowProvider?: () => number}} [options]
   * @throws {TypeError | RangeError | Error}
   */
  constructor(options = {}) {
    if (!ModelCatalog.#isPlainObject(options)) {
      throw new TypeError('ModelCatalog options must be a plain object.');
    }

    const {
      catalogPath = path.resolve(import.meta.dirname, 'recommended-models.json'),
      cachePath = null,
      fetchImpl = fetch,
      apiUrl = 'https://openrouter.ai/api/v1/models',
      /**
       * @param {string} modelId
       * @returns {string}
       */
      endpointsUrlFor = (modelId) => `https://openrouter.ai/api/v1/models/${modelId}/endpoints`,
      /**
       * @returns {string[]}
       */
      configuredIdsProvider = () => [],
      cacheTtlMs = 14_400_000,
      timeoutMs = 10_000,
      nowProvider = Date.now,
    } = options;

    if (typeof catalogPath !== 'string' || catalogPath.trim().length === 0) {
      throw new RangeError('catalogPath must be a non-empty string.');
    }
    if (cachePath !== null) {
      if (typeof cachePath !== 'string') {
        throw new TypeError('cachePath must be null or a string.');
      }
      if (cachePath.trim().length === 0 || cachePath.includes('\0')) {
        throw new RangeError('cachePath must be a non-empty string without NUL characters.');
      }
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
    if (typeof endpointsUrlFor !== 'function') {
      throw new TypeError('endpointsUrlFor must be a function.');
    }
    if (typeof configuredIdsProvider !== 'function') {
      throw new TypeError('configuredIdsProvider must be a function.');
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
    if (!ModelCatalog.#isPlainObject(parsedCatalog)) {
      throw new TypeError('Recommended models catalog must be a JSON object.');
    }
    if (!ModelCatalog.#isPlainObject(parsedCatalog.defaultSlots)) {
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

    this.#defaultSlots = Object.freeze(defaultSlots);
    this.#fetchImpl = fetchImpl;
    this.#apiUrl = apiUrl.trim();
    this.#endpointsUrlFor = endpointsUrlFor;
    this.#configuredIdsProvider = configuredIdsProvider;
    this.#cachePath = cachePath;
    this.#cacheTtlMs = cacheTtlMs;
    this.#timeoutMs = timeoutMs;
    this.#nowProvider = nowProvider;

    if (cachePath !== null) {
      let fileDescriptor = null;
      try {
        fileDescriptor = fs.openSync(cachePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      } catch (openError) {
        if (openError.code !== 'ENOENT') {
          throw openError;
        }
      }
      if (fileDescriptor !== null) {
        let rawCache;
        try {
          rawCache = fs.readFileSync(fileDescriptor, 'utf8');
        } finally {
          fs.closeSync(fileDescriptor);
        }

        let parsedCache = null;
        try {
          parsedCache = JSON.parse(rawCache);
        } catch {
          parsedCache = null;
        }

        /**
         * @param {unknown} value
         * @returns {boolean}
         */
        const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

        /**
         * @param {unknown} entry
         * @returns {boolean}
         */
        const isValidVerdict = (entry) => {
          return ModelCatalog.#isPlainObject(entry) &&
            ModelCatalog.#Outcomes.has(entry.outcome) &&
            (entry.providerCount === null || (Number.isInteger(entry.providerCount) && entry.providerCount > 0)) &&
            typeof entry.checkedAt === 'string' &&
            !Number.isNaN(Date.parse(entry.checkedAt));
        };
        const isValidFile = ModelCatalog.#isPlainObject(parsedCache) &&
          parsedCache.version === ModelCatalog.#CacheVersion &&
          Number.isInteger(parsedCache.fetchedAtMs) &&
          parsedCache.fetchedAtMs >= 0 &&
          typeof parsedCache.fetchedAt === 'string' &&
          Date.parse(parsedCache.fetchedAt) === parsedCache.fetchedAtMs &&
          Array.isArray(parsedCache.models) &&
          isStringArray(parsedCache.unservedIds) &&
          isStringArray(parsedCache.uncheckedIds) &&
          (parsedCache.fetchedAtMs > 0 ||
            (parsedCache.models.length === 0 &&
              parsedCache.unservedIds.length === 0 &&
              parsedCache.uncheckedIds.length === 0)) &&
          ModelCatalog.#isPlainObject(parsedCache.verdicts) &&
          Object.values(parsedCache.verdicts).every(isValidVerdict);

        if (isValidFile) {
          /**
           * @param {unknown} cost
           * @returns {boolean}
           */
          const isValidCost = (cost) => typeof cost === 'number' && Number.isFinite(cost) && cost >= 0;

          const cachedById = new Map();
          for (const entry of parsedCache.models) {
            if (!ModelCatalog.#isPlainObject(entry)) {
              continue;
            }
            if (typeof entry.id !== 'string' || entry.id.length === 0 || cachedById.has(entry.id)) {
              continue;
            }
            if (!Number.isInteger(entry.providerCount) || entry.providerCount <= 0) {
              continue;
            }
            const displayName = typeof entry.name === 'string' && entry.name.trim().length > 0
              ? entry.name.trim()
              : entry.id;
            cachedById.set(entry.id, Object.freeze({
              id: entry.id,
              name: displayName,
              contextLength: Number.isInteger(entry.contextLength) && entry.contextLength > 0
                ? entry.contextLength
                : null,
              promptCostPerMillion: isValidCost(entry.promptCostPerMillion) ? entry.promptCostPerMillion : null,
              completionCostPerMillion: isValidCost(entry.completionCostPerMillion)
                ? entry.completionCostPerMillion
                : null,
              isModerated: typeof entry.isModerated === 'boolean' ? entry.isModerated : null,
              supportsStructuredOutput: entry.supportsStructuredOutput === true,
              providerCount: entry.providerCount,
            }));
          }

          if (parsedCache.models.length === 0 || cachedById.size > 0) {
            const hasCatalog = parsedCache.fetchedAtMs > 0;
            this.#setCache({
              models: hasCatalog
                ? Object.freeze([...cachedById.values()].sort((left, right) => left.id.localeCompare(right.id)))
                : null,
              atMs: hasCatalog ? parsedCache.fetchedAtMs : null,
              atIso: hasCatalog ? parsedCache.fetchedAt : null,
              unservedIds: parsedCache.unservedIds,
              uncheckedIds: parsedCache.uncheckedIds,
              verdicts: new Map(Object.entries(parsedCache.verdicts).map(([verdictId, verdict]) => {
                return [verdictId, Object.freeze({
                  outcome: verdict.outcome,
                  providerCount: verdict.providerCount,
                  checkedAt: verdict.checkedAt,
                })];
              })),
            });
          }
        }
      }
    }
  }

  /**
   * @param {unknown} modelId
   * @returns {boolean}
   */
  static isValidModelId(modelId) {
    return typeof modelId === 'string' && ModelCatalog.#ModelIdPattern.test(modelId) && !modelId.includes('..');
  }

  /**
   * @returns {Readonly<{director: string, composer: string, main: string, recurring: string, scribe: string}>}
   */
  getDefaults() {
    return this.#defaultSlots;
  }

  /**
   * @param {{refresh?: boolean, signal?: AbortSignal | null}} [options]
   * @returns {Promise<Readonly<{defaults: Readonly<{director: string, composer: string, main: string, recurring: string, scribe: string}>, openrouter: ReadonlyArray<object>, fetchedAt: string | null, stale: boolean, warning: string | null}>>}
   * @throws {TypeError | Error}
   */
  async listModels({ refresh = false, signal = null } = {}) {
    if (typeof refresh !== 'boolean') {
      throw new TypeError('refresh must be a boolean.');
    }
    if (signal !== null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
      throw new TypeError('signal must be null or an AbortSignal.');
    }
    if (signal?.aborted) {
      throw ModelCatalog.#createAbortError();
    }

    const nowMs = this.#nowProvider();
    const hasFreshCache = this.#cachedModels !== null &&
      this.#cachedAtMs !== null &&
      nowMs >= this.#cachedAtMs &&
      nowMs - this.#cachedAtMs < this.#cacheTtlMs;
    if (this.#closed || (!refresh && hasFreshCache)) {
      return this.#buildResult({ stale: this.#cachedModels === null, warning: null });
    }

    if (this.#refreshPromise === null) {
      this.#refreshVerdicts = new Map();
      /**
       * @returns {Promise<Readonly<{defaults: object, openrouter: ReadonlyArray<object>, fetchedAt: string | null, stale: boolean, warning: string | null}>>}
       * @throws {TypeError | Error}
       */
      this.#refreshPromise = (async () => {
        const refreshSignal = this.#controller.signal;
        const listResult = await this.#fetchJson(this.#apiUrl, refreshSignal);

        let failureReason = null;
        if (listResult.failure === ModelCatalog.#Failure.Timeout) {
          failureReason = 'Timed out fetching OpenRouter models catalog.';
        } else if (listResult.failure === ModelCatalog.#Failure.Network) {
          failureReason = `Failed to fetch OpenRouter models catalog: ${listResult.detail}`;
        } else if (listResult.failure === ModelCatalog.#Failure.Malformed) {
          failureReason = 'OpenRouter models catalog returned malformed JSON.';
        } else if (!listResult.ok) {
          failureReason = `OpenRouter models catalog returned HTTP ${listResult.status}.`;
        } else if (!ModelCatalog.#isPlainObject(listResult.body) || !Array.isArray(listResult.body.data)) {
          failureReason = 'OpenRouter models catalog response is missing data array.';
        }
        if (failureReason !== null) {
          const failureWarning = this.#cachedModels !== null
            ? `${failureReason} Showing cached OpenRouter catalog.`
            : failureReason;
          console.error(failureWarning);
          return this.#buildResult({ stale: true, warning: failureWarning });
        }

        const listedModels = [];
        const seenIds = new Set();
        for (const rawEntry of listResult.body.data) {
          if (!ModelCatalog.#isPlainObject(rawEntry) || typeof rawEntry.id !== 'string') {
            continue;
          }
          const modelId = rawEntry.id.trim();
          if (!ModelCatalog.isValidModelId(modelId) || seenIds.has(modelId)) {
            continue;
          }
          seenIds.add(modelId);

          const supportedParams = Array.isArray(rawEntry.supported_parameters) ? rawEntry.supported_parameters : [];
          listedModels.push({
            id: modelId,
            name: typeof rawEntry.name === 'string' && rawEntry.name.trim().length > 0
              ? rawEntry.name.trim()
              : modelId,
            contextLength: Number.isInteger(rawEntry.context_length) && rawEntry.context_length > 0
              ? rawEntry.context_length
              : null,
            promptCostPerMillion: ModelCatalog.#parseCostPerMillion(rawEntry.pricing?.prompt),
            completionCostPerMillion: ModelCatalog.#parseCostPerMillion(rawEntry.pricing?.completion),
            isModerated: typeof rawEntry.top_provider?.is_moderated === 'boolean'
              ? rawEntry.top_provider.is_moderated
              : null,
            supportsStructuredOutput:
              supportedParams.includes('response_format') || supportedParams.includes('structured_outputs'),
          });
        }
        listedModels.sort((leftModel, rightModel) => leftModel.id.localeCompare(rightModel.id));

        const configuredIds = this.#configuredIdsProvider();
        if (!Array.isArray(configuredIds)) {
          throw new TypeError('configuredIdsProvider must return an array.');
        }
        const unlistedConfiguredIds = [...new Set(configuredIds)].filter((configuredId) => {
          return ModelCatalog.isValidModelId(configuredId) && !seenIds.has(configuredId);
        });
        const requestedIds = [...listedModels.map((model) => model.id), ...unlistedConfiguredIds];

        const results = new Array(requestedIds.length);
        let nextIndex = 0;
        const workerCount = Math.min(ModelCatalog.#ProviderConcurrency, requestedIds.length);
        await Promise.all(Array.from({ length: workerCount }, async () => {
          while (nextIndex < requestedIds.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await this.#requestProvider(requestedIds[currentIndex], refreshSignal);
          }
        }));

        if (refreshSignal.aborted) {
          throw ModelCatalog.#createAbortError();
        }

        const completedAtMs = this.#nowProvider();
        const fetchedAtIso = new Date(completedAtMs).toISOString();
        const servedModels = [];
        const unservedIds = [];
        const uncheckedIds = [];
        const verdicts = new Map();
        let uncheckedCount = 0;
        let firstUncheckedReason = null;
        requestedIds.forEach((requestedId, requestIndex) => {
          const result = results[requestIndex];
          if (result.outcome === ModelAvailability.Unchecked) {
            uncheckedCount += 1;
            firstUncheckedReason ??= result.reason;
          }
          if (requestIndex >= listedModels.length) {
            verdicts.set(requestedId, Object.freeze({
              outcome: result.outcome,
              providerCount: result.providerCount,
              checkedAt: fetchedAtIso,
            }));
          } else if (result.outcome === ModelAvailability.Served) {
            servedModels.push(Object.freeze({ ...listedModels[requestIndex], providerCount: result.providerCount }));
          } else if (result.outcome === ModelAvailability.Unserved) {
            unservedIds.push(requestedId);
          } else {
            uncheckedIds.push(requestedId);
          }
        });
        for (const [checkedId, checkedVerdict] of this.#refreshVerdicts) {
          verdicts.set(checkedId, checkedVerdict);
        }

        this.#setCache({
          models: Object.freeze(servedModels),
          atMs: completedAtMs,
          atIso: fetchedAtIso,
          unservedIds,
          uncheckedIds,
          verdicts,
        });

        const warnings = [];
        if (uncheckedCount > 0) {
          warnings.push(
            `${uncheckedCount} of ${requestedIds.length} models could not be checked (first reason: ${firstUncheckedReason}); they are left out until the next refresh.`,
          );
        }
        const writeMessage = this.#writeCache();
        if (writeMessage !== null) {
          warnings.push(`Loaded live OpenRouter models, but failed to update local cache: ${writeMessage}`);
        }
        const warning = warnings.length > 0 ? warnings.join(' ') : null;
        if (warning !== null) {
          console.error(warning);
        }
        return this.#buildResult({ stale: false, warning });
      })().finally(() => {
        this.#refreshPromise = null;
        this.#refreshVerdicts = null;
      });
    }
    if (signal === null) {
      return this.#refreshPromise;
    }

    let onAbort;
    const aborted = new Promise((resolve, reject) => {
      /**
       * @returns {void}
       */
      onAbort = () => {
        reject(ModelCatalog.#createAbortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([this.#refreshPromise, aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * @param {string} modelId
   * @param {{signal?: AbortSignal | null}} [options]
   * @returns {Promise<Readonly<{outcome: string, providerCount: number | null, reason: string | null, cacheWarning: string | null}>>}
   * @throws {TypeError | Error}
   */
  async checkModel(modelId, { signal = null } = {}) {
    if (!ModelCatalog.isValidModelId(modelId)) {
      throw new TypeError(`modelId is not a valid OpenRouter model ID: ${String(modelId)}`);
    }
    if (signal !== null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
      throw new TypeError('signal must be null or an AbortSignal.');
    }
    if (this.#closed || signal?.aborted) {
      throw ModelCatalog.#createAbortError();
    }

    const requestSignal = signal === null ? this.#controller.signal : AbortSignal.any([this.#controller.signal, signal]);
    const result = await this.#requestProvider(modelId, requestSignal);
    if (requestSignal.aborted) {
      throw ModelCatalog.#createAbortError();
    }
    const verdict = Object.freeze({
      outcome: result.outcome,
      providerCount: result.providerCount,
      checkedAt: new Date(this.#nowProvider()).toISOString(),
    });
    this.#verdicts.set(modelId, verdict);
    this.#refreshVerdicts?.set(modelId, verdict);
    const writeMessage = this.#writeCache();
    return Object.freeze({
      outcome: result.outcome,
      providerCount: result.providerCount,
      reason: result.reason,
      cacheWarning: writeMessage === null
        ? null
        : `The model check result could not be written to the local cache: ${writeMessage}.`,
    });
  }

  /**
   * @param {string} modelId
   * @returns {string | null}
   */
  modelStatus(modelId) {
    const verdict = this.#verdicts.get(modelId);
    if (verdict !== undefined) {
      return verdict.outcome;
    }
    if (this.#servedIds.has(modelId)) {
      return ModelAvailability.Served;
    }
    if (this.#unservedIds.has(modelId)) {
      return ModelAvailability.Unserved;
    }
    if (this.#uncheckedIds.has(modelId)) {
      return ModelAvailability.Unchecked;
    }
    return null;
  }

  /**
   * @param {string} modelId
   * @returns {string | null}
   */
  modelCheckedAt(modelId) {
    const verdict = this.#verdicts.get(modelId);
    if (verdict !== undefined) {
      return verdict.checkedAt;
    }
    return this.modelStatus(modelId) === null ? null : this.#cachedAtIso;
  }

  /**
   * @param {string} modelId
   * @returns {number | null}
   */
  contextLength(modelId) {
    return this.#contextLengths.get(modelId) ?? null;
  }

  /**
   * @returns {void}
   */
  close() {
    this.#closed = true;
    this.#controller.abort();
  }

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  static #isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * @returns {Error}
   */
  static #createAbortError() {
    const abortError = new Error('Model catalog request aborted.');
    abortError.name = 'AbortError';
    return abortError;
  }

  /**
   * @param {unknown} rawCostPerToken
   * @returns {number | null}
   */
  static #parseCostPerMillion(rawCostPerToken) {
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

  /**
   * @param {{stale: boolean, warning: string | null}} options
   * @returns {Readonly<{defaults: object, openrouter: ReadonlyArray<object>, fetchedAt: string | null, stale: boolean, warning: string | null}>}
   */
  #buildResult({ stale, warning }) {
    return Object.freeze({
      defaults: this.#defaultSlots,
      openrouter: this.#cachedModels ?? ModelCatalog.#NoModels,
      fetchedAt: this.#cachedAtIso,
      stale,
      warning,
    });
  }

  /**
   * @param {{models: ReadonlyArray<object> | null, atMs: number | null, atIso: string | null, unservedIds: ReadonlyArray<string>, uncheckedIds: ReadonlyArray<string>, verdicts: Map<string, object>}} cacheState
   * @returns {void}
   */
  #setCache({ models, atMs, atIso, unservedIds, uncheckedIds, verdicts }) {
    const modelList = models ?? [];
    this.#cachedModels = models;
    this.#cachedAtMs = atMs;
    this.#cachedAtIso = atIso;
    this.#servedIds = new Set(modelList.map((model) => model.id));
    this.#unservedIds = new Set(unservedIds);
    this.#uncheckedIds = new Set(uncheckedIds);
    this.#verdicts = verdicts;
    this.#contextLengths = new Map();
    for (const model of modelList) {
      if (Number.isInteger(model.contextLength) && model.contextLength > 0) {
        this.#contextLengths.set(model.id, model.contextLength);
      }
    }
  }

  /**
   * @returns {string | null}
   * @throws {Error}
   */
  #writeCache() {
    if (this.#cachePath === null) {
      return null;
    }
    const hasCatalog = this.#cachedAtMs !== null;
    const fetchedAtMs = hasCatalog ? this.#cachedAtMs : 0;
    const serialized = `${JSON.stringify({
      version: ModelCatalog.#CacheVersion,
      fetchedAtMs,
      fetchedAt: hasCatalog ? this.#cachedAtIso : new Date(fetchedAtMs).toISOString(),
      models: hasCatalog ? this.#cachedModels : [],
      unservedIds: [...this.#unservedIds],
      uncheckedIds: [...this.#uncheckedIds],
      verdicts: Object.fromEntries(this.#verdicts),
    }, null, 2)}\n`;

    const parentDir = path.dirname(this.#cachePath);
    const tempPath = path.join(parentDir, `.openrouter-models-cache-${process.pid}-${randomUUID()}.tmp`);
    let fileDescriptor = null;
    try {
      const existingStats = fs.lstatSync(this.#cachePath, { throwIfNoEntry: false });
      if (existingStats !== undefined && existingStats.isSymbolicLink()) {
        const symlinkError = new Error(`Refusing to write the model cache through a symlink: ${this.#cachePath}`);
        symlinkError.code = 'ELOOP';
        throw symlinkError;
      }
      fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
      fileDescriptor = fs.openSync(tempPath, 'wx', 0o600);
      fs.writeFileSync(fileDescriptor, serialized, 'utf8');
      fs.fsyncSync(fileDescriptor);
      fs.closeSync(fileDescriptor);
      fileDescriptor = null;
      fs.renameSync(tempPath, this.#cachePath);
      return null;
    } catch (writeError) {
      if (fileDescriptor !== null) {
        fs.closeSync(fileDescriptor);
      }
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      if (writeError.code === 'ELOOP') {
        throw writeError;
      }
      return writeError instanceof Error ? writeError.message : String(writeError);
    }
  }

  /**
   * @param {string} url
   * @param {AbortSignal} parentSignal
   * @returns {Promise<{ok: boolean, status: number | null, body: unknown, failure: string | null, detail: string}>}
   * @throws {Error}
   */
  async #fetchJson(url, parentSignal) {
    if (parentSignal.aborted) {
      throw ModelCatalog.#createAbortError();
    }
    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
    const requestSignal = AbortSignal.any([parentSignal, timeoutSignal]);
    let isParsingBody = false;
    try {
      const response = await this.#fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: requestSignal,
      });
      if (parentSignal.aborted) {
        throw ModelCatalog.#createAbortError();
      }
      if (!response.ok) {
        return { ok: false, status: response.status, body: null, failure: null, detail: '' };
      }
      isParsingBody = true;
      const body = await response.json();
      if (parentSignal.aborted) {
        throw ModelCatalog.#createAbortError();
      }
      return { ok: true, status: response.status, body, failure: null, detail: '' };
    } catch (requestError) {
      if (parentSignal.aborted) {
        throw ModelCatalog.#createAbortError();
      }
      const detail = requestError instanceof Error ? requestError.message : String(requestError);
      if (timeoutSignal.aborted || (requestError instanceof Error && requestError.name === 'TimeoutError')) {
        return { ok: false, status: null, body: null, failure: ModelCatalog.#Failure.Timeout, detail };
      }
      const failure = isParsingBody ? ModelCatalog.#Failure.Malformed : ModelCatalog.#Failure.Network;
      return { ok: false, status: null, body: null, failure, detail };
    }
  }

  /**
   * @param {string} modelId
   * @param {AbortSignal} parentSignal
   * @returns {Promise<{outcome: string, providerCount: number | null, reason: string | null}>}
   * @throws {Error}
   */
  async #requestProvider(modelId, parentSignal) {
    const result = await this.#fetchJson(this.#endpointsUrlFor(modelId), parentSignal);
    if (result.failure === ModelCatalog.#Failure.Timeout) {
      return {
        outcome: ModelAvailability.Unchecked,
        providerCount: null,
        reason: `timed out after ${this.#timeoutMs / 1000} seconds`,
      };
    }
    if (result.failure === ModelCatalog.#Failure.Network) {
      return {
        outcome: ModelAvailability.Unchecked,
        providerCount: null,
        reason: `network error: ${result.detail}`,
      };
    }
    if (result.failure === ModelCatalog.#Failure.Malformed) {
      return { outcome: ModelAvailability.Unchecked, providerCount: null, reason: ModelCatalog.#MalformedReason };
    }
    if (result.status === ModelCatalog.#HttpNotFound) {
      return { outcome: ModelAvailability.Unserved, providerCount: null, reason: null };
    }
    if (!result.ok) {
      return { outcome: ModelAvailability.Unchecked, providerCount: null, reason: `HTTP ${result.status}` };
    }
    const endpoints = ModelCatalog.#isPlainObject(result.body) && ModelCatalog.#isPlainObject(result.body.data)
      ? result.body.data.endpoints
      : undefined;
    if (!Array.isArray(endpoints)) {
      return { outcome: ModelAvailability.Unchecked, providerCount: null, reason: ModelCatalog.#MalformedReason };
    }
    if (endpoints.length === 0) {
      return { outcome: ModelAvailability.Unserved, providerCount: null, reason: null };
    }
    return { outcome: ModelAvailability.Served, providerCount: endpoints.length, reason: null };
  }
}
