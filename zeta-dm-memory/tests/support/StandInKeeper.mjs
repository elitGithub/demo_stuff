export default class StandInKeeper {
    /**
     * @param {{ reader: boolean, trusted: boolean, edition: number, phase: string, stop: object|null, read: number, state: object, player: string, messages: readonly object[], settings: { refresh: number }, unread: readonly object[], lastRead: { id: string, position: number }|null }} current
     */
    constructor(current) {
        this.current = current;
        this.ruled = [];
        this.filed = [];
        this.previews = [];
        this.refuseRule = false;
        this.refuseFile = false;
        this.refusePreview = false;
        this.pinned = false;
        this.gate = null;
        this.filing = null;
        this.previewer = (operations, anchor) => ({
            before: this.current.state,
            state: this.current.state,
            refused: [],
        });
    }

    /**
     * @return {object}
     */
    view() {
        return this.current;
    }

    /**
     * @param {object} fields
     * @return {void}
     */
    change(fields) {
        this.current = { ...this.current, ...fields };
    }

    /**
     * @param {object} operation
     * @return {Promise<void>}
     * @throws {Error}
     */
    async rule(operation) {
        this.ruled.push(operation);
        if (this.refuseRule) {
            throw new Error('The ruling was refused');
        }
    }

    /**
     * @param {readonly object[]} operations
     * @param {{ id: string, position: number }|null} anchor
     * @return {Promise<object[]>}
     * @throws {Error}
     */
    async file(operations, anchor) {
        this.filed.push({ operations, anchor });
        if (this.filing !== null) {
            const filing = this.filing;
            this.filing = null;
            await filing;
        }
        if (this.refuseFile) {
            throw new Error('The filing was refused');
        }
        return [];
    }

    /**
     * @param {readonly object[]} operations
     * @param {{ id: string, position: number }|null} anchor
     * @return {Promise<{ before: object, state: object, refused: readonly object[] }>}
     * @throws {Error}
     */
    async preview(operations, anchor) {
        this.previews.push({ operations, anchor });
        if (this.gate !== null) {
            const gate = this.gate;
            this.gate = null;
            await gate;
        }
        if (this.refusePreview) {
            throw new Error('The preview was refused');
        }
        return this.previewer(operations, anchor);
    }
}
