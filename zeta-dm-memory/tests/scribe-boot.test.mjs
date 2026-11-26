import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import FakeEvent from './support/FakeEvent.mjs';
import FakeLocks from './support/FakeLocks.mjs';
import FakeSendDocument from './support/FakeSendDocument.mjs';
import FakeSendWindow from './support/FakeSendWindow.mjs';
import FakeStorage from './support/FakeStorage.mjs';
import FakeTextArea from './support/FakeTextArea.mjs';
import FakeTimers from './support/FakeTimers.mjs';
import FakeZeta from './support/FakeZeta.mjs';
import PanelDocument from './support/PanelDocument.mjs';

const context = vm.createContext({ URL, URLSearchParams, TextEncoder });

/**
 * @return {Object<string, object>}
 */
function load() {
    const loaded = {};
    const files = [
        ['core', 'ScribeText'],
        ['core', 'ScribeGateway'],
        ['core', 'ScribeAdoption'],
        ['page', 'ZetaSource'],
        ['page', 'PanelStyle'],
        ['page', 'ScribeStore'],
        ['page', 'ScribeFrame'],
        ['page', 'ScribeSetup'],
        ['page', 'ScribePlotExport'],
        ['page', 'ScribeBoot'],
    ];
    for (const [folder, name] of files) {
        const url = new URL(`../scribe/${folder}/${name}.js`, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
        loaded[name] = vm.runInContext(name, context);
    }
    return loaded;
}

const { ScribeStore, ScribeFrame, ScribeSetup, ScribePlotExport, ScribeBoot } = load();

test('fork sources look up the selected Worker room even with a local Book and never request origin chat history', async () => {
    const isolated = vm.createContext({TextEncoder, URL, URLSearchParams});
    for (const file of ['core/ScribeText', 'core/ScribeLog', 'page/ZetaSource', 'page/ScribeStore', 'page/ScribeKeeper', 'page/ScribeBoot']) {
        const url = new URL('../scribe/' + file + '.js', import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), isolated, {filename: url.pathname});
    }
    const {boot, log} = vm.runInContext('({boot: ScribeBoot, log: ScribeLog})', isolated);
    for (const scenario of ['found', 'missing', 'unavailable', 'damaged campaign']) {
        const storage = new FakeStorage();
        const rows = FakeZeta.messages(3).map((row) => ({...row, roomId: FakeZeta.Room}));
        const book = {adopted: true, fingerprints: {}, log: log.create()};
        ScribeStore.write(storage, FakeZeta.Room, 'book', {...book, localOnly: true});
        ScribeStore.write(storage, FakeZeta.Room, 'campaign', {completeHistory: true, messages: rows.slice(0, 2)});
        if (scenario === 'damaged campaign') {
            storage.set(ScribeStore.name('head', ScribeStore.room(FakeZeta.Room), 'campaign'), 'damaged');
        }
        const initial = [...storage.values];
        let cloudReads = 0;
        const site = new FakeZeta(rows);
        const session = {boot: {environment: {storage}}, cloud: {forkBook: async (room) => {
            cloudReads++;
            assert.equal(room, FakeZeta.Room);
            if (scenario === 'unavailable') {
                throw new Error('Worker unavailable');
            }
            return scenario === 'missing' ? null : book;
        }}};
        const request = {fetch: site.fetch, roomId: 'child', token: FakeZeta.Token, signal: new AbortController().signal,
            pause: () => new Promise(() => {})};
        const lookup = boot.forkSource(session, FakeZeta.Room, request);
        if (scenario === 'unavailable') {
            await assert.rejects(lookup, /Worker unavailable/);
        } else if (scenario === 'missing') {
            assert.equal(await lookup, null);
        } else {
            const result = await lookup;
            assert.equal(result.book, book);
            assert.equal(result.worker, true);
        }
        assert.equal(site.requests.length, 0, scenario);
        assert.equal(cloudReads, 1, scenario);
        assert.deepEqual([...storage.values], initial, scenario);
    }
});

/**
 * @return {object}
 */
function realSender() {
    const separate = vm.createContext({ TextEncoder });
    for (const path of ['../scribe/core/ScribeText.js', '../scribe/page/ScribeSender.js']) {
        const url = new URL(path, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), separate, { filename: url.pathname });
    }
    return vm.runInContext('ScribeSender', separate);
}

const RealSender = realSender();

/**
 * @return {object}
 */
function realCloud() {
    const separate = vm.createContext({ TextEncoder, URL, URLSearchParams });
    for (const path of ['../scribe/page/ScribeStore.js', '../scribe/page/ScribeCloud.js']) {
        const url = new URL(path, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), separate, { filename: url.pathname });
    }
    return vm.runInContext('ScribeCloud', separate);
}

const RealCloud = realCloud();
const START_SOURCE = readFileSync(new URL('../scribe/page/ScribeStart.js', import.meta.url), 'utf8');
const ZETA = 'https://zeta-ai.io';
const PINGPONG = 'https://frame.pingpong.ai';
const CHAT_SRC = 'https://frame.pingpong.ai/v1/index.html#run=1';
const NATIVE = Object.getOwnPropertyDescriptor(FakeTextArea.prototype, 'value');
const BRIDGE = 'bridge-token-test-0123456789';
const OTHER = 'other-tab-token-9876543210';
const TOKEN_NAME = 'scribe-bridge';
const APPENDED = '\n@: [Scribe] Day 1, the mill.';

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
    pedant: 'mistralai/mistral-large-4-0',
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
 * @return {Array<string|boolean>}
 */
function asked(call) {
    const body = JSON.parse(call.details.data);
    return [body.model, Object.hasOwn(body, 'max_tokens')];
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
        appended: null,
        offerAtOpen: null,
        clouds: [],
        notes: null,
        rawNotes: null,
        notesChecked: false,
        leads: true,
        booked: true,
        setupResult: null,
        setupHold: null,
        setupFailure: null,
        setupRecord: null,
        liveSetupView: null,
    };
    context.ScribeCloud = {
        Settings: RealCloud.Settings,

        /**
         * @param {*} value
         * @return {boolean}
         */
        validKey: (value) => RealCloud.validKey(value),

        /**
         * @param {object} options
         * @return {object}
         */
        open(options) {
            const record = { roomId: options.roomId, options, keepersAtOpen: world.keepers.length, ticks: [], stirs: 0, closes: 0, handle: null };
            world.clouds.push(record);
            record.handle = {
                /**
                 * @return {object}
                 */
                view: () => ({ phase: 'Off', keyed: false, conflict: null, notes: null, unsent: 0, problem: null }),

                /**
                 * @return {Promise<void>}
                 */
                tick: () => {
                    const keeper = world.keepers.find((entry) => entry.roomId === record.roomId && entry.options.lease !== undefined);
                    record.ticks.push(keeper === undefined ? null : keeper.ticks.length);
                    return Promise.resolve();
                },

                /**
                 * @return {Promise<void>}
                 */
                stir: () => {
                    record.stirs++;
                    return Promise.resolve();
                },

                /**
                 * @return {boolean}
                 */
                leads: () => world.leads,

                /**
                 * @return {string|null}
                 */
                notes: () => world.notes,

                /**
                 * @return {string|null}
                 */
                rawNotes: () => world.rawNotes,

                /**
                 * @return {boolean}
                 */
                notesChecked: () => world.notesChecked,

                /**
                 * @return {void}
                 */
                close: () => {
                    record.closes++;
                },
            };
            return record.handle;
        },
    };
    context.ScribeKeeper = {
        Busy: { Reading: 'Reading' },
        Defaults: DEFAULTS,
        Event: Object.freeze({ Changed: 'Changed', Progress: 'Progress', Reply: 'Reply' }),
        Phase: Object.freeze({ Idle: 'Idle', Reading: 'Reading', Watching: 'Watching' }),

        /**
         * @param {object} options
         * @return {Promise<object>}
         */
        open(options) {
            const record = { roomId: options.roomId, options, ticks: [], observations: [], closes: 0, claimed: null, finish: null, handle: null, phase: 'Idle', booked: world.booked };
            record.claimed = typeof options.claim === 'function' ? options.claim() : null;
            world.order.push(`keeper ${options.roomId}`);
            world.keepers.push(record);
            record.reader = record.claimed ?? ScribeStore.claim(options.storage, options.roomId, options.tabId, options.clock.now());
            record.handle = {
                /**
                 * @return {{ phase: string, reader: boolean }}
                 */
                view: () => ({ phase: record.phase, reader: record.reader, booked: record.booked, stop: record.stop }),
                pause: () => {
                    record.stop = { reason: 'Paused' };
                    options.pauseCalls();
                },
                releaseReader: () => {
                    if (record.reader) {
                        record.reader = false;
                        options.zeta.abort();
                        options.pauseCalls('Another tab is reading this chat.');
                    }
                },
                rekey: () => { record.rekeys = (record.rekeys ?? 0) + 1; },
                /**
                 * @param {object} page
                 * @return {boolean}
                 */
                observe: (page) => {
                    if (!record.reader || record.refuseObservation) {
                        return false;
                    }
                    record.observations.push(page);
                    return true;
                },

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
            const record = {
                roomId: options.roomId,
                options,
                replies: [],
                closes: 0,
                outgoing: [],
                sent: [],
                live: null,
                ready: world.offerAtOpen,
                suggestion: null,
                reminder: null,
                attempt: null,
                afterView: null,
                reads: [],
                went: [],
                wentLines: [],
                starting: [],
                cancelled: [],
                uncertain: [],
                setups: 0,
                ensureCasts: 0,
            };
            world.order.push(`live ${options.roomId}`);
            world.lives.push(record);
            const live = {
                keyWork: () => () => true,
                rekey: () => { record.rekeys = (record.rekeys ?? 0) + 1; },
                /**
                 * @return {Promise<object|null>}
                 */
                setup: () => {
                    record.setups++;
                    if (world.setupHold !== null) {
                        return world.setupHold;
                    }
                    if (world.setupFailure !== null) {
                        return Promise.reject(world.setupFailure);
                    }
                    return Promise.resolve(world.setupResult);
                },
                /**
                 * @return {{ story: object|null, profile: object|null, notes: string|null }}
                 */
                setupRecord: () => world.setupRecord ?? { story: null, profile: null, notes: null },
                /**
                 * @return {void}
                 */
                ensureCast: () => {
                    record.ensureCasts++;
                },

                /**
                 * @return {{ ready: string|null }}
                 */
                view: () => {
                    record.reads.push('view');
                    if (record.afterView !== null) {
                        record.ready = record.afterView;
                        record.afterView = null;
                    }
                    return { ready: record.ready, ...(world.liveSetupView !== null ? { setup: world.liveSetupView } : {}) };
                },

                /**
                 * @return {{ ready: string|null, suggestion: string|null, ends: number[] }}
                 */
                lines: () => {
                    record.reads.push('lines');
                    return {
                        ready: record.ready,
                        manual: record.manual === true,
                        suggestion: record.suggestion,
                        ends: [],
                        reminder: record.reminder,
                        attempt: record.attempt,
                    };
                },

                /**
                 * @param {{ ready: string|null, suggestion: string|null }} lines
                 * @return {void}
                 */
                went: (lines) => {
                    record.went.push(`${lines.ready} | ${lines.suggestion}`);
                    record.wentLines.push(lines);
                },
                /**
                 * @param {object} lines
                 * @return {boolean}
                 */
                starting: (lines) => {
                    record.starting.push(lines);
                    return true;
                },
                posting: () => ({ key: 'current attempt' }),
                outstanding: (key) => record.uncertain.find((lines) => lines.key === key &&
                    !record.wentLines.includes(lines) && !record.cancelled.includes(lines)) ?? null,
                uncertain: (lines) => { record.uncertain.push(lines); },
                /**
                 * @param {object} lines
                 * @return {void}
                 */
                cancelled: (lines) => {
                    record.cancelled.push(lines);
                },
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
                    return world.appended === null ? 'the outgoing words' : `${values[0]}${world.appended}`;
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
                keyChanged: () => {
                    record.keyChanges = (record.keyChanges ?? 0) + 1;
                    record.onKeyChange?.();
                },
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
        paragraph: RealSender.paragraph,
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
    document.frames = [];
    document.searches = 0;
    /**
     * @param {string} selector
     * @return {object[]}
     * @throws {Error}
     */
    document.querySelectorAll = (selector) => {
        if (selector !== 'iframe') {
            throw new Error(`The fake document cannot answer ${selector}`);
        }
        document.searches++;
        return [...document.frames];
    };
    return document;
}

/**
 * @param {object} run
 * @param {{ src?: string, width?: number, height?: number }} choices
 * @return {{ element: object, window: { posted: object[], failing: number, postMessage: Function }, box: { width: number, height: number } }}
 */
function frameIn(run, choices = {}) {
    const target = {
        posted: [],
        failing: 0,
        /**
         * @param {object} message
         * @param {string} origin
         * @return {void}
         * @throws {Error}
         */
        postMessage: (message, origin) => {
            if (target.failing > 0) {
                target.failing--;
                throw new Error(`The object could not be cloned: ${message.token}`);
            }
            target.observationToken = message.observationToken;
            target.posted.push({
                kind: message.kind,
                seq: message.seq,
                token: message.token,
                ready: message.ready,
                suggestion: message.suggestion,
                tag: message.zetaScribe,
                origin,
            });
        },
    };
    const box = { width: choices.width ?? 800, height: choices.height ?? 600 };
    const element = {
        src: choices.src ?? CHAT_SRC,
        contentWindow: target,
        /**
         * @return {{ width: number, height: number }}
         */
        getBoundingClientRect: () => box,
    };
    run.document.frames.push(element);
    return { element, window: target, box };
}

/**
 * @param {object} run
 * @param {{ origin: string, source: *, data: *, isTrusted?: * }} event
 * @return {Promise<void>}
 */
async function deliver(run, event) {
    const isTrusted = Object.hasOwn(event, 'isTrusted') ? event.isTrusted : true;
    for (const entry of run.page.listeners.filter((listening) => listening.type === 'message')) {
        entry.listener({ type: 'message', isTrusted, origin: event.origin, source: event.source, data: event.data });
    }
    await settle();
}

/**
 * @param {*} source
 * @return {{ origin: string, source: *, data: object }}
 */
function readyFrom(source) {
    return { origin: PINGPONG, source, data: { zetaScribe: 1, kind: 'ready' } };
}

/**
 * @param {*} source
 * @param {number} seq
 * @param {boolean} ready
 * @param {boolean} suggestion
 * @return {{ origin: string, source: *, data: object }}
 */
function sentFrom(source, seq, ready, suggestion) {
    return { origin: PINGPONG, source, data: { zetaScribe: 1, kind: 'sent', seq, ready, suggestion } };
}

/**
 * @param {object} run
 * @param {object} live
 * @param {string|null} ready
 * @param {string|null} suggestion
 * @return {Promise<void>}
 */
async function offer(run, live, ready, suggestion = null) {
    live.ready = ready;
    live.suggestion = suggestion;
    live.options.notify();
    await settle();
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
        made: 0,
        menus: [],
        asked: [],
        typed: [],
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
        random: () => {
            run.made++;
            return choices.made ?? BRIDGE;
        },
        locks: choices.locks ?? null,
        confirm: () => true,
        download: () => undefined,
        log: (text) => {
            run.lines.push(text);
        },
        menu: (label, action) => {
            run.menus.push({ label, action });
        },
        prompt: (text) => {
            run.asked.push(`prompt ${text}`);
            return run.typed.length > 0 ? run.typed.shift() : null;
        },
        alert: (text) => {
            run.asked.push(`alert ${text}`);
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
    run.environment.storage = noted(run.storage, ['get', 'set', 'remove', 'list', 'watch'], 'storage', note);
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
        querySelectorAll: document.querySelectorAll,
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
    await zeta.history();
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
    const initial = await plain.world.keepers[0].options.zeta.history();
    assert.equal(initial.messages.length, 1);
    assert.equal(plain.page.fetchCalls.length, 2);
    assert.equal(plain.page.fetchCalls[1].receiver === plain.page, true);
    assert.equal(plain.page.fetchCalls[1].values[1].headers.Authorization, TOKEN);
    plain.boot.stop();
    run.boot.stop();
});

test('the story and the profile are read through the page fetch, a cloned init and the current token', async () => {
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
    const run = harness({ clone });
    run.world.plans.push(HOLD);
    start(run);
    await settle();
    const keeperOptions = run.world.keepers[0].options;
    assert.equal(typeof keeperOptions.setup, 'function');
    assert.equal(await keeperOptions.setup(), null);
    run.world.keepers[0].finish();
    await settle();
    await run.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: TOKEN } });
    const served = new Map([
        [
            '/v1/rooms/harbour',
            {
                id: 'harbour',
                title: 'The harbour',
                plot: {
                    id: 'p 1',
                    name: 'The harbour tale',
                    characters: [{ name: 'Mavan the Gray', description: 'An old wizard.' }, { name: '' }],
                },
            },
        ],
        ['/v1/plots/p%201/rooms/harbour/user-personas/selected', { name: 'Orla', description: 'A sellsword.' }],
    ]);
    /**
     * @param {string} url
     * @return {Promise<object>}
     */
    run.page.answer = (url) => {
        const path = new URL(url).pathname;
        return Promise.resolve(
            served.has(path) ? FakeZeta.reply(200, JSON.stringify(served.get(path))) : FakeZeta.reply(404, 'No'),
        );
    };
    const options = run.world.lives[0].options;
    const before = run.page.fetchCalls.length;
    const story = await options.story();
    assert.equal(story.plotId, 'p 1');
    assert.equal(story.name, 'The harbour tale');
    assert.equal(story.roomTitle, 'The harbour');
    assert.deepEqual(JSON.parse(JSON.stringify(story.characters)), [
        { id: null, name: 'Mavan the Gray', description: 'An old wizard.' },
    ]);
    const storyReads = run.page.fetchCalls.slice(before);
    assert.deepEqual(
        storyReads.map((call) => call.values[0]),
        [`${API}/v1/rooms/harbour`],
    );
    for (const call of storyReads) {
        assert.equal(call.receiver === run.page, true);
        assert.equal(cloned.includes(call.values[1]), true);
        assert.equal(call.values[1].headers.Authorization, TOKEN);
    }
    const renewed = 'Bearer RENEWEDRENEWEDRENEWED';
    await run.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: renewed } });
    const after = run.page.fetchCalls.length;
    assert.deepEqual(JSON.parse(JSON.stringify(await options.profile('p 1'))), {
        source: 'Persona',
        name: 'Orla',
        description: 'A sellsword.',
        text: 'Orla: A sellsword.',
    });
    const profileReads = run.page.fetchCalls.slice(after);
    assert.equal(profileReads.length, 1);
    assert.equal(profileReads[0].values[0], `${API}/v1/plots/p%201/rooms/harbour/user-personas/selected`);
    assert.equal(profileReads[0].receiver === run.page, true);
    assert.equal(cloned.includes(profileReads[0].values[1]), true);
    assert.equal(profileReads[0].values[1].headers.Authorization, renewed);
    await run.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: TOKEN } });
    const again = run.page.fetchCalls.length;
    await options.story();
    const tokens = run.page.fetchCalls.slice(again).map((call) => call.values[1].headers.Authorization);
    assert.deepEqual(tokens, [TOKEN]);
    const unplotted = run.page.fetchCalls.length;
    assert.equal(await options.profile(null), null);
    assert.equal(run.page.fetchCalls.length, unplotted);
    run.world.setupResult = { text: 'BACKGROUND...', storyText: 'Harbour', profileText: 'Orla', shown: 7, whole: 7, source: 'Persona', persona: 'Orla' };
    assert.equal(run.world.lives[0].setups, 0);
    assert.deepEqual(await keeperOptions.setup(), run.world.setupResult);
    assert.equal(run.world.lives[0].setups, 1);
    run.world.notesChecked = true;
    run.world.rawNotes = 'Full raw notes';
    assert.deepEqual(JSON.parse(JSON.stringify(options.rawNotes())), { checked: true, text: 'Full raw notes' });
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

test('queued key notices reread once per value across navigation, sleep, and stop', async () => {
    const run = harness({ locks: new FakeLocks() });
    start(run);
    await settle();
    const storage = run.storage;
    const first = run.world.panels[0];
    const baseline = first.options.keyVersion();
    const watched = (room) => ['scribe:key', 'scribe:observations:' + room,
        ...['draft', 'draft-sent', 'preview', 'generating', 'result'].map((part) => 'scribe:reminder:' + room + ':' + part),
        'scribe:head:' + room + ':live', 'scribe:fork:' + room];
    assert.deepEqual([...storage.listeners.values()].map((entry) => entry.name), watched('harbour'));
    storage.queued = [];
    ScribeStore.setKey(storage, 'test-first');
    ScribeStore.setKey(storage, 'test-second');
    assert.equal(first.options.saveKey('stale-draft', baseline), false);
    assert.equal(ScribeStore.key(storage), 'test-second');
    assert.equal(run.world.keepers[0].rekeys, 1);
    assert.equal(run.world.lives[0].rekeys, 1);
    assert.equal(first.keyChanges, 1);
    for (const deliver of storage.queued.reverse()) {
        deliver();
        deliver();
    }
    assert.equal(first.keyChanges, 1);
    assert.equal(first.options.saveKey('test-second', first.options.keyVersion()), true);
    assert.equal(run.world.keepers[0].rekeys, 2);
    go(run, '/rooms/quay');
    await pass(run, 1000);
    const second = run.world.panels.at(-1);
    assert.deepEqual([...storage.listeners.values()].map((entry) => entry.name), watched('quay'));
    ScribeStore.setKey(storage, 'test-third');
    storage.queued[0]();
    assert.equal(second.keyChanges, 1);
    assert.equal(first.keyChanges, 1);
    ScribeStore.setKey(storage, 'test-fourth');
    run.page.listeners.find((entry) => entry.type === 'pageshow').listener();
    assert.equal(second.keyChanges, 2);
    ScribeStore.setKey(storage, 'test-fifth');
    const asking = run.world.keepers.at(-1).options.ask(ScribeBoot.Role.Analyzer, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 1);
    assert.equal(run.sent.calls[0].details.headers.Authorization, 'Bearer test-fifth');
    answer(run.sent.calls[0], 200, completion('Answer', 0));
    await asking;
    storage.refuseGetsMatching(/^scribe:key$/);
    const error = await failureOf(run.world.keepers.at(-1).options.ask(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    assert.equal(error.source, 'Scribe');
    assert.equal(error.code, ScribeStore.KeyStorageSource);
    assert.equal(error.message, ScribeBoot.Settings.Messages.KeyStorage);
    assert.equal(run.sent.calls.length, 1);
    storage.allow();
    run.boot.stop();
    assert.equal(storage.listeners.size, 0);
    for (const deliver of storage.queued) {
        deliver();
    }
    assert.equal(second.keyChanges, 3);
    start(run);
    await settle();
    assert.equal([...storage.listeners.values()].filter((entry) => entry.name === 'scribe:key').length, 1);
    assert.equal(run.sent.calls.length, 1);
    run.boot.stop();
});

for (const [helper, role] of [['keepers', 'Analyzer'], ['lives', 'Pedant']]) {
    test(helper + ' select the saved key at dispatch and after gateway backoff', async () => {
        const run = harness({ locks: new FakeLocks() });
        ScribeStore.setKey(run.storage, KEY);
        start(run);
        await settle();
        run.storage.queued = [];
        const asking = run.world[helper][0].options.ask(role, SYSTEM, USER);
        ScribeStore.setKey(run.storage, 'queued-test-key');
        await settle();
        assert.deepEqual(run.sent.calls.map((call) => call.details.headers.Authorization), ['Bearer queued-test-key']);
        answer(run.sent.calls[0], 503, '{"error":"busy","usage":{"cost":0.125}}');
        await pass(run, 1999);
        ScribeStore.setKey(run.storage, 'backoff-test-key');
        await pass(run, 1);
        assert.equal(run.sent.calls.length, 2);
        assert.equal(run.sent.calls[1].details.headers.Authorization, 'Bearer backoff-test-key');
        ScribeStore.setKey(run.storage, 'newer-than-valid-result');
        answer(run.sent.calls[1], 200, completion('Keep this result.', 0.25));
        const result = await asking;
        assert.equal(result.text, 'Keep this result.');
        assert.equal(result.stopped, 0);
        assert.equal(result.cost, 0.375);
        assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), helper === 'keepers' ? 0 : 0.375);
        assert.equal(ScribeStore.spent(run.storage, 'quay', DAY), 0);
        run.boot.stop();
    });

    test(helper + ' replace late 401s once per observed rotation and preserve the current masked rejection', async () => {
        const run = harness({ locks: new FakeLocks() });
        ScribeStore.setKey(run.storage, KEY);
        start(run);
        await settle();
        run.storage.queued = [];
        const pending = failureOf(run.world[helper][0].options.ask(role, SYSTEM, USER));
        await settle();
        const keys = [KEY, 'second-synthetic-key', 'final-synthetic-key'];
        for (const [index, key] of keys.entries()) {
            assert.equal(run.sent.calls.length, index + 1);
            assert.equal(run.sent.calls[index].details.headers.Authorization, 'Bearer ' + key);
            ScribeStore.setKey(run.storage, keys[index + 1] ?? key);
            answer(run.sent.calls[index], 401, JSON.stringify({
                error: { message: 'Rejection ' + index + ' ' + keys.slice(0, index + 1).join(', ') },
                usage: { cost: 0.125 },
            }));
            await settle();
        }
        const error = await pending;
        assert.equal(error.status, 401);
        assert.equal(error.source, 'OpenRouter');
        assert.match(error.reason, /^Rejection 2 /);
        assert.equal(carries(error, keys), false);
        for (const deliver of run.storage.queued.reverse()) {
            deliver();
            deliver();
        }
        await pass(run, 20000);
        assert.equal(run.sent.calls.length, 3);
        assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 0.375);
        assert.equal(ScribeStore.spent(run.storage, 'quay', DAY), 0);
        run.boot.stop();
    });

    for (const barrier of ['cleared', 'unreadable', 'paused', 'reader', 'claim', 'lease', 'budget', 'route']) {
        test(helper + ' discard an obsolete 401 when blocked by ' + barrier, async () => {
            const run = harness();
            ScribeStore.setKey(run.storage, KEY);
            start(run);
            await settle();
            const pending = failureOf(run.world[helper][0].options.ask(role, SYSTEM, USER));
            await settle();
            run.storage.queued = [];
            ScribeStore.setKey(run.storage, barrier === 'cleared' ? '' : 'rotated-test-key');
            const keeper = run.world.keepers[0];
            const barriers = {
                cleared: [() => {}, ScribeBoot.Settings.Messages.NoKey],
                unreadable: [() => run.storage.refuseGetsMatching(/^scribe:key$/), ScribeBoot.Settings.Messages.KeyStorage],
                paused: [() => { keeper.stop = { reason: 'Paused' }; }, ScribeBoot.Settings.Messages.Paused],
                reader: [() => { keeper.reader = false; }, ScribeBoot.Settings.Messages.NotReader],
                claim: [() => run.storage.set('scribe:claim:harbour', JSON.stringify({ tabId: 'second-tab', at: run.clock.now() })), ScribeBoot.Settings.Messages.NotReader],
                lease: [() => { run.world.leads = false; }, ScribeBoot.Settings.Messages.NotReader],
                budget: [() => ScribeStore.setOthers(run.storage, 'harbour', DAY, 2.875), ScribeBoot.Settings.Messages.Spent],
                route: [() => go(run, '/rooms/quay'), ScribeBoot.Settings.Messages.Left],
            };
            const [block, reason] = barriers[barrier];
            block();
            answer(run.sent.calls[0], 401, '{"error":"obsolete rejection","usage":{"cost":0.125}}');
            const error = await pending;
            assert.equal(error.message, reason);
            assert.equal(error.source, 'Scribe');
            assert.equal(error.status, undefined);
            assert.equal(run.sent.calls.length, 1);
            assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 0.125);
            assert.equal(ScribeStore.spent(run.storage, 'quay', DAY), 0);
            run.boot.stop();
        });
    }
}

for (const unavailable of ['empty', 'unreadable']) {
    test('queued first dispatches send nothing if the saved key becomes ' + unavailable, async () => {
        const run = harness({ locks: new FakeLocks() });
        ScribeStore.setKey(run.storage, KEY);
        start(run);
        await settle();
        const pending = [run.world.keepers[0], run.world.lives[0]].map((helper) =>
            failureOf(helper.options.ask('Scribe', SYSTEM, USER)));
        run.storage.queued = [];
        if (unavailable === 'empty') {
            ScribeStore.setKey(run.storage, '');
        } else {
            run.storage.refuseGetsMatching(/^scribe:key$/);
        }
        for (const error of await Promise.all(pending)) {
            assert.equal(error.message, unavailable === 'empty' ? ScribeBoot.Settings.Messages.NoKey : ScribeBoot.Settings.Messages.KeyStorage);
            assert.equal(error.source, 'Scribe');
        }
        assert.equal(run.sent.calls.length, 0);
        run.boot.stop();
    });
}

test('a handoff while a gateway retry reconciles its key cancels the outgoing dispatch', async () => {
    const run = harness();
    ScribeStore.setKey(run.storage, KEY);
    start(run);
    await settle();
    const pending = failureOf(run.world.lives[0].options.ask('Pedant', SYSTEM, USER));
    await settle();
    answer(run.sent.calls[0], 503, '{"error":"temporary"}');
    await pass(run, 1999);
    run.storage.queued = [];
    ScribeStore.setKey(run.storage, 'key-before-handoff');
    run.world.panels[0].onKeyChange = () => run.storage.set('scribe:claim:harbour',
        JSON.stringify({ tabId: 'new-reader', at: run.clock.now() }));
    await pass(run, 1);
    assert.equal((await pending).message, ScribeBoot.Settings.Messages.NotReader);
    assert.equal(run.sent.calls.length, 1);
    run.boot.stop();
});

for (const envelope of ['top-level', 'choice', 'message only']) {
    test('a rotated key uses the structured provider code in a ' + envelope + ' error', async () => {
        const run = harness({ locks: new FakeLocks() });
        ScribeStore.setKey(run.storage, KEY);
        start(run);
        await settle();
        const pending = failureOf(run.world.lives[0].options.ask('Pedant', SYSTEM, USER));
        await settle();
        ScribeStore.setKey(run.storage, 'new-test-key');
        const provider = { code: envelope === 'message only' ? 400 : '401', message: 'Provider reference 401' };
        const body = envelope === 'choice' ? { choices: [{ error: provider, finish_reason: 'error' }] } : { error: provider };
        answer(run.sent.calls[0], 200, JSON.stringify(body));
        await settle();
        if (envelope !== 'message only') {
            assert.equal(run.sent.calls.length, 2);
            assert.equal(run.sent.calls[1].details.headers.Authorization, 'Bearer new-test-key');
            answer(run.sent.calls[1], 200, JSON.stringify(body));
        } else {
            assert.equal(run.sent.calls.length, 1);
        }
        const error = await pending;
        assert.equal(error.status, 200);
        assert.equal(error.reason, provider.message);
        assert.equal(error.providerCode, Number(provider.code));
        assert.equal(error.source, 'OpenRouter');
        run.boot.stop();
    });
}

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
    assert.deepEqual(asked(run.sent.calls[0]), [DEFAULTS.analyzer, false]);
    answer(run.sent.calls[0], 200, completion('The plain answer.', 0.25));
    const result = await plain;
    assert.deepEqual(Object.keys(result), ['text', 'cost', 'finish', 'stopped']);
    assert.equal(result.finish, 'stop');
    assert.equal(result.stopped, 0);
    assert.equal(result.text, 'The plain answer.');
    assert.equal(result.cost, 0.25);
    ScribeStore.write(run.storage, 'harbour', ScribeStore.Kind.Settings, { analyzer: 'invented/analyzer-model', scribe: 'invented/scribe-model', budget: 3 });
    const roles = [
        ['Analyzer', 'invented/analyzer-model'],
        ['Scribe', 'invented/scribe-model'],
        ['Pedant', DEFAULTS.pedant],
    ];
    for (const [role, model] of roles) {
        const asking = ask(ScribeBoot.Role[role], SYSTEM, USER);
        await settle();
        const call = run.sent.calls.at(-1);
        assert.deepEqual(asked(call), [model, false], role);
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
    assert.deepEqual(asked(run.sent.calls.at(-1)), ['invented/scribe-model', false]);
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
    assert.deepEqual(keeper.ticks.slice(4), []);
    await pass(run, 6000);
    assert.deepEqual(keeper.ticks.slice(4), [100000]);
    for (let count = 0; count < 3; count++) {
        await traffic(run);
        await pass(run, 400);
    }
    await pass(run, 20800);
    assert.deepEqual(keeper.ticks.slice(5), [120000]);
    run.world.tickFailure = 'The newest page could not be read';
    await pass(run, 15000);
    assert.equal(keeper.ticks.at(-1), 140000);
    assert.deepEqual(run.lines, ['The check failed: The newest page could not be read']);
    run.world.tickFailure = null;
    await pass(run, 20000);
    assert.equal(keeper.ticks.at(-1), 160000);
    assert.equal(keeper.ticks.length, 8);
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
    assert.ok(run.timers.count > 0);
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
    assert.deepEqual([...new Set(run.lines)], [
        'The scribe could not start: Zeta refused [hidden]',
        'The check failed: The newest page failed for [hidden]',
        'The panel could not be drawn: The panel saw [hidden]',
    ]);
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
    run.environment.storage = noted(run.storage, ['get', 'set', 'remove', 'list', 'watch'], 'storage', note);
    start(run);
    await settle();
    assert.deepEqual(touched.slice(0, 9), [...Array(7).fill('listener wrapped'), 'storage wrapped', 'storage wrapped']);
    assert.equal(touched.includes('timer wrapped'), true);
    assert.deepEqual(
        run.page.listeners.map((entry) => `${entry.type} ${entry.capture}`),
        ['keydown true', 'keyup true', 'keypress true', 'message false', 'popstate false', 'pagehide false', 'pageshow false'],
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
        answer(run.sent.calls.at(-1), 200, finished('error', '', 1));
        await pass(run, pauseMs);
    }
    assert.equal((await first).message.startsWith('answer ended in an error'), true);
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
    answer(run.sent.calls.at(-1), 200, finished('error', '', 0.4));
    await pass(run, 2000);
    answer(run.sent.calls.at(-1), 200, finished('stop', 'The scene.', 0.01));
    const scene = await mended;
    assert.equal(scene.text, 'The scene.');
    assert.equal(scene.cost, 0.4 + 0.01);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', NEXT_DAY), 0.4 + 0.01);
    run.clock.day = '2026-11-17';
    const cut = keeper(ScribeBoot.Role.Analyzer, SYSTEM, USER);
    await settle();
    answer(run.sent.calls.at(-1), 200, finished('length', 'A stretch cut short', 0.7));
    const partial = await cut;
    assert.equal(partial.text, 'A stretch cut short');
    assert.equal(partial.finish, 'length');
    assert.equal(partial.cost, 0.7);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', '2026-11-17'), 0);
    run.clock.day = '2026-11-18';
    const twice = keeper(ScribeBoot.Role.Analyzer, SYSTEM, USER);
    await settle();
    answer(run.sent.calls.at(-1), 200, finished('error', '', 0.25));
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

test('Force stop immediately aborts the call and blocks dispatch even when an old response arrives', async () => {
    const run = harness();
    run.sent = requests({ aborting: false });
    run.environment.xmlHttpRequest = run.sent.xmlHttpRequest;
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const calls = run.world.panels[0].options.calls;
    const live = run.world.lives[0];
    const asking = failureOf(live.options.ask(ScribeBoot.Role.Scribe, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 1);
    assert.equal(calls.due(), true);
    calls.stop();
    assert.equal(run.sent.calls[0].handle.aborts, 1);
    assert.equal((await asking).message, ScribeBoot.Settings.Messages.Paused);
    answer(run.sent.calls[0], 200, completion('A late answer.', 0.5));
    await pass(run, 2 * ScribeBoot.Settings.TickMs);
    assert.equal((await failureOf(live.options.ask(ScribeBoot.Role.Scribe, SYSTEM, USER))).message, ScribeBoot.Settings.Messages.Paused);
    assert.equal(run.sent.calls.length, 1);
    assert.equal(calls.due(), false);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 0);
    run.boot.stop();
});

test('Pause terminates a gateway backoff and every concurrent room request even when the provider ignores abort', async () => {
    const run = harness();
    run.sent = requests({ aborting: false });
    run.environment.xmlHttpRequest = run.sent.xmlHttpRequest;
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const keeper = run.world.keepers[0];
    const live = run.world.lives[0];
    const reading = failureOf(keeper.options.ask('Analyzer', SYSTEM, USER));
    const scene = failureOf(live.options.ask('Scribe', SYSTEM, USER));
    const checking = failureOf(live.options.ask('Pedant', SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 3);
    answer(run.sent.calls[0], 503, '{"error":"unavailable"}');
    await settle();
    assert.ok(run.timers.delays.includes(ScribeBoot.Settings.PauseMs));
    keeper.stop = { reason: 'Paused' };
    keeper.options.pauseCalls();
    assert.equal(run.sent.calls[1].handle.aborts, 1);
    assert.equal(run.sent.calls[2].handle.aborts, 1);
    assert.ok(!run.timers.delays.includes(ScribeBoot.Settings.PauseMs));
    const blocked = failureOf(live.options.ask('Scribe', SYSTEM, USER));
    for (const failure of await Promise.all([reading, scene, checking, blocked])) {
        assert.equal(failure.message, ScribeBoot.Settings.Messages.Paused);
    }
    keeper.stop = null;
    const resumed = live.options.ask('Scribe', SYSTEM, USER);
    await settle();
    answer(run.sent.calls[1], 200, completion('Old scene.', 0));
    answer(run.sent.calls[2], 200, completion('Old finding.', 0));
    answer(run.sent.calls[3], 200, completion('Current scene.', 0));
    assert.equal((await resumed).text, 'Current scene.');
    await pass(run, 2 * ScribeBoot.Settings.TickMs);
    assert.equal(run.sent.calls.length, 4);
    run.boot.stop();
});

test('historical checks reserve at dispatch, and a reservation failure, ambiguous response or forced stop cannot cause a retry', async () => {
    const run = harness();
    start(run);
    await settle();
    const keeper = run.world.keepers[0];
    const attempts = [];
    const reserve = () => attempts.push(run.sent.calls.length);
    await failureOf(keeper.options.askChecker(SYSTEM, USER, reserve));
    assert.deepEqual(attempts, []);
    ScribeStore.setKey(run.storage, KEY);
    const failure = await failureOf(keeper.options.askChecker(SYSTEM, USER, () => { throw new Error('Storage refused'); }));
    assert.equal(failure.message, 'Storage refused');
    assert.equal(failure.source, 'Scribe');
    assert.equal(run.sent.calls.length, 0);
    for (const force of [false, true]) {
        const checking = failureOf(keeper.options.askChecker(SYSTEM, USER, reserve));
        await settle();
        const count = run.sent.calls.length;
        const call = run.sent.calls.at(-1);
        if (force) {
            run.world.panels[0].options.calls.stop();
            assert.equal(call.handle.aborts, 1);
        } else {
            answer(call, 503, '{"error":"unavailable"}');
        }
        await checking;
        await pass(run, 3 * ScribeBoot.Settings.PauseMs);
        assert.equal(run.sent.calls.length, count);
    }
    assert.deepEqual(attempts, [0, 1]);
    run.boot.stop();
});

test('a stopped call cannot dispatch a replacement after the stopped state clears', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const keeper = run.world.keepers[0];
    const reading = failureOf(keeper.options.ask('Analyzer', SYSTEM, USER));
    await settle();
    const calls = run.world.panels[0].options.calls;
    assert.equal(calls.due(), true);
    calls.stop();
    assert.equal(calls.due(), false);
    keeper.stop = null;
    assert.equal((await reading).message, ScribeBoot.Settings.Messages.Paused);
    assert.equal(run.sent.calls.length, 1);
    run.boot.stop();
});

test('only a historical auth rejection without observed charges can be released after the key actually changes', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const keeper = run.world.keepers[0];
    for (const cost of [0.1, 0]) {
        const checking = failureOf(keeper.options.askChecker(SYSTEM, USER, () => {}));
        await settle();
        answer(run.sent.calls.at(-1), 401, JSON.stringify({ error: 'Denied', usage: { cost } }));
        const error = await checking;
        assert.equal(error.billed, cost > 0);
        if (cost > 0) {
            assert.equal(error.unbilledAuth, undefined);
            assert.equal(error.keyChanged, undefined);
        } else {
            assert.equal(error.unbilledAuth, true);
            ScribeStore.setKey(run.storage, KEY);
            assert.equal(error.keyChanged(), false);
            ScribeStore.setKey(run.storage, 'rotated-test-key');
            assert.equal(error.keyChanged(), true);
        }
    }
    const generated = failureOf(keeper.options.askChecker(SYSTEM, USER, () => {}));
    await settle();
    answer(run.sent.calls.at(-1), 200, JSON.stringify({
        error: { code: 401, message: 'Provider authentication failed' }, usage: { completion_tokens: 7 },
    }));
    /** @type {Error & {providerCode?: number, unbilledAuth?: boolean, keyChanged?: Function}} */
    const uncertain = await generated;
    assert.equal(uncertain.providerCode, 401);
    assert.equal(uncertain.unbilledAuth, undefined);
    assert.equal(uncertain.keyChanged, undefined);
    assert.equal(run.sent.calls.length, 3);
    run.boot.stop();
});

test('one Force stop cancels all three room calls regardless of when they began', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const calls = run.world.panels[0].options.calls;
    const reading = failureOf(run.world.keepers[0].options.ask(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    await pass(run, 100);
    const check = failureOf(run.world.lives[0].options.ask(ScribeBoot.Role.Pedant, SYSTEM, USER));
    await pass(run, 100);
    const scene = failureOf(run.world.lives[0].options.ask(ScribeBoot.Role.Scribe, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 3);
    assert.equal(calls.due(), true);
    calls.stop();
    assert.deepEqual(run.sent.calls.map((call) => call.handle.aborts), [1, 1, 1]);
    for (const error of await Promise.all([reading, check, scene])) {
        assert.equal(error.message, ScribeBoot.Settings.Messages.Paused);
    }
    await pass(run, 2 * ScribeBoot.Settings.TickMs);
    assert.equal(calls.due(), false);
    assert.equal(run.sent.calls.length, 3);
    run.boot.stop();
});

test('Force stop ends the call even after the day is spent', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    ScribeStore.write(run.storage, 'harbour', ScribeStore.Kind.Settings, { budget: 1 });
    const calls = run.world.panels[0].options.calls;
    const scene = failureOf(run.world.lives[0].options.ask(ScribeBoot.Role.Scribe, SYSTEM, USER));
    await settle();
    ScribeStore.spend(run.storage, 'harbour', DAY, 1);
    calls.stop();
    await settle();
    assert.equal(run.sent.calls.length, 1);
    assert.equal(run.sent.calls[0].handle.aborts, 1);
    const ended = await scene;
    assert.equal(ended.message, ScribeBoot.Settings.Messages.Paused);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 1);
    run.boot.stop();
});

test('Force stop sends nothing more while spending is unrecorded, and the call ends with that refusal', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const calls = run.world.panels[0].options.calls;
    const reading = failureOf(run.world.keepers[0].options.ask(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    const scene = failureOf(run.world.lives[0].options.ask(ScribeBoot.Role.Scribe, SYSTEM, USER));
    await settle();
    run.storage.refuseSetsMatching(/spent/);
    const check = run.world.lives[0].options.ask(ScribeBoot.Role.Pedant, SYSTEM, USER);
    await settle();
    answer(run.sent.calls[2], 200, completion('Checked.', 2));
    await check;
    assert.equal((await failureOf(run.world.lives[0].options.ask(ScribeBoot.Role.Pedant, SYSTEM, USER))).message, UNRECORDED);
    calls.stop();
    await settle();
    assert.equal(run.sent.calls.length, 3);
    for (const ended of [await reading, await scene]) {
        assert.equal(ended.message, ScribeBoot.Settings.Messages.Paused);
    }
    run.storage.allow();
    run.boot.stop();
});

test('nothing is looked up outside the details', async () => {
    const made = requests();
    const fetch = ScribeBoot.request(made.xmlHttpRequest);
    const going = fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: '{}' });
    const details = made.calls[0].details;
    assert.equal(Object.getPrototypeOf(details), null);
    assert.equal(Object.getPrototypeOf(details.headers), null);
    for (const name of ['anonymous', 'redirect', 'responseType', 'method', 'url', 'headers', 'data']) {
        assert.equal(Object.hasOwn(details, name), true, name);
    }
    assert.equal(Object.hasOwn(details, 'timeout'), false);
    assert.equal(Object.hasOwn(details, 'ontimeout'), false);
    assert.equal(details.redirect, 'error');
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
        watch: (name, changed) => storage.watch(name, changed),
    };
    ScribeStore.setKey(storage, KEY);
    start(run);
    await settle();
    assert.equal(keyReads, 1);
    keyReads = 0;
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
    assert.equal(keeper.ticks.length, 30);
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

test('neither this room nor another room schedules history polling after native traffic', async () => {
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
    assert.deepEqual(keeper.ticks.slice(3), [80000]);
    await traffic(run, `${API}/v1/rooms/quay/messages`);
    await pass(run, 20000);
    assert.deepEqual(keeper.ticks.slice(4), [100000]);
    await traffic(run, `${API}/v1/rooms/harbourside/messages`);
    await pass(run, 20000);
    assert.deepEqual(keeper.ticks.slice(4), [100000, 120000]);
    run.boot.stop();
});

test('a head received before Keeper opens survives startup and a late old-room head is ignored', async () => {
    const run = harness();
    run.world.plans.push(HOLD);
    start(run);
    await settle();
    const row = { id: 'first', roomId: 'harbour', sender: { type: 'CHARACTER' }, messageTime: FakeZeta.time(1),
        contents: [{ type: 'TEXT', text: 'The first reply.' }] };
    const reply = () => {
        const response = Response.json({ messages: [row], nextCursor: null });
        Object.defineProperty(response, 'url', { value: MESSAGES });
        return response;
    };
    run.page.answer = async () => reply();
    const host = await run.page.fetch(MESSAGES);
    assert.equal((await host.json()).messages[0].contents[0].text, 'The first reply.');
    await settle();
    const first = run.world.keepers[0];
    first.finish();
    await settle();
    assert.deepEqual(Array.from(first.observations, (page) => page.messages[0].id), ['first']);
    let release;
    run.page.answer = () => new Promise((resolve) => { release = resolve; });
    const old = run.page.fetch(MESSAGES);
    go(run, '/rooms/ford');
    await pass(run, 1000);
    go(run, '/rooms/harbour');
    await pass(run, 1000);
    release(reply());
    await old;
    await settle();
    assert.equal(first.observations.length, 1);
    assert.equal(run.world.keepers.at(-1).observations.length, 0);
    assert.equal(run.page.fetchCalls.length, 2);
    run.boot.stop();
});

test('only the current chat frame observation reaches its keeper', async () => {
    const { run, chat, keeper } = await bridged();
    run.environment.random = () => 'observation-token-for-this-room';
    await deliver(run, readyFrom(chat.window));
    const page = { observedAt: START, head: false, complete: false, created: true, messages: [{ id: 'id', roomId: 'harbour',
        messageTime: FakeZeta.time(1), sender: { type: 'CHARACTER' }, contents: [{ type: 'TEXT', text: 'New reply.' }] }] };
    const event = { origin: PINGPONG, source: chat.window, data: { zetaScribe: 1, kind: ScribeFrame.Bridge.Kind.Messages,
        seq: chat.window.posted.at(-1).seq, token: chat.window.observationToken, room: 'harbour', page } };
    await deliver(run, { ...event, data: { ...event.data, token: BRIDGE } });
    await deliver(run, { ...event, data: { ...event.data, room: 'ford' } });
    await deliver(run, { ...event, isTrusted: false });
    assert.equal(keeper.observations.length, 0);
    await deliver(run, event);
    assert.equal(keeper.observations.length, 1);
    assert.equal(keeper.observations[0].messages[0].contents[0].text, 'New reply.');
    go(run, '/rooms/ford');
    await pass(run, 1000);
    await deliver(run, event);
    assert.equal(run.world.keepers.at(-1).observations.length, 0);
    run.boot.stop();
});

test('a watching tab transfers message heads to the reader and retains them through handoff', async () => {
    const locks = new FakeLocks();
    const first = harness({ locks });
    const second = harness({ locks, storage: first.storage, timers: first.timers, world: first.world, tabId: 'tab-two' });
    start(first);
    await settle();
    start(second);
    await settle();
    const [reader, watcher] = first.world.keepers;
    assert.equal(reader.reader, true);
    assert.equal(watcher.reader, false);
    const report = async (id, wording) => {
        const message = { id, roomId: 'harbour', sender: { type: 'CHARACTER' }, messageTime: FakeZeta.time(1),
            contents: [{ type: 'TEXT', text: wording }] };
        second.page.answer = () => {
            const response = Response.json({ messages: [message], nextCursor: null });
            Object.defineProperty(response, 'url', { value: MESSAGES });
            return Promise.resolve(response);
        };
        await second.page.fetch(MESSAGES);
        await settle();
    };
    const pending = () => first.storage.list().filter((name) => name.startsWith('scribe:observations:harbour:'));
    reader.stop = { reason: 'Paused' };
    await report('first', 'The rider arrived.');
    assert.equal(reader.observations[0].messages[0].contents[0].text, 'The rider arrived.');
    assert.equal(watcher.observations.length, 0);
    assert.equal(pending().length, 0);
    reader.refuseObservation = true;
    await report('next', 'The gate opened.');
    assert.equal(pending().length, 1);
    assert.equal(reader.observations.length, 1);
    first.boot.stop();
    watcher.reader = true;
    watcher.options.notify({ kind: 'Changed' });
    assert.equal(watcher.observations[0].messages[0].contents[0].text, 'The gate opened.');
    assert.equal(pending().length, 0);
    await pass(second, 40000);
    assert.equal(watcher.observations.length, 1);
    assert.equal(first.page.fetchCalls.length, 0);
    assert.equal(second.page.fetchCalls.length, 2);
    assert.equal(first.sent.calls.length + second.sent.calls.length, 0);
    second.boot.stop();
});

test('watcher reminder edits are written locally even with delayed notifications, and report a refused write', async () => {
    const locks = new FakeLocks();
    const first = harness({ locks });
    const second = harness({ locks, storage: first.storage, timers: first.timers, world: first.world, tabId: 'tab-two' });
    start(first);
    await settle();
    start(second);
    await settle();
    const watcher = first.world.lives[1].live;
    const panel = first.world.panels[1].options;
    const applied = [];
    watcher.writeReminderDraft = (text) => {
        if (text === 'refused') {
            throw new Error('Storage refused the change.');
        }
        applied.push(text);
    };
    first.storage.queued = [];
    panel.writeReminderDraft('  chosen text  ');
    assert.deepEqual(applied, ['  chosen text  ']);
    const callbacks = first.storage.queued;
    first.storage.queued = null;
    callbacks.forEach((callback) => callback());
    assert.deepEqual(applied, ['  chosen text  ']);
    assert.throws(() => panel.writeReminderDraft('refused'), /Reminder was not saved. Your text is still here/);
    assert.deepEqual(first.storage.list().filter((key) => key.includes(':edit:')), []);
    assert.equal(first.page.fetchCalls.length + second.page.fetchCalls.length, 0);
    assert.equal(first.sent.calls.length + second.sent.calls.length, 0);
    second.boot.stop();
    first.boot.stop();
});

test('an owned history request is aborted on its native fetch and paused dispatch remains blocked', async () => {
    const run = harness({ clone: (value) => structuredClone(value) });
    start(run);
    await settle();
    await run.page.fetch(API + '/v1/users/me', { headers: { Authorization: TOKEN } });
    run.page.answer = () => new Promise(() => {});
    const keeper = run.world.keepers[0];
    const zeta = keeper.options.zeta;
    const pending = failureOf(zeta.history());
    await settle();
    const signal = run.page.fetchCalls.at(-1).values[1].signal;
    keeper.stop = { reason: 'Paused' };
    zeta.abort();
    assert.equal(signal.aborted, true);
    assert.equal((await pending).name, 'AbortError');
    assert.equal((await failureOf(zeta.history())).message, ScribeBoot.Settings.Messages.Paused);
    assert.equal(run.page.fetchCalls.length, 2);
    run.boot.stop();
});

for (const departure of ['currententrychange', 'pagehide']) {
    test(departure + ' aborts a history request and cancels model backoff before the route timer', async () => {
        const run = harness();
        const navigation = new EventTarget();
        run.page.navigation = navigation;
        start(run);
        await settle();
        ScribeStore.setKey(run.storage, KEY);
        const { options } = run.world.keepers[0];
        const asking = failureOf(options.ask(ScribeBoot.Role.Analyzer, SYSTEM, USER));
        await settle();
        answer(run.sent.calls[0], 503, '{"error":"unavailable"}');
        await settle();
        assert.ok(run.timers.delays.includes(ScribeBoot.Settings.PauseMs));
        await run.page.fetch(API + '/v1/users/me', { headers: { Authorization: TOKEN } });
        run.page.answer = () => new Promise(() => {});
        const querying = failureOf(options.zeta.history(() => {}));
        await settle();
        const signal = run.page.fetchCalls.at(-1).values[1].signal;
        if (departure === 'currententrychange') {
            go(run, '/');
            navigation.dispatchEvent(new Event(departure));
        } else {
            run.page.listeners.find((entry) => entry.type === 'pagehide').listener({ type: 'pagehide' });
        }
        assert.equal(signal.aborted, true);
        assert.ok(!run.timers.delays.includes(ScribeBoot.Settings.PauseMs));
        assert.equal((await querying).name, 'AbortError');
        assert.equal((await asking).message, 'The chat has been left');
        await pass(run, 2 * ScribeBoot.Settings.TickMs);
        assert.equal(run.sent.calls.length, 1);
        assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 0);
        run.boot.stop();
    });
}

test('one boot per page', async () => {
    const run = harness();
    const first = start(run);
    await settle();
    assert.deepEqual(run.world.order, BUILT);
    const second = ScribeBoot.start(run.environment);
    await pass(run, 3000);
    assert.equal(run.world.keepers.length, 1);
    assert.deepEqual(run.lines, ['The scribe is already running on this page']);
    assert.equal(run.page.listeners.length, 7);
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
    assert.equal((await walk).name, 'AbortError');
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

test('a call left running ends when the chat is left', async () => {
    assert.equal(Object.hasOwn(ScribeBoot.Settings, 'TimeoutMs'), false);
    assert.equal(Object.hasOwn(ScribeBoot.Settings, 'TransportMarginMs'), false);
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const pending = failureOf(run.world.keepers[0].options.ask(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 1);
    assert.equal(Object.hasOwn(run.sent.calls[0].details, 'timeout'), false);
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

test('no timer ends a model call, whatever its role', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const keeper = run.world.keepers[0].options.ask;
    const live = run.world.lives[0].options.ask;
    const roles = [
        [keeper, ScribeBoot.Role.Analyzer],
        [live, ScribeBoot.Role.Scribe],
        [live, ScribeBoot.Role.Pedant],
    ];
    const asking = roles.map(([ask, role]) => ask(role, SYSTEM, USER));
    await settle();
    assert.equal(run.sent.calls.length, 3);
    for (const call of run.sent.calls) {
        assert.equal(Object.hasOwn(call.details, 'timeout'), false);
    }
    for (let stretch = 0; stretch < 6; stretch++) {
        await pass(run, 600000);
    }
    for (const [index, pending] of asking.entries()) {
        assert.equal(await stateOf(pending), 'pending', roles[index][1]);
        assert.equal(run.sent.calls[index].handle.aborts, 0, roles[index][1]);
        assert.equal(run.sent.calls[index].ended, false, roles[index][1]);
    }
    assert.equal(run.sent.calls.length, 3);
    for (const [index, pending] of asking.entries()) {
        answer(run.sent.calls[index], 200, completion(`The ${roles[index][1]} answer.`, 0.01));
        assert.equal((await pending).text, `The ${roles[index][1]} answer.`);
    }
    run.boot.stop();
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

test('the provider charge returned despite a transport abort is still counted after leaving the room', async () => {
    const run = harness();
    run.sent = requests({ aborting: false });
    run.environment.xmlHttpRequest = run.sent.xmlHttpRequest;
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
    assert.equal(run.sent.calls[0].handle.aborts, 1);
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

test('no role caps the length of its answer', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const keeper = run.world.keepers[0].options.ask;
    const live = run.world.lives[0].options.ask;
    const expected = [
        [keeper, ScribeBoot.Role.Analyzer],
        [live, ScribeBoot.Role.Scribe],
        [live, ScribeBoot.Role.Pedant],
    ];
    assert.equal(Object.hasOwn(ScribeBoot.Settings, 'MaxTokens'), false);
    for (const [ask, role] of expected) {
        const asking = ask(role, SYSTEM, USER);
        await settle();
        const call = run.sent.calls.at(-1);
        assert.equal(Object.hasOwn(JSON.parse(call.details.data), 'max_tokens'), false, role);
        answer(call, 200, completion(`The ${role} answer.`, 0.01));
        assert.equal((await asking).text, `The ${role} answer.`);
    }
    assert.equal(run.sent.calls.length, 3);
    run.boot.stop();
});

/**
 * @param {{ origin: string, top: boolean, ancestors: string[]|undefined, parented: boolean }} where
 * @param {?string} stored
 * @return {{ booted: number, framed: number, storage: number, asked: string[], window: boolean, options: ?object, environment: ?object }}
 */
function startIn(where, stored = null) {
    const seen = { booted: 0, framed: 0, storage: 0, asked: [], window: false, options: null, environment: null };
    const page = { location: { origin: where.origin, ancestorOrigins: where.ancestors } };
    page.top = where.top ? page : { name: 'the top window' };
    page.parent = where.parented ? { name: 'the parent window' } : page;
    /**
     * @param {string} name
     * @return {*}
     */
    const counted = (name) => {
        seen.storage++;
        seen.asked.push(name);
        return name === TOKEN_NAME ? stored : null;
    };
    const sandbox = {
        unsafeWindow: page,
        document: { kind: 'document' },
        window: { confirm: () => true },
        navigator: { locks: null },
        crypto: { randomUUID: () => 'a-random-value-0123456789' },
        console,
        GM_getValue: counted,
        GM_setValue: counted,
        GM_deleteValue: counted,
        GM_listValues: counted,
        GM_xmlhttpRequest: counted,
        ScribeBoot: {
            Settings: ScribeBoot.Settings,
            day: ScribeBoot.day,
            start: (environment) => {
                seen.booted++;
                seen.window = environment.pageWindow === page;
                seen.environment = environment;
            },
        },
        ScribeFrame: {
            Bridge: ScribeFrame.Bridge,
            Role: ScribeFrame.Role,
            role: (values) => ScribeFrame.role(values),
            start: (options) => {
                seen.framed++;
                seen.window = options.window === page;
                seen.options = options;
            },
        },
    };
    vm.runInContext(START_SOURCE, vm.createContext(sandbox));
    return seen;
}

/**
 * @param {object} choices
 * @return {Promise<{ run: object, chat: object, live: object, keeper: object }>}
 */
async function bridged(choices = {}) {
    const run = harness(choices);
    start(run);
    await settle();
    const chat = frameIn(run);
    return { run, chat, live: run.world.lives[0], keeper: run.world.keepers[0] };
}

test('the start picks its case', () => {
    const top = startIn({ origin: ZETA, top: true, ancestors: [], parented: false });
    assert.deepEqual([top.booted, top.framed, top.storage, top.window], [1, 0, 0, true]);
    for (const ancestors of [[ZETA], undefined]) {
        const framed = startIn({ origin: PINGPONG, top: false, ancestors, parented: true });
        assert.deepEqual([framed.booted, framed.framed, framed.storage, framed.window], [0, 1, 0, true], String(ancestors));
    }
    const nothing = [
        ['a Zeta sub-frame', { origin: ZETA, top: false, ancestors: [ZETA], parented: true }],
        ['a Pingpong page on top', { origin: PINGPONG, top: true, ancestors: [], parented: false }],
        ['a Pingpong frame under another site', { origin: PINGPONG, top: false, ancestors: ['https://elsewhere.example'], parented: true }],
    ];
    for (const [label, where] of nothing) {
        const seen = startIn(where);
        assert.deepEqual([seen.booted, seen.framed, seen.storage], [0, 0, 0], label);
    }
});

test('a frame is armed only after it has spoken', async () => {
    const { run, chat, live, keeper } = await bridged();
    await offer(run, live, 'Remember the mill.');
    keeper.options.notify({ kind: 'Changed' });
    await pass(run, 20000);
    assert.equal(keeper.ticks.length, 1);
    assert.equal(chat.window.posted.length, 0);
    assert.equal(run.document.searches, 0);
    await deliver(run, readyFrom(chat.window));
    assert.equal(chat.window.posted.length, 1);
    assert.deepEqual(chat.window.posted[0], { kind: 'arm', seq: 1, token: BRIDGE, ready: 'Remember the mill.', suggestion: null, tag: 1, origin: PINGPONG });
    run.boot.stop();
});

test('only an iframe of this page is heard', async () => {
    const { run, chat, live, keeper } = await bridged();
    await offer(run, live, 'Remember the mill.');
    const other = frameIn(run, { src: 'https://elsewhere.example/widget' });
    const lookalike = frameIn(run, { src: 'https://frame.pingpong.ai.example/v1/index.html' });
    const gone = frameIn(run, { src: 'https://frame.pingpong.ai/v1/old.html' });
    run.document.frames.splice(run.document.frames.indexOf(gone.element), 1);
    const ready = { zetaScribe: 1, kind: 'ready' };
    const sent = { zetaScribe: 1, kind: 'sent', seq: 1, ready: true, suggestion: false };
    const ignored = [
        { origin: 'https://elsewhere.example', source: chat.window, data: ready },
        { origin: 'https://elsewhere.example', source: chat.window, data: sent },
        { origin: PINGPONG, source: other.window, data: ready },
        { origin: PINGPONG, source: run.page, data: ready },
        { origin: PINGPONG, source: lookalike.window, data: ready },
        { origin: PINGPONG, source: lookalike.window, data: sent },
        { origin: PINGPONG, source: gone.window, data: ready },
        { origin: PINGPONG, source: gone.window, data: sent },
        { origin: PINGPONG, source: chat.window, data: { zetaScribe: 1, kind: 'sent', seq: 'one', ready: true, suggestion: false } },
        { origin: PINGPONG, source: chat.window, data: { kind: 'ready' } },
        { origin: PINGPONG, source: chat.window, data: 'ready' },
    ];
    for (const event of ignored) {
        await deliver(run, event);
    }
    await pass(run, 16000);
    for (const frame of [chat, other, lookalike, gone]) {
        assert.equal(frame.window.posted.length, 0);
    }
    assert.deepEqual(live.went, []);
    assert.deepEqual(keeper.ticks, []);
    const searches = run.document.searches;
    await deliver(run, { origin: 'https://elsewhere.example', source: chat.window, data: ready });
    assert.equal(run.document.searches, searches);
    await deliver(run, readyFrom(chat.window));
    assert.equal(chat.window.posted.length, 1);
    run.boot.stop();
});

test('the arm follows the lines', async () => {
    const { run, chat, live, keeper } = await bridged();
    await deliver(run, readyFrom(chat.window));
    await offer(run, live, 'Remember the mill.');
    await offer(run, live, 'Remember the bridge.');
    await offer(run, live, null);
    await offer(run, live, null);
    keeper.options.notify({ kind: 'Changed' });
    await settle();
    assert.deepEqual(
        chat.window.posted.map((message) => `${message.seq} ${message.ready}`),
        ['1 null', '2 Remember the mill.', '3 Remember the bridge.', '4 null'],
    );
    run.boot.stop();
});

test('a sent under the last arm tells the live part', async () => {
    const { run, chat, live, keeper } = await bridged();
    live.ready = 'Remember the mill.';
    live.suggestion = 'A stranger knocks.';
    await deliver(run, readyFrom(chat.window));
    assert.equal(chat.window.posted.length, 1);
    await deliver(run, sentFrom(chat.window, 1, true, false));
    assert.deepEqual(live.went, ['Remember the mill. | null']);
    assert.equal(chat.window.posted.length, 2);
    assert.equal(chat.window.posted[1].seq, 2);
    await pass(run, 16000);
    assert.deepEqual(keeper.ticks, []);
    await deliver(run, sentFrom(chat.window, 2, false, false));
    assert.deepEqual(live.went, ['Remember the mill. | null', 'null | null']);
    assert.equal(chat.window.posted.length, 3);
    assert.equal(chat.window.posted[2].seq, 3);
    run.boot.stop();
});

test('a sent under an earlier kept arm still tells the live part', async () => {
    const { run, chat, live } = await bridged();
    live.ready = 'Remember the mill.';
    await deliver(run, readyFrom(chat.window));
    await offer(run, live, 'Remember the bridge.');
    assert.deepEqual(chat.window.posted.map((message) => message.seq), [1, 2]);
    /**
     * @param {object} target
     * @param {{ origin: string, source: *, data: object }} event
     * @return {Promise<void>}
     */
    const reportTo = async (target, event) => {
        const posted = target.window.posted.length;
        await deliver(run, event);
        assert.equal(run.timers.delays.includes(5000), false);
        assert.equal(run.timers.delays.includes(15000), false);
        assert.equal(target.window.posted.length, posted + 1);
        await pass(run, 20000);
    };
    await reportTo(chat, sentFrom(chat.window, 1, true, false));
    assert.deepEqual(live.went, ['Remember the mill. | null']);
    await reportTo(chat, sentFrom(chat.window, 99, true, false));
    assert.deepEqual(live.went, ['Remember the mill. | null']);
    for (let step = 0; step < 9; step++) {
        await offer(run, live, `Remember step ${step}.`);
    }
    const oldest = chat.window.posted.at(-9).seq;
    await reportTo(chat, sentFrom(chat.window, oldest, true, false));
    assert.deepEqual(live.went, ['Remember the mill. | null']);
    const lastToOld = chat.window.posted.at(-1).seq;
    run.document.frames.length = 0;
    const fresh = frameIn(run);
    await deliver(run, readyFrom(fresh.window));
    assert.equal(fresh.window.posted.length, 1);
    await reportTo(fresh, sentFrom(fresh.window, lastToOld, true, false));
    assert.deepEqual(live.went, ['Remember the mill. | null']);
    await reportTo(fresh, sentFrom(fresh.window, fresh.window.posted.at(-1).seq, true, false));
    assert.deepEqual(live.went, ['Remember the mill. | null', 'Remember step 8. | null']);
    run.boot.stop();
});

/**
 * @param {*} source
 * @param {number} seq
 * @param {object} fields
 * @return {{ origin: string, source: *, data: object }}
 */
function reminderSentFrom(source, seq, fields) {
    const base = sentFrom(source, seq, true, false);
    return { ...base, data: { ...base.data, ...fields } };
}

test('a reminder report is told to the live part with the identities of the arm it answers', async () => {
    const { run, chat, live } = await bridged();
    live.ready = 'Remember the mill.';
    live.reminder = 'room-1#reminder-1';
    live.attempt = 'room-1#attempt-1';
    await deliver(run, readyFrom(chat.window));
    await deliver(run, reminderSentFrom(chat.window, 1, { reminder: 'room-1#reminder-1', attempt: 'room-1#attempt-1', index: 0 }));
    assert.equal(live.wentLines.length, 1);
    assert.deepEqual(
        [live.wentLines[0].ready, live.wentLines[0].reminder, live.wentLines[0].attempt],
        ['Remember the mill.', 'room-1#reminder-1', 'room-1#attempt-1'],
    );
    await deliver(run, sentFrom(chat.window, 2, false, false));
    assert.deepEqual(
        [live.wentLines[1].ready, live.wentLines[1].reminder, live.wentLines[1].attempt],
        [null, null, null],
    );
    run.boot.stop();
});

test('a manual frame arm keeps the selected text and journals the full marked paragraph', async () => {
    const { run, chat, live } = await bridged();
    live.manual = true;
    live.ready = 'Hold  here.\nThen go.';
    live.reminder = 'room-1#reminder-2';
    live.attempt = 'room-1#attempt-2';
    await deliver(run, readyFrom(chat.window));
    const identity = { kind: 'starting', index: 0, reminder: live.reminder, attempt: live.attempt, submission: 'abcd1234' };
    await deliver(run, reminderSentFrom(chat.window, 1, { ...identity, cut: 4 }));
    assert.equal(live.starting.length, 0);
    await deliver(run, reminderSentFrom(chat.window, 1, identity));
    assert.equal(live.starting.length, 1);
    const started = live.starting[0];
    assert.deepEqual([started.ready, started.carried, started.manual], [live.ready, '[Scribe] ' + live.ready, true]);
    run.boot.stop();
});

test('a duplicate report of one arm tells the live part once, and a new index is a new send', async () => {
    const { run, chat, live } = await bridged();
    await deliver(run, readyFrom(chat.window));
    const plain = { index: 0 };
    await deliver(run, reminderSentFrom(chat.window, 1, { ...plain, ready: false }));
    await deliver(run, reminderSentFrom(chat.window, 1, { ...plain, ready: false }));
    assert.equal(live.wentLines.length, 1);
    await deliver(run, reminderSentFrom(chat.window, 1, { index: 1, ready: false }));
    assert.equal(live.wentLines.length, 2);
    await deliver(run, reminderSentFrom(chat.window, 1, { index: 1, ready: false }));
    assert.equal(live.wentLines.length, 2);
    run.boot.stop();
});

test('the top page journals a frame send before confirmation and can release it on cancellation', async () => {
    const { run, chat, live } = await bridged();
    live.ready = 'The full paragraph.';
    live.reminder = 'first';
    live.attempt = 'first-attempt';
    await deliver(run, readyFrom(chat.window));
    const identity = { index: 0, reminder: live.reminder, attempt: live.attempt };
    await deliver(run, reminderSentFrom(chat.window, 1, { ...identity, kind: 'starting', attempt: 'other' }));
    assert.equal(live.starting.length, 0);
    await deliver(run, reminderSentFrom(chat.window, 1, { ...identity, kind: 'starting' }));
    await deliver(run, reminderSentFrom(chat.window, 1, { ...identity, kind: 'starting' }));
    assert.equal(live.starting.length, 1);
    assert.equal(live.wentLines.length, 0);
    assert.equal(live.starting[0].key, 'frame:tab-one:1:1:0');
    await deliver(run, reminderSentFrom(chat.window, 1, { ...identity, kind: 'cancelled' }));
    await deliver(run, reminderSentFrom(chat.window, 1, identity));
    assert.deepEqual(live.cancelled, live.starting);
    assert.equal(live.wentLines.length, 0);
    const seq = chat.window.posted.at(-1).seq;
    const plain = { index: 1, ready: false };
    await deliver(run, reminderSentFrom(chat.window, seq, { ...plain, kind: 'starting' }));
    await deliver(run, reminderSentFrom(chat.window, seq, plain));
    assert.equal(live.wentLines.length, 1);
    assert.equal(live.wentLines[0], live.starting[1]);
    assert.notEqual(live.wentLines[0].key, live.starting[0].key);
    run.boot.stop();
});

test('a report naming another reminder than the arm offered tells nothing, and one naming none is the arm', async () => {
    const { run, chat, live } = await bridged();
    live.ready = 'Remember the mill.';
    live.reminder = 'room-1#reminder-1';
    live.attempt = 'room-1#attempt-1';
    await deliver(run, readyFrom(chat.window));
    await deliver(run, reminderSentFrom(chat.window, 1, { reminder: 'room-0#reminder-9', attempt: 'room-0#attempt-9', index: 0 }));
    assert.deepEqual(live.wentLines, []);
    await deliver(run, reminderSentFrom(chat.window, 1, { index: 1 }));
    assert.equal(live.wentLines.length, 1);
    assert.deepEqual([live.wentLines[0].reminder, live.wentLines[0].attempt], ['room-1#reminder-1', 'room-1#attempt-1']);
    run.boot.stop();
});

test('an offer whose text is unchanged but whose reminder is new arms the frame again', async () => {
    const { run, chat, live } = await bridged();
    live.reminder = 'room-1#reminder-1';
    live.attempt = 'room-1#attempt-1';
    await offer(run, live, 'Remember the mill.');
    await deliver(run, readyFrom(chat.window));
    const armed = chat.window.posted.length;
    live.reminder = 'room-1#reminder-2';
    live.attempt = 'room-1#attempt-2';
    await offer(run, live, 'Remember the mill.');
    assert.equal(chat.window.posted.length, armed + 1);
    await offer(run, live, 'Remember the mill.');
    assert.equal(chat.window.posted.length, armed + 1);
    run.boot.stop();
});

test('the lines are read after the live part is brought up to date', async () => {
    const { run, chat, live } = await bridged();
    await deliver(run, readyFrom(chat.window));
    live.afterView = 'A fresh reminder.';
    live.reads.length = 0;
    await pass(run, 20000);
    assert.deepEqual(live.reads.slice(0, 2), ['view', 'lines']);
    assert.deepEqual(
        chat.window.posted.map((message) => message.ready),
        [null, 'A fresh reminder.'],
    );
    run.boot.stop();
});

test('leaving the chat disarms the frame', async () => {
    const { run, chat, live, keeper } = await bridged();
    live.ready = 'Remember the mill.';
    live.suggestion = 'A stranger knocks.';
    await deliver(run, readyFrom(chat.window));
    go(run, '/');
    await pass(run, 1000);
    assert.deepEqual(
        chat.window.posted.map((message) => `${message.seq} ${message.ready} ${message.suggestion}`),
        ['1 Remember the mill. A stranger knocks.', '2 null null'],
    );
    const ticks = keeper.ticks.length;
    await deliver(run, sentFrom(chat.window, 1, true, true));
    await pass(run, 16000);
    assert.deepEqual(live.went, []);
    assert.equal(keeper.ticks.length, ticks);
    assert.equal(chat.window.posted.length, 3);
    go(run, '/rooms/harbour');
    await pass(run, 1000);
    assert.equal(run.world.lives.length, 2);
    assert.equal(chat.window.posted.length, 4);
    go(run, '/');
    await pass(run, 1000);
    assert.deepEqual(
        chat.window.posted.map((message) => `${message.seq} ${message.ready} ${message.suggestion}`),
        ['1 Remember the mill. A stranger knocks.', '2 null null', '3 null null', '4 null null', '5 null null'],
    );
    run.boot.stop();
});

test('a tab that is not the reader arms nothing to send', async () => {
    const { run, chat, live, keeper } = await bridged();
    keeper.reader = false;
    live.ready = 'Remember the mill.';
    live.suggestion = 'A stranger knocks.';
    await deliver(run, readyFrom(chat.window));
    await offer(run, live, 'Remember the bridge.', 'Another stranger.');
    assert.deepEqual(
        chat.window.posted.map((message) => `${message.ready} ${message.suggestion}`),
        ['null null'],
    );
    keeper.reader = true;
    keeper.options.notify({ kind: 'Changed' });
    await settle();
    assert.equal(chat.window.posted.at(-1).ready, 'Remember the bridge.');
    run.boot.stop();
});

test('a new frame window is armed afresh', async () => {
    const { run, chat, live } = await bridged();
    live.ready = 'Remember the mill.';
    await deliver(run, readyFrom(chat.window));
    assert.equal(chat.window.posted.length, 1);
    run.document.frames.length = 0;
    const fresh = frameIn(run);
    await offer(run, live, 'Remember the bridge.');
    assert.equal(fresh.window.posted.length, 0);
    assert.equal(chat.window.posted.length, 1);
    await deliver(run, readyFrom(fresh.window));
    assert.deepEqual(
        fresh.window.posted.map((message) => message.ready),
        ['Remember the bridge.'],
    );
    await deliver(run, readyFrom(chat.window));
    await offer(run, live, 'Remember the ford.');
    assert.equal(chat.window.posted.length, 1);
    assert.equal(fresh.window.posted.length, 2);
    run.document.frames.length = 0;
    run.document.frames.push(chat.element);
    await offer(run, live, 'Remember the weir.');
    assert.equal(chat.window.posted.length, 1);
    assert.equal(fresh.window.posted.length, 2);
    await deliver(run, readyFrom(chat.window));
    assert.deepEqual(
        chat.window.posted.map((message) => message.ready),
        ['Remember the mill.', 'Remember the weir.'],
    );
    assert.equal(fresh.window.posted.length, 2);
    run.boot.stop();
});

test('a line too long is not armed', async () => {
    const { run, chat, live } = await bridged();
    live.ready = 'x'.repeat(6001);
    live.suggestion = 'y'.repeat(6000);
    await deliver(run, readyFrom(chat.window));
    assert.equal(chat.window.posted.length, 1);
    assert.equal(chat.window.posted[0].ready, null);
    assert.equal(chat.window.posted[0].suggestion.length, 6000);
    await offer(run, live, 'x'.repeat(6000), 'y'.repeat(6001));
    assert.equal(chat.window.posted.length, 2);
    assert.equal(chat.window.posted[1].ready.length, 6000);
    assert.equal(chat.window.posted[1].suggestion, null);
    run.boot.stop();
});

test('the top document\'s own hook still works', async () => {
    const run = harness();
    const sendWindow = new FakeSendWindow();
    sendWindow.location = { href: `${SITE}/rooms/harbour`, pathname: '/rooms/harbour' };
    const sendDocument = new FakeSendDocument(sendWindow);
    sendDocument.body = { kind: 'body' };
    sendDocument.visibilityState = 'visible';
    sendDocument.documentElement = rootElement();
    sendDocument.addEventListener = () => undefined;
    sendDocument.removeEventListener = () => undefined;
    const box = sendDocument.add(new FakeTextArea({ name: 'message' }));
    const sentTexts = [];
    box.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            sentTexts.push(box.value);
            box.value = '';
        }
    });
    run.environment.pageWindow = sendWindow;
    run.environment.document = sendDocument;
    run.world.hostless = true;
    run.world.appended = APPENDED;
    context.ScribeSender = RealSender;
    start(run);
    await settle();
    assert.deepEqual(run.world.order, ['keeper harbour', 'live harbour', 'panel harbour']);
    sendDocument.focus(box);
    NATIVE.set.call(box, 'Hello');
    box.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    box.forget();
    sendWindow.dispatch(box, 'keydown', { key: 'Enter', keyCode: 13 });
    sendWindow.advance(25);
    assert.deepEqual(sentTexts, [`Hello${APPENDED}`]);
    sendWindow.advance(100);
    const live = run.world.lives[0];
    assert.deepEqual(live.outgoing, ['true Hello']);
    assert.deepEqual(live.sent, []);
    assert.deepEqual(live.uncertain, [{ key: 'current attempt' }]);
    run.boot.stop();
});

test('stop removes the listener', async () => {
    const { run, chat } = await bridged();
    await deliver(run, readyFrom(chat.window));
    assert.equal(chat.window.posted.length, 1);
    run.boot.stop();
    const posted = chat.window.posted.length;
    assert.equal(run.page.listeners.filter((entry) => entry.type === 'message').length, 0);
    await deliver(run, readyFrom(chat.window));
    assert.equal(chat.window.posted.length, posted);
});

test('a hidden frame is still armed and still heard', async () => {
    const { run, chat, live } = await bridged();
    live.ready = 'Remember the mill.';
    await deliver(run, readyFrom(chat.window));
    chat.box.width = 0;
    await offer(run, live, null);
    assert.deepEqual(
        chat.window.posted.map((message) => message.ready),
        ['Remember the mill.', null],
    );
    chat.box.width = 480;
    await offer(run, live, 'Remember the bridge.');
    const bridgeSeq = chat.window.posted.at(-1).seq;
    chat.box.height = 0;
    await deliver(run, sentFrom(chat.window, bridgeSeq, true, false));
    assert.deepEqual(live.went, ['Remember the bridge. | null']);
    assert.equal(chat.window.posted.length, 4);
    run.boot.stop();
});

test('another pingpong iframe steals nothing', async () => {
    const { run, chat, live } = await bridged();
    const widget = frameIn(run, { src: 'https://frame.pingpong.ai/v1/widget.html', width: 1, height: 1 });
    run.document.frames.unshift(run.document.frames.pop());
    live.ready = 'Remember the mill.';
    await deliver(run, readyFrom(chat.window));
    await deliver(run, readyFrom(widget.window));
    await offer(run, live, 'Remember the bridge.');
    await offer(run, live, 'Remember the ford.');
    assert.deepEqual(
        chat.window.posted.map((message) => message.ready),
        ['Remember the mill.', 'Remember the bridge.', 'Remember the ford.'],
    );
    assert.deepEqual(
        widget.window.posted.map((message) => message.ready),
        ['Remember the mill.', 'Remember the bridge.', 'Remember the ford.'],
    );
    const seqs = [...chat.window.posted, ...widget.window.posted].map((message) => message.seq).sort((first, second) => first - second);
    assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6]);
    run.boot.stop();
});

test('a removed frame is forgotten', async () => {
    const { run, chat, live } = await bridged();
    await deliver(run, readyFrom(chat.window));
    assert.equal(chat.window.posted.length, 1);
    run.document.frames.length = 0;
    await offer(run, live, 'Remember the mill.');
    await pass(run, 20000);
    assert.equal(chat.window.posted.length, 1);
    run.document.frames.push(chat.element);
    await offer(run, live, 'Remember the bridge.');
    assert.equal(chat.window.posted.length, 1);
    run.boot.stop();
});

test('a delayed result cannot finish a journaled send after its originating frame was detached', async () => {
    const { run, chat, live } = await bridged();
    live.ready = 'The old paragraph.';
    live.reminder = 'first';
    live.attempt = 'first-attempt';
    await deliver(run, readyFrom(chat.window));
    const seq = chat.window.posted.at(-1).seq;
    const identity = { index: 0, reminder: live.reminder, attempt: live.attempt };
    await deliver(run, reminderSentFrom(chat.window, seq, { ...identity, kind: 'starting' }));
    await deliver(run, reminderSentFrom(chat.window, seq, { ...identity, kind: 'uncertain' }));
    assert.equal(live.uncertain.length, 1);
    run.document.frames.length = 0;
    await offer(run, live, 'A later paragraph.');
    await pass(run, 20000);
    run.document.frames.push(chat.element);
    await deliver(run, readyFrom(chat.window));
    await deliver(run, reminderSentFrom(chat.window, seq, identity));
    assert.equal(live.wentLines.length, 0);
    run.boot.stop();
});

test('one room\'s sent never reaches another room', async () => {
    const { run, chat, live } = await bridged();
    live.ready = 'Remember the harbour.';
    await deliver(run, readyFrom(chat.window));
    const harbourSeq = chat.window.posted[0].seq;
    go(run, '/rooms/ford');
    await pass(run, 1000);
    const ford = run.world.lives[1];
    assert.equal(ford.roomId, 'ford');
    assert.deepEqual(
        chat.window.posted.map((message) => `${message.seq} ${message.ready}`),
        ['1 Remember the harbour.', '2 null', '3 null'],
    );
    await deliver(run, sentFrom(chat.window, harbourSeq, true, false));
    assert.deepEqual(ford.went, []);
    assert.deepEqual(live.went, []);
    assert.equal(run.timers.delays.includes(5000), false);
    assert.equal(run.timers.delays.includes(15000), false);
    await pass(run, 1000);
    await deliver(run, sentFrom(chat.window, 2, false, false));
    assert.deepEqual(ford.went, []);
    run.boot.stop();
});

test('arms carry the token and nothing leaks it', async () => {
    const run = harness();
    start(run);
    await settle();
    assert.equal(run.made, 1);
    assert.equal(run.storage.values.get(TOKEN_NAME), BRIDGE);
    const chat = frameIn(run);
    const live = run.world.lives[0];
    await deliver(run, readyFrom(chat.window));
    await offer(run, live, 'Remember the mill.');
    chat.window.failing = 1;
    await offer(run, live, 'Remember the bridge.');
    run.world.keepers[0].options.notify({ kind: 'Changed' });
    await settle();
    assert.deepEqual(
        chat.window.posted.map((message) => message.token === BRIDGE),
        [true, true, true],
    );
    assert.equal(run.lines.length, 1);
    assert.equal(run.lines.some((line) => line.includes(BRIDGE)), false);
    run.boot.stop();
    const again = harness({ storage: run.storage });
    start(again);
    await settle();
    assert.equal(again.made, 0);
    assert.equal(run.storage.calls.filter((call) => call.operation === 'set' && call.name === TOKEN_NAME).length, 1);
    const second = frameIn(again);
    await deliver(again, readyFrom(second.window));
    assert.equal(second.window.posted[0].token, BRIDGE);
    again.boot.stop();
    for (const [label, refuse] of [
        ['unreadable', (storage) => storage.refuseGetsMatching(/^scribe-bridge$/)],
        ['unsaveable', (storage) => storage.refuseSetsMatching(/^scribe-bridge$/)],
    ]) {
        const broken = harness();
        refuse(broken.storage);
        start(broken);
        await settle();
        const frame = frameIn(broken);
        await deliver(broken, readyFrom(frame.window));
        await offer(broken, broken.world.lives[0], 'Remember the mill.');
        assert.equal(frame.window.posted.length, 0, label);
        assert.equal(broken.lines.length, 1, label);
        assert.equal(broken.lines[0].startsWith('The bridge to the chat frame could not be keyed: '), true, label);
        assert.equal(broken.lines[0].includes(BRIDGE), false, label);
        broken.boot.stop();
    }
    const echoing = harness();
    const plainSet = echoing.storage.set.bind(echoing.storage);
    /**
     * @param {string} name
     * @param {*} value
     * @return {void}
     * @throws {Error}
     */
    echoing.storage.set = (name, value) => {
        if (name === TOKEN_NAME) {
            throw new Error(`No room for ${value}`);
        }
        plainSet(name, value);
    };
    start(echoing);
    await settle();
    assert.deepEqual(echoing.lines, ['The bridge to the chat frame could not be keyed: the token could not be read, made or saved']);
    echoing.boot.stop();
});

test('only a real message is a message', async () => {
    const { run, chat, live, keeper } = await bridged();
    live.ready = 'Remember the mill.';
    await deliver(run, readyFrom(chat.window));
    assert.equal(chat.window.posted.length, 1);
    for (const isTrusted of [false, undefined, 'true', 1]) {
        await deliver(run, { ...sentFrom(chat.window, 1, true, true), isTrusted });
        await deliver(run, { ...readyFrom(chat.window), isTrusted });
    }
    await pass(run, 16000);
    assert.deepEqual(live.went, []);
    assert.deepEqual(keeper.ticks, []);
    assert.equal(chat.window.posted.length, 1);
    run.boot.stop();
});

test('a flood is ignored', async () => {
    const { run, chat, live, keeper } = await bridged();
    live.ready = 'Remember the mill.';
    await deliver(run, readyFrom(chat.window));
    for (let count = 0; count < 500; count++) {
        await deliver(run, sentFrom(chat.window, chat.window.posted.at(-1).seq, true, false));
    }
    assert.equal(live.went.length, 10);
    assert.equal(chat.window.posted.length, 11);
    assert.equal(run.timers.count <= 32, true, `${run.timers.count} timers`);
    await pass(run, 10000);
    assert.deepEqual(keeper.ticks, []);
    await deliver(run, sentFrom(chat.window, chat.window.posted.at(-1).seq, true, false));
    assert.equal(live.went.length, 10);
    await pass(run, 1);
    await deliver(run, sentFrom(chat.window, chat.window.posted.at(-1).seq, true, false));
    assert.equal(live.went.length, 11);
    run.boot.stop();
});

test('a full frame window admits one start for the current named reminder, across rearms', async () => {
    const { run, chat, live } = await bridged();
    await deliver(run, readyFrom(chat.window));
    for (let count = 0; count < 10; count++) {
        await deliver(run, sentFrom(chat.window, chat.window.posted.at(-1).seq, false, false));
    }
    const old = chat.window.posted.at(-1).seq;
    live.reminder = 'harbour#reminder-2';
    live.attempt = 'harbour#attempt-2';
    await offer(run, live, 'The bell rings.');
    const current = chat.window.posted.at(-1).seq;
    const identity = { index: 0, reminder: live.reminder, attempt: live.attempt };
    const start = { ...identity, kind: 'starting', submission: 'abcd1234' };
    await deliver(run, reminderSentFrom(chat.window, old, start));
    await deliver(run, reminderSentFrom(chat.window, current, { ...start, cut: 1 }));
    await deliver(run, reminderSentFrom(chat.window, current, { ...start, attempt: 'other' }));
    await deliver(run, reminderSentFrom(chat.window, current, { ...start, ready: false }));
    assert.equal(live.starting.length, 0);
    await deliver(run, reminderSentFrom(chat.window, current, start));
    await deliver(run, reminderSentFrom(chat.window, current, identity));
    assert.equal(live.starting.length, 1);
    assert.equal(live.wentLines.at(-1), live.starting[0]);
    const rearmed = chat.window.posted.at(-1).seq;
    assert.notEqual(rearmed, current);
    await deliver(run, reminderSentFrom(chat.window, rearmed, { ...start, index: 1 }));
    await deliver(run, reminderSentFrom(chat.window, rearmed, { ...identity, index: 1 }));
    assert.equal(live.starting.length, 1);
    assert.equal(live.wentLines.length, 11);
    run.boot.stop();
});

test('an explicitly cancelled reserved send rearms after its retry delay', async () => {
    const { run, chat, live } = await bridged();
    await deliver(run, readyFrom(chat.window));
    for (let count = 0; count < 10; count++) {
        await deliver(run, sentFrom(chat.window, chat.window.posted.at(-1).seq, false, false));
    }
    live.reminder = 'harbour#reminder-3';
    live.attempt = 'harbour#attempt-3';
    await offer(run, live, 'The bell rings.');
    const first = chat.window.posted.at(-1).seq;
    const identity = { index: 0, reminder: live.reminder, attempt: live.attempt };
    const start = { ...identity, kind: 'starting', submission: 'abcd1234' };
    await deliver(run, reminderSentFrom(chat.window, first, start));
    assert.equal(chat.window.posted.at(-1).ready, null);
    await deliver(run, reminderSentFrom(chat.window, first, { ...identity, kind: 'cancelled' }));
    await deliver(run, reminderSentFrom(chat.window, first, { ...start, index: 1 }));
    assert.equal(live.starting.length, 1);
    await pass(run, 1000);
    assert.equal(chat.window.posted.at(-1).ready, 'The bell rings.');
    const retry = chat.window.posted.at(-1).seq;
    await deliver(run, reminderSentFrom(chat.window, retry, start));
    await deliver(run, reminderSentFrom(chat.window, retry, identity));
    assert.equal(live.starting.length, 2);
    assert.equal(live.cancelled.length, 1);
    assert.equal(live.wentLines.length, 11);
    run.boot.stop();
});

test('a window still in the page is never pushed out', async () => {
    const { run, chat, live } = await bridged();
    live.ready = 'Remember the mill.';
    await deliver(run, readyFrom(chat.window));
    const decoys = [];
    for (let count = 0; count < 24; count++) {
        if (count === 8) {
            await offer(run, live, 'Remember the bridge.');
        }
        decoys.push(frameIn(run, { src: `https://frame.pingpong.ai/v1/index.html#run=decoy-${count}` }));
        await deliver(run, readyFrom(decoys[count].window));
    }
    await offer(run, live, 'Remember the ford.');
    assert.deepEqual(
        chat.window.posted.map((message) => message.ready),
        ['Remember the mill.', 'Remember the bridge.', 'Remember the ford.'],
    );
    assert.deepEqual(
        decoys.map((decoy) => decoy.window.posted.length),
        [3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    );
    await deliver(run, sentFrom(chat.window, chat.window.posted.at(-1).seq, true, false));
    assert.deepEqual(live.went, ['Remember the ford. | null']);
    const seventeenth = decoys[15];
    run.document.frames.splice(run.document.frames.indexOf(decoys[0].element), 1);
    await deliver(run, readyFrom(seventeenth.window));
    assert.deepEqual(
        seventeenth.window.posted.map((message) => message.ready),
        ['Remember the ford.'],
    );
    assert.equal(decoys[16].window.posted.length, 0);
    run.boot.stop();
});

test('the token is read when it is used', async () => {
    const { run, chat, live } = await bridged();
    await deliver(run, readyFrom(chat.window));
    run.storage.values.set(TOKEN_NAME, OTHER);
    await offer(run, live, 'Remember the mill.');
    assert.deepEqual(
        chat.window.posted.map((message) => message.token),
        [BRIDGE, OTHER],
    );
    const remade = 'remade-token-test-0123456789';
    /**
     * @return {string}
     */
    run.environment.random = () => remade;
    run.storage.values.set(TOKEN_NAME, 'z'.repeat(15));
    await offer(run, live, 'Remember the bridge.');
    assert.equal(chat.window.posted.at(-1).token, remade);
    assert.equal(run.storage.values.get(TOKEN_NAME), remade);
    run.boot.stop();
    const made = 'made-token-test-0123456789';
    for (const [label, stored] of [
        ['fifteen', 'x'.repeat(15)],
        ['two hundred and one', 'y'.repeat(201)],
        ['not a string', Array(20).fill('w')],
    ]) {
        const fresh = harness({ made });
        fresh.storage.values.set(TOKEN_NAME, stored);
        start(fresh);
        await settle();
        assert.equal(fresh.storage.values.get(TOKEN_NAME), made, label);
        const frame = frameIn(fresh);
        await deliver(fresh, readyFrom(frame.window));
        assert.deepEqual(
            frame.window.posted.map((message) => message.token),
            [made],
            label,
        );
        fresh.boot.stop();
    }
    const short = harness({ made: 'short-token' });
    start(short);
    await settle();
    const frame = frameIn(short);
    await deliver(short, readyFrom(frame.window));
    await offer(short, short.world.lives[0], 'Remember the mill.');
    assert.equal(frame.window.posted.length, 0);
    assert.equal(short.storage.values.has(TOKEN_NAME), false);
    assert.deepEqual(short.lines, ['The bridge to the chat frame could not be keyed: no usable token was made']);
    /**
     * @return {string}
     */
    short.environment.random = () => made;
    await offer(short, short.world.lives[0], 'Remember the bridge.');
    assert.deepEqual(
        frame.window.posted.map((message) => message.token),
        [made],
    );
    /**
     * @return {string}
     */
    short.environment.random = () => 'short-token';
    short.storage.values.delete(TOKEN_NAME);
    await offer(short, short.world.lives[0], 'Remember the ford.');
    await offer(short, short.world.lives[0], 'Remember the weir.');
    assert.equal(frame.window.posted.length, 1);
    assert.equal(short.lines.length, 2);
    short.boot.stop();
});

test('honest sends are not dropped', async () => {
    const { run, chat, live } = await bridged();
    const other = frameIn(run, { src: 'https://frame.pingpong.ai/v1/index.html#second' });
    live.ready = 'Remember the mill.';
    live.suggestion = 'A gull cries.';
    await deliver(run, readyFrom(chat.window));
    await deliver(run, readyFrom(other.window));
    await deliver(run, sentFrom(chat.window, chat.window.posted.at(-1).seq, false, true));
    await pass(run, 80);
    await deliver(run, sentFrom(chat.window, chat.window.posted.at(-1).seq, true, false));
    assert.deepEqual(live.went, ['null | A gull cries.', 'Remember the mill. | null']);
    for (let count = 0; count < 9; count++) {
        await pass(run, 500);
        await deliver(run, sentFrom(chat.window, chat.window.posted.at(-1).seq, true, true));
    }
    assert.equal(live.went.length, 10);
    await deliver(run, sentFrom(other.window, other.window.posted.at(-1).seq, true, true));
    assert.equal(live.went.length, 11);
    /**
     * @return {number}
     */
    run.clock.now = () => run.timers.now() - 60000;
    await deliver(run, sentFrom(chat.window, chat.window.posted.at(-1).seq, true, false));
    assert.equal(live.went.length, 12);
    run.boot.stop();
});

test('a new session is armed afresh', async () => {
    const { run, chat } = await bridged();
    await deliver(run, readyFrom(chat.window));
    go(run, '/rooms/ford');
    await pass(run, 1000);
    const ford = run.world.lives[1];
    assert.equal(ford.roomId, 'ford');
    assert.deepEqual(
        chat.window.posted.map((message) => `${message.seq} ${message.ready} ${message.suggestion}`),
        ['1 null null', '2 null null', '3 null null'],
    );
    await deliver(run, sentFrom(chat.window, 3, false, false));
    assert.deepEqual(ford.went, ['null | null']);
    run.boot.stop();
});

test('no token in a log line', async () => {
    const locked = harness();
    locked.storage.values.set(TOKEN_NAME, BRIDGE);
    const plainGet = locked.storage.get.bind(locked.storage);
    /**
     * @param {string} name
     * @param {*} fallback
     * @return {*}
     * @throws {Error}
     */
    locked.storage.get = (name, fallback) => {
        if (name === TOKEN_NAME) {
            throw new Error(`storage is locked; last value ${BRIDGE}`);
        }
        return plainGet(name, fallback);
    };
    start(locked);
    await settle();
    assert.equal(locked.lines.length, 1);
    assert.equal(locked.lines[0].includes(BRIDGE), false);
    locked.boot.stop();
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    run.storage.values.set(TOKEN_NAME, OTHER);
    const plainSet = run.storage.set.bind(run.storage);
    /**
     * @param {string} name
     * @param {*} value
     * @return {void}
     * @throws {Error}
     */
    run.storage.set = (name, value) => {
        if (name.includes('spent')) {
            throw new Error(`storage is full; ${TOKEN_NAME}=${OTHER}`);
        }
        plainSet(name, value);
    };
    const scene = run.world.lives[0].options.ask(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    answer(run.sent.calls[0], 200, completion('The scene.', 3));
    assert.equal((await scene).cost, 3);
    assert.equal(run.lines.some((line) => line.startsWith('The spending could not be saved')), true);
    assert.equal(run.lines.some((line) => line.includes(OTHER)), false);
    run.boot.stop();
});

test('a failing post is logged once', async () => {
    const { run, chat, live } = await bridged();
    const other = frameIn(run, { src: 'https://frame.pingpong.ai/v1/index.html#second' });
    await deliver(run, readyFrom(chat.window));
    await deliver(run, readyFrom(other.window));
    chat.window.failing = 5;
    other.window.failing = 1;
    for (let step = 1; step <= 5; step++) {
        await offer(run, live, `Step ${step}.`);
    }
    assert.equal(run.lines.length, 2);
    assert.equal(chat.window.posted.length, 1);
    assert.equal(other.window.posted.length, 5);
    await offer(run, live, 'Step 6.');
    assert.equal(chat.window.posted.at(-1).ready, 'Step 6.');
    chat.window.failing = 1;
    await offer(run, live, 'Step 7.');
    assert.equal(run.lines.length, 3);
    run.boot.stop();
});

test('an arm that could not be posted is tried again', async () => {
    const { run, chat, live, keeper } = await bridged();
    live.ready = 'Remember the mill.';
    await deliver(run, readyFrom(chat.window));
    chat.window.failing = 1;
    await offer(run, live, 'Remember the bridge.');
    assert.equal(chat.window.posted.length, 1);
    assert.equal(run.lines.length, 1);
    assert.equal(run.lines[0].startsWith('The chat frame could not be armed: '), true);
    keeper.options.notify({ kind: 'Changed' });
    await settle();
    assert.deepEqual(
        chat.window.posted.map((message) => message.ready),
        ['Remember the mill.', 'Remember the bridge.'],
    );
    run.boot.stop();
});

test('eight arms are kept for a window', async () => {
    const { run, chat, live } = await bridged();
    live.ready = 'Step 0.';
    await deliver(run, readyFrom(chat.window));
    for (let step = 1; step <= 9; step++) {
        await offer(run, live, `Step ${step}.`);
    }
    assert.equal(chat.window.posted.length, 10);
    const ninth = chat.window.posted.at(-9);
    await deliver(run, sentFrom(chat.window, ninth.seq, true, false));
    assert.deepEqual(live.went, []);
    await pass(run, 1000);
    const eighth = chat.window.posted.at(-8);
    await deliver(run, sentFrom(chat.window, eighth.seq, true, false));
    assert.deepEqual(live.went, [`${eighth.ready} | null`]);
    run.boot.stop();
});

test('a session that finishes building arms at once', async () => {
    const run = harness();
    run.world.plans.push(HOLD);
    run.world.offerAtOpen = 'Remember the mill.';
    start(run);
    await settle();
    const chat = frameIn(run);
    await deliver(run, readyFrom(chat.window));
    assert.deepEqual(
        chat.window.posted.map((message) => message.ready),
        [null],
    );
    run.world.keepers[0].finish();
    await settle();
    assert.deepEqual(
        chat.window.posted.map((message) => message.ready),
        [null, 'Remember the mill.'],
    );
    run.boot.stop();
});

test('the start gives each role only what it needs', async () => {
    const framed = startIn({ origin: PINGPONG, top: false, ancestors: [ZETA], parented: true }, BRIDGE);
    assert.equal(framed.framed, 1);
    assert.deepEqual([...Object.keys(framed.options)].sort(), ['document', 'token', 'watch', 'window']);
    assert.equal(framed.storage, 0);
    assert.equal(framed.options.token(), BRIDGE);
    assert.deepEqual(framed.asked, [TOKEN_NAME]);
    const topless = startIn({ origin: PINGPONG, top: true, ancestors: undefined, parented: false });
    assert.deepEqual([topless.booted, topless.framed, topless.storage], [0, 0, 0]);
    const top = startIn({ origin: ZETA, top: true, ancestors: [], parented: false });
    assert.equal(top.booted, 1);
    assert.equal(top.environment.random(), 'a-random-value-0123456789');
    const cloned = [];
    /**
     * @param {object} value
     * @return {object}
     */
    const clone = (value) => {
        cloned.push(value.kind);
        return { ...value };
    };
    const { run, chat } = await bridged({ clone });
    await deliver(run, readyFrom(chat.window));
    assert.deepEqual(cloned, ['arm']);
    assert.equal(chat.window.posted.length, 1);
    run.boot.stop();
});

test('the day is the local date', () => {
    assert.equal(ScribeBoot.day(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(ScribeBoot.day(new Date(2026, 10, 15, 0, 1)), '2026-11-15');
    assert.equal(ScribeBoot.day(new Date(2026, 11, 31, 12, 0)), '2026-12-31');
});

const DM_KEY = 'Fictional-DM-Key-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdefghijkl';

test('the DM API key is set from the menu, once per page', async () => {
    const run = harness();
    const menus = [];
    run.environment.menu = (label, action) => {
        menus.push({ label, action, written: run.storage.calls.filter((call) => call.operation === 'set').map((call) => call.name) });
    };
    start(run);
    await settle();
    assert.equal(menus.length, 1);
    assert.equal(menus[0].label, 'Set DM API key');
    assert.deepEqual(menus[0].written, [TOKEN_NAME]);
    const action = menus[0].action;
    const sets = () => run.storage.count('set');
    const before = sets();
    action();
    await settle();
    assert.deepEqual(run.asked, ['prompt Enter DM API key']);
    assert.equal(sets(), before);
    for (const typed of ['k'.repeat(59), 'k'.repeat(255), `${'k'.repeat(59)}é`, `${'k'.repeat(30)} ${'k'.repeat(30)}`, '']) {
        run.asked = [];
        run.typed.push(typed);
        action();
        await settle();
        assert.deepEqual(run.asked, ['prompt Enter DM API key', 'alert Enter 60–254 visible ASCII characters.'], typed.slice(0, 5));
        assert.equal(sets(), before);
        assert.equal(ScribeStore.cloudKey(run.storage), '');
    }
    const cloud = run.world.clouds[0];
    const keeper = run.world.keepers[0];
    const ticks = cloud.ticks.length;
    assert.equal(run.storage.values.has('scribe:browser'), false);
    run.asked = [];
    run.typed.push(DM_KEY);
    action();
    await settle();
    assert.deepEqual(run.asked, ['prompt Enter DM API key']);
    assert.equal(ScribeStore.cloudKey(run.storage), DM_KEY);
    assert.equal(run.storage.values.get('scribe:browser'), BRIDGE);
    const written = run.storage.calls.filter((call) => call.operation === 'set').map((call) => call.name);
    assert.deepEqual(written.slice(-2), ['scribe:browser', 'scribe:cloudkey']);
    assert.equal(cloud.ticks.length, ticks + 1);
    assert.equal(keeper.ticks.length, 1);
    const saved = sets();
    run.typed.push(DM_KEY);
    action();
    await settle();
    assert.equal(sets(), saved);
    run.storage.refuseSetsMatching(/^scribe:cloudkey$/);
    run.typed.push(`${DM_KEY}-2`);
    action();
    await settle();
    run.storage.allow();
    assert.deepEqual(run.lines, ['The book could not be synced: The key could not be saved']);
    assert.equal(run.lines.some((line) => line.includes(DM_KEY)), false);
    const again = ScribeBoot.start(run.environment);
    assert.equal(menus.length, 1);
    again.stop();
    run.boot.stop();
});

test('the cloud opens before the keeper, ticks before it and closes with the session', async () => {
    const run = harness();
    start(run);
    await settle();
    assert.equal(run.world.clouds.length, 1);
    const cloud = run.world.clouds[0];
    const keeper = run.world.keepers[0];
    const live = run.world.lives[0];
    const panel = run.world.panels[0];
    assert.equal(cloud.keepersAtOpen, 0);
    assert.equal(cloud.options.storage === run.storage, true);
    assert.equal(cloud.options.roomId, 'harbour');
    assert.equal(cloud.options.notesRoom, '/rooms/harbour');
    assert.equal(cloud.options.xmlHttpRequest === run.environment.xmlHttpRequest, true);
    assert.equal(cloud.options.clock === run.clock, true);
    assert.equal(cloud.options.random === run.environment.random, true);
    assert.equal(panel.options.cloud === cloud.handle, true);
    assert.deepEqual(cloud.ticks, [0]);
    await pass(run, 40000);
    assert.deepEqual(keeper.ticks, [20000, 40000]);
    assert.deepEqual(cloud.ticks, [0, 0, 1]);
    assert.equal(keeper.options.lease(), true);
    run.world.leads = false;
    assert.equal(keeper.options.lease(), false);
    const stirs = cloud.stirs;
    keeper.options.notify({ kind: 'Changed' });
    live.options.notify();
    await settle();
    assert.equal(cloud.stirs, stirs + 2);
    const redraws = panel.redraws;
    cloud.options.notify();
    await settle();
    assert.equal(panel.redraws, redraws + 1);
    assert.equal(keeper.ticks.length, 3);
    let fired = 0;
    cloud.options.later(1000, () => {
        fired++;
    });
    await pass(run, 999);
    assert.equal(fired, 0);
    await pass(run, 1);
    assert.equal(fired, 1);
    assert.equal(cloud.options.reader(), true);
    run.storage.remove('scribe:claim:harbour');
    assert.equal(cloud.options.chosen(), false);
    ScribeStore.claim(run.storage, 'harbour', 'tab-one', run.timers.now());
    assert.equal(cloud.options.chosen(), true);
    ScribeStore.claim(run.storage, 'harbour', 'tab-two', run.timers.now() + 100000);
    assert.equal(cloud.options.chosen(), false);
    assert.equal(cloud.options.reader(), false);
    assert.equal(cloud.options.busy(), false);
    assert.equal(cloud.options.reading(), false);
    keeper.phase = 'Reading';
    assert.equal(cloud.options.reading(), true);
    go(run, '/rooms/quay');
    await pass(run, 1000);
    assert.equal(cloud.closes, 1);
    assert.equal(keeper.closes, 1);
    assert.equal(run.world.clouds.length, 2);
    assert.equal(run.world.clouds[1].roomId, 'quay');
    assert.equal(run.world.clouds[1].options.notesRoom, '/rooms/quay');
    const ticked = cloud.ticks.length;
    await pass(run, 40000);
    assert.equal(cloud.ticks.length, ticked);
    run.boot.stop();
    assert.equal(run.world.clouds[1].closes, 1);
    const locked = harness({ locks: lockManager(true, []) });
    start(locked);
    await pass(locked, 3000);
    assert.equal(locked.world.clouds[0].options.chosen(), true);
    locked.boot.stop();
});

test('a model call carries the operator notes only when the cloud has some, and the DM key never goes out', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    ScribeStore.setCloudKey(run.storage, DM_KEY);
    const ask = run.world.keepers[0].options.ask;
    const live = run.world.lives[0].options.ask;
    const users = [];
    for (const notes of [null, '', 'The ferry stops at dusk.\nNobody crosses at night.']) {
        run.world.notes = notes;
        for (const asking of [ask, live]) {
            const pending = asking(ScribeBoot.Role.Scribe, SYSTEM, USER);
            await settle();
            const call = run.sent.calls.at(-1);
            users.push(JSON.parse(call.details.data).messages[1].content);
            answer(call, 200, completion('An answer.', 0.01));
            await pending;
        }
    }
    const told = `${USER}\n\nOPERATOR NOTES:\nThe ferry stops at dusk.\nNobody crosses at night.`;
    assert.deepEqual(users, [USER, USER, USER, USER, told, told]);
    for (const call of run.sent.calls) {
        assert.equal(JSON.stringify(call.details).includes(DM_KEY), false);
        assert.equal(call.details.url, ENDPOINT);
    }
    const failing = failureOf(ask(ScribeBoot.Role.Scribe, SYSTEM, USER));
    await settle();
    answer(run.sent.calls.at(-1), 401, `{"error":"bad key ${DM_KEY}"}`);
    await failing;
    assert.equal(run.lines.some((line) => line.includes(DM_KEY) || line.includes(KEY)), false);
    run.boot.stop();
});

test('key and spend preflight failures carry the local source without sending either kind of model call', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const book = run.world.keepers[0].options.ask;
    const live = run.world.lives[0].options.ask;
    run.storage.refuseGetsMatching(/^scribe:key$/);
    for (const ask of [book, live]) {
        const failure = await failureOf(ask(ScribeBoot.Role.Scribe, SYSTEM, USER));
        assert.equal(failure.source, 'Scribe');
    }
    run.storage.allow();
    run.storage.refuseGetsMatching(/^scribe:spent:/);
    assert.equal((await failureOf(live(ScribeBoot.Role.Scribe, SYSTEM, USER))).source, 'Scribe');
    assert.equal(run.sent.calls.length, 0);
    run.storage.allow();
    const denied = failureOf(book(ScribeBoot.Role.Analyzer, SYSTEM, USER));
    await settle();
    answer(run.sent.calls.at(-1), 401, '{"error":"unauthorized"}');
    assert.equal((await denied).source, 'OpenRouter');
    assert.equal(run.sent.calls.length, 1);
    run.boot.stop();
});

test('the budget counts what the other PCs spent', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const live = run.world.lives[0].options.ask;
    ScribeStore.spend(run.storage, 'harbour', DAY, 1);
    ScribeStore.setOthers(run.storage, 'harbour', DAY, 2);
    const refused = failureOf(live(ScribeBoot.Role.Scribe, SYSTEM, USER));
    await settle();
    assert.equal((await refused).message, "The day's budget is spent");
    assert.equal(run.sent.calls.length, 0);
    ScribeStore.setOthers(run.storage, 'harbour', DAY, 1.99);
    const allowed = live(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 1);
    answer(run.sent.calls[0], 200, completion('Under the line.', 0.5));
    await allowed;
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 1.5);
    assert.equal(ScribeStore.others(run.storage, 'harbour', DAY), 1.99);
    ScribeStore.setOthers(run.storage, 'harbour', NEXT_DAY, 5);
    const elsewhere = live(ScribeBoot.Role.Scribe, SYSTEM, USER);
    await settle();
    assert.equal(run.sent.calls.length, 2);
    answer(run.sent.calls[1], 200, completion('Another day counts apart.', 0.1));
    await elsewhere;
    run.boot.stop();
});

test('text calls prepend BACKGROUND once before user content and keep historicalCheck strict JSON', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    const background = 'BACKGROUND:\n\nSTORY SETUP:\nHarbour Lights.';
    run.world.setupResult = { text: background, storyText: 'Harbour Lights.', profileText: null, shown: 15, whole: 15, source: null, persona: null };
    run.world.notes = 'Keep the lantern lit.';
    const keeper = run.world.keepers[0].options;
    const live = run.world.lives[0].options;
    const payloads = [];
    for (const invoke of [
        () => keeper.ask(ScribeBoot.Role.Analyzer, SYSTEM, USER),
        () => live.ask(ScribeBoot.Role.Scribe, SYSTEM, USER, false),
        () => live.ask(ScribeBoot.Role.Pedant, SYSTEM, USER, false),
        () => live.ask(ScribeBoot.Role.Scribe, SYSTEM, USER, true),
    ]) {
        const pending = invoke();
        await settle();
        const call = run.sent.calls.at(-1);
        payloads.push(JSON.parse(call.details.data).messages[1].content);
        answer(call, 200, completion('OK', 0.01));
        await pending;
    }
    const expectedText = `${background}\n\n${USER}\n\nOPERATOR NOTES:\nKeep the lantern lit.`;
    for (const content of payloads) {
        assert.equal(content, expectedText);
    }
    const strictJson = JSON.stringify({ page: 1, storySetup: 'Harbour Lights.' });
    const checkerCall = keeper.askChecker(SYSTEM, strictJson);
    await settle();
    const sentChecker = JSON.parse(run.sent.calls.at(-1).details.data).messages[1].content;
    assert.equal(sentChecker, strictJson);
    assert.deepEqual(JSON.parse(sentChecker), { page: 1, storySetup: 'Harbour Lights.' });
    answer(run.sent.calls.at(-1), 200, completion('{}', 0.01));
    await checkerCall;
    run.boot.stop();
});

test('Pause, Force stop, and room close abort a stalled setup() wait immediately without billing or leaking secrets', async () => {
    const run = harness();
    start(run);
    await settle();
    ScribeStore.setKey(run.storage, KEY);
    let releaseSetup = null;
    run.world.setupHold = new Promise((resolve) => {
        releaseSetup = resolve;
    });
    const panelCalls = run.world.panels[0].options.calls;
    const liveAsk = run.world.lives[0].options.ask;
    const waiting = failureOf(liveAsk(ScribeBoot.Role.Scribe, SYSTEM, USER));
    assert.equal(panelCalls.due(), true);
    panelCalls.stop();
    const stoppedError = await waiting;
    assert.equal(stoppedError.message, 'The book is paused');
    assert.equal(stoppedError.stopped, 0);
    assert.equal(run.sent.calls.length, 0);
    assert.equal(ScribeStore.spent(run.storage, 'harbour', DAY), 0);
    assert.equal(panelCalls.due(), false);
    releaseSetup({ text: 'Late' });
    await settle();

    run.world.keepers[0].stop = null;
    run.world.setupHold = null;
    run.world.setupFailure = new Error(`setup blew up with ${KEY}`);
    const failedSetup = await failureOf(liveAsk(ScribeBoot.Role.Scribe, SYSTEM, USER));
    assert.equal(failedSetup.stopped, 0);
    assert.equal(failedSetup.message.includes(KEY), false);
    assert.equal(run.sent.calls.length, 0);

    run.world.setupFailure = null;
    let releaseClose = null;
    run.world.setupHold = new Promise((resolve) => {
        releaseClose = resolve;
    });
    const leaving = failureOf(liveAsk(ScribeBoot.Role.Scribe, SYSTEM, USER));
    go(run, '/');
    await pass(run, 1000);
    const leftError = await leaving;
    assert.equal(leftError.message, 'The chat has been left');
    assert.equal(leftError.stopped, 0);
    assert.equal(run.sent.calls.length, 0);
    releaseClose({ text: 'After leave' });
    await settle();
    run.boot.stop();
});

test('plot-page routing mounts, switches, retries document-start, shields keys, and cleans up timers/listeners', async () => {
    const run = harness({ path: '/' });
    const panelDocument = new PanelDocument(1280);
    panelDocument.body = null;
    panelDocument.visibilityState = 'visible';
    panelDocument.documentElement = rootElement();
    panelDocument.listeners = [];
    panelDocument.addEventListener = (type, listener) => {
        panelDocument.listeners.push({ type, listener });
    };
    panelDocument.removeEventListener = (type, listener) => {
        panelDocument.listeners = panelDocument.listeners.filter((entry) => entry.type !== type || entry.listener !== listener);
    };
    panelDocument.querySelectorAll = () => [];
    run.document = panelDocument;
    run.environment.document = panelDocument;
    const downloads = [];
    run.environment.download = (name, text) => downloads.push({ name, text });
    let customAbortConstructed = 0;
    class PageAbortController extends AbortController {
        constructor() {
            super();
            customAbortConstructed++;
        }
    }
    run.page.AbortController = PageAbortController;
    const site = new FakeZeta([], 'other-room', TOKEN);
    site.plot = 'p1';
    site.plotName = 'Lantern Wharf';
    site.about = 'Plot-only about text.';
    site.characters = [{ name: 'Mavan', description: 'Watcher.' }];
    run.page.answer = (url, options) => site.fetch(url, options);

    start(run);
    await settle();
    assert.equal(run.world.keepers.length, 0);

    go(run, '/en/plots/p1/profile?fromRoom=true');
    await pass(run, 1000);
    assert.equal(panelDocument.listeners.some((entry) => entry.type === 'DOMContentLoaded'), true);

    go(run, '/');
    await pass(run, 1000);
    assert.equal(panelDocument.listeners.some((entry) => entry.type === 'DOMContentLoaded'), false);

    go(run, '/en/plots/p1/profile');
    await pass(run, 1000);
    assert.equal(panelDocument.listeners.some((entry) => entry.type === 'DOMContentLoaded'), true);
    panelDocument.body = panelDocument.createElement('body');
    for (const entry of [...panelDocument.listeners]) {
        if (entry.type === 'DOMContentLoaded') {
            entry.listener({ type: 'DOMContentLoaded' });
        }
    }
    await settle();
    assert.equal(panelDocument.listeners.some((entry) => entry.type === 'DOMContentLoaded'), false);
    const firstHost = panelDocument.body.children.find((child) => child.id === ScribePlotExport.Settings.HostId);
    assert.notEqual(firstHost, undefined);

    const shielded = key(run, 'keydown', { path: [firstHost] });
    assert.equal(shielded.stops, 1);

    await run.page.fetch(`${API}/v2/plots/p1/likes/summary`, { headers: { Authorization: TOKEN } });
    const button = firstHost.shadow.descendants().find((element) => element.id === ScribePlotExport.Settings.ButtonId);
    button.click();
    await settle();
    await settle();
    assert.equal(customAbortConstructed, 1);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].name, 'zeta-plot-lantern-wharf.json');
    const parsed = JSON.parse(downloads[0].text);
    assert.equal(parsed.chat, null);
    assert.equal(parsed.plot.about, 'Plot-only about text.');

    go(run, '/plots/p2/profile');
    await pass(run, 1000);
    const secondHost = panelDocument.body.children.find((child) => child.id === ScribePlotExport.Settings.HostId);
    assert.notEqual(secondHost, undefined);
    assert.notEqual(secondHost, firstHost);
    assert.equal(panelDocument.body.children.includes(firstHost), false);

    go(run, '/rooms/harbour');
    await pass(run, 1000);
    assert.equal(panelDocument.body.children.includes(secondHost), false);
    assert.equal(run.world.keepers.length, 1);

    go(run, '/');
    await pass(run, 1000);
    assert.equal(run.world.keepers[0].closes, 1);
    run.boot.stop();
});

test('both token-before-adopt and token-after-adopt trigger ensureCast on booked rooms only', async () => {
    const beforeAdopt = harness();
    beforeAdopt.world.booked = false;
    start(beforeAdopt);
    await settle();
    await beforeAdopt.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: TOKEN } });
    await pass(beforeAdopt, 1000);
    assert.equal(beforeAdopt.world.lives[0].ensureCasts, 0);
    beforeAdopt.world.keepers[0].booked = true;
    beforeAdopt.world.keepers[0].options.notify({ kind: 'Changed' });
    assert.equal(beforeAdopt.world.lives[0].ensureCasts, 1);
    beforeAdopt.boot.stop();

    const afterAdopt = harness();
    afterAdopt.world.booked = true;
    start(afterAdopt);
    await settle();
    await pass(afterAdopt, 1000);
    assert.equal(afterAdopt.world.lives[0].ensureCasts, 0);
    await afterAdopt.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: TOKEN } });
    await pass(afterAdopt, 1000);
    assert.equal(afterAdopt.world.lives[0].ensureCasts, 1);
    afterAdopt.boot.stop();
});

test('ScribeBoot.exportPlot resolves introId, falls back on /v1/plots error, respects cleared notes, paginates history, and rejects incomplete history', async () => {
    const messages = FakeZeta.messages(35);
    const site = new FakeZeta(messages, 'harbour', TOKEN);
    site.most = 100;
    site.plot = 'plot-9';
    site.plotName = 'Harbour Lights';
    site.roomTitle = 'Harbour Room';
    site.about = 'Full plot about.';
    site.introId = 'intro-2';
    site.intros = [
        { id: 'intro-1', conversation: { messages: [{ content: 'First intro', senderId: '_NARRATOR_' }] } },
        { id: 'intro-2', conversation: { messages: [{ content: 'Second intro', senderId: '_NARRATOR_' }] } },
    ];
    site.characters = [{ id: 'c1', name: 'Mavan', description: 'Keeper.' }];
    const run = harness();
    run.page.answer = (url, options) => site.fetch(url, options);
    start(run);
    await settle();
    await run.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: TOKEN } });
    const exportPlot = run.world.panels[0].options.exportPlot;

    run.world.notesChecked = true;
    run.world.rawNotes = null;
    run.world.setupRecord = { story: null, profile: null, notes: 'stale saved notes' };
    const progress = [];
    const controller = new AbortController();
    const firstExport = exportPlot(controller.signal, (count) => progress.push(count));
    await pass(run, 1000);
    const bundleInput = await firstExport;
    assert.equal(bundleInput.plot.about, 'Full plot about.');
    assert.equal(bundleInput.introId, 'intro-2');
    assert.equal(bundleInput.plot.opening[0].text, 'Second intro');
    assert.equal(bundleInput.profile.name, 'Orla');
    assert.equal(bundleInput.notes, null);
    assert.equal(bundleInput.chat.completeHistory, true);
    assert.equal(bundleInput.chat.messages.length, 35);
    assert.deepEqual(progress, [31, 35]);

    site.plotFailure = 500;
    const cachedStory = {
        plotId: 'plot-9',
        name: 'Harbour Lights',
        summary: 'Short.',
        description: 'Long.',
        about: '',
        creatorComment: '',
        language: 'en',
        mode: 'STORY',
        hashtags: [],
        characters: [],
        chatProfiles: [],
        opening: [{ speaker: 'Narrator', text: 'Cached intro' }],
        lore: [],
        raw: {},
        roomTitle: 'Harbour Room',
        introId: 'intro-2',
    };
    run.world.setupRecord = { story: cachedStory, profile: null, notes: 'kept notes' };
    run.world.liveSetupView = { profileRead: true };
    run.world.notesChecked = false;
    const requestsBeforeFallback = site.requests.length;
    const fallbackPromise = exportPlot(new AbortController().signal);
    await pass(run, 10000);
    const fallbackResult = await fallbackPromise;
    assert.equal(fallbackResult.plot, cachedStory);
    assert.equal(fallbackResult.profile, null);
    assert.equal(fallbackResult.notes, 'kept notes');
    assert.equal(
        site.requests.slice(requestsBeforeFallback).some((entry) => entry.url.includes('user-personas/selected')),
        false,
    );

    site.plotFailure = null;
    site.messages = [];
    const emptyResult = await exportPlot(new AbortController().signal);
    assert.equal(emptyResult.chat.completeHistory, true);
    assert.deepEqual(JSON.parse(JSON.stringify(emptyResult.chat.messages)), []);

    let repeatCalls = 0;
    run.page.answer = (url, options) => {
        if (new URL(url).pathname === '/v1/rooms/harbour/messages') {
            repeatCalls++;
            return Promise.resolve(
                FakeZeta.reply(
                    200,
                    JSON.stringify({
                        messages: [FakeZeta.message(`repeat-${repeatCalls}`, FakeZeta.time(10 - repeatCalls))],
                        nextCursor: 'stuck-cursor',
                    }),
                ),
            );
        }
        return site.fetch(url, options);
    };
    const repeatPromise = failureOf(exportPlot(new AbortController().signal));
    await pass(run, 2000);
    assert.equal((await repeatPromise).message, 'Chat history was incomplete (RepeatedCursor).');

    site.messages = FakeZeta.messages(35);
    let pageCalls = 0;
    run.page.answer = (url, options) => {
        if (new URL(url).pathname === '/v1/rooms/harbour/messages') {
            pageCalls++;
            if (pageCalls >= 2) {
                return Promise.resolve(FakeZeta.reply(500, 'Boom'));
            }
        }
        return site.fetch(url, options);
    };
    const pageTwoPromise = failureOf(exportPlot(new AbortController().signal));
    await pass(run, 10000);
    assert.match((await pageTwoPromise).message, /^Chat history was incomplete: /);

    run.page.answer = (url, options) => {
        if (new URL(url).pathname === '/v1/rooms/harbour/messages') {
            return Promise.resolve(
                FakeZeta.reply(
                    200,
                    JSON.stringify({
                        messages: [FakeZeta.message('m1', FakeZeta.time(1)), { bad: true }],
                        nextCursor: null,
                    }),
                ),
            );
        }
        return site.fetch(url, options);
    };
    const skippedError = await failureOf(exportPlot(new AbortController().signal));
    assert.equal(skippedError.message, 'Chat history was incomplete (1 unreadable message skipped).');

    let nothingNewCalls = 0;
    run.page.answer = (url, options) => {
        if (new URL(url).pathname === '/v1/rooms/harbour/messages') {
            nothingNewCalls++;
            return Promise.resolve(
                FakeZeta.reply(
                    200,
                    JSON.stringify({
                        messages: [FakeZeta.message('m1', FakeZeta.time(1))],
                        nextCursor: `cursor-${nothingNewCalls}`,
                    }),
                ),
            );
        }
        return site.fetch(url, options);
    };
    const nothingNewPromise = failureOf(exportPlot(new AbortController().signal));
    await pass(run, 1000);
    assert.equal((await nothingNewPromise).message, 'Chat history was incomplete (NothingNew).');

    run.page.answer = (url, options) => site.fetch(url, options);
    const abortDuringHistory = new AbortController();
    const abortingPromise = failureOf(exportPlot(abortDuringHistory.signal));
    await settle();
    abortDuringHistory.abort();
    const abortError = await abortingPromise;
    assert.equal(abortError.name, 'AbortError');

    run.page.answer = (url, options) => {
        if (new URL(url).pathname === '/v1/plots/plot-9') {
            return new Promise((resolve) => {
                go(run, '/');
                resolve(FakeZeta.reply(404, 'Late plot error'));
            });
        }
        return site.fetch(url, options);
    };
    const leftDuringPlot = await failureOf(exportPlot(new AbortController().signal));
    assert.equal(leftDuringPlot.message, 'The chat has been left');

    run.boot.stop();
});

test('malformed stored story triggers on-demand fetch, synchronous delay leaves no stranded timers, profile 500/404 and End.Limit behave cleanly, and pagehide/pageshow cycles plotSession', async () => {
    const syncListeners = [];
    const fakeSignal = {
        aborted: false,
        addEventListener: (type, listener) => syncListeners.push({ type, listener }),
        removeEventListener: (type, listener) => {
            const index = syncListeners.findIndex((entry) => entry.type === type && entry.listener === listener);
            if (index >= 0) {
                syncListeners.splice(index, 1);
            }
        },
    };
    const fakeBoot = {
        stopped: false,
        plotTimers: new Set(),
        environment: {
            timers: {
                setTimeout: (callback) => {
                    callback();
                    return 77;
                },
                clearTimeout: () => {},
            },
        },
    };
    await ScribeBoot.delay(fakeBoot, 500, fakeSignal);
    assert.equal(fakeBoot.plotTimers.size, 0);
    assert.equal(syncListeners.length, 0);

    const throwingSignal = {
        aborted: false,
        addEventListener: () => {
            throw new Error('Listener refused');
        },
        removeEventListener: () => {},
    };
    const listenerError = await failureOf(ScribeBoot.delay(fakeBoot, 500, throwingSignal));
    assert.equal(listenerError.message, 'Listener refused');
    assert.equal(fakeBoot.plotTimers.size, 0);

    const messages = FakeZeta.messages(2);
    const site = new FakeZeta(messages, 'harbour', TOKEN);
    site.most = 100;
    site.plot = 'plot-9';
    site.plotName = 'Harbour Lights';
    site.roomTitle = 'Harbour Room';
    site.about = 'Fetched plot about.';
    const run = harness();
    run.page.answer = (url, options) => site.fetch(url, options);
    start(run);
    await settle();
    await run.page.fetch(`${API}/v1/users/me`, { headers: { Authorization: TOKEN } });
    const exportPlot = run.world.panels[0].options.exportPlot;

    run.world.setupRecord = { story: { name: 'Broken stored story without plotId' }, profile: null, notes: null };
    const beforeMalformed = site.requests.length;
    const repaired = await exportPlot(new AbortController().signal);
    assert.equal(repaired.plot.plotId, 'plot-9');
    assert.equal(repaired.plot.about, 'Fetched plot about.');
    assert.equal(
        site.requests.slice(beforeMalformed).some((entry) => new URL(entry.url).pathname === '/v1/rooms/harbour'),
        true,
    );

    site.profile = null;
    run.world.setupRecord = { story: null, profile: null, notes: null };
    const noPersona = await exportPlot(new AbortController().signal);
    assert.equal(noPersona.profile, null);

    run.page.answer = (url, options) => {
        if (new URL(url).pathname.endsWith('/user-personas/selected')) {
            return Promise.resolve(FakeZeta.reply(500, 'Persona server error'));
        }
        return site.fetch(url, options);
    };
    const profileFailurePromise = failureOf(exportPlot(new AbortController().signal));
    await pass(run, 10000);
    assert.match((await profileFailurePromise).message, /HTTP 500/);

    site.profile = FakeZeta.Profile;
    let limitPages = 0;
    run.page.answer = (url, options) => {
        if (new URL(url).pathname === '/v1/rooms/harbour/messages') {
            limitPages++;
            return Promise.resolve(
                FakeZeta.reply(
                    200,
                    JSON.stringify({
                        messages: [FakeZeta.message(`limit-${limitPages}`, FakeZeta.time(limitPages))],
                        nextCursor: `limit-cursor-${limitPages}`,
                    }),
                ),
            );
        }
        return site.fetch(url, options);
    };
    const limitPromise = failureOf(exportPlot(new AbortController().signal));
    let limitDone = false;
    limitPromise.finally(() => {
        limitDone = true;
    });
    for (let step = 0; step < 3000 && !limitDone; step++) {
        await settle();
        if (limitDone) {
            break;
        }
        const next = run.timers.next;
        if (next === null) {
            break;
        }
        run.timers.advance(next - run.timers.now());
    }
    const limitError = await limitPromise;
    assert.equal(limitError.message, 'Chat history was incomplete (Limit).');
    assert.equal(limitPages, 2000);
    run.boot.stop();

    const plotRun = harness({ path: '/en/plots/p1/profile' });
    const panelDocument = new PanelDocument(1280);
    panelDocument.visibilityState = 'visible';
    panelDocument.documentElement = rootElement();
    panelDocument.listeners = [];
    panelDocument.addEventListener = (type, listener) => panelDocument.listeners.push({ type, listener });
    panelDocument.removeEventListener = (type, listener) => {
        panelDocument.listeners = panelDocument.listeners.filter((entry) => entry.type !== type || entry.listener !== listener);
    };
    panelDocument.querySelectorAll = () => [];
    plotRun.document = panelDocument;
    plotRun.environment.document = panelDocument;
    start(plotRun);
    await settle();
    assert.equal(panelDocument.body.children.some((child) => child.id === ScribePlotExport.Settings.HostId), true);
    for (const entry of [...plotRun.page.listeners]) {
        if (entry.type === 'pagehide') {
            entry.listener({ type: 'pagehide' });
        }
    }
    await settle();
    assert.equal(panelDocument.body.children.some((child) => child.id === ScribePlotExport.Settings.HostId), false);
    for (const entry of [...plotRun.page.listeners]) {
        if (entry.type === 'pageshow') {
            entry.listener({ type: 'pageshow' });
        }
    }
    await settle();
    assert.equal(panelDocument.body.children.some((child) => child.id === ScribePlotExport.Settings.HostId), true);
    plotRun.boot.stop();
});
