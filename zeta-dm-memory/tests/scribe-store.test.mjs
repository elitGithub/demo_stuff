import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import FakeStorage from './support/FakeStorage.mjs';

/**
 * @param {string[]} names
 * @return {Object<string, object>}
 */
function loadPage(names) {
    const context = vm.createContext({});
    const loaded = {};
    for (const name of names) {
        const url = new URL(`../scribe/page/${name}.js`, import.meta.url);
        vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname });
        loaded[name] = vm.runInContext(name, context);
    }
    return loaded;
}

const { ScribeStore } = loadPage(['ScribeStore']);
const Kind = ScribeStore.Kind;
const KINDS = Object.values(Kind);
const KEY = 'sk-or-v1-fictional-key-0042';
const DAY = '2026-11-15';
const NEXT_DAY = '2026-11-16';
const OPENING = '{"text":"';
const LAST_SAFE = 9007199254740991;
const LENGTH_SEGMENT = 6;

/**
 * @param {string} letter
 * @param {number} characters
 * @return {{ text: string }}
 */
function sized(letter, characters) {
    return { text: letter.repeat(characters - '{"text":""}'.length) };
}

const LARGE = sized('y', 1300000);
const LARGE_OTHER = sized('z', 1200000);
const MEDIUM = sized('m', 600000);
const TAB_A = sized('a', 700000);
const TAB_B = sized('b', 700000);
const SIGNS = new Map();

/**
 * @param {string} label
 * @return {object}
 */
function sample(label) {
    return {
        label,
        scenes: [['Harbour', 'Ferry'], [{ who: 'Maren', said: ['Wait.', 'Stay.'] }], []],
        text: 'Ñandú café in Zürich, Привет, 東京, 🌊 at the tide',
        long: 'abcdefghij'.repeat(200),
        counters: { read: 12, sent: 3, ratio: 0.5 },
    };
}

/**
 * @param {string} text
 * @return {string}
 */
function fnv(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * @param {object} value
 * @return {{ digest: string, length: number }}
 */
function signOf(value) {
    if (!SIGNS.has(value)) {
        const text = JSON.stringify(value);
        SIGNS.set(value, { digest: fnv(text), length: text.length });
    }
    return SIGNS.get(value);
}

/**
 * @param {object} value
 * @return {string}
 */
function digestOf(value) {
    return signOf(value).digest;
}

/**
 * @param {*} value
 * @return {*}
 */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * @param {*} actual
 * @param {*} expected
 * @param {string} label
 * @return {void}
 */
function assertSame(actual, expected, label) {
    const expectedText = JSON.stringify(expected);
    if (expectedText.length <= 10000) {
        assert.deepEqual(actual === null ? null : plain(actual), plain(expected), label);
        return;
    }
    const actualText = JSON.stringify(actual);
    assert.equal(typeof actualText === 'string' ? actualText.length : -1, expectedText.length, `${label}: length`);
    assert.equal(actualText === expectedText, true, `${label}: content`);
}

/**
 * @param {Function} action
 * @return {Error}
 */
function failureOf(action) {
    try {
        action();
    } catch (error) {
        return error;
    }
    assert.fail('The action did not fail');
}

/**
 * @param {FakeStorage} storage
 * @param {string} roomId
 * @param {string} kind
 * @param {Object<string, object>} candidates
 * @return {string}
 */
function outcome(storage, roomId, kind, candidates) {
    let found = null;
    try {
        found = ScribeStore.read(storage, roomId, kind);
    } catch (error) {
        assert.equal(error.damaged, true, error.message);
        return 'damaged';
    }
    const text = JSON.stringify(found);
    for (const [label, value] of Object.entries(candidates)) {
        if (text === JSON.stringify(value)) {
            return label;
        }
    }
    return 'a mixture';
}

/**
 * @param {string} roomId
 * @param {string} kind
 * @return {string}
 */
function headName(roomId, kind) {
    return `scribe:head:${encodeURIComponent(roomId)}:${kind}`;
}

/**
 * @param {string} roomId
 * @param {string} kind
 * @param {number} generation
 * @param {string} digest
 * @param {number} length
 * @param {number} part
 * @return {string}
 */
function partName(roomId, kind, generation, digest, length, part) {
    return `scribe:part:${encodeURIComponent(roomId)}:${kind}:${generation}:${digest}:${length}:${part}`;
}

/**
 * @param {string} roomId
 * @param {string} kind
 * @param {number} generation
 * @param {object} value
 * @param {number} part
 * @return {string}
 */
function partOf(roomId, kind, generation, value, part) {
    const sign = signOf(value);
    return partName(roomId, kind, generation, sign.digest, sign.length, part);
}

/**
 * @param {string} name
 * @return {RegExp}
 */
function exactly(name) {
    return new RegExp(`^${name}$`);
}

/**
 * @param {FakeStorage} storage
 * @return {string[]}
 */
function names(storage) {
    return [...storage.values.keys()].sort();
}

/**
 * @param {FakeStorage} storage
 * @param {string} roomId
 * @param {string} kind
 * @return {string[]}
 */
function partsOf(storage, roomId, kind) {
    const prefix = `scribe:part:${encodeURIComponent(roomId)}:${kind}:`;
    return names(storage).filter((name) => name.startsWith(prefix));
}

/**
 * @param {FakeStorage} storage
 * @param {string} roomId
 * @param {string} kind
 * @return {{ generation: number, parts: number, characters: number, digest: string, form: number }}
 */
function headOf(storage, roomId, kind) {
    return JSON.parse(storage.values.get(headName(roomId, kind)));
}

/**
 * @param {Map<string, *>} before
 * @param {FakeStorage} storage
 * @return {boolean}
 */
function unchanged(before, storage) {
    if (before.size !== storage.values.size) {
        return false;
    }
    for (const [name, value] of before) {
        if (!storage.values.has(name) || storage.values.get(name) !== value) {
            return false;
        }
    }
    return true;
}

/**
 * @param {FakeStorage} storage
 * @return {number}
 */
function changes(storage) {
    return storage.count('set') + storage.count('remove');
}

/**
 * @param {Error} error
 * @return {string[]}
 */
function textsOf(error) {
    const texts = [];
    for (const property of Object.getOwnPropertyNames(error)) {
        const value = error[property];
        texts.push(String(value));
        if (value !== null && typeof value === 'object') {
            for (const inner of Object.getOwnPropertyNames(value)) {
                texts.push(String(value[inner]));
            }
        }
    }
    return texts;
}

/**
 * @param {FakeStorage} storage
 * @param {string} roomId
 * @param {string} kind
 * @param {object} value
 * @param {string} label
 * @return {void}
 */
function assertWholeOrDamaged(storage, roomId, kind, value, label) {
    const found = outcome(storage, roomId, kind, { whole: value });
    assert.equal(found === 'whole' || found === 'damaged', true, `${label}: ${found}`);
}

test('a value is read back as written', () => {
    const storage = new FakeStorage();
    for (const kind of KINDS) {
        const value = sample(kind);
        assert.equal(ScribeStore.write(storage, 'harbour', kind, value), JSON.stringify(value).length, kind);
        assertSame(ScribeStore.read(storage, 'harbour', kind), value, kind);
    }
    for (const kind of KINDS) {
        assertSame(ScribeStore.read(storage, 'harbour', kind), sample(kind), `${kind} after the others`);
        assert.equal(ScribeStore.read(storage, 'empty', kind), null, `${kind} of an empty room`);
    }

    const apart = new FakeStorage();
    ScribeStore.write(apart, 'north', Kind.Book, sample('north book'));
    ScribeStore.write(apart, 'north', Kind.Live, sample('north live'));
    ScribeStore.write(apart, 'south', Kind.Book, sample('south book'));
    assertSame(ScribeStore.read(apart, 'north', Kind.Book), sample('north book'), 'north book');
    assertSame(ScribeStore.read(apart, 'north', Kind.Live), sample('north live'), 'north live');
    assertSame(ScribeStore.read(apart, 'south', Kind.Book), sample('south book'), 'south book');
    assert.equal(ScribeStore.read(apart, 'south', Kind.Live), null);
    assert.equal(ScribeStore.read(apart, 'north', Kind.Campaign), null);

    const tricky = ['a/b', 'a:b', 'a%2Fb', 'book'];
    const mixed = new FakeStorage();
    for (const roomId of tricky) {
        ScribeStore.write(mixed, roomId, Kind.Book, sample(`book of ${roomId}`));
        ScribeStore.write(mixed, roomId, Kind.Live, sample(`live of ${roomId}`));
    }
    for (const roomId of tricky) {
        ScribeStore.write(mixed, roomId, Kind.Book, sample(`second book of ${roomId}`));
    }
    for (const roomId of tricky) {
        const second = sample(`second book of ${roomId}`);
        assertSame(ScribeStore.read(mixed, roomId, Kind.Book), second, roomId);
        assertSame(ScribeStore.read(mixed, roomId, Kind.Live), sample(`live of ${roomId}`), roomId);
        assert.deepEqual(partsOf(mixed, roomId, Kind.Book), [partOf(roomId, Kind.Book, 2, second, 0)], roomId);
    }
    assert.equal(names(mixed).filter((name) => name.startsWith('scribe:head:')).length, 8);
});

test('a large value is written in parts', () => {
    const storage = new FakeStorage();
    assert.equal(ScribeStore.write(storage, 'deep', Kind.Book, LARGE), 1300000);
    const parts = [0, 1, 2].map((part) => partOf('deep', Kind.Book, 1, LARGE, part));
    assert.deepEqual(names(storage), [headName('deep', Kind.Book), ...parts].sort());
    assert.deepEqual(parts.map((name) => storage.values.get(name).length), [500000, 500000, 300000]);
    assert.deepEqual(headOf(storage, 'deep', Kind.Book), { generation: 1, parts: 3, characters: 1300000, digest: digestOf(LARGE), form: 2 });
    assertSame(ScribeStore.read(storage, 'deep', Kind.Book), LARGE, 'large book');

    const even = new FakeStorage();
    const evenValue = sized('e', 1000000);
    assert.equal(ScribeStore.write(even, 'deep', Kind.Book, evenValue), 1000000);
    assert.equal(partsOf(even, 'deep', Kind.Book).length, 2);
    assertSame(ScribeStore.read(even, 'deep', Kind.Book), evenValue, 'two full parts');
});

test('a save takes effect only when its head is written', () => {
    for (let failing = 1; failing <= 4; failing++) {
        const label = `set ${failing} of the second save`;
        const storage = new FakeStorage();
        ScribeStore.write(storage, 'keep', Kind.Book, LARGE);
        const before = names(storage);
        storage.refuseSetNumber(failing);
        const error = failureOf(() => ScribeStore.write(storage, 'keep', Kind.Book, LARGE_OTHER));
        assert.equal(error.message, 'The save failed', label);
        assert.notEqual(storage.lastRefusal, null, label);
        assert.equal(error.cause, storage.lastRefusal, label);
        const refusedHead = storage.lastRefusal.message.endsWith(headName('keep', Kind.Book));
        assert.equal(refusedHead, failing === 4, label);
        const left = failing === 4 ? [0, 1, 2].map((part) => partOf('keep', Kind.Book, 2, LARGE_OTHER, part)) : [];
        assert.deepEqual(names(storage), [...before, ...left].sort(), label);
        assertSame(ScribeStore.read(storage, 'keep', Kind.Book), LARGE, label);
    }

    const stubborn = new FakeStorage();
    ScribeStore.write(stubborn, 'keep', Kind.Book, LARGE);
    const newParts = [0, 1, 2].map((part) => partOf('keep', Kind.Book, 2, LARGE_OTHER, part));
    stubborn.refuseSetsMatching(exactly(newParts[2])).refuseRemovesMatching(exactly(newParts[0]));
    const error = failureOf(() => ScribeStore.write(stubborn, 'keep', Kind.Book, LARGE_OTHER));
    stubborn.allow();
    assert.equal(error.message, 'The save failed');
    assert.equal(error.cause.message, `The storage refused to set ${newParts[2]}`);
    assert.deepEqual(partsOf(stubborn, 'keep', Kind.Book).filter((name) => name.includes(':book:2:')), [newParts[0]]);
    assertSame(ScribeStore.read(stubborn, 'keep', Kind.Book), LARGE, 'after a cleanup that failed');
});

test('the old generation is removed after the new one is in', () => {
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'tide', Kind.Book, LARGE);
    ScribeStore.write(storage, 'tide', Kind.Book, LARGE_OTHER);
    const second = [0, 1, 2].map((part) => partOf('tide', Kind.Book, 2, LARGE_OTHER, part));
    assert.deepEqual(names(storage), [headName('tide', Kind.Book), ...second].sort());
    assertSame(ScribeStore.read(storage, 'tide', Kind.Book), LARGE_OTHER, 'second save');

    storage.refuseRemovesMatching(exactly(second[1]));
    const third = sample('third');
    assert.equal(ScribeStore.write(storage, 'tide', Kind.Book, third), JSON.stringify(third).length);
    assertSame(ScribeStore.read(storage, 'tide', Kind.Book), third, 'third save');
    const current = partOf('tide', Kind.Book, 3, third, 0);
    assert.deepEqual(names(storage), [headName('tide', Kind.Book), second[1], current].sort());
    storage.allow();
    assert.equal(ScribeStore.sweep(storage, 'tide'), 1);
    assert.deepEqual(names(storage), [headName('tide', Kind.Book), current].sort());
    assertSame(ScribeStore.read(storage, 'tide', Kind.Book), third, 'after the sweep');
});

test('damage is reported, never repaired', () => {
    const tail = MEDIUM.text.length + '{"text":""}'.length - 500000;
    const second = partOf('worn', Kind.Book, 1, MEDIUM, 1);
    const cases = [
        {
            label: 'a missing part',
            leftovers: 0,
            /**
             * @param {FakeStorage} storage
             * @return {void}
             */
            damage: (storage) => {
                storage.values.delete(second);
            },
        },
        {
            label: 'a part with other text that still parses',
            leftovers: 0,
            /**
             * @param {FakeStorage} storage
             * @return {void}
             */
            damage: (storage) => {
                storage.values.set(second, 'm"}');
            },
        },
        {
            label: 'a part with other text of the same length',
            leftovers: 0,
            /**
             * @param {FakeStorage} storage
             * @return {void}
             */
            damage: (storage) => {
                storage.values.set(second, `${'m'.repeat(tail - 2)}!!`);
            },
        },
        {
            label: 'a head that is not JSON',
            leftovers: 2,
            /**
             * @param {FakeStorage} storage
             * @return {void}
             */
            damage: (storage) => {
                storage.values.set(headName('worn', Kind.Book), 'not json');
            },
        },
        {
            label: 'a head with a negative part count',
            leftovers: 2,
            /**
             * @param {FakeStorage} storage
             * @return {void}
             */
            damage: (storage) => {
                storage.values.set(headName('worn', Kind.Book), JSON.stringify({ generation: 1, parts: -1, characters: 600000 }));
            },
        },
    ];
    for (const { label, leftovers, damage } of cases) {
        const storage = new FakeStorage();
        ScribeStore.write(storage, 'worn', Kind.Book, MEDIUM);
        assert.equal(storage.values.get(second).length, tail, label);
        damage(storage);
        const before = new Map(storage.values);
        const changed = changes(storage);
        const error = failureOf(() => ScribeStore.read(storage, 'worn', Kind.Book));
        assert.equal(error.message, 'The saved book of this chat is damaged', label);
        assert.equal(error.damaged, true, label);
        assert.equal(unchanged(before, storage), true, label);
        assert.equal(changes(storage), changed, label);
        assert.equal(ScribeStore.sweep(storage, 'worn'), 0, label);
        assert.equal(unchanged(before, storage), true, label);

        const fresh = sample(`after ${label}`);
        ScribeStore.write(storage, 'worn', Kind.Book, fresh);
        assertSame(ScribeStore.read(storage, 'worn', Kind.Book), fresh, label);
        assert.equal(headOf(storage, 'worn', Kind.Book).generation, 2, label);
        assert.equal(ScribeStore.sweep(storage, 'worn'), leftovers, label);
        const expected = [headName('worn', Kind.Book), partOf('worn', Kind.Book, 2, fresh, 0)];
        assert.deepEqual(names(storage), expected.sort(), label);
        assertSame(ScribeStore.read(storage, 'worn', Kind.Book), fresh, `${label} after the sweep`);
    }
});

test('sweep removes only what nothing points at', () => {
    const storage = new FakeStorage();
    ScribeStore.setKey(storage, KEY);
    const northLive = sample('north live');

    ScribeStore.write(storage, 'north', Kind.Book, MEDIUM);
    storage.refuseRemovesMatching(/^scribe:part:north:book:1:/);
    ScribeStore.write(storage, 'north', Kind.Book, sample('north book'));
    storage.allow();

    ScribeStore.write(storage, 'north', Kind.Campaign, sample('north campaign'));
    storage.refuseSetsMatching(/^scribe:head:north:campaign$/).refuseRemovesMatching(/^scribe:part:north:campaign:2:/);
    failureOf(() => ScribeStore.write(storage, 'north', Kind.Campaign, MEDIUM));
    storage.allow();

    ScribeStore.write(storage, 'north', Kind.Live, northLive);
    const stray = partOf('north', Kind.Live, 1, northLive, 1);
    storage.set(stray, 'stray');
    ScribeStore.claim(storage, 'north', 'tab-1', 1000);

    ScribeStore.write(storage, 'south', Kind.Live, sample('south live'));
    ScribeStore.write(storage, 'south', Kind.Settings, sample('south settings'));
    storage.refuseSetsMatching(/^scribe:head:south:live$/).refuseRemovesMatching(/^scribe:part:south:live:/);
    failureOf(() => ScribeStore.write(storage, 'south', Kind.Live, sample('lost')));
    storage.allow();
    ScribeStore.spend(storage, 'south', DAY, 0.5);
    const orphan = partOf('ghost', Kind.Book, 1, MEDIUM, 0);
    storage.set(orphan, 'orphan');

    const below = [partOf('north', Kind.Book, 1, MEDIUM, 0), partOf('north', Kind.Book, 1, MEDIUM, 1)];
    const above = [
        partOf('north', Kind.Campaign, 2, MEDIUM, 0),
        partOf('north', Kind.Campaign, 2, MEDIUM, 1),
        partOf('south', Kind.Live, 2, sample('lost'), 0),
    ];
    assert.deepEqual([...below, ...above, stray, orphan].filter((name) => !storage.values.has(name)), []);
    const kept = names(storage).filter((name) => !below.includes(name));
    assert.equal(ScribeStore.sweep(storage, 'north'), 2);
    assert.equal(ScribeStore.sweep(storage, 'south'), 0);
    assert.equal(ScribeStore.sweep(storage, 'ghost'), 0);
    assert.deepEqual(names(storage), kept);

    assertSame(ScribeStore.read(storage, 'north', Kind.Book), sample('north book'), 'north book');
    assertSame(ScribeStore.read(storage, 'north', Kind.Campaign), sample('north campaign'), 'north campaign');
    assertSame(ScribeStore.read(storage, 'north', Kind.Live), northLive, 'north live');
    assertSame(ScribeStore.read(storage, 'south', Kind.Live), sample('south live'), 'south live');
    assertSame(ScribeStore.read(storage, 'south', Kind.Settings), sample('south settings'), 'south settings');
    assert.equal(failureOf(() => ScribeStore.read(storage, 'ghost', Kind.Book)).damaged, true);
    assert.equal(ScribeStore.key(storage), KEY);
    assert.equal(ScribeStore.claim(storage, 'north', 'tab-2', 2000), false);
    assert.equal(ScribeStore.spent(storage, 'south', DAY), 0.5);

    ScribeStore.write(storage, 'north', Kind.Campaign, sample('campaign two'));
    ScribeStore.write(storage, 'north', Kind.Campaign, sample('campaign three'));
    ScribeStore.write(storage, 'north', Kind.Live, sample('live two'));
    ScribeStore.write(storage, 'south', Kind.Live, sample('south live two'));
    ScribeStore.write(storage, 'ghost', Kind.Book, sample('ghost book'));
    assert.equal(ScribeStore.sweep(storage, 'south'), 0);
    ScribeStore.write(storage, 'south', Kind.Live, sample('south live three'));
    assert.equal(ScribeStore.sweep(storage, 'north'), 3);
    assert.equal(ScribeStore.sweep(storage, 'south'), 1);
    assert.equal(ScribeStore.sweep(storage, 'ghost'), 1);
    assert.deepEqual(partsOf(storage, 'north', Kind.Campaign), [partOf('north', Kind.Campaign, 3, sample('campaign three'), 0)]);
    assert.deepEqual(partsOf(storage, 'north', Kind.Live), [partOf('north', Kind.Live, 2, sample('live two'), 0)]);
    assert.deepEqual(partsOf(storage, 'ghost', Kind.Book), [partOf('ghost', Kind.Book, 2, sample('ghost book'), 0)]);
    for (const roomId of ['north', 'south', 'ghost']) {
        assert.equal(ScribeStore.sweep(storage, roomId), 0, roomId);
    }
});

test('a sweep never touches another chat or a damaged book', () => {
    const storage = new FakeStorage();
    for (const roomId of ['north', 'north:2']) {
        ScribeStore.write(storage, roomId, Kind.Live, sample(`${roomId} live`));
        storage.refuseRemovesMatching(/^scribe:part:/);
        ScribeStore.write(storage, roomId, Kind.Live, sample(`${roomId} live again`));
        storage.allow();
    }
    const northLeftover = partOf('north', Kind.Live, 1, sample('north live'), 0);
    const otherLeftover = partOf('north:2', Kind.Live, 1, sample('north:2 live'), 0);
    assert.equal(storage.values.has(northLeftover), true);
    assert.equal(ScribeStore.sweep(storage, 'north'), 1);
    assert.equal(storage.values.has(northLeftover), false);
    assert.equal(storage.values.has(otherLeftover), true);
    assert.equal(ScribeStore.sweep(storage, 'north:2'), 1);
    assert.equal(storage.values.has(otherLeftover), false);
    for (const roomId of ['north', 'north:2']) {
        assertSame(ScribeStore.read(storage, roomId, Kind.Live), sample(`${roomId} live again`), roomId);
    }

    const second = partOf('worn', Kind.Book, 2, MEDIUM, 1);
    const damages = [
        {
            label: 'a head that is not JSON',
            /**
             * @param {FakeStorage} worn
             * @return {void}
             */
            damage: (worn) => {
                worn.values.set(headName('worn', Kind.Book), 'not json');
            },
        },
        {
            label: 'a head of the wrong shape',
            /**
             * @param {FakeStorage} worn
             * @return {void}
             */
            damage: (worn) => {
                worn.values.set(headName('worn', Kind.Book), JSON.stringify({ generation: 2, parts: -1, characters: 600000 }));
            },
        },
        {
            label: 'a head pointing at a missing part',
            /**
             * @param {FakeStorage} worn
             * @return {void}
             */
            damage: (worn) => {
                worn.values.delete(second);
            },
        },
        {
            label: 'a part with other text',
            /**
             * @param {FakeStorage} worn
             * @return {void}
             */
            damage: (worn) => {
                worn.values.set(second, 'm"}');
            },
        },
    ];
    for (const { label, damage } of damages) {
        const worn = new FakeStorage();
        ScribeStore.write(worn, 'worn', Kind.Book, MEDIUM);
        ScribeStore.write(worn, 'worn', Kind.Live, sample('live'));
        worn.refuseRemovesMatching(/^scribe:part:/);
        ScribeStore.write(worn, 'worn', Kind.Book, MEDIUM);
        ScribeStore.write(worn, 'worn', Kind.Live, sample('live again'));
        worn.allow();
        damage(worn);
        const bookParts = partsOf(worn, 'worn', Kind.Book);
        const bookHead = worn.values.get(headName('worn', Kind.Book));
        assert.equal(bookParts.length >= 3, true, label);
        assert.equal(failureOf(() => ScribeStore.read(worn, 'worn', Kind.Book)).damaged, true, label);

        assert.equal(ScribeStore.sweep(worn, 'worn'), 1, label);
        assert.deepEqual(partsOf(worn, 'worn', Kind.Book), bookParts, label);
        assert.equal(worn.values.get(headName('worn', Kind.Book)), bookHead, label);
        assert.deepEqual(partsOf(worn, 'worn', Kind.Live), [partOf('worn', Kind.Live, 2, sample('live again'), 0)], label);
        assertSame(ScribeStore.read(worn, 'worn', Kind.Live), sample('live again'), label);

        const fresh = sample(`over ${label}`);
        ScribeStore.write(worn, 'worn', Kind.Book, fresh);
        ScribeStore.sweep(worn, 'worn');
        assert.deepEqual(partsOf(worn, 'worn', Kind.Book), [partOf('worn', Kind.Book, 3, fresh, 0)], label);
        assertSame(ScribeStore.read(worn, 'worn', Kind.Book), fresh, label);
    }
});

test('rooms are listed with what they hold', () => {
    const storage = new FakeStorage();
    ScribeStore.setKey(storage, KEY);
    const book = ScribeStore.write(storage, 'a/b', Kind.Book, MEDIUM);
    const live = ScribeStore.write(storage, 'a/b', Kind.Live, sample('live'));
    const campaign = ScribeStore.write(storage, 'south', Kind.Campaign, sample('campaign'));
    ScribeStore.write(storage, 'south', Kind.Settings, sample('first settings'));
    const settings = ScribeStore.write(storage, 'south', Kind.Settings, { models: ['m/x'], stretch: 40 });
    storage.refuseSetsMatching(/^scribe:head:/).refuseRemovesMatching(/^scribe:part:/);
    failureOf(() => ScribeStore.write(storage, 'a/b', Kind.Campaign, sample('lost')));
    failureOf(() => ScribeStore.write(storage, 'ghost', Kind.Book, sample('lost')));
    storage.allow();
    ScribeStore.claim(storage, 'claimed', 'tab-1', 1000);
    ScribeStore.spend(storage, 'spender', DAY, 1);

    const listed = plain(ScribeStore.rooms(storage)).sort((first, other) => first.roomId.localeCompare(other.roomId));
    assert.deepEqual(listed, [
        { roomId: 'a/b', kinds: [Kind.Campaign, Kind.Book, Kind.Live], characters: book + live, damaged: [Kind.Campaign] },
        { roomId: 'ghost', kinds: [Kind.Book], characters: 0, damaged: [Kind.Book] },
        { roomId: 'south', kinds: [Kind.Campaign, Kind.Settings], characters: campaign + settings, damaged: [] },
    ]);
    assert.equal(JSON.stringify(listed).includes(KEY), false);
});

test('dropping a chat removes all of it', () => {
    const storage = new FakeStorage();
    ScribeStore.setKey(storage, KEY);
    const other = 'room:2';
    for (const kind of KINDS) {
        ScribeStore.write(storage, other, kind, sample(`other ${kind}`));
    }
    ScribeStore.claim(storage, other, 'tab-2', 1000);
    ScribeStore.spend(storage, other, DAY, 2);
    const kept = names(storage);

    /**
     * @return {void}
     */
    const fill = () => {
        for (const kind of KINDS) {
            ScribeStore.write(storage, 'room', kind, kind === Kind.Book ? MEDIUM : sample(`room ${kind}`));
        }
        ScribeStore.claim(storage, 'room', 'tab-1', 1000);
        ScribeStore.spend(storage, 'room', DAY, 1);
        storage.refuseSetsMatching(/^scribe:head:room:live$/).refuseRemovesMatching(/^scribe:part:room:live:2:/);
        failureOf(() => ScribeStore.write(storage, 'room', Kind.Live, sample('lost')));
        storage.allow();
    };

    fill();
    assert.equal(storage.values.has(partOf('room', Kind.Live, 2, sample('lost'), 0)), true);
    ScribeStore.drop(storage, 'room');
    assert.deepEqual(names(storage), kept);
    for (const kind of KINDS) {
        assertSame(ScribeStore.read(storage, other, kind), sample(`other ${kind}`), kind);
        assert.equal(ScribeStore.read(storage, 'room', kind), null, kind);
    }
    assert.equal(ScribeStore.claim(storage, other, 'tab-3', 2000), false);
    assert.equal(ScribeStore.spent(storage, other, DAY), 2);
    assert.equal(ScribeStore.key(storage), KEY);

    fill();
    storage.refuseRemovesMatching(/^scribe:head:room:book$/);
    failureOf(() => ScribeStore.drop(storage, 'room'));
    storage.allow();
    assertSame(ScribeStore.read(storage, 'room', Kind.Book), MEDIUM, 'the book whose head stayed');
    for (const kind of KINDS) {
        assertWholeOrDamaged(storage, 'room', kind, kind === Kind.Book ? MEDIUM : sample(`room ${kind}`), kind);
    }
    ScribeStore.drop(storage, 'room');
    assert.deepEqual(names(storage), kept);
});

test('the key is kept apart', () => {
    const storage = new FakeStorage();
    assert.equal(ScribeStore.key(storage), '');
    ScribeStore.setKey(storage, `  ${KEY}\n`);
    assert.equal(ScribeStore.key(storage), KEY);
    ScribeStore.write(storage, 'harbour', Kind.Book, sample('book'));
    ScribeStore.write(storage, 'harbour', Kind.Live, sample('live'));
    assert.equal(ScribeStore.exportText(storage, 'harbour').includes(KEY), false);
    assert.equal(JSON.stringify(ScribeStore.rooms(storage)).includes(KEY), false);

    const errors = [];
    storage.refuseSetNumber(1);
    errors.push(failureOf(() => ScribeStore.write(storage, 'harbour', Kind.Book, sample('again'))));
    storage.refuseGetsMatching(/^scribe:part:/);
    errors.push(failureOf(() => ScribeStore.read(storage, 'harbour', Kind.Book)));
    storage.allow();
    storage.set(headName('harbour', Kind.Live), 'not json');
    errors.push(failureOf(() => ScribeStore.read(storage, 'harbour', Kind.Live)));
    assert.equal(ScribeStore.exportText(storage, 'harbour').includes(KEY), false);
    errors.push(failureOf(() => ScribeStore.write(storage, 'harbour', 'secret', {})));
    errors.push(failureOf(() => ScribeStore.setKey(storage, 42)));
    const leaky = new FakeStorage();
    /**
     * @param {string} name
     * @param {string} value
     * @return {void}
     * @throws {Error}
     */
    leaky.set = (name, value) => {
        throw new Error(`The storage cannot hold ${value} under ${name}`);
    };
    const refusedKey = failureOf(() => ScribeStore.setKey(leaky, KEY));
    assert.equal(refusedKey.message, 'The key could not be saved');
    errors.push(refusedKey);
    for (const error of errors) {
        assert.equal(error.message.includes(KEY), false, error.message);
        for (const text of textsOf(error)) {
            assert.equal(text.includes(KEY), false, error.message);
        }
    }
    assert.equal(ScribeStore.key(storage), KEY);

    ScribeStore.setKey(storage, '');
    assert.equal(ScribeStore.key(storage), '');
    assert.equal(storage.values.has('scribe:key'), false);
    ScribeStore.setKey(storage, KEY);
    ScribeStore.setKey(storage, '  \t ');
    assert.equal(storage.values.has('scribe:key'), false);
});

test('one reader per chat', () => {
    const storage = new FakeStorage();
    const claimName = 'scribe:claim:harbour';
    assert.equal(ScribeStore.claim(storage, 'harbour', 'tab-1', 1000), true);
    const first = storage.values.get(claimName);
    assert.equal(ScribeStore.claim(storage, 'harbour', 'tab-2', 2000), false);
    assert.equal(storage.values.get(claimName), first);

    assert.equal(ScribeStore.claim(storage, 'harbour', 'tab-1', 50000), true);
    assert.deepEqual(JSON.parse(storage.values.get(claimName)), { tabId: 'tab-1', at: 50000 });
    assert.equal(ScribeStore.claim(storage, 'harbour', 'tab-2', 1000 + 90001), false);
    assert.equal(ScribeStore.claim(storage, 'harbour', 'tab-2', 50000 + 90000), false);
    assert.equal(ScribeStore.claim(storage, 'harbour', 'tab-2', 50000 + 90001), true);
    assert.deepEqual(JSON.parse(storage.values.get(claimName)), { tabId: 'tab-2', at: 140001 });
    assert.equal(ScribeStore.claim(storage, 'other', 'tab-1', 140001), true);

    const held = storage.values.get(claimName);
    ScribeStore.release(storage, 'harbour', 'tab-1');
    assert.equal(storage.values.get(claimName), held);
    assert.equal(ScribeStore.claim(storage, 'harbour', 'tab-1', 140002), false);
    ScribeStore.release(storage, 'harbour', 'tab-2');
    assert.equal(storage.values.has(claimName), false);
    assert.equal(storage.values.has('scribe:claim:other'), true);
    assert.equal(ScribeStore.claim(storage, 'harbour', 'tab-3', 140003), true);

    storage.set(claimName, 'not json');
    ScribeStore.release(storage, 'harbour', 'tab-3');
    assert.equal(storage.values.get(claimName), 'not json');
    assert.equal(ScribeStore.claim(storage, 'harbour', 'tab-4', 140004), true);
    storage.set(claimName, JSON.stringify({ tabId: 7, at: 'soon' }));
    assert.equal(ScribeStore.claim(storage, 'harbour', 'tab-5', 140005), true);
    assert.deepEqual(JSON.parse(storage.values.get(claimName)), { tabId: 'tab-5', at: 140005 });
});

test('spending is counted by day', () => {
    const storage = new FakeStorage();
    assert.equal(ScribeStore.spent(storage, 'harbour', DAY), 0);
    assert.equal(ScribeStore.spend(storage, 'harbour', DAY, 0.25), 0.25);
    assert.equal(ScribeStore.spend(storage, 'harbour', DAY, 0.5), 0.75);
    assert.equal(ScribeStore.spent(storage, 'harbour', DAY), 0.75);
    for (const amount of [NaN, -1, '1', Infinity, null, undefined]) {
        assert.equal(ScribeStore.spend(storage, 'harbour', DAY, amount), 0.75, String(amount));
    }
    assert.equal(ScribeStore.spent(storage, 'harbour', DAY), 0.75);

    assert.equal(ScribeStore.spend(storage, 'south', DAY, 2), 2);
    assert.equal(ScribeStore.spent(storage, 'harbour', DAY), 0.75);

    assert.equal(ScribeStore.spent(storage, 'harbour', NEXT_DAY), 0);
    assert.equal(ScribeStore.spend(storage, 'harbour', NEXT_DAY, 0.125), 0.125);
    assert.equal(ScribeStore.spent(storage, 'harbour', NEXT_DAY), 0.125);
    assert.equal(ScribeStore.spent(storage, 'harbour', DAY), 0);
    assert.equal(ScribeStore.spent(storage, 'south', DAY), 2);
    assert.deepEqual(
        names(storage).filter((name) => name.startsWith('scribe:spent:')),
        ['scribe:spent:harbour', 'scribe:spent:south'],
    );
});

test('the export holds everything but the key', () => {
    const storage = new FakeStorage();
    ScribeStore.setKey(storage, KEY);
    ScribeStore.write(storage, 'a:b', Kind.Campaign, sample('campaign'));
    ScribeStore.write(storage, 'a:b', Kind.Book, sample('first book'));
    ScribeStore.write(storage, 'a:b', Kind.Book, sample('book'));
    ScribeStore.write(storage, 'a:b', Kind.Live, sample('live'));
    ScribeStore.write(storage, 'other', Kind.Settings, sample('other settings'));

    const text = ScribeStore.exportText(storage, 'a:b');
    assert.equal(text.includes(KEY), false);
    assert.deepEqual(JSON.parse(text), {
        roomId: 'a:b',
        generations: { campaign: 1, book: 2, live: 1, settings: null },
        damaged: [],
        raw: {},
        campaign: plain(sample('campaign')),
        book: plain(sample('book')),
        live: plain(sample('live')),
        settings: null,
    });

    const bookHead = storage.values.get(headName('a:b', Kind.Book));
    storage.values.set(headName('a:b', Kind.Live), 'not json');
    storage.values.delete(partOf('a:b', Kind.Book, 2, sample('book'), 0));
    const damaged = ScribeStore.exportText(storage, 'a:b');
    assert.equal(damaged.includes(KEY), false);
    assert.deepEqual(JSON.parse(damaged), {
        roomId: 'a:b',
        generations: { campaign: 1, book: null, live: null, settings: null },
        damaged: [Kind.Book, Kind.Live],
        raw: {
            book: { head: bookHead, parts: [] },
            live: {
                head: 'not json',
                parts: [{ name: partOf('a:b', Kind.Live, 1, sample('live'), 0), text: JSON.stringify(sample('live')) }],
            },
        },
        campaign: plain(sample('campaign')),
        book: null,
        live: null,
        settings: null,
    });
});

test('storage that is full does not lose the book', () => {
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'deep', Kind.Book, LARGE);
    const before = names(storage);
    storage.limitCharacters(2000000);
    const error = failureOf(() => ScribeStore.write(storage, 'deep', Kind.Book, LARGE_OTHER));
    assert.equal(error.message, 'The save failed');
    assert.notEqual(storage.lastRefusal, null);
    assert.equal(error.cause, storage.lastRefusal);
    assert.deepEqual(names(storage), before);
    assertSame(ScribeStore.read(storage, 'deep', Kind.Book), LARGE, 'the first book');

    assert.equal(ScribeStore.sweep(storage, 'deep'), 0);
    const smaller = sized('s', 400000);
    assert.equal(ScribeStore.write(storage, 'deep', Kind.Book, smaller), 400000);
    assertSame(ScribeStore.read(storage, 'deep', Kind.Book), smaller, 'the smaller book');
    assert.deepEqual(names(storage), [headName('deep', Kind.Book), partOf('deep', Kind.Book, 2, smaller, 0)].sort());
});

test('arguments that cannot be used are refused', () => {
    const storage = new FakeStorage();
    const attempts = [
        ['kind', () => ScribeStore.write(storage, 'harbour', 'claim', {})],
        ['kind', () => ScribeStore.read(storage, 'harbour', 'Book')],
        ['roomId', () => ScribeStore.write(storage, 42, Kind.Book, {})],
        ['roomId', () => ScribeStore.read(storage, '\ud800', Kind.Book)],
        ['roomId', () => ScribeStore.drop(storage, null)],
        ['roomId', () => ScribeStore.sweep(storage, undefined)],
        ['value', () => ScribeStore.write(storage, 'harbour', Kind.Book, null)],
        ['value', () => ScribeStore.write(storage, 'harbour', Kind.Book, [1, 2])],
        ['value', () => ScribeStore.write(storage, 'harbour', Kind.Book, 'text')],
        ['tabId', () => ScribeStore.claim(storage, 'harbour', '', 1000)],
        ['now', () => ScribeStore.claim(storage, 'harbour', 'tab-1', NaN)],
        ['day', () => ScribeStore.spend(storage, 'harbour', 20261115, 1)],
        ['key', () => ScribeStore.setKey(storage, null)],
    ];
    for (const [argument, attempt] of attempts) {
        assert.equal(failureOf(attempt).message, `The argument is not valid: ${argument}`, argument);
    }
    assert.equal(changes(storage), 0);
});

test('two tabs saving at once never mix', () => {
    const candidates = { first: sample('first'), A: TAB_A, B: TAB_B };
    const dA = digestOf(TAB_A);
    const dB = digestOf(TAB_B);

    /**
     * @return {FakeStorage}
     */
    const fresh = () => {
        const storage = new FakeStorage();
        ScribeStore.write(storage, 'shared', Kind.Book, sample('first'));
        return storage;
    };

    /**
     * @param {FakeStorage} storage
     * @param {object} value
     * @return {string}
     */
    const save = (storage, value) => {
        try {
            ScribeStore.write(storage, 'shared', Kind.Book, value);
        } catch (error) {
            assert.equal(error.message, 'The save failed');
            return 'failed';
        }
        return 'saved';
    };

    /**
     * @param {FakeStorage} storage
     * @param {string} digest
     * @return {string[]}
     */
    const partsWith = (storage, digest) => partsOf(storage, 'shared', Kind.Book).filter((name) => name.includes(`:${digest}:`));

    const between = fresh();
    let tabA = null;
    between.interrupt('set', 2, () => {
        tabA = save(between, TAB_A);
    });
    assert.equal(save(between, TAB_B), 'failed');
    assert.equal(tabA, 'saved');
    assert.equal(outcome(between, 'shared', Kind.Book, candidates), 'A', "A's parts between B's parts");

    const beforeHead = fresh();
    beforeHead.interrupt('set', 3, () => {
        tabA = save(beforeHead, TAB_A);
    });
    assert.equal(save(beforeHead, TAB_B), 'saved');
    assert.equal(tabA, 'saved');
    assert.equal(outcome(beforeHead, 'shared', Kind.Book, candidates), 'B', "A's head between B's parts and B's head");

    const afterHead = fresh();
    afterHead.interrupt('get', 5, () => {
        tabA = save(afterHead, TAB_A);
    });
    assert.equal(save(afterHead, TAB_B), 'failed');
    assert.equal(tabA, 'saved');
    assert.equal(outcome(afterHead, 'shared', Kind.Book, candidates), 'A', "A's head between B's head and its read-back");
    assert.equal(partsWith(afterHead, dA).length, 2);

    const inner = fresh();
    inner.interrupt('set', 2, () => {
        inner.refuseSetsMatching(new RegExp(`:${dA}:\\d+:1$`));
        tabA = save(inner, TAB_A);
        inner.allow();
    });
    assert.equal(save(inner, TAB_B), 'saved');
    assert.equal(tabA, 'failed');
    assert.equal(outcome(inner, 'shared', Kind.Book, candidates), 'B', 'A failing half-way inside B');
    assert.deepEqual(partsWith(inner, dA), []);

    const outer = fresh();
    let tabB = null;
    outer.refuseSetsMatching(new RegExp(`:${dA}:\\d+:1$`));
    outer.interrupt('set', 2, () => {
        tabB = save(outer, TAB_B);
    });
    assert.equal(save(outer, TAB_A), 'failed');
    outer.allow();
    assert.equal(tabB, 'saved');
    assert.equal(outcome(outer, 'shared', Kind.Book, candidates), 'B', 'A failing half-way around B');
    assert.equal(partsWith(outer, dB).length, 2);
    assert.deepEqual(partsWith(outer, dA), []);

    const twins = fresh();
    twins.interrupt('set', 2, () => {
        tabA = save(twins, TAB_A);
        twins.refuseSetNumber(1);
    });
    assert.equal(save(twins, TAB_A), 'failed');
    assert.equal(tabA, 'saved');
    assert.equal(outcome(twins, 'shared', Kind.Book, candidates), 'A', 'the same value failing after its twin was saved');
    assert.equal(partsWith(twins, dA).length, 2);

    const overwritten = fresh();
    const firstOfB = partOf('shared', Kind.Book, 2, TAB_B, 0);
    overwritten.interrupt('set', 2, () => {
        overwritten.values.set(firstOfB, 'other text');
        overwritten.refuseSetNumber(1);
    });
    assert.equal(save(overwritten, TAB_B), 'failed');
    assert.equal(overwritten.values.get(firstOfB), 'other text');
    assert.equal(outcome(overwritten, 'shared', Kind.Book, candidates), 'first', 'a name that no longer holds what B wrote');
});

test('a sweep never removes a save in progress', () => {
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'busy', Kind.Book, MEDIUM);
    let swept = null;
    let seen = null;
    storage.interrupt('set', 3, () => {
        seen = partsOf(storage, 'busy', Kind.Book).filter((name) => name.includes(`:${digestOf(TAB_A)}:`)).length;
        swept = ScribeStore.sweep(storage, 'busy');
    });
    storage.refuseRemovesMatching(/^scribe:part:busy:book:1:/);
    ScribeStore.write(storage, 'busy', Kind.Book, TAB_A);
    storage.allow();
    assert.equal(seen, 2);
    assert.equal(swept, 0);
    assertSame(ScribeStore.read(storage, 'busy', Kind.Book), TAB_A, 'the save that was in progress');
    const current = [0, 1].map((part) => partOf('busy', Kind.Book, 2, TAB_A, part));
    assert.equal(ScribeStore.sweep(storage, 'busy'), 2);
    assert.deepEqual(names(storage), [headName('busy', Kind.Book), ...current].sort());
});

test('a silent storage is not believed', () => {
    const cases = [
        ['a dropped part', /^scribe:part:quiet:book:2:[0-9a-f]{8}:\d+:1$/, 'A part did not read back as written', false],
        ['a dropped head', /^scribe:head:quiet:book$/, 'The head did not read back as written', true],
    ];
    for (const [label, pattern, reason, leftBehind] of cases) {
        const storage = new FakeStorage();
        ScribeStore.write(storage, 'quiet', Kind.Book, MEDIUM);
        const before = names(storage);
        storage.dropSetsMatching(pattern);
        const error = failureOf(() => ScribeStore.write(storage, 'quiet', Kind.Book, TAB_A));
        storage.allow();
        assert.equal(error.message, 'The save failed', label);
        assert.equal(error.cause.message, reason, label);
        assertSame(ScribeStore.read(storage, 'quiet', Kind.Book), MEDIUM, label);
        const left = leftBehind ? [0, 1].map((part) => partOf('quiet', Kind.Book, 2, TAB_A, part)) : [];
        assert.deepEqual(names(storage), [...before, ...left].sort(), label);
    }
});

test('a head that was stored before the throw counts', () => {
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'late', Kind.Book, MEDIUM);
    storage.throwAfterSetsMatching(/^scribe:head:/);
    assert.equal(ScribeStore.write(storage, 'late', Kind.Book, TAB_A), 700000);
    storage.allow();
    assert.equal(storage.refusals.length, 1);
    assertSame(ScribeStore.read(storage, 'late', Kind.Book), TAB_A, 'the new value');
    const current = [0, 1].map((part) => partOf('late', Kind.Book, 2, TAB_A, part));
    assert.deepEqual(names(storage), [headName('late', Kind.Book), ...current].sort());
});

test('parts without a head are damage', () => {
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'bare', Kind.Book, MEDIUM);
    storage.values.delete(headName('bare', Kind.Book));
    const before = new Map(storage.values);
    const error = failureOf(() => ScribeStore.read(storage, 'bare', Kind.Book));
    assert.equal(error.message, 'The saved book of this chat is damaged');
    assert.equal(error.damaged, true);
    assert.equal(ScribeStore.sweep(storage, 'bare'), 0);
    assert.equal(unchanged(before, storage), true);
    assert.deepEqual(plain(ScribeStore.rooms(storage)), [{ roomId: 'bare', kinds: [Kind.Book], characters: 0, damaged: [Kind.Book] }]);
    const exported = JSON.parse(ScribeStore.exportText(storage, 'bare'));
    assert.deepEqual(exported.damaged, [Kind.Book]);
    assert.equal(exported.book, null);
    assert.equal(exported.raw.book.head, null);
    assert.deepEqual(exported.raw.book.parts.map((part) => part.name), partsOf(storage, 'bare', Kind.Book));
    assert.equal(exported.raw.book.parts.map((part) => part.text).join('') === JSON.stringify(MEDIUM), true);
    assert.equal(ScribeStore.read(storage, 'bare', Kind.Live), null);
});

test('a part that does not match the digest is damage', () => {
    for (const [text, expected] of [['', '811c9dc5'], ['a', 'e40c292c'], ['foobar', 'bf9cf968']]) {
        assert.equal(fnv(text), expected, text);
        assert.equal(ScribeStore.digest(text), expected, text);
    }
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'one', Kind.Book, MEDIUM);
    assert.equal(headOf(storage, 'one', Kind.Book).digest, fnv(JSON.stringify(MEDIUM)));
    const first = partOf('one', Kind.Book, 1, MEDIUM, 0);
    const original = storage.values.get(first);
    storage.values.set(first, `${original.slice(0, 1000)}n${original.slice(1001)}`);
    assert.equal(failureOf(() => ScribeStore.read(storage, 'one', Kind.Book)).damaged, true, 'one character changed');

    const swap = new FakeStorage();
    const otherValue = sized('n', 600000);
    ScribeStore.write(swap, 'one', Kind.Book, MEDIUM);
    ScribeStore.write(swap, 'two', Kind.Book, otherValue);
    swap.values.set(first, swap.values.get(partOf('two', Kind.Book, 1, otherValue, 0)));
    assert.equal(failureOf(() => ScribeStore.read(swap, 'one', Kind.Book)).damaged, true, "another room's part");
    assertSame(ScribeStore.read(swap, 'two', Kind.Book), otherValue, 'the other room');

    const legacy = new FakeStorage();
    const old = sample('legacy');
    const oldText = JSON.stringify(old);
    legacy.values.set('scribe:head:old:book', JSON.stringify({ generation: 1, parts: 1, characters: oldText.length }));
    legacy.values.set('scribe:part:old:book:1:0', oldText);
    assertSame(ScribeStore.read(legacy, 'old', Kind.Book), old, 'a head without a digest');
    legacy.values.set('scribe:part:old:book:1:0', JSON.stringify({ label: 'cut' }));
    assert.equal(failureOf(() => ScribeStore.read(legacy, 'old', Kind.Book)).damaged, true, 'a shorter legacy part');
    legacy.values.set('scribe:part:old:book:1:0', oldText);
    const newer = sample('newer');
    ScribeStore.write(legacy, 'old', Kind.Book, newer);
    assert.deepEqual(names(legacy), [headName('old', Kind.Book), partOf('old', Kind.Book, 2, newer, 0)].sort());
});

test('a damaged read is retried when the head moved', () => {
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'moving', Kind.Book, MEDIUM);
    storage.interrupt('get', 3, () => {
        ScribeStore.write(storage, 'moving', Kind.Book, TAB_A);
    });
    assertSame(ScribeStore.read(storage, 'moving', Kind.Book), TAB_A, 'the head moved once');

    storage.interrupt('get', 3, () => {
        ScribeStore.write(storage, 'moving', Kind.Book, TAB_B);
    });
    storage.interrupt('get', 6, () => {
        ScribeStore.write(storage, 'moving', Kind.Book, MEDIUM);
    });
    assert.equal(failureOf(() => ScribeStore.read(storage, 'moving', Kind.Book)).damaged, true, 'the head moved twice');
    assertSame(ScribeStore.read(storage, 'moving', Kind.Book), MEDIUM, 'once the saves are done');

    const still = new FakeStorage();
    ScribeStore.write(still, 'still', Kind.Book, MEDIUM);
    still.values.delete(partOf('still', Kind.Book, 1, MEDIUM, 1));
    assert.equal(failureOf(() => ScribeStore.read(still, 'still', Kind.Book)).damaged, true, 'the head did not move');
});

test('only what reads back is written', () => {
    const storage = new FakeStorage();
    const cyclic = { name: 'loop' };
    cyclic.self = cyclic;
    const values = [
        ['a toJSON that yields a number', {
            /**
             * @return {number}
             */
            toJSON: () => 5,
        }],
        ['a Date', new Date(0)],
        ['a String object', new String('text')],
        ['a BigInt', { count: 10n }],
        ['a cyclic object', cyclic],
    ];
    for (const [label, value] of values) {
        assert.equal(failureOf(() => ScribeStore.write(storage, 'odd', Kind.Book, value)).message, 'The argument is not valid: value', label);
    }
    assert.equal(storage.calls.length, 0);

    const edge = new FakeStorage();
    ScribeStore.write(edge, 'edge', Kind.Book, sample('book'));
    edge.values.set(partName('edge', Kind.Live, LAST_SAFE, 'abcdef01', 5, 0), 'stray');
    const sets = edge.count('set');
    const error = failureOf(() => ScribeStore.write(edge, 'edge', Kind.Live, sample('live')));
    assert.equal(error.message, 'The save failed');
    assert.equal(error.cause.message, 'The next generation is out of range');
    assert.equal(edge.count('set'), sets);
    assertSame(ScribeStore.read(edge, 'edge', Kind.Book), sample('book'), 'the readable book');

    edge.values.set(partName('edge', Kind.Book, LAST_SAFE, 'abcdef01', 5, 0), 'stray');
    ScribeStore.write(edge, 'edge', Kind.Book, sample('book two'));
    assert.equal(headOf(edge, 'edge', Kind.Book).generation, 2);
    assertSame(ScribeStore.read(edge, 'edge', Kind.Book), sample('book two'), 'a readable head is not pushed by a stray part');
});

test('rooms lists everything that can be dropped', () => {
    const storage = new FakeStorage();
    const book = ScribeStore.write(storage, 'healthy', Kind.Book, sample('book'));
    const live = ScribeStore.write(storage, 'healthy', Kind.Live, sample('live'));
    ScribeStore.write(storage, 'headless', Kind.Book, sample('book'));
    storage.values.delete(headName('headless', Kind.Book));
    ScribeStore.write(storage, 'broken', Kind.Campaign, sample('campaign'));
    storage.values.set(headName('broken', Kind.Campaign), 'not json');
    const settings = ScribeStore.write(storage, 'broken', Kind.Settings, sample('settings'));
    storage.values.set(headName('odd', Kind.Book), JSON.stringify({ generation: 1.5, parts: 1, characters: 10 }));
    storage.values.set(headName('odd', Kind.Live), JSON.stringify({ generation: 1, parts: 1, characters: -5 }));
    const foreign = ['scribe:head:%E0:book', 'scribe:part:healthy:book:1:abcdef01:5:0:extra', 'scribe:head:healthy:book:extra'];
    for (const name of foreign) {
        storage.values.set(name, 'foreign');
    }
    ScribeStore.claim(storage, 'claimed', 'tab-1', 1000);

    const listed = plain(ScribeStore.rooms(storage)).sort((first, other) => first.roomId.localeCompare(other.roomId));
    assert.deepEqual(listed, [
        { roomId: 'broken', kinds: [Kind.Campaign, Kind.Settings], characters: settings, damaged: [Kind.Campaign] },
        { roomId: 'headless', kinds: [Kind.Book], characters: 0, damaged: [Kind.Book] },
        { roomId: 'healthy', kinds: [Kind.Book, Kind.Live], characters: book + live, damaged: [] },
        { roomId: 'odd', kinds: [Kind.Book, Kind.Live], characters: 0, damaged: [Kind.Book, Kind.Live] },
    ]);
    for (const entry of listed) {
        ScribeStore.drop(storage, entry.roomId);
    }
    assert.deepEqual(plain(ScribeStore.rooms(storage)), []);
    assert.deepEqual(names(storage), [...foreign, 'scribe:claim:claimed'].sort());
});

test('claims and time', () => {
    const storage = new FakeStorage();
    assert.equal(ScribeStore.claim(storage, 'clock', 'tab-1', 500000), true);
    assert.equal(ScribeStore.claim(storage, 'clock', 'tab-2', 100000), true);
    assert.deepEqual(JSON.parse(storage.values.get('scribe:claim:clock')), { tabId: 'tab-2', at: 100000 });

    assert.equal(ScribeStore.claim(storage, 'race', 'tab-1', 1000), true);
    storage.interrupt('get', 2, () => {
        ScribeStore.claim(storage, 'race', 'tab-2', 1000 + 90001);
    });
    ScribeStore.release(storage, 'race', 'tab-1');
    assert.equal(storage.values.has('scribe:claim:race'), true);
    assert.deepEqual(JSON.parse(storage.values.get('scribe:claim:race')), { tabId: 'tab-2', at: 91001 });

    const unreadable = ['{"tabId":7,"at":1000}', '{"tabId":"tab-1","at":1e999}', '{"tabId":"tab-1","at":null}', '{"tabId":"tab-1"}'];
    for (const text of unreadable) {
        storage.values.set('scribe:claim:odd', text);
        assert.equal(ScribeStore.claim(storage, 'odd', 'tab-9', 1001), true, text);
    }
});

test('spending and the key are read strictly', () => {
    const storage = new FakeStorage();
    for (const text of [`{"day":"${DAY}","amount":-3}`, `{"day":"${DAY}","amount":1e999}`, `{"day":"${DAY}","amount":"2"}`]) {
        storage.values.set('scribe:spent:loose', text);
        assert.equal(ScribeStore.spent(storage, 'loose', DAY), 0, text);
    }
    assert.equal(ScribeStore.spend(storage, 'kept', DAY, 0.5), 0.5);
    assert.equal(ScribeStore.spend(storage, 'kept', NEXT_DAY, 0), 0);
    assert.equal(ScribeStore.spent(storage, 'kept', DAY), 0.5);
    for (const stored of [42, ['sk-or-v1'], { key: 'sk-or-v1' }]) {
        storage.values.set('scribe:key', stored);
        assert.equal(ScribeStore.key(storage), '', JSON.stringify(stored));
    }
});

test('storage errors are not mistaken for damage', () => {
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'sound', Kind.Book, MEDIUM);
    const actions = [
        ['read', () => ScribeStore.read(storage, 'sound', Kind.Book)],
        ['exportText', () => ScribeStore.exportText(storage, 'sound')],
        ['sweep', () => ScribeStore.sweep(storage, 'sound')],
        ['rooms', () => ScribeStore.rooms(storage)],
    ];
    const failures = [
        ['every part', /^scribe:part:/, null],
        ['every head', /^scribe:head:/, null],
        ['the first get only', null, 1],
        ['the second get only', null, 2],
    ];
    for (const [failure, pattern, number] of failures) {
        for (const [label, action] of actions) {
            if (pattern !== null) {
                storage.refuseGetsMatching(pattern);
            } else {
                storage.refuseGetNumber(number);
            }
            const error = failureOf(action);
            storage.allow();
            assert.equal(error.message, 'The storage could not be read', `${label}, ${failure}`);
            assert.equal(error.cause, storage.lastRefusal, `${label}, ${failure}`);
            assert.notEqual(error.damaged, true, `${label}, ${failure}`);
        }
    }
    assertSame(ScribeStore.read(storage, 'sound', Kind.Book), MEDIUM, 'the book afterwards');
});

test('surrogate pairs are never split', () => {
    for (const [label, pair] of [['U+10000', '\u{10000}'], ['U+10FFFF', '\u{10FFFF}']]) {
        const storage = new FakeStorage();
        const value = { text: `${'w'.repeat(500000 - OPENING.length - 1)}${pair}${'w'.repeat(1000)}` };
        assert.equal(JSON.stringify(value).charCodeAt(499999), pair.charCodeAt(0), label);
        ScribeStore.write(storage, 'wave', Kind.Book, value);
        const pieces = partsOf(storage, 'wave', Kind.Book).map((name) => storage.values.get(name));
        assert.equal(pieces.length, 2, label);
        assert.equal(pieces[0].length, 499999, label);
        assert.equal(pieces.every((piece) => piece.isWellFormed()), true, label);
        assertSame(ScribeStore.read(storage, 'wave', Kind.Book), value, label);
    }
});

test('the head never moves down', () => {
    const lastOfB = sample('B second');
    const points = [['before A writes its parts', 'list', 1, 2], ['before A looks at the head again', 'get', 4, 0]];
    for (const [label, operation, count, leftByA] of points) {
        const storage = new FakeStorage();
        ScribeStore.write(storage, 'down', Kind.Book, sample('first'));
        storage.interrupt(operation, count, () => {
            ScribeStore.write(storage, 'down', Kind.Book, sample('B first'));
            ScribeStore.write(storage, 'down', Kind.Book, lastOfB);
            ScribeStore.sweep(storage, 'down');
        });
        const error = failureOf(() => ScribeStore.write(storage, 'down', Kind.Book, TAB_A));
        assert.equal(error.message, 'The save failed', label);
        assert.equal(error.cause.message, 'Another save came first', label);
        assert.equal(partsOf(storage, 'down', Kind.Book).filter((name) => name.includes(`:${digestOf(TAB_A)}:`)).length, leftByA, label);
        assertSame(ScribeStore.read(storage, 'down', Kind.Book), lastOfB, label);
        assert.equal(headOf(storage, 'down', Kind.Book).generation, 3, label);
        ScribeStore.sweep(storage, 'down');
        assertSame(ScribeStore.read(storage, 'down', Kind.Book), lastOfB, `${label}, after a sweep`);
        assert.deepEqual(partsOf(storage, 'down', Kind.Book), [partOf('down', Kind.Book, 3, lastOfB, 0)], label);
    }
});

test('a sweep looks again before removing', () => {
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'look', Kind.Book, MEDIUM);
    const earlier = storage.values.get(headName('look', Kind.Book));
    storage.refuseRemovesMatching(/^scribe:part:look:book:1:/);
    ScribeStore.write(storage, 'look', Kind.Book, sample('second'));
    storage.allow();
    const marked = [0, 1].map((part) => partOf('look', Kind.Book, 1, MEDIUM, part));
    assert.deepEqual(marked.filter((name) => !storage.values.has(name)), []);
    storage.interrupt('get', 3, () => {
        storage.set(headName('look', Kind.Book), earlier);
    });
    assert.equal(ScribeStore.sweep(storage, 'look'), 0);
    assert.deepEqual(marked.filter((name) => !storage.values.has(name)), []);
    assertSame(ScribeStore.read(storage, 'look', Kind.Book), MEDIUM, 'the book the head points at');

    const rising = new FakeStorage();
    const lagging = sample('lagging save');
    const lagText = JSON.stringify(lagging);
    ScribeStore.write(rising, 'rise', Kind.Book, sample('first'));
    rising.refuseRemovesMatching(/^scribe:part:rise:book:1:/);
    ScribeStore.write(rising, 'rise', Kind.Book, sample('second'));
    rising.allow();
    rising.dropSetsMatching(/^scribe:head:/);
    failureOf(() => ScribeStore.write(rising, 'rise', Kind.Book, lagging));
    rising.allow();
    const lagPart = partOf('rise', Kind.Book, 3, lagging, 0);
    assert.equal(rising.values.has(lagPart), true);
    rising.interrupt('get', 3, () => {
        ScribeStore.write(rising, 'rise', Kind.Book, sample('third'));
        ScribeStore.write(rising, 'rise', Kind.Book, sample('fourth'));
    });
    assert.equal(ScribeStore.sweep(rising, 'rise'), 1);
    assert.equal(rising.values.has(lagPart), true);
    rising.set(headName('rise', Kind.Book), JSON.stringify({ generation: 3, parts: 1, characters: lagText.length, digest: fnv(lagText), form: 2 }));
    assertSame(ScribeStore.read(rising, 'rise', Kind.Book), lagging, 'a late head over parts above the first floor');
});

test('an unsure save removes nothing', () => {
    const second = sample('second');
    const lagging = new FakeStorage();
    ScribeStore.write(lagging, 'unsure', Kind.Book, MEDIUM);
    lagging.lagGetsMatching(/^scribe:head:/, 2);
    const error = failureOf(() => ScribeStore.write(lagging, 'unsure', Kind.Book, second));
    assert.equal(error.message, 'The save failed');
    assert.equal(error.cause.message, 'The head did not read back as written');
    lagging.allow();
    assertSame(ScribeStore.read(lagging, 'unsure', Kind.Book), second, 'a head that landed late');
    assert.equal(ScribeStore.sweep(lagging, 'unsure'), 2);
    assertSame(ScribeStore.read(lagging, 'unsure', Kind.Book), second, 'after a sweep');

    const blind = new FakeStorage();
    ScribeStore.write(blind, 'unsure', Kind.Book, MEDIUM);
    blind.interrupt('set', 2, () => {
        blind.refuseGetsMatching(/^scribe:head:/);
    });
    const unreadable = failureOf(() => ScribeStore.write(blind, 'unsure', Kind.Book, second));
    assert.equal(unreadable.message, 'The save failed');
    assert.equal(unreadable.cause.message, 'The storage could not be read');
    blind.allow();
    assertSame(ScribeStore.read(blind, 'unsure', Kind.Book), second, 'a head that could not be read back');
});

test('two values of one digest and different lengths never share a name', () => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';

    /**
     * @param {number} seed
     * @param {number} length
     * @return {string}
     */
    const token = (seed, length) => {
        let state = seed;
        let made = '';
        for (let position = 0; position < length; position++) {
            state = (Math.imul(state ^ (state >>> 15), 2246822519) + 374761393) | 0;
            made += alphabet[(state >>> 0) % alphabet.length];
        }
        return made;
    };
    const shorter = new Map();
    const longer = new Map();
    let pair = null;
    for (let index = 0; index < 400000 && pair === null; index++) {
        const short = { a: token(index * 2 + 1, 8) };
        const long = { a: token(index * 2 + 2, 9) };
        const shortDigest = fnv(JSON.stringify(short));
        const longDigest = fnv(JSON.stringify(long));
        shorter.set(shortDigest, short);
        longer.set(longDigest, long);
        if (longer.has(shortDigest)) {
            pair = [short, longer.get(shortDigest)];
        } else if (shorter.has(longDigest)) {
            pair = [shorter.get(longDigest), long];
        }
    }
    assert.notEqual(pair, null);
    const [first, other] = pair;
    assert.equal(fnv(JSON.stringify(first)), fnv(JSON.stringify(other)));
    assert.notEqual(JSON.stringify(first).length, JSON.stringify(other).length);

    const storage = new FakeStorage();
    ScribeStore.write(storage, 'same', Kind.Book, sample('first'));
    storage.interrupt('set', 2, () => {
        ScribeStore.write(storage, 'same', Kind.Book, other);
    });
    ScribeStore.write(storage, 'same', Kind.Book, first);
    assertSame(ScribeStore.read(storage, 'same', Kind.Book), first, 'the value whose head stands');
    const firstPart = partOf('same', Kind.Book, 2, first, 0);
    const otherPart = partOf('same', Kind.Book, 2, other, 0);
    assert.notEqual(firstPart, otherPart);
    assert.equal(storage.values.get(firstPart), JSON.stringify(first));
    assert.equal(storage.values.get(otherPart), JSON.stringify(other));

    const sized = new FakeStorage();
    ScribeStore.write(sized, 'sized', Kind.Book, MEDIUM);
    const head = headOf(sized, 'sized', Kind.Book);
    assert.equal(head.form, 2);
    for (const name of partsOf(sized, 'sized', Kind.Book)) {
        assert.equal(name.split(':')[LENGTH_SEGMENT], String(head.characters), name);
    }

    const roundOne = new FakeStorage();
    const old = sample('round one');
    const oldText = JSON.stringify(old);
    const oldPart = `scribe:part:old:book:1:${fnv(oldText)}:0`;
    roundOne.values.set('scribe:head:old:book', JSON.stringify({ generation: 1, parts: 1, characters: oldText.length, digest: fnv(oldText) }));
    roundOne.values.set(oldPart, oldText);
    assertSame(ScribeStore.read(roundOne, 'old', Kind.Book), old, 'a round-1 book');
    const newer = sample('newer');
    ScribeStore.write(roundOne, 'old', Kind.Book, newer);
    assert.deepEqual(names(roundOne), [headName('old', Kind.Book), partOf('old', Kind.Book, 2, newer, 0)].sort());
});

test('a claim slightly ahead is held', () => {
    const storage = new FakeStorage();
    assert.equal(ScribeStore.claim(storage, 'ahead', 'tab-A', 1000), true);
    assert.equal(ScribeStore.claim(storage, 'ahead', 'tab-B', 999), false);
    assert.equal(ScribeStore.claim(storage, 'ahead', 'tab-B', 1000 - 90000), false);
    assert.deepEqual(JSON.parse(storage.values.get('scribe:claim:ahead')), { tabId: 'tab-A', at: 1000 });
    assert.equal(ScribeStore.claim(storage, 'ahead', 'tab-B', 1000 - 90001), true);
});

test('a part must read back exactly', () => {
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'exact', Kind.Book, MEDIUM);
    const kept = [0, 1].map((part) => partOf('exact', Kind.Book, 1, MEDIUM, part));
    storage.alterSetsMatching(/^scribe:part:exact:book:2:/);
    const error = failureOf(() => ScribeStore.write(storage, 'exact', Kind.Book, TAB_A));
    storage.allow();
    assert.equal(error.message, 'The save failed');
    assert.equal(error.cause.message, 'A part did not read back as written');
    assert.deepEqual(kept.filter((name) => !storage.values.has(name)), []);
    assertSame(ScribeStore.read(storage, 'exact', Kind.Book), MEDIUM, 'the previous book');
});

test('an export holds only its own chat', () => {
    const storage = new FakeStorage();
    const own = sample('harbour book');
    ScribeStore.write(storage, 'harbour', Kind.Book, own);
    storage.values.set(headName('harbour', Kind.Book), 'not json');
    ScribeStore.write(storage, 'other', Kind.Book, { text: 'OTHERCHAT book' });
    ScribeStore.write(storage, 'other', Kind.Live, { text: 'OTHERCHAT live' });
    const text = ScribeStore.exportText(storage, 'harbour');
    assert.equal(text.includes('OTHERCHAT'), false);
    const exported = JSON.parse(text);
    assert.deepEqual(exported.damaged, [Kind.Book]);
    assert.deepEqual(exported.raw.book.parts.map((part) => part.name), [partOf('harbour', Kind.Book, 1, own, 0)]);
});

test('a listing that fails is not an empty kind', () => {
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'listless', Kind.Book, sample('book'));
    storage.refuseListing();
    const error = failureOf(() => ScribeStore.read(storage, 'listless', Kind.Live));
    storage.allow();
    assert.equal(error.message, 'The storage could not be read');
    assert.equal(error.cause, storage.lastRefusal);
    assert.notEqual(error.damaged, true);
    assert.equal(ScribeStore.read(storage, 'listless', Kind.Live), null);
});

test('heads and names of the wrong shape', () => {
    const value = sample('shape');
    const text = JSON.stringify(value);
    const digest = fnv(text);
    const storage = new FakeStorage();
    for (const [roomId, generation] of [['fraction', 1.5], ['zero', 0]]) {
        storage.values.set(headName(roomId, Kind.Book), JSON.stringify({ generation, parts: 1, characters: text.length, digest, form: 2 }));
        storage.values.set(`scribe:part:${roomId}:book:${generation}:${digest}:${text.length}:0`, text);
        assert.equal(failureOf(() => ScribeStore.read(storage, roomId, Kind.Book)).damaged, true, roomId);
    }
    storage.values.set(headName('nulled', Kind.Book), JSON.stringify({ generation: 1, parts: 1, characters: text.length, digest: null }));
    storage.values.set('scribe:part:nulled:book:1:0', text);
    assert.equal(failureOf(() => ScribeStore.read(storage, 'nulled', Kind.Book)).damaged, true, 'a null digest');

    const foreign = new FakeStorage();
    ScribeStore.write(foreign, 'sound', Kind.Book, value);
    const strangers = [
        'scribe:head:a%3ab:live',
        'scribe:part:harbour:book:1:ZZZZZZZZ:5:0',
        'scribe:part:harbour:book:1:abc:0',
        'scribe:part:harbour:book:0:0',
        `scribe:part:harbour:book:0:${digest}:${text.length}:0`,
    ];
    for (const name of strangers) {
        foreign.values.set(name, 'foreign');
    }
    assert.deepEqual(plain(ScribeStore.rooms(foreign)).map((entry) => entry.roomId), ['sound']);
    assert.equal(ScribeStore.read(foreign, 'harbour', Kind.Book), null);
    for (const roomId of ['harbour', 'a:b']) {
        assert.equal(ScribeStore.sweep(foreign, roomId), 0, roomId);
        ScribeStore.drop(foreign, roomId);
    }
    assert.deepEqual(strangers.filter((name) => !foreign.values.has(name)), []);
    assertSame(ScribeStore.read(foreign, 'sound', Kind.Book), value, 'the healthy chat');
});

test('a part is recorded before it is set', () => {
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'record', Kind.Book, MEDIUM);
    storage.throwAfterSetsMatching(/^scribe:part:record:book:2:/);
    const error = failureOf(() => ScribeStore.write(storage, 'record', Kind.Book, TAB_A));
    storage.allow();
    assert.equal(error.message, 'The save failed');
    assert.deepEqual(partsOf(storage, 'record', Kind.Book).filter((name) => name.includes(':book:2:')), []);
    assertSame(ScribeStore.read(storage, 'record', Kind.Book), MEDIUM, 'the previous book');
});
