import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const blade = readFileSync(new URL('../../resources/views/components/theme-script.blade.php', import.meta.url), 'utf8');
const source = blade.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source);

/**
 * @param {object} options
 * @return {object}
 */
function mountTheme(options = {}) {
    const listeners = new Map();
    const mediaListeners = new Map();
    const documentListeners = new Map();
    const writes = [];
    const requests = [];
    const focusCalls = [];
    const stored = { value: options.saved ?? null };
    const storage = {
        getItem(key) {
            assert.equal(key, 'casefile.theme');
            if (options.readError) { throw options.readError; }
            return stored.value;
        },
        setItem(key, value) {
            if (options.writeError) { throw options.writeError; }
            writes.push([key, value]);
            stored.value = value;
        },
    };
    const window = {
        get localStorage() {
            if (options.getterError) { throw options.getterError; }
            return storage;
        },
        matchMedia: () => media,
        addEventListener: (name, callback) => listeners.set(name, callback),
        location: { href: '/case/1' },
        scrollX: 19,
        scrollY: 31,
        fetch: (...arguments_) => requests.push(arguments_),
    };
    const media = {
        matches: options.dark ?? false,
        addEventListener: (name, callback) => mediaListeners.set(name, callback),
    };
    const choices = ['system', 'light', 'dark'].map((value) => {
        const choiceListeners = new Map();
        return {
            value,
            checked: value === 'system',
            listeners: choiceListeners,
            addEventListener: (name, callback) => choiceListeners.set(name, callback),
            closest(selector) { assert.equal(selector, '[data-header-disclosure]'); return disclosure; },
            focus: () => focusCalls.push(value),
        };
    });
    const notice = { textContent: '' };
    const trigger = {
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        focus(options) {
            focusCalls.push({ target: 'trigger', preventScroll: options.preventScroll });
            document.activeElement = this;
        },
    };
    const tooltip = { textContent: '' };
    const disclosure = { open: false };
    const control = {
        hidden: true,
        querySelector: (selector) => ({
            '[data-theme-notice]': notice,
            '[data-theme-trigger]': trigger,
            '[data-theme-tooltip]': tooltip,
        })[selector] ?? null,
        querySelectorAll(selector) { assert.equal(selector, '[data-theme-option]'); return choices; },
        removeAttribute(name) {
            assert.equal(name, 'hidden');
            assert.ok(choices.every((choice) => choice.listeners.has('change')));
            this.hidden = false;
        },
    };
    const draft = { value: 'unsaved reply' };
    const document = {
        documentElement: { dataset: {} },
        activeElement: draft,
        addEventListener: (name, callback) => documentListeners.set(name, callback),
        querySelector: (selector) => selector === '[data-theme-control]' ? control : null,
    };
    runInNewContext(source, { window, document, DOMException });

    return {
        window, document, media, storage, stored, writes, requests, focusCalls, draft, control, choices, notice, trigger, tooltip, disclosure,
        ready: () => documentListeners.get('DOMContentLoaded')(),
        checkedPreference() {
            const checked = choices.filter((choice) => choice.checked);
            assert.equal(checked.length, 1);
            const label = 'Appearance: ' + checked[0].value.charAt(0).toUpperCase() + checked[0].value.slice(1);
            assert.equal(trigger.attributes['aria-label'], label);
            assert.equal(trigger.attributes.title, label);
            assert.equal(tooltip.textContent, label);
            return checked[0].value;
        },
        choose(value) {
            const chosen = choices.find((choice) => choice.value === value);
            assert.ok(chosen);
            choices.forEach((choice) => { choice.checked = choice === chosen; });
            chosen.listeners.get('change')();
        },
        click(value, detail, pointerType = '') {
            const chosen = choices.find((choice) => choice.value === value);
            assert.ok(chosen);
            const changed = !chosen.checked;
            choices.forEach((choice) => { choice.checked = choice === chosen; });
            document.activeElement = chosen;
            const event = {
                detail,
                pointerType,
                defaultPrevented: false,
                preventDefault() { this.defaultPrevented = true; },
            };
            chosen.listeners.get('click')(event);
            if (changed && !event.defaultPrevented) {
                chosen.listeners.get('change')();
            }
            return event;
        },
        changeUnchecked(value) {
            const choice = choices.find((candidate) => candidate.value === value);
            assert.ok(choice);
            assert.equal(choice.checked, false);
            choice.listeners.get('change')();
        },
        device(value) { media.matches = value; mediaListeners.get('change')(); },
        remote(key, value, area = storage) { listeners.get('storage')({ key, newValue: value, storageArea: area }); },
        restore() { listeners.get('pageshow')({ persisted: true }); },
    };
}

test('first paint uses device and saved overrides before control readiness', () => {
    for (const dark of [false, true]) {
        for (const saved of [null, 'invalid', 'system', 'light', 'dark']) {
            const page = mountTheme({ dark, saved });
            const expected = saved === 'light' || saved === 'dark' ? saved : dark ? 'dark' : 'light';
            assert.equal(page.document.documentElement.dataset.theme, expected);
            assert.equal(page.control.hidden, true);
            page.ready();
            assert.equal(page.control.hidden, false);
            assert.equal(page.checkedPreference(), saved === 'light' || saved === 'dark' ? saved : 'system');
        }
    }
});

test('manual preference persists across pages and device changes follow only System', () => {
    const page = mountTheme({ dark: true });
    page.ready();
    page.choose('light');
    assert.equal(page.checkedPreference(), 'light');
    assert.equal(page.document.documentElement.dataset.theme, 'light');
    page.device(false);
    page.device(true);
    assert.equal(page.checkedPreference(), 'light');
    assert.equal(page.document.documentElement.dataset.theme, 'light');
    page.choose('dark');
    assert.equal(page.checkedPreference(), 'dark');
    assert.equal(page.document.documentElement.dataset.theme, 'dark');
    page.choose('system');
    assert.equal(page.checkedPreference(), 'system');
    assert.equal(page.document.documentElement.dataset.theme, 'dark');
    page.device(false);
    assert.equal(page.checkedPreference(), 'system');
    assert.equal(page.document.documentElement.dataset.theme, 'light');
    assert.deepEqual(page.writes, [['casefile.theme', 'light'], ['casefile.theme', 'dark'], ['casefile.theme', 'system']]);
    const nextPage = mountTheme({ saved: page.stored.value, dark: true });
    assert.equal(nextPage.document.documentElement.dataset.theme, 'dark');
    nextPage.ready();
    assert.equal(nextPage.checkedPreference(), 'system');
    assert.equal(page.draft.value, 'unsaved reply');
    assert.equal(page.document.activeElement, page.draft);
    assert.deepEqual(page.requests, []);
    assert.deepEqual(page.focusCalls, []);
    assert.equal(page.window.location.href, '/case/1');
    assert.equal(page.window.scrollY, 31);
});

test('storage events synchronize without feedback writes and pageshow reads new persistence', () => {
    const page = mountTheme();
    page.ready();
    page.remote('other.key', 'dark');
    page.remote('casefile.theme', 'dark', {});
    assert.equal(page.checkedPreference(), 'system');
    for (const [value, expected] of [['dark', 'dark'], ['light', 'light'], ['system', 'light'], ['invalid', 'light'], [null, 'light']]) {
        page.remote(value === null ? null : 'casefile.theme', value);
        assert.equal(page.document.documentElement.dataset.theme, expected);
        assert.equal(page.checkedPreference(), value === 'dark' || value === 'light' ? value : 'system');
    }
    page.stored.value = 'dark';
    page.restore();
    assert.equal(page.checkedPreference(), 'dark');
    assert.equal(page.document.documentElement.dataset.theme, 'dark');
    assert.deepEqual(page.writes, []);
    assert.equal(page.draft.value, 'unsaved reply');
    assert.equal(page.document.activeElement, page.draft);
    assert.deepEqual(page.focusCalls, []);
    assert.deepEqual(page.requests, []);
    assert.equal(page.window.location.href, '/case/1');
    assert.equal(page.window.scrollY, 31);
});

test('expected storage failures leave page usable and successful retry clears notice', () => {
    for (const property of ['getterError', 'readError', 'writeError']) {
        const error = new DOMException('denied', property === 'writeError' ? 'QuotaExceededError' : 'SecurityError');
        const options = { [property]: error, dark: true };
        const page = mountTheme(options);
        page.ready();
        if (property !== 'writeError') {
            assert.equal(page.notice.textContent, 'This choice applies to this page only.');
        }
        page.choose('light');
        assert.equal(page.disclosure.open, false);
        assert.equal(page.checkedPreference(), 'light');
        assert.equal(page.document.documentElement.dataset.theme, 'light');
        assert.equal(page.notice.textContent, property === 'readError' ? '' : 'This choice applies to this page only.');
        page.restore();
        assert.equal(page.checkedPreference(), 'light');
        delete options[property];
        page.choose('dark');
        assert.equal(page.checkedPreference(), 'dark');
        assert.equal(page.notice.textContent, '');
        assert.equal(page.stored.value, 'dark');
    }
});

test('unchecked radio changes do not change appearance or persist', () => {
    const page = mountTheme({ dark: true });
    page.ready();
    page.changeUnchecked('light');
    assert.equal(page.checkedPreference(), 'system');
    assert.equal(page.document.documentElement.dataset.theme, 'dark');
    assert.deepEqual(page.writes, []);
});

test('mouse, touch and pen radio clicks dismiss Appearance while preserving native selection', () => {
    for (const pointerType of ['mouse', 'touch', 'pen']) {
        const page = mountTheme();
        page.ready();
        page.disclosure.open = true;
        const event = page.click('dark', 1, pointerType);
        assert.equal(event.defaultPrevented, false);
        assert.equal(page.disclosure.open, false);
        assert.equal(page.checkedPreference(), 'dark');
        assert.equal(page.document.documentElement.dataset.theme, 'dark');
        assert.deepEqual(page.writes, [['casefile.theme', 'dark']]);
        assert.equal(page.document.activeElement, page.trigger);
        assert.deepEqual(page.focusCalls, [{ target: 'trigger', preventScroll: true }]);
        assert.equal(page.window.scrollY, 31);
    }
});

test('clicking the selected radio dismisses without requiring a change event', () => {
    const page = mountTheme({ saved: 'dark' });
    page.ready();
    page.disclosure.open = true;
    const event = page.click('dark', 1, 'mouse');
    assert.equal(event.defaultPrevented, false);
    assert.equal(page.disclosure.open, false);
    assert.equal(page.checkedPreference(), 'dark');
    assert.deepEqual(page.writes, []);
    assert.equal(page.document.activeElement, page.trigger);
    assert.deepEqual(page.focusCalls, [{ target: 'trigger', preventScroll: true }]);
});

test('keyboard zero-detail clicks and consecutive arrow changes retain the open picker and focus', () => {
    const page = mountTheme();
    page.ready();
    page.disclosure.open = true;
    const event = page.click('light', 0);
    assert.equal(event.defaultPrevented, false);
    assert.equal(page.document.activeElement, page.choices[1]);
    assert.equal(page.disclosure.open, true);
    for (const value of ['dark', 'system', 'light']) {
        page.document.activeElement = page.choices.find((choice) => choice.value === value);
        page.choose(value);
        assert.equal(page.disclosure.open, true);
        assert.equal(page.document.activeElement.value, value);
        assert.equal(page.checkedPreference(), value);
    }
    assert.deepEqual(page.focusCalls, []);
    assert.deepEqual(page.writes, [
        ['casefile.theme', 'light'], ['casefile.theme', 'dark'],
        ['casefile.theme', 'system'], ['casefile.theme', 'light'],
    ]);
});

test('pointer dismissal retains failed-storage warning and leaves no stale keyboard dismissal', () => {
    const page = mountTheme({ writeError: new DOMException('denied', 'QuotaExceededError') });
    page.ready();
    page.disclosure.open = true;
    page.click('dark', 1, 'touch');
    assert.equal(page.disclosure.open, false);
    assert.equal(page.checkedPreference(), 'dark');
    assert.equal(page.notice.textContent, 'This choice applies to this page only.');
    page.disclosure.open = true;
    page.document.activeElement = page.choices[1];
    page.choose('light');
    assert.equal(page.disclosure.open, true);
    assert.equal(page.document.activeElement, page.choices[1]);
    assert.equal(page.checkedPreference(), 'light');
    assert.equal(page.notice.textContent, 'This choice applies to this page only.');
    assert.deepEqual(page.focusCalls, [{ target: 'trigger', preventScroll: true }]);
});

test('storage, OS and pageshow synchronization leave the disclosure and focus alone', () => {
    const page = mountTheme();
    page.ready();
    page.disclosure.open = true;
    page.document.activeElement = page.choices[0];
    page.remote('casefile.theme', 'dark');
    assert.equal(page.checkedPreference(), 'dark');
    page.remote('casefile.theme', 'system');
    page.device(true);
    assert.equal(page.document.documentElement.dataset.theme, 'dark');
    page.stored.value = 'light';
    page.restore();
    assert.equal(page.checkedPreference(), 'light');
    assert.equal(page.disclosure.open, true);
    assert.equal(page.document.activeElement, page.choices[0]);
    assert.deepEqual(page.focusCalls, []);
    assert.deepEqual(page.writes, []);
});

test('unrelated storage errors surface', () => {
    assert.throws(() => mountTheme({ readError: new TypeError('broken') }), TypeError);
    const options = { writeError: new TypeError('broken') };
    const page = mountTheme(options);
    page.ready();
    assert.throws(() => page.choose('dark'), TypeError);
});
