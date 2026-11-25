import { SpeakerType } from '../store/enums/SpeakerType.mjs';
import { SpendStage } from '../store/enums/SpendStage.mjs';
import { BeatParser } from './BeatParser.mjs';

export const NarratorComposer = Object.freeze({
  /**
   * @param {{campaign: object, characters: ReadonlyArray<object>, nextState: object, recentSceneTurns?: ReadonlyArray<object>, userBeat: object, oocNudge?: string | null, directorPlan: object, mindPackets?: ReadonlyArray<object>, model: string, client: object, signal?: AbortSignal | null, onBeatDelta?: ((delta: {beatIndex: number, speakerType: string, slug: string, speakerName: string, delta: string}) => void | Promise<void>) | null}} options
   * @returns {Promise<Readonly<{beats: ReadonlyArray<Readonly<{speakerType: string, characterId: string | null, slug: string, speakerName: string, text: string, mindPacket: object | null}>>, rawText: string, truncated: boolean, playerBeatRemapped: boolean, spendId: string | null}>>}
   * @throws {Error}
   */
  async compose(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('NarratorComposer options must be a plain object.');
    }

    const {
      campaign,
      characters,
      nextState,
      recentSceneTurns = [],
      userBeat,
      oocNudge = null,
      directorPlan,
      mindPackets = [],
      model,
      client,
      signal = null,
      onBeatDelta = null,
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
    if (nextState === null || typeof nextState !== 'object' || Array.isArray(nextState)) {
      throw new TypeError('nextState must be an object.');
    }
    if (!Number.isInteger(nextState.sceneNumber) || nextState.sceneNumber < 1) {
      throw new RangeError('nextState.sceneNumber must be a positive integer.');
    }
    if (!Array.isArray(recentSceneTurns)) {
      throw new TypeError('recentSceneTurns must be an array.');
    }
    if (userBeat === null || typeof userBeat !== 'object' || Array.isArray(userBeat)) {
      throw new TypeError('userBeat must be an object.');
    }
    if (typeof userBeat.speakerName !== 'string' || typeof userBeat.text !== 'string') {
      throw new TypeError('userBeat must include string speakerName and text.');
    }
    if (oocNudge !== null && typeof oocNudge !== 'string') {
      throw new TypeError('oocNudge must be null or a string.');
    }
    if (directorPlan === null || typeof directorPlan !== 'object' || Array.isArray(directorPlan)) {
      throw new TypeError('directorPlan must be an object.');
    }
    if (!Array.isArray(mindPackets)) {
      throw new TypeError('mindPackets must be an array.');
    }
    if (typeof model !== 'string' || model.trim().length === 0) {
      throw new RangeError('model must be a non-empty string.');
    }
    if (client === null || typeof client !== 'object' || typeof client.stream !== 'function') {
      throw new TypeError('client must provide a stream() method.');
    }
    if (signal !== null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
      throw new TypeError('signal must be null or an AbortSignal.');
    }
    if (onBeatDelta !== null && typeof onBeatDelta !== 'function') {
      throw new TypeError('onBeatDelta must be null or a function.');
    }

    if (signal?.aborted) {
      const abortError = new Error('Turn aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    const nonArchivedChars = characters.filter(
      (character) => character !== null && typeof character === 'object' && character.archived !== true,
    );
    const playerChar = campaign.playerCharacterId
      ? nonArchivedChars.find((character) => character.id === campaign.playerCharacterId) ?? null
      : null;
    const playerSlug = playerChar?.slug ? playerChar.slug.trim().toLowerCase() : null;

    const presentIdSet = new Set(Array.isArray(nextState.presentIds) ? nextState.presentIds : []);
    const remoteIdSet = new Set(Array.isArray(nextState.remoteIds) ? nextState.remoteIds : []);
    const participantIdSet = new Set([...presentIdSet, ...remoteIdSet]);

    const activeNpcChars = nonArchivedChars.filter((character) => {
      return participantIdSet.has(character.id) && character.id !== campaign.playerCharacterId;
    });

    const validSlugs = [];
    const slugToName = {};
    const nameToSlug = {};
    const slugToChar = new Map();

    for (const character of activeNpcChars) {
      const normalizedSlug = character.slug.trim().toLowerCase();
      validSlugs.push(normalizedSlug);
      slugToName[normalizedSlug] = character.name;
      slugToChar.set(normalizedSlug, character);
      nameToSlug[character.name.trim().toLowerCase()] = normalizedSlug;
      if (Array.isArray(character.aliases)) {
        for (const alias of character.aliases) {
          if (typeof alias === 'string' && alias.trim().length > 0) {
            const aliasKey = alias.trim().toLowerCase();
            if (!Object.hasOwn(nameToSlug, aliasKey)) {
              nameToSlug[aliasKey] = normalizedSlug;
            }
          }
        }
      }
    }

    if (playerChar !== null && playerSlug !== null) {
      nameToSlug[playerChar.name.trim().toLowerCase()] = playerSlug;
      if (Array.isArray(playerChar.aliases)) {
        for (const alias of playerChar.aliases) {
          if (typeof alias === 'string' && alias.trim().length > 0) {
            nameToSlug[alias.trim().toLowerCase()] = playerSlug;
          }
        }
      }
    }

    const currentSceneTurns = recentSceneTurns.filter((turn) => {
      return turn !== null && typeof turn === 'object' && turn.sceneNumber === nextState.sceneNumber;
    });
    const sceneTranscriptLines = [];
    for (const turn of currentSceneTurns) {
      const turnBeats = Array.isArray(turn.beats) ? turn.beats : [];
      if (turnBeats.length > 0) {
        for (const beat of turnBeats) {
          sceneTranscriptLines.push(`${beat.speakerName}: ${typeof beat.text === 'string' ? beat.text : ''}`);
        }
      } else if (typeof turn.rawText === 'string' && turn.rawText.trim().length > 0) {
        sceneTranscriptLines.push(turn.rawText.trim());
      }
    }

    const participantSummaries = nonArchivedChars
      .filter((character) => participantIdSet.has(character.id))
      .map((character) => {
        const modeLabel = presentIdSet.has(character.id) ? 'present' : 'remote';
        const roleLabel = character.id === campaign.playerCharacterId ? 'player' : 'npc';
        const voicePart = character.card.speakingStyle.trim().length > 0
          ? ` | voice: ${character.card.speakingStyle.trim()}`
          : '';
        return `- ${character.name} (slug: ${character.slug}, ${roleLabel}, ${modeLabel})${voicePart}`;
      });

    const sanitizedPackets = [];
    const mindPacketByCharId = new Map();
    for (const rawPacket of mindPackets) {
      if (rawPacket === null || typeof rawPacket !== 'object') {
        continue;
      }
      const cleanPacket = Object.freeze({
        characterId: rawPacket.characterId,
        slug: rawPacket.slug,
        name: rawPacket.name,
        internalThought: typeof rawPacket.internalThought === 'string' ? rawPacket.internalThought : '',
        physicalAction: typeof rawPacket.physicalAction === 'string' ? rawPacket.physicalAction : '',
        spokenLines: typeof rawPacket.spokenLines === 'string' ? rawPacket.spokenLines : '',
        tone: typeof rawPacket.tone === 'string' ? rawPacket.tone : '',
        knowledgeBoundaries: Object.freeze(
          Array.isArray(rawPacket.knowledgeBoundaries) ? [...rawPacket.knowledgeBoundaries] : [],
        ),
      });
      sanitizedPackets.push(cleanPacket);
      mindPacketByCharId.set(cleanPacket.characterId, cleanPacket);
    }

    const mindPacketLines = sanitizedPackets.map((packet) => {
      return [
        `Character: ${packet.name} (slug: ${packet.slug})`,
        `Tone: ${packet.tone || 'neutral'}`,
        `Physical action: ${packet.physicalAction || '(none)'}`,
        `Spoken lines / intent: ${packet.spokenLines || '(none)'}`,
        `Internal thought (SUBTEXT ONLY - NEVER print as telepathy or shared facts): ${packet.internalThought || '(none)'}`,
        `Knowledge boundaries: ${packet.knowledgeBoundaries.length > 0 ? packet.knowledgeBoundaries.join('; ') : '(none)'}`,
      ].join('\n');
    });

    const systemPrompt = [
      'You are the Narrator Composer weaving the next scene reply in cohesive, vivid prose broken into speaker-tagged beats.',
      '',
      'Mandatory contracts:',
      '1. Emit EVERY beat starting on its own line with [[BEAT:narrator]] or [[BEAT:<slug>]] using ONLY the exact non-player character slugs listed below.',
      '2. Preserve each Character Mind packet spoken intent, physical cues, tone, and knowledgeBoundaries.',
      '3. Use internalThought ONLY to inform posture, hesitation, expression, and subtext. NEVER print telepathic inner monologue or unspoken thoughts as shared facts.',
      `4. NEVER speak, act, think, or emit a beat tag for the player character${playerChar !== null ? ` (${playerChar.name}, slug "${playerChar.slug}")` : ''}.`,
      '5. Use [[BEAT:narrator]] for scene description, transitions, and any active walk-ons.',
    ].join('\n');

    const activeWalkOns = Array.isArray(nextState.activeWalkOns) ? nextState.activeWalkOns : [];
    const userPrompt = [
      `CAMPAIGN PREMISE:\n${typeof campaign.premise === 'string' && campaign.premise.trim().length > 0 ? campaign.premise.trim() : '(none)'}`,
      `STYLE NOTES:\n${typeof campaign.styleNotes === 'string' && campaign.styleNotes.trim().length > 0 ? campaign.styleNotes.trim() : '(none)'}`,
      [
        'UPDATED SCENE STATE:',
        `Scene #${nextState.sceneNumber}, Day ${nextState.day} (${nextState.timeLabel}), Location: ${nextState.location}, Type: ${nextState.sceneType}`,
        `Participants:\n${participantSummaries.length > 0 ? participantSummaries.join('\n') : '(none)'}`,
        `Active walk-ons: ${activeWalkOns.length > 0 ? activeWalkOns.join(', ') : '(none)'}`,
      ].join('\n'),
      `CURRENT SCENE RECENT TRANSCRIPT:\n${sceneTranscriptLines.length > 0 ? sceneTranscriptLines.join('\n') : '(opening of scene)'}`,
      `CURRENT USER BEAT:\n${userBeat.speakerName}: ${userBeat.text}${oocNudge !== null && oocNudge.trim().length > 0 ? `\nOOC Nudge: ${oocNudge.trim()}` : ''}`,
      [
        'DIRECTOR PLAN:',
        `Pacing: ${directorPlan.pacing ?? 'focused_one'}`,
        `Target length: ~${directorPlan.targetChars ?? 1350} chars`,
        `Narrator directive: ${directorPlan.narratorDirective || '(none)'}`,
        ...(directorPlan.encounterAccepted && directorPlan.encounterBrief
          ? [`Encounter brief: ${directorPlan.encounterBrief}`]
          : []),
      ].join('\n'),
      `CHARACTER MIND PACKETS:\n${mindPacketLines.length > 0 ? mindPacketLines.join('\n\n') : '(none - narrator_only)'}`,
    ].join('\n\n');

    const beatParser = new BeatParser({
      validSlugs,
      nameToSlug,
      slugToName,
      playerSlug,
    });

    const streamResult = await client.stream({
      model: model.trim(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stage: SpendStage.Composer,
      campaignId: campaign.id,
      signal,
      onDelta: async (deltaText) => {
        const parsedDeltas = beatParser.push(deltaText);
        if (onBeatDelta !== null) {
          for (const parsedDelta of parsedDeltas) {
            await onBeatDelta(parsedDelta);
          }
        }
      },
    });

    if (signal?.aborted) {
      const abortError = new Error('Turn aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    const flushedDeltas = beatParser.flush();
    if (onBeatDelta !== null) {
      for (const parsedDelta of flushedDeltas) {
        await onBeatDelta(parsedDelta);
      }
    }

    const parsedBeats = beatParser.getBeats();
    if (parsedBeats.length === 0) {
      throw new Error('NarratorComposer produced zero non-empty beats.');
    }

    const assembledBeats = parsedBeats.map((parsedBeat) => {
      const matchedChar = parsedBeat.speakerType === SpeakerType.Character
        ? slugToChar.get(parsedBeat.slug) ?? null
        : null;
      const mindPacket = matchedChar !== null
        ? mindPacketByCharId.get(matchedChar.id) ?? null
        : null;
      return Object.freeze({
        speakerType: parsedBeat.speakerType,
        characterId: matchedChar?.id ?? null,
        slug: parsedBeat.slug,
        speakerName: parsedBeat.speakerName,
        text: parsedBeat.text,
        mindPacket,
      });
    });

    return Object.freeze({
      beats: Object.freeze(assembledBeats),
      rawText: streamResult.text,
      truncated: streamResult.truncated,
      playerBeatRemapped: beatParser.wasPlayerBeatRemapped(),
      spendId: streamResult.spendId,
    });
  },
});
