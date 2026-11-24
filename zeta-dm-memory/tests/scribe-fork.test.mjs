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
    page: ['ScribeStore', 'ScribePedant', 'ScribeKeeper', 'ScribeCloud'],
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
    assert.throws(() => stage(data, 'parent3'), /do not verify/);
    data.child[1].contents[0].text += ' edited';
    assert.throws(() => stage(data), /do not verify/);
    data.child[1].roomId = 'other';
    assert.throws(() => stage(data), /both rooms/);
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

test('Worker Book lookup reads the selected parent revision even when the child has the same revision', async () => {
    const {book} = example();
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
            const response = url.pathname.endsWith('/part') ? book : {heads: [{kind:'book', revision:4, parts:1}]};
            details.onload({status:200, finalUrl:details.url, responseText: JSON.stringify(response)});
        }};
    const found = await ScribeCloud.forkBook(cloud, 'parent');
    assert.equal(found.log.entries.length, 5);
    assert.deepEqual(paths, ['/v1/scribe', '/v1/scribe/part']);
});
