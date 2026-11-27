import { ScribeIntakeAdapter } from '../scribe/ScribeIntakeAdapter.mjs';
import { ScribeKnowledge } from '../scribe/ScribeKnowledge.mjs';
import { ScribeLogCore } from '../scribe/ScribeLogCore.mjs';
import { ScribeReplay } from '../scribe/ScribeReplay.mjs';
import { ScribeText } from '../scribe/ScribeText.mjs';
import { CharacterTier } from '../store/enums/CharacterTier.mjs';
import { SceneStyle } from '../store/enums/SceneStyle.mjs';
import { SpeakerType } from '../store/enums/SpeakerType.mjs';
import { SpendStage } from '../store/enums/SpendStage.mjs';
import { TurnMode } from '../store/enums/TurnMode.mjs';
import { CharacterBrain } from './CharacterBrain.mjs';
import { Director } from './Director.mjs';
import { EncounterRoller } from './EncounterRoller.mjs';
import { HistoryWindow } from './HistoryWindow.mjs';
import { NarrationParts } from './NarrationParts.mjs';
import { Narrator } from './Narrator.mjs';
import { RequestBudget } from './RequestBudget.mjs';
import { StorySlice } from './StorySlice.mjs';
import { WitnessFilter } from './WitnessFilter.mjs';

export class TurnEngine {
  static Settings = Object.freeze({
    Phase: Object.freeze({
      Directing: 'directing',
      DirectorDone: 'director_done',
      Narrating: 'narrating',
      Replying: 'replying',
    }),
    Event: Object.freeze({
      Phase: 'phase',
      BeatDelta: 'beat_delta',
      Committed: 'committed',
      Findings: 'findings',
      Warning: 'warning',
      MemoryUpdated: 'memory_updated',
    }),
    MainHistoryMaxTurns: 25,
    RecurringHistoryMaxTurns: 12,
    NarratorHistoryMaxTurns: 25,
    NarratorSlug: 'narrator',
    EmptyText: '',
    LineSeparator: '\n',
    ParagraphSeparator: '\n\n',
    CommaSpace: ', ',
    SpeakerSeparator: ': ',
    AbortName: 'AbortError',
    AbortMessage: 'Turn aborted',
    ConflictName: 'ConflictError',
    ConflictStatusCode: 409,
    EncounterFallbackText: '*(Encounter)*',
    DefaultArrivalDirection: 'Describe the arrival.',
    DefaultSceneDirection: 'Describe the scene.',
    DefaultPageLimit: 50,
    SingleTurnWindow: 1,
    HistoryTag: Narrator.Settings.Tag.History,

    /**
     * @returns {RegExp}
     */
    get NarratorPrefixPattern() {
      return /^[\s*_]*narrator:\s*/i;
    },
  });

  #store;
  #client;
  #scribeService;
  #pedantService;
  #random;
  #modelCatalog;
  #inFlight = new Set();

  /**
   * @param {{store: object, client: object, scribeService: object, pedantService?: object | null, random?: () => number, modelCatalog: {contextLength: (modelId: string) => number | null}}} options
   * @throws {TypeError}
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
      modelCatalog,
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
    if (
      modelCatalog === null ||
      typeof modelCatalog !== 'object' ||
      Array.isArray(modelCatalog) ||
      typeof modelCatalog.contextLength !== 'function'
    ) {
      throw new TypeError('modelCatalog must provide a contextLength() method.');
    }

    this.#store = store;
    this.#client = client;
    this.#scribeService = scribeService;
    this.#pedantService = pedantService;
    this.#random = random;
    this.#modelCatalog = modelCatalog;
  }

  /**
   * @param {string} campaignId
   * @returns {boolean}
   * @throws {RangeError}
   */
  isInFlight(campaignId) {
    if (typeof campaignId !== 'string' || campaignId.trim().length === 0) {
      throw new RangeError('campaignId must be a non-empty string.');
    }
    return this.#inFlight.has(campaignId);
  }

  /**
   * @param {{campaignId: string, text: string, mode?: string, narration?: string | null, oocNudge?: string | null, signal?: AbortSignal | null, emit?: ((payload: {event: string, data: unknown}) => void | Promise<void>) | null}} options
   * @returns {Promise<Readonly<{userTurn: object, assistantTurn: object, sceneState: object, plan: object, truncated: boolean}>>}
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
      narration = null,
      oocNudge = null,
      signal = null,
      emit = null,
    } = options;

    this.#acquireLock(campaignId);
    try {
      if (typeof text !== 'string') {
        throw new TypeError('text must be a string.');
      }
      if (narration !== null && typeof narration !== 'string') {
        throw new TypeError('narration must be null or a string.');
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
        narration,
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
   * @returns {Promise<Readonly<{userTurn: object, assistantTurn: object, sceneState: object, plan: object, truncated: boolean}>>}
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
      const remainingTurns = snapshot.allTurns.filter((turn) => turn.id !== assistantTurn.id);
      const priorTurns = remainingTurns.filter((turn) => turn.id !== userTurn.id);

      const scribeLoaded = this.#scribeService.loadState(campaignId);
      const previewLog = structuredClone(scribeLoaded.log);
      ScribeLogCore.withdrawSources(previewLog, new Set([assistantTurn.id]));
      const previewState = this.#recoverMissingScenes(
        previewLog,
        remainingTurns,
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
        existingUserTurn: userTurn,
        mode: userTurn.mode,
        oocNudge: userTurn.oocNudge,
        signal,
        emit,
        beforeCommit: () => {
          const deleted = this.#store.deleteLastAssistantTurn(campaignId);
          if (deleted === null) {
            throw new Error('Failed to delete latest assistant turn.');
          }
          this.#withdrawFromSavedBook(
            campaignId,
            [deleted.deletedTurnId],
            remainingTurns,
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
      conflictError.name = TurnEngine.Settings.ConflictName;
      conflictError.statusCode = TurnEngine.Settings.ConflictStatusCode;
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
    if (signal !== null && signal.aborted) {
      const abortError = new Error(TurnEngine.Settings.AbortMessage);
      abortError.name = TurnEngine.Settings.AbortName;
      throw abortError;
    }
  }

  /**
   * @param {unknown} error
   * @param {AbortSignal | null} signal
   * @returns {void}
   * @throws {Error}
   */
  #rethrowIfAborted(error, signal) {
    if (error instanceof Error && error.name === TurnEngine.Settings.AbortName) {
      throw error;
    }
    this.#throwIfAborted(signal);
  }

  /**
   * @param {((payload: {event: string, data: unknown}) => void | Promise<void>) | null} emit
   * @param {string} event
   * @param {unknown} data
   * @returns {Promise<void>}
   * @throws {Error}
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
    const pageLimit = TurnEngine.Settings.DefaultPageLimit;

    const allCharacters = [];
    let charCursor = null;
    while (true) {
      const charPage = this.#store.listCharacters(campaignId, {
        includeArchived: true,
        limit: pageLimit,
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
        limit: pageLimit,
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
   * @param {readonly object[]} remainingTurns
   * @param {readonly object[]} allCharacters
   * @param {object} campaign
   * @returns {object}
   * @throws {Error}
   */
  #recoverMissingScenes(log, remainingTurns, allCharacters, campaign) {
    const sortedTurns = [...remainingTurns].sort((leftTurn, rightTurn) => leftTurn.seq - rightTurn.seq);
    const matchedPlayer = campaign.playerCharacterId
      ? allCharacters.find((character) => character.id === campaign.playerCharacterId)
      : undefined;
    const playerName = matchedPlayer === undefined ? null : matchedPlayer.name;
    const intake = ScribeIntakeAdapter.fromTurns(sortedTurns, {
      playerCharacterId: campaign.playerCharacterId,
      playerName,
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
   * @param {readonly string[]} turnIds
   * @param {readonly object[]} remainingTurns
   * @param {readonly object[]} allCharacters
   * @param {object} campaign
   * @param {{markDirty?: boolean}} [options]
   * @returns {boolean}
   * @throws {Error}
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
   * @param {object} character
   * @param {object} settings
   * @returns {string}
   * @throws {Error}
   */
  #resolveCharacterModel(character, settings) {
    const engineSettings = TurnEngine.Settings;
    const overrideModel = typeof character.modelOverride === 'string'
      ? character.modelOverride.trim()
      : engineSettings.EmptyText;
    const tierModel = typeof settings.models[character.tier] === 'string'
      ? settings.models[character.tier].trim()
      : engineSettings.EmptyText;
    const resolvedModel = overrideModel.length > 0 ? overrideModel : tierModel;
    if (resolvedModel.length === 0) {
      throw new Error(`Model is not configured for ${character.name} (${character.tier}).`);
    }
    return resolvedModel;
  }

  /**
   * @param {readonly string[]} characterIds
   * @param {ReadonlyMap<string, object>} nonArchivedById
   * @returns {string[]}
   */
  #collectSubjectIds(characterIds, nonArchivedById) {
    const subjectIds = [];
    for (const characterId of characterIds) {
      const character = nonArchivedById.get(characterId);
      if (
        character !== undefined &&
        typeof character.scribeSubjectId === 'string' &&
        character.scribeSubjectId.trim().length > 0
      ) {
        subjectIds.push(character.scribeSubjectId.trim());
      }
    }
    return subjectIds;
  }

  /**
   * @param {{roleLabel: string, model: string, budget: {limitTokens: number | null, estimate: (text: string) => number, fits: (usedTokens: number, text: string) => boolean}, buildMessages: (storyState: string, history: string) => readonly [Readonly<{role: string, content: string}>, Readonly<{role: string, content: string}>], scribeState: object, viewer: {subjectId: string | null, omniscient: boolean, characterId?: string | null}, scene: {location: string, day: number, timeLabel: string, sceneType: string, situation: string}, presentSubjectIds: readonly string[], remoteSubjectIds: readonly string[], namedText: string, playerName: string | null, turnsById: ReadonlyMap<string, object> | null, historyTurns: ReadonlyArray<object>, historyCharacterId: string | null, historyMaxTurns: number}} contextOptions
   * @returns {{storyState: string, history: string}}
   * @throws {Error}
   */
  #assembleBudgetedContext({
    roleLabel,
    model,
    budget,
    buildMessages,
    scribeState,
    viewer,
    scene,
    presentSubjectIds,
    remoteSubjectIds,
    namedText,
    playerName,
    turnsById,
    historyTurns,
    historyCharacterId,
    historyMaxTurns,
  }) {
    const engineSettings = TurnEngine.Settings;
    const mandatoryMessages = buildMessages(engineSettings.EmptyText, engineSettings.EmptyText);
    const mandatoryTokens =
      budget.estimate(mandatoryMessages[0].content) +
      budget.estimate(mandatoryMessages[1].content);
    if (budget.limitTokens !== null && mandatoryTokens > budget.limitTokens) {
      throw new Error(`Mandatory prompt exceeds context budget for ${roleLabel} on model ${model}.`);
    }

    const sliceUsedTokens =
      budget.estimate(mandatoryMessages[0].content) +
      budget.estimate(`${mandatoryMessages[1].content}${engineSettings.ParagraphSeparator}`);
    const storySlice = StorySlice.build({
      state: scribeState,
      viewer,
      scene,
      presentSubjectIds,
      remoteSubjectIds,
      namedText,
      playerName,
      budget,
      usedTokens: sliceUsedTokens,
      turnsById,
    });

    const withSliceMessages = buildMessages(storySlice.text, engineSettings.EmptyText);
    const historyWrapper = `${engineSettings.ParagraphSeparator}<${engineSettings.HistoryTag}>${engineSettings.LineSeparator}${engineSettings.LineSeparator}</${engineSettings.HistoryTag}>`;
    const historyUsedTokens =
      budget.estimate(withSliceMessages[0].content) +
      budget.estimate(`${withSliceMessages[1].content}${historyWrapper}`);
    const historyWindow = HistoryWindow.build({
      turns: historyTurns,
      characterId: historyCharacterId,
      maxTurns: historyMaxTurns,
      budget,
      usedTokens: historyUsedTokens,
    });

    return {
      storyState: storySlice.text,
      history: historyWindow.text,
    };
  }

  /**
   * @param {{campaign: object, settings: object, allCharacters: Array<object>, priorTurns: Array<object>, preState: object, scribeState: object, rawText?: string, narration?: string | null, existingUserTurn?: object | null, mode: string, oocNudge: string | null, signal: AbortSignal | null, emit: ((payload: {event: string, data: unknown}) => void | Promise<void>) | null, beforeCommit?: (() => void) | null}} pipelineInput
   * @returns {Promise<Readonly<{userTurn: object, assistantTurn: object, sceneState: object, plan: object, truncated: boolean}>>}
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
    narration = null,
    existingUserTurn = null,
    mode,
    oocNudge,
    signal,
    emit,
    beforeCommit = null,
  }) {
    const engineSettings = TurnEngine.Settings;
    const narratorPrefixPattern = engineSettings.NarratorPrefixPattern;
    let narrationText = engineSettings.EmptyText;
    let effectiveMode = mode;
    let promptText;
    let directorUserText;
    let directorNarrationText = null;
    if (existingUserTurn !== null) {
      promptText = existingUserTurn.beats.map((beat) => beat.text).join(NarrationParts.Settings.Joiner);
      const nonNarratorBeats = existingUserTurn.beats.filter((beat) => beat.speakerType !== SpeakerType.Narrator);
      const narratorBeats = existingUserTurn.beats.filter((beat) => beat.speakerType === SpeakerType.Narrator);
      if (nonNarratorBeats.length > 0 && narratorBeats.length > 0) {
        directorUserText = nonNarratorBeats.map((beat) => beat.text).join(NarrationParts.Settings.Joiner);
        directorNarrationText = narratorBeats.map((beat) => beat.text).join(NarrationParts.Settings.Joiner);
      } else {
        directorUserText = promptText;
      }
    } else {
      const parts = NarrationParts.split(rawText, narration);
      narrationText = parts.narration;
      const hasNarratorPrefix = narratorPrefixPattern.test(parts.text);
      effectiveMode = hasNarratorPrefix ? TurnMode.Narrator : mode;
      promptText = hasNarratorPrefix
        ? parts.text.replace(narratorPrefixPattern, engineSettings.EmptyText).trim()
        : parts.text;
      if (
        (effectiveMode === TurnMode.Normal || effectiveMode === TurnMode.Narrator) &&
        promptText.length === 0 &&
        narrationText.length > 0
      ) {
        effectiveMode = TurnMode.Narrator;
        promptText = narrationText;
        narrationText = engineSettings.EmptyText;
      }
      directorUserText = promptText;
      directorNarrationText = narrationText.length > 0 ? narrationText : null;
    }

    if (effectiveMode === TurnMode.Encounter && promptText.length === 0) {
      promptText = engineSettings.EncounterFallbackText;
      if (existingUserTurn === null) {
        directorUserText = promptText;
      }
    }
    if ((effectiveMode === TurnMode.Normal || effectiveMode === TurnMode.Narrator) && promptText.length === 0) {
      throw new RangeError('Turn text must not be blank.');
    }

    const normalizedOocNudge = oocNudge !== null && oocNudge.trim().length > 0 ? oocNudge.trim() : null;

    const directorModel = typeof settings.models.director === 'string'
      ? settings.models.director.trim()
      : engineSettings.EmptyText;
    const composerModel = typeof settings.models.composer === 'string'
      ? settings.models.composer.trim()
      : engineSettings.EmptyText;
    if (directorModel.length === 0) {
      throw new Error('Director model is not configured.');
    }
    if (composerModel.length === 0) {
      throw new Error('Narrator model is not configured.');
    }

    const nonArchivedChars = allCharacters.filter((character) => !character.archived);
    const nonArchivedById = new Map(nonArchivedChars.map((character) => [character.id, character]));
    const matchedPlayer = campaign.playerCharacterId
      ? nonArchivedById.get(campaign.playerCharacterId)
      : undefined;
    const playerChar = matchedPlayer === undefined ? null : matchedPlayer;
    const playerName = playerChar === null ? null : playerChar.name;
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

    await this.#emitEvent(emit, engineSettings.Event.Phase, { phase: engineSettings.Phase.Directing });

    const openThreadTitles = scribeState.threads
      .filter((thread) => thread.closed === null)
      .map((thread) => thread.text);

    const directorBudget = RequestBudget.create({
      contextLength: this.#modelCatalog.contextLength(directorModel),
      replyReserve: settings.replyReserve,
      charsPerToken: RequestBudget.charsPerToken({
        store: this.#store,
        model: directorModel,
      }),
    });

    const collectedSpendIds = new Set();
    const planResult = await Director.planTurn({
      campaign,
      characters: allCharacters,
      preState,
      recentTurns: priorTurns,
      userText: directorUserText,
      narrationText: directorNarrationText,
      mode: effectiveMode,
      oocNudge: normalizedOocNudge,
      encounterRoll,
      openThreadTitles,
      model: directorModel,
      client: this.#client,
      signal,
      budget: directorBudget,
      replyReserve: settings.replyReserve,
    });
    for (const spendId of planResult.spendIds) {
      if (typeof spendId === 'string' && spendId.length > 0) {
        collectedSpendIds.add(spendId);
      }
    }

    const { plan } = planResult;
    this.#throwIfAborted(signal);

    const carriedPin = plan.sceneChanged ? null : preState.pinnedStyle;
    const effectiveStyle = carriedPin !== null ? carriedPin : plan.style;
    const styleText = effectiveStyle === SceneStyle.None
      ? engineSettings.EmptyText
      : settings.sceneStyles[effectiveStyle];
    const nextState = Object.freeze({
      ...planResult.nextState,
      style: effectiveStyle,
      pinnedStyle: carriedPin,
    });

    await this.#emitEvent(emit, engineSettings.Event.Phase, {
      phase: engineSettings.Phase.DirectorDone,
      sceneState: nextState,
      plan,
    });

    for (const responderEntry of plan.responders) {
      const responderChar = nonArchivedById.get(responderEntry.characterId);
      if (responderChar === undefined) {
        throw new Error(`Responder character not found: ${responderEntry.characterId}`);
      }
      this.#resolveCharacterModel(responderChar, settings);
    }

    const nextParticipantSet = new Set([...nextState.presentIds, ...nextState.remoteIds]);
    const arrivingSet = plan.sceneChanged
      ? new Set()
      : new Set([...nextParticipantSet].filter((characterId) => !preParticipantSet.has(characterId)));

    const isNarratorUserBeat =
      effectiveMode === TurnMode.Narrator ||
      playerChar === null ||
      (plan.userInputKind === Director.Settings.InputKind.NarratorDirection && !nextParticipantSet.has(playerChar.id));

    const userBeat = existingUserTurn === null
      ? {
          speakerType: isNarratorUserBeat ? SpeakerType.Narrator : SpeakerType.Player,
          characterId: isNarratorUserBeat ? null : playerChar.id,
          speakerName: isNarratorUserBeat ? SpeakerType.label(SpeakerType.Narrator) : playerChar.name,
          text: promptText,
        }
      : null;

    const userHasPlayerBeat = existingUserTurn === null
      ? userBeat.speakerType === SpeakerType.Player
      : existingUserTurn.beats.some((beat) => beat.speakerType === SpeakerType.Player);

    let userWitnessIds;
    if (plan.sceneChanged) {
      userWitnessIds = [...nextParticipantSet];
    } else {
      const userWitnessSet = new Set(preParticipantSet);
      if (userHasPlayerBeat && playerChar !== null && nextParticipantSet.has(playerChar.id)) {
        userWitnessSet.add(playerChar.id);
      }
      userWitnessIds = [...userWitnessSet];
    }

    const userTurnLines = existingUserTurn !== null
      ? existingUserTurn.beats.map((beat) => `${beat.speakerName}${engineSettings.SpeakerSeparator}${beat.text}`)
      : [
          `${userBeat.speakerName}${engineSettings.SpeakerSeparator}${userBeat.text}`,
          ...(narrationText.length > 0
            ? [`${SpeakerType.label(SpeakerType.Narrator)}${engineSettings.SpeakerSeparator}${narrationText}`]
            : []),
        ];

    const arrivingNonPlayerSet = new Set(
      [...arrivingSet].filter((characterId) => {
        return !(userHasPlayerBeat && playerChar !== null && characterId === playerChar.id);
      }),
    );

    const presentSubjectIds = this.#collectSubjectIds(nextState.presentIds, nonArchivedById);
    const remoteSubjectIds = this.#collectSubjectIds(nextState.remoteIds, nonArchivedById);
    const sliceScene = {
      location: nextState.location,
      day: nextState.day,
      timeLabel: nextState.timeLabel,
      sceneType: nextState.sceneType,
      situation: plan.situation,
    };
    const turnsById = new Map(priorTurns.map((turn) => [turn.id, turn]));
    const witnessIdsList = [...nextParticipantSet];

    const assistantBeats = [];
    const earlierBoxes = [];
    let anyTruncated = false;
    let nextStreamBeatIndex = 0;

    const shouldRunNarrator =
      plan.narratorDirective.length > 0 ||
      arrivingNonPlayerSet.size > 0 ||
      plan.pacing === Director.Settings.Pacing.NarratorOnly;

    if (shouldRunNarrator) {
      this.#throwIfAborted(signal);
      await this.#emitEvent(emit, engineSettings.Event.Phase, { phase: engineSettings.Phase.Narrating });

      const arrivingNames = [];
      for (const arrivingId of arrivingNonPlayerSet) {
        const arrivingChar = nonArchivedById.get(arrivingId);
        if (arrivingChar !== undefined) {
          arrivingNames.push(arrivingChar.name);
        }
      }

      const directionParts = [];
      if (plan.narratorDirective.length > 0) {
        directionParts.push(plan.narratorDirective);
      } else if (arrivingNonPlayerSet.size > 0) {
        directionParts.push(
          arrivingNames.length > 0
            ? `Describe the arrival of ${arrivingNames.join(engineSettings.CommaSpace)}.`
            : engineSettings.DefaultArrivalDirection,
        );
      } else {
        directionParts.push(engineSettings.DefaultSceneDirection);
      }
      if (plan.encounterAccepted && plan.encounterBrief.length > 0) {
        directionParts.push(`Encounter: ${plan.encounterBrief}`);
      }
      if (plan.walkOnsEnter.length > 0) {
        directionParts.push(`Walk-ons entering: ${plan.walkOnsEnter.join(engineSettings.CommaSpace)}`);
      }
      if (plan.walkOnsLeave.length > 0) {
        directionParts.push(`Walk-ons leaving: ${plan.walkOnsLeave.join(engineSettings.CommaSpace)}`);
      }
      if (normalizedOocNudge !== null) {
        directionParts.push(`OOC nudge: ${normalizedOocNudge}`);
      }
      const narratorDirection = directionParts.join(engineSettings.LineSeparator);
      const userTurnText = userTurnLines.join(engineSettings.LineSeparator);

      const currentSceneTurns = priorTurns.filter((turn) => turn.sceneNumber === nextState.sceneNumber);
      const lastSceneTurn = currentSceneTurns.length > 0
        ? currentSceneTurns[currentSceneTurns.length - 1]
        : null;
      const lastSceneTurnLines = lastSceneTurn !== null && Array.isArray(lastSceneTurn.beats)
        ? lastSceneTurn.beats.map((beat) => `${beat.speakerName}${engineSettings.SpeakerSeparator}${beat.text}`)
        : [];
      const narratorNamedText = [...userTurnLines, ...lastSceneTurnLines].join(engineSettings.LineSeparator);

      const narratorBudget = RequestBudget.create({
        contextLength: this.#modelCatalog.contextLength(composerModel),
        replyReserve: settings.replyReserve,
        charsPerToken: RequestBudget.charsPerToken({
          store: this.#store,
          model: composerModel,
        }),
      });

      const narratorContext = this.#assembleBudgetedContext({
        roleLabel: SpeakerType.label(SpeakerType.Narrator),
        model: composerModel,
        budget: narratorBudget,
        buildMessages: (storyStateText, historyText) => {
          return Narrator.buildMessages({
            campaign,
            storyState: storyStateText,
            history: historyText,
            thisTurn: userTurnText,
            styleText,
            direction: narratorDirection,
          });
        },
        scribeState,
        viewer: { subjectId: null, omniscient: true },
        scene: sliceScene,
        presentSubjectIds,
        remoteSubjectIds,
        namedText: narratorNamedText,
        playerName,
        turnsById: null,
        historyTurns: currentSceneTurns,
        historyCharacterId: null,
        historyMaxTurns: engineSettings.NarratorHistoryMaxTurns,
      });

      const narratorStreamIndex = nextStreamBeatIndex;
      let narratorEmittedDelta = false;
      let narratorResult = null;
      try {
        narratorResult = await Narrator.narrate({
          campaign,
          storyState: narratorContext.storyState,
          history: narratorContext.history,
          thisTurn: userTurnText,
          styleText,
          direction: narratorDirection,
          model: composerModel,
          replyReserve: settings.replyReserve,
          client: this.#client,
          signal,
          onDelta: emit === null
            ? null
            : async (delta) => {
                narratorEmittedDelta = true;
                await this.#emitEvent(emit, engineSettings.Event.BeatDelta, {
                  beatIndex: narratorStreamIndex,
                  speakerType: SpeakerType.Narrator,
                  slug: engineSettings.NarratorSlug,
                  speakerName: SpeakerType.label(SpeakerType.Narrator),
                  delta,
                });
              },
        });
      } catch (narratorError) {
        this.#rethrowIfAborted(narratorError, signal);
        if (narratorEmittedDelta) {
          nextStreamBeatIndex += 1;
        }
        const errorMessage = narratorError instanceof Error ? narratorError.message : String(narratorError);
        await this.#emitEvent(emit, engineSettings.Event.Warning, {
          stage: SpendStage.Composer,
          message: `Narrator failed: ${errorMessage}`,
        });
      }

      if (narratorResult !== null) {
        if (typeof narratorResult.spendId === 'string' && narratorResult.spendId.length > 0) {
          collectedSpendIds.add(narratorResult.spendId);
        }
        if (narratorResult.narration.length === 0) {
          if (narratorEmittedDelta) {
            nextStreamBeatIndex += 1;
          }
          await this.#emitEvent(emit, engineSettings.Event.Warning, {
            stage: SpendStage.Composer,
            message: 'Narrator returned an empty narration.',
          });
        } else {
          nextStreamBeatIndex += 1;
          if (narratorResult.truncated) {
            anyTruncated = true;
          }
          const narratorSpeakerName = SpeakerType.label(SpeakerType.Narrator);
          assistantBeats.push({
            speakerType: SpeakerType.Narrator,
            characterId: null,
            speakerName: narratorSpeakerName,
            text: narratorResult.narration,
            witnessIds: witnessIdsList,
            mindPacket: null,
          });
          earlierBoxes.push(`${narratorSpeakerName}${engineSettings.SpeakerSeparator}${narratorResult.narration}`);
        }
      }
    }

    const queue = plan.responders.map((entry) => ({ ...entry }));
    const queuedIds = new Set(queue.map((entry) => entry.characterId));
    const replyCounts = new Map();

    while (queue.length > 0) {
      const entry = queue.shift();
      queuedIds.delete(entry.characterId);

      const character = nonArchivedById.get(entry.characterId);
      if (character === undefined) {
        throw new Error(`Responder character not found: ${entry.characterId}`);
      }
      const brainModel = this.#resolveCharacterModel(character, settings);

      this.#throwIfAborted(signal);
      await this.#emitEvent(emit, engineSettings.Event.Phase, {
        phase: engineSettings.Phase.Replying,
        name: character.name,
        slug: character.slug,
      });

      const characterThisTurnLines = arrivingNonPlayerSet.has(character.id)
        ? earlierBoxes
        : [...userTurnLines, ...earlierBoxes];
      const characterThisTurn = characterThisTurnLines.join(engineSettings.LineSeparator);

      const latestWitnessed = WitnessFilter.selectWitnessedBeats({
        turns: priorTurns,
        characterId: character.id,
        maxTurns: engineSettings.SingleTurnWindow,
      });
      const latestWitnessedLines = latestWitnessed.length > 0
        ? latestWitnessed[0].beats.map((beat) => `${beat.speakerName}${engineSettings.SpeakerSeparator}${beat.text}`)
        : [];
      const characterNamedText = [...characterThisTurnLines, ...latestWitnessedLines].join(engineSettings.LineSeparator);

      const brainBudget = RequestBudget.create({
        contextLength: this.#modelCatalog.contextLength(brainModel),
        replyReserve: settings.replyReserve,
        charsPerToken: RequestBudget.charsPerToken({
          store: this.#store,
          model: brainModel,
        }),
      });

      const brainDirection = {
        reacting: entry.reacting,
        length: entry.length,
        beatGoal: entry.beatGoal,
      };
      const viewerSubjectId = typeof character.scribeSubjectId === 'string' && character.scribeSubjectId.trim().length > 0
        ? character.scribeSubjectId.trim()
        : null;
      const historyMaxTurns = character.tier === CharacterTier.Main
        ? engineSettings.MainHistoryMaxTurns
        : engineSettings.RecurringHistoryMaxTurns;

      const brainContext = this.#assembleBudgetedContext({
        roleLabel: character.name,
        model: brainModel,
        budget: brainBudget,
        buildMessages: (storyStateText, historyText) => {
          return CharacterBrain.buildMessages({
            campaign,
            character,
            card: character.card,
            playerName,
            storyState: storyStateText,
            history: historyText,
            thisTurn: characterThisTurn,
            styleText,
            direction: brainDirection,
          });
        },
        scribeState,
        viewer: {
          subjectId: viewerSubjectId,
          omniscient: false,
          characterId: character.id,
        },
        scene: sliceScene,
        presentSubjectIds,
        remoteSubjectIds,
        namedText: characterNamedText,
        playerName,
        turnsById,
        historyTurns: priorTurns,
        historyCharacterId: character.id,
        historyMaxTurns,
      });

      const brainStreamIndex = nextStreamBeatIndex;
      let brainEmittedDelta = false;
      let brainResult = null;
      try {
        brainResult = await CharacterBrain.reply({
          campaign,
          character,
          card: character.card,
          playerName,
          storyState: brainContext.storyState,
          history: brainContext.history,
          thisTurn: characterThisTurn,
          styleText,
          direction: brainDirection,
          model: brainModel,
          replyReserve: settings.replyReserve,
          client: this.#client,
          signal,
          onDelta: emit === null
            ? null
            : async (delta) => {
                brainEmittedDelta = true;
                await this.#emitEvent(emit, engineSettings.Event.BeatDelta, {
                  beatIndex: brainStreamIndex,
                  speakerType: SpeakerType.Character,
                  slug: character.slug,
                  speakerName: character.name,
                  delta,
                });
              },
        });
      } catch (brainError) {
        this.#rethrowIfAborted(brainError, signal);
        if (brainEmittedDelta) {
          nextStreamBeatIndex += 1;
        }
        const errorMessage = brainError instanceof Error ? brainError.message : String(brainError);
        await this.#emitEvent(emit, engineSettings.Event.Warning, {
          stage: SpendStage.Mind,
          message: `${character.name} failed: ${errorMessage}`,
        });
        continue;
      }

      if (typeof brainResult.spendId === 'string' && brainResult.spendId.length > 0) {
        collectedSpendIds.add(brainResult.spendId);
      }
      if (brainResult.reply.length === 0) {
        if (brainEmittedDelta) {
          nextStreamBeatIndex += 1;
        }
        await this.#emitEvent(emit, engineSettings.Event.Warning, {
          stage: SpendStage.Mind,
          message: `${character.name} returned an empty reply.`,
        });
        continue;
      }

      nextStreamBeatIndex += 1;
      if (brainResult.truncated) {
        anyTruncated = true;
      }

      const previousReplyCount = replyCounts.get(character.id);
      replyCounts.set(character.id, (previousReplyCount === undefined ? 0 : previousReplyCount) + 1);

      assistantBeats.push({
        speakerType: SpeakerType.Character,
        characterId: character.id,
        speakerName: character.name,
        text: brainResult.reply,
        witnessIds: witnessIdsList,
        mindPacket: {
          thoughts: brainResult.thoughts,
          next: brainResult.next,
          direction: brainDirection,
        },
      });
      earlierBoxes.push(`${character.name}${engineSettings.SpeakerSeparator}${brainResult.reply}`);

      if (brainResult.next !== null) {
        const rawNext = brainResult.next.trim();
        const lowerNext = rawNext.toLowerCase();
        const normalizedNext = ScribeText.normaliseName(rawNext);
        let handoffTarget = null;
        const slugMatch = nonArchivedChars.find((candidate) => candidate.slug.toLowerCase() === lowerNext);
        if (slugMatch !== undefined) {
          handoffTarget = slugMatch;
        }
        if (handoffTarget === null && normalizedNext.length > 0) {
          const nameMatches = nonArchivedChars.filter((candidate) => {
            return ScribeText.normaliseName(candidate.name) === normalizedNext;
          });
          if (nameMatches.length === 1) {
            handoffTarget = nameMatches[0];
          } else if (nameMatches.length > 1) {
            const presentNameMatches = nameMatches.filter((candidate) => nextParticipantSet.has(candidate.id));
            if (presentNameMatches.length === 1) {
              handoffTarget = presentNameMatches[0];
            }
          }
        }
        if (handoffTarget === null && normalizedNext.length > 0) {
          const aliasMatches = nonArchivedChars.filter((candidate) => {
            return Array.isArray(candidate.aliases) && candidate.aliases.some((alias) => {
              return ScribeText.normaliseName(alias) === normalizedNext;
            });
          });
          if (aliasMatches.length === 1) {
            handoffTarget = aliasMatches[0];
          } else if (aliasMatches.length > 1) {
            const presentAliasMatches = aliasMatches.filter((candidate) => nextParticipantSet.has(candidate.id));
            if (presentAliasMatches.length === 1) {
              handoffTarget = presentAliasMatches[0];
            }
          }
        }

        if (handoffTarget !== null) {
          const targetReplyCount = replyCounts.get(handoffTarget.id);
          const countForTarget = targetReplyCount === undefined ? 0 : targetReplyCount;
          if (
            nextParticipantSet.has(handoffTarget.id) &&
            handoffTarget.id !== campaign.playerCharacterId &&
            handoffTarget.isPlayer !== true &&
            handoffTarget.id !== character.id &&
            !queuedIds.has(handoffTarget.id) &&
            countForTarget < settings.maxRepliesPerCharacter
          ) {
            queue.push({
              characterId: handoffTarget.id,
              slug: handoffTarget.slug,
              name: handoffTarget.name,
              beatGoal: engineSettings.EmptyText,
              length: Director.Settings.Length.Medium,
              reacting: character.slug,
            });
            queuedIds.add(handoffTarget.id);
          }
        }
      }
    }

    this.#throwIfAborted(signal);
    if (assistantBeats.length === 0) {
      throw new Error('Turn produced zero non-empty boxes.');
    }

    const assistantRawText = assistantBeats
      .map((beat) => `${beat.speakerName}${engineSettings.SpeakerSeparator}${beat.text}`)
      .join(engineSettings.ParagraphSeparator);

    const assistantPayload = {
      mode: effectiveMode,
      rawText: assistantRawText,
      sceneNumber: nextState.sceneNumber,
      witnessIds: witnessIdsList,
      directorPlan: plan,
      truncated: anyTruncated,
    };

    const committed = this.#store.runTransaction(() => {
      if (beforeCommit !== null) {
        beforeCommit();
      }
      if (existingUserTurn !== null) {
        const assistantTurn = this.#store.commitAssistantTurn({
          campaignId: campaign.id,
          userTurnId: existingUserTurn.id,
          assistantTurn: assistantPayload,
          assistantBeats,
          nextSceneState: nextState,
          spendIds: [...collectedSpendIds],
        });
        return { userTurn: this.#store.getTurn(campaign.id, existingUserTurn.id), assistantTurn };
      }
      return this.#store.commitTurnPair({
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
        userExtraBeats: narrationText.length === 0
          ? []
          : [{
              speakerType: SpeakerType.Narrator,
              characterId: null,
              speakerName: SpeakerType.label(SpeakerType.Narrator),
              text: narrationText,
              witnessIds: userWitnessIds,
            }],
        assistantTurn: assistantPayload,
        assistantBeats,
        nextSceneState: nextState,
        spendIds: [...collectedSpendIds],
      });
    });

    await this.#emitEvent(emit, engineSettings.Event.Committed, {
      userTurn: committed.userTurn,
      assistantTurn: committed.assistantTurn,
      sceneState: nextState,
    });

    if ((signal === null || !signal.aborted) && this.#pedantService !== null && settings.pedantEnabled) {
      if (scribeState.facts.length > 0 || scribeState.subjects.length > 0) {
        try {
          const findings = await this.#pedantService.checkTurn({
            campaignId: campaign.id,
            turn: committed.assistantTurn,
            beats: committed.assistantTurn.beats,
            signal,
          });
          if (Array.isArray(findings) && findings.length > 0) {
            await this.#emitEvent(emit, engineSettings.Event.Findings, findings);
          }
        } catch (pedantError) {
          await this.#emitEvent(emit, engineSettings.Event.Warning, {
            stage: SpendStage.Pedant,
            message: pedantError instanceof Error ? pedantError.message : String(pedantError),
          });
        }
      }
    }

    if (signal === null || !signal.aborted) {
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
          await this.#emitEvent(emit, engineSettings.Event.MemoryUpdated, memoryResult);
        }
      } catch (scribeError) {
        await this.#emitEvent(emit, engineSettings.Event.Warning, {
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
      truncated: anyTruncated,
    });
  }
}
