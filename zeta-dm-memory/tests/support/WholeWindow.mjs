import FakeSendWindow from './FakeSendWindow.mjs';

export default class WholeWindow extends FakeSendWindow {
    static Origin = 'https://zeta-ai.io';

    static Width = 1280;

    /**
     * @param {{ site: { respond: Function }, timers: import('./WholeTimers.mjs').default, path: string, width?: number, origin?: string, ancestors?: string[]|undefined, label?: string }} options
     */
    constructor(options) {
        super();
        const site = options.site;
        this.label = options.label ?? 'window';
        this.clock = options.timers;
        this.site = site;
        this.innerWidth = options.width ?? WholeWindow.Width;
        this.AbortController = AbortController;
        const origin = options.origin ?? WholeWindow.Origin;
        this.location = {
            origin,
            href: `${origin}${options.path}`,
            pathname: options.path,
            ancestorOrigins: options.ancestors === undefined ? undefined : Object.freeze([...options.ancestors]),
        };
        this.top = this;
        this.parent = this;
        this.dead = false;
        Object.defineProperty(this, 'seen', { value: new Map(), writable: false, enumerable: false, configurable: false });
        /**
         * @param {*} url
         * @param {object} options
         * @return {Promise<object>}
         */
        this.fetch = function (url, options) {
            return site.respond(this, url, options);
        };
    }

    /**
     * @param {string} path
     * @return {void}
     */
    go(path) {
        this.location.href = `${this.location.origin}${path}`;
        this.location.pathname = path;
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
     * @param {string} type
     * @return {number}
     */
    listening(type) {
        return this.listeners.filter((entry) => entry.type === type).length;
    }

    /**
     * @param {{ type: string, origin: string, source: *, data: * }} event
     * @return {void}
     */
    receive(event) {
        if (this.dead) {
            return;
        }
        for (const entry of this.listeners.filter((listening) => listening.type === event.type)) {
            entry.listener(event);
        }
    }
}
