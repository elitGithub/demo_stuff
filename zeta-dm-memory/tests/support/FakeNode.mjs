export default class FakeNode {
    static MostDepth = 20;

    /**
     * @param {string} tag
     * @param {{ id?: string, type?: string, name?: string, bottom?: number }} attributes
     */
    constructor(tag, attributes = {}) {
        for (const [name, value] of [
            ['parent', null],
            ['owner', null],
            ['children', []],
            ['listeners', []],
            ['events', []],
        ]) {
            Object.defineProperty(this, name, { value, writable: true, enumerable: false, configurable: false });
        }
        this.tagName = tag.toUpperCase();
        this.id = attributes.id ?? '';
        this.type = attributes.type ?? '';
        this.name = attributes.name ?? '';
        this.bottom = attributes.bottom ?? 0;
    }

    /**
     * @param {object|null} owner
     * @return {void}
     */
    adopt(owner) {
        const waiting = [this];
        for (let seen = 0; waiting.length > 0 && seen < FakeNode.MostDepth * FakeNode.MostDepth; seen++) {
            const node = waiting.shift();
            node.owner = owner;
            waiting.push(...node.children);
        }
    }

    /**
     * @param {FakeNode} child
     * @return {FakeNode}
     */
    append(child) {
        child.parent = this;
        this.children.push(child);
        child.adopt(this.owner);
        return child;
    }

    /**
     * @return {FakeNode[]}
     */
    ancestry() {
        const chain = [];
        let node = this;
        for (let depth = 0; node !== null && depth < FakeNode.MostDepth; depth++) {
            chain.push(node);
            node = node.parent;
        }
        return chain;
    }

    /**
     * @param {*} other
     * @return {boolean}
     */
    contains(other) {
        return other instanceof FakeNode && other.ancestry().includes(this);
    }

    /**
     * @param {string} selector
     * @return {boolean}
     * @throws {Error}
     */
    matches(selector) {
        if (selector.startsWith('#')) {
            return this.id === selector.slice(1);
        }
        if (/^[a-z]+$/.test(selector)) {
            return this.tagName === selector.toUpperCase();
        }
        throw new Error(`The fake node cannot match ${selector}`);
    }

    /**
     * @param {string} selector
     * @return {FakeNode|null}
     */
    closest(selector) {
        return this.ancestry().find((node) => node.matches(selector)) ?? null;
    }

    /**
     * @param {string} selector
     * @return {FakeNode|null}
     */
    querySelector(selector) {
        const waiting = [...this.children];
        for (let seen = 0; waiting.length > 0 && seen < FakeNode.MostDepth * FakeNode.MostDepth; seen++) {
            const node = waiting.shift();
            if (node.matches(selector)) {
                return node;
            }
            waiting.push(...node.children);
        }
        return null;
    }

    /**
     * @return {{ bottom: number }}
     */
    getBoundingClientRect() {
        return { bottom: this.bottom };
    }

    /**
     * @param {string} type
     * @param {Function} listener
     * @return {void}
     */
    addEventListener(type, listener) {
        this.listeners.push({ type, listener });
    }

    /**
     * @param {string} type
     * @param {Function} listener
     * @return {void}
     */
    removeEventListener(type, listener) {
        this.listeners = this.listeners.filter((entry) => entry.type !== type || entry.listener !== listener);
    }

    /**
     * @param {{ type: string, bubbles: boolean, inputType?: string|null, target: *, immediateStopped?: boolean, defaultPrevented: boolean }} event
     * @return {boolean}
     */
    dispatchEvent(event) {
        if (event.target === null || event.target === undefined) {
            event.target = this;
        }
        this.events.push([event.type, event.bubbles, event.inputType ?? null]);
        if (this.owner !== null) {
            this.owner.propagate(this, event);
            return !event.defaultPrevented;
        }
        for (const entry of this.listeners.filter((listening) => listening.type === event.type)) {
            if (event.immediateStopped !== true) {
                entry.listener(event);
            }
        }
        return !event.defaultPrevented;
    }
}
