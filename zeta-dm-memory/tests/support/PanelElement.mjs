import FakeElement from './FakeElement.mjs';
import PanelShadowRoot from './PanelShadowRoot.mjs';

export default class PanelElement extends FakeElement {
    static Depth = 10000;

    /**
     * @param {string} tagName
     */
    constructor(tagName) {
        super(tagName);
        Object.defineProperty(this, 'shadow', { value: null, writable: true, enumerable: false, configurable: false });
        this.open = false;
        if (['INPUT', 'TEXTAREA'].includes(this.tagName)) {
            this.selectionStart = 0;
            this.selectionEnd = 0;
            this.selectionDirection = 'none';
        }
    }

    /**
     * @param {{ mode: string }} init
     * @return {PanelShadowRoot}
     * @throws {Error}
     */
    attachShadow(init) {
        if (this.shadow !== null) {
            throw new Error('This element already has a shadow root');
        }
        this.shadow = new PanelShadowRoot(this, init.mode);
        return this.shadow;
    }

    /**
     * @param {number} start
     * @param {number} end
     * @param {string} direction
     * @return {void}
     */
    setSelectionRange(start, end, direction = 'none') {
        this.selectionStart = start;
        this.selectionEnd = end;
        this.selectionDirection = direction;
    }

    /**
     * @param {{ type: string, bubbles?: boolean }} event
     * @return {boolean}
     */
    dispatchEvent(event) {
        super.dispatchEvent(event);
        if (event.bubbles !== true) {
            return true;
        }
        let node = this.parent;
        for (let depth = 0; node !== null && depth < PanelElement.Depth; depth++) {
            FakeElement.prototype.dispatchEvent.call(node, event);
            node = node.parent;
        }
        return true;
    }

    /**
     * @return {void}
     */
    remove() {
        if (this.parent === null) {
            return;
        }
        this.parent.children = this.parent.children.filter((child) => child !== this);
        this.parent = null;
    }
}
