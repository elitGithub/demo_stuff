import { ScribeCategory } from '../scribe/ScribeCategory.mjs';
import { ScribeKnowledge } from '../scribe/ScribeKnowledge.mjs';
import { ScribeLogCore } from '../scribe/ScribeLogCore.mjs';
import { ScribeReplay } from '../scribe/ScribeReplay.mjs';
import { ScribeText } from '../scribe/ScribeText.mjs';
import { CharacterCard } from '../store/CharacterCard.mjs';
import { SceneType } from '../store/enums/SceneType.mjs';

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * @param {object} state
 * @param {{omniscient: boolean, subjectId: string | null}} viewer
 * @param {object} fact
 * @returns {boolean}
 */
function isFactVisible(state, viewer, fact) {
  if (viewer.omniscient) {
    return !fact.hidden;
  }
  return ScribeKnowledge.knows(state, viewer.subjectId, fact);
}

/**
 * @param {object} turn
 * @param {string} characterId
 * @returns {boolean}
 */
function turnWitnessedBy(turn, characterId) {
  if (Array.isArray(turn.witnessIds) && turn.witnessIds.includes(characterId)) {
    return true;
  }
  return (
    Array.isArray(turn.beats) &&
    turn.beats.some(
      (beat) =>
        beat !== null &&
        typeof beat === 'object' &&
        Array.isArray(beat.witnessIds) &&
        beat.witnessIds.includes(characterId),
    )
  );
}

/**
 * @param {string} text
 * @returns {readonly string[]}
 * @throws {TypeError}
 */
function tokenizePhrase(text) {
  return ScribeText.words(
    ScribeText.normaliseName(text.replace(ScribeText.Settings.StrippedMarks, ScribeText.Settings.Space)),
  );
}

/**
 * @param {readonly string[]} haystackTokens
 * @param {readonly string[]} needleTokens
 * @returns {boolean}
 */
function containsTokenPhrase(haystackTokens, needleTokens) {
  if (needleTokens.length === 0 || haystackTokens.length < needleTokens.length) {
    return false;
  }
  const maxStart = haystackTokens.length - needleTokens.length;
  for (let startIndex = 0; startIndex <= maxStart; startIndex += 1) {
    let matched = true;
    for (let offset = 0; offset < needleTokens.length; offset += 1) {
      if (haystackTokens[startIndex + offset] !== needleTokens[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string} label
 * @param {ReadonlyArray<object>} facts
 * @param {ReadonlyMap<object, string>} formattedTexts
 * @returns {string}
 */
function formatSubjectLine(label, facts, formattedTexts) {
  const settings = StorySlice.Settings;
  const attributeParts = [];
  const itemParts = [];
  for (const fact of facts) {
    const valueText = formattedTexts.get(fact);
    if (fact.category === settings.BelongingCategory) {
      itemParts.push(valueText);
    } else {
      attributeParts.push(`${fact.category}${settings.ColonSeparator}${valueText}`);
    }
  }
  const prefix = `${settings.BulletPrefix}${label}${settings.ColonSeparator}`;
  if (attributeParts.length === 0) {
    const itemsLabel = settings.ItemsPrefix.slice(settings.PipeSeparator.length);
    return `${prefix}${itemsLabel}${itemParts.join(settings.CommaSeparator)}`;
  }
  const attributesJoined = attributeParts.join(settings.SemicolonSeparator);
  if (itemParts.length === 0) {
    return `${prefix}${attributesJoined}`;
  }
  return `${prefix}${attributesJoined}${settings.ItemsPrefix}${itemParts.join(settings.CommaSeparator)}`;
}

/**
 * @param {ReadonlyArray<string>} lines
 * @returns {string}
 */
function wrapLines(lines) {
  const settings = StorySlice.Settings;
  if (lines.length === 0) {
    return settings.EmptyText;
  }
  return `${settings.OpenTag}${settings.LineSeparator}${lines.join(settings.LineSeparator)}${settings.LineSeparator}${settings.CloseTag}`;
}

/**
 * @param {{subjects: ReadonlyArray<object>, factsBySubject: ReadonlyMap<string, ReadonlyArray<object>>, formattedTexts: ReadonlyMap<object, string>, budget: {fits: (usedTokens: number, text: string) => boolean}, usedTokens: number, acceptedLines: string[], heading?: string | null}} options
 * @returns {boolean}
 * @throws {TypeError | RangeError | Error}
 */
function appendSubjectLines({
  subjects,
  factsBySubject,
  formattedTexts,
  budget,
  usedTokens,
  acceptedLines,
  heading = null,
}) {
  let headingEmitted = heading === null;
  for (const subject of subjects) {
    const subjectFacts = factsBySubject.get(subject.id);
    if (subjectFacts === undefined || subjectFacts.length === 0) {
      continue;
    }
    const pendingHeading = headingEmitted ? [] : [heading];
    const fullLine = formatSubjectLine(subject.label, subjectFacts, formattedTexts);
    if (budget.fits(usedTokens, wrapLines([...acceptedLines, ...pendingHeading, fullLine]))) {
      if (!headingEmitted) {
        acceptedLines.push(heading);
        headingEmitted = true;
      }
      acceptedLines.push(fullLine);
      continue;
    }

    const chosenFacts = [];
    for (const fact of subjectFacts) {
      const nextChosen = [...chosenFacts, fact];
      const candidateLine = formatSubjectLine(subject.label, nextChosen, formattedTexts);
      if (!budget.fits(usedTokens, wrapLines([...acceptedLines, ...pendingHeading, candidateLine]))) {
        break;
      }
      chosenFacts.push(fact);
    }
    if (chosenFacts.length > 0) {
      if (!headingEmitted) {
        acceptedLines.push(heading);
      }
      acceptedLines.push(formatSubjectLine(subject.label, chosenFacts, formattedTexts));
    }
    return true;
  }
  return false;
}

/**
 * @param {{heading: string, lines: ReadonlyArray<string>, budget: {fits: (usedTokens: number, text: string) => boolean}, usedTokens: number, acceptedLines: string[]}} options
 * @returns {boolean}
 * @throws {TypeError | RangeError | Error}
 */
function appendHeadedLines({ heading, lines, budget, usedTokens, acceptedLines }) {
  if (lines.length === 0) {
    return false;
  }
  for (let index = 0; index < lines.length; index += 1) {
    const pending = index === 0 ? [heading, lines[index]] : [lines[index]];
    if (!budget.fits(usedTokens, wrapLines([...acceptedLines, ...pending]))) {
      return true;
    }
    acceptedLines.push(...pending);
  }
  return false;
}

export const StorySlice = Object.freeze({
  Settings: Object.freeze({
    OpenTag: '<story_state>',
    CloseTag: '</story_state>',
    LocationPrefix: 'Location: ',
    TimeDayPrefix: 'Time: Day ',
    PresentPrefix: 'Present: ',
    RemotePrefix: 'Remote: ',
    SituationPrefix: 'Situation: ',
    ItemsPrefix: ' | Items: ',
    RelationsHeading: 'Relations:',
    OpenThreadsHeading: 'Open threads:',
    KnownFactsHeading: 'Known facts:',
    BulletPrefix: '- ',
    ArrowSeparator: ' -> ',
    SemicolonSeparator: '; ',
    PipeSeparator: ' | ',
    CommaSeparator: ', ',
    ColonSeparator: ': ',
    OriginallyPrefix: ' (originally ',
    OriginallySuffix: ')',
    LineSeparator: '\n',
    EmptyText: '',
    BelongingCategory: 'belonging',
  }),

  /**
   * @param {{state: object, viewer: {omniscient: boolean, subjectId: string | null, characterId?: string | null}, scene: {location: string, day: number, timeLabel: string, sceneType: string, situation: string}, presentSubjectIds?: ReadonlyArray<string>, remoteSubjectIds?: ReadonlyArray<string>, namedText?: string, playerName?: string | null, budget: {limitTokens: number | null, estimate: (text: string) => number, fits: (usedTokens: number, text: string) => boolean}, usedTokens?: number, turnsById?: ReadonlyMap<string, object> | Record<string, object> | null}} [options]
   * @returns {Readonly<{text: string, tokens: number}>}
   * @throws {TypeError | RangeError | Error}
   */
  build(options = {}) {
    if (!isPlainObject(options)) {
      throw new TypeError('StorySlice options must be a plain object.');
    }

    const settings = StorySlice.Settings;
    const {
      state,
      viewer,
      scene,
      presentSubjectIds = [],
      remoteSubjectIds = [],
      namedText = settings.EmptyText,
      playerName = null,
      budget,
      usedTokens = 0,
      turnsById = null,
    } = options;

    if (
      !isPlainObject(state) ||
      !Array.isArray(state.subjects) ||
      !Array.isArray(state.facts) ||
      !Array.isArray(state.threads) ||
      !Array.isArray(state.scenes)
    ) {
      throw new TypeError('state must be a plain object with subjects, facts, threads, and scenes arrays.');
    }
    if (!isPlainObject(viewer)) {
      throw new TypeError('viewer must be a plain object.');
    }
    if (typeof viewer.omniscient !== 'boolean') {
      throw new TypeError('viewer.omniscient must be a boolean.');
    }
    let trimmedSubjectId = null;
    if (viewer.subjectId !== null) {
      if (typeof viewer.subjectId !== 'string') {
        throw new TypeError('viewer.subjectId must be null or a non-empty string.');
      }
      trimmedSubjectId = viewer.subjectId.trim();
      if (trimmedSubjectId.length === 0) {
        throw new RangeError('viewer.subjectId must be null or a non-empty string.');
      }
    }
    let trimmedCharacterId = null;
    if (viewer.characterId !== undefined && viewer.characterId !== null) {
      if (typeof viewer.characterId !== 'string') {
        throw new TypeError('viewer.characterId must be undefined, null, or a non-empty string.');
      }
      trimmedCharacterId = viewer.characterId.trim();
      if (trimmedCharacterId.length === 0) {
        throw new RangeError('viewer.characterId must be undefined, null, or a non-empty string.');
      }
    }
    if (!isPlainObject(scene)) {
      throw new TypeError('scene must be a plain object.');
    }
    if (typeof scene.location !== 'string') {
      throw new TypeError('scene.location must be a string.');
    }
    if (typeof scene.day !== 'number') {
      throw new TypeError('scene.day must be a positive integer.');
    }
    if (!Number.isInteger(scene.day) || scene.day < 1) {
      throw new RangeError('scene.day must be a positive integer.');
    }
    if (typeof scene.timeLabel !== 'string') {
      throw new TypeError('scene.timeLabel must be a string.');
    }
    SceneType.label(scene.sceneType);
    if (typeof scene.situation !== 'string') {
      throw new TypeError('scene.situation must be a string.');
    }
    if (!Array.isArray(presentSubjectIds) || presentSubjectIds.some((subjectId) => typeof subjectId !== 'string')) {
      throw new TypeError('presentSubjectIds must be an array of strings.');
    }
    if (!Array.isArray(remoteSubjectIds) || remoteSubjectIds.some((subjectId) => typeof subjectId !== 'string')) {
      throw new TypeError('remoteSubjectIds must be an array of strings.');
    }
    if (typeof namedText !== 'string') {
      throw new TypeError('namedText must be a string.');
    }
    if (playerName !== null && typeof playerName !== 'string') {
      throw new TypeError('playerName must be null or a string.');
    }
    if (
      budget === null ||
      typeof budget !== 'object' ||
      Array.isArray(budget) ||
      typeof budget.estimate !== 'function' ||
      typeof budget.fits !== 'function'
    ) {
      throw new TypeError('budget must provide estimate(), fits(), and limitTokens.');
    }
    if (budget.limitTokens !== null) {
      if (typeof budget.limitTokens !== 'number') {
        throw new TypeError('budget.limitTokens must be null or a non-negative integer.');
      }
      if (!Number.isInteger(budget.limitTokens) || budget.limitTokens < 0) {
        throw new RangeError('budget.limitTokens must be null or a non-negative integer.');
      }
    }
    if (typeof usedTokens !== 'number') {
      throw new TypeError('usedTokens must be a finite non-negative number.');
    }
    if (!Number.isFinite(usedTokens) || usedTokens < 0) {
      throw new RangeError('usedTokens must be a finite non-negative number.');
    }
    let turnsMap = null;
    if (turnsById !== null) {
      if (turnsById instanceof Map) {
        turnsMap = turnsById;
      } else if (isPlainObject(turnsById)) {
        turnsMap = new Map(Object.entries(turnsById));
      } else {
        throw new TypeError('turnsById must be null, a Map, or a plain object.');
      }
    }

    const effectiveViewer = { omniscient: viewer.omniscient, subjectId: trimmedSubjectId };
    const viewerSurvivor = trimmedSubjectId === null ? null : ScribeKnowledge.survivor(state, trimmedSubjectId);

    const survivingSubjects = [];
    const survivingById = new Map();
    const mergedLabelsBySurvivor = new Map();
    for (const subject of state.subjects) {
      if (subject.mergedInto === null) {
        survivingSubjects.push(subject);
        survivingById.set(subject.id, subject);
      } else {
        const survivorId = ScribeKnowledge.survivor(state, subject.mergedInto);
        const bucket = mergedLabelsBySurvivor.get(survivorId);
        const mergedEntries = [subject.label, subject.name];
        if (bucket === undefined) {
          mergedLabelsBySurvivor.set(survivorId, mergedEntries);
        } else {
          bucket.push(...mergedEntries);
        }
      }
    }

    const presentSurvivors = [];
    const presentSet = new Set();
    for (const rawId of presentSubjectIds) {
      const candidateId = rawId.trim();
      if (candidateId.length === 0) {
        continue;
      }
      const survivorId = ScribeKnowledge.survivor(state, candidateId);
      const subject = survivingById.get(survivorId);
      if (subject !== undefined && !presentSet.has(survivorId)) {
        presentSet.add(survivorId);
        presentSurvivors.push(subject);
      }
    }

    const remoteSurvivors = [];
    const remoteSet = new Set();
    for (const rawId of remoteSubjectIds) {
      const candidateId = rawId.trim();
      if (candidateId.length === 0) {
        continue;
      }
      const survivorId = ScribeKnowledge.survivor(state, candidateId);
      const subject = survivingById.get(survivorId);
      if (subject !== undefined && !presentSet.has(survivorId) && !remoteSet.has(survivorId)) {
        remoteSet.add(survivorId);
        remoteSurvivors.push(subject);
      }
    }

    const trimmedTimeLabel = scene.timeLabel.trim();
    const trimmedSituation = scene.situation.trim();
    const section1Lines = [
      `${settings.LocationPrefix}${scene.location.trim()}${settings.PipeSeparator}${settings.TimeDayPrefix}${scene.day}${trimmedTimeLabel.length > 0 ? `${settings.CommaSeparator}${trimmedTimeLabel}` : settings.EmptyText}${settings.PipeSeparator}${scene.sceneType}`,
    ];
    if (presentSurvivors.length > 0) {
      section1Lines.push(
        `${settings.PresentPrefix}${presentSurvivors.map((subject) => subject.label).join(settings.CommaSeparator)}`,
      );
    }
    if (remoteSurvivors.length > 0) {
      section1Lines.push(
        `${settings.RemotePrefix}${remoteSurvivors.map((subject) => subject.label).join(settings.CommaSeparator)}`,
      );
    }
    if (trimmedSituation.length > 0) {
      section1Lines.push(`${settings.SituationPrefix}${trimmedSituation}`);
    }

    const acceptedLines = [];
    for (const headerLine of section1Lines) {
      if (!budget.fits(usedTokens, wrapLines([...acceptedLines, headerLine]))) {
        const stoppedText = wrapLines(acceptedLines);
        return Object.freeze({ text: stoppedText, tokens: budget.estimate(stoppedText) });
      }
      acceptedLines.push(headerLine);
    }

    const activeIndexed = [];
    for (let index = 0; index < state.facts.length; index += 1) {
      const fact = state.facts[index];
      if (fact.status === ScribeReplay.Status.InForce && isFactVisible(state, effectiveViewer, fact)) {
        const isRuling =
          fact.pinned === true ||
          fact.made === true ||
          fact.origin === ScribeLogCore.Origin.Operator ||
          fact.origin === ScribeLogCore.Origin.Notes ||
          (state.editOrigins !== undefined && Object.hasOwn(state.editOrigins, fact.id));
        activeIndexed.push({ fact, isRuling, index });
      }
    }
    activeIndexed.sort((left, right) => {
      const rulingDiff = Number(right.isRuling) - Number(left.isRuling);
      if (rulingDiff !== 0) {
        return rulingDiff;
      }
      const positionDiff = right.fact.position - left.fact.position;
      if (positionDiff !== 0) {
        return positionDiff;
      }
      return left.index - right.index;
    });

    const formattedTexts = new Map();
    const factsBySubject = new Map();
    const activeRelations = [];
    for (const { fact } of activeIndexed) {
      const currentText = CharacterCard.requestValue(ScribeCategory.displayValue(fact));
      let displayText = currentText;
      if (
        ScribeCategory.Settings.Words.Fixed.includes(fact.category) &&
        state.decidedFacts !== undefined
      ) {
        const factSurvivor = ScribeKnowledge.survivor(state, fact.subject);
        const normalizedFact = fact.subject === factSurvivor ? fact : { ...fact, subject: factSurvivor };
        const currentSlot = fact.pinned === true
          ? ScribeReplay.decisionBase(state, normalizedFact)
          : ScribeReplay.decisionField(state, normalizedFact);
        const currentSequence = Object.hasOwn(state.decidedFacts, fact.id)
          ? state.decidedFacts[fact.id]
          : null;
        let earliestCandidate = null;
        let earliestSequence = 0;
        let earliestPriorText = settings.EmptyText;
        for (const candidate of state.facts) {
          if (
            candidate.id === fact.id ||
            candidate.status !== ScribeReplay.Status.Reported ||
            !Object.hasOwn(state.decidedFacts, candidate.id) ||
            candidate.category !== fact.category ||
            ScribeKnowledge.survivor(state, candidate.subject) !== factSurvivor
          ) {
            continue;
          }
          const candidateSequence = state.decidedFacts[candidate.id];
          if (
            currentSequence !== null &&
            (candidateSequence > currentSequence ||
              (candidateSequence === currentSequence && candidate.position >= fact.position))
          ) {
            continue;
          }
          const normalizedCandidate = candidate.subject === factSurvivor
            ? candidate
            : { ...candidate, subject: factSurvivor };
          const candidateSlot = fact.pinned === true
            ? ScribeReplay.decisionBase(state, normalizedCandidate)
            : ScribeReplay.decisionField(state, normalizedCandidate);
          if (candidateSlot !== currentSlot || !isFactVisible(state, effectiveViewer, candidate)) {
            continue;
          }
          const candidateText = CharacterCard.requestValue(ScribeCategory.displayValue(candidate));
          if (
            earliestCandidate === null ||
            candidateSequence < earliestSequence ||
            (candidateSequence === earliestSequence && candidate.position < earliestCandidate.position)
          ) {
            earliestCandidate = candidate;
            earliestSequence = candidateSequence;
            earliestPriorText = candidateText;
          }
        }
        if (earliestCandidate !== null && !ScribeCategory.same(earliestPriorText, currentText)) {
          displayText = `${currentText}${settings.OriginallyPrefix}${earliestPriorText}${settings.OriginallySuffix}`;
        }
      }
      formattedTexts.set(fact, displayText);

      if (fact.category === ScribeCategory.Settings.RelationCategory) {
        activeRelations.push(fact);
      } else {
        const ownerId = ScribeKnowledge.survivor(state, fact.subject);
        const bucket = factsBySubject.get(ownerId);
        if (bucket === undefined) {
          factsBySubject.set(ownerId, [fact]);
        } else {
          bucket.push(fact);
        }
      }
    }

    let renderedViewerInSection2 = false;
    if (!effectiveViewer.omniscient && viewerSurvivor !== null) {
      const viewerSubject = survivingById.get(viewerSurvivor);
      if (viewerSubject !== undefined) {
        const viewerFacts = factsBySubject.get(viewerSurvivor);
        if (viewerFacts !== undefined && viewerFacts.length > 0) {
          renderedViewerInSection2 = true;
          if (
            appendSubjectLines({
              subjects: [viewerSubject],
              factsBySubject,
              formattedTexts,
              budget,
              usedTokens,
              acceptedLines,
            })
          ) {
            const stoppedText = wrapLines(acceptedLines);
            return Object.freeze({ text: stoppedText, tokens: budget.estimate(stoppedText) });
          }
        }
      }
    }

    const section3Subjects = [...presentSurvivors, ...remoteSurvivors].filter((subject) => {
      return !(renderedViewerInSection2 && subject.id === viewerSurvivor);
    });
    if (
      appendSubjectLines({
        subjects: section3Subjects,
        factsBySubject,
        formattedTexts,
        budget,
        usedTokens,
        acceptedLines,
      })
    ) {
      const stoppedText = wrapLines(acceptedLines);
      return Object.freeze({ text: stoppedText, tokens: budget.estimate(stoppedText) });
    }

    const aliasesBySurvivor = new Map();
    const invisibleAliasesBySurvivor = new Map();
    if (Array.isArray(state.aliases)) {
      for (const aliasEntry of state.aliases) {
        if (
          aliasEntry !== null &&
          typeof aliasEntry === 'object' &&
          typeof aliasEntry.subject === 'string' &&
          typeof aliasEntry.name === 'string'
        ) {
          const survivorId = ScribeKnowledge.survivor(state, aliasEntry.subject);
          let aliasVisible = true;
          if (
            !effectiveViewer.omniscient &&
            trimmedCharacterId !== null &&
            turnsMap !== null &&
            typeof aliasEntry.cite === 'string'
          ) {
            const aliasTurn = turnsMap.get(aliasEntry.cite);
            if (
              aliasTurn !== undefined &&
              aliasTurn !== null &&
              typeof aliasTurn === 'object' &&
              !turnWitnessedBy(aliasTurn, trimmedCharacterId)
            ) {
              aliasVisible = false;
            }
          }
          if (aliasVisible) {
            const bucket = aliasesBySurvivor.get(survivorId);
            if (bucket === undefined) {
              aliasesBySurvivor.set(survivorId, [aliasEntry.name]);
            } else {
              bucket.push(aliasEntry.name);
            }
          } else {
            const normalizedAlias = ScribeText.normaliseName(aliasEntry.name);
            if (normalizedAlias.length > 0) {
              const hiddenBucket = invisibleAliasesBySurvivor.get(survivorId);
              if (hiddenBucket === undefined) {
                invisibleAliasesBySurvivor.set(survivorId, new Set([normalizedAlias]));
              } else {
                hiddenBucket.add(normalizedAlias);
              }
            }
          }
        }
      }
    }

    const akaFactsBySurvivor = new Map();
    for (const fact of state.facts) {
      if (
        fact.category === ScribeLogCore.Settings.AkaCategory &&
        (ScribeReplay.live(fact) || fact.status === ScribeReplay.Status.Replaced)
      ) {
        const survivorId = ScribeKnowledge.survivor(state, fact.subject);
        const bucket = akaFactsBySurvivor.get(survivorId);
        if (bucket === undefined) {
          akaFactsBySurvivor.set(survivorId, [fact]);
        } else {
          bucket.push(fact);
        }
      }
    }

    const visibleNamesBySubject = new Map();
    for (const subject of survivingSubjects) {
      const names = [];
      const seenRawNames = new Set();
      const nonFactNormalized = new Set();
      const mergedLabels = mergedLabelsBySurvivor.get(subject.id);
      const aliasNames = aliasesBySurvivor.get(subject.id);
      const nonFactList = [
        subject.label,
        subject.name,
        ...(mergedLabels === undefined ? [] : mergedLabels),
        ...(aliasNames === undefined ? [] : aliasNames),
      ];
      for (const rawName of nonFactList) {
        if (typeof rawName === 'string' && rawName.length > 0) {
          if (!seenRawNames.has(rawName)) {
            seenRawNames.add(rawName);
            names.push(rawName);
          }
          const normalized = ScribeText.normaliseName(rawName);
          if (normalized.length > 0) {
            nonFactNormalized.add(normalized);
          }
        }
      }

      const visibleAkaNormalized = new Set();
      const invisibleAkaNormalized = new Set();
      const subjectAkaFacts = akaFactsBySurvivor.get(subject.id);
      if (subjectAkaFacts !== undefined) {
        for (const akaFact of subjectAkaFacts) {
          const visible = isFactVisible(state, effectiveViewer, akaFact);
          const normalized = typeof akaFact.text === 'string'
            ? ScribeText.normaliseName(akaFact.text)
            : settings.EmptyText;
          if (ScribeReplay.live(akaFact) && visible) {
            if (typeof akaFact.text === 'string' && akaFact.text.length > 0 && !seenRawNames.has(akaFact.text)) {
              seenRawNames.add(akaFact.text);
              names.push(akaFact.text);
            }
            if (normalized.length > 0) {
              visibleAkaNormalized.add(normalized);
            }
          } else if (!visible && normalized.length > 0) {
            invisibleAkaNormalized.add(normalized);
          }
        }
      }

      const invisibleAliasNormalized = invisibleAliasesBySurvivor.get(subject.id);
      if (Array.isArray(subject.aka)) {
        for (const entry of subject.aka) {
          if (typeof entry !== 'string' || entry.length === 0) {
            continue;
          }
          const normalized = ScribeText.normaliseName(entry);
          const isInvisibleAlias =
            invisibleAliasNormalized !== undefined && invisibleAliasNormalized.has(normalized);
          if (
            (invisibleAkaNormalized.has(normalized) || isInvisibleAlias) &&
            !visibleAkaNormalized.has(normalized) &&
            !nonFactNormalized.has(normalized)
          ) {
            continue;
          }
          if (!seenRawNames.has(entry)) {
            seenRawNames.add(entry);
            names.push(entry);
          }
        }
      }
      visibleNamesBySubject.set(subject.id, names);
    }

    const sceneParticipants = [...presentSurvivors, ...remoteSurvivors];
    const sceneParticipantIds = new Set(sceneParticipants.map((subject) => subject.id));
    const sceneParticipantNamesBySubject = new Map();
    for (const participant of sceneParticipants) {
      const nameSet = new Set();
      for (const rawName of visibleNamesBySubject.get(participant.id)) {
        const normalized = ScribeText.normaliseName(rawName);
        if (normalized.length > 0) {
          nameSet.add(normalized);
        }
      }
      sceneParticipantNamesBySubject.set(participant.id, nameSet);
    }

    const viewerNames = new Set();
    if (!effectiveViewer.omniscient && viewerSurvivor !== null) {
      const viewerVisibleNames = visibleNamesBySubject.get(viewerSurvivor);
      if (viewerVisibleNames !== undefined) {
        for (const rawName of viewerVisibleNames) {
          const normalized = ScribeText.normaliseName(rawName);
          if (normalized.length > 0) {
            viewerNames.add(normalized);
          }
        }
      }
    }

    const relationLines = [];
    for (const fact of activeRelations) {
      const fromId = ScribeKnowledge.survivor(state, fact.subject);
      const toId = fact.target === null ? null : ScribeKnowledge.survivor(state, fact.target);
      const normalizedTargetText = fact.target === null && fact.targetText !== null
        ? ScribeText.normaliseName(fact.targetText)
        : settings.EmptyText;

      let matchesRelation = false;
      if (effectiveViewer.omniscient) {
        if (sceneParticipantIds.has(fromId)) {
          if (toId !== null) {
            matchesRelation = toId !== fromId && sceneParticipantIds.has(toId);
          } else if (normalizedTargetText.length > 0) {
            for (const [participantId, participantNames] of sceneParticipantNamesBySubject.entries()) {
              if (participantId !== fromId && participantNames.has(normalizedTargetText)) {
                matchesRelation = true;
                break;
              }
            }
          }
        }
      } else if (viewerSurvivor !== null) {
        if (fromId === viewerSurvivor) {
          if (toId !== null) {
            matchesRelation = toId !== viewerSurvivor && sceneParticipantIds.has(toId);
          } else if (normalizedTargetText.length > 0) {
            for (const [participantId, participantNames] of sceneParticipantNamesBySubject.entries()) {
              if (participantId !== viewerSurvivor && participantNames.has(normalizedTargetText)) {
                matchesRelation = true;
                break;
              }
            }
          }
        } else if (sceneParticipantIds.has(fromId)) {
          if (toId !== null) {
            matchesRelation = toId === viewerSurvivor;
          } else if (normalizedTargetText.length > 0) {
            matchesRelation = viewerNames.has(normalizedTargetText);
          }
        }
      }

      if (!matchesRelation) {
        continue;
      }
      const fromSubject = survivingById.get(fromId);
      const fromLabel = fromSubject === undefined ? fromId : fromSubject.label;
      let toLabel;
      if (toId !== null) {
        const toSubject = survivingById.get(toId);
        toLabel = toSubject === undefined ? toId : toSubject.label;
      } else {
        toLabel = fact.targetText === null ? settings.EmptyText : fact.targetText;
      }
      relationLines.push(
        `${settings.BulletPrefix}${fromLabel}${settings.ArrowSeparator}${toLabel}${settings.ColonSeparator}${formattedTexts.get(fact)}`,
      );
    }

    if (
      appendHeadedLines({
        heading: settings.RelationsHeading,
        lines: relationLines,
        budget,
        usedTokens,
        acceptedLines,
      })
    ) {
      const stoppedText = wrapLines(acceptedLines);
      return Object.freeze({ text: stoppedText, tokens: budget.estimate(stoppedText) });
    }

    const touchedSubjectIds = new Set(sceneParticipantIds);
    if (!effectiveViewer.omniscient && viewerSurvivor !== null) {
      touchedSubjectIds.add(viewerSurvivor);
    }
    const touchedTokenPhrases = [];
    for (const subjectId of touchedSubjectIds) {
      const visibleNames = visibleNamesBySubject.get(subjectId);
      if (visibleNames !== undefined) {
        for (const rawName of visibleNames) {
          const phraseTokens = tokenizePhrase(rawName);
          if (phraseTokens.length > 0) {
            touchedTokenPhrases.push(phraseTokens);
          }
        }
      }
    }

    const visibleThreadsIndexed = [];
    for (let index = 0; index < state.threads.length; index += 1) {
      const thread = state.threads[index];
      if (thread.closed !== null) {
        continue;
      }
      let isVisible = effectiveViewer.omniscient;
      if (!isVisible) {
        if (
          thread.position === 0 ||
          thread.origin === ScribeLogCore.Origin.Operator ||
          thread.origin === ScribeLogCore.Origin.Notes
        ) {
          isVisible = true;
        }
      }
      let resolvedByTurn = false;
      if (!isVisible && trimmedCharacterId !== null && turnsMap !== null && typeof thread.cite === 'string') {
        const openingTurn = turnsMap.get(thread.cite);
        if (openingTurn !== undefined && openingTurn !== null && typeof openingTurn === 'object') {
          resolvedByTurn = true;
          if (turnWitnessedBy(openingTurn, trimmedCharacterId)) {
            isVisible = true;
          }
        }
      }
      if (!isVisible && !resolvedByTurn) {
        const { closed, open } = ScribeKnowledge.covering(state, thread.position);
        if (closed.length > 0) {
          isVisible =
            viewerSurvivor !== null &&
            closed.every((coveringScene) => {
              return coveringScene.present.some((entry) => {
                return (
                  ScribeKnowledge.survivor(state, entry.subject) === viewerSurvivor &&
                  ScribeKnowledge.within(entry, thread.position)
                );
              });
            });
        } else if (open.length > 0) {
          isVisible = true;
        }
      }
      if (!isVisible) {
        continue;
      }

      let touches =
        typeof thread.subject === 'string' &&
        touchedSubjectIds.has(ScribeKnowledge.survivor(state, thread.subject));
      if (!touches && typeof thread.text === 'string') {
        const threadTokens = tokenizePhrase(thread.text);
        touches = touchedTokenPhrases.some((phraseTokens) => containsTokenPhrase(threadTokens, phraseTokens));
      }
      if (touches) {
        const isPriority =
          thread.origin === ScribeLogCore.Origin.Operator || thread.origin === ScribeLogCore.Origin.Notes;
        visibleThreadsIndexed.push({ thread, isPriority, index });
      }
    }

    visibleThreadsIndexed.sort((left, right) => {
      const priorityDiff = Number(right.isPriority) - Number(left.isPriority);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      const positionDiff = right.thread.position - left.thread.position;
      if (positionDiff !== 0) {
        return positionDiff;
      }
      return left.index - right.index;
    });

    const threadLines = visibleThreadsIndexed.map(
      ({ thread }) => `${settings.BulletPrefix}${CharacterCard.requestValue(thread.text)}`,
    );
    if (
      appendHeadedLines({
        heading: settings.OpenThreadsHeading,
        lines: threadLines,
        budget,
        usedTokens,
        acceptedLines,
      })
    ) {
      const stoppedText = wrapLines(acceptedLines);
      return Object.freeze({ text: stoppedText, tokens: budget.estimate(stoppedText) });
    }

    const coveredIds = new Set(sceneParticipantIds);
    if (!effectiveViewer.omniscient && viewerSurvivor !== null) {
      coveredIds.add(viewerSurvivor);
    }
    const namedTokens = tokenizePhrase(namedText);
    const namedMatchedSubjects = [];
    if (namedTokens.length > 0) {
      for (const subject of survivingSubjects) {
        if (coveredIds.has(subject.id)) {
          continue;
        }
        const subjectFacts = factsBySubject.get(subject.id);
        if (subjectFacts === undefined || subjectFacts.length === 0) {
          continue;
        }
        const matchesName = visibleNamesBySubject.get(subject.id).some((rawName) => {
          const phraseTokens = tokenizePhrase(rawName);
          return phraseTokens.length > 0 && containsTokenPhrase(namedTokens, phraseTokens);
        });
        if (matchesName) {
          namedMatchedSubjects.push(subject);
        }
      }
    }

    appendSubjectLines({
      subjects: namedMatchedSubjects,
      factsBySubject,
      formattedTexts,
      budget,
      usedTokens,
      acceptedLines,
      heading: settings.KnownFactsHeading,
    });

    const finalText = wrapLines(acceptedLines);
    return Object.freeze({ text: finalText, tokens: budget.estimate(finalText) });
  },
});
