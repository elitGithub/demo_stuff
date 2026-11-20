import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import FakeClock from './FakeClock.mjs';
import FakeStorage from './FakeStorage.mjs';
import PanelCloud from './PanelCloud.mjs';
import PanelDocument from './PanelDocument.mjs';
import PanelKeeper from './PanelKeeper.mjs';
import PanelLive from './PanelLive.mjs';

export default class PanelHarness {
    static Engine = Object.freeze([
        'core/ScribeText',
        'core/ScribeCategory',
        'core/ScribeIntake',
        'core/ScribeAnswer',
        'core/ScribeLog',
        'core/ScribeReplay',
        'core/ScribeKnowledge',
        'core/ScribeAnalyzer',
        'core/ScribeGateway',
        'core/ScribeAdoption',
        'page/ZetaSource',
        'bench/BenchView',
        'page/ScribeStore',
        'page/ScribeCloud',
    ]);

    static StandIns = Object.freeze({
        ScribeKeeper: Object.freeze({
            Phase: Object.freeze({
                Loading: 'Loading',
                NoBook: 'NoBook',
                Reading: 'Reading',
                Idle: 'Idle',
                Stopped: 'Stopped',
                Watching: 'Watching',
            }),
            Event: Object.freeze({ Changed: 'Changed', Progress: 'Progress', Reply: 'Reply' }),
        }),
        ScribePedant: Object.freeze({
            Kind: Object.freeze({ Spelling: 'Spelling', Contradiction: 'Contradiction', Leak: 'Leak' }),
        }),
        ScribeLive: Object.freeze({
            Status: Object.freeze({
                Open: 'Open',
                Dismissed: 'Dismissed',
                Accepted: 'Accepted',
                Told: 'Told',
                Reminded: 'Reminded',
            }),
        }),
    });

    static Panel = Object.freeze(['page/PanelStyle', 'page/PanelView', 'page/ScribePanel']);

    static StartTime = Date.UTC(2026, 10, 15, 9, 0, 0);

    static Wide = 1280;

    static Turns = 20;

    static used = [];

    /**
     * @param {object} context
     * @param {string} path
     * @return {void}
     */
    static run(context, path) {
        const url = new URL(`../../scribe/${path}.js`, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
    }

    /**
     * @return {Object<string, object>}
     */
    static load() {
        const context = vm.createContext({ TextEncoder });
        const loaded = {};
        for (const path of PanelHarness.Engine) {
            PanelHarness.run(context, path);
            const name = path.split('/').at(-1);
            loaded[name] = vm.runInContext(name, context);
        }
        PanelHarness.used = [];
        for (const [name, standIn] of Object.entries(PanelHarness.StandIns)) {
            const path = `page/${name}`;
            let source = 'stand-in';
            if (existsSync(new URL(`../../scribe/${path}.js`, import.meta.url))) {
                try {
                    PanelHarness.run(context, path);
                    source = 'real';
                } catch (error) {
                    source = `stand-in (the real file did not load: ${error.message})`;
                }
            }
            if (source !== 'real') {
                context[name] = standIn;
            }
            PanelHarness.used.push(`${name}: ${source}`);
            loaded[name] = vm.runInContext(name, context);
        }
        for (const path of PanelHarness.Panel) {
            PanelHarness.run(context, path);
            const name = path.split('/').at(-1);
            loaded[name] = vm.runInContext(name, context);
        }
        return loaded;
    }

    /**
     * @param {Object<string, object>} scripts
     * @param {{ keeper: object, live: object, cloud?: object, width?: number, storage?: FakeStorage }} options
     */
    constructor(scripts, options) {
        this.scripts = scripts;
        this.document = new PanelDocument(options.width ?? PanelHarness.Wide);
        this.storage = options.storage ?? new FakeStorage();
        this.keeper = new PanelKeeper(options.keeper);
        this.live = new PanelLive(options.live);
        this.cloud = new PanelCloud(options.cloud ?? PanelCloud.Local);
        this.clock = new FakeClock(PanelHarness.StartTime);
        this.document.defaultView.setInterval = (callback, delay) => this.clock.setInterval(callback, delay);
        this.document.defaultView.clearInterval = (id) => this.clock.clearInterval(id);
        this.confirming = true;
        this.questions = [];
        this.downloads = [];
        this.handle = null;
        this.callDue = false;
        this.forceStops = 0;
    }

    /**
     * @return {PanelHarness}
     */
    mount() {
        this.handle = this.scripts.ScribePanel.mount({
            document: this.document,
            keeper: this.keeper,
            live: this.live,
            cloud: this.cloud,
            calls: Object.freeze({
                /**
                 * @return {boolean}
                 */
                due: () => this.callDue,

                /**
                 * @return {void}
                 */
                stop: () => {
                    this.forceStops++;
                },
            }),
            storage: this.storage,
            keyVersion: () => 0,
            keyProblem: () => false,
            keyRecoveryProblem: () => false,
            saveKey: (value) => {
                if (value.trim()) {
                    this.scripts.ScribeStore.setKey(this.storage, value);
                    this.keeper.rekey();
                    this.live.rekey();
                }
                return true;
            },
            /**
             * @param {string} text
             * @return {boolean}
             */
            confirm: (text) => {
                this.questions.push(text);
                return this.confirming;
            },
            /**
             * @param {string} name
             * @param {string} text
             * @return {void}
             */
            download: (name, text) => {
                this.downloads.push({ name, text });
            },
            clock: this.clock,
        });
        return this;
    }

    /**
     * @return {void}
     */
    redraw() {
        this.handle.redraw();
    }

    /**
     * @return {import('./PanelElement.mjs').default[]}
     */
    hosts() {
        return this.document.body.children.filter((child) => child.shadow !== null);
    }

    /**
     * @return {import('./PanelShadowRoot.mjs').default}
     * @throws {Error}
     */
    get root() {
        const hosts = this.hosts();
        if (hosts.length !== 1) {
            throw new Error(`Expected one panel host, found ${hosts.length}`);
        }
        return hosts[0].shadow;
    }

    /**
     * @return {import('./PanelElement.mjs').default[]}
     */
    all() {
        return this.root.descendants();
    }

    /**
     * @param {string} id
     * @return {import('./PanelElement.mjs').default}
     * @throws {Error}
     */
    byId(id) {
        const found = this.all().filter((element) => element.id === id);
        if (found.length !== 1) {
            throw new Error(`Expected one element with the id ${id}, found ${found.length}`);
        }
        return found[0];
    }

    /**
     * @param {string} id
     * @return {string}
     */
    text(id) {
        return this.byId(id).textContent;
    }

    /**
     * @param {string} list
     * @return {import('./PanelElement.mjs').default[]}
     */
    rows(list) {
        return this.byId(`scribe-list-${list}`).children.filter((child) => child.classes.has('row'));
    }

    /**
     * @param {string} list
     * @return {string[]}
     */
    rowTexts(list) {
        return this.rows(list).map((row) => row.textContent);
    }

    /**
     * @param {string} list
     * @param {string} text
     * @return {import('./PanelElement.mjs').default}
     * @throws {Error}
     */
    rowSaying(list, text) {
        const found = this.rows(list).filter((row) => row.textContent.includes(text));
        if (found.length !== 1) {
            throw new Error(`Expected one row of ${list} saying ${text}, found ${found.length}`);
        }
        return found[0];
    }

    /**
     * @param {import('./PanelElement.mjs').default} root
     * @param {string} text
     * @return {import('./PanelElement.mjs').default}
     * @throws {Error}
     */
    button(root, text) {
        const found = root.descendants().filter((element) => element.tagName === 'BUTTON' && element.textContent === text);
        if (found.length !== 1) {
            throw new Error(`Expected one button reading ${text}, found ${found.length}`);
        }
        return found[0];
    }

    /**
     * @param {string} id
     * @return {string[]}
     */
    buttonTexts(id) {
        return this.byId(id)
            .descendants()
            .filter((element) => element.tagName === 'BUTTON')
            .map((element) => element.textContent);
    }

    /**
     * @param {string} id
     * @param {boolean} disabled
     * @return {string[]}
     */
    buttonsWhere(id, disabled) {
        return this.byId(id)
            .descendants()
            .filter((element) => element.tagName === 'BUTTON' && element.disabled === disabled)
            .map((element) => element.textContent);
    }

    /**
     * @param {import('./PanelElement.mjs').default} root
     * @param {string} type
     * @return {import('./PanelElement.mjs').default[]}
     */
    inputs(root, type) {
        return root.descendants().filter((element) => element.tagName === 'INPUT' && element.type === type);
    }

    /**
     * @param {string} name
     * @return {import('./PanelElement.mjs').default}
     */
    section(name) {
        return this.byId(`scribe-section-${name.toLowerCase()}`);
    }

    /**
     * @param {string} name
     * @return {string[]}
     */
    actionTexts(name) {
        return this.section(name)
            .descendants()
            .filter((element) => element.tagName === 'BUTTON' && !/-(previous|next)$/.test(element.id))
            .map((element) => element.textContent);
    }

    /**
     * @param {string} name
     * @param {boolean} disabled
     * @return {string[]}
     */
    actionsWhere(name, disabled) {
        return this.section(name)
            .descendants()
            .filter((element) => element.tagName === 'BUTTON' && !/-(previous|next)$/.test(element.id))
            .filter((element) => element.disabled === disabled)
            .map((element) => element.textContent);
    }

    /**
     * @param {string} id
     * @return {void}
     */
    click(id) {
        this.byId(id).click();
    }

    /**
     * @param {string} name
     * @return {Promise<void>}
     */
    async tab(name) {
        this.click(`scribe-tab-${name.toLowerCase()}`);
        await this.flush();
    }

    /**
     * @return {string}
     */
    focused() {
        const active = this.root.activeElement;
        if (active === null) {
            return 'outside';
        }
        const typed = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA';
        return `${active.tagName}|${active.id}|${typed ? active.value : active.textContent}`;
    }

    /**
     * @return {Promise<void>}
     */
    async flush() {
        for (let turn = 0; turn < PanelHarness.Turns; turn++) {
            await new Promise((resolve) => setImmediate(resolve));
        }
    }
}
