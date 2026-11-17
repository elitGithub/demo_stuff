export default class WholePanel {
    static HostId = 'scribe-host';

    static MostElements = 20000;

    static MostDepth = 60;

    static MostCreated = 400000;

    /**
     * @param {import('./WholeDocument.mjs').default} document
     */
    constructor(document) {
        this.document = document;
    }

    /**
     * @return {object|null}
     */
    host() {
        const hosts = this.document.body.children.filter((child) => child.id === WholePanel.HostId);
        return hosts.length === 1 ? hosts[0] : null;
    }

    /**
     * @return {number}
     */
    hosts() {
        return this.document.body.children.filter((child) => child.id === WholePanel.HostId).length;
    }

    /**
     * @return {object}
     * @throws {Error}
     */
    root() {
        const host = this.host();
        if (host === null || host.shadow === null) {
            throw new Error('There is no panel on the page');
        }
        return host.shadow;
    }

    /**
     * @param {object} start
     * @return {object[]}
     * @throws {Error}
     */
    walk(start) {
        const found = [];
        const waiting = start.children.map((child) => ({ node: child, depth: 1 }));
        while (waiting.length > 0) {
            if (found.length >= WholePanel.MostElements) {
                throw new Error('The panel holds more elements than a walk may visit');
            }
            const { node, depth } = waiting.shift();
            if (depth > WholePanel.MostDepth) {
                throw new Error('The panel is deeper than a walk may go');
            }
            found.push(node);
            for (const child of node.children) {
                waiting.push({ node: child, depth: depth + 1 });
            }
        }
        return found;
    }

    /**
     * @param {string} id
     * @return {object}
     * @throws {Error}
     */
    byId(id) {
        const found = this.walk(this.root()).filter((element) => element.id === id);
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
     * @param {string} id
     * @return {void}
     */
    click(id) {
        this.byId(id).click();
    }

    /**
     * @param {string} name
     * @return {void}
     */
    tab(name) {
        this.click(`scribe-tab-${name.toLowerCase()}`);
    }

    /**
     * @param {string} id
     * @param {string} value
     * @return {void}
     */
    type(id, value) {
        this.byId(id).value = value;
    }

    /**
     * @param {string} list
     * @return {object[]}
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
     * @param {object} element
     * @return {object[]}
     */
    buttonsIn(element) {
        return this.walk(element).filter((child) => child.tagName === 'BUTTON');
    }

    /**
     * @param {object} element
     * @return {string[]}
     */
    buttonTexts(element) {
        return this.buttonsIn(element).map((button) => button.textContent);
    }

    /**
     * @param {object} element
     * @param {string} text
     * @return {object}
     * @throws {Error}
     */
    button(element, text) {
        const found = this.buttonsIn(element).filter((button) => button.textContent === text);
        if (found.length !== 1) {
            throw new Error(`Expected one button reading ${text}, found ${found.length}`);
        }
        return found[0];
    }

    /**
     * @param {object} element
     * @param {string} start
     * @return {object}
     * @throws {Error}
     */
    buttonStarting(element, start) {
        const found = this.buttonsIn(element).filter((button) => button.textContent.startsWith(start));
        if (found.length !== 1) {
            throw new Error(`Expected one button starting ${start}, found ${found.length}`);
        }
        return found[0];
    }

    /**
     * @return {string}
     */
    headline() {
        return this.text('scribe-headline');
    }

    /**
     * @return {string[]}
     */
    headlines() {
        return this.byId('scribe-headline')
            .written.filter((entry) => entry.kind === 'text' && entry.text !== '')
            .map((entry) => entry.text);
    }

    /**
     * @return {string}
     */
    spend() {
        return this.text('scribe-spend');
    }

    /**
     * @return {string[]}
     */
    shownTexts() {
        const shown = [];
        for (const element of this.walk(this.root())) {
            shown.push(element.ownText);
            if (typeof element.current === 'string') {
                shown.push(element.current);
            }
            for (const value of element.attributes.values()) {
                shown.push(value);
            }
        }
        return shown;
    }

    /**
     * @return {string[]}
     * @throws {Error}
     */
    everWritten() {
        const elements = this.document.elements;
        if (elements.length > WholePanel.MostCreated) {
            throw new Error('The page created more elements than a check may visit');
        }
        const written = [];
        for (const element of elements) {
            written.push(element.ownText);
            for (const entry of element.written) {
                if (entry.kind !== 'value') {
                    written.push(entry.text);
                }
            }
        }
        return written;
    }
}
