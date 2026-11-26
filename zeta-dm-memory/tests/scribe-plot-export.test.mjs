import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import FakeClock from './support/FakeClock.mjs';
import PanelDocument from './support/PanelDocument.mjs';

/**
 * @return {Object<string, object>}
 */
function load() {
    const context = vm.createContext({ URL, URLSearchParams, TextEncoder });
    const loaded = {};
    const files = [
        ['core', 'ScribeText'],
        ['core', 'ScribeIntake'],
        ['page', 'ZetaSource'],
        ['page', 'PanelStyle'],
        ['page', 'ScribeSetup'],
        ['page', 'ScribePlotExport'],
    ];
    for (const [folder, name] of files) {
        const url = new URL(`../scribe/${folder}/${name}.js`, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
        loaded[name] = vm.runInContext(name, context);
    }
    return loaded;
}

const { ZetaSource, PanelStyle, ScribePlotExport } = load();

/**
 * @return {Promise<void>}
 */
async function flush() {
    for (let turn = 0; turn < 10; turn++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/**
 * @param {object} overrides
 * @return {object}
 */
function samplePlot(overrides = {}) {
    return {
        plotId: 'plot-42',
        name: 'Harbour Lights: Dusk & Fog!',
        summary: 'A seaside mystery.',
        description: 'Lanterns flicker along {{user}} street.',
        about: 'Built for late-night tales.',
        creatorComment: 'Enjoy.',
        language: 'en',
        mode: 'STORY',
        hashtags: ['mystery'],
        characters: [
            { id: 'c1', name: 'Mavan', description: 'Harbourmaster.' },
            { id: 'c2', name: 'Tamsin', description: 'Ferryman.' },
            { id: 'c3', name: 'Oswin', description: 'Miller.' },
        ],
        chatProfiles: [],
        opening: [{ speaker: 'Narrator', text: 'Rain falls on {{user}}.' }],
        lore: [
            { name: 'Lanterns', text: 'Blue glass warns of reef rocks.' },
            { name: 'Bell', text: 'Rings twice at curfew.' },
        ],
        raw: { lorebooks: [{ name: 'Lanterns', keys: ['lantern'], content: 'Blue glass warns of reef rocks.' }] },
        ...overrides,
    };
}

test('mounts Shadow DOM host with zero inline styles and token-only CSS outside :host', () => {
    const document = new PanelDocument(390);
    const clock = new FakeClock(Date.UTC(2026, 10, 26, 12, 0, 0));
    const handle = ScribePlotExport.mount({
        document,
        AbortController,
        plotId: 'plot-42',
        fetchPlot: async () => samplePlot(),
        download: () => {},
        clock,
    });
    assert.equal(handle.host.id, ScribePlotExport.Settings.HostId);
    assert.equal(document.body.children.includes(handle.host), true);
    assert.notEqual(handle.host.shadow, null);
    const allElements = [handle.host, ...handle.host.shadow.descendants()];
    for (const element of allElements) {
        assert.equal(element.getAttribute('style'), null, element.tagName);
    }
    const style = handle.host.shadow.descendants().find((element) => element.tagName === 'STYLE');
    assert.equal(style.textContent, PanelStyle.PlotText);
    const withoutHost = PanelStyle.PlotText.replace(/:host\s*\{[\s\S]*?\}/g, '');
    assert.equal(/#[0-9a-f]{3,8}\b|rgba?\(/i.test(withoutHost), false);
    assert.match(PanelStyle.PlotText, /prefers-reduced-motion:\s*reduce/);
    assert.match(PanelStyle.PlotText, /:focus-visible/);
    assert.match(PanelStyle.PlotText, /max-width:\s*calc\(100vw - 1\.5rem\)/);
    handle.unmount();
    assert.equal(document.body.children.includes(handle.host), false);
});

test('click disables button, ignores double-click while busy, and downloads formatted plot JSON', async () => {
    const document = new PanelDocument(1280);
    const clock = new FakeClock(Date.UTC(2026, 10, 26, 12, 30, 0));
    const downloads = [];
    let release = null;
    let fetches = 0;
    let seenSignal = null;
    const handle = ScribePlotExport.mount({
        document,
        AbortController,
        plotId: 'plot-42',
        fetchPlot: (signal) => {
            fetches++;
            seenSignal = signal;
            return new Promise((resolve) => {
                release = resolve;
            });
        },
        download: (name, text) => {
            downloads.push({ name, text });
        },
        clock,
    });
    const button = handle.host.shadow.descendants().find((element) => element.id === ScribePlotExport.Settings.ButtonId);
    const status = handle.host.shadow.descendants().find((element) => element.id === ScribePlotExport.Settings.StatusId);
    assert.equal(button.textContent, 'Export plot');
    assert.equal(button.getAttribute('type'), 'button');
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.equal(status.hidden, true);
    button.click();
    assert.equal(fetches, 1);
    assert.equal(button.disabled, true);
    assert.equal(status.hidden, false);
    assert.equal(status.textContent, 'Exporting plot...');
    assert.equal(seenSignal instanceof AbortSignal, true);
    button.dispatchEvent({ type: 'click' });
    assert.equal(fetches, 1);
    release(samplePlot());
    await flush();
    assert.equal(button.disabled, false);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].name, 'zeta-plot-harbour-lights-dusk-fog.json');
    const parsed = JSON.parse(downloads[0].text);
    assert.equal(parsed.format, 'zeta-scribe-plot');
    assert.equal(parsed.version, 1);
    assert.equal(parsed.exportedAt, '2026-11-26T12:30:00.000Z');
    assert.equal(parsed.chat, null);
    assert.equal(parsed.plot.longDescription, 'Lanterns flicker along {{user}} street.');
    assert.equal(status.textContent, 'Exported zeta-plot-harbour-lights-dusk-fog.json (3 characters, 2 lore entries).');
    assert.equal(status.classes.has('error'), false);
    handle.unmount();
});

test('singular counts and omitted AbortController work cleanly', async () => {
    const document = new PanelDocument(1280);
    const clock = new FakeClock(Date.UTC(2026, 10, 26, 13, 0, 0));
    const downloads = [];
    let seenSignal = 'unset';
    const handle = ScribePlotExport.mount({
        document,
        AbortController: null,
        plotId: 'plot-singular',
        fetchPlot: async (signal) => {
            seenSignal = signal;
            return samplePlot({
                plotId: 'plot-singular',
                name: 'Solo',
                characters: [{ id: 'c1', name: 'Mavan', description: 'Alone.' }],
                lore: [{ name: 'Tide', text: 'High at noon.' }],
            });
        },
        download: (name, text) => downloads.push({ name, text }),
        clock,
    });
    const button = handle.host.shadow.descendants().find((element) => element.id === ScribePlotExport.Settings.ButtonId);
    const status = handle.host.shadow.descendants().find((element) => element.id === ScribePlotExport.Settings.StatusId);
    button.click();
    await flush();
    assert.equal(seenSignal, null);
    assert.equal(downloads.length, 1);
    assert.equal(status.textContent, 'Exported zeta-plot-solo.json (1 character, 1 lore entry).');
    handle.unmount();
});

test('NoLogin maps to friendly guidance and HTTP 500 shows error then recovers on retry', async () => {
    const document = new PanelDocument(1280);
    const clock = new FakeClock(Date.UTC(2026, 10, 26, 14, 0, 0));
    const downloads = [];
    let mode = 'nologin';
    const handle = ScribePlotExport.mount({
        document,
        AbortController,
        plotId: 'plot-42',
        fetchPlot: async () => {
            if (mode === 'nologin') {
                throw new Error(ZetaSource.Settings.Messages.NoLogin);
            }
            if (mode === 'server') {
                throw new Error('Zeta answered HTTP 500');
            }
            return samplePlot({ characters: [], lore: [] });
        },
        download: (name, text) => downloads.push({ name, text }),
        clock,
    });
    const button = handle.host.shadow.descendants().find((element) => element.id === ScribePlotExport.Settings.ButtonId);
    const status = handle.host.shadow.descendants().find((element) => element.id === ScribePlotExport.Settings.StatusId);
    button.click();
    await flush();
    assert.equal(downloads.length, 0);
    assert.equal(button.disabled, false);
    assert.equal(status.classes.has('error'), true);
    assert.equal(status.textContent, ScribePlotExport.Settings.Words.NoLogin);
    mode = 'server';
    button.click();
    await flush();
    assert.equal(downloads.length, 0);
    assert.equal(button.disabled, false);
    assert.equal(status.classes.has('error'), true);
    assert.equal(status.textContent, 'Zeta answered HTTP 500');
    mode = 'ok';
    button.click();
    await flush();
    assert.equal(downloads.length, 1);
    assert.equal(button.disabled, false);
    assert.equal(status.classes.has('error'), false);
    assert.equal(status.textContent, 'Exported zeta-plot-harbour-lights-dusk-fog.json (0 characters, 0 lore entries).');
    handle.unmount();
});

test('unmount aborts in-flight fetch and suppresses post-unmount DOM and download calls', async () => {
    const document = new PanelDocument(1280);
    const clock = new FakeClock(Date.UTC(2026, 10, 26, 15, 0, 0));
    const downloads = [];
    let release = null;
    let seenSignal = null;
    const handle = ScribePlotExport.mount({
        document,
        AbortController,
        plotId: 'plot-42',
        fetchPlot: (signal) => {
            seenSignal = signal;
            return new Promise((resolve) => {
                release = resolve;
            });
        },
        download: (name, text) => downloads.push({ name, text }),
        clock,
    });
    const button = handle.host.shadow.descendants().find((element) => element.id === ScribePlotExport.Settings.ButtonId);
    const status = handle.host.shadow.descendants().find((element) => element.id === ScribePlotExport.Settings.StatusId);
    button.click();
    assert.equal(seenSignal.aborted, false);
    const beforeWrites = status.written.length;
    handle.unmount();
    assert.equal(seenSignal.aborted, true);
    assert.equal(document.body.children.includes(handle.host), false);
    release(samplePlot());
    await flush();
    assert.equal(downloads.length, 0);
    assert.equal(status.written.length, beforeWrites);
});

test('invalid plot payload, download failure, mounted AbortError, and idle unmount are handled cleanly', async () => {
    const document = new PanelDocument(1280);
    const clock = new FakeClock(Date.UTC(2026, 10, 26, 16, 0, 0));
    const downloads = [];
    let response = null;
    let failDownload = false;
    const handle = ScribePlotExport.mount({
        document,
        AbortController,
        plotId: 'plot-42',
        fetchPlot: async () => {
            if (response instanceof Error) {
                throw response;
            }
            return response;
        },
        download: (name, text) => {
            if (failDownload) {
                throw new Error('Disk full');
            }
            downloads.push({ name, text });
        },
        clock,
    });
    const button = handle.host.shadow.descendants().find((element) => element.id === ScribePlotExport.Settings.ButtonId);
    const status = handle.host.shadow.descendants().find((element) => element.id === ScribePlotExport.Settings.StatusId);

    for (const bad of [null, { name: 'Broken' }, { plotId: '   ', name: 'Blank' }]) {
        response = bad;
        button.click();
        await flush();
        assert.equal(downloads.length, 0);
        assert.equal(button.disabled, false);
        assert.equal(status.classes.has('error'), true);
        assert.equal(status.textContent, ZetaSource.Settings.Messages.NoPlot);
    }

    response = samplePlot();
    failDownload = true;
    button.click();
    await flush();
    assert.equal(downloads.length, 0);
    assert.equal(button.disabled, false);
    assert.equal(status.classes.has('error'), true);
    assert.equal(status.textContent, 'Disk full');

    failDownload = false;
    const abortError = new Error('Stopped');
    abortError.name = 'AbortError';
    response = abortError;
    button.click();
    await flush();
    assert.equal(button.disabled, false);
    assert.equal(status.hidden, true);
    assert.equal(status.textContent, '');
    assert.equal(status.classes.has('error'), false);

    handle.unmount();
    handle.unmount();
    assert.equal(document.body.children.includes(handle.host), false);
});
