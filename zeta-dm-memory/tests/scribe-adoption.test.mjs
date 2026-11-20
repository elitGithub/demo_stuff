import assert from 'node:assert/strict';
import test from 'node:test';
import CampaignBuilder from './support/CampaignBuilder.mjs';
import ScribeCore from './support/ScribeCore.mjs';

const { ScribeIntake, ScribeAnswer, ScribeLog, ScribeReplay, ScribeAnalyzer, ScribeAdoption } = ScribeCore.load([
    'ScribeText',
    'ScribeCategory',
    'ScribeIntake',
    'ScribeAnswer',
    'ScribeLog',
    'ScribeReplay',
    'ScribeAnalyzer',
    'ScribeAdoption',
]);

const firstNote = 'Halvard served ten years with the pikes.';
const laterNote = 'Mirelle keeps the harbour ledger.';
const prose = 'I could not tell which lines matter | the story runs long.';
const questions = [
    'Does Mirelle trust Halvard? | #12',
    'Who rang the harbour bell? | #30',
    'Is the ledger forged? | #35',
];

/**
 * @param {Object<number, string>} written
 * @param {number[]} without
 * @return {{ messages: readonly object[], notes: readonly object[], player: string }}
 */
function campaign(written = {}, without = []) {
    const builder = new CampaignBuilder('Orla');
    for (let number = 1; number <= 100; number++) {
        if (Object.hasOwn(written, number)) {
            builder.player(written[number]);
        } else if (number % 2 === 0) {
            builder.player(`I answer the ferryman, line ${number}.`);
        } else {
            builder.narrator(`The tale goes on, line ${number}.`);
        }
    }
    return ScribeIntake.read(builder.messages.filter((raw, index) => !without.includes(index + 1)));
}

const plainCampaign = campaign();
const notedCampaign = campaign({
    6: `*(\n${firstNote}\n)*`,
    50: `I wave to the ferryman.\n*(\n${firstNote}\n)*`,
    55: `I count the crates.\n*(\n${laterNote}\n)*`,
});
const prompts = new Map([
    [ScribeAnalyzer.Prompt, 'Story'],
    [ScribeAnalyzer.NotesPrompt, 'Notes'],
    [ScribeAnalyzer.AnswersPrompt, 'Answers'],
]);

/**
 * @param {*} value
 * @return {*}
 */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * @param {Object<string, string[]>} blocks
 * @return {string}
 */
function answer(blocks) {
    return Object.entries(blocks)
        .map(([block, lines]) => [`=== ${block}`, ...lines].join('\n'))
        .join('\n');
}

/**
 * @param {{ messages: readonly object[] }} chosen
 * @return {string[]}
 */
function orderOf(chosen) {
    return chosen.messages.map((message) => message.id);
}

/**
 * @param {{ messages: readonly object[] }} chosen
 * @param {number} first
 * @param {number} last
 * @return {object[]}
 */
function stretchOf(chosen, first, last) {
    return chosen.messages.slice(first - 1, last);
}

/**
 * @param {{ messages: readonly object[] }} chosen
 * @param {number} first
 * @param {number} last
 * @return {string[]}
 */
function idsOf(chosen, first, last) {
    return stretchOf(chosen, first, last).map((message) => message.id);
}

/**
 * @param {number} first
 * @param {number} last
 * @return {number[]}
 */
function numbers(first, last) {
    return Array.from({ length: last - first + 1 }, (unused, index) => first + index);
}

/**
 * @param {readonly object[]} stretch
 * @return {number[]}
 */
function positionsOf(stretch) {
    return plain(stretch.map((message) => message.position));
}

/**
 * @param {object} log
 * @param {{ messages: readonly object[] }} chosen
 * @param {number} first
 * @param {number} last
 * @return {void}
 */
function markRead(log, chosen, first, last) {
    ScribeLog.append(log, ScribeReplay.run(log, orderOf(chosen)), [], {
        messages: stretchOf(chosen, first, last),
        origin: 'Story',
    });
}

/**
 * @param {object} log
 * @param {{ messages: readonly object[] }} chosen
 * @return {number}
 */
function readCount(log, chosen) {
    return chosen.messages.filter((message) => Object.hasOwn(log.read, message.id)).length;
}

/**
 * @param {object} state
 * @param {string} text
 * @return {number}
 */
function timesSaid(state, text) {
    return state.facts.filter((fact) => fact.text === text).length;
}

/**
 * @param {string} pass
 * @param {string} user
 * @return {number[]}
 */
function marksOf(pass, user) {
    if (pass === 'Story') {
        const heading = user.match(/NEW MESSAGES \(#(\d+) to #(\d+)\):/);
        return [Number(heading[1]), Number(heading[2])];
    }
    return [...user.matchAll(/^\[#(\d+)\] /gm)].map((match) => Number(match[1]));
}

/**
 * @param {{ pass: string, marks: number[] }} call
 * @return {string}
 */
function scripted(call) {
    if (call.pass === 'Story') {
        const [first, last] = call.marks;
        return answer({
            SUBJECTS: ['Halvard | character', 'Mirelle | character'],
            FACTS: [
                `Halvard | trait | keeps watch from line ${first} | #${first}`,
                `Mirelle | trait | counts coins to line ${last} | #${last}`,
            ],
        });
    }
    const category = call.pass === 'Notes' ? 'background' : 'trait';
    const word = call.pass.toLowerCase();
    return answer({
        FACTS: call.marks.map((mark) => `Halvard | ${category} | settled by the ${word} at line ${mark} | #${mark}`),
    });
}

/**
 * @param {{ pass: string, marks: number[] }} call
 * @return {string}
 */
function questioning(call) {
    const text = scripted(call);
    if (call.pass === 'Story' && call.marks[0] === 1) {
        return `${text}\n${answer({ QUESTIONS: questions })}`;
    }
    return text;
}

/**
 * @param {object} log
 * @param {string} question
 * @param {string} text
 * @return {void}
 */
function reply(log, question, text) {
    ScribeLog.rule(log, ScribeReplay.run(log, orderOf(plainCampaign)), { type: 'Answer', question, text });
}

/**
 * @return {Promise<void>}
 */
function tick() {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * @return {void}
 */
function nothing() {}

/**
 * @return {boolean}
 */
function never() {
    return false;
}

/**
 * @param {object} chosen
 * @return {Promise<{ result: object, log: object, calls: object[], saved: object[], records: object[], reports: object[], events: string[], savesAtReport: number[] }>}
 */
async function adopt(chosen = {}) {
    const book = chosen.campaign ?? plainCampaign;
    const answering = chosen.answering ?? scripted;
    const costing = chosen.costing ?? (() => 0.25);
    const context = {
        log: chosen.log ?? ScribeLog.create(),
        calls: [],
        saved: [],
        records: [],
        reports: [],
        events: [],
        savesAtReport: [],
        pauses: 0,
    };
    const result = await ScribeAdoption.run({
        messages: book.messages,
        readThrough: chosen.readThrough,
        notes: book.notes,
        player: book.player,
        profile: chosen.profile,
        log: context.log,
        size: chosen.size ?? 40,
        budget: chosen.budget ?? 100,
        spent: chosen.spent ?? 0,
        /**
         * @param {string} system
         * @param {string} user
         * @return {Promise<{ text: string, cost: * }>}
         */
        ask: async (system, user) => {
            const pass = prompts.get(system);
            const call = { system, user, pass, marks: marksOf(pass, user), answer: null };
            context.calls.push(call);
            context.events.push('ask');
            call.answer = answering(call, context.calls.length);
            const stopped = (chosen.stopping ?? (() => 0))(call, context.calls.length);
            return { text: call.answer, cost: costing(call, context.calls.length), stopped };
        },
        /**
         * @param {object} kept
         * @return {Promise<void>}
         */
        save: async (kept) => {
            const copy = plain(kept);
            context.events.push('save');
            await (chosen.saving ?? nothing)(context.saved.length + 1, context);
            context.saved.push(copy);
        },
        /**
         * @param {object} item
         * @return {Promise<void>}
         */
        record: async (item) => {
            context.events.push('record');
            await (chosen.recording ?? nothing)(item, context);
            context.records.push(item);
        },
        /**
         * @param {object} report
         * @return {*}
         */
        progress: (report) => {
            context.reports.push(report);
            context.savesAtReport.push(context.saved.length);
            context.events.push('progress');
            return (chosen.reporting ?? nothing)(report, context);
        },
        /**
         * @return {*}
         */
        paused: () => {
            context.pauses++;
            return (chosen.pausing ?? never)(context);
        },
    });
    return { result, ...context };
}

/**
 * @return {{ options: object, touched: string[] }}
 */
function spied() {
    const touched = [];
    const options = {
        messages: plainCampaign.messages,
        notes: plainCampaign.notes,
        player: plainCampaign.player,
        log: ScribeLog.create(),
        size: 40,
        budget: 1,
        spent: 0.5,
        /**
         * @return {Promise<{ text: string, cost: number }>}
         */
        ask: async () => {
            touched.push('ask');
            return { text: '', cost: 0 };
        },
        /**
         * @return {Promise<void>}
         */
        save: async () => {
            touched.push('save');
        },
        /**
         * @return {Promise<void>}
         */
        record: async () => {
            touched.push('record');
        },
        /**
         * @return {void}
         */
        progress: () => {
            touched.push('progress');
        },
        /**
         * @return {boolean}
         */
        paused: () => {
            touched.push('paused');
            return false;
        },
    };
    return { options, touched };
}

/**
 * @param {object[]} calls
 * @return {Array<[string, number[]]>}
 */
function passes(calls) {
    return calls.map((call) => [call.pass, call.marks]);
}

/**
 * @param {string} stop
 * @param {string|null} problem
 * @param {number} spent
 * @param {number} calls
 * @param {number} unpriced
 * @return {{ stop: string, problem: string|null, spent: number, calls: number, unpriced: number }}
 */
function ended(stop, problem, spent, calls, unpriced = 0) {
    return { stop, problem, spent, calls, unpriced };
}

/**
 * @return {Promise<object>}
 */
async function answeredLog() {
    const run = await adopt({ answering: questioning });
    reply(run.log, 'Q1', 'She trusts him with the ledger');
    return run.log;
}

test('the next stretch is the first unread run', () => {
    const messages = plainCampaign.messages;
    const log = ScribeLog.create();
    const fresh = ScribeAdoption.next(log, messages, 40);
    assert.deepEqual(positionsOf(fresh), numbers(1, 40));
    assert.equal(fresh[0], messages[0]);
    markRead(log, plainCampaign, 1, 40);
    assert.deepEqual(positionsOf(ScribeAdoption.next(log, messages, 40)), numbers(41, 80));
    markRead(log, plainCampaign, 41, 50);
    assert.deepEqual(positionsOf(ScribeAdoption.next(log, messages, 40)), numbers(51, 90));
    const gapped = ScribeLog.create();
    markRead(gapped, plainCampaign, 1, 40);
    markRead(gapped, plainCampaign, 61, 100);
    assert.deepEqual(positionsOf(ScribeAdoption.next(gapped, messages, 40)), numbers(41, 60));
    const islanded = ScribeLog.create();
    markRead(islanded, plainCampaign, 1, 40);
    markRead(islanded, plainCampaign, 61, 70);
    assert.deepEqual(positionsOf(ScribeAdoption.next(islanded, messages, 40)), numbers(41, 60));
    const whole = ScribeLog.create();
    markRead(whole, plainCampaign, 1, 100);
    assert.deepEqual(plain(ScribeAdoption.next(whole, messages, 40)), []);
    for (const size of [0, -3, Number.NaN]) {
        assert.deepEqual(positionsOf(ScribeAdoption.next(ScribeLog.create(), messages, size)), [1], String(size));
    }
    assert.deepEqual(positionsOf(ScribeAdoption.next(ScribeLog.create(), messages, 2.9)), [1, 2]);
    assert.deepEqual(positionsOf(ScribeAdoption.next(gapped, messages, 0)), [41]);
});

test('a campaign is read in stretches', async () => {
    const order = orderOf(plainCampaign);
    const run = await adopt();
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passes(run.calls), [
        ['Story', [1, 40]],
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    for (const [index, call] of run.calls.entries()) {
        const before = index === 0 ? ScribeLog.create() : run.saved[index - 1];
        const [first, last] = call.marks;
        assert.equal(call.system, ScribeAnalyzer.Prompt);
        assert.equal(
            call.user,
            ScribeAnalyzer.input(ScribeReplay.run(before, order), 'Orla', stretchOf(plainCampaign, first, last)),
        );
    }
    assert.equal(order.every((id) => Object.hasOwn(run.log.read, id)), true);
    assert.equal(run.saved.length, 3);
    assert.deepEqual(plain(run.log), run.saved[2]);
    const state = ScribeReplay.run(run.log, order);
    assert.deepEqual(plain(state.facts.map((fact) => [fact.text, fact.cite, fact.origin])), [
        ['keeps watch from line 1', 'MESSAGE-1', 'Story'],
        ['counts coins to line 40', 'MESSAGE-40', 'Story'],
        ['keeps watch from line 41', 'MESSAGE-41', 'Story'],
        ['counts coins to line 80', 'MESSAGE-80', 'Story'],
        ['keeps watch from line 81', 'MESSAGE-81', 'Story'],
        ['counts coins to line 100', 'MESSAGE-100', 'Story'],
    ]);
});

test('notes are filed once', async () => {
    const order = orderOf(notedCampaign);
    assert.deepEqual(plain(notedCampaign.notes), [
        { text: firstNote, position: 6 },
        { text: laterNote, position: 55 },
    ]);
    assert.equal(notedCampaign.messages[5].text, '');
    /**
     * @param {{ pass: string, marks: number[] }} call
     * @return {string}
     */
    const straying = (call) =>
        call.pass === 'Notes' ? `${scripted(call)}\nHalvard | trait | heard beside the note | #7` : scripted(call);
    const run = await adopt({ campaign: notedCampaign, answering: straying });
    assert.deepEqual(plain(run.result), ended('Done', null, 1.25, 5));
    assert.deepEqual(passes(run.calls), [
        ['Notes', [6]],
        ['Story', [1, 40]],
        ['Notes', [55]],
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    assert.equal(run.calls[0].system, ScribeAnalyzer.NotesPrompt);
    assert.equal(
        run.calls[0].user,
        ScribeAnalyzer.notesInput(ScribeReplay.run(ScribeLog.create(), order), 'Orla', [notedCampaign.notes[0]]),
    );
    assert.equal(
        run.calls[2].user,
        ScribeAnalyzer.notesInput(ScribeReplay.run(run.saved[1], order), 'Orla', [notedCampaign.notes[1]]),
    );
    assert.deepEqual(plain(run.log.notes), [firstNote, laterNote]);
    assert.deepEqual(plain(run.saved[0].notes), [firstNote]);
    assert.deepEqual(plain(run.saved[0].read), {});
    const state = ScribeReplay.run(run.log, order);
    const filed = state.facts.filter((fact) => fact.text.startsWith('settled by the notes'));
    assert.deepEqual(plain(filed.map((fact) => [fact.text, fact.origin, fact.cite])), [
        ['settled by the notes at line 6', 'Notes', 'MESSAGE-6'],
        ['settled by the notes at line 55', 'Notes', 'MESSAGE-55'],
    ]);
    assert.equal(timesSaid(state, 'heard beside the note'), 0);
    assert.deepEqual(plain(run.reports[0].refusedOperations.map((item) => item.reason)), ['Citation']);
    assert.deepEqual(plain(ScribeLog.withdraw(run.log, 'MESSAGE-3')), idsOf(notedCampaign, 1, 40));
    const again = await adopt({ campaign: notedCampaign, log: run.log });
    assert.deepEqual(plain(again.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(again.calls), [['Story', [1, 40]]]);
    assert.deepEqual(plain(run.log.notes), [firstNote, laterNote]);
});

test('a mixed stretch reads an echo-only row but accepts story citations only from the surviving release at #217', async () => {
    const builder = new CampaignBuilder('Frost');
    while (builder.messages.length < 215) {
        builder.narrator('Frost waits.');
    }
    const attendance = '[Scribe] Mavan stands beside the chains.';
    const release = 'The chains break and Magera takes cat form.';
    builder.narrator(attendance).reply([['Mavan', attendance], ['Narrator', release]]);
    const chosen = ScribeIntake.read(builder.messages);
    const log = ScribeLog.create();
    markRead(log, chosen, 1, 215);
    const result = await adopt({
        campaign: chosen,
        log,
        answering: () => answer({
            FACTS: ['Mavan | trait | stands beside the chains | #216', 'Magera | trait | takes cat form | #217'],
        }),
    });
    assert.equal(result.result.stop, 'Done');
    assert.equal(result.calls.length, 1);
    assert.ok(result.calls[0].user.includes(`[#217] Narrator: ${release}`));
    assert.ok(!result.calls[0].user.includes('[#216]'));
    assert.ok(!result.calls[0].user.includes('Mavan'));
    assert.deepEqual(plain(result.reports[0].refusedOperations.map((item) => item.reason)), ['Citation']);
    assert.deepEqual(plain(log.entries.at(-1).messageIds), ['MESSAGE-216', 'MESSAGE-217']);
    const state = ScribeReplay.run(log, orderOf(chosen));
    assert.deepEqual(plain(state.facts.map((fact) => [fact.text, fact.cite])), [['takes cat form', 'MESSAGE-217']]);
    assert.equal((await adopt({ campaign: chosen, log })).calls.length, 0);
});

test('a disputed position stays out of Story, legacy notes and historical attendance citations', async () => {
    const builder = new CampaignBuilder('Frost').player('I enter.')
        .player('A disputed account.').narrator('A gate opens.').narrator('Rain falls.');
    const intake = ScribeIntake.read(builder.messages);
    const chosen = { ...intake, notes: [{ position: 2, text: 'A disputed legacy note.' }],
        messages: intake.messages.map((message) => message.position === 2 ? { ...message, attributionPending: true } : message) };
    const run = await adopt({
        campaign: chosen,
        answering: (call) => answer({ SCENES: call.marks.includes(1) ? [
            'Day 1 | #1-#1 | Inn | public | present: Frost (from #1) | We wait',
        ] : [
            'Day 1 | #1-#4 | Inn | public | present: Mavan (from #2 until #4) | Rain falls',
            'Day 1 | #1-#4 | Inn | public | present: Frost (from #1 until #4) | Rain falls',
        ] }),
    });
    assert.equal(run.result.stop, 'Done');
    assert.deepEqual(run.calls.map((call) => [call.pass, call.marks]), [['Story', [1, 1]], ['Story', [3, 4]]]);
    assert.ok(run.calls.every((call) => !call.user.includes('disputed')));
    assert.deepEqual(plain(run.reports.at(-1).refusedOperations.map((item) => item.reason)), ['Citation']);
    assert.deepEqual(Object.keys(run.log.read), ['MESSAGE-1', 'MESSAGE-3', 'MESSAGE-4']);
    assert.deepEqual(plain(run.log.notes), []);
    const state = ScribeReplay.run(run.log, orderOf(chosen));
    assert.deepEqual(plain(state.subjects.map((subject) => subject.label)), ['Frost']);
    assert.equal(state.scenes[0].lastPosition, 4);
});

test('adoption marks a storyteller echo-only stretch read with zero claims and zero model calls', async () => {
    const chosen = ScribeIntake.read(new CampaignBuilder('Frost').narrator('@: [Scribe] Mavan is here.').messages);
    const result = await adopt({ campaign: chosen, budget: 0 });
    assert.deepEqual(plain(result.result), ended('Done', null, 0, 0));
    assert.equal(result.calls.length, 0);
    const saved = result.saved.at(-1);
    assert.equal(saved.read['MESSAGE-1'], saved.entries[0].sequence);
    assert.deepEqual(saved.entries[0].operations, []);
});

test('both scene attendance bounds reject echo-only sources before allocating subjects', async () => {
    const builder = new CampaignBuilder('Frost').player('I enter.').narrator('[Scribe] Mavan is here.').narrator('The door closes.');
    const chosen = ScribeIntake.read(builder.messages);
    const run = await adopt({
        campaign: chosen,
        answering: () => answer({
            SCENES: [
                'Day 1 | #1-#3 | Inn | public | present: Mavan (from #2) | The door closes',
                'Day 1 | #1-#3 | Inn | public | present: Mavan (until #2) | The door closes',
                'Day 1 | #1-#3 | Inn | public | present: Frost (from #1 until #3) | The door closes',
            ],
        }),
    });
    assert.equal(run.result.stop, 'Done');
    assert.deepEqual(plain(run.reports[0].refusedOperations.map((item) => item.reason)), ['Citation', 'Citation']);
    const state = ScribeReplay.run(run.log, orderOf(chosen));
    assert.deepEqual(plain(state.subjects.map((subject) => [subject.id, subject.label])), [['S1', 'Frost']]);
    assert.equal(state.scenes.length, 1);
    assert.deepEqual(plain(state.scenes[0].present), [{ subject: 'S1', from: 1, until: 3 }]);
    assert.equal(readCount(run.log, chosen), 3);
});

test('continuing a scene checks historical attendance bounds against the original story rows', async () => {
    const builder = new CampaignBuilder('Frost').player('I enter.').narrator('[Scribe] Mavan is here.').narrator('The door closes.');
    const first = await adopt({
        campaign: ScribeIntake.read(builder.messages),
        answering: () => answer({ SCENES: ['Day 1 | #1-#3 | Inn | public | present: Frost (from #1) | We wait'] }),
    });
    const chosen = ScribeIntake.read(builder.narrator('It starts to rain.').messages);
    const next = await adopt({
        campaign: chosen,
        log: plain(first.saved.at(-1)),
        answering: () => answer({
            SCENES: [
                'Day 1 | #1-#4 | Inn | public | present: Mavan (from #2 until #4) | It rains',
                'Day 1 | #1-#4 | Inn | public | present: Frost (from #1 until #2) | It rains',
                'Day 1 | #1-#4 | Inn | public | present: Frost (from #1 until #4) | It rains',
            ],
        }),
    });
    assert.equal(next.result.stop, 'Done');
    assert.deepEqual(plain(next.reports[0].refusedOperations.map((item) => item.reason)), ['Citation', 'Citation']);
    const state = ScribeReplay.run(next.log, orderOf(chosen));
    assert.deepEqual(plain(state.subjects.map((subject) => subject.label)), ['Frost']);
    assert.equal(state.scenes.length, 1);
    assert.equal(state.scenes[0].lastPosition, 4);
    assert.equal(state.scenes[0].summary, 'It rains');
    assert.equal(readCount(next.log, chosen), 4);
});

test('an empty stretch and an empty answer are both read', async () => {
    const log = ScribeLog.create();
    markRead(log, notedCampaign, 1, 5);
    markRead(log, notedCampaign, 7, 100);
    log.notes.push(laterNote);
    const lone = await adopt({ campaign: notedCampaign, log });
    assert.deepEqual(plain(lone.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(lone.calls), [['Notes', [6]]]);
    assert.equal(readCount(log, notedCampaign), 100);
    assert.deepEqual(plain(log.entries.at(-1)), {
        sequence: 4,
        kind: 'Update',
        origin: 'Story',
        messageIds: ['MESSAGE-6'],
        operations: [],
        withdrawn: false,
    });
    assert.deepEqual(plain(lone.saved.at(-1)), plain(log));
    /**
     * @param {{ pass: string, marks: number[] }} call
     * @param {number} index
     * @return {string}
     */
    const quiet = (call, index) => ['', 'none'][index - 1] ?? scripted(call);
    const run = await adopt({ answering: quiet });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passes(run.calls), [
        ['Story', [1, 40]],
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    assert.deepEqual(plain(run.log.entries.slice(0, 2).map((entry) => [entry.messageIds, entry.operations])), [
        [idsOf(plainCampaign, 1, 40), []],
        [idsOf(plainCampaign, 41, 80), []],
    ]);
    assert.equal(readCount(run.log, plainCampaign), 100);
    const state = ScribeReplay.run(run.log, orderOf(plainCampaign));
    assert.deepEqual(plain(state.facts.map((fact) => fact.text)), [
        'keeps watch from line 81',
        'counts coins to line 100',
    ]);
});

test('an unreadable answer is recorded and reported', async () => {
    /**
     * @param {{ pass: string, marks: number[] }} call
     * @param {number} index
     * @return {string}
     */
    const failing = (call, index) => (index === 2 ? prose : scripted(call));
    const run = await adopt({ answering: failing });
    assert.deepEqual(
        plain(run.result),
        ended('Failed', 'The answer for #41 to #80 held no line that could be read.', 0.5, 2),
    );
    assert.equal(readCount(run.log, plainCampaign), 40);
    assert.equal(run.log.entries.length, 1);
    assert.equal(run.saved.length, 1);
    assert.deepEqual(plain(run.log), run.saved[0]);
    assert.deepEqual(plain(run.records), [
        {
            sequence: 1,
            pass: 'Story',
            system: ScribeAnalyzer.Prompt,
            input: run.calls[0].user,
            answer: run.calls[0].answer,
            readable: true,
        },
        {
            sequence: null,
            pass: 'Story',
            system: ScribeAnalyzer.Prompt,
            input: run.calls[1].user,
            answer: prose,
            readable: false,
        },
    ]);
    assert.deepEqual(plain(run.reports[1]), {
        pass: 'Story',
        first: 41,
        last: 80,
        read: 40,
        total: 100,
        spent: 0.5,
        calls: 2,
        unpriced: 0,
        stored: 0,
        refusedLines: [{ block: 'PREAMBLE', line: prose, reason: 'Shape' }],
        refusedOperations: [],
    });
    const again = await adopt({ log: plain(run.saved[0]) });
    assert.deepEqual(plain(again.result), ended('Done', null, 0.5, 2));
    assert.deepEqual(passes(again.calls), [
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    const noted = await adopt({
        campaign: notedCampaign,
        answering: (call) => (call.pass === 'Notes' ? prose : scripted(call)),
    });
    assert.deepEqual(
        plain(noted.result),
        ended('Failed', 'The answer for the notes in #1 to #40 held no line that could be read.', 0.25, 1),
    );
    assert.deepEqual(plain(noted.log), plain(ScribeLog.create()));
    assert.deepEqual(noted.saved, []);
    assert.deepEqual(plain(noted.records.map((item) => [item.sequence, item.pass, item.readable])), [
        [null, 'Notes', false],
    ]);
    const log = await answeredLog();
    const kept = plain(log);
    const answers = await adopt({
        log,
        answering: (call) => (call.pass === 'Answers' ? prose : scripted(call)),
    });
    assert.deepEqual(
        plain(answers.result),
        ended('Failed', 'The answer for the answered questions held no line that could be read.', 0.25, 1),
    );
    assert.deepEqual(passes(answers.calls), [['Answers', [12]]]);
    assert.deepEqual(plain(log), kept);
    assert.deepEqual(answers.saved, []);
    assert.deepEqual(plain(answers.records.map((item) => [item.sequence, item.pass, item.readable])), [
        [null, 'Answers', false],
    ]);
});

test('a refusal that starts with none is unreadable', async () => {
    for (const refusal of [
        'None of this is something I am able to summarise for you.',
        'Nothing here can be processed: the text appears to be cut off.',
        'No new information can be extracted because the content violates policy.',
    ]) {
        const run = await adopt({ answering: (call, index) => (index === 1 ? refusal : scripted(call)) });
        assert.deepEqual(
            plain(run.result),
            ended('Failed', 'The answer for #1 to #40 held no line that could be read.', 0.25, 1),
            refusal,
        );
        assert.equal(readCount(run.log, plainCampaign), 0, refusal);
        assert.deepEqual(plain(run.records.map((item) => [item.answer, item.readable])), [[refusal, false]]);
    }
    const headers = [
        '=== SUBJECTS',
        '=== NAMES',
        '=== FACTS',
        '=== CHANGES',
        '=== TOLD',
        '=== SCENES',
        '=== NIGHTS',
        '=== THREADS',
        '=== QUESTIONS',
    ].join('\n');
    for (const empty of ['none', '(none)', 'No new facts.', headers]) {
        const run = await adopt({ answering: (call, index) => (index === 1 ? empty : scripted(call)) });
        assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3), empty);
        assert.deepEqual(plain(run.log.entries[0].messageIds), idsOf(plainCampaign, 1, 40), empty);
        assert.deepEqual(plain(run.log.entries[0].operations), [], empty);
        assert.equal(readCount(run.log, plainCampaign), 100, empty);
    }
});

test('pause stops between stretches', async () => {
    const run = await adopt({ pausing: (context) => context.reports.length >= 1 });
    assert.deepEqual(plain(run.result), ended('Paused', null, 0.25, 1));
    assert.equal(readCount(run.log, plainCampaign), 40);
    assert.deepEqual(plain(run.log), run.saved.at(-1));
    const rest = await adopt({ log: run.log });
    assert.deepEqual(plain(rest.result), ended('Done', null, 0.5, 2));
    assert.deepEqual(passes(rest.calls), [
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    assert.equal(readCount(run.log, plainCampaign), 100);
    const held = await adopt({ pausing: () => true });
    assert.deepEqual(plain(held.result), ended('Paused', null, 0, 0));
    assert.deepEqual(held.saved, []);
    assert.deepEqual(plain(held.log), plain(ScribeLog.create()));
});

test('a pause is honoured before every call', async () => {
    const run = await adopt({
        campaign: notedCampaign,
        pausing: (context) => context.calls.some((call) => call.pass === 'Notes'),
    });
    assert.deepEqual(plain(run.result), ended('Paused', null, 0.25, 1));
    assert.deepEqual(passes(run.calls), [['Notes', [6]]]);
    assert.equal(run.saved.length, 1);
    assert.deepEqual(plain(run.saved[0].notes), [firstNote]);
    assert.deepEqual(plain(run.saved[0].read), {});
    const rest = await adopt({ campaign: notedCampaign, log: plain(run.saved[0]) });
    assert.deepEqual(plain(rest.result), ended('Done', null, 1, 4));
    assert.deepEqual(passes(rest.calls), [
        ['Story', [1, 40]],
        ['Notes', [55]],
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    const log = await answeredLog();
    const kept = plain(log);
    const asked = await adopt({ log, pausing: (context) => context.pauses >= 2 });
    assert.deepEqual(plain(asked.result), ended('Paused', null, 0, 0));
    assert.deepEqual(asked.calls, []);
    assert.deepEqual(plain(log), kept);
});

test('the budget stops the run', async () => {
    const run = await adopt({ budget: 0.05, costing: () => 0.04 });
    assert.deepEqual(plain(run.result), ended('Budget', null, 0.08, 2));
    assert.equal(run.calls.length, 2);
    assert.equal(readCount(run.log, plainCampaign), 80);
    assert.deepEqual(plain(run.log), run.saved.at(-1));
    const unpriced = await adopt({ budget: 0.05, costing: (call, index) => (index === 2 ? null : 0.04) });
    assert.deepEqual(plain(unpriced.result), ended('Done', null, 0.08, 3, 1));
    assert.deepEqual(plain(unpriced.reports.map((report) => report.spent)), [0.04, 0.04, 0.08]);
    const spentAlready = await adopt({ budget: 0.05, spent: 0.05 });
    assert.deepEqual(plain(spentAlready.result), ended('Budget', null, 0.05, 0));
    assert.deepEqual(spentAlready.calls, []);
});

test('the budget guards every pass', async () => {
    const noted = await adopt({ campaign: notedCampaign, budget: 0 });
    assert.deepEqual(plain(noted.result), ended('Budget', null, 0, 0));
    assert.deepEqual(noted.calls, []);
    const log = await answeredLog();
    const kept = plain(log);
    const asked = await adopt({ log, budget: 0 });
    assert.deepEqual(plain(asked.result), ended('Budget', null, 0, 0));
    assert.deepEqual(plain(log), kept);
    const empty = ScribeLog.create();
    markRead(empty, notedCampaign, 1, 5);
    markRead(empty, notedCampaign, 7, 100);
    empty.notes.push(firstNote, laterNote);
    const lone = await adopt({ campaign: notedCampaign, log: empty, budget: 0 });
    assert.deepEqual(plain(lone.result), ended('Done', null, 0, 0));
    assert.equal(empty.read['MESSAGE-6'], 3);
    assert.equal(lone.saved.length, 1);
});

test('money is counted only when it has a price', async () => {
    for (const cost of [Number.NaN, -1, '1', undefined]) {
        const run = await adopt({ costing: (call, index) => (index === 2 ? cost : 0.25) });
        assert.deepEqual(plain(run.result), ended('Done', null, 0.5, 3, 1), String(cost));
        assert.deepEqual(
            plain(run.reports.map((report) => [report.spent, report.unpriced])),
            [
                [0.25, 0],
                [0.25, 1],
                [0.5, 1],
            ],
            String(cost),
        );
    }
    const free = await adopt({ costing: () => null });
    assert.deepEqual(plain(free.result), ended('Done', null, 0, 3, 3));
    for (const [name, value] of [
        ['budget', Number.NaN],
        ['spent', '1'],
    ]) {
        const { options, touched } = spied();
        const result = await ScribeAdoption.run({ ...options, [name]: value });
        const spent = name === 'spent' ? 0 : 0.5;
        assert.deepEqual(plain(result), ended('Failed', `${name} is not a finite number of at least 0.`, spent, 0));
        assert.deepEqual(touched, []);
    }
    const { options, touched } = spied();
    const { budget, ...unbudgeted } = options;
    assert.equal(budget, 1);
    assert.deepEqual(
        plain(await ScribeAdoption.run(unbudgeted)),
        ended('Failed', 'budget is not a finite number of at least 0.', 0.5, 0),
    );
    assert.deepEqual(touched, []);
});

test('a failed call applies nothing', async () => {
    /**
     * @param {{ pass: string, marks: number[] }} call
     * @param {number} index
     * @return {string}
     */
    const silent = (call, index) => {
        if (index === 2) {
            throw new Error('the model went quiet');
        }
        return scripted(call);
    };
    const run = await adopt({ answering: silent });
    assert.deepEqual(plain(run.result), ended('Failed', 'the model went quiet', 0.25, 2));
    assert.deepEqual(passes(run.calls), [
        ['Story', [1, 40]],
        ['Story', [41, 80]],
    ]);
    assert.equal(readCount(run.log, plainCampaign), 40);
    assert.equal(run.saved.length, 1);
    assert.deepEqual(plain(run.log), run.saved[0]);
    assert.equal(run.records.length, 1);
    assert.equal(run.reports.length, 1);
});

test('a call stopped by the operator is recorded before the call that answered, its cost unknown', async () => {
    const run = await adopt({ stopping: (call, index) => (index === 1 ? 1 : 0) });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 4, 1));
    assert.deepEqual(
        plain(run.records.map((item) => [item.sequence, item.pass, item.readable, item.stopped === true, item.answer])),
        [
            [null, 'Story', true, true, null],
            [1, 'Story', true, false, run.calls[0].answer],
            [2, 'Story', true, false, run.calls[1].answer],
            [3, 'Story', true, false, run.calls[2].answer],
        ],
    );
    assert.equal(run.records[0].input, run.calls[0].user);
    /**
     * @param {{ pass: string, marks: number[] }} call
     * @param {number} index
     * @return {string}
     */
    const quiet = (call, index) => {
        if (index === 2) {
            throw Object.assign(new Error('the model went quiet'), { stopped: 1 });
        }
        return scripted(call);
    };
    const failed = await adopt({ answering: quiet });
    assert.deepEqual(plain(failed.result), ended('Failed', 'the model went quiet', 0.25, 3, 1));
    assert.deepEqual(plain(failed.records.map((item) => [item.sequence, item.stopped === true])), [
        [1, false],
        [null, true],
    ]);
});

test('resume after a failed save reads the stretch once', async () => {
    /**
     * @param {number} count
     * @return {void}
     */
    const full = (count) => {
        if (count === 2) {
            throw new Error('the disk is full');
        }
    };
    const run = await adopt({ saving: full });
    assert.deepEqual(plain(run.result), ended('Failed', 'the disk is full', 0.5, 2));
    assert.equal(run.saved.length, 1);
    assert.equal(readCount(run.saved[0], plainCampaign), 40);
    const resumed = await adopt({ log: plain(run.saved[0]) });
    assert.deepEqual(plain(resumed.result), ended('Done', null, 0.5, 2));
    assert.deepEqual(passes(resumed.calls), [
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    const state = ScribeReplay.run(resumed.log, orderOf(plainCampaign));
    const texts = [
        'keeps watch from line 1',
        'counts coins to line 40',
        'keeps watch from line 41',
        'counts coins to line 80',
        'keeps watch from line 81',
        'counts coins to line 100',
    ];
    assert.deepEqual(texts.map((text) => timesSaid(state, text)), [1, 1, 1, 1, 1, 1]);
    assert.equal(state.facts.length, 6);
    assert.equal(readCount(resumed.log, plainCampaign), 100);
});

test('a step is saved before it is recorded', async () => {
    const run = await adopt();
    assert.deepEqual(run.events, [
        ...['ask', 'save', 'record', 'progress'],
        ...['ask', 'save', 'record', 'progress'],
        ...['ask', 'save', 'record', 'progress'],
    ]);
    const broken = await adopt({
        saving: (count) => {
            if (count === 2) {
                throw new Error('the disk is full');
            }
        },
    });
    assert.deepEqual(plain(broken.result), ended('Failed', 'the disk is full', 0.5, 2));
    assert.deepEqual(plain(broken.records.map((item) => item.sequence)), [1]);
    const resumed = await adopt({ log: plain(broken.saved[0]) });
    assert.deepEqual(plain([...broken.records, ...resumed.records].map((item) => item.sequence)), [1, 2, 3]);
    const unrecorded = await adopt({
        recording: (item) => {
            if (item.sequence === 2) {
                throw new Error('the record shelf is full');
            }
        },
    });
    assert.deepEqual(plain(unrecorded.result), ended('Failed', 'the record shelf is full', 0.5, 2));
    assert.equal(unrecorded.saved.length, 2);
    assert.equal(readCount(unrecorded.saved[1], plainCampaign), 80);
    const restarted = await adopt({ log: plain(unrecorded.saved[1]) });
    assert.deepEqual(plain(restarted.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(restarted.calls), [['Story', [81, 100]]]);
});

test('refused lines are reported and the rest applied', async () => {
    const malformed = 'Halvard | trait | #45';
    const outside = 'Halvard | trait | stern | #12';
    /**
     * @param {{ pass: string, marks: number[] }} call
     * @param {number} index
     * @return {string}
     */
    const mixed = (call, index) =>
        index === 2
            ? answer({
                  FACTS: [
                      malformed,
                      outside,
                      'Halvard | trait | patient with the ferry | #45',
                      'Mirelle | trait | fond of salt fish | #46',
                  ],
              })
            : scripted(call);
    const run = await adopt({ answering: mixed });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(plain(run.reports[1]), {
        pass: 'Story',
        first: 41,
        last: 80,
        read: 80,
        total: 100,
        spent: 0.5,
        calls: 2,
        unpriced: 0,
        stored: 2,
        refusedLines: [{ block: 'FACTS', line: malformed, reason: 'Shape' }],
        refusedOperations: [
            { operation: plain(ScribeAnswer.parse(answer({ FACTS: [outside] })).operations[0]), reason: 'Citation' },
        ],
    });
    const state = ScribeReplay.run(run.log, orderOf(plainCampaign));
    assert.equal(timesSaid(state, 'patient with the ferry'), 1);
    assert.equal(timesSaid(state, 'fond of salt fish'), 1);
    assert.equal(timesSaid(state, 'stern'), 0);
    assert.equal(readCount(run.log, plainCampaign), 100);
});

test('every call is recorded', async () => {
    /**
     * @param {{ pass: string, marks: number[] }} call
     * @return {string}
     */
    const padded = (call) => `\n${scripted(call)}\n\n`;
    const run = await adopt({ campaign: notedCampaign, answering: padded });
    assert.equal(run.calls.length, 5);
    assert.deepEqual(
        plain(run.records),
        run.calls.map((call, index) => ({
            sequence: index + 1,
            pass: call.pass,
            system: call.system,
            input: call.user,
            answer: call.answer,
            readable: true,
        })),
    );
    assert.deepEqual(plain(run.log.entries.map((entry) => [entry.sequence, entry.origin])), [
        [1, 'Notes'],
        [2, 'Story'],
        [3, 'Notes'],
        [4, 'Story'],
        [5, 'Story'],
    ]);
    const log = ScribeLog.create();
    markRead(log, notedCampaign, 1, 5);
    markRead(log, notedCampaign, 7, 100);
    log.notes.push(laterNote);
    const lone = await adopt({ campaign: notedCampaign, log, answering: padded });
    assert.equal(lone.calls.length, 1);
    assert.deepEqual(plain(lone.records), [
        {
            sequence: 3,
            pass: 'Notes',
            system: ScribeAnalyzer.NotesPrompt,
            input: lone.calls[0].user,
            answer: lone.calls[0].answer,
            readable: true,
        },
    ]);
    assert.deepEqual(plain(lone.reports.map((report) => report.pass)), ['Notes', 'Story']);
});

test('progress is reported after every step', async () => {
    const run = await adopt();
    assert.deepEqual(plain(run.reports), [
        {
            pass: 'Story',
            first: 1,
            last: 40,
            read: 40,
            total: 100,
            spent: 0.25,
            calls: 1,
            unpriced: 0,
            stored: 4,
            refusedLines: [],
            refusedOperations: [],
        },
        {
            pass: 'Story',
            first: 41,
            last: 80,
            read: 80,
            total: 100,
            spent: 0.5,
            calls: 2,
            unpriced: 0,
            stored: 2,
            refusedLines: [],
            refusedOperations: [],
        },
        {
            pass: 'Story',
            first: 81,
            last: 100,
            read: 100,
            total: 100,
            spent: 0.75,
            calls: 3,
            unpriced: 0,
            stored: 2,
            refusedLines: [],
            refusedOperations: [],
        },
    ]);
    assert.deepEqual(run.savesAtReport, [1, 2, 3]);
    const noted = await adopt({ campaign: notedCampaign, spent: 1 });
    assert.deepEqual(
        plain(noted.reports.map((report) => [report.pass, report.first, report.last, report.read, report.spent])),
        [
            ['Notes', 1, 40, 0, 1.25],
            ['Story', 1, 40, 40, 1.5],
            ['Notes', 41, 80, 40, 1.75],
            ['Story', 41, 80, 80, 2],
            ['Story', 81, 100, 100, 2.25],
        ],
    );
    assert.deepEqual(noted.savesAtReport, [1, 2, 3, 4, 5]);
});

test('progress counts what is read in this campaign', async () => {
    const run = await adopt();
    assert.deepEqual(plain(ScribeLog.withdraw(run.log, 'MESSAGE-90')), idsOf(plainCampaign, 81, 100));
    const shorter = campaign({}, [12]);
    const again = await adopt({ campaign: shorter, log: run.log });
    assert.deepEqual(plain(again.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(again.calls), [['Story', [80, 99]]]);
    assert.deepEqual(plain(again.reports.map((report) => [report.read, report.total])), [[99, 99]]);
    assert.equal(Object.hasOwn(run.log.read, 'MESSAGE-12'), true);
});

test('withdrawn messages are read again', async () => {
    const run = await adopt();
    assert.deepEqual(plain(ScribeLog.withdraw(run.log, 'MESSAGE-12')), idsOf(plainCampaign, 1, 40));
    assert.deepEqual(positionsOf(ScribeAdoption.next(run.log, plainCampaign.messages, 40)), numbers(1, 40));
    const again = await adopt({ log: run.log });
    assert.deepEqual(plain(again.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(again.calls), [['Story', [1, 40]]]);
    assert.deepEqual(
        plain(run.log.read),
        Object.fromEntries([
            ...idsOf(plainCampaign, 1, 40).map((id) => [id, 4]),
            ...idsOf(plainCampaign, 41, 80).map((id) => [id, 2]),
            ...idsOf(plainCampaign, 81, 100).map((id) => [id, 3]),
        ]),
    );
    const state = ScribeReplay.run(run.log, orderOf(plainCampaign));
    assert.equal(timesSaid(state, 'keeps watch from line 1'), 1);
    assert.equal(state.facts.length, 6);
});

test('reading an interior gap reports saved coverage across the entire room', async () => {
    const first = await adopt();
    ScribeLog.withdraw(first.log, 'MESSAGE-41');
    const second = await adopt({ log: first.log, readThrough: 80 });
    assert.deepEqual(passes(second.calls), [['Story', [41, 80]]]);
    assert.deepEqual(plain(second.reports.map(({ read, total }) => [read, total])), [[100, 100]]);
});

test('answered questions are filed and retired', async () => {
    const order = orderOf(plainCampaign);
    const log = await answeredLog();
    const read = plain(log.read);
    const before = ScribeReplay.run(log, order);
    const sequence = log.nextSequence;
    const second = await adopt({ log });
    assert.deepEqual(plain(second.result), ended('Done', null, 0.25, 1));
    assert.equal(second.calls[0].system, ScribeAnalyzer.AnswersPrompt);
    assert.equal(
        second.calls[0].user,
        ScribeAnalyzer.answersInput(before, 'Orla', before.questions.filter((question) => question.id === 'Q1')),
    );
    assert.deepEqual(passes(second.calls), [['Answers', [12]]]);
    assert.deepEqual(
        plain(log.entries.slice(-2).map((entry) => [entry.sequence, entry.kind, entry.origin, entry.messageIds])),
        [
            [sequence, 'Update', 'Answers', []],
            [sequence + 1, 'Operator', 'Operator', []],
        ],
    );
    assert.deepEqual(plain(log.entries.at(-1).operations), [
        { type: 'Dismiss', question: 'Q1', questionText: 'Does Mirelle trust Halvard?',
            passages: [{ id: 'MESSAGE-12', fingerprint: plainCampaign.messages[11].fingerprint }] },
    ]);
    assert.deepEqual(plain(log.read), read);
    assert.deepEqual(plain(log), second.saved.at(-1));
    const state = ScribeReplay.run(log, order);
    const filed = state.facts.filter((fact) => fact.text === 'settled by the answers at line 12');
    assert.deepEqual(plain(filed.map((fact) => [fact.origin, fact.cite, fact.position])), [
        ['Answers', 'MESSAGE-12', 12],
    ]);
    assert.deepEqual(plain(state.questions.map((question) => [question.id, question.answer, question.dismissed])), [
        ['Q1', 'She trusts him with the ledger', true],
        ['Q2', null, false],
        ['Q3', null, false],
    ]);
    assert.deepEqual(plain(second.records), [
        {
            sequence,
            pass: 'Answers',
            system: ScribeAnalyzer.AnswersPrompt,
            input: second.calls[0].user,
            answer: second.calls[0].answer,
            readable: true,
        },
    ]);
    assert.deepEqual(plain(second.reports), [
        {
            pass: 'Answers',
            first: null,
            last: null,
            read: 100,
            total: 100,
            spent: 0.25,
            calls: 1,
            unpriced: 0,
            stored: 1,
            refusedLines: [],
            refusedOperations: [],
        },
    ]);
    const third = await adopt({ log });
    assert.deepEqual(plain(third.result), ended('Done', null, 0, 0));
    reply(log, 'Q2', 'The miller rang it');
    reply(log, 'Q3', 'It is forged');
    const both = ScribeReplay.run(log, order);
    const fourth = await adopt({ log });
    assert.deepEqual(plain(fourth.result), ended('Done', null, 0.25, 1));
    assert.equal(
        fourth.calls[0].user,
        ScribeAnalyzer.answersInput(both, 'Orla', both.questions.filter((question) => question.id !== 'Q1')),
    );
    assert.deepEqual(passes(fourth.calls), [['Answers', [30, 35]]]);
    const after = ScribeReplay.run(log, order);
    assert.deepEqual(plain(after.questions.map((question) => question.dismissed)), [true, true, true]);
    assert.deepEqual(
        plain(after.facts.filter((fact) => fact.origin === 'Answers').map((fact) => [fact.text, fact.cite])),
        [
            ['settled by the answers at line 12', 'MESSAGE-12'],
            ['settled by the answers at line 30', 'MESSAGE-30'],
            ['settled by the answers at line 35', 'MESSAGE-35'],
        ],
    );
    assert.deepEqual(plain(log.read), read);
    const fifth = await adopt({ log });
    assert.deepEqual(plain(fifth.result), ended('Done', null, 0, 0));
});

test('the answers pass sends only what it was asked', async () => {
    const log = await answeredLog();
    const beside = 'Halvard | trait | wary of the bell | #13';
    const run = await adopt({
        log,
        answering: (call) =>
            call.pass === 'Answers'
                ? answer({ FACTS: ['Halvard | trait | sure of her at line 12 | #12', beside] })
                : scripted(call),
    });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(plain(run.reports[0].refusedOperations), [
        { operation: plain(ScribeAnswer.parse(answer({ FACTS: [beside] })).operations[0]), reason: 'Citation' },
    ]);
    assert.equal(run.reports[0].stored, 1);
    const state = ScribeReplay.run(log, orderOf(plainCampaign));
    assert.equal(timesSaid(state, 'sure of her at line 12'), 1);
    assert.equal(timesSaid(state, 'wary of the bell'), 0);
});

test('after the answers pass the loop starts again', async () => {
    const order = orderOf(plainCampaign);
    const first = await adopt({ answering: questioning, pausing: (context) => context.reports.length >= 1 });
    reply(first.log, 'Q1', 'She trusts him with the ledger');
    const run = await adopt({
        log: first.log,
        answering: (call) =>
            call.pass === 'Answers'
                ? answer({ FACTS: ['Kira | trait | rang the bell at line 12 | #12'] })
                : scripted(call),
    });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passes(run.calls), [
        ['Answers', [12]],
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    assert.equal(
        run.calls[1].user,
        ScribeAnalyzer.input(ScribeReplay.run(run.saved[0], order), 'Orla', stretchOf(plainCampaign, 41, 80)),
    );
    assert.equal(run.calls[1].user.includes('- Kira (character)'), true);
    assert.deepEqual(plain(run.log.entries.map((entry) => entry.origin)), [
        'Story',
        'Operator',
        'Answers',
        'Operator',
        'Story',
        'Story',
    ]);
    assert.equal(readCount(run.log, plainCampaign), 100);
});

test('a stale state is retried once', async () => {
    const first = await adopt({ answering: questioning, pausing: (context) => context.reports.length >= 1 });
    const log = first.log;
    let ruled = false;
    const run = await adopt({
        log,
        answering: (call) => {
            if (!ruled && call.pass === 'Story') {
                ruled = true;
                reply(log, 'Q2', 'The miller rang it');
            }
            return scripted(call);
        },
    });
    assert.equal(ruled, true);
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passes(run.calls), [
        ['Story', [41, 80]],
        ['Answers', [30]],
        ['Story', [81, 100]],
    ]);
    const stretchEntries = log.entries.filter((entry) => entry.messageIds.includes('MESSAGE-41'));
    assert.equal(stretchEntries.length, 1);
    assert.equal(run.records.filter((item) => item.sequence === stretchEntries[0].sequence).length, 1);
    assert.equal(run.records.length, 3);
    assert.equal(run.saved.length, 3);
    assert.equal(readCount(log, plainCampaign), 100);
});

test('a question whose message is gone is not asked about', async () => {
    const first = await adopt({ answering: questioning, pausing: (context) => context.reports.length >= 1 });
    const log = first.log;
    reply(log, 'Q1', 'She trusts him with the ledger');
    const shorter = campaign({}, [12]);
    const second = await adopt({ campaign: shorter, log });
    assert.deepEqual(plain(second.result), ended('Done', null, 0.5, 2));
    assert.deepEqual(passes(second.calls), [
        ['Story', [40, 79]],
        ['Story', [80, 99]],
    ]);
    assert.equal(readCount(log, shorter), 99);
    assert.equal(log.entries.some((entry) => entry.origin === 'Answers'), false);
    const state = ScribeReplay.run(log, orderOf(shorter));
    assert.deepEqual(plain(state.questions.map((question) => [question.id, question.dismissed])), [
        ['Q2', false],
        ['Q3', false],
    ]);
});

test('answers run even when every message is read', async () => {
    const log = await answeredLog();
    assert.deepEqual(plain(ScribeAdoption.next(log, plainCampaign.messages, 40)), []);
    const second = await adopt({ log });
    assert.deepEqual(plain(second.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(second.calls), [['Answers', [12]]]);
});

test('notes are known by their words', async () => {
    const run = await adopt({ campaign: notedCampaign });
    const shouted = campaign({
        6: '*(\nHALVARD served ten years, with the pikes!\n)*',
        50: 'I wave to the ferryman.',
        55: `I count the crates.\n*(\n${laterNote}\n)*`,
    });
    assert.deepEqual(plain(shouted.notes.map((note) => note.text)), [
        'HALVARD served ten years, with the pikes!',
        laterNote,
    ]);
    const entries = run.log.entries.length;
    const settled = await adopt({ campaign: shouted, log: run.log });
    assert.deepEqual(plain(settled.result), ended('Done', null, 0, 0));
    assert.equal(run.log.entries.length, entries);
    ScribeLog.withdraw(run.log, 'MESSAGE-3');
    const again = await adopt({ campaign: shouted, log: run.log });
    assert.deepEqual(passes(again.calls), [['Story', [1, 40]]]);
    assert.equal(run.log.entries.filter((entry) => entry.origin === 'Notes').length, 2);
});

test('no note is left behind', async () => {
    const behind = ScribeLog.create();
    markRead(behind, notedCampaign, 1, 40);
    const caught = await adopt({ campaign: notedCampaign, log: behind });
    assert.deepEqual(plain(caught.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passes(caught.calls), [
        ['Notes', [6, 55]],
        ['Story', [41, 80]],
        ['Story', [81, 100]],
    ]);
    assert.deepEqual(plain(behind.notes), [firstNote, laterNote]);
    const single = campaign({ 6: `*(\n${firstNote}\n)*` });
    const whole = ScribeLog.create();
    markRead(whole, single, 1, 100);
    const last = await adopt({ campaign: single, log: whole });
    assert.deepEqual(plain(last.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(last.calls), [['Notes', [6]]]);
    assert.deepEqual(plain(last.reports.map((report) => [report.pass, report.first, report.last])), [
        ['Notes', null, null],
    ]);
    assert.deepEqual(plain(whole.notes), [firstNote]);
    const stray = { ...plainCampaign, notes: [{ text: 'Kira hates the ferry.', position: 140 }] };
    const passed = await adopt({ campaign: stray });
    assert.deepEqual(plain(passed.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passed.calls.map((call) => call.pass), ['Story', 'Story', 'Story']);
    assert.deepEqual(plain(passed.log.notes), []);
});

test('the size given is the size used', async () => {
    const thirty = { ...plainCampaign, messages: plainCampaign.messages.slice(0, 30) };
    const run = await adopt({ campaign: thirty, size: 10 });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.deepEqual(passes(run.calls), [
        ['Story', [1, 10]],
        ['Story', [11, 20]],
        ['Story', [21, 30]],
    ]);
    for (const size of [undefined, '10', 0, 2.5]) {
        const { options, touched } = spied();
        const result = await ScribeAdoption.run({ ...options, size });
        assert.deepEqual(plain(result), ended('Failed', 'size is not a positive whole number.', 0.5, 0), String(size));
        assert.deepEqual(touched, []);
    }
});

test('every message id must be its own', async () => {
    const { options, touched } = spied();
    const twice = plainCampaign.messages.map((message) =>
        message.position === 6 ? { ...message, id: 'MESSAGE-3' } : message,
    );
    const result = await ScribeAdoption.run({ ...options, messages: twice });
    assert.deepEqual(plain(result), ended('Failed', 'Two messages share the id MESSAGE-3.', 0.5, 0));
    assert.deepEqual(touched, []);
    assert.deepEqual(plain(options.log), plain(ScribeLog.create()));
});

test('bad arguments stop before any call', async () => {
    const twice = [...plainCampaign.messages.slice(0, 3), plainCampaign.messages[0]];
    const cases = [
        [{ messages: 'all of them' }, 'messages is not a list.'],
        [{ messages: twice }, 'Two messages share the id MESSAGE-1.'],
        [{ readThrough: -1 }, 'readThrough is not a whole number within the message list.'],
        [{ readThrough: 1.5 }, 'readThrough is not a whole number within the message list.'],
        [{ readThrough: plainCampaign.messages.length + 1 }, 'readThrough is not a whole number within the message list.'],
        [{ notes: null }, 'notes is not a list.'],
        [{ atBudget: true }, 'atBudget is not a function.'],
        [{ player: 7 }, 'player is not a string.'],
        [{ profile: 7 }, 'profile is neither a string nor null.'],
        [{ profile: { text: 'Orla' } }, 'profile is neither a string nor null.'],
        [{ log: null }, 'log is not an object.'],
        [{ log: 'the book' }, 'log is not an object.'],
        [{ size: Number.POSITIVE_INFINITY }, 'size is not a positive whole number.'],
        [{ size: -40 }, 'size is not a positive whole number.'],
        [{ budget: -1 }, 'budget is not a finite number of at least 0.'],
        [{ budget: Number.POSITIVE_INFINITY }, 'budget is not a finite number of at least 0.'],
        [{ spent: -0.5 }, 'spent is not a finite number of at least 0.'],
        [{ spent: Number.NaN }, 'spent is not a finite number of at least 0.'],
        [{ ask: 'a model' }, 'ask is not a function.'],
        [{ save: undefined }, 'save is not a function.'],
        [{ record: null }, 'record is not a function.'],
        [{ progress: {} }, 'progress is not a function.'],
        [{ paused: false }, 'paused is not a function.'],
    ];
    for (const [bad, problem] of cases) {
        const { options, touched } = spied();
        const spent = Object.hasOwn(bad, 'spent') ? 0 : 0.5;
        const result = await ScribeAdoption.run({ ...options, ...bad });
        assert.deepEqual(plain(result), ended('Failed', problem, spent, 0), problem);
        assert.deepEqual(touched, [], problem);
        if (options.log !== null && typeof options.log === 'object') {
            assert.deepEqual(plain(options.log), plain(ScribeLog.create()), problem);
        }
    }
    for (const missing of [undefined, null, 'options']) {
        const result = await ScribeAdoption.run(missing);
        assert.deepEqual(plain(result), ended('Failed', 'The options are missing.', 0, 0), String(missing));
    }
    assert.deepEqual(plain(await ScribeAdoption.run({})), ended('Failed', 'messages is not a list.', 0, 0));
    await assert.doesNotReject(ScribeAdoption.run());
});

test('the chat profile goes to every story reading and to no other pass', async () => {
    const profile = 'Orla is a sellsword from the north.';
    const read = await adopt({ campaign: notedCampaign, profile });
    const passes = [...new Set(read.calls.map((call) => call.pass))].sort();
    assert.deepEqual(passes, ['Notes', 'Story']);
    for (const call of read.calls) {
        const carries = call.user.includes(`PLAYER CHARACTER:\nOrla\n\nPLAYER CHARACTER PROFILE:\n${profile}\n\nSUBJECTS:`);
        assert.equal(carries, call.pass === 'Story', call.pass);
    }
    const bare = await adopt({ campaign: notedCampaign });
    const empty = await adopt({ campaign: notedCampaign, profile: null });
    assert.deepEqual(
        bare.calls.map((call) => call.user),
        empty.calls.map((call) => call.user),
    );
    assert.equal(bare.calls.some((call) => call.user.includes('PLAYER CHARACTER PROFILE:')), false);
    assert.deepEqual(
        read.calls.map((call) => call.user.replace(`PLAYER CHARACTER PROFILE:\n${profile}\n\n`, '')),
        bare.calls.map((call) => call.user),
    );
});

test('callbacks may be asynchronous', async () => {
    const waiting = await adopt({
        pausing: async () => {
            await tick();
            return false;
        },
    });
    assert.deepEqual(plain(waiting.result), ended('Done', null, 0.75, 3));
    const rejecting = await adopt({
        reporting: async () => {
            await tick();
            throw new Error('the dial jammed');
        },
    });
    assert.deepEqual(plain(rejecting.result), ended('Failed', 'the dial jammed', 0.25, 1));
    const ordered = await adopt({
        saving: async (count, context) => {
            await tick();
            context.events.push('saved');
        },
        recording: async (item, context) => {
            await tick();
            context.events.push('recorded');
        },
    });
    assert.deepEqual(plain(ordered.result), ended('Done', null, 0.75, 3));
    const step = ['ask', 'save', 'saved', 'record', 'recorded', 'progress'];
    assert.deepEqual(ordered.events, [...step, ...step, ...step]);
});

test('run never rejects', async () => {
    const recorded = await adopt({
        recording: () => {
            throw new Error('the record shelf is full');
        },
    });
    assert.deepEqual(plain(recorded.result), ended('Failed', 'the record shelf is full', 0.25, 1));
    assert.equal(recorded.saved.length, 1);
    const reported = await adopt({
        reporting: () => {
            throw new Error('the progress bar broke');
        },
    });
    assert.deepEqual(plain(reported.result), ended('Failed', 'the progress bar broke', 0.25, 1));
    assert.equal(reported.saved.length, 1);
    const bare = await adopt({
        answering: () => {
            throw 'a bare complaint';
        },
    });
    assert.deepEqual(plain(bare.result), ended('Failed', 'a bare complaint', 0, 1));
});

const staffKept = {
    said: 'guarded the Staff of Tides for a thousand years',
    before: 'the Staff of Tides, held for two centuries',
    why: 'Two keepers and two spans for one staff',
};
const oathKept = {
    said: `...Sela's oath binds her to the "Tide Hall"...`,
    before: 'Sela has guarded the Staff of Tides',
    why: 'She is bound to the hall, not the staff',
};
const staffLines = [
    `#45 "${staffKept.said}" | F3 | ${staffKept.why}`,
    `#46 "${oathKept.said}" | #45 "${oathKept.before}" | ${oathKept.why}`,
    '#45 "guarded the Staff of Tides for ten years" | #5 "held the Staff of Tides" | The span differs',
    `#45 "${staffKept.said}" | #4 "${staffKept.before}" | The earlier words are in another message`,
    '#45 "uarded the Staff of Tides" | #5 "held the Staff of Tides" | A word cut in half',
    '#45 "Sela" | #5 "held the Staff of Tides" | One word is no quote',
    '#150 "guarded the Staff of Tides" | #5 "held the Staff of Tides" | No such message',
    '#5 "held the Staff of Tides for two centuries" | #4 "The tide bell rang" | Both before the stretch',
];

/**
 * @return {{ messages: readonly object[], notes: readonly object[], player: string }}
 */
function staffCampaign() {
    const builder = new CampaignBuilder('Orla');
    const written = {
        4: 'The tide bell rang at dusk over the harbour.',
        5: 'Old Brannoc has held the Sta​ff of Tides for two centuries, or so the harbour says.',
        45: 'Sela has guarded the Staff of Tides for a thousand years.',
        46: 'Sela’s oath binds her to the “Tide Hall” forever.',
    };
    for (let number = 1; number <= 100; number++) {
        builder.narrator(written[number] ?? `The tale goes on, line ${number}.`);
    }
    return ScribeIntake.read(builder.messages);
}

/**
 * @param {{ pass: string, marks: number[] }} call
 * @return {string}
 */
function staffAnswer(call) {
    if (call.pass === 'Story' && call.marks[0] === 1) {
        const held = answer({ SUBJECTS: ['Brannoc | character'], FACTS: [`Brannoc | belonging | ${staffKept.before} | #5`] });
        return `${scripted(call)}\n${held}`;
    }
    if (call.pass !== 'Story' || call.marks[0] !== 41) {
        return scripted(call);
    }
    return answer({
        SUBJECTS: ['Sela | character'],
        FACTS: ['Sela | trait | keeps a long vigil | #45'],
        CONTRADICTIONS: staffLines,
    });
}

/**
 * @param {object} run
 * @return {void}
 */
function assertStaffRead(run) {
    const parsed = ScribeAnswer.parse(answer({ CONTRADICTIONS: staffLines })).operations;
    const report = run.reports.find((item) => item.first === 41);
    assert.deepEqual(plain([report.pass, report.last, report.stored, report.refusedLines]), ['Story', 80, 4, []]);
    assert.deepEqual(plain(report.refusedOperations), [
        ...[2, 3, 4, 5].map((index) => ({ operation: plain(parsed[index]), reason: 'Quote' })),
        ...[6, 7].map((index) => ({ operation: plain(parsed[index]), reason: 'Citation' })),
    ]);
    const state = ScribeReplay.run(run.log, orderOf(staffCampaign()));
    assert.equal(timesSaid(state, 'keeps a long vigil'), 1);
    assert.deepEqual(plain(state.contradictions), [
        {
            id: JSON.stringify(['MESSAGE-45', 'MESSAGE-5', staffKept.said, staffKept.before]),
            cite: 'MESSAGE-45',
            position: 45,
            earlier: 'MESSAGE-5',
            earlierPosition: 5,
            ...staffKept,
            dismissed: false,
        },
        {
            id: JSON.stringify(['MESSAGE-46', 'MESSAGE-45', oathKept.said, oathKept.before]),
            cite: 'MESSAGE-46',
            position: 46,
            earlier: 'MESSAGE-45',
            earlierPosition: 45,
            ...oathKept,
            dismissed: false,
        },
    ]);
    const entry = run.log.entries.find((item) => item.messageIds.includes('MESSAGE-45') && !item.withdrawn);
    assert.deepEqual(plain(entry.operations.filter((operation) => operation.type === 'Contradiction')), [
        {
            type: 'Contradiction',
            cite: 'MESSAGE-45',
            position: 45,
            earlier: 'MESSAGE-5',
            earlierPosition: 5,
            ...staffKept,
        },
        {
            type: 'Contradiction',
            cite: 'MESSAGE-46',
            position: 46,
            earlier: 'MESSAGE-45',
            earlierPosition: 45,
            ...oathKept,
        },
    ]);
}

test('a contradiction is kept only when both quotes are in the cited messages', async () => {
    const chosen = staffCampaign();
    assert.equal(chosen.messages[4].text.includes('​'), true);
    const run = await adopt({ campaign: chosen, answering: staffAnswer });
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assert.equal(readCount(run.log, chosen), 100);
    assertStaffRead(run);
    assert.deepEqual(
        plain(run.reports.filter((item) => item.first !== 41).map((item) => item.refusedOperations)),
        [[], []],
    );
});

test('a kept contradiction survives the stale state retry', async () => {
    const chosen = staffCampaign();
    const order = orderOf(chosen);
    const log = ScribeLog.create();
    let ruled = false;
    const run = await adopt({
        campaign: chosen,
        log,
        answering: (call) => {
            if (!ruled && call.pass === 'Story' && call.marks[0] === 41) {
                ruled = true;
                ScribeLog.rule(log, ScribeReplay.run(log, order), {
                    type: 'AddFact',
                    subject: 'S1',
                    category: 'trait',
                    target: null,
                    text: 'hums while rowing',
                    hidden: false,
                    cite: null,
                    position: 0,
                });
            }
            return staffAnswer(call);
        },
    });
    assert.equal(ruled, true);
    assert.deepEqual(plain(run.result), ended('Done', null, 0.75, 3));
    assertStaffRead(run);
});

test('a contradiction can be dismissed and goes with its stretch', async () => {
    const chosen = staffCampaign();
    const order = orderOf(chosen);
    const run = await adopt({ campaign: chosen, answering: staffAnswer });
    const log = run.log;
    const before = ScribeReplay.run(log, order);
    const [staff, oath] = before.contradictions;
    const ruling = ScribeLog.rule(log, before, { type: 'DismissContradiction', contradiction: staff.id });
    assert.deepEqual(plain(ruling.operations), [
        {
            type: 'DismissContradiction',
            contradiction: staff.id,
            said: 'guarded the Staff of Tides for a thousand years',
            before: staffKept.before,
        },
    ]);
    /**
     * @return {Array<[string, boolean]>}
     */
    const marks = () => plain(ScribeReplay.run(log, order).contradictions.map((item) => [item.id, item.dismissed]));
    assert.deepEqual(marks(), [
        [staff.id, true],
        [oath.id, false],
    ]);
    const dismissed = ScribeReplay.run(log, order);
    assert.throws(
        () => ScribeLog.rule(log, dismissed, { type: 'DismissContradiction', contradiction: `${staff.id} ` }),
        { message: 'Reference' },
    );
    for (const contradiction of [undefined, null, 4, [staff.id], { id: staff.id }]) {
        assert.throws(
            () => ScribeLog.rule(log, dismissed, { type: 'DismissContradiction', contradiction }),
            { message: 'InvalidOperation' },
            String(contradiction),
        );
    }
    assert.deepEqual(plain(ScribeLog.withdraw(log, 'MESSAGE-45')), idsOf(chosen, 41, 80));
    const withdrawn = ScribeReplay.run(log, order);
    assert.deepEqual(plain(withdrawn.contradictions), []);
    assert.throws(
        () => ScribeLog.rule(log, withdrawn, { type: 'DismissContradiction', contradiction: oath.id }),
        { message: 'Reference' },
    );
    const again = await adopt({ campaign: chosen, log, answering: staffAnswer });
    assert.deepEqual(plain(again.result), ended('Done', null, 0.25, 1));
    assert.deepEqual(passes(again.calls), [['Story', [41, 80]]]);
    assert.deepEqual(marks(), [
        [staff.id, true],
        [oath.id, false],
    ]);
    assert.equal(ScribeLog.revoke(log, ruling.sequence), ruling);
    assert.deepEqual(marks(), [
        [staff.id, false],
        [oath.id, false],
    ]);
});

test("the operator's Staff shape: new words against an ended entry from an earlier stretch are kept", async () => {
    const chosen = staffCampaign();
    const said = 'guarded the Staff of Tides for a thousand years';
    const why = 'Two keepers and two spans for one staff';
    const run = await adopt({
        campaign: chosen,
        size: 20,
        /**
         * @param {{ pass: string, marks: number[] }} call
         * @return {string}
         */
        answering: (call) => {
            if (call.pass !== 'Story') {
                return scripted(call);
            }
            const first = call.marks[0];
            if (first === 1) {
                return answer({
                    SUBJECTS: ['Brannoc | character'],
                    FACTS: [`Brannoc | belonging | ${staffKept.before} | #5`, 'Brannoc | eyes | grey | #10'],
                    THREADS: ['OPEN | who will guard the Staff of Tides | #3'],
                });
            }
            if (first === 21) {
                return answer({
                    CHANGES: ['F1 | Brannoc | belonging | ENDED: he left it at the tide hall | #30'],
                    THREADS: ['CLOSE T1 | Brannoc keeps the Staff of Tides for good | #31'],
                });
            }
            if (first === 41) {
                return answer({
                    CONTRADICTIONS: [
                        `#45 "${said}" | f1 | ${why}`,
                        '#45 "guarded the Staff of Tides" | F9 | No such entry',
                        '#45 "carried the Staff of Tides" | F1 | Words the message does not hold',
                        `#45 "${said}" | F2 | The eye colour has nothing to do with it`,
                        '#45 "Sela has guarded" | F1 (#5) | Two common words are not enough',
                        `#45 "${said}" | "T1." | The closed thread said Brannoc keeps it`,
                    ],
                });
            }
            return '=== FACTS';
        },
    });
    assert.equal(run.result.stop, 'Done');
    const state = ScribeReplay.run(run.log, orderOf(chosen));
    assert.equal(state.facts.find((fact) => fact.id === 'F1').status, 'Ended');
    const closing = 'Brannoc keeps the Staff of Tides for good';
    assert.deepEqual(
        plain(state.contradictions.map((item) => [item.position, item.earlierPosition, item.before])),
        [
            [45, 5, staffKept.before],
            [45, 31, closing],
        ],
    );
    assert.deepEqual(plain(state.contradictions[0]), {
        id: JSON.stringify(['MESSAGE-45', 'MESSAGE-5', said, staffKept.before]),
        cite: 'MESSAGE-45',
        position: 45,
        earlier: 'MESSAGE-5',
        earlierPosition: 5,
        said,
        before: staffKept.before,
        why,
        dismissed: false,
    });
    const report = run.reports.find((item) => item.first === 41);
    assert.deepEqual(
        plain(report.refusedOperations.map((entry) => [entry.operation.entry, entry.reason])),
        [
            ['F9', 'Reference'],
            ['F1', 'Quote'],
            ['F2', 'Mismatch'],
            ['F1', 'Mismatch'],
        ],
    );
});

test('the notes and answers passes keep no contradiction', async () => {
    const noteLine = '#55 "I count the crates" | #2 "I answer the ferryman" | Crates or the ferryman';
    const noted = await adopt({
        campaign: notedCampaign,
        answering: (call) =>
            call.pass === 'Notes' && call.marks[0] === 55
                ? `${scripted(call)}\n${answer({ CONTRADICTIONS: [noteLine] })}`
                : scripted(call),
    });
    assert.deepEqual(plain(noted.result), ended('Done', null, 1.25, 5));
    const notesReport = noted.reports.find((report) => report.pass === 'Notes' && report.first === 41);
    const [noteOperation] = ScribeAnswer.parse(answer({ CONTRADICTIONS: [noteLine] })).operations;
    assert.deepEqual(plain(notesReport.refusedOperations), [{ operation: plain(noteOperation), reason: 'Citation' }]);
    assert.deepEqual(plain(ScribeReplay.run(noted.log, orderOf(notedCampaign)).contradictions), []);
    const log = await answeredLog();
    const answersLine = '#12 "I answer the ferryman" | #2 "I answer the ferryman" | Said twice';
    const answered = await adopt({
        log,
        answering: (call) => (call.pass === 'Answers' ? answer({ CONTRADICTIONS: [answersLine] }) : scripted(call)),
    });
    assert.deepEqual(plain(answered.result), ended('Done', null, 0.25, 1));
    const [answersOperation] = ScribeAnswer.parse(answer({ CONTRADICTIONS: [answersLine] })).operations;
    assert.deepEqual(plain(answered.reports[0].refusedOperations), [
        { operation: plain(answersOperation), reason: 'Citation' },
    ]);
    assert.equal(answered.reports[0].stored, 0);
    assert.deepEqual(plain(ScribeReplay.run(log, orderOf(plainCampaign)).contradictions), []);
});
