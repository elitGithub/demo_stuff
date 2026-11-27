import { CharacterCard } from '../store/CharacterCard.mjs';
import { SceneStyle } from '../store/enums/SceneStyle.mjs';
import { SceneType } from '../store/enums/SceneType.mjs';
import { SpendStage } from '../store/enums/SpendStage.mjs';
import { TurnMode } from '../store/enums/TurnMode.mjs';
import { HistoryWindow } from './HistoryWindow.mjs';
import { RequestBudget } from './RequestBudget.mjs';
import { TagReader } from './TagReader.mjs';

const TAG_NAMES = Object.freeze({
  Scene: 'scene',
  Situation: 'situation',
  Input: 'input',
  Present: 'present',
  Remote: 'remote',
  Offscreen: 'offscreen',
  WalkOns: 'walkons',
  Encounter: 'encounter',
  Pacing: 'pacing',
  Narrator: 'narrator',
  Direction: 'direction',
  Style: 'style',
});

const ATTR_NAMES = Object.freeze({
  Changed: 'changed',
  To: 'to',
  Enter: 'enter',
  Leave: 'leave',
  Accepted: 'accepted',
  Reacting: 'reacting',
  Length: 'length',
});

const PACING_MODES = Object.freeze({
  IntimateDeep: 'intimate_deep',
  FocusedOne: 'focused_one',
  GroupBanter: 'group_banter',
  NarratorOnly: 'narrator_only',
});

const INPUT_KINDS = Object.freeze({
  PlayerInScene: 'player_in_scene',
  NarratorDirection: 'narrator_direction',
  PlayerTag: 'player',
  NarratorTag: 'narrator',
});

const RESPONDER_LENGTHS = Object.freeze({
  Short: 'short',
  Medium: 'medium',
  Long: 'long',
});

export const Director = Object.freeze({
  Settings: Object.freeze({
    Tag: TAG_NAMES,
    RecognisedTags: Object.freeze([
      TAG_NAMES.Scene,
      TAG_NAMES.Situation,
      TAG_NAMES.Input,
      TAG_NAMES.Present,
      TAG_NAMES.Remote,
      TAG_NAMES.Offscreen,
      TAG_NAMES.WalkOns,
      TAG_NAMES.Encounter,
      TAG_NAMES.Pacing,
      TAG_NAMES.Narrator,
      TAG_NAMES.Direction,
      TAG_NAMES.Style,
    ]),
    Attr: ATTR_NAMES,
    Pacing: Object.freeze({
      ...PACING_MODES,
      ValidValues: Object.freeze([
        PACING_MODES.IntimateDeep,
        PACING_MODES.FocusedOne,
        PACING_MODES.GroupBanter,
        PACING_MODES.NarratorOnly,
      ]),
    }),
    InputKind: INPUT_KINDS,
    Length: Object.freeze({
      ...RESPONDER_LENGTHS,
      ValidValues: Object.freeze([
        RESPONDER_LENGTHS.Short,
        RESPONDER_LENGTHS.Medium,
        RESPONDER_LENGTHS.Long,
      ]),
    }),
    Bool: Object.freeze({
      Yes: 'yes',
      No: 'no',
    }),
    Presence: Object.freeze({
      Present: 'present',
      Remote: 'remote',
      Absent: 'absent',
    }),
    ReactingPlayer: 'player',
    ForbiddenKeys: Object.freeze(['__proto__', 'constructor', 'prototype']),
    HistoryMaxTurns: 8,
    DefaultReplyReserve: 3000,
    SummaryMaxLength: 220,
    SummaryEllipsisLength: 217,
    Ellipsis: '...',
    EmptyText: '',
    NoneLabel: '(none)',
    SectionSeparator: '\n\n',
    LineSeparator: '\n',
    PipeSeparator: '|',
    CommaSeparator: ',',
    CommaSpaceSeparator: ', ',
    DefaultStance: 'unplanned',
    DefaultTargetKind: 'stranger',
    AbortName: 'AbortError',
    AbortMessage: 'Turn aborted',
    StyleDescriptions: Object.freeze({
      [SceneStyle.Explicit]: 'sexual activity in vivid detail, escalating tension',
      [SceneStyle.Combat]: 'blow-by-blow fighting, footing, weapons, injuries, momentum',
      [SceneStyle.Tension]: 'held breath, unspoken threat, slow pace, guarded words',
      [SceneStyle.Emotional]: 'feelings, vulnerability, warmth, regret, small gestures',
      [SceneStyle.Banter]: 'light, quick, playful exchanges and teasing',
      [SceneStyle.Travel]: 'places, weather, sensory journey, group mood and fatigue',
      [SceneStyle.Investigation]: 'clues, details, cautious reasoning from known facts',
      [SceneStyle.None]: 'no extra style guidance; campaign style notes alone',
    }),

    /**
     * @returns {RegExp}
     */
    get WhitespacePattern() {
      return /\s+/g;
    },

    /**
     * @returns {RegExp}
     */
    get DayValuePattern() {
      return /^(?:day\s+)?(\d+)$/i;
    },
  }),

  /**
   * @param {unknown} rawList
   * @returns {Array<string>}
   */
  sanitizeNames(rawList) {
    if (!Array.isArray(rawList)) {
      return [];
    }
    const result = [];
    const seenLower = new Set();
    for (const entry of rawList) {
      if (typeof entry !== 'string') {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const lowerKey = trimmed.toLowerCase();
      if (!seenLower.has(lowerKey)) {
        seenLower.add(lowerKey);
        result.push(trimmed);
      }
    }
    return result;
  },

  /**
   * @param {{campaign: object, characters: ReadonlyArray<object>, preState: object, recentTurns?: ReadonlyArray<object>, userText: string, narrationText?: string | null, mode: string, oocNudge?: string | null, encounterRoll: object, openThreadTitles?: ReadonlyArray<string>, model: string, client: object, signal?: AbortSignal | null, maxResponders?: number | null, replyReserve?: number | null, budget?: {limitTokens: number | null, estimate: (text: string) => number, fits: (usedTokens: number, text: string) => boolean} | null}} options
   * @returns {Promise<Readonly<{plan: object, nextState: object, spendIds: readonly string[]}>>}
   * @throws {Error}
   */
  async planTurn(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Director options must be a plain object.');
    }

    const {
      campaign,
      characters,
      preState,
      recentTurns = [],
      userText,
      narrationText = null,
      mode,
      oocNudge = null,
      encounterRoll,
      openThreadTitles = [],
      model,
      client,
      signal = null,
      maxResponders = null,
      replyReserve = null,
      budget = null,
    } = options;

    if (campaign === null || typeof campaign !== 'object' || Array.isArray(campaign)) {
      throw new TypeError('campaign must be an object.');
    }
    if (typeof campaign.id !== 'string' || campaign.id.trim().length === 0) {
      throw new RangeError('campaign.id must be a non-empty string.');
    }
    if (!Array.isArray(characters)) {
      throw new TypeError('characters must be an array.');
    }
    if (preState === null || typeof preState !== 'object' || Array.isArray(preState)) {
      throw new TypeError('preState must be a plain object.');
    }
    if (!Number.isInteger(preState.sceneNumber) || preState.sceneNumber < 1) {
      throw new RangeError('preState.sceneNumber must be a positive integer.');
    }
    if (!Number.isInteger(preState.day) || preState.day < 1) {
      throw new RangeError('preState.day must be a positive integer.');
    }
    if (typeof preState.timeLabel !== 'string' || typeof preState.location !== 'string') {
      throw new TypeError('preState.timeLabel and preState.location must be strings.');
    }
    SceneType.label(preState.sceneType);
    if (!Array.isArray(preState.presentIds) || !Array.isArray(preState.remoteIds) || !Array.isArray(preState.activeWalkOns)) {
      throw new TypeError('preState.presentIds, remoteIds, and activeWalkOns must be arrays.');
    }
    if (preState.offscreenNotes === null || typeof preState.offscreenNotes !== 'object' || Array.isArray(preState.offscreenNotes)) {
      throw new TypeError('preState.offscreenNotes must be a plain object.');
    }
    if (!Array.isArray(recentTurns)) {
      throw new TypeError('recentTurns must be an array.');
    }
    if (typeof userText !== 'string') {
      throw new TypeError('userText must be a string.');
    }
    if (narrationText !== null && typeof narrationText !== 'string') {
      throw new TypeError('narrationText must be null or a string.');
    }
    TurnMode.label(mode);
    if (oocNudge !== null && typeof oocNudge !== 'string') {
      throw new TypeError('oocNudge must be null or a string.');
    }
    if (encounterRoll === null || typeof encounterRoll !== 'object' || Array.isArray(encounterRoll)) {
      throw new TypeError('encounterRoll must be a plain object.');
    }
    if (typeof encounterRoll.triggered !== 'boolean' || typeof encounterRoll.forced !== 'boolean') {
      throw new TypeError('encounterRoll must include boolean triggered and forced fields.');
    }
    if (!Array.isArray(openThreadTitles)) {
      throw new TypeError('openThreadTitles must be an array.');
    }
    if (typeof model !== 'string' || model.trim().length === 0) {
      throw new RangeError('model must be a non-empty string.');
    }
    if (client === null || typeof client !== 'object' || typeof client.complete !== 'function') {
      throw new TypeError('client must provide a complete() method.');
    }
    if (signal !== null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
      throw new TypeError('signal must be null or an AbortSignal.');
    }
    if (maxResponders !== null && (!Number.isInteger(maxResponders) || maxResponders < 1)) {
      throw new RangeError('maxResponders must be null or a positive integer.');
    }
    if (replyReserve !== null) {
      if (typeof replyReserve !== 'number') {
        throw new TypeError('replyReserve must be null or a positive integer.');
      }
      if (!Number.isInteger(replyReserve) || replyReserve < 1) {
        throw new RangeError('replyReserve must be null or a positive integer.');
      }
    }
    if (budget !== null) {
      if (
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
    }

    const settings = Director.Settings;

    if (signal !== null && signal.aborted) {
      const abortError = new Error(settings.AbortMessage);
      abortError.name = settings.AbortName;
      throw abortError;
    }

    const nonArchivedChars = [];
    const nonArchivedById = new Map();
    const slugToChar = new Map();
    for (const character of characters) {
      if (character === null || typeof character !== 'object' || character.archived === true) {
        continue;
      }
      nonArchivedChars.push(character);
      nonArchivedById.set(character.id, character);
      if (typeof character.slug === 'string' && character.slug.trim().length > 0) {
        slugToChar.set(character.slug.trim().toLowerCase(), character);
      }
    }

    const prePresentSet = new Set(preState.presentIds);
    const preRemoteSet = new Set(preState.remoteIds);

    const rosterLines = nonArchivedChars.map((character) => {
      let presence = settings.Presence.Absent;
      if (prePresentSet.has(character.id)) {
        presence = settings.Presence.Present;
      } else if (preRemoteSet.has(character.id)) {
        presence = settings.Presence.Remote;
      }
      const isPlayer = character.id === campaign.playerCharacterId || character.isPlayer === true;
      const aliases = Array.isArray(character.aliases) && character.aliases.length > 0
        ? ` | aliases: ${character.aliases.join(settings.CommaSpaceSeparator)}`
        : settings.EmptyText;
      const rawPersona = CharacterCard.requestValue(character.card.personalitySummary)
        .replace(settings.WhitespacePattern, ' ')
        .trim();
      const personaSummary = rawPersona.length > settings.SummaryMaxLength
        ? `${rawPersona.slice(0, settings.SummaryEllipsisLength)}${settings.Ellipsis}`
        : rawPersona;
      const summaryPart = personaSummary.length > 0 ? ` | summary: ${personaSummary}` : settings.EmptyText;
      return `- slug: ${character.slug} | name: ${character.name}${aliases} | tier: ${character.tier} | isPlayer: ${String(isPlayer)} | presence: ${presence}${summaryPart}`;
    });

    const prePresentSlugs = [];
    for (const characterId of preState.presentIds) {
      const matchedChar = nonArchivedById.get(characterId);
      if (matchedChar !== undefined && typeof matchedChar.slug === 'string') {
        prePresentSlugs.push(matchedChar.slug);
      }
    }
    const preRemoteSlugs = [];
    for (const characterId of preState.remoteIds) {
      const matchedChar = nonArchivedById.get(characterId);
      if (matchedChar !== undefined && typeof matchedChar.slug === 'string') {
        preRemoteSlugs.push(matchedChar.slug);
      }
    }

    const absentNonPlayerCast = nonArchivedChars
      .filter((character) => {
        return (
          character.id !== campaign.playerCharacterId &&
          !prePresentSet.has(character.id) &&
          !preRemoteSet.has(character.id)
        );
      })
      .map((character) => `${character.slug} (${character.name})`);

    const responderRuleLine = maxResponders === null
      ? '5. <direction> tags list each non-player character who should speak or act this turn in reply order; every to slug must appear in <present> or <remote> and must NOT be the player character.'
      : `5. Emit at most ${maxResponders} <direction> tags; every to slug must appear in <present> or <remote> and must NOT be the player character.`;

    const styleLines = SceneStyle.AllValues.map((styleName) => {
      return `- ${styleName}: ${settings.StyleDescriptions[styleName]}`;
    });

    const systemPrompt = [
      'You are the Turn Director for an ongoing multi-character narrative campaign.',
      'You NEVER write prose or dialogue. You output ONLY the tagged plan below using double quotes on tag attributes.',
      '',
      'Strict rules:',
      '1. Talking ABOUT an absent character NEVER makes them present or remote. Only explicit arrival, scene transition, or accepted encounter brings someone into <present> or <remote>.',
      '2. Cut-away scenes where the player character is elsewhere MUST omit the player slug from <present> and <remote>, set <input>narrator</input>, and note the player character location in <offscreen to="{playerSlug}">...</offscreen>.',
      '3. NEVER emit a <direction> tag for the player character (isPlayer: true).',
      '4. NEVER invent unprompted character arrivals when encounterRoll.triggered is false and neither userText, narration, nor oocNudge explicitly brings a character into the scene.',
      responderRuleLine,
      '6. When mode is "narrator", <encounter> MUST have accepted="no" and <input> MUST be "narrator".',
      '7. When encounterRoll.forced is true (mode is "encounter"), <encounter> MUST have accepted="yes" with a concrete encounter brief.',
      '8. When encounterRoll.triggered is true and encounterRoll.plausibilityRequired is true, accept the encounter ONLY if plausible in the current scene (accepted="yes"); otherwise use <encounter accepted="no"></encounter>.',
      '9. When <scene changed="yes">, reset walk-ons unless explicitly carried over in <walkons enter="..."/>.',
      '10. When CURRENT TURN INPUT includes narration, treat it as player-authored narrator facts established in the scene.',
      '',
      'Scene styles for <style>:',
      ...styleLines,
      '',
      'Required tagged output format:',
      '<scene changed="yes|no">{place} | day {n} | {time label} | public|private</scene>',
      '<situation>{one line}</situation>',
      '<input>player|narrator</input>',
      '<present>{slug}, {slug}</present>',
      '<remote>{slug}</remote>',
      '<offscreen to="{slug}">{note}</offscreen>',
      '<walkons enter="{name}, {name}" leave="{name}"/>',
      '<encounter accepted="yes|no">{brief}</encounter>',
      '<pacing>intimate_deep|focused_one|group_banter|narrator_only</pacing>',
      '<narrator>{what the narration should cover}</narrator>',
      '<direction to="{slug}" reacting="{slug or player}" length="short|medium|long">{beat goal, data that matters}</direction>',
      '<style>{name}</style>',
    ].join(settings.LineSeparator);

    const premiseBody = typeof campaign.premise === 'string' && campaign.premise.trim().length > 0
      ? campaign.premise.trim()
      : settings.NoneLabel;
    const fixedBeforeHistory = [
      `CAMPAIGN PREMISE:\n${premiseBody}`,
      `CURRENT SCENE STATE (preState):\n${JSON.stringify({
        sceneNumber: preState.sceneNumber,
        day: preState.day,
        timeLabel: preState.timeLabel,
        location: preState.location,
        sceneType: preState.sceneType,
        presentSlugs: prePresentSlugs,
        remoteSlugs: preRemoteSlugs,
        activeWalkOns: preState.activeWalkOns,
        offscreenNotes: preState.offscreenNotes,
      })}`,
      `CAST ROSTER:\n${rosterLines.length > 0 ? rosterLines.join(settings.LineSeparator) : settings.NoneLabel}`,
      `ACTIVE WALK-ONS:\n${preState.activeWalkOns.length > 0 ? preState.activeWalkOns.join(settings.CommaSpaceSeparator) : settings.NoneLabel}`,
      `OPEN THREADS:\n${openThreadTitles.length > 0 ? openThreadTitles.map((title) => `- ${title}`).join(settings.LineSeparator) : settings.NoneLabel}`,
    ];

    const inputLines = [
      `mode: ${mode}`,
      `userText: ${userText}`,
    ];
    if (narrationText !== null && narrationText.trim().length > 0) {
      inputLines.push(`narration: ${narrationText.trim()}`);
    }
    if (oocNudge !== null && oocNudge.trim().length > 0) {
      inputLines.push(`oocNudge: ${oocNudge.trim()}`);
    }

    const fixedAfterHistory = [
      `ENCOUNTER ROLL CANDIDATE:\n${JSON.stringify({
        triggered: encounterRoll.triggered,
        forced: encounterRoll.forced,
        plausibilityRequired: encounterRoll.plausibilityRequired,
        targetKind: encounterRoll.targetKind ?? null,
        stance: encounterRoll.stance ?? null,
        absentCastCandidates: absentNonPlayerCast,
      })}`,
      `CURRENT TURN INPUT:\n${inputLines.join(settings.LineSeparator)}`,
    ];

    const normalizedModel = model.trim();
    const effectiveBudget = budget !== null
      ? budget
      : RequestBudget.create({
          contextLength: null,
          replyReserve: replyReserve === null ? settings.DefaultReplyReserve : replyReserve,
          charsPerToken: RequestBudget.StartingCharsPerToken,
        });
    const fixedUserTextWithNone = [
      ...fixedBeforeHistory,
      `RECENT TURNS:\n${settings.NoneLabel}`,
      ...fixedAfterHistory,
    ].join(settings.SectionSeparator);
    const mandatoryTokens = effectiveBudget.estimate(systemPrompt) + effectiveBudget.estimate(fixedUserTextWithNone);
    if (effectiveBudget.limitTokens !== null && mandatoryTokens > effectiveBudget.limitTokens) {
      throw new Error(`Mandatory prompt exceeds context budget for Director on model ${normalizedModel}.`);
    }
    const fixedUserText = [
      ...fixedBeforeHistory,
      'RECENT TURNS:\n',
      ...fixedAfterHistory,
    ].join(settings.SectionSeparator);
    const usedTokens = effectiveBudget.estimate(systemPrompt) + effectiveBudget.estimate(fixedUserText);
    const historyWindow = HistoryWindow.build({
      turns: recentTurns,
      characterId: null,
      maxTurns: settings.HistoryMaxTurns,
      budget: effectiveBudget,
      usedTokens,
    });
    const recentTurnsBody = historyWindow.turnCount > 0 ? historyWindow.text : settings.NoneLabel;

    const userPromptSections = [
      ...fixedBeforeHistory,
      `RECENT TURNS:\n${recentTurnsBody}`,
      ...fixedAfterHistory,
    ];

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPromptSections.join(settings.SectionSeparator) },
    ];

    const spendIds = [];
    const completion = await client.complete({
      model: normalizedModel,
      messages,
      ...(replyReserve === null ? {} : { maxTokens: replyReserve }),
      stage: SpendStage.Director,
      campaignId: campaign.id,
      signal,
    });
    if (typeof completion.spendId === 'string' && completion.spendId.length > 0) {
      spendIds.push(completion.spendId);
    }

    const rawReply = typeof completion.text === 'string' ? completion.text : settings.EmptyText;
    const tagMap = new Map();
    let totalMatchedTags = 0;
    for (const tagName of settings.RecognisedTags) {
      const matchedTags = TagReader.read(rawReply, tagName);
      tagMap.set(tagName, matchedTags);
      totalMatchedTags += matchedTags.length;
    }

    const directorMissed = totalMatchedTags === 0;
    const playerChar = typeof campaign.playerCharacterId === 'string' && campaign.playerCharacterId.length > 0
      ? nonArchivedById.get(campaign.playerCharacterId) ?? null
      : null;

    let sceneChanged = false;
    let sceneNumber = preState.sceneNumber;
    let day = preState.day;
    let timeLabel = preState.timeLabel;
    let location = preState.location;
    let sceneType = preState.sceneType;
    let situation = settings.EmptyText;
    let userInputKind = mode === TurnMode.Narrator
      ? settings.InputKind.NarratorDirection
      : settings.InputKind.PlayerInScene;
    let presentIds = [];
    let remoteIds = [];
    let walkOnsEnter = [];
    let walkOnsLeave = [];
    let activeWalkOns = [];
    let parsedAccepted = false;
    let rawEncounterBrief = settings.EmptyText;
    let pacing = settings.Pacing.FocusedOne;
    let narratorDirective = settings.EmptyText;
    let responders = [];
    let style = SceneStyle.None;
    let offscreenTags = [];

    if (directorMissed) {
      presentIds = [...preState.presentIds];
      remoteIds = [...preState.remoteIds];
      activeWalkOns = Director.sanitizeNames(preState.activeWalkOns);
      style = typeof preState.style === 'string' && SceneStyle.AllValues.includes(preState.style)
        ? preState.style
        : SceneStyle.None;
      for (const character of nonArchivedChars) {
        if (maxResponders !== null && responders.length >= maxResponders) {
          break;
        }
        if (
          prePresentSet.has(character.id) &&
          character.id !== campaign.playerCharacterId &&
          character.isPlayer !== true
        ) {
          responders.push(
            Object.freeze({
              characterId: character.id,
              slug: character.slug,
              name: character.name,
              beatGoal: settings.EmptyText,
              length: settings.Length.Medium,
              reacting: settings.ReactingPlayer,
            }),
          );
        }
      }
    } else {
      const sceneTags = tagMap.get(settings.Tag.Scene);
      if (sceneTags.length > 0) {
        const sceneTag = sceneTags[0];
        const rawChanged = sceneTag.attributes[settings.Attr.Changed];
        sceneChanged = typeof rawChanged === 'string' && rawChanged.trim().toLowerCase() === settings.Bool.Yes;
        sceneNumber = sceneChanged ? preState.sceneNumber + 1 : preState.sceneNumber;

        const sceneParts = sceneTag.body.split(settings.PipeSeparator).map((part) => part.trim());
        if (sceneParts.length > 0 && sceneParts[0].length > 0) {
          location = sceneParts[0];
        }
        if (sceneParts.length > 1) {
          const dayMatch = settings.DayValuePattern.exec(sceneParts[1]);
          if (dayMatch !== null) {
            const parsedDay = Number.parseInt(dayMatch[1], 10);
            if (Number.isInteger(parsedDay) && parsedDay >= preState.day) {
              day = parsedDay;
            }
          }
        }
        if (sceneParts.length > 2 && sceneParts[2].length > 0) {
          timeLabel = sceneParts[2];
        }
        if (sceneParts.length > 3) {
          const lowerSceneType = sceneParts[3].toLowerCase();
          if (lowerSceneType === SceneType.Public || lowerSceneType === SceneType.Private) {
            sceneType = lowerSceneType;
          }
        }
      }

      const situationTags = tagMap.get(settings.Tag.Situation);
      if (situationTags.length > 0) {
        situation = situationTags[0].body.trim();
      }

      const inputTags = tagMap.get(settings.Tag.Input);
      if (mode !== TurnMode.Narrator && inputTags.length > 0) {
        const inputValue = inputTags[0].body.trim().toLowerCase();
        if (
          inputValue === settings.InputKind.NarratorTag ||
          inputValue === settings.InputKind.NarratorDirection
        ) {
          userInputKind = settings.InputKind.NarratorDirection;
        }
      }

      const presentTags = tagMap.get(settings.Tag.Present);
      const presentSet = new Set();
      if (presentTags.length === 0) {
        for (const characterId of preState.presentIds) {
          if (nonArchivedById.has(characterId) && !presentSet.has(characterId)) {
            presentSet.add(characterId);
            presentIds.push(characterId);
          }
        }
      } else {
        for (const rawSlug of presentTags[0].body.split(settings.CommaSeparator)) {
          const trimmedSlug = rawSlug.trim().toLowerCase();
          if (trimmedSlug.length === 0) {
            continue;
          }
          const matchedChar = slugToChar.get(trimmedSlug);
          if (matchedChar !== undefined && !presentSet.has(matchedChar.id)) {
            presentSet.add(matchedChar.id);
            presentIds.push(matchedChar.id);
          }
        }
      }

      const remoteTags = tagMap.get(settings.Tag.Remote);
      const remoteSet = new Set();
      if (remoteTags.length === 0) {
        for (const characterId of preState.remoteIds) {
          if (nonArchivedById.has(characterId) && !presentSet.has(characterId) && !remoteSet.has(characterId)) {
            remoteSet.add(characterId);
            remoteIds.push(characterId);
          }
        }
      } else {
        for (const rawSlug of remoteTags[0].body.split(settings.CommaSeparator)) {
          const trimmedSlug = rawSlug.trim().toLowerCase();
          if (trimmedSlug.length === 0) {
            continue;
          }
          const matchedChar = slugToChar.get(trimmedSlug);
          if (matchedChar !== undefined && !presentSet.has(matchedChar.id) && !remoteSet.has(matchedChar.id)) {
            remoteSet.add(matchedChar.id);
            remoteIds.push(matchedChar.id);
          }
        }
      }

      if (
        playerChar !== null &&
        userInputKind === settings.InputKind.PlayerInScene &&
        !presentIds.includes(playerChar.id) &&
        !remoteIds.includes(playerChar.id)
      ) {
        if (sceneChanged) {
          presentIds = [playerChar.id];
          remoteIds = [];
        } else {
          presentIds.push(playerChar.id);
        }
      }

      const rawEnterNames = [];
      const rawLeaveNames = [];
      for (const walkOnTag of tagMap.get(settings.Tag.WalkOns)) {
        const enterAttr = walkOnTag.attributes[settings.Attr.Enter];
        if (typeof enterAttr === 'string') {
          rawEnterNames.push(...enterAttr.split(settings.CommaSeparator));
        }
        const leaveAttr = walkOnTag.attributes[settings.Attr.Leave];
        if (typeof leaveAttr === 'string') {
          rawLeaveNames.push(...leaveAttr.split(settings.CommaSeparator));
        }
      }
      walkOnsEnter = Director.sanitizeNames(rawEnterNames);
      walkOnsLeave = Director.sanitizeNames(rawLeaveNames);
      const leaveLowerSet = new Set(walkOnsLeave.map((name) => name.toLowerCase()));
      const startingWalkOns = sceneChanged ? [] : Director.sanitizeNames(preState.activeWalkOns);
      const activeWalkOnLower = new Set();
      for (const walkOnName of [...startingWalkOns, ...walkOnsEnter]) {
        const lowerName = walkOnName.toLowerCase();
        if (!leaveLowerSet.has(lowerName) && !activeWalkOnLower.has(lowerName)) {
          activeWalkOnLower.add(lowerName);
          activeWalkOns.push(walkOnName);
        }
      }

      const encounterTags = tagMap.get(settings.Tag.Encounter);
      if (encounterTags.length > 0) {
        const encounterTag = encounterTags[0];
        const rawAccepted = encounterTag.attributes[settings.Attr.Accepted];
        parsedAccepted = typeof rawAccepted === 'string' && rawAccepted.trim().toLowerCase() === settings.Bool.Yes;
        rawEncounterBrief = encounterTag.body.trim();
      }

      const pacingTags = tagMap.get(settings.Tag.Pacing);
      if (pacingTags.length > 0) {
        const candidatePacing = pacingTags[0].body.trim().toLowerCase();
        if (settings.Pacing.ValidValues.includes(candidatePacing)) {
          pacing = candidatePacing;
        }
      }

      const narratorTags = tagMap.get(settings.Tag.Narrator);
      if (narratorTags.length > 0) {
        narratorDirective = narratorTags[0].body.trim();
      }

      const participantIdSet = new Set([...presentIds, ...remoteIds]);
      const seenResponderIds = new Set();
      if (pacing !== settings.Pacing.NarratorOnly) {
        for (const directionTag of tagMap.get(settings.Tag.Direction)) {
          if (maxResponders !== null && responders.length >= maxResponders) {
            break;
          }
          const rawTo = directionTag.attributes[settings.Attr.To];
          if (typeof rawTo !== 'string') {
            continue;
          }
          const matchedChar = slugToChar.get(rawTo.trim().toLowerCase());
          if (matchedChar === undefined) {
            continue;
          }
          if (
            (campaign.playerCharacterId !== null && matchedChar.id === campaign.playerCharacterId) ||
            matchedChar.isPlayer === true
          ) {
            continue;
          }
          if (!participantIdSet.has(matchedChar.id) || seenResponderIds.has(matchedChar.id)) {
            continue;
          }
          seenResponderIds.add(matchedChar.id);

          const rawLength = directionTag.attributes[settings.Attr.Length];
          const normalizedLength = typeof rawLength === 'string'
            ? rawLength.trim().toLowerCase()
            : settings.EmptyText;
          const length = settings.Length.ValidValues.includes(normalizedLength)
            ? normalizedLength
            : settings.Length.Medium;

          let reacting = settings.ReactingPlayer;
          const rawReacting = directionTag.attributes[settings.Attr.Reacting];
          if (typeof rawReacting === 'string') {
            const lowerReacting = rawReacting.trim().toLowerCase();
            if (lowerReacting.length > 0 && lowerReacting !== settings.ReactingPlayer) {
              const reactingChar = slugToChar.get(lowerReacting);
              if (
                reactingChar !== undefined &&
                participantIdSet.has(reactingChar.id) &&
                reactingChar.id !== matchedChar.id &&
                !(campaign.playerCharacterId !== null && reactingChar.id === campaign.playerCharacterId) &&
                reactingChar.isPlayer !== true
              ) {
                reacting = reactingChar.slug;
              }
            }
          }

          responders.push(
            Object.freeze({
              characterId: matchedChar.id,
              slug: matchedChar.slug,
              name: matchedChar.name,
              beatGoal: directionTag.body.trim(),
              length,
              reacting,
            }),
          );
        }
      }

      const styleTags = tagMap.get(settings.Tag.Style);
      if (styleTags.length > 0) {
        const candidateStyle = styleTags[0].body.trim().toLowerCase();
        if (SceneStyle.AllValues.includes(candidateStyle)) {
          style = candidateStyle;
        }
      }

      offscreenTags = tagMap.get(settings.Tag.Offscreen);
    }

    const presentSlugLowerSet = new Set();
    for (const characterId of presentIds) {
      const matchedChar = nonArchivedById.get(characterId);
      if (matchedChar !== undefined && typeof matchedChar.slug === 'string') {
        presentSlugLowerSet.add(matchedChar.slug.toLowerCase());
      }
    }

    const forbiddenKeys = new Set(settings.ForbiddenKeys);
    const offscreenNotes = {};
    for (const [rawKey, rawNote] of Object.entries(preState.offscreenNotes)) {
      if (forbiddenKeys.has(rawKey) || typeof rawNote !== 'string') {
        continue;
      }
      const trimmedNote = rawNote.trim();
      if (trimmedNote.length === 0) {
        continue;
      }
      const lowerKey = rawKey.trim().toLowerCase();
      if (forbiddenKeys.has(lowerKey)) {
        continue;
      }
      const matchedChar = slugToChar.get(lowerKey);
      const canonicalKey = matchedChar !== undefined ? matchedChar.slug : rawKey.trim();
      if (canonicalKey.length === 0 || forbiddenKeys.has(canonicalKey)) {
        continue;
      }
      if (presentSlugLowerSet.has(canonicalKey.toLowerCase())) {
        continue;
      }
      Object.defineProperty(offscreenNotes, canonicalKey, {
        value: trimmedNote,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }

    for (const offscreenTag of offscreenTags) {
      const rawTo = offscreenTag.attributes[settings.Attr.To];
      if (typeof rawTo !== 'string') {
        continue;
      }
      const lowerKey = rawTo.trim().toLowerCase();
      if (lowerKey.length === 0 || forbiddenKeys.has(lowerKey)) {
        continue;
      }
      const matchedChar = slugToChar.get(lowerKey);
      if (matchedChar === undefined || forbiddenKeys.has(matchedChar.slug)) {
        continue;
      }
      if (presentSlugLowerSet.has(matchedChar.slug.toLowerCase())) {
        continue;
      }
      const trimmedNote = offscreenTag.body.trim();
      if (trimmedNote.length === 0) {
        delete offscreenNotes[matchedChar.slug];
      } else {
        Object.defineProperty(offscreenNotes, matchedChar.slug, {
          value: trimmedNote,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }

    let encounterAccepted = false;
    let encounterBrief = settings.EmptyText;
    const stanceLabel = typeof encounterRoll.stance === 'string' && encounterRoll.stance.length > 0
      ? encounterRoll.stance
      : settings.DefaultStance;
    const targetKindLabel = typeof encounterRoll.targetKind === 'string' && encounterRoll.targetKind.length > 0
      ? encounterRoll.targetKind
      : settings.DefaultTargetKind;
    const defaultEncounterBrief = `An unexpected ${stanceLabel} ${targetKindLabel} encounter interrupts the scene.`;

    if (mode === TurnMode.Narrator) {
      encounterAccepted = false;
      encounterBrief = settings.EmptyText;
    } else if (mode === TurnMode.Encounter) {
      encounterAccepted = true;
      encounterBrief = rawEncounterBrief.length > 0 ? rawEncounterBrief : defaultEncounterBrief;
    } else if (!encounterRoll.triggered) {
      encounterAccepted = false;
      encounterBrief = settings.EmptyText;
    } else if (!encounterRoll.forced) {
      encounterAccepted = parsedAccepted;
      encounterBrief = encounterAccepted
        ? (rawEncounterBrief.length > 0 ? rawEncounterBrief : defaultEncounterBrief)
        : settings.EmptyText;
    } else {
      encounterAccepted = true;
      encounterBrief = rawEncounterBrief.length > 0 ? rawEncounterBrief : defaultEncounterBrief;
    }

    const presentSlugs = [];
    for (const characterId of presentIds) {
      const matchedChar = nonArchivedById.get(characterId);
      if (matchedChar !== undefined && typeof matchedChar.slug === 'string') {
        presentSlugs.push(matchedChar.slug);
      }
    }
    const remoteSlugs = [];
    for (const characterId of remoteIds) {
      const matchedChar = nonArchivedById.get(characterId);
      if (matchedChar !== undefined && typeof matchedChar.slug === 'string') {
        remoteSlugs.push(matchedChar.slug);
      }
    }

    const frozenOffscreenNotes = Object.freeze({ ...offscreenNotes });

    const plan = Object.freeze({
      sceneChanged,
      location,
      day,
      timeLabel,
      sceneType,
      userInputKind,
      presentIds: Object.freeze([...presentIds]),
      presentSlugs: Object.freeze(presentSlugs),
      remoteIds: Object.freeze([...remoteIds]),
      remoteSlugs: Object.freeze(remoteSlugs),
      offscreenNotes: frozenOffscreenNotes,
      walkOnsEnter: Object.freeze(walkOnsEnter),
      walkOnsLeave: Object.freeze(walkOnsLeave),
      encounterAccepted,
      encounterBrief,
      pacing,
      situation,
      responders: Object.freeze(responders),
      narratorDirective,
      directorMissed,
      style,
    });

    const nextState = Object.freeze({
      sceneNumber,
      day,
      timeLabel,
      location,
      sceneType,
      presentIds: Object.freeze([...presentIds]),
      remoteIds: Object.freeze([...remoteIds]),
      offscreenNotes: frozenOffscreenNotes,
      activeWalkOns: Object.freeze(activeWalkOns),
    });

    return Object.freeze({
      plan,
      nextState,
      spendIds: Object.freeze([...spendIds]),
    });
  },
});
