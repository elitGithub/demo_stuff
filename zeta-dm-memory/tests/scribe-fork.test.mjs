import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import CampaignBuilder from './support/CampaignBuilder.mjs';
import FakeStorage from './support/FakeStorage.mjs';

const context = vm.createContext({TextEncoder, URL, URLSearchParams});
for (const [folder, names] of Object.entries({
    core: ['ScribeText', 'ScribeCategory', 'ScribeIntake', 'ScribeAnswer', 'ScribeLog', 'ScribeReplay',
        'ScribeFork', 'ScribeKnowledge', 'ScribeAnalyzer', 'ScribeAdoption'],
    page: ['ZetaSource', 'ScribeStore', 'ScribePedant', 'ScribeKeeper', 'ScribeCloud'],
})) {
    for (const name of names) {
        const file = new URL('../scribe/' + folder + '/' + name + '.js', import.meta.url);
        vm.runInContext(readFileSync(file, 'utf8'), context, {filename: file.pathname});
    }
}
const {ScribeFork, ScribeIntake, ScribeLog, ScribeReplay, ScribeText, ScribeStore, ScribeKeeper, ScribeCloud, ScribePedant} =
    vm.runInContext('({ScribeFork, ScribeIntake, ScribeLog, ScribeReplay, ScribeText, ScribeStore, ScribeKeeper, ScribeCloud, ScribePedant})', context);

/**
 * @param {number} count
 * @return {object}
 */
function example(count = 5) {
    const builder = new CampaignBuilder('Player');
    for (let index = 0; index < count; index++) {
        builder.narrator('Saved passage number ' + index + '.');
    }
    const make = (roomId) => builder.messages.map((row, index) => ({...structuredClone(row), roomId,
        id: roomId + index, candidateId: 'choice' + index, isIntro: !index}));
    const parent = make('parent');
    const child = make('child');
    const intake = ScribeIntake.read(parent);
    const book = {adopted: true, log: ScribeLog.create(), fingerprints: {}};
    for (const message of intake.messages) {
        const sequence = book.log.nextSequence++;
        book.log.entries.push({sequence, origin: 'Story', kind: 'Update', messageIds: [message.id],
            operations: [], withdrawn: false, sources: [{id: message.id, fingerprint: message.fingerprint,
                position: message.position, result: 'read'}]});
        book.fingerprints[message.id] = message.fingerprint;
        book.log.read[message.id] = sequence;
    }
    return {parent, child, book};
}

/**
 * @param {object} data
 * @param {string|null} selected
 * @param {object|null} current
 * @return {object}
 */
function stage(data, selected = null, current = null) {
    return ScribeFork.stage({book: data.book, messages: data.parent}, data.child, ScribeIntake.read(data.child),
        'parent', 'child', selected, current);
}

test('direct cutoff, source attribution, candidate mismatch and independent edits bound recovery', () => {
    const data = example();
    assert.equal(stage(data, 'parent1').read, 2);
    data.child[3].candidateId = 'other';
    assert.equal(stage(data).read, 3);
    const stopped = stage(data, 'parent3');
    assert.equal(stopped.shared, 3);
    assert.equal(stopped.read, 3);
    assert.equal(stopped.cutoff.detail, 'passage #4 (parent3) — candidate ID differs.');
    data.child[1].contents[0].text += ' edited';
    assert.throws(() => stage(data), /Fork verification failed at passage #2 \(parent1\): message content differs\./);
    data.child[1].roomId = 'other';
    assert.throws(() => stage(data), /both rooms/);
});

test('fork diagnostics identify the first differing field and require evidence beyond a common intro for an unknown origin', () => {
    for (const [change, reason] of [
        [(row) => { row.messageTime = '2025-01-01T00:00:00.000Z'; }, 'message timestamp differs'],
        [(row) => { row.sender.type = 'USER'; }, 'sender differs'],
        [(row) => { row.contents[0].text = 'Different words'; }, 'message content differs'],
        [(row) => { row.candidateId = 'different'; }, 'candidate ID differs'],
    ]) {
        const data = example();
        change(data.child[0]);
        assert.throws(() => stage(data, 'parent2'), {message: 'Fork verification failed at passage #1 (parent0): ' + reason + ' (selected parent2).'});
    }
    const data = example();
    assert.equal(stage(data, 'parent0').cutoff, null);
    const missing = stage(data, 'elsewhere');
    assert.equal(missing.shared, data.parent.length);
    assert.equal(missing.cutoff.reason, 'selected passage was not found in the source chat');
    assert.equal(missing.cutoff.index, data.parent.length);
    data.child.length = 1;
    assert.throws(() => stage(data), {message: 'Fork verification failed at passage #2 (parent1): the fork has fewer messages than the source.'});
    data.parent.length = 1;
    assert.throws(() => stage(data), /only intro passages matched/);
    assert.throws(() => stage(data, 'elsewhere'), /selected passage elsewhere was not found in the source chat and no non-intro passage matched/);
});

test('fork recovery reads the parent again at most once and commits only a current verified result', async () => {
    for (const scenario of ['first mismatch', 'cutoff', 'picker divergence', 'shorter fork', 'extra child', 'fresh cutoff', 'fresh mismatch',
        'offline', 'room changed', 'fresh child']) {
        const data = example();
        const cached = structuredClone(data.parent);
        const storage = new FakeStorage();
        const first = ['first mismatch', 'fresh mismatch', 'offline', 'room changed'].includes(scenario);
        if (first || ['cutoff', 'picker divergence', 'fresh cutoff'].includes(scenario)) {
            cached[first ? 0 : 3].contents[0].text += ' Obsolete.';
        }
        if (scenario === 'shorter fork') {
            data.child.pop();
        } else if (scenario === 'extra child') {
            cached.pop();
        }
        const needsHistory = scenario === 'fresh child';
        ScribeStore.write(storage, 'child', 'campaign', {completeHistory: true, messages: needsHistory ? data.child.slice(0, 1) : data.child,
            ...(needsHistory ? {needsHistory: true, observations: [{ids: ['obsolete']}]} : {})});
        let childPulls = 0;
        const keeper = await ScribeKeeper.open({storage, roomId: 'child', tabId: 'tab', notify: () => {},
            clock: {now: () => 1000, today: () => '2026-11-24'}, zeta: {history: async () => {
                childPulls++;
                return {messages: data.child, end: 'NoCursor', completeHistory: true};
            }}});
        const calls = [];
        const picker = ['picker divergence', 'shorter fork', 'extra child'].includes(scenario);
        const result = await keeper.recoverFork('parent', picker ? null : 'parent4', async (room, options) => {
            assert.equal(room, 'parent');
            calls.push(options);
            if (!options) {
                return {book: data.book, messages: cached, cached: !['fresh cutoff', 'fresh mismatch'].includes(scenario)};
            }
            assert.equal(options.refresh, true);
            assert.equal(options.book, data.book);
            if (scenario === 'offline') {
                throw new Error('Source history is offline.');
            }
            if (scenario === 'room changed') {
                ScribeStore.write(storage, 'child', 'live', {changed: true});
            }
            return {book: data.book, messages: data.parent, cached: false};
        });
        const retry = ['first mismatch', 'cutoff', 'picker divergence', 'offline', 'room changed'].includes(scenario);
        assert.equal(calls.length, retry ? 2 : 1, scenario);
        assert.equal(childPulls, needsHistory ? 1 : 0, scenario);
        if (needsHistory) {
            assert.equal(ScribeStore.read(storage, 'child', 'campaign').observations, undefined);
        }
        if (['fresh mismatch', 'offline', 'room changed'].includes(scenario)) {
            assert.equal(result.ok, false, scenario);
            assert.equal(ScribeStore.read(storage, 'child', 'book'), null, scenario);
            if (scenario === 'room changed') {
                assert.equal(result.reason, 'Fork recovery stopped because the room changed.');
            } else if (scenario === 'offline') {
                assert.equal(result.reason, 'Source history is offline.');
            }
        } else {
            assert.equal(result.ok, true, result.reason);
            const count = scenario === 'fresh cutoff' ? 3 : ['shorter fork', 'extra child'].includes(scenario) ? 4 : 5;
            assert.equal(result.read, count, scenario);
            assert.equal(result.shared, count, scenario);
        }
        keeper.close();
    }
});

test('partial Writer batch never crosses a fork; modern note and Checker receipts reuse child message IDs', () => {
    const data = example();
    const {book} = data;
    const target = ScribeIntake.read(data.parent).messages[1];
    const fields = [target.id, target.fingerprint, null, 4, 'note-fingerprint'];
    book.log.entries.push({sequence: book.log.nextSequence++, origin: 'Notes', kind: 'Update', messageIds: [],
        operations: [], withdrawn: false, filedInputs: [JSON.stringify(fields)], noteReceipts: [{id: target.id, fingerprint: target.fingerprint}]});
    const pageId = 'incoming-' + ScribeText.fingerprint(JSON.stringify([target.id, target.fingerprint])) + ':0';
    const page = {id: pageId, complete: true, index: 0, total: 1, judged: true, claims: [], findings: [],
        answer: JSON.stringify({page: pageId, complete: true, claims: [], findings: []})};
    const sourceMessages = ScribeIntake.read(data.parent).messages;
    assert.equal(ScribeLog.saveCheck(book, sourceMessages, ScribeLog.checkWork(book, sourceMessages, false, target.id), page), true);
    const restored = stage(data);
    assert.deepEqual(JSON.parse(restored.book.log.entries.find((entry) => entry.filedInputs).filedInputs[0]), ['child1', ...fields.slice(1)]);
    assert.equal(ScribeLog.checkWork(restored.book, ScribeIntake.read(data.child).messages, false, 'child1').targetComplete, true);
    const early = stage(data, 'parent1');
    assert.equal(ScribeLog.checkWork(early.book, ScribeIntake.read(data.child).messages, false, 'child1').targetComplete, true);
    book.log.entries[2].messageIds.push('parent3');
    assert.equal(stage(data, 'parent2').read, 2);
    const partial = structuredClone(restored.book);
    partial.adopted = false;
    assert.throws(() => stage(data, 'parent2', partial), /independent|outside/);
});

test('a 1,301-message fork uses saved originals, keeps its last changed message, and runs no model', async () => {
    const data = example(1301);
    data.child.at(-1).contents[0].text = 'Child-only ending.';
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'child', 'campaign', {completeHistory: true, messages: data.child, gone: []});
    ScribeStore.write(storage, 'parent', 'book', data.book);
    const before = ScribeStore.snapshot(storage, 'parent', 'book');
    let calls = 0;
    const forbidden = () => { calls++; throw new Error('Unexpected request'); };
    const keeper = await ScribeKeeper.open({storage, roomId: 'child', tabId: 'local', ask: forbidden, checkPassage: forbidden,
        clock: {now: () => 1000, today: () => '2026-11-24'}, notify: () => {}, zeta: {history: forbidden}});
    const load = async () => ({book: ScribeStore.read(storage, 'parent', 'book'), messages: data.parent});
    assert.equal(keeper.view().canRecoverFork, true);
    const result = await keeper.recoverFork('parent', null, load);
    assert.deepEqual({...result}, {ok: true, read: 1300, shared: 1300});
    assert.equal(keeper.view().unread.length, 1);
    assert.equal(keeper.view().unread[0].id, 'child1300');
    assert.equal(keeper.view().canRecoverFork, false);
    assert.equal((await keeper.recoverFork('parent', null, load)).ok, false);
    assert.equal(ScribeStore.snapshot(storage, 'parent', 'book').text, before.text);
    assert.equal(ScribeStore.snapshot(storage, 'parent', 'book').generation, before.generation);
    assert.equal(calls, 0);
    keeper.close();
});

test('a parent-only Writer batch leaves a later Narrow valid only for scenes wholly retained in the fork', () => {
    const data = example();
    const entry = (first, last) => ({type: 'Scene', first: 'parent' + first, last: 'parent' + last,
        firstPosition: first + 1, lastPosition: last + 1, day: 1, reach: 'Public', present: [], place: null, summary: 'A visit.'});
    data.book.log.entries[0].operations.push(entry(0, 0));
    data.book.log.entries[1].operations.push(entry(1, 1));
    data.book.log.entries[4].operations.push({...entry(1, 4), sceneId: 'parent1'});
    for (const id of ['parent0', 'parent1', 'parent4']) {
        data.book.log.entries.push({sequence: data.book.log.nextSequence++, origin: 'Operator', kind: 'Operator',
            messageIds: [], operations: [{type: 'Narrow', scene: id}], withdrawn: false});
    }
    const result = stage(data, 'parent2');
    const scenes = result.book.log.entries.filter((row) => row.kind === 'Operator').map((row) => row.operations[0].scene);
    assert.deepEqual([...scenes], ['child0']);
});

test('saved player identity decisions and contradiction dismissals follow their verified referents', () => {
    for (const type of ['Merge', 'Distinct', 'Split', 'Unalias', 'DismissContradiction']) {
        const data = example();
        const {log} = data.book;
        log.nextSubject = 3;
        log.nextFact = 2;
        log.entries[0].operations.push({type:'Subject', subject:'S1', label:'Ada', kind:'character'});
        log.entries[1].operations.push({type:'Subject', subject:'S2', label:'Dee', kind:'character'},
            {type:'Alias', subject:'S1', name:'Scout', cite:'parent1', position:2},
            {type:'Fact', fact:'F1', subject:'S1', label:'Ada', category:'trait', text:'Quiet', hidden:false,
                target:null, targetText:null, other:null, cite:'parent1', position:2},
            {type:'Contradiction', cite:'parent1', earlier:'parent0', said:'East', before:'West',
                why:'Different directions', position:2, earlierPosition:1});
        const sources = ScribeIntake.read(data.parent).messages;
        const order = sources.map((row) => row.id);
        if (type === 'Unalias') {
            ScribeLog.rule(log,ScribeReplay.run(log,order),{type:'Merge',from:'S1',into:'S2'});
        }
        const state = ScribeReplay.run(log, order);
        const command = {Merge:{from:'S1',into:'S2'}, Distinct:{first:'S1',second:'S2'},
            Split:{subject:'S1', label:'Bex', kind:'character', facts:['F1']}, Unalias:{subject:'S1',name:'Scout'},
            DismissContradiction:{contradiction:state.contradictions[0].id}}[type];
        const persisted = ScribeLog.rule(log, state, {type,...command});
        ScribeLog.link(persisted, state, [], sources);
        const result = stage(data,'parent2');
        const childState = ScribeReplay.run(result.book.log,data.child.map((row) => row.id));
        const applied = result.book.log.entries.filter((entry) => entry.operations.some((operation) => operation.type === type));
        assert.equal(applied.length,1,type);
        if (type === 'Merge') {
            assert.equal(childState.subjects.find((row) => row.id === 'S1').mergedInto,'S2');
        } else if (type === 'Distinct') {
            assert.ok(childState.distinct.some((row) => row.first === 'S1' && row.second === 'S2'));
        } else if (type === 'Split') {
            const split = childState.subjects.find((row) => row.label === 'Bex');
            assert.equal(childState.facts.find((row) => row.id === 'F1').subject,split.id);
        } else if (type === 'Unalias') {
            assert.ok(childState.unaliased.some((row) => row.subject === 'S2' && row.name === 'Scout'));
        } else {
            assert.equal(childState.contradictions[0].dismissed,true);
            assert.equal(childState.contradictions[0].id,JSON.stringify(['child1','child0','East','West']));
        }
        assert.equal(stage(data,'parent0').book.log.entries.some((entry) => entry.kind === 'Operator'),false,type);
    }
});

test('an in-flight comparison or its persisted reply follows the shared message and cannot dispatch twice', async () => {
    for (const replied of [false, true]) {
        const data = example();
        const messages = ScribeIntake.read(data.parent).messages;
        const target = messages[1];
        const work = ScribeLog.checkWork(data.book, messages, true, target.id);
        const request = await ScribeFork.incomingPacket(work);
        const answer = {page: request.id, complete: true, claims: [], findings: []};
        data.book.log.checkRequests = {[request.id]: {messageId: target.id, version: work.version, fingerprint: target.fingerprint,
            inputStamp: ScribeText.fingerprint(request.input), projection: null, planBytes: 100000,
            ...(replied ? {reply: {text: JSON.stringify(answer), finish: 'stop'}} : {})}};
        const storage = new FakeStorage();
        ScribeStore.write(storage, 'child', 'campaign', {completeHistory: true, messages: data.child, gone: []});
        const calls = [];
        const keeper = await ScribeKeeper.open({storage, roomId: 'child', tabId: 'local', ask: () => {calls.push('writer');},
            askChecker: () => {calls.push('checker');}, checkPassage: ScribePedant.checkPassage,
            clock: {now: () => 1000, today: () => '2026-11-24'}, notify: () => {},
            zeta: {history: () => ({messages: data.child, end: 'NoCursor', completeHistory: true})}});
        const result = await keeper.recoverFork('parent', null, async () => ({book:data.book, messages:data.parent}));
        assert.equal(result.ok, true, result.reason);
        await keeper.pull();
        const child = ScribeIntake.read(data.child).messages;
        const moved = ScribeStore.read(storage, 'child', 'book');
        const found = Object.entries(moved.log.checkRequests)[0];
        assert.equal(found[1].messageId, child[1].id);
        assert.notEqual(found[0], request.id);
        await keeper.checkHistory(2, 2);
        const latest = ScribeStore.read(storage, 'child', 'book');
        const latestWork = ScribeLog.checkWork(latest, child, false, child[1].id);
        assert.equal(latestWork.targetComplete, replied);
        assert.equal(latestWork.targetDispatched, !replied);
        assert.deepEqual(calls, []);
        keeper.close();
    }
});

test('a saved legacy segment remaps to the identical child comparison and only unpaid pieces are requested', async () => {
    const words = Array.from({length:390}, (item, index) => 'Marker' + String(index).padStart(3, '0') + '.').join(' ');
    const data = example(1);
    data.parent[0].contents[0].text = words;
    data.child[0].contents[0].text = words;
    const sources = ScribeIntake.read(data.parent).messages;
    const target = sources[0];
    data.book.fingerprints[target.id] = target.fingerprint;
    data.book.log.entries[0].sources[0].fingerprint = target.fingerprint;
    const work = ScribeLog.checkWork(data.book, sources);
    const pageBytes = ScribePedant.minimumPassageBytes() + 6000;
    let paid;
    const stop = (page) => {
        assert.ok(ScribeLog.saveCheck(data.book, sources, work, page));
        throw new Error('Interrupted');
    };
    await assert.rejects(ScribePedant.checkPassage({...work, pageBytes, ask: async (system, input) => {
        const request = JSON.parse(input);
        if (!request.page.includes('/')) {
            throw Object.assign(new Error('maximum context length exceeded'), {status:400});
        }
        paid = request;
        return {text: JSON.stringify({page: request.page, complete: true, claims: [], findings: []})};
    }, saveSegment: stop, savePage: stop}), /Interrupted/);
    const result = stage(data, target.id);
    const child = ScribeIntake.read(data.child).messages;
    const next = ScribeLog.checkWork(result.book, child, true, child[0].id);
    assert.equal(next.legacyPartial, true);
    assert.equal(next.targetDispatched, false);
    assert.equal(next.segments.length, 1);
    assert.notEqual(next.segments[0].id, paid.page);
    const calls = [];
    await ScribePedant.checkPassage({...next, pageBytes, completedPages: next.completed, completedSegments: next.segments, ask: async (system, input) => {
        const request = JSON.parse(input);
        calls.push(request);
        return {text: JSON.stringify({page:request.page, complete:true, claims:[], findings:[]})};
    }});
    const done = paid.target.flatMap((part) => part.quote.match(/Marker\d+/g));
    const requested = calls.flatMap((request) => request.target.flatMap((part) => part.quote.match(/Marker\d+/g)));
    assert.ok(done.length && requested.length);
    const overlap = done.filter((word) => requested.includes(word));
    assert.deepEqual(overlap, []);
    assert.equal(new Set([...done,...requested]).size, 390);
});

test('refused Book publication restores the old campaign and Book', () => {
    const storage = new FakeStorage();
    ScribeStore.write(storage, 'child', 'campaign', {messages: []});
    ScribeStore.write(storage, 'child', 'book', {old: true});
    const before = ScribeStore.snapshot(storage, 'child', 'campaign');
    storage.refuseSetsMatching(/:head:child:book$/);
    assert.throws(() => ScribeStore.installFork(storage, 'child', {messages: [{id: 'new'}]}, {old: false}, () => true));
    assert.deepEqual({...ScribeStore.snapshot(storage, 'child', 'campaign')}, {...before});
    assert.equal(ScribeStore.read(storage, 'child', 'book').old, true);
});

test('an unfinished Worker Book maps its saved readings to different destination IDs without an origin transcript', () => {
    const data = example();
    data.book.adopted = false;
    const candidate = {worker: true, book: data.book};
    const recover = () => ScribeFork.stage(candidate, data.child, ScribeIntake.read(data.child), 'parent', 'child', null, null);
    assert.equal(recover().read, 5);
    data.child[3].contents[0].text += ' A different passage.';
    const result = recover();
    assert.equal(result.read, 3);
    assert.deepEqual(Object.keys(result.book.log.read), ['child0', 'child1', 'child2']);
    assert.equal(result.book.log.read.parent1, undefined);
});

test('Worker Book verification handles unread intros, out-of-order reads, Checker pages, cutoffs, duplicates, and empty inputs', () => {
    const unreadIntro = example(4);
    unreadIntro.book.log.entries.shift();
    delete unreadIntro.book.log.read.parent0;
    delete unreadIntro.book.fingerprints.parent0;
    const parentIntake = ScribeIntake.read(unreadIntro.parent).messages;
    const checkedTarget = parentIntake[2];
    const pageId = 'incoming-' + ScribeText.fingerprint(JSON.stringify([checkedTarget.id, checkedTarget.fingerprint])) + ':0';
    const page = {id: pageId, complete: true, index: 0, total: 1, judged: true, claims: [], findings: [],
        answer: JSON.stringify({page: pageId, complete: true, claims: [], findings: []})};
    assert.equal(ScribeLog.saveCheck(unreadIntro.book, parentIntake,
        ScribeLog.checkWork(unreadIntro.book, parentIntake, false, checkedTarget.id), page), true);
    const introRecovered = ScribeFork.stage({worker: true, book: unreadIntro.book}, unreadIntro.child,
        ScribeIntake.read(unreadIntro.child), 'parent', 'child', null, null);
    assert.equal(introRecovered.shared, 3);
    assert.equal(introRecovered.read, 3);
    assert.equal(introRecovered.mapping.get('parent1').id, 'child1');
    assert.equal(introRecovered.mapping.get('parent2').id, 'child2');
    assert.equal(ScribeLog.checkWork(introRecovered.book, ScribeIntake.read(unreadIntro.child).messages,
        false, 'child2').targetComplete, true);

    const outOfOrder = example(4);
    outOfOrder.book.log.entries = [outOfOrder.book.log.entries[2], outOfOrder.book.log.entries[1]];
    outOfOrder.book.log.read = {parent2: outOfOrder.book.log.entries[0].sequence, parent1: outOfOrder.book.log.entries[1].sequence};
    const ordered = ScribeFork.stage({worker: true, book: outOfOrder.book}, outOfOrder.child,
        ScribeIntake.read(outOfOrder.child), 'parent', 'child', null, null);
    assert.equal(ordered.shared, 2);
    assert.equal(ordered.mapping.get('parent1').id, 'child1');
    assert.equal(ordered.mapping.get('parent2').id, 'child2');

    const duplicatedIntro = example(3);
    duplicatedIntro.book.log.entries[1].sources[0].position = 1;
    assert.throws(() => ScribeFork.stage({worker: true, book: duplicatedIntro.book}, duplicatedIntro.child,
        ScribeIntake.read(duplicatedIntro.child), 'parent', 'child', null, null),
    /Fork verification failed at passage #1 \(parent1\): the saved reading does not match this position\./);

    const duplicatedPlayed = example(3);
    duplicatedPlayed.book.log.entries[2].sources[0].position = 2;
    const dupStopped = ScribeFork.stage({worker: true, book: duplicatedPlayed.book}, duplicatedPlayed.child,
        ScribeIntake.read(duplicatedPlayed.child), 'parent', 'child', 'parent2', null);
    assert.equal(dupStopped.shared, 2);
    assert.equal(dupStopped.mismatch.reason, 'the saved reading does not match this position');
    assert.equal(dupStopped.cutoff.reason, 'the saved reading does not match this position');

    const emptyBook = example(3);
    emptyBook.book.log.entries = [];
    emptyBook.book.log.read = {};
    emptyBook.book.fingerprints = {};
    assert.throws(() => ScribeFork.stage({worker: true, book: emptyBook.book}, emptyBook.child,
        ScribeIntake.read(emptyBook.child), 'parent', 'child', null, null),
    {message: 'No saved Writer readings were found in the Worker Book.'});

    const partialRead = example(5);
    partialRead.book.log.entries = partialRead.book.log.entries.slice(0, 3);
    partialRead.book.log.read = Object.fromEntries(partialRead.book.log.entries.map((entry) => [entry.messageIds[0], entry.sequence]));
    const beyond = ScribeFork.stage({worker: true, book: partialRead.book}, partialRead.child,
        ScribeIntake.read(partialRead.child), 'parent', 'child', 'parent4', null);
    assert.equal(beyond.shared, 3);
    assert.deepEqual({...beyond.cutoff}, {
        selected: 'parent4',
        index: 3,
        parentId: null,
        childId: 'child3',
        reason: 'selected passage was not covered by the Worker Book readings',
        detail: 'selected passage was not covered by the Worker Book readings.',
    });

    const noMessages = example(3);
    assert.throws(() => ScribeFork.stage({worker: true, book: noMessages.book}, [],
        {messages: []}, 'parent', 'child', null, null),
    {message: 'The fork messages are needed to verify the Worker Book.'});
});

test('Worker fork recovery pulls full history without a boundary, checks room changes immediately, and clears stale observations', async () => {
    for (const scenario of ['fresh', 'room changed during full pull', 'delta changed', 'delta unchanged']) {
        const data = example(5);
        const storage = new FakeStorage();
        const isDelta = scenario.startsWith('delta');
        if (isDelta) {
            const initialMessages = scenario === 'delta changed' ? data.child.slice(0, 4) : data.child;
            ScribeStore.write(storage, 'child', 'campaign', {
                completeHistory: true,
                gone: [],
                messages: initialMessages,
                observations: [{ids: ['stale-observation']}],
            });
        }
        let historyCalls = 0;
        let lastBoundary = undefined;
        const keeper = await ScribeKeeper.open({
            storage,
            roomId: 'child',
            tabId: 'tab',
            notify: () => {},
            clock: {now: () => 2000, today: () => '2026-11-25'},
            zeta: {
                history: async (_onPage, boundary = null) => {
                    historyCalls++;
                    lastBoundary = boundary;
                    if (scenario === 'room changed during full pull') {
                        ScribeStore.write(storage, 'child', 'live', {changed: true});
                        return {messages: [], end: 'Failed', completeHistory: false};
                    }
                    if (isDelta) {
                        const rows = scenario === 'delta changed' ? data.child.slice(3) : data.child.slice(4);
                        return {messages: rows, end: 'ThroughMessage', completeHistory: false, problem: null, skipped: 0};
                    }
                    return {messages: data.child, end: 'NoCursor', completeHistory: true, problem: null, skipped: 0};
                },
            },
        });
        const result = await keeper.recoverFork('parent', null, async () => ({book: data.book, worker: true}));
        assert.equal(historyCalls, 1, scenario);
        if (scenario === 'room changed during full pull') {
            assert.equal(result.ok, false);
            assert.equal(result.reason, 'Fork recovery stopped because the room changed.');
            assert.equal(ScribeStore.read(storage, 'child', 'book'), null);
        } else {
            assert.equal(result.ok, true, result.reason);
            assert.equal(result.read, 5, scenario);
            assert.equal(result.shared, 5, scenario);
            assert.equal(ScribeStore.read(storage, 'child', 'campaign').observations, undefined, scenario);
            assert.equal(ScribeStore.read(storage, 'child', 'campaign').messages.length, 5, scenario);
            if (isDelta) {
                assert.equal(lastBoundary.id, scenario === 'delta changed' ? 'child3' : 'child4');
            } else {
                assert.equal(lastBoundary, null);
            }
        }
        keeper.close();
    }
});

test('Worker Book lookup reads the selected parent revision even when the child has the same revision', async () => {
    const {book} = example();
    book.adopted = false;
    const storage = new FakeStorage();
    ScribeStore.setCloudKey(storage, 'synthetic'.repeat(8));
    const paths = [];
    const cloud = {room: '/rooms/child', roomId: 'child', storage, clock: {today: () => '2026-11-24'},
        random: () => 'Fictional-Browser-Z-9999', epoch: 0, texts: new Map([['book', {revision: 4, text: 'unrelated'}]]),
        later: () => {}, xmlHttpRequest: (details) => {
            const url = new URL(details.url);
            assert.equal(url.searchParams.get('roomId'), '/rooms/parent');
            assert.equal(details.method, 'GET');
            paths.push(url.pathname);
            const response = url.pathname.endsWith('/part') ? book : {heads: [null, {kind:'book', revision:4, parts:1}]};
            details.onload({status:200, finalUrl:details.url, responseText: JSON.stringify(response)});
        }};
    const found = await ScribeCloud.forkBook(cloud, 'parent');
    assert.equal(found.adopted, false);
    assert.equal(found.log.entries.length, 5);
    assert.deepEqual(paths, ['/v1/scribe', '/v1/scribe/part']);
});

test('a saved Book lookup reports why it failed without exposing credentials or retrying', async () => {
    const metadata = {heads: [{kind: 'book', revision: 1, parts: 1}]};
    const key = 'synthetic'.repeat(8);
    const revoked = 'The Worker request was cancelled.';
    for (const [setup, reason, expectedRequests] of [
        [{key: ''}, 'No DM API key is saved on this PC.', 0],
        [{key: 'short'}, 'The DM API key saved on this PC has an invalid format.', 0],
        [{status: 401}, 'The Worker returned HTTP 401 while looking up the saved Book.', 1],
        [{status: 503}, 'The Worker returned HTTP 503 while looking up the saved Book.', 1],
        [{parts: true, status: 404}, 'The Worker returned HTTP 404 while downloading the saved Book.', 2],
        [{parts: true, status: 503}, 'The Worker returned HTTP 503 while downloading the saved Book.', 2],
        [{event: 'onerror'}, 'The Worker could not be reached while looking up the saved Book.', 1],
        [{parts: true, event: 'onerror'}, 'The Worker could not be reached while downloading the saved Book.', 2],
        [{event: 'ontimeout'}, 'The Worker request timed out.', 1],
        [{event: 'deadline'}, 'The Worker request timed out.', 1],
        [{event: 'onabort'}, revoked, 1],
        [{event: 'abort'}, revoked, 1],
        [{redirect: true}, 'An answer did not come straight from your Worker.', 1],
        [{body: {error: {message: key}}}, 'The Worker returned an invalid list of saved records for this chat.', 1],
        [{body: {heads: [{kind: 'BOok', revision: 2, parts: 1}]}}, 'The Worker returned an invalid list of saved records for this chat.', 1],
        [{body: {heads: [null]}}, 'The Worker returned an invalid list of saved records for this chat.', 1],
        [{body: {heads: [{kind: 'settings'}]}}, 'The Worker returned an invalid list of saved records for this chat.', 1],
        [{body: {heads: [{kind: 'book', parts: 0, revision: 1}]}}, 'The Worker returned invalid revision or part information for the saved Book.', 1],
        [{parts: true, body: key}, 'The downloaded data does not contain a readable Scribe Book.', 2],
        [{parts: true, restart: true}, 'The Worker connection changed while downloading the saved Book.', 2],
        [{body: {heads: []}}, null, 1],
        [{body: {heads: [{kind: 'settings', revision: 2, parts: 1}]}}, null, 1],
    ]) {
        const storage = new FakeStorage();
        ScribeStore.setCloudKey(storage, setup.key ?? key);
        const controller = new AbortController();
        let requests = 0;
        let deadline;
        const cloud = {room: '/rooms/child', roomId: 'child', storage, clock: {today: () => '2026-11-24'},
            random: () => 'Fictional-Browser-Z-9999', epoch: 0, texts: new Map(),
            later: (delay, callback) => { deadline = callback; }, xmlHttpRequest: (details) => {
                requests++;
                if (setup.parts && requests === 1) {
                    details.onload({status: 200, finalUrl: details.url, responseText: JSON.stringify(metadata)});
                } else if (setup.event === 'abort') {
                    controller.abort();
                } else if (setup.event === 'deadline') {
                    deadline();
                } else if (setup.event) {
                    details[setup.event]();
                } else {
                    details.onload({status: setup.status ?? 200, finalUrl: setup.redirect ? 'https://elsewhere.example' : details.url,
                        responseText: JSON.stringify(setup.body ?? {error: {message: key}})});
                    if (setup.restart) {
                        cloud.epoch++;
                    }
                }
            }};
        const lookup = ScribeCloud.forkBook(cloud, 'parent', controller.signal);
        if (reason === null) {
            assert.equal(await lookup, null);
        } else {
            await assert.rejects(lookup, {message: reason});
        }
        assert.equal(requests, expectedRequests);
    }
});
