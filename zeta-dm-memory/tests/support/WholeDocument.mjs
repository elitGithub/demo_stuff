import FakeNode from './FakeNode.mjs';
import PanelDocument from './PanelDocument.mjs';
import WholeElement from './WholeElement.mjs';

export default class WholeDocument extends PanelDocument {
    static MostNodes = 5000;

    static Selectors = Object.freeze({
        'textarea[name="message"]': (node) => node.tagName === 'TEXTAREA' && node.name === 'message',
        textarea: (node) => node.tagName === 'TEXTAREA',
        'input[type="text"]': (node) => node.tagName === 'INPUT' && node.type === 'text',
    });

    /**
     * @param {object} window
     */
    constructor(window) {
        super(window.innerWidth);
        this.defaultView = window;
        this.documentElement = this.createElement('html');
        this.visibilityState = 'visible';
        this.heard = [];
        this.page = [];
        this.asked = [];
    }

    /**
     * @param {string} tag
     * @return {WholeElement}
     */
    createElement(tag) {
        const element = new WholeElement(tag);
        element.ownerDocument = this;
        this.elements.push(element);
        return element;
    }

    /**
     * @param {string} type
     * @param {Function} listener
     * @return {void}
     */
    addEventListener(type, listener) {
        this.heard.push({ type, listener });
    }

    /**
     * @param {string} type
     * @param {Function} listener
     * @return {void}
     */
    removeEventListener(type, listener) {
        this.heard = this.heard.filter((entry) => entry.type !== type || entry.listener !== listener);
    }

    /**
     * @param {string} type
     * @return {number}
     */
    listening(type) {
        return this.heard.filter((entry) => entry.type === type).length;
    }

    /**
     * @param {string} state
     * @return {void}
     */
    show(state) {
        this.visibilityState = state;
        for (const entry of this.heard.filter((listening) => listening.type === 'visibilitychange')) {
            entry.listener({ type: 'visibilitychange' });
        }
    }

    /**
     * @param {FakeNode} node
     * @return {FakeNode}
     */
    add(node) {
        this.page.push(node);
        node.adopt(this.defaultView);
        return node;
    }

    /**
     * @param {object|null} node
     * @return {void}
     */
    focusOn(node) {
        this.focused = node;
    }

    /**
     * @return {object}
     */
    get activeElement() {
        if (this.focused instanceof FakeNode) {
            return this.focused;
        }
        return super.activeElement;
    }

    /**
     * @param {string} selector
     * @return {object[]}
     * @throws {Error}
     */
    querySelectorAll(selector) {
        this.asked.push(selector);
        if (!Object.hasOwn(WholeDocument.Selectors, selector)) {
            throw new Error(`The page cannot answer ${selector}`);
        }
        const matches = WholeDocument.Selectors[selector];
        const found = [];
        const waiting = [...this.page, ...this.body.children];
        for (let seen = 0; waiting.length > 0; seen++) {
            if (seen >= WholeDocument.MostNodes) {
                throw new Error('The page holds more nodes than a walk may visit');
            }
            const node = waiting.shift();
            if (matches(node)) {
                found.push(node);
            }
            waiting.push(...node.children);
        }
        return found;
    }
}
