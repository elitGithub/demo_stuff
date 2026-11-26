import { CharacterCard } from '../store/CharacterCard.mjs';
import { SceneType } from '../store/enums/SceneType.mjs';
import { SpendStage } from '../store/enums/SpendStage.mjs';
import { TurnRole } from '../store/enums/TurnRole.mjs';
import { CardFiling } from './CardFiling.mjs';
import { ScribeAnalyzer } from './ScribeAnalyzer.mjs';
import { ScribeAnswer } from './ScribeAnswer.mjs';
import { ScribeCategory } from './ScribeCategory.mjs';
import { ScribeIntakeAdapter } from './ScribeIntakeAdapter.mjs';
import { ScribeKnowledge } from './ScribeKnowledge.mjs';
import { ScribeLogCore } from './ScribeLogCore.mjs';
import { ScribeReplay } from './ScribeReplay.mjs';
import { ScribeText } from './ScribeText.mjs';

export class ScribeService {
  #store;
  #client;
  #modelProvider;

  /**
   * @param {{store: object, client?: object | null, modelProvider?: ((context: {stage: string, campaignId: string}) => string | Promise<string>) | null}} options
   * @throws {TypeError}
   */
  constructor({ store, client = null, modelProvider = null } = {}) {
    if (store === null || typeof store !== 'object') {
      throw new TypeError('store must be a valid StoryStore instance.');
    }
    if (client !== null && (typeof client !== 'object' || typeof client.complete !== 'function')) {
      throw new TypeError('client must be null or an OpenRouterClient with complete().');
    }
    if (modelProvider !== null && typeof modelProvider !== 'function') {
      throw new TypeError('modelProvider must be null or a function.');
    }
    this.#store = store;
    this.#client = client;
    this.#modelProvider = modelProvider;
  }

  /**
   * @param {string} campaignId
   * @returns {Array<object>}
   * @throws {RangeError}
   */
  listAllCharacters(campaignId) {
    if (typeof campaignId !== 'string' || campaignId.trim().length === 0) {
      throw new RangeError('campaignId must be a non-empty string.');
    }
    const allCharacters = [];
    let after = null;
    while (true) {
      const page = this.#store.listCharacters(campaignId, { includeArchived: true, limit: 50, after });
      allCharacters.push(...page.items);
      if (page.nextCursor === null) {
        break;
      }
      after = page.nextCursor;
    }
    return allCharacters;
  }

  /**
   * @param {string} campaignId
   * @returns {{log: object, state: object, turns: Array<object>, messages: readonly object[], player: string, lastTurnSeq: number, dirty: boolean}}
   * @throws {Error}
   */
  loadState(campaignId) {
    if (typeof campaignId !== 'string' || campaignId.trim().length === 0) {
      throw new RangeError('campaignId must be a non-empty string.');
    }
    const campaign = this.#store.getCampaign(campaignId);
    if (campaign === null) {
      throw new RangeError(`Campaign not found: ${campaignId}`);
    }

    const turnPages = [];
    let beforeSeq = null;
    while (true) {
      const page = this.#store.listTurns(campaignId, { limit: 50, beforeSeq });
      turnPages.push(...page.items);
      if (page.nextCursor === null) {
        break;
      }
      beforeSeq = page.nextCursor;
    }
    const turns = turnPages.sort((left, right) => left.seq - right.seq);

    let playerName = null;
    if (campaign.playerCharacterId !== null) {
      const playerCharacter = this.#store.getCharacter(campaignId, campaign.playerCharacterId);
      if (playerCharacter !== null) {
        playerName = playerCharacter.name;
      }
    }

    const intake = ScribeIntakeAdapter.fromTurns(turns, {
      playerCharacterId: campaign.playerCharacterId,
      playerName,
    });

    const bookRow = this.#store.getScribeBook(campaignId);
    let log;
    let lastTurnSeq = 0;
    let dirty = false;
    if (bookRow === null) {
      log = ScribeLogCore.create();
    } else {
      log = JSON.parse(bookRow.bookJson);
      if (log === null || typeof log !== 'object' || !Array.isArray(log.entries)) {
        throw new Error(`Invalid scribe_books.book_json for campaign ${campaignId}.`);
      }
      lastTurnSeq = bookRow.lastTurnSeq;
      dirty = bookRow.dirty;
    }

    const order = turns.map((turn) => ({ id: turn.id, position: turn.seq }));
    const fingerprints = new Map(intake.messages.map((message) => [message.id, message.fingerprint]));
    const state = ScribeReplay.run(log, order, null, fingerprints, null, null, intake.messages);

    return {
      log,
      state,
      turns,
      messages: intake.messages,
      player: intake.player,
      lastTurnSeq,
      dirty,
    };
  }

  /**
   * @param {{campaignId: string, subjectId: string, before: CharacterCard, after: CharacterCard}} options
   * @returns {CharacterCard}
   * @throws {Error}
   */
  fileCardAppearance({ campaignId, subjectId, before, after }) {
    const loaded = this.loadState(campaignId);
    const { log, turns, messages } = loaded;
    const order = turns.map((turn) => ({ id: turn.id, position: turn.seq }));
    const fingerprints = new Map(messages.map((message) => [message.id, message.fingerprint]));
    const steps = CardFiling.operations({ state: loaded.state, subjectId, before, after });
    const filedFactIds = { ...before.filedFactIds };
    for (const field of CardFiling.changedFields(before, after)) {
      delete filedFactIds[field];
    }
    let state = loaded.state;
    for (const [index, step] of steps.entries()) {
      if (index > 0) {
        state = ScribeReplay.run(log, order, null, fingerprints, null, null, messages);
      }
      const entry = ScribeLogCore.rule(log, state, step.operation);
      if (step.operation.type === ScribeLogCore.Ruling.AddFact && CardFiling.ListFields.includes(step.field)) {
        filedFactIds[step.field] = entry.operations[0].fact;
      }
    }
    if (steps.length > 0) {
      this.#store.saveScribeBook(campaignId, {
        bookJson: JSON.stringify(log),
        lastTurnSeq: loaded.lastTurnSeq,
        dirty: loaded.dirty,
      });
    }
    return CharacterCard.fromObject({ ...after.toObject(), filedFactIds });
  }

  /**
   * @param {{state: object, subjectId: string}} options
   * @returns {Readonly<Record<string, string>>}
   */
  bookAppearance({ state, subjectId }) {
    const owner = ScribeKnowledge.survivor(state, subjectId);
    const appearance = {};
    for (const slot of CardFiling.Slots) {
      const texts = state.facts
        .filter((fact) => {
          return (
            fact.subject === owner &&
            fact.category === slot.category &&
            fact.status === ScribeReplay.Status.InForce
          );
        })
        .map((fact) => fact.text);
      if (texts.length > 0) {
        appearance[slot.key] = texts.join(CardFiling.Separator);
      }
    }
    return Object.freeze(appearance);
  }

  /**
   * @param {{state: object, character: object, presentCharacters?: ReadonlyArray<object>, turnsById?: ReadonlyMap<string, object> | Record<string, object>}} options
   * @returns {Readonly<{knownFacts: readonly object[], relationships: readonly object[], visibleThreads: readonly object[], rulings: readonly object[]}>}
   * @throws {TypeError}
   */
  characterKnowledgePacket({ state, character, presentCharacters = [], turnsById = new Map() } = {}) {
    if (state === null || typeof state !== 'object' || !Array.isArray(state.facts) || !Array.isArray(state.threads)) {
      throw new TypeError('state must be a valid Scribe replay state.');
    }
    if (character === null || typeof character !== 'object' || typeof character.id !== 'string') {
      throw new TypeError('character must be an object with an id string.');
    }
    if (!Array.isArray(presentCharacters)) {
      throw new TypeError('presentCharacters must be an array.');
    }

    const turnsMap = turnsById instanceof Map
      ? turnsById
      : turnsById !== null && typeof turnsById === 'object'
        ? new Map(Object.entries(turnsById))
        : null;
    if (turnsMap === null) {
      throw new TypeError('turnsById must be a Map or plain object.');
    }

    const knowerSubjectId = typeof character.scribeSubjectId === 'string' && character.scribeSubjectId.trim().length > 0
      ? character.scribeSubjectId.trim()
      : null;
    const knowerSurvivor = knowerSubjectId === null ? null : ScribeKnowledge.survivor(state, knowerSubjectId);
    const knowerNames = new Set();
    if (typeof character.name === 'string' && character.name.trim().length > 0) {
      knowerNames.add(ScribeText.normaliseName(character.name));
    }
    if (Array.isArray(character.aliases)) {
      for (const alias of character.aliases) {
        if (typeof alias === 'string' && alias.trim().length > 0) {
          knowerNames.add(ScribeText.normaliseName(alias));
        }
      }
    }
    if (knowerSurvivor !== null) {
      const knowerSubject = state.subjects.find((subject) => subject.id === knowerSurvivor);
      if (knowerSubject !== undefined) {
        for (const subjectName of [knowerSubject.label, knowerSubject.name, ...(knowerSubject.aka ?? [])]) {
          if (typeof subjectName === 'string' && subjectName.trim().length > 0) {
            knowerNames.add(ScribeText.normaliseName(subjectName));
          }
        }
      }
    }

    const knownFacts = [];
    for (const fact of state.facts) {
      if (fact.status === ScribeReplay.Status.InForce && ScribeKnowledge.knows(state, knowerSubjectId, fact)) {
        knownFacts.push(fact);
      }
    }

    const presentSubjectIds = new Set();
    const presentNames = new Set();
    for (const presentCharacter of presentCharacters) {
      if (presentCharacter === null || typeof presentCharacter !== 'object') {
        continue;
      }
      if (typeof presentCharacter.scribeSubjectId === 'string' && presentCharacter.scribeSubjectId.trim().length > 0) {
        presentSubjectIds.add(ScribeKnowledge.survivor(state, presentCharacter.scribeSubjectId.trim()));
      }
      if (typeof presentCharacter.name === 'string' && presentCharacter.name.trim().length > 0) {
        presentNames.add(ScribeText.normaliseName(presentCharacter.name));
      }
      if (Array.isArray(presentCharacter.aliases)) {
        for (const alias of presentCharacter.aliases) {
          if (typeof alias === 'string' && alias.trim().length > 0) {
            presentNames.add(ScribeText.normaliseName(alias));
          }
        }
      }
    }

    const relationships = [];
    for (const fact of knownFacts) {
      if (fact.category !== ScribeCategory.Settings.RelationCategory) {
        continue;
      }
      const matchesSubjectToPresent =
        knowerSurvivor !== null &&
        fact.subject === knowerSurvivor &&
        (
          (fact.target !== null && presentSubjectIds.has(fact.target)) ||
          (fact.target === null && fact.targetText !== null && presentNames.has(ScribeText.normaliseName(fact.targetText)))
        );
      const matchesPresentToSubject =
        knowerSurvivor !== null &&
        presentSubjectIds.has(fact.subject) &&
        (
          fact.target === knowerSurvivor ||
          (fact.target === null && fact.targetText !== null && knowerNames.has(ScribeText.normaliseName(fact.targetText)))
        );
      if (matchesSubjectToPresent || matchesPresentToSubject) {
        relationships.push(fact);
      }
    }

    const visibleThreads = [];
    for (const thread of state.threads) {
      if (thread.closed !== null) {
        continue;
      }
      let isVisible =
        thread.position === 0 ||
        thread.origin === ScribeLogCore.Origin.Notes ||
        thread.origin === ScribeLogCore.Origin.Operator;
      if (!isVisible && typeof thread.cite === 'string') {
        const openingTurn = turnsMap.get(thread.cite);
        if (openingTurn !== undefined) {
          if (Array.isArray(openingTurn.witnessIds) && openingTurn.witnessIds.includes(character.id)) {
            isVisible = true;
          } else if (
            Array.isArray(openingTurn.beats) &&
            openingTurn.beats.some((beat) => Array.isArray(beat.witnessIds) && beat.witnessIds.includes(character.id))
          ) {
            isVisible = true;
          }
        }
      }
      if (isVisible) {
        visibleThreads.push(thread);
      }
    }

    const rulings = [];
    for (const fact of knownFacts) {
      if (
        fact.pinned === true ||
        fact.made === true ||
        fact.origin === ScribeLogCore.Origin.Operator ||
        fact.origin === ScribeLogCore.Origin.Notes ||
        Boolean(state.editOrigins?.[fact.id])
      ) {
        rulings.push(fact);
      }
    }

    return Object.freeze({
      knownFacts: Object.freeze(knownFacts),
      relationships: Object.freeze(relationships),
      visibleThreads: Object.freeze(visibleThreads),
      rulings: Object.freeze(rulings),
    });
  }

  /**
   * @param {ReadonlyArray<object>} unreadTurns
   * @param {ReadonlyMap<string, object> | Record<string, object>} charactersById
   * @returns {readonly object[]}
   * @throws {TypeError}
   */
  synthesizeSceneOperations(unreadTurns, charactersById) {
    if (!Array.isArray(unreadTurns)) {
      throw new TypeError('unreadTurns must be an array.');
    }
    const lookupCharacter = charactersById instanceof Map
      ? (characterId) => charactersById.get(characterId)
      : charactersById !== null && typeof charactersById === 'object'
        ? (characterId) => charactersById[characterId]
        : null;
    if (lookupCharacter === null) {
      throw new TypeError('charactersById must be a Map or plain object.');
    }
    if (unreadTurns.length === 0) {
      return Object.freeze([]);
    }

    const sortedTurns = [...unreadTurns].sort((left, right) => left.seq - right.seq);
    const groups = [];
    let currentGroup = null;

    for (const turn of sortedTurns) {
      const sceneState = turn.sceneStateAfter ?? null;
      const sceneNumber = Number.isInteger(turn.sceneNumber)
        ? turn.sceneNumber
        : Number.isInteger(sceneState?.sceneNumber)
          ? sceneState.sceneNumber
          : 1;
      const day = Number.isInteger(sceneState?.day) && sceneState.day >= 1 ? sceneState.day : 1;
      const place = typeof sceneState?.location === 'string' && sceneState.location.trim().length > 0
        ? sceneState.location.trim()
        : 'Unknown';
      const timeLabel = typeof sceneState?.timeLabel === 'string' && sceneState.timeLabel.trim().length > 0
        ? sceneState.timeLabel.trim()
        : '';
      const reach = sceneState?.sceneType === SceneType.Private
        ? ScribeAnswer.Reach.Private
        : ScribeAnswer.Reach.Public;

      const sceneMemberIds = [];
      const seenMemberIds = new Set();
      for (const list of [sceneState?.presentIds, sceneState?.remoteIds]) {
        if (Array.isArray(list)) {
          for (const characterId of list) {
            if (typeof characterId === 'string' && !seenMemberIds.has(characterId)) {
              seenMemberIds.add(characterId);
              sceneMemberIds.push(characterId);
            }
          }
        }
      }

      const witnessUnion = new Set();
      if (Array.isArray(turn.witnessIds)) {
        for (const witnessId of turn.witnessIds) {
          if (typeof witnessId === 'string') {
            witnessUnion.add(witnessId);
          }
        }
      }
      if (Array.isArray(turn.beats)) {
        for (const beat of turn.beats) {
          if (Array.isArray(beat?.witnessIds)) {
            for (const witnessId of beat.witnessIds) {
              if (typeof witnessId === 'string') {
                witnessUnion.add(witnessId);
              }
            }
          }
        }
      }

      let activeCharacterIds;
      if (turn.role === TurnRole.User && turn.sceneStateBefore !== null && turn.sceneStateBefore !== undefined && Array.isArray(turn.witnessIds)) {
        activeCharacterIds = [...new Set(turn.witnessIds)];
      } else {
        activeCharacterIds = [...new Set([...sceneMemberIds, ...witnessUnion])];
      }

      const subjectMap = new Map();
      for (const characterId of activeCharacterIds) {
        const character = lookupCharacter(characterId);
        if (character === undefined || character === null) {
          continue;
        }
        const subjectId = typeof character.scribeSubjectId === 'string' && character.scribeSubjectId.trim().length > 0
          ? character.scribeSubjectId.trim()
          : null;
        const label = typeof character.name === 'string' && character.name.trim().length > 0
          ? character.name.trim()
          : characterId;
        const key = subjectId ?? `label:${label}`;
        if (!subjectMap.has(key)) {
          subjectMap.set(key, { subject: subjectId, label });
        }
      }

      const canExtendGroup =
        currentGroup !== null &&
        currentGroup.sceneNumber === sceneNumber &&
        currentGroup.reach === reach &&
        currentGroup.place === place &&
        currentGroup.day === day;

      if (!canExtendGroup) {
        currentGroup = {
          sceneNumber,
          day,
          place,
          timeLabel,
          reach,
          turns: [],
          turnSubjects: [],
        };
        groups.push(currentGroup);
      } else if (timeLabel.length > 0) {
        currentGroup.timeLabel = timeLabel;
      }
      currentGroup.turns.push(turn);
      currentGroup.turnSubjects.push(subjectMap);
    }

    const operations = [];
    for (const group of groups) {
      const openEntries = new Map();
      const completedEntries = [];
      const seenLabels = [];
      const seenLabelSet = new Set();

      for (let turnIndex = 0; turnIndex < group.turns.length; turnIndex += 1) {
        const turnSeq = group.turns[turnIndex].seq;
        const previousSeq = turnIndex > 0 ? group.turns[turnIndex - 1].seq : null;
        const presentAtTurn = group.turnSubjects[turnIndex];

        for (const [key, entry] of openEntries.entries()) {
          if (!presentAtTurn.has(key)) {
            entry.until = previousSeq;
            completedEntries.push(entry);
            openEntries.delete(key);
          }
        }
        for (const [key, info] of presentAtTurn.entries()) {
          if (!seenLabelSet.has(info.label)) {
            seenLabelSet.add(info.label);
            seenLabels.push(info.label);
          }
          if (!openEntries.has(key)) {
            openEntries.set(key, {
              subject: info.subject,
              label: info.label,
              from: turnIndex === 0 ? null : turnSeq,
              until: null,
            });
          }
        }
      }

      for (const entry of openEntries.values()) {
        completedEntries.push(entry);
      }

      const present = completedEntries.map((entry) => {
        return Object.freeze({
          ...(entry.subject !== null ? { subject: entry.subject } : {}),
          label: entry.label,
          from: entry.from,
          until: entry.until,
        });
      });

      const timePart = group.timeLabel.length > 0 ? ` (${group.timeLabel})` : '';
      const castPart = seenLabels.length > 0 ? ` with ${seenLabels.join(', ')}` : '';
      const summary = `${group.place}${timePart}${castPart}`.trim();

      operations.push(Object.freeze({
        type: ScribeAnswer.Type.Scene,
        day: group.day,
        first: group.turns[0].seq,
        last: group.turns[group.turns.length - 1].seq,
        place: group.place,
        reach: group.reach,
        present: Object.freeze(present),
        summary,
      }));
    }

    return Object.freeze(operations);
  }

  /**
   * @param {{campaignId: string, upToSeq?: number | null, signal?: AbortSignal | null, profile?: string | null}} options
   * @returns {Promise<Readonly<{log: object, state: object, lastTurnSeq: number, updated: boolean, scenesAdded: number, operationsAdded: number, refused: readonly object[]}>>}
   * @throws {Error}
   */
  async updateMemory({ campaignId, upToSeq = null, signal = null, profile = null } = {}) {
    if (upToSeq !== null && (!Number.isInteger(upToSeq) || upToSeq < 1)) {
      throw new RangeError('upToSeq must be null or a positive integer.');
    }
    if (signal !== null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
      throw new TypeError('signal must be null or an AbortSignal.');
    }

    const loaded = this.loadState(campaignId);
    const { log, turns, messages, player } = loaded;
    let state = loaded.state;
    const initialRevision = log.revision;

    const order = turns.map((turn) => ({ id: turn.id, position: turn.seq }));
    const fingerprints = new Map(messages.map((message) => [message.id, message.fingerprint]));

    const changedTurnIds = new Set();
    for (const entry of log.entries) {
      if (entry.withdrawn || entry.origin !== ScribeLogCore.Origin.Story) {
        continue;
      }
      if (Array.isArray(entry.sources)) {
        for (const source of entry.sources) {
          if (typeof source?.id === 'string' && Object.hasOwn(log.read, source.id)) {
            const currentFingerprint = fingerprints.get(source.id);
            if (currentFingerprint === undefined || currentFingerprint !== source.fingerprint) {
              changedTurnIds.add(source.id);
            }
          }
        }
      }
      const entryRetired = new Set(entry.retired ?? []);
      for (const operation of entry.operations) {
        if (operation.revoked === true) {
          continue;
        }
        for (const citedId of [operation.cite, operation.first, operation.last]) {
          if (
            typeof citedId === 'string' &&
            citedId.length > 0 &&
            !entryRetired.has(citedId) &&
            !fingerprints.has(citedId)
          ) {
            changedTurnIds.add(citedId);
          }
        }
      }
    }
    if (changedTurnIds.size > 0) {
      ScribeLogCore.withdrawSources(log, changedTurnIds);
      state = ScribeReplay.run(log, order, null, fingerprints, null, null, messages);
    }

    const allCharacters = this.listAllCharacters(campaignId);
    const pendingSubjectUpdates = [];
    for (const character of allCharacters) {
      if (character.archived && character.scribeSubjectId === null) {
        continue;
      }
      const existingSubject = character.scribeSubjectId === null
        ? undefined
        : state.subjects.find((subject) => subject.id === character.scribeSubjectId && subject.mergedInto === null);
      const trimmedCharacterName = character.name.trim();
      const labelChanged = existingSubject !== undefined && existingSubject.label !== trimmedCharacterName;
      let missingAlias = false;
      if (existingSubject !== undefined && Array.isArray(character.aliases)) {
        const existingAliasForms = new Set(existingSubject.aka.map((entry) => ScribeText.normaliseName(entry)));
        const normCharName = ScribeText.normaliseName(trimmedCharacterName);
        missingAlias = character.aliases.some((alias) => {
          if (typeof alias !== 'string' || alias.trim().length === 0) {
            return false;
          }
          const normAlias = ScribeText.normaliseName(alias);
          return normAlias.length > 0 && normAlias !== normCharName && !existingAliasForms.has(normAlias);
        });
      }
      if (character.scribeSubjectId === null || existingSubject === undefined || labelChanged || missingAlias) {
        const excludeSubjectIds = new Set();
        for (const otherCharacter of allCharacters) {
          if (
            otherCharacter.id !== character.id &&
            typeof otherCharacter.scribeSubjectId === 'string' &&
            otherCharacter.scribeSubjectId.trim().length > 0
          ) {
            const trimmedId = otherCharacter.scribeSubjectId.trim();
            excludeSubjectIds.add(trimmedId);
            excludeSubjectIds.add(ScribeKnowledge.survivor(state, trimmedId));
          }
        }
        const synced = ScribeLogCore.syncCharacterSubject(log, state, {
          subjectId: character.scribeSubjectId,
          name: character.name,
          aliases: character.aliases,
          kind: ScribeCategory.SubjectKinds.Character,
          excludeSubjectIds,
        });
        if (character.scribeSubjectId !== synced.subjectId) {
          pendingSubjectUpdates.push({ characterId: character.id, scribeSubjectId: synced.subjectId });
          character.scribeSubjectId = synced.subjectId;
        }
        if (synced.changed) {
          state = ScribeReplay.run(log, order, null, fingerprints, null, null, messages);
        }
      }
    }

    const unreadTurns = turns.filter((turn) => {
      return !Object.hasOwn(log.read, turn.id) && (upToSeq === null || turn.seq <= upToSeq);
    });
    const missingSceneTurns = turns.filter((turn) => {
      return (
        (upToSeq === null || turn.seq <= upToSeq) &&
        Object.hasOwn(log.read, turn.id) &&
        ScribeKnowledge.sceneAt(state, turn.seq) === null
      );
    });
    const charactersById = new Map(allCharacters.map((character) => [character.id, character]));
    const sourcesByPosition = new Map(messages.map((message) => [message.position, message]));

    if (unreadTurns.length === 0) {
      if (missingSceneTurns.length > 0) {
        const recoverySceneOps = this.synthesizeSceneOperations(missingSceneTurns, charactersById);
        if (recoverySceneOps.length > 0) {
          const recoveryAppend = ScribeLogCore.append(log, state, recoverySceneOps, {
            messages: [],
            origin: ScribeLogCore.Origin.Story,
            sources: sourcesByPosition,
          });
          const nextState = ScribeReplay.run(log, order, null, fingerprints, null, null, messages);
          const readSeqs = turns
            .filter((turn) => Object.hasOwn(log.read, turn.id))
            .map((turn) => turn.seq);
          const lastTurnSeq = readSeqs.length > 0 ? Math.max(...readSeqs) : 0;
          const scenesAdded = recoveryAppend.entry.operations.filter(
            (operation) => operation.type === ScribeAnswer.Type.Scene,
          ).length;
          this.#persistBookAndCharacters(
            campaignId,
            {
              bookJson: JSON.stringify(log),
              lastTurnSeq,
              dirty: false,
            },
            pendingSubjectUpdates,
          );
          return Object.freeze({
            log,
            state: nextState,
            lastTurnSeq,
            updated: true,
            scenesAdded,
            operationsAdded: recoveryAppend.entry.operations.length,
            refused: recoveryAppend.refused,
          });
        }
      }

      const readSeqs = turns
        .filter((turn) => Object.hasOwn(log.read, turn.id))
        .map((turn) => turn.seq);
      const lastTurnSeq = readSeqs.length > 0 ? Math.max(...readSeqs) : 0;
      if (loaded.dirty || log.revision !== initialRevision || pendingSubjectUpdates.length > 0) {
        this.#persistBookAndCharacters(
          campaignId,
          {
            bookJson: JSON.stringify(log),
            lastTurnSeq,
            dirty: false,
          },
          pendingSubjectUpdates,
        );
      }
      return Object.freeze({
        log,
        state,
        lastTurnSeq,
        updated: false,
        scenesAdded: 0,
        operationsAdded: 0,
        refused: Object.freeze([]),
      });
    }

    const model = await this.#resolveModel(campaignId);
    const unreadIds = new Set(unreadTurns.map((turn) => turn.id));
    const unreadMessages = messages.filter((message) => unreadIds.has(message.id));
    const sceneTurnMap = new Map();
    for (const turn of [...missingSceneTurns, ...unreadTurns]) {
      sceneTurnMap.set(turn.id, turn);
    }
    const sceneTurns = [...sceneTurnMap.values()].sort((left, right) => left.seq - right.seq);
    const sceneOps = this.synthesizeSceneOperations(sceneTurns, charactersById);

    const userPrompt = ScribeAnalyzer.input(state, player, unreadMessages, profile);
    const completion = await this.#client.complete({
      model,
      messages: [
        { role: 'system', content: ScribeAnalyzer.StoryPrompt },
        { role: 'user', content: userPrompt },
      ],
      stage: SpendStage.Scribe,
      campaignId,
      signal,
    });

    let parsed = ScribeAnswer.parseStory(completion.text);
    if (completion.text.trim().length > 0 && parsed.rows.size === 0 && parsed.refused.length > 0) {
      const repairPrompt = [
        'Your previous response did not follow the required pipe-delimited block format.',
        'Re-output strictly using === SUBJECTS, === NAMES, === FACTS, === CHANGES, === TOLD, === NIGHTS, === THREADS blocks.',
        'If there are no entries for a section, omit it or write (none). Do not include prose explanations.',
        '',
        'Previous invalid output:',
        completion.text,
        '',
        'Original input:',
        userPrompt,
      ].join('\n');

      const repairedCompletion = await this.#client.complete({
        model,
        messages: [
          { role: 'system', content: ScribeAnalyzer.StoryPrompt },
          { role: 'user', content: repairPrompt },
        ],
        stage: SpendStage.Scribe,
        campaignId,
        signal,
      });
      parsed = ScribeAnswer.parseStory(repairedCompletion.text);
      if (repairedCompletion.text.trim().length > 0 && parsed.rows.size === 0 && parsed.refused.length > 0) {
        throw new Error('Scribe returned unparseable output after repair retry.');
      }
    }

    const llmOps = [...parsed.rows.values()].filter((operation) => operation.type !== ScribeAnswer.Type.Scene);
    const combinedOps = [...sceneOps, ...llmOps];
    const resultsByPosition = new Map(unreadMessages.map((message) => [message.position, 'read']));

    const appendResult = ScribeLogCore.append(log, state, combinedOps, {
      messages: unreadMessages,
      origin: ScribeLogCore.Origin.Story,
      sources: sourcesByPosition,
      results: resultsByPosition,
    });

    const nextState = ScribeReplay.run(log, order, null, fingerprints, null, null, messages);
    const readSeqs = turns
      .filter((turn) => Object.hasOwn(log.read, turn.id))
      .map((turn) => turn.seq);
    const lastTurnSeq = readSeqs.length > 0 ? Math.max(...readSeqs) : 0;
    const scenesAdded = appendResult.entry.operations.filter(
      (operation) => operation.type === ScribeAnswer.Type.Scene,
    ).length;

    this.#persistBookAndCharacters(
      campaignId,
      {
        bookJson: JSON.stringify(log),
        lastTurnSeq,
        dirty: false,
      },
      pendingSubjectUpdates,
    );

    return Object.freeze({
      log,
      state: nextState,
      lastTurnSeq,
      updated: true,
      scenesAdded,
      operationsAdded: appendResult.entry.operations.length,
      refused: appendResult.refused,
    });
  }

  /**
   * @param {{campaignId: string, instruction: string, signal?: AbortSignal | null}} options
   * @returns {Promise<Readonly<{operations: readonly object[], refused: readonly object[], changes: readonly string[]}>>}
   * @throws {Error}
   */
  async tellPreview({ campaignId, instruction, signal = null } = {}) {
    if (typeof instruction !== 'string' || instruction.trim().length === 0) {
      throw new RangeError('instruction must be a non-empty string.');
    }
    if (signal !== null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
      throw new TypeError('signal must be null or an AbortSignal.');
    }

    const model = await this.#resolveModel(campaignId);
    const loaded = this.loadState(campaignId);
    const latestTurn = loaded.turns.at(-1) ?? null;
    const anchorPosition = latestTurn?.seq ?? 0;
    const anchorId = latestTurn?.id ?? null;
    const promptPosition = anchorPosition > 0 ? anchorPosition : 1;

    const userPrompt = ScribeAnalyzer.notesInput(loaded.state, loaded.player, [
      { text: instruction.trim(), position: promptPosition },
    ]);

    const completion = await this.#client.complete({
      model,
      messages: [
        { role: 'system', content: ScribeAnalyzer.NotesPrompt },
        { role: 'user', content: userPrompt },
      ],
      stage: SpendStage.Scribe,
      campaignId,
      signal,
    });

    const parsed = ScribeAnswer.parse(completion.text);
    const operations = Object.freeze(
      parsed.operations.map((operation) => {
        if (anchorPosition === 0 && typeof operation.position === 'number') {
          return Object.freeze({ ...operation, position: 0 });
        }
        return operation;
      }),
    );

    const previewLog = structuredClone(loaded.log);
    const applied = this.#applyTellOperations(previewLog, loaded.state, operations, loaded.turns, loaded.messages, {
      anchorPosition,
      anchorId,
    });

    return Object.freeze({
      operations,
      refused: Object.freeze([...parsed.refused, ...applied.refused]),
      changes: applied.changes,
    });
  }

  /**
   * @param {{campaignId: string, operations: ReadonlyArray<object>}} options
   * @returns {Readonly<{state: object, changes: readonly string[]}>}
   * @throws {Error}
   */
  tellCommit({ campaignId, operations } = {}) {
    if (!Array.isArray(operations)) {
      throw new TypeError('operations must be an array.');
    }

    const loaded = this.loadState(campaignId);
    if (operations.length === 0) {
      return Object.freeze({
        state: loaded.state,
        changes: this.describeChanges(loaded.state, loaded.state),
      });
    }

    const latestTurn = loaded.turns.at(-1) ?? null;
    const anchorPosition = latestTurn?.seq ?? 0;
    const anchorId = latestTurn?.id ?? null;

    const commitLog = structuredClone(loaded.log);
    const applied = this.#applyTellOperations(commitLog, loaded.state, operations, loaded.turns, loaded.messages, {
      anchorPosition,
      anchorId,
    });

    if (applied.refused.length > 0) {
      const firstRefusal = applied.refused[0];
      throw new Error(`Tell operation refused (${firstRefusal.reason}): ${firstRefusal.operation.type}`);
    }

    if (commitLog.revision !== loaded.log.revision) {
      this.#store.saveScribeBook(campaignId, {
        bookJson: JSON.stringify(commitLog),
        lastTurnSeq: loaded.lastTurnSeq,
        dirty: loaded.dirty,
      });
    }

    return Object.freeze({
      state: applied.afterState,
      changes: applied.changes,
    });
  }

  /**
   * @param {object} beforeState
   * @param {object} afterState
   * @returns {readonly string[]}
   */
  describeChanges(beforeState, afterState) {
    const labelLimit = 60;
    const textLimit = 200;
    const cutText = '...';
    const controlChars = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
    const formatChars = /\p{Cf}/gu;
    const quoteMarks = /(?!['’])\p{Quotation_Mark}/gu;
    const coveredStateKeys = [
      'revision',
      'subjects',
      'facts',
      'threads',
      'conflicts',
      'lookAlikes',
      'resolutions',
      'editOrigins',
      'editedSince',
    ];
    const subjectCoveredKeys = ['id', 'kind', 'label', 'aka'];
    const factCoveredKeys = ['id', 'status', 'hidden', 'told', 'widened'];
    const factLinkKeys = ['replacedBy', 'ended'];
    const status = ScribeReplay.Status;

    /**
     * @param {unknown} value
     * @param {number} limit
     * @returns {string}
     */
    const clean = (value, limit) => {
      const flat = ScribeIntakeAdapter.collapse(
        String(value).replace(controlChars, ' ').replace(formatChars, ''),
      );
      const points = Array.from(flat);
      if (points.length <= limit) {
        return flat;
      }
      return points.slice(0, limit - cutText.length).join('') + cutText;
    };

    /**
     * @param {unknown} value
     * @param {number} limit
     * @returns {string}
     */
    const quote = (value, limit) => {
      const inside = clean(value, limit).replace(quoteMarks, "'");
      return `"${inside}"`;
    };

    /**
     * @param {ReadonlyMap<string, string>} labelsMap
     * @param {object} fact
     * @returns {string}
     */
    const describeFact = (labelsMap, fact) => {
      const subjectLabel = quote(labelsMap.get(fact.subject), labelLimit);
      const textSuffix = `: ${quote(fact.text, textLimit)}`;
      if (fact.category !== ScribeCategory.Settings.RelationCategory) {
        return `${subjectLabel}, ${clean(fact.category, labelLimit)}${textSuffix}`;
      }
      const target = fact.target === null ? fact.targetText : labelsMap.get(fact.target);
      return `${subjectLabel} toward ${quote(target, labelLimit)}${textSuffix}`;
    };

    /**
     * @param {object} entry
     * @param {readonly string[]} omitted
     * @returns {string}
     */
    const serial = (entry, omitted) => {
      const kept = {};
      for (const key of Object.keys(entry)) {
        if (!omitted.includes(key)) {
          kept[key] = entry[key];
        }
      }
      return JSON.stringify(kept, (key, value) => {
        const tag = Object.prototype.toString.call(value);
        if (tag === '[object Map]' || tag === '[object Set]') {
          return Array.from(value, (item) => JSON.stringify(item)).sort();
        }
        return value;
      });
    };

    const lines = [];
    const labelOf = new Map();
    const subjects = new Map();
    const kept = new Map();
    const facts = new Map();
    const finals = new Map();
    const threads = new Map();
    const conflicts = new Map();

    for (const subject of beforeState.subjects) {
      subjects.set(subject.id, subject);
      labelOf.set(subject.id, subject.label);
    }
    for (const subject of afterState.subjects) {
      labelOf.set(subject.id, subject.label);
      kept.set(subject.id, subject);
    }
    for (const fact of beforeState.facts) {
      facts.set(fact.id, fact);
    }
    for (const fact of afterState.facts) {
      finals.set(fact.id, fact);
    }
    for (const thread of beforeState.threads) {
      threads.set(thread.id, thread);
    }
    const conflictKey = (conflict) => JSON.stringify([conflict.subject, conflict.category]);
    for (const conflict of beforeState.conflicts) {
      conflicts.set(conflictKey(conflict), conflict);
    }

    const mark = (fact) => (fact.hidden ? 'Hidden' : 'Not hidden');
    const named = new Set();
    const nameKey = (subjectId, aliasName) => `${subjectId}|${ScribeText.normaliseName(aliasName)}`;

    for (const subject of afterState.subjects) {
      if (!subjects.has(subject.id)) {
        lines.push(`New ${clean(subject.kind, labelLimit)}: ${quote(subject.label, labelLimit)}`);
        const own = [ScribeText.normaliseName(subject.label), ScribeText.normaliseName(subject.name)];
        for (const alias of subject.aka) {
          if (!own.includes(ScribeText.normaliseName(alias))) {
            named.add(nameKey(subject.id, alias));
            lines.push(`Another name for ${quote(subject.label, labelLimit)}: ${quote(alias, labelLimit)}`);
          }
        }
      }
    }
    for (const subject of afterState.subjects) {
      const earlier = subjects.get(subject.id);
      if (earlier !== undefined && earlier.kind !== subject.kind) {
        lines.push(`Becomes a ${clean(subject.kind, labelLimit)}: ${quote(subject.label, labelLimit)}`);
      }
    }
    for (const subject of afterState.subjects) {
      const earlier = subjects.get(subject.id);
      if (earlier !== undefined && earlier.label !== subject.label) {
        lines.push(`Renamed: ${quote(earlier.label, labelLimit)} is now ${quote(subject.label, labelLimit)}`);
      }
    }
    for (const subject of afterState.subjects) {
      const earlier = subjects.get(subject.id);
      if (earlier === undefined) {
        continue;
      }
      for (const alias of subject.aka) {
        if (!earlier.aka.includes(alias)) {
          named.add(nameKey(subject.id, alias));
          lines.push(`Another name for ${quote(subject.label, labelLimit)}: ${quote(alias, labelLimit)}`);
        }
      }
      for (const alias of earlier.aka) {
        if (!subject.aka.includes(alias)) {
          named.add(nameKey(subject.id, alias));
          lines.push(`No longer a name for ${quote(subject.label, labelLimit)}: ${quote(alias, labelLimit)}`);
        }
      }
    }
    for (const subject of beforeState.subjects) {
      if (!kept.has(subject.id)) {
        lines.push(`Leaves the book: ${quote(subject.label, labelLimit)}`);
      }
    }
    for (const subject of afterState.subjects) {
      const earlier = subjects.get(subject.id);
      if (earlier !== undefined && serial(earlier, subjectCoveredKeys) !== serial(subject, subjectCoveredKeys)) {
        lines.push(`Something else changes: ${quote(subject.label, labelLimit)}`);
      }
    }
    for (const fact of afterState.facts) {
      if (facts.has(fact.id)) {
        continue;
      }
      const said = `: ${describeFact(labelOf, fact)}`;
      const pinned = fact.made || fact.pinned ? ', pinned' : '';
      lines.push(
        fact.status === status.InForce
          ? `${mark(fact)}, new${pinned}${said}`
          : `${mark(fact)}, new but not in force (${clean(fact.status, labelLimit)})${pinned}${said}`,
      );
    }
    for (const fact of beforeState.facts) {
      if (!finals.has(fact.id)) {
        lines.push(`${mark(fact)}, removed: ${describeFact(labelOf, fact)}`);
      }
    }
    for (const fact of afterState.facts) {
      const earlier = facts.get(fact.id);
      if (earlier !== undefined && earlier.status !== fact.status) {
        lines.push(
          `${mark(fact)}, was ${clean(earlier.status, labelLimit)}, becomes ${clean(fact.status, labelLimit)}: ${describeFact(labelOf, fact)}`,
        );
        const reason = fact.status === status.Ended && fact.ended ? fact.ended.reason : '';
        if (clean(reason, textLimit) !== '') {
          lines.push(`${mark(fact)}, reason given for the end: ${describeFact(labelOf, fact)}: ${quote(reason, textLimit)}`);
        }
      }
    }
    for (const fact of afterState.facts) {
      const earlier = facts.get(fact.id);
      if (earlier !== undefined && earlier.hidden !== fact.hidden) {
        const prefix = earlier.hidden ? 'Was hidden, becomes not hidden: ' : 'Was not hidden, becomes hidden: ';
        lines.push(`${prefix}${describeFact(labelOf, fact)}`);
      }
    }
    for (const fact of afterState.facts) {
      const earlier = facts.get(fact.id);
      if (
        earlier !== undefined &&
        JSON.stringify([earlier.told, earlier.widened]) !== JSON.stringify([fact.told, fact.widened])
      ) {
        lines.push(`${mark(fact)}, who knows it changes: ${describeFact(labelOf, fact)}`);
      }
    }
    for (const fact of afterState.facts) {
      const earlier = facts.get(fact.id);
      if (earlier === undefined) {
        continue;
      }
      const omitted = earlier.status === fact.status ? factCoveredKeys : [...factCoveredKeys, ...factLinkKeys];
      const members = Object.keys(fact).filter((member) => {
        return (
          !omitted.includes(member) &&
          serial({ member: earlier[member] }, []) !== serial({ member: fact[member] }, [])
        );
      });
      if (members.length > 0) {
        lines.push(`${mark(fact)}, also changes (${members.join(', ')}): ${describeFact(labelOf, fact)}`);
      }
    }
    const presentConflicts = new Set();
    for (const conflict of afterState.conflicts) {
      presentConflicts.add(conflictKey(conflict));
      const earlier = conflicts.get(conflictKey(conflict));
      const said = `${quote(labelOf.get(conflict.subject), labelLimit)}, ${clean(conflict.category, labelLimit)}`;
      if (earlier === undefined) {
        lines.push(`A conflict for you to rule: ${said}`);
      } else if (serial(earlier, []) !== serial(conflict, [])) {
        lines.push(`A conflict changes: ${said}`);
      }
    }
    for (const conflict of beforeState.conflicts) {
      if (!presentConflicts.has(conflictKey(conflict))) {
        lines.push(
          `A conflict would be settled: ${quote(labelOf.get(conflict.subject), labelLimit)}, ${clean(conflict.category, labelLimit)}`,
        );
      }
    }
    const remainingThreads = new Set();
    for (const thread of afterState.threads) {
      remainingThreads.add(thread.id);
      const earlier = threads.get(thread.id);
      const threadText = quote(thread.text, textLimit);
      if (earlier === undefined) {
        lines.push(`${thread.closed === null ? 'Open thread: ' : 'New thread, already closed: '}${threadText}`);
      } else if (earlier.closed === null && thread.closed !== null) {
        lines.push(`Thread closed: ${threadText}`);
      } else if (earlier.closed !== null && thread.closed === null) {
        lines.push(`Thread reopened: ${threadText}`);
      } else if (serial(earlier, []) !== serial(thread, [])) {
        lines.push(`Thread changes: ${threadText}`);
      }
    }
    for (const thread of beforeState.threads) {
      if (!remainingThreads.has(thread.id)) {
        lines.push(`Thread removed: ${quote(thread.text, textLimit)}`);
      }
    }
    for (const member of Object.keys(afterState)) {
      if (
        coveredStateKeys.includes(member) ||
        serial({ member: beforeState[member] }, []) === serial({ member: afterState[member] }, [])
      ) {
        continue;
      }
      let said = false;
      if (member === 'aliases') {
        const known = new Set(beforeState[member].map((entry) => JSON.stringify(entry)));
        const final = new Set(afterState[member].map((entry) => JSON.stringify(entry)));
        const moved = [
          ...afterState[member].filter((entry) => !known.has(JSON.stringify(entry))),
          ...beforeState[member].filter((entry) => !final.has(JSON.stringify(entry))),
        ];
        said = moved.every((entry) => named.has(nameKey(entry.subject, entry.name)));
      }
      if (!said) {
        lines.push(`Something else in the book would change: ${clean(member, labelLimit)}`);
      }
    }
    return Object.freeze(lines.length === 0 ? ['Nothing in the book would change.'] : lines);
  }

  /**
   * @param {string} campaignId
   * @returns {Promise<string>}
   * @throws {Error}
   */
  async #resolveModel(campaignId) {
    if (this.#client === null) {
      throw new Error('OpenRouterClient is required for Scribe LLM operations.');
    }
    let resolved = null;
    if (this.#modelProvider !== null) {
      resolved = await this.#modelProvider({ stage: SpendStage.Scribe, campaignId });
    } else {
      resolved = this.#store.getSettings().models.scribe;
    }
    if (typeof resolved !== 'string' || resolved.trim().length === 0) {
      throw new Error('Scribe model is not configured.');
    }
    return resolved.trim();
  }

  /**
   * @param {string} campaignId
   * @param {{bookJson: string, lastTurnSeq: number, dirty: boolean}} bookPayload
   * @param {ReadonlyArray<{characterId: string, scribeSubjectId: string}>} pendingSubjectUpdates
   * @returns {void}
   */
  #persistBookAndCharacters(campaignId, bookPayload, pendingSubjectUpdates) {
    this.#store.saveScribeBook(campaignId, bookPayload);
    for (const update of pendingSubjectUpdates) {
      this.#store.updateCharacter(campaignId, update.characterId, { scribeSubjectId: update.scribeSubjectId });
    }
  }

  /**
   * @param {object} log
   * @param {object} beforeState
   * @param {ReadonlyArray<object>} operations
   * @param {ReadonlyArray<object>} turns
   * @param {readonly object[]} messages
   * @param {{anchorPosition: number, anchorId: string | null}} anchor
   * @returns {{afterState: object, changes: readonly string[], refused: readonly object[]}}
   * @throws {Error}
   */
  #applyTellOperations(log, beforeState, operations, turns, messages, anchor) {
    const answerOps = [];
    const rulingOps = [];
    for (const operation of operations) {
      if (operation === null || typeof operation !== 'object') {
        throw new TypeError('Each tell operation must be an object.');
      }
      if (Object.hasOwn(ScribeAnswer.Type, operation.type)) {
        answerOps.push(operation);
      } else if (Object.hasOwn(ScribeLogCore.Ruling, operation.type)) {
        rulingOps.push(operation);
      } else {
        throw new RangeError(`Unsupported tell operation type: ${String(operation.type)}`);
      }
    }

    const order = turns.map((turn) => ({ id: turn.id, position: turn.seq }));
    const fingerprints = new Map(messages.map((message) => [message.id, message.fingerprint]));
    let currentState = beforeState;

    let refused = Object.freeze([]);
    if (answerOps.length > 0) {
      const noteMessagesMap = new Map();
      noteMessagesMap.set(0, { id: null, position: 0, text: 'note' });
      noteMessagesMap.set(anchor.anchorPosition, {
        id: anchor.anchorId,
        position: anchor.anchorPosition,
        text: 'note',
      });
      for (const turn of turns) {
        if (!noteMessagesMap.has(turn.seq)) {
          noteMessagesMap.set(turn.seq, { id: turn.id, position: turn.seq, text: 'note' });
        }
      }
      const appendResult = ScribeLogCore.append(log, currentState, answerOps, {
        messages: [...noteMessagesMap.values()],
        origin: ScribeLogCore.Origin.Notes,
      });
      refused = appendResult.refused;
      if (refused.length === 0 && appendResult.entry.operations.length === 0) {
        log.entries.pop();
        log.nextSequence -= 1;
        log.revision -= 1;
      } else {
        currentState = ScribeReplay.run(log, order, null, fingerprints, null, null, messages);
      }
    }

    for (const rulingOp of rulingOps) {
      ScribeLogCore.rule(log, currentState, rulingOp);
      currentState = ScribeReplay.run(log, order, null, fingerprints, null, null, messages);
    }

    return {
      afterState: currentState,
      changes: this.describeChanges(beforeState, currentState),
      refused,
    };
  }
}
