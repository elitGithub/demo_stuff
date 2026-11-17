export default class FakeLocks {
    constructor() {
        this.holders = new Map();
        this.queues = new Map();
        this.made = [];
    }

    /**
     * @param {string} name
     * @return {number}
     */
    waiting(name) {
        return this.queues.has(name) ? this.queues.get(name).length : 0;
    }

    /**
     * @param {string} name
     * @return {boolean}
     */
    held(name) {
        return this.holders.has(name);
    }

    /**
     * @return {Promise<{ held: Array<{ name: string, mode: string, clientId: string }>, pending: Array<{ name: string, mode: string, clientId: string }> }>}
     */
    query() {
        const held = [...this.holders.values()].map((entry) => ({ name: entry.name, mode: 'exclusive', clientId: 'a client' }));
        const pending = [];
        for (const queue of this.queues.values()) {
            for (const entry of queue) {
                pending.push({ name: entry.name, mode: 'exclusive', clientId: 'a client' });
            }
        }
        return Promise.resolve({ held, pending });
    }

    /**
     * @param {string} name
     * @param {...*} rest
     * @return {Promise<*>}
     */
    request(name, ...rest) {
        const callback = rest.at(-1);
        const options = rest.length > 1 ? rest[0] : {};
        const entry = { name, ifAvailable: options.ifAvailable === true, signal: options.signal ?? null, callback, resolve: null, reject: null };
        this.made.push(`${name} ${entry.ifAvailable ? 'if available' : 'waiting'}`);
        return new Promise((resolve, reject) => {
            entry.resolve = resolve;
            entry.reject = reject;
            if (entry.signal !== null && entry.signal.aborted) {
                reject(FakeLocks.aborted());
                return;
            }
            if (!this.holders.has(name)) {
                this.grant(entry);
                return;
            }
            if (entry.ifAvailable) {
                Promise.resolve()
                    .then(() => callback(null))
                    .then(resolve, reject);
                return;
            }
            if (!this.queues.has(name)) {
                this.queues.set(name, []);
            }
            this.queues.get(name).push(entry);
            if (entry.signal !== null) {
                entry.signal.addEventListener(
                    'abort',
                    () => {
                        const queue = this.queues.get(name);
                        const index = queue.indexOf(entry);
                        if (index !== -1) {
                            queue.splice(index, 1);
                            reject(FakeLocks.aborted());
                        }
                    },
                    { once: true },
                );
            }
        });
    }

    /**
     * @return {Error}
     */
    static aborted() {
        const error = new Error('The request was aborted');
        error.name = 'AbortError';
        return error;
    }

    /**
     * @param {object} entry
     * @return {void}
     */
    grant(entry) {
        this.holders.set(entry.name, entry);
        Promise.resolve()
            .then(() => entry.callback({ name: entry.name, mode: 'exclusive' }))
            .then(
                (value) => {
                    this.free(entry);
                    entry.resolve(value);
                },
                (error) => {
                    this.free(entry);
                    entry.reject(error);
                },
            );
    }

    /**
     * @param {object} entry
     * @return {void}
     */
    free(entry) {
        if (this.holders.get(entry.name) !== entry) {
            return;
        }
        this.holders.delete(entry.name);
        const queue = this.queues.get(entry.name);
        if (queue !== undefined && queue.length > 0) {
            this.grant(queue.shift());
        }
    }
}
