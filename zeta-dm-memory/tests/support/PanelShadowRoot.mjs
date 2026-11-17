import FakeElement from './FakeElement.mjs';

export default class PanelShadowRoot extends FakeElement {
    static Depth = 10000;

    /**
     * @param {FakeElement} host
     * @param {string} mode
     */
    constructor(host, mode) {
        super('#shadow-root');
        Object.defineProperty(this, 'host', { value: host, writable: false, enumerable: false, configurable: false });
        this.mode = mode;
        this.parent = host;
        this.ownerDocument = host.ownerDocument;
    }

    /**
     * @return {FakeElement|null}
     */
    get activeElement() {
        const active = this.ownerDocument.activeElement;
        let node = active;
        for (let depth = 0; node !== null && depth < PanelShadowRoot.Depth; depth++) {
            if (node === this) {
                return active;
            }
            node = node.parent;
        }
        return null;
    }
}
