export default class FakeEvent {
    /**
     * @param {string} type
     * @param {{ bubbles?: boolean, cancelable?: boolean, inputType?: string, data?: string, key?: string, code?: string, keyCode?: number, which?: number, shiftKey?: boolean, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean, isComposing?: boolean, path?: object[]|null }} init
     */
    constructor(type, init = {}) {
        this.type = type;
        this.bubbles = init.bubbles === true;
        this.cancelable = init.cancelable === true;
        this.inputType = init.inputType ?? null;
        this.data = init.data ?? null;
        this.key = init.key ?? '';
        this.code = init.code ?? '';
        this.keyCode = init.keyCode ?? 0;
        this.which = init.which ?? 0;
        this.shiftKey = init.shiftKey === true;
        this.ctrlKey = init.ctrlKey === true;
        this.altKey = init.altKey === true;
        this.metaKey = init.metaKey === true;
        this.isComposing = init.isComposing === true;
        this.target = null;
        this.path = init.path ?? null;
        this.defaultPrevented = false;
        this.stopped = false;
        this.immediateStopped = false;
    }

    /**
     * @return {object[]}
     */
    composedPath() {
        return this.path === null ? [] : [...this.path];
    }

    /**
     * @return {void}
     */
    preventDefault() {
        this.defaultPrevented = true;
    }

    /**
     * @return {void}
     */
    stopPropagation() {
        this.stopped = true;
    }

    /**
     * @return {void}
     */
    stopImmediatePropagation() {
        this.stopped = true;
        this.immediateStopped = true;
    }
}
