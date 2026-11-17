import FakeDocument from './FakeDocument.mjs';
import PanelElement from './PanelElement.mjs';

export default class PanelDocument extends FakeDocument {
    /**
     * @param {number} innerWidth
     */
    constructor(innerWidth) {
        super('');
        this.defaultView = { innerWidth };
    }

    /**
     * @param {string} tag
     * @return {PanelElement}
     */
    createElement(tag) {
        const element = new PanelElement(tag);
        element.ownerDocument = this;
        this.elements.push(element);
        return element;
    }

    /**
     * @param {string} id
     * @return {PanelElement|null}
     */
    getElementById(id) {
        const found = this.body.descendants().find((element) => element.id === id);
        return found ?? super.getElementById(id);
    }
}
