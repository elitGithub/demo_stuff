import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export default class SqliteD1 {
    #db = new DatabaseSync(':memory:');
    #beforeExecute;
    #afterExecute;

    /**
     * @param {import('node:test').TestContext} testContext
     * @param {{ installSchema?: boolean, beforeExecute?: Function, afterExecute?: Function }} [options]
     */
    constructor(testContext, { installSchema = true, beforeExecute, afterExecute } = {}) {
        testContext.after(() => this.#db.close());
        this.#beforeExecute = beforeExecute;
        this.#afterExecute = afterExecute;
        if (installSchema) {
            this.applySchema();
        }
    }

    /**
     * @return {void}
     */
    applySchema() {
        this.#db.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
    }

    /**
     * @param {string} sql
     * @return {{ bind(...values: (string | number | null)[]): { all(): Promise<{ success: boolean, results: object[] }> } }}
     */
    prepare(sql) {
        return {
            bind: (...values) => ({
                all: async () => {
                    await this.#beforeExecute?.(sql, values);
                    const results = this.#db.prepare(sql).all(...values);
                    await this.#afterExecute?.(sql, values);
                    return { success: true, results };
                },
            }),
        };
    }
}
