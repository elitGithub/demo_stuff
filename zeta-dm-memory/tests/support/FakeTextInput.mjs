import FakeTextArea from './FakeTextArea.mjs';

export default class FakeTextInput extends FakeTextArea {
    /**
     * @param {{ id?: string, name?: string, tracker?: boolean }} attributes
     */
    constructor(attributes = {}) {
        super({ type: 'text', ...attributes }, 'input');
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
        this.writes.push(`native:${String(value)}`);
        this.trail.push(`native:${String(value)}`);
        this.current = String(value);
    }
}
