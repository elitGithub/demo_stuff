import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { ReplyRetry } from '../extension/universe-retry/ReplyRetry.js';
import { ReplyRetrySettings } from '../extension/universe-retry/ReplyRetrySettings.js';

const { Endpoint } = ReplyRetrySettings;
const body = '{"messages": [{"role": "user", "content": "Hello"}],  "stream": false}';
const jsonType = 'application/json; charset=utf-8';
const reply = { choices: [{ message: { role: 'assistant', content: 'Hi there.' } }] };
const absolute = `http://127.0.0.1:8000${Endpoint}`;
const delays = [2000, 5000, 10000];
const sent = 'send';

/**
 * @param {number} status
 * @param {*} [payload]
 * @returns {Response}
 * @throws {RangeError}
 */
function answer(status, payload = reply) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': jsonType } });
}

/**
 * @param {AbortSignal} [signal]
 * @returns {RequestInit}
 */
function post(signal = new AbortController().signal) {
  return { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, signal };
}

/**
 * @param {number} attempt
 * @param {string} reason
 * @returns {string}
 */
function toast(attempt, reason) {
  return `Reply failed (${reason}). Retrying ${attempt} of 3...`;
}

/**
 * @param {number} milliseconds
 * @returns {string}
 */
function waited(milliseconds) {
  return `wait ${milliseconds}`;
}

/**
 * @param {string[]} reasons
 * @returns {string[]}
 */
function expectedEvents(reasons) {
  return [
    ...reasons.flatMap((reason, index) => [sent, toast(index + 1, reason), waited(delays[index])]),
    sent,
  ];
}

/**
 * @param {Array<*>} outcomes
 * @param {?function(AbortSignal): Promise<void>} [pause]
 * @returns {{calls: Array<{input: *, options: ?RequestInit, body: ?string}>, events: string[], fetch: Function}}
 */
function harness(outcomes, pause = null) {
  const calls = [];
  const events = [];
  const wrapped = ReplyRetry.wrap(
    /**
     * @param {*} input
     * @param {RequestInit} [options]
     * @returns {Promise<Response>}
     * @throws {*}
     */
    async (input, options) => {
      events.push(sent);
      calls.push({ input, options, body: options?.body });
      const outcome = outcomes.shift();
      if (!(outcome instanceof Response)) {
        throw outcome;
      }
      return outcome;
    },
    {
      /**
       * @param {number} milliseconds
       * @param {AbortSignal} [signal]
       * @returns {Promise<void>}
       * @throws {*}
       */
      async wait(milliseconds, signal) {
        events.push(waited(milliseconds));
        await pause?.(signal);
      },
      /**
       * @param {string} message
       * @returns {void}
       */
      notify(message) {
        events.push(message);
      },
    },
  );
  return { calls, events, fetch: wrapped };
}

/**
 * @param {Response} response
 * @returns {Promise<void>}
 * @throws {Error}
 */
async function assertReturnedAtOnce(response) {
  const record = harness([response, answer(200)]);
  assert.equal(await record.fetch(Endpoint, post()), response);
  assert.equal(response.bodyUsed, false);
  assert.equal(record.calls.length, 1);
  assert.deepEqual(record.events, [sent]);
}

test('a 502 then a 200 returns the 200 after one wait of 2000', async () => {
  const success = answer(200);
  const record = harness([answer(502), success]);
  assert.equal(await record.fetch(Endpoint, post()), success);
  assert.equal(record.calls.length, 2);
  assert.deepEqual(record.events, expectedEvents(['HTTP 502']));
});

test('four 502s return the fourth 502 unread after waits of 2000, 5000 and 10000 with toasts 1, 2 and 3 of 3', async () => {
  const last = answer(502);
  const record = harness([answer(502), answer(502), answer(502), last, answer(200)]);
  assert.equal(await record.fetch(Endpoint, post()), last);
  assert.equal(last.bodyUsed, false);
  assert.equal(record.calls.length, 4);
  assert.deepEqual(record.events, expectedEvents(['HTTP 502', 'HTTP 502', 'HTTP 502']));
});

test('every retry status is retried and named in the toast', async () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    const success = answer(200);
    const record = harness([answer(status), success]);
    assert.equal(await record.fetch(Endpoint, post()), success);
    assert.deepEqual(record.events, expectedEvents([`HTTP ${status}`]));
  }
});

test('a rejection TypeError Failed to fetch then a 200 returns the 200', async () => {
  const success = answer(200);
  const record = harness([new TypeError('Failed to fetch'), success]);
  assert.equal(await record.fetch(Endpoint, post()), success);
  assert.equal(record.calls.length, 2);
  assert.deepEqual(record.events, expectedEvents(['Failed to fetch']));
});

test('four rejections rethrow the fourth rejection unchanged after three waits', async () => {
  const last = new TypeError('Failed to fetch');
  const record = harness([new TypeError('Failed to fetch'), new TypeError('Failed to fetch'), 'offline', last, answer(200)]);
  await assert.rejects(record.fetch(Endpoint, post()), error => error === last);
  assert.equal(record.calls.length, 4);
  assert.deepEqual(record.events, expectedEvents(['Failed to fetch', 'Failed to fetch', 'offline']));
});

test('400, 401, 402, 403 and 404 return at once with no wait', async () => {
  for (const status of [400, 401, 402, 403, 404]) {
    await assertReturnedAtOnce(answer(status, { error: { message: 'Bad Gateway' } }));
  }
});

test('a 200 JSON answer with error Service Unavailable then a reply returns the reply', async () => {
  const success = answer(200);
  const record = harness([answer(200, { error: { message: 'Service Unavailable' }, quota_error: false }), success]);
  assert.equal(await record.fetch(Endpoint, post()), success);
  assert.equal(record.calls.length, 2);
  assert.deepEqual(record.events, expectedEvents(['Service Unavailable']));
});

test('every retry reason in a 200 JSON answer is retried', async () => {
  const reasons = ['Too Many Requests', 'Request Timeout', 'Internal Server Error', 'Bad Gateway', 'Service Unavailable', 'Gateway Timeout'];
  for (const message of reasons) {
    const success = answer(200);
    const record = harness([answer(200, { error: { message } }), success]);
    assert.equal(await record.fetch(Endpoint, post()), success);
    assert.deepEqual(record.events, expectedEvents([message]));
  }
});

test('a 200 JSON answer with Payment Required, a quota error or a non-object error returns at once unread', async () => {
  const payloads = [
    { error: { message: 'Payment Required' }, quota_error: false },
    { error: { message: 'Too Many Requests' }, quota_error: true },
    { error: 'Bad Gateway' },
  ];
  for (const payload of payloads) {
    const failure = answer(200, payload);
    await assertReturnedAtOnce(failure);
    assert.deepEqual(await failure.json(), payload);
  }
});

test('a successful or malformed 200 JSON answer is returned unread at once', async () => {
  const success = answer(200);
  const malformed = new Response('{"error": {"message": "Bad Gateway"', { status: 200, headers: { 'content-type': jsonType } });
  await assertReturnedAtOnce(success);
  await assertReturnedAtOnce(malformed);
  assert.deepEqual(await success.json(), reply);
});

test('a 200 JSON answer whose body fails to read rejects with that failure and is not retried', async () => {
  const failure = new TypeError('terminated');
  const stream = new ReadableStream({
    /**
     * @param {ReadableStreamDefaultController} controller
     * @returns {void}
     */
    pull(controller) {
      controller.error(failure);
    },
  }, { highWaterMark: 0 });
  const record = harness([new Response(stream, { status: 200, headers: { 'content-type': jsonType } }), answer(200)]);
  await assert.rejects(record.fetch(Endpoint, post()), error => error === failure);
  assert.equal(record.calls.length, 1);
  assert.deepEqual(record.events, [sent]);
});

test('four option-B answers return the fourth answer unread', async () => {
  const payload = { error: { message: 'Bad Gateway' }, quota_error: false };
  const last = answer(200, payload);
  const record = harness([answer(200, payload), answer(200, payload), answer(200, payload), last, answer(200)]);
  assert.equal(await record.fetch(Endpoint, post()), last);
  assert.equal(last.bodyUsed, false);
  assert.deepEqual(await last.json(), payload);
  assert.deepEqual(record.events, expectedEvents(['Bad Gateway', 'Bad Gateway', 'Bad Gateway']));
});

test('a streamed 200 answer is returned with its body unread', async () => {
  const events = 'data: {"error":{"message":"Bad Gateway"}}\n\n';
  for (const headers of [{ 'content-type': 'text/event-stream' }, {}]) {
    const source = { pulls: 0 };
    const stream = new ReadableStream({
      /**
       * @param {ReadableStreamDefaultController} controller
       * @returns {void}
       */
      pull(controller) {
        source.pulls += 1;
        controller.enqueue(new TextEncoder().encode(events));
        controller.close();
      },
    }, { highWaterMark: 0 });
    const streamed = new Response(stream, { status: 200, headers });
    await assertReturnedAtOnce(streamed);
    assert.equal(source.pulls, 0);
    assert.equal(await streamed.text(), events);
  }
});

test('an abort during a wait rejects with the abort reason and sends no further request', async () => {
  const controller = new AbortController();
  const reason = new Error('Clicked stop button');
  const waiting = Promise.withResolvers();
  const record = harness([answer(502), answer(200)],
    /**
     * @param {AbortSignal} signal
     * @returns {Promise<void>}
     * @throws {*}
     */
    signal => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      waiting.resolve(signal);
    }));
  const pending = record.fetch(Endpoint, post(controller.signal));
  assert.equal(await waiting.promise, controller.signal);
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(record.calls.length, 1);
  assert.deepEqual(record.events, [sent, toast(1, 'HTTP 502'), waited(2000)]);
});

test('a rejection while the signal is already aborted is not retried', async () => {
  const controller = new AbortController();
  controller.abort();
  const record = harness([controller.signal.reason, answer(200)]);
  await assert.rejects(record.fetch(Endpoint, post(controller.signal)), error => error === controller.signal.reason);
  assert.equal(record.calls.length, 1);
  assert.deepEqual(record.events, [sent]);
});

test('a GET to the endpoint and a POST to any other path pass through with one call each', async () => {
  const requests = [
    { input: Endpoint, options: { method: 'GET' } },
    { input: Endpoint, options: undefined },
    { input: '/api/backends/text-completions/generate', options: post() },
    { input: '/api/backends/chat-completions/status', options: post() },
    { input: new Request(absolute, { method: 'POST', body }), options: undefined },
  ];
  for (const { input, options } of requests) {
    const failure = answer(502);
    const record = harness([failure, answer(200)]);
    assert.equal(await record.fetch(input, options), failure);
    assert.equal(record.calls.length, 1);
    assert.equal(record.calls[0].input, input);
    assert.equal(record.calls[0].options, options);
    assert.deepEqual(record.events, [sent]);
  }
});

test('an absolute address, a URL object, a query string and a lower-case method on the endpoint are retried', async () => {
  for (const input of [absolute, new URL(absolute), `${Endpoint}?source=openrouter`]) {
    const success = answer(200);
    const record = harness([answer(503), success]);
    assert.equal(await record.fetch(input, { ...post(), method: 'post' }), success);
    assert.equal(record.calls.length, 2);
    assert.deepEqual(record.events, expectedEvents(['HTTP 503']));
  }
});

test('every attempt receives the identical input, options and body string', async () => {
  const options = post();
  const record = harness([
    answer(502), new TypeError('Failed to fetch'), answer(200, { error: { message: 'Bad Gateway' } }), answer(504),
  ]);
  await record.fetch(Endpoint, options);
  assert.equal(record.calls.length, 4);
  assert.deepEqual(record.events, expectedEvents(['HTTP 502', 'Failed to fetch', 'Bad Gateway']));
  for (const call of record.calls) {
    assert.equal(call.body, body);
    assert.equal(call.input, Endpoint);
    assert.equal(call.options, options);
  }
});

test('the page script wraps window.fetch with toastr warnings and a timer that waits and honours an abort', async context => {
  const page = {
    outcomes: [],
    calls: 0,
    toasts: [],
    /**
     * @returns {void}
     */
    onToast() {},
  };
  globalThis.window = {
    /**
     * @returns {Promise<Response>}
     */
    async fetch() {
      page.calls += 1;
      return page.outcomes.shift();
    },
  };
  globalThis.toastr = {
    /**
     * @param {string} message
     * @returns {void}
     * @throws {*}
     */
    warning(message) {
      page.toasts.push(message);
      page.onToast();
    },
  };
  context.after(() => {
    delete globalThis.window;
    delete globalThis.toastr;
  });
  context.mock.timers.enable({ apis: ['setTimeout'] });
  await import('../extension/universe-retry/index.js');

  const success = answer(200);
  page.outcomes.push(answer(502), success);
  const pending = globalThis.window.fetch(Endpoint, post());
  await setImmediate();
  assert.deepEqual(page.toasts, [toast(1, 'HTTP 502')]);
  context.mock.timers.tick(1999);
  await setImmediate();
  assert.equal(page.calls, 1);
  context.mock.timers.tick(1);
  await setImmediate();
  assert.equal(page.calls, 2);
  assert.equal(await pending, success);

  const reason = new Error('Clicked stop button');
  const stopping = new AbortController();
  page.outcomes.push(answer(502), answer(200));
  const aborted = globalThis.window.fetch(Endpoint, post(stopping.signal));
  await setImmediate();
  assert.equal(page.toasts.length, 2);
  stopping.abort(reason);
  context.mock.timers.tick(10000);
  await assert.rejects(aborted, error => error === reason);
  assert.equal(page.calls, 3);

  const early = new AbortController();
  const abortedOnToast = once(early.signal, 'abort');
  page.outcomes.length = 0;
  page.outcomes.push(answer(502), answer(200));
  page.onToast = early.abort.bind(early, reason);
  const refused = globalThis.window.fetch(Endpoint, post(early.signal));
  await abortedOnToast;
  context.mock.timers.tick(10000);
  await assert.rejects(refused, error => error === reason);
  assert.equal(page.toasts.length, 3);
  assert.equal(page.calls, 4);
});
