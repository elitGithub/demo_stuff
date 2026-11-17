import vm from 'node:vm';
import FakeEvent from './FakeEvent.mjs';
import FakeTextArea from './FakeTextArea.mjs';
import WholeDocument from './WholeDocument.mjs';
import WholePanel from './WholePanel.mjs';
import WholeSite from './WholeSite.mjs';
import WholeTimers from './WholeTimers.mjs';
import WholeWindow from './WholeWindow.mjs';

export default class WholeTab {
    static Native = Object.getOwnPropertyDescriptor(FakeTextArea.prototype, 'value');

    static PageSize = 31;

    /**
     * @param {{ name: string, tabId: string, packed: string, clock: import('./FakeTimers.mjs').default, storage: import('./FakeStorage.mjs').default, site: WholeSite, model: import('./WholeModel.mjs').default, locks: import('./FakeLocks.mjs').default|null, path: string, width?: number }} options
     */
    constructor(options) {
        this.name = options.name;
        this.tabId = options.tabId;
        this.packed = options.packed;
        this.clock = options.clock;
        this.storage = options.storage;
        this.site = options.site;
        this.model = options.model;
        this.locks = options.locks;
        this.dead = false;
        this.release = null;
        this.death = new Promise((resolve) => {
            this.release = resolve;
        });
        this.scriptTimers = new WholeTimers(this.clock);
        this.pageTimers = new WholeTimers(this.clock);
        this.window = new WholeWindow(this.site, this.pageTimers, options.path, options.width ?? WholeWindow.Width);
        this.document = new WholeDocument(this.window);
        this.panel = new WholePanel(this.document);
        this.logs = [];
        this.questions = [];
        this.confirming = true;
        this.box = null;
        this.state = '';
        this.refusing = false;
        this.keys = [];
        this.sent = [];
        this.refused = 0;
        this.body = null;
        this.context = null;
    }

    /**
     * @return {Function}
     */
    dates() {
        const clock = this.clock;
        /**
         * @param {...*} values
         * @return {Date}
         */
        function ScriptedDate(...values) {
            return values.length === 0 ? new Date(clock.now()) : new Date(...values);
        }
        /**
         * @return {number}
         */
        ScriptedDate.now = () => clock.now();
        /**
         * @param {string} text
         * @return {number}
         */
        ScriptedDate.parse = (text) => Date.parse(text);
        /**
         * @param {...number} values
         * @return {number}
         */
        ScriptedDate.UTC = (...values) => Date.UTC(...values);
        ScriptedDate.prototype = Date.prototype;
        return ScriptedDate;
    }

    /**
     * @param {string} name
     * @param {...*} rest
     * @return {Promise<*>}
     */
    lock(name, ...rest) {
        const callback = rest.at(-1);
        const options = rest.length > 1 ? rest[0] : {};
        return this.locks.request(name, options, (granted) => {
            if (this.dead) {
                return null;
            }
            const held = callback(granted);
            if (held === null || held === undefined) {
                return held;
            }
            return Promise.race([held, this.death]);
        });
    }

    /**
     * @return {object}
     */
    globals() {
        const storage = this.storage;
        const timers = this.scriptTimers;
        /**
         * @param {...*} values
         * @return {void}
         */
        const record = (...values) => {
            this.logs.push(String(values[0]));
        };
        return {
            unsafeWindow: this.window,
            document: this.document,
            GM_getValue: (name, fallback) => storage.get(name, fallback),
            GM_setValue: (name, value) => {
                storage.set(name, value);
            },
            GM_deleteValue: (name) => {
                storage.remove(name);
            },
            GM_listValues: () => storage.list(),
            GM_xmlhttpRequest: (details) => this.model.request(this, details),
            setTimeout: (callback, delay) => timers.setTimeout(callback, delay),
            clearTimeout: (id) => {
                timers.clearTimeout(id);
            },
            setInterval: (callback, delay) => timers.setInterval(callback, delay),
            clearInterval: (id) => {
                timers.clearInterval(id);
            },
            navigator: this.locks === null ? {} : { locks: { request: (name, ...rest) => this.lock(name, ...rest) } },
            crypto: { randomUUID: () => this.tabId },
            console: { log: record, info: record, warn: record, error: record, debug: record },
            window: {
                confirm: (text) => {
                    this.questions.push(String(text));
                    return this.confirming;
                },
            },
            Date: this.dates(),
            URL,
            URLSearchParams,
            TextEncoder,
            Blob,
        };
    }

    /**
     * @return {void}
     */
    run() {
        this.body = this.document.body;
        this.document.body = null;
        this.context = vm.createContext(this.globals());
        vm.runInContext(this.packed, this.context, { filename: 'scribe.user.js' });
    }

    /**
     * @return {void}
     */
    ready() {
        if (this.body !== null) {
            this.document.body = this.body;
            this.body = null;
        }
    }

    /**
     * @param {string} path
     * @return {void}
     */
    go(path) {
        this.window.go(path);
    }

    /**
     * @return {Promise<object>}
     */
    openPage() {
        if (this.box === null) {
            const box = this.document.add(new FakeTextArea({ name: 'message' }));
            box.addEventListener('input', () => {
                if (box.value !== box.tracked) {
                    box.tracked = box.value;
                    this.state = box.value;
                }
            });
            box.addEventListener('keydown', (event) => {
                this.pressed(event);
            });
            this.box = box;
        }
        return this.pageGet();
    }

    /**
     * @return {Promise<object>}
     */
    pageGet() {
        return this.window.fetch(`${WholeSite.Messages}?limit=${WholeTab.PageSize}`, {
            headers: { Authorization: WholeSite.Token },
            own: true,
        });
    }

    /**
     * @param {string} text
     * @return {Promise<object>}
     */
    pagePost(text) {
        return this.window.fetch(WholeSite.Messages, {
            method: 'POST',
            headers: { Authorization: WholeSite.Token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            own: true,
        });
    }

    /**
     * @param {string} id
     * @return {Promise<object>}
     */
    pageRegenerate(id) {
        return this.window.fetch(`${WholeSite.Messages}/${id}/regenerate`, {
            method: 'POST',
            headers: { Authorization: WholeSite.Token, 'Content-Type': 'application/json' },
            body: '{}',
            own: true,
        });
    }

    /**
     * @param {{ key: string, shiftKey: boolean, isComposing: boolean, keyCode: number }} event
     * @return {void}
     */
    pressed(event) {
        this.keys.push({ key: event.key, at: this.clock.now() });
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) {
            return;
        }
        if (this.state.trim() === '') {
            return;
        }
        if (this.refusing) {
            this.refused++;
            return;
        }
        const text = this.state;
        this.sent.push(text);
        this.pagePost(text);
        this.state = '';
        this.box.value = '';
    }

    /**
     * @param {string} text
     * @return {void}
     */
    type(text) {
        this.document.focusOn(this.box);
        WholeTab.Native.set.call(this.box, text);
        this.box.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    }

    /**
     * @return {FakeEvent}
     */
    enter() {
        this.document.focusOn(this.box);
        return this.window.dispatch(this.box, 'keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    }

    /**
     * @param {string} key
     * @return {FakeEvent}
     */
    keyDown(key) {
        this.document.focusOn(this.box);
        return this.window.dispatch(this.box, 'keydown', { key });
    }

    /**
     * @param {string} character
     * @return {void}
     */
    land(character) {
        WholeTab.Native.set.call(this.box, this.box.value + character);
        this.box.dispatchEvent(new FakeEvent('input', { bubbles: true, inputType: 'insertText', data: character }));
    }

    /**
     * @param {string} state
     * @return {void}
     */
    show(state) {
        this.document.show(state);
    }

    /**
     * @return {void}
     */
    unload() {
        this.dead = true;
        this.scriptTimers.stop();
        this.pageTimers.stop();
        this.release();
    }
}
