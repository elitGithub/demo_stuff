import FakeNode from './FakeNode.mjs';

export default class FakeTextArea extends FakeNode {
    /**
     * @param {{ id?: string, name?: string, type?: string, tracker?: boolean }} attributes
     * @param {string} tag
     */
    constructor(attributes = {}, tag = 'textarea') {
        super(tag, attributes);
        for (const [name, value] of [
            ['current', ''],
            ['tracked', ''],
            ['writes', []],
            ['trackerCalls', []],
            ['trail', []],
            ['selectionStart', 0],
            ['selectionEnd', 0],
        ]) {
            Object.defineProperty(this, name, { value, writable: true, enumerable: false, configurable: false });
        }
        const native = Object.getOwnPropertyDescriptor(new.target.prototype, 'value');
        Object.defineProperty(this, 'value', {
            enumerable: false,
            configurable: true,
            get: () => native.get.call(this),
            set: (value) => {
                this.writes.push(`instance:${String(value)}`);
                this.trail.push(`instance:${String(value)}`);
                this.tracked = String(value);
                native.set.call(this, value);
            },
        });
        if (attributes.tracker !== false) {
            Object.defineProperty(this, '_valueTracker', {
                enumerable: false,
                configurable: false,
                value: Object.freeze({
                    setValue: (value) => {
                        this.trackerCalls.push(String(value));
                        this.trail.push(`tracker:${String(value)}`);
                        this.tracked = String(value);
                    },
                }),
            });
        }
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

    /**
     * @param {object} event
     * @return {boolean}
     */
    dispatchEvent(event) {
        this.trail.push(`event:${event.type}:${event.bubbles}:${event.inputType ?? ''}`);
        return super.dispatchEvent(event);
    }

    /**
     * @param {number} start
     * @param {number} end
     * @return {void}
     */
    setSelectionRange(start, end) {
        this.trail.push(`select:${start}:${end}`);
        this.selectionStart = start;
        this.selectionEnd = end;
    }

    /**
     * @return {void}
     */
    forget() {
        this.writes = [];
        this.trackerCalls = [];
        this.events = [];
        this.trail = [];
    }
}
