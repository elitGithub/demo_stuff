export default class PanelLive {
    /**
     * @param {object} view
     */
    constructor(view) {
        this.current = view;
        this.calls = [];
        this.failure = null;
        this.refusal = null;
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
     * @return {void}
     */
    note(name, args) {
        this.calls.push({ name, args: [...args] });
    }

    /**
     * @param {string} name
     * @param {Array<*>} args
     * @return {Promise<void>}
     */
    answer(name, args) {
        this.note(name, args);
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
     * @param {string} key
     * @return {void}
     */
    dismiss(key) {
        this.note('dismiss', [key]);
    }

    /**
     * @param {string} key
     * @return {Promise<void>}
     */
    told(key) {
        return this.answer('told', [key]);
    }

    /**
     * @return {void}
     */
    clear() {
        this.note('clear', []);
    }

    /**
     * @param {string} text
     * @param {boolean|null} shown
     * @return {void}
     * @throws {Error}
     */
    edit(text, shown = null) {
        this.note('edit', [text, shown]);
        if (this.refusal !== null) {
            throw this.refusal;
        }
    }

    /**
     * @return {Promise<void>}
     */
    force() {
        return this.answer('force', []);
    }

    /**
     * @return {Promise<void>}
     */
    suggest() {
        return this.answer('suggest', []);
    }

    /**
     * @return {Promise<void>}
     */
    another() {
        return this.answer('another', []);
    }

    /**
     * @return {void}
     */
    ignore() {
        this.note('ignore', []);
    }

    /**
     * @param {string} text
     * @return {void}
     */
    use(text) {
        this.note('use', [text]);
    }

    /**
     * @param {string} words
     * @return {Promise<void>}
     */
    tell(words) {
        return this.answer('tell', [words]);
    }

    /**
     * @return {Promise<void>}
     */
    confirm() {
        return this.answer('confirm', []);
    }

    /**
     * @return {void}
     */
    forget() {
        this.note('forget', []);
    }
}
