import FakeZeta from './FakeZeta.mjs';

export default class WholeSite {
    static Api = 'https://api.zeta-ai.io';

    static Room = 'harbour';

    static Token = 'Bearer zeta-test-token-7f3a9c';

    static MostRequests = 600;

    /**
     * @param {import('./CampaignBuilder.mjs').default} builder
     */
    constructor(builder) {
        this.builder = builder;
        this.zeta = new FakeZeta(builder.messages, WholeSite.Room, WholeSite.Token);
        this.zeta.most = WholeSite.MostRequests;
        this.requests = [];
    }

    /**
     * @return {string}
     */
    static get Messages() {
        return `${WholeSite.Api}/v1/rooms/${WholeSite.Room}/messages`;
    }

    /**
     * @return {object[]}
     */
    get messages() {
        return this.builder.messages;
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
            method,
            url: String(url),
            authorization: typeof headers.Authorization === 'string' ? headers.Authorization : null,
            headers: JSON.stringify(headers),
            body: typeof options?.body === 'string' ? options.body : null,
        });
        if (method !== 'GET') {
            if (String(url) === WholeSite.Messages) {
                this.builder.player(JSON.parse(options.body).text);
            }
            return FakeZeta.reply(200, '{}');
        }
        return this.zeta.respond(receiver, url, options);
    }

    /**
     * @param {Array<[string, string]>} blocks
     * @return {object}
     */
    reply(blocks) {
        this.builder.reply(blocks);
        return this.messages.at(-1);
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
    ownRequests() {
        return this.requests.filter((request) => request.own);
    }
}
