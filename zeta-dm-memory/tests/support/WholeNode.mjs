import FakeNode from './FakeNode.mjs';

export default class WholeNode extends FakeNode {
    /**
     * @param {string} tag
     * @param {Object<string, string>} marks
     * @param {{ width?: number, height?: number, bottom?: number }} size
     */
    constructor(tag, marks = {}, size = {}) {
        super(tag, { id: marks.id, type: marks.type, name: marks.name, bottom: size.bottom ?? 0 });
        Object.defineProperty(this, 'marks', { value: new Map(Object.entries(marks)), writable: false, enumerable: false, configurable: false });
        this.width = size.width ?? 0;
        this.height = size.height ?? 0;
        this.src = typeof marks.src === 'string' ? marks.src : '';
        this.contentWindow = null;
    }

    /**
     * @param {string} name
     * @return {string|null}
     */
    getAttribute(name) {
        return this.marks.has(name) ? this.marks.get(name) : null;
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
        const parts = /^([a-z]+)(?:\[([a-z-]+)="([^"]*)"\])?$/.exec(selector);
        if (parts === null) {
            throw new Error(`The page node cannot match ${selector}`);
        }
        if (this.tagName !== parts[1].toUpperCase()) {
            return false;
        }
        return parts[2] === undefined || this.getAttribute(parts[2]) === parts[3];
    }

    /**
     * @return {{ width: number, height: number, top: number, left: number, bottom: number, right: number }}
     */
    getBoundingClientRect() {
        return { width: this.width, height: this.height, top: this.bottom - this.height, left: 0, bottom: this.bottom, right: this.width };
    }
}
