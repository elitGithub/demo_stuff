import { SpendStage } from '../store/enums/SpendStage.mjs';
import { ReplyStreamSplitter } from './ReplyStreamSplitter.mjs';
import { TagReader } from './TagReader.mjs';

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
  const settings = Narrator.Settings;
  return `<${tagName}>${settings.LineSeparator}${lines.join(settings.LineSeparator)}${settings.LineSeparator}</${tagName}>`;
}

export const Narrator = Object.freeze({
  Settings: Object.freeze({
    Tag: Object.freeze({
      Campaign: 'campaign',
      Rules: 'rules',
      StoryState: 'story_state',
      History: 'history',
      ThisTurn: 'this_turn',
      Style: 'style',
      Direction: 'direction',
      Narration: 'narration',
    }),
    Label: Object.freeze({
      Premise: 'Premise',
      Style: 'Style',
    }),
    RoleSystem: 'system',
    RoleUser: 'user',
    LineSeparator: '\n',
    SectionSeparator: '\n\n',
    ColonSeparator: ': ',
    EmptyText: '',
    AbortName: 'AbortError',
    AbortMessage: 'Turn aborted',
    UnclosedNarrationPattern: /<narration(?=\s|\/|>|$)/i,
  }),

  /**
   * @param {{campaign: {id?: string, premise?: string, styleNotes?: string}, storyState?: string, history?: string, thisTurn?: string, styleText?: string, direction?: string}} [options]
   * @returns {readonly [Readonly<{role: string, content: string}>, Readonly<{role: string, content: string}>]}
   * @throws {TypeError}
   */
  buildMessages(options = {}) {
    if (
      options === null ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)
    ) {
      throw new TypeError('Narrator options must be a plain object.');
    }

    const settings = Narrator.Settings;
    const {
      campaign,
      storyState = settings.EmptyText,
      history = settings.EmptyText,
      thisTurn = settings.EmptyText,
      styleText = settings.EmptyText,
      direction = settings.EmptyText,
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

    const trimmedStoryState = requireString(storyState, 'storyState').trim();
    const trimmedHistory = requireString(history, 'history').trim();
    const trimmedThisTurn = requireString(thisTurn, 'thisTurn').trim();
    const trimmedStyleText = requireString(styleText, 'styleText').trim();
    const trimmedDirection = requireString(direction, 'direction').trim();

    const systemSections = [
      'You are the Narrator in an ongoing adult fiction roleplay. You open the turn by grounding the scene in concrete prose.',
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

    const rulesLines = [
      'Describe the scene: weather, time, light, sounds, scenery, where everyone is, visible actions, arrivals, and walk-on lines.',
      'Never decide a cast member\'s choices, dialogue, or private thoughts.',
      'Leave the player character alone unless an action is obvious, small, or stated by the player.',
      'Treat any Narrator: lines in <this_turn> as established narrator facts.',
      'Write in third-person narrative prose.',
      'Answer in exactly this shape and nothing else:',
      `<${settings.Tag.Narration}>the scene narration</${settings.Tag.Narration}>`,
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
    if (trimmedStyleText.length > 0) {
      userSections.push(wrapTagBlock(settings.Tag.Style, [trimmedStyleText]));
    }
    userSections.push(`<${settings.Tag.Direction}>${trimmedDirection}</${settings.Tag.Direction}>`);

    return Object.freeze([
      Object.freeze({ role: settings.RoleSystem, content: systemSections.join(settings.SectionSeparator) }),
      Object.freeze({ role: settings.RoleUser, content: userSections.join(settings.SectionSeparator) }),
    ]);
  },

  /**
   * @param {{campaign: {id: string, premise?: string, styleNotes?: string}, storyState?: string, history?: string, thisTurn?: string, styleText?: string, direction?: string, model: string, replyReserve: number, client: {stream: (requestOptions: object) => Promise<{text?: string, truncated?: boolean, spendId?: string | null}>}, signal?: AbortSignal | null, onDelta?: ((delta: string) => void | Promise<void>) | null}} [options]
   * @returns {Promise<Readonly<{narration: string, truncated: boolean, spendId: string | null}>>}
   * @throws {TypeError | RangeError | Error}
   */
  async narrate(options = {}) {
    if (
      options === null ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)
    ) {
      throw new TypeError('Narrator options must be a plain object.');
    }

    const settings = Narrator.Settings;
    const {
      campaign,
      storyState = settings.EmptyText,
      history = settings.EmptyText,
      thisTurn = settings.EmptyText,
      styleText = settings.EmptyText,
      direction = settings.EmptyText,
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
    const messages = Narrator.buildMessages({
      campaign,
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
      visibleTag: settings.Tag.Narration,
    });

    const streamResult = await client.stream({
      model: trimmedModel,
      messages,
      maxTokens: replyReserve,
      stage: SpendStage.Composer,
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
        visibleTag: settings.Tag.Narration,
      });
      fallbackSplitter.push(raw);
      resolvedVisible = fallbackSplitter.finish().visible;
    }

    const narrationBodies = TagReader.read(raw, settings.Tag.Narration)
      .map((tag) => tag.body.trim())
      .filter((body) => body.length > 0);
    let narration;
    if (narrationBodies.length > 0) {
      narration = narrationBodies.join(settings.SectionSeparator);
    } else if (resolvedVisible.trim().length > 0) {
      narration = resolvedVisible.trim();
    } else {
      const outsideText = TagReader.outside(raw, [settings.Tag.Narration]);
      const unclosedMatch = settings.UnclosedNarrationPattern.exec(outsideText);
      narration = (unclosedMatch === null ? outsideText : outsideText.slice(0, unclosedMatch.index)).trim();
    }

    return Object.freeze({
      narration,
      truncated: Boolean(streamResult.truncated),
      spendId: typeof streamResult.spendId === 'string' && streamResult.spendId.length > 0 ? streamResult.spendId : null,
    });
  },
});
