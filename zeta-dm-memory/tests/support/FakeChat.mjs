import CampaignBuilder from './CampaignBuilder.mjs';

export default class FakeChat {
    static PageSize = 31;

    static Player = 'Orla';

    static MostRequests = 5000;

    /**
     * @param {number} count
     */
    constructor(count) {
        this.builder = new CampaignBuilder(FakeChat.Player);
        this.serial = 0;
        this.requests = [];
        this.failures = { history: [], newest: [] };
        this.broken = { history: null, newest: null };
        this.gates = { history: null, newest: null };
        this.cuts = [];
        this.cutEvery = null;
        this.others = [];
        this.hidden = null;
        this.doubled = null;
        this.numeric = false;
        this.skipped = 0;
        this.add(count);
    }

    /**
     * @param {string} end
     * @param {number} count
     * @param {string|null} problem
     * @return {FakeChat}
     */
    cutShort(end, count, problem = null) {
        this.cuts.push({ end, count, problem });
        return this;
    }

    /**
     * @param {string} end
     * @param {number} count
     * @param {string|null} problem
     * @return {FakeChat}
     */
    cutAlways(end, count, problem = null) {
        this.cutEvery = { end, count, problem };
        return this;
    }

    /**
     * @param {number} count
     * @return {FakeChat}
     */
    strangers(count) {
        const other = new CampaignBuilder(FakeChat.Player);
        for (let number = 1; number <= count; number++) {
            other.narrator(`Another tale goes on, line ${number}.`);
            other.timed(FakeChat.time(number));
            other.messages[other.messages.length - 1].id = `OTHER-${number}`;
        }
        this.others.push(other.messages);
        return this;
    }

    /**
     * @param {number} number
     * @return {FakeChat}
     */
    hide(number) {
        this.hidden = FakeChat.id(number);
        return this;
    }

    /**
     * @param {number} number
     * @return {FakeChat}
     */
    twice(number) {
        this.doubled = FakeChat.id(number);
        return this;
    }

    /**
     * @param {number} count
     * @return {FakeChat}
     */
    skip(count) {
        this.skipped = count;
        return this;
    }

    /**
     * @return {object[]}
     */
    get raw() {
        return this.builder.messages;
    }

    /**
     * @param {number} number
     * @return {string}
     */
    static id(number) {
        return `MESSAGE-${number}`;
    }

    /**
     * @param {number} number
     * @return {string}
     */
    static time(number) {
        return new Date(Date.UTC(2026, 10, 3, 11, 0, number)).toISOString();
    }

    /**
     * @param {number} count
     * @return {FakeChat}
     */
    add(count) {
        for (let index = 0; index < count; index++) {
            this.serial++;
            const number = this.serial;
            const duties = ` Halvard keeps watch from line ${number}. Mirelle counts coins to line ${number}.`;
            if (number % 2 === 0) {
                this.builder.player(`I answer the ferryman, line ${number}.` + duties);
            } else {
                const age = { 3: ' Halvard is twenty-five.', 5: ' Halvard is thirty.' };
                this.builder.narrator(`The tale goes on, line ${number}.` + duties + (age[number] ?? ''));
            }
            this.builder.timed(FakeChat.time(number));
            this.raw[this.raw.length - 1].id = FakeChat.id(number);
        }
        return this;
    }

    /**
     * @param {number} number
     * @return {object}
     */
    find(number) {
        const found = this.raw.find((message) => message.id === FakeChat.id(number));
        if (found === undefined) {
            throw new Error(`No message numbered ${number}`);
        }
        return found;
    }

    /**
     * @param {number} number
     * @param {string} text
     * @return {FakeChat}
     */
    edit(number, text) {
        const message = this.find(number);
        message.contents[0].text = text;
        return this;
    }

    /**
     * @param {number} number
     * @return {FakeChat}
     */
    remove(number) {
        this.raw.splice(this.raw.indexOf(this.find(number)), 1);
        return this;
    }

    /**
     * @param {string} prefix
     * @return {FakeChat}
     */
    renameAll(prefix) {
        for (const message of this.raw) {
            message.id = message.id.replace(/^[A-Z]+-/, `${prefix}-`);
        }
        return this;
    }

    /**
     * @param {number} number
     * @param {string} time
     * @return {FakeChat}
     */
    retime(number, time) {
        this.find(number).messageTime = time;
        return this;
    }

    /**
     * @param {string} kind
     * @param {Error} error
     * @param {number} times
     * @return {FakeChat}
     */
    fail(kind, error, times = 1) {
        for (let index = 0; index < times; index++) {
            this.failures[kind].push(error);
        }
        return this;
    }

    /**
     * @param {string} kind
     * @param {Error|null} error
     * @return {FakeChat}
     */
    failAlways(kind, error) {
        this.broken[kind] = error;
        return this;
    }

    /**
     * @param {string} kind
     * @return {Function}
     */
    hold(kind) {
        let release = null;
        const promise = new Promise((resolve) => {
            release = resolve;
        });
        this.gates[kind] = promise;
        /**
         * @return {void}
         */
        return () => {
            this.gates[kind] = null;
            release();
        };
    }

    /**
     * @param {string} label
     * @param {string} kind
     * @return {number}
     */
    count(label, kind) {
        return this.requests.filter((request) => request.label === label && request.kind === kind).length;
    }

    /**
     * @param {string} label
     * @param {string} kind
     * @return {Promise<void>}
     * @throws {Error}
     */
    async answer(label, kind) {
        this.requests.push({ label, kind });
        if (this.requests.length > FakeChat.MostRequests) {
            await new Promise(() => {});
        }
        if (this.gates[kind] !== null) {
            await this.gates[kind];
        }
        if (this.failures[kind].length > 0) {
            throw this.failures[kind].shift();
        }
        if (this.broken[kind] !== null) {
            throw this.broken[kind];
        }
    }

    /**
     * @param {object[]} chosen
     * @return {object[]}
     */
    copy(chosen) {
        const copy = JSON.parse(JSON.stringify(chosen));
        if (this.doubled !== null) {
            const twin = copy.find((message) => message.id === this.doubled);
            if (twin !== undefined) {
                copy.splice(copy.indexOf(twin), 0, JSON.parse(JSON.stringify(twin)));
            }
            this.doubled = null;
        }
        if (!this.numeric) {
            return copy;
        }
        return copy.map((message) => ({ ...message, id: Number(message.id.replace(/^[A-Z]+-/, '')) }));
    }

    /**
     * @param {string} label
     * @return {{ history: (onPage: Function) => Promise<object>, newest: () => Promise<object> }}
     */
    zeta(label) {
        return {
            /**
             * @param {(count: number) => void} onPage
             * @return {Promise<{ messages: object[], end: string, problem: string|null, skipped: number }>}
             */
            history: async (onPage) => {
                await this.answer(label, 'history');
                let chosen = this.raw;
                let end = this.raw.length === 0 ? 'EmptyPage' : 'NoCursor';
                let problem = null;
                const replacement = this.others.length > 0;
                if (replacement) {
                    chosen = this.others.shift();
                } else {
                    const cut = this.cuts.length > 0 ? this.cuts.shift() : this.cutEvery;
                    if (cut !== null) {
                        chosen = this.raw.slice(-cut.count);
                        end = cut.end;
                        problem = cut.problem;
                    }
                }
                let skipped = this.skipped;
                this.skipped = 0;
                if (this.hidden !== null) {
                    chosen = chosen.filter((message) => message.id !== this.hidden);
                    skipped++;
                    this.hidden = null;
                }
                const copy = this.copy(chosen);
                for (let count = FakeChat.PageSize; count < copy.length; count += FakeChat.PageSize) {
                    onPage(count);
                }
                onPage(copy.length);
                return { messages: copy, end, problem, skipped, completeHistory: (chosen === this.raw || replacement) && !skipped,
                    emptyRoom: chosen === this.raw && this.raw.length === 0 };
            },
            /**
             * @return {Promise<{ messages: object[], end: string, problem: null, skipped: number }>}
             */
            newest: async (through = null) => {
                await this.answer(label, 'newest');
                const index = through === null ? this.raw.length - 1 : Math.max(0, this.raw.findIndex((message) => message.id === through));
                const pages = Math.max(1, Math.ceil((this.raw.length - index) / FakeChat.PageSize));
                let chosen = this.raw.slice(-pages * FakeChat.PageSize);
                let skipped = 0;
                if (this.hidden !== null) {
                    chosen = chosen.filter((message) => message.id !== this.hidden);
                    skipped = 1;
                    this.hidden = null;
                }
                const copy = this.copy(chosen);
                return { messages: copy, end: copy.length === 0 ? 'EmptyPage' : 'NoCursor', problem: null, skipped,
                    completeHistory: through !== null && copy.length === this.raw.length && !skipped,
                    emptyRoom: this.raw.length === 0 };
            },
        };
    }
}
