import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../../resources/css/app.css', import.meta.url), 'utf8');
const root = css.match(/:root\s*\{([\s\S]*?)\n    \}/)?.[1];
const explicit = css.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n    \}/)?.[1];
const fallback = css.match(/:root:not\(\[data-theme\]\)\s*\{([\s\S]*?)\n        \}/)?.[1];
assert.ok(root && explicit && fallback);

/**
 * @param {string} block
 * @return {Map<string, string>}
 */
function declarations(block) {
    return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

const values = declarations(root);
const aliases = declarations(explicit);
const fallbackAliases = declarations(fallback);

/**
 * @param {string} token
 * @return {string}
 */
function resolve(token) {
    const reference = aliases.get(token);
    assert.ok(reference, `Missing dark alias ${token}`);
    assert.equal(reference, fallbackAliases.get(token), `Fallback differs for ${token}`);
    const name = reference.match(/^var\((--dark-[\w-]+)\)$/)?.[1];
    assert.ok(name, `Alias is not canonical for ${token}`);
    const value = values.get(name);
    assert.ok(value, `Missing canonical ${name}`);
    return value;
}

/**
 * @param {string} value
 * @return {number[]}
 */
function parseColor(value) {
    if (value.startsWith('#')) {
        const digits = value.slice(1);
        return [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16)).concat(1);
    }

    const match = value.match(/^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/);
    assert.ok(match, `Unsupported color: ${value}`);
    return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}

/**
 * @param {number[]} foreground
 * @param {number[]} background
 * @return {number[]}
 */
function composite(foreground, background) {
    return [0, 1, 2].map((index) => foreground[index] * foreground[3] + background[index] * (1 - foreground[3])).concat(1);
}

/**
 * @param {number[]} color
 * @return {number}
 */
function luminance(color) {
    const channels = color.slice(0, 3).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/**
 * @param {string} foreground
 * @param {string} background
 * @param {number} minimum
 * @return {void}
 */
function expectContrast(foreground, background, minimum) {
    const foregroundColor = parseColor(resolve(foreground));
    const canvas = parseColor(resolve('--canvas'));
    const backgroundColor = composite(parseColor(resolve(background)), canvas);
    const result = composite(foregroundColor, backgroundColor);
    const levels = [luminance(result), luminance(backgroundColor)].sort((first, second) => second - first);
    const ratio = (levels[0] + 0.05) / (levels[1] + 0.05);
    assert.ok(ratio >= minimum, `${foreground} on ${background}: ${ratio.toFixed(2)} < ${minimum}`);
}

test('explicit and no-JavaScript dark aliases share canonical values', () => {
    assert.deepEqual([...aliases], [...fallbackAliases]);
    assert.match(explicit, /color-scheme: dark/);
    assert.match(fallback, /color-scheme: dark/);
    assert.match(root, /color-scheme: light/);
});

test('dark text, state, action, brand, avatar and focus contrast', () => {
    for (const background of ['--canvas', '--surface', '--surface-solid', '--field-bg', '--glass-bg', '--glass-nav-bg', '--action-soft']) {
        for (const foreground of ['--ink', '--muted', '--action']) {
            expectContrast(foreground, background, 4.5);
        }
    }

    for (const [foreground, background] of [
        ['--status-open', '--status-open-soft'], ['--status-progress', '--status-progress-soft'],
        ['--status-closed', '--status-closed-soft'], ['--success', '--success-soft'],
        ['--danger', '--danger-soft'], ['--on-action', '--action'],
        ['--on-action', '--action-strong'], ['--on-action', '--brand-from'],
        ['--on-action', '--brand-to'], ...['--avatar-peach', '--avatar-lavender', '--avatar-sage', '--avatar-sky'].map((background) => ['--avatar-ink', background]),
    ]) {
        expectContrast(foreground, background, 4.5);
    }

    for (const background of ['--canvas', '--surface-solid', '--field-bg']) {
        expectContrast('--field-border', background, 3);
        expectContrast('--action', background, 3);
    }
});
