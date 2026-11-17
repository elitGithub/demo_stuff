import FakeNode from './FakeNode.mjs';

export default class FakeSendDocument {
    static Selectors = Object.freeze({
        'textarea[name="message"]': (node) => node.tagName === 'TEXTAREA' && node.name === 'message',
        textarea: (node) => node.tagName === 'TEXTAREA',
        'input[type="text"]': (node) => node.tagName === 'INPUT' && node.type === 'text',
    });

    /**
     * @param {object} window
     */
    constructor(window) {
        this.window = window;
        this.nodes = [];
        this.activeElement = null;
        this.asked = [];
    }

    /**
     * @param {FakeNode} node
     * @return {FakeNode}
     */
    add(node) {
        this.nodes.push(node);
        node.adopt(this.window);
        return node;
    }

    /**
     * @param {FakeNode} node
     * @return {void}
     */
    remove(node) {
        this.nodes = this.nodes.filter((other) => other !== node);
    }

    /**
     * @param {FakeNode} node
     * @return {FakeNode}
     */
    focus(node) {
        this.activeElement = node;
        return node;
    }

    /**
     * @return {FakeNode[]}
     */
    all() {
        const found = [];
        const waiting = [...this.nodes];
        for (let seen = 0; waiting.length > 0 && seen < FakeNode.MostDepth * FakeNode.MostDepth; seen++) {
            const node = waiting.shift();
            found.push(node);
            waiting.unshift(...node.children);
        }
        return found;
    }

    /**
     * @param {string} selector
     * @return {FakeNode[]}
     * @throws {Error}
     */
    querySelectorAll(selector) {
        this.asked.push(selector);
        if (!Object.hasOwn(FakeSendDocument.Selectors, selector)) {
            throw new Error(`The fake document cannot answer ${selector}`);
        }
        return this.all().filter(FakeSendDocument.Selectors[selector]);
    }
}
