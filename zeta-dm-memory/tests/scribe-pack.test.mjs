import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { ScribePack } from '../scribe/pack.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HEADER = '// ==UserScript==\n// @name         Invented\n// ==/UserScript==\n';
const OPENING = '(() => {';
const CLOSING = '})();';
const COMPILE_PREFIX = 'The packed script does not compile: ';
const BAD_HEADER = 'The header is not a userscript header';
const FIRST = ScribePack.Files[0];
const FIRST_NAME = 'ScribeText';
const LAST = ScribePack.Files.at(-1);
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x2029);

/**
 * @param {string} file
 * @return {string}
 */
function nameOf(file) {
    return file.slice(file.lastIndexOf('/') + 1, -'.js'.length);
}

/**
 * @param {string} file
 * @return {string}
 */
function bodyOf(file) {
    return file === LAST ? `void ${ScribePack.Files.length};\n` : `const ${nameOf(file)} = ${ScribePack.Files.indexOf(file)};\n`;
}

/**
 * @param {Object<string, string>} changes
 * @return {Map<string, string>}
 */
function invented(changes = {}) {
    const files = new Map([[ScribePack.Settings.Header, HEADER]]);
    for (const file of ScribePack.Files) {
        files.set(file, bodyOf(file));
    }
    for (const [file, text] of Object.entries(changes)) {
        files.set(file, text);
    }
    return files;
}

/**
 * @param {Map<string, string>} files
 * @return {(relativePath: string) => string}
 */
function readerOf(files) {
    return (relativePath) => {
        if (!files.has(relativePath)) {
            throw new Error(`No such file: ${relativePath}`);
        }
        return files.get(relativePath);
    };
}

/**
 * @param {Object<string, string>} changes
 * @return {string}
 */
function built(changes = {}) {
    return ScribePack.build(readerOf(invented(changes)));
}

/**
 * @param {string} text
 * @param {string} part
 * @return {number}
 */
function count(text, part) {
    return text.split(part).length - 1;
}

/**
 * @param {string} file
 * @return {string}
 */
function markerOf(file) {
    return `/** @file ${file} */\n`;
}

test('the header comes first and unchanged', () => {
    const output = built();
    assert.equal(output.startsWith(HEADER), true);
    assert.equal(output.slice(HEADER.length).startsWith(`\n${OPENING}\n'use strict';\n${markerOf(FIRST)}`), true);
    const lines = output.split('\n');
    assert.equal(lines.at(-1), '');
    assert.equal(lines.at(-2), CLOSING);
    assert.equal(output.endsWith(`\n${CLOSING}\n`), true);
    const bare = ScribePack.build(readerOf(invented({ [ScribePack.Settings.Header]: HEADER.slice(0, -1) })));
    assert.equal(bare.startsWith(`${HEADER}\n${OPENING}\n`), true);
    assert.equal(bare.length, output.length);
});

test('the files come in order, each once', () => {
    const files = invented({ [FIRST]: `const ${FIRST_NAME} = 1;`, [ScribePack.Files[1]]: 'const ScribeCategory = 2;\n\n' });
    const output = ScribePack.build(readerOf(files));
    let from = 0;
    for (const file of ScribePack.Files) {
        const marker = markerOf(file);
        assert.equal(count(output, marker), 1, file);
        const position = output.indexOf(marker);
        assert.equal(position >= from, true, file);
        assert.equal(output.slice(position + marker.length).startsWith(files.get(file)), true, file);
        from = position + marker.length + files.get(file).length;
    }
    assert.equal(output.slice(output.indexOf(markerOf(FIRST)) + markerOf(FIRST).length).startsWith(`const ${FIRST_NAME} = 1;\n${markerOf(ScribePack.Files[1])}`), true);
    assert.equal(count(output, '/** @file '), ScribePack.Files.length);
});

test('a bad header is refused', () => {
    const headers = [
        '// @name         Invented\n// ==/UserScript==\n',
        '\n// ==UserScript==\n// ==/UserScript==\n',
        '// ==UserScript==\n// @name         Invented\n',
        '// ==UserScript==\n// ==/UserScript== \n',
        '',
    ];
    for (const header of headers) {
        assert.throws(() => ScribePack.build(readerOf(invented({ [ScribePack.Settings.Header]: header }))), { name: 'Error', message: BAD_HEADER }, header);
    }
});

test('a module is refused', () => {
    const lines = ["import x from 'y';", '  export const ScribeText = 1;', "const ScribeText = require('x');", 'export default 1;'];
    for (const line of lines) {
        const text = line.includes('const ScribeText') ? `${line}\n` : `const ScribeText = 1;\n${line}\n`;
        assert.throws(() => built({ [FIRST]: text }), { message: `A source file is a module, not a script: ${FIRST}` }, line);
    }
    const other = ScribePack.Files[3];
    assert.throws(() => built({ [other]: `const ScribeAnswer = 1;\nimport { x } from 'y';\n` }), { message: `A source file is a module, not a script: ${other}` });
    assert.equal(built({ [FIRST]: 'const ScribeText = 1;\nimportant = 2;\nexported = 3;\n' }).length > 0, true);
});

test('an empty or misnamed file is refused', () => {
    const second = ScribePack.Files[1];
    assert.throws(() => built({ [second]: '' }), { message: `A source file is empty: ${second}` });
    assert.throws(() => built({ [second]: '\n  \n' }), { message: `A source file is empty: ${second}` });
    assert.throws(() => built({ [second]: 'const Other = 1;\n' }), { message: `A source file does not declare its object: ${second}` });
    assert.throws(() => built({ [second]: 'const ScribeCategoryExtra = 1;\n' }), { message: `A source file does not declare its object: ${second}` });
    assert.throws(() => built({ [second]: 'let ScribeCategory = 1;\n' }), { message: `A source file does not declare its object: ${second}` });
    assert.throws(() => built({ [LAST]: '' }), { message: `A source file is empty: ${LAST}` });
    assert.equal(built({ [LAST]: 'void 0;\n' }).length > 0, true);
    assert.equal(built({ [second]: '// first\nconst ScribeCategory = 1;\n' }).length > 0, true);
});

test('a line separator is refused', () => {
    for (const separator of [LINE_SEPARATOR, PARAGRAPH_SEPARATOR]) {
        const text = `const ScribeText = 'a${separator}b';\n`;
        assert.throws(() => built({ [FIRST]: text }), { message: `A source file holds a line separator the browser would break on: ${FIRST}` });
    }
    assert.throws(() => built({ [LAST]: `void 0; // a${LINE_SEPARATOR}b\n` }), { message: `A source file holds a line separator the browser would break on: ${LAST}` });
});

test('carriage returns are removed', () => {
    const files = invented();
    const crlf = new Map();
    for (const [file, text] of files) {
        crlf.set(file, text.replaceAll('\n', '\r\n'));
    }
    crlf.set(FIRST, `const ${FIRST_NAME} =\r 1;\r\n`);
    files.set(FIRST, `const ${FIRST_NAME} = 1;\n`);
    const output = ScribePack.build(readerOf(crlf));
    assert.equal(output.includes('\r'), false);
    assert.equal(output === ScribePack.build(readerOf(files)), true);
});

test('the packed script must compile', () => {
    assert.throws(() => built({ [FIRST]: 'const ScribeText = ;\n' }), (error) => {
        assert.equal(error instanceof Error, true);
        assert.equal(error.message.startsWith(COMPILE_PREFIX), true);
        assert.equal(error.message.length > COMPILE_PREFIX.length, true);
        return true;
    });
    assert.throws(() => built({ [LAST]: 'void 0; }\n' }), (error) => error.message.startsWith(COMPILE_PREFIX));
});

test('a missing file passes through with its path', () => {
    const files = invented();
    files.delete(ScribePack.Files[5]);
    assert.throws(() => ScribePack.build(readerOf(files)), { message: `No such file: ${ScribePack.Files[5]}` });
    files.delete(ScribePack.Settings.Header);
    assert.throws(() => ScribePack.build(readerOf(files)), { message: `No such file: ${ScribePack.Settings.Header}` });
});

test('the real files pack and compile', () => {
    const output = ScribePack.build((relativePath) => readFileSync(`${ROOT}${relativePath}`, 'utf8'));
    assert.equal(output.length > 0, true);
    assert.doesNotThrow(() => new vm.Script(output));
    for (const file of ScribePack.Files) {
        assert.equal(count(output, markerOf(file)), 1, file);
    }
    assert.equal(count(output, '/** @file '), ScribePack.Files.length);
    assert.equal(/^ *(import|export) /m.test(output), false);
    assert.equal(output.startsWith('// ==UserScript==\n'), true);
    assert.equal(output.endsWith(`\n${CLOSING}\n`), true);
});

/**
 * @param {string} relativePath
 * @return {string}
 */
function realRead(relativePath) {
    return readFileSync(`${ROOT}${relativePath}`, 'utf8');
}

/**
 * @param {string} output
 * @param {{ path?: string, body?: object|null, navigator?: object, uuids?: string[], date?: Function, extras?: object, observe?: boolean }} choices
 * @return {{ page: object, original: Function, requests: object[], timers: Array<[string, number]>, logs: string[], added: string[], seen: object[], context: object, run: () => void }}
 */
function stage(output, choices = {}) {
    const store = new Map();
    const seen = [];
    const marks = new Map();
    const documentAdded = [];
    const documentRemoved = [];
    const uuids = [...(choices.uuids ?? ['tab-invented'])];
    const requests = [];
    const timers = [];
    const logs = [];
    const original = () => 'the page fetch';
    const added = [];
    const removed = [];
    const page = {
        location: { pathname: choices.path ?? '/' },
        fetch: original,
        AbortController,
        addEventListener: (type) => {
            added.push(type);
        },
        removeEventListener: (type) => {
            removed.push(type);
        },
    };
    let next = 0;
    const record = (name) => (...values) => {
        timers.push([name, values.length]);
        next += 1;
        return next;
    };
    const context = vm.createContext({
        unsafeWindow: page,
        document: {
            body: choices.body ?? null,
            visibilityState: 'visible',
            documentElement: {
                hasAttribute: (name) => marks.has(name),
                setAttribute: (name, value) => {
                    marks.set(name, value);
                },
                removeAttribute: (name) => {
                    marks.delete(name);
                },
            },
            addEventListener: (type) => {
                documentAdded.push(type);
            },
            removeEventListener: (type) => {
                documentRemoved.push(type);
            },
        },
        observe: (environment) => {
            seen.push(environment);
        },
        GM_getValue: (name, fallback) => (store.has(name) ? store.get(name) : fallback),
        GM_setValue: (name, value) => {
            store.set(name, value);
        },
        GM_deleteValue: (name) => {
            store.delete(name);
        },
        GM_listValues: () => [...store.keys()],
        GM_xmlhttpRequest: (details) => {
            requests.push(details);
            return { abort: () => undefined };
        },
        setTimeout: record('setTimeout'),
        clearTimeout: record('clearTimeout'),
        setInterval: record('setInterval'),
        clearInterval: record('clearInterval'),
        navigator: choices.navigator ?? {},
        crypto: { randomUUID: () => uuids.shift() },
        console: {
            log: (...values) => logs.push(String(values[0]).slice(0, 120)),
            warn: (...values) => logs.push(String(values[0]).slice(0, 120)),
            error: (...values) => logs.push(String(values[0]).slice(0, 120)),
        },
        window: { confirm: () => true },
        Date: choices.date ?? Date,
        URL,
        URLSearchParams,
        TextEncoder,
        Blob,
        ...(choices.extras ?? {}),
    });
    return { page, original, requests, timers, logs, added, seen, marks, documentAdded, documentRemoved, context, run: () => vm.runInContext(output, context) };
}

/**
 * @param {string} output
 * @return {string}
 */
function observed(output) {
    const marker = markerOf(LAST);
    const position = output.indexOf(marker);
    const tail = output.slice(position);
    assert.equal(count(tail, 'ScribeBoot.start('), 1);
    return `${output.slice(0, position)}${tail.replace('ScribeBoot.start(', 'observe(')}`;
}

test('the packed script starts on a page that is not a chat', () => {
    const output = ScribePack.build(realRead);
    const { page, original, requests, timers, logs, added, run } = stage(output);
    assert.doesNotThrow(run);
    assert.equal(page.fetch === original, false);
    assert.equal(typeof page.fetch, 'function');
    assert.equal(timers.filter(([name]) => name === 'setInterval' || name === 'setTimeout').length >= 1, true);
    assert.equal(requests.length, 0);
    assert.deepEqual(logs, []);
    for (const type of ['keydown', 'keyup', 'keypress']) {
        assert.equal(added.includes(type), true, type);
    }
});

test('the packed script boots once', () => {
    const output = ScribePack.build(realRead);
    const chat = stage(output, { path: '/rooms/harbour', body: { kind: 'body' } });
    assert.doesNotThrow(chat.run);
    assert.equal(chat.page.fetch === chat.original, false);
    assert.equal(chat.requests.length, 0);
    assert.equal(chat.marks.has('data-zeta-scribe'), true);
    assert.equal(chat.documentAdded.includes('visibilitychange'), true);
    assert.equal(chat.documentRemoved.length, 0);
    assert.equal(chat.timers.filter(([name]) => name === 'setInterval').length >= 1, true);
    assert.equal(
        chat.logs.every((line) => line.startsWith('[Scribe] ')),
        true,
    );
    const plain = stage(output, { path: '/', body: { kind: 'body' } });
    assert.doesNotThrow(plain.run);
    assert.equal(plain.page.fetch === plain.original, false);
    assert.deepEqual(plain.logs, []);
});

test('the list is the list', () => {
    const wanted = [
        'ScribeText',
        'ScribeCategory',
        'ScribeIntake',
        'ScribeAnswer',
        'ScribeLog',
        'ScribeReplay',
        'ScribeKnowledge',
        'ScribeAnalyzer',
        'ScribeGateway',
        'ScribeAdoption',
    ].map((name) => `scribe/core/${name}.js`);
    wanted.push('scribe/bench/BenchView.js');
    for (const name of [
        'ZetaSource',
        'ScribeStore',
        'ScribeKeeper',
        'ScribeScene',
        'ScribeReminder',
        'ScribePedant',
        'ScribeMuse',
        'ScribeLive',
        'ScribeSender',
        'PanelStyle',
        'PanelView',
        'ScribePanel',
        'ScribeBoot',
        'ScribeStart',
    ]) {
        wanted.push(`scribe/page/${name}.js`);
    }
    assert.equal(wanted.length, 25);
    assert.equal(ScribePack.Files.length, 25);
    assert.deepEqual([...ScribePack.Files], wanted);
});

/**
 * @param {string} built
 * @return {string[]}
 */
function undeclaredNames(built) {
    const used = new Set();
    for (const file of ScribePack.Files) {
        for (const match of realRead(file).matchAll(/\b((?:Scribe|Zeta|Bench|Panel)[A-Z][A-Za-z]*)\.[A-Za-z]/g)) {
            used.add(match[1]);
        }
    }
    return [...used].filter((name) => !new RegExp(`^const ${name} = `, 'm').test(built)).sort();
}

/**
 * @param {string} built
 * @param {string} file
 * @return {string}
 */
function without(built, file) {
    const start = built.indexOf(markerOf(file));
    const next = built.indexOf('/** @file ', start + 1);
    return `${built.slice(0, start)}${next === -1 ? `${CLOSING}\n` : built.slice(next)}`;
}

test('every object the sources call is packed', () => {
    const output = ScribePack.build(realRead);
    assert.deepEqual(undeclaredNames(output), []);
    for (const name of ['ScribeSender', 'ScribePanel', 'ScribeKeeper']) {
        const file = ScribePack.Files.find((entry) => entry.endsWith(`/${name}.js`));
        assert.deepEqual(undeclaredNames(without(output, file)), [name]);
        assert.throws(
            () => ScribePack.build((relativePath) => (relativePath === file ? `const Other${name} = 1;\n` : realRead(relativePath))),
            { message: `A source file does not declare its object: ${file}` },
        );
    }
});

/**
 * @param {string} header
 * @param {string} body
 * @return {string[]}
 */
function headerProblems(header, body) {
    const problems = [];
    const lines = header.split('\n');
    const grants = lines.filter((line) => line.startsWith('// @grant ')).map((line) => line.slice('// @grant '.length).trim());
    const used = new Set(body.match(/\b(?:GM_[A-Za-z]+|unsafeWindow)\b/g));
    for (const name of used) {
        if (!grants.includes(name)) {
            problems.push(`no grant for ${name}`);
        }
    }
    for (const name of grants) {
        if (!used.has(name)) {
            problems.push(`unused grant ${name}`);
        }
    }
    const host = new URL(/ModelOrigin: '([^']+)'/.exec(body)[1]).host;
    const wanted = [
        ['connect', lines.filter((line) => line.startsWith('// @connect ')).map((line) => line.slice('// @connect '.length).trim()), [host]],
        ['match', lines.filter((line) => line.startsWith('// @match ')).map((line) => line.slice('// @match '.length).trim()), ['https://zeta-ai.io/*']],
        ['run-at', lines.filter((line) => line.startsWith('// @run-at ')).map((line) => line.slice('// @run-at '.length).trim()), ['document-start']],
        ['noframes', lines.filter((line) => line === '// @noframes'), ['// @noframes']],
    ];
    for (const [name, found, expected] of wanted) {
        if (found.length !== expected.length || found.some((entry, index) => entry !== expected[index])) {
            problems.push(`wrong ${name}`);
        }
    }
    return problems;
}

test('the header grants what the script uses', () => {
    const header = realRead(ScribePack.Settings.Header);
    const output = ScribePack.build(realRead);
    const body = output.slice(output.indexOf(`${OPENING}\n`));
    assert.deepEqual(headerProblems(header, body), []);
    const lines = header.split('\n');
    const prefixes = ['// @grant GM_getValue', '// @grant GM_setValue', '// @grant GM_deleteValue', '// @grant GM_listValues', '// @grant GM_xmlhttpRequest', '// @grant unsafeWindow', '// @connect', '// @match', '// @run-at', '// @noframes'];
    for (const prefix of prefixes) {
        const kept = lines.filter((line) => !line.replace(/ +/g, ' ').startsWith(prefix));
        assert.equal(kept.length, lines.length - 1, prefix);
        assert.equal(headerProblems(kept.join('\n'), body).length > 0, true, prefix);
    }
    const changes = [
        ['// @run-at       document-start', '// @run-at       document-idle'],
        ['// @match        https://zeta-ai.io/*', '// @match        https://example.org/*'],
        ['// @connect      openrouter.ai', '// @connect      openrouter.example'],
        ['// @noframes', '// @noframes extra'],
        ['// @grant        unsafeWindow', '// @grant        unsafeWindow\n// @grant        GM_download'],
    ];
    for (const [from, to] of changes) {
        assert.equal(header.includes(from), true, from);
        assert.equal(headerProblems(header.replace(from, to), body).length > 0, true, from);
    }
});

const NOON = Date.UTC(2026, 10, 15, 22, 30);

class AheadDate extends Date {
    /**
     * @param {...*} values
     */
    constructor(...values) {
        super(...(values.length === 0 ? [NOON] : values));
    }

    /**
     * @return {number}
     */
    static now() {
        return NOON;
    }

    /**
     * @return {number}
     */
    getFullYear() {
        return 2026;
    }

    /**
     * @return {number}
     */
    getMonth() {
        return 10;
    }

    /**
     * @return {number}
     */
    getDate() {
        return 16;
    }
}

/**
 * @param {string} output
 * @param {object} choices
 * @return {{ environment: object, world: object }}
 */
function environmentOf(output, choices = {}) {
    const world = stage(observed(output), { path: '/rooms/harbour', body: { kind: 'body' }, ...choices });
    world.run();
    assert.equal(world.seen.length, 1);
    return { environment: world.seen[0], world };
}

test('the start hands the boot what the page has', () => {
    const output = ScribePack.build(realRead);
    const locks = { request: () => undefined };
    assert.equal(environmentOf(output, { navigator: { locks } }).environment.locks === locks, true);
    assert.equal(environmentOf(output, { navigator: {} }).environment.locks, null);
    const plain = environmentOf(output);
    assert.equal(plain.environment.exporter, null);
    assert.equal(plain.environment.clone, null);
    const extras = {
        exportFunction: (wrapper, target) => ({ exported: wrapper, target }),
        cloneInto: (value, target) => ({ cloned: value, target }),
    };
    const rich = environmentOf(output, { extras });
    const wrapper = () => 1;
    const exported = rich.environment.exporter(wrapper);
    assert.equal(exported.exported === wrapper && exported.target === rich.world.page, true);
    const value = { kind: 'value' };
    const cloned = rich.environment.clone(value);
    assert.equal(cloned.cloned === value && cloned.target === rich.world.page, true);
    assert.equal(environmentOf(output, { uuids: ['tab-one'] }).environment.tabId, 'tab-one');
    assert.equal(environmentOf(output, { uuids: ['tab-two'] }).environment.tabId, 'tab-two');
    const ahead = environmentOf(output, { date: AheadDate }).environment;
    assert.equal(ahead.clock.today(), '2026-11-16');
    assert.equal(ahead.clock.now(), NOON);
    const logging = environmentOf(output);
    logging.environment.log('a line');
    assert.deepEqual(logging.world.logs, ['[Scribe] a line']);
    assert.equal(logging.environment.pageWindow === logging.world.page, true);
});

test('a byte-order mark is stripped', () => {
    const mark = String.fromCodePoint(0xfeff);
    const plain = built();
    const files = invented();
    for (const file of [FIRST, LAST, ScribePack.Settings.Header]) {
        files.set(file, `${mark}${files.get(file)}`);
    }
    const marked = ScribePack.build(readerOf(files));
    assert.equal(marked.includes(mark), false);
    assert.equal(marked === plain, true);
    const middle = invented({ [FIRST]: `${bodyOf(FIRST)}${mark}\n` });
    assert.equal(ScribePack.build(readerOf(middle)).includes(mark), true);
});
