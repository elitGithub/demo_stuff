export default class WholeTimers {
    /**
     * @param {import('./FakeTimers.mjs').default} clock
     */
    constructor(clock) {
        this.clock = clock;
        this.owned = new Set();
        this.dead = false;
    }

    /**
     * @param {Function} callback
     * @param {number} delay
     * @return {number}
     */
    setTimeout(callback, delay) {
        const owned = this.owned;
        const id = this.clock.setTimeout(() => {
            owned.delete(id);
            if (!this.dead) {
                callback();
            }
        }, delay);
        owned.add(id);
        return id;
    }

    /**
     * @param {Function} callback
     * @param {number} delay
     * @return {number}
     */
    setInterval(callback, delay) {
        const id = this.clock.setInterval(() => {
            if (!this.dead) {
                callback();
            }
        }, delay);
        this.owned.add(id);
        return id;
    }

    /**
     * @param {number} id
     * @return {void}
     */
    clearTimeout(id) {
        this.owned.delete(id);
        this.clock.clearTimeout(id);
    }

    /**
     * @param {number} id
     * @return {void}
     */
    clearInterval(id) {
        this.owned.delete(id);
        this.clock.clearInterval(id);
    }

    /**
     * @return {number}
     */
    get count() {
        return this.owned.size;
    }

    /**
     * @return {void}
     */
    stop() {
        this.dead = true;
        for (const id of this.owned) {
            this.clock.clearTimeout(id);
        }
        this.owned.clear();
    }
}
