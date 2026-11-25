import { SceneType } from '../store/enums/SceneType.mjs';
import { SpendStage } from '../store/enums/SpendStage.mjs';
import { TurnMode } from '../store/enums/TurnMode.mjs';

export const Director = Object.freeze({
  /**
   * @param {unknown} rawText
   * @returns {Record<string, unknown> | null}
   */
  parseJsonObject(rawText) {
    if (typeof rawText !== 'string') {
      return null;
    }
    let candidate = rawText.trim();
    if (candidate.length === 0) {
      return null;
    }
    const fencedMatch = /^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/.exec(candidate);
    if (fencedMatch !== null) {
      candidate = fencedMatch[1].trim();
    }
    try {
      const parsed = JSON.parse(candidate);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },

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
   * @param {{campaign: object, characters: ReadonlyArray<object>, preState: object, recentTurns?: ReadonlyArray<object>, userText: string, mode: string, oocNudge?: string | null, encounterRoll: object, openThreadTitles?: ReadonlyArray<string>, model: string, client: object, signal?: AbortSignal | null, maxResponders?: number | null}} options
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
      mode,
      oocNudge = null,
      encounterRoll,
      openThreadTitles = [],
      model,
      client,
      signal = null,
      maxResponders = null,
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

    if (signal?.aborted) {
      const abortError = new Error('Turn aborted');
      abortError.name = 'AbortError';
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
      let presence = 'absent';
      if (prePresentSet.has(character.id)) {
        presence = 'present';
      } else if (preRemoteSet.has(character.id)) {
        presence = 'remote';
      }
      const isPlayer = character.id === campaign.playerCharacterId || character.isPlayer === true;
      const aliases = Array.isArray(character.aliases) && character.aliases.length > 0
        ? ` | aliases: ${character.aliases.join(', ')}`
        : '';
      const rawPersona = character.card.personalitySummary.replace(/\s+/g, ' ').trim();
      const personaSummary = rawPersona.length > 220 ? `${rawPersona.slice(0, 217)}...` : rawPersona;
      return `- slug: ${character.slug} | name: ${character.name}${aliases} | tier: ${character.tier} | isPlayer: ${String(isPlayer)} | presence: ${presence}${personaSummary.length > 0 ? ` | summary: ${personaSummary}` : ''}`;
    });

    const prePresentSlugs = preState.presentIds
      .map((characterId) => nonArchivedById.get(characterId)?.slug)
      .filter((slug) => typeof slug === 'string');
    const preRemoteSlugs = preState.remoteIds
      .map((characterId) => nonArchivedById.get(characterId)?.slug)
      .filter((slug) => typeof slug === 'string');

    const recentTurnLines = recentTurns.slice(-8).map((turn) => {
      const turnBeats = Array.isArray(turn?.beats) ? turn.beats : [];
      if (turnBeats.length > 0) {
        const beatSummary = turnBeats
          .map((beat) => `${beat.speakerName}: ${typeof beat.text === 'string' ? beat.text : ''}`)
          .join(' / ');
        return `[#${turn.seq} Scene ${turn.sceneNumber} (${turn.mode})] ${beatSummary}`;
      }
      return `[#${turn.seq} Scene ${turn.sceneNumber} (${turn.mode})] ${typeof turn.rawText === 'string' ? turn.rawText : ''}`;
    });

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
      ? '5. Responders array lists each non-player character who should speak or act this turn; every responder slug must appear in presentSlugs or remoteSlugs and must NOT be the player character.'
      : `5. Responders array must have at most ${maxResponders} entries, each must appear in presentSlugs or remoteSlugs, and each must not be the player character.`;

    const systemPrompt = [
      'You are the Turn Director for an ongoing multi-character narrative campaign.',
      'You NEVER write prose or dialogue. You output ONLY a single valid JSON object matching the exact schema.',
      '',
      'Strict rules:',
      '1. Talking ABOUT an absent character NEVER makes them present or remote. Only explicit arrival, scene transition, or accepted encounter brings someone into presentSlugs or remoteSlugs.',
      '2. Cut-away scenes where the player character is elsewhere MUST omit the player slug from presentSlugs and remoteSlugs, set userInputKind to "narrator_direction", and note the player character location in offscreenNotes.',
      '3. NEVER include the player character (isPlayer: true) in responders.',
      '4. NEVER invent unprompted character arrivals when encounterRoll.triggered is false and neither userText nor oocNudge explicitly brings a character into the scene.',
      responderRuleLine,
      '6. When mode is "narrator", encounterAccepted MUST be false and userInputKind MUST be "narrator_direction".',
      '7. When encounterRoll.forced is true (mode is "encounter"), encounterAccepted MUST be true with a concrete encounterBrief.',
      '8. When encounterRoll.triggered is true and encounterRoll.plausibilityRequired is true, accept the encounter ONLY if plausible in the current scene; otherwise set encounterAccepted to false and encounterBrief to "".',
      '9. When sceneChanged is true, reset walk-ons unless explicitly carried over in walkOnsEnter.',
      '',
      'Required JSON schema:',
      '{',
      '  "sceneChanged": boolean,',
      '  "location": string,',
      '  "day": integer >= 1,',
      '  "timeLabel": string,',
      '  "sceneType": "public" | "private",',
      '  "userInputKind": "player_in_scene" | "narrator_direction",',
      '  "presentSlugs": string[],',
      '  "remoteSlugs": string[],',
      '  "offscreenNotes": Record<string, string>,',
      '  "walkOnsEnter": string[],',
      '  "walkOnsLeave": string[],',
      '  "encounterAccepted": boolean,',
      '  "encounterBrief": string,',
      '  "pacing": "intimate_deep" | "focused_one" | "group_banter" | "narrator_only",',
      '  "targetChars": number,',
      '  "responders": Array<{ "slug": string, "beatGoal": string, "length": "short" | "medium" | "long" }>,',
      '  "narratorDirective": string',
      '}',
    ].join('\n');

    const userPromptSections = [
      `CAMPAIGN PREMISE:\n${typeof campaign.premise === 'string' && campaign.premise.trim().length > 0 ? campaign.premise.trim() : '(none)'}`,
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
      `CAST ROSTER:\n${rosterLines.length > 0 ? rosterLines.join('\n') : '(none)'}`,
      `ACTIVE WALK-ONS:\n${preState.activeWalkOns.length > 0 ? preState.activeWalkOns.join(', ') : '(none)'}`,
      `OPEN THREADS:\n${openThreadTitles.length > 0 ? openThreadTitles.map((title) => `- ${title}`).join('\n') : '(none)'}`,
      `RECENT TURNS:\n${recentTurnLines.length > 0 ? recentTurnLines.join('\n') : '(none)'}`,
      `ENCOUNTER ROLL CANDIDATE:\n${JSON.stringify({
        triggered: encounterRoll.triggered,
        forced: encounterRoll.forced,
        plausibilityRequired: encounterRoll.plausibilityRequired,
        targetKind: encounterRoll.targetKind ?? null,
        stance: encounterRoll.stance ?? null,
        absentCastCandidates: absentNonPlayerCast,
      })}`,
      `CURRENT TURN INPUT:\nmode: ${mode}\nuserText: ${userText}${oocNudge !== null && oocNudge.trim().length > 0 ? `\noocNudge: ${oocNudge.trim()}` : ''}`,
    ];

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPromptSections.join('\n\n') },
    ];

    const normalizedModel = model.trim();
    const spendIds = [];
    const firstCompletion = await client.complete({
      model: normalizedModel,
      messages,
      stage: SpendStage.Director,
      campaignId: campaign.id,
      signal,
    });
    if (typeof firstCompletion.spendId === 'string' && firstCompletion.spendId.length > 0) {
      spendIds.push(firstCompletion.spendId);
    }

    let parsed = Director.parseJsonObject(firstCompletion.text);
    if (parsed === null) {
      if (signal?.aborted) {
        const abortError = new Error('Turn aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }

      const repairCompletion = await client.complete({
        model: normalizedModel,
        messages: [
          ...messages,
          { role: 'assistant', content: firstCompletion.text },
          {
            role: 'user',
            content: 'Your previous output was not a valid JSON object. Respond ONLY with one valid JSON object matching the schema, with no prose and no markdown code fences.',
          },
        ],
        stage: SpendStage.Director,
        campaignId: campaign.id,
        signal,
      });
      if (typeof repairCompletion.spendId === 'string' && repairCompletion.spendId.length > 0) {
        spendIds.push(repairCompletion.spendId);
      }
      parsed = Director.parseJsonObject(repairCompletion.text);
      if (parsed === null) {
        const parseError = new Error('Director returned malformed JSON after repair retry.');
        parseError.spendIds = Object.freeze([...spendIds]);
        throw parseError;
      }
    }

    let presentIds = [];
    const presentSet = new Set();
    if (Array.isArray(parsed.presentSlugs)) {
      for (const rawSlug of parsed.presentSlugs) {
        if (typeof rawSlug !== 'string') {
          continue;
        }
        const matchedChar = slugToChar.get(rawSlug.trim().toLowerCase());
        if (matchedChar !== undefined && !presentSet.has(matchedChar.id)) {
          presentSet.add(matchedChar.id);
          presentIds.push(matchedChar.id);
        }
      }
    }

    let remoteIds = [];
    const remoteSet = new Set();
    if (Array.isArray(parsed.remoteSlugs)) {
      for (const rawSlug of parsed.remoteSlugs) {
        if (typeof rawSlug !== 'string') {
          continue;
        }
        const matchedChar = slugToChar.get(rawSlug.trim().toLowerCase());
        if (matchedChar !== undefined && !presentSet.has(matchedChar.id) && !remoteSet.has(matchedChar.id)) {
          remoteSet.add(matchedChar.id);
          remoteIds.push(matchedChar.id);
        }
      }
    }

    const sceneChanged = parsed.sceneChanged === true;
    const sceneNumber = sceneChanged ? preState.sceneNumber + 1 : preState.sceneNumber;
    const day = Number.isInteger(parsed.day) && parsed.day >= preState.day ? parsed.day : preState.day;
    const timeLabel = typeof parsed.timeLabel === 'string' && parsed.timeLabel.trim().length > 0
      ? parsed.timeLabel.trim()
      : preState.timeLabel;
    const location = typeof parsed.location === 'string' && parsed.location.trim().length > 0
      ? parsed.location.trim()
      : preState.location;
    const sceneType = parsed.sceneType === SceneType.Private || parsed.sceneType === SceneType.Public
      ? parsed.sceneType
      : preState.sceneType;

    const walkOnsEnter = Director.sanitizeNames(parsed.walkOnsEnter);
    const walkOnsLeave = Director.sanitizeNames(parsed.walkOnsLeave);
    const leaveLowerSet = new Set(walkOnsLeave.map((name) => name.toLowerCase()));
    const startingWalkOns = sceneChanged ? [] : Director.sanitizeNames(preState.activeWalkOns);
    const activeWalkOns = [];
    const activeWalkOnLower = new Set();
    for (const walkOnName of [...startingWalkOns, ...walkOnsEnter]) {
      const lowerName = walkOnName.toLowerCase();
      if (!leaveLowerSet.has(lowerName) && !activeWalkOnLower.has(lowerName)) {
        activeWalkOnLower.add(lowerName);
        activeWalkOns.push(walkOnName);
      }
    }

    const playerChar = campaign.playerCharacterId
      ? nonArchivedById.get(campaign.playerCharacterId) ?? null
      : null;
    const userInputKind = mode === TurnMode.Narrator
      ? 'narrator_direction'
      : parsed.userInputKind === 'narrator_direction'
        ? 'narrator_direction'
        : 'player_in_scene';

    if (
      playerChar !== null &&
      userInputKind === 'player_in_scene' &&
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

    const presentSlugLowerSet = new Set(
      presentIds
        .map((characterId) => nonArchivedById.get(characterId)?.slug?.toLowerCase())
        .filter((slug) => typeof slug === 'string'),
    );

    const preOffscreenKeyMap = new Map();
    const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
    for (const rawKey of Object.keys(preState.offscreenNotes)) {
      if (forbiddenKeys.has(rawKey)) {
        continue;
      }
      preOffscreenKeyMap.set(rawKey.trim().toLowerCase(), rawKey.trim());
    }

    const rawOffscreenSource = parsed.offscreenNotes !== null &&
      typeof parsed.offscreenNotes === 'object' &&
      !Array.isArray(parsed.offscreenNotes)
      ? parsed.offscreenNotes
      : preState.offscreenNotes;

    const offscreenNotes = {};
    for (const [rawKey, rawNote] of Object.entries(rawOffscreenSource)) {
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
      const canonicalKey = matchedChar !== undefined
        ? matchedChar.slug
        : preOffscreenKeyMap.get(lowerKey) ?? null;
      if (canonicalKey === null || forbiddenKeys.has(canonicalKey)) {
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

    let encounterAccepted = false;
    let encounterBrief = '';
    const rawEncounterBrief = typeof parsed.encounterBrief === 'string' ? parsed.encounterBrief.trim() : '';
    const defaultEncounterBrief = `An unexpected ${encounterRoll.stance ?? 'unplanned'} ${encounterRoll.targetKind ?? 'stranger'} encounter interrupts the scene.`;

    if (mode === TurnMode.Narrator) {
      encounterAccepted = false;
      encounterBrief = '';
    } else if (mode === TurnMode.Encounter) {
      encounterAccepted = true;
      encounterBrief = rawEncounterBrief.length > 0 ? rawEncounterBrief : defaultEncounterBrief;
    } else if (!encounterRoll.triggered) {
      encounterAccepted = false;
      encounterBrief = '';
    } else if (!encounterRoll.forced) {
      encounterAccepted = parsed.encounterAccepted === true;
      encounterBrief = encounterAccepted
        ? (rawEncounterBrief.length > 0 ? rawEncounterBrief : defaultEncounterBrief)
        : '';
    } else {
      encounterAccepted = true;
      encounterBrief = rawEncounterBrief.length > 0 ? rawEncounterBrief : defaultEncounterBrief;
    }

    const validPacingModes = new Set(['intimate_deep', 'focused_one', 'group_banter', 'narrator_only']);
    const pacing = typeof parsed.pacing === 'string' && validPacingModes.has(parsed.pacing)
      ? parsed.pacing
      : 'focused_one';

    const targetChars = typeof parsed.targetChars === 'number' && Number.isFinite(parsed.targetChars)
      ? Math.min(2200, Math.max(600, Math.round(parsed.targetChars)))
      : 1350;

    const participantIdSet = new Set([...presentIds, ...remoteIds]);
    const validResponderLengths = new Set(['short', 'medium', 'long']);
    const responders = [];
    const seenResponderIds = new Set();

    if (pacing !== 'narrator_only' && Array.isArray(parsed.responders)) {
      for (const responderEntry of parsed.responders) {
        if (maxResponders !== null && responders.length >= maxResponders) {
          break;
        }
        if (responderEntry === null || typeof responderEntry !== 'object' || Array.isArray(responderEntry)) {
          continue;
        }
        if (typeof responderEntry.slug !== 'string') {
          continue;
        }
        const matchedChar = slugToChar.get(responderEntry.slug.trim().toLowerCase());
        if (matchedChar === undefined) {
          continue;
        }
        if (campaign.playerCharacterId !== null && matchedChar.id === campaign.playerCharacterId) {
          continue;
        }
        if (!participantIdSet.has(matchedChar.id) || seenResponderIds.has(matchedChar.id)) {
          continue;
        }
        seenResponderIds.add(matchedChar.id);
        const beatGoal = typeof responderEntry.beatGoal === 'string' ? responderEntry.beatGoal.trim() : '';
        const length = typeof responderEntry.length === 'string' && validResponderLengths.has(responderEntry.length)
          ? responderEntry.length
          : 'medium';
        responders.push(
          Object.freeze({
            characterId: matchedChar.id,
            slug: matchedChar.slug,
            name: matchedChar.name,
            beatGoal,
            length,
          }),
        );
      }
    }

    const narratorDirective = typeof parsed.narratorDirective === 'string'
      ? parsed.narratorDirective.trim()
      : '';

    const presentSlugs = presentIds
      .map((characterId) => nonArchivedById.get(characterId)?.slug)
      .filter((slug) => typeof slug === 'string');
    const remoteSlugs = remoteIds
      .map((characterId) => nonArchivedById.get(characterId)?.slug)
      .filter((slug) => typeof slug === 'string');

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
      offscreenNotes: Object.freeze({ ...offscreenNotes }),
      walkOnsEnter: Object.freeze(walkOnsEnter),
      walkOnsLeave: Object.freeze(walkOnsLeave),
      encounterAccepted,
      encounterBrief,
      pacing,
      targetChars,
      responders: Object.freeze(responders),
      narratorDirective,
    });

    const nextState = Object.freeze({
      sceneNumber,
      day,
      timeLabel,
      location,
      sceneType,
      presentIds: Object.freeze([...presentIds]),
      remoteIds: Object.freeze([...remoteIds]),
      offscreenNotes: Object.freeze({ ...offscreenNotes }),
      activeWalkOns: Object.freeze(activeWalkOns),
    });

    return Object.freeze({
      plan,
      nextState,
      spendIds: Object.freeze([...spendIds]),
    });
  },
});
