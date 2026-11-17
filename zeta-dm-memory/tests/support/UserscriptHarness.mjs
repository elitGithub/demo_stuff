import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';

export class UserscriptHarness {
    /**
     * @param {{source: string, pathname: string, localStorage?: Map, gmStorage?: Map, origin?: string, frame?: boolean, blankFrame?: boolean, ancestors?: boolean|string[], dropFirstReady?: boolean}} options
     */
    constructor({
        source, pathname, localStorage = new Map(), gmStorage = new Map(), origin = 'https://zeta-ai.io',
        frame = false, blankFrame = false, ancestors = true, dropFirstReady = false,
    }) {
        this.source = source;
        this.localStorage = localStorage;
        this.gmStorage = gmStorage;
        this.localWrites = [];
        this.gmWrites = [];
        this.logs = [];
        this.prompts = [];
        this.alerts = [];
        this.confirmations = [];
        this.confirmResult = true;
        this.requests = [];
        this.chatEvents = [];
        this.messages = [];
        this.frameCalls = [];
        this.realms = [];
        this.framed = frame;
        this.ancestors = ancestors;
        this.frameLoads = 0;
        this.dropNextReady = dropFirstReady;
        this.running = null;
        this.failLocalWrites = false;
        this.hasAbortHandle = true;
        this.menus = new Map();
        this.keyListeners = new Map();
        this.time = Date.parse('2026-11-10T10:00:00.000Z');
        this.timers = new Map();
        this.nextTimer = 0;

        class BrowserEvent {
            constructor(type, data = {}) {
                Object.assign(this, { type, defaultPrevented: false, stopped: false }, data);
            }
            preventDefault() { this.defaultPrevented = true; }
            stopImmediatePropagation() { this.stopped = true; }
        }
        this.BrowserEvent = BrowserEvent;

        const top = this.createRealm('top', { origin, pathname });
        top.window.parent = top.window;
        Object.assign(top.window, {
            prompt: (...args) => {
                this.prompts.push(args);
                return this.promptResult;
            },
            alert: (message) => this.alerts.push(message),
            confirm: (message) => {
                this.confirmations.push(message);
                return typeof this.confirmResult === 'function' ? this.confirmResult() : this.confirmResult;
            },
        });
        this.top = top;
        this.document = top.document;
        this.window = top.window;
        if (frame) {
            this.iframe = top.document.body.appendChild(new top.Element('iframe'));
            this.iframe.setAttribute('src', 'https://frame.pingpong.ai/v1/index.html#run=r&host=h');
            this.setFrameRect(480, 927);
        } else {
            this.addChat(top);
            const send = top.document.body.appendChild(new top.Element('button'));
            send.setAttribute('id', 'send');
            send.setAttribute('type', 'submit');
            send.setAttribute('aria-label', 'Send');
        }
        const context = {
            ...this.globals(top),
            localStorage: {
                getItem: (key) => localStorage.get(key) ?? null,
                setItem: (key, value) => {
                    this.localWrites.push({ key, value });
                    if (this.failLocalWrites) {
                        throw new Error('Quota exceeded');
                    }
                    localStorage.set(key, value);
                },
            },
        };
        if (!source.includes('// @grant        none')) {
            Object.assign(context, {
                GM_getValue: (key, fallback) => gmStorage.get(key) ?? fallback,
                GM_setValue: (key, value) => {
                    const previous = gmStorage.get(key);
                    gmStorage.set(key, value);
                    this.gmWrites.push({ key, value });
                    this.keyListeners.get(key)?.(key, previous, value, false);
                },
                GM_registerMenuCommand: (label, callback) => this.menus.set(label, callback),
                GM_addValueChangeListener: (key, callback) => this.keyListeners.set(key, callback),
                GM_xmlhttpRequest: (options) => {
                    const request = { ...options, aborted: false };
                    this.requests.push(request);
                    if (this.hasAbortHandle) {
                        return { abort: () => {
                            request.aborted = true;
                            request.onabort();
                        } };
                    }
                    return undefined;
                },
            });
        }
        this.within(top, () => runInNewContext(source, context, { filename: 'zeta-dm-memory.user.js' }));
        if (frame) {
            this.openFrame();
        }
        if (frame && !blankFrame) {
            this.reloadSameWindow();
        }
    }

    /**
     * @param {string} name
     * @param {{origin: string, pathname: string, hash?: string}} location
     * @return {object}
     */
    createRealm(name, location) {
        const harness = this;
        const realm = { name, origin: location.origin };

        class Element {
            constructor(tagName) {
                this.tagName = tagName.toUpperCase();
                this.children = [];
                this.attributes = new Map();
                this.style = {};
                this.listeners = new Map();
                this.disabled = false;
                this.hidden = false;
                this.checked = false;
                this._value = '';
                this._text = '';
            }
            get value() { return this._value; }
            set value(text) {
                this._value = String(text);
                if (this.tagName === 'TEXTAREA') {
                    this._value = this._value.replace(/\r\n?/g, '\n');
                }
                if (this.id === 'chat') {
                    harness.chatEvents.push({ type: 'native-setter', value: this._value });
                }
            }
            get textContent() {
                return this._text + this.children.map((child) => child.textContent).join('');
            }
            set textContent(text) {
                this.replaceChildren();
                this._text = String(text);
            }
            get options() { return this.children; }
            setAttribute(name, value) {
                this.attributes.set(name, value);
                if (['id', 'name', 'type', 'src'].includes(name)) {
                    this[name] = value;
                }
                if (name === 'hidden') {
                    this.hidden = true;
                }
            }
            appendChild(child) {
                child.parent = this;
                this.children.push(child);
                return child;
            }
            /**
             * @param {Element} child
             * @return {Element}
             */
            prepend(child) {
                child.parent = this;
                this.children.unshift(child);
                return child;
            }
            /**
             * @return {void}
             */
            remove() {
                if (this.parent) {
                    this.parent.children = this.parent.children.filter((child) => child !== this);
                    this.parent = null;
                }
            }
            replaceChildren(...children) {
                this.children = [];
                this._text = '';
                children.forEach((child) => this.appendChild(child));
            }
            set innerHTML(markup) {
                this.replaceChildren();
                const stack = [this];
                for (const token of markup.matchAll(/<(\/?)([a-z][a-z0-9]*)([^>]*)>|([^<]+)/gi)) {
                    const [, closing, tag, attributes, text] = token;
                    if (text) {
                        stack.at(-1)._text += text;
                    } else if (closing) {
                        stack.pop();
                    } else {
                        const child = stack.at(-1).appendChild(new Element(tag));
                        for (const [, name, value = ''] of attributes.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
                            child.setAttribute(name, value);
                        }
                        if (tag !== 'input') {
                            stack.push(child);
                        }
                    }
                }
            }
            descendants() {
                return this.children.flatMap((child) => [child, ...child.descendants()]);
            }
            matches(selector) {
                switch (selector) {
                    case 'textarea[name="message"]': return this.tagName === 'TEXTAREA' && this.name === 'message';
                    case 'textarea:not(#zeta-dm-notes)': return this.tagName === 'TEXTAREA' && this.id !== 'zeta-dm-notes';
                    case 'input[type="text"]:not(#zeta-dm-interval)':
                        return this.tagName === 'INPUT' && this.type === 'text' && this.id !== 'zeta-dm-interval';
                    case 'button[aria-label="Send"]':
                        return this.tagName === 'BUTTON' && this.attributes.get('aria-label') === 'Send';
                    case 'iframe': return this.tagName === 'IFRAME';
                    default: return selector.startsWith('#') ? this.id === selector.slice(1) : this.tagName === selector.toUpperCase();
                }
            }
            querySelector(selector) { return this.descendants().find((element) => element.matches(selector)) ?? null; }
            /**
             * @param {string} selector
             * @return {Element[]}
             */
            querySelectorAll(selector) { return this.descendants().filter((element) => element.matches(selector)); }
            closest(selector) {
                for (let element = this; element; element = element.parent) {
                    if (element.matches(selector)) {
                        return element;
                    }
                }
                return null;
            }
            getBoundingClientRect() { return this.rect ?? { bottom: 790 }; }
            focus() { document.activeElement = this; }
            addEventListener(type, listener) {
                if (!this.listeners.has(type)) {
                    this.listeners.set(type, []);
                }
                this.listeners.get(type).push(listener);
            }
            dispatchEvent(event) {
                return harness.within(realm, () => {
                    event.target = this;
                    if (this !== window && (event.type === 'keydown' || event.type === 'pointerdown')) {
                        window.emit(event);
                    }
                    this.emit(event);
                    return !event.defaultPrevented;
                });
            }
            emit(event) {
                for (const listener of this.listeners.get(event.type) ?? []) {
                    if (event.stopped) {
                        break;
                    }
                    listener(event);
                }
            }
        }

        const document = {
            body: new Element('body'),
            activeElement: null,
            createElement: (tag) => new Element(tag),
            getElementById: (id) => document.body.querySelector('#' + id),
            querySelector: (selector) => document.body.querySelector(selector),
            querySelectorAll: (selector) => document.body.querySelectorAll(selector),
        };
        const window = new Element('window');
        Object.assign(window, {
            location: { ...location },
            innerHeight: 800,
            HTMLTextAreaElement: Element,
            HTMLInputElement: Element,
            postMessage: (data, targetOrigin) => harness.post(harness.running, realm, data, targetOrigin),
        });
        Object.assign(realm, { Element, document, window });
        this.realms.push(realm);
        return realm;
    }

    /**
     * @param {object} realm
     * @return {object}
     */
    globals(realm) {
        const harness = this;
        return {
            document: realm.document, window: realm.window, TextEncoder, URL, URLSearchParams, crypto: { randomUUID },
            Event: this.BrowserEvent, InputEvent: this.BrowserEvent, KeyboardEvent: this.BrowserEvent,
            Date: class extends Date { static now() { return harness.time; } },
            setTimeout: (callback, delay) => this.setTimer(callback, delay, false, realm),
            setInterval: (callback, delay) => this.setTimer(callback, delay, true, realm),
            clearTimeout: (id) => this.timers.delete(id),
            clearInterval: (id) => this.timers.delete(id),
            console: Object.fromEntries(['log', 'warn', 'error'].map((level) => [level, (...args) => this.logs.push(args)])),
        };
    }

    /**
     * @param {object} realm
     * @return {void}
     */
    addChat(realm) {
        const chat = realm.document.body.appendChild(new realm.Element('textarea'));
        chat.setAttribute('id', 'chat');
        chat.setAttribute('name', 'message');
        chat._valueTracker = { setValue: (value) => this.chatEvents.push({ type: 'tracker', value }) };
        for (const type of ['input', 'change', 'keydown']) {
            chat.addEventListener(type, (event) => this.chatEvents.push({ type, data: event.data, key: event.key }));
        }
    }

    /**
     * @return {?object}
     */
    openFrame() {
        this.frameLoads += 1;
        const previous = this.frame ?? null;
        this.frame = this.createRealm(this.frameLoads === 1 ? 'frame' : 'frame' + this.frameLoads, {
            origin: this.window.location.origin, pathname: 'blank',
        });
        this.frame.window.parent = this.window;
        this.iframe.contentWindow = this.frame.window;
        return previous;
    }

    /**
     * @return {?object}
     */
    reloadFrame() {
        const previous = this.openFrame();
        this.reloadSameWindow();
        return previous;
    }

    /**
     * @return {void}
     */
    reloadSameWindow() {
        const frame = this.frame;
        for (const [id, timer] of this.timers) {
            if (timer.realm === frame) {
                this.timers.delete(id);
            }
        }
        frame.window.listeners = new Map();
        frame.document.body.replaceChildren();
        frame.document.activeElement = null;
        const ancestorOrigins = this.ancestors === true ? [this.window.location.origin] : this.ancestors;
        frame.origin = 'https://frame.pingpong.ai';
        frame.window.location = {
            origin: frame.origin, pathname: '/v1/index.html', hash: '#run=r&host=h',
            ...(ancestorOrigins ? { ancestorOrigins } : {}),
        };
        this.addChat(frame);
        const body = frame.document.body;
        for (const [id, label] of [['suggest', 'Suggested replies'], ['asterisk', 'Insert asterisk'], ['send', 'Send']]) {
            const button = body.appendChild(new frame.Element('button'));
            button.setAttribute('id', id);
            button.setAttribute('aria-label', label);
            button.appendChild(new frame.Element('svg'));
        }
        for (const id of ['extra1', 'extra2', 'extra3']) {
            const input = body.appendChild(new frame.Element('input'));
            input.setAttribute('id', id);
            input.setAttribute('type', 'text');
        }
        /**
         * @param {string} name
         * @return {Function}
         */
        const logged = (name) => (...args) => {
            this.frameCalls.push({ name, args });
        };
        const context = {
            ...this.globals(frame),
            localStorage: Object.fromEntries(['getItem', 'setItem', 'removeItem', 'clear', 'key']
                .map((method) => [method, logged('localStorage.' + method)])),
        };
        if (!this.source.includes('// @grant        none')) {
            Object.assign(context, Object.fromEntries(['GM_getValue', 'GM_setValue', 'GM_registerMenuCommand',
                'GM_addValueChangeListener', 'GM_xmlhttpRequest'].map((name) => [name, logged(name)])));
        }
        this.within(frame, () => runInNewContext(this.source, context, { filename: 'zeta-dm-memory.user.js' }));
    }

    /**
     * @param {number} width
     * @param {number} height
     * @return {void}
     */
    setFrameRect(width, height) {
        this.iframe.rect = { width, height, bottom: height };
    }

    /**
     * @param {object} realm
     * @param {Function} callback
     * @return {unknown}
     */
    within(realm, callback) {
        const previous = this.running;
        this.running = realm;
        try {
            return callback();
        } finally {
            this.running = previous;
        }
    }

    /**
     * @param {?object} sender
     * @param {object} receiver
     * @param {unknown} data
     * @param {string} targetOrigin
     * @return {void}
     */
    post(sender, receiver, data, targetOrigin) {
        if (!sender) {
            throw new Error('postMessage called outside a realm');
        }
        const clone = structuredClone(data);
        let delivered = targetOrigin === receiver.origin;
        if (delivered && this.dropNextReady && clone?.kind === 'ready') {
            delivered = false;
            this.dropNextReady = false;
        }
        this.messages.push({ from: sender.name, to: receiver.name, targetOrigin, data: clone, delivered });
        if (delivered) {
            this.deliver(receiver, clone, sender.origin, sender.window);
        }
    }

    /**
     * @param {{origin: string, source: unknown}} sender
     * @param {object} target
     * @param {unknown} data
     * @return {void}
     */
    postAs({ origin, source }, target, data) {
        const receiver = this.realms.find((realm) => realm.window === target);
        const clone = structuredClone(data);
        this.messages.push({ from: 'forged', to: receiver.name, targetOrigin: receiver.origin, data: clone, delivered: true });
        this.deliver(receiver, clone, origin, source);
    }

    /**
     * @param {object} receiver
     * @param {unknown} data
     * @param {string} origin
     * @param {unknown} source
     * @return {void}
     */
    deliver(receiver, data, origin, source) {
        this.setTimer(() => receiver.window.emit(new this.BrowserEvent('message', {
            data: structuredClone(data), origin, source,
        })), 0, false, receiver);
    }

    /**
     * @param {object} document
     * @return {object}
     */
    byId(document) {
        return Object.fromEntries(document.body.descendants().filter((element) => element.id)
            .map((element) => [element.id, element]));
    }

    /**
     * @return {object}
     */
    get elements() {
        const elements = this.byId(this.document);
        return this.framed ? { ...elements, chat: this.frameElements.chat } : elements;
    }

    /**
     * @return {object}
     */
    get frameElements() {
        return this.byId(this.frame.document);
    }

    /**
     * @return {object}
     */
    get chatElements() {
        return this.framed ? this.frameElements : this.elements;
    }

    /**
     * @param {Function} callback
     * @param {number} delay
     * @param {boolean} repeating
     * @param {object} realm
     * @return {number}
     */
    setTimer(callback, delay, repeating, realm) {
        const id = ++this.nextTimer;
        this.timers.set(id, { callback, at: this.time + delay, interval: repeating ? delay : 0, realm });
        return id;
    }

    /**
     * @return {Promise<void>}
     */
    async flush() {
        for (let turn = 0; turn < 8; turn += 1) {
            await Promise.resolve();
        }
    }

    /**
     * @param {number} ms
     * @return {Promise<void>}
     */
    async advance(ms) {
        const target = this.time + ms;
        await this.flush();
        for (;;) {
            const next = [...this.timers].filter(([, timer]) => timer.at <= target)
                .sort(([leftId, left], [rightId, right]) => left.at - right.at || leftId - rightId)[0];
            if (!next) {
                break;
            }
            const [id, timer] = next;
            this.time = timer.at;
            if (timer.interval) {
                timer.at += timer.interval;
            } else {
                this.timers.delete(id);
            }
            this.within(timer.realm, timer.callback);
            await this.flush();
        }
        this.time = target;
        await this.flush();
    }

    /**
     * @param {string} text
     * @return {Promise<void>}
     */
    editNotes(text) {
        const notes = this.elements['zeta-dm-notes'];
        notes.focus();
        notes.value = text;
        notes.dispatchEvent(new this.BrowserEvent('input', { bubbles: true }));
        return this.flush();
    }

    /**
     * @param {string} pathname
     * @return {void}
     */
    navigate(pathname) {
        this.window.location.pathname = pathname;
    }

    /**
     * @return {Promise<void>}
     */
    focus() {
        this.window.dispatchEvent(new this.BrowserEvent('focus'));
        return this.flush();
    }

    /**
     * @param {string} elementId
     * @return {Promise<void>}
     */
    click(elementId) {
        const element = this.elements[elementId];
        if (!element.disabled) {
            element.dispatchEvent(new this.BrowserEvent('click'));
        }
        return this.flush();
    }

    /**
     * @param {string} elementId
     * @param {string|boolean} value
     * @return {Promise<void>}
     */
    change(elementId, value) {
        const element = this.elements[elementId];
        if (typeof value === 'boolean') {
            element.checked = value;
        } else {
            element.value = value;
        }
        element.dispatchEvent(new this.BrowserEvent('change'));
        return this.flush();
    }

    /**
     * @param {string} kind
     * @return {Promise<void>}
     */
    dispatchComposition(kind) {
        const notes = this.elements['zeta-dm-notes'];
        notes.focus();
        notes.dispatchEvent(new this.BrowserEvent(kind));
        return this.flush();
    }

    /**
     * @param {string} label
     * @param {?string} promptResult
     * @return {Promise<void>}
     */
    runMenu(label, promptResult = null) {
        this.promptResult = promptResult;
        this.menus.get(label)();
        this.promptResult = null;
        return this.flush();
    }

    /**
     * @param {string} key
     * @param {string} value
     * @return {Promise<void>}
     */
    remoteValue(key, value) {
        const previous = this.gmStorage.get(key);
        this.gmStorage.set(key, value);
        this.keyListeners.get(key)?.(key, previous, value, true);
        return this.flush();
    }

    /**
     * @param {number} index
     * @param {{status?: number, data?: unknown, headers?: string, finalUrl?: string, responseText?: string}} response
     * @return {Promise<void>}
     */
    completeRequest(index, { status = 200, data, headers = '', finalUrl, responseText = JSON.stringify(data) }) {
        const request = this.requests[index];
        request.onload({ status, responseText, responseHeaders: headers, finalUrl: finalUrl ?? request.url });
        return this.flush();
    }

    /**
     * @param {number} index
     * @param {string} kind
     * @return {Promise<void>}
     */
    failRequest(index, kind = 'error') {
        this.requests[index]['on' + kind]();
        return this.flush();
    }

    /**
     * @param {string} roomId
     * @return {?object}
     */
    readRoom(roomId) {
        return JSON.parse(this.localStorage.get('zeta_dm_mem_' + roomId) ?? 'null');
    }

    /**
     * @param {string} text
     * @return {void}
     */
    typeChat(text) {
        const chat = this.elements.chat;
        chat.focus();
        chat.value = text;
        this.chatEvents.length = 0;
    }

    /**
     * @return {boolean}
     */
    enter() {
        return this.elements.chat.dispatchEvent(new this.BrowserEvent('keydown', { key: 'Enter', bubbles: true }));
    }

    /**
     * @param {string} elementId
     * @param {object} [fields]
     * @return {boolean}
     */
    enterOn(elementId, fields = {}) {
        const element = this.chatElements[elementId];
        element.focus();
        return element.dispatchEvent(new this.BrowserEvent('keydown', { key: 'Enter', bubbles: true, ...fields }));
    }

    /**
     * @param {string} elementId
     * @return {boolean}
     */
    pointerOn(elementId) {
        return this.chatElements[elementId].dispatchEvent(new this.BrowserEvent('pointerdown'));
    }

    /**
     * @return {boolean}
     */
    pointerSend() {
        return this.pointerOn('send');
    }
}
