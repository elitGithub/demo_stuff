import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { ModelAvailability } from '../src/openrouter/ModelAvailability.mjs';
import { ModelAvailabilityService } from '../src/openrouter/ModelAvailabilityService.mjs';
import { ModelCatalog } from '../src/openrouter/ModelCatalog.mjs';
import { createFakeModelCatalog } from './support/createFakeModelCatalog.mjs';

const NowMs = 1_800_000_000_000;
const TtlMs = 14_400_000;
const VerdictTime = '2026-11-25T11:00:00.000Z';
const NowIso = new Date(NowMs).toISOString();
const ClockOffsetsMs = Object.freeze([60_000, -60_000]);
const tempRootDirs = [];

after(() => {
  for (const tempDir of tempRootDirs) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

/**
 * @returns {string}
 * @throws {Error}
 */
function createTempDir() {
  const createdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-catalog-test-'));
  tempRootDirs.push(createdDir);
  return createdDir;
}

/**
 * @returns {{promise: Promise<void>, open: () => void}}
 */
function createGate() {
  let open;
  const promise = new Promise((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/**
 * @param {number} count
 * @returns {Response}
 * @throws {Error}
 */
function endpointsResponse(count) {
  return new Response(
    JSON.stringify({ data: { endpoints: Array.from({ length: count }, () => ({ name: 'provider' })) } }),
    { status: 200 },
  );
}

/**
 * @param {AbortSignal} signal
 * @returns {Promise<never>}
 * @throws {Error}
 */
function waitForAbort(signal) {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 * @throws {RangeError}
 */
function buildCacheFile(overrides = {}) {
  return {
    version: 2,
    fetchedAtMs: NowMs,
    fetchedAt: new Date(NowMs).toISOString(),
    models: [
      {
        id: 'disk/model-b',
        name: 'Disk Model B',
        contextLength: 4096,
        promptCostPerMillion: 0.3,
        completionCostPerMillion: 0.5,
        isModerated: false,
        supportsStructuredOutput: true,
        providerCount: 2,
      },
    ],
    unservedIds: ['disk/dead'],
    uncheckedIds: ['disk/flaky'],
    verdicts: { 'disk/verdict': { outcome: 'served', providerCount: 1, checkedAt: VerdictTime } },
    ...overrides,
  };
}

/**
 * @param {string} dirPath
 * @param {unknown} content
 * @returns {string}
 * @throws {Error}
 */
function writeCacheFile(dirPath, content) {
  const cachePath = path.join(dirPath, 'cache.json');
  fs.writeFileSync(cachePath, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  return cachePath;
}

/**
 * @param {import('node:test').TestContext} testContext
 * @returns {{mock: {calls: Array<{arguments: unknown[]}>}}}
 * @throws {Error}
 */
function silenceStderr(testContext) {
  return testContext.mock.method(console, 'error', () => {});
}

/**
 * @param {() => boolean} predicate
 * @returns {Promise<void>}
 * @throws {Error}
 */
async function waitUntil(predicate) {
  const deadlineMs = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadlineMs) {
      throw new Error('Timed out waiting for a condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * @param {() => void} action
 * @param {number} microtaskCount
 * @returns {void}
 */
function runAfterMicrotasks(action, microtaskCount) {
  if (microtaskCount <= 0) {
    action();
    return;
  }
  queueMicrotask(() => runAfterMicrotasks(action, microtaskCount - 1));
}

describe('ModelAvailability enum', () => {
  it('labels every case and rejects unknown values', () => {
    assert.equal(ModelAvailability.label(ModelAvailability.Served), 'Served');
    assert.equal(ModelAvailability.label(ModelAvailability.Unserved), 'Unserved');
    assert.equal(ModelAvailability.label(ModelAvailability.Unchecked), 'Unchecked');
    assert.throws(() => ModelAvailability.label('nope'), RangeError);
  });
});

describe('ModelCatalog.isValidModelId', () => {
  it('accepts the measured ID forms', () => {
    for (const modelId of [
      'thedrummer/cydonia-24b-v4.1',
      'nousresearch/hermes-4-405b',
      '~openai/gpt-luna-latest',
      'openai/gpt-4o:batch',
      'cognitivecomputations/dolphin-mistral-24b-venice-edition',
      'a/b',
      'x-y.z_w/model.v1-2',
    ]) {
      assert.equal(ModelCatalog.isValidModelId(modelId), true, modelId);
    }
  });

  it('rejects query, fragment, space, dot-dot, empty segment and non-string forms', () => {
    for (const modelId of [
      'thedrummer/cydonia-24b-v4.1/endpoints?x=',
      'a/b?x=1',
      'a/b#c',
      'a b/c',
      'a/b c',
      'a/b..c',
      '../x/y',
      'a..b/c',
      '',
      'a',
      'a/',
      '/b',
      'a//b',
      'a/b/c',
      '.a/b',
      'a/.b',
      '-a/b',
      'a/b\n',
      5,
      null,
      undefined,
      {},
    ]) {
      assert.equal(ModelCatalog.isValidModelId(modelId), false, String(modelId));
    }
  });
});

describe('ModelCatalog constructor and defaults', () => {
  it('serves the 5 verified default slots and no static recommended list', () => {
    const catalog = new ModelCatalog();
    assert.deepEqual({ ...catalog.getDefaults() }, {
      director: 'nousresearch/hermes-4-405b',
      composer: 'sao10k/l3.1-euryale-70b',
      main: 'thedrummer/cydonia-24b-v4.1',
      recurring: 'thedrummer/unslopnemo-12b',
      scribe: 'cognitivecomputations/dolphin-mistral-24b-venice-edition',
    });
    assert.equal(Object.isFrozen(catalog.getDefaults()), true);
    assert.equal(catalog.getRecommended, undefined);
    const rawCatalog = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'openrouter', 'recommended-models.json'), 'utf8'),
    );
    assert.deepEqual(Object.keys(rawCatalog), ['defaultSlots']);
    for (const defaultId of Object.values(rawCatalog.defaultSlots)) {
      assert.equal(ModelCatalog.isValidModelId(defaultId), true);
    }
  });

  it('validates cachePath, endpointsUrlFor and configuredIdsProvider', () => {
    assert.throws(() => new ModelCatalog({ cachePath: 5 }), TypeError);
    assert.throws(() => new ModelCatalog({ cachePath: {} }), TypeError);
    assert.throws(() => new ModelCatalog({ cachePath: '' }), RangeError);
    assert.throws(() => new ModelCatalog({ cachePath: '   ' }), RangeError);
    assert.throws(() => new ModelCatalog({ cachePath: 'cache\0.json' }), RangeError);
    assert.throws(() => new ModelCatalog({ endpointsUrlFor: 'nope' }), TypeError);
    assert.throws(() => new ModelCatalog({ configuredIdsProvider: 'nope' }), TypeError);
    assert.throws(() => new ModelCatalog(null), TypeError);
    assert.doesNotThrow(() => new ModelCatalog({ cachePath: null }));
  });

  it('rejects a bad refresh flag and a bad signal', async () => {
    const { catalog } = createFakeModelCatalog();
    await assert.rejects(() => catalog.listModels({ refresh: 'yes' }), TypeError);
    await assert.rejects(() => catalog.listModels({ signal: {} }), TypeError);
    await assert.rejects(() => catalog.checkModel('a/b', { signal: {} }), TypeError);
  });
});

describe('ModelCatalog refresh and provider check', () => {
  it('keeps served models, leaves out unserved and unchecked ones, and reports the unchecked count', async (testContext) => {
    const stderr = silenceStderr(testContext);
    const tempDir = createTempDir();
    const cachePath = path.join(tempDir, 'cache.json');
    const fake = createFakeModelCatalog({
      cachePath,
      timeoutMs: 50,
      nowProvider: () => NowMs,
      modelIds: [
        'ok/one',
        'ok/two',
        'zero/none',
        'nf/notfound',
        'err/boom',
        'slow/timeout',
        'bad/json',
        'net/fail',
      ],
      answerProvider: async (modelId, init) => {
        switch (modelId) {
          case 'ok/two':
            return endpointsResponse(2);
          case 'zero/none':
            return endpointsResponse(0);
          case 'nf/notfound':
            return new Response(JSON.stringify({ error: { message: 'Not Found', code: 404 } }), { status: 404 });
          case 'err/boom':
            return new Response('boom', { status: 500 });
          case 'slow/timeout':
            return await waitForAbort(init.signal);
          case 'bad/json':
            return new Response('not json', { status: 200 });
          case 'net/fail':
            throw new Error('socket hang up');
          default:
            return undefined;
        }
      },
    });

    const result = await fake.catalog.listModels({ refresh: true });
    assert.deepEqual(result.openrouter.map((model) => [model.id, model.providerCount]), [
      ['ok/one', 1],
      ['ok/two', 2],
    ]);
    assert.equal(result.stale, false);
    assert.equal(result.fetchedAt, new Date(NowMs).toISOString());
    assert.equal(
      result.warning,
      '4 of 8 models could not be checked (first reason: malformed response); they are left out until the next refresh.',
    );
    assert.equal(stderr.mock.calls.length, 1);
    assert.equal(stderr.mock.calls[0].arguments[0], result.warning);
    assert.equal(fake.listRequests, 1);
    assert.equal(fake.providerRequests.length, 8);

    assert.equal(fake.catalog.modelStatus('ok/one'), ModelAvailability.Served);
    assert.equal(fake.catalog.modelStatus('zero/none'), ModelAvailability.Unserved);
    assert.equal(fake.catalog.modelStatus('nf/notfound'), ModelAvailability.Unserved);
    for (const uncheckedId of ['err/boom', 'slow/timeout', 'bad/json', 'net/fail']) {
      assert.equal(fake.catalog.modelStatus(uncheckedId), ModelAvailability.Unchecked, uncheckedId);
    }
    assert.equal(fake.catalog.modelStatus('never/seen'), null);
    for (const checkedId of ['ok/one', 'zero/none', 'nf/notfound', 'err/boom', 'slow/timeout']) {
      assert.equal(fake.catalog.modelCheckedAt(checkedId), NowIso, checkedId);
    }
    assert.equal(fake.catalog.modelCheckedAt('never/seen'), null);

    const written = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.equal(written.version, 2);
    assert.equal(written.fetchedAtMs, NowMs);
    assert.deepEqual(written.models.map((model) => model.providerCount), [1, 2]);
    assert.deepEqual(written.unservedIds, ['nf/notfound', 'zero/none']);
    assert.deepEqual(written.uncheckedIds, ['bad/json', 'err/boom', 'net/fail', 'slow/timeout']);
    assert.deepEqual(written.verdicts, {});
    assert.deepEqual(fs.readdirSync(tempDir), ['cache.json']);
  });

  it('normalizes upstream records: skips invalid IDs, dedupes, sorts, and keeps costs per million', async () => {
    const fake = createFakeModelCatalog({
      answerList: () => new Response(
        JSON.stringify({
          data: [
            { id: 'z/last', name: ' Z ', context_length: 10, pricing: { prompt: '0.0000007', completion: 'x' }, top_provider: { is_moderated: true }, supported_parameters: ['response_format'] },
            { id: 'a/first' },
            { id: 'a/first', name: 'Duplicate' },
            { id: 'bad id/x' },
            { id: 'a/b?x=1' },
            { id: 5 },
            null,
          ],
        }),
        { status: 200 },
      ),
    });
    const result = await fake.catalog.listModels();
    assert.deepEqual(result.openrouter.map((model) => model.id), ['a/first', 'z/last']);
    const last = result.openrouter[1];
    assert.equal(last.name, 'Z');
    assert.equal(last.contextLength, 10);
    assert.equal(last.promptCostPerMillion, 0.7);
    assert.equal(last.completionCostPerMillion, null);
    assert.equal(last.isModerated, true);
    assert.equal(last.supportsStructuredOutput, true);
    assert.equal(result.openrouter[0].name, 'a/first');
    assert.equal(Object.isFrozen(result.openrouter), true);
    assert.deepEqual(fake.providerRequests, ['a/first', 'z/last']);
  });

  it('sends at most 10 provider requests at once and reaches 10', async () => {
    const modelIds = Array.from(Array(35).keys(), (index) => `bulk/model-${String(index).padStart(2, '0')}`);
    let inFlight = 0;
    let maxInFlight = 0;
    const fake = createFakeModelCatalog({
      modelIds,
      answerProvider: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return undefined;
      },
    });
    const result = await fake.catalog.listModels();
    assert.equal(result.openrouter.length, 35);
    assert.equal(maxInFlight, 10);
  });

  it('keeps the previous cache and sends no provider request when the list request fails', async (testContext) => {
    const stderr = silenceStderr(testContext);
    let mode = 'ok';
    const failures = {
      http: [() => new Response('down', { status: 503 }), 'OpenRouter models catalog returned HTTP 503.'],
      json: [() => new Response('not-json', { status: 200 }), 'OpenRouter models catalog returned malformed JSON.'],
      shape: [() => new Response(JSON.stringify({ items: [] }), { status: 200 }), 'OpenRouter models catalog response is missing data array.'],
      network: [() => {
        throw new Error('connection refused');
      }, 'Failed to fetch OpenRouter models catalog: connection refused'],
      timeout: [(init) => waitForAbort(init.signal), 'Timed out fetching OpenRouter models catalog.'],
    };
    const fake = createFakeModelCatalog({
      modelIds: ['keep/me'],
      timeoutMs: 50,
      answerList: (init) => (mode === 'ok' ? undefined : failures[mode][0](init)),
    });
    const first = await fake.catalog.listModels();
    assert.equal(first.openrouter.length, 1);
    const providerRequestsAfterFirst = fake.providerRequests.length;

    for (const failureMode of Object.keys(failures)) {
      mode = failureMode;
      const result = await fake.catalog.listModels({ refresh: true });
      assert.equal(result.stale, true, failureMode);
      assert.equal(result.warning, `${failures[failureMode][1]} Showing cached OpenRouter catalog.`, failureMode);
      assert.deepEqual(result.openrouter.map((model) => model.id), ['keep/me']);
      assert.equal(result.fetchedAt, first.fetchedAt);
      assert.equal(fake.catalog.modelStatus('keep/me'), ModelAvailability.Served);
    }
    assert.equal(fake.providerRequests.length, providerRequestsAfterFirst);
    assert.equal(stderr.mock.calls.length, Object.keys(failures).length);
  });

  it('returns an empty stale result on a cold start failure', async (testContext) => {
    silenceStderr(testContext);
    const fake = createFakeModelCatalog({
      answerList: () => new Response('down', { status: 503 }),
    });
    const result = await fake.catalog.listModels();
    assert.deepEqual([...result.openrouter], []);
    assert.equal(result.fetchedAt, null);
    assert.equal(result.stale, true);
    assert.equal(result.warning, 'OpenRouter models catalog returned HTTP 503.');
    assert.deepEqual({ ...result.defaults }, { ...fake.catalog.getDefaults() });
    assert.equal(fake.providerRequests.length, 0);
  });

  it('replaces the cache with 0 models when every provider request fails, and a models: [] file loads as valid', async (testContext) => {
    silenceStderr(testContext);
    const tempDir = createTempDir();
    const cachePath = path.join(tempDir, 'cache.json');
    let providersDown = false;
    const fake = createFakeModelCatalog({
      cachePath,
      nowProvider: () => NowMs,
      modelIds: ['m/one', 'm/two', 'm/three'],
      answerProvider: () => (providersDown ? new Response('boom', { status: 500 }) : undefined),
    });
    assert.equal((await fake.catalog.listModels()).openrouter.length, 3);

    providersDown = true;
    const refreshed = await fake.catalog.listModels({ refresh: true });
    assert.deepEqual([...refreshed.openrouter], []);
    assert.equal(refreshed.stale, false);
    assert.match(refreshed.warning, /^3 of 3 models could not be checked \(first reason: HTTP 500\)/);
    assert.equal(fake.catalog.modelStatus('m/one'), ModelAvailability.Unchecked);

    const reloaded = createFakeModelCatalog({ cachePath, nowProvider: () => NowMs });
    const result = await reloaded.catalog.listModels();
    assert.equal(reloaded.listRequests, 0);
    assert.deepEqual([...result.openrouter], []);
    assert.equal(result.stale, false);
    assert.equal(result.fetchedAt, new Date(NowMs).toISOString());
  });

  it('provider-checks configured models missing from the list (ruling 16) without adding them to the dropdowns', async (testContext) => {
    silenceStderr(testContext);
    const fake = createFakeModelCatalog({
      modelIds: ['list/me'],
      configuredIds: ['cfg/served', 'cfg/dead', 'cfg/gone', 'cfg/flaky', 'list/me', 'bad id', 'cfg/served', 5],
      answerProvider: (modelId) => {
        switch (modelId) {
          case 'cfg/dead':
            return endpointsResponse(0);
          case 'cfg/gone':
            return new Response('{}', { status: 404 });
          case 'cfg/flaky':
            return new Response('boom', { status: 500 });
          default:
            return undefined;
        }
      },
    });
    const result = await fake.catalog.listModels();
    assert.deepEqual(result.openrouter.map((model) => model.id), ['list/me']);
    assert.deepEqual(fake.providerRequests.toSorted(), ['cfg/dead', 'cfg/flaky', 'cfg/gone', 'cfg/served', 'list/me']);
    assert.equal(fake.catalog.modelStatus('cfg/served'), ModelAvailability.Served);
    assert.equal(fake.catalog.modelStatus('cfg/dead'), ModelAvailability.Unserved);
    assert.equal(fake.catalog.modelStatus('cfg/gone'), ModelAvailability.Unserved);
    assert.equal(fake.catalog.modelStatus('cfg/flaky'), ModelAvailability.Unchecked);
    assert.equal(fake.catalog.modelStatus('bad id'), null);
    for (const configuredId of ['cfg/served', 'cfg/dead', 'cfg/gone', 'cfg/flaky', 'list/me']) {
      assert.equal(fake.catalog.modelCheckedAt(configuredId), result.fetchedAt, configuredId);
    }
    assert.equal(fake.catalog.modelCheckedAt('bad id'), null);
  });

  it('rejects when configuredIdsProvider does not return an array', async () => {
    const fake = createFakeModelCatalog({ modelIds: ['a/b'], configuredIds: () => 'nope' });
    await assert.rejects(() => fake.catalog.listModels(), TypeError);
  });
});

describe('ModelCatalog cache lifetime', () => {
  it('serves from memory until exactly 4 hours, refreshes at the boundary, and on clock rollback', async () => {
    let nowMs = NowMs;
    const fake = createFakeModelCatalog({ modelIds: ['a/b'], nowProvider: () => nowMs });
    assert.equal((await fake.catalog.listModels()).stale, false);
    assert.equal(fake.listRequests, 1);

    nowMs = NowMs + TtlMs - 1;
    await fake.catalog.listModels();
    assert.equal(fake.listRequests, 1);
    assert.equal(fake.providerRequests.length, 1);

    nowMs = NowMs + TtlMs;
    await fake.catalog.listModels();
    assert.equal(fake.listRequests, 2);

    const secondFetchMs = nowMs;
    nowMs = secondFetchMs - 1;
    await fake.catalog.listModels();
    assert.equal(fake.listRequests, 3);

    await fake.catalog.listModels({ refresh: true });
    assert.equal(fake.listRequests, 4);
  });

  it('samples the clock once, after the last provider request', async () => {
    let nowMs = NowMs;
    const fake = createFakeModelCatalog({
      modelIds: ['a/b'],
      nowProvider: () => nowMs,
      answerProvider: () => {
        nowMs += 1000;
        return undefined;
      },
    });
    const result = await fake.catalog.listModels();
    assert.equal(result.fetchedAt, new Date(NowMs + 1000).toISOString());
  });
});

describe('ModelCatalog disk cache', () => {
  it('round-trips through the file: a fresh disk cache sends nothing and an expired one refetches and overwrites', async () => {
    const tempDir = createTempDir();
    const cachePath = path.join(tempDir, 'nested', 'cache.json');
    const first = createFakeModelCatalog({ cachePath, nowProvider: () => NowMs, modelIds: ['a/one', 'b/two'] });
    const firstResult = await first.catalog.listModels();
    assert.equal(fs.statSync(cachePath).mode & 0o777, 0o600);

    const second = createFakeModelCatalog({ cachePath, nowProvider: () => NowMs + TtlMs - 1 });
    const secondResult = await second.catalog.listModels();
    assert.equal(second.listRequests, 0);
    assert.equal(second.providerRequests.length, 0);
    assert.deepEqual(secondResult.openrouter, firstResult.openrouter);
    assert.equal(secondResult.fetchedAt, firstResult.fetchedAt);
    assert.equal(secondResult.stale, false);
    assert.equal(second.catalog.modelStatus('a/one'), ModelAvailability.Served);

    const expiredMs = NowMs + TtlMs;
    const third = createFakeModelCatalog({ cachePath, nowProvider: () => expiredMs, modelIds: ['c/three'] });
    const thirdResult = await third.catalog.listModels();
    assert.equal(third.listRequests, 1);
    assert.deepEqual(thirdResult.openrouter.map((model) => model.id), ['c/three']);
    assert.equal(JSON.parse(fs.readFileSync(cachePath, 'utf8')).fetchedAtMs, expiredMs);
  });

  it('loads a hand-written valid file, skipping malformed entries, deduping and sorting', async () => {
    const tempDir = createTempDir();
    const goodEntry = buildCacheFile().models[0];
    const cachePath = writeCacheFile(tempDir, buildCacheFile({
      models: [
        { ...goodEntry, id: 'z/last', name: '  ', contextLength: -5, promptCostPerMillion: -1, completionCostPerMillion: 'x', isModerated: 'yes', supportsStructuredOutput: 'yes' },
        goodEntry,
        { ...goodEntry, name: 'Duplicate' },
        { ...goodEntry, id: 'no/providers', providerCount: 0 },
        { ...goodEntry, id: 'frac/providers', providerCount: 1.5 },
        { ...goodEntry, id: '' },
        { name: 'no id', providerCount: 1 },
        'string',
        null,
      ],
    }));
    const fake = createFakeModelCatalog({ cachePath, nowProvider: () => NowMs });
    const result = await fake.catalog.listModels();
    assert.equal(fake.listRequests, 0);
    assert.deepEqual(result.openrouter.map((model) => model.id), ['disk/model-b', 'z/last']);
    assert.equal(result.openrouter[0].name, 'Disk Model B');
    const last = result.openrouter[1];
    assert.equal(last.name, 'z/last');
    assert.equal(last.contextLength, null);
    assert.equal(last.promptCostPerMillion, null);
    assert.equal(last.completionCostPerMillion, null);
    assert.equal(last.isModerated, null);
    assert.equal(last.supportsStructuredOutput, false);
    assert.equal(fake.catalog.modelStatus('disk/dead'), ModelAvailability.Unserved);
    assert.equal(fake.catalog.modelStatus('disk/flaky'), ModelAvailability.Unchecked);
    assert.equal(fake.catalog.modelStatus('disk/verdict'), ModelAvailability.Served);
    assert.equal(fake.catalog.modelStatus('disk/model-b'), ModelAvailability.Served);
    assert.equal(fake.catalog.modelCheckedAt('disk/verdict'), VerdictTime);
    assert.equal(fake.catalog.modelCheckedAt('disk/dead'), NowIso);
    assert.equal(fake.catalog.modelCheckedAt('disk/flaky'), NowIso);
    assert.equal(fake.catalog.modelCheckedAt('disk/model-b'), NowIso);
  });

  it('treats every malformed file as a cache miss, recovers on the next live fetch, and rewrites a valid file', async () => {
    const goodEntry = buildCacheFile().models[0];
    const malformedFiles = {
      'invalid JSON': '{not json',
      'null root': 'null',
      'array root': '[]',
      'primitive root': '5',
      'version 1': buildCacheFile({ version: 1 }),
      'missing version': buildCacheFile({ version: undefined }),
      'negative fetchedAtMs': buildCacheFile({ fetchedAtMs: -1, fetchedAt: new Date(0).toISOString() }),
      'fractional fetchedAtMs': buildCacheFile({ fetchedAtMs: NowMs + 0.5 }),
      'string fetchedAtMs': buildCacheFile({ fetchedAtMs: String(NowMs) }),
      'non-string fetchedAt': buildCacheFile({ fetchedAt: 5 }),
      'unparseable fetchedAt': buildCacheFile({ fetchedAt: 'garbage' }),
      'mismatched fetchedAt': buildCacheFile({ fetchedAt: new Date(NowMs + 1000).toISOString() }),
      'models not an array': buildCacheFile({ models: {} }),
      'unservedIds not an array': buildCacheFile({ unservedIds: 'x' }),
      'unservedIds with a non-string': buildCacheFile({ unservedIds: ['a/b', 1] }),
      'uncheckedIds not an array': buildCacheFile({ uncheckedIds: null }),
      'uncheckedIds with a non-string': buildCacheFile({ uncheckedIds: [null] }),
      'verdicts an array': buildCacheFile({ verdicts: [] }),
      'verdicts missing': buildCacheFile({ verdicts: undefined }),
      'verdict with unknown outcome': buildCacheFile({
        verdicts: { 'a/b': { outcome: 'maybe', providerCount: 1, checkedAt: VerdictTime } },
      }),
      'verdict with zero providerCount': buildCacheFile({
        verdicts: { 'a/b': { outcome: 'served', providerCount: 0, checkedAt: VerdictTime } },
      }),
      'verdict with missing providerCount': buildCacheFile({
        verdicts: { 'a/b': { outcome: 'served', checkedAt: VerdictTime } },
      }),
      'verdict not an object': buildCacheFile({ verdicts: { 'a/b': 'served' } }),
      'verdict with missing checkedAt': buildCacheFile({
        verdicts: { 'a/b': { outcome: 'served', providerCount: 1 } },
      }),
      'verdict with non-string checkedAt': buildCacheFile({
        verdicts: { 'a/b': { outcome: 'served', providerCount: 1, checkedAt: 1_800_000_000_000 } },
      }),
      'verdict with unparseable checkedAt': buildCacheFile({
        verdicts: { 'a/b': { outcome: 'served', providerCount: 1, checkedAt: 'garbage' } },
      }),
      'models all invalid': buildCacheFile({ models: [{ ...goodEntry, providerCount: undefined }, null] }),
      'epoch fetchedAtMs with models': buildCacheFile({
        fetchedAtMs: 0,
        fetchedAt: new Date(0).toISOString(),
        unservedIds: [],
        uncheckedIds: [],
      }),
      'epoch fetchedAtMs with unservedIds': buildCacheFile({
        fetchedAtMs: 0,
        fetchedAt: new Date(0).toISOString(),
        models: [],
        uncheckedIds: [],
      }),
      'epoch fetchedAtMs with uncheckedIds': buildCacheFile({
        fetchedAtMs: 0,
        fetchedAt: new Date(0).toISOString(),
        models: [],
        unservedIds: [],
      }),
    };

    for (const [caseName, content] of Object.entries(malformedFiles)) {
      const tempDir = createTempDir();
      const cachePath = writeCacheFile(tempDir, content);
      const fake = createFakeModelCatalog({ cachePath, nowProvider: () => NowMs, modelIds: ['fresh/model'] });
      assert.equal(fake.catalog.modelStatus('disk/dead'), null, caseName);
      assert.equal(fake.catalog.modelStatus('disk/verdict'), null, caseName);
      const result = await fake.catalog.listModels();
      assert.equal(fake.listRequests, 1, caseName);
      assert.deepEqual(result.openrouter.map((model) => model.id), ['fresh/model'], caseName);
      const rewritten = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      assert.equal(rewritten.version, 2, caseName);
      assert.deepEqual(rewritten.models.map((model) => model.id), ['fresh/model'], caseName);
    }
  });

  it('reloads the verdicts of a valid epoch file with empty lists and still lists live', async () => {
    const tempDir = createTempDir();
    const cachePath = writeCacheFile(tempDir, buildCacheFile({
      fetchedAtMs: 0,
      fetchedAt: new Date(0).toISOString(),
      models: [],
      unservedIds: [],
      uncheckedIds: [],
    }));
    const fake = createFakeModelCatalog({ cachePath, nowProvider: () => NowMs, modelIds: ['fresh/model'] });
    assert.equal(fake.catalog.modelStatus('disk/verdict'), ModelAvailability.Served);
    assert.equal(fake.catalog.modelCheckedAt('disk/verdict'), VerdictTime);
    assert.equal(fake.catalog.modelStatus('disk/model-b'), null);
    const result = await fake.catalog.listModels();
    assert.equal(fake.listRequests, 1);
    assert.deepEqual(result.openrouter.map((model) => model.id), ['fresh/model']);
  });

  it('refuses a symlink at the cache path on read (ELOOP) and on write (ELOOP)', async () => {
    const tempDir = createTempDir();
    const targetPath = path.join(tempDir, 'target.json');
    fs.writeFileSync(targetPath, JSON.stringify(buildCacheFile()), 'utf8');
    const readLinkPath = path.join(tempDir, 'read-link.json');
    fs.symlinkSync(targetPath, readLinkPath);
    assert.throws(() => createFakeModelCatalog({ cachePath: readLinkPath }), (error) => error.code === 'ELOOP');

    const writeLinkPath = path.join(tempDir, 'write-link.json');
    const fake = createFakeModelCatalog({ cachePath: writeLinkPath, modelIds: ['a/b'] });
    fs.symlinkSync(targetPath, writeLinkPath);
    await assert.rejects(() => fake.catalog.listModels(), (error) => error.code === 'ELOOP');
    assert.equal(JSON.parse(fs.readFileSync(targetPath, 'utf8')).models[0].id, 'disk/model-b');
    assert.deepEqual(fs.readdirSync(tempDir).toSorted(), ['read-link.json', 'target.json', 'write-link.json']);

    const danglingPath = path.join(tempDir, 'dangling.json');
    const danglingFake = createFakeModelCatalog({ cachePath: danglingPath, modelIds: ['a/b'] });
    fs.symlinkSync(path.join(tempDir, 'missing-target.json'), danglingPath);
    await assert.rejects(() => danglingFake.catalog.listModels(), (error) => error.code === 'ELOOP');
    assert.equal(fs.existsSync(path.join(tempDir, 'missing-target.json')), false);
  });

  it('throws loudly for a non-ENOENT read error', () => {
    const tempDir = createTempDir();
    const directoryPath = path.join(tempDir, 'cache.json');
    fs.mkdirSync(directoryPath);
    assert.throws(() => createFakeModelCatalog({ cachePath: directoryPath }), (error) => error.code === 'EISDIR');
  });

  it('returns live models with stale false and a warning when the cache write fails, unchecked text first', async (testContext) => {
    const stderr = silenceStderr(testContext);
    const tempDir = createTempDir();
    const blockerPath = path.join(tempDir, 'blocker');
    const cachePath = path.join(blockerPath, 'cache.json');
    const fake = createFakeModelCatalog({
      cachePath,
      modelIds: ['a/one', 'b/two'],
      answerProvider: (modelId) => (modelId === 'b/two' ? new Response('boom', { status: 500 }) : undefined),
    });
    fs.writeFileSync(blockerPath, 'a file where a directory should be', 'utf8');

    const result = await fake.catalog.listModels();
    assert.equal(result.stale, false);
    assert.deepEqual(result.openrouter.map((model) => model.id), ['a/one']);
    assert.match(
      result.warning,
      /^1 of 2 models could not be checked \(first reason: HTTP 500\); they are left out until the next refresh\. Loaded live OpenRouter models, but failed to update local cache: .+/,
    );
    assert.equal(stderr.mock.calls.length, 1);
    assert.equal(stderr.mock.calls[0].arguments[0], result.warning);
    assert.deepEqual(fs.readdirSync(tempDir), ['blocker']);
  });

  it('reports only the cache text when the write fails and nothing was unchecked', async (testContext) => {
    silenceStderr(testContext);
    const tempDir = createTempDir();
    const blockerPath = path.join(tempDir, 'blocker');
    const fake = createFakeModelCatalog({ cachePath: path.join(blockerPath, 'cache.json'), modelIds: ['a/one'] });
    fs.writeFileSync(blockerPath, 'x', 'utf8');
    const result = await fake.catalog.listModels();
    assert.match(result.warning, /^Loaded live OpenRouter models, but failed to update local cache: .+/);
    assert.equal(result.stale, false);
  });
});

describe('ModelCatalog shared refresh, abort and close', () => {
  it('runs one refresh for overlapping calls and lets one caller abort without ending it', async () => {
    const gate = createGate();
    const fake = createFakeModelCatalog({
      modelIds: ['a/one', 'b/two'],
      answerList: async () => {
        await gate.promise;
        return undefined;
      },
    });
    const abortController = new AbortController();
    const first = fake.catalog.listModels({ refresh: true });
    const second = fake.catalog.listModels({ refresh: true, signal: abortController.signal });
    const third = fake.catalog.listModels();
    abortController.abort();
    await assert.rejects(() => second, (error) => error.name === 'AbortError');
    gate.open();
    const [firstResult, thirdResult] = await Promise.all([first, third]);
    assert.equal(firstResult, thirdResult);
    assert.equal(fake.listRequests, 1);
    assert.deepEqual(fake.providerRequests.toSorted(), ['a/one', 'b/two']);

    await fake.catalog.listModels();
    assert.equal(fake.listRequests, 1);
  });

  it('rejects immediately with AbortError for an already aborted signal and sends nothing', async () => {
    const fake = createFakeModelCatalog({ modelIds: ['a/b'] });
    const abortController = new AbortController();
    abortController.abort();
    await assert.rejects(() => fake.catalog.listModels({ signal: abortController.signal }), (error) => error.name === 'AbortError');
    await assert.rejects(() => fake.catalog.checkModel('a/b', { signal: abortController.signal }), (error) => error.name === 'AbortError');
    assert.equal(fake.listRequests, 0);
    assert.equal(fake.providerRequests.length, 0);
  });

  it('rejects with AbortError when the signal aborts during the list body read', async () => {
    const abortController = new AbortController();
    const fake = createFakeModelCatalog({
      answerList: (init) => ({
        ok: true,
        status: 200,
        json: () => waitForAbort(init.signal),
      }),
    });
    const pending = fake.catalog.listModels({ signal: abortController.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));
    abortController.abort();
    await assert.rejects(() => pending, (error) => error.name === 'AbortError');
    fake.catalog.close();
  });

  it('close() aborts a running refresh, leaves memory and disk unchanged, and is final', async () => {
    const tempDir = createTempDir();
    const cachePath = path.join(tempDir, 'cache.json');
    const gate = createGate();
    let hold = false;
    const fake = createFakeModelCatalog({
      cachePath,
      nowProvider: () => NowMs,
      modelIds: ['a/one'],
      answerList: async (init) => {
        if (hold) {
          await Promise.race([gate.promise, waitForAbort(init.signal)]);
        }
        return undefined;
      },
    });
    await fake.catalog.listModels();
    const diskBefore = fs.readFileSync(cachePath, 'utf8');
    const resultBefore = await fake.catalog.listModels();

    hold = true;
    const running = fake.catalog.listModels({ refresh: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    fake.catalog.close();
    await assert.rejects(() => running, (error) => error.name === 'AbortError');
    assert.equal(fs.readFileSync(cachePath, 'utf8'), diskBefore);
    assert.equal(fake.catalog.modelCheckedAt('a/one'), resultBefore.fetchedAt);
    assert.equal(fake.catalog.modelStatus('a/one'), ModelAvailability.Served);

    const requestsBefore = fake.listRequests;
    const afterClose = await fake.catalog.listModels({ refresh: true });
    assert.equal(afterClose.openrouter.length, 1);
    assert.equal(fake.listRequests, requestsBefore);
    await assert.rejects(() => fake.catalog.checkModel('a/one'), (error) => error.name === 'AbortError');
  });

  it('close() before any cache leaves no cache file and returns an empty list', async () => {
    const tempDir = createTempDir();
    const cachePath = path.join(tempDir, 'cache.json');
    const gate = createGate();
    const fake = createFakeModelCatalog({
      cachePath,
      modelIds: ['a/one'],
      answerList: async (init) => {
        await Promise.race([gate.promise, waitForAbort(init.signal)]);
        return undefined;
      },
    });
    const running = fake.catalog.listModels();
    await new Promise((resolve) => setTimeout(resolve, 10));
    fake.catalog.close();
    await assert.rejects(() => running, (error) => error.name === 'AbortError');
    assert.equal(fs.existsSync(cachePath), false);
    const afterClose = await fake.catalog.listModels();
    assert.deepEqual([...afterClose.openrouter], []);
    assert.equal(afterClose.fetchedAt, null);
    assert.equal(afterClose.stale, true);
  });

  it('close() stops provider requests that are still in flight', async () => {
    const fake = createFakeModelCatalog({
      modelIds: ['a/one'],
      answerProvider: (modelId, init) => waitForAbort(init.signal),
    });
    const running = fake.catalog.listModels();
    await new Promise((resolve) => setTimeout(resolve, 10));
    fake.catalog.close();
    await assert.rejects(() => running, (error) => error.name === 'AbortError');
  });
});

describe('ModelCatalog.checkModel and modelStatus', () => {
  it('returns served, unserved and unchecked with the measured reasons', async () => {
    const fake = createFakeModelCatalog({
      timeoutMs: 50,
      answerProvider: async (modelId, init) => {
        switch (modelId) {
          case 'a/two':
            return endpointsResponse(2);
          case 'a/zero':
            return endpointsResponse(0);
          case 'a/gone':
            return new Response(JSON.stringify({ error: { message: 'Not Found', code: 404 } }), { status: 404 });
          case 'a/network':
            throw new Error('ECONNRESET');
          case 'a/slow':
            return await waitForAbort(init.signal);
          case 'a/boom':
            return new Response('x', { status: 500 });
          case 'a/badjson':
            return new Response('<html>', { status: 200 });
          case 'a/noshape':
            return new Response(JSON.stringify({ data: {} }), { status: 200 });
          default:
            return undefined;
        }
      },
    });
    /**
     * @param {string} modelId
     * @returns {Promise<Array<string | number | null>>}
     * @throws {Error}
     */
    const check = async (modelId) => {
      const { outcome, providerCount, reason, cacheWarning } = await fake.catalog.checkModel(modelId);
      assert.equal(cacheWarning, null);
      return [outcome, providerCount, reason];
    };
    assert.deepEqual(await check('a/one'), [ModelAvailability.Served, 1, null]);
    assert.deepEqual(await check('a/two'), [ModelAvailability.Served, 2, null]);
    assert.deepEqual(await check('a/zero'), [ModelAvailability.Unserved, null, null]);
    assert.deepEqual(await check('a/gone'), [ModelAvailability.Unserved, null, null]);
    assert.deepEqual(await check('a/network'), [ModelAvailability.Unchecked, null, 'network error: ECONNRESET']);
    assert.deepEqual(await check('a/slow'), [ModelAvailability.Unchecked, null, 'timed out after 0.05 seconds']);
    assert.deepEqual(await check('a/boom'), [ModelAvailability.Unchecked, null, 'HTTP 500']);
    assert.deepEqual(await check('a/badjson'), [ModelAvailability.Unchecked, null, 'malformed response']);
    assert.deepEqual(await check('a/noshape'), [ModelAvailability.Unchecked, null, 'malformed response']);
    assert.equal(fake.listRequests, 0);
  });

  it('refuses a malformed ID with a TypeError and sends no request', async () => {
    const fake = createFakeModelCatalog();
    for (const modelId of ['a/b/endpoints?x=', 'a/b#c', 'a b/c', 'a/b..c', '', 5, null]) {
      await assert.rejects(() => fake.catalog.checkModel(modelId), TypeError, String(modelId));
    }
    assert.equal(fake.providerRequests.length, 0);
  });

  it('records every outcome in verdicts, in memory and on disk, without changing fetchedAt or the dropdown list', async () => {
    const tempDir = createTempDir();
    const cachePath = path.join(tempDir, 'cache.json');
    let nowMs = NowMs;
    let flipped = false;
    const fake = createFakeModelCatalog({
      cachePath,
      nowProvider: () => nowMs,
      modelIds: ['list/dead', 'list/live'],
      answerProvider: (modelId) => (modelId === 'list/dead' && !flipped ? endpointsResponse(0) : undefined),
    });
    const refreshed = await fake.catalog.listModels();
    assert.equal(fake.catalog.modelStatus('list/dead'), ModelAvailability.Unserved);

    flipped = true;
    nowMs += 60_000;
    const served = await fake.catalog.checkModel('list/dead');
    assert.equal(served.outcome, ModelAvailability.Served);
    assert.equal(fake.catalog.modelStatus('list/dead'), ModelAvailability.Served);
    const unlisted = await fake.catalog.checkModel('unlisted/gone');
    assert.equal(unlisted.outcome, ModelAvailability.Served);

    const afterCheck = await fake.catalog.listModels();
    assert.equal(afterCheck.fetchedAt, refreshed.fetchedAt);
    assert.deepEqual(afterCheck.openrouter.map((model) => model.id), ['list/live']);
    assert.equal(fake.listRequests, 1);

    const onDisk = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.equal(onDisk.fetchedAtMs, NowMs);
    const checkedIso = new Date(NowMs + 60_000).toISOString();
    assert.deepEqual(onDisk.verdicts, {
      'list/dead': { outcome: ModelAvailability.Served, providerCount: 1, checkedAt: checkedIso },
      'unlisted/gone': { outcome: ModelAvailability.Served, providerCount: 1, checkedAt: checkedIso },
    });
    assert.deepEqual(onDisk.unservedIds, ['list/dead']);

    const reloaded = createFakeModelCatalog({ cachePath, nowProvider: () => nowMs });
    assert.equal(reloaded.catalog.modelStatus('list/dead'), ModelAvailability.Served);
    assert.equal(reloaded.catalog.modelStatus('unlisted/gone'), ModelAvailability.Served);
    assert.equal(reloaded.catalog.modelCheckedAt('list/dead'), checkedIso);
    assert.equal(reloaded.catalog.modelCheckedAt('unlisted/gone'), checkedIso);
    assert.equal(reloaded.catalog.modelCheckedAt('list/live'), NowIso);
  });

  it('with no checked catalog a served save-time result leaves every other ID null and the file reads back as no catalog', async () => {
    const tempDir = createTempDir();
    const cachePath = path.join(tempDir, 'cache.json');
    const fake = createFakeModelCatalog({ cachePath, nowProvider: () => NowMs, modelIds: ['real/one'] });
    const result = await fake.catalog.checkModel('typed/model');
    assert.equal(result.outcome, ModelAvailability.Served);
    assert.equal(fake.catalog.modelStatus('typed/model'), ModelAvailability.Served);
    assert.equal(fake.catalog.modelStatus('other/model'), null);
    assert.equal(fake.catalog.modelCheckedAt('typed/model'), NowIso);
    assert.equal(fake.catalog.modelCheckedAt('other/model'), null);

    const onDisk = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.equal(onDisk.fetchedAtMs, 0);
    assert.deepEqual(onDisk.models, []);

    const reloaded = createFakeModelCatalog({ cachePath, nowProvider: () => NowMs, modelIds: ['real/one'] });
    assert.equal(reloaded.catalog.modelStatus('typed/model'), ModelAvailability.Served);
    assert.equal(reloaded.catalog.modelCheckedAt('typed/model'), NowIso);
    assert.equal(reloaded.catalog.modelCheckedAt('other/model'), null);
    const listed = await reloaded.catalog.listModels();
    assert.equal(reloaded.listRequests, 1);
    assert.deepEqual(listed.openrouter.map((model) => model.id), ['real/one']);
    assert.equal(reloaded.catalog.modelStatus('typed/model'), null);
  });

  it('a refresh drops earlier save-time verdicts', async () => {
    const fake = createFakeModelCatalog({ modelIds: ['a/one'] });
    await fake.catalog.checkModel('typed/model');
    assert.equal(fake.catalog.modelStatus('typed/model'), ModelAvailability.Served);
    await fake.catalog.listModels({ refresh: true });
    assert.equal(fake.catalog.modelStatus('typed/model'), null);
  });

  it('adds a cache warning when the write fails and throws ELOOP for a symlink', async () => {
    const tempDir = createTempDir();
    const blockerPath = path.join(tempDir, 'blocker');
    const failing = createFakeModelCatalog({ cachePath: path.join(blockerPath, 'cache.json') });
    fs.writeFileSync(blockerPath, 'x', 'utf8');
    const warned = await failing.catalog.checkModel('a/b');
    assert.equal(warned.outcome, ModelAvailability.Served);
    assert.match(warned.cacheWarning, /^The model check result could not be written to the local cache: .+\.$/);
    assert.equal(failing.catalog.modelStatus('a/b'), ModelAvailability.Served);

    const linkPath = path.join(tempDir, 'link.json');
    const linked = createFakeModelCatalog({ cachePath: linkPath });
    fs.symlinkSync(path.join(tempDir, 'nowhere.json'), linkPath);
    await assert.rejects(() => linked.catalog.checkModel('a/b'), (error) => error.code === 'ELOOP');
  });

  it('rejects with AbortError when the signal aborts during the request and records nothing', async () => {
    const abortController = new AbortController();
    const fake = createFakeModelCatalog({ answerProvider: (modelId, init) => waitForAbort(init.signal) });
    const pending = fake.catalog.checkModel('a/b', { signal: abortController.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));
    abortController.abort();
    await assert.rejects(() => pending, (error) => error.name === 'AbortError');
    assert.equal(fake.catalog.modelStatus('a/b'), null);
  });

  it('checkModel neither starts nor waits for a refresh', async () => {
    const gate = createGate();
    const fake = createFakeModelCatalog({
      modelIds: ['a/one'],
      answerList: async () => {
        await gate.promise;
        return undefined;
      },
    });
    const running = fake.catalog.listModels();
    const checked = await fake.catalog.checkModel('typed/model');
    assert.equal(checked.outcome, ModelAvailability.Served);
    assert.equal(fake.listRequests, 1);
    gate.open();
    await running;
    assert.equal(fake.listRequests, 1);
  });
});

describe('ModelCatalog check time and close gap (ruling 18 and checkModel after close)', () => {
  const GapMicrotaskCounts = Object.freeze([2, 3]);

  it('rejects with AbortError and records and writes nothing when close() lands just after the provider answer', async () => {
    for (const microtaskCount of GapMicrotaskCounts) {
      const tempDir = createTempDir();
      const cachePath = path.join(tempDir, 'cache.json');
      const fake = createFakeModelCatalog({
        cachePath,
        answerProvider: () => ({
          ok: true,
          status: 200,
          json: async () => {
            runAfterMicrotasks(() => fake.catalog.close(), microtaskCount);
            return { data: { endpoints: [{ name: 'provider' }] } };
          },
        }),
      });
      await assert.rejects(() => fake.catalog.checkModel('a/b'), (error) => error.name === 'AbortError', String(microtaskCount));
      assert.equal(fake.catalog.modelStatus('a/b'), null, String(microtaskCount));
      assert.equal(fake.catalog.modelCheckedAt('a/b'), null, String(microtaskCount));
      assert.equal(fs.existsSync(cachePath), false, String(microtaskCount));
    }
  });

  it('rejects with AbortError and records and writes nothing when the caller signal aborts just after the provider answer', async () => {
    for (const microtaskCount of GapMicrotaskCounts) {
      const tempDir = createTempDir();
      const cachePath = path.join(tempDir, 'cache.json');
      const abortController = new AbortController();
      const fake = createFakeModelCatalog({
        cachePath,
        answerProvider: () => ({
          ok: true,
          status: 200,
          json: async () => {
            runAfterMicrotasks(() => abortController.abort(), microtaskCount);
            return { data: { endpoints: [{ name: 'provider' }] } };
          },
        }),
      });
      await assert.rejects(
        () => fake.catalog.checkModel('a/b', { signal: abortController.signal }),
        (error) => error.name === 'AbortError',
        String(microtaskCount),
      );
      assert.equal(fake.catalog.modelStatus('a/b'), null, String(microtaskCount));
      assert.equal(fs.existsSync(cachePath), false, String(microtaskCount));
    }
  });

  it('stores the time the provider request answered and round-trips it through the file', async () => {
    const tempDir = createTempDir();
    const cachePath = path.join(tempDir, 'cache.json');
    let nowMs = NowMs;
    const fake = createFakeModelCatalog({
      cachePath,
      nowProvider: () => nowMs,
      answerProvider: () => {
        nowMs += 5000;
        return undefined;
      },
    });
    await fake.catalog.checkModel('a/b');
    const answeredIso = new Date(NowMs + 5000).toISOString();
    assert.equal(fake.catalog.modelCheckedAt('a/b'), answeredIso);
    assert.equal(JSON.parse(fs.readFileSync(cachePath, 'utf8')).verdicts['a/b'].checkedAt, answeredIso);

    const reloaded = createFakeModelCatalog({ cachePath, nowProvider: () => nowMs });
    assert.equal(reloaded.catalog.modelCheckedAt('a/b'), answeredIso);
  });

  it('gives a refresh verdict the refresh fetchedAt and round-trips it through the file', async () => {
    const tempDir = createTempDir();
    const cachePath = path.join(tempDir, 'cache.json');
    const fake = createFakeModelCatalog({
      cachePath,
      nowProvider: () => NowMs,
      modelIds: ['list/me'],
      configuredIds: ['cfg/unlisted'],
    });
    await fake.catalog.listModels();
    assert.equal(fake.catalog.modelCheckedAt('cfg/unlisted'), NowIso);
    assert.equal(JSON.parse(fs.readFileSync(cachePath, 'utf8')).verdicts['cfg/unlisted'].checkedAt, NowIso);

    const reloaded = createFakeModelCatalog({ cachePath, nowProvider: () => NowMs });
    assert.equal(reloaded.catalog.modelCheckedAt('cfg/unlisted'), NowIso);
    assert.equal(reloaded.catalog.modelCheckedAt('list/me'), NowIso);
    assert.equal(reloaded.catalog.modelCheckedAt('never/seen'), null);
  });
});

describe('ModelCatalog save-time results and a running refresh (ruling 17)', () => {
  /**
   * @param {{completionOffsetMs: number, cachePath: string | null}} options
   * @returns {Promise<{fake: ReturnType<typeof createFakeModelCatalog>, checkedIso: string, refreshedIso: string}>}
   * @throws {Error}
   */
  async function runCheckDuringRefresh({ completionOffsetMs, cachePath }) {
    const gate = createGate();
    let nowMs = NowMs;
    let listAnswers = 0;
    const fake = createFakeModelCatalog({
      cachePath,
      nowProvider: () => nowMs,
      modelIds: ['list/x', 'zz/hold'],
      answerProvider: async (modelId) => {
        if (modelId === 'zz/hold') {
          await gate.promise;
        }
        if (modelId === 'list/x') {
          listAnswers += 1;
          return listAnswers === 1 ? endpointsResponse(0) : undefined;
        }
        return undefined;
      },
    });
    const running = fake.catalog.listModels();
    await waitUntil(() => fake.providerRequests.includes('list/x') && fake.providerRequests.includes('zz/hold'));
    nowMs = NowMs + 30_000;
    const checked = await fake.catalog.checkModel('list/x');
    assert.equal(checked.outcome, ModelAvailability.Served);
    nowMs = NowMs + completionOffsetMs;
    gate.open();
    await running;
    return {
      fake,
      checkedIso: new Date(NowMs + 30_000).toISOString(),
      refreshedIso: new Date(NowMs + completionOffsetMs).toISOString(),
    };
  }

  it('keeps a check recorded while the refresh was running, in memory and on disk, whichever way the clock moved', async () => {
    for (const completionOffsetMs of ClockOffsetsMs) {
      const tempDir = createTempDir();
      const cachePath = path.join(tempDir, 'cache.json');
      const { fake, checkedIso, refreshedIso } = await runCheckDuringRefresh({ completionOffsetMs, cachePath });
      const label = String(completionOffsetMs);

      assert.equal(fake.catalog.modelStatus('list/x'), ModelAvailability.Served, label);
      assert.equal(fake.catalog.modelCheckedAt('list/x'), checkedIso, label);
      assert.equal(fake.catalog.modelCheckedAt('zz/hold'), refreshedIso, label);

      const onDisk = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      assert.equal(onDisk.fetchedAt, refreshedIso, label);
      assert.deepEqual(onDisk.verdicts, { 'list/x': { outcome: ModelAvailability.Served, providerCount: 1, checkedAt: checkedIso } }, label);
      assert.deepEqual(onDisk.unservedIds, ['list/x'], label);

      const reloaded = createFakeModelCatalog({ cachePath, nowProvider: () => NowMs + completionOffsetMs });
      assert.equal(reloaded.catalog.modelStatus('list/x'), ModelAvailability.Served, label);
      assert.equal(reloaded.catalog.modelCheckedAt('list/x'), checkedIso, label);
    }
  });

  it('keeps it in the in-memory result of a refresh that runs without a cache file too', async () => {
    const { fake, checkedIso } = await runCheckDuringRefresh({ completionOffsetMs: ClockOffsetsMs[1], cachePath: null });
    assert.equal(fake.catalog.modelStatus('list/x'), ModelAvailability.Served);
    assert.equal(fake.catalog.modelCheckedAt('list/x'), checkedIso);
  });

  it('replaces a check recorded before the refresh started, whichever way the clock moved', async () => {
    for (const completionOffsetMs of ClockOffsetsMs) {
      const tempDir = createTempDir();
      const cachePath = path.join(tempDir, 'cache.json');
      let nowMs = NowMs;
      let listAnswers = 0;
      const fake = createFakeModelCatalog({
        cachePath,
        nowProvider: () => nowMs,
        modelIds: ['list/x'],
        answerProvider: (modelId) => {
          listAnswers += 1;
          return modelId === 'list/x' && listAnswers > 1 ? endpointsResponse(0) : undefined;
        },
      });
      const label = String(completionOffsetMs);
      nowMs = NowMs + 30_000;
      await fake.catalog.checkModel('list/x');
      assert.equal(fake.catalog.modelStatus('list/x'), ModelAvailability.Served, label);

      nowMs = NowMs + completionOffsetMs;
      await fake.catalog.listModels({ refresh: true });
      assert.equal(fake.catalog.modelStatus('list/x'), ModelAvailability.Unserved, label);
      assert.equal(fake.catalog.modelCheckedAt('list/x'), new Date(NowMs + completionOffsetMs).toISOString(), label);
      assert.deepEqual(JSON.parse(fs.readFileSync(cachePath, 'utf8')).verdicts, {}, label);
    }
  });
});

describe('ModelAvailabilityService', () => {
  /**
   * @param {{models?: object, characters?: object[], catalogOptions?: object}} [options]
   * @returns {{service: ModelAvailabilityService, fake: ReturnType<typeof createFakeModelCatalog>, store: {models: object}}}
   * @throws {TypeError | RangeError | Error}
   */
  function buildService({ models = {}, characters = [], catalogOptions = {} } = {}) {
    const store = {
      models: { director: '', composer: '', main: '', recurring: '', scribe: '', ...models },
      /**
       * @returns {{models: object}}
       */
      getSettings() {
        return { models: this.models };
      },
    };
    const scribeService = { listAllCharacters: () => characters };
    const fake = createFakeModelCatalog(catalogOptions);
    const service = new ModelAvailabilityService({ modelCatalog: fake.catalog, store, scribeService });
    return { service, fake, store };
  }

  /**
   * @param {string} modelId
   * @returns {Response | undefined}
   * @throws {Error}
   */
  const deadAnswer = (modelId) => (modelId.startsWith('dead/') ? endpointsResponse(0) : undefined);

  it('validates its dependencies', () => {
    const { fake } = buildService();
    const store = { getSettings: () => ({ models: {} }) };
    const scribeService = { listAllCharacters: () => [] };
    assert.throws(() => new ModelAvailabilityService({ store, scribeService }), TypeError);
    assert.throws(() => new ModelAvailabilityService({ modelCatalog: fake.catalog, scribeService }), TypeError);
    assert.throws(() => new ModelAvailabilityService({ modelCatalog: fake.catalog, store }), TypeError);
    const catalogWithOldCheckedAt = {
      checkModel: fake.catalog.checkModel,
      modelStatus: fake.catalog.modelStatus,
      checkedAt: () => null,
    };
    assert.throws(
      () => new ModelAvailabilityService({ modelCatalog: catalogWithOldCheckedAt, store, scribeService }),
      /modelCheckedAt\(\)/,
    );
  });

  it('sends nothing for unchanged, whitespace-only-changed and cleared slots', async () => {
    const { service, fake } = buildService({ models: { director: 'a/dir', main: 'a/main' } });
    const result = await service.checkSlotChanges({
      director: '  a/dir  ',
      main: '',
      composer: '   ',
      recurring: '',
    });
    assert.deepEqual(result, { refusals: [], warnings: [] });
    assert.equal(fake.providerRequests.length, 0);
  });

  it('checks only changed slots and refuses invalid and unserved IDs with the design texts', async () => {
    const { service, fake } = buildService({
      models: { director: 'a/dir' },
      catalogOptions: { answerProvider: deadAnswer },
    });
    const result = await service.checkSlotChanges({
      scribe: 'dead/scribe',
      director: 'a/dir',
      main: 'bad id/x',
      composer: 'ok/composer',
    });
    assert.deepEqual(result.refusals, [
      "Not saved: the main slot model 'bad id/x' is not a valid OpenRouter model ID; the scribe slot model dead/scribe is not served by any OpenRouter provider.",
    ]);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(fake.providerRequests.toSorted(), ['dead/scribe', 'ok/composer']);
  });

  it('warns for an unchecked slot and for a cache write failure, and refuses nothing', async () => {
    const tempDir = createTempDir();
    const blockerPath = path.join(tempDir, 'blocker');
    const { service } = buildService({
      catalogOptions: {
        cachePath: path.join(blockerPath, 'cache.json'),
        answerProvider: (modelId) => (modelId === 'flaky/main' ? new Response('x', { status: 500 }) : undefined),
      },
    });
    fs.writeFileSync(blockerPath, 'x', 'utf8');
    const result = await service.checkSlotChanges({ main: 'flaky/main' });
    assert.deepEqual(result.refusals, []);
    assert.equal(result.warnings[0], 'The main slot model flaky/main could not be checked: HTTP 500.');
    assert.match(result.warnings[1], /^The model check result could not be written to the local cache: /);
    assert.equal(result.warnings.length, 2);
  });

  it('checks a character override change with the design texts', async () => {
    const { service, fake } = buildService({
      catalogOptions: {
        answerProvider: (modelId) => {
          if (modelId === 'dead/model') {
            return endpointsResponse(0);
          }
          return modelId === 'flaky/model' ? new Response('x', { status: 503 }) : undefined;
        },
      },
    });
    assert.deepEqual(await service.checkOverrideChange('Maya', null, null), { refusals: [], warnings: [] });
    assert.deepEqual(await service.checkOverrideChange('Maya', 'a/b', ' a/b '), { refusals: [], warnings: [] });
    assert.deepEqual(await service.checkOverrideChange('Maya', 'a/b', ''), { refusals: [], warnings: [] });
    assert.equal(fake.providerRequests.length, 0);

    assert.deepEqual(await service.checkOverrideChange('Maya', null, "bad id'/x"), {
      refusals: ["Not saved: Maya's model override 'bad id'/x' is not a valid OpenRouter model ID."],
      warnings: [],
    });
    assert.deepEqual(await service.checkOverrideChange('Maya', 'a/b', 'dead/model'), {
      refusals: ["Not saved: Maya's model override dead/model is not served by any OpenRouter provider."],
      warnings: [],
    });
    assert.deepEqual(await service.checkOverrideChange('The new character', null, 'flaky/model'), {
      refusals: [],
      warnings: ["The new character's model override flaky/model could not be checked: HTTP 503."],
    });
    assert.deepEqual(await service.checkOverrideChange('Maya', null, 'ok/model'), { refusals: [], warnings: [] });
    assert.deepEqual(fake.providerRequests, ['dead/model', 'flaky/model', 'ok/model']);
  });

  it('blocks only on unserved slots and non-archived overrides, with the design text', async (testContext) => {
    silenceStderr(testContext);
    const context = buildService({
      models: { director: 'dead/dir', composer: 'ok/comp', main: 'flaky/main', recurring: 'never/seen' },
      characters: [
        { name: 'Maya', archived: false, modelOverride: 'dead/maya' },
        { name: 'Old Pete', archived: true, modelOverride: 'dead/pete' },
        { name: 'Lize', archived: false, modelOverride: 'ok/lize' },
        { name: 'Blank', archived: false, modelOverride: null },
      ],
      catalogOptions: {
        nowProvider: () => NowMs,
        modelIds: ['dead/dir', 'ok/comp', 'flaky/main', 'dead/maya', 'dead/pete', 'ok/lize'],
        answerProvider: (modelId) => {
          if (modelId.startsWith('dead/')) {
            return endpointsResponse(0);
          }
          return modelId === 'flaky/main' ? new Response('x', { status: 500 }) : undefined;
        },
      },
    });
    assert.equal(context.service.blockingMessage('campaign-1'), null);

    await context.fake.catalog.listModels();
    assert.equal(
      context.service.blockingMessage('campaign-1'),
      `Refused: the director slot uses dead/dir, which no OpenRouter provider serves (checked ${NowIso}); Maya's model override dead/maya is not served by any OpenRouter provider (checked ${NowIso}). Change it in Settings or the character window.`,
    );
  });

  it('gives each named model its own check time: a save-time verdict and a refresh result differ', async () => {
    let nowMs = NowMs;
    const context = buildService({
      models: { director: 'list/dead', scribe: 'typed/dead' },
      characters: [{ name: 'Maya', archived: false, modelOverride: 'override/dead' }],
      catalogOptions: {
        nowProvider: () => nowMs,
        modelIds: ['list/dead'],
        answerProvider: (modelId) => {
          return modelId === 'list/dead' || modelId === 'typed/dead' || modelId === 'override/dead'
            ? endpointsResponse(0)
            : undefined;
        },
      },
    });
    await context.fake.catalog.listModels();
    nowMs = NowMs + 90_000;
    await context.fake.catalog.checkModel('typed/dead');
    nowMs = NowMs + 180_000;
    await context.fake.catalog.checkModel('override/dead');

    const refreshIso = new Date(NowMs).toISOString();
    const typedIso = new Date(NowMs + 90_000).toISOString();
    const overrideIso = new Date(NowMs + 180_000).toISOString();
    assert.equal(
      context.service.blockingMessage('campaign-1'),
      `Refused: the director slot uses list/dead, which no OpenRouter provider serves (checked ${refreshIso}); the scribe slot uses typed/dead, which no OpenRouter provider serves (checked ${typedIso}); Maya's model override override/dead is not served by any OpenRouter provider (checked ${overrideIso}). Change it in Settings or the character window.`,
    );
  });

  it('shows the verdict time when only a save-time verdict exists', async () => {
    const verdictOnly = buildService({
      models: { scribe: 'typed/dead' },
      catalogOptions: {
        nowProvider: () => NowMs,
        answerProvider: (modelId) => (modelId === 'typed/dead' ? endpointsResponse(0) : undefined),
      },
    });
    await verdictOnly.fake.catalog.checkModel('typed/dead');
    assert.equal(
      verdictOnly.service.blockingMessage('campaign-1'),
      `Refused: the scribe slot uses typed/dead, which no OpenRouter provider serves (checked ${NowIso}). Change it in Settings or the character window.`,
    );
  });

  it('a served save-time verdict unblocks a model the last refresh found unserved', async () => {
    let flipped = false;
    const context = buildService({
      models: { director: 'list/dead' },
      catalogOptions: {
        modelIds: ['list/dead'],
        answerProvider: (modelId) => (modelId === 'list/dead' && !flipped ? endpointsResponse(0) : undefined),
      },
    });
    await context.fake.catalog.listModels();
    assert.notEqual(context.service.blockingMessage('campaign-1'), null);
    flipped = true;
    await context.fake.catalog.checkModel('list/dead');
    assert.equal(context.service.blockingMessage('campaign-1'), null);
  });
});

describe('ModelCatalog.contextLength', () => {
  it('returns cached context length for listed served models across live refresh and disk cache, and null for unlisted, unserved, unchecked, and null-context models', async (testContext) => {
    silenceStderr(testContext);
    const tempDir = createTempDir();
    const cachePath = path.join(tempDir, 'cache.json');
    const fake = createFakeModelCatalog({
      cachePath,
      nowProvider: () => NowMs,
      configuredIds: ['cfg/unlisted'],
      answerList: () => new Response(
        JSON.stringify({
          data: [
            { id: 'ok/served', name: 'Served Model', context_length: 131072 },
            { id: 'ok/no-ctx', name: 'No Context Model', context_length: null },
            { id: 'dead/unserved', name: 'Dead Model', context_length: 65536 },
            { id: 'flaky/unchecked', name: 'Flaky Model', context_length: 32768 },
          ],
        }),
        { status: 200 },
      ),
      answerProvider: (modelId) => {
        switch (modelId) {
          case 'dead/unserved': {
            return endpointsResponse(0);
          }
          case 'flaky/unchecked': {
            return new Response('boom', { status: 500 });
          }
          default: {
            return undefined;
          }
        }
      },
    });

    assert.equal(fake.catalog.contextLength('ok/served'), null);
    await fake.catalog.listModels();
    await fake.catalog.checkModel('typed/checked');

    assert.equal(fake.catalog.contextLength('ok/served'), 131072);
    assert.equal(fake.catalog.contextLength('ok/no-ctx'), null);
    assert.equal(fake.catalog.contextLength('dead/unserved'), null);
    assert.equal(fake.catalog.contextLength('flaky/unchecked'), null);
    assert.equal(fake.catalog.contextLength('cfg/unlisted'), null);
    assert.equal(fake.catalog.contextLength('typed/checked'), null);
    assert.equal(fake.catalog.contextLength('never/seen'), null);

    const reloaded = createFakeModelCatalog({ cachePath, nowProvider: () => NowMs + 60_000 });
    assert.equal(reloaded.listRequests, 0);
    assert.equal(reloaded.catalog.contextLength('ok/served'), 131072);
    assert.equal(reloaded.catalog.contextLength('ok/no-ctx'), null);
    assert.equal(reloaded.catalog.contextLength('dead/unserved'), null);
    assert.equal(reloaded.catalog.contextLength('flaky/unchecked'), null);
    assert.equal(reloaded.catalog.contextLength('cfg/unlisted'), null);
    assert.equal(reloaded.catalog.contextLength('never/seen'), null);

    let includeContext = true;
    const mutatingFake = createFakeModelCatalog({
      nowProvider: () => NowMs,
      answerList: () => {
        const models = includeContext
          ? [
              { id: 'ok/served', name: 'Served', context_length: 65536 },
              { id: 'ok/dropped', name: 'Dropped', context_length: 32768 },
            ]
          : [{ id: 'ok/served', name: 'Served', context_length: null }];
        return new Response(JSON.stringify({ data: models }), { status: 200 });
      },
    });
    await mutatingFake.catalog.listModels({ refresh: true });
    assert.equal(mutatingFake.catalog.contextLength('ok/served'), 65536);
    assert.equal(mutatingFake.catalog.contextLength('ok/dropped'), 32768);

    includeContext = false;
    await mutatingFake.catalog.listModels({ refresh: true });
    assert.equal(mutatingFake.catalog.contextLength('ok/served'), null);
    assert.equal(mutatingFake.catalog.contextLength('ok/dropped'), null);
  });
});
