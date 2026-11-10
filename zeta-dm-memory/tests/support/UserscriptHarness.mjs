import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';

export class UserscriptHarness {
    /**
     * @param {{source: string, pathname: string, localStorage?: Map, gmStorage?: Map}} options
     */
    constructor({ source, pathname, localStorage = new Map(), gmStorage = new Map() }) {
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
        this.failLocalWrites = false;
        this.hasAbortHandle = true;
        this.menus = new Map();
        this.keyListeners = new Map();
        this.time = Date.parse('2026-11-10T10:00:00.000Z');
        this.timers = new Map();
        this.nextTimer = 0;
        const harness = this;

        class BrowserEvent {
            constructor(type, data = {}) {
                Object.assign(this, { type, defaultPrevented: false, stopped: false }, data);
            }
            preventDefault() { this.defaultPrevented = true; }
            stopImmediatePropagation() { this.stopped = true; }
        }

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
                if (['id', 'name', 'type'].includes(name)) {
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
                    default: return selector.startsWith('#') ? this.id === selector.slice(1) : this.tagName === selector.toUpperCase();
                }
            }
            querySelector(selector) { return this.descendants().find((element) => element.matches(selector)) ?? null; }
            closest(selector) {
                for (let element = this; element; element = element.parent) {
                    if (element.matches(selector)) {
                        return element;
                    }
                }
                return null;
            }
            getBoundingClientRect() { return { bottom: 790 }; }
            focus() { document.activeElement = this; }
            addEventListener(type, listener) {
                if (!this.listeners.has(type)) {
                    this.listeners.set(type, []);
                }
                this.listeners.get(type).push(listener);
            }
            dispatchEvent(event) {
                event.target = this;
                if (this !== window && (event.type === 'keydown' || event.type === 'pointerdown')) {
                    window.emit(event);
                }
                this.emit(event);
                return !event.defaultPrevented;
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
        };
        const window = new Element('window');
        Object.assign(window, {
            location: { pathname },
            innerHeight: 800,
            HTMLTextAreaElement: Element,
            HTMLInputElement: Element,
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
        const chat = document.body.appendChild(new Element('textarea'));
        chat.setAttribute('id', 'chat');
        chat.setAttribute('name', 'message');
        chat._valueTracker = { setValue: (value) => this.chatEvents.push({ type: 'tracker', value }) };
        for (const type of ['input', 'change', 'keydown']) {
            chat.addEventListener(type, (event) => this.chatEvents.push({ type, data: event.data, key: event.key }));
        }
        const send = document.body.appendChild(new Element('button'));
        send.setAttribute('id', 'send');
        send.setAttribute('type', 'submit');
        this.document = document;
        this.window = window;
        this.BrowserEvent = BrowserEvent;
        const context = {
            document, window, TextEncoder, URL, URLSearchParams, crypto: { randomUUID },
            Event: BrowserEvent, InputEvent: BrowserEvent, KeyboardEvent: BrowserEvent,
            Date: class extends Date { static now() { return harness.time; } },
            setTimeout: (callback, delay) => this.setTimer(callback, delay, false),
            setInterval: (callback, delay) => this.setTimer(callback, delay, true),
            clearTimeout: (id) => this.timers.delete(id),
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
            console: Object.fromEntries(['log', 'warn', 'error'].map((level) => [level, (...args) => this.logs.push(args)])),
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
        runInNewContext(source, context, { filename: 'zeta-dm-memory.user.js' });
    }

    /**
     * @return {object}
     */
    get elements() {
        return Object.fromEntries(this.document.body.descendants().filter((element) => element.id)
            .map((element) => [element.id, element]));
    }

    /**
     * @param {Function} callback
     * @param {number} delay
     * @param {boolean} repeating
     * @return {number}
     */
    setTimer(callback, delay, repeating) {
        const id = ++this.nextTimer;
        this.timers.set(id, { callback, at: this.time + delay, interval: repeating ? delay : 0 });
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
            timer.callback();
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
     * @return {void}
     */
    pointerSend() {
        this.elements.send.dispatchEvent(new this.BrowserEvent('pointerdown'));
    }
}
