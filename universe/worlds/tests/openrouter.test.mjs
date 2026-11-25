import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { OpenRouterClient } from '../src/openrouter/OpenRouterClient.mjs';
import { ReplyLog } from '../src/openrouter/ReplyLog.mjs';
import { RetryPolicy } from '../src/openrouter/RetryPolicy.mjs';
import { SpendStage } from '../src/store/enums/SpendStage.mjs';
import { SqliteStore } from '../src/store/SqliteStore.mjs';

/**
 * @param {Array<Uint8Array | string>} chunks
 * @param {{failAfterIndex?: number, errorToThrow?: Error, onCancel?: () => void, closeAtEnd?: boolean}} [options]
 * @returns {ReadableStream<Uint8Array>}
 */
function createChunkedStream(chunks, options = {}) {
  const {
    failAfterIndex = -1,
    errorToThrow = new TypeError('Stream connection dropped'),
    onCancel = null,
    closeAtEnd = true,
  } = options;
  const encoder = new TextEncoder();
  let chunkCursor = 0;

  return new ReadableStream({
    /**
     * @param {ReadableStreamDefaultController<Uint8Array>} controller
     * @returns {void}
     */
    pull(controller) {
      if (failAfterIndex >= 0 && chunkCursor === failAfterIndex) {
        controller.error(errorToThrow);
        return;
      }
      if (chunkCursor >= chunks.length) {
        if (closeAtEnd) {
          controller.close();
        }
        return;
      }
      const nextItem = chunks[chunkCursor];
      chunkCursor += 1;
      const bytes = typeof nextItem === 'string' ? encoder.encode(nextItem) : nextItem;
      controller.enqueue(bytes);
    },

    /**
     * @returns {void}
     */
    cancel() {
      if (typeof onCancel === 'function') {
        onCancel();
      }
    },
  });
}

/**
 * @param {string} sseText
 * @param {{onCancel?: () => void}} [options]
 * @returns {Response}
 */
function createSingleByteSseResponse(sseText, options = {}) {
  const allBytes = new TextEncoder().encode(sseText);
  const singleByteChunks = [];
  for (let byteIndex = 0; byteIndex < allBytes.length; byteIndex += 1) {
    singleByteChunks.push(allBytes.slice(byteIndex, byteIndex + 1));
  }
  const stream = createChunkedStream(singleByteChunks, options);
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

/**
 * @returns {{wait: (delayMs: number, signal?: AbortSignal | null) => Promise<void>, recordedDelays: Array<number>}}
 */
function createRecordedWait() {
  const recordedDelays = [];

  /**
   * @param {number} delayMs
   * @param {AbortSignal | null | undefined} signal
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async function wait(delayMs, signal) {
    recordedDelays.push(delayMs);
    if (signal?.aborted) {
      const abortError = new Error('Request aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
  }

  return { wait, recordedDelays };
}

describe('RetryPolicy constants and classifyFailure', () => {
  it('exposes frozen retry constants matching expected backoff delays and status lists', () => {
    assert.equal(Object.isFrozen(RetryPolicy), true);
    assert.equal(Object.isFrozen(RetryPolicy.DelaysMs), true);
    assert.equal(Object.isFrozen(RetryPolicy.RetryStatuses), true);
    assert.equal(Object.isFrozen(RetryPolicy.NonRetryStatuses), true);
    assert.equal(Object.isFrozen(RetryPolicy.TransientReasons), true);
    assert.deepEqual([...RetryPolicy.DelaysMs], [2000, 5000, 10000]);
    assert.deepEqual([...RetryPolicy.RetryStatuses], [408, 429, 500, 502, 503, 504]);
    assert.deepEqual([...RetryPolicy.NonRetryStatuses], [401, 402, 403]);
  });

  it('marks 408, 429, 500, 502, 503, 504 and network errors as retryable when not aborted or quota-blocked', () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      const result = RetryPolicy.classifyFailure({
        status,
        bodyText: `<html>${status} error</html>`,
      });
      assert.equal(Object.isFrozen(result), true);
      assert.equal(result.retryable, true);
      assert.match(result.reason, new RegExp(String(status)));
    }

    const networkResult = RetryPolicy.classifyFailure({
      status: null,
      error: new TypeError('fetch failed'),
      bytesEmitted: 0,
    });
    assert.equal(networkResult.retryable, true);
    assert.equal(networkResult.reason, 'fetch failed');

    const statusZeroResult = RetryPolicy.classifyFailure({
      status: 0,
      error: new Error('socket hang up'),
    });
    assert.equal(statusZeroResult.retryable, true);
    assert.equal(statusZeroResult.reason, 'socket hang up');
  });

  it('refuses retries for 401, 402, 403, other 4xx, aborts, partial streams, and nested quota errors', () => {
    for (const status of [400, 401, 402, 403, 404, 422, 501]) {
      const result = RetryPolicy.classifyFailure({
        status,
        bodyText: JSON.stringify({ error: { message: 'Denied' } }),
      });
      assert.equal(result.retryable, false);
    }

    assert.equal(
      RetryPolicy.classifyFailure({ status: 503, aborted: true }).retryable,
      false,
    );
    const abortError = new Error('The user aborted a request');
    abortError.name = 'AbortError';
    assert.equal(
      RetryPolicy.classifyFailure({ status: null, error: abortError }).retryable,
      false,
    );
    assert.equal(
      RetryPolicy.classifyFailure({ status: 503, bytesEmitted: 1 }).retryable,
      false,
    );
    assert.equal(
      RetryPolicy.classifyFailure({ status: null, error: new TypeError('drop'), bytesEmitted: 4 }).retryable,
      false,
    );

    const quotaPayloads = [
      JSON.stringify({ quota_error: true, error: { message: 'Out of credits' } }),
      JSON.stringify({ error: { message: 'Limit reached', quota_error: true } }),
      JSON.stringify({ error: { message: 'Rate limited', metadata: { quota_error: true } } }),
      JSON.stringify({ error: { message: 'Provider error', metadata: { raw: '{"quota_error":true}' } } }),
      JSON.stringify({ error: { message: 'Billing limit', code: 'insufficient_quota' } }),
      JSON.stringify({ error: { message: 'Billing limit', type: 'insufficient_quota' } }),
    ];

    for (const payload of quotaPayloads) {
      assert.equal(
        RetryPolicy.classifyFailure({ status: 429, bodyText: payload }).retryable,
        false,
      );
      assert.equal(
        RetryPolicy.classifyFailure({ status: 200, bodyText: payload }).retryable,
        false,
      );
    }
  });

  it('classifies HTTP 200 transient JSON errors as retryable and non-transient 200 errors as non-retryable', () => {
    for (const reasonText of RetryPolicy.TransientReasons) {
      const exactResult = RetryPolicy.classifyFailure({
        status: 200,
        bodyText: JSON.stringify({ error: { message: reasonText } }),
      });
      assert.equal(exactResult.retryable, true);

      const substringResult = RetryPolicy.classifyFailure({
        status: 200,
        bodyText: JSON.stringify({ error: { message: `Prefix: ${reasonText.toUpperCase()} suffix` } }),
      });
      assert.equal(substringResult.retryable, true);
    }

    assert.equal(
      RetryPolicy.classifyFailure({
        status: 200,
        bodyText: JSON.stringify({ error: { message: 'Unknown upstream fault', code: 502 } }),
      }).retryable,
      true,
    );
    assert.equal(
      RetryPolicy.classifyFailure({
        status: 200,
        bodyText: JSON.stringify({ error: { message: 'Unknown upstream fault', code: '503' } }),
      }).retryable,
      true,
    );
    assert.equal(
      RetryPolicy.classifyFailure({
        status: 200,
        bodyText: JSON.stringify({ error: { message: 'Invalid model ID', code: 400 } }),
      }).retryable,
      false,
    );
  });

  it('rejects malformed inputs to classifyFailure', () => {
    assert.throws(() => RetryPolicy.classifyFailure(null), TypeError);
    assert.throws(() => RetryPolicy.classifyFailure([]), TypeError);
    assert.throws(() => RetryPolicy.classifyFailure({ bytesEmitted: -1 }), RangeError);
    assert.throws(() => RetryPolicy.classifyFailure({ bytesEmitted: Number.NaN }), RangeError);
    assert.throws(() => RetryPolicy.classifyFailure({ status: 999 }), RangeError);
  });
});

describe('RetryPolicy.runWithRetry', () => {
  it('retries up to delaysMs.length with exact delays and notification metadata', async () => {
    const { wait, recordedDelays } = createRecordedWait();
    const notifications = [];
    const attempts = [];

    const finalValue = await RetryPolicy.runWithRetry(
      async (attempt) => {
        attempts.push(attempt);
        if (attempt < 4) {
          const transientError = new Error(`Failure ${attempt}`);
          transientError.retryable = true;
          transientError.reason = `HTTP 503 attempt ${attempt}`;
          throw transientError;
        }
        return 'ok';
      },
      {
        wait,
        notify: (info) => {
          notifications.push(info);
        },
      },
    );

    assert.equal(finalValue, 'ok');
    assert.deepEqual(attempts, [1, 2, 3, 4]);
    assert.deepEqual(recordedDelays, [2000, 5000, 10000]);
    assert.deepEqual(notifications, [
      { attempt: 1, maxRetries: 3, delayMs: 2000, reason: 'HTTP 503 attempt 1' },
      { attempt: 2, maxRetries: 3, delayMs: 5000, reason: 'HTTP 503 attempt 2' },
      { attempt: 3, maxRetries: 3, delayMs: 10000, reason: 'HTTP 503 attempt 3' },
    ]);
  });

  it('never retries non-retryable, mid-stream, or partial-stream errors even if retryable is true', async () => {
    const { wait, recordedDelays } = createRecordedWait();

    await assert.rejects(
      () => RetryPolicy.runWithRetry(
        async () => {
          const partialError = new Error('Interrupted after partial output');
          partialError.retryable = true;
          partialError.bytesEmitted = 12;
          throw partialError;
        },
        { wait },
      ),
      /Interrupted after partial output/,
    );

    await assert.rejects(
      () => RetryPolicy.runWithRetry(
        async () => {
          const midError = new Error('Mid-stream frame error');
          midError.retryable = true;
          midError.midStreamError = true;
          throw midError;
        },
        { wait },
      ),
      /Mid-stream frame error/,
    );

    assert.deepEqual(recordedDelays, []);
  });

  it('cancels default backoff timer immediately when AbortSignal aborts mid-wait', async () => {
    const controller = new AbortController();
    let operationCalls = 0;
    const startedAt = Date.now();

    const promise = RetryPolicy.runWithRetry(
      async () => {
        operationCalls += 1;
        const transientError = new Error('Temporary 429');
        transientError.retryable = true;
        throw transientError;
      },
      {
        signal: controller.signal,
        delaysMs: [10000],
        notify: () => {
          setTimeout(() => controller.abort(), 15);
        },
      },
    );

    await assert.rejects(promise, (error) => error.name === 'AbortError');
    const elapsedMs = Date.now() - startedAt;
    assert.equal(operationCalls, 1);
    assert.equal(elapsedMs < 2000, true);
  });

  it('aborts immediately before first attempt when signal is pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let operationCalls = 0;

    await assert.rejects(
      () => RetryPolicy.runWithRetry(
        async () => {
          operationCalls += 1;
          return 'unreachable';
        },
        { signal: controller.signal },
      ),
      (error) => error.name === 'AbortError',
    );
    assert.equal(operationCalls, 0);
  });
});

describe('OpenRouterClient validation and key protection', () => {
  it('validates constructor options and normalizes trailing slashes on baseUrl', () => {
    assert.throws(() => new OpenRouterClient(null), TypeError);
    assert.throws(() => new OpenRouterClient({ apiKeyProvider: 'not-fn' }), TypeError);
    assert.throws(() => new OpenRouterClient({ apiKeyProvider: () => 'k', fetchImpl: null }), TypeError);
    assert.throws(() => new OpenRouterClient({ apiKeyProvider: () => 'k', baseUrl: 'ftp://bad.example' }), RangeError);
    assert.throws(() => new OpenRouterClient({ apiKeyProvider: () => 'k', baseUrl: 'https://openrouter.ai/api?x=1' }), RangeError);
    assert.throws(() => new OpenRouterClient({ apiKeyProvider: () => 'k', onSpend: 'bad' }), TypeError);
    assert.throws(() => new OpenRouterClient({ apiKeyProvider: () => 'k', appTitle: 'Bad\nTitle' }), RangeError);
    assert.throws(() => new OpenRouterClient({ apiKeyProvider: () => 'k', appReferer: '' }), RangeError);

    const validClient = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-test',
      fetchImpl: async () => new Response('{}'),
      baseUrl: 'https://proxy.example/api/v1///',
    });
    assert.ok(validClient instanceof OpenRouterClient);
  });

  it('fails loudly without calling fetch when API key or request inputs are invalid and never leaks key', async () => {
    let fetchCalls = 0;
    const secretBadKey = 'sk-or-super-secret-value\ninvalid';
    let currentKey = null;

    const client = new OpenRouterClient({
      apiKeyProvider: () => currentKey,
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response('{}');
      },
    });

    const baseRequest = {
      model: 'openrouter/test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      stage: SpendStage.Director,
    };

    for (const invalidKey of [null, undefined, '', '   ']) {
      currentKey = invalidKey;
      await assert.rejects(() => client.complete(baseRequest), /API key is missing/);
      await assert.rejects(() => client.stream(baseRequest), /API key is missing/);
    }

    currentKey = secretBadKey;
    await assert.rejects(
      () => client.complete(baseRequest),
      (error) => error instanceof RangeError && !error.message.includes('sk-or-super-secret-value'),
    );
    await assert.rejects(
      () => client.stream(baseRequest),
      (error) => error instanceof RangeError && !error.message.includes('sk-or-super-secret-value'),
    );

    currentKey = 'sk-or-valid-key-xyz';
    await assert.rejects(() => client.complete({ ...baseRequest, model: '' }), RangeError);
    await assert.rejects(() => client.complete({ ...baseRequest, messages: [] }), RangeError);
    await assert.rejects(() => client.complete({ ...baseRequest, stage: 'invalid_stage' }), RangeError);
    await assert.rejects(() => client.complete({ ...baseRequest, maxTokens: 0 }), RangeError);
    await assert.rejects(() => client.complete({ ...baseRequest, temperature: -0.1 }), RangeError);
    await assert.rejects(() => client.stream({ ...baseRequest, onDelta: 'nope' }), TypeError);
    assert.equal(fetchCalls, 0);
  });

  it('redacts secret API key if upstream HTTP error echoes it', async () => {
    const secretKey = 'sk-or-echo-secret-9988';
    const client = new OpenRouterClient({
      apiKeyProvider: () => secretKey,
      fetchImpl: async () => new Response(
        JSON.stringify({ error: { message: `Unauthorized token ${secretKey}` } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    await assert.rejects(
      () => client.complete({
        model: 'openrouter/test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        stage: SpendStage.Mind,
      }),
      (error) => {
        assert.equal(error.message.includes(secretKey), false);
        assert.equal(error.bodyText.includes(secretKey), false);
        assert.equal(error.message.includes('[REDACTED]'), true);
        return true;
      },
    );
  });
});

describe('OpenRouterClient.complete', () => {
  it('retries transient HTTP statuses, network throws, and 200 transient JSON errors with 2s/5s/10s backoff', async () => {
    const { wait, recordedDelays } = createRecordedWait();
    const retryEvents = [];
    const seenRequests = [];

    const retryableScenarios = [408, 429, 500, 502, 503, 504, 'network', 'http200'];
    for (const scenario of retryableScenarios) {
      recordedDelays.length = 0;
      retryEvents.length = 0;
      let attemptCount = 0;

      const client = new OpenRouterClient({
        apiKeyProvider: () => 'sk-or-test-key',
        baseUrl: 'https://openrouter.example/api/v1/',
        retryOptions: { wait },
        fetchImpl: async (url, init) => {
          attemptCount += 1;
          seenRequests.push({ url, init });
          if (attemptCount <= 3) {
            if (scenario === 'network') {
              throw new TypeError('Connection reset');
            }
            if (scenario === 'http200') {
              return new Response(
                JSON.stringify({ error: { message: 'Provider returned error', code: 502 } }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
              );
            }
            return new Response(
              JSON.stringify({ error: { message: `Temporary ${scenario}` } }),
              { status: scenario, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Success output' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 15, completion_tokens: 7, cost: 0.00025 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      });

      const response = await client.complete({
        model: 'openrouter/test-model',
        messages: [{ role: 'user', content: 'Ping' }],
        temperature: 0,
        maxTokens: 256,
        responseFormat: { type: 'json_object' },
        stage: SpendStage.Director,
        onRetry: (info) => {
          retryEvents.push(info);
        },
      });

      assert.equal(attemptCount, 4);
      assert.deepEqual(recordedDelays, [2000, 5000, 10000]);
      assert.equal(retryEvents.length, 3);
      assert.equal(response.text, 'Success output');
      assert.equal(response.finishReason, 'stop');
      assert.equal(response.truncated, false);
      assert.deepEqual(response.usage, {
        promptTokens: 15,
        completionTokens: 7,
        costUsd: 0.00025,
      });
    }

    const lastRequest = seenRequests[seenRequests.length - 1];
    assert.equal(lastRequest.url, 'https://openrouter.example/api/v1/chat/completions');
    assert.equal(lastRequest.init.method, 'POST');
    assert.equal(lastRequest.init.headers.Authorization, 'Bearer sk-or-test-key');
    assert.equal(lastRequest.init.headers['X-Title'], 'Worlds');
    assert.equal(lastRequest.init.headers['HTTP-Referer'], 'http://127.0.0.1');
    const parsedRequestBody = JSON.parse(lastRequest.init.body);
    assert.equal(parsedRequestBody.stream, false);
    assert.equal(parsedRequestBody.temperature, 0);
    assert.equal(parsedRequestBody.max_tokens, 256);
    assert.deepEqual(parsedRequestBody.response_format, { type: 'json_object' });
    assert.deepEqual(parsedRequestBody.usage, { include: true });
  });

  it('never retries 401, 402, 403, quota_error, malformed JSON, missing content, or AbortError', async () => {
    const { wait, recordedDelays } = createRecordedWait();

    const nonRetryCases = [
      () => new Response('{"error":{"message":"Unauthorized"}}', { status: 401 }),
      () => new Response('{"error":{"message":"Payment required"}}', { status: 402 }),
      () => new Response('{"error":{"message":"Forbidden"}}', { status: 403 }),
      () => new Response(JSON.stringify({ quota_error: true, error: { message: 'Quota hit' } }), { status: 429 }),
      () => new Response(JSON.stringify({ error: { message: 'Provider returned error', metadata: { quota_error: true } } }), { status: 200 }),
      () => new Response(JSON.stringify({ error: { message: 'Bad model', code: 400 } }), { status: 200 }),
      () => new Response('{not valid json', { status: 200 }),
      () => new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 }),
      () => {
        const abortError = new Error('Aborted');
        abortError.name = 'AbortError';
        throw abortError;
      },
    ];

    for (const makeResponse of nonRetryCases) {
      let fetchCalls = 0;
      const client = new OpenRouterClient({
        apiKeyProvider: () => 'sk-or-test',
        retryOptions: { wait },
        fetchImpl: async () => {
          fetchCalls += 1;
          return makeResponse();
        },
      });

      await assert.rejects(() => client.complete({
        model: 'openrouter/model',
        messages: [{ role: 'user', content: 'Hi' }],
        stage: SpendStage.Mind,
      }));
      assert.equal(fetchCalls, 1);
      assert.deepEqual(recordedDelays, []);
    }
  });

  it('flags length truncation, handles omitted or invalid cost safely, and records spend into SqliteStore', async () => {
    const store = new SqliteStore(':memory:');
    try {
      const campaign = store.createCampaign({ title: 'Spend Integration' });
      let callNumber = 0;

      const client = new OpenRouterClient({
        apiKeyProvider: () => 'sk-or-test',
        onSpend: (spendDto) => store.recordSpend(spendDto),
        fetchImpl: async () => {
          callNumber += 1;
          if (callNumber === 1) {
            return new Response(
              JSON.stringify({
                choices: [{ message: { content: 'Truncated text' }, finish_reason: 'length' }],
                usage: { prompt_tokens: 100, completion_tokens: 50 },
              }),
              { status: 200 },
            );
          }
          if (callNumber === 2) {
            return new Response(
              JSON.stringify({
                choices: [{ message: { content: '' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 20, completion_tokens: 0, cost: -5 },
              }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Priced reply' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 30, completion_tokens: 10, cost: 0.015 },
            }),
            { status: 200 },
          );
        },
      });

      const first = await client.complete({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Turn 1' }],
        stage: SpendStage.Composer,
        campaignId: campaign.id,
      });
      assert.equal(first.truncated, true);
      assert.equal(first.usage.costUsd, null);
      assert.equal(Number.isNaN(first.usage.costUsd), false);
      assert.equal(typeof first.spendId, 'string');

      const second = await client.complete({
        model: 'openrouter/scribe',
        messages: [{ role: 'user', content: 'Turn 2' }],
        stage: SpendStage.Scribe,
        campaignId: null,
      });
      assert.equal(second.text, '');
      assert.equal(second.truncated, false);
      assert.equal(second.usage.costUsd, null);

      const third = await client.complete({
        model: 'openrouter/director',
        messages: [{ role: 'user', content: 'Turn 3' }],
        stage: SpendStage.Director,
        campaignId: campaign.id,
      });
      assert.equal(third.usage.costUsd, 0.015);
      assert.equal(typeof third.spendId, 'string');

      const todayUtc = new Date().toISOString().slice(0, 10);
      const dailySummary = store.getDailySpend(todayUtc);
      assert.equal(dailySummary.callCount, 3);
      assert.equal(dailySummary.unpricedCount, 2);
      assert.ok(Math.abs(dailySummary.totalUsd - 0.015) < 1e-9);
    } finally {
      store.close();
    }
  });
});

describe('OpenRouterClient.stream', () => {
  it('parses single-byte-split multi-byte UTF-8 SSE frames, keepalive comments, CRLF, and [DONE]', async () => {
    const deltas = [];
    const spendCalls = [];
    let cancelledOnDone = false;

    const ssePayload = [
      ': OPENROUTER PROCESSING\r\n',
      '\r\n',
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\r\n',
      '\r\n',
      'data:{"choices":[{"delta":{"content":"Café — 世界"}}]}\r\n',
      '\r\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":40,"completion_tokens":12}}\r\n',
      '\r\n',
      'data: [DONE]\r\n',
      'data: {"choices":[{"delta":{"content":"IGNORED_AFTER_DONE"}}]}\r\n',
    ].join('');

    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      onSpend: (dto) => {
        spendCalls.push(dto);
        return { id: 'spend-stream-1' };
      },
      fetchImpl: async () => createSingleByteSseResponse(ssePayload, {
        onCancel: () => {
          cancelledOnDone = true;
        },
      }),
    });

    const result = await client.stream({
      model: 'openrouter/composer',
      messages: [{ role: 'user', content: 'Describe tavern' }],
      stage: SpendStage.Composer,
      campaignId: 'camp-1',
      onDelta: (chunk) => {
        deltas.push(chunk);
      },
    });

    assert.equal(cancelledOnDone, true);
    assert.deepEqual(deltas, ['Café — 世界', '!']);
    assert.equal(result.text, 'Café — 世界!');
    assert.equal(result.finishReason, 'length');
    assert.equal(result.truncated, true);
    assert.equal(result.spendId, 'spend-stream-1');
    assert.deepEqual(result.usage, {
      promptTokens: 40,
      completionTokens: 12,
      costUsd: null,
    });
    assert.equal(spendCalls.length, 1);
    assert.deepEqual(spendCalls[0], {
      campaignId: 'camp-1',
      turnId: null,
      stage: 'composer',
      model: 'openrouter/composer',
      promptTokens: 40,
      completionTokens: 12,
      costUsd: null,
    });
  });

  it('handles EOF without trailing newline or [DONE] and separate final usage frame', async () => {
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":1,"cost":0}}',
    ].join('');

    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      fetchImpl: async () => createSingleByteSseResponse(ssePayload),
    });

    const result = await client.stream({
      model: 'openrouter/composer',
      messages: [{ role: 'user', content: 'Say hello' }],
      stage: SpendStage.Composer,
    });

    assert.equal(result.text, 'Hello');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.truncated, false);
    assert.deepEqual(result.usage, {
      promptTokens: 9,
      completionTokens: 1,
      costUsd: 0,
    });
  });

  it('retries before first byte on 503, network drop, and 200 application/json transient errors', async () => {
    const { wait, recordedDelays } = createRecordedWait();
    const retryNotices = [];
    let attemptCount = 0;

    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      retryOptions: { wait },
      fetchImpl: async () => {
        attemptCount += 1;
        if (attemptCount === 1) {
          return new Response('Service Unavailable', { status: 503 });
        }
        if (attemptCount === 2) {
          throw new TypeError('ECONNRESET');
        }
        if (attemptCount === 3) {
          return new Response(
            JSON.stringify({ error: { message: 'Provider returned error' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return createSingleByteSseResponse(
          'data: {"choices":[{"delta":{"content":"Recovered"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        );
      },
    });

    const result = await client.stream({
      model: 'openrouter/composer',
      messages: [{ role: 'user', content: 'Retry stream' }],
      stage: SpendStage.Composer,
      onRetry: (info) => {
        retryNotices.push(info);
      },
    });

    assert.equal(attemptCount, 4);
    assert.deepEqual(recordedDelays, [2000, 5000, 10000]);
    assert.equal(retryNotices.length, 3);
    assert.equal(result.text, 'Recovered');
  });

  it('never retries HTTP 200 application/json quota errors or non-transient JSON errors during stream()', async () => {
    const { wait, recordedDelays } = createRecordedWait();
    let fetchCalls = 0;

    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      retryOptions: { wait },
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({ error: { message: 'Provider returned error', metadata: { quota_error: true } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    await assert.rejects(
      () => client.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Test' }],
        stage: SpendStage.Composer,
      }),
      /Quota error/,
    );
    assert.equal(fetchCalls, 1);
    assert.deepEqual(recordedDelays, []);
  });

  it('never retries mid-stream SSE { error } frames (both at 0 deltas and after deltas) and cancels reader', async () => {
    const { wait, recordedDelays } = createRecordedWait();
    const spendCalls = [];

    for (const hasPriorDelta of [false, true]) {
      recordedDelays.length = 0;
      let fetchCalls = 0;
      let readerCancelled = false;
      const receivedDeltas = [];

      const frames = hasPriorDelta
        ? [
            'data: {"choices":[{"delta":{"content":"Partial "}}]}\n\n',
            'data: {"error":{"message":"Provider returned error","code":502}}\n\n',
            'data: {"choices":[{"delta":{"content":"IGNORED_AFTER_ERROR"}}]}\n\n',
          ]
        : [
            ': OPENROUTER PROCESSING\n\n',
            'data: {"error":{"message":"Provider returned error","code":502}}\n\n',
            'data: {"choices":[{"delta":{"content":"IGNORED_AFTER_ERROR"}}]}\n\n',
          ];

      const client = new OpenRouterClient({
        apiKeyProvider: () => 'sk-or-stream',
        retryOptions: { wait },
        onSpend: (dto) => {
          spendCalls.push(dto);
          return { id: 'should-not-happen' };
        },
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response(
            createChunkedStream(frames, {
              onCancel: () => {
                readerCancelled = true;
              },
            }),
            { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
          );
        },
      });

      await assert.rejects(
        () => client.stream({
          model: 'openrouter/composer',
          messages: [{ role: 'user', content: 'Test mid-stream error' }],
          stage: SpendStage.Composer,
          onDelta: (chunk) => {
            receivedDeltas.push(chunk);
          },
        }),
        /Provider returned error/,
      );

      assert.equal(fetchCalls, 1);
      assert.equal(readerCancelled, true);
      assert.deepEqual(recordedDelays, []);
      assert.deepEqual(receivedDeltas, hasPriorDelta ? ['Partial '] : []);
    }

    assert.equal(spendCalls.length, 0);
  });

  it('never retries if stream drops after emitting at least one delta, and records spend only if usage arrived', async () => {
    const { wait, recordedDelays } = createRecordedWait();
    const spendCalls = [];
    let fetchCalls = 0;

    const clientWithoutUsage = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      retryOptions: { wait },
      onSpend: (dto) => {
        spendCalls.push(dto);
        return { id: 'spend-none' };
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(
          createChunkedStream(
            ['data: {"choices":[{"delta":{"content":"First chunk"}}]}\n\n'],
            { failAfterIndex: 1 },
          ),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        );
      },
    });

    await assert.rejects(
      () => clientWithoutUsage.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Drop mid stream' }],
        stage: SpendStage.Composer,
      }),
      /Stream connection dropped/,
    );
    assert.equal(fetchCalls, 1);
    assert.deepEqual(recordedDelays, []);
    assert.equal(spendCalls.length, 0);

    let fetchCallsWithUsage = 0;
    const clientWithUsageBeforeDrop = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      retryOptions: { wait },
      onSpend: (dto) => {
        spendCalls.push(dto);
        return { id: 'spend-partial' };
      },
      fetchImpl: async () => {
        fetchCallsWithUsage += 1;
        return new Response(
          createChunkedStream(
            [
              'data: {"choices":[{"delta":{"content":"Chunk"}}],"usage":{"prompt_tokens":11,"completion_tokens":3,"cost":0.004}}\n\n',
            ],
            { failAfterIndex: 1 },
          ),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        );
      },
    });

    await assert.rejects(
      () => clientWithUsageBeforeDrop.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Drop after usage' }],
        stage: SpendStage.Composer,
      }),
      /Stream connection dropped/,
    );
    assert.equal(fetchCallsWithUsage, 1);
    assert.equal(spendCalls.length, 1);
    assert.equal(spendCalls[0].costUsd, 0.004);
  });

  it('aborts cleanly on pre-aborted signal or mid-stream abort without recording unreceived spend', async () => {
    const controller = new AbortController();
    const spendCalls = [];
    let fetchCalls = 0;

    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      onSpend: (dto) => {
        spendCalls.push(dto);
        return { id: 'unexpected' };
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(
          createChunkedStream(['data: {"choices":[{"delta":{"content":"One"}}]}\n\n']),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        );
      },
    });

    controller.abort();
    await assert.rejects(
      () => client.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Aborted' }],
        stage: SpendStage.Composer,
        signal: controller.signal,
      }),
      (error) => error.name === 'AbortError',
    );
    assert.equal(fetchCalls, 0);
    assert.equal(spendCalls.length, 0);

    const midController = new AbortController();
    await assert.rejects(
      () => client.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Abort mid delta' }],
        stage: SpendStage.Composer,
        signal: midController.signal,
        onDelta: () => {
          midController.abort();
        },
      }),
      (error) => error.name === 'AbortError',
    );
    assert.equal(fetchCalls, 1);
    assert.equal(spendCalls.length, 0);
  });
});

describe('OpenRouterClient and RetryPolicy adversarial regressions', () => {
  it('blocks non-retryable 4xx error codes on HTTP 200 even with transient message and handles choice.error', async () => {
    for (const statusCode of [400, 401, 403, 404, 422, '401']) {
      const result = RetryPolicy.classifyFailure({
        status: 200,
        bodyText: JSON.stringify({ error: { message: 'Provider returned error', code: statusCode } }),
      });
      assert.equal(result.retryable, false);
    }

    assert.equal(
      RetryPolicy.classifyFailure({
        status: 200,
        bodyText: JSON.stringify({ error: { message: 'Provider returned error', code: 429 } }),
      }).retryable,
      true,
    );

    assert.equal(
      RetryPolicy.classifyFailure({
        status: 200,
        bodyText: JSON.stringify({ choices: [{ error: { message: 'Provider returned error', code: 502 } }] }),
      }).retryable,
      true,
    );

    assert.equal(
      RetryPolicy.classifyFailure({
        status: 200,
        bodyText: JSON.stringify({ choices: [{ error: { message: 'Provider returned error', code: 401 } }] }),
      }).retryable,
      false,
    );

    const { wait, recordedDelays } = createRecordedWait();
    let fetchCalls = 0;
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-test',
      retryOptions: { wait },
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({ error: { message: 'Provider returned error', code: 401 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    await assert.rejects(
      () => client.complete({
        model: 'openrouter/model',
        messages: [{ role: 'user', content: 'Hi' }],
        stage: SpendStage.Director,
      }),
      /HTTP 401: Provider returned error/,
    );
    assert.equal(fetchCalls, 1);
    assert.deepEqual(recordedDelays, []);
  });

  it('sanitizes malformed status, bodyText, and bytesEmitted on caught errors in RetryPolicy.runWithRetry', async () => {
    const { wait, recordedDelays } = createRecordedWait();
    let attempts = 0;

    const result = await RetryPolicy.runWithRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          const messyError = new TypeError('Temporary network fault');
          messyError.status = 'ECONNRESET';
          messyError.bytesEmitted = -5;
          messyError.bodyText = 12345;
          throw messyError;
        }
        return 'recovered';
      },
      { wait, delaysMs: [2000] },
    );

    assert.equal(result, 'recovered');
    assert.equal(attempts, 2);
    assert.deepEqual(recordedDelays, [2000]);
  });

  it('rejects control or non-ByteString characters in headers and validates responseFormat and onDelta before apiKeyProvider', async () => {
    assert.throws(() => new OpenRouterClient({ apiKeyProvider: () => 'sk-or-ok', appTitle: 'Worlds\tApp' }), RangeError);
    assert.throws(() => new OpenRouterClient({ apiKeyProvider: () => 'sk-or-ok', appTitle: 'Worlds\x7fApp' }), RangeError);
    assert.throws(() => new OpenRouterClient({ apiKeyProvider: () => 'sk-or-ok', appTitle: 'Worlds\u2014App' }), RangeError);
    assert.throws(() => new OpenRouterClient({ apiKeyProvider: () => 'sk-or-ok', appReferer: 'http://127.0.0.1\u2014' }), RangeError);

    const validHeaderClient = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-ok',
      appTitle: 'Worlds App',
      fetchImpl: async () => new Response('{}'),
    });
    assert.ok(validHeaderClient instanceof OpenRouterClient);

    let keyCalls = 0;
    let activeKey = 'sk-or-ok';
    const client = new OpenRouterClient({
      apiKeyProvider: () => {
        keyCalls += 1;
        return activeKey;
      },
      fetchImpl: async () => new Response('{}'),
    });

    await assert.rejects(
      () => client.complete({
        model: 'openrouter/model',
        messages: [{ role: 'user', content: 'Hi' }],
        stage: SpendStage.Director,
        responseFormat: 'invalid-format',
      }),
      TypeError,
    );
    await assert.rejects(
      () => client.stream({
        model: 'openrouter/model',
        messages: [{ role: 'user', content: 'Hi' }],
        stage: SpendStage.Composer,
        onDelta: 'invalid-callback',
      }),
      TypeError,
    );
    assert.equal(keyCalls, 0);

    for (const badKey of ['sk-or bad', ' sk-or ', 'sk-or\tbad', 'sk-or\x7fbad', 'sk-or\u2014bad']) {
      activeKey = badKey;
      await assert.rejects(
        () => client.complete({
          model: 'openrouter/model',
          messages: [{ role: 'user', content: 'Hi' }],
          stage: SpendStage.Mind,
        }),
        (error) => error instanceof RangeError && !error.message.includes('sk-or'),
      );
    }
  });

  it('supports choice.error retries, array message.content parts, refusal fallback, and -0 usage normalization in complete()', async () => {
    const { wait, recordedDelays } = createRecordedWait();
    let callCount = 0;

    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-complete',
      retryOptions: { wait },
      fetchImpl: async () => {
        callCount += 1;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({ choices: [{ error: { message: 'Provider returned error', code: 502 } }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (callCount === 2) {
          return new Response(
            JSON.stringify({
              choices: [{
                message: {
                  content: [
                    'Alpha ',
                    { type: 'text', text: 'Beta ' },
                    { type: 'output_text', text: 'Gamma' },
                    { type: 'image_url', image_url: { url: 'https://example.invalid/x.png' } },
                    { text: ' Delta' },
                  ],
                },
                finish_reason: 'stop',
              }],
              usage: { prompt_tokens: -0, completion_tokens: -0, cost: -0 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: null,
                refusal: 'Cannot comply',
              },
              finish_reason: 'stop',
            }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    const partsResult = await client.complete({
      model: 'openrouter/model',
      messages: [{ role: 'user', content: 'Test parts' }],
      stage: SpendStage.Mind,
    });
    assert.equal(partsResult.text, 'Alpha Beta Gamma Delta');
    assert.deepEqual(recordedDelays, [2000]);
    assert.equal(Object.is(partsResult.usage.promptTokens, 0), true);
    assert.equal(Object.is(partsResult.usage.completionTokens, 0), true);
    assert.equal(Object.is(partsResult.usage.costUsd, 0), true);

    const refusalResult = await client.complete({
      model: 'openrouter/model',
      messages: [{ role: 'user', content: 'Test refusal' }],
      stage: SpendStage.Mind,
    });
    assert.equal(refusalResult.text, 'Cannot comply');
  });

  it('redacts API key from fetch, response.text, reader.read, DOMException, and retry notify reasons', async () => {
    const secretKey = 'sk-or-deep-secret-4242';
    const { wait } = createRecordedWait();
    const notifyReasons = [];
    let attemptIndex = 0;

    const client = new OpenRouterClient({
      apiKeyProvider: () => secretKey,
      retryOptions: {
        wait,
        notify: (info) => {
          notifyReasons.push(info.reason);
        },
      },
      fetchImpl: async () => {
        attemptIndex += 1;
        if (attemptIndex === 1) {
          throw new TypeError(`Network error carrying ${secretKey}`);
        }
        if (attemptIndex === 2) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'Content-Type': 'application/json' }),
            text: async () => {
              throw new TypeError(`Body read error carrying ${secretKey}`);
            },
          };
        }
        throw new DOMException(`Aborted carrying ${secretKey}`, 'AbortError');
      },
    });

    await assert.rejects(
      () => client.complete({
        model: 'openrouter/model',
        messages: [{ role: 'user', content: 'Secret check' }],
        stage: SpendStage.Director,
      }),
      (error) => {
        assert.equal(error.name, 'AbortError');
        assert.equal(error.message.includes(secretKey), false);
        assert.equal(error.message.includes('[REDACTED]'), true);
        assert.equal((error.stack ?? '').includes(secretKey), false);
        return true;
      },
    );

    assert.equal(notifyReasons.length, 2);
    for (const reasonText of notifyReasons) {
      assert.equal(reasonText.includes(secretKey), false);
      assert.equal(reasonText.includes('[REDACTED]'), true);
    }

    const streamClient = new OpenRouterClient({
      apiKeyProvider: () => secretKey,
      retryOptions: { wait, delaysMs: [] },
      fetchImpl: async () => new Response(
        createChunkedStream([], {
          failAfterIndex: 0,
          errorToThrow: new TypeError(`Stream read failed with ${secretKey}`),
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    });

    await assert.rejects(
      () => streamClient.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Stream leak check' }],
        stage: SpendStage.Composer,
      }),
      (error) => {
        assert.equal(error.message.includes(secretKey), false);
        assert.equal(error.message.includes('[REDACTED]'), true);
        assert.equal((error.stack ?? '').includes(secretKey), false);
        return true;
      },
    );
  });

  it('handles non-SSE text/plain JSON errors, HTML responses, and comment-only EOF streams in stream()', async () => {
    const { wait, recordedDelays } = createRecordedWait();
    const spendCalls = [];
    let attemptCount = 0;

    const recoveringClient = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      retryOptions: { wait },
      onSpend: (dto) => {
        spendCalls.push(dto);
        return { id: 'spend-ok' };
      },
      fetchImpl: async () => {
        attemptCount += 1;
        if (attemptCount === 1) {
          return new Response(
            JSON.stringify({ error: { message: 'Provider returned error', code: 502 } }),
            { status: 200, headers: { 'Content-Type': 'text/plain' } },
          );
        }
        if (attemptCount === 2) {
          return new Response(
            ': OPENROUTER PROCESSING\n\n: keepalive\n\n',
            { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
          );
        }
        return new Response(
          'data: {"choices":[{"delta":{"content":"Recovered SSE"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          { status: 200 },
        );
      },
    });

    const recovered = await recoveringClient.stream({
      model: 'openrouter/composer',
      messages: [{ role: 'user', content: 'Test recovery' }],
      stage: SpendStage.Composer,
    });
    assert.equal(recovered.text, 'Recovered SSE');
    assert.deepEqual(recordedDelays, [2000, 5000]);
    assert.equal(spendCalls.length, 1);

    const htmlSecret = 'sk-or-html-secret';
    let htmlFetches = 0;
    const htmlClient = new OpenRouterClient({
      apiKeyProvider: () => htmlSecret,
      retryOptions: { wait },
      onSpend: (dto) => {
        spendCalls.push(dto);
        return { id: 'never' };
      },
      fetchImpl: async () => {
        htmlFetches += 1;
        return new Response(
          `<html><body>Gateway page ${htmlSecret}</body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      },
    });

    await assert.rejects(
      () => htmlClient.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'HTML error' }],
        stage: SpendStage.Composer,
      }),
      (error) => {
        assert.match(error.message, /non-SSE response/);
        assert.equal(error.message.includes(htmlSecret), false);
        assert.equal(error.message.includes('[REDACTED]'), true);
        return true;
      },
    );
    assert.equal(htmlFetches, 1);

    let emptyAttempts = 0;
    const emptyCommentsClient = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      retryOptions: { wait, delaysMs: [2000] },
      onSpend: (dto) => {
        spendCalls.push(dto);
        return { id: 'never' };
      },
      fetchImpl: async () => {
        emptyAttempts += 1;
        return new Response(
          ': OPENROUTER PROCESSING\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        );
      },
    });

    await assert.rejects(
      () => emptyCommentsClient.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Empty keepalive' }],
        stage: SpendStage.Composer,
      }),
      /ended before any data frame/,
    );
    assert.equal(emptyAttempts, 2);
    assert.equal(spendCalls.length, 1);
  });

  it('stops immediately on abort inside multi-event chunks and cancels reader even when aborted', async () => {
    const controller = new AbortController();
    const spendCalls = [];
    const receivedDeltas = [];
    let readerCancelled = false;

    const multiEventChunk = [
      'data: {"choices":[{"delta":{"content":"First"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Second"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"cost":0.02}}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      onSpend: (dto) => {
        spendCalls.push(dto);
        return { id: 'never' };
      },
      fetchImpl: async () => new Response(
        createChunkedStream([multiEventChunk], {
          closeAtEnd: false,
          onCancel: () => {
            readerCancelled = true;
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    });

    await assert.rejects(
      () => client.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Multi-event abort' }],
        stage: SpendStage.Composer,
        signal: controller.signal,
        onDelta: (delta) => {
          receivedDeltas.push(delta);
          controller.abort();
        },
      }),
      (error) => error.name === 'AbortError',
    );

    assert.deepEqual(receivedDeltas, ['First']);
    assert.equal(readerCancelled, true);
    assert.equal(spendCalls.length, 0);
  });

  it('shields primary error when reader.cancel() rejects and treats choice.error in stream() as non-retryable', async () => {
    const { wait, recordedDelays } = createRecordedWait();

    /**
     * @param {Array<string>} chunks
     * @returns {ReadableStream<Uint8Array>}
     */
    function createRejectingCancelStream(chunks) {
      const encoder = new TextEncoder();
      let chunkIndex = 0;
      return new ReadableStream({
        /**
         * @param {ReadableStreamDefaultController<Uint8Array>} controller
         * @returns {void}
         */
        pull(controller) {
          if (chunkIndex >= chunks.length) {
            return;
          }
          controller.enqueue(encoder.encode(chunks[chunkIndex]));
          chunkIndex += 1;
        },

        /**
         * @returns {Promise<void>}
         */
        async cancel() {
          throw new Error('Cancel rejected during teardown');
        },
      });
    }

    let choiceErrorFetches = 0;
    const choiceErrorClient = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      retryOptions: { wait },
      fetchImpl: async () => {
        choiceErrorFetches += 1;
        return new Response(
          createRejectingCancelStream([
            'data: {"choices":[{"error":{"message":"Choice stream fault","code":502}}]}\n\n',
            'data: [DONE]\n\n',
          ]),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        );
      },
    });

    await assert.rejects(
      () => choiceErrorClient.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Choice error' }],
        stage: SpendStage.Composer,
      }),
      /Choice stream fault/,
    );
    assert.equal(choiceErrorFetches, 1);
    assert.deepEqual(recordedDelays, []);

    const deltaErrorClient = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      retryOptions: { wait },
      fetchImpl: async () => new Response(
        createRejectingCancelStream([
          'data: {"choices":[{"delta":{"content":"One"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    });

    await assert.rejects(
      () => deltaErrorClient.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Callback boom' }],
        stage: SpendStage.Composer,
        onDelta: () => {
          throw new Error('Callback boom');
        },
      }),
      /Callback boom/,
    );

    const doneCancelClient = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      fetchImpl: async () => new Response(
        createRejectingCancelStream([
          'data: {"choices":[{"delta":{"content":"Clean"},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    });

    const doneResult = await doneCancelClient.stream({
      model: 'openrouter/composer',
      messages: [{ role: 'user', content: 'Done cancel fail' }],
      stage: SpendStage.Composer,
    });
    assert.equal(doneResult.text, 'Clean');
  });

  it('supports standalone CR, split CR+LF across chunks, and multi-line data events preserving extra spaces', async () => {
    const splitChunks = [
      'data: {"choices":[{"delta":\r',
      '\n',
      'data: {"content":"  spaced"}}]}\r',
      '\rdata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\r',
      'data: [DONE]\r',
    ];

    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-stream',
      fetchImpl: async () => new Response(
        createChunkedStream(splitChunks),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    });

    const result = await client.stream({
      model: 'openrouter/composer',
      messages: [{ role: 'user', content: 'Line endings' }],
      stage: SpendStage.Composer,
    });

    assert.equal(result.text, '  spaced');
    assert.equal(result.finishReason, 'stop');
  });

  it('redacts nested and cyclic error.cause chains without mutating original objects', async () => {
    const secretKey = 'sk-or-cause-secret-7777';
    const { wait } = createRecordedWait();

    const deepCause = new Error(`Authorization: Bearer ${secretKey}`);
    const middleCause = new Error('Middle failure', { cause: deepCause });
    const outerError = new TypeError('fetch failed', { cause: middleCause });
    deepCause.cause = outerError;
    outerError.retryable = false;

    const client = new OpenRouterClient({
      apiKeyProvider: () => secretKey,
      retryOptions: { wait },
      fetchImpl: async () => {
        throw outerError;
      },
    });

    await assert.rejects(
      () => client.complete({
        model: 'openrouter/model',
        messages: [{ role: 'user', content: 'Cyclic cause check' }],
        stage: SpendStage.Director,
      }),
      (sanitizedError) => {
        assert.equal(sanitizedError.name, 'TypeError');
        assert.equal(sanitizedError.message, 'fetch failed');
        assert.notEqual(sanitizedError, outerError);
        assert.equal(sanitizedError.cause.message, 'Middle failure');
        assert.equal(sanitizedError.cause.cause.message, 'Authorization: Bearer [REDACTED]');
        assert.equal((sanitizedError.cause.cause.stack ?? '').includes(secretKey), false);
        assert.equal(sanitizedError.cause.cause.cause, sanitizedError);
        assert.equal(deepCause.message, `Authorization: Bearer ${secretKey}`);
        return true;
      },
    );

    const cleanInner = new Error('Clean inner');
    const cleanOuter = new TypeError('Clean outer', { cause: cleanInner });
    cleanInner.cause = cleanOuter;
    cleanOuter.retryable = false;

    const cleanClient = new OpenRouterClient({
      apiKeyProvider: () => secretKey,
      retryOptions: { wait },
      fetchImpl: async () => {
        throw cleanOuter;
      },
    });

    await assert.rejects(
      () => cleanClient.complete({
        model: 'openrouter/model',
        messages: [{ role: 'user', content: 'Clean cycle check' }],
        stage: SpendStage.Director,
      }),
      (returnedError) => returnedError === cleanOuter,
    );
  });

  it('redacts AggregateError.errors and nested string causes cleanly', async () => {
    const secretKey = 'sk-or-aggregate-secret-8888';
    const { wait } = createRecordedWait();

    const nestedError = new Error(`Bearer ${secretKey}`);
    const aggregate = new AggregateError(
      [nestedError, `Nested string ${secretKey}`],
      `outer ${secretKey}`,
      { cause: `String cause ${secretKey}` },
    );
    aggregate.retryable = false;

    const client = new OpenRouterClient({
      apiKeyProvider: () => secretKey,
      retryOptions: { wait },
      fetchImpl: async () => {
        throw aggregate;
      },
    });

    await assert.rejects(
      () => client.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Aggregate check' }],
        stage: SpendStage.Composer,
      }),
      (sanitizedError) => {
        assert.equal(sanitizedError instanceof AggregateError, true);
        assert.equal(sanitizedError.message, 'outer [REDACTED]');
        assert.equal((sanitizedError.stack ?? '').includes(secretKey), false);
        assert.equal(sanitizedError.cause, 'String cause [REDACTED]');
        assert.equal(sanitizedError.errors[0].message, 'Bearer [REDACTED]');
        assert.equal((sanitizedError.errors[0].stack ?? '').includes(secretKey), false);
        assert.equal(sanitizedError.errors[1], 'Nested string [REDACTED]');
        return true;
      },
    );
  });

  it('redacts read-only reason and bodyText properties without throwing read-only assignment TypeError', async () => {
    const secretKey = 'sk-or-readonly-secret-9999';
    const { wait } = createRecordedWait();

    const readonlyError = new Error('Clean top message');
    readonlyError.retryable = false;
    Object.defineProperty(readonlyError, 'reason', {
      value: `Reason leaked ${secretKey}`,
      writable: false,
      enumerable: true,
    });
    Object.defineProperty(readonlyError, 'bodyText', {
      value: `Body leaked ${secretKey}`,
      writable: false,
      enumerable: true,
    });

    const client = new OpenRouterClient({
      apiKeyProvider: () => secretKey,
      retryOptions: { wait },
      fetchImpl: async () => {
        throw readonlyError;
      },
    });

    await assert.rejects(
      () => client.complete({
        model: 'openrouter/model',
        messages: [{ role: 'user', content: 'Readonly descriptor check' }],
        stage: SpendStage.Mind,
      }),
      (sanitizedError) => {
        assert.equal(sanitizedError.message, 'Clean top message');
        assert.equal(sanitizedError.reason, 'Reason leaked [REDACTED]');
        assert.equal(sanitizedError.bodyText, 'Body leaked [REDACTED]');
        assert.equal(readonlyError.reason, `Reason leaked ${secretKey}`);
        assert.equal(readonlyError.bodyText, `Body leaked ${secretKey}`);
        return true;
      },
    );
  });

  it('redacts plain-object cause carrying reason or bodyText secrets', async () => {
    const secretKey = 'sk-or-plain-cause-1010';
    const { wait } = createRecordedWait();

    const reasonCauseError = new Error('Outer reason check', {
      cause: { reason: `Bearer ${secretKey}` },
    });
    reasonCauseError.retryable = false;

    const bodyCauseError = new Error('Outer bodyText check', {
      cause: { bodyText: `Bearer ${secretKey}` },
    });
    bodyCauseError.retryable = false;

    let throwIndex = 0;
    const client = new OpenRouterClient({
      apiKeyProvider: () => secretKey,
      retryOptions: { wait },
      fetchImpl: async () => {
        throwIndex += 1;
        if (throwIndex === 1) {
          throw reasonCauseError;
        }
        throw bodyCauseError;
      },
    });

    await assert.rejects(
      () => client.complete({
        model: 'openrouter/model',
        messages: [{ role: 'user', content: 'Plain cause reason' }],
        stage: SpendStage.Mind,
      }),
      (sanitizedError) => {
        assert.equal(sanitizedError.cause.reason, 'Bearer [REDACTED]');
        return true;
      },
    );

    await assert.rejects(
      () => client.complete({
        model: 'openrouter/model',
        messages: [{ role: 'user', content: 'Plain cause bodyText' }],
        stage: SpendStage.Mind,
      }),
      (sanitizedError) => {
        assert.equal(sanitizedError.cause.bodyText, 'Bearer [REDACTED]');
        return true;
      },
    );
  });
});

const replyLogTempDirs = [];

after(() => {
  for (const tempDir of replyLogTempDirs) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

/**
 * @returns {{logPath: string, replyLog: ReplyLog}}
 * @throws {Error}
 */
function createReplyLogFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-reply-log-test-'));
  replyLogTempDirs.push(tempDir);
  const logPath = path.join(tempDir, 'nested', 'model-replies.log');
  return { logPath, replyLog: new ReplyLog(logPath) };
}

/**
 * @param {string} logPath
 * @returns {{header: string, body: string}}
 * @throws {Error}
 */
function readSingleRecord(logPath) {
  const content = fs.readFileSync(logPath, 'utf8');
  assert.equal(content.endsWith('\n\n'), true);
  const headerEnd = content.indexOf('\n');
  return {
    header: content.slice(0, headerEnd),
    body: content.slice(headerEnd + 1, content.length - 2),
  };
}

/**
 * @param {string} content
 * @returns {Response}
 */
function createCompletionResponse(content) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 15, completion_tokens: 7 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('OpenRouterClient reply log', () => {
  it('logs a successful complete() reply byte for byte with a full header', async () => {
    const { logPath, replyLog } = createReplyLogFixture();
    const reply = '  \n  not json {"a": \n\t trailing  \n\n';
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-test-key',
      replyLog,
      fetchImpl: async () => createCompletionResponse(reply),
    });

    const result = await client.complete({
      model: 'openrouter/model',
      messages: [{ role: 'user', content: 'Secret prompt text' }],
      stage: SpendStage.Mind,
      campaignId: 'camp-9',
    });

    assert.equal(result.text, reply);
    const record = readSingleRecord(logPath);
    assert.match(
      record.header,
      /^=== \d{4}-\d{2}-\d{2}T[\d:.]+Z \| stage=mind \| campaign=camp-9 \| model=openrouter\/model \| status=ok \| finish=stop \| tokens=15\/7$/,
    );
    assert.equal(record.body, reply);
    assert.equal(fs.readFileSync(logPath, 'utf8').includes('Secret prompt text'), false);
  });

  it('logs an empty reply and records none for a missing campaign and missing usage', async () => {
    const { logPath, replyLog } = createReplyLogFixture();
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-test-key',
      replyLog,
      fetchImpl: async () => new Response(
        JSON.stringify({ choices: [{ message: { content: '' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    const result = await client.complete({
      model: 'openrouter/model',
      messages: [{ role: 'user', content: 'Hi' }],
      stage: SpendStage.Scribe,
    });

    assert.equal(result.text, '');
    const record = readSingleRecord(logPath);
    assert.match(record.header, /\| campaign=none \| model=openrouter\/model \| status=ok \| finish=none \| tokens=none$/);
    assert.equal(record.body, '');
  });

  it('logs a retried 503 body first and then the successful reply', async () => {
    const { logPath, replyLog } = createReplyLogFixture();
    const { wait } = createRecordedWait();
    let attemptCount = 0;
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-test-key',
      replyLog,
      retryOptions: { wait },
      fetchImpl: async () => {
        attemptCount += 1;
        if (attemptCount === 1) {
          return new Response('<html>upstream down</html>', { status: 503 });
        }
        return createCompletionResponse('Second try reply');
      },
    });

    const result = await client.complete({
      model: 'openrouter/model',
      messages: [{ role: 'user', content: 'Hi' }],
      stage: SpendStage.Mind,
      campaignId: 'camp-9',
    });

    assert.equal(result.text, 'Second try reply');
    const content = fs.readFileSync(logPath, 'utf8');
    const recordHeaders = content.split('\n').filter((line) => line.startsWith('=== '));
    assert.equal(recordHeaders.length, 2);
    assert.match(recordHeaders[0], /status=http 503 \| finish=none \| tokens=none$/);
    assert.match(recordHeaders[1], /status=ok \| finish=stop \| tokens=15\/7$/);
    assert.ok(content.indexOf('<html>upstream down</html>') < content.indexOf('Second try reply'));
  });

  it('logs a 400 body and still rejects as before', async () => {
    const { logPath, replyLog } = createReplyLogFixture();
    const errorBody = JSON.stringify({ error: { message: 'Bad request details', code: 400 } });
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-test-key',
      replyLog,
      fetchImpl: async () => new Response(errorBody, { status: 400 }),
    });

    await assert.rejects(
      () => client.complete({
        model: 'openrouter/model',
        messages: [{ role: 'user', content: 'Hi' }],
        stage: SpendStage.Mind,
      }),
      (caughtError) => {
        assert.equal(caughtError.status, 400);
        assert.equal(caughtError.retryable, false);
        return true;
      },
    );

    const record = readSingleRecord(logPath);
    assert.match(record.header, /status=http 400 \| finish=none \| tokens=none$/);
    assert.equal(record.body, errorBody);
  });

  it('logs a 200 body that is not JSON before rejecting', async () => {
    const { logPath, replyLog } = createReplyLogFixture();
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-test-key',
      replyLog,
      fetchImpl: async () => new Response('plain words, no json', { status: 200 }),
    });

    await assert.rejects(
      () => client.complete({
        model: 'openrouter/model',
        messages: [{ role: 'user', content: 'Hi' }],
        stage: SpendStage.Mind,
      }),
      /Malformed JSON response/,
    );

    const record = readSingleRecord(logPath);
    assert.match(record.header, /status=http 200 /);
    assert.equal(record.body, 'plain words, no json');
  });

  it('redacts the api key from a logged error body', async () => {
    const { logPath, replyLog } = createReplyLogFixture();
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-secret-key',
      replyLog,
      fetchImpl: async () => new Response('echo sk-or-secret-key here', { status: 400 }),
    });

    await assert.rejects(() => client.complete({
      model: 'openrouter/model',
      messages: [{ role: 'user', content: 'Hi' }],
      stage: SpendStage.Mind,
    }));

    assert.equal(fs.readFileSync(logPath, 'utf8').includes('sk-or-secret-key'), false);
  });

  it('logs the full streamed text once at the end', async () => {
    const { logPath, replyLog } = createReplyLogFixture();
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":" Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world \\n"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-test-key',
      replyLog,
      fetchImpl: async () => new Response(createChunkedStream([ssePayload]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    });

    const result = await client.stream({
      model: 'openrouter/composer',
      messages: [{ role: 'user', content: 'Hi' }],
      stage: SpendStage.Composer,
      campaignId: 'camp-3',
    });

    assert.equal(result.text, ' Hello world \n');
    const record = readSingleRecord(logPath);
    assert.match(record.header, /stage=composer \| campaign=camp-3 \| model=openrouter\/composer \| status=ok \| finish=stop \| tokens=4\/2$/);
    assert.equal(record.body, ' Hello world \n');
  });

  it('logs the error and the partial text for a mid-stream error frame', async () => {
    const { logPath, replyLog } = createReplyLogFixture();
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"Half a sent"}}]}\n\n',
      'data: {"error":{"message":"Provider cut the stream","code":502}}\n\n',
    ].join('');
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-test-key',
      replyLog,
      fetchImpl: async () => new Response(createChunkedStream([ssePayload]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    });

    await assert.rejects(
      () => client.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Hi' }],
        stage: SpendStage.Composer,
      }),
      /Provider cut the stream/,
    );

    const record = readSingleRecord(logPath);
    assert.match(record.header, /status=stream-error \| finish=none \| tokens=none$/);
    assert.equal(record.body, 'error: Provider cut the stream\npartial text:\nHalf a sent');
  });

  it('logs what arrived for an aborted stream', async () => {
    const { logPath, replyLog } = createReplyLogFixture();
    const controller = new AbortController();
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"Before abort"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" never seen"}}]}\n\n',
    ].join('');
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-test-key',
      replyLog,
      fetchImpl: async () => new Response(createChunkedStream([ssePayload]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    });

    await assert.rejects(
      () => client.stream({
        model: 'openrouter/composer',
        messages: [{ role: 'user', content: 'Hi' }],
        stage: SpendStage.Composer,
        signal: controller.signal,
        onDelta: () => {
          controller.abort();
        },
      }),
      (caughtError) => caughtError.name === 'AbortError',
    );

    const record = readSingleRecord(logPath);
    assert.match(record.header, /status=aborted /);
    assert.ok(record.body.endsWith('partial text:\nBefore abort'));
  });

  it('logs the text received before a network drop', async () => {
    const { logPath, replyLog } = createReplyLogFixture();
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-test-key',
      replyLog,
      fetchImpl: async () => new Response(
        createChunkedStream(
          ['data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'],
          { failAfterIndex: 1 },
        ),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    });

    await assert.rejects(() => client.stream({
      model: 'openrouter/composer',
      messages: [{ role: 'user', content: 'Hi' }],
      stage: SpendStage.Composer,
    }));

    const record = readSingleRecord(logPath);
    assert.match(record.header, /status=network-error /);
    assert.ok(record.body.endsWith('partial text:\nPartial'));
  });

  it('logs a streaming HTTP failure body', async () => {
    const { logPath, replyLog } = createReplyLogFixture();
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-test-key',
      replyLog,
      fetchImpl: async () => new Response('{"error":{"message":"No credits"}}', { status: 402 }),
    });

    await assert.rejects(() => client.stream({
      model: 'openrouter/composer',
      messages: [{ role: 'user', content: 'Hi' }],
      stage: SpendStage.Composer,
    }));

    const record = readSingleRecord(logPath);
    assert.match(record.header, /status=http 402 /);
    assert.equal(record.body, '{"error":{"message":"No credits"}}');
  });

  it('writes nothing and behaves the same with replyLog null', async () => {
    const { logPath } = createReplyLogFixture();
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-or-test-key',
      replyLog: null,
      fetchImpl: async () => createCompletionResponse('Plain'),
    });

    const result = await client.complete({
      model: 'openrouter/model',
      messages: [{ role: 'user', content: 'Hi' }],
      stage: SpendStage.Mind,
    });

    assert.equal(result.text, 'Plain');
    assert.equal(fs.existsSync(logPath), false);
    assert.equal(fs.existsSync(path.dirname(logPath)), false);
  });

  it('rejects a replyLog without append()', () => {
    assert.throws(
      () => new OpenRouterClient({ apiKeyProvider: () => 'sk-or-test-key', replyLog: {} }),
      TypeError,
    );
  });
});
