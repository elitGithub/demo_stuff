import FakeSendWindow from './FakeSendWindow.mjs';

export default class FakeFrameWindow extends FakeSendWindow {
    constructor() {
        super();
        const posted = [];
        this.posted = posted;
        this.parent = {
            /**
             * @param {*} data
             * @param {string} origin
             * @return {void}
             */
            postMessage: (data, origin) => {
                posted.push({ data: structuredClone(data), origin });
            },
        };
    }

    /**
     * @param {Function} callback
     * @param {number} delay
     * @return {number}
     */
    setInterval(callback, delay) {
        return this.clock.setInterval(callback, delay);
    }

    /**
     * @param {number|null} id
     * @return {void}
     */
    clearInterval(id) {
        this.clock.clearInterval(id);
    }

    /**
     * @param {*} data
     * @param {string} origin
     * @param {*} source
     * @param {object} trust
     * @return {void}
     */
    deliver(data, origin, source, trust = { isTrusted: true }) {
        const event = { type: 'message', data, origin, source, ...trust };
        for (const entry of this.listeners.filter((listening) => listening.type === 'message')) {
            entry.listener(event);
        }
    }
}
