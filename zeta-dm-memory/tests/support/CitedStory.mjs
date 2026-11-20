export default class CitedStory {
    /**
     * @param {string} input
     * @return {Map<number, object[]>}
     */
    static messages(input) {
        const transcript = input.split(/NEW MESSAGES \(#\d+ to #\d+\):\n/).at(-1);
        const messages = new Map();
        let blocks;
        for (const line of transcript.split('\n')) {
            const start = /^\[#(\d+)\] (.*)$/.exec(line);
            if (start) {
                blocks = [];
                messages.set(Number(start[1]), blocks);
            }
            if (start || line.startsWith('[block ')) {
                const block = /^(?:\[block (\d+)\] )?([^:]+): (.+)$/.exec(start ? start[2] : line);
                if (block) {
                    blocks.push({ blockNumber: Number(block[1] ?? 1), quote: block[3] });
                }
            }
        }
        return messages;
    }

    /**
     * @param {string} input
     * @param {string} rows
     * @param {number[]} subjects
     * @return {string}
     */
    static answer(input, rows, subjects = []) {
        const messages = CitedStory.messages(input);
        const read = new Set();
        const evidence = [];
        const counts = new Map();
        let section;
        for (const line of rows.split('\n')) {
            if (line.startsWith('=== ')) {
                section = line.slice(4);
                continue;
            }
            if (line.trim().length === 0) {
                continue;
            }
            const row = (counts.get(section) ?? 0) + 1;
            counts.set(section, row);
            let messageNumber = Number(/#(\d+)/.exec(line)?.[1]);
            if (section === 'SUBJECTS') {
                messageNumber = subjects[row - 1];
            } else if (section === 'SCENES') {
                messageNumber = Number(/#\d+\s*-\s*#(\d+)/.exec(line)?.[1]);
            }
            const blocks = messages.get(messageNumber) ?? [];
            const point = line.split(' | ')[section === 'CHANGES' ? 3 : 2];
            const block = blocks.find((source) => point && source.quote.includes(point)) ?? blocks[0];
            if (!block) {
                throw new Error('Missing source block for ' + section + ' row ' + row + ' in fixture: ' + line);
            }
            read.add(messageNumber);
            evidence.push(JSON.stringify({
                section, row, messageNumber, ...block, attribution: 'witnessed', form: null, dimension: null,
            }));
        }
        return [rows, '=== EVIDENCE', ...evidence, '=== READ',
            ...[...messages.keys()].map((number) => '#' + number + (read.has(number) ? ' | read' : ' | no change')),
        ].join('\n');
    }
}
