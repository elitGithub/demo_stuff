const ScribeReplay = Object.freeze({
    Inputs: new WeakMap(),
    Status: Object.freeze({
        InForce: 'InForce',
        Disputed: 'Disputed',
        Replaced: 'Replaced',
        Ended: 'Ended',
        Expired: 'Expired',
        Removed: 'Removed',
    }),

    Likeness: Object.freeze({
        Spelling: 'Spelling',
        SameName: 'SameName',
        Alias: 'Alias',
    }),

    Settings: Object.freeze({
        KindCategory: 'kind',
        TargetKey: 'target',
        TextKey: 'text',
        WordJoiner: ' ',
        Nothing: '',
        PinnedPosition: 0,
    }),

    /**
     * @param {object} book
     * @param {string} id
     * @return {string}
     */
    resolve(book, id) {
        const passed = [];
        let current = id;
        while (book.merged.has(current)) {
            passed.push(current);
            current = book.merged.get(current);
        }
        for (const step of passed) {
            book.merged.set(step, current);
        }
        return current;
    },

    /**
     * @param {object} book
     * @param {string} id
     * @param {string} subject
     * @return {string}
     */
    owner(book, id, subject) {
        return ScribeReplay.resolve(book, book.split.get(id) ?? subject);
    },

    /**
     * @param {object} book
     * @param {string} first
     * @param {string} second
     * @return {string}
     */
    pairKey(book, first, second) {
        return ScribeLog.pair(ScribeReplay.resolve(book, first), ScribeReplay.resolve(book, second));
    },

    /**
     * @param {{ subject: string, category: string, target: string|null, targetText: string|null, text: string }} statement
     * @return {string[]}
     */
    statementKeys(statement) {
        const settings = ScribeReplay.Settings;
        const wording = ScribeReplay.wording(statement.text);
        if (statement.category !== ScribeCategory.Settings.RelationCategory) {
            return [ScribeReplay.disputeKey(statement, wording)];
        }
        const keys = [];
        if (statement.target !== null) {
            keys.push(
                JSON.stringify([statement.subject, statement.category, settings.TargetKey, statement.target, wording]),
            );
        }
        const name = statement.targetText === null ? settings.Nothing : ScribeText.normaliseName(statement.targetText);
        if (name !== settings.Nothing) {
            keys.push(JSON.stringify([statement.subject, statement.category, settings.TextKey, name, wording]));
        }
        return keys;
    },

    /**
     * @param {object} book
     * @param {{ subject: string, category: string, target: string|null, targetText: string|null, text: string }} mark
     * @return {string[]}
     */
    markKeys(book, mark) {
        return ScribeReplay.statementKeys({
            subject: ScribeReplay.resolve(book, mark.subject),
            category: mark.category,
            ...ScribeCategory.scope(mark),
            target: mark.target === null ? null : ScribeReplay.resolve(book, mark.target),
            targetText: mark.targetText,
            text: mark.text,
        });
    },

    /**
     * @param {readonly object[]} facts
     * @param {object} issue
     * @return {object|null}
     */
    supportedFact(facts, issue) {
        const candidates = facts.filter((fact) => fact.subject === issue.subject &&
            fact.category === issue.category && fact.target === issue.target && fact.targetText === issue.targetText &&
            fact.cite === issue.cite && ScribeCategory.same(fact.text, issue.book));
        const scope = ScribeCategory.scope({ ...issue, text: issue.book });
        const eligible = scope.form || scope.dimension ? candidates.filter((fact) =>
            ScribeCategory.sameScope(fact, { ...issue, text: issue.book })) : candidates;
        return eligible.find((fact) => fact.id === issue.fact) ??
            (issue.cite !== null && eligible.length === 1 ? eligible[0] : null);
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @return {boolean}
     */
    erase(book, fact) {
        const struck =
            book.removed.has(fact.id) ||
            (book.struck.size > 0 &&
                fact.origin !== ScribeLog.Origin.Operator &&
                !fact.made &&
                ScribeReplay.statementKeys(book.edits.has(fact.id) ? { ...fact, text: book.edits.get(fact.id).source.book } : fact).some(
                    /**
                     * @param {string} key
                     * @return {boolean}
                     */
                    (key) => book.struck.has(key),
                ));
        if (struck) {
            fact.status = ScribeReplay.Status.Removed;
            book.facts.push(fact);
        }
        return struck;
    },

    /**
     * @param {object} book
     * @param {readonly object[]} rulings
     * @param {Object<string, Function>} handlers
     * @return {void}
     */
    apply(book, rulings, handlers) {
        for (const [order, operation] of rulings.entries()) {
            if (Object.hasOwn(handlers, operation.type)) {
                handlers[operation.type](book, operation, order);
            }
        }
    },

    /**
     * @param {Map<string, { order: number }>} rulings
     * @param {string[]} keys
     * @param {{ order: number }|undefined} found
     * @return {{ order: number }|undefined}
     */
    latest(rulings, keys, found) {
        let latest = found;
        for (const key of keys) {
            const candidate = rulings.get(key);
            if (candidate !== undefined && (latest === undefined || candidate.order > latest.order)) {
                latest = candidate;
            }
        }
        return latest;
    },

    /**
     * @param {object} book
     * @param {object} operation
     * @return {string|null}
     */
    pinSlot(book, operation) {
        const fixed = ScribeLog.categoryKind(operation.category) === ScribeCategory.Kind.Fixed;
        if (!fixed || !book.subjects.has(operation.subject)) {
            return null;
        }
        let source = book.byId.get(operation.winner);
        if (!source && operation.category === 'build' && operation.winner && operation.cite && !('form' in operation)) {
            const matching = book.facts.filter((fact) => fact.cite === operation.cite &&
                fact.category === operation.category && fact.subject === ScribeReplay.resolve(book, operation.subject) &&
                ScribeCategory.same(fact.text, operation.text));
            if (matching.length === 1) {
                [source] = matching;
            }
        }
        const scope = ScribeCategory.scope(source ?? operation);
        return ScribeReplay.keys({ ...operation, ...scope, subject: ScribeReplay.resolve(book, operation.subject) },
            ScribeCategory.Kind.Fixed)[0];
    },

    /**
     * @param {string} category
     * @return {string|null}
     */
    kindOf(category) {
        if (category === ScribeCategory.Settings.RelationCategory) {
            return ScribeCategory.Kind.Moving;
        }
        const parsed = ScribeCategory.parse(category);
        return parsed === null ? null : parsed.kind;
    },

    /**
     * @param {string} text
     * @return {string}
     */
    wording(text) {
        return ScribeText.words(text).join(ScribeReplay.Settings.WordJoiner);
    },

    /**
     * @param {string} subject
     * @param {string} target
     * @return {string}
     */
    targetKey(subject, target) {
        return JSON.stringify([
            subject,
            ScribeCategory.Settings.RelationCategory,
            ScribeReplay.Settings.TargetKey,
            target,
        ]);
    },

    /**
     * @param {object} fact
     * @return {string|null}
     */
    textKey(fact) {
        const settings = ScribeReplay.Settings;
        const name = fact.targetText === null ? settings.Nothing : ScribeText.normaliseName(fact.targetText);
        if (name === settings.Nothing) {
            return null;
        }
        return JSON.stringify([fact.subject, fact.category, settings.TextKey, name]);
    },

    /**
     * @param {object} fact
     * @param {string} kind
     * @return {string[]}
     */
    keys(fact, kind) {
        if (fact.category === ScribeCategory.Settings.RelationCategory) {
            if (fact.target !== null) {
                return [ScribeReplay.targetKey(fact.subject, fact.target)];
            }
            const text = ScribeReplay.textKey(fact);
            return text === null ? [] : [text];
        }
        if (kind === ScribeCategory.Kind.List) {
            return [JSON.stringify([fact.subject, fact.category, ScribeReplay.wording(fact.text)])];
        }
        const { form, dimension } = ScribeCategory.scope(fact);
        if (form || dimension) {
            return [JSON.stringify([fact.subject, fact.category, form, dimension])];
        }
        return [JSON.stringify([fact.subject, fact.category])];
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @param {string[]} keys
     * @return {void}
     */
    enter(book, fact, keys) {
        for (const key of keys) {
            const holders = book.inForce.get(key) ?? new Set();
            holders.add(fact);
            book.inForce.set(key, holders);
        }
        if (ScribeReplay.kindOf(fact.category) === ScribeCategory.Kind.Passing) {
            book.passing.add(fact);
        }
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @param {string[]} keys
     * @return {void}
     */
    leave(book, fact, keys) {
        for (const key of keys) {
            book.inForce.get(key).delete(fact);
        }
    },

    /**
     * @param {object|undefined} fact
     * @return {boolean}
     */
    live(fact) {
        const status = ScribeReplay.Status;
        return fact !== undefined && (fact.status === status.InForce || fact.status === status.Disputed);
    },

    /**
     * @param {object} book
     * @param {string} slot
     * @param {string} wording
     * @return {void}
     */
    say(book, slot, wording) {
        const said = book.said.get(slot) ?? new Map();
        said.set(wording, (said.get(wording) ?? 0) + 1);
        book.said.set(slot, said);
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @return {void}
     */
    unsay(book, fact) {
        const [slot] = ScribeReplay.keys(fact, ScribeCategory.Kind.Fixed);
        const said = book.said.get(slot);
        const pending = [fact.id];
        while (pending.length > 0) {
            const id = pending.pop();
            const wording = book.wordings.get(id);
            const left = said.get(wording) - 1;
            if (left === 0) {
                said.delete(wording);
            } else {
                said.set(wording, left);
            }
            for (const former of book.behind.get(id) ?? []) {
                pending.push(former);
            }
        }
    },

    /**
     * @param {object} fact
     * @param {string} wording
     * @return {string}
     */
    disputeKey(fact, wording) {
        const { form, dimension } = ScribeCategory.scope(fact);
        return form || dimension ? JSON.stringify([fact.subject, fact.category, form, dimension, wording]) :
            JSON.stringify([fact.subject, fact.category, wording]);
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @return {void}
     */
    contest(book, fact) {
        const key = ScribeReplay.disputeKey(fact, book.wordings.get(fact.id));
        const contested = book.disputes.get(key) ?? new Set();
        contested.add(fact);
        book.disputes.set(key, contested);
    },

    /**
     * @param {object} book
     * @param {string} holder
     * @param {string} former
     * @return {void}
     */
    attach(book, holder, former) {
        const formers = book.behind.get(holder) ?? [];
        formers.push(former);
        book.behind.set(holder, formers);
    },

    /**
     * @param {object} book
     * @param {string} id
     * @return {object|undefined}
     */
    follow(book, id) {
        const passed = [];
        let current = id;
        while (book.fuller.has(current)) {
            passed.push(current);
            current = book.fuller.get(current);
        }
        for (const step of passed) {
            book.fuller.set(step, current);
        }
        return book.byId.get(current);
    },

    /**
     * @param {object} book
     * @param {string} subject
     * @param {string} text
     * @param {object|null} fact
     * @return {void}
     */
    mention(book, subject, text, fact) {
        const mentions = book.mentions.get(subject) ?? [];
        mentions.push({ text, fact });
        book.mentions.set(subject, mentions);
    },

    /**
     * @param {object} book
     * @param {string} first
     * @param {string} second
     * @return {void}
     */
    link(book, first, second) {
        for (const [one, two] of [
            [first, second],
            [second, first],
        ]) {
            const partners = book.pairs.get(one) ?? new Set();
            partners.add(two);
            book.pairs.set(one, partners);
        }
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @return {void}
     */
    keep(book, fact) {
        book.facts.push(fact);
        book.byId.set(fact.id, fact);
        if (fact.category === ScribeLog.Settings.AkaCategory) {
            ScribeReplay.mention(book, fact.subject, fact.text, fact);
        }
    },

    /**
     * @param {object} book
     * @param {object} fact
     * @param {number} position
     * @return {void}
     */
    mark(book, fact, position) {
        if (
            fact.category !== ScribeCategory.Settings.RelationCategory ||
            fact.target === null ||
            fact.target === fact.subject
        ) {
            return;
        }
        const forward = JSON.stringify([fact.subject, fact.target]);
        if (book.stale.has(forward)) {
            book.stale.delete(forward);
            return;
        }
        for (const back of book.inForce.get(ScribeReplay.targetKey(fact.target, fact.subject)) ?? []) {
            if (back.position < position) {
                book.stale.set(JSON.stringify([fact.target, fact.subject]), {
                    subject: fact.target,
                    target: fact.subject,
                });
            }
        }
    },

    Rules: Object.freeze({
        /**
         * @param {object} book
         * @param {object} fact
         * @param {string[]} keys
         * @return {boolean}
         */
        Fixed(book, fact, keys) {
            const status = ScribeReplay.Status;
            const [slot] = keys;
            const wording = ScribeCategory.value(fact);
            const said = book.said.get(slot);
            if (said !== undefined && said.has(wording)) {
                ScribeReplay.combine(book.fixedClaims.get(ScribeReplay.disputeKey(fact, wording)), fact);
                return false;
            }
            ScribeReplay.say(book, slot, wording);
            book.wordings.set(fact.id, wording);
            book.fixedClaims.set(ScribeReplay.disputeKey(fact, wording), fact);
            const holders = book.inForce.get(slot) ?? new Set();
            if (holders.size === 0) {
                fact.status = status.InForce;
                return true;
            }
            fact.status = status.Disputed;
            ScribeReplay.contest(book, fact);
            return true;
        },

        /**
         * @param {object} book
         * @param {object} fact
         * @param {string[]} keys
         * @return {boolean}
         */
        Moving(book, fact, keys) {
            const status = ScribeReplay.Status;
            const sought = [...keys];
            const text = ScribeReplay.textKey(fact);
            if (fact.target !== null && text !== null) {
                sought.push(text);
            }
            const displaced = new Set();
            for (const key of sought) {
                for (const holder of book.inForce.get(key) ?? []) {
                    displaced.add(holder);
                }
            }
            for (const holder of displaced) {
                ScribeReplay.leave(book, holder, ScribeReplay.keys(holder, ScribeCategory.Kind.Moving));
                holder.status = status.Replaced;
                holder.replacedBy = fact.id;
            }
            fact.status = status.InForce;
            return true;
        },

        /**
         * @param {object} book
         * @param {object} fact
         * @param {string[]} keys
         * @return {boolean}
         */
        List(book, fact, keys) {
            const [slot] = keys;
            const holders = book.inForce.get(slot) ?? new Set();
            if (holders.size > 0) {
                ScribeReplay.combine(holders.values().next().value, fact);
                return false;
            }
            fact.status = ScribeReplay.Status.InForce;
            return true;
        },

        /**
         * @param {object} book
         * @param {object} fact
         * @return {boolean}
         */
        Passing(book, fact) {
            fact.status = ScribeReplay.Status.InForce;
            return true;
        },
    }),

    /**
     * @param {object} holder
     * @param {object} fact
     * @return {void}
     */
    combine(holder, fact) {
        if (holder && (holder.claims || fact.claims)) {
            holder.claims ??= [{ id: holder.id, text: holder.text, cite: holder.cite, position: holder.position, evidence: holder.evidence ?? null }];
            holder.claims.push(...(fact.claims ?? [{ id: fact.id, text: fact.text, cite: fact.cite, position: fact.position, evidence: null }]));
        }
    },

    /**
     * @param {object} book
     * @return {object[]}
     */
    contradictions(book) {
        if (!book.contradictions.size) {
            return [];
        }
        const measurements = new Map();
        for (const fact of book.facts) {
            if (fact.category !== 'build' || !fact.form || !fact.dimension || fact.status === ScribeReplay.Status.Removed) {
                continue;
            }
            for (const claim of fact.claims ?? []) {
                const key = JSON.stringify([claim.cite, ScribeReplay.wording(claim.text)]);
                measurements.set(key, measurements.has(key) ? null : { ...fact, text: claim.text });
            }
        }
        return [...book.contradictions.values()].filter((issue) => {
            const earlier = measurements.get(JSON.stringify([issue.earlier, ScribeReplay.wording(issue.before)]));
            const later = measurements.get(JSON.stringify([issue.cite, ScribeReplay.wording(issue.said)]));
            return issue.dismissed || !earlier || !later || earlier.subject !== later.subject ||
                (ScribeCategory.sameScope(earlier, later) && ScribeCategory.value(earlier) !== ScribeCategory.value(later));
        });
    },

    /**
     * @param {object} operation
     * @param {string} id
     * @param {number} position
     * @return {object}
     */
    claim(operation, id, position) {
        const scope = ScribeCategory.scope(operation);
        return {
            ...scope,
            ...(operation.evidence ? { evidence: operation.evidence } : {}),
            ...(operation.evidence || scope.dimension ? { claims: [{ id, text: operation.text, position,
                cite: operation.cite ?? null, evidence: operation.evidence ?? null }] } : {}),
        };
    },

    /**
     * @param {object} book
     * @param {{ operation: object, position: number, origin: string }} item
     * @param {string} id
     * @return {object|null}
     */
    file(book, item, id) {
        const operation = item.operation;
        const kind = ScribeReplay.kindOf(operation.category);
        if (kind === null) {
            return null;
        }
        const fact = {
            id,
            ...ScribeReplay.claim(operation, id, item.position),
            ...ScribeCategory.scope({ ...book.edits.get(id), category: operation.category }),
            subject: ScribeReplay.owner(book, id, operation.subject),
            category: operation.category,
            target: operation.target === null ? null : ScribeReplay.resolve(book, operation.target),
            targetText: operation.targetText,
            text: book.edits.get(id)?.text ?? operation.text,
            cite: operation.cite,
            position: item.position,
            origin: item.origin,
            hidden: operation.hidden,
            told: [],
            widened: null,
            status: null,
            replacedBy: null,
            ended: null,
            pinned: false,
            made: false,
        };
        book.sources?.push(fact);
        if (ScribeReplay.erase(book, fact)) {
            return null;
        }
        const keys = ScribeReplay.keys(fact, kind);
        if (!ScribeReplay.Rules[kind](book, fact, keys)) {
            return null;
        }
        if (fact.status === ScribeReplay.Status.InForce) {
            ScribeReplay.enter(book, fact, keys);
        }
        ScribeReplay.keep(book, fact);
        if (typeof operation.other === 'string') {
            ScribeReplay.link(book, fact.subject, ScribeReplay.resolve(book, operation.other));
        }
        ScribeReplay.mark(book, fact, fact.position);
        return fact;
    },

    /**
     * @param {object} book
     * @param {object} operation
     * @param {object|undefined} named
     * @return {boolean}
     */
    takes(book, operation, named) {
        if (!ScribeReplay.live(named) || ScribeReplay.owner(book, operation.becomes, named.subject) !== named.subject) {
            return false;
        }
        const scope = ScribeCategory.scope(operation);
        return (!scope.form || named.form === scope.form) && (!scope.dimension || named.dimension === scope.dimension);
    },

    /**
     * @param {object} book
     * @param {{ operation: object, position: number, origin: string }} item
     * @param {object} named
     * @return {object|null}
     */
    succeed(book, item, named) {
        const status = ScribeReplay.Status;
        const operation = item.operation;
        const fact = {
            id: operation.becomes,
            ...ScribeReplay.claim({ ...operation, ...ScribeCategory.scope(named) }, operation.becomes, item.position),
            ...ScribeCategory.scope({ ...book.edits.get(operation.becomes), category: named.category }),
            subject: named.subject,
            category: named.category,
            target: named.target,
            targetText: named.targetText,
            text: book.edits.get(operation.becomes)?.text ?? operation.text,
            cite: operation.cite,
            position: item.position,
            origin: item.origin,
            hidden: named.hidden,
            told: [],
            widened: null,
            status: null,
            replacedBy: null,
            ended: null,
            pinned: false,
            made: false,
        };
        book.sources?.push(fact);
        if (ScribeReplay.erase(book, fact)) {
            return null;
        }
        fact.status = named.status;
        fact.replacedBy = named.replacedBy;
        const kind = ScribeReplay.kindOf(named.category);
        if (named.status === status.InForce) {
            ScribeReplay.leave(book, named, ScribeReplay.keys(named, kind));
            ScribeReplay.enter(book, fact, ScribeReplay.keys(fact, kind));
        }
        named.status = status.Replaced;
        named.replacedBy = fact.id;
        ScribeReplay.keep(book, fact);
        if (operation.other !== null) {
            ScribeReplay.link(book, fact.subject, ScribeReplay.resolve(book, operation.other));
        }
        if (kind === ScribeCategory.Kind.Fixed) {
            const [slot] = ScribeReplay.keys(fact, kind);
            const wording = ScribeCategory.value(fact);
            ScribeReplay.say(book, slot, wording);
            book.wordings.set(fact.id, wording);
            book.fixedClaims.set(ScribeReplay.disputeKey(fact, wording), fact);
            if (fact.status === status.Disputed) {
                ScribeReplay.contest(book, fact);
            }
        }
        return fact;
    },

    Handlers: Object.freeze({
        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Fact(book, item) {
            ScribeReplay.file(book, item, item.operation.fact);
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Refine(book, item) {
            const status = ScribeReplay.Status;
            const operation = item.operation;
            const named = book.byId.get(operation.fact);
            if (!ScribeReplay.takes(book, operation, named)) {
                ScribeReplay.file(book, item, operation.becomes);
                return;
            }
            const fact = ScribeReplay.succeed(book, item, named);
            if (fact === null) {
                return;
            }
            book.fuller.set(named.id, fact.id);
            ScribeReplay.attach(book, fact.id, named.id);
            book.refinements.push({ from: named.id, to: fact.id });
            if (named.category === ScribeCategory.Settings.RelationCategory && named.target !== null) {
                book.stale.delete(JSON.stringify([named.subject, named.target]));
            }
            if (fact.status !== status.InForce || ScribeReplay.kindOf(fact.category) !== ScribeCategory.Kind.Fixed) {
                return;
            }
            const key = ScribeReplay.disputeKey(fact, book.wordings.get(fact.id));
            for (const disputed of book.disputes.get(key) ?? []) {
                if (disputed.status === status.Disputed) {
                    disputed.status = status.Replaced;
                    disputed.replacedBy = fact.id;
                    ScribeReplay.attach(book, fact.id, disputed.id);
                }
            }
            book.disputes.delete(key);
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Change(book, item) {
            const operation = item.operation;
            const named = ScribeReplay.follow(book, operation.fact);
            if (!ScribeReplay.takes(book, operation, named)) {
                ScribeReplay.file(book, item, operation.becomes);
                return;
            }
            const fact = ScribeReplay.succeed(book, item, named);
            if (fact === null) {
                return;
            }
            if (ScribeReplay.kindOf(named.category) === ScribeCategory.Kind.Fixed) {
                ScribeReplay.unsay(book, named);
            }
            ScribeReplay.mark(book, fact, fact.position);
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        End(book, item) {
            const status = ScribeReplay.Status;
            const operation = item.operation;
            const fact = ScribeReplay.follow(book, operation.fact);
            if (!ScribeReplay.live(fact)) {
                return;
            }
            const kind = ScribeReplay.kindOf(fact.category);
            if (fact.status === status.InForce) {
                ScribeReplay.leave(book, fact, ScribeReplay.keys(fact, kind));
            }
            if (kind === ScribeCategory.Kind.Fixed) {
                ScribeReplay.unsay(book, fact);
            }
            fact.status = status.Ended;
            fact.ended = { reason: operation.reason, cite: operation.cite, position: item.position,
                ...(operation.evidence ? { evidence: operation.evidence } : {}) };
            ScribeReplay.mark(book, fact, item.position);
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Told(book, item) {
            const operation = item.operation;
            const fact = book.byId.get(operation.fact);
            const subject = ScribeReplay.resolve(book, operation.subject);
            if (fact !== undefined && !fact.told.includes(subject)) {
                fact.told.push(subject);
            }
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Night(book, item) {
            const status = ScribeReplay.Status;
            const operation = item.operation;
            if (book.nights.has(operation.cite)) {
                return;
            }
            book.nights.set(operation.cite, {
                cite: operation.cite,
                position: item.position,
                marker: operation.marker,
                ...(operation.evidence ? { evidence: operation.evidence } : {}),
            });
            for (const fact of book.passing) {
                if (fact.status === status.InForce && fact.position < item.position) {
                    fact.status = status.Expired;
                    ScribeReplay.leave(book, fact, ScribeReplay.keys(fact, ScribeCategory.Kind.Passing));
                }
                if (fact.status !== status.InForce) {
                    book.passing.delete(fact);
                }
            }
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Alias(book, item) {
            const operation = item.operation;
            const subject = ScribeReplay.resolve(book, operation.subject);
            const key = ScribeLog.aliasKey(subject, operation.name);
            if (book.unaliased.has(key)) {
                return;
            }
            if (operation.other !== null) {
                ScribeReplay.link(book, subject, ScribeReplay.resolve(book, operation.other));
            }
            ScribeReplay.mention(book, subject, operation.name, null);
            if (!book.aliased.has(key)) {
                book.aliased.add(key);
                book.aliases.push({ subject, name: operation.name, cite: operation.cite,
                    ...(operation.evidence ? { evidence: operation.evidence } : {}) });
            }
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        AddFact(book, item) {
            const operation = item.operation;
            const target = operation.target;
            if (book.subjects.has(operation.subject) && (target === null || book.subjects.has(target))) {
                ScribeReplay.file(book, item, operation.fact);
            }
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        ThreadOpen(book, item) {
            const operation = item.operation;
            book.threads.set(operation.thread, {
                id: operation.thread,
                text: operation.text,
                cite: operation.cite,
                position: item.position,
                closed: null,
                ...(operation.evidence ? { evidence: operation.evidence } : {}),
            });
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        ThreadClose(book, item) {
            book.closes.push(item.operation);
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Question(book, item) {
            const operation = item.operation;
            book.questions.push({
                id: operation.question,
                text: operation.text,
                cite: operation.cite,
                position: item.position,
                answer: null,
                ...(operation.evidence ? { evidence: operation.evidence } : {}),
                dismissed: false,
            });
        },

        /**
         * @param {object} book
         * @param {{ operation: object, position: number, origin: string }} item
         * @return {void}
         */
        Contradiction(book, item) {
            const operation = item.operation;
            const id = JSON.stringify([operation.cite, operation.earlier, operation.said, operation.before]);
            if (book.contradictions.has(id)) {
                return;
            }
            book.contradictions.set(id, {
                id,
                cite: operation.cite,
                position: item.position,
                earlier: operation.earlier,
                earlierPosition: book.positions.get(operation.earlier) ?? operation.earlierPosition,
                said: operation.said,
                before: operation.before,
                why: operation.why,
                ...(operation.evidence ? { evidence: operation.evidence } : {}),
                dismissed: false,
            });
        },
    }),

    Merging: Object.freeze({
        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        Merge(book, operation) {
            const known = book.subjects.has(operation.from) && book.subjects.has(operation.into);
            if (!known || book.merged.has(operation.from)) {
                return;
            }
            const into = ScribeReplay.resolve(book, operation.into);
            if (into !== operation.from) {
                book.merged.set(operation.from, into);
            }
        },
    }),

    Shaping: Object.freeze({
        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        Split(book, operation) {
            if (!book.subjects.has(operation.subject) || !book.subjects.has(operation.becomes)) {
                return;
            }
            for (const id of operation.facts) {
                book.split.set(id, operation.becomes);
            }
            book.distinct.add(ScribeReplay.pairKey(book, operation.subject, operation.becomes));
        },

        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        RemoveFact(book, operation) {
            book.removed.add(operation.fact);
            if (operation.editedSource) {
                return;
            }
            for (const key of ScribeReplay.markKeys(book, operation.mark)) {
                book.struck.add(key);
            }
        },

        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        Unalias(book, operation) {
            if (book.subjects.has(operation.subject)) {
                const subject = ScribeReplay.resolve(book, operation.subject);
                book.unaliased.add(ScribeLog.aliasKey(subject, operation.name));
                book.unaliasings.push({ subject, name: operation.name });
            }
        },

        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        Distinct(book, operation) {
            if (book.subjects.has(operation.first) && book.subjects.has(operation.second)) {
                book.distinct.add(ScribeReplay.pairKey(book, operation.first, operation.second));
                book.distinctions.push({
                    first: ScribeReplay.resolve(book, operation.first),
                    second: ScribeReplay.resolve(book, operation.second),
                });
            }
        },
    }),

    Pinning: Object.freeze({
        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        Pin(book, operation) {
            const status = ScribeReplay.Status;
            const slot = ScribeReplay.pinSlot(book, operation);
            if (slot === null || book.pins.get(slot) !== operation) {
                return;
            }
            const held = book.held.get(slot) ?? [];
            const candidates = new Set();
            for (const fact of held) {
                const standing = ScribeReplay.follow(book, fact.id);
                const edit = book.edits.get(fact.id);
                const kept = operation.winner === fact.id && operation.editedSource ||
                    edit && (operation.winner === fact.id || operation.winner === edit.source.fact);
                const pinned = { ...operation, ...ScribeCategory.scope(fact) };
                if ((kept || ScribeCategory.value(fact) === ScribeCategory.value(pinned)) && ScribeReplay.live(standing)) {
                    candidates.add(standing);
                }
            }
            const preferred = operation.winner === null ? undefined : ScribeReplay.follow(book, operation.winner);
            let winner = candidates.has(preferred) ? preferred : candidates.values().next().value;
            if (winner === undefined) {
                const told = [];
                for (const id of operation.told) {
                    const subject = ScribeReplay.resolve(book, id);
                    if (!told.includes(subject)) {
                        told.push(subject);
                    }
                }
                const located = operation.origin !== undefined;
                winner = {
                    id: operation.fact,
                    ...ScribeReplay.claim(operation, operation.fact, book.positions.get(operation.cite) ?? operation.position ?? 0),
                    ...ScribeCategory.scope({ ...book.edits.get(operation.fact), category: operation.category }),
                    subject: ScribeReplay.resolve(book, operation.subject),
                    category: operation.category,
                    target: null,
                    targetText: null,
                    text: book.edits.get(operation.fact)?.text ?? operation.text,
                    cite: located ? operation.cite : null,
                    position: located
                        ? (book.positions.get(operation.cite) ?? operation.position)
                        : ScribeReplay.Settings.PinnedPosition,
                    origin: located ? operation.origin : ScribeLog.Origin.Operator,
                    hidden: operation.hidden,
                    told,
                    widened: null,
                    status: null,
                    replacedBy: null,
                    ended: null,
                    pinned: false,
                    made: true,
                };
                book.sources?.push(winner);
                if (ScribeReplay.erase(book, winner)) {
                    return;
                }
                ScribeReplay.keep(book, winner);
            }
            for (const fact of held) {
                if (fact !== winner && fact.status === status.InForce) {
                    ScribeReplay.leave(book, fact, [slot]);
                    fact.status = status.Disputed;
                }
            }
            if (winner.status !== status.InForce) {
                winner.status = status.InForce;
                ScribeReplay.enter(book, winner, [slot]);
            }
            winner.pinned = true;
            book.pinned.add(slot);
        },
    }),

    Finishing: Object.freeze({
        /**
         * @param {object} book
         * @param {object} operation
         * @param {number} order
         * @return {void}
         */
        Widen(book, operation, order) {
            const known =
                operation.to === ScribeLog.Settings.Everyone ||
                operation.to.every(
                    /**
                     * @param {string} id
                     * @return {boolean}
                     */
                    (id) => book.subjects.has(id),
                );
            if (!known) {
                return;
            }
            const ruling = { order, operation };
            book.widenings.set(operation.fact, ruling);
            if (operation.editedSource) {
                return;
            }
            for (const key of ScribeReplay.markKeys(book, operation.mark)) {
                book.widenedMarks.set(key, ruling);
            }
        },

        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        Narrow(book, operation) {
            const scene = book.scenes.get(operation.scene);
            if (scene !== undefined) {
                scene.narrowed = true;
            }
        },

        /**
         * @param {object} book
         * @param {object} operation
         * @param {number} order
         * @return {void}
         */
        Answer(book, operation, order) {
            book.answers.set(operation.question, { order, text: operation.text });
        },

        /**
         * @param {object} book
         * @param {object} operation
         * @param {number} order
         * @return {void}
         */
        Dismiss(book, operation, order) {
            book.dismissals.set(operation.question, { order });
        },

        /**
         * @param {object} book
         * @param {object} operation
         * @return {void}
         */
        DismissContradiction(book, operation) {
            const contradiction = book.contradictions.get(operation.contradiction);
            if (contradiction !== undefined) {
                contradiction.dismissed = true;
            }
        },
    }),

    /**
     * @param {*} value
     * @return {*}
     */
    seal(value) {
        if (value !== null && typeof value === 'object') {
            for (const child of Object.values(value)) {
                ScribeReplay.seal(child);
            }
            Object.freeze(value);
        }
        return value;
    },

    /**
     * @param {object} log
     * @param {string[]} order
     * @param {ReadonlySet<string>|null} pending
     * @param {ReadonlyMap<string, string>|null} fingerprints
     * @param {ReadonlyMap<string, object>|null} edits
     * @return {Readonly<{ revision: number, subjects: readonly object[], facts: readonly object[], scenes: readonly object[], nights: readonly object[], threads: readonly object[], conflicts: readonly object[], lookAlikes: readonly object[], stale: readonly object[], refinements: readonly object[], aliases: readonly object[], questions: readonly object[], unaliased: readonly object[], distinct: readonly object[], contradictions: readonly object[] }>}
     */
    run(log, order, pending = null, fingerprints = null, edits = null, sources = null) {
        const settings = ScribeReplay.Settings;
        const status = ScribeReplay.Status;
        const likeness = ScribeReplay.Likeness;
        const types = ScribeAnswer.Type;
        const rulingTypes = ScribeLog.Ruling;
        const targets = new Map();
        if (edits === null) {
            edits = new Map();
            const corrections = log.entries.filter((entry) => entry.kind === ScribeLog.Kind.Operator && !entry.withdrawn)
                .flatMap((entry) => entry.operations.filter((operation) => !operation.revoked &&
                    (operation.type === rulingTypes.EditFact || operation.editedSource)));
            if (corrections.length > 0) {
                const originals = [];
                ScribeReplay.run(log, order, pending, fingerprints, edits, originals);
                for (const operation of corrections) {
                    const source = operation.editedSource ?? operation.source;
                    if (source.sourcePrint !== null && fingerprints !== null && fingerprints.get(source.cite) !== source.sourcePrint) {
                        continue;
                    }
                    const fact = ScribeReplay.supportedFact(originals, source);
                    if (fact && (fact.id === source.fact || (source.sourcePrint !== null && fingerprints !== null))) {
                        if (operation.type === rulingTypes.EditFact) {
                            edits.set(fact.id, operation);
                        } else {
                            targets.set(operation, fact.id);
                        }
                    }
                }
            }
        }
        const positions = new Map();
        for (const [index, id] of order.entries()) {
            positions.set(id, index + 1);
        }
        const book = {
            edits,
            sources,
            positions,
            subjects: new Map(),
            facts: [],
            byId: new Map(),
            inForce: new Map(),
            said: new Map(),
            fixedClaims: new Map(),
            wordings: new Map(),
            behind: new Map(),
            fuller: new Map(),
            passing: new Set(),
            disputes: new Map(),
            stale: new Map(),
            refinements: [],
            mentions: new Map(),
            aliases: [],
            aliased: new Set(),
            pairs: new Map(),
            threads: new Map(),
            closes: [],
            questions: [],
            nights: new Map(),
            scenes: new Map(),
            merged: new Map(),
            split: new Map(),
            removed: new Set(),
            struck: new Set(),
            unaliased: new Set(),
            unaliasings: [],
            distinct: new Set(),
            distinctions: [],
            pins: new Map(),
            held: new Map(),
            pinned: new Set(),
            widenings: new Map(),
            widenedMarks: new Map(),
            answers: new Map(),
            dismissals: new Map(),
            contradictions: new Map(),
        };
        const counted = [];
        const showings = [];
        const rulings = [];
        const decisions = [];
        const claims = [];
        const legacyDecisions = [];
        const withdrawnQuestions = new Map();
        const previousQuestions = new Map();
        const questionKeys = new Map();
        const activeQuestionCounts = new Map();
        const ambiguousQuestions = new Set();
        for (const entry of log.entries) {
            const ruled = entry.kind === ScribeLog.Kind.Operator;
            const retired = new Set(entry.retired);
            for (const [index, operation] of entry.operations.entries()) {
                if (operation.revoked === true) {
                    continue;
                }
                const evidence = operation.evidence;
                const withdrawn = entry.withdrawn || retired.has(operation.cite) || retired.has(evidence?.messageId) ||
                    retired.has(operation.first) || retired.has(operation.last) || retired.has(operation.earlier);
                if (!ruled && evidence && (!positions.has(evidence.messageId) ||
                    (fingerprints !== null && fingerprints.get(evidence.messageId) !== evidence.fingerprint))) {
                    continue;
                }
                if (pending && (pending.has(operation.cite) ||
                    (operation.type === types.Contradiction && pending.has(operation.earlier)) ||
                    (operation.type === types.Scene && (pending.has(operation.first) || pending.has(operation.last))))) {
                    continue;
                }
                if (operation.type === types.Subject) {
                    const declared = book.subjects.get(operation.subject) ?? { label: operation.label, kind: null };
                    if (operation.evidence && !withdrawn) {
                        declared.evidence = operation.evidence;
                        claims.push(operation);
                    }
                    if (!withdrawn && declared.kind === null) {
                        declared.kind = operation.kind;
                    }
                    book.subjects.set(operation.subject, declared);
                    continue;
                }
                const ruling = Object.hasOwn(rulingTypes, operation.type);
                const splitting =
                    ruled &&
                    operation.type === rulingTypes.Split &&
                    book.subjects.has(operation.subject) &&
                    !book.subjects.has(operation.becomes);
                if (splitting) {
                    book.subjects.set(operation.becomes, { label: operation.label, kind: operation.kind });
                }
                if (operation.type === types.Question && typeof operation.cite === 'string') {
                    const key = JSON.stringify([entry.origin, operation.cite, ScribeReplay.wording(operation.text)]);
                    const previous = withdrawnQuestions.get(key);
                    if (withdrawn) {
                        const ids = previous ?? [];
                        if (ids.at(-1)?.sequence === entry.sequence) {
                            ambiguousQuestions.add(key);
                        }
                        ids.push({ id: operation.question, sequence: entry.sequence });
                        withdrawnQuestions.set(key, ids);
                    } else if (previous) {
                        activeQuestionCounts.set(key, (activeQuestionCounts.get(key) ?? 0) + 1);
                        questionKeys.set(operation.question, key);
                        previousQuestions.set(operation.question, previous.map((item) => item.id));
                    }
                }
                if (withdrawn || (ruling && !ruled)) {
                    continue;
                }
                if (operation.passages?.some((passage) => !positions.has(passage.id) ||
                    (fingerprints !== null && fingerprints.get(passage.id) !== passage.fingerprint))) {
                    continue;
                }
                if (operation.evidence && !ruled) {
                    claims.push(operation);
                }
                if (ruled || entry.origin === ScribeLog.Origin.Notes) {
                    for (const issue of operation.resolutions ?? []) {
                        if (!positions.has(issue.message) || (issue.cite !== null && !positions.has(issue.cite)) ||
                            (fingerprints !== null && (fingerprints.get(issue.message) !== issue.fingerprint ||
                                (issue.cite !== null && fingerprints.get(issue.cite) !== issue.sourcePrint))) ||
                            !ScribeLog.settles(operation, issue)) {
                            continue;
                        }
                        decisions.push({ sequence: entry.sequence, ...issue,
                            ...(operation.type === rulingTypes.EditFact ? { correctedBy: operation } : {}) });
                    }
                    const legacy = ruled ? [rulingTypes.Pin, rulingTypes.Widen, rulingTypes.RemoveFact,
                        rulingTypes.DismissContradiction] : [types.Change, types.Refine, types.End, types.Told];
                    if (fingerprints !== null && !entry.linked && legacy.includes(operation.type)) {
                        legacyDecisions.push({ sequence: entry.sequence, operation: JSON.parse(JSON.stringify(operation)) });
                    }
                }
                if (operation.type === rulingTypes.AddFact) {
                    const position = positions.get(operation.cite) ?? operation.position;
                    counted.push({ operation, position, ruled, sequence: entry.sequence, index, origin: entry.origin });
                    continue;
                }
                if (ruling) {
                    if (!operation.editedSource || targets.has(operation) || sources !== null) {
                        const address = operation.type === rulingTypes.Pin ? 'winner' : 'fact';
                        rulings.push(targets.has(operation) ? { ...operation, [address]: targets.get(operation) } : operation);
                    }
                    continue;
                }
                if (operation.type === types.Scene) {
                    const firstFound = positions.get(operation.first);
                    const lastFound = positions.get(operation.last);
                    const whole = firstFound !== undefined && lastFound !== undefined;
                    const firstPosition = whole ? firstFound : operation.firstPosition;
                    const lastPosition = whole ? lastFound : operation.lastPosition;
                    if (firstPosition !== undefined && lastPosition !== undefined) {
                        showings.push({ operation, firstPosition, lastPosition, sequence: entry.sequence, index });
                    }
                    continue;
                }
                if (!Object.hasOwn(ScribeReplay.Handlers, operation.type)) {
                    continue;
                }
                let position = positions.get(operation.cite);
                if (position === undefined && entry.origin === ScribeLog.Origin.Notes) {
                    position = operation.position;
                }
                if (position !== undefined) {
                    counted.push({ operation, position, ruled, sequence: entry.sequence, index, origin: entry.origin });
                }
            }
        }
        ScribeReplay.apply(book, rulings, ScribeReplay.Merging);
        ScribeReplay.apply(book, rulings, ScribeReplay.Shaping);
        counted.sort(
            /**
             * @param {{ position: number, ruled: boolean, sequence: number, index: number }} first
             * @param {{ position: number, ruled: boolean, sequence: number, index: number }} second
             * @return {number}
             */
            (first, second) =>
                first.position - second.position ||
                Number(first.ruled) - Number(second.ruled) ||
                first.sequence - second.sequence ||
                first.index - second.index,
        );
        for (const item of counted) {
            ScribeReplay.Handlers[item.operation.type](book, item);
        }
        for (const operation of book.closes) {
            const thread = book.threads.get(operation.thread);
            if (thread !== undefined && thread.closed === null) {
                thread.closed = {
                    how: operation.how,
                    ...(operation.evidence ? { evidence: operation.evidence } : {}),
                    cite: operation.cite,
                    position: positions.get(operation.cite) ?? operation.position,
                };
            }
        }
        for (const operation of rulings) {
            const slot = operation.type === rulingTypes.Pin ? ScribeReplay.pinSlot(book, operation) : null;
            if (slot !== null) {
                book.pins.set(slot, operation);
            }
        }
        for (const fact of book.facts) {
            const [slot] = ScribeReplay.keys(fact, ScribeCategory.Kind.Fixed);
            if (book.pins.has(slot) && fact.status !== status.Removed) {
                const held = book.held.get(slot) ?? [];
                held.push(fact);
                book.held.set(slot, held);
            }
        }
        ScribeReplay.apply(book, rulings, ScribeReplay.Pinning);
        showings.sort(
            /**
             * @param {{ lastPosition: number, sequence: number, index: number }} first
             * @param {{ lastPosition: number, sequence: number, index: number }} second
             * @return {number}
             */
            (first, second) =>
                first.lastPosition - second.lastPosition ||
                first.sequence - second.sequence ||
                first.index - second.index,
        );
        for (const showing of showings) {
            const operation = showing.operation;
            const replaced = book.scenes.get(operation.first);
            const present = [];
            for (const attendee of replaced === undefined ? [] : replaced.present) {
                present.push({
                    subject: attendee.subject,
                    from: attendee.from,
                    until: Math.min(attendee.until ?? replaced.lastPosition, replaced.lastPosition),
                });
            }
            const kept = present.length;
            for (const attendee of operation.present) {
                const subject = ScribeReplay.resolve(book, attendee.subject);
                if (replaced === undefined) {
                    present.push({ subject, from: attendee.from, until: attendee.until });
                    continue;
                }
                const floor = replaced.lastPosition + 1;
                const from = Math.max(attendee.from ?? showing.firstPosition, floor);
                if (from > (attendee.until ?? showing.lastPosition)) {
                    continue;
                }
                const joined =
                    from === floor
                        ? present.find(
                              /**
                               * @param {{ subject: string, from: number|null, until: number|null }} entry
                               * @return {boolean}
                               */
                              (entry) => entry.subject === subject && entry.until === replaced.lastPosition,
                          )
                        : undefined;
                if (joined === undefined) {
                    present.push({ subject, from, until: attendee.until });
                } else {
                    joined.until = attendee.until;
                }
            }
            for (const entry of present.slice(0, kept)) {
                if (entry.from === showing.firstPosition) {
                    entry.from = null;
                }
                if (entry.until !== null && entry.until >= showing.lastPosition) {
                    entry.until = null;
                }
            }
            const wasPrivate = replaced !== undefined && replaced.reach === ScribeAnswer.Reach.Private;
            book.scenes.set(operation.first, {
                id: operation.first,
                day: operation.day,
                first: operation.first,
                last: operation.last,
                firstPosition: showing.firstPosition,
                lastPosition: showing.lastPosition,
                place: operation.place,
                reach: wasPrivate ? replaced.reach : operation.reach,
                narrowed: false,
                present,
                summary: operation.summary,
                ...(operation.evidence ? { evidence: operation.evidence } : {}),
            });
        }
        const scenes = [...book.scenes.values()].sort(
            /**
             * @param {{ firstPosition: number, lastPosition: number }} first
             * @param {{ firstPosition: number, lastPosition: number }} second
             * @return {number}
             */
            (first, second) => first.firstPosition - second.firstPosition || first.lastPosition - second.lastPosition,
        );
        ScribeReplay.apply(book, rulings, ScribeReplay.Finishing);
        for (const fact of book.facts) {
            if (book.widenings.size === 0 || fact.status === status.Removed) {
                continue;
            }
            const edit = edits.get(fact.id);
            const keys = ScribeReplay.statementKeys(edit ? { ...fact, text: edit.source.book } : fact);
            const ruling = ScribeReplay.latest(book.widenedMarks, keys, book.widenings.get(fact.id));
            if (ruling === undefined) {
                continue;
            }
            if (ruling.operation.to === ScribeLog.Settings.Everyone) {
                fact.widened = ruling.operation.to;
                continue;
            }
            const widened = [];
            for (const id of ruling.operation.to) {
                const subject = ScribeReplay.resolve(book, id);
                if (!widened.includes(subject)) {
                    widened.push(subject);
                }
            }
            fact.widened = widened;
        }
        for (const question of book.questions) {
            const key = questionKeys.get(question.id);
            const previous = activeQuestionCounts.get(key) === 1 && !ambiguousQuestions.has(key)
                ? previousQuestions.get(question.id) : [];
            const answered = ScribeReplay.latest(book.answers, previous, book.answers.get(question.id));
            const dismissed = ScribeReplay.latest(book.dismissals, previous, book.dismissals.get(question.id));
            if (answered !== undefined) {
                question.answer = answered.text;
            }
            question.dismissed = dismissed !== undefined && (answered === undefined || dismissed.order > answered.order);
        }
        const members = new Map();
        for (const id of book.subjects.keys()) {
            const root = ScribeReplay.resolve(book, id);
            if (root !== id) {
                const merged = members.get(root) ?? [];
                merged.push(id);
                members.set(root, merged);
            }
        }
        const kinds = Object.values(ScribeCategory.SubjectKinds);
        const subjects = [];
        const survivors = [];
        const names = [];
        const lengths = [];
        for (const [id, declared] of book.subjects) {
            const name = ScribeLog.name(declared.label);
            const seen = new Set([ScribeText.normaliseName(declared.label), ScribeText.normaliseName(name)]);
            const offered = [];
            for (const mention of book.mentions.get(id) ?? []) {
                const live =
                    mention.fact === null ||
                    mention.fact.status === status.InForce ||
                    mention.fact.status === status.Replaced;
                if (live) {
                    offered.push(mention.text);
                }
            }
            for (const member of members.get(id) ?? []) {
                const label = book.subjects.get(member).label;
                offered.push(label, ScribeLog.name(label));
            }
            const aka = [];
            for (const text of offered) {
                const key = ScribeText.normaliseName(text);
                if (key !== settings.Nothing && !seen.has(key)) {
                    seen.add(key);
                    aka.push(text);
                }
            }
            const assumed = declared.kind === null;
            let kind = assumed ? ScribeCategory.SubjectKinds.Character : declared.kind;
            for (const fact of book.inForce.get(JSON.stringify([id, settings.KindCategory])) ?? []) {
                const stated = fact.text.trim().toLowerCase();
                if (assumed && kinds.includes(stated)) {
                    kind = stated;
                }
            }
            const root = ScribeReplay.resolve(book, id);
            const subject = {
                id,
                label: declared.label,
                ...(declared.evidence ? { evidence: declared.evidence } : {}),
                name,
                kind,
                assumed,
                aka,
                mergedInto: root === id ? null : root,
            };
            subjects.push(subject);
            if (root === id) {
                const normal = ScribeText.normaliseName(name);
                survivors.push(subject);
                names.push(normal);
                lengths.push(Array.from(normal).length);
            }
        }
        const limit = Math.max(ScribeText.Settings.ShortNameDistance, ScribeText.Settings.LongNameDistance);
        const lookAlikes = [];
        for (let later = 0; later < survivors.length; later++) {
            const second = survivors[later];
            const partners = book.pairs.get(second.id);
            for (let earlier = 0; earlier < later; earlier++) {
                const first = survivors[earlier];
                const gap = lengths[later] - lengths[earlier];
                let reason = null;
                if (names[earlier] === names[later]) {
                    reason = likeness.SameName;
                } else if (partners !== undefined && partners.has(first.id)) {
                    reason = likeness.Alias;
                } else if (gap <= limit && gap >= -limit && ScribeText.resembles(first.name, second.name)) {
                    reason = likeness.Spelling;
                }
                if (reason !== null && !book.distinct.has(ScribeReplay.pairKey(book, first.id, second.id))) {
                    lookAlikes.push({ first: first.id, second: second.id, reason });
                }
            }
        }
        const stale = [];
        for (const mark of book.stale.values()) {
            const holders = book.inForce.get(ScribeReplay.targetKey(mark.subject, mark.target));
            if (holders !== undefined && holders.size > 0) {
                stale.push(mark);
            }
        }
        const conflicts = new Map();
        for (const fact of book.facts) {
            if (fact.status !== status.Disputed) {
                continue;
            }
            const [slot] = ScribeReplay.keys(fact, ScribeCategory.Kind.Fixed);
            const dispute = book.pins.get(slot)?.dispute;
            if (book.pinned.has(slot) && (!dispute || dispute.some((item) => item.id === fact.id ||
                (item.cite === fact.cite && ScribeCategory.same(item.text, fact.text))))) {
                continue;
            }
            if (!conflicts.has(slot)) {
                const [holder] = book.inForce.get(slot);
                conflicts.set(slot, {
                    subject: fact.subject,
                    category: fact.category,
                    ...ScribeCategory.scope(fact),
                    target: null,
                    established: holder === undefined ? null : holder.id,
                    others: [],
                });
            }
            conflicts.get(slot).others.push(fact.id);
        }
        const resolved = [];
        for (const issue of decisions) {
            const { correctedBy, ...evidence } = issue;
            const fact = correctedBy ? book.facts.find((row) => edits.get(row.id) === correctedBy && row.text === correctedBy.text)
                : ScribeReplay.supportedFact(book.facts, issue);
            const told = fact && (fact.widened === ScribeLog.Settings.Everyone ||
                fact.widened?.includes(issue.speaker) || fact.told.includes(issue.speaker));
            if (fact && (issue.kind !== 'Leak' || told)) {
                resolved.push({ ...evidence, activeFact: fact.id });
            }
        }
        for (const issue of resolved) {
            if (issue.contradiction !== null && book.contradictions.has(issue.contradiction)) {
                book.contradictions.get(issue.contradiction).dismissed = true;
            }
            const [slot] = ScribeReplay.keys(book.byId.get(issue.activeFact) ?? { ...issue, text: issue.book },
                ScribeCategory.Kind.Fixed);
            const conflict = conflicts.get(slot);
            if (issue.kind !== 'Contradiction' || !conflict) {
                continue;
            }
            conflict.others = conflict.others.filter((id) => {
                const other = book.byId.get(id);
                const holder = book.byId.get(conflict.established);
                return !((conflict.established === issue.activeFact && issue.alternatives.includes(id) &&
                    ScribeCategory.same(other.text, issue.said)) || (id === issue.activeFact && holder &&
                    issue.alternatives.includes(holder.id) && ScribeCategory.same(holder.text, issue.said)));
            });
            if (conflict.others.length === 0) {
                conflicts.delete(slot);
            }
        }
        const contradictions = ScribeReplay.contradictions(book).sort(
            /**
             * @param {{ position: number, earlierPosition: number }} first
             * @param {{ position: number, earlierPosition: number }} second
             * @return {number}
             */
            (first, second) => first.position - second.position || first.earlierPosition - second.earlierPosition,
        );
        const state = ScribeReplay.seal({
            revision: log.revision,
            ...(log.editRun?.through === log.revision ? { editedSince: log.editRun.from } : {}),
            ...(edits.size ? { editOrigins: Object.fromEntries([...edits].map(([id, operation]) => [id, { ...operation.source }])) } : {}),
            subjects,
            facts: book.facts,
            ...(claims.length ? { claims: JSON.parse(JSON.stringify(claims)) } : {}),
            scenes,
            nights: [...book.nights.values()],
            threads: [...book.threads.values()],
            conflicts: [...conflicts.values()],
            lookAlikes,
            stale,
            refinements: book.refinements,
            aliases: book.aliases,
            questions: book.questions,
            unaliased: book.unaliasings,
            distinct: book.distinctions,
            contradictions,
            resolutions: resolved,
            legacyDecisions,
            decisionRead: fingerprints === null ? null : (legacyDecisions.length ? { ...log.read } : {}),
        });
        ScribeReplay.Inputs.set(state, { order, pending, fingerprints });
        return state;
    },
});
