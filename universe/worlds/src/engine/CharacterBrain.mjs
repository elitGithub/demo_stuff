import { CharacterCard } from '../store/CharacterCard.mjs';
import { SpendStage } from '../store/enums/SpendStage.mjs';
import { ReplyStreamSplitter } from './ReplyStreamSplitter.mjs';
import { TagReader } from './TagReader.mjs';

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
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {string}
 * @throws {TypeError}
 */
function requireString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must be a string.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {string}
 * @throws {TypeError | RangeError}
 */
function requireNonEmptyString(value, fieldName) {
  const stringValue = requireString(value, fieldName);
  const trimmed = stringValue.trim();
  if (trimmed.length === 0) {
    throw new RangeError(`${fieldName} must be a non-empty string.`);
  }
  return trimmed;
}

/**
 * @param {string} tagName
 * @param {ReadonlyArray<string>} lines
 * @returns {string}
 */
function wrapTagBlock(tagName, lines) {
  const settings = CharacterBrain.Settings;
  return `<${tagName}>${settings.LineSeparator}${lines.join(settings.LineSeparator)}${settings.LineSeparator}</${tagName}>`;
}

/**
 * @param {ReadonlyArray<readonly [string, string]>} pairs
 * @returns {string | null}
 */
function formatIdentityLine(pairs) {
  const settings = CharacterBrain.Settings;
  const parts = [];
  for (const [label, value] of pairs) {
    if (value.length > 0) {
      parts.push(`${label}${settings.ColonSeparator}${value}`);
    }
  }
  return parts.length > 0 ? parts.join(settings.PipeSeparator) : null;
}

/**
 * @param {string} text
 * @param {ReadonlyArray<RegExp>} patterns
 * @returns {string}
 */
function stripAtEarliestMatch(text, patterns) {
  let earliestIndex = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match !== null && (earliestIndex === -1 || match.index < earliestIndex)) {
      earliestIndex = match.index;
    }
  }
  return earliestIndex === -1 ? text : text.slice(0, earliestIndex);
}

export const CharacterBrain = Object.freeze({
  Settings: Object.freeze({
    Tag: Object.freeze({
      Thoughts: 'thoughts',
      Reply: 'reply',
      Next: 'next',
      Campaign: 'campaign',
      Identity: 'identity',
      VoiceExamples: 'voice_examples',
      Rules: 'rules',
      StoryState: 'story_state',
      History: 'history',
      ThisTurn: 'this_turn',
      Portrayal: 'portrayal',
      Style: 'style',
      Direction: 'direction',
    }),
    Attr: Object.freeze({
      Reacting: 'reacting',
      Length: 'length',
    }),
    Label: Object.freeze({
      Premise: 'Premise',
      Style: 'Style',
      Personality: 'Personality',
      Traits: 'Traits',
      Habits: 'Habits',
      Behaviour: 'Behaviour',
      Likes: 'Likes',
      Dislikes: 'Dislikes',
      Sexuality: 'Sexuality',
      Kinks: 'Kinks',
      SpeakingStyle: 'Speaking style',
      Quirks: 'Quirks',
      RoleInStory: 'Role in the story',
    }),
    NextNone: 'none',
    RoleSystem: 'system',
    RoleUser: 'user',
    LineSeparator: '\n',
    SectionSeparator: '\n\n',
    PipeSeparator: ' | ',
    ColonSeparator: ': ',
    EmptyText: '',
    AbortName: 'AbortError',
    AbortMessage: 'Turn aborted',
    UnclosedThoughtsPattern: /<thoughts(?=\s|\/|>|$)/i,
    UnclosedReplyPattern: /<reply(?=\s|\/|>|$)/i,
    UnclosedNextPattern: /<next(?=\s|\/|>|$)/i,
  }),

  /**
   * @param {{campaign: {id?: string, premise?: string, styleNotes?: string}, character: {name: string}, card: CharacterCard | Record<string, unknown>, playerName?: string | null, storyState?: string, history?: string, thisTurn?: string, styleText?: string, direction: {reacting: string, length: string, beatGoal: string}}} [options]
   * @returns {readonly [Readonly<{role: string, content: string}>, Readonly<{role: string, content: string}>]}
   * @throws {TypeError | RangeError}
   */
  buildMessages(options = {}) {
    if (!isPlainObject(options)) {
      throw new TypeError('CharacterBrain options must be a plain object.');
    }

    const settings = CharacterBrain.Settings;
    const {
      campaign,
      character,
      card,
      playerName = null,
      storyState = settings.EmptyText,
      history = settings.EmptyText,
      thisTurn = settings.EmptyText,
      styleText = settings.EmptyText,
      direction,
    } = options;

    if (campaign === null || typeof campaign !== 'object' || Array.isArray(campaign)) {
      throw new TypeError('campaign must be an object.');
    }
    if (campaign.premise !== undefined) {
      requireString(campaign.premise, 'campaign.premise');
    }
    if (campaign.styleNotes !== undefined) {
      requireString(campaign.styleNotes, 'campaign.styleNotes');
    }

    if (character === null || typeof character !== 'object' || Array.isArray(character)) {
      throw new TypeError('character must be an object.');
    }
    const characterName = requireNonEmptyString(character.name, 'character.name');

    const parsedCard = CharacterCard.fromObject(card);

    if (playerName !== null && typeof playerName !== 'string') {
      throw new TypeError('playerName must be null or a string.');
    }
    const trimmedStoryState = requireString(storyState, 'storyState').trim();
    const trimmedHistory = requireString(history, 'history').trim();
    const trimmedThisTurn = requireString(thisTurn, 'thisTurn').trim();
    const trimmedStyleText = requireString(styleText, 'styleText').trim();

    if (!isPlainObject(direction)) {
      throw new TypeError('direction must be a plain object.');
    }
    const trimmedReacting = requireNonEmptyString(direction.reacting, 'direction.reacting');
    const trimmedLength = requireNonEmptyString(direction.length, 'direction.length');
    const trimmedBeatGoal = requireString(direction.beatGoal, 'direction.beatGoal').trim();

    const systemSections = [
      `You are ${characterName} in an ongoing adult fiction roleplay. You write only ${characterName}'s own reply.`,
    ];

    const premiseText = campaign.premise === undefined ? settings.EmptyText : campaign.premise.trim();
    const styleNotesText = campaign.styleNotes === undefined ? settings.EmptyText : campaign.styleNotes.trim();
    const campaignLines = [];
    if (premiseText.length > 0) {
      campaignLines.push(`${settings.Label.Premise}${settings.ColonSeparator}${premiseText}`);
    }
    if (styleNotesText.length > 0) {
      campaignLines.push(`${settings.Label.Style}${settings.ColonSeparator}${styleNotesText}`);
    }
    if (campaignLines.length > 0) {
      systemSections.push(wrapTagBlock(settings.Tag.Campaign, campaignLines));
    }

    const identityLines = [];
    const personalityValue = CharacterCard.requestValue(parsedCard.personalitySummary).trim();
    if (personalityValue.length > 0) {
      identityLines.push(`${settings.Label.Personality}${settings.ColonSeparator}${personalityValue}`);
    }
    const temperamentLine = formatIdentityLine([
      [settings.Label.Traits, CharacterCard.requestValue(parsedCard.traits).trim()],
      [settings.Label.Habits, CharacterCard.requestValue(parsedCard.habits).trim()],
      [settings.Label.Behaviour, CharacterCard.requestValue(parsedCard.behavior).trim()],
    ]);
    if (temperamentLine !== null) {
      identityLines.push(temperamentLine);
    }
    const preferenceLine = formatIdentityLine([
      [settings.Label.Likes, CharacterCard.requestValue(parsedCard.likes).trim()],
      [settings.Label.Dislikes, CharacterCard.requestValue(parsedCard.dislikes).trim()],
    ]);
    if (preferenceLine !== null) {
      identityLines.push(preferenceLine);
    }
    const intimacyLine = formatIdentityLine([
      [settings.Label.Sexuality, CharacterCard.requestValue(parsedCard.sexualityOrientation).trim()],
      [settings.Label.Kinks, CharacterCard.requestValue(parsedCard.sexualityKinks).trim()],
      [settings.Label.Likes, CharacterCard.requestValue(parsedCard.sexualityLikes).trim()],
      [settings.Label.Dislikes, CharacterCard.requestValue(parsedCard.sexualityDislikes).trim()],
    ]);
    if (intimacyLine !== null) {
      identityLines.push(intimacyLine);
    }
    const voiceLine = formatIdentityLine([
      [settings.Label.SpeakingStyle, CharacterCard.requestValue(parsedCard.speakingStyle).trim()],
      [settings.Label.Quirks, CharacterCard.requestValue(parsedCard.speakingQuirks).trim()],
    ]);
    if (voiceLine !== null) {
      identityLines.push(voiceLine);
    }
    const scenarioValue = CharacterCard.requestValue(parsedCard.scenario).trim();
    if (scenarioValue.length > 0) {
      identityLines.push(`${settings.Label.RoleInStory}${settings.ColonSeparator}${scenarioValue}`);
    }
    if (identityLines.length > 0) {
      systemSections.push(wrapTagBlock(settings.Tag.Identity, identityLines));
    }

    const voiceExamples = parsedCard.speechExamples
      .map((example) => example.trim())
      .filter((example) => example.length > 0);
    if (voiceExamples.length > 0) {
      systemSections.push(wrapTagBlock(settings.Tag.VoiceExamples, voiceExamples));
    }

    const trimmedPlayerName = playerName === null ? settings.EmptyText : playerName.trim();
    const boundaryLine = trimmedPlayerName.length > 0
      ? `Never speak, act or decide for ${trimmedPlayerName} or for anyone else.`
      : 'Never speak, act or decide for anyone else.';
    const nextShapeLine = trimmedPlayerName.length > 0
      ? `<${settings.Tag.Next}>the name of who should answer you, or ${trimmedPlayerName}, or ${settings.NextNone}</${settings.Tag.Next}>`
      : `<${settings.Tag.Next}>the name of who should answer you, or ${settings.NextNone}</${settings.Tag.Next}>`;
    const rulesLines = [
      `Write speech in "quotes" and ${characterName}'s actions in third person between *asterisks*, together in one reply.`,
      'Never write first-person narration of your own actions.',
      boundaryLine,
      'Know only what is in your story state and what you witnessed.',
      'Answer in exactly this shape and nothing else:',
      `<${settings.Tag.Thoughts}>what ${characterName} privately thinks and feels now</${settings.Tag.Thoughts}>`,
      `<${settings.Tag.Reply}>the visible reply</${settings.Tag.Reply}>`,
      nextShapeLine,
    ];
    systemSections.push(wrapTagBlock(settings.Tag.Rules, rulesLines));

    const userSections = [];
    if (trimmedStoryState.length > 0) {
      const isAlreadyWrapped =
        TagReader.read(trimmedStoryState, settings.Tag.StoryState).length === 1 &&
        TagReader.outside(trimmedStoryState, [settings.Tag.StoryState]).length === 0;
      userSections.push(
        isAlreadyWrapped ? trimmedStoryState : wrapTagBlock(settings.Tag.StoryState, [trimmedStoryState]),
      );
    }
    if (trimmedHistory.length > 0) {
      userSections.push(wrapTagBlock(settings.Tag.History, [trimmedHistory]));
    }
    if (trimmedThisTurn.length > 0) {
      userSections.push(wrapTagBlock(settings.Tag.ThisTurn, [trimmedThisTurn]));
    }
    const portrayalValue = CharacterCard.requestValue(parsedCard.characterNote).trim();
    if (portrayalValue.length > 0) {
      userSections.push(wrapTagBlock(settings.Tag.Portrayal, [portrayalValue]));
    }
    if (trimmedStyleText.length > 0) {
      userSections.push(wrapTagBlock(settings.Tag.Style, [trimmedStyleText]));
    }
    userSections.push(
      `<${settings.Tag.Direction} ${settings.Attr.Reacting}="${trimmedReacting}" ${settings.Attr.Length}="${trimmedLength}">${trimmedBeatGoal}</${settings.Tag.Direction}>`,
    );

    return Object.freeze([
      Object.freeze({ role: settings.RoleSystem, content: systemSections.join(settings.SectionSeparator) }),
      Object.freeze({ role: settings.RoleUser, content: userSections.join(settings.SectionSeparator) }),
    ]);
  },

  /**
   * @param {{campaign: {id: string, premise?: string, styleNotes?: string}, character: {name: string}, card: CharacterCard | Record<string, unknown>, playerName?: string | null, storyState?: string, history?: string, thisTurn?: string, styleText?: string, direction: {reacting: string, length: string, beatGoal: string}, model: string, replyReserve: number, client: {stream: (requestOptions: object) => Promise<{text?: string, truncated?: boolean, spendId?: string | null}>}, signal?: AbortSignal | null, onDelta?: ((delta: string) => void | Promise<void>) | null}} [options]
   * @returns {Promise<Readonly<{reply: string, thoughts: string, next: string | null, truncated: boolean, spendId: string | null}>>}
   * @throws {TypeError | RangeError | Error}
   */
  async reply(options = {}) {
    if (!isPlainObject(options)) {
      throw new TypeError('CharacterBrain options must be a plain object.');
    }

    const settings = CharacterBrain.Settings;
    const {
      campaign,
      character,
      card,
      playerName = null,
      storyState = settings.EmptyText,
      history = settings.EmptyText,
      thisTurn = settings.EmptyText,
      styleText = settings.EmptyText,
      direction,
      model,
      replyReserve,
      client,
      signal = null,
      onDelta = null,
    } = options;

    if (campaign === null || typeof campaign !== 'object' || Array.isArray(campaign)) {
      throw new TypeError('campaign must be an object.');
    }
    const campaignId = requireNonEmptyString(campaign.id, 'campaign.id');
    const messages = CharacterBrain.buildMessages({
      campaign,
      character,
      card,
      playerName,
      storyState,
      history,
      thisTurn,
      styleText,
      direction,
    });

    const trimmedModel = requireNonEmptyString(model, 'model');

    if (typeof replyReserve !== 'number') {
      throw new TypeError('replyReserve must be a positive integer.');
    }
    if (!Number.isInteger(replyReserve) || replyReserve <= 0) {
      throw new RangeError('replyReserve must be a positive integer.');
    }
    if (client === null || typeof client !== 'object' || Array.isArray(client) || typeof client.stream !== 'function') {
      throw new TypeError('client must provide a stream() method.');
    }
    if (signal !== null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
      throw new TypeError('signal must be null or an AbortSignal.');
    }
    if (onDelta !== null && typeof onDelta !== 'function') {
      throw new TypeError('onDelta must be null or a function.');
    }

    if (signal !== null && signal.aborted) {
      const abortError = new Error(settings.AbortMessage);
      abortError.name = settings.AbortName;
      throw abortError;
    }

    const splitter = new ReplyStreamSplitter({
      visibleTag: settings.Tag.Reply,
      hiddenTags: [settings.Tag.Thoughts, settings.Tag.Next],
    });

    const streamResult = await client.stream({
      model: trimmedModel,
      messages,
      maxTokens: replyReserve,
      stage: SpendStage.Mind,
      campaignId,
      signal,
      onDelta: async (deltaChunk) => {
        const visibleChunk = splitter.push(deltaChunk);
        if (onDelta !== null && visibleChunk.length > 0) {
          await onDelta(visibleChunk);
        }
      },
    });

    if (signal !== null && signal.aborted) {
      const abortError = new Error(settings.AbortMessage);
      abortError.name = settings.AbortName;
      throw abortError;
    }

    const splitResult = splitter.finish();
    const raw = typeof streamResult.text === 'string' && streamResult.text.length > 0
      ? streamResult.text
      : splitResult.raw;

    let resolvedVisible = splitResult.visible;
    if (splitResult.raw.length === 0 && raw.length > 0) {
      const fallbackSplitter = new ReplyStreamSplitter({
        visibleTag: settings.Tag.Reply,
        hiddenTags: [settings.Tag.Thoughts, settings.Tag.Next],
      });
      fallbackSplitter.push(raw);
      resolvedVisible = fallbackSplitter.finish().visible;
    }

    const thoughts = TagReader.read(raw, settings.Tag.Thoughts)
      .map((tag) => tag.body.trim())
      .filter((body) => body.length > 0)
      .join(settings.SectionSeparator);

    const withoutClosedThoughts = TagReader.outside(raw, [settings.Tag.Thoughts]);
    const hasThoughtsOutsideReply = settings.UnclosedThoughtsPattern.test(
      TagReader.outside(withoutClosedThoughts, [settings.Tag.Reply]),
    );
    const unclosedThoughtsMatch = hasThoughtsOutsideReply
      ? settings.UnclosedThoughtsPattern.exec(withoutClosedThoughts)
      : null;
    const sanitizedForReplyAndNext = unclosedThoughtsMatch === null
      ? withoutClosedThoughts
      : withoutClosedThoughts.slice(0, unclosedThoughtsMatch.index);

    const replyBodies = TagReader.read(sanitizedForReplyAndNext, settings.Tag.Reply)
      .map((tag) => TagReader.outside(tag.body, [settings.Tag.Next]).trim())
      .filter((body) => body.length > 0);
    let reply;
    if (replyBodies.length > 0) {
      reply = replyBodies.join(settings.SectionSeparator);
    } else if (resolvedVisible.trim().length > 0) {
      const cleanedVisible = TagReader.outside(resolvedVisible, [settings.Tag.Thoughts, settings.Tag.Next]);
      reply = stripAtEarliestMatch(cleanedVisible, [
        settings.UnclosedThoughtsPattern,
        settings.UnclosedNextPattern,
      ]).trim();
    } else {
      const outsideText = TagReader.outside(sanitizedForReplyAndNext, [
        settings.Tag.Reply,
        settings.Tag.Next,
      ]);
      reply = stripAtEarliestMatch(outsideText, [
        settings.UnclosedReplyPattern,
        settings.UnclosedNextPattern,
      ]).trim();
    }

    const nextTags = TagReader.read(sanitizedForReplyAndNext, settings.Tag.Next);
    let next = null;
    if (nextTags.length > 0) {
      const candidateNext = nextTags[0].body.trim();
      if (candidateNext.length > 0 && candidateNext.toLowerCase() !== settings.NextNone) {
        next = candidateNext;
      }
    }

    return Object.freeze({
      reply,
      thoughts,
      next,
      truncated: Boolean(streamResult.truncated),
      spendId: typeof streamResult.spendId === 'string' && streamResult.spendId.length > 0 ? streamResult.spendId : null,
    });
  },
});
