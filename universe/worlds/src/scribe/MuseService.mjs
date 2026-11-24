import { SceneType } from '../store/enums/SceneType.mjs';
import { SpendStage } from '../store/enums/SpendStage.mjs';
import { ScribeAnalyzer } from './ScribeAnalyzer.mjs';
import { ScribeCategory } from './ScribeCategory.mjs';
import { ScribeIntakeAdapter } from './ScribeIntakeAdapter.mjs';

export class MuseService {
  static SuggestPrompt = Object.freeze([
    'You help a storyteller keep an ongoing adult fiction roleplay moving. You do not continue the story yourself.',
    'You receive the SCENE as it stands, one open THREAD the story left hanging, and the RECENT MESSAGES.',
    'Write one narrator line, at most 40 words, that brings the THREAD back into this scene as a development the characters must react to: an arrival, a discovery, a message, a consequence. It must fit the scene and contradict nothing in the recent messages.',
    'Return the suggestion in your own words.',
  ]).join('\n');

  #store;
  #client;
  #scribeService;
  #modelProvider;

  /**
   * @param {{store: object, client?: object | null, scribeService: object, modelProvider?: ((context: {stage: string, campaignId: string}) => string | Promise<string>) | null}} options
   * @throws {TypeError}
   */
  constructor({ store, client = null, scribeService, modelProvider = null } = {}) {
    if (store === null || typeof store !== 'object') {
      throw new TypeError('store must be a valid StoryStore instance.');
    }
    if (client !== null && (typeof client !== 'object' || typeof client.complete !== 'function')) {
      throw new TypeError('client must be null or an OpenRouterClient with complete().');
    }
    if (scribeService === null || typeof scribeService !== 'object' || typeof scribeService.loadState !== 'function') {
      throw new TypeError('scribeService must be a valid ScribeService instance.');
    }
    if (modelProvider !== null && typeof modelProvider !== 'function') {
      throw new TypeError('modelProvider must be null or a function.');
    }
    this.#store = store;
    this.#client = client;
    this.#scribeService = scribeService;
    this.#modelProvider = modelProvider;
  }

  /**
   * @param {object} state
   * @param {{present: ReadonlyArray<{subject: string | null}>} | null} now
   * @param {readonly string[]} [exclude]
   * @returns {object | null}
   */
  static thread(state, now, exclude = []) {
    const open = state.threads.filter((threadEntry) => {
      return threadEntry.closed === null && !exclude.includes(threadEntry.id);
    });
    if (open.length === 0) {
      return null;
    }
    if (now === null) {
      return open[0];
    }
    const worlds = new Set();
    for (const subject of state.subjects) {
      if (subject.kind === ScribeCategory.SubjectKinds.World) {
        worlds.add(subject.id);
      }
    }
    const present = new Set();
    for (const person of now.present) {
      if (person.subject !== null && !worlds.has(person.subject)) {
        present.add(person.subject);
      }
    }
    const near = open.find((threadEntry) => {
      return ScribeAnalyzer.select(state, threadEntry.text, '', 0).some((id) => present.has(id));
    });
    return near === undefined ? open[0] : near;
  }

  /**
   * @param {{day: number, place: string, reach: string, present: ReadonlyArray<{label?: string, subject?: string | null}>, summary: string, modelResponse?: string} | null} now
   * @param {{text: string}} threadEntry
   * @param {readonly object[]} recent
   * @returns {string}
   */
  static suggestInput(now, threadEntry, recent) {
    let scene = '(unknown)';
    if (now !== null) {
      const labels = now.present.map((person) => {
        return ScribeIntakeAdapter.collapse(person.label ?? person.subject ?? 'Unknown');
      });
      scene = now.modelResponse ?? [
        `Day ${now.day}`,
        ScribeIntakeAdapter.collapse(now.place),
        now.reach.toLowerCase(),
        `present: ${labels.length === 0 ? 'nobody' : labels.join(', ')}`,
        ScribeIntakeAdapter.collapse(now.summary),
      ].join(' | ');
    }
    return [
      `SCENE:\n${scene}`,
      `THREAD:\n${threadEntry.text}`,
      `RECENT MESSAGES:\n${ScribeIntakeAdapter.transcript(recent.slice(-10))}`,
    ].join('\n\n');
  }

  /**
   * @param {unknown} text
   * @returns {string | null}
   */
  static line(text) {
    if (typeof text !== 'string') {
      return null;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (/^LINE:[ \t]*/i.test(trimmed)) {
      const remainder = trimmed.replace(/^LINE:[ \t]*/i, '').trim();
      return remainder.length === 0 ? null : remainder;
    }
    return trimmed;
  }

  /**
   * @param {{campaignId: string, excludeThreadIds?: ReadonlyArray<string>, signal?: AbortSignal | null}} options
   * @returns {Promise<Readonly<{threadId: string, threadTitle: string, text: string}> | null>}
   * @throws {Error}
   */
  async suggestDevelopment({ campaignId, excludeThreadIds = [], signal = null } = {}) {
    if (typeof campaignId !== 'string' || campaignId.trim().length === 0) {
      throw new RangeError('campaignId must be a non-empty string.');
    }
    if (!Array.isArray(excludeThreadIds)) {
      throw new TypeError('excludeThreadIds must be an array.');
    }
    if (signal !== null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
      throw new TypeError('signal must be null or an AbortSignal.');
    }

    const loaded = this.#scribeService.loadState(campaignId);
    const { state, messages } = loaded;
    const campaign = this.#store.getCampaign(campaignId);
    const allCharacters = this.#scribeService.listAllCharacters(campaignId);
    const charactersById = new Map(allCharacters.map((character) => [character.id, character]));
    const subjectLabels = ScribeAnalyzer.labels(state);

    let now = null;
    if (campaign !== null && campaign.sceneState !== null && typeof campaign.sceneState === 'object') {
      const sceneState = campaign.sceneState;
      const presentMembers = [];
      const seenMemberIds = new Set();
      for (const idList of [sceneState.presentIds, sceneState.remoteIds]) {
        if (!Array.isArray(idList)) {
          continue;
        }
        for (const charId of idList) {
          if (seenMemberIds.has(charId)) {
            continue;
          }
          seenMemberIds.add(charId);
          const character = charactersById.get(charId);
          if (character !== undefined) {
            presentMembers.push({
              subject: character.scribeSubjectId ?? null,
              label: character.name,
            });
          }
        }
      }
      const latestRecordedScene = state.scenes.at(-1) ?? null;
      const place = typeof sceneState.location === 'string' && sceneState.location.trim().length > 0
        ? sceneState.location.trim()
        : latestRecordedScene?.place ?? 'Current scene';
      const summary = latestRecordedScene?.summary ?? (campaign.premise || place);
      now = {
        day: Number.isInteger(sceneState.day) && sceneState.day >= 1 ? sceneState.day : 1,
        place,
        reach: sceneState.sceneType === SceneType.Private ? 'Private' : 'Public',
        present: presentMembers,
        summary,
      };
    } else if (state.scenes.length > 0) {
      const latestScene = state.scenes.at(-1);
      now = {
        day: latestScene.day,
        place: latestScene.place,
        reach: latestScene.reach,
        present: latestScene.present.map((attendee) => ({
          subject: attendee.subject,
          label: subjectLabels.get(attendee.subject) ?? attendee.subject,
        })),
        summary: latestScene.summary,
      };
    }

    const chosen = MuseService.thread(state, now, excludeThreadIds);
    if (chosen === null) {
      return null;
    }

    if (this.#client === null) {
      throw new Error('OpenRouterClient is required for MuseService.suggestDevelopment().');
    }
    const rawModel = this.#modelProvider !== null
      ? await this.#modelProvider({ stage: SpendStage.Muse, campaignId })
      : this.#store.getSettings().models.scribe;
    if (typeof rawModel !== 'string' || rawModel.trim().length === 0) {
      throw new Error('Muse model is not configured.');
    }
    const model = rawModel.trim();

    const completion = await this.#client.complete({
      model,
      messages: [
        { role: 'system', content: MuseService.SuggestPrompt },
        { role: 'user', content: MuseService.suggestInput(now, chosen, messages) },
      ],
      stage: SpendStage.Muse,
      campaignId,
      signal,
    });

    const parsedLine = MuseService.line(completion.text);
    if (parsedLine === null) {
      throw new Error('Muse returned an empty suggestion.');
    }
    const body = parsedLine.replace(/^narrator:\s*/i, '').trim();
    if (body.length === 0) {
      throw new Error('Muse returned an empty suggestion.');
    }

    return Object.freeze({
      threadId: chosen.id,
      threadTitle: chosen.text,
      text: `Narrator: ${body}`,
    });
  }
}
