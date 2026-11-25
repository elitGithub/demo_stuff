import { ScribeAnswer } from './ScribeAnswer.mjs';
import { ScribeCategory } from './ScribeCategory.mjs';
import { ScribeIntakeAdapter } from './ScribeIntakeAdapter.mjs';
import { ScribeKnowledge } from './ScribeKnowledge.mjs';
import { ScribeReplay } from './ScribeReplay.mjs';
import { ScribeText } from './ScribeText.mjs';

export const ScribeLogCore = Object.freeze({
  Reason: Object.freeze({
    Citation: 'Citation',
    Reference: 'Reference',
    Ambiguous: 'Ambiguous',
    Mismatch: 'Mismatch',
    Ruled: 'Ruled',
    Quote: 'Quote',
  }),

  Kind: Object.freeze({
    Update: 'Update',
    Operator: 'Operator',
  }),

  Origin: Object.freeze({
    Story: 'Story',
    Notes: 'Notes',
    Answers: 'Answers',
    Operator: 'Operator',
  }),

  Ruling: Object.freeze({
    Pin: 'Pin',
    Merge: 'Merge',
    Split: 'Split',
    Distinct: 'Distinct',
    Narrow: 'Narrow',
    Widen: 'Widen',
    AddFact: 'AddFact',
    RemoveFact: 'RemoveFact',
    EditFact: 'EditFact',
    Unalias: 'Unalias',
    Answer: 'Answer',
    Dismiss: 'Dismiss',
    DismissContradiction: 'DismissContradiction',
  }),

  Settings: Object.freeze({
    Version: 1,
    FirstNumber: 1,
    FirstRevision: 0,
    LeastPosition: 0,
    Everyone: 'Everyone',
    SubjectPrefix: 'S',
    FactPrefix: 'F',
    ThreadPrefix: 'T',
    QuestionPrefix: 'Q',
    AkaCategory: 'aka',
    Nothing: '',
    Space: ' ',
    OpenBrackets: '([',
    CloseBrackets: ')]',
    AlreadyRead: 'AlreadyRead',
    UnknownOperation: 'UnknownOperation',
    UnknownOrigin: 'UnknownOrigin',
    StaleState: 'StaleState',
    InvalidOperation: 'InvalidOperation',
    EvidenceKeys: Object.freeze(['attribution', 'speaker']),

    /**
     * @returns {RegExp}
     */
    get Blank() {
      return /\s/u;
    },
  }),

  /**
   * @returns {{version: number, nextFact: number, nextSubject: number, nextThread: number, nextQuestion: number, nextSequence: number, revision: number, entries: object[], read: Object<string, number>, notes: string[]}}
   */
  create() {
    const settings = ScribeLogCore.Settings;
    return {
      version: settings.Version,
      nextFact: settings.FirstNumber,
      nextSubject: settings.FirstNumber,
      nextThread: settings.FirstNumber,
      nextQuestion: settings.FirstNumber,
      nextSequence: settings.FirstNumber,
      revision: settings.FirstRevision,
      entries: [],
      read: {},
      notes: [],
    };
  },

  /**
   * @param {string} label
   * @returns {string}
   */
  name(label) {
    const settings = ScribeLogCore.Settings;
    let depth = 0;
    let gap = false;
    let name = settings.Nothing;
    for (const character of label) {
      if (settings.OpenBrackets.includes(character)) {
        depth += 1;
      } else if (depth > 0 && settings.CloseBrackets.includes(character)) {
        depth -= 1;
      } else if (depth === 0 && settings.Blank.test(character)) {
        gap = true;
      } else if (depth === 0) {
        name += (gap && name !== settings.Nothing ? settings.Space : settings.Nothing) + character;
        gap = false;
      }
    }
    return name === settings.Nothing ? label : name;
  },

  /**
   * @param {object} context
   * @param {string} written
   * @param {string} subject
   * @returns {void}
   */
  index(context, written, subject) {
    const holders = context.names.get(written) ?? [];
    if (written && !holders.includes(subject)) {
      context.names.set(written, [...holders, subject]);
    }
  },

  /**
   * @param {object} context
   * @param {string} subject
   * @param {string} label
   * @param {string} name
   * @returns {void}
   */
  enrol(context, subject, label, name) {
    const holders = context.labels.get(label) ?? [];
    if (label && !holders.includes(subject)) {
      context.labels.set(label, [...holders, subject]);
    }
    ScribeLogCore.index(context, name, subject);
  },

  /**
   * @param {object} context
   * @param {string} written
   * @returns {Readonly<{subject: string | null, ambiguous: boolean}>}
   */
  find(context, written) {
    const holders = context.labels.get(written) ?? context.names.get(written) ?? [];
    return Object.freeze({
      subject: holders.length === 1 ? holders[0] : null,
      ambiguous: holders.length > 1,
    });
  },

  /**
   * @param {object} context
   * @param {string} written
   * @param {string} subject
   * @returns {boolean}
   */
  owns(context, written, subject) {
    return (context.labels.get(written) ?? context.names.get(written) ?? []).includes(subject);
  },

  /**
   * @param {object} context
   * @param {{label: string, category: string, target: string | null}} operation
   * @param {object} named
   * @returns {boolean}
   */
  fits(context, operation, named) {
    if (!ScribeLogCore.owns(context, operation.label, named.subject) || operation.category !== named.category) {
      return false;
    }
    const scope = ScribeCategory.scope(operation);
    const original = ScribeCategory.scope(named);
    if ((scope.form && scope.form !== original.form) || (scope.dimension && scope.dimension !== original.dimension)) {
      return false;
    }
    if (named.category !== ScribeCategory.Settings.RelationCategory) {
      return true;
    }
    const written = operation.target === null || operation.target === undefined
      ? ScribeLogCore.Settings.Nothing
      : ScribeText.normaliseName(operation.target);
    const sameText =
      written !== ScribeLogCore.Settings.Nothing &&
      named.targetText !== null &&
      written === ScribeText.normaliseName(named.targetText);
    const sameSubject =
      named.target !== null &&
      operation.target !== null &&
      operation.target !== undefined &&
      ScribeLogCore.find(context, operation.target).subject === named.target;
    return sameText || sameSubject;
  },

  /**
   * @param {object} context
   * @param {string} label
   * @param {string | null} kind
   * @returns {{type: string, subject: string, label: string, kind: string | null}}
   */
  make(context, label, kind) {
    const subject = ScribeLogCore.Settings.SubjectPrefix + context.counters.nextSubject;
    context.counters.nextSubject += 1;
    ScribeLogCore.enrol(context, subject, label, ScribeLogCore.name(label));
    context.subjects.set(subject, { label, kind, assumed: kind === null });
    return { type: ScribeAnswer.Type.Subject, subject, label, kind };
  },

  /**
   * @param {object} context
   * @param {string} label
   * @param {object[]} made
   * @returns {string | null}
   */
  reach(context, label, made) {
    const match = ScribeLogCore.find(context, label);
    if (match.ambiguous || match.subject !== null) {
      return match.subject;
    }
    const subject = ScribeLogCore.make(context, label, null);
    made.push(subject);
    return subject.subject;
  },

  /**
   * @param {object} context
   * @param {object} state
   * @returns {void}
   */
  learn(context, state) {
    for (const subject of state.subjects) {
      if (subject.mergedInto !== null) {
        ScribeLogCore.enrol(context, subject.mergedInto, subject.label, subject.name);
        continue;
      }
      ScribeLogCore.enrol(context, subject.id, subject.label, subject.name);
      for (const aka of subject.aka) {
        ScribeLogCore.index(context, aka, subject.id);
      }
      context.subjects.set(subject.id, { label: subject.label, kind: subject.kind, assumed: subject.assumed });
    }
  },

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  worded(value) {
    return typeof value === 'string' && ScribeAnswer.Settings.HasContent.test(value);
  },

  /**
   * @param {unknown} category
   * @returns {string | null}
   */
  categoryKind(category) {
    for (const [kind, words] of Object.entries(ScribeCategory.Settings.Words)) {
      if (words.includes(category)) {
        return ScribeCategory.Kind[kind];
      }
    }
    return null;
  },

  /**
   * @param {object} state
   * @returns {{state: object, subjects: Map<string, object>, facts: Map<string, object>}}
   */
  view(state) {
    const subjects = new Map();
    const facts = new Map();
    for (const subject of state.subjects) {
      subjects.set(subject.id, subject);
    }
    for (const fact of state.facts) {
      facts.set(fact.id, fact);
    }
    return { state, subjects, facts };
  },

  /**
   * @param {{subjects: Map<string, object>}} view
   * @param {unknown} id
   * @returns {unknown}
   */
  root(view, id) {
    const subject = view.subjects.get(id);
    return subject === undefined || subject.mergedInto === null ? id : subject.mergedInto;
  },

  /**
   * @param {{subjects: Map<string, object>}} view
   * @param {unknown} first
   * @param {unknown} second
   * @returns {string | null}
   */
  twoSubjects(view, first, second) {
    const sameAlready = ScribeLogCore.root(view, first) === ScribeLogCore.root(view, second);
    if (typeof first !== 'string' || typeof second !== 'string' || sameAlready) {
      return ScribeLogCore.Settings.InvalidOperation;
    }
    if (!view.subjects.has(first) || !view.subjects.has(second)) {
      return ScribeLogCore.Reason.Reference;
    }
    return null;
  },

  /**
   * @param {ReadonlyArray<{id: string}>} items
   * @param {string} id
   * @returns {object | undefined}
   */
  lookup(items, id) {
    return items.find((item) => item.id === id);
  },

  /**
   * @param {string} subject
   * @param {string} name
   * @returns {string}
   */
  aliasKey(subject, name) {
    return JSON.stringify([subject, name.toLowerCase()]);
  },

  /**
   * @param {string} first
   * @param {string} second
   * @returns {string}
   */
  pair(first, second) {
    return JSON.stringify(first < second ? [first, second] : [second, first]);
  },

  /**
   * @param {object | undefined} fact
   * @returns {boolean}
   */
  unnamed(fact) {
    return fact !== undefined && (fact.status === ScribeReplay.Status.Removed || fact.made);
  },

  /**
   * @param {unknown} list
   * @returns {boolean}
   */
  ids(list) {
    if (!Array.isArray(list) || list.length === 0 || new Set(list).size !== list.length) {
      return false;
    }
    for (let index = 0; index < list.length; index += 1) {
      if (!Object.hasOwn(list, index) || typeof list[index] !== 'string') {
        return false;
      }
    }
    return true;
  },

  /**
   * @param {object} fact
   * @returns {{subject: string, category: string, target: string | null, targetText: string | null, text: string}}
   */
  mark(fact) {
    return {
      subject: fact.subject,
      category: fact.category,
      ...ScribeCategory.scope(fact),
      target: fact.target,
      targetText: fact.targetText,
      text: fact.text,
    };
  },

  /**
   * @param {object} fact
   * @param {object | null} [state]
   * @returns {object}
   */
  editExpected(fact, state = null) {
    const audience = state ? ScribeKnowledge.audience(state, fact) : null;
    return {
      ...ScribeLogCore.mark(fact),
      cite: fact.cite,
      status: fact.status,
      pinned: fact.pinned,
      ...(state
        ? {
            audience: Array.isArray(audience) ? [...new Set(audience)].sort() : audience,
            fingerprint: ScribeReplay.Inputs.get(state)?.fingerprints?.get(fact.cite) ?? null,
          }
        : {}),
      hidden: fact.hidden,
      widened: Array.isArray(fact.widened) ? [...new Set(fact.widened)].sort() : fact.widened,
      told: [...new Set(fact.told)].sort(),
    };
  },

  /**
   * @param {{nextFact: number}} counters
   * @returns {string}
   */
  nextFactId(counters) {
    const id = ScribeLogCore.Settings.FactPrefix + counters.nextFact;
    counters.nextFact += 1;
    return id;
  },

  Resolvers: Object.freeze({
    /**
     * @param {object} operation
     * @param {object} context
     * @param {{subjects: object[], draft: object | null, checks: object[]}} outcome
     * @returns {string | null}
     */
    Subject(operation, context, outcome) {
      const ids = context.labels.get(operation.label) ?? [];
      const subject =
        ids.find((id) => context.subjects.get(id)?.kind === operation.kind) ??
        ids.find((id) => context.subjects.get(id)?.assumed);
      if (subject === undefined) {
        outcome.draft = ScribeLogCore.make(context, operation.label, operation.kind);
        return null;
      }
      const known = context.subjects.get(subject);
      if (known.assumed) {
        known.kind = operation.kind;
        known.assumed = false;
        outcome.draft = {
          type: ScribeAnswer.Type.Subject,
          subject,
          label: known.label,
          kind: operation.kind,
        };
        return null;
      }
      if (operation.evidence) {
        outcome.draft = { type: operation.type, subject, label: known.label, kind: known.kind };
      }
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} context
     * @param {{subjects: object[], draft: object | null, checks: object[]}} outcome
     * @returns {string | null}
     */
    Alias(operation, context, outcome) {
      const reasons = ScribeLogCore.Reason;
      const cite = context.cites.get(operation.position);
      if (cite === undefined) {
        return reasons.Citation;
      }
      const known = ScribeLogCore.find(context, operation.label);
      if (known.ambiguous) {
        return reasons.Ambiguous;
      }
      if (known.subject === null) {
        return reasons.Reference;
      }
      const named = ScribeLogCore.find(context, operation.name);
      if (named.ambiguous) {
        return reasons.Ambiguous;
      }
      if (named.subject === known.subject) {
        if (operation.evidence) {
          outcome.draft = {
            type: operation.type,
            subject: known.subject,
            name: operation.name,
            cite,
            position: operation.position,
            other: null,
          };
        }
        return null;
      }
      const unaliased = context.unaliased.has(ScribeLogCore.aliasKey(known.subject, operation.name));
      const apart = named.subject !== null && context.distinct.has(ScribeLogCore.pair(known.subject, named.subject));
      if (unaliased || apart) {
        return reasons.Ruled;
      }
      ScribeLogCore.index(context, operation.name, known.subject);
      outcome.checks.push({ written: operation.label, subject: known.subject });
      outcome.draft = {
        type: ScribeAnswer.Type.Alias,
        subject: known.subject,
        name: operation.name,
        cite,
        position: operation.position,
        other: named.subject,
      };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} context
     * @param {{subjects: object[], draft: object | null, checks: object[]}} outcome
     * @returns {string | null}
     */
    Fact(operation, context, outcome) {
      const reasons = ScribeLogCore.Reason;
      const cite = context.cites.get(operation.position);
      if (cite === undefined) {
        return reasons.Citation;
      }
      const subject = ScribeLogCore.reach(context, operation.label, outcome.subjects);
      if (subject === null) {
        return reasons.Ambiguous;
      }
      let other = null;
      if (operation.category === ScribeLogCore.Settings.AkaCategory) {
        const named = ScribeLogCore.find(context, operation.text).subject;
        other = named === subject ? null : named;
        ScribeLogCore.index(context, operation.text, subject);
      }
      outcome.checks.push({ written: operation.label, subject });
      outcome.draft = {
        type: ScribeAnswer.Type.Fact,
        fact: null,
        subject,
        label: operation.label,
        category: operation.category,
        ...ScribeCategory.scope(operation),
        target: null,
        targetText: operation.target,
        other,
        text: operation.text,
        cite,
        position: operation.position,
        hidden: operation.hidden,
      };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} context
     * @param {{subjects: object[], draft: object | null, checks: object[]}} outcome
     * @returns {string | null}
     */
    Refine(operation, context, outcome) {
      const reasons = ScribeLogCore.Reason;
      const cite = context.cites.get(operation.position);
      if (cite === undefined) {
        return reasons.Citation;
      }
      const named = context.facts.get(operation.fact);
      if (named === undefined || ScribeLogCore.unnamed(named)) {
        return reasons.Reference;
      }
      const declared = ScribeLogCore.fits(context, operation, named)
        ? null
        : {
            label: operation.label,
            category: operation.category,
            target: operation.target,
            ...ScribeCategory.scope(operation),
          };
      let other = null;
      if (named.category === ScribeLogCore.Settings.AkaCategory) {
        const found = ScribeLogCore.find(context, operation.text).subject;
        other = found === named.subject ? null : found;
        ScribeLogCore.index(context, operation.text, named.subject);
      }
      const selectedSubject = ScribeLogCore.reach(context, operation.label, outcome.subjects) ?? named.subject;
      outcome.draft = {
        type: operation.type,
        ...(declared ? { declared } : {}),
        ...(selectedSubject !== named.subject ? { changedSubject: true } : {}),
        fact: operation.fact,
        becomes: null,
        subject: selectedSubject,
        label: operation.label,
        category: operation.category,
        ...ScribeCategory.scope(named),
        ...ScribeCategory.scope(operation),
        target: operation.target ? ScribeLogCore.find(context, operation.target).subject : null,
        targetText: operation.target,
        other,
        hidden: named.hidden,
        text: operation.text,
        cite,
        position: operation.position,
      };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} context
     * @param {{subjects: object[], draft: object | null, checks: object[]}} outcome
     * @returns {string | null}
     */
    Change(operation, context, outcome) {
      return ScribeLogCore.Resolvers.Refine(operation, context, outcome);
    },

    /**
     * @param {object} operation
     * @param {object} context
     * @param {{subjects: object[], draft: object | null, checks: object[]}} outcome
     * @returns {string | null}
     */
    End(operation, context, outcome) {
      const reasons = ScribeLogCore.Reason;
      const cite = context.cites.get(operation.position);
      if (cite === undefined) {
        return reasons.Citation;
      }
      const named = context.facts.get(operation.fact);
      if (named === undefined || ScribeLogCore.unnamed(named)) {
        return reasons.Reference;
      }
      const declared = ScribeLogCore.fits(context, operation, named)
        ? null
        : {
            label: operation.label,
            category: operation.category,
            target: operation.target,
            ...ScribeCategory.scope(operation),
          };
      outcome.draft = {
        type: ScribeAnswer.Type.End,
        ...(declared ? { declared } : {}),
        fact: operation.fact,
        ...ScribeCategory.scope(named),
        label: operation.label,
        reason: operation.reason,
        cite,
        position: operation.position,
      };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} context
     * @param {{subjects: object[], draft: object | null, checks: object[]}} outcome
     * @returns {string | null}
     */
    Told(operation, context, outcome) {
      const reasons = ScribeLogCore.Reason;
      const cite = context.cites.get(operation.position);
      if (cite === undefined) {
        return reasons.Citation;
      }
      const named = context.facts.get(operation.fact);
      if (named === undefined || ScribeLogCore.unnamed(named)) {
        return reasons.Reference;
      }
      const owned = ScribeLogCore.owns(context, operation.owner, named.subject);
      const subject = ScribeLogCore.reach(context, operation.label, outcome.subjects);
      if (subject === null) {
        return reasons.Ambiguous;
      }
      outcome.checks.push({ written: operation.label, subject });
      outcome.draft = {
        type: ScribeAnswer.Type.Told,
        ...(!owned ? { declared: { owner: operation.owner, label: operation.label } } : {}),
        fact: operation.fact,
        subject,
        owner: operation.owner,
        label: operation.label,
        cite,
        position: operation.position,
      };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} context
     * @param {{subjects: object[], draft: object | null, checks: object[]}} outcome
     * @returns {string | null}
     */
    Scene(operation, context, outcome) {
      const reasons = ScribeLogCore.Reason;
      const reachesBack = context.before !== null && operation.first === context.before.firstPosition;
      const priorFirst = context.sources.get(operation.first);
      const recordedFirst =
        priorFirst &&
        !priorFirst.attributionPending &&
        Object.hasOwn(context.read, priorFirst.id);
      const first =
        context.sceneCites.get(operation.first) ??
        (recordedFirst
          ? priorFirst.id
          : reachesBack && (!context.story || !priorFirst)
            ? context.before.first
            : undefined);
      const priorLast = context.sources.get(operation.last);
      const recordedLast =
        priorLast &&
        !priorLast.attributionPending &&
        Object.hasOwn(context.read, priorLast.id);
      const last =
        context.sceneCites.get(operation.last) ??
        (recordedLast ? priorLast.id : undefined);
      if (first === undefined || last === undefined) {
        return reasons.Citation;
      }
      for (const attendee of operation.present) {
        for (const position of [attendee.from, attendee.until]) {
          if (position === null || position === undefined) {
            continue;
          }
          const source = context.sources.get(position);
          if (source?.attributionPending) {
            return reasons.Citation;
          }
        }
      }
      const trial = {
        ...context,
        labels: new Map(context.labels),
        names: new Map(context.names),
        counters: { ...context.counters },
      };
      const present = [];
      for (const attendee of operation.present) {
        if (typeof attendee.subject === 'string' && trial.subjects.has(attendee.subject)) {
          const knownSubject = trial.subjects.get(attendee.subject);
          present.push({
            subject: attendee.subject,
            label: attendee.label ?? knownSubject.label,
            from: attendee.from ?? null,
            until: attendee.until ?? null,
          });
          continue;
        }
        const subject = ScribeLogCore.reach(trial, attendee.label, outcome.subjects);
        if (subject === null) {
          return reasons.Ambiguous;
        }
        outcome.checks.push({ written: attendee.label, subject });
        present.push({
          subject,
          label: attendee.label,
          from: attendee.from ?? null,
          until: attendee.until ?? null,
        });
      }
      context.labels = trial.labels;
      context.names = trial.names;
      context.counters = trial.counters;
      const used = context.starts.get(first) ?? new Set();
      const existing = context.scenes.filter((scene) => scene.first === first && !used.has(scene.id));
      const matches = existing.filter((scene) => scene.day === operation.day && scene.place === operation.place);
      let sceneId =
        matches.length === 1
          ? matches[0].id
          : used.size === 0 && existing.length === 1
            ? existing[0].id
            : null;
      if (!sceneId) {
        sceneId = used.size || existing.length ? JSON.stringify([first, context.sequence, used.size]) : first;
      }
      used.add(sceneId);
      context.starts.set(first, used);
      outcome.draft = {
        type: ScribeAnswer.Type.Scene,
        ...(sceneId === first ? {} : { sceneId }),
        day: operation.day,
        first,
        last,
        firstPosition: operation.first,
        lastPosition: operation.last,
        place: operation.place,
        reach: operation.reach,
        present,
        summary: operation.summary,
      };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} context
     * @param {{subjects: object[], draft: object | null, checks: object[]}} outcome
     * @returns {string | null}
     */
    Night(operation, context, outcome) {
      const cite = context.cites.get(operation.position);
      if (cite === undefined) {
        return ScribeLogCore.Reason.Citation;
      }
      outcome.draft = {
        type: ScribeAnswer.Type.Night,
        cite,
        position: operation.position,
        marker: operation.marker,
      };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} context
     * @param {{subjects: object[], draft: object | null, checks: object[]}} outcome
     * @returns {string | null}
     */
    ThreadOpen(operation, context, outcome) {
      const cite = context.cites.get(operation.position);
      if (cite === undefined) {
        return ScribeLogCore.Reason.Citation;
      }
      outcome.draft = {
        type: ScribeAnswer.Type.ThreadOpen,
        thread: null,
        text: operation.text,
        cite,
        position: operation.position,
        ...(typeof operation.subject === 'string' ? { subject: operation.subject } : {}),
      };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} context
     * @param {{subjects: object[], draft: object | null, checks: object[]}} outcome
     * @returns {string | null}
     */
    ThreadClose(operation, context, outcome) {
      const reasons = ScribeLogCore.Reason;
      const cite = context.cites.get(operation.position);
      if (cite === undefined) {
        return reasons.Citation;
      }
      if (!context.threads.has(operation.thread)) {
        return reasons.Reference;
      }
      outcome.draft = {
        type: ScribeAnswer.Type.ThreadClose,
        thread: operation.thread,
        how: operation.how,
        cite,
        position: operation.position,
      };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} context
     * @param {{subjects: object[], draft: object | null, checks: object[]}} outcome
     * @returns {string | null}
     */
    Question(operation, context, outcome) {
      const cite = context.cites.get(operation.position);
      if (cite === undefined) {
        return ScribeLogCore.Reason.Citation;
      }
      outcome.draft = {
        type: ScribeAnswer.Type.Question,
        question: null,
        text: operation.text,
        cite,
        position: operation.position,
      };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} context
     * @param {{subjects: object[], draft: object | null, checks: object[]}} outcome
     * @returns {string | null}
     */
    Contradiction(operation, context, outcome) {
      const cite = context.cites.get(operation.position);
      if (cite === undefined || typeof operation.earlierCite !== 'string') {
        return ScribeLogCore.Reason.Citation;
      }
      outcome.draft = {
        type: ScribeAnswer.Type.Contradiction,
        cite,
        position: operation.position,
        earlier: operation.earlierCite,
        earlierPosition: operation.earlier,
        said: operation.said,
        before: operation.before,
        why: operation.why,
      };
      return null;
    },
  }),

  Finishers: Object.freeze({
    /**
     * @param {object} draft
     * @param {object} context
     * @returns {void}
     */
    Fact(draft, context) {
      if (draft.targetText !== null) {
        draft.target = ScribeLogCore.find(context, draft.targetText).subject;
      }
      draft.fact = ScribeLogCore.Settings.FactPrefix + context.counters.nextFact;
      context.counters.nextFact += 1;
    },

    /**
     * @param {object} draft
     * @param {object} context
     * @returns {void}
     */
    Refine(draft, context) {
      draft.becomes = ScribeLogCore.Settings.FactPrefix + context.counters.nextFact;
      context.counters.nextFact += 1;
    },

    /**
     * @param {object} draft
     * @param {object} context
     * @returns {void}
     */
    Change(draft, context) {
      ScribeLogCore.Finishers.Refine(draft, context);
    },

    /**
     * @param {object} draft
     * @param {object} context
     * @returns {void}
     */
    ThreadOpen(draft, context) {
      draft.thread = ScribeLogCore.Settings.ThreadPrefix + context.counters.nextThread;
      context.counters.nextThread += 1;
    },

    /**
     * @param {object} draft
     * @param {object} context
     * @returns {void}
     */
    Question(draft, context) {
      draft.question = ScribeLogCore.Settings.QuestionPrefix + context.counters.nextQuestion;
      context.counters.nextQuestion += 1;
    },
  }),

  Rulers: Object.freeze({
    /**
     * @param {object} operation
     * @param {object} view
     * @param {object} outcome
     * @returns {string | null}
     */
    EditFact(operation, view, outcome) {
      const fact = view.facts.get(operation.fact);
      if (!ScribeReplay.live(fact) || !operation.expected) {
        return ScribeLogCore.Settings.StaleState;
      }
      const expected = ScribeLogCore.editExpected(
        fact,
        Object.hasOwn(operation.expected, 'audience') ? view.state : null,
      );
      if (Object.keys(expected).some((key) => JSON.stringify(expected[key]) !== JSON.stringify(operation.expected[key]))) {
        return ScribeLogCore.Settings.StaleState;
      }
      if (!ScribeLogCore.worded(operation.text)) {
        return 'Write the corrected wording.';
      }
      const text = operation.text.trim();
      const scope = ScribeCategory.scope(fact);
      if (text === fact.text) {
        return null;
      }
      const source = view.state.editOrigins?.[fact.id] ?? {
        fact: fact.id,
        cite: fact.cite,
        subject: fact.subject,
        category: fact.category,
        target: fact.target,
        targetText: fact.targetText,
        ...ScribeCategory.scope(fact),
        book: fact.text,
        sourcePrint: null,
      };
      outcome.stored = { type: operation.type, fact: fact.id, before: fact.text, text, ...scope, source: { ...source } };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} view
     * @param {{counters: object, stored: object | null}} outcome
     * @returns {string | null}
     */
    Pin(operation, view, outcome) {
      const { subject, category, target, text, hidden } = operation;
      const fixed = ScribeLogCore.categoryKind(category) === ScribeCategory.Kind.Fixed;
      const valid =
        typeof subject === 'string' &&
        fixed &&
        target === null &&
        ScribeLogCore.worded(text) &&
        [operation.form, operation.dimension].every((part) => part == null || ScribeLogCore.worded(part)) &&
        typeof hidden === 'boolean';
      if (!valid) {
        return ScribeLogCore.Settings.InvalidOperation;
      }
      if (!view.subjects.has(subject)) {
        return ScribeLogCore.Reason.Reference;
      }
      const owner = ScribeLogCore.root(view, subject);
      const winner = view.state.facts.find((fact) => {
        return (
          fact.subject === owner &&
          fact.category === category &&
          ScribeCategory.sameScope(fact, operation) &&
          ScribeReplay.live(fact) &&
          !ScribeLogCore.unnamed(fact) &&
          ScribeCategory.value(fact) === ScribeCategory.value(operation)
        );
      });
      const source =
        winner ??
        view.state.facts.find((fact) => {
          return (
            fact.made &&
            fact.subject === owner &&
            fact.category === category &&
            ScribeCategory.sameScope(fact, operation) &&
            fact.status === ScribeReplay.Status.InForce &&
            ScribeCategory.value(fact) === ScribeCategory.value(operation)
          );
        });
      outcome.stored = {
        type: operation.type,
        subject,
        category,
        ...ScribeCategory.scope(operation),
        target: null,
        text,
        hidden: winner === undefined ? hidden : winner.hidden,
        fact: ScribeLogCore.nextFactId(outcome.counters),
        winner: winner === undefined ? null : winner.id,
        told: source === undefined ? [] : [...source.told],
        origin: source === undefined ? ScribeLogCore.Origin.Operator : source.origin,
        cite: source === undefined ? null : source.cite,
        position: source === undefined ? ScribeReplay.Settings.PinnedPosition : source.position,
        ...(source?.evidence ? { evidence: source.evidence } : {}),
      };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} view
     * @param {{counters: object, stored: object | null}} outcome
     * @returns {string | null}
     */
    Merge(operation, view, outcome) {
      const { from, into } = operation;
      if (ScribeLogCore.root(view, from) !== from) {
        return ScribeLogCore.Settings.InvalidOperation;
      }
      const reason = ScribeLogCore.twoSubjects(view, from, into);
      if (reason === null) {
        outcome.stored = { type: operation.type, from, into };
      }
      return reason;
    },

    /**
     * @param {object} operation
     * @param {object} view
     * @param {{counters: object, stored: object | null}} outcome
     * @returns {string | null}
     */
    Split(operation, view, outcome) {
      const settings = ScribeLogCore.Settings;
      const reasons = ScribeLogCore.Reason;
      const { subject, label, kind, facts } = operation;
      const listing = ScribeLogCore.ids(facts) && !facts.some((id) => ScribeLogCore.unnamed(view.facts.get(id)));
      const valid =
        typeof subject === 'string' &&
        typeof label === 'string' &&
        label.length <= ScribeAnswer.Settings.MaxLabel &&
        ScribeLogCore.worded(ScribeText.normaliseName(label)) &&
        Object.values(ScribeCategory.SubjectKinds).includes(kind) &&
        listing;
      if (!valid) {
        return settings.InvalidOperation;
      }
      if (!view.subjects.has(subject)) {
        return reasons.Reference;
      }
      const owner = ScribeLogCore.root(view, subject);
      for (const id of facts) {
        const fact = view.facts.get(id);
        if (fact === undefined || fact.subject !== owner) {
          return reasons.Reference;
        }
      }
      const context = { labels: new Map(), names: new Map(), subjects: new Map() };
      ScribeLogCore.learn(context, view.state);
      const found = ScribeLogCore.find(context, label);
      if (found.ambiguous || found.subject !== null) {
        return reasons.Ambiguous;
      }
      const becomes = settings.SubjectPrefix + outcome.counters.nextSubject;
      outcome.counters.nextSubject += 1;
      outcome.stored = { type: operation.type, subject, label, kind, facts: [...facts], becomes };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} view
     * @param {{counters: object, stored: object | null}} outcome
     * @returns {string | null}
     */
    Distinct(operation, view, outcome) {
      const { first, second } = operation;
      const reason = ScribeLogCore.twoSubjects(view, first, second);
      if (reason === null) {
        outcome.stored = { type: operation.type, first, second };
      }
      return reason;
    },

    /**
     * @param {object} operation
     * @param {object} view
     * @param {{counters: object, stored: object | null}} outcome
     * @returns {string | null}
     */
    Narrow(operation, view, outcome) {
      const { scene } = operation;
      if (typeof scene !== 'string') {
        return ScribeLogCore.Settings.InvalidOperation;
      }
      if (ScribeLogCore.lookup(view.state.scenes, scene) === undefined) {
        return ScribeLogCore.Reason.Reference;
      }
      outcome.stored = { type: operation.type, scene };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} view
     * @param {{counters: object, stored: object | null}} outcome
     * @returns {string | null}
     */
    Widen(operation, view, outcome) {
      const { fact, to } = operation;
      const everyone = to === ScribeLogCore.Settings.Everyone;
      const named = view.facts.get(fact);
      if (
        typeof fact !== 'string' ||
        (!everyone && !ScribeLogCore.ids(to)) ||
        (named !== undefined && named.status === ScribeReplay.Status.Removed)
      ) {
        return ScribeLogCore.Settings.InvalidOperation;
      }
      const known = everyone || to.every((id) => view.subjects.has(id));
      if (named === undefined || !known) {
        return ScribeLogCore.Reason.Reference;
      }
      outcome.stored = {
        type: operation.type,
        fact,
        to: everyone ? to : [...to],
        mark: ScribeLogCore.mark(named),
      };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} view
     * @param {{counters: object, stored: object | null}} outcome
     * @returns {string | null}
     */
    AddFact(operation, view, outcome) {
      const settings = ScribeLogCore.Settings;
      const { subject, category, target, text, hidden, cite, position, evidence, reported, audience } = operation;
      const relation = category === ScribeCategory.Settings.RelationCategory;
      const reportable = reported === undefined || reported === true;
      const audible =
        audience === undefined ||
        (Array.isArray(audience) &&
          audience.length > 0 &&
          new Set(audience).size === audience.length &&
          audience.every((listener) => {
            return typeof listener === 'string' && listener.trim().length > 0 && view.subjects.has(listener);
          }));
      const attested =
        evidence === undefined ||
        (evidence !== null &&
          typeof evidence === 'object' &&
          !Array.isArray(evidence) &&
          Object.keys(evidence).length === settings.EvidenceKeys.length &&
          settings.EvidenceKeys.every((key) => Object.hasOwn(evidence, key)) &&
          ScribeAnswer.Settings.Attributions.includes(evidence.attribution) &&
          typeof evidence.speaker === 'string' &&
          evidence.speaker.trim().length > 0);
      const valid =
        typeof subject === 'string' &&
        typeof category === 'string' &&
        Boolean(ScribeCategory.parse(category)) &&
        (relation ? typeof target === 'string' : target === null) &&
        ScribeLogCore.worded(text) &&
        typeof hidden === 'boolean' &&
        (cite === null || typeof cite === 'string') &&
        Number.isSafeInteger(position) &&
        position >= settings.LeastPosition &&
        attested &&
        reportable &&
        audible;
      if (!valid) {
        return settings.InvalidOperation;
      }
      const aimed = relation ? view.subjects.get(target) : undefined;
      if (!view.subjects.has(subject) || (relation && aimed === undefined)) {
        return ScribeLogCore.Reason.Reference;
      }
      outcome.stored = {
        type: operation.type,
        subject,
        category,
        target,
        targetText: relation ? view.subjects.get(target).label : null,
        text,
        hidden,
        cite,
        position,
        fact: ScribeLogCore.nextFactId(outcome.counters),
        ...(evidence === undefined ? {} : { evidence: { attribution: evidence.attribution, speaker: evidence.speaker } }),
        ...(reported === true ? { reported: true } : {}),
        ...(audience === undefined ? {} : { audience: [...audience] }),
      };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} view
     * @param {{counters: object, stored: object | null}} outcome
     * @returns {string | null}
     */
    RemoveFact(operation, view, outcome) {
      const { fact } = operation;
      const named = view.facts.get(fact);
      if (typeof fact !== 'string' || ScribeLogCore.unnamed(named)) {
        return ScribeLogCore.Settings.InvalidOperation;
      }
      if (named === undefined) {
        return ScribeLogCore.Reason.Reference;
      }
      outcome.stored = { type: operation.type, fact, mark: ScribeLogCore.mark(named) };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} view
     * @param {{counters: object, stored: object | null}} outcome
     * @returns {string | null}
     */
    Unalias(operation, view, outcome) {
      const { subject, name } = operation;
      if (typeof subject !== 'string' || typeof name !== 'string') {
        return ScribeLogCore.Settings.InvalidOperation;
      }
      const owner = ScribeLogCore.root(view, subject);
      const key = name.toLowerCase();
      const held = view.state.aliases.some((item) => item.subject === owner && item.name.toLowerCase() === key);
      if (!view.subjects.has(subject) || !held) {
        return ScribeLogCore.Reason.Reference;
      }
      outcome.stored = { type: operation.type, subject, name };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} view
     * @param {{counters: object, stored: object | null}} outcome
     * @returns {string | null}
     */
    Answer(operation, view, outcome) {
      const { question, text } = operation;
      if (typeof question !== 'string' || !ScribeLogCore.worded(text)) {
        return ScribeLogCore.Settings.InvalidOperation;
      }
      const asked = ScribeLogCore.lookup(view.state.questions, question);
      if (asked === undefined) {
        return ScribeLogCore.Reason.Reference;
      }
      outcome.stored = { type: operation.type, question, text, questionText: asked.text };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} view
     * @param {{counters: object, stored: object | null}} outcome
     * @returns {string | null}
     */
    Dismiss(operation, view, outcome) {
      const { question } = operation;
      if (typeof question !== 'string') {
        return ScribeLogCore.Settings.InvalidOperation;
      }
      const asked = ScribeLogCore.lookup(view.state.questions, question);
      if (asked === undefined) {
        return ScribeLogCore.Reason.Reference;
      }
      outcome.stored = { type: operation.type, question, questionText: asked.text };
      return null;
    },

    /**
     * @param {object} operation
     * @param {object} view
     * @param {{counters: object, stored: object | null}} outcome
     * @returns {string | null}
     */
    DismissContradiction(operation, view, outcome) {
      const { contradiction } = operation;
      if (typeof contradiction !== 'string') {
        return ScribeLogCore.Settings.InvalidOperation;
      }
      const read = ScribeLogCore.lookup(view.state.contradictions, contradiction);
      if (read === undefined) {
        return ScribeLogCore.Reason.Reference;
      }
      outcome.stored = { type: operation.type, contradiction, said: read.said, before: read.before };
      return null;
    },
  }),

  /**
   * @param {object} log
   * @param {object} state
   * @param {readonly object[]} operations
   * @param {{messages: readonly object[], origin: string, sources?: ReadonlyMap<number, object>, results?: ReadonlyMap<number, string>}} stretch
   * @returns {Readonly<{entry: object, refused: ReadonlyArray<Readonly<{operation: object, reason: string}>>}>}
   * @throws {Error}
   */
  append(log, state, operations, stretch) {
    const settings = ScribeLogCore.Settings;
    const origins = ScribeLogCore.Origin;
    if (
      stretch.origin !== origins.Story &&
      stretch.origin !== origins.Notes &&
      stretch.origin !== origins.Answers
    ) {
      throw new Error(settings.UnknownOrigin);
    }
    if (state.revision !== log.revision) {
      throw new Error(settings.StaleState);
    }
    const story = stretch.origin === origins.Story;
    const sources = stretch.sources ?? new Map(stretch.messages.map((message) => [message.position, message]));
    const messageIds = [];
    const cites = new Map();
    const sceneCites = new Map();
    let earliest = Number.POSITIVE_INFINITY;
    for (const message of stretch.messages) {
      if (message.attributionPending) {
        continue;
      }
      if (typeof message.id === 'string' && message.id.length > 0) {
        messageIds.push(message.id);
      }
      sceneCites.set(message.position, message.id ?? null);
      if (!story || message.text !== settings.Nothing) {
        cites.set(message.position, message.id ?? null);
      }
      earliest = Math.min(earliest, message.position);
    }
    let before = null;
    for (const scene of state.scenes) {
      const running =
        before === null ||
        scene.lastPosition > before.lastPosition ||
        (scene.lastPosition === before.lastPosition && scene.firstPosition > before.firstPosition);
      if (scene.firstPosition < earliest && running) {
        before = scene;
      }
    }
    if (story) {
      for (const id of messageIds) {
        if (Object.hasOwn(log.read, id)) {
          throw new Error(settings.AlreadyRead);
        }
      }
    }
    const unaliased = new Set();
    for (const item of state.unaliased) {
      unaliased.add(ScribeLogCore.aliasKey(item.subject, item.name));
    }
    const distinct = new Set();
    for (const item of state.distinct) {
      distinct.add(ScribeLogCore.pair(item.first, item.second));
    }
    const settled = new Map();
    let context = null;
    let results = [];
    let unsettled = true;
    while (unsettled) {
      context = {
        cites,
        sceneCites,
        sources,
        story,
        before,
        earliest,
        read: log.read,
        unaliased,
        distinct,
        starts: new Map(),
        scenes: state.scenes,
        sequence: log.nextSequence,
        facts: new Map(),
        threads: new Set(),
        labels: new Map(),
        names: new Map(),
        subjects: new Map(),
        counters: {
          nextSubject: log.nextSubject,
          nextFact: log.nextFact,
          nextThread: log.nextThread,
          nextQuestion: log.nextQuestion,
        },
      };
      for (const fact of state.facts) {
        context.facts.set(fact.id, fact);
      }
      for (const thread of state.threads) {
        context.threads.add(thread.id);
      }
      ScribeLogCore.learn(context, state);
      results = [];
      for (const [index, operation] of operations.entries()) {
        if (!Object.hasOwn(ScribeLogCore.Resolvers, operation.type)) {
          throw new Error(settings.UnknownOperation);
        }
        const outcome = { subjects: [], draft: null, checks: [] };
        const evidence = operation.evidence;
        const wrongSource =
          evidence &&
          (cites.get(evidence.messageNumber) !== evidence.messageId ||
            sources.get(evidence.messageNumber)?.fingerprint !== evidence.fingerprint ||
            (operation.position !== undefined && operation.position !== evidence.messageNumber));
        const reason = wrongSource
          ? ScribeLogCore.Reason.Citation
          : settled.get(index) ?? ScribeLogCore.Resolvers[operation.type](operation, context, outcome);
        results.push({ operation, outcome, reason });
      }
      let refusedAtEnd = false;
      for (const [index, { outcome, reason }] of results.entries()) {
        const shifted =
          reason === null &&
          outcome.checks.some((check) => ScribeLogCore.find(context, check.written).subject !== check.subject);
        if (shifted) {
          settled.set(index, ScribeLogCore.Reason.Ambiguous);
          refusedAtEnd = true;
        }
      }
      unsettled = refusedAtEnd;
    }
    const resolved = [];
    const refused = [];
    for (const { operation, outcome, reason } of results) {
      if (reason !== null) {
        refused.push(Object.freeze({ operation, reason }));
        continue;
      }
      for (const subject of outcome.subjects) {
        if (operation.evidence) {
          subject.cite = operation.evidence.messageId;
        }
        resolved.push(subject);
      }
      if (outcome.draft === null) {
        continue;
      }
      if (operation.evidence) {
        outcome.draft.evidence = outcome.draft.declared
          ? { ...operation.evidence, declared: outcome.draft.declared }
          : operation.evidence;
        outcome.draft.cite ??= operation.evidence.messageId;
      }
      if (Object.hasOwn(ScribeLogCore.Finishers, outcome.draft.type)) {
        ScribeLogCore.Finishers[outcome.draft.type](outcome.draft, context);
      }
      resolved.push(outcome.draft);
    }
    const entry = {
      sequence: log.nextSequence,
      kind: ScribeLogCore.Kind.Update,
      origin: stretch.origin,
      messageIds: story ? messageIds : [],
      operations: resolved,
      withdrawn: false,
    };
    if (story && stretch.results) {
      entry.sources = stretch.messages.map((message) => ({
        id: message.id,
        position: message.position,
        fingerprint: message.fingerprint,
        result: stretch.results.get(message.position),
      }));
    }
    Object.assign(log, context.counters);
    log.nextSequence += 1;
    log.revision += 1;
    log.entries.push(entry);
    for (const id of entry.messageIds) {
      log.read[id] = entry.sequence;
    }
    return Object.freeze({ entry, refused: Object.freeze(refused) });
  },

  /**
   * @param {object} log
   * @param {object} operation
   * @returns {object}
   */
  file(log, operation) {
    const entry = {
      sequence: log.nextSequence,
      kind: ScribeLogCore.Kind.Operator,
      origin: ScribeLogCore.Origin.Operator,
      messageIds: [],
      operations: [operation],
      withdrawn: false,
    };
    log.nextSequence += 1;
    if (operation.type === ScribeLogCore.Ruling.EditFact) {
      ScribeLogCore.noteEdit(log);
    }
    log.revision += 1;
    log.entries.push(entry);
    return entry;
  },

  /**
   * @param {object} log
   * @returns {void}
   */
  noteEdit(log) {
    const from = log.editRun?.through === log.revision ? log.editRun.from : log.revision;
    log.editRun = { from, through: log.revision + 1 };
  },

  /**
   * @param {object} operation
   * @param {object} issue
   * @returns {boolean}
   */
  settles(operation, issue) {
    const ruling = ScribeLogCore.Ruling;
    const type = ScribeAnswer.Type;
    if (issue.kind === 'Leak') {
      if (operation.type === type.Told) {
        return operation.fact === issue.fact && operation.subject === issue.speaker;
      }
      return (
        operation.type === ruling.Widen &&
        operation.fact === issue.fact &&
        (operation.to === ScribeLogCore.Settings.Everyone || operation.to.includes(issue.speaker))
      );
    }
    if (issue.kind !== 'Contradiction') {
      return false;
    }
    if (operation.type === ruling.DismissContradiction) {
      return operation.contradiction === issue.contradiction;
    }
    if (operation.type === ruling.RemoveFact) {
      return operation.fact === issue.fact;
    }
    if (operation.type === ruling.EditFact) {
      return (
        operation.fact === issue.fact &&
        operation.before === issue.book &&
        ScribeCategory.same(operation.text, issue.said)
      );
    }
    if (operation.type === type.End) {
      const said = ScribeReplay.wording(issue.said);
      return (
        operation.fact === issue.fact &&
        operation.cite === issue.message &&
        said.length > 0 &&
        (' ' + ScribeReplay.wording(operation.reason) + ' ').includes(' ' + said + ' ')
      );
    }
    if (
      operation.subject !== issue.subject ||
      operation.category !== issue.category ||
      !ScribeCategory.sameScope(operation, { ...issue, text: issue.book }) ||
      operation.target !== issue.target ||
      (operation.target === null && operation.targetText && operation.targetText !== issue.targetText)
    ) {
      return false;
    }
    if (operation.type === ruling.Pin) {
      return (
        operation.winner === issue.fact ||
        ScribeCategory.same(operation.text, issue.said) ||
        (operation.dispute?.some((fact) => fact.id === issue.fact) &&
          operation.dispute.some((fact) => fact.cite === issue.message && ScribeCategory.same(fact.text, issue.said)))
      );
    }
    return (
      [type.Fact, type.Refine, type.Change, ruling.AddFact].includes(operation.type) &&
      (![type.Refine, type.Change].includes(operation.type) || operation.fact === issue.fact) &&
      (ScribeCategory.same(operation.text, issue.said) || ScribeCategory.same(operation.text, issue.book))
    );
  },

  /**
   * @param {object} entry
   * @param {object} state
   * @param {object[]} findings
   * @param {readonly object[]} messages
   * @returns {void}
   */
  link(entry, state, findings, messages) {
    const sources = new Map(messages.map((message) => [message.id, message]));
    const issues = [];
    for (const finding of findings) {
      const fact = ScribeLogCore.lookup(state.facts, finding.fact);
      const reply = sources.get(finding.message);
      if (
        !fact ||
        !reply ||
        reply.fromPlayer ||
        reply.attributionPending ||
        reply.fingerprint !== finding.fingerprint ||
        fact.subject !== finding.subject ||
        fact.category !== finding.category ||
        typeof finding.book !== 'string' ||
        !ScribeCategory.same(fact.text, finding.book) ||
        typeof finding.said !== 'string' ||
        !ScribeReplay.wording(finding.said) ||
        !reply.blocks.some((block) => {
          if (finding.kind === 'Leak') {
            const speaker = ScribeLogCore.lookup(state.subjects, finding.speaker);
            if (
              !speaker ||
              block.role !== ScribeIntakeAdapter.Role.Character ||
              ![speaker.label, speaker.name, ...speaker.aka].some((name) => {
                return ScribeText.normaliseName(name) === ScribeText.normaliseName(block.speaker);
              })
            ) {
              return false;
            }
          }
          return (' ' + ScribeReplay.wording(block.text) + ' ').includes(' ' + ScribeReplay.wording(finding.said) + ' ');
        })
      ) {
        continue;
      }
      const source = sources.get(fact.cite);
      if (fact.cite !== null && (!source || source.attributionPending)) {
        continue;
      }
      if (finding.support && (finding.support.cite !== fact.cite || finding.support.sourcePrint !== source?.fingerprint)) {
        continue;
      }
      const conflict = state.contradictions.find((item) => {
        return (
          item.cite === reply.id &&
          item.earlier === fact.cite &&
          ScribeCategory.same(item.said, finding.said) &&
          ScribeCategory.same(item.before, fact.text)
        );
      });
      issues.push({
        kind: finding.kind,
        fact: fact.id,
        subject: fact.subject,
        category: fact.category,
        ...ScribeCategory.scope(fact),
        target: fact.target,
        targetText: fact.targetText,
        book: fact.text,
        said: finding.said,
        speaker: finding.speaker ?? null,
        message: reply.id,
        fingerprint: reply.fingerprint,
        cite: fact.cite,
        sourcePrint: source?.fingerprint ?? null,
        contradiction: conflict?.id ?? null,
      });
    }
    for (const operation of entry.operations) {
      const ruling = ScribeLogCore.Ruling;
      if (operation.type === ruling.EditFact && operation.source.sourcePrint === null && operation.source.cite !== null) {
        operation.source.sourcePrint = sources.get(operation.source.cite)?.fingerprint ?? null;
      }
      if (operation.type === ruling.Widen) {
        for (const prior of state.resolutions) {
          const { sequence, alternatives, activeFact, ...issue } = prior;
          issue.fact = activeFact;
          if (
            ScribeLogCore.settles(operation, issue) &&
            !issues.some((candidate) => {
              return (
                candidate.kind === issue.kind &&
                candidate.fact === issue.fact &&
                candidate.message === issue.message &&
                candidate.speaker === issue.speaker
              );
            })
          ) {
            issues.push(issue);
          }
        }
      }
      let ids = [];
      if ([ruling.Answer, ruling.Dismiss].includes(operation.type)) {
        const question = ScribeLogCore.lookup(state.questions, operation.question);
        ids = [question.cite];
      } else if (operation.type === ruling.DismissContradiction) {
        const contradiction = ScribeLogCore.lookup(state.contradictions, operation.contradiction);
        ids = [contradiction.cite, contradiction.earlier];
      } else if (operation.type === ruling.Pin) {
        const conflict = state.conflicts.find((item) => {
          return (
            item.subject === operation.subject &&
            item.category === operation.category &&
            ScribeCategory.sameScope(item, operation)
          );
        });
        if (conflict) {
          operation.dispute = [conflict.established, ...conflict.others].filter(Boolean).map((id) => {
            const fact = ScribeLogCore.lookup(state.facts, id);
            return { id, cite: fact.cite, text: fact.text, ...ScribeCategory.scope(fact) };
          });
          ids = operation.dispute.map((fact) => fact.cite);
        }
      }
      const passages = [...new Set(ids)].filter((id) => sources.has(id));
      if (passages.length > 0) {
        operation.passages = passages.map((id) => ({ id, fingerprint: sources.get(id).fingerprint }));
      }
      const linked = issues.filter((issue) => ScribeLogCore.settles(operation, issue));
      if (linked.length > 0) {
        operation.resolutions = linked.map((issue) => {
          const alternatives = state.facts
            .filter((fact) => {
              return (
                fact.subject === issue.subject &&
                fact.category === issue.category &&
                fact.cite === issue.message &&
                ScribeCategory.sameScope(fact, { ...issue, text: issue.book }) &&
                ScribeCategory.same(fact.text, issue.said)
              );
            })
            .map((fact) => fact.id);
          if ([ScribeAnswer.Type.Fact, ScribeLogCore.Ruling.AddFact].includes(operation.type)) {
            alternatives.push(operation.fact);
          }
          return { ...issue, alternatives };
        });
      }
    }
    entry.linked = true;
  },

  /**
   * @param {object} log
   * @param {object} state
   * @param {object} operation
   * @returns {object | null}
   * @throws {Error}
   */
  rule(log, state, operation) {
    const settings = ScribeLogCore.Settings;
    if (state.revision !== log.revision) {
      throw new Error(settings.StaleState);
    }
    if (operation === null || typeof operation !== 'object' || !Object.hasOwn(ScribeLogCore.Ruling, operation.type)) {
      throw new Error(settings.UnknownOperation);
    }
    const outcome = { counters: { nextFact: log.nextFact, nextSubject: log.nextSubject }, stored: null };
    const reason = ScribeLogCore.Rulers[operation.type](operation, ScribeLogCore.view(state), outcome);
    if (reason !== null) {
      throw new Error(reason);
    }
    if (outcome.stored === null) {
      return null;
    }
    if ([ScribeLogCore.Ruling.Widen, ScribeLogCore.Ruling.RemoveFact].includes(operation.type) && state.editOrigins?.[operation.fact]) {
      outcome.stored.editedSource = { ...state.editOrigins[operation.fact] };
    }
    if (operation.type === ScribeLogCore.Ruling.Pin && state.editOrigins?.[outcome.stored.winner]) {
      outcome.stored.editedSource = { ...state.editOrigins[outcome.stored.winner] };
    }
    if (operation.type === ScribeLogCore.Ruling.EditFact) {
      const inputs = ScribeReplay.Inputs.get(state);
      if (!inputs) {
        throw new Error(settings.StaleState);
      }
      const { order, pending, fingerprints, messages } = inputs;
      const source = outcome.stored.source;
      source.sourcePrint ??= fingerprints?.get(source.cite) ?? null;
      const preview = { ...log, entries: [...log.entries] };
      ScribeLogCore.file(preview, outcome.stored);
      const after = ScribeReplay.run(preview, order, pending, fingerprints, null, null, messages);
      const retained = new Set(after.facts.map((fact) => fact.id));
      if (
        state.facts.some((fact) => !retained.has(fact.id)) ||
        !after.facts.some((fact) => fact.id === operation.fact && fact.text === outcome.stored.text)
      ) {
        throw new Error('This wording would combine two facts. Choose distinct wording.');
      }
    }
    Object.assign(log, outcome.counters);
    return ScribeLogCore.file(log, outcome.stored);
  },

  /**
   * @param {object} log
   * @param {object} state
   * @returns {readonly object[]}
   * @throws {Error}
   */
  keepFirst(log, state) {
    if (state.revision !== log.revision) {
      throw new Error(ScribeLogCore.Settings.StaleState);
    }
    const facts = ScribeLogCore.view(state).facts;
    const counters = { nextFact: log.nextFact };
    const pins = [];
    for (const conflict of state.conflicts) {
      if (conflict.established === null) {
        continue;
      }
      const fact = facts.get(conflict.established);
      pins.push({
        type: ScribeLogCore.Ruling.Pin,
        subject: fact.subject,
        category: fact.category,
        ...ScribeCategory.scope(fact),
        target: null,
        text: fact.text,
        hidden: fact.hidden,
        fact: ScribeLogCore.nextFactId(counters),
        winner: fact.id,
        told: [...fact.told],
        origin: fact.origin,
        cite: fact.cite,
        position: fact.position,
      });
    }
    log.nextFact = counters.nextFact;
    const entries = [];
    for (const pin of pins) {
      entries.push(ScribeLogCore.file(log, pin));
    }
    return Object.freeze(entries);
  },

  /**
   * @param {object} log
   * @param {ReadonlySet<string>} ids
   * @returns {Set<string>}
   */
  withdrawSources(log, ids) {
    const freed = new Set();
    for (const entry of log.entries) {
      if (entry.withdrawn || entry.origin !== ScribeLogCore.Origin.Story) {
        continue;
      }
      if (entry.messageIds.length > 0) {
        const active = entry.messageIds.filter((id) => log.read[id] === entry.sequence);
        const retired = active.filter((id) => ids.has(id));
        if (retired.length === 0) {
          continue;
        }
        for (const id of retired) {
          freed.add(id);
          delete log.read[id];
        }
        if (retired.length === active.length) {
          entry.withdrawn = true;
        } else {
          entry.retired = [...(entry.retired ?? []), ...retired];
        }
        log.revision += 1;
        continue;
      }
      const alreadyRetired = new Set(entry.retired ?? []);
      const newlyRetired = [];
      let remainingActive = 0;
      for (const operation of entry.operations) {
        if (operation.revoked === true) {
          continue;
        }
        const cites = [operation.cite, operation.first, operation.last].filter(
          (value) => typeof value === 'string' && value.length > 0,
        );
        if (cites.some((value) => alreadyRetired.has(value))) {
          continue;
        }
        const matched = cites.filter((value) => ids.has(value));
        if (matched.length > 0) {
          for (const value of matched) {
            if (!alreadyRetired.has(value)) {
              alreadyRetired.add(value);
              newlyRetired.push(value);
            }
            freed.add(value);
          }
        } else {
          remainingActive += 1;
        }
      }
      if (newlyRetired.length > 0) {
        entry.retired = [...(entry.retired ?? []), ...newlyRetired];
        if (remainingActive === 0) {
          entry.withdrawn = true;
        }
        log.revision += 1;
      }
    }
    return freed;
  },

  /**
   * @param {object} log
   * @param {string} messageId
   * @returns {readonly string[] | null}
   */
  withdraw(log, messageId) {
    let found = null;
    for (const entry of log.entries) {
      const story = entry.kind === ScribeLogCore.Kind.Update && entry.origin === ScribeLogCore.Origin.Story;
      if (story && !entry.withdrawn && log.read[messageId] === entry.sequence && entry.messageIds.includes(messageId)) {
        found = entry;
        break;
      }
    }
    if (found === null) {
      return null;
    }
    found.withdrawn = true;
    for (const id of found.messageIds) {
      if (log.read[id] === found.sequence) {
        delete log.read[id];
      }
    }
    log.revision += 1;
    return Object.freeze([...found.messageIds]);
  },

  /**
   * @param {object} log
   * @param {number} sequence
   * @returns {object | null}
   */
  revoke(log, sequence) {
    for (const entry of log.entries) {
      if (entry.sequence === sequence && entry.origin === ScribeLogCore.Origin.Notes && !entry.withdrawn) {
        const linked = entry.operations.filter((operation) => operation.resolutions?.length && !operation.revoked);
        if (linked.length === 0) {
          return null;
        }
        for (const operation of linked) {
          operation.revoked = true;
        }
        log.revision += 1;
        return entry;
      }
      if (entry.sequence === sequence && entry.kind === ScribeLogCore.Kind.Operator && !entry.withdrawn) {
        entry.withdrawn = true;
        if (entry.operations.some((operation) => operation.type === ScribeLogCore.Ruling.EditFact)) {
          ScribeLogCore.noteEdit(log);
        }
        log.revision += 1;
        return entry;
      }
    }
    return null;
  },

  /**
   * @param {object} log
   * @param {object} state
   * @param {{factId: string, speakerSubjectId: string}} options
   * @returns {object}
   * @throws {Error}
   */
  tell(log, state, { factId, speakerSubjectId }) {
    if (typeof factId !== 'string' || factId.trim().length === 0) {
      throw new RangeError('factId must be a non-empty string.');
    }
    if (typeof speakerSubjectId !== 'string' || speakerSubjectId.trim().length === 0) {
      throw new RangeError('speakerSubjectId must be a non-empty string.');
    }
    if (state.revision !== log.revision) {
      throw new Error(ScribeLogCore.Settings.StaleState);
    }
    const fact = ScribeLogCore.lookup(state.facts, factId.trim());
    if (fact === undefined || fact.status === ScribeReplay.Status.Removed) {
      throw new RangeError(`Fact not found or removed: ${factId}`);
    }
    const resolvedSpeakerId = ScribeKnowledge.survivor(state, speakerSubjectId.trim());
    const speakerSubject = ScribeLogCore.lookup(state.subjects, resolvedSpeakerId);
    if (speakerSubject === undefined || speakerSubject.mergedInto !== null) {
      throw new RangeError(`Speaker subject not found: ${speakerSubjectId}`);
    }
    const currentAudience = ScribeKnowledge.audience(state, fact);
    if (currentAudience === ScribeKnowledge.Everyone) {
      throw new RangeError(`Fact ${fact.id} is already known to everyone.`);
    }
    const nextWidened = [];
    if (Array.isArray(fact.widened)) {
      for (const existingId of fact.widened) {
        const survivorId = ScribeKnowledge.survivor(state, existingId);
        if (!nextWidened.includes(survivorId)) {
          nextWidened.push(survivorId);
        }
      }
    }
    if (!nextWidened.includes(resolvedSpeakerId)) {
      nextWidened.push(resolvedSpeakerId);
    }
    return ScribeLogCore.rule(log, state, {
      type: ScribeLogCore.Ruling.Widen,
      fact: fact.id,
      to: nextWidened,
    });
  },

  /**
   * @param {object} log
   * @param {object} state
   * @param {{subjectId?: string | null, name: string, aliases?: readonly string[], kind?: string, excludeSubjectIds?: Iterable<string> | null}} options
   * @returns {Readonly<{subjectId: string, changed: boolean}>}
   * @throws {Error}
   */
  syncCharacterSubject(log, state, {
    subjectId = null,
    name,
    aliases = [],
    kind = ScribeCategory.SubjectKinds.Character,
    excludeSubjectIds = null,
  }) {
    if (state.revision !== log.revision) {
      throw new Error(ScribeLogCore.Settings.StaleState);
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new RangeError('name must be a non-empty string.');
    }
    const trimmedName = name.trim();
    if (trimmedName.length > ScribeAnswer.Settings.MaxLabel) {
      throw new RangeError(`name exceeds maximum length (${ScribeAnswer.Settings.MaxLabel}).`);
    }
    if (ScribeText.normaliseName(trimmedName) === ScribeAnswer.Settings.NarratorName) {
      throw new RangeError('Character name cannot be Narrator.');
    }
    if (!Object.values(ScribeCategory.SubjectKinds).includes(kind)) {
      throw new RangeError(`Unsupported subject kind: ${String(kind)}`);
    }
    if (!Array.isArray(aliases)) {
      throw new TypeError('aliases must be an array of strings.');
    }
    const excludedSet = new Set();
    if (excludeSubjectIds !== null && excludeSubjectIds !== undefined) {
      if (typeof excludeSubjectIds[Symbol.iterator] !== 'function') {
        throw new TypeError('excludeSubjectIds must be null or an iterable of strings.');
      }
      for (const excludedId of excludeSubjectIds) {
        if (typeof excludedId === 'string' && excludedId.trim().length > 0) {
          excludedSet.add(excludedId.trim());
        }
      }
    }

    const normalisedName = ScribeText.normaliseName(trimmedName);
    const desiredAliases = [];
    const seenAliasForms = new Set([normalisedName]);
    for (const rawAlias of aliases) {
      if (typeof rawAlias !== 'string') {
        throw new TypeError('Each alias must be a string.');
      }
      const trimmedAlias = rawAlias.trim();
      if (trimmedAlias.length === 0) {
        continue;
      }
      const normalisedAlias = ScribeText.normaliseName(trimmedAlias);
      if (normalisedAlias.length === 0 || seenAliasForms.has(normalisedAlias)) {
        continue;
      }
      seenAliasForms.add(normalisedAlias);
      desiredAliases.push(trimmedAlias);
    }

    let targetSubjectId;
    if (subjectId !== null && subjectId !== undefined) {
      if (typeof subjectId !== 'string' || subjectId.trim().length === 0) {
        throw new RangeError('subjectId must be null or a non-empty string.');
      }
      targetSubjectId = ScribeKnowledge.survivor(state, subjectId.trim());
      const prefixMatch = /^S(\d+)$/.exec(targetSubjectId);
      if (prefixMatch !== null) {
        const numericSuffix = Number(prefixMatch[1]);
        if (Number.isSafeInteger(numericSuffix) && numericSuffix >= log.nextSubject) {
          log.nextSubject = numericSuffix + 1;
        }
      }
    } else {
      const unmergedSameKind = state.subjects.filter((subject) => {
        return subject.mergedInto === null && subject.kind === kind && !excludedSet.has(subject.id);
      });
      const labelMatches = unmergedSameKind.filter((subject) => {
        return ScribeText.normaliseName(subject.label) === normalisedName;
      });
      if (labelMatches.length === 1) {
        targetSubjectId = labelMatches[0].id;
      } else {
        const aliasMatches = labelMatches.length === 0
          ? unmergedSameKind.filter((subject) => {
              const subjectForms = new Set(
                [subject.name, ...subject.aka].map((entry) => ScribeText.normaliseName(entry)),
              );
              return (
                subjectForms.has(normalisedName) ||
                desiredAliases.some((alias) => subjectForms.has(ScribeText.normaliseName(alias)))
              );
            })
          : [];
        if (aliasMatches.length === 1) {
          targetSubjectId = aliasMatches[0].id;
        } else {
          do {
            targetSubjectId = ScribeLogCore.Settings.SubjectPrefix + log.nextSubject;
            log.nextSubject += 1;
          } while (
            excludedSet.has(targetSubjectId) ||
            ScribeLogCore.lookup(state.subjects, targetSubjectId) !== undefined
          );
        }
      }
    }

    const existing = ScribeLogCore.lookup(state.subjects, targetSubjectId);
    const operations = [];
    let modifiedExistingEntries = false;

    if (existing === undefined) {
      operations.push({
        type: ScribeAnswer.Type.Subject,
        subject: targetSubjectId,
        label: trimmedName,
        kind,
      });
      for (const alias of desiredAliases) {
        operations.push({
          type: ScribeAnswer.Type.Alias,
          subject: targetSubjectId,
          name: alias,
          cite: null,
          position: 0,
          other: null,
        });
      }
    } else {
      if (existing.label !== trimmedName || existing.kind !== kind || existing.assumed) {
        operations.push({
          type: ScribeAnswer.Type.Subject,
          subject: targetSubjectId,
          label: trimmedName,
          kind,
        });
      }

      const desiredLower = new Set(desiredAliases.map((alias) => alias.toLowerCase()));
      const desiredNormalised = new Set(desiredAliases.map((alias) => ScribeText.normaliseName(alias)));

      for (const aliasEntry of state.aliases) {
        if (aliasEntry.subject !== targetSubjectId) {
          continue;
        }
        const aliasNormalised = ScribeText.normaliseName(aliasEntry.name);
        if (!desiredLower.has(aliasEntry.name.toLowerCase()) && !desiredNormalised.has(aliasNormalised)) {
          operations.push({
            type: ScribeLogCore.Ruling.Unalias,
            subject: targetSubjectId,
            name: aliasEntry.name,
          });
        }
      }

      for (const fact of state.facts) {
        if (
          fact.subject === targetSubjectId &&
          fact.category === ScribeLogCore.Settings.AkaCategory &&
          fact.status === ScribeReplay.Status.InForce
        ) {
          const factNormalised = ScribeText.normaliseName(fact.text);
          if (!desiredLower.has(fact.text.toLowerCase()) && !desiredNormalised.has(factNormalised)) {
            operations.push({
              type: ScribeLogCore.Ruling.RemoveFact,
              fact: fact.id,
              mark: ScribeLogCore.mark(fact),
            });
          }
        }
      }

      const existingAliasForms = new Set(
        existing.aka.map((entry) => ScribeText.normaliseName(entry)),
      );
      for (const alias of desiredAliases) {
        const aliasLower = alias.toLowerCase();
        for (const logEntry of log.entries) {
          if (logEntry.kind !== ScribeLogCore.Kind.Operator || logEntry.withdrawn) {
            continue;
          }
          for (const op of logEntry.operations) {
            if (
              op.type === ScribeLogCore.Ruling.Unalias &&
              !op.revoked &&
              op.subject === targetSubjectId &&
              op.name.toLowerCase() === aliasLower
            ) {
              op.revoked = true;
              modifiedExistingEntries = true;
            }
          }
        }
        if (!existingAliasForms.has(ScribeText.normaliseName(alias))) {
          operations.push({
            type: ScribeAnswer.Type.Alias,
            subject: targetSubjectId,
            name: alias,
            cite: null,
            position: 0,
            other: null,
          });
        }
      }
    }

    if (operations.length === 0 && !modifiedExistingEntries) {
      return Object.freeze({ subjectId: targetSubjectId, changed: false });
    }

    if (operations.length > 0) {
      log.entries.push({
        sequence: log.nextSequence,
        kind: ScribeLogCore.Kind.Operator,
        origin: ScribeLogCore.Origin.Operator,
        messageIds: [],
        operations,
        withdrawn: false,
      });
      log.nextSequence += 1;
    }
    log.revision += 1;
    return Object.freeze({ subjectId: targetSubjectId, changed: true });
  },
});
