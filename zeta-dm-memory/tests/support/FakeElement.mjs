export default class FakeElement {
    /**
     * @param {string} tagName
     */
    constructor(tagName) {
        for (const [name, value] of [
            ['parent', null],
            ['ownerDocument', null],
            ['written', []],
            ['listeners', new Map()],
        ]) {
            Object.defineProperty(this, name, { value, writable: true, enumerable: false, configurable: false });
        }
        this.tagName = tagName.toUpperCase();
        this.id = '';
        this.type = '';
        this.current = '';
        this.checked = false;
        this.disabled = false;
        this.hidden = false;
        this.children = [];
        this.attributes = new Map();
        this.classes = new Set();
        this.ownText = '';
    }

    /**
     * @return {boolean}
     */
    get isConnected() {
        let node = this;
        while (node.parent !== null) {
            node = node.parent;
        }
        return this.ownerDocument !== null && node === this.ownerDocument.body;
    }

    /**
     * @return {void}
     */
    focus() {
        if (this.disabled || this.ownerDocument === null || !this.isConnected) {
            return;
        }
        this.ownerDocument.focused = this;
        this.dispatchEvent({ type: 'focus' });
    }

    /**
     * @param {string} text
     * @return {FakeElement}
     */
    static text(text) {
        const node = new FakeElement('#text');
        node.ownText = text;
        return node;
    }

    /**
     * @return {string}
     */
    get value() {
        return this.current;
    }

    /**
     * @param {*} value
     */
    set value(value) {
        this.current = String(value);
        this.written.push({ kind: 'value', text: this.current });
    }

    /**
     * @return {string}
     */
    get textContent() {
        return this.ownText + this.children.map((child) => child.textContent).join('');
    }

    /**
     * @param {*} text
     */
    set textContent(text) {
        this.detach();
        this.ownText = String(text);
        this.written.push({ kind: 'text', text: this.ownText });
    }

    /**
     * @return {{ add: Function, remove: Function, contains: Function, toggle: Function }}
     */
    get classList() {
        const classes = this.classes;
        return {
            /**
             * @param {...string} names
             * @return {void}
             */
            add: (...names) => {
                for (const name of names) {
                    classes.add(name);
                }
            },
            /**
             * @param {...string} names
             * @return {void}
             */
            remove: (...names) => {
                for (const name of names) {
                    classes.delete(name);
                }
            },
            /**
             * @param {string} name
             * @return {boolean}
             */
            contains: (name) => classes.has(name),
            /**
             * @param {string} name
             * @return {boolean}
             */
            toggle: (name) => {
                if (classes.has(name)) {
                    classes.delete(name);
                    return false;
                }
                classes.add(name);
                return true;
            },
        };
    }

    /**
     * @return {void}
     */
    detach() {
        for (const child of this.children) {
            child.parent = null;
        }
        this.children = [];
    }

    /**
     * @param {...(FakeElement|string)} nodes
     * @return {void}
     */
    append(...nodes) {
        for (const node of nodes) {
            const child = typeof node === 'string' ? FakeElement.text(node) : node;
            if (child.parent !== null) {
                child.parent.children = child.parent.children.filter((sibling) => sibling !== child);
            }
            child.parent = this;
            this.children.push(child);
        }
    }

    /**
     * @param {...(FakeElement|string)} nodes
     * @return {void}
     */
    replaceChildren(...nodes) {
        this.detach();
        this.ownText = '';
        this.append(...nodes);
    }

    /**
     * @param {string} type
     * @param {Function} listener
     * @return {void}
     */
    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    /**
     * @param {{ type: string }} event
     * @return {boolean}
     */
    dispatchEvent(event) {
        for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
            listener({ target: this, ...event });
        }
        return true;
    }

    /**
     * @return {void}
     */
    click() {
        if (!this.disabled) {
            this.dispatchEvent({ type: 'click' });
        }
    }

    /**
     * @param {string} name
     * @param {*} value
     * @return {void}
     */
    setAttribute(name, value) {
        const text = String(value);
        this.attributes.set(name, text);
        this.written.push({ kind: name, text });
        if (name === 'id' || name === 'type') {
            this[name] = text;
        }
        if (name === 'hidden') {
            this.hidden = true;
        }
    }

    /**
     * @param {string} name
     * @return {string|null}
     */
    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    /**
     * @param {string} name
     * @return {void}
     */
    removeAttribute(name) {
        this.attributes.delete(name);
        if (name === 'hidden') {
            this.hidden = false;
        }
    }

    /**
     * @return {FakeElement[]}
     */
    descendants() {
        return this.children.flatMap((child) => [child, ...child.descendants()]);
    }
}
