const ScribeFork = Object.freeze({
    PlayerActions: Object.freeze(['Merge', 'Distinct', 'Split', 'Unalias', 'DismissContradiction']),
    /**
     * @param {*} left
     * @param {*} right
     * @return {boolean}
     */
    equal(left, right) {
        if (left === right) {
            return true;
        }
        if (!left || !right || typeof left !== 'object' || typeof right !== 'object' ||
            Array.isArray(left) !== Array.isArray(right)) {
            return false;
        }
        const keys = Object.keys(left);
        return keys.length === Object.keys(right).length && keys.every((key) =>
            Object.hasOwn(right, key) && ScribeFork.equal(left[key], right[key]));
    },

    /**
     * @param {object} entry
     * @param {Map} mapping
     * @param {Set} originals
     * @return {{entry: object, anchored: boolean}|null}
     */
    translate(entry, mapping, originals) {
        let supported = true;
        let anchored = false;
        const references = ['cite', 'earlierCite', 'first', 'last', 'messageId', 'sourceId', 'earlier',
            'scene', 'sceneId', 'messageIds', 'retrySources', 'retired', 'id', 'after', 'reviewAt', 'message'];
        const encoded = ['scene', 'sceneId', 'filedInputs', 'pendingInputs'];
        const visit = (value, key) => {
            if (Array.isArray(value)) {
                return value.map((item) => visit(item, key));
            }
            if (value && typeof value === 'object') {
                const fields = Object.fromEntries(Object.entries(value).map(([name, item]) => [
                    name, value.type === ScribeLog.Ruling.Distinct && name === 'first' ? item : visit(item, name),
                ]));
                if (key === 'record' && typeof value.text === 'string') {
                    const prefix = 'Filed citation: ';
                    fields.text = value.text.split('\n').map((line) => {
                        if (!line.startsWith(prefix) && !line.startsWith('{')) {
                            return line;
                        }
                        const label = line.startsWith(prefix) ? prefix : '';
                        let payload;
                        try {
                            payload = JSON.parse(line.slice(label.length));
                        } catch {
                            return line;
                        }
                        return label + JSON.stringify(visit(payload, ''));
                    }).join('\n');
                }
                return fields;
            }
            if (typeof value !== 'string') {
                return value;
            }
            if (key === 'contradiction' && value.startsWith('[')) {
                let tuple;
                try {
                    tuple = JSON.parse(value);
                } catch {
                    supported = false;
                    return value;
                }
                if (!Array.isArray(tuple) || tuple.length !== 4) {
                    supported = false;
                    return value;
                }
                return JSON.stringify([visit(tuple[0], 'messageId'), visit(tuple[1], 'messageId'), tuple[2], tuple[3]]);
            }
            if (encoded.includes(key) && value.startsWith('[')) {
                let tuple;
                try {
                    tuple = JSON.parse(value);
                } catch {
                    return value;
                }
                if (!Array.isArray(tuple) || !tuple.length) {
                    supported = false;
                    return value;
                }
                return JSON.stringify([visit(tuple[0], 'messageId'), ...tuple.slice(1)]);
            }
            if (!references.includes(key) || !originals.has(value)) {
                if (['messageIds', 'cite', 'messageId', 'sourceId', 'retrySources', 'retired', 'first', 'last'].includes(key)) {
                    supported = false;
                }
                return value;
            }
            if (!mapping.has(value)) {
                supported = false;
                return value;
            }
            anchored = true;
            return mapping.get(value).id;
        };
        const translated = visit(entry, '');
        return supported ? {entry: translated, anchored} : null;
    },

    /**
     * @param {object} operation
     * @param {object} state
     * @param {Map} originals
     * @return {boolean}
     */
    supportedRuling(operation, state, originals) {
        const ruling = ScribeLog.Ruling;
        if (operation.type === ruling.Narrow) {
            return state.scenes.some((scene) => scene.id === operation.scene);
        }
        if ([ruling.Answer, ruling.Dismiss].includes(operation.type)) {
            return state.questions.some((question) => question.id === operation.question);
        }
        if (operation.type === ruling.Pin && !operation.cite && !operation.winner) {
            const matches = state.conflicts.filter((issue) => issue.subject === operation.subject &&
                issue.category === operation.category && issue.target === operation.target && ScribeCategory.sameScope(issue, operation));
            if (!matches.length && !operation.form && !operation.dimension) {
                const slot = state.facts.filter((fact) => fact.subject === operation.subject &&
                    fact.category === operation.category && fact.target === operation.target &&
                    [ScribeReplay.Status.InForce, ScribeReplay.Status.Disputed].includes(fact.status));
                return slot.length === 2 && slot.every((fact) => originals.has(fact.cite)) &&
                    !ScribeCategory.sameScope(slot[0], slot[1]);
            }
            if (matches.length !== 1 || !matches[0].established || !matches[0].others.length) {
                return false;
            }
            const disputed = [matches[0].established, ...matches[0].others];
            return disputed.every((id) => state.facts.some((fact) => fact.id === id && originals.has(fact.cite)));
        }
        if (operation.winner || operation.source?.fact || operation.fact) {
            return state.facts.some((fact) => fact.id === (operation.winner ?? operation.source?.fact ?? operation.fact) &&
                originals.has(fact.cite));
        }
        if (operation.subject && operation.other) {
            return [operation.subject, operation.other].every((id) => state.subjects.some((subject) => subject.id === id));
        }
        return false;
    },

    /**
     * @param {object} original
     * @param {object} operation
     * @param {object} parent
     * @param {object} child
     * @param {Map} mapping
     * @param {Set} originals
     * @return {boolean}
     */
    supportedAction(original, operation, parent, child, mapping, originals) {
        const ruling = ScribeLog.Ruling;
        const same = (before, after) => {
            const moved = before && ScribeFork.translate(before, mapping, originals);
            return Boolean(after && moved && ScribeFork.equal(moved.entry, after));
        };
        const subject = (id) => same(parent.subjects.find((row) => row.id === id), child.subjects.find((row) => row.id === id));
        if (operation.type === ruling.Merge || operation.type === ruling.Distinct) {
            const pair = operation.type === ruling.Merge ? [operation.from, operation.into] : [operation.first, operation.second];
            return pair.every(subject);
        }
        if (operation.type === ruling.Split) {
            return subject(operation.subject) && !child.subjects.some((row) => row.id === operation.becomes) &&
                Array.isArray(operation.facts) && operation.facts.every((id) =>
                    same(parent.facts.find((row) => row.id === id), child.facts.find((row) => row.id === id)));
        }
        if (operation.type === ruling.Unalias) {
            const aliases = (state) => {
                const owner = ScribeLog.root(ScribeLog.view(state), operation.subject);
                return state.aliases.filter((alias) => alias.subject === owner &&
                    alias.name.toLowerCase() === operation.name.toLowerCase());
            };
            const originalAliases = aliases(parent);
            return originalAliases.length > 0 && same(originalAliases, aliases(child));
        }
        const contradiction = parent.contradictions.find((row) => row.id === original.contradiction);
        return same(contradiction && {...contradiction, id: operation.contradiction},
            child.contradictions.find((row) => row.id === operation.contradiction));
    },

    /**
     * @param {object} source
     * @param {object} destination
     * @param {number} bytes
     * @param {Set} required
     * @return {Map}
     * @throws {Error}
     */
    comparisonMap(source, destination, bytes, required) {
        const map = new Map();
        const unsupported = 'A paid Checker comparison could not be matched to the same fork passages.';
        const match = (before, after) => {
            for (const [index, page] of before.entries()) {
                const nested = [...required].some((id) => id.startsWith(page.id + '/'));
                if (!nested && !required.has(page.id)) {
                    continue;
                }
                const next = after[index];
                if (!next || !ScribeFork.equal({...JSON.parse(page.input), page: next.id}, JSON.parse(next.input))) {
                    throw new Error(unsupported);
                }
                map.set(page.id, {before: page, after: next});
                if (nested) {
                    match(ScribePedant.divideComparison(page), ScribePedant.divideComparison(next));
                }
            }
        };
        match([...ScribePedant.passagePages({...source, pageBytes: bytes})],
            [...ScribePedant.passagePages({...destination, pageBytes: bytes})]);
        if ([...required].some((id) => !map.has(id))) {
            throw new Error(unsupported);
        }
        return map;
    },

    /**
     * @param {string} text
     * @param {string} previous
     * @param {string} next
     * @return {string}
     */
    answerPage(text, previous, next) {
        let answer;
        try {
            answer = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n|\n```$/gi, ''));
        } catch {
            return text;
        }
        return answer?.page === previous ? JSON.stringify({...answer, page: next}) : text;
    },

    /**
     * @param {object} work
     * @return {Promise<object>}
     * @throws {Error}
     */
    async incomingPacket(work) {
        const captured = {};
        try {
            await ScribePedant.incoming({...work, ask: (system, input, positions, id) => {
                Object.assign(captured, {id, input});
                throw captured;
            }});
        } catch (error) {
            if (error !== captured) {
                throw error;
            }
        }
        return captured;
    },

    /**
     * @param {object} result
     * @param {object} sourceBook
     * @param {object[]} messages
     * @return {Promise<void>}
     * @throws {Error}
     */
    async requests(result, sourceBook, messages) {
        const {book, sourceIntake, mapping} = result;
        for (const [id, request] of Object.entries(sourceBook.log.checkRequests ?? {})) {
            const row = mapping.get(request.messageId);
            if (!row || !book.log.read[row.id]) {
                continue;
            }
            if (request.fingerprint !== undefined && (request.fingerprint !== row.fingerprint ||
                (request.projection ?? null) !== (row.projection ?? null))) {
                continue;
            }
            const legacy = !request.version?.startsWith('incoming-');
            const source = legacy ? ScribeLog.checkWork(sourceBook, sourceIntake, true, null, true, request.messageId) :
                ScribeLog.checkWork(sourceBook, sourceIntake, true, request.messageId);
            const next = legacy ? ScribeLog.checkWork(book, messages, true, null, true, row.id) :
                ScribeLog.checkWork(book, messages, true, row.id);
            let before;
            let after;
            if (legacy) {
                const pair = ScribeFork.comparisonMap(source, next, request.planBytes, new Set([id])).get(id);
                before = pair.before;
                after = pair.after;
            } else {
                before = await ScribeFork.incomingPacket(source);
                after = await ScribeFork.incomingPacket(next);
            }
            if (source.version !== request.version || before.id !== id ||
                (request.inputStamp && request.inputStamp !== ScribeText.fingerprint(before.input)) ||
                !ScribeFork.equal({...JSON.parse(before.input), page: after.id}, JSON.parse(after.input))) {
                throw new Error('The dispatched Checker request could not be verified against its original input.');
            }
            const moved = {...request, messageId: row.id, version: next.version, inputStamp: ScribeText.fingerprint(after.input)};
            if (request.reply) {
                moved.reply = {...request.reply, text: ScribeFork.answerPage(request.reply.text, id, after.id)};
            }
            (book.log.checkRequests ??= {})[after.id] = moved;
        }
    },

    /**
     * @param {object} source
     * @param {object[]} messages
     * @param {object} intake
     * @param {string} sourceRoomId
     * @param {string} roomId
     * @param {string|null} selected
     * @param {object|null} current
     * @return {{book: object, shared: number, read: number, mapping: Map, sourceIntake: object[]}}
     * @throws {Error}
     */
    stage(source, messages, intake, sourceRoomId, roomId, selected, current) {
        const parent = source.messages;
        const saved = source.book;
        if (roomId === sourceRoomId || !ScribeKeeper.soundBook(saved) || !saved.adopted ||
            !ScribeKeeper.replaceableForkBook(current)) {
            throw new Error('Fork recovery needs an adopted source Book and a fork without independent Book changes.');
        }
        for (const [rows, room] of [[parent, sourceRoomId], [messages, roomId]]) {
            if (!Array.isArray(rows) || !rows.length || rows.some((row) => !row || row.roomId !== room ||
                typeof row.id !== 'string' || !row.id || !Number.isFinite(Date.parse(row.messageTime)) ||
                !row.sender?.type || !Array.isArray(row.contents)) || new Set(rows.map((row) => row.id)).size !== rows.length) {
                throw new Error('The original messages for both rooms are needed to verify the fork.');
            }
        }
        const originals = new Set(parent.map((row) => row.id));
        const mapping = new Map();
        let played = false;
        let boundary = null;
        for (const [index, before] of parent.entries()) {
            const after = messages[index];
            if (!after || before.messageTime !== after.messageTime || !ScribeFork.equal(before.sender, after.sender) ||
                !ScribeFork.equal(before.contents, after.contents) || (before.candidateId && after.candidateId &&
                    before.candidateId !== after.candidateId)) {
                break;
            }
            mapping.set(before.id, intake.messages[index]);
            boundary = before.id;
            played ||= before.isIntro === false && after.isIntro === false;
            if (selected && selected === before.id) {
                break;
            }
        }
        if (!mapping.size || (selected ? !mapping.has(selected) : !played)) {
            throw new Error('The original messages do not verify this fork through the selected passage.');
        }
        const log = ScribeLog.create();
        for (const key of Object.keys(log).filter((name) => typeof log[name] === 'number')) {
            log[key] = saved.log[key];
        }
        const book = {log, fingerprints: {}, adopted: true, fork: {sourceRoomId,
            sourceMessageId: boundary, messageId: mapping.get(boundary).id}};
        const originalsByChild = new Map([...mapping.values()].map((row) => [row.id, row]));
        const credited = new Set();
        const childIds = intake.messages.map((row) => row.id);
        const fingerprints = new Map(intake.messages.map((row) => [row.id, row.fingerprint]));
        const sourceIntake = intake.messages.slice(0, mapping.size).map((row, index) => ({...row, id: parent[index].id}));
        let contiguous = true;
        for (const entry of saved.log.entries) {
            if (entry.withdrawn) {
                continue;
            }
            const story = entry.origin === ScribeLog.Origin.Story;
            const valid = (id) => {
                const row = mapping.get(id);
                return row && !row.attributionPending && saved.fingerprints[id] === row.fingerprint &&
                    (saved.projections?.[id] ?? null) === (row.projection ?? null);
            };
            if (story && (!entry.messageIds.length || !entry.messageIds.every(valid))) {
                contiguous = false;
                continue;
            }
            const moved = ScribeFork.translate(entry, mapping, originals);
            if (!moved) {
                contiguous = false;
                continue;
            }
            if (entry.origin === ScribeLog.Origin.Checker) {
                const old = entry.check;
                const row = mapping.get(old?.messageId);
                const originalPages = [...old?.pages ?? [], ...old?.segments ?? [], ...old?.priorPages ?? []];
                if (!row || !originalPages.length || !credited.has(row.id) ||
                    !originalPages.every((page) => page.seal === ScribeLog.checkSeal(page) &&
                        ScribeLog.validCheckPage(page, sourceIntake[row.position - 1], sourceIntake))) {
                    continue;
                }
                const receipt = moved.entry.check;
                const versionArgs = [row.id, row.fingerprint, row.projection ?? null];
                const pageArgs = row.projection == null ? versionArgs.slice(0, 2) : versionArgs;
                if (old.targeted) {
                    const sourceVersion = 'incoming-' + ScribeText.fingerprint(JSON.stringify([old.messageId, ...versionArgs.slice(1)]));
                    const sourcePage = 'incoming-' + ScribeText.fingerprint(JSON.stringify([old.messageId, ...pageArgs.slice(1)])) + ':0';
                    if (old.version !== sourceVersion || old.pages.length !== 1 || old.pages[0].id !== sourcePage) {
                        continue;
                    }
                    receipt.version = 'incoming-' + ScribeText.fingerprint(JSON.stringify(versionArgs));
                    const pageId = 'incoming-' + ScribeText.fingerprint(JSON.stringify(pageArgs)) + ':0';
                    for (const page of receipt.pages) {
                        const answer = JSON.parse(page.answer);
                        page.id = pageId;
                        page.answer = JSON.stringify({...answer, page: pageId});
                    }
                } else {
                    const original = ScribeLog.checkWork(saved, sourceIntake, true, null, true, old.messageId);
                    if (original.version !== old.version) {
                        throw new Error('The source Book could not verify its saved Checker comparison.');
                    }
                    const next = ScribeLog.checkWork(book, intake.messages, true, null, true, row.id);
                    receipt.version = next.version;
                    if (old.segments?.length || old.priorPages?.length || old.pages?.length !== old.pages?.[0]?.total) {
                        const map = ScribeFork.comparisonMap(original, next, originalPages[0].planBytes,
                            new Set(originalPages.map((page) => page.id)));
                        for (const page of [...receipt.pages ?? [], ...receipt.segments ?? [], ...receipt.priorPages ?? []]) {
                            const nextId = map.get(page.id).after.id;
                            page.answer = ScribeFork.answerPage(page.answer, page.id, nextId);
                            if (page.parentId) {
                                page.parentId = map.get(page.parentId).after.id;
                            }
                            page.id = nextId;
                        }
                    }
                }
                const translatedPages = [...receipt.pages ?? [], ...receipt.segments ?? [], ...receipt.priorPages ?? []];
                for (const page of translatedPages) {
                    page.seal = ScribeLog.checkSeal(page);
                }
                if (!translatedPages.every((page) => ScribeLog.validCheckPage(page, row, intake.messages))) {
                    throw new Error('The paid Checker result could not be verified against the fork.');
                }
            }
            const playerActions = entry.kind === ScribeLog.Kind.Operator && entry.operations.length > 0 &&
                entry.operations.every((operation) => ScribeFork.PlayerActions.includes(operation.type));
            if (playerActions) {
                const earlier = {...saved.log, entries: saved.log.entries.filter((item) => item.sequence < entry.sequence)};
                const before = ScribeReplay.run(earlier, parent.map((row) => row.id));
                const after = ScribeReplay.run(log, childIds, null, fingerprints, null, null, intake.messages);
                if (!entry.operations.every((operation, index) =>
                    ScribeFork.supportedAction(operation, moved.entry.operations[index], before, after, mapping, originals))) {
                    continue;
                }
            }
            if (!story && !contiguous && !playerActions && entry.origin !== ScribeLog.Origin.Checker) {
                if (entry.kind !== ScribeLog.Kind.Operator || !entry.operations.length ||
                    !entry.operations.every((operation) => operation.type === ScribeLog.Ruling.Narrow)) {
                    continue;
                }
                const parentOrder = parent.map((row) => row.id);
                const earlier = {...saved.log, entries: saved.log.entries.filter((item) => item.sequence < entry.sequence)};
                const before = ScribeReplay.run(earlier, parentOrder).scenes;
                const after = ScribeReplay.run(log, childIds, null, fingerprints, null, null, intake.messages).scenes;
                const independent = entry.operations.every((operation, index) => {
                    const original = before.find((scene) => scene.id === operation.scene);
                    const retained = after.find((scene) => scene.id === moved.entry.operations[index].scene);
                    return original && retained && mapping.get(original.first)?.id === retained.first &&
                        mapping.get(original.last)?.id === retained.last;
                });
                if (!independent) {
                    continue;
                }
            }
            if (entry.kind === ScribeLog.Kind.Operator && !playerActions && (!moved.anchored || entry.operations.some((op) =>
                op.type === ScribeLog.Ruling.Pin && !op.cite && !op.winner))) {
                const state = ScribeReplay.run(log, childIds, null, fingerprints, null, null, intake.messages);
                if (!moved.entry.operations.length || !moved.entry.operations.every((op) =>
                    ScribeFork.supportedRuling(op, state, originalsByChild))) {
                    continue;
                }
            } else if (!story && !playerActions && !moved.anchored) {
                continue;
            }
            const decision = moved.entry.checkerRuling;
            if (decision) {
                const matches = ScribeLog.checkProgress(book, intake.messages).findings.filter((finding) =>
                    finding.kind === decision.kind && finding.source?.messageId === decision.source?.messageId &&
                    finding.earlier?.messageId === decision.earlier?.messageId && finding.source?.quote === decision.source?.quote &&
                    finding.earlier?.quote === decision.earlier?.quote &&
                    (finding.question === decision.question || ScribeText.fingerprint(finding.question) === decision.reportedQuestionHash));
                if (matches.length !== 1) {
                    throw new Error('The saved Checker ruling could not be linked to its finding in the fork.');
                }
                decision.finding = matches[0].id;
                decision.version = matches[0].version;
            }
            log.entries.push(moved.entry);
            for (const id of entry.messageIds) {
                if (saved.log.read[id] !== entry.sequence) {
                    continue;
                }
                const row = mapping.get(id);
                credited.add(row.id);
                log.read[row.id] = entry.sequence;
                book.fingerprints[row.id] = row.fingerprint;
                if (row.projection != null) {
                    (book.projections ??= {})[row.id] = row.projection;
                }
            }
        }
        if (log.entries.some((entry) => entry.origin === ScribeLog.Origin.Notes)) {
            const filed = new Map();
            for (const note of saved.log.notes) {
                const used = filed.get(note) ?? new Set();
                const place = parent.slice(0, mapping.size).findIndex((row, index) => !used.has(index) &&
                    row.contents.some((block) => typeof block.text === 'string' && note && block.text.includes(note)));
                if (place >= 0) {
                    used.add(place);
                    filed.set(note, used);
                    log.notes.push(note);
                }
            }
        }
        if (!credited.size) {
            throw new Error('No complete Writer reading in the source Book matches the shared passages.');
        }
        if (current && (current.log.entries.some((entry) => !entry.messageIds.length ||
            entry.messageIds.some((id) => !credited.has(id))) || Object.keys(current.log.read).some((id) => !credited.has(id)))) {
            throw new Error('This fork has Book entries outside the verified source readings.');
        }
        ScribeReplay.run(log, childIds, null, fingerprints, null, null, intake.messages);
        return {book, shared: mapping.size, read: credited.size, mapping, sourceIntake};
    },
});
