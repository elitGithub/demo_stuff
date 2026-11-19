import assert from 'node:assert/strict';
import test from 'node:test';
import ScribeCore from './support/ScribeCore.mjs';

const { ScribeGateway } = ScribeCore.load(['ScribeGateway']);

const KEY = 'sk-or-secret-1234';
const CONTENT = '=== FACTS\nMirelle | age | ninety | #50';

/**
 * @param {object} value
 * @return {object}
 */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * @return {Promise<void>}
 */
function never() {
    return new Promise(() => {});
}

/**
 * @return {Promise<void>}
 */
function settle() {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * @param {number} status
 * @param {string} text
 * @return {{ status: number, ok: boolean, text: () => Promise<string> }}
 */
function reply(status, text) {
    return { status, ok: status >= 200 && status < 300, text: async () => text };
}

/**
 * @param {object} body
 * @param {number} status
 * @return {{ status: number, ok: boolean, text: () => Promise<string> }}
 */
function json(body, status = 200) {
    return reply(status, JSON.stringify(body));
}

/**
 * @param {string|null|undefined} finish
 * @param {*} content
 * @param {object|undefined} usage
 * @return {object}
 */
function answer(finish, content, usage) {
    const choice = { message: { content } };
    if (finish !== undefined) {
        choice.finish_reason = finish;
    }
    const body = { choices: [choice] };
    if (usage !== undefined) {
        body.usage = usage;
    }
    return body;
}

/**
 * @param {Array<*>} queue
 * @return {{ fetch: Function, calls: Array<{ url: string, options: object }> }}
 */
function scripted(queue) {
    const calls = [];
    const pending = [...queue];
    const fetch = async (url, options) => {
        calls.push({ url, options });
        const next = pending.shift();
        if (next instanceof Error) {
            throw next;
        }
        return next;
    };
    return { fetch, calls };
}

/**
 * @param {Function} fetch
 * @param {object} extra
 * @return {Promise<object>}
 */
function send(fetch, extra = {}) {
    return ScribeGateway.call({
        fetch,
        sleep: never,
        key: KEY,
        model: 'm/x',
        system: 'sys',
        user: 'usr',
        maxTokens: 500,
        ...extra,
    });
}

/**
 * @param {*} script
 * @param {object} extra
 * @return {Promise<object>}
 */
function run(script, extra = {}) {
    return send(scripted([script]).fetch, extra);
}

/**
 * @param {Promise<object>} promise
 * @return {Promise<Error>}
 */
async function failureOf(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new assert.AssertionError({ message: 'expected the call to throw' });
}

/**
 * @param {Error} error
 * @param {boolean} retryable
 * @param {number|null} status
 * @param {string|null} finish
 * @return {void}
 */
function expectFailure(error, retryable, status, finish) {
    assert.equal(error.retryable, retryable);
    assert.equal(error.status, status);
    assert.equal(error.finish, finish);
}

test('a complete answer is returned', async () => {
    const usage = { prompt_tokens: 1200, completion_tokens: 80, cost: 0.0123 };
    const result = await run(json(answer('stop', CONTENT, usage)));
    assert.deepEqual(plain(result), {
        text: CONTENT,
        tokensIn: 1200,
        tokensOut: 80,
        reasoningTokens: null,
        finish: 'stop',
        cost: 0.0123,
    });
    const bare = await run(json(answer('stop', CONTENT)));
    assert.deepEqual(plain(bare), {
        text: CONTENT,
        tokensIn: 0,
        tokensOut: 0,
        reasoningTokens: null,
        finish: 'stop',
        cost: null,
    });
    const padded = await run(json(answer('stop', `  \n${CONTENT}\n  `)));
    assert.equal(padded.text, `  \n${CONTENT}\n  `);
});

test('the request is built as specified', async () => {
    const { fetch, calls } = scripted([json(answer('stop', CONTENT)), json(answer('stop', CONTENT))]);
    await send(fetch);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, ScribeGateway.Endpoint);
    assert.equal(ScribeGateway.Endpoint, 'https://openrouter.ai/api/v1/chat/completions');
    assert.deepEqual(Object.keys(calls[0].options), ['method', 'headers', 'body']);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        model: 'm/x',
        temperature: 0.2,
        max_tokens: 500,
        reasoning: { effort: 'low' },
        usage: { include: true },
        messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'usr' },
        ],
    });
    const signal = { aborted: false };
    await send(fetch, { signal, maxTokens: 77 });
    assert.deepEqual(Object.keys(calls[1].options), ['method', 'headers', 'body', 'signal']);
    assert.equal(calls[1].options.signal, signal);
    assert.equal(JSON.parse(calls[1].options.body).max_tokens, 77);
});

test('bad arguments make no request', async () => {
    const cases = [
        ['fetch', { fetch: 'nope' }],
        ['fetch', { fetch: undefined }],
        ['sleep', { sleep: 'nope' }],
        ['sleep', { sleep: undefined }],
        ['key', { key: '' }],
        ['key', { key: 12345 }],
        ['key', { key: undefined }],
        ['key', { key: `${KEY}\n` }],
        ['key', { key: `${KEY} ` }],
        ['key', { key: 'sk-or-with space' }],
        ['key', { key: 'sk-or-with\ttab' }],
        ['key', { key: 'sk-or-with\u0000nul' }],
        ['key', { key: 'sk-or-with\u007fdel' }],
        ['model', { model: '' }],
        ['model', { model: 7 }],
        ['system', { system: '' }],
        ['system', { system: null }],
        ['user', { user: '' }],
        ['user', { user: {} }],
        ['maxTokens', { maxTokens: 0 }],
        ['maxTokens', { maxTokens: -5 }],
        ['maxTokens', { maxTokens: 1.5 }],
        ['maxTokens', { maxTokens: '500' }],
        ['maxTokens', { maxTokens: Number.NaN }],
        ['maxTokens', { maxTokens: Number.MAX_SAFE_INTEGER + 1 }],
        ['maxTokens', { maxTokens: undefined }],
    ];
    for (const [name, extra] of cases) {
        const { fetch, calls } = scripted([json(answer('stop', CONTENT))]);
        const error = await failureOf(send(fetch, extra));
        assert.equal(calls.length, 0, name);
        expectFailure(error, false, null, null);
        assert.ok(error.message.includes(name));
        assert.ok(!error.message.includes(KEY));
        if (typeof extra.key === 'string' && extra.key !== '') {
            assert.ok(!error.message.includes(extra.key));
        }
    }
});

test('fetch is called without a receiver', async () => {
    const seen = [];
    const fetch = function (url, options) {
        seen.push(this);
        return Promise.resolve(json(answer('stop', CONTENT)));
    };
    const request = { fetch, sleep: never, key: KEY, model: 'm/x', system: 'sys', user: 'usr', maxTokens: 500 };
    await ScribeGateway.call(request);
    assert.equal(seen.length, 1);
    assert.notEqual(seen[0], request);
    assert.ok(seen[0] === undefined || seen[0] === globalThis || Object.keys(seen[0]).length === 0);
});

test('a call that never answers times out', async () => {
    const asked = [];
    let release = null;
    const sleep = (milliseconds) => {
        asked.push(milliseconds);
        return new Promise((resolve) => {
            release = resolve;
        });
    };
    const hung = send(() => never(), { sleep, timeoutMs: 5000 });
    release();
    const error = await failureOf(hung);
    expectFailure(error, true, null, null);
    assert.ok(error.message.startsWith('no answer within 5 seconds'));
    assert.deepEqual(asked, [5000]);
    const slow = send(async () => ({ status: 200, ok: true, text: () => never() }), { sleep, timeoutMs: 2500 });
    release();
    const slowError = await failureOf(slow);
    expectFailure(slowError, true, null, null);
    assert.ok(slowError.message.startsWith('no answer within 2.5 seconds'));
    for (const missing of [undefined, 0, -1, Number.NaN, 'soon', Number.POSITIVE_INFINITY]) {
        asked.length = 0;
        const defaulted = send(() => never(), { sleep, timeoutMs: missing });
        release();
        await failureOf(defaulted);
        assert.deepEqual(asked, [180000]);
    }
    const unhandled = [];
    const listener = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    let fail = null;
    const late = send(() => new Promise((resolve, reject) => { fail = reject; }), { sleep, timeoutMs: 10 });
    release();
    await failureOf(late);
    fail(new Error('late failure'));
    await settle();
    await settle();
    process.off('unhandledRejection', listener);
    assert.deepEqual(unhandled, []);
    const winner = await run(json(answer('stop', CONTENT)), { sleep, timeoutMs: 10 });
    assert.equal(winner.text, CONTENT);
});

test('no response is retried', async () => {
    const callable = Object.assign(() => {}, { status: 200, text: async () => '{}' });
    const listed = Object.assign([], { status: 200, text: async () => '{}' });
    for (const script of [callable, listed, undefined, null, 'text', 42, { status: 0 }, { status: 99, text: async () => '' }, { status: '200', text: async () => '' }, { text: async () => '' }]) {
        expectFailure(await failureOf(run(script)), true, null, null);
    }
    const noText = await failureOf(run({ status: 200, ok: true }));
    expectFailure(noText, false, 200, null);
    const badText = await failureOf(run({ status: 200, ok: true, text: 'nope' }));
    expectFailure(badText, false, 200, null);
});

test('a timeout status is retried', async () => {
    expectFailure(await failureOf(run(reply(408, '{}'))), true, 408, null);
    const provider = await failureOf(run(json({ error: { code: 408 } })));
    expectFailure(provider, true, 200, null);
});

test('the key never leaves the header', async () => {
    const quoted = `bad key ${KEY} and again ${KEY}`;
    const scripts = [
        new Error(`connect failed for ${KEY}`),
        { status: 200, ok: true, text: async () => { throw new Error(`read ${KEY}`); } },
        reply(429, `body ${KEY}`),
        reply(401, `body ${KEY}`),
        reply(200, `<html>${KEY}`),
        json({ error: { code: 502, message: quoted } }),
        json({ error: { code: 400, message: quoted } }),
        json({ error: quoted }),
        json({ choices: [{ finish_reason: 'stop', error: { code: 502, message: quoted }, message: { content: CONTENT } }] }),
        json(answer('length', CONTENT)),
        json(answer('error', CONTENT)),
        json(answer('content_filter', CONTENT)),
        json(answer(`odd ${KEY} finish`, CONTENT)),
        json(answer('stop', '')),
        json({ error: { code: 400, message: `${'x'.repeat(290)}${KEY}` } }),
        json({}),
    ];
    for (const script of scripts) {
        const { fetch, calls } = scripted([script]);
        const error = await failureOf(send(fetch));
        assert.ok(!calls[0].url.includes(KEY));
        assert.ok(!calls[0].options.body.includes(KEY));
        for (const name of Object.getOwnPropertyNames(error)) {
            assert.ok(!String(error[name]).includes(KEY), name);
        }
    }
    const shown = await failureOf(run(json({ error: { code: 400, message: quoted } })));
    assert.ok(shown.message.includes('bad key [key] and again [key]'));
});

test('a half answer is refused', async () => {
    const error = await failureOf(run(json(answer('error', CONTENT))));
    expectFailure(error, true, 200, 'error');
});

test('a cut-off answer is refused and not retried', async () => {
    const error = await failureOf(run(json(answer('length', CONTENT))));
    expectFailure(error, false, 200, 'length');
});

test('an empty answer is refused', async () => {
    for (const content of ['', '   \n ', null]) {
        const error = await failureOf(run(json(answer('stop', content))));
        expectFailure(error, true, 200, 'stop');
    }
    const none = await failureOf(run(json({})));
    expectFailure(none, false, 200, null);
});

test('content must be a string', async () => {
    for (const content of [[{ type: 'text', text: CONTENT }], 12, { text: CONTENT }, true]) {
        const error = await failureOf(run(json(answer('stop', content))));
        expectFailure(error, true, 200, 'stop');
    }
});

test('other finish reasons are refused', async () => {
    const filtered = await failureOf(run(json(answer('content_filter', CONTENT))));
    expectFailure(filtered, false, 200, 'content_filter');
    const missing = await failureOf(run(json(answer(undefined, CONTENT))));
    expectFailure(missing, false, 200, null);
    const empty = await failureOf(run(json(answer(null, CONTENT))));
    expectFailure(empty, false, 200, null);
    const tools = await failureOf(run(json(answer('tool_calls', CONTENT))));
    expectFailure(tools, false, 200, 'tool_calls');
});

test('odd finish reasons do not throw past the contract', async () => {
    for (const odd of [7, { reason: 'stop' }, ['stop'], true]) {
        const error = await failureOf(run(json(answer(odd, CONTENT))));
        expectFailure(error, false, 200, null);
        assert.ok(error.message.includes('answer did not finish with stop'));
    }
});

test('rate limits and server errors retry', async () => {
    for (const status of [429, 500, 503]) {
        expectFailure(await failureOf(run(reply(status, '{}'))), true, status, null);
    }
    for (const status of [400, 401, 402, 404]) {
        expectFailure(await failureOf(run(reply(status, '{}'))), false, status, null);
    }
});

test('a provider error in a good response', async () => {
    const upstream = await failureOf(run(json({ error: { code: 502, message: 'upstream failed' } })));
    expectFailure(upstream, true, 200, null);
    assert.ok(upstream.message.includes('upstream failed'));
    const limited = await failureOf(run(json({ error: { code: 429, message: 'slow down' } })));
    assert.equal(limited.retryable, true);
    const invalid = await failureOf(run(json({ error: { code: 400, message: 'bad input' } })));
    assert.equal(invalid.retryable, false);
    const found = await failureOf(run(json({ error: { code: 400, message: 'bad' }, choices: [{ finish_reason: 'error' }] })));
    assert.equal(found.finish, 'error');
    const long = await failureOf(run(json({ error: { code: 502, message: `${'a'.repeat(300)}${'b'.repeat(700)}` } })));
    assert.ok(long.message.includes('a'.repeat(300)));
    assert.ok(!long.message.includes('b'));
});

test('an error on the choice is refused', async () => {
    const choice = (code, extra = {}) => json({
        choices: [{ finish_reason: 'stop', message: { content: CONTENT }, error: { code, message: 'Provider returned error' }, ...extra }],
    });
    const transient = await failureOf(run(choice(502)));
    expectFailure(transient, true, 200, 'stop');
    assert.ok(transient.message.includes('Provider returned error'));
    expectFailure(await failureOf(run(choice(400))), false, 200, 'stop');
});

test('an empty error member is ignored', async () => {
    for (const ignored of [null, {}, '', 0, false, [], 7]) {
        const result = await run(json({ ...answer('stop', CONTENT), error: ignored }));
        assert.equal(result.text, CONTENT);
    }
    const onChoice = await run(json({ choices: [{ finish_reason: 'stop', message: { content: CONTENT }, error: null }] }));
    assert.equal(onChoice.text, CONTENT);
    const text = await failureOf(run(json({ ...answer('stop', CONTENT), error: 'boom' })));
    assert.equal(text.retryable, false);
    assert.ok(text.message.includes('boom'));
    const digits = await failureOf(run(json({ ...answer('stop', CONTENT), error: { code: '502' } })));
    assert.equal(digits.retryable, true);
    for (const code of ['rate', '0x1F4', '1e3', ' 502', '-502', '502.5']) {
        const word = await failureOf(run(json({ ...answer('stop', CONTENT), error: { code } })));
        assert.equal(word.retryable, false, code);
    }
    const message = await failureOf(run(json({ ...answer('stop', CONTENT), error: { message: 'only words' } })));
    assert.equal(message.retryable, false);
});

test('the provider error is checked before the finish reason', async () => {
    const first = await failureOf(run(json({ error: { code: 400 }, choices: [{ finish_reason: 'error' }] })));
    assert.equal(first.retryable, false);
    const second = await failureOf(run(json({ error: { code: 502 }, choices: [{ finish_reason: 'length' }] })));
    assert.equal(second.retryable, true);
    const third = await failureOf(
        run(json({ choices: [{ finish_reason: 'length', message: { content: CONTENT }, error: { code: 502 } }] })),
    );
    assert.equal(third.retryable, true);
});

test('the key is masked everywhere in an error', async () => {
    const inFinish = await failureOf(run(json(answer(`odd-${KEY}-finish`, CONTENT))));
    assert.ok(!inFinish.message.includes(KEY));
    assert.ok(!inFinish.finish.includes(KEY));
    assert.ok(inFinish.finish.includes('[key]'));
    const joined = await failureOf(run(json(answer('content_filter', CONTENT)), { key: 'stop;' }));
    assert.ok(!joined.message.includes('stop;'));
    const huge = await failureOf(run(json(answer('f'.repeat(5000), CONTENT))));
    assert.equal(huge.finish.length, 40);
    assert.ok(huge.message.length < 200);
    const edge = await failureOf(run(json(answer(`${'a'.repeat(38)}${KEY}`, CONTENT))));
    assert.ok(!edge.finish.includes('sk'));
    assert.ok(!edge.message.includes('sk'));
    const tricky = 'sk+a.b$&c';
    const awkward = await failureOf(
        run(json({ error: { code: 400, message: `quoted ${tricky} twice ${tricky} thrice ${tricky} four ${tricky}` } }), { key: tricky }),
    );
    assert.ok(awkward.message.includes('quoted [key] twice [key] thrice [key] four [key]'));
    const near = await failureOf(run(json({ error: { code: 400, message: `${'x'.repeat(290)}${KEY}` } })));
    assert.ok(!near.message.includes(KEY.slice(0, 6)));
    const lines = await failureOf(run(json({ error: { code: 400, message: 'one\ntwo\r\nthree\tfour' } })));
    assert.ok(!/[\r\n]/.test(lines.message));
    assert.ok(lines.message.includes('one two three four'));
});

test('a network failure retries', async () => {
    const down = await failureOf(run(new Error('socket hang up')));
    expectFailure(down, true, null, null);
    const unreadable = await failureOf(
        run({ status: 200, ok: true, text: async () => { throw new Error('aborted'); } }),
    );
    expectFailure(unreadable, true, 200, null);
});

test('an unreadable body retries', async () => {
    for (const text of ['<html>', '42', 'null', '[]']) {
        expectFailure(await failureOf(run(reply(200, text))), true, 200, null);
    }
});

test('a byte-order mark is tolerated', async () => {
    const result = await run(reply(200, `﻿${JSON.stringify(answer('stop', CONTENT))}`));
    assert.equal(result.text, CONTENT);
});

/**
 * @param {number} tokensIn
 * @param {number} tokensOut
 * @param {number|null} cost
 * @return {object}
 */
function complete(tokensIn, tokensOut, cost) {
    return { text: CONTENT, tokensIn, tokensOut, reasoningTokens: null, finish: 'stop', cost };
}

test('usage is read strictly', async () => {
    const counts = await run(json(answer('stop', CONTENT, { prompt_tokens: '12', completion_tokens: '7', cost: '0.5' })));
    assert.deepEqual(plain(counts), complete(0, 0, null));
    const negative = await run(json(answer('stop', CONTENT, { prompt_tokens: -1, completion_tokens: -2, cost: -0.1 })));
    assert.deepEqual(plain(negative), complete(0, 0, null));
    const fractional = await run(json(answer('stop', CONTENT, { prompt_tokens: 1.5, completion_tokens: 2.5, cost: 0 })));
    assert.deepEqual(plain(fractional), complete(0, 0, 0));
    const huge = await run(reply(200, `{"choices":[{"finish_reason":"stop","message":{"content":"ok"}}],"usage":{"cost":1e999,"prompt_tokens":1e999}}`));
    assert.equal(huge.text, 'ok');
    assert.equal(huge.tokensIn, 0);
    assert.equal(huge.tokensOut, 0);
    assert.equal(huge.cost, null);
    const infiniteCost = await run(reply(200, '{"choices":[{"finish_reason":"stop","message":{"content":"ok"}}],"usage":{"cost":1e999}}'));
    assert.equal(infiniteCost.cost, null);
    const nan = await run(json(answer('stop', CONTENT, { cost: null })));
    assert.equal(nan.cost, null);
    const lone = await run(json(answer('stop', CONTENT, { prompt_tokens: 5 })));
    assert.deepEqual(plain(lone), complete(5, 0, null));
    const edge = await run(json(answer('stop', CONTENT), 299));
    assert.equal(edge.text, CONTENT);
    const keyed = await failureOf(run(json({ choices: { 0: { finish_reason: 'stop', message: { content: CONTENT } } } })));
    expectFailure(keyed, false, 200, null);
    const array = await failureOf(run(json([answer('stop', CONTENT)])));
    assert.equal(array.retryable, true);
});

/**
 * @param {Array<Error|object>} outcomes
 * @return {{ attempt: () => Promise<object>, sleep: (milliseconds: number) => Promise<void>, attempts: number[], pauses: number[] }}
 */
function sequence(outcomes) {
    const attempts = [];
    const pauses = [];
    const pending = [...outcomes];
    const attempt = async () => {
        attempts.push(attempts.length + 1);
        const next = pending.shift();
        if (next instanceof Error) {
            throw next;
        }
        return next;
    };
    const sleep = async (milliseconds) => {
        pauses.push(milliseconds);
    };
    return { attempt, sleep, attempts, pauses };
}

/**
 * @param {string} name
 * @param {boolean|string|undefined} retryable
 * @return {Error}
 */
function failing(name, retryable) {
    const error = new Error(name);
    if (retryable !== undefined) {
        error.retryable = retryable;
    }
    return error;
}

test('retry stops after the limit', async () => {
    const third = failing('third', true);
    const run3 = sequence([failing('first', true), failing('second', true), third]);
    await assert.rejects(
        ScribeGateway.retry(run3.attempt, { attempts: 3, pauseMs: 10000, sleep: run3.sleep }),
        (error) => error === third,
    );
    assert.equal(run3.attempts.length, 3);
    assert.deepEqual(run3.pauses, [10000, 20000]);
    const floor = sequence([failing('only', true), { ok: 1 }]);
    await assert.rejects(ScribeGateway.retry(floor.attempt, { attempts: 0, pauseMs: 5, sleep: floor.sleep }));
    assert.equal(floor.attempts.length, 1);
    assert.deepEqual(floor.pauses, []);
});

test('retry returns the first success', async () => {
    const success = { ok: true };
    const sequenced = sequence([failing('once', true), success, failing('never', true)]);
    const result = await ScribeGateway.retry(sequenced.attempt, { attempts: 5, pauseMs: 7, sleep: sequenced.sleep });
    assert.equal(result, success);
    assert.equal(sequenced.attempts.length, 2);
    assert.deepEqual(sequenced.pauses, [7]);
});

test('retry does not repeat a fatal error', async () => {
    for (const error of [failing('fatal', false), failing('plain', undefined), failing('truthy', 'yes')]) {
        const sequenced = sequence([error, { ok: true }]);
        await assert.rejects(
            ScribeGateway.retry(sequenced.attempt, { attempts: 4, pauseMs: 7, sleep: sequenced.sleep }),
            (caught) => caught === error,
        );
        assert.equal(sequenced.attempts.length, 1);
        assert.deepEqual(sequenced.pauses, []);
    }
});

test('retry cannot loop forever', async () => {
    const cases = [
        [{}, 1],
        [{ attempts: undefined }, 1],
        [{ attempts: Number.NaN }, 1],
        [{ attempts: 'three' }, 1],
        [{ attempts: Number.POSITIVE_INFINITY }, 1],
        [{ attemps: 3 }, 1],
        [{ attempts: 2.5 }, 2],
        [{ attempts: '3' }, 3],
        [{ attempts: 0.5 }, 1],
        [{ attempts: -4 }, 1],
    ];
    for (const [options, expected] of cases) {
        const pauses = [];
        let count = 0;
        const attempt = async () => {
            count++;
            throw failing('again', count < 50);
        };
        await failureOf(ScribeGateway.retry(attempt, { pauseMs: 1, sleep: async (ms) => { pauses.push(ms); }, ...options }));
        assert.equal(count, expected, JSON.stringify(options));
        assert.equal(pauses.length, expected - 1);
    }
});

test('retry pauses and waits', async () => {
    const defaulted = sequence([failing('a', true), failing('b', true), { ok: true }]);
    await ScribeGateway.retry(defaulted.attempt, { attempts: 3, sleep: defaulted.sleep });
    assert.deepEqual(defaulted.pauses, [10000, 20000]);
    for (const pauseMs of [Number.NaN, -1, 'soon', Number.POSITIVE_INFINITY]) {
        const odd = sequence([failing('a', true), { ok: true }]);
        await ScribeGateway.retry(odd.attempt, { attempts: 2, pauseMs, sleep: odd.sleep });
        assert.deepEqual(odd.pauses, [10000]);
    }
    const zero = sequence([failing('a', true), { ok: true }]);
    await ScribeGateway.retry(zero.attempt, { attempts: 2, pauseMs: 0, sleep: zero.sleep });
    assert.deepEqual(zero.pauses, [0]);

    const waits = sequence([failing('a', true), { ok: true }]);
    let release = null;
    const sleep = (milliseconds) => {
        waits.pauses.push(milliseconds);
        return new Promise((resolve) => {
            release = resolve;
        });
    };
    const running = ScribeGateway.retry(waits.attempt, { attempts: 2, pauseMs: 3, sleep });
    await settle();
    assert.equal(waits.attempts.length, 1);
    release();
    await running;
    assert.equal(waits.attempts.length, 2);

    const untouched = sequence([{ ok: true }]);
    for (const options of [{ attempts: 3 }, undefined, null]) {
        const error = await failureOf(ScribeGateway.retry(untouched.attempt, options));
        assert.equal(error.retryable, false);
    }
    assert.equal(untouched.attempts.length, 0);
});

test('retry with call end to end', async () => {
    const { fetch } = scripted([
        reply(503, '{}'),
        json(answer('error', CONTENT)),
        json(answer('stop', CONTENT, { prompt_tokens: 3, completion_tokens: 4 })),
    ]);
    const pauses = [];
    const sleep = async (milliseconds) => {
        pauses.push(milliseconds);
    };
    const result = await ScribeGateway.retry(() => send(fetch, { sleep: never }), { attempts: 4, pauseMs: 100, sleep });
    assert.deepEqual(plain(result), complete(3, 4, null));
    assert.deepEqual(pauses, [100, 200]);
});

test('a refused request keeps the provider text, masked', async () => {
    const body = { error: { code: 402, message: `Insufficient credits for ${KEY}; add more at the settings page` } };
    const refused = await failureOf(run(json(body, 402)));
    expectFailure(refused, false, 402, null);
    assert.match(refused.message, /unexpected HTTP status; status 402; finish none; reason: Insufficient credits/);
    assert.equal(refused.message.includes(KEY), false);
    assert.equal(refused.reason, 'Insufficient credits for [key]; add more at the settings page');
    const plainText = await failureOf(run(reply(500, `${'x'.repeat(290)} ${KEY} tail`)));
    expectFailure(plainText, true, 500, null);
    assert.equal(plainText.reason.length, 300);
    assert.equal(plainText.reason.includes('sk-or'), false);
    assert.equal(plainText.reason.endsWith('[key]'), false);
    const halfKey = await failureOf(run(reply(500, `${'y'.repeat(296)}${KEY}`)));
    assert.equal(halfKey.message.includes('sk-or'), false);
    const silent = await failureOf(run(reply(503, '   ')));
    assert.equal(silent.reason, null);
    assert.equal(silent.message.includes('reason'), false);
    const bare = await failureOf(run(json({ error: { code: 401 } }, 401)));
    assert.equal(bare.reason, '{"error":{"code":401}}');
});

test('a cut-off answer is refused whole but keeps its first 2,000 characters', async () => {
    const long = `${KEY} ${'w'.repeat(2500)}`;
    const usage = { prompt_tokens: 900, completion_tokens: 4000, completion_tokens_details: { reasoning_tokens: 3100 } };
    const cut = await failureOf(run(json(answer('length', long, usage))));
    expectFailure(cut, false, 200, 'length');
    assert.equal(cut.answer.length, 2000);
    assert.equal(cut.answer.startsWith('[key] w'), true);
    assert.equal(cut.tokensIn, 900);
    assert.equal(cut.tokensOut, 4000);
    assert.equal(cut.reasoningTokens, 3100);
    const empty = await failureOf(run(json(answer('length', null))));
    assert.equal(empty.answer, '');
    const other = await failureOf(run(json(answer('error', CONTENT))));
    assert.equal(other.answer, undefined);
    assert.equal(other.reasoningTokens, null);
    const reasoned = await run(json(answer('stop', CONTENT, { completion_tokens_details: { reasoning_tokens: 12 } })));
    assert.equal(reasoned.reasoningTokens, 12);
    const odd = await run(json(answer('stop', CONTENT, { completion_tokens_details: { reasoning_tokens: -3 } })));
    assert.equal(odd.reasoningTokens, null);
});
