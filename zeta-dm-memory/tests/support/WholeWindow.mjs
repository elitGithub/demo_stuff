import FakeSendWindow from './FakeSendWindow.mjs';

export default class WholeWindow extends FakeSendWindow {
    static Origin = 'https://zeta-ai.io';

    static Width = 1280;

    /**
     * @param {{ respond: Function }} site
     * @param {import('./WholeTimers.mjs').default} timers
     * @param {string} path
     * @param {number} width
     */
    constructor(site, timers, path, width = WholeWindow.Width) {
        super();
        this.clock = timers;
        this.site = site;
        this.innerWidth = width;
        this.AbortController = AbortController;
        this.location = { href: `${WholeWindow.Origin}${path}`, pathname: path };
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
        this.location.href = `${WholeWindow.Origin}${path}`;
        this.location.pathname = path;
    }
}
