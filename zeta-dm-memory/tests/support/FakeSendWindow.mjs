import FakeClock from './FakeClock.mjs';
import FakeEvent from './FakeEvent.mjs';
import FakeTextArea from './FakeTextArea.mjs';
import FakeTextInput from './FakeTextInput.mjs';

export default class FakeSendWindow {
    static MostDepth = 20;

    constructor() {
        this.clock = new FakeClock(0);
        this.listeners = [];
        this.innerHeight = 900;
        this.HTMLTextAreaElement = FakeTextArea;
        this.HTMLInputElement = FakeTextInput;
        this.Event = FakeEvent;
        this.InputEvent = FakeEvent;
        this.KeyboardEvent = FakeEvent;
    }

    /**
     * @param {boolean|{ capture?: boolean }|undefined} options
     * @return {boolean}
     */
    static capturing(options) {
        return options === true || (typeof options === 'object' && options !== null && options.capture === true);
    }

    /**
     * @param {string} type
     * @param {Function} listener
     * @param {boolean|{ capture?: boolean }|undefined} options
     * @return {void}
     */
    addEventListener(type, listener, options) {
        this.listeners.push({ type, listener, capture: FakeSendWindow.capturing(options) });
    }

    /**
     * @param {string} type
     * @param {Function} listener
     * @param {boolean|{ capture?: boolean }|undefined} options
     * @return {void}
     */
    removeEventListener(type, listener, options) {
        const capture = FakeSendWindow.capturing(options);
        const index = this.listeners.findIndex(
            (entry) => entry.type === type && entry.listener === listener && entry.capture === capture,
        );
        if (index >= 0) {
            this.listeners.splice(index, 1);
        }
    }

    /**
     * @return {number}
     */
    get listenerCount() {
        return this.listeners.length;
    }

    /**
     * @return {number}
     */
    get timerCount() {
        return this.clock.timers.size;
    }

    /**
     * @param {Function} callback
     * @param {number} delay
     * @return {number}
     */
    setTimeout(callback, delay) {
        return this.clock.setTimeout(callback, delay);
    }

    /**
     * @param {number|null} id
     * @return {void}
     */
    clearTimeout(id) {
        this.clock.clearInterval(id);
    }

    /**
     * @param {number} milliseconds
     * @return {void}
     */
    advance(milliseconds) {
        this.clock.advance(milliseconds);
    }

    /**
     * @param {object} target
     * @param {FakeEvent} event
     * @return {FakeEvent}
     */
    propagate(target, event) {
        const chain = [];
        let node = target;
        for (let depth = 0; node !== null && node !== undefined && depth < FakeSendWindow.MostDepth; depth++) {
            chain.push(node);
            node = node.parent;
        }
        if (event.path === null) {
            event.path = [...chain, this];
        }
        /**
         * @param {Array<{ listener: Function }>} entries
         * @return {void}
         */
        const run = (entries) => {
            for (const entry of entries) {
                if (!event.immediateStopped) {
                    entry.listener(event);
                }
            }
        };
        event.eventPhase = 1;
        run(this.listeners.filter((listening) => listening.type === event.type && listening.capture));
        for (const step of chain) {
            if (event.stopped) {
                break;
            }
            event.eventPhase = step === target ? 2 : 3;
            run((step.listeners ?? []).filter((listening) => listening.type === event.type));
            if (!event.bubbles) {
                break;
            }
        }
        if (event.bubbles && !event.stopped) {
            event.eventPhase = 3;
            run(this.listeners.filter((listening) => listening.type === event.type && !listening.capture));
        }
        event.eventPhase = 0;
        return event;
    }

    /**
     * @param {object} target
     * @param {string} type
     * @param {object} init
     * @return {FakeEvent}
     */
    dispatch(target, type, init = {}) {
        const event = new FakeEvent(type, { bubbles: true, cancelable: true, ...init });
        event.target = target;
        return this.propagate(target, event);
    }
}
