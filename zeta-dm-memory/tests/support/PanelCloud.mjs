export default class PanelCloud {
    static Local = Object.freeze({ phase: 'Off', keyed: false, conflict: null, notes: null, unsent: 0, problem: null });

    /**
     * @param {object} view
     */
    constructor(view) {
        this.current = view;
        this.calls = [];
        this.failure = null;
        this.held = null;
    }

    /**
     * @return {object}
     */
    view() {
        return this.current;
    }

    /**
     * @param {string} name
     * @return {Array<Array<*>>}
     */
    called(name) {
        return this.calls.filter((call) => call.name === name).map((call) => call.args);
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
     * @param {Array<*>} args
     * @return {Promise<void>}
     */
    answer(name, args) {
        this.calls.push({ name, args: [...args] });
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
     * @return {Promise<void>}
     */
    keep() {
        return this.answer('keep', []);
    }

    /**
     * @return {Promise<void>}
     */
    useCloud() {
        return this.answer('useCloud', []);
    }
}
