export default class ScriptedD1 {
    calls = [];
    #outcomes;

    /**
     * @param {...(object[] | Error | {success: boolean, results: object[]})} outcomes
     */
    constructor(...outcomes) {
        this.#outcomes = outcomes;
    }

    /**
     * @param {string} sql
     * @return {{ bind(...values: (string | number)[]): { all(): Promise<object> } }}
     */
    prepare(sql) {
        return {
            bind: (...values) => ({
                all: async () => {
                    this.calls.push({ sql, values });
                    if (this.#outcomes.length === 0) {
                        throw new Error('Unexpected database call');
                    }
                    const outcome = this.#outcomes.shift();
                    if (outcome instanceof Error) {
                        throw outcome;
                    }
                    return Array.isArray(outcome) ? { success: true, results: outcome } : outcome;
                },
            }),
        };
    }
}
