import { ModelCatalog } from '../../src/openrouter/ModelCatalog.mjs';

/**
 * @param {{modelIds?: string[], answerProvider?: ((modelId: string, init: object) => Promise<Response | undefined> | Response | undefined) | null, answerList?: ((init: object) => Promise<Response | undefined> | Response | undefined) | null, configuredIds?: string[] | (() => string[]), cachePath?: string | null, nowProvider?: () => number, cacheTtlMs?: number, timeoutMs?: number}} [options]
 * @returns {{catalog: ModelCatalog, listRequests: number, providerRequests: string[]}}
 * @throws {TypeError | RangeError | Error}
 */
export function createFakeModelCatalog({
  modelIds = [],
  answerProvider = null,
  answerList = null,
  configuredIds = [],
  cachePath = null,
  nowProvider = Date.now,
  cacheTtlMs = 14_400_000,
  timeoutMs = 10_000,
} = {}) {
  const listUrl = 'http://fake-openrouter.example/models';
  const endpointsPrefix = `${listUrl}/`;
  const endpointsSuffix = '/endpoints';
  const record = { catalog: null, listRequests: 0, providerRequests: [] };

  /**
   * @returns {string[]}
   * @throws {Error}
   */
  const configuredIdsProvider = () => (typeof configuredIds === 'function' ? configuredIds() : configuredIds);

  record.catalog = new ModelCatalog({
    cachePath,
    nowProvider,
    cacheTtlMs,
    timeoutMs,
    apiUrl: listUrl,
    /**
     * @param {string} modelId
     * @returns {string}
     */
    endpointsUrlFor: (modelId) => `${endpointsPrefix}${modelId}${endpointsSuffix}`,
    configuredIdsProvider,
    /**
     * @param {string} url
     * @param {{signal: AbortSignal}} init
     * @returns {Promise<Response | object>}
     * @throws {Error}
     */
    fetchImpl: async (url, init) => {
      if (url === listUrl) {
        record.listRequests += 1;
        const customList = answerList === null ? undefined : await answerList(init);
        if (customList !== undefined) {
          return customList;
        }
        return new Response(
          JSON.stringify({
            data: modelIds.map((modelId) => ({
              id: modelId,
              name: `Name of ${modelId}`,
              context_length: 32768,
              pricing: { prompt: '0.0000003', completion: '0.0000005' },
              top_provider: { is_moderated: false },
              supported_parameters: ['temperature'],
            })),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith(endpointsPrefix) && url.endsWith(endpointsSuffix)) {
        const modelId = url.slice(endpointsPrefix.length, -endpointsSuffix.length);
        record.providerRequests.push(modelId);
        const customAnswer = answerProvider === null ? undefined : await answerProvider(modelId, init);
        if (customAnswer !== undefined) {
          return customAnswer;
        }
        return new Response(JSON.stringify({ data: { endpoints: [{ name: 'fake-provider' }] } }), { status: 200 });
      }
      throw new Error(`Fake catalog received an unexpected URL: ${String(url)}`);
    },
  });
  return record;
}
