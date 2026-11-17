export default class PanelKeeper {
    /**
     * @param {object} view
     */
    constructor(view) {
        this.current = view;
        this.calls = [];
        this.held = null;
        this.failure = null;
    }

    /**
     * @return {object}
     */
    view() {
        return this.current;
    }

    /**
     * @return {{ open: () => void, fail: (error: Error) => void }}
     */
    hold() {
        let open = null;
        let fail = null;
        const promise = new Promise((resolve, reject) => {
            open = resolve;
            fail = reject;
        });
        this.held = promise;
        return { open, fail };
    }

    /**
     * @param {string} name
     * @return {Array<Array<*>>}
     */
    called(name) {
        return this.calls.filter((call) => call.name === name).map((call) => call.args);
    }

    /**
     * @param {string} name
     * @param {Array<*>} args
     * @return {Promise<void>}
     */
    answer(name, args) {
        this.calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
        if (this.failure !== null) {
            const error = this.failure;
            this.failure = null;
            return Promise.reject(error);
        }
        if (this.held !== null) {
            const held = this.held;
            this.held = null;
            return held;
        }
        return Promise.resolve();
    }

    /**
     * @param {object} settings
     * @return {Promise<void>}
     */
    adopt(settings) {
        return this.answer('adopt', [settings]);
    }

    /**
     * @return {Promise<void>}
     */
    resume() {
        return this.answer('resume', []);
    }

    /**
     * @return {void}
     */
    pause() {
        this.calls.push({ name: 'pause', args: [] });
    }

    /**
     * @return {Promise<void>}
     */
    pull() {
        return this.answer('pull', []);
    }

    /**
     * @param {object} operation
     * @return {Promise<void>}
     */
    rule(operation) {
        return this.answer('rule', [operation]);
    }

    /**
     * @return {Promise<void>}
     */
    keepFirst() {
        return this.answer('keepFirst', []);
    }

    /**
     * @param {number} sequence
     * @return {Promise<void>}
     */
    revoke(sequence) {
        return this.answer('revoke', [sequence]);
    }

    /**
     * @param {object} settings
     * @return {Promise<void>}
     */
    configure(settings) {
        return this.answer('configure', [settings]);
    }
}
