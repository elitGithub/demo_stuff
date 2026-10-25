import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../public/assets/js/app.js', import.meta.url), 'utf8');

function scenario({ method = 'get', query = '?service=3&date=2026-10-23', confirmation = true, destructive = false } = {}) {
    const handlers = new Map();
    const attributes = new Map();
    const button = { disabled: false };
    const status = { hidden: true, setAttribute() {} };
    const result = { focused: false, scrolled: false, focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; } };
    const form = {
        method,
        action: 'https://demo.example/bookings/create#times',
        dataset: destructive ? { confirm: 'Remove this time off?' } : {},
        entries: [['service', '3'], ['date', '2026-10-23']],
        closest() { return this; },
        getAttribute(name) { return attributes.get(name); },
        setAttribute(name, value) { attributes.set(name, value); },
        querySelectorAll(selector) { return selector === 'button[type="submit"]' ? [button] : [status]; },
    };
    const location = { href: `https://demo.example/bookings/create${query}`, origin: 'https://demo.example', pathname: '/bookings/create', search: query, hash: '' };
    let prompts = 0;
    runInNewContext(source, {
        URL,
        URLSearchParams,
        FormData: class { constructor(input) { return input.entries; } },
        document: { addEventListener(name, handler) { handlers.set(name, handler); }, querySelector() { return null; }, getElementById() { return result; } },
        window: { location, addEventListener() {}, confirm() { prompts++; return confirmation; } },
    });
    const submit = () => {
        const event = { target: form, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        handlers.get('submit')(event);
        return event;
    };

    return { submit, button, status, result, location, attributes, prompts: () => prompts };
}

test('same-query GET completes at its result without leaving a busy form', () => {
    const browser = scenario();
    assert.equal(browser.submit().defaultPrevented, true);
    assert.equal(browser.location.hash, '#times');
    assert.equal(browser.result.focused, true);
    assert.equal(browser.result.scrolled, true);
    assert.equal(browser.button.disabled, false);
    assert.equal(browser.status.hidden, true);
    assert.equal(browser.attributes.has('aria-busy'), false);
});

test('changed-date GET shows immediate loading and rejects duplicate submission', () => {
    const browser = scenario({ query: '?service=3&date=2026-10-22' });
    assert.equal(browser.submit().defaultPrevented, false);
    assert.equal(browser.button.disabled, true);
    assert.equal(browser.status.hidden, false);
    assert.equal(browser.submit().defaultPrevented, true);
});

test('cancelling destructive confirmation prevents submission before loading', () => {
    const browser = scenario({ method: 'post', destructive: true, confirmation: false });
    assert.equal(browser.submit().defaultPrevented, true);
    assert.equal(browser.prompts(), 1);
    assert.equal(browser.button.disabled, false);
    assert.equal(browser.status.hidden, true);
});

test('confirmed mutation loads once and a duplicate does not prompt again', () => {
    const browser = scenario({ method: 'post', destructive: true });
    assert.equal(browser.submit().defaultPrevented, false);
    assert.equal(browser.button.disabled, true);
    assert.equal(browser.submit().defaultPrevented, true);
    assert.equal(browser.prompts(), 1);
});
