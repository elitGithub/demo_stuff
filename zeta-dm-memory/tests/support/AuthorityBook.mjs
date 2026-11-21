import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import CampaignBuilder from './CampaignBuilder.mjs';

const bundle = readFileSync(new URL('../../scribe/scribe.user.js', import.meta.url), 'utf8');
const start = bundle.indexOf('/** @file scribe/page/ScribeStart.js */');
assert.ok(start > 0);
export const { ScribeIntake, ScribeLog, ScribeAnswer, ScribeReplay, ScribeAnalyzer, ScribePedant, ScribeKnowledge } =
    vm.runInNewContext(bundle.slice(0, start) +
        'return {ScribeIntake,ScribeLog,ScribeAnswer,ScribeReplay,ScribeAnalyzer,ScribePedant,ScribeKnowledge};})();', { TextEncoder });
export const plain = (value) => JSON.parse(JSON.stringify(value));

export function room(lines) {
    const builder = new CampaignBuilder('Orla');
    for (const line of lines) {
        builder.narrator(line);
    }
    const messages = ScribeIntake.read(builder.messages).messages;
    const order = messages.map((message) => message.id);
    const prints = new Map(messages.map((message) => [message.id, message.fingerprint]));
    const book = { log: ScribeLog.create(), fingerprints: Object.fromEntries(prints) };
    const state = () => ScribeReplay.run(plain(book.log), order, null, prints, null, null, messages);
    const file = (text, slice, evidence = []) => {
        const parsed = ScribeAnswer.parse(text);
        assert.deepEqual(plain(parsed.refused), []);
        const operations = parsed.operations.map((operation, index) => {
            const message = messages[operation.position - 1];
            return evidence[index] ? { ...operation, evidence: { messageId: message.id, fingerprint: message.fingerprint,
                messageNumber: message.position, blockNumber: 1, speaker: message.blocks[0].speaker,
                quote: message.blocks[0].text, ...evidence[index] } } : operation;
        });
        const result = ScribeLog.append(book.log, state(), operations, { messages: slice, origin: 'Story' });
        assert.deepEqual(plain(result.refused), []);
        return result.entry;
    };
    return { messages, book, state, file };
}
