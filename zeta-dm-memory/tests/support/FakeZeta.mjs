export default class FakeZeta {
    static Origin = 'https://api.zeta-ai.io';

    static PageAddress = 'https://zeta-ai.io/rooms/abc';

    static Room = 'abc';

    static Token = 'Bearer zeta-test-7f3a9c';

    static MostRequests = 20;

    static Plot = 'plot-1';

    static Profile = 'Orla is a sellsword from the northern marches.';

    static Persona = 'Orla';

    /**
     * @param {object[]} messages
     * @param {string} room
     * @param {string} token
     */
    constructor(messages, room = FakeZeta.Room, token = FakeZeta.Token) {
        this.messages = messages;
        this.room = room;
        this.token = token;
        this.plot = FakeZeta.Plot;
        this.characters = [];
        this.profile = FakeZeta.Profile;
        this.persona = FakeZeta.Persona;
        this.repeat = null;
        this.endless = false;
        this.perPage = null;
        this.most = FakeZeta.MostRequests;
        this.requests = [];
        this.events = [];
        this.cursors = new Map();
        const server = this;
        /**
         * @param {string} url
         * @param {{ headers?: Object<string, string> }} options
         * @return {Promise<{ status: number, ok: boolean, text: () => Promise<string> }>}
         */
        this.fetch = function (url, options) {
            return server.respond(this, url, options);
        };
    }

    /**
     * @param {number} status
     * @param {string} text
     * @return {{ status: number, ok: boolean, text: () => Promise<string> }}
     */
    static reply(status, text) {
        return {
            status,
            ok: status >= 200 && status < 300,
            /**
             * @return {Promise<string>}
             */
            text: async () => text,
        };
    }

    /**
     * @param {object[]} messages
     * @param {*} nextCursor
     * @return {{ status: number, ok: boolean, text: () => Promise<string> }}
     */
    static page(messages, nextCursor) {
        return FakeZeta.reply(200, JSON.stringify({ messages, nextCursor, prevCursor: null }));
    }

    /**
     * @param {number} minute
     * @return {string}
     */
    static time(minute) {
        return new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
    }

    /**
     * @param {string} id
     * @param {string} messageTime
     * @param {string} text
     * @return {object}
     */
    static message(id, messageTime, text = 'A line of the tale.') {
        return {
            id,
            sender: { type: 'BOT' },
            contents: [{ speakerName: 'Narrator', position: 0, text }],
            messageTime,
            edited: false,
        };
    }

    /**
     * @param {number} count
     * @return {object[]}
     */
    static messages(count) {
        const made = [];
        for (let number = 1; number <= count; number++) {
            made.push(FakeZeta.message(`m${String(number).padStart(3, '0')}`, FakeZeta.time(number), `Line ${number} of the tale.`));
        }
        return made;
    }

    /**
     * @param {number} offset
     * @return {string}
     */
    static cursorAt(offset) {
        return `older+${offset}/=`;
    }

    /**
     * @param {Array<object|Error>} answers
     * @return {{ fetch: Function, requests: Array<{ receiver: *, url: string, options: object }> }}
     */
    static scripted(answers) {
        const requests = [];
        const queue = [...answers];
        /**
         * @param {string} url
         * @param {object} options
         * @return {Promise<object>}
         */
        const fetch = function (url, options) {
            requests.push({ receiver: this, url: String(url), options });
            if (queue.length === 0) {
                return Promise.resolve(FakeZeta.reply(429, 'No more answers are scripted.'));
            }
            const next = queue.shift();
            return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
        };
        return { fetch, requests };
    }

    /**
     * @return {object}
     */
    roomBody() {
        return {
            id: this.room,
            createdAt: '2026-01-01T00:00:00.000Z',
            lastMessage: this.messages.length ? { id: this.messages.at(-1).id } : null,
            isActive: true,
            title: 'The harbour tale',
            unreadCount: 0,
            plot: {
                id: this.plot,
                name: 'Harbour Lights',
                shortDescription: 'A short tale of a harbour.',
                longDescription: 'A longer tale of a harbour and its lamps.',
                characters: this.characters.map((character, index) => ({
                    id: `character-${index + 1}`,
                    plotId: this.plot,
                    imageUrl: null,
                    isProfileImageDeletedByAbusing: false,
                    ...character,
                })),
                intros: [],
                lorebooks: [],
            },
            savedAt: null,
            penalty: null,
        };
    }

    /**
     * @param {*} receiver
     * @param {string} url
     * @param {{ headers?: Object<string, string> }} options
     * @return {Promise<{ status: number, ok: boolean, text: () => Promise<string> }>}
     */
    async respond(receiver, url, options) {
        this.requests.push({ receiver, url: String(url), options });
        this.events.push('fetch');
        if (this.requests.length > this.most) {
            return FakeZeta.reply(429, 'Too many requests.');
        }
        const address = new URL(url);
        const room = `/v1/rooms/${encodeURIComponent(this.room)}`;
        const story = {
            [room]: () => (this.plot === null ? null : this.roomBody()),
        };
        if (this.plot !== null) {
            const plot = `/v1/plots/${encodeURIComponent(this.plot)}`;
            story[`${plot}/rooms/${encodeURIComponent(this.room)}/user-personas/selected`] = () =>
                this.profile === null ? null : { name: this.persona, profileImageUrl: null, description: this.profile };
        }
        const known = address.pathname === `${room}/messages` || Object.hasOwn(story, address.pathname);
        if (address.origin !== FakeZeta.Origin || !known) {
            return FakeZeta.reply(404, 'No such room.');
        }
        if (options?.headers?.Authorization !== this.token) {
            return FakeZeta.reply(401, 'Login required.');
        }
        if (Object.hasOwn(story, address.pathname)) {
            const body = story[address.pathname]();
            return body === null ? FakeZeta.reply(404, 'Nothing here.') : FakeZeta.reply(200, JSON.stringify(body));
        }
        const limit = this.perPage === null ? Number(address.searchParams.get('limit')) : this.perPage;
        const cursor = address.searchParams.get('cursor');
        const total = this.messages.length;
        let start = 0;
        if (this.repeat !== null) {
            start = (this.requests.length - 1) * limit;
        } else if (cursor !== null) {
            if (!this.cursors.has(cursor)) {
                return FakeZeta.reply(400, 'Unknown cursor.');
            }
            start = this.cursors.get(cursor);
        }
        let next = null;
        if (this.repeat !== null) {
            next = this.repeat;
        } else if (this.endless || start + limit < total) {
            next = FakeZeta.cursorAt(start + limit);
            this.cursors.set(next, start + limit);
        }
        const served = [];
        for (let offset = start; offset < Math.min(start + limit, total); offset++) {
            served.push(this.messages[total - 1 - offset]);
        }
        return FakeZeta.page(served, next);
    }

    /**
     * @param {string} href
     * @return {{ location: { href: string }, answer: Function, fetchCalls: object[], requests: object[], fetch: Function, XMLHttpRequest: Function }}
     */
    static window(href = FakeZeta.PageAddress) {
        const page = {
            location: { href },
            /**
             * @return {Promise<object>}
             */
            answer: () => Promise.resolve(FakeZeta.reply(200, '{}')),
            fetchCalls: [],
            requests: [],
        };
        /**
         * @param {...*} values
         * @return {*}
         */
        page.fetch = function (...values) {
            const call = { receiver: this, values, result: undefined };
            page.fetchCalls.push(call);
            call.result = page.answer(...values);
            return call.result;
        };
        page.XMLHttpRequest = class {
            constructor() {
                this.calls = [];
                this.listeners = [];
                this.refusal = null;
                page.requests.push(this);
            }

            /**
             * @param {string} name
             * @param {Array<*>} values
             * @return {{ from: string }}
             */
            record(name, values) {
                const result = { from: name };
                this.calls.push({ name, receiver: this, values, result });
                return result;
            }

            /**
             * @param {...*} values
             * @return {{ from: string }}
             */
            open(...values) {
                return this.record('open', values);
            }

            /**
             * @param {...*} values
             * @return {{ from: string }}
             */
            setRequestHeader(...values) {
                return this.record('setRequestHeader', values);
            }

            /**
             * @param {...*} values
             * @return {{ from: string }}
             */
            send(...values) {
                const result = this.record('send', values);
                if (this.refusal !== null) {
                    throw this.refusal;
                }
                return result;
            }

            /**
             * @param {string} type
             * @param {Function} listener
             * @param {{ once?: boolean }} options
             * @return {void}
             */
            addEventListener(type, listener, options) {
                this.listeners.push({ type, listener, once: options?.once === true });
            }

            /**
             * @param {string} type
             * @param {Function} listener
             * @return {void}
             */
            removeEventListener(type, listener) {
                this.listeners = this.listeners.filter((entry) => entry.type !== type || entry.listener !== listener);
            }

            /**
             * @return {void}
             */
            finish() {
                const due = this.listeners.filter((entry) => entry.type === 'loadend');
                this.listeners = this.listeners.filter((entry) => entry.type !== 'loadend' || !entry.once);
                for (const entry of due) {
                    entry.listener.call(this, { type: 'loadend' });
                }
            }
        };
        return page;
    }
}
