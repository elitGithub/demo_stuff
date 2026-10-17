import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../resources/js/board.js', import.meta.url), 'utf8');

/**
 * @param {string} initialHash
 * @param {object} layout
 * @return {object}
 */
function mountBoard(initialHash = '', layout = {}) {
    const location = { hash: initialHash };
    const scrolls = [];
    const focusCalls = [];
    const submissions = [];
    const pageScrolls = [];
    const tabScrolls = [];
    const pageWindow = {
        scrollX: 17,
        scrollY: 190,
        innerHeight: 800,
        scrollTo: (options) => {
            pageWindow.scrollX = options.left;
            pageWindow.scrollY = options.top;
            pageScrolls.push(options);
        },
    };
    const header = {
        bottom: layout.headerBottom ?? 228,
        getBoundingClientRect: () => ({ top: 10, bottom: header.bottom }),
    };
    const banner = layout.banner === false ? null : {
        top: layout.bannerTop ?? 740,
        getBoundingClientRect: () => ({ top: banner.top, bottom: 790 }),
    };
    const tabList = {
        documentTop: layout.tabListDocumentTop ?? 490,
        scrollLeft: 0,
        getBoundingClientRect: () => ({
            top: tabList.documentTop - pageWindow.scrollY,
            bottom: tabList.documentTop - pageWindow.scrollY + 76,
            left: 20,
            right: 320,
        }),
    };
    const body = {};
    const document = { activeElement: body, documentElement: { classList: new Set() } };
    const observerCallbacks = [];
    const columns = {
        children: [],
        contains: (target) => columns.children.includes(target) || target === card,
    };
    const statuses = ['open', 'in_progress', 'closed'];
    columns.children = statuses.map((status) => ({
        id: `board-${status}`,
        classList: { contains: () => false },
        scrollIntoView: (options) => scrolls.push({ status, options }),
    }));
    const card = {
        id: 'board-card-CASE-0018',
        classList: { contains: (name) => name === 'board-card' },
        scrollIntoView: (options) => scrolls.push({ status: 'card', options }),
        focus: (options) => {
            document.activeElement = card;
            focusCalls.push({ target: 'card', options });
        },
    };
    const tabs = statuses.map((status, index) => ({
        hash: `#board-${status}`,
        closest: () => tabList,
        getBoundingClientRect: () => ({
            top: tabList.getBoundingClientRect().top + 8,
            bottom: tabList.getBoundingClientRect().top + 52,
            left: 28 + index * 120 - tabList.scrollLeft,
            right: 140 + index * 120 - tabList.scrollLeft,
        }),
        attributes: new Map(),
        listeners: new Map(),
        addEventListener: (type, callback) => tabs[index].listeners.set(type, callback),
        setAttribute: (name, value) => tabs[index].attributes.set(name, value),
        removeAttribute: (name) => tabs[index].attributes.delete(name),
        focus: (options) => {
            document.activeElement = tabs[index];
            focusCalls.push({ target: status, options });
        },
        scrollIntoView: (options) => {
            tabScrolls.push({ status, options });
            const bounds = tabs[index].getBoundingClientRect();
            const listBounds = tabList.getBoundingClientRect();

            if (bounds.left < listBounds.left) {
                tabList.scrollLeft += bounds.left - listBounds.left;
            } else if (bounds.right > listBounds.right) {
                tabList.scrollLeft += bounds.right - listBounds.right;
            }

            if (bounds.top < 0) {
                pageWindow.scrollY += bounds.top;
            } else if (bounds.bottom > pageWindow.innerHeight) {
                pageWindow.scrollY += bounds.bottom - pageWindow.innerHeight;
            }
        },
        click: () => {
            location.hash = tabs[index].hash;
            document.activeElement = body;
            pageWindow.scrollX = 0;
            pageWindow.scrollY = 640;
            columns.children[index].scrollIntoView({ block: 'start' });
            observerCallbacks.forEach((callback) => callback([{ isIntersecting: true, target: columns.children[index] }]));
        },
    }));
    const submitButton = {};
    const select = {
        listeners: new Map(),
        addEventListener: (type, callback) => select.listeners.set(type, callback),
        form: {
            classList: { contains: (name) => select.pending && name === 'is-pending' },
            querySelector: () => submitButton,
            requestSubmit: (submitter) => submissions.push(submitter),
        },
        pending: false,
    };
    document.querySelectorAll = (selector) => selector === '[data-board-status-select]' ? [select] : tabs;
    document.querySelector = (selector) => ({
        '[data-board-columns]': columns,
        '.app-bar': header,
        '.demo-banner': banner,
    })[selector];
    document.getElementById = (id) => [...columns.children, card].find((element) => element.id === id);
    runInNewContext(source, {
        document,
        location,
        window: pageWindow,
        IntersectionObserver: class {
            /**
             * @param {Function} callback
             */
            constructor(callback) {
                observerCallbacks.push(callback);
            }

            /**
             * @return {void}
             */
            observe() {}
        },
    });

    return { document, location, tabs, card, scrolls, focusCalls, select, submitButton, submissions, pageWindow, pageScrolls, header, banner, tabList, tabScrolls };
}

test('consecutive Board keys retain active tabs, columns, hashes and outer page position without refocusing', () => {
    const board = mountBoard();
    board.tabs[0].focus();
    const sequence = [
        ['ArrowRight', 1], ['ArrowRight', 2], ['ArrowLeft', 1], ['Home', 0], ['End', 2],
        ['ArrowRight', 0], ['ArrowLeft', 2], ['Home', 0], ['End', 2],
    ];

    for (const [key, expected] of sequence) {
        let prevented = false;
        board.document.activeElement.listeners.get('keydown')({
            key,
            preventDefault: () => { prevented = true; },
        });
        assert.equal(prevented, true);
        assert.equal(board.document.activeElement, board.tabs[expected]);
        assert.equal(board.location.hash, board.tabs[expected].hash);
        assert.deepEqual(board.tabs.map((tab) => tab.attributes.get('aria-current')), board.tabs.map((_, index) => index === expected ? 'true' : undefined));
        assert.equal(board.scrolls.at(-1).status, ['open', 'in_progress', 'closed'][expected]);
        assert.equal(board.focusCalls.at(-1).options.preventScroll, true);
        assert.equal(board.pageWindow.scrollX, 17);
        assert.equal(board.pageWindow.scrollY, 190);
        assert.equal(board.pageScrolls.at(-1).behavior, 'instant');
        assert.equal(board.tabScrolls.at(-1).options.inline, 'nearest');
        assert.ok(board.document.activeElement.getBoundingClientRect().left >= board.tabList.getBoundingClientRect().left);
        assert.ok(board.document.activeElement.getBoundingClientRect().right <= board.tabList.getBoundingClientRect().right);
    }
});

test('consecutive keys reveal an occluded tab below the current sticky header without losing the column or hash', () => {
    const board = mountBoard('', { tabListDocumentTop: 293 });
    board.pageWindow.scrollY = 249;
    board.tabs[0].focus();
    assert.equal(board.tabs[0].getBoundingClientRect().top, 52);

    for (const [key, expected, headerBottom] of [['ArrowRight', 1, 228], ['End', 2, 260], ['Home', 0, 260]]) {
        board.header.bottom = headerBottom;
        board.document.activeElement.listeners.get('keydown')({ key, preventDefault: () => {} });
        assert.equal(board.document.activeElement, board.tabs[expected]);
        assert.equal(board.location.hash, board.tabs[expected].hash);
        assert.equal(board.scrolls.at(-1).status, ['open', 'in_progress', 'closed'][expected]);
        assert.ok(board.tabList.getBoundingClientRect().top >= board.header.bottom);
        assert.ok(board.tabList.getBoundingClientRect().bottom <= board.banner.top);
        assert.equal(board.pageWindow.scrollX, 17);
    }
});

test('keyboard navigation reveals the full tab strip above a fixed banner', () => {
    const board = mountBoard('', { tabListDocumentTop: 910 });
    board.tabs[0].focus();
    assert.ok(board.tabs[0].getBoundingClientRect().bottom > board.banner.top);
    board.tabs[0].listeners.get('keydown')({ key: 'End', preventDefault: () => {} });
    assert.equal(board.document.activeElement, board.tabs[2]);
    assert.equal(board.location.hash, '#board-closed');
    assert.equal(board.tabList.getBoundingClientRect().bottom, board.banner.top);
    assert.ok(board.tabList.getBoundingClientRect().top >= board.header.bottom);
    assert.equal(board.pageWindow.scrollX, 17);
});

test('keyboard navigation uses the viewport edge when no demo banner is rendered', () => {
    const board = mountBoard('', { tabListDocumentTop: 1010, banner: false });
    board.tabs[0].focus();
    board.tabs[0].listeners.get('keydown')({ key: 'ArrowRight', preventDefault: () => {} });
    assert.equal(board.document.activeElement, board.tabs[1]);
    assert.equal(board.location.hash, '#board-in_progress');
    assert.equal(board.tabList.getBoundingClientRect().bottom, board.pageWindow.innerHeight);
    assert.equal(board.pageWindow.scrollX, 17);
});

test('ordinary anchor activation still navigates to its column without claiming keyboard focus restoration', () => {
    const board = mountBoard();
    board.tabs[2].click();
    assert.equal(board.location.hash, '#board-closed');
    assert.equal(board.scrolls.at(-1).status, 'closed');
    assert.equal(board.tabs[2].attributes.get('aria-current'), 'true');
    assert.equal(board.pageWindow.scrollY, 640);
    assert.equal(board.pageScrolls.length, 0);
});

test('non-navigation keys are not cancelled or converted into column navigation', () => {
    const board = mountBoard();
    board.tabs[1].focus();
    board.tabs[1].listeners.get('keydown')({ key: 'Tab', preventDefault: () => assert.fail('Tab must remain native') });
    assert.equal(board.document.activeElement, board.tabs[1]);
    assert.equal(board.location.hash, '');
    assert.equal(board.scrolls.length, 0);
});

test('initial pagination column fragment scrolls without taking card focus', () => {
    const board = mountBoard('#board-closed');
    assert.equal(board.location.hash, '#board-closed');
    assert.equal(board.scrolls.at(-1).status, 'closed');
    assert.equal(board.scrolls.at(-1).options.inline, 'start');
    assert.equal(board.focusCalls.length, 0);
});

test('initial moved-card fragment still scrolls and focuses the moved article', () => {
    const board = mountBoard('#board-card-CASE-0018');
    assert.equal(board.location.hash, '#board-card-CASE-0018');
    assert.equal(board.scrolls.at(-1).status, 'card');
    assert.equal(board.document.activeElement, board.card);
    assert.equal(board.focusCalls.at(-1).options.preventScroll, true);
});

test('status selection still uses requestSubmit and does not resubmit a pending form', () => {
    const board = mountBoard();
    board.select.listeners.get('change')();
    assert.deepEqual(board.submissions, [board.submitButton]);
    board.select.pending = true;
    board.select.listeners.get('change')();
    assert.equal(board.submissions.length, 1);
});
