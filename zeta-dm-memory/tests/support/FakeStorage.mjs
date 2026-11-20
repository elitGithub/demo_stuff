export default class FakeStorage {
    constructor() {
        this.values = new Map();
        this.calls = [];
        this.refusals = [];
        this.interruptions = [];
        this.interrupting = false;
        this.listeners = new Map();
        this.queued = null;
        this.allow();
    }

    /**
     * @param {number} count
     * @return {FakeStorage}
     */
    refuseSetNumber(count) {
        this.setsBeforeRefusal = count;
        return this;
    }

    /**
     * @param {string} name
     * @param {Function} changed
     * @return {Function}
     */
    watch(name, changed) {
        const remove = () => this.listeners.delete(remove);
        this.listeners.set(remove, { name, changed });
        return remove;
    }

    /**
     * @param {string} name
     * @return {void}
     */
    notify(name) {
        for (const entry of this.listeners.values()) {
            if (entry.name === name) {
                if (this.queued) {
                    this.queued.push(entry.changed);
                } else {
                    entry.changed();
                }
            }
        }
    }

    /**
     * @param {RegExp} pattern
     * @return {FakeStorage}
     */
    refuseSetsMatching(pattern) {
        this.refusedSets = pattern;
        return this;
    }

    /**
     * @param {RegExp} pattern
     * @return {FakeStorage}
     */
    dropSetsMatching(pattern) {
        this.droppedSets = pattern;
        return this;
    }

    /**
     * @param {RegExp} pattern
     * @return {FakeStorage}
     */
    alterSetsMatching(pattern) {
        this.alteredSets = pattern;
        return this;
    }

    /**
     * @param {RegExp} pattern
     * @return {FakeStorage}
     */
    throwAfterSetsMatching(pattern) {
        this.failingAfterSets = pattern;
        return this;
    }

    /**
     * @param {RegExp} pattern
     * @param {number} count
     * @return {FakeStorage}
     */
    lagGetsMatching(pattern, count) {
        this.lagging = { pattern, count };
        return this;
    }

    /**
     * @param {RegExp} pattern
     * @return {FakeStorage}
     */
    refuseRemovesMatching(pattern) {
        this.refusedRemoves = pattern;
        return this;
    }

    /**
     * @param {number} count
     * @return {FakeStorage}
     */
    refuseGetNumber(count) {
        this.getsBeforeRefusal = count;
        return this;
    }

    /**
     * @param {RegExp} pattern
     * @return {FakeStorage}
     */
    refuseGetsMatching(pattern) {
        this.refusedGets = pattern;
        return this;
    }

    /**
     * @return {FakeStorage}
     */
    refuseListing() {
        this.listingRefused = true;
        return this;
    }

    /**
     * @param {number} limit
     * @return {FakeStorage}
     */
    limitCharacters(limit) {
        this.limit = limit;
        return this;
    }

    /**
     * @return {FakeStorage}
     */
    allow() {
        this.setsBeforeRefusal = null;
        this.refusedSets = null;
        this.droppedSets = null;
        this.alteredSets = null;
        this.failingAfterSets = null;
        this.lagging = null;
        this.stale = new Map();
        this.refusedRemoves = null;
        this.getsBeforeRefusal = null;
        this.refusedGets = null;
        this.listingRefused = false;
        this.limit = null;
        return this;
    }

    /**
     * @param {string} operation
     * @param {number} count
     * @param {Function} action
     * @return {FakeStorage}
     */
    interrupt(operation, count, action) {
        this.interruptions.push({ operation, remaining: count, action });
        return this;
    }

    /**
     * @return {number}
     */
    get characters() {
        let total = 0;
        for (const value of this.values.values()) {
            total += String(value).length;
        }
        return total;
    }

    /**
     * @return {Error|null}
     */
    get lastRefusal() {
        return this.refusals.length === 0 ? null : this.refusals[this.refusals.length - 1];
    }

    /**
     * @param {string} operation
     * @return {number}
     */
    count(operation) {
        return this.calls.filter((call) => call.operation === operation).length;
    }

    /**
     * @param {string} operation
     * @return {void}
     */
    reach(operation) {
        if (this.interrupting) {
            return;
        }
        for (const interruption of [...this.interruptions]) {
            if (interruption.operation !== operation) {
                continue;
            }
            interruption.remaining--;
            if (interruption.remaining > 0) {
                continue;
            }
            this.interruptions.splice(this.interruptions.indexOf(interruption), 1);
            this.interrupting = true;
            try {
                interruption.action();
            } finally {
                this.interrupting = false;
            }
        }
    }

    /**
     * @param {string} operation
     * @param {string} name
     * @return {never}
     * @throws {Error}
     */
    refuse(operation, name) {
        const error = new Error(`The storage refused to ${operation} ${name}`);
        this.refusals.push(error);
        throw error;
    }

    /**
     * @param {string} name
     * @param {*} fallback
     * @return {*}
     * @throws {Error}
     */
    get(name, fallback) {
        this.reach('get');
        this.calls.push({ operation: 'get', name });
        if (this.getsBeforeRefusal !== null) {
            this.getsBeforeRefusal--;
            if (this.getsBeforeRefusal === 0) {
                this.getsBeforeRefusal = null;
                this.refuse('get', name);
            }
        }
        if (this.refusedGets !== null && this.refusedGets.test(name)) {
            this.refuse('get', name);
        }
        if (this.stale.has(name)) {
            const earlier = this.stale.get(name);
            earlier.remaining--;
            if (earlier.remaining <= 0) {
                this.stale.delete(name);
            }
            return earlier.present ? earlier.value : fallback;
        }
        return this.values.has(name) ? this.values.get(name) : fallback;
    }

    /**
     * @param {string} name
     * @param {*} value
     * @return {void}
     * @throws {Error}
     */
    set(name, value) {
        this.reach('set');
        this.calls.push({ operation: 'set', name });
        if (this.setsBeforeRefusal !== null) {
            this.setsBeforeRefusal--;
            if (this.setsBeforeRefusal === 0) {
                this.setsBeforeRefusal = null;
                this.refuse('set', name);
            }
        }
        if (this.refusedSets !== null && this.refusedSets.test(name)) {
            this.refuse('set', name);
        }
        if (this.limit !== null) {
            const replaced = this.values.has(name) ? String(this.values.get(name)).length : 0;
            if (this.characters - replaced + String(value).length > this.limit) {
                this.refuse('set', name);
            }
        }
        if (this.droppedSets !== null && this.droppedSets.test(name)) {
            return;
        }
        if (this.lagging !== null && this.lagging.pattern.test(name)) {
            this.stale.set(name, { present: this.values.has(name), value: this.values.get(name), remaining: this.lagging.count });
        }
        let stored = value;
        if (this.alteredSets !== null && this.alteredSets.test(name) && typeof value === 'string' && value.length > 0) {
            stored = `${String.fromCharCode(value.charCodeAt(0) ^ 1)}${value.slice(1)}`;
        }
        this.values.set(name, stored);
        if (this.failingAfterSets !== null && this.failingAfterSets.test(name)) {
            this.refuse('set', name);
        }
        this.notify(name);
    }

    /**
     * @param {string} name
     * @return {void}
     * @throws {Error}
     */
    remove(name) {
        this.reach('remove');
        this.calls.push({ operation: 'remove', name });
        if (this.refusedRemoves !== null && this.refusedRemoves.test(name)) {
            this.refuse('remove', name);
        }
        this.values.delete(name);
        this.notify(name);
    }

    /**
     * @return {string[]}
     * @throws {Error}
     */
    list() {
        this.reach('list');
        this.calls.push({ operation: 'list', name: null });
        if (this.listingRefused) {
            this.refuse('list', 'every name');
        }
        return [...this.values.keys()];
    }
}
