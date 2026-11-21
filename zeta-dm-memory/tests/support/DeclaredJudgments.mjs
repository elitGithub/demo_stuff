export default function declaredJudgments(state, log, replay) {
    const { conflictRows = [], identityPairs = [] } = log.fixtureJudgments ?? {};
    if (!log.fixtureJudgments) {
        return state;
    }
    const conflicts = conflictRows.flatMap(([established, ...others]) => {
        const fact = state.facts.find((row) => row.id === established);
        if (!fact || state.facts.some((row) => row.pinned && row.subject === fact.subject &&
            row.category === fact.category && row.form === fact.form && row.dimension === fact.dimension)) {
            return [];
        }
        return [{ subject: fact.subject, category: fact.category, target: fact.target,
            ...(fact.form ? { form: fact.form, dimension: fact.dimension } : {}), established, others }];
    });
    const lookAlikes = identityPairs.flatMap(([first, second]) => {
        const active = (id) => state.subjects.some((subject) => subject.id === id && subject.mergedInto === null);
        return active(first) && active(second) && !state.distinct.some((pair) => pair.first === first && pair.second === second)
            ? [{ first, second, reason: 'Alias' }] : [];
    });
    const declared = { ...state, conflicts: [...state.conflicts, ...conflicts], lookAlikes: [...state.lookAlikes, ...lookAlikes] };
    replay.Inputs.set(declared, replay.Inputs.get(state));
    return declared;
}
