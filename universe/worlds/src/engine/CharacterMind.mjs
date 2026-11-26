import { CharacterCard } from '../store/CharacterCard.mjs';
import { CharacterTier } from '../store/enums/CharacterTier.mjs';
import { SpendStage } from '../store/enums/SpendStage.mjs';

export const CharacterMind = Object.freeze({
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
   * @param {{character: object, campaign: object, nextState: object, presentCharacters?: ReadonlyArray<object>, witnessedHistory?: ReadonlyArray<object>, knowledgePacket: object, currentInput: string, isArriving?: boolean, encounterBrief?: string, beatGoal?: string, length?: string, subjectLabels?: ReadonlyMap<string, string> | Record<string, string> | null, model: string, client: object, signal?: AbortSignal | null}} options
   * @returns {Promise<Readonly<{characterId: string, slug: string, name: string, internalThought: string, physicalAction: string, spokenLines: string, tone: string, knowledgeBoundaries: readonly string[], spendIds: readonly string[]}>>}
   * @throws {Error}
   */
  async think(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('CharacterMind options must be a plain object.');
    }

    const {
      character,
      campaign,
      nextState,
      presentCharacters = [],
      witnessedHistory = [],
      knowledgePacket,
      currentInput,
      isArriving = false,
      encounterBrief = '',
      beatGoal = '',
      length = 'medium',
      subjectLabels = null,
      model,
      client,
      signal = null,
    } = options;

    if (character === null || typeof character !== 'object' || Array.isArray(character)) {
      throw new TypeError('character must be an object.');
    }
    if (typeof character.id !== 'string' || character.id.trim().length === 0) {
      throw new RangeError('character.id must be a non-empty string.');
    }
    if (typeof character.slug !== 'string' || character.slug.trim().length === 0) {
      throw new RangeError('character.slug must be a non-empty string.');
    }
    if (typeof character.name !== 'string' || character.name.trim().length === 0) {
      throw new RangeError('character.name must be a non-empty string.');
    }
    CharacterTier.label(character.tier);

    if (campaign === null || typeof campaign !== 'object' || Array.isArray(campaign)) {
      throw new TypeError('campaign must be an object.');
    }
    if (typeof campaign.id !== 'string' || campaign.id.trim().length === 0) {
      throw new RangeError('campaign.id must be a non-empty string.');
    }
    if (nextState === null || typeof nextState !== 'object' || Array.isArray(nextState)) {
      throw new TypeError('nextState must be an object.');
    }
    if (!Array.isArray(presentCharacters)) {
      throw new TypeError('presentCharacters must be an array.');
    }
    if (!Array.isArray(witnessedHistory)) {
      throw new TypeError('witnessedHistory must be an array.');
    }
    if (knowledgePacket === null || typeof knowledgePacket !== 'object' || Array.isArray(knowledgePacket)) {
      throw new TypeError('knowledgePacket must be an object.');
    }
    if (typeof currentInput !== 'string') {
      throw new TypeError('currentInput must be a string.');
    }
    if (typeof isArriving !== 'boolean') {
      throw new TypeError('isArriving must be a boolean.');
    }
    if (typeof encounterBrief !== 'string') {
      throw new TypeError('encounterBrief must be a string.');
    }
    if (typeof beatGoal !== 'string') {
      throw new TypeError('beatGoal must be a string.');
    }
    if (typeof length !== 'string') {
      throw new TypeError('length must be a string.');
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

    if (signal?.aborted) {
      const abortError = new Error('Turn aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    const labelMap = new Map();
    if (subjectLabels instanceof Map) {
      for (const [subjectId, labelText] of subjectLabels.entries()) {
        if (typeof subjectId === 'string' && typeof labelText === 'string') {
          labelMap.set(subjectId, labelText);
        }
      }
    } else if (subjectLabels !== null && typeof subjectLabels === 'object' && !Array.isArray(subjectLabels)) {
      for (const [subjectId, labelText] of Object.entries(subjectLabels)) {
        if (typeof labelText === 'string') {
          labelMap.set(subjectId, labelText);
        }
      }
    }
    for (const participant of [character, ...presentCharacters]) {
      if (
        participant !== null &&
        typeof participant === 'object' &&
        typeof participant.scribeSubjectId === 'string' &&
        participant.scribeSubjectId.trim().length > 0 &&
        typeof participant.name === 'string' &&
        participant.name.trim().length > 0
      ) {
        labelMap.set(participant.scribeSubjectId.trim(), participant.name.trim());
      }
    }

    const formatFactLine = (fact) => {
      if (fact === null || typeof fact !== 'object') {
        return String(fact);
      }
      const subjectLabel = labelMap.get(fact.subject) ?? fact.subject ?? character.name;
      const targetLabel = fact.target !== null && fact.target !== undefined
        ? (labelMap.get(fact.target) ?? fact.target)
        : fact.targetText;
      const categoryPart = targetLabel ? `${fact.category} (${targetLabel})` : (fact.category ?? 'fact');
      return `- ${subjectLabel} | ${categoryPart}: ${CharacterCard.requestValue(fact.text)}`;
    };

    const knownFacts = Array.isArray(knowledgePacket.knownFacts) ? knowledgePacket.knownFacts : [];
    const relationships = Array.isArray(knowledgePacket.relationships) ? knowledgePacket.relationships : [];
    const visibleThreads = Array.isArray(knowledgePacket.visibleThreads) ? knowledgePacket.visibleThreads : [];
    const rulings = Array.isArray(knowledgePacket.rulings) ? knowledgePacket.rulings : [];

    const participantNames = presentCharacters
      .filter((participant) => participant !== null && typeof participant === 'object' && typeof participant.name === 'string')
      .map((participant) => participant.name.trim())
      .filter((name) => name.length > 0);
    const activeWalkOns = Array.isArray(nextState.activeWalkOns) ? nextState.activeWalkOns : [];

    const historyLines = [];
    for (const turnEntry of witnessedHistory) {
      const turnBeats = Array.isArray(turnEntry?.beats) ? turnEntry.beats : [];
      for (const beat of turnBeats) {
        historyLines.push(`[#${turnEntry.seq} Scene ${turnEntry.sceneNumber}] ${beat.speakerName}: ${beat.text}`);
      }
    }

    const systemPrompt = [
      `You are the internal mind and voice of ${character.name} in an ongoing adult fiction roleplay.`,
      'Stay strictly inside what this character directly perceives, witnessed, or knows from their memory packet.',
      'Never assume knowledge of scenes or facts that are not in your witnessed history or knowledge packet.',
      'Output ONLY one valid JSON object matching this exact schema (no prose outside JSON):',
      '{',
      '  "internalThought": string,',
      '  "physicalAction": string,',
      '  "spokenLines": string,',
      '  "tone": string,',
      '  "knowledgeBoundaries": string[]',
      '}',
    ].join('\n');

    const promptSections = [
      [
        'CHARACTER IDENTITY:',
        `Name: ${character.name}`,
        `Tier: ${character.tier}`,
        `Persona: ${character.card.personalitySummary.trim().length > 0 ? CharacterCard.requestValue(character.card.personalitySummary).trim() : '(none)'}`,
        `Voice notes: ${character.card.speakingStyle.trim().length > 0 ? CharacterCard.requestValue(character.card.speakingStyle).trim() : '(none)'}`,
      ].join('\n'),
      [
        'CURRENT SCENE:',
        `Location: ${nextState.location ?? ''}`,
        `Day: ${nextState.day ?? 1} (${nextState.timeLabel ?? ''})`,
        `Scene type: ${nextState.sceneType ?? ''}`,
        `Present/remote participants: ${participantNames.length > 0 ? participantNames.join(', ') : '(none)'}`,
        `Walk-ons present: ${activeWalkOns.length > 0 ? activeWalkOns.join(', ') : '(none)'}`,
      ].join('\n'),
      [
        'KNOWLEDGE PACKET:',
        `Rulings:\n${rulings.length > 0 ? rulings.map(formatFactLine).join('\n') : '(none)'}`,
        `Known facts:\n${knownFacts.length > 0 ? knownFacts.map(formatFactLine).join('\n') : '(none)'}`,
        `Relationships in scene:\n${relationships.length > 0 ? relationships.map(formatFactLine).join('\n') : '(none)'}`,
        `Visible open threads:\n${visibleThreads.length > 0 ? visibleThreads.map((thread) => `- ${thread.text}`).join('\n') : '(none)'}`,
      ].join('\n\n'),
      `WITNESSED HISTORY:\n${historyLines.length > 0 ? historyLines.join('\n') : '(none)'}`,
    ];

    if (isArriving) {
      const arrivalContext = encounterBrief.trim().length > 0
        ? encounterBrief.trim()
        : `You are just arriving at ${nextState.location ?? 'the scene'}.`;
      promptSections.push(
        [
          'CURRENT ARRIVAL CONTEXT (you were not present before this moment):',
          arrivalContext,
          `Beat goal: ${beatGoal.trim().length > 0 ? beatGoal.trim() : 'React naturally to what you immediately observe upon arrival.'}`,
          `Requested length: ${length}`,
        ].join('\n'),
      );
    } else {
      promptSections.push(
        [
          'CURRENT TURN INPUT:',
          currentInput,
          ...(encounterBrief.trim().length > 0 ? [`Encounter context: ${encounterBrief.trim()}`] : []),
          `Beat goal: ${beatGoal.trim().length > 0 ? beatGoal.trim() : 'Respond in character.'}`,
          `Requested length: ${length}`,
        ].join('\n'),
      );
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: promptSections.join('\n\n') },
    ];

    const normalizedModel = model.trim();
    const spendIds = [];
    const firstCompletion = await client.complete({
      model: normalizedModel,
      messages,
      stage: SpendStage.Mind,
      campaignId: campaign.id,
      signal,
    });
    if (typeof firstCompletion.spendId === 'string' && firstCompletion.spendId.length > 0) {
      spendIds.push(firstCompletion.spendId);
    }

    let parsed = CharacterMind.parseJsonObject(firstCompletion.text);
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
        stage: SpendStage.Mind,
        campaignId: campaign.id,
        signal,
      });
      if (typeof repairCompletion.spendId === 'string' && repairCompletion.spendId.length > 0) {
        spendIds.push(repairCompletion.spendId);
      }
      parsed = CharacterMind.parseJsonObject(repairCompletion.text);
      if (parsed === null) {
        const parseError = new Error(`CharacterMind (${character.name}) returned malformed JSON after repair retry.`);
        parseError.spendIds = Object.freeze([...spendIds]);
        throw parseError;
      }
    }

    const internalThought = typeof parsed.internalThought === 'string' ? parsed.internalThought.trim() : '';
    const physicalAction = typeof parsed.physicalAction === 'string' ? parsed.physicalAction.trim() : '';
    const spokenLines = typeof parsed.spokenLines === 'string' ? parsed.spokenLines.trim() : '';
    const tone = typeof parsed.tone === 'string' ? parsed.tone.trim() : '';

    const knowledgeBoundaries = [];
    if (Array.isArray(parsed.knowledgeBoundaries)) {
      for (const boundary of parsed.knowledgeBoundaries) {
        if (typeof boundary === 'string' && boundary.trim().length > 0) {
          knowledgeBoundaries.push(boundary.trim());
        }
      }
    } else if (typeof parsed.knowledgeBoundaries === 'string' && parsed.knowledgeBoundaries.trim().length > 0) {
      knowledgeBoundaries.push(parsed.knowledgeBoundaries.trim());
    }

    return Object.freeze({
      characterId: character.id,
      slug: character.slug,
      name: character.name,
      internalThought,
      physicalAction,
      spokenLines,
      tone,
      knowledgeBoundaries: Object.freeze(knowledgeBoundaries),
      spendIds: Object.freeze([...spendIds]),
    });
  },
});
