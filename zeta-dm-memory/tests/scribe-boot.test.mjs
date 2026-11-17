import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import FakeLocks from './support/FakeLocks.mjs';
import FakeStorage from './support/FakeStorage.mjs';
import FakeTimers from './support/FakeTimers.mjs';
import FakeZeta from './support/FakeZeta.mjs';

const context = vm.createContext({ URL, URLSearchParams, TextEncoder });

/**
 * @return {Object<string, object>}
 */
function load() {
    const loaded = {};
    const files = [
        ['core', 'ScribeText'],
        ['core', 'ScribeGateway'],
        ['page', 'ZetaSource'],
        ['page', 'ScribeStore'],
        ['page', 'ScribeBoot'],
    ];
    for (const [folder, name] of files) {
        const url = new URL(`../scribe/${folder}/${name}.js`, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
        loaded[name] = vm.runInContext(name, context);
    }
    return loaded;
}

const { ScribeStore, ScribeBoot } = load();

const START = Date.UTC(2026, 10, 15, 9, 0, 0);
const DAY = '2026-11-15';
const NEXT_DAY = '2026-11-16';
const SITE = 'https://zeta-ai.io';
const API = 'https://api.zeta-ai.io';
const MESSAGES = `${API}/v1/rooms/harbour/messages`;
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const KEY = 'sk-test-KEY-123';
const BARE = 'TOKENTOKENTOKENTOKEN';
const TOKEN = `Bearer ${BARE}`;
const LOCK = 'scribe:reader:harbour';
const UNRECORDED = 'The spending could not be recorded, so nothing more is asked until it is';
const SYSTEM = 'The system words.';
const USER = 'The user words.';
const OPEN = 'open';
const HOLD = 'hold';
const MOST_STEPS = 1000;
const BUILT = Object.freeze(['keeper harbour', 'live harbour', 'panel harbour', 'sender harbour']);
const DEFAULTS = Object.freeze({
    analyzer: 'mistralai/mistral-large-4-0',
    scribe: 'mistralai/mistral-small-3.2-24b-instruct',
    pedant: 'mistralai/mistral-small-3.2-24b-instruct',
    size: 40,
    budget: 3,
    refresh: 6,
});

/**
 * @return {Promise<void>}
 */
function settle() {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * @param {Promise<*>} promise
 * @return {Promise<Error>}
 */
async function failureOf(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new assert.AssertionError({ message: 'expected the call to fail' });
}

/**
 * @param {Error} error
 * @param {string[]} secrets
 * @return {boolean}
 */
function carries(error, secrets) {
    const texts = [String(error)];
    for (const name of Object.getOwnPropertyNames(error)) {
        texts.push(String(error[name]));
    }
    return texts.some((text) => secrets.some((secret) => text.includes(secret)));
}

/**
 * @param {string} text
 * @param {number} cost
 * @return {string}
 */
function completion(text, cost) {
    return JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: text } }],
        usage: { prompt_tokens: 12, completion_tokens: 6, cost },
    });
}

/**
 * @param {string} finish
 * @param {string} text
 * @param {number} cost
 * @return {string}
 */
function finished(finish, text, cost) {
    return JSON.stringify({
        choices: [{ finish_reason: finish, message: { content: text } }],
        usage: { prompt_tokens: 12, completion_tokens: 6, cost },
    });
}

/**
 * @param {{ details: object, ended: boolean }} call
 * @param {number} status
 * @param {*} text
 * @return {void}
 * @throws {Error}
 */
function answer(call, status, text) {
    if (call.ended) {
        throw new Error('The request has already ended');
    }
    call.ended = true;
    call.details.onload({ status, responseText: text });
}

/**
 * @param {{ details: { data: string } }} call
 * @return {Array<string|number>}
 */
function asked(call) {
    const body = JSON.parse(call.details.data);
    return [body.model, body.max_tokens];
}

/**
 * @param {{ timers?: FakeTimers|null, aborting?: boolean }} choices
 * @return {{ xmlHttpRequest: Function, calls: Array<{ details: object, handle: { aborts: number, abort: Function }, ended: boolean }>, most: number }}
 */
function requests(choices = {}) {
    const timers = choices.timers ?? null;
    const aborting = choices.aborting ?? true;
    const made = { calls: [], most: 0 };
    /**
     * @param {object} details
     * @return {{ aborts: number, abort: Function }}
     */
    made.xmlHttpRequest = (details) => {
        const handle = { aborts: 0 };
        const call = { details, handle, ended: false };
        /**
         * @return {void}
         */
        handle.abort = () => {
            handle.aborts++;
            if (aborting && !call.ended) {
                call.ended = true;
                details.onabort({ status: 0 });
            }
        };
        made.calls.push(call);
        made.most = Math.max(made.most, made.calls.filter((entry) => !entry.ended).length);
        if (timers !== null && typeof details.timeout === 'number') {
            timers.setTimeout(() => {
                if (!call.ended) {
                    call.ended = true;
                    details.ontimeout({ status: 0 });
                }
            }, details.timeout);
        }
        return handle;
    };
    return made;
}

/**
 * @param {object} target
 * @param {string[]} names
 * @param {string} label
 * @param {(label: string) => void} note
 * @return {object}
 */
function noted(target, names, label, note) {
    const copy = {};
    for (const name of names) {
        /**
         * @param {...*} values
         * @return {*}
         */
        copy[name] = (...values) => {
            note(label);
            return target[name](...values);
        };
    }
    return copy;
}

/**
 * @param {boolean} grants
 * @param {string[]} order
 * @return {{ request: Function, asked: string[], entries: object[] }}
 */
function lockManager(grants, order) {
    const manager = { asked: [], entries: [] };
    /**
     * @param {string} name
     * @param {...*} rest
     * @return {Promise<void>}
     */
    manager.request = (name, ...rest) => {
        const callback = rest.at(-1);
        const options = rest.length > 1 ? rest[0] : {};
        const waiting = options.ifAvailable !== true;
        const entry = { name, waiting, granted: false, released: false, grant: null };
        manager.asked.push(`${name} ${waiting ? 'waiting' : 'if available'}`);
        manager.entries.push(entry);
        /**
         * @param {object|null} lock
         * @return {Promise<void>}
         */
        const give = (lock) => {
            entry.granted = lock !== null;
            order.push(lock === null ? `no lock ${name}` : `lock ${name}`);
            return Promise.resolve(callback(lock)).then(() => {
                entry.released = true;
            });
        };
        if (waiting) {
            return new Promise((resolve) => {
                entry.grant = () => resolve(give({ name }));
            });
        }
        return Promise.resolve().then(() => give(grants ? { name } : null));
    };
    return manager;
}

/**
 * @param {FakeTimers} timers
 * @return {object}
 */
function standIns(timers) {
    const world = {
        order: [],
        plans: [],
        keepers: [],
        lives: [],
        panels: [],
        senders: [],
        tickFailure: null,
        mountFailure: null,
        redrawFailure: null,
        replyFailure: null,
        detachFailure: null,
        hostless: false,
    };
    context.ScribeKeeper = {
        Defaults: DEFAULTS,
        Event: Object.freeze({ Changed: 'Changed', Progress: 'Progress', Reply: 'Reply' }),
        Phase: Object.freeze({ Idle: 'Idle', Reading: 'Reading', Watching: 'Watching' }),

        /**
         * @param {object} options
         * @return {Promise<object>}
         */
        open(options) {
            const record = { roomId: options.roomId, options, ticks: [], closes: 0, claimed: null, finish: null, handle: null, phase: 'Idle' };
            record.claimed = typeof options.claim === 'function' ? options.claim() : null;
            world.order.push(`keeper ${options.roomId}`);
            world.keepers.push(record);
            record.handle = {
                /**
                 * @return {{ phase: string }}
                 */
                view: () => ({ phase: record.phase }),

                /**
                 * @return {Promise<void>}
                 */
                tick: () => {
                    record.ticks.push(timers.now() - START);
                    return world.tickFailure === null ? Promise.resolve() : Promise.reject(new Error(world.tickFailure));
                },

                /**
                 * @return {void}
                 */
                close: () => {
                    record.closes++;
                    world.order.push(`keeper close ${record.roomId}`);
                },
            };
            const plan = world.plans.length > 0 ? world.plans.shift() : OPEN;
            if (plan === OPEN) {
                return Promise.resolve(record.handle);
            }
            if (plan === HOLD) {
                return new Promise((resolve) => {
                    record.finish = () => resolve(record.handle);
                });
            }
            return Promise.reject(new Error(plan));
        },
    };
    context.ScribeLive = {
        /**
         * @param {object} options
         * @return {object}
         */
        open(options) {
            const record = { roomId: options.roomId, options, replies: [], closes: 0, outgoing: [], sent: [], live: null };
            world.order.push(`live ${options.roomId}`);
            world.lives.push(record);
            const live = {
                /**
                 * @param {*} message
                 * @return {void}
                 */
                reply: (message) => {
                    record.replies.push(message);
                    if (world.replyFailure !== null) {
                        throw new Error(world.replyFailure);
                    }
                },

                /**
                 * @param {...*} values
                 * @return {string}
                 */
                outgoing(...values) {
                    record.outgoing.push(`${this === live} ${values.join(' ')}`);
                    return 'the outgoing words';
                },

                /**
                 * @param {...*} values
                 * @return {void}
                 */
                sent(...values) {
                    record.sent.push(`${this === live} ${values.join(' ')}`);
                },

                /**
                 * @return {void}
                 */
                close: () => {
                    record.closes++;
                    world.order.push(`live close ${record.roomId}`);
                },
            };
            record.live = live;
            return live;
        },
    };
    context.ScribePanel = {
        /**
         * @param {object} options
         * @return {object}
         */
        mount(options) {
            const keeper = world.keepers.find((entry) => entry.handle === options.keeper);
            const record = { roomId: keeper.roomId, options, redraws: 0, unmounts: 0, host: null };
            world.order.push(`panel ${record.roomId}`);
            world.panels.push(record);
            if (world.mountFailure !== null) {
                throw new Error(world.mountFailure);
            }
            const panel = {
                /**
                 * @return {void}
                 */
                redraw: () => {
                    record.redraws++;
                    if (world.redrawFailure !== null) {
                        throw new Error(world.redrawFailure);
                    }
                },

                /**
                 * @return {void}
                 */
                unmount: () => {
                    record.unmounts++;
                    world.order.push(`unmount ${record.roomId}`);
                },
            };
            if (!world.hostless) {
                record.host = { name: `host ${record.roomId}`, parentNode: null };
                panel.host = record.host;
            }
            return panel;
        },
    };
    context.ScribeSender = {
        /**
         * @param {object} options
         * @return {object}
         */
        attach(options) {
            const record = { roomId: world.panels.at(-1).roomId, options, detaches: 0 };
            world.order.push(`sender ${record.roomId}`);
            world.senders.push(record);
            return {
                /**
                 * @return {void}
                 */
                detach: () => {
                    record.detaches++;
                    world.order.push(`detach ${record.roomId}`);
                    if (world.detachFailure !== null) {
                        throw new Error(world.detachFailure);
                    }
                },
            };
        },
    };
    return world;
}

/**
 * @return {object}
 */
function rootElement() {
    const root = { marks: new Map() };
    /**
     * @param {string} name
     * @return {boolean}
     */
    root.hasAttribute = (name) => root.marks.has(name);
    /**
     * @param {string} name
     * @param {string} value
     * @return {void}
     */
    root.setAttribute = (name, value) => {
        root.marks.set(name, String(value));
    };
    /**
     * @param {string} name
     * @return {void}
     */
    root.removeAttribute = (name) => {
        root.marks.delete(name);
    };
    return root;
}

/**
 * @param {boolean} body
 * @return {object}
 */
function pageDocument(body) {
    const document = { body: body ? { kind: 'body' } : null, visibilityState: 'visible', documentElement: rootElement(), listeners: [] };
    /**
     * @param {string} type
     * @param {Function} listener
     * @return {void}
     */
    document.addEventListener = (type, listener) => {
        document.listeners.push({ type, listener });
    };
    /**
     * @param {string} type
     * @param {Function} listener
     * @return {void}
     */
    document.removeEventListener = (type, listener) => {
        document.listeners = document.listeners.filter((entry) => entry.type !== type || entry.listener !== listener);
    };
    return document;
}

/**
 * @param {object} run
 * @param {string} state
 * @return {Promise<void>}
 */
async function show(run, state) {
    run.document.visibilityState = state;
    for (const entry of run.document.listeners.filter((listening) => listening.type === 'visibilitychange')) {
        entry.listener({ type: 'visibilitychange' });
    }
    await settle();
}

/**
 * @param {{ path?: string, body?: boolean, exporter?: Function|null, clone?: Function|null, locks?: object|null, timers?: FakeTimers, storage?: FakeStorage, world?: object, tabId?: string }} choices
 * @return {object}
 */
function harness(choices = {}) {
    const path = choices.path ?? '/rooms/harbour';
    const timers = choices.timers ?? new FakeTimers(START);
    const page = FakeZeta.window(`${SITE}${path}`);
    page.location.pathname = path;
    page.AbortController = AbortController;
    page.listeners = [];
    /**
     * @param {string} type
     * @param {Function} listener
     * @param {boolean|{ capture?: boolean }} options
     * @return {void}
     */
    page.addEventListener = (type, listener, options) => {
        page.listeners.push({ type, listener, capture: options === true || options?.capture === true });
    };
    /**
     * @param {string} type
     * @param {Function} listener
     * @param {boolean|{ capture?: boolean }} options
     * @return {void}
     */
    page.removeEventListener = (type, listener, options) => {
        const capture = options === true || options?.capture === true;
        page.listeners = page.listeners.filter((entry) => entry.type !== type || entry.listener !== listener || entry.capture !== capture);
    };
    const run = {
        timers,
        page,
        original: page.fetch,
        document: pageDocument(choices.body !== false),
        storage: choices.storage ?? new FakeStorage(),
        lines: [],
        sent: requests(),
        world: choices.world ?? standIns(timers),
        clock: null,
        environment: null,
        boot: null,
    };
    run.clock = {
        day: DAY,
        /**
         * @return {number}
         */
        now: () => timers.now(),
        /**
         * @return {string}
         */
        today: () => run.clock.day,
    };
    run.environment = {
        pageWindow: page,
        document: run.document,
        storage: run.storage,
        xmlHttpRequest: run.sent.xmlHttpRequest,
        exporter: choices.exporter ?? null,
        clone: choices.clone ?? null,
        timers: {
            setTimeout: (callback, delay) => timers.setTimeout(callback, delay),
            clearTimeout: (id) => timers.clearTimeout(id),
            setInterval: (callback, delay) => timers.setInterval(callback, delay),
            clearInterval: (id) => timers.clearInterval(id),
        },
        clock: run.clock,
        tabId: choices.tabId ?? 'tab-one',
        locks: choices.locks ?? null,
        confirm: () => true,
        download: () => undefined,
        log: (text) => {
            run.lines.push(text);
        },
    };
    return run;
}

/**
 * @param {object} run
 * @return {object}
 */
function start(run) {
    run.boot = ScribeBoot.start(run.environment);
    return run.boot;
}

/**
 * @param {object} run
 * @param {string} path
 * @return {void}
 */
function go(run, path) {
    run.page.location.href = `${SITE}${path}`;
    run.page.location.pathname = path;
}

/**
 * @param {object} run
 * @param {number} milliseconds
 * @return {Promise<void>}
 */
async function pass(run, milliseconds) {
    await settle();
    const target = run.timers.now() + milliseconds;
    for (let step = 0; step < MOST_STEPS; step++) {
        const next = run.timers.next;
        if (next === null || next > target) {
            run.timers.advance(target - run.timers.now());
            await settle();
            return;
        }
        run.timers.advance(next - run.timers.now());
        await settle();
    }
    assert.fail('Time did not come to rest');
}

/**
 * @param {object} run
 * @param {string} type
 * @param {{ path?: object[], target?: object, broken?: boolean }} shape
 * @return {{ stops: number, prevents: number, heard: number }}
 */
function key(run, type, shape) {
    const event = {
        type,
        stops: 0,
        prevents: 0,
        heard: 0,
        /**
         * @return {void}
         */
        stopImmediatePropagation() {
            event.stops++;
        },
        /**
         * @return {void}
         */
        preventDefault() {
            event.prevents++;
        },
    };
    if (shape.path !== undefined) {
        /**
         * @return {object[]}
         */
        event.composedPath = () => shape.path;
    }
    if (shape.broken === true) {
        /**
         * @return {never}
         */
        event.composedPath = () => {
            throw new Error('The path could not be read');
        };
    }
    if (shape.target !== undefined) {
        event.target = shape.target;
    }
    for (const entry of run.page.listeners.filter((listening) => listening.type === type && listening.capture)) {
        event.heard++;
        entry.listener(event);
    }
    return { stops: event.stops, prevents: event.prevents, heard: event.heard };
}

/**
 * @param {Promise<*>} promise
 * @return {Promise<string>}
 */
function stateOf(promise) {
    return Promise.race([promise.then(() => 'settled', () => 'settled'), settle().then(() => 'pending')]);
}

/**
 * @param {object} run
 * @param {string} address
 * @return {Promise<void>}
 */
async function traffic(run, address = MESSAGES) {
    await run.page.fetch(address, { method: 'POST', body: 'a message' });
    await settle();
}

test('the model request goes only to the model', async () => {
    const made = requests();
    const fetch = ScribeBoot.request(made.xmlHttpRequest);
    const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
    const body = JSON.stringify({ model: 'invented/model' });
    const answering = fetch(ENDPOINT, { method: 'POST', headers, body });
    assert.equal(made.calls.length, 1);
    const details = made.calls[0].details;
    assert.equal(details.method, 'POST');
    assert.equal(details.url, ENDPOINT);
    assert.deepEqual(Object.keys(details.headers), ['Authorization', 'Content-Type']);
    assert.equal(details.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(details.headers['Content-Type'], 'application/json');
    assert.equal(details.data, body);
    assert.equal(details.anonymous, true);
    assert.equal(details.responseType, 'text');
    answer(made.calls[0], 201, 'the words that came back');
    const response = await answering;
    assert.equal(response.status, 201);
    assert.equal(await response.text(), 'the words that came back');
    const odd = fetch(ENDPOINT, { method: 'POST', headers, body });
    answer(made.calls[1], 200, null);
    assert.equal(await (await odd).text(), '');
    const refused = ['https://openrouter.ai.example/x', 'https://example.org/', 'http://openrouter.ai/x', 'https://openrouter.ai', 'https://openrouter.ai@example.org/'];
    for (const url of refused) {
        const refusing = fetch(url, { method: 'POST', headers, body });
        assert.equal(made.calls.length, 2, url);
        const error = await failureOf(refusing);
        assert.equal(error.message, 'The request was refused', url);
    }
});

test('a failed model request says nothing of the request', async () => {
    const made = requests();
    const fetch = ScribeBoot.request(made.xmlHttpRequest);
    const url = `${ENDPOINT}?for=${KEY}`;
    const options = { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ key: KEY }) };
    const endings = [
        ['onerror', 'The request failed'],
        ['ontimeout', 'The request timed out'],
        ['onabort', 'The request was stopped'],
    ];
    for (const [ending, sentence] of endings) {
        const failing = fetch(url, options);
        made.calls.at(-1).details[ending]({ status: 0, error: `failed at ${url} with ${KEY}`, finalUrl: url, responseHeaders: `authorization: Bearer ${KEY}` });
        const error = await failureOf(failing);
        assert.equal(error.message, sentence);
        assert.equal(carries(error, [KEY, url]), false, ending);
    }
    const throwing = ScribeBoot.request(() => {
        throw new Error(`no route to ${url} for ${KEY}`);
    });
    const thrown = await failureOf(throwing(url, options));
    assert.equal(thrown.message, 'The request failed');
    assert.equal(carries(thrown, [KEY, url]), false);
});

test('a stopped request is stopped', async () => {
    const made = requests();
    const fetch = ScribeBoot.request(made.xmlHttpRequest);
    const options = { method: 'POST', headers: {}, body: '{}' };
    const early = new AbortController();
    early.abort();
    const stopping = fetch(ENDPOINT, { ...options, signal: early.signal });
    assert.equal(made.calls.length, 0);
    assert.equal((await failureOf(stopping)).message, 'The request was stopped');
    const later = new AbortController();
    const running = fetch(ENDPOINT, { ...options, signal: later.signal });
    assert.equal(made.calls.length, 1);
    assert.equal(made.calls[0].handle.aborts, 0);
    later.abort();
    assert.equal(made.calls[0].handle.aborts, 1);
    assert.equal((await failureOf(running)).message, 'The request was stopped');
    later.abort();
    assert.equal(made.calls[0].handle.aborts, 1);
    for (const handle of [{}, undefined, null]) {
        const bare = ScribeBoot.request(() => handle);
        const quiet = new AbortController();
        const going = bare(ENDPOINT, { ...options, signal: quiet.signal });
        quiet.abort();
        assert.equal((await failureOf(going)).message, 'The request was stopped');
    }
    await settle();
});

test('the watcher is installed before anything else', async () => {
    const given = [];
    let exported = 0;
    /**
     * @param {Function} wrapper
     * @return {Function}
     */
    const exporter = (wrapper) => {
        given.push(wrapper);
        return function (...values) {
            exported++;
            return wrapper.apply(this, values);
        };
    };
    const cloned = [];
    /**
     * @param {*} value
     * @return {*}
     */
    const clone = (value) => {
        const copy = JSON.parse(JSON.stringify(value));
        cloned.push(copy);
        return copy;
    };
    const run = harness({ exporter, clone });
    const touched = [];
    /**
     * @param {string} what
     * @return {void}
     */
    const note = (what) => {
        touched.push(`${what} ${run.page.fetch === run.original ? 'unwrapped' : 'wrapped'}`);
    };
    run.environment.timers = noted(run.environment.timers, ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], 'timer', note);
    run.environment.storage = noted(run.storage, ['get', 'set', 'remove', 'list'], 'storage', note);
    const document = run.document;
    run.environment.document = {
        /**
         * @return {object|null}
         */
        get body() {
            note('document');
            return document.body;
        },

        /**
         * @return {string}
         */
        get visibilityState() {
            note('document');
            return document.visibilityState;
        },
        documentElement: document.documentElement,
        addEventListener: document.addEventListener,
        removeEventListener: document.removeEventListener,
    };
    Object.defineProperty(run.page.location, 'pathname', {
        get: () => {
            note('location');
            return '/rooms/harbour';
        },
    });
    start(run);
    await settle();
    assert.equal(given.length, 4);
    assert.equal(run.page.fetch === run.original, false);
    assert.deepEqual(run.world.order, BUILT);
    assert.equal(touched.includes('timer wrapped'), true);
    assert.equal(touched.includes('location wrapped'), true);
    assert.equal(touched.includes('document wrapped'), true);
    assert.deepEqual(touched.filter((entry) => entry.endsWith('unwrapped')), []);
    await run.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: TOKEN } });
    assert.equal(exported, 1);
    assert.equal(run.page.fetchCalls.length, 1);
    run.page.answer = () => Promise.resolve(FakeZeta.page([FakeZeta.message('m1', FakeZeta.time(1))], null));
    const zeta = run.world.keepers[0].options.zeta;
    const counts = [];
    const pulled = await zeta.history((count) => {
        counts.push(count);
    });
    assert.equal(pulled.messages.length, 1);
    assert.deepEqual(counts, [1]);
    assert.equal(exported, 1);
    assert.equal(run.page.fetchCalls.length, 2);
    const reading = run.page.fetchCalls[1];
    assert.equal(reading.receiver === run.page, true);
    assert.equal(reading.values[0], `${MESSAGES}?limit=31`);
    assert.equal(reading.values[1] === cloned.at(-1), true);
    assert.equal(reading.values[1].headers.Authorization, TOKEN);
    const renewed = 'Bearer RENEWEDRENEWEDRENEWED';
    await run.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: renewed } });
    await zeta.newest();
    assert.equal(exported, 2);
    assert.equal(run.page.fetchCalls.length, 4);
    assert.equal(run.page.fetchCalls[3].receiver === run.page, true);
    assert.equal(run.page.fetchCalls[3].values[1] === cloned.at(-1), true);
    assert.equal(run.page.fetchCalls[3].values[1].headers.Authorization, renewed);
    const plain = harness();
    start(plain);
    await settle();
    await plain.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: TOKEN } });
    plain.page.answer = () => Promise.resolve(FakeZeta.page([FakeZeta.message('m1', FakeZeta.time(1))], null));
    const newest = await plain.world.keepers[0].options.zeta.newest();
    assert.equal(newest.messages.length, 1);
    assert.equal(plain.page.fetchCalls.length, 2);
    assert.equal(plain.page.fetchCalls[1].receiver === plain.page, true);
    assert.equal(plain.page.fetchCalls[1].values[1].headers.Authorization, TOKEN);
    plain.boot.stop();
    run.boot.stop();
});

test('a session opens for a room and only once', async () => {
    const run = harness();
    start(run);
    await settle();
    assert.deepEqual(run.world.order, BUILT);
    const keeper = run.world.keepers[0];
    assert.equal(keeper.options.storage === run.storage, true);
    assert.equal(keeper.options.roomId, 'harbour');
    assert.equal(keeper.options.tabId, 'tab-one');
    assert.equal(keeper.options.clock === run.clock, true);
    const live = run.world.lives[0];
    assert.equal(live.options.keeper === keeper.handle, true);
    assert.equal(live.options.storage === run.storage, true);
    assert.equal(live.options.clock === run.clock, true);
    const panel = run.world.panels[0];
    assert.equal(panel.options.document === run.document, true);
    assert.equal(panel.options.keeper === keeper.handle, true);
    assert.equal(panel.options.live === live.live, true);
    assert.equal(panel.options.storage === run.storage, true);
    assert.equal(panel.options.confirm === run.environment.confirm, true);
    assert.equal(panel.options.download === run.environment.download, true);
    assert.equal(panel.options.clock === run.clock, true);
    const sender = run.world.senders[0];
    assert.equal(sender.options.document === run.document, true);
    assert.equal(sender.options.window === run.page, true);
    assert.equal(sender.options.outgoing('the', 'words'), 'the outgoing words');
    sender.options.sent('done');
    assert.deepEqual(live.outgoing, ['true the words']);
    assert.deepEqual(live.sent, ['true done']);
    await pass(run, 5000);
    assert.equal(run.world.keepers.length, 1);
    assert.deepEqual(run.world.order, BUILT);
    run.boot.stop();
    const home = harness({ path: '/' });
    start(home);
    await pass(home, 3000);
    assert.deepEqual(home.world.order, []);
    home.boot.stop();
    const early = harness({ body: false });
    start(early);
    await pass(early, 3000);
    assert.deepEqual(early.world.order, []);
    early.document.body = { kind: 'body' };
    await pass(early, 1000);
    assert.deepEqual(early.world.order, BUILT);
    await pass(early, 3000);
    assert.equal(early.world.keepers.length, 1);
    early.boot.stop();
});

test('the session follows the player', async () => {
    const run = harness();
    start(run);
    await settle();
    assert.equal(run.timers.intervals, 2);
    go(run, '/rooms/quay');
    await pass(run, 1000);
    assert.deepEqual(run.world.order, [
        ...BUILT,
        'detach harbour',
        'unmount harbour',
        'live close harbour',
        'keeper close harbour',
        'keeper quay',
        'live quay',
        'panel quay',
        'sender quay',
    ]);
    assert.equal(run.timers.intervals, 2);
    await pass(run, 20000);
    assert.equal(run.world.keepers[0].ticks.length, 0);
    assert.equal(run.world.keepers[1].ticks.length, 1);
    go(run, '/characters/someone');
    await pass(run, 1000);
    assert.deepEqual(run.world.order.slice(12), ['detach quay', 'unmount quay', 'live close quay', 'keeper close quay']);
    assert.equal(run.timers.intervals, 1);
    await pass(run, 40000);
    assert.equal(run.world.keepers.length, 2);
    assert.equal(run.world.order.length, 16);
    assert.equal(run.world.keepers[1].ticks.length, 1);
    run.boot.stop();
});

test('a keeper that arrives late is closed', async () => {
    const run = harness();
    run.world.plans.push(HOLD);
    start(run);
    await settle();
    assert.deepEqual(run.world.order, ['keeper harbour']);
    go(run, '/rooms/quay');
    await pass(run, 1000);
    assert.deepEqual(run.world.order, ['keeper harbour', 'keeper quay', 'live quay', 'panel quay', 'sender quay']);
    const late = run.world.keepers[0];
    late.finish();
    await settle();
    assert.equal(late.closes, 1);
    assert.deepEqual(run.world.order.slice(5), ['keeper close harbour']);
    assert.equal(run.world.lives.length, 1);
    assert.equal(run.world.panels.length, 1);
    assert.equal(run.world.senders.length, 1);
    assert.equal(run.world.lives[0].roomId, 'quay');
    await pass(run, 20000);
    assert.equal(late.ticks.length, 0);
    assert.equal(run.world.keepers[1].ticks.length, 1);
    run.boot.stop();
});

test('a session that cannot start is tried again', async () => {
    const run = harness();
    run.world.plans.push('The storage could not be read', OPEN, 'The book could not be found');
    start(run);
    await settle();
    assert.deepEqual(run.lines, ['The scribe could not start: The storage could not be read']);
    assert.equal(run.world.keepers.length, 1);
    await pass(run, 9999);
    assert.equal(run.world.keepers.length, 1);
    run.world.mountFailure = 'The panel broke';
    await pass(run, 1);
    assert.equal(run.world.keepers.length, 2);
    assert.deepEqual(run.world.order, ['keeper harbour', 'keeper harbour', 'live harbour', 'panel harbour', 'live close harbour', 'keeper close harbour']);
    assert.equal(run.world.keepers[1].closes, 1);
    assert.equal(run.world.lives[0].closes, 1);
    assert.equal(run.world.senders.length, 0);
    assert.equal(run.lines.at(-1), 'The scribe could not start: The panel broke');
    run.world.mountFailure = null;
    await pass(run, 9999);
    assert.equal(run.world.keepers.length, 2);
    await pass(run, 1);
    assert.equal(run.world.keepers.length, 3);
    assert.equal(run.lines.at(-1), 'The scribe could not start: The book could not be found');
    go(run, '/');
    await pass(run, 30000);
    assert.equal(run.world.keepers.length, 3);
    assert.equal(run.lines.length, 3);
    assert.equal(run.timers.count, 1);
    run.boot.stop();
});

test('the model is asked by role', async () => {
    const run = harness();
    start(run);
    await settle();
    const ask = run.world.keepers[0].options.ask;
    const missing = await failureOf(ask(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    assert.equal(missing.message, 'No key');
    assert.equal(run.sent.calls.length, 0);
    ScribeStore.setKey(run.storage, KEY);
    const plain = ask(ScribeBoot.Role.Analyzer, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 1);
    assert.deepEqual(asked(run.sent.calls[0]), [DEFAULTS.analyzer, 40000]);
    answer(run.sent.calls[0], 200, completion('The plain answer.', 0.25));
    const result = await plain;
    assert.deepEqual(Object.keys(result), ['text', 'cost']);
    assert.equal(result.text, 'The plain answer.');
    assert.equal(result.cost, 0.25);
    ScribeStore.write(run.storage, 'harbour', ScribeStore.Kind.Settings, { analyzer: 'invented/analyzer-model', scribe: 'invented/scribe-model', budget: 3 });
    const roles = [
        ['Analyzer', 'invented/analyzer-model', 40000],
        ['Scribe', 'invented/scribe-model', 700],
        ['Pedant', DEFAULTS.pedant, 1500],
    ];
    for (const [role, model, tokens] of roles) {
        const asking = ask(ScribeBoot.Role[role], SYSTEM, USER);
        await settle();
        const call = run.sent.calls.at(-1);
        assert.deepEqual(asked(call), [model, tokens], role);
        assert.equal(call.details.url, ENDPOINT);
        assert.equal(call.details.headers.Authorization, `Bearer ${KEY}`);
        answer(call, 200, completion(`The ${role} answer.`, 0.5));
        const answered = await asking;
        assert.equal(answered.text, `The ${role} answer.`);
        assert.equal(answered.cost, 0.5);
    }
    assert.equal(run.sent.calls.length, 4);
    const retried = ask(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    answer(run.sent.calls.at(-1), 500, 'The service is busy.');
    await pass(run, 1999);
    assert.equal(run.sent.calls.length, 5);
    await pass(run, 1);
    assert.equal(run.sent.calls.length, 6);
    assert.deepEqual(asked(run.sent.calls.at(-1)), ['invented/scribe-model', 700]);
    answer(run.sent.calls.at(-1), 200, completion('The second try.', 0.1));
    assert.equal((await retried).text, 'The second try.');
    run.boot.stop();
});

test('the live part\'s calls are counted and capped', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const live = run.world.lives[0].options.ask;
    const keeper = run.world.keepers[0].options.ask;
    const scene = live(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 1);
    answer(run.sent.calls[0], 200, completion('The scene.', 0.01));
    assert.equal((await scene).text, 'The scene.');
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 0.01);
    assert.equal(ScribeStore.spent(run.storage, 'quay', DAY), 0);
    run.clock.day = NEXT_DAY;
    ScribeStore.spend(run.storage, 'harbour', NEXT_DAY, 3);
    const capping = failureOf(live(ScribeBoot.Role.Pedant, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 1);
    assert.equal((await capping).message, "The day's budget is spent");
    const stretch = keeper(ScribeBoot.Role.Analyzer, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 2);
    answer(run.sent.calls[1], 200, completion('The stretch.', 0.5));
    assert.equal((await stretch).cost, 0.5);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', NEXT_DAY), 3);
    ScribeStore.write(run.storage, 'harbour', ScribeStore.Kind.Settings, { budget: 4 });
    const allowed = live(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 3);
    answer(run.sent.calls[2], 200, completion('The next scene.', 1));
    await allowed;
    assert.equal(ScribeStore.spent(run.storage, 'harbour', NEXT_DAY), 4);
    const over = failureOf(live(ScribeBoot.Role.Scribe, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 3);
    assert.equal((await over).message, "The day's budget is spent");
    run.boot.stop();
});

test('ticks come on time and not too often', async () => {
    const run = harness();
    start(run);
    await settle();
    const keeper = run.world.keepers[0];
    await pass(run, 40000);
    assert.deepEqual(keeper.ticks, [20000, 40000]);
    await show(run, 'hidden');
    await pass(run, 40000);
    assert.deepEqual(keeper.ticks, [20000, 40000, 60000, 80000]);
    await show(run, 'visible');
    await pass(run, 3000);
    await traffic(run);
    await pass(run, 15000);
    assert.deepEqual(keeper.ticks.slice(4), [83000, 88000, 98000]);
    await pass(run, 6000);
    assert.deepEqual(keeper.ticks.slice(7), [101000]);
    const base = run.timers.now() - START;
    for (let count = 0; count < 3; count++) {
        await traffic(run);
        await pass(run, 400);
    }
    await pass(run, 20800);
    assert.deepEqual(
        keeper.ticks.slice(8).map((time) => time - base),
        [0, 3000, 6000, 15000, 18000],
    );
    run.world.tickFailure = 'The newest page could not be read';
    await pass(run, 15000);
    assert.equal(keeper.ticks.at(-1), 140000);
    assert.deepEqual(run.lines, ['The check failed: The newest page could not be read']);
    run.world.tickFailure = null;
    await pass(run, 20000);
    assert.equal(keeper.ticks.at(-1), 160000);
    assert.equal(keeper.ticks.length, 15);
    assert.equal(run.lines.length, 1);
    run.boot.stop();
});

test('replies reach the live part', async () => {
    const run = harness();
    run.world.plans.push(HOLD);
    start(run);
    await settle();
    const keeper = run.world.keepers[0];
    const notify = keeper.options.notify;
    notify({ kind: 'Reply', message: 'The first reply.' });
    notify({ kind: 'Reply', message: 'The second reply.' });
    notify({ kind: 'Changed' });
    keeper.finish();
    await settle();
    assert.deepEqual(run.world.order, BUILT);
    const live = run.world.lives[0];
    const panel = run.world.panels[0];
    assert.deepEqual(live.replies, ['The second reply.']);
    assert.equal(panel.redraws, 0);
    notify({ kind: 'Reply', message: 'The third reply.' });
    assert.deepEqual(live.replies, ['The second reply.', 'The third reply.']);
    assert.equal(panel.redraws, 1);
    notify({ kind: 'Progress' });
    assert.equal(panel.redraws, 2);
    live.options.notify({ kind: 'Found' });
    assert.equal(panel.redraws, 3);
    run.world.redrawFailure = 'The panel could not draw';
    notify({ kind: 'Changed' });
    await settle();
    assert.equal(panel.redraws, 4);
    assert.deepEqual(run.lines, ['The panel could not be drawn: The panel could not draw']);
    run.world.redrawFailure = null;
    run.world.replyFailure = 'The live part tripped';
    notify({ kind: 'Reply', message: 'The fourth reply.' });
    await settle();
    assert.deepEqual(live.replies, ['The second reply.', 'The third reply.', 'The fourth reply.']);
    assert.equal(panel.redraws, 5);
    assert.deepEqual(run.lines, ['The panel could not be drawn: The panel could not draw', 'The reply could not be handed on: The live part tripped']);
    run.world.replyFailure = null;
    notify({ kind: 'Reply', message: 'The fifth reply.' });
    assert.equal(live.replies.at(-1), 'The fifth reply.');
    assert.equal(panel.redraws, 6);
    await pass(run, 20000);
    assert.equal(keeper.ticks.length, 1);
    run.boot.stop();
});

test('one reader by the browser\'s lock', async () => {
    const run = harness();
    const granting = lockManager(true, run.world.order);
    run.environment.locks = granting;
    start(run);
    await settle();
    assert.deepEqual(granting.asked, ['scribe:reader:harbour if available']);
    assert.deepEqual(run.world.order, ['lock scribe:reader:harbour', ...BUILT]);
    const reader = run.world.keepers[0];
    assert.equal(reader.claimed, true);
    assert.equal(reader.options.claim(), true);
    assert.equal(granting.entries[0].released, false);
    go(run, '/');
    await pass(run, 1000);
    assert.equal(granting.entries[0].released, true);
    assert.equal(reader.options.claim(), false);
    run.boot.stop();

    const second = harness();
    const refusing = lockManager(false, second.world.order);
    second.environment.locks = refusing;
    start(second);
    await settle();
    assert.deepEqual(refusing.asked, ['scribe:reader:harbour if available', 'scribe:reader:harbour waiting']);
    assert.deepEqual(second.world.order, ['no lock scribe:reader:harbour', ...BUILT]);
    const watcher = second.world.keepers[0];
    assert.equal(watcher.claimed, false);
    assert.equal(watcher.options.claim(), false);
    assert.equal(watcher.ticks.length, 0);
    refusing.entries[1].grant();
    await settle();
    assert.equal(refusing.entries[1].granted, true);
    assert.equal(watcher.options.claim(), true);
    assert.equal(watcher.ticks.length, 1);
    assert.equal(refusing.entries[1].released, false);
    second.boot.stop();
    await settle();
    assert.equal(refusing.entries[1].released, true);
    assert.equal(watcher.options.claim(), false);

    const third = harness();
    const late = lockManager(false, third.world.order);
    third.environment.locks = late;
    start(third);
    await settle();
    go(third, '/');
    await pass(third, 1000);
    assert.equal(late.entries[1].granted, false);
    late.entries[1].grant();
    await settle();
    assert.equal(late.entries[1].granted, true);
    assert.equal(late.entries[1].released, true);
    assert.equal(third.world.keepers[0].options.claim(), false);
    assert.equal(third.world.keepers[0].ticks.length, 0);
    third.boot.stop();

    const fourth = harness();
    start(fourth);
    await settle();
    assert.equal('claim' in fourth.world.keepers[0].options, false);
    fourth.boot.stop();
});

test('stop ends everything', async () => {
    const run = harness();
    const boot = start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const ask = run.world.keepers[0].options.ask;
    const pending = failureOf(ask(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 1);
    await traffic(run);
    assert.equal(run.timers.count > 2, true);
    assert.equal(run.document.documentElement.hasAttribute('data-zeta-scribe'), true);
    boot.stop();
    assert.deepEqual(run.world.order, [...BUILT, 'detach harbour', 'unmount harbour', 'live close harbour', 'keeper close harbour']);
    assert.equal(run.page.fetch === run.original, true);
    assert.equal(run.timers.count, 0);
    assert.equal(run.document.listeners.length, 0);
    assert.equal(run.document.documentElement.hasAttribute('data-zeta-scribe'), false);
    assert.equal(await stateOf(pending), 'settled');
    assert.equal((await pending).message, 'The chat has been left');
    const refusing = failureOf(ask(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 1);
    assert.equal((await refusing).message, 'The chat has been left');
    go(run, '/rooms/quay');
    await traffic(run);
    await pass(run, 60000);
    assert.equal(run.world.order.length, 8);
    assert.equal(run.world.keepers.length, 1);
    assert.equal(run.world.keepers[0].ticks.length, 0);
    assert.equal(run.timers.count, 0);
});

test('secrets stay out of the log', async () => {
    const run = harness({ path: '/' });
    ScribeStore.setKey(run.storage, KEY);
    run.world.plans.push(`Zeta refused ${TOKEN}`, OPEN);
    start(run);
    await run.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: TOKEN } });
    go(run, '/rooms/harbour');
    await pass(run, 1000);
    assert.equal(run.world.keepers.length, 1);
    await pass(run, 10000);
    assert.equal(run.world.keepers.length, 2);
    assert.deepEqual(run.world.order.slice(1), BUILT);
    const keeper = run.world.keepers[1];
    run.world.tickFailure = `The newest page failed for ${BARE}`;
    await pass(run, 20000);
    assert.equal(keeper.ticks.length, 1);
    run.world.redrawFailure = `The panel saw ${TOKEN}`;
    keeper.options.notify({ kind: 'Changed' });
    await settle();
    const rejected = [];
    const failing = keeper.options.ask(ScribeBoot.Role.Analyzer, SYSTEM, USER);
    await settle();
    answer(run.sent.calls.at(-1), 200, JSON.stringify({ error: { code: 401, message: `Key ${KEY} is not valid` } }));
    rejected.push((await failureOf(failing)).message);
    const live = run.world.lives[0].options.ask(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    answer(run.sent.calls.at(-1), 200, JSON.stringify({ error: { code: 403, message: `The key ${KEY} is refused` } }));
    rejected.push((await failureOf(live)).message);
    const refusal = ScribeBoot.request(run.sent.xmlHttpRequest)(`https://example.org/?key=${KEY}&token=${TOKEN}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}` },
        body: TOKEN,
    });
    assert.equal(run.sent.calls.length, 2);
    rejected.push((await failureOf(refusal)).message);
    assert.equal(run.lines.length, 3);
    assert.equal(run.lines[0], 'The scribe could not start: Zeta refused [hidden]');
    assert.equal(run.lines[1], 'The check failed: The newest page failed for [hidden]');
    assert.equal(run.lines[2], 'The panel could not be drawn: The panel saw [hidden]');
    assert.equal(rejected.length, 3);
    assert.equal(rejected[2], 'The request was refused');
    for (const [index, text] of [...run.lines, ...rejected].entries()) {
        assert.equal(text.includes(KEY), false, `text ${index}`);
        assert.equal(text.includes(TOKEN), false, `text ${index}`);
        assert.equal(text.includes('TOKENTOKEN'), false, `text ${index}`);
    }
    run.boot.stop();
});

test('the send hook is told what to ignore', async () => {
    const run = harness();
    start(run);
    await settle();
    const panel = run.world.panels[0];
    assert.equal(panel.host === null, false);
    assert.equal(run.world.senders.length, 1);
    assert.equal(run.world.senders[0].options.ignore === panel.host, true);
    go(run, '/rooms/quay');
    await pass(run, 1000);
    assert.equal(run.world.senders.length, 2);
    assert.equal(run.world.senders[1].options.ignore === run.world.panels[1].host, true);
    assert.equal(run.world.senders[1].options.ignore === panel.host, false);
    run.boot.stop();
    const bare = harness();
    bare.world.hostless = true;
    start(bare);
    await settle();
    assert.equal(bare.world.senders.length, 1);
    assert.equal('ignore' in bare.world.senders[0].options, true);
    assert.equal(bare.world.senders[0].options.ignore, null);
    bare.boot.stop();
});

test('keys typed in the panel stay in the panel', async () => {
    const run = harness();
    const touched = [];
    /**
     * @param {string} what
     * @return {void}
     */
    const note = (what) => {
        touched.push(`${what} ${run.page.fetch === run.original ? 'unwrapped' : 'wrapped'}`);
    };
    const adding = run.page.addEventListener;
    run.page.addEventListener = (...values) => {
        note('listener');
        adding(...values);
    };
    run.environment.timers = noted(run.environment.timers, ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], 'timer', note);
    run.environment.storage = noted(run.storage, ['get', 'set', 'remove', 'list'], 'storage', note);
    start(run);
    await settle();
    assert.deepEqual(touched.slice(0, 4), ['listener wrapped', 'listener wrapped', 'listener wrapped', 'timer wrapped']);
    assert.deepEqual(
        run.page.listeners.map((entry) => `${entry.type} ${entry.capture}`),
        ['keydown true', 'keyup true', 'keypress true'],
    );
    const host = run.world.panels[0].host;
    const field = { name: 'the key field', parentNode: host };
    const body = { name: 'the page body', parentNode: null };
    const box = { name: 'the message box', parentNode: body };
    for (const type of ['keydown', 'keyup', 'keypress']) {
        assert.deepEqual(key(run, type, { path: [field, host, body] }), { stops: 1, prevents: 0, heard: 1 }, type);
        assert.deepEqual(key(run, type, { path: [box, body] }), { stops: 0, prevents: 0, heard: 1 }, type);
        assert.deepEqual(key(run, type, { target: field }), { stops: 1, prevents: 0, heard: 1 }, type);
        assert.deepEqual(key(run, type, { target: box }), { stops: 0, prevents: 0, heard: 1 }, type);
    }
    assert.deepEqual(key(run, 'keydown', { broken: true }), { stops: 0, prevents: 0, heard: 1 });
    go(run, '/rooms/quay');
    await pass(run, 1000);
    const next = run.world.panels[1].host;
    assert.equal(next === host, false);
    assert.deepEqual(key(run, 'keydown', { path: [field, host, body] }), { stops: 0, prevents: 0, heard: 1 });
    assert.deepEqual(key(run, 'keydown', { path: [{ name: 'the quay field' }, next, body] }), { stops: 1, prevents: 0, heard: 1 });
    go(run, '/');
    await pass(run, 1000);
    assert.deepEqual(key(run, 'keydown', { path: [{ name: 'the quay field' }, next, body] }), { stops: 0, prevents: 0, heard: 1 });
    run.boot.stop();
    assert.equal(run.page.listeners.length, 0);
    assert.deepEqual(key(run, 'keyup', { path: [field, host, body] }), { stops: 0, prevents: 0, heard: 0 });
});

test('everything billed is counted', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const live = run.world.lives[0].options.ask;
    const keeper = run.world.keepers[0].options.ask;
    const first = failureOf(live(ScribeBoot.Role.Pedant, SYSTEM, USER));
    for (const pauseMs of [2000, 4000, 0]) {
        await settle();
        answer(run.sent.calls.at(-1), 200, finished('stop', '   ', 1));
        await pass(run, pauseMs);
    }
    assert.equal((await first).message.startsWith('answer has no usable content'), true);
    assert.equal(run.sent.calls.length, 3);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 3);
    for (let count = 0; count < 5; count++) {
        const refused = failureOf(live(ScribeBoot.Role.Pedant, SYSTEM, USER));
        await settle();
        assert.equal((await refused).message, "The day's budget is spent");
    }
    assert.equal(run.sent.calls.length, 3);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 3);
    run.clock.day = NEXT_DAY;
    const mended = live(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    answer(run.sent.calls.at(-1), 200, finished('error', 'Half a scene', 0.4));
    await pass(run, 2000);
    answer(run.sent.calls.at(-1), 200, finished('stop', 'The scene.', 0.01));
    const scene = await mended;
    assert.equal(scene.text, 'The scene.');
    assert.equal(scene.cost, 0.4 + 0.01);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', NEXT_DAY), 0.4 + 0.01);
    run.clock.day = '2026-11-17';
    const cut = failureOf(keeper(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    await settle();
    answer(run.sent.calls.at(-1), 200, finished('length', 'A stretch cut short', 0.7));
    assert.equal((await cut).message.startsWith('answer was cut off'), true);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', '2026-11-17'), 0.7);
    run.clock.day = '2026-11-18';
    const twice = keeper(ScribeBoot.Role.Analyzer, SYSTEM, USER);
    await settle();
    answer(run.sent.calls.at(-1), 200, finished('stop', '   ', 0.25));
    await pass(run, 2000);
    answer(run.sent.calls.at(-1), 200, finished('stop', 'The stretch.', 0.25));
    const stretch = await twice;
    assert.equal(stretch.text, 'The stretch.');
    assert.equal(stretch.cost, 0.5);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', '2026-11-18'), 0);
    assert.equal(run.sent.calls.length, 8);
    run.boot.stop();
});

test('a billed amount that cannot be written is kept', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const live = run.world.lives[0].options.ask;
    run.storage.refuseSetsMatching(/spent/);
    const scene = live(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    answer(run.sent.calls[0], 200, completion('The scene.', 3));
    assert.equal((await scene).cost, 3);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 0);
    assert.equal(run.lines.at(-1).startsWith('The spending could not be saved'), true);
    const held = failureOf(live(ScribeBoot.Role.Scribe, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 1);
    assert.equal((await held).message, UNRECORDED);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 0);
    run.storage.allow();
    const written = failureOf(live(ScribeBoot.Role.Scribe, SYSTEM, USER));
    await settle();
    assert.equal((await written).message, "The day's budget is spent");
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 3);
    const again = failureOf(live(ScribeBoot.Role.Scribe, SYSTEM, USER));
    await settle();
    assert.equal((await again).message, "The day's budget is spent");
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 3);
    assert.equal(run.sent.calls.length, 1);
    run.boot.stop();
});

test('a request that is given up is ended', async () => {
    const run = harness();
    run.sent = requests({ timers: run.timers });
    run.environment.xmlHttpRequest = run.sent.xmlHttpRequest;
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const scene = run.world.lives[0].options.ask(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 1);
    assert.equal(run.sent.calls[0].details.timeout, ScribeBoot.Settings.TimeoutMs.Scribe - 5000);
    await pass(run, 174999);
    assert.equal(run.sent.calls[0].ended, false);
    await pass(run, 1);
    assert.equal(run.sent.calls[0].ended, true);
    assert.equal(run.sent.calls.length, 1);
    await pass(run, 2000);
    assert.equal(run.sent.calls.length, 2);
    assert.throws(() => answer(run.sent.calls[0], 200, completion('A late answer.', 0.5)));
    answer(run.sent.calls[1], 200, completion('The scene.', 0.01));
    assert.equal((await scene).cost, 0.01);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 0.01);
    assert.equal(run.sent.most, 1);
    run.boot.stop();
    const deaf = harness();
    deaf.sent = requests({ aborting: false });
    deaf.environment.xmlHttpRequest = deaf.sent.xmlHttpRequest;
    start(deaf);
    await settle();
    ScribeStore.setKey(deaf.storage, KEY);
    const waited = deaf.world.lives[0].options.ask(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    await pass(deaf, 182000);
    assert.equal(deaf.sent.calls[0].handle.aborts, 1);
    assert.equal(deaf.sent.calls.length, 1);
    deaf.sent.calls[0].ended = true;
    deaf.sent.calls[0].details.onerror({ status: 0 });
    await settle();
    assert.equal(deaf.sent.calls.length, 2);
    assert.equal(deaf.sent.most, 1);
    answer(deaf.sent.calls[1], 200, completion('The scene at last.', 0.01));
    assert.equal((await waited).text, 'The scene at last.');
    deaf.boot.stop();
});

test('nothing is looked up outside the details', async () => {
    const made = requests();
    const fetch = ScribeBoot.request(made.xmlHttpRequest);
    const going = fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: '{}', timeout: 175000 });
    const details = made.calls[0].details;
    assert.equal(Object.getPrototypeOf(details), null);
    assert.equal(Object.getPrototypeOf(details.headers), null);
    for (const name of ['anonymous', 'timeout', 'redirect', 'responseType', 'method', 'url', 'headers', 'data']) {
        assert.equal(Object.hasOwn(details, name), true, name);
    }
    assert.equal(details.redirect, 'error');
    assert.equal(details.timeout, 175000);
    assert.equal(details.anonymous, true);
    assert.equal(Object.hasOwn(details.headers, 'Authorization'), true);
    answer(made.calls[0], 200, '{}');
    assert.equal((await going).status, 200);
});

test('say does not read the key', async () => {
    const run = harness();
    let keyReads = 0;
    const storage = run.storage;
    run.environment.storage = {
        /**
         * @param {string} name
         * @param {*} fallback
         * @return {*}
         */
        get: (name, fallback) => {
            const value = storage.get(name, fallback);
            if (value === KEY) {
                keyReads++;
            }
            return value;
        },
        set: (name, value) => storage.set(name, value),
        remove: (name) => storage.remove(name),
        list: () => storage.list(),
    };
    ScribeStore.setKey(storage, KEY);
    start(run);
    await settle();
    await run.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: TOKEN } });
    await pass(run, 1000);
    const renewed = 'Bearer RENEWEDRENEWEDRENEWED';
    await run.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: renewed } });
    await pass(run, 1000);
    const strings = vm.runInContext('String.prototype', context);
    const replaceAll = strings.replaceAll;
    const received = [];
    strings.replaceAll = function (...values) {
        received.push(...values.filter((value) => typeof value === 'string'));
        return replaceAll.apply(this, values);
    };
    try {
        run.world.tickFailure = `The newest page failed for ${BARE} after ${TOKEN} and ${renewed}`;
        await pass(run, 20000);
    } finally {
        strings.replaceAll = replaceAll;
    }
    assert.equal(run.world.keepers[0].ticks.length, 1);
    assert.equal(keyReads, 0);
    assert.equal(received.length > 0, true);
    assert.equal(received.some((value) => value.includes(KEY)), false);
    assert.equal(run.lines.at(-1), 'The check failed: The newest page failed for [hidden] after [hidden] and [hidden]');
    run.boot.stop();
});

test('a hidden tab keeps its chat', async () => {
    const locks = new FakeLocks();
    const run = harness({ locks });
    start(run);
    await settle();
    const keeper = run.world.keepers[0];
    assert.equal(keeper.options.claim(), true);
    keeper.phase = 'Reading';
    await show(run, 'hidden');
    for (let minute = 0; minute < 10; minute++) {
        await traffic(run);
        await pass(run, 60000);
        if (minute === 0) {
            keeper.phase = 'Idle';
            keeper.options.notify({ kind: 'Changed' });
            await settle();
            assert.equal(keeper.options.claim(), true);
        }
        assert.equal(locks.held(LOCK), true, `minute ${minute}`);
    }
    assert.equal(keeper.options.claim(), true);
    assert.equal(keeper.ticks.length > 40, true, `${keeper.ticks.length} ticks`);
    assert.equal(locks.waiting(LOCK), 0);
    assert.deepEqual(locks.made, [`${LOCK} if available`]);
    run.boot.stop();
});

test('two chats in two tabs both work', async () => {
    const locks = new FakeLocks();
    const one = harness({ locks });
    const two = harness({ locks, path: '/rooms/quay', tabId: 'tab-two', timers: one.timers, storage: one.storage, world: one.world });
    start(one);
    await settle();
    await show(one, 'hidden');
    start(two);
    await settle();
    const [first, second] = one.world.keepers;
    assert.equal(first.roomId, 'harbour');
    assert.equal(second.roomId, 'quay');
    assert.equal(first.options.claim(), true);
    assert.equal(second.options.claim(), true);
    locks.request('scribe:reader:quay', () => null);
    await settle();
    assert.equal(locks.waiting('scribe:reader:quay'), 1);
    await pass(one, 60000);
    assert.equal(first.options.claim(), true);
    assert.equal(second.options.claim(), true);
    assert.equal(locks.held(LOCK), true);
    assert.deepEqual(first.ticks, [20000, 40000, 60000]);
    assert.deepEqual(second.ticks, [20000, 40000, 60000]);
    one.boot.stop();
    two.boot.stop();
});

test('a hidden reader yields to a waiting tab', async () => {
    const locks = new FakeLocks();
    const one = harness({ locks });
    const two = harness({ locks, tabId: 'tab-two', timers: one.timers, storage: one.storage, world: one.world });
    start(one);
    await settle();
    start(two);
    await settle();
    const [first, second] = one.world.keepers;
    assert.equal(first.options.claim(), true);
    assert.equal(second.options.claim(), false);
    assert.equal(locks.waiting(LOCK), 1);
    await show(one, 'hidden');
    await settle();
    assert.equal(first.options.claim(), false);
    assert.equal(second.options.claim(), true);
    assert.equal(second.ticks.length, 1);
    assert.equal(locks.waiting(LOCK), 1);
    go(two, '/');
    await pass(one, 1000);
    assert.equal(first.options.claim(), true);
    assert.equal(locks.waiting(LOCK), 0);
    go(two, '/rooms/harbour');
    await pass(one, 1000);
    const third = one.world.keepers[2];
    assert.equal(third.options.tabId, 'tab-two');
    assert.equal(third.options.claim(), false);
    assert.equal(locks.waiting(LOCK), 1);
    first.phase = 'Reading';
    await pass(one, 20000);
    assert.equal(first.options.claim(), true);
    assert.equal(third.options.claim(), false);
    first.phase = 'Idle';
    first.options.notify({ kind: 'Changed' });
    await settle();
    assert.equal(first.options.claim(), false);
    assert.equal(third.options.claim(), true);
    assert.equal(locks.waiting(LOCK), 1);
    one.boot.stop();
    two.boot.stop();
});

test('a visible reader never yields', async () => {
    const locks = new FakeLocks();
    const one = harness({ locks });
    const two = harness({ locks, tabId: 'tab-two', timers: one.timers, storage: one.storage, world: one.world });
    start(one);
    await settle();
    start(two);
    await settle();
    const [first, second] = one.world.keepers;
    await traffic(two);
    await pass(one, 60000);
    assert.equal(first.options.claim(), true);
    assert.equal(second.options.claim(), false);
    assert.equal(locks.waiting(LOCK), 1);
    assert.deepEqual(first.ticks, [20000, 40000, 60000]);
    one.boot.stop();
    two.boot.stop();
});

test('no guess when the manager cannot say', async () => {
    const managers = [
        ['without query', (locks) => ({ request: (...values) => locks.request(...values) })],
        ['query rejects', (locks) => ({ request: (...values) => locks.request(...values), query: () => Promise.reject(new Error('No answer')) })],
        ['query throws', (locks) => ({ request: (...values) => locks.request(...values), query: () => {
            throw new Error('No answer at all');
        } })],
    ];
    for (const [label, wrap] of managers) {
        const locks = new FakeLocks();
        const manager = wrap(locks);
        const one = harness({ locks: manager });
        const two = harness({ locks: manager, tabId: 'tab-two', timers: one.timers, storage: one.storage, world: one.world });
        start(one);
        await settle();
        start(two);
        await settle();
        const [first, second] = one.world.keepers;
        assert.equal(first.options.claim(), true, label);
        assert.equal(locks.waiting(LOCK), 1, label);
        await show(one, 'hidden');
        await pass(one, 40000);
        assert.equal(first.options.claim(), true, label);
        assert.equal(second.options.claim(), false, label);
        assert.equal(locks.held(LOCK), true, label);
        one.boot.stop();
        two.boot.stop();
    }
});

test('a failing lock manager falls back', async () => {
    const managers = [
        ['throws', { request: () => {
            throw new Error('No locks here');
        } }, 0],
        ['never answers', { request: () => new Promise(() => {}) }, 2000],
        ['rejects', { request: () => Promise.reject(new Error('The locks refused')) }, 0],
    ];
    for (const [label, locks, wait] of managers) {
        const run = harness({ locks });
        start(run);
        await settle();
        if (wait > 0) {
            await pass(run, wait - 1);
            assert.deepEqual(run.world.order, [], label);
            await pass(run, 1);
        }
        assert.deepEqual(run.world.order, BUILT, label);
        assert.equal('claim' in run.world.keepers[0].options, false, label);
        assert.equal(run.lines.length, 1, label);
        assert.equal(run.lines[0].startsWith('The browser lock could not be used'), true, label);
        await pass(run, 30000);
        assert.equal(run.lines.length, 1, label);
        assert.equal(run.world.keepers.length, 1, label);
        run.boot.stop();
    }
});

test('a waiting lock request is withdrawn', async () => {
    const locks = new FakeLocks();
    locks.request(LOCK, () => new Promise(() => {}));
    await settle();
    const run = harness({ locks });
    start(run);
    await settle();
    assert.equal(locks.waiting(LOCK), 1);
    for (let round = 0; round < 6; round++) {
        go(run, '/');
        await pass(run, 1000);
        assert.equal(locks.waiting(LOCK), 0, `round ${round}`);
        go(run, '/rooms/harbour');
        await pass(run, 1000);
        assert.equal(locks.waiting(LOCK), 1, `round ${round}`);
    }
    go(run, '/');
    await pass(run, 1000);
    assert.equal(locks.waiting(LOCK), 0);
    assert.equal(run.world.keepers.length, 7);
    assert.deepEqual(run.lines, []);
    run.boot.stop();
});

test('only this chat\'s traffic asks for ticks', async () => {
    const run = harness();
    start(run);
    await settle();
    const keeper = run.world.keepers[0];
    for (let count = 0; count < 30; count++) {
        await traffic(run, `${API}/v1/users/me/presence`);
        await pass(run, 2000);
    }
    assert.deepEqual(keeper.ticks, [20000, 40000, 60000]);
    await pass(run, 4000);
    await traffic(run);
    await pass(run, 20000);
    assert.deepEqual(keeper.ticks.slice(3), [64000, 69000, 79000, 82000]);
    await traffic(run, `${API}/v1/rooms/quay/messages`);
    await pass(run, 20000);
    assert.deepEqual(keeper.ticks.slice(7), [100000]);
    await traffic(run, `${API}/v1/rooms/harbourside/messages`);
    await pass(run, 20000);
    assert.deepEqual(keeper.ticks.slice(7), [100000, 120000]);
    run.boot.stop();
});

test('one boot per page', async () => {
    const run = harness();
    const first = start(run);
    await settle();
    assert.deepEqual(run.world.order, BUILT);
    const second = ScribeBoot.start(run.environment);
    await pass(run, 3000);
    assert.equal(run.world.keepers.length, 1);
    assert.deepEqual(run.lines, ['The scribe is already running on this page']);
    assert.equal(run.page.listeners.length, 3);
    second.stop();
    assert.equal(run.page.fetch === run.original, false);
    assert.equal(run.world.order.length, 4);
    assert.equal(run.document.documentElement.hasAttribute('data-zeta-scribe'), true);
    first.stop();
    assert.equal(run.document.documentElement.hasAttribute('data-zeta-scribe'), false);
    const third = ScribeBoot.start(run.environment);
    await settle();
    assert.equal(run.world.keepers.length, 2);
    assert.equal(run.page.fetch === run.original, false);
    third.stop();
    assert.equal(run.page.fetch === run.original, true);
});

test('a closed session\'s waits end', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const pending = failureOf(run.world.keepers[0].options.ask(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    await settle();
    answer(run.sent.calls[0], 503, 'Unavailable');
    await settle();
    assert.equal(run.timers.delays.includes(2000), true);
    await run.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: TOKEN } });
    run.page.answer = () => new Promise(() => {});
    const walk = failureOf(run.world.keepers[0].options.zeta.history(() => null));
    await settle();
    go(run, '/');
    await pass(run, 1000);
    assert.equal(await stateOf(pending), 'settled');
    assert.equal(await stateOf(walk), 'settled');
    assert.equal((await pending).message, 'The chat has been left');
    assert.equal((await walk).message, 'Could not pause between requests');
    assert.equal(run.sent.calls.length, 1);
    run.boot.stop();
});

test('each part is closed on its own', async () => {
    const locks = new FakeLocks();
    const run = harness({ locks });
    start(run);
    await settle();
    assert.equal(locks.held(LOCK), true);
    run.world.detachFailure = 'The send hook would not let go';
    go(run, '/');
    await pass(run, 1000);
    assert.deepEqual(run.world.order.slice(4), ['detach harbour', 'unmount harbour', 'live close harbour', 'keeper close harbour']);
    assert.equal(locks.held(LOCK), false);
    assert.deepEqual(run.lines, ['A part of the scribe could not be closed: The send hook would not let go']);
    run.boot.stop();
});

test('the model timeout is the setting', async () => {
    assert.equal(ScribeBoot.Settings.TimeoutMs.Analyzer, 600000);
    assert.equal(ScribeBoot.Settings.TimeoutMs.Scribe, 180000);
    assert.equal(ScribeBoot.Settings.TimeoutMs.Pedant, 180000);
    assert.equal(ScribeBoot.Settings.TransportMarginMs, 5000);
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const pending = failureOf(run.world.keepers[0].options.ask(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 1);
    assert.equal(run.sent.calls[0].details.timeout, 595000);
    assert.equal(run.timers.delays.includes(600000), true);
    run.boot.stop();
    assert.equal(await stateOf(pending), 'settled');
    assert.equal((await pending).message, 'The chat has been left');
});

test('nothing is asked while a billed amount is unwritten', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const live = run.world.lives[0].options.ask;
    const keeper = run.world.keepers[0].options.ask;
    run.storage.refuseSetsMatching(/spent/);
    const scene = live(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    answer(run.sent.calls[0], 200, completion('The scene.', 3));
    assert.equal((await scene).cost, 3);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 0);
    const refusedLive = failureOf(live(ScribeBoot.Role.Scribe, SYSTEM, USER));
    const refusedKeeper = failureOf(keeper(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 1);
    assert.equal((await refusedLive).message, UNRECORDED);
    assert.equal((await refusedKeeper).message, UNRECORDED);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 0);
    run.storage.allow();
    const stretch = keeper(ScribeBoot.Role.Analyzer, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 2);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 3);
    answer(run.sent.calls[1], 200, completion('The stretch.', 0.5));
    assert.equal((await stretch).cost, 0.5);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 3);
    run.clock.day = NEXT_DAY;
    run.storage.refuseSetsMatching(/spent/);
    const late = live(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    answer(run.sent.calls[2], 200, completion('Another scene.', 1));
    await late;
    assert.equal(ScribeStore.spent(run.storage, 'harbour', NEXT_DAY), 0);
    run.storage.allow();
    go(run, '/');
    await pass(run, 1000);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', NEXT_DAY), 1);
    run.boot.stop();
});

test('a kept amount outlives the session', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    run.storage.refuseSetsMatching(/spent/);
    const scene = run.world.lives[0].options.ask(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    answer(run.sent.calls[0], 200, completion('The scene.', 3));
    assert.equal((await scene).cost, 3);
    go(run, '/');
    await pass(run, 1000);
    go(run, '/rooms/harbour');
    await pass(run, 1000);
    assert.equal(run.world.keepers.length, 2);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 0);
    const live = run.world.lives[1].options.ask;
    const keeper = run.world.keepers[1].options.ask;
    const refusedLive = failureOf(live(ScribeBoot.Role.Scribe, SYSTEM, USER));
    const refusedKeeper = failureOf(keeper(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 1);
    assert.equal((await refusedLive).message, UNRECORDED);
    assert.equal((await refusedKeeper).message, UNRECORDED);
    run.storage.allow();
    const stretch = keeper(ScribeBoot.Role.Analyzer, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 2);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 3);
    answer(run.sent.calls[1], 200, completion('The stretch.', 0.5));
    assert.equal((await stretch).cost, 0.5);
    const again = keeper(ScribeBoot.Role.Analyzer, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 3);
    answer(run.sent.calls[2], 200, completion('Another stretch.', 0.5));
    await again;
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 3);
    run.boot.stop();
});

test('a spending write that landed is not kept', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const live = run.world.lives[0].options.ask;
    run.storage.throwAfterSetsMatching(/spent/);
    const first = live(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    answer(run.sent.calls[0], 200, completion('A scene.', 1));
    await first;
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 1);
    assert.deepEqual(run.lines, []);
    run.storage.allow();
    const second = live(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 2);
    answer(run.sent.calls[1], 200, completion('Another scene.', 0.001));
    await second;
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 1 + 0.001);
    run.boot.stop();
});

test('the boot ends what the transport does not', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const scene = run.world.lives[0].options.ask(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 1);
    await pass(run, 174999);
    assert.equal(run.sent.calls[0].handle.aborts, 0);
    await pass(run, 1);
    assert.equal(run.sent.calls[0].handle.aborts, 1);
    assert.equal(run.sent.calls[0].ended, true);
    await pass(run, 2000);
    assert.equal(run.sent.calls.length, 2);
    answer(run.sent.calls[1], 200, completion('The scene.', 0.01));
    assert.equal((await scene).text, 'The scene.');
    assert.equal(run.sent.calls[1].handle.aborts, 0);
    run.boot.stop();
    const stuck = harness();
    stuck.sent = requests({ aborting: false });
    stuck.environment.xmlHttpRequest = stuck.sent.xmlHttpRequest;
    start(stuck);
    await settle();
    ScribeStore.setKey(stuck.storage, KEY);
    const given = failureOf(stuck.world.lives[0].options.ask(ScribeBoot.Role.Scribe, SYSTEM, USER));
    await settle();
    await pass(stuck, 546000);
    assert.equal(await stateOf(given), 'settled');
    assert.equal((await given).message.startsWith('no answer within 180 seconds'), true);
    assert.equal(stuck.sent.calls.length, 1);
    stuck.sent.calls[0].ended = true;
    stuck.sent.calls[0].details.onerror({ status: 0 });
    await pass(stuck, 10000);
    assert.equal(stuck.sent.calls.length, 1);
    stuck.boot.stop();
});

test('a lock granted late is given back', async () => {
    const locks = new FakeLocks();
    const run = harness();
    run.environment.locks = {
        /**
         * @param {string} name
         * @param {...*} rest
         * @return {Promise<*>}
         */
        request: (name, ...rest) =>
            new Promise((resolve) => {
                run.timers.setTimeout(() => resolve(locks.request(name, ...rest)), 3000);
            }),
    };
    start(run);
    await pass(run, 2000);
    assert.deepEqual(run.world.order, BUILT);
    assert.equal('claim' in run.world.keepers[0].options, false);
    assert.equal(run.lines.length, 1);
    await pass(run, 1000);
    assert.deepEqual(locks.made, [`${LOCK} if available`]);
    assert.equal(locks.held(LOCK), false);
    const taken = await locks.request(LOCK, { ifAvailable: true }, (lock) => lock !== null);
    assert.equal(taken, true);
    run.boot.stop();
});

test('a failing waiting request backs off', async () => {
    const locks = new FakeLocks();
    const run = harness();
    const signalled = [];
    run.environment.locks = {
        /**
         * @param {string} name
         * @param {...*} rest
         * @return {Promise<*>}
         */
        request: (name, ...rest) => {
            if (rest.length > 1 && rest[0].signal !== undefined) {
                signalled.push(run.timers.now() - START);
                throw new Error('The signal was refused');
            }
            return locks.request(name, ...rest);
        },
    };
    locks.request(LOCK, () => new Promise(() => {}));
    await settle();
    start(run);
    await settle();
    assert.equal(run.world.keepers[0].options.claim(), false);
    await pass(run, 60000);
    assert.equal(signalled.length >= 6 && signalled.length <= 7, true, `${signalled.length} requests`);
    for (let index = 1; index < signalled.length; index++) {
        assert.equal(signalled[index] - signalled[index - 1] >= 10000, true, `request ${index}`);
    }
    assert.equal(run.lines.length, 1);
    assert.equal(run.lines[0].startsWith('The reader lock failed: '), true);
    run.boot.stop();
});

test('an answer billed after the ask settled is still counted', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const scene = failureOf(run.world.lives[0].options.ask(ScribeBoot.Role.Scribe, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 1);
    go(run, '/');
    await pass(run, 1000);
    assert.equal(await stateOf(scene), 'settled');
    assert.equal((await scene).message, 'The chat has been left');
    answer(run.sent.calls[0], 200, completion('A scene for nobody.', 0.3));
    await settle();
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 0.3);
    run.boot.stop();
});

test('a tab opened hidden starts at once', async () => {
    const locks = new FakeLocks();
    const run = harness({ locks });
    run.document.visibilityState = 'hidden';
    start(run);
    await settle();
    assert.deepEqual(run.world.order, BUILT);
    assert.deepEqual(locks.made, [`${LOCK} if available`]);
    assert.equal(run.world.keepers[0].claimed, true);
    assert.equal(run.world.keepers[0].options.claim(), true);
    await pass(run, 20000);
    assert.equal(run.world.keepers[0].ticks.length, 1);
    run.boot.stop();
});

test('the reading role may answer at length', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const keeper = run.world.keepers[0].options.ask;
    const live = run.world.lives[0].options.ask;
    const expected = [
        [keeper, ScribeBoot.Role.Analyzer, 40000],
        [live, ScribeBoot.Role.Scribe, 700],
        [live, ScribeBoot.Role.Pedant, 1500],
    ];
    for (const [ask, role, tokens] of expected) {
        const asking = ask(role, SYSTEM, USER);
        await settle();
        const call = run.sent.calls.at(-1);
        assert.equal(JSON.parse(call.details.data).max_tokens, tokens, role);
        answer(call, 200, completion(`The ${role} answer.`, 0.01));
        assert.equal((await asking).text, `The ${role} answer.`);
    }
    assert.equal(run.sent.calls.length, 3);
    run.boot.stop();
});

test('each role has its own timeout', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const keeper = run.world.keepers[0].options.ask;
    const live = run.world.lives[0].options.ask;
    const reading = keeper(ScribeBoot.Role.Analyzer, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 1);
    assert.equal(run.sent.calls[0].details.timeout, 595000);
    assert.equal(run.timers.delays.includes(600000), true);
    assert.equal(run.timers.delays.includes(595000), true);
    await pass(run, 300000);
    assert.equal(await stateOf(reading), 'pending');
    assert.equal(run.sent.calls[0].handle.aborts, 0);
    answer(run.sent.calls[0], 200, completion('A long reading.', 0.2));
    assert.equal(await stateOf(reading), 'settled');
    assert.equal((await reading).text, 'A long reading.');
    assert.equal(run.sent.calls.length, 1);
    const unanswered = failureOf(keeper(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 2);
    await pass(run, 594999);
    assert.equal(run.sent.calls[1].handle.aborts, 0);
    await pass(run, 1);
    assert.equal(run.sent.calls[1].handle.aborts, 1);
    assert.equal(run.sent.calls[1].ended, true);
    for (const role of [ScribeBoot.Role.Scribe, ScribeBoot.Role.Pedant]) {
        const asking = live(role, SYSTEM, USER);
        await settle();
        const call = run.sent.calls.at(-1);
        assert.equal(call.details.timeout, 175000, role);
        assert.equal(run.timers.delays.includes(180000), true, role);
        assert.equal(run.timers.delays.includes(175000), true, role);
        answer(call, 200, completion(`The ${role} answer.`, 0.01));
        assert.equal((await asking).text, `The ${role} answer.`);
    }
    run.boot.stop();
    assert.equal(await stateOf(unanswered), 'settled');
    assert.equal((await unanswered).message, 'The chat has been left');
});

test('the day is the local date', () => {
    assert.equal(ScribeBoot.day(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(ScribeBoot.day(new Date(2026, 10, 15, 0, 1)), '2026-11-15');
    assert.equal(ScribeBoot.day(new Date(2026, 11, 31, 12, 0)), '2026-12-31');
});
