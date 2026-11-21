import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import FakeClock from './FakeClock.mjs';
import declaredJudgments from './DeclaredJudgments.mjs';
import FakeDocument from './FakeDocument.mjs';
import FakeServer from './FakeServer.mjs';

export default class FakePage {
    static Markup = new URL('../../scribe/bench/adopt.html', import.meta.url);

    static Starter = 'BenchStart.js';

    static StartTime = Date.UTC(2026, 10, 15, 9, 0, 0);

    /**
     * @param {Object<string, string>} files
     */
    constructor(files = {}) {
        this.document = new FakeDocument(readFileSync(FakePage.Markup, 'utf8'));
        this.clock = new FakeClock(FakePage.StartTime);
        this.server = new FakeServer(files);
        this.confirming = true;
        this.questions = [];
        this.stored = [];
        this.logged = [];
        this.scripts = FakePage.load(this);
        this.handle = null;
        this.environment = {
            document: this.document,
            fetch: this.server.fetch,
            /**
             * @param {Function} callback
             * @param {number} delay
             * @return {number}
             */
            setInterval: (callback, delay) => this.clock.setInterval(callback, delay),
            /**
             * @param {number} id
             * @return {void}
             */
            clearInterval: (id) => this.clock.clearInterval(id),
            /**
             * @param {Function} callback
             * @param {number} delay
             * @return {number}
             */
            setTimeout: (callback, delay) => this.clock.setTimeout(callback, delay),
            /**
             * @param {string} question
             * @return {boolean}
             */
            confirm: (question) => {
                this.questions.push(question);
                return this.confirming;
            },
            /**
             * @return {number}
             */
            now: () => this.clock.now(),
            AbortController,
        };
    }

    /**
     * @return {string[]}
     */
    static sources() {
        const markup = readFileSync(FakePage.Markup, 'utf8');
        return [...markup.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((match) => match[1]);
    }

    /**
     * @param {{ stored: Array<[string, string]>, logged: unknown[][] }|null} recorder
     * @return {Object<string, object>}
     */
    static load(recorder = null) {
        const stored = recorder === null ? [] : recorder.stored;
        const logged = recorder === null ? [] : recorder.logged;
        const storage = {
            /**
             * @param {string} name
             * @param {string} value
             * @return {void}
             */
            setItem: (name, value) => {
                stored.push([String(name), String(value)]);
            },
            /**
             * @return {null}
             */
            getItem: () => null,
            /**
             * @return {void}
             */
            removeItem: () => {},
            /**
             * @return {void}
             */
            clear: () => {},
        };
        /**
         * @param {...*} parts
         * @return {void}
         */
        const record = (...parts) => {
            logged.push(parts);
        };
        const context = vm.createContext({
            TextEncoder,
            localStorage: storage,
            sessionStorage: storage,
            console: { log: record, info: record, warn: record, error: record, debug: record },
        });
        const loaded = {};
        for (const source of FakePage.sources()) {
            if (source === FakePage.Starter) {
                continue;
            }
            const url = new URL(source, FakePage.Markup);
            const name = url.pathname.split('/').at(-1).replace(/\.js$/, '');
            if (name === 'BenchPage') {
                const replay = loaded.ScribeReplay;
                const view = { ...replay, run: (log, ...args) => declaredJudgments(replay.run(log, ...args), log, replay) };
                loaded[name] = vm.compileFunction(readFileSync(url, 'utf8') + '\nreturn BenchPage;', ['ScribeReplay'],
                    { parsingContext: context, filename: url.pathname })(view);
                continue;
            }
            vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
            loaded[name] = vm.runInContext(name, context);
        }
        return loaded;
    }

    /**
     * @return {Promise<FakePage>}
     */
    async start() {
        this.handle = this.scripts.BenchPage.start(this.environment);
        await this.idle();
        return this;
    }

    /**
     * @return {Promise<void>}
     */
    idle() {
        return this.handle.idle();
    }

    /**
     * @param {string} id
     * @return {import('./FakeElement.mjs').default}
     * @throws {Error}
     */
    byId(id) {
        const element = this.document.getElementById(id);
        if (element === null) {
            throw new Error(`No element with the id ${id}`);
        }
        return element;
    }

    /**
     * @param {string} id
     * @return {string}
     */
    text(id) {
        return this.byId(id).textContent;
    }

    /**
     * @param {string} id
     * @return {import('./FakeElement.mjs').default[]}
     */
    rows(id) {
        return this.byId(id).children.filter((child) => child.classes.has('row'));
    }

    /**
     * @param {import('./FakeElement.mjs').default} root
     * @param {string} text
     * @return {import('./FakeElement.mjs').default}
     * @throws {Error}
     */
    button(root, text) {
        const found = root.descendants().filter((element) => element.tagName === 'BUTTON' && element.textContent === text);
        if (found.length !== 1) {
            throw new Error(`Expected one button reading ${text}, found ${found.length}`);
        }
        return found[0];
    }

    /**
     * @param {import('./FakeElement.mjs').default} root
     * @param {string} type
     * @return {import('./FakeElement.mjs').default[]}
     */
    inputs(root, type) {
        return root.descendants().filter((element) => element.tagName === 'INPUT' && element.type === type);
    }

    /**
     * @param {string} id
     * @return {void}
     */
    click(id) {
        this.byId(id).click();
    }

    /**
     * @param {string} id
     * @param {string} value
     * @param {string} type
     * @return {void}
     */
    set(id, value, type = 'input') {
        const element = this.byId(id);
        element.value = value;
        element.dispatchEvent({ type });
    }

    /**
     * @param {string} name
     * @return {Promise<void>}
     */
    async choose(name) {
        this.set('campaign', name, 'change');
        await this.idle();
    }

    /**
     * @param {string} name
     * @return {object}
     */
    saved(name) {
        return JSON.parse(this.server.files.get(name));
    }
}
