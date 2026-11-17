import PanelElement from './PanelElement.mjs';

export default class WholeElement extends PanelElement {
    static Depth = 200;

    /**
     * @param {string} name
     * @return {boolean}
     */
    hasAttribute(name) {
        return this.attributes.has(name);
    }

    /**
     * @param {*} other
     * @return {boolean}
     */
    contains(other) {
        let node = other;
        for (let depth = 0; node !== null && node !== undefined && depth < WholeElement.Depth; depth++) {
            if (node === this) {
                return true;
            }
            node = node.parent;
        }
        return false;
    }
}
