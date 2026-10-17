import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../resources/js/header.js', import.meta.url), 'utf8');

/**
 * @param {number} count
 * @return {object}
 */
function mountHeader(count = 2) {
    const listeners = new Map();
    const focusCalls = [];
    const document = {
        activeElement: null,
        addEventListener: (name, callback) => listeners.set(name, callback),
        querySelectorAll: (selector) => {
            assert.equal(selector, '.app-bar [data-header-disclosure]');
            return disclosures;
        },
    };
    const disclosures = Array.from({ length: count }, () => {
        const events = new Map();
        const summary = { focus(options) { focusCalls.push(options.preventScroll); document.activeElement = summary; } };
        const child = {};
        const disclosure = {
            open: false,
            summary,
            child,
            events,
            contains: (target) => target === summary || target === child || target === disclosure,
            querySelector: (selector) => { assert.equal(selector, 'summary'); return summary; },
            addEventListener: (name, callback) => events.set(name, callback),
        };
        return disclosure;
    });
    runInNewContext(source, { document });
    return {
        document, disclosures, focusCalls,
        open(index) { disclosures[index].open = true; disclosures[index].events.get('toggle')(); },
        event(type, target, key) {
            const event = { target, key, prevented: false, preventDefault() { this.prevented = true; } };
            listeners.get(type)?.(event);
            return event;
        },
    };
}

test('opening either native disclosure closes the other', () => {
    const page = mountHeader();
    page.open(0);
    page.open(1);
    assert.equal(page.disclosures[0].open, false);
    assert.equal(page.disclosures[1].open, true);
    page.open(0);
    assert.equal(page.disclosures[1].open, false);
});

test('Escape from a radio or menu item closes only its menu and restores summary focus', () => {
    for (const index of [0, 1]) {
        const page = mountHeader();
        page.open(index);
        const event = page.event('keydown', page.disclosures[index].child, 'Escape');
        assert.equal(event.prevented, true);
        assert.equal(page.disclosures[index].open, false);
        assert.equal(page.document.activeElement, page.disclosures[index].summary);
        assert.deepEqual(page.focusCalls, [true]);
    }
});

test('outside click and keyboard departure preserve outside focus and draft', () => {
    const page = mountHeader();
    const draft = { value: 'unsaved' };
    for (const type of ['click', 'focusin']) {
        page.open(0);
        page.document.activeElement = draft;
        assert.equal(page.event(type, draft).prevented, false);
        assert.equal(page.disclosures[0].open, false);
        assert.equal(page.document.activeElement, draft);
        assert.equal(draft.value, 'unsaved');
    }
    assert.deepEqual(page.focusCalls, []);
});

test('inside links, forms, radio changes and native arrow keys keep default behavior', () => {
    const page = mountHeader();
    page.open(1);
    for (const type of ['click', 'change', 'submit', 'focusin']) {
        assert.equal(page.event(type, page.disclosures[1].child).prevented, false);
        assert.equal(page.disclosures[1].open, true);
    }
    assert.equal(page.event('keydown', page.disclosures[1].child, 'ArrowDown').prevented, false);
    assert.equal(page.disclosures[1].open, true);
    const outside = {};
    assert.equal(page.event('keydown', outside, 'Escape').prevented, false);
    assert.equal(page.disclosures[1].open, true);
});

test('breakpoint changes retain disclosure identity, open state and focused child', () => {
    const page = mountHeader();
    page.open(1);
    const appearance = page.disclosures[1];
    page.document.activeElement = appearance.child;
    page.event('resize', appearance.child);
    assert.equal(page.disclosures[1], appearance);
    assert.equal(appearance.open, true);
    assert.equal(page.document.activeElement, appearance.child);
    assert.deepEqual(page.focusCalls, []);
});

test('a page without disclosures is inert', () => {
    const page = mountHeader(0);
    assert.equal(page.event('click', {}).prevented, false);
    assert.equal(page.event('keydown', {}, 'Escape').prevented, false);
    assert.deepEqual(page.focusCalls, []);
});
