import FakeZeta from './FakeZeta.mjs';

export default class WholeSite {
    static Api = 'https://api.zeta-ai.io';

    static Room = 'harbour';

    static Token = 'Bearer zeta-test-token-7f3a9c';

    static MostRequests = 600;

    static Profile = 'Halvard is a harbour guard, thirty-four winters old, who once ran from a siege.';

    /**
     * @param {import('./CampaignBuilder.mjs').default} builder
     */
    constructor(builder) {
        this.rooms = new Map();
        this.requests = [];
        this.clock = null;
        this.open(WholeSite.Room, builder);
    }

    /**
     * @param {string} room
     * @return {string}
     */
    static messagesOf(room) {
        return `${WholeSite.Api}/v1/rooms/${room}/messages`;
    }

    /**
     * @return {string}
     */
    static get Messages() {
        return WholeSite.messagesOf(WholeSite.Room);
    }

    /**
     * @param {string} room
     * @param {import('./CampaignBuilder.mjs').default} builder
     * @return {void}
     */
    open(room, builder) {
        const zeta = new FakeZeta(builder.messages, room, WholeSite.Token);
        zeta.most = WholeSite.MostRequests;
        zeta.plot = `plot-${room}`;
        zeta.profile = WholeSite.Profile;
        this.rooms.set(room, { builder, zeta });
    }

    /**
     * @param {string} room
     * @return {object[]}
     */
    messagesIn(room) {
        return this.rooms.get(room).builder.messages;
    }

    /**
     * @return {object[]}
     */
    get messages() {
        return this.messagesIn(WholeSite.Room);
    }

    /**
     * @param {*} url
     * @return {string|null}
     */
    static roomOf(url) {
        const found = /^\/v1\/rooms\/([^/]+)/.exec(new URL(String(url)).pathname);
        return found === null ? null : decodeURIComponent(found[1]);
    }

    /**
     * @param {*} url
     * @return {object|undefined}
     */
    keptFor(url) {
        const plot = /^\/v1\/plots\/([^/]+)$/.exec(new URL(String(url)).pathname);
        if (plot === null) {
            const room = WholeSite.roomOf(url);
            return room === null ? undefined : this.rooms.get(room);
        }
        return [...this.rooms.values()].find(
            (entry) => entry.zeta.plot !== null && encodeURIComponent(entry.zeta.plot) === plot[1],
        );
    }

    /**
     * @param {*} url
     * @return {boolean}
     */
    static paged(url) {
        return /^\/v1\/rooms\/[^/]+\/messages$/.test(new URL(String(url)).pathname);
    }

    /**
     * @param {*} receiver
     * @param {*} url
     * @param {object} options
     * @return {Promise<{ status: number, ok: boolean, text: () => Promise<string> }>}
     */
    async respond(receiver, url, options) {
        const method = String(options?.method ?? 'GET').toUpperCase();
        const headers = options?.headers ?? {};
        this.requests.push({
            own: options?.own === true,
            at: this.clock === null ? null : this.clock.now(),
            origin: typeof receiver?.location?.origin === 'string' ? receiver.location.origin : null,
            method,
            url: String(url),
            authorization: typeof headers.Authorization === 'string' ? headers.Authorization : null,
            headers: JSON.stringify(headers),
            body: typeof options?.body === 'string' ? options.body : null,
        });
        const kept = this.keptFor(url);
        if (kept === undefined) {
            return FakeZeta.reply(404, 'No such room.');
        }
        if (method !== 'GET') {
            if (String(url) === WholeSite.messagesOf(kept.zeta.room)) {
                kept.builder.player(JSON.parse(options.body).text);
            }
            return FakeZeta.reply(200, '{}');
        }
        return kept.zeta.respond(receiver, url, options);
    }

    /**
     * @param {Array<[string, string]>} blocks
     * @param {string} room
     * @return {object}
     */
    reply(blocks, room = WholeSite.Room) {
        this.rooms.get(room).builder.reply(blocks);
        return this.messagesIn(room).at(-1);
    }

    /**
     * @param {number} position
     * @param {object} message
     * @return {object}
     */
    put(position, message) {
        const before = this.messages[position - 1];
        this.messages[position - 1] = message;
        return before;
    }

    /**
     * @param {number} position
     * @param {string} text
     * @return {void}
     */
    edit(position, text) {
        const before = this.messages[position - 1];
        this.messages[position - 1] = {
            ...before,
            contents: before.contents.map((block, index) => (index === 0 ? { ...block, text } : block)),
            edited: true,
        };
    }

    /**
     * @return {object[]}
     */
    scribeRequests() {
        return this.requests.filter((request) => !request.own);
    }

    /**
     * @return {object[]}
     */
    pageRequests() {
        return this.scribeRequests().filter((request) => WholeSite.paged(request.url));
    }

    /**
     * @return {object[]}
     */
    ownRequests() {
        return this.requests.filter((request) => request.own);
    }
}
