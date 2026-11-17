import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export default class ScribeCore {
    /**
     * @param {string[]} names
     * @return {Object<string, object>}
     */
    static load(names) {
        const context = vm.createContext({ TextEncoder });
        const loaded = {};
        for (const name of names) {
            const url = new URL(`../../scribe/core/${name}.js`, import.meta.url);
            vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
            loaded[name] = vm.runInContext(name, context);
        }
        return loaded;
    }
}
