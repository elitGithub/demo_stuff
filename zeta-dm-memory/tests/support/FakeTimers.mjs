export default class FakeTimers {
    static MostFirings = 2000;

    /**
     * @param {number} time
     */
    constructor(time) {
        this.time = time;
        this.timers = new Map();
        this.nextTimer = 1;
    }

    /**
     * @return {number}
     */
    now() {
        return this.time;
    }

    /**
     * @param {Function} callback
     * @param {number} delay
     * @param {number|null} every
     * @return {number}
     */
    schedule(callback, delay, every) {
        const id = this.nextTimer;
        this.nextTimer++;
        this.timers.set(id, { callback, at: this.time + Math.max(0, Number(delay) || 0), every });
        return id;
    }

    /**
     * @param {Function} callback
     * @param {number} delay
     * @return {number}
     */
    setTimeout(callback, delay) {
        return this.schedule(callback, delay, null);
    }

    /**
     * @param {Function} callback
     * @param {number} delay
     * @return {number}
     */
    setInterval(callback, delay) {
        return this.schedule(callback, delay, Math.max(1, Number(delay) || 0));
    }

    /**
     * @param {number} id
     * @return {void}
     */
    clearTimeout(id) {
        this.timers.delete(id);
    }

    /**
     * @param {number} id
     * @return {void}
     */
    clearInterval(id) {
        this.timers.delete(id);
    }

    /**
     * @return {number}
     */
    get count() {
        return this.timers.size;
    }

    /**
     * @return {number}
     */
    get intervals() {
        return [...this.timers.values()].filter((timer) => timer.every !== null).length;
    }

    /**
     * @return {number[]}
     */
    get delays() {
        return [...this.timers.values()].map((timer) => timer.at - this.time);
    }

    /**
     * @return {number|null}
     */
    get next() {
        let earliest = null;
        for (const timer of this.timers.values()) {
            if (earliest === null || timer.at < earliest) {
                earliest = timer.at;
            }
        }
        return earliest;
    }

    /**
     * @param {number} milliseconds
     * @return {void}
     * @throws {Error}
     */
    advance(milliseconds) {
        const target = this.time + milliseconds;
        for (let fired = 0; ; fired++) {
            let due = null;
            for (const [id, timer] of this.timers) {
                if (timer.at <= target && (due === null || timer.at < due.timer.at)) {
                    due = { id, timer };
                }
            }
            if (due === null) {
                break;
            }
            if (fired >= FakeTimers.MostFirings) {
                throw new Error('Too many timers fired in one advance');
            }
            this.time = due.timer.at;
            if (due.timer.every === null) {
                this.timers.delete(due.id);
            } else {
                due.timer.at += due.timer.every;
            }
            due.timer.callback();
        }
        this.time = target;
    }
}
