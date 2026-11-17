export default class FakeServer {
    static Endpoint = 'https://openrouter.ai/api/v1/chat/completions';

    static PrivatePath = '/private/';

    /**
     * @param {Object<string, string>} files
     */
    constructor(files) {
        this.files = new Map(Object.entries(files));
        this.requests = [];
        this.refusing = new Set();
        this.holding = new Map();
        /**
         * @return {{ content: string, cost: number|null }|{ status: number }}
         * @throws {Error}
         */
        this.model = () => {
            throw new Error('No model answer is scripted.');
        };
        /**
         * @param {string} url
         * @param {object} options
         * @return {Promise<{ status: number, text: () => Promise<string> }>}
         */
        this.fetch = (url, options) => this.respond(url, options);
    }

    /**
     * @param {number} status
     * @param {string} body
     * @return {{ status: number, text: () => Promise<string> }}
     */
    static reply(status, body) {
        return {
            status,
            /**
             * @return {Promise<string>}
             */
            text: async () => body,
        };
    }

    /**
     * @return {Array<{ url: string, method: string, headers: Object<string, string>, body: string|null, system: string, user: string }>}
     */
    get modelCalls() {
        return this.requests.filter((request) => request.url === FakeServer.Endpoint);
    }

    /**
     * @return {Array<{ url: string, method: string, headers: Object<string, string>, body: string|null }>}
     */
    get posts() {
        return this.requests.filter((request) => request.method === 'POST' && request.url !== FakeServer.Endpoint);
    }

    /**
     * @param {string} name
     * @return {Array<{ url: string, method: string, headers: Object<string, string>, body: string|null }>}
     */
    postsOf(name) {
        return this.posts.filter((request) => request.url === FakeServer.PrivatePath + name);
    }

    /**
     * @param {string} name
     * @param {string} method
     * @return {{ open: () => void, reached: Promise<void> }}
     */
    hold(name, method) {
        let open = null;
        let reach = null;
        const gate = new Promise((resolve) => {
            open = resolve;
        });
        const reached = new Promise((resolve) => {
            reach = resolve;
        });
        this.holding.set(`${method} ${name}`, { gate, reach });
        return { open, reached };
    }

    /**
     * @param {{ signal: object|null }} request
     * @return {Promise<never>}
     */
    static aborted(request) {
        return new Promise((resolve, reject) => {
            if (request.signal === null) {
                return;
            }
            /**
             * @return {void}
             */
            const fail = () => {
                const error = new Error('The request was aborted.');
                error.name = 'AbortError';
                reject(error);
            };
            if (request.signal.aborted) {
                fail();
                return;
            }
            request.signal.addEventListener('abort', fail, { once: true });
        });
    }

    /**
     * @param {string} url
     * @param {{ method?: string, headers?: Object<string, string>, body?: string, signal?: object }} options
     * @return {Promise<{ status: number, text: () => Promise<string> }>}
     * @throws {TypeError}
     */
    async respond(url, options = {}) {
        const request = {
            url: String(url),
            method: options.method ?? 'GET',
            headers: { ...(options.headers ?? {}) },
            body: options.body ?? null,
            signal: options.signal ?? null,
        };
        this.requests.push(request);
        if (request.url === FakeServer.Endpoint) {
            const sent = JSON.parse(request.body);
            request.system = sent.messages[0].content;
            request.user = sent.messages[1].content;
            request.model = sent.model;
            const scripted = await Promise.race([
                this.model(request, this.modelCalls.length),
                FakeServer.aborted(request),
            ]);
            if (scripted.status !== undefined) {
                return FakeServer.reply(scripted.status, 'Refused by the fake provider');
            }
            const usage = { prompt_tokens: 100, completion_tokens: 50 };
            if (scripted.cost !== null) {
                usage.cost = scripted.cost;
            }
            const answer = { choices: [{ finish_reason: 'stop', message: { content: scripted.content } }], usage };
            return FakeServer.reply(200, JSON.stringify(answer));
        }
        if (!request.url.startsWith(FakeServer.PrivatePath)) {
            throw new TypeError(`The fake server does not serve ${request.url}`);
        }
        const name = request.url.slice(FakeServer.PrivatePath.length);
        const held = this.holding.get(`${request.method} ${name}`);
        if (held !== undefined) {
            this.holding.delete(`${request.method} ${name}`);
            held.reach();
            await held.gate;
        }
        if (request.method === 'GET' && name === '') {
            return FakeServer.reply(200, JSON.stringify([...this.files.keys()].sort()));
        }
        if (request.method === 'GET') {
            return this.files.has(name) ? FakeServer.reply(200, this.files.get(name)) : FakeServer.reply(404, 'Not found');
        }
        if (request.method === 'POST') {
            if (this.refusing.has(name)) {
                return FakeServer.reply(500, 'Server error');
            }
            this.files.set(name, request.body);
            return FakeServer.reply(200, JSON.stringify({ saved: name, bytes: request.body.length }));
        }
        return FakeServer.reply(405, 'Method not allowed');
    }
}
