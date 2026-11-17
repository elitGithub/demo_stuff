export default class WholeHandle {
    /**
     * @param {import('./WholeWindow.mjs').default} from
     * @param {import('./WholeWindow.mjs').default} to
     * @param {object[]} posts
     */
    constructor(from, to, posts) {
        Object.defineProperty(this, 'from', { value: from, writable: false, enumerable: false, configurable: false });
        Object.defineProperty(this, 'to', { value: to, writable: false, enumerable: false, configurable: false });
        Object.defineProperty(this, 'posts', { value: posts, writable: false, enumerable: false, configurable: false });
    }

    /**
     * @param {*} message
     * @param {string} targetOrigin
     * @return {void}
     * @throws {Error}
     */
    postMessage(message, targetOrigin) {
        const from = this.from;
        const to = this.to;
        const data = structuredClone(message);
        const delivered = targetOrigin === '*' || targetOrigin === to.location.origin;
        this.posts.push({
            from: from.location.origin,
            to: to.location.origin,
            fromLabel: from.label,
            toLabel: to.label,
            target: String(targetOrigin),
            data: JSON.stringify(data),
            delivered,
        });
        if (!delivered || from.dead || to.dead) {
            return;
        }
        const source = to.seen.get(from) ?? null;
        Promise.resolve().then(() => {
            to.receive({ type: 'message', isTrusted: true, origin: from.location.origin, source, data });
        });
    }
}
