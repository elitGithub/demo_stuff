import vm from 'node:vm';
import FakeEvent from './FakeEvent.mjs';
import FakeTextArea from './FakeTextArea.mjs';
import FakeTextInput from './FakeTextInput.mjs';
import WholeDocument from './WholeDocument.mjs';
import WholeHandle from './WholeHandle.mjs';
import WholeNode from './WholeNode.mjs';
import WholePanel from './WholePanel.mjs';
import WholeSite from './WholeSite.mjs';
import WholeTimers from './WholeTimers.mjs';
import WholeWindow from './WholeWindow.mjs';

export default class WholeTab {
    static Native = Object.getOwnPropertyDescriptor(FakeTextArea.prototype, 'value');

    static PageSize = 31;

    static TopOrigin = 'https://zeta-ai.io';

    static FrameOrigin = 'https://frame.pingpong.ai';

    static FramePath = '/v1/index.html';

    static FrameAddress = 'https://frame.pingpong.ai/v1/index.html#run=invented-run&host=zeta-ai.io';

    static Labels = Object.freeze(['Suggested replies', 'Insert asterisk', 'Send']);

    static Inputs = Object.freeze(['search', 'scene', 'note']);

    /**
     * @param {{ name: string, tabId: string, packed: string, clock: import('./FakeTimers.mjs').default, storage: import('./FakeStorage.mjs').default, site: WholeSite, model: import('./WholeModel.mjs').default, locks: import('./FakeLocks.mjs').default|null, path: string, width?: number, query?: boolean, layout?: string, origin?: string, posts: object[] }} options
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
        this.posts = options.posts;
        this.layout = options.layout ?? 'frame';
        this.queried = options.query !== false;
        this.callbacks = new Set();
        this.dead = false;
        this.release = null;
        this.death = new Promise((resolve) => {
            this.release = resolve;
        });
        this.scriptTimers = new WholeTimers(this.clock);
        this.pageTimers = new WholeTimers(this.clock);
        this.window = new WholeWindow({
            site: this.site,
            timers: this.pageTimers,
            path: options.path,
            width: options.width,
            origin: options.origin ?? WholeTab.TopOrigin,
            ancestors: [],
            label: this.name,
        });
        this.document = new WholeDocument(this.window);
        this.panel = new WholePanel(this.document);
        this.logs = [];
        this.gm = [];
        this.questions = [];
        this.confirming = true;
        this.state = '';
        this.refusing = false;
        this.keys = [];
        this.sent = [];
        this.refused = 0;
        this.made = 0;
        this.presses = [];
        this.elsewhere = [];
        this.body = null;
        this.context = null;
        this.frame = null;
        this.iframe = null;
        this.buttons = new Map();
        this.inputs = [];
        this.icon = null;
        this.tools = [];
        if (this.layout === 'frame') {
            this.buildFrame(options.width);
        } else if (this.layout === 'top') {
            this.box = this.document.add(new FakeTextArea({ name: 'message' }));
            this.chatWindow = this.window;
            this.chatDocument = this.document;
            this.wireBox();
        } else {
            this.box = null;
            this.chatWindow = this.window;
            this.chatDocument = this.document;
        }
    }

    /**
     * @param {number|undefined} width
     * @return {void}
     */
    buildFrame(width) {
        const timers = { scriptTimers: new WholeTimers(this.clock), pageTimers: new WholeTimers(this.clock) };
        const window = new WholeWindow({
            site: this.site,
            timers: timers.pageTimers,
            path: WholeTab.FramePath,
            width,
            origin: WholeTab.FrameOrigin,
            ancestors: [WholeTab.TopOrigin],
            label: `${this.name}/frame`,
        });
        const document = new WholeDocument(window);
        const toFrame = new WholeHandle(this.window, window, this.posts);
        const toTop = new WholeHandle(window, this.window, this.posts);
        this.window.seen.set(window, toFrame);
        window.seen.set(this.window, toTop);
        window.parent = toTop;
        window.top = toTop;
        this.iframe = this.document.add(new WholeNode('iframe', { src: WholeTab.FrameAddress }, { width: 420, height: 720, bottom: 800 }));
        this.iframe.contentWindow = toFrame;
        this.frame = { window, document, ...timers, logs: [], gm: [], context: null, started: false, toTop, toFrame };
        const form = new WholeNode('form', {}, { width: 420, height: 120, bottom: 790 });
        this.box = new FakeTextArea({ name: 'message' });
        form.append(this.box);
        for (const name of WholeTab.Inputs) {
            const input = new FakeTextInput({ name });
            input.addEventListener('keydown', (event) => {
                this.elsewhere.push(`${name}:${event.key}`);
            });
            this.inputs.push(form.append(input));
        }
        for (const label of WholeTab.Labels) {
            const button = new WholeNode('button', { 'aria-label': label, type: 'button' }, { width: 32, height: 32, bottom: 780 });
            button.addEventListener('click', () => {
                this.clicked(label);
            });
            this.buttons.set(label, form.append(button));
        }
        this.icon = this.buttons.get('Send').append(new WholeNode('svg', {}, { width: 16, height: 16, bottom: 772 }));
        document.add(form);
        this.chatWindow = window;
        this.chatDocument = document;
        this.wireBox();
    }

    /**
     * @return {void}
     */
    wireBox() {
        const box = this.box;
        box.addEventListener('input', () => {
            if (box.value !== box.tracked) {
                box.tracked = box.value;
                this.state = box.value;
            }
        });
        box.addEventListener('keydown', (event) => {
            this.pressed(event);
        });
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
        /**
         * @param {object|null} granted
         * @return {*}
         */
        const wrapped = (granted) => {
            this.callbacks.delete(wrapped);
            if (this.dead) {
                return null;
            }
            const held = callback(granted);
            if (held === null || held === undefined) {
                return held;
            }
            return Promise.race([held, this.death]);
        };
        this.callbacks.add(wrapped);
        return this.locks.request(name, options, wrapped);
    }

    /**
     * @return {object}
     */
    lockManager() {
        const manager = {
            /**
             * @param {string} name
             * @param {...*} rest
             * @return {Promise<*>}
             */
            request: (name, ...rest) => this.lock(name, ...rest),
        };
        if (this.queried) {
            /**
             * @return {Promise<object>}
             */
            manager.query = () => this.locks.query();
        }
        return manager;
    }

    /**
     * @return {void}
     */
    forsake() {
        if (this.locks === null) {
            return;
        }
        for (const queue of this.locks.queues.values()) {
            for (let index = queue.length - 1; index >= 0; index--) {
                if (this.callbacks.has(queue[index].callback)) {
                    queue.splice(index, 1);
                }
            }
        }
        this.callbacks.clear();
    }

    /**
     * @return {string}
     */
    room() {
        const found = /^\/rooms\/([^/]+)/.exec(this.window.location.pathname);
        return found === null ? WholeSite.Room : decodeURIComponent(found[1]);
    }

    /**
     * @param {string[]} calls
     * @param {string} name
     * @param {Function} action
     * @return {Function}
     */
    static counted(calls, name, action) {
        const shown = name === 'GM_getValue' ? 2 : 1;
        /**
         * @param {...*} values
         * @return {*}
         */
        return (...values) => {
            const named = values
                .slice(0, shown)
                .map((value) => (typeof value === 'function' || typeof value === 'object' && value !== null ? typeof value : JSON.stringify(value)))
                .join(', ');
            calls.push(`${name}(${named})`);
            return action(...values);
        };
    }

    /**
     * @return {string}
     */
    uuid() {
        this.made++;
        return `${this.tabId}-uuid-${String(this.made).padStart(8, '0')}`;
    }

    /**
     * @param {boolean} shown
     * @return {void}
     */
    frameShown(shown) {
        this.iframe.width = shown ? 420 : 0;
        this.iframe.height = shown ? 720 : 0;
    }

    /**
     * @param {{ window: WholeWindow, document: WholeDocument, scriptTimers: WholeTimers, logs: string[], gm: string[] }} copy
     * @param {boolean} top
     * @return {object}
     */
    globals(copy, top) {
        const storage = this.storage;
        const timers = copy.scriptTimers;
        const calls = copy.gm;
        /**
         * @param {...*} values
         * @return {void}
         */
        const record = (...values) => {
            copy.logs.push(String(values[0]));
        };
        const locks = top
            ? this.lockManager()
            : {
                  request: WholeTab.counted(calls, 'locks.request', () => new Promise(() => {})),
                  query: WholeTab.counted(calls, 'locks.query', () => new Promise(() => {})),
              };
        return {
            unsafeWindow: copy.window,
            document: copy.document,
            GM_getValue: WholeTab.counted(calls, 'GM_getValue', (name, fallback) => storage.get(name, fallback)),
            GM_setValue: WholeTab.counted(calls, 'GM_setValue', (name, value) => {
                storage.set(name, value);
            }),
            GM_deleteValue: WholeTab.counted(calls, 'GM_deleteValue', (name) => {
                storage.remove(name);
            }),
            GM_listValues: WholeTab.counted(calls, 'GM_listValues', () => storage.list()),
            GM_xmlhttpRequest: WholeTab.counted(calls, 'GM_xmlhttpRequest', (details) =>
                top ? this.model.request(this, details) : { abort: () => undefined },
            ),
            setTimeout: (callback, delay) => timers.setTimeout(callback, delay),
            clearTimeout: (id) => {
                timers.clearTimeout(id);
            },
            setInterval: (callback, delay) => timers.setInterval(callback, delay),
            clearInterval: (id) => {
                timers.clearInterval(id);
            },
            navigator: this.locks === null && top ? {} : { locks },
            crypto: { randomUUID: () => this.uuid() },
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
        const copy = { window: this.window, document: this.document, scriptTimers: this.scriptTimers, logs: this.logs, gm: this.gm };
        this.context = vm.createContext(this.globals(copy, true));
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
        if (this.frame !== null && !this.frame.started) {
            this.frame.started = true;
            this.frame.context = vm.createContext(this.globals(this.frame, false));
            vm.runInContext(this.packed, this.frame.context, { filename: 'scribe.user.js' });
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
        return this.pageGet();
    }

    /**
     * @return {Promise<object>}
     */
    pageGet() {
        return this.window.fetch(`${WholeSite.messagesOf(this.room())}?limit=${WholeTab.PageSize}`, {
            headers: { Authorization: WholeSite.Token },
            own: true,
        });
    }

    /**
     * @param {string} text
     * @return {Promise<object>}
     */
    pagePost(text) {
        return this.chatWindow.fetch(WholeSite.messagesOf(this.room()), {
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
        return this.chatWindow.fetch(`${WholeSite.messagesOf(this.room())}/${id}/regenerate`, {
            method: 'POST',
            headers: { Authorization: WholeSite.Token, 'Content-Type': 'application/json' },
            body: '{}',
            own: true,
        });
    }

    /**
     * @return {void}
     */
    send() {
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
     * @param {{ key: string, shiftKey: boolean, isComposing: boolean, keyCode: number }} event
     * @return {void}
     */
    pressed(event) {
        this.keys.push({ key: event.key, at: this.clock.now() });
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) {
            return;
        }
        this.send();
    }

    /**
     * @param {string} label
     * @return {void}
     */
    clicked(label) {
        this.presses.push(label);
        if (label === 'Send') {
            this.send();
        }
    }

    /**
     * @param {string} text
     * @return {void}
     */
    type(text) {
        this.chatDocument.focusOn(this.box);
        WholeTab.Native.set.call(this.box, text);
        this.box.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    }

    /**
     * @return {FakeEvent}
     */
    enter() {
        this.chatDocument.focusOn(this.box);
        return this.chatWindow.dispatch(this.box, 'keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    }

    /**
     * @param {string} key
     * @return {FakeEvent}
     */
    keyDown(key) {
        this.chatDocument.focusOn(this.box);
        return this.chatWindow.dispatch(this.box, 'keydown', { key });
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
     * @param {string} label
     * @param {boolean} onIcon
     * @return {void}
     */
    press(label, onIcon = false) {
        const button = this.buttons.get(label);
        const target = onIcon && label === 'Send' ? this.icon : button;
        this.chatWindow.dispatch(target, 'pointerdown', {});
        this.chatWindow.dispatch(target, 'click', {});
    }

    /**
     * @param {object} field
     * @param {WholeDocument} document
     * @param {WholeWindow} window
     * @param {string} text
     * @return {FakeEvent}
     */
    enterIn(field, document, window, text) {
        document.focusOn(field);
        WholeTab.Native.set.call(field, text);
        field.dispatchEvent(new FakeEvent('input', { bubbles: true }));
        return window.dispatch(field, 'keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    }

    /**
     * @return {{ notes: FakeTextArea, title: FakeTextInput }}
     */
    addTool() {
        const notes = this.document.add(new FakeTextArea({ name: 'notes' }));
        const title = this.document.add(new FakeTextInput({ name: 'dm-title' }));
        for (const field of [notes, title]) {
            field.addEventListener('keydown', (event) => {
                this.elsewhere.push(`${field.name}:${event.key}`);
            });
        }
        this.tools.push(notes, title);
        return { notes, title };
    }

    /**
     * @param {string} origin
     * @param {string} toward
     * @return {WholeHandle}
     */
    outsider(origin, toward) {
        const stranger = new WholeWindow({ site: this.site, timers: new WholeTimers(this.clock), path: '/', origin, ancestors: [], label: 'outsider' });
        const target = toward === 'frame' ? this.frame.window : this.window;
        target.seen.set(stranger, new WholeHandle(target, stranger, this.posts));
        return new WholeHandle(stranger, target, this.posts);
    }

    /**
     * @param {string} state
     * @return {void}
     */
    show(state) {
        this.document.show(state);
        if (this.frame !== null) {
            this.frame.document.show(state);
        }
    }

    /**
     * @return {void}
     */
    unload() {
        this.dead = true;
        this.window.dead = true;
        this.scriptTimers.stop();
        this.pageTimers.stop();
        if (this.frame !== null) {
            this.frame.window.dead = true;
            this.frame.scriptTimers.stop();
            this.frame.pageTimers.stop();
        }
        this.forsake();
        this.release();
    }
}
