import FakeElement from './FakeElement.mjs';

export default class FakeDocument {
    static VoidTags = Object.freeze(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'wbr']);

    /**
     * @param {string} markup
     * @throws {Error}
     */
    constructor(markup) {
        this.elements = [];
        this.byId = new Map();
        this.focused = null;
        this.body = this.createElement('body');
        const stack = [this.body];
        const tokens = markup
            .replace(/<script\b[\s\S]*?<\/script>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<!doctype[^>]*>/gi, '');
        for (const [, closing, tag, attributes, text] of tokens.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g)) {
            if (text !== undefined) {
                if (text.trim() !== '') {
                    stack.at(-1).append(FakeElement.text(text.trim()));
                }
                continue;
            }
            const name = tag.toLowerCase();
            if (closing === '/') {
                if (stack.length > 1 && stack.at(-1).tagName === name.toUpperCase()) {
                    stack.pop();
                }
                continue;
            }
            const element = this.createElement(name);
            for (const [, attribute, quoted] of attributes.matchAll(/([a-zA-Z][\w:-]*)(?:="([^"]*)")?/g)) {
                element.setAttribute(attribute, quoted ?? '');
            }
            if (element.id !== '') {
                if (this.byId.has(element.id)) {
                    throw new Error(`The markup repeats the id ${element.id}`);
                }
                this.byId.set(element.id, element);
            }
            stack.at(-1).append(element);
            if (!FakeDocument.VoidTags.includes(name)) {
                stack.push(element);
            }
        }
    }

    /**
     * @return {FakeElement}
     */
    get activeElement() {
        const focused = this.focused;
        if (focused === null || !focused.isConnected || focused.disabled) {
            return this.body;
        }
        return focused;
    }

    /**
     * @param {string} id
     * @return {FakeElement|null}
     */
    getElementById(id) {
        return this.byId.get(id) ?? null;
    }

    /**
     * @param {string} tag
     * @return {FakeElement}
     */
    createElement(tag) {
        const element = new FakeElement(tag);
        element.ownerDocument = this;
        this.elements.push(element);
        return element;
    }
}
