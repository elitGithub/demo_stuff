import { ScribeAnalyzer } from '../scribe/ScribeAnalyzer.mjs';
import { ScribeIntakeAdapter } from '../scribe/ScribeIntakeAdapter.mjs';
import { ScribeKnowledge } from '../scribe/ScribeKnowledge.mjs';
import { ScribeLogCore } from '../scribe/ScribeLogCore.mjs';
import { ScribeReplay } from '../scribe/ScribeReplay.mjs';
import { CharacterTier } from '../store/enums/CharacterTier.mjs';
import { SpeakerType } from '../store/enums/SpeakerType.mjs';
import { SpendStage } from '../store/enums/SpendStage.mjs';
import { TurnMode } from '../store/enums/TurnMode.mjs';
import { CharacterMind } from './CharacterMind.mjs';
import { Director } from './Director.mjs';
import { EncounterRoller } from './EncounterRoller.mjs';
import { NarratorComposer } from './NarratorComposer.mjs';
import { WitnessFilter } from './WitnessFilter.mjs';

export class TurnEngine {
  #store;
  #client;
  #scribeService;
  #pedantService;
  #random;
  #maxResponders;
  #inFlight = new Set();

  /**
   * @param {{store: object, client: object, scribeService: object, pedantService?: object | null, random?: () => number, maxResponders?: number | null}} options
   * @throws {TypeError | RangeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('TurnEngine options must be a plain object.');
    }

    const {
      store,
      client,
      scribeService,
      pedantService = null,
      random = Math.random,
      maxResponders = null,
    } = options;

    if (store === null || typeof store !== 'object') {
      throw new TypeError('store must be a valid StoryStore instance.');
    }
    if (client === null || typeof client !== 'object' || typeof client.complete !== 'function' || typeof client.stream !== 'function') {
      throw new TypeError('client must provide complete() and stream() methods.');
    }
    if (
      scribeService === null ||
      typeof scribeService !== 'object' ||
      typeof scribeService.loadState !== 'function' ||
      typeof scribeService.characterKnowledgePacket !== 'function' ||
      typeof scribeService.updateMemory !== 'function'
    ) {
      throw new TypeError('scribeService must be a valid ScribeService instance.');
    }
    if (pedantService !== null && (typeof pedantService !== 'object' || typeof pedantService.checkTurn !== 'function')) {
      throw new TypeError('pedantService must be null or a valid PedantService instance.');
    }
    if (typeof random !== 'function') {
      throw new TypeError('random must be a function.');
    }
    if (maxResponders !== null && (!Number.isInteger(maxResponders) || maxResponders < 1)) {
      throw new RangeError('maxResponders must be null or a positive integer.');
    }

    this.#store = store;
    this.#client = client;
    this.#scribeService = scribeService;
    this.#pedantService = pedantService;
    this.#random = random;
    this.#maxResponders = maxResponders;
  }

  /**
   * @param {{campaignId: string, text: string, mode?: string, oocNudge?: string | null, signal?: AbortSignal | null, emit?: ((payload: {event: string, data: unknown}) => void | Promise<void>) | null}} options
   * @returns {Promise<Readonly<{userTurn: object, assistantTurn: object, sceneState: object, plan: object, truncated: boolean, playerBeatRemapped: boolean}>>}
   * @throws {Error}
   */
  async runTurn(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('runTurn options must be a plain object.');
    }

    const {
      campaignId,
      text,
      mode = TurnMode.Normal,
      oocNudge = null,
      signal = null,
      emit = null,
    } = options;

    this.#acquireLock(campaignId);
    try {
      if (typeof text !== 'string') {
        throw new TypeError('text must be a string.');
      }
      TurnMode.label(mode);
      if (oocNudge !== null && typeof oocNudge !== 'string') {
        throw new TypeError('oocNudge must be null or a string.');
      }
      if (signal !== null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
        throw new TypeError('signal must be null or an AbortSignal.');
      }
      if (emit !== null && typeof emit !== 'function') {
        throw new TypeError('emit must be null or a function.');
      }

      this.#throwIfAborted(signal);

      const snapshot = this.#loadCampaignSnapshot(campaignId);
      const scribeLoaded = this.#scribeService.loadState(campaignId);

      return await this.#executePipeline({
        campaign: snapshot.campaign,
        settings: snapshot.settings,
        allCharacters: snapshot.allCharacters,
        priorTurns: snapshot.allTurns,
        preState: snapshot.campaign.sceneState,
        scribeState: scribeLoaded.state,
        rawText: text,
        mode,
        oocNudge,
        signal,
        emit,
      });
    } finally {
      this.#inFlight.delete(campaignId);
    }
  }

  /**
   * @param {{campaignId: string, signal?: AbortSignal | null, emit?: ((payload: {event: string, data: unknown}) => void | Promise<void>) | null}} options
   * @returns {Promise<Readonly<{userTurn: object, assistantTurn: object, sceneState: object, plan: object, truncated: boolean, playerBeatRemapped: boolean}>>}
   * @throws {Error}
   */
  async regenerateLastTurn(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('regenerateLastTurn options must be a plain object.');
    }

    const {
      campaignId,
      signal = null,
      emit = null,
    } = options;

    this.#acquireLock(campaignId);
    try {
      if (signal !== null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
        throw new TypeError('signal must be null or an AbortSignal.');
      }
      if (emit !== null && typeof emit !== 'function') {
        throw new TypeError('emit must be null or a function.');
      }

      this.#throwIfAborted(signal);

      const latestPair = this.#store.getLatestTurnPair(campaignId);
      if (latestPair === null || latestPair.userTurn === null || latestPair.assistantTurn === null) {
        throw new Error('Cannot regenerate: latest turns do not form a complete user and assistant pair.');
      }

      const { userTurn, assistantTurn } = latestPair;
      const preState = userTurn.sceneStateBefore;
      if (preState === null || typeof preState !== 'object') {
        throw new Error('Cannot regenerate: missing sceneStateBefore snapshot on latest user turn.');
      }

      const snapshot = this.#loadCampaignSnapshot(campaignId);
      const discardedIdSet = new Set([userTurn.id, assistantTurn.id]);
      const priorTurns = snapshot.allTurns.filter((turn) => !discardedIdSet.has(turn.id));

      const scribeLoaded = this.#scribeService.loadState(campaignId);
      const previewLog = structuredClone(scribeLoaded.log);
      ScribeLogCore.withdrawSources(previewLog, discardedIdSet);
      const previewState = this.#recoverMissingScenes(
        previewLog,
        priorTurns,
        snapshot.allCharacters,
        snapshot.campaign,
      );

      return await this.#executePipeline({
        campaign: snapshot.campaign,
        settings: snapshot.settings,
        allCharacters: snapshot.allCharacters,
        priorTurns,
        preState,
        scribeState: previewState,
        rawText: userTurn.rawText,
        mode: userTurn.mode,
        oocNudge: userTurn.oocNudge,
        signal,
        emit,
        beforeCommit: () => {
          const deleted = this.#store.deleteLastTurnPair(campaignId);
          if (deleted === null) {
            throw new Error('Failed to delete latest turn pair.');
          }
          this.#withdrawFromSavedBook(
            campaignId,
            [deleted.deletedUserTurnId, deleted.deletedAssistantTurnId],
            priorTurns,
            snapshot.allCharacters,
            snapshot.campaign,
          );
        },
      });
    } finally {
      this.#inFlight.delete(campaignId);
    }
  }

  /**
   * @param {{campaignId: string}} options
   * @returns {Readonly<{deletedUserTurnId: string, deletedAssistantTurnId: string, deletedSeqs: [number, number], restoredSceneState: object}>}
   * @throws {Error}
   */
  deleteLastTurnPair(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('deleteLastTurnPair options must be a plain object.');
    }

    const { campaignId } = options;

    this.#acquireLock(campaignId);
    try {
      const deleted = this.#store.runTransaction(() => {
        const latestPair = this.#store.getLatestTurnPair(campaignId);
        if (latestPair === null || latestPair.userTurn === null || latestPair.assistantTurn === null) {
          throw new Error('Cannot delete: latest turns do not form a complete user and assistant pair.');
        }

        const deletedResult = this.#store.deleteLastTurnPair(campaignId);
        if (deletedResult === null) {
          throw new Error('Failed to delete latest turn pair.');
        }

        const snapshot = this.#loadCampaignSnapshot(campaignId);
        this.#withdrawFromSavedBook(
          campaignId,
          [deletedResult.deletedUserTurnId, deletedResult.deletedAssistantTurnId],
          snapshot.allTurns,
          snapshot.allCharacters,
          snapshot.campaign,
        );
        return deletedResult;
      });

      return Object.freeze({ ...deleted });
    } finally {
      this.#inFlight.delete(campaignId);
    }
  }

  /**
   * @param {{campaignId: string, turnId: string, text: string, beatId?: string | null}} options
   * @returns {object}
   * @throws {Error}
   */
  editTurn(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('editTurn options must be a plain object.');
    }

    const {
      campaignId,
      turnId,
      text,
      beatId = null,
    } = options;

    this.#acquireLock(campaignId);
    try {
      if (typeof turnId !== 'string' || turnId.trim().length === 0) {
        throw new RangeError('turnId must be a non-empty string.');
      }
      if (typeof text !== 'string') {
        throw new TypeError('text must be a string.');
      }
      if (text.trim().length === 0) {
        throw new RangeError('text must not be empty.');
      }
      if (beatId !== null && (typeof beatId !== 'string' || beatId.trim().length === 0)) {
        throw new RangeError('beatId must be null or a non-empty string.');
      }

      return this.#store.runTransaction(() => {
        const turn = this.#store.getTurn(campaignId, turnId);
        if (turn === null) {
          throw new RangeError(`Turn not found: ${turnId}`);
        }

        let targetBeatId;
        if (beatId !== null) {
          const belongsToTurn = Array.isArray(turn.beats) && turn.beats.some((beat) => beat.id === beatId);
          if (!belongsToTurn) {
            throw new RangeError(`Beat ${beatId} does not belong to turn ${turnId}.`);
          }
          targetBeatId = beatId;
        } else if (Array.isArray(turn.beats) && turn.beats.length === 1) {
          targetBeatId = turn.beats[0].id;
        } else {
          throw new RangeError('beatId is required when editing a multi-beat turn.');
        }

        const updatedTurn = this.#store.updateBeatText(campaignId, targetBeatId, text);
        if (updatedTurn === null) {
          throw new Error(`Failed to update beat text for beat ${targetBeatId}.`);
        }

        const snapshot = this.#loadCampaignSnapshot(campaignId);
        this.#withdrawFromSavedBook(
          campaignId,
          [turnId],
          snapshot.allTurns,
          snapshot.allCharacters,
          snapshot.campaign,
          { markDirty: true },
        );

        return updatedTurn;
      });
    } finally {
      this.#inFlight.delete(campaignId);
    }
  }

  /**
   * @param {string} campaignId
   * @returns {void}
   * @throws {Error}
   */
  #acquireLock(campaignId) {
    if (typeof campaignId !== 'string' || campaignId.trim().length === 0) {
      throw new RangeError('campaignId must be a non-empty string.');
    }
    if (this.#inFlight.has(campaignId)) {
      const conflictError = new Error(`A turn operation is already in flight for campaign ${campaignId}.`);
      conflictError.name = 'ConflictError';
      conflictError.statusCode = 409;
      throw conflictError;
    }
    this.#inFlight.add(campaignId);
  }

  /**
   * @param {AbortSignal | null} signal
   * @returns {void}
   * @throws {Error}
   */
  #throwIfAborted(signal) {
    if (signal?.aborted) {
      const abortError = new Error('Turn aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
  }

  /**
   * @param {((payload: {event: string, data: unknown}) => void | Promise<void>) | null} emit
   * @param {string} event
   * @param {unknown} data
   * @returns {Promise<void>}
   */
  async #emitEvent(emit, event, data) {
    if (emit !== null) {
      await emit({ event, data });
    }
  }

  /**
   * @param {string} campaignId
   * @returns {{campaign: object, settings: object, allCharacters: Array<object>, allTurns: Array<object>}}
   * @throws {RangeError}
   */
  #loadCampaignSnapshot(campaignId) {
    const campaign = this.#store.getCampaign(campaignId);
    if (campaign === null) {
      throw new RangeError(`Campaign not found: ${campaignId}`);
    }
    const settings = this.#store.getSettings();

    const allCharacters = [];
    let charCursor = null;
    while (true) {
      const charPage = this.#store.listCharacters(campaignId, {
        includeArchived: true,
        limit: 50,
        after: charCursor,
      });
      allCharacters.push(...charPage.items);
      if (charPage.nextCursor === null) {
        break;
      }
      charCursor = charPage.nextCursor;
    }

    const turnPages = [];
    let beforeSeq = null;
    while (true) {
      const turnPage = this.#store.listTurns(campaignId, {
        limit: 50,
        beforeSeq,
      });
      turnPages.push(...turnPage.items);
      if (turnPage.nextCursor === null) {
        break;
      }
      beforeSeq = turnPage.nextCursor;
    }
    const allTurns = turnPages.sort((leftTurn, rightTurn) => leftTurn.seq - rightTurn.seq);

    return {
      campaign,
      settings,
      allCharacters,
      allTurns,
    };
  }

  /**
   * @param {object} log
   * @param {ReadonlyArray<object>} remainingTurns
   * @param {ReadonlyArray<object>} allCharacters
   * @param {object} campaign
   * @returns {object}
   * @throws {Error}
   */
  #recoverMissingScenes(log, remainingTurns, allCharacters, campaign) {
    const sortedTurns = [...remainingTurns].sort((leftTurn, rightTurn) => leftTurn.seq - rightTurn.seq);
    const playerChar = campaign.playerCharacterId
      ? allCharacters.find((character) => character.id === campaign.playerCharacterId) ?? null
      : null;
    const intake = ScribeIntakeAdapter.fromTurns(sortedTurns, {
      playerCharacterId: campaign.playerCharacterId,
      playerName: playerChar?.name ?? null,
    });
    const order = sortedTurns.map((turn) => ({ id: turn.id, position: turn.seq }));
    const fingerprints = new Map(intake.messages.map((message) => [message.id, message.fingerprint]));
    let state = ScribeReplay.run(log, order, null, fingerprints, null, null, intake.messages);

    const missingTurns = sortedTurns.filter((turn) => {
      return Object.hasOwn(log.read, turn.id) && ScribeKnowledge.sceneAt(state, turn.seq) === null;
    });
    if (missingTurns.length === 0) {
      return state;
    }

    if (typeof this.#scribeService.synthesizeSceneOperations !== 'function') {
      throw new Error('scribeService.synthesizeSceneOperations() is required for Scribe scene recovery.');
    }

    const charactersById = new Map(allCharacters.map((character) => [character.id, character]));
    const recoverySceneOps = this.#scribeService.synthesizeSceneOperations(missingTurns, charactersById);
    if (recoverySceneOps.length > 0) {
      const sourcesByPosition = new Map(intake.messages.map((message) => [message.position, message]));
      ScribeLogCore.append(log, state, recoverySceneOps, {
        messages: [],
        origin: ScribeLogCore.Origin.Story,
        sources: sourcesByPosition,
        results: new Map(),
      });
      state = ScribeReplay.run(log, order, null, fingerprints, null, null, intake.messages);
    }

    return state;
  }

  /**
   * @param {string} campaignId
   * @param {ReadonlyArray<string>} turnIds
   * @param {ReadonlyArray<object>} remainingTurns
   * @param {ReadonlyArray<object>} allCharacters
   * @param {object} campaign
   * @param {{markDirty?: boolean}} [options]
   * @returns {boolean}
   */
  #withdrawFromSavedBook(campaignId, turnIds, remainingTurns, allCharacters, campaign, { markDirty = false } = {}) {
    const bookRow = this.#store.getScribeBook(campaignId);
    if (bookRow === null) {
      return false;
    }
    const log = JSON.parse(bookRow.bookJson);
    const hasReadTurn = turnIds.some((turnId) => Object.hasOwn(log.read, turnId));
    const initialRevision = log.revision;
    ScribeLogCore.withdrawSources(log, new Set(turnIds));
    if (!hasReadTurn && log.revision === initialRevision) {
      return false;
    }

    this.#recoverMissingScenes(log, remainingTurns, allCharacters, campaign);
    const readSeqs = remainingTurns
      .filter((turn) => Object.hasOwn(log.read, turn.id))
      .map((turn) => turn.seq);
    const lastTurnSeq = readSeqs.length > 0 ? Math.max(...readSeqs) : 0;
    this.#store.saveScribeBook(campaignId, {
      bookJson: JSON.stringify(log),
      lastTurnSeq,
      dirty: markDirty ? true : bookRow.dirty,
    });
    return true;
  }

  /**
   * @param {{campaign: object, settings: object, allCharacters: Array<object>, priorTurns: Array<object>, preState: object, scribeState: object, rawText: string, mode: string, oocNudge: string | null, signal: AbortSignal | null, emit: ((payload: {event: string, data: unknown}) => void | Promise<void>) | null, beforeCommit?: (() => void) | null}} pipelineInput
   * @returns {Promise<Readonly<{userTurn: object, assistantTurn: object, sceneState: object, plan: object, truncated: boolean, playerBeatRemapped: boolean}>>}
   * @throws {Error}
   */
  async #executePipeline({
    campaign,
    settings,
    allCharacters,
    priorTurns,
    preState,
    scribeState,
    rawText,
    mode,
    oocNudge,
    signal,
    emit,
    beforeCommit = null,
  }) {
    const narratorPrefixPattern = /^[\s*_]*narrator:\s*/i;
    const hasNarratorPrefix = narratorPrefixPattern.test(rawText);
    const effectiveMode = hasNarratorPrefix ? TurnMode.Narrator : mode;
    let promptText = hasNarratorPrefix ? rawText.replace(narratorPrefixPattern, '').trim() : rawText.trim();

    if (effectiveMode === TurnMode.Encounter && promptText.length === 0) {
      promptText = '*(Encounter)*';
    }
    if ((effectiveMode === TurnMode.Normal || effectiveMode === TurnMode.Narrator) && promptText.length === 0) {
      throw new RangeError('Turn text must not be blank.');
    }

    const normalizedOocNudge = oocNudge !== null && oocNudge.trim().length > 0 ? oocNudge.trim() : null;

    const directorModel = typeof settings?.models?.director === 'string' ? settings.models.director.trim() : '';
    const composerModel = typeof settings?.models?.composer === 'string' ? settings.models.composer.trim() : '';
    if (directorModel.length === 0) {
      throw new Error('Director model is not configured.');
    }
    if (composerModel.length === 0) {
      throw new Error('Composer model is not configured.');
    }

    const nonArchivedChars = allCharacters.filter((character) => !character.archived);
    const nonArchivedById = new Map(nonArchivedChars.map((character) => [character.id, character]));
    const playerChar = campaign.playerCharacterId
      ? nonArchivedById.get(campaign.playerCharacterId) ?? null
      : null;
    const preParticipantSet = new Set([...preState.presentIds, ...preState.remoteIds]);
    const absentNonPlayerCast = nonArchivedChars.filter((character) => {
      return character.id !== campaign.playerCharacterId && !preParticipantSet.has(character.id);
    });

    this.#throwIfAborted(signal);

    const encounterRoll = EncounterRoller.rollEncounter({
      mode: effectiveMode,
      sceneType: preState.sceneType,
      publicOdds: campaign.encounterPublicOdds,
      privateOdds: campaign.encounterPrivateOdds,
      absentCast: absentNonPlayerCast,
      random: this.#random,
    });

    await this.#emitEvent(emit, 'phase', { phase: 'directing' });

    const openThreadTitles = scribeState.threads
      .filter((thread) => thread.closed === null)
      .map((thread) => thread.text);

    const collectedSpendIds = new Set();
    const planResult = await Director.planTurn({
      campaign,
      characters: allCharacters,
      preState,
      recentTurns: priorTurns.slice(-8),
      userText: promptText,
      mode: effectiveMode,
      oocNudge: normalizedOocNudge,
      encounterRoll,
      openThreadTitles,
      model: directorModel,
      client: this.#client,
      signal,
      maxResponders: this.#maxResponders,
    });
    for (const spendId of planResult.spendIds) {
      if (typeof spendId === 'string' && spendId.length > 0) {
        collectedSpendIds.add(spendId);
      }
    }

    const { plan, nextState } = planResult;
    this.#throwIfAborted(signal);

    await this.#emitEvent(emit, 'phase', {
      phase: 'director_done',
      sceneState: nextState,
      plan,
    });

    const nextParticipantSet = new Set([...nextState.presentIds, ...nextState.remoteIds]);
    const arrivingSet = plan.sceneChanged
      ? new Set()
      : new Set([...nextParticipantSet].filter((characterId) => !preParticipantSet.has(characterId)));

    let mindPackets = [];
    if (plan.responders.length > 0) {
      const responderTargets = plan.responders.map((responderEntry) => {
        const character = nonArchivedById.get(responderEntry.characterId);
        if (character === undefined) {
          throw new Error(`Responder character not found: ${responderEntry.characterId}`);
        }
        const overrideModel = typeof character.modelOverride === 'string' ? character.modelOverride.trim() : '';
        const tierModel = typeof settings.models?.[character.tier] === 'string' ? settings.models[character.tier].trim() : '';
        const mindModel = overrideModel.length > 0 ? overrideModel : tierModel;
        if (mindModel.length === 0) {
          throw new Error(`Model is not configured for ${character.name} (${character.tier}).`);
        }
        return { responderEntry, character, model: mindModel };
      });

      this.#throwIfAborted(signal);

      await this.#emitEvent(emit, 'phase', {
        phase: 'minds',
        names: responderTargets.map((target) => target.character.name),
        slugs: responderTargets.map((target) => target.character.slug),
      });

      const presentCharacters = nonArchivedChars.filter((character) => nextParticipantSet.has(character.id));
      const turnsById = new Map(priorTurns.map((turn) => [turn.id, turn]));
      const subjectLabels = ScribeAnalyzer.labels(scribeState);

      const mindController = new AbortController();
      let onParentAbort = null;
      if (signal !== null) {
        onParentAbort = () => {
          mindController.abort(signal.reason);
        };
        if (signal.aborted) {
          mindController.abort(signal.reason);
        } else {
          signal.addEventListener('abort', onParentAbort, { once: true });
        }
      }

      let firstRootError = null;
      let settledResults;
      try {
        settledResults = await Promise.allSettled(
          responderTargets.map(async ({ responderEntry, character, model }) => {
            try {
              const maxTurns = character.tier === CharacterTier.Main ? 25 : 12;
              const witnessedHistory = WitnessFilter.selectWitnessedBeats({
                turns: priorTurns,
                characterId: character.id,
                maxTurns,
              });
              const knowledgePacket = this.#scribeService.characterKnowledgePacket({
                state: scribeState,
                character,
                presentCharacters,
                turnsById,
              });
              const isArriving = !plan.sceneChanged && arrivingSet.has(character.id);
              return await CharacterMind.think({
                character,
                campaign,
                nextState,
                presentCharacters,
                witnessedHistory,
                knowledgePacket,
                currentInput: promptText,
                isArriving,
                encounterBrief: plan.encounterAccepted ? plan.encounterBrief : '',
                beatGoal: responderEntry.beatGoal,
                length: responderEntry.length,
                subjectLabels,
                model,
                client: this.#client,
                signal: mindController.signal,
              });
            } catch (mindError) {
              if (firstRootError === null) {
                firstRootError = mindError;
              }
              if (!mindController.signal.aborted) {
                mindController.abort(mindError);
              }
              throw mindError;
            }
          }),
        );
      } finally {
        if (signal !== null && onParentAbort !== null) {
          signal.removeEventListener('abort', onParentAbort);
        }
      }

      this.#throwIfAborted(signal);

      if (firstRootError !== null) {
        throw firstRootError;
      }

      for (const settledResult of settledResults) {
        if (settledResult.status === 'rejected') {
          throw settledResult.reason;
        }
      }

      mindPackets = settledResults.map((settledResult) => {
        const packet = settledResult.value;
        for (const spendId of packet.spendIds) {
          if (typeof spendId === 'string' && spendId.length > 0) {
            collectedSpendIds.add(spendId);
          }
        }
        return packet;
      });
    }

    this.#throwIfAborted(signal);

    await this.#emitEvent(emit, 'phase', { phase: 'composing' });

    const isNarratorUserBeat =
      effectiveMode === TurnMode.Narrator ||
      playerChar === null ||
      (plan.userInputKind === 'narrator_direction' && !nextParticipantSet.has(playerChar.id));

    const userBeat = {
      speakerType: isNarratorUserBeat ? SpeakerType.Narrator : SpeakerType.Player,
      characterId: isNarratorUserBeat ? null : playerChar.id,
      speakerName: isNarratorUserBeat ? 'Narrator' : playerChar.name,
      text: promptText,
    };

    let userWitnessIds;
    if (plan.sceneChanged) {
      userWitnessIds = [...nextParticipantSet];
    } else {
      const userWitnessSet = new Set(preParticipantSet);
      if (
        userBeat.speakerType === SpeakerType.Player &&
        playerChar !== null &&
        nextParticipantSet.has(playerChar.id)
      ) {
        userWitnessSet.add(playerChar.id);
      }
      userWitnessIds = [...userWitnessSet];
    }

    const recentSceneTurns = priorTurns.filter((turn) => turn.sceneNumber === nextState.sceneNumber);
    const composerResult = await NarratorComposer.compose({
      campaign,
      characters: allCharacters,
      nextState,
      recentSceneTurns,
      userBeat,
      oocNudge: normalizedOocNudge,
      directorPlan: plan,
      mindPackets,
      model: composerModel,
      client: this.#client,
      signal,
      onBeatDelta: emit === null
        ? null
        : async (parsedDelta) => {
            await this.#emitEvent(emit, 'beat_delta', parsedDelta);
          },
    });
    if (typeof composerResult.spendId === 'string' && composerResult.spendId.length > 0) {
      collectedSpendIds.add(composerResult.spendId);
    }

    this.#throwIfAborted(signal);

    const preBeatWitnessSet = new Set(preParticipantSet);
    if (
      userBeat.speakerType === SpeakerType.Player &&
      playerChar !== null &&
      nextParticipantSet.has(playerChar.id)
    ) {
      preBeatWitnessSet.add(playerChar.id);
    }

    const arrivingNonPlayerSet = new Set(
      [...arrivingSet].filter((characterId) => {
        return !(userBeat.speakerType === SpeakerType.Player && playerChar !== null && characterId === playerChar.id);
      }),
    );

    let arrivalBeatIndex = 0;
    if (!plan.sceneChanged && arrivingNonPlayerSet.size > 0) {
      const arrivingPatterns = [];
      for (const arrivingId of arrivingNonPlayerSet) {
        const arrivingChar = nonArchivedById.get(arrivingId);
        if (arrivingChar === undefined) {
          continue;
        }
        const rawTerms = [
          arrivingChar.name,
          arrivingChar.slug,
          ...(Array.isArray(arrivingChar.aliases) ? arrivingChar.aliases : []),
        ];
        for (const rawTerm of rawTerms) {
          if (typeof rawTerm !== 'string') {
            continue;
          }
          const normalizedTerm = rawTerm.trim().replace(/\s+/g, ' ');
          if (normalizedTerm.length === 0) {
            continue;
          }
          const escapedTerm = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          arrivingPatterns.push(
            new RegExp(`(?<![\\p{L}\\p{N}_])${escapedTerm}(?![\\p{L}\\p{N}_])`, 'iu'),
          );
        }
      }

      arrivalBeatIndex = composerResult.beats.findIndex((beat) => {
        if (beat.characterId !== null && arrivingNonPlayerSet.has(beat.characterId)) {
          return true;
        }
        if (beat.speakerType === SpeakerType.Narrator && arrivingPatterns.length > 0) {
          const normalizedText = beat.text.replace(/\s+/g, ' ');
          return arrivingPatterns.some((pattern) => pattern.test(normalizedText));
        }
        return false;
      });
      if (arrivalBeatIndex === -1) {
        arrivalBeatIndex = composerResult.beats.length;
      }
    }

    const assistantTurnWitnessSet = new Set();
    const assistantBeats = composerResult.beats.map((beat, beatIndex) => {
      let beatWitnessIds;
      if (plan.sceneChanged || arrivingNonPlayerSet.size === 0 || beatIndex >= arrivalBeatIndex) {
        beatWitnessIds = [...nextParticipantSet];
      } else {
        beatWitnessIds = [...preBeatWitnessSet];
      }
      for (const witnessId of beatWitnessIds) {
        assistantTurnWitnessSet.add(witnessId);
      }
      return {
        speakerType: beat.speakerType,
        characterId: beat.characterId,
        speakerName: beat.speakerName,
        text: beat.text,
        witnessIds: beatWitnessIds,
        mindPacket: beat.mindPacket,
      };
    });

    const commitPayload = {
      campaignId: campaign.id,
      userTurn: {
        mode: effectiveMode,
        rawText: promptText,
        oocNudge: normalizedOocNudge,
        sceneNumber: nextState.sceneNumber,
        witnessIds: userWitnessIds,
      },
      userBeat: {
        ...userBeat,
        witnessIds: userWitnessIds,
        mindPacket: null,
      },
      assistantTurn: {
        mode: effectiveMode,
        rawText: composerResult.rawText,
        sceneNumber: nextState.sceneNumber,
        witnessIds: [...assistantTurnWitnessSet],
        directorPlan: plan,
        truncated: composerResult.truncated,
      },
      assistantBeats,
      nextSceneState: nextState,
      spendIds: [...collectedSpendIds],
    };

    this.#throwIfAborted(signal);

    const committed = this.#store.runTransaction(() => {
      if (beforeCommit !== null) {
        beforeCommit();
      }
      return this.#store.commitTurnPair(commitPayload);
    });

    await this.#emitEvent(emit, 'committed', {
      userTurn: committed.userTurn,
      assistantTurn: committed.assistantTurn,
      sceneState: nextState,
    });

    if (!signal?.aborted && this.#pedantService !== null && settings.pedantEnabled) {
      if (scribeState.facts.length > 0 || scribeState.subjects.length > 0) {
        try {
          const findings = await this.#pedantService.checkTurn({
            campaignId: campaign.id,
            turn: committed.assistantTurn,
            beats: committed.assistantTurn.beats,
            signal,
          });
          if (Array.isArray(findings) && findings.length > 0) {
            await this.#emitEvent(emit, 'findings', findings);
          }
        } catch (pedantError) {
          await this.#emitEvent(emit, 'warning', {
            stage: SpendStage.Pedant,
            message: pedantError instanceof Error ? pedantError.message : String(pedantError),
          });
        }
      }
    }

    if (!signal?.aborted) {
      try {
        let memoryResult = null;
        if (plan.sceneChanged) {
          const priorSceneMaxSeq = [...priorTurns, committed.userTurn, committed.assistantTurn]
            .filter((turn) => turn.sceneNumber < nextState.sceneNumber)
            .reduce((maxSeq, turn) => Math.max(maxSeq, turn.seq), 0);
          if (priorSceneMaxSeq > 0) {
            memoryResult = await this.#scribeService.updateMemory({
              campaignId: campaign.id,
              upToSeq: priorSceneMaxSeq,
              signal,
            });
          }
        } else if (
          campaign.scribeInterval > 0 &&
          this.#store.countTurnsSinceScribe(campaign.id) >= campaign.scribeInterval
        ) {
          memoryResult = await this.#scribeService.updateMemory({
            campaignId: campaign.id,
            signal,
          });
        }
        if (memoryResult !== null && memoryResult.updated === true) {
          await this.#emitEvent(emit, 'memory_updated', memoryResult);
        }
      } catch (scribeError) {
        await this.#emitEvent(emit, 'warning', {
          stage: SpendStage.Scribe,
          message: scribeError instanceof Error ? scribeError.message : String(scribeError),
        });
      }
    }

    return Object.freeze({
      userTurn: committed.userTurn,
      assistantTurn: committed.assistantTurn,
      sceneState: nextState,
      plan,
      truncated: composerResult.truncated,
      playerBeatRemapped: composerResult.playerBeatRemapped,
    });
  }
}
