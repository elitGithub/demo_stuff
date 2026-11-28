import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { CharacterBrain } from '../src/engine/CharacterBrain.mjs';
import { Director } from '../src/engine/Director.mjs';
import { EncounterRoller } from '../src/engine/EncounterRoller.mjs';
import { HistoryWindow } from '../src/engine/HistoryWindow.mjs';
import { NarrationParts } from '../src/engine/NarrationParts.mjs';
import { Narrator } from '../src/engine/Narrator.mjs';
import { ReplyStreamSplitter } from '../src/engine/ReplyStreamSplitter.mjs';
import { RequestBudget } from '../src/engine/RequestBudget.mjs';
import { StorySlice } from '../src/engine/StorySlice.mjs';
import { TagReader } from '../src/engine/TagReader.mjs';
import { TurnEngine } from '../src/engine/TurnEngine.mjs';
import { WitnessFilter } from '../src/engine/WitnessFilter.mjs';
import { OpenRouterClient } from '../src/openrouter/OpenRouterClient.mjs';
import { PedantService } from '../src/scribe/PedantService.mjs';
import { ScribeAnswer } from '../src/scribe/ScribeAnswer.mjs';
import { ScribeCategory } from '../src/scribe/ScribeCategory.mjs';
import { ScribeIntakeAdapter } from '../src/scribe/ScribeIntakeAdapter.mjs';
import { ScribeKnowledge } from '../src/scribe/ScribeKnowledge.mjs';
import { ScribeLogCore } from '../src/scribe/ScribeLogCore.mjs';
import { ScribeReplay } from '../src/scribe/ScribeReplay.mjs';
import { ScribeService } from '../src/scribe/ScribeService.mjs';
import { CharacterCard } from '../src/store/CharacterCard.mjs';
import { AvatarToken } from '../src/store/enums/AvatarToken.mjs';
import { CharacterTier } from '../src/store/enums/CharacterTier.mjs';
import { FindingKind } from '../src/store/enums/FindingKind.mjs';
import { SceneStyle } from '../src/store/enums/SceneStyle.mjs';
import { SceneType } from '../src/store/enums/SceneType.mjs';
import { SpeakerType } from '../src/store/enums/SpeakerType.mjs';
import { SpendStage } from '../src/store/enums/SpendStage.mjs';
import { TurnMode } from '../src/store/enums/TurnMode.mjs';
import { TurnRole } from '../src/store/enums/TurnRole.mjs';
import { SqliteStore } from '../src/store/SqliteStore.mjs';
import { createFakeModelCatalog } from './support/createFakeModelCatalog.mjs';

const CLIENT_STREAM_ENTRY = 'stream';
const CLIENT_ERROR_ENTRY = 'error';
const CLIENT_FINISH_LENGTH = 'length';
const DEFAULT_REPLY_RESERVE = 3000;
const PEDANT_FIXTURE_MODEL = 'openai/gpt-4.1-mini';
const PEDANT_TINY_INPUT_TOKENS = 50;
const PEDANT_OVERFLOW_PATTERN = /Pedant mandatory prompt exceeds/;

/**
 * @param {Record<string, number | null>} [contextLengths]
 * @returns {{contextLength: (modelId: string) => number | null}}
 */
function createContextCatalog(contextLengths = {}) {
  return {
    /**
     * @param {string} modelId
     * @returns {number | null}
     */
    contextLength(modelId) {
      return Object.hasOwn(contextLengths, modelId) ? contextLengths[modelId] : null;
    },
  };
}

/**
 * @param {string} narrationText
 * @param {{finishReason?: string, midStreamError?: string | null, usage?: object}} [options]
 * @returns {{type: string, text: string, finishReason?: string, midStreamError?: string | null, usage?: object}}
 */
function buildNarratorStreamEntry(narrationText, options = {}) {
  const narrationTag = Narrator.Settings.Tag.Narration;
  return {
    type: CLIENT_STREAM_ENTRY,
    text: `<${narrationTag}>${narrationText}</${narrationTag}>`,
    ...options,
  };
}

/**
 * @param {{thoughts?: string, reply: string, next?: string | null, finishReason?: string, midStreamError?: string | null, usage?: object}} options
 * @returns {{type: string, text: string, finishReason?: string, midStreamError?: string | null, usage?: object}}
 */
function buildBrainStreamEntry({ thoughts = '', reply, next = CharacterBrain.Settings.NextNone, ...extra }) {
  const tagSettings = CharacterBrain.Settings.Tag;
  const parts = [];
  if (thoughts.length > 0) {
    parts.push(`<${tagSettings.Thoughts}>${thoughts}</${tagSettings.Thoughts}>`);
  }
  parts.push(`<${tagSettings.Reply}>${reply}</${tagSettings.Reply}>`);
  if (next !== null) {
    parts.push(`<${tagSettings.Next}>${next}</${tagSettings.Next}>`);
  }
  return {
    type: CLIENT_STREAM_ENTRY,
    text: parts.join('\n'),
    ...extra,
  };
}

/**
 * @param {string} text
 * @param {{chunkSize?: number, finishReason?: string, usage?: object, midStreamError?: string | null}} [options]
 * @returns {ReadableStream<Uint8Array>}
 */
function buildSseStream(
  text,
  {
    chunkSize = 12,
    finishReason = 'stop',
    usage = { prompt_tokens: 90, completion_tokens: 40, cost: 0.0015 },
    midStreamError = null,
  } = {},
) {
  const encoder = new TextEncoder();
  const frames = [];
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    const slice = text.slice(offset, offset + chunkSize);
    frames.push(`data: ${JSON.stringify({ choices: [{ delta: { content: slice } }] })}\n\n`);
  }
  if (midStreamError !== null) {
    frames.push(`data: ${JSON.stringify({ error: { message: midStreamError } })}\n\n`);
  } else {
    frames.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }], usage })}\n\n`);
    frames.push('data: [DONE]\n\n');
  }

  return new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
}

/**
 * @param {Array<object | ((context: {payload: object, url: string, init: object, callIndex: number}) => Promise<Response> | Response)>} handlers
 * @param {{store?: SqliteStore | null}} [options]
 * @returns {{client: OpenRouterClient, calls: Array<{payload: object, signal: AbortSignal | undefined}>}}
 */
function createScriptedClient(handlers, { store = null } = {}) {
  const queue = [...handlers];
  const calls = [];
  const client = new OpenRouterClient({
    apiKeyProvider: () => 'sk-test-engine-fake-key',
    retryOptions: {
      delaysMs: [0],
      wait: async () => {},
    },
    onSpend: store === null ? null : (spendDto) => store.recordSpend(spendDto),
    fetchImpl: async (url, init) => {
      const payload = JSON.parse(init.body);
      const callIndex = calls.length;
      calls.push({ payload, signal: init.signal });
      const entry = queue.shift();
      if (entry === undefined) {
        throw new Error(`Unexpected OpenRouter call #${callIndex} with empty queue.`);
      }
      if (typeof entry === 'function') {
        return await entry({ payload, url, init, callIndex });
      }
      if (entry.type === 'stream') {
        return new Response(
          buildSseStream(entry.text, entry),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }
      if (entry.type === 'error') {
        return new Response(
          JSON.stringify({ error: { message: entry.message ?? 'Provider failure' } }),
          { status: entry.status ?? 400, headers: { 'content-type': 'application/json' } },
        );
      }
      const responseText = typeof entry.json === 'object' ? JSON.stringify(entry.json) : String(entry.text ?? '');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: responseText }, finish_reason: entry.finishReason ?? 'stop' }],
          usage: entry.usage ?? { prompt_tokens: 110, completion_tokens: 35, cost: 0.0011 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  return { client, calls };
}

/**
 * @param {{publicOdds?: number, privateOdds?: number, scribeInterval?: number, pedantEnabled?: boolean, models?: Partial<{director: string, composer: string, main: string, recurring: string, scribe: string}>}} [options]
 * @returns {{store: SqliteStore, campaign: object, frost: object, lize: object, viola: object, collette: object, mirra: object, kira: object, maya: object}}
 */
function createWorldFixture({
  publicOdds = 0,
  privateOdds = 0,
  scribeInterval = 10,
  pedantEnabled = true,
  models = {},
} = {}) {
  const store = new SqliteStore(':memory:');
  store.updateSettings({
    pedantEnabled,
    models: {
      director: 'openai/gpt-4.1-mini',
      composer: 'openai/gpt-4.1',
      main: 'openai/gpt-4.1',
      recurring: 'openai/gpt-4.1-mini',
      scribe: 'openai/gpt-4.1-mini',
      ...models,
    },
  });

  const campaign = store.createCampaign({
    title: 'Ashen Vale',
    premise: 'A low-fantasy borderlands caravan campaign.',
    styleNotes: 'Close third-person grounded prose.',
    encounterPublicOdds: publicOdds,
    encounterPrivateOdds: privateOdds,
    scribeInterval,
    sceneState: {
      sceneNumber: 1,
      day: 1,
      timeLabel: 'Evening',
      location: 'Oak Bedroom',
      sceneType: SceneType.Private,
      presentIds: [],
      remoteIds: [],
      offscreenNotes: {},
      activeWalkOns: [],
    },
  });

  const frost = store.createCharacter(campaign.id, {
    slug: 'frost',
    scribeSubjectId: 'S1',
    name: 'Frost',
    aliases: ['Scout Frost'],
    isPlayer: true,
    tier: CharacterTier.Main,
    card: { personalitySummary: 'Wary caravan scout.', speakingStyle: 'Terse and observant.' },
    avatarToken: AvatarToken.Slate,
  });
  const lize = store.createCharacter(campaign.id, {
    slug: 'lize',
    scribeSubjectId: 'S2',
    name: 'Lize',
    aliases: ['Lady Lize'],
    isPlayer: false,
    tier: CharacterTier.Main,
    card: { personalitySummary: 'Sharp-eyed quartermaster.', speakingStyle: 'Measured and wry.' },
    avatarToken: AvatarToken.Rose,
  });
  const viola = store.createCharacter(campaign.id, {
    slug: 'viola',
    scribeSubjectId: 'S3',
    name: 'Viola',
    aliases: [],
    isPlayer: false,
    tier: CharacterTier.Main,
    card: { personalitySummary: 'Apothecary keeping secret ledgers.', speakingStyle: 'Quiet and precise.' },
    avatarToken: AvatarToken.Plum,
  });
  const collette = store.createCharacter(campaign.id, {
    slug: 'collette',
    scribeSubjectId: 'S4',
    name: 'Collette',
    aliases: ['Cook Collette'],
    isPlayer: false,
    tier: CharacterTier.Recurring,
    card: { personalitySummary: 'Cheerful camp cook.', speakingStyle: 'Warm and blunt.' },
    avatarToken: AvatarToken.Amber,
  });
  const mirra = store.createCharacter(campaign.id, {
    slug: 'mirra',
    scribeSubjectId: 'S5',
    name: 'Mirra',
    aliases: [],
    isPlayer: false,
    tier: CharacterTier.Main,
    card: { personalitySummary: 'Cart driver.', speakingStyle: 'Steady.' },
    avatarToken: AvatarToken.Teal,
  });
  const kira = store.createCharacter(campaign.id, {
    slug: 'kira',
    scribeSubjectId: 'S6',
    name: 'Kira',
    aliases: [],
    isPlayer: false,
    tier: CharacterTier.Recurring,
    card: { personalitySummary: 'Outrider.', speakingStyle: 'Brisk.' },
    avatarToken: AvatarToken.Indigo,
  });
  const maya = store.createCharacter(campaign.id, {
    slug: 'maya',
    scribeSubjectId: 'S7',
    name: 'Maya',
    aliases: [],
    isPlayer: false,
    tier: CharacterTier.Recurring,
    card: { personalitySummary: 'Messenger.', speakingStyle: 'Urgent.' },
    avatarToken: AvatarToken.Coral,
  });

  const updatedCampaign = store.updateCampaign(campaign.id, {
    playerCharacterId: frost.id,
    sceneState: {
      sceneNumber: 1,
      day: 1,
      timeLabel: 'Evening',
      location: 'Oak Bedroom',
      sceneType: SceneType.Private,
      presentIds: [frost.id, lize.id],
      remoteIds: [],
      offscreenNotes: {
        viola: 'At the apothecary stall',
        collette: 'Tending soup in the tavern kitchen',
      },
      activeWalkOns: [],
    },
  });

  return { store, campaign: updatedCampaign, frost, lize, viola, collette, mirra, kira, maya };
}

/**
 * @param {{sceneChanged?: boolean, location?: string, day?: number, timeLabel?: string, sceneType?: string, userInputKind?: string, presentSlugs?: readonly string[] | null, remoteSlugs?: readonly string[] | null, offscreenNotes?: Record<string, string>, walkOnsEnter?: readonly string[], walkOnsLeave?: readonly string[], encounterAccepted?: boolean, encounterBrief?: string, pacing?: string, situation?: string, responders?: ReadonlyArray<{slug: string, beatGoal: string, length: string, reacting?: string}>, narratorDirective?: string, style?: string}} [options]
 * @returns {string}
 */
function buildTaggedDirectorPlan({
  sceneChanged = false,
  location = 'Oak Bedroom',
  day = 1,
  timeLabel = 'Evening',
  sceneType = SceneType.Private,
  userInputKind = Director.Settings.InputKind.PlayerInScene,
  presentSlugs = [],
  remoteSlugs = [],
  offscreenNotes = {},
  walkOnsEnter = [],
  walkOnsLeave = [],
  encounterAccepted = false,
  encounterBrief = Director.Settings.EmptyText,
  pacing = Director.Settings.Pacing.FocusedOne,
  situation = 'Scene in progress.',
  responders = [],
  narratorDirective = Director.Settings.EmptyText,
  style = SceneStyle.None,
} = {}) {
  const settings = Director.Settings;
  const changedFlag = sceneChanged ? settings.Bool.Yes : settings.Bool.No;
  const inputTagValue = userInputKind === settings.InputKind.NarratorDirection
    ? settings.InputKind.NarratorTag
    : settings.InputKind.PlayerTag;
  const acceptedFlag = encounterAccepted ? settings.Bool.Yes : settings.Bool.No;
  const lines = [
    `<scene changed="${changedFlag}">${location} | day ${day} | ${timeLabel} | ${sceneType}</scene>`,
    `<situation>${situation}</situation>`,
    `<input>${inputTagValue}</input>`,
  ];
  if (presentSlugs !== null) {
    lines.push(`<present>${presentSlugs.join(', ')}</present>`);
  }
  if (remoteSlugs !== null) {
    lines.push(`<remote>${remoteSlugs.join(', ')}</remote>`);
  }
  for (const [slug, note] of Object.entries(offscreenNotes)) {
    lines.push(`<offscreen to="${slug}">${note}</offscreen>`);
  }
  lines.push(`<walkons enter="${walkOnsEnter.join(', ')}" leave="${walkOnsLeave.join(', ')}"/>`);
  lines.push(`<encounter accepted="${acceptedFlag}">${encounterBrief}</encounter>`);
  lines.push(`<pacing>${pacing}</pacing>`);
  lines.push(`<narrator>${narratorDirective}</narrator>`);
  for (const responder of responders) {
    const reactingSlug = responder.reacting ?? settings.ReactingPlayer;
    lines.push(
      `<direction to="${responder.slug}" reacting="${reactingSlug}" length="${responder.length}">${responder.beatGoal}</direction>`,
    );
  }
  lines.push(`<style>${style}</style>`);
  return lines.join('\n');
}

describe('EncounterRoller', () => {
  it('guards zero odds without division by zero and distinguishes public vs private odds', () => {
    let rollCalled = false;
    const zeroPublic = EncounterRoller.rollEncounter({
      mode: TurnMode.Normal,
      sceneType: SceneType.Public,
      publicOdds: 0,
      privateOdds: 5,
      absentCast: ['viola'],
      random: () => {
        rollCalled = true;
        return 0;
      },
    });
    assert.equal(rollCalled, false);
    assert.deepEqual(zeroPublic, {
      triggered: false,
      forced: false,
      plausibilityRequired: false,
      targetKind: null,
      stance: null,
    });

    const zeroPrivate = EncounterRoller.rollEncounter({
      mode: TurnMode.Normal,
      sceneType: SceneType.Private,
      publicOdds: 5,
      privateOdds: 0,
      absentCast: ['viola'],
      random: () => {
        rollCalled = true;
        return 0;
      },
    });
    assert.equal(rollCalled, false);
    assert.equal(zeroPrivate.triggered, false);

    const publicHit = EncounterRoller.rollEncounter({
      mode: TurnMode.Normal,
      sceneType: SceneType.Public,
      publicOdds: 4,
      privateOdds: 100,
      absentCast: ['viola'],
      random: () => 0.2,
    });
    assert.deepEqual(publicHit, {
      triggered: true,
      forced: false,
      plausibilityRequired: true,
      targetKind: 'cast',
      stance: 'enemy',
    });

    const privateMiss = EncounterRoller.rollEncounter({
      mode: TurnMode.Normal,
      sceneType: SceneType.Private,
      publicOdds: 4,
      privateOdds: 100,
      absentCast: ['viola'],
      random: () => 0.2,
    });
    assert.equal(privateMiss.triggered, false);
  });

  it('never triggers in Narrator mode, forces hits in Encounter mode, falls back to stranger when absentCast is empty, and rejects invalid random values', () => {
    const narratorResult = EncounterRoller.rollEncounter({
      mode: TurnMode.Narrator,
      sceneType: SceneType.Public,
      publicOdds: 1,
      privateOdds: 1,
      absentCast: ['viola'],
      random: () => 0,
    });
    assert.deepEqual(narratorResult, {
      triggered: false,
      forced: false,
      plausibilityRequired: false,
      targetKind: null,
      stance: null,
    });

    const sequence = [0.05, 0.75];
    let seqIndex = 0;
    const encounterResult = EncounterRoller.rollEncounter({
      mode: TurnMode.Encounter,
      sceneType: SceneType.Private,
      publicOdds: 0,
      privateOdds: 0,
      absentCast: [],
      random: () => {
        const value = sequence[seqIndex];
        seqIndex += 1;
        return value;
      },
    });
    assert.deepEqual(encounterResult, {
      triggered: true,
      forced: true,
      plausibilityRequired: false,
      targetKind: 'stranger',
      stance: 'chatter',
    });

    for (const badValue of [-0.01, 1, Number.NaN, Number.POSITIVE_INFINITY, '0.2']) {
      assert.throws(() => {
        EncounterRoller.rollEncounter({
          mode: TurnMode.Encounter,
          sceneType: SceneType.Public,
          publicOdds: 8,
          privateOdds: 30,
          random: () => badValue,
        });
      }, RangeError);
    }
  });
});

describe('WitnessFilter', () => {
  it('filters strictly to witnessed beats, omits mindPacket/oocNudge/directorPlan, sorts ascending, and slices last maxTurns', () => {
    const rawTurns = [
      {
        id: 't3',
        seq: 3,
        role: TurnRole.Assistant,
        mode: TurnMode.Normal,
        sceneNumber: 2,
        oocNudge: 'PRIVATE_NUDGE',
        directorPlan: { secret: 'PLAN_HIDDEN' },
        beats: [
          {
            id: 'b3a',
            seq: 1,
            speakerType: SpeakerType.Character,
            characterId: 'c-lize',
            speakerName: 'Lize',
            text: 'Scene 2 Lize beat.',
            witnessIds: ['c-collette', 'c-lize'],
            mindPacket: { internalThought: 'SECRET_THOUGHT' },
          },
        ],
      },
      {
        id: 't1',
        seq: 1,
        role: TurnRole.User,
        mode: TurnMode.Normal,
        sceneNumber: 1,
        oocNudge: 'SECRET_USER_NUDGE',
        beats: [
          {
            id: 'b1a',
            seq: 1,
            speakerType: SpeakerType.Player,
            characterId: 'c-frost',
            speakerName: 'Frost',
            text: 'First witnessed beat.',
            witnessIds: ['c-collette', 'c-frost'],
            mindPacket: null,
          },
        ],
      },
      {
        id: 't2',
        seq: 2,
        role: TurnRole.Assistant,
        mode: TurnMode.Normal,
        sceneNumber: 1,
        beats: [
          {
            id: 'b2a',
            seq: 1,
            speakerType: SpeakerType.Character,
            characterId: 'c-viola',
            speakerName: 'Viola',
            text: 'Private pre-arrival bedroom secret.',
            witnessIds: ['c-frost', 'c-viola'],
            mindPacket: { internalThought: 'NEVER_SEEN' },
          },
          {
            id: 'b2b',
            seq: 2,
            speakerType: SpeakerType.Character,
            characterId: 'c-collette',
            speakerName: 'Collette',
            text: 'Collette walks into the hall.',
            witnessIds: ['c-collette', 'c-frost'],
            mindPacket: { internalThought: 'HIDDEN_SELF_THOUGHT' },
          },
        ],
      },
    ];

    const originalOrder = rawTurns.map((turn) => turn.id);
    const filtered = WitnessFilter.selectWitnessedBeats({
      turns: rawTurns,
      characterId: 'c-collette',
      maxTurns: 2,
    });

    assert.deepEqual(rawTurns.map((turn) => turn.id), originalOrder);
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].turnId, 't2');
    assert.equal(filtered[1].turnId, 't3');
    assert.equal(filtered[0].beats.length, 1);
    assert.equal(filtered[0].beats[0].text, 'Collette walks into the hall.');
    assert.equal(Object.hasOwn(filtered[0], 'directorPlan'), false);
    assert.equal(Object.hasOwn(filtered[0], 'oocNudge'), false);
    assert.equal(Object.hasOwn(filtered[0].beats[0], 'mindPacket'), false);
    assert.equal(JSON.stringify(filtered).includes('SECRET_THOUGHT'), false);
    assert.equal(JSON.stringify(filtered).includes('Private pre-arrival'), false);
    assert.equal(JSON.stringify(filtered).includes('HIDDEN_SELF_THOUGHT'), false);
  });
});

describe('Director tagged invariants and full-miss fallback', () => {
  it('enforces disjoint slugs, player/absent responder exclusion, walk-on resets, offscreen rules, single call, and no targetChars', async () => {
    const fixture = createWorldFixture();
    const { store, campaign, frost, lize, viola, collette } = fixture;
    const preState = {
      ...campaign.sceneState,
      activeWalkOns: ['Innkeeper Bram', 'Guard'],
    };

    const taggedReply = [
      '<scene changed="yes">  Market Square  | day 0 |   | invalid_type</scene>',
      '<situation>  Dawn crowds gather around the spice carts.  </situation>',
      '<input>player</input>',
      '<present>FROST, lize, unknown_ghost, lize</present>',
      '<remote>lize, collette</remote>',
      '<offscreen to="__proto__">polluted</offscreen>',
      '<offscreen to="constructor">polluted</offscreen>',
      '<offscreen to="frost">Should be cleared because frost is present</offscreen>',
      '<offscreen to="viola">  Sorting dried herbs  </offscreen>',
      '<offscreen to="collette"></offscreen>',
      '<offscreen to="unknown_slug">Should be dropped</offscreen>',
      '<walkons enter="Guard, guard, Peddler" leave="Guard"/>',
      '<walkons enter=\'SingleQuotedIgnored\'/>',
      '<encounter accepted="yes">A wild wolf appears</encounter>',
      '<pacing>group_banter</pacing>',
      '<direction to="frost" length="short">Never player</direction>',
      '<direction to="viola" length="long">Absent char cannot respond</direction>',
      '<direction to="lize" reacting="collette" length="short">Check prices</direction>',
      '<direction to="lize" length="long">Duplicate dropped</direction>',
      '<direction to="collette" reacting="ghost" length="weird">Call over the stall</direction>',
      '<narrator>  Keep banter brisk.  </narrator>',
      '<style>Banter</style>',
    ].join('\n');

    const { client, calls } = createScriptedClient([{ text: taggedReply }], { store });

    const result = await Director.planTurn({
      campaign,
      characters: [frost, lize, viola, collette],
      preState,
      recentTurns: [],
      userText: 'We head downstairs to the market.',
      mode: TurnMode.Normal,
      encounterRoll: {
        triggered: false,
        forced: false,
        plausibilityRequired: false,
        targetKind: null,
        stance: null,
      },
      model: 'openai/gpt-4.1-mini',
      client,
    });

    assert.equal(calls.length, 1);
    assert.equal(result.spendIds.length, 1);
    assert.equal(result.plan.directorMissed, false);
    assert.equal(result.nextState.sceneNumber, 2);
    assert.equal(result.nextState.day, 1);
    assert.equal(result.nextState.timeLabel, 'Evening');
    assert.equal(result.nextState.location, 'Market Square');
    assert.equal(result.nextState.sceneType, SceneType.Private);
    assert.equal(result.plan.situation, 'Dawn crowds gather around the spice carts.');
    assert.equal(result.plan.narratorDirective, 'Keep banter brisk.');
    assert.equal(result.plan.style, SceneStyle.Banter);
    assert.deepEqual(result.nextState.presentIds, [frost.id, lize.id]);
    assert.deepEqual(result.nextState.remoteIds, [collette.id]);
    assert.deepEqual(result.nextState.activeWalkOns, ['Peddler']);
    assert.deepEqual(result.nextState.offscreenNotes, { viola: 'Sorting dried herbs' });
    assert.equal(Object.hasOwn(result.nextState.offscreenNotes, 'frost'), false);
    assert.equal(Object.hasOwn(result.nextState.offscreenNotes, 'collette'), false);
    assert.equal(Object.hasOwn(result.nextState.offscreenNotes, '__proto__'), false);
    assert.equal(result.plan.encounterAccepted, false);
    assert.equal(result.plan.encounterBrief, '');
    assert.equal(Object.hasOwn(result.plan, 'targetChars'), false);
    assert.equal('targetChars' in result.plan, false);
    assert.equal(result.plan.responders.length, 2);
    assert.deepEqual(result.plan.responders[0], {
      characterId: lize.id,
      slug: 'lize',
      name: 'Lize',
      beatGoal: 'Check prices',
      length: Director.Settings.Length.Short,
      reacting: 'collette',
    });
    assert.deepEqual(result.plan.responders[1], {
      characterId: collette.id,
      slug: 'collette',
      name: 'Collette',
      beatGoal: 'Call over the stall',
      length: Director.Settings.Length.Medium,
      reacting: Director.Settings.ReactingPlayer,
    });
  });

  it('falls back cleanly on full miss without a repair call and preserves preState and preState.style', async () => {
    const fixture = createWorldFixture();
    const { store, campaign, frost, lize, viola } = fixture;
    const preState = {
      ...campaign.sceneState,
      presentIds: [frost.id, lize.id, viola.id],
      offscreenNotes: { collette: 'In the kitchen' },
      activeWalkOns: ['Gate Guard'],
      style: SceneStyle.Tension,
    };

    for (const missText of [
      'Just some prose without any tags.',
      '<unknown>not a recognised tag</unknown>',
      '<scene changed="yes">unclosed scene tag',
      '',
    ]) {
      const { client, calls } = createScriptedClient([{ text: missText }], { store });
      const missResult = await Director.planTurn({
        campaign,
        characters: [frost, lize, viola],
        preState,
        userText: 'Hello',
        mode: TurnMode.Normal,
        encounterRoll: {
          triggered: false,
          forced: false,
          plausibilityRequired: false,
          targetKind: null,
          stance: null,
        },
        model: 'openai/gpt-4.1-mini',
        client,
      });

      assert.equal(calls.length, 1);
      assert.equal(missResult.plan.directorMissed, true);
      assert.equal(missResult.plan.sceneChanged, false);
      assert.equal(missResult.nextState.sceneNumber, preState.sceneNumber);
      assert.equal(missResult.nextState.location, preState.location);
      assert.deepEqual(missResult.nextState.presentIds, preState.presentIds);
      assert.deepEqual(missResult.nextState.remoteIds, preState.remoteIds);
      assert.deepEqual(missResult.nextState.offscreenNotes, { collette: 'In the kitchen' });
      assert.deepEqual(missResult.nextState.activeWalkOns, ['Gate Guard']);
      assert.equal(missResult.plan.style, SceneStyle.Tension);
      assert.equal(missResult.plan.situation, '');
      assert.equal(missResult.plan.narratorDirective, '');
      assert.equal(missResult.plan.pacing, Director.Settings.Pacing.FocusedOne);
      assert.deepEqual(missResult.plan.responders, [
        {
          characterId: lize.id,
          slug: 'lize',
          name: 'Lize',
          beatGoal: '',
          length: Director.Settings.Length.Medium,
          reacting: Director.Settings.ReactingPlayer,
        },
        {
          characterId: viola.id,
          slug: 'viola',
          name: 'Viola',
          beatGoal: '',
          length: Director.Settings.Length.Medium,
          reacting: Director.Settings.ReactingPlayer,
        },
      ]);
    }
  });
});

describe('TurnEngine end-to-end regressions and adversarial invariants', () => {
  it('keeps Viola absent on mention ("I need to get vegetables to Viola") and never invokes Viola Brain', async () => {
    const fixture = createWorldFixture();
    const { store, campaign, frost, lize, viola } = fixture;
    const scribeService = new ScribeService({ store });

    const { client, calls } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          offscreenNotes: { viola: 'At the apothecary stall' },
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [{ slug: 'lize', beatGoal: 'Offer to check the pantry', length: Director.Settings.Length.Short }],
          narratorDirective: 'Keep Viola offscreen.',
        }),
      },
      buildNarratorStreamEntry('A cellar draft cools the floorboards.'),
      buildBrainStreamEntry({
        thoughts: 'Frost is thinking of Viola again.',
        reply: '*Lize ties her apron strings.*\n"There are turnips in the cellar crate if you hurry."',
      }),
    ], { store });

    const engine = new TurnEngine({ store, client, scribeService, modelCatalog: createContextCatalog() });
    const result = await engine.runTurn({
      campaignId: campaign.id,
      text: 'I need to get vegetables to Viola.',
      mode: TurnMode.Normal,
    });

    assert.equal(calls.length, 3);
    assert.deepEqual(result.sceneState.presentIds, [frost.id, lize.id]);
    assert.equal(result.sceneState.presentIds.includes(viola.id), false);
    assert.equal(result.assistantTurn.beats.some((beat) => beat.characterId === viola.id), false);
    assert.equal(calls[2].payload.messages[0].content.includes('Lize'), true);
    assert.equal(calls[2].payload.messages[0].content.includes('Viola'), false);
  });

  it('isolates absent Collette from private bedroom scene facts and sibling thoughts', async () => {
    const fixture = createWorldFixture({ scribeInterval: 1, pedantEnabled: false });
    const { store, campaign } = fixture;

    const { client, calls } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          offscreenNotes: { collette: 'In the tavern kitchen' },
          pacing: Director.Settings.Pacing.IntimateDeep,
          responders: [{ slug: 'lize', beatGoal: 'Confess the cipher location', length: Director.Settings.Length.Medium }],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      buildBrainStreamEntry({
        thoughts: 'SECRET_LIZE_THOUGHT_999',
        reply: '*Lize leans close to the hearth.*\n"I hid the silver cipher key inside the ash drawer."',
      }),
      {
        text: [
          '=== FACTS',
          'Lize | belonging | keeps the silver cipher key hidden in the ash drawer | #2',
        ].join('\n'),
      },
      {
        text: buildTaggedDirectorPlan({
          sceneChanged: true,
          location: 'Tavern Kitchen',
          timeLabel: 'Late Evening',
          sceneType: SceneType.Public,
          userInputKind: Director.Settings.InputKind.NarratorDirection,
          presentSlugs: ['collette'],
          offscreenNotes: { frost: 'Upstairs in Oak Bedroom', lize: 'Upstairs in Oak Bedroom' },
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [{ slug: 'collette', beatGoal: 'Taste the stew', length: Director.Settings.Length.Short }],
          narratorDirective: 'Show Collette alone.',
        }),
      },
      buildNarratorStreamEntry('Steam rises over the cast-iron kettle.'),
      buildBrainStreamEntry({
        thoughts: 'Needs more salt.',
        reply: '*Collette stirs the kettle.*\n"Almost ready for supper."',
      }),
    ], { store });

    const scribeService = new ScribeService({ store, client });
    const engine = new TurnEngine({ store, client, scribeService, modelCatalog: createContextCatalog() });

    await engine.runTurn({
      campaignId: campaign.id,
      text: 'Where did you hide the cipher key, Lize?',
      mode: TurnMode.Normal,
    });

    await engine.runTurn({
      campaignId: campaign.id,
      text: 'Narrator: Meanwhile downstairs in the tavern kitchen, Collette tends the stew.',
      mode: TurnMode.Normal,
    });

    const colletteBrainCall = calls[5];
    const collettePrompt = JSON.stringify(colletteBrainCall.payload.messages);
    assert.equal(collettePrompt.includes('Collette'), true);
    assert.equal(collettePrompt.includes('SECRET_LIZE_THOUGHT_999'), false);
    assert.equal(collettePrompt.includes('ash drawer'), false);
    assert.equal(collettePrompt.includes('cipher key'), false);
    assert.equal(collettePrompt.includes('Where did you hide'), false);
  });

  it('handles cut-away scene without misattributing Narrator beat to Frost and enforces absent-player invariant when player acts in-scene', async () => {
    const fixture = createWorldFixture({ pedantEnabled: false });
    const { store, campaign, frost, mirra, kira, maya } = fixture;
    const scribeService = new ScribeService({ store });

    const { client } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          sceneChanged: true,
          location: 'Party Wagon',
          timeLabel: 'Night',
          sceneType: SceneType.Public,
          userInputKind: Director.Settings.InputKind.NarratorDirection,
          presentSlugs: ['mirra', 'kira', 'maya'],
          offscreenNotes: { frost: 'doing his rounds' },
          pacing: Director.Settings.Pacing.NarratorOnly,
          narratorDirective: 'Set the wagon scene without Frost.',
        }),
      },
      buildNarratorStreamEntry('Maya raps sharply on the wagon door while Mirra and Kira trade glances.'),
      {
        text: buildTaggedDirectorPlan({
          location: 'Party Wagon',
          timeLabel: 'Night',
          sceneType: SceneType.Public,
          presentSlugs: ['mirra', 'kira', 'maya'],
          offscreenNotes: { frost: 'doing his rounds' },
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [{ slug: 'mirra', beatGoal: 'Greet Frost', length: Director.Settings.Length.Short }],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      buildBrainStreamEntry({
        thoughts: 'Back already.',
        reply: '*Mirra unlatches the shutter.*\n"Quiet rounds tonight, Frost?"',
      }),
      {
        text: buildTaggedDirectorPlan({
          sceneChanged: true,
          location: 'Watchtower Gate',
          timeLabel: 'Midnight',
          sceneType: SceneType.Public,
          presentSlugs: ['mirra'],
          remoteSlugs: ['kira'],
          offscreenNotes: { frost: 'At the gatehouse' },
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [{ slug: 'mirra', beatGoal: 'Should be dropped', length: Director.Settings.Length.Short }],
          narratorDirective: 'Cut back.',
        }),
      },
      buildNarratorStreamEntry('Frost stands alone beneath the watchtower lantern.'),
    ], { store });

    const engine = new TurnEngine({ store, client, scribeService, modelCatalog: createContextCatalog() });

    const cutAwayResult = await engine.runTurn({
      campaignId: campaign.id,
      text: '*Two hours later, Frost is doing his rounds, Mirra and Kira are in the party wagon. Maya knocks*',
      mode: TurnMode.Normal,
    });
    assert.equal(cutAwayResult.sceneState.presentIds.includes(frost.id), false);
    assert.deepEqual(cutAwayResult.sceneState.presentIds, [mirra.id, kira.id, maya.id]);
    assert.equal(cutAwayResult.userTurn.beats[0].speakerType, SpeakerType.Narrator);
    assert.equal(cutAwayResult.userTurn.beats[0].characterId, null);
    assert.equal(cutAwayResult.userTurn.witnessIds.includes(frost.id), false);
    assert.equal(cutAwayResult.assistantTurn.witnessIds.includes(frost.id), false);

    const playerRejoinResult = await engine.runTurn({
      campaignId: campaign.id,
      text: 'I step up to the wagon door and knock.',
      mode: TurnMode.Normal,
    });
    assert.equal(playerRejoinResult.sceneState.presentIds.includes(frost.id), true);
    assert.equal(Object.hasOwn(playerRejoinResult.sceneState.offscreenNotes, 'frost'), false);
    assert.equal(playerRejoinResult.userTurn.beats[0].speakerType, SpeakerType.Player);
    assert.equal(playerRejoinResult.userTurn.witnessIds.includes(frost.id), true);

    store.updateCampaign(campaign.id, {
      sceneState: {
        ...playerRejoinResult.sceneState,
        presentIds: [mirra.id],
        remoteIds: [],
        offscreenNotes: { frost: 'At the gatehouse' },
      },
    });
    const cutBackResult = await engine.runTurn({
      campaignId: campaign.id,
      text: 'I check the gatehouse logbook.',
      mode: TurnMode.Normal,
    });
    assert.deepEqual(cutBackResult.sceneState.presentIds, [frost.id]);
    assert.deepEqual(cutBackResult.sceneState.remoteIds, []);
    assert.deepEqual(cutBackResult.plan.responders, []);
  });

  it('isolates mid-turn encounter arrival from private pre-arrival user dialogue and witnessIds', async () => {
    const fixture = createWorldFixture({ publicOdds: 1, privateOdds: 1, pedantEnabled: false });
    const { store, campaign, frost, lize, collette } = fixture;
    store.updateCampaign(campaign.id, {
      sceneState: {
        ...campaign.sceneState,
        sceneType: SceneType.Public,
      },
    });
    const scribeService = new ScribeService({ store });

    const { client, calls } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          sceneType: SceneType.Public,
          presentSlugs: ['frost', 'lize', 'collette'],
          encounterAccepted: true,
          encounterBrief: 'Collette knocks and steps inside carrying fresh bread.',
          pacing: Director.Settings.Pacing.GroupBanter,
          responders: [
            { slug: 'lize', beatGoal: 'Respond to Frost', length: Director.Settings.Length.Short },
            { slug: 'collette', beatGoal: 'Offer the bread upon entering', length: Director.Settings.Length.Short },
          ],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      buildNarratorStreamEntry('Collette knocks and steps inside carrying fresh bread.'),
      buildBrainStreamEntry({
        thoughts: 'Keep Ember secret.',
        reply: '*Lize whispers quickly.*\n"Got it."',
      }),
      buildBrainStreamEntry({
        thoughts: 'Smells warm in here.',
        reply: '*Collette holds out the loaf.*\n"Brought fresh bread for you two."',
      }),
    ], { store });

    const engine = new TurnEngine({
      store,
      client,
      scribeService,
      random: () => 0.1,
      modelCatalog: createContextCatalog(),
    });

    const result = await engine.runTurn({
      campaignId: campaign.id,
      text: 'Lize, the secret passphrase is Ember.',
      mode: TurnMode.Normal,
    });

    const lizeBrainPrompt = JSON.stringify(calls[2].payload.messages);
    const colletteBrainPrompt = JSON.stringify(calls[3].payload.messages);
    assert.equal(lizeBrainPrompt.includes('Ember'), true);
    assert.equal(colletteBrainPrompt.includes('Collette knocks and steps inside carrying fresh bread.'), true);
    assert.equal(colletteBrainPrompt.includes('Ember'), false);

    assert.equal(result.userTurn.witnessIds.includes(collette.id), false);
    assert.deepEqual(result.userTurn.witnessIds.sort(), [frost.id, lize.id].sort());
    assert.equal(result.assistantTurn.beats.length, 3);
    for (const beat of result.assistantTurn.beats) {
      assert.equal(beat.witnessIds.includes(collette.id), true);
    }
  });

  it('continues on first brain failure with warning, fails with zero DB mutations on zero boxes, and keeps spend_log unlinked', async () => {
    const fixture = createWorldFixture({ pedantEnabled: false });
    const { store, campaign, frost, lize, collette } = fixture;
    store.updateCampaign(campaign.id, {
      sceneState: {
        ...campaign.sceneState,
        presentIds: [frost.id, lize.id, collette.id],
        offscreenNotes: {},
      },
    });
    const scribeService = new ScribeService({ store });

    const { client: partialFailClient } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize', 'collette'],
          pacing: Director.Settings.Pacing.GroupBanter,
          responders: [
            { slug: 'lize', beatGoal: 'Fail quickly', length: Director.Settings.Length.Short },
            { slug: 'collette', beatGoal: 'Pick up the slack', length: Director.Settings.Length.Short },
          ],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      { type: CLIENT_ERROR_ENTRY, status: 401, message: 'Bad key' },
      buildBrainStreamEntry({
        thoughts: 'My turn then.',
        reply: '*Collette steps forward.*\n"Everyone still awake?"',
      }),
    ], { store });

    const partialEvents = [];
    const partialEngine = new TurnEngine({
      store,
      client: partialFailClient,
      scribeService,
      modelCatalog: createContextCatalog(),
    });
    const partialResult = await partialEngine.runTurn({
      campaignId: campaign.id,
      text: 'Everyone ready?',
      emit: (eventItem) => {
        partialEvents.push(eventItem);
      },
    });
    const partialWarnings = partialEvents.filter((item) => item.event === TurnEngine.Settings.Event.Warning);
    assert.equal(partialWarnings.length, 1);
    assert.equal(partialWarnings[0].data.stage, SpendStage.Mind);
    assert.equal(partialWarnings[0].data.message.includes('Lize'), true);
    assert.equal(partialResult.assistantTurn.beats.length, 1);
    assert.equal(partialResult.assistantTurn.beats[0].speakerName, 'Collette');
    assert.equal(store.listTurns(campaign.id).total, 2);

    partialEngine.deleteLastTurnPair({ campaignId: campaign.id });
    const utcDay = new Date().toISOString().slice(0, 10);
    const callsBeforeZero = store.getDailySpend(utcDay).callCount;

    const { client: streamFailClient } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          location: 'Tavern',
          sceneType: SceneType.Public,
          presentSlugs: ['frost', 'lize'],
          pacing: Director.Settings.Pacing.NarratorOnly,
          narratorDirective: 'Stream fails mid-flight.',
        }),
      },
      {
        type: CLIENT_STREAM_ENTRY,
        text: buildNarratorStreamEntry('Partial line before crash').text,
        midStreamError: 'Upstream dropped',
      },
    ], { store });

    const zeroEvents = [];
    const engineTwo = new TurnEngine({
      store,
      client: streamFailClient,
      scribeService,
      modelCatalog: createContextCatalog(),
    });
    await assert.rejects(
      () => engineTwo.runTurn({
        campaignId: campaign.id,
        text: 'Let us go.',
        emit: (eventItem) => {
          zeroEvents.push(eventItem);
        },
      }),
      /zero non-empty boxes/,
    );
    assert.equal(zeroEvents.some((item) => item.event === TurnEngine.Settings.Event.Warning), true);
    assert.equal(store.listTurns(campaign.id).total, 0);
    assert.equal(store.getCampaign(campaign.id).sceneState.location, 'Oak Bedroom');
    assert.equal(store.getDailySpend(utcDay).callCount, callsBeforeZero + 1);
  });

  it('rejects overlapping campaign mutations with ConflictError (409) and always releases mutex in finally', async () => {
    const fixture = createWorldFixture({ pedantEnabled: false });
    const { store, campaign } = fixture;
    const scribeService = new ScribeService({ store });

    let releaseDirector = null;
    const directorGate = new Promise((resolve) => {
      releaseDirector = resolve;
    });

    const { client } = createScriptedClient([
      async () => {
        await directorGate;
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: buildTaggedDirectorPlan({
                  presentSlugs: ['frost', 'lize'],
                  pacing: Director.Settings.Pacing.NarratorOnly,
                  narratorDirective: 'Done.',
                }),
              },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 50, completion_tokens: 30, cost: 0.001 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
      buildNarratorStreamEntry('Quiet settles.'),
    ], { store });

    const engine = new TurnEngine({ store, client, scribeService, modelCatalog: createContextCatalog() });
    const firstTurnPromise = engine.runTurn({ campaignId: campaign.id, text: 'Wait here.' });

    await assert.rejects(
      () => engine.runTurn({ campaignId: campaign.id, text: 'Overlapping call.' }),
      (error) => error.name === TurnEngine.Settings.ConflictName && error.statusCode === 409,
    );
    assert.throws(
      () => engine.deleteLastTurnPair({ campaignId: campaign.id }),
      (error) => error.name === TurnEngine.Settings.ConflictName && error.statusCode === 409,
    );

    releaseDirector();
    await firstTurnPromise;

    const deleted = engine.deleteLastTurnPair({ campaignId: campaign.id });
    assert.deepEqual(deleted.deletedSeqs, [1, 2]);
  });

  it('withdraws discarded Scribe facts before Brain calls during regenerateLastTurn and preserves prior pair on regenerate failure', async () => {
    const fixture = createWorldFixture({ scribeInterval: 1, pedantEnabled: false });
    const { store, campaign } = fixture;

    const { client, calls } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [{ slug: 'lize', beatGoal: 'Answer', length: Director.Settings.Length.Short }],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      buildBrainStreamEntry({
        thoughts: 'First attempt.',
        reply: '"My brother went to Redwall."',
      }),
      {
        text: '=== FACTS\nLize | trait | DISCARDED_SECRET_FACT_42 | #2',
      },
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [{ slug: 'lize', beatGoal: 'Answer differently', length: Director.Settings.Length.Short }],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      {
        type: CLIENT_STREAM_ENTRY,
        text: buildBrainStreamEntry({ thoughts: 'Fresh take.', reply: 'Partial fail' }).text,
        midStreamError: 'Dropped mid regen',
      },
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [{ slug: 'lize', beatGoal: 'Answer differently', length: Director.Settings.Length.Short }],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      buildBrainStreamEntry({
        thoughts: 'Clean state.',
        reply: '"He took the northern road."',
      }),
      {
        text: '=== FACTS\nLize | trait | CLEAN_REGEN_FACT_88 | #2',
      },
    ], { store });

    const scribeService = new ScribeService({ store, client });
    const engine = new TurnEngine({ store, client, scribeService, modelCatalog: createContextCatalog() });

    const initialTurn = await engine.runTurn({
      campaignId: campaign.id,
      text: 'Where is your brother?',
      mode: TurnMode.Normal,
    });
    assert.equal(store.listTurns(campaign.id).total, 2);

    await assert.rejects(
      () => engine.regenerateLastTurn({ campaignId: campaign.id }),
      /zero non-empty boxes/,
    );
    const afterFailedRegen = store.getLatestTurnPair(campaign.id);
    assert.equal(afterFailedRegen.assistantTurn.id, initialTurn.assistantTurn.id);
    assert.equal(afterFailedRegen.assistantTurn.beats[0].text, '"My brother went to Redwall."');

    const regenResult = await engine.regenerateLastTurn({ campaignId: campaign.id });
    assert.equal(regenResult.assistantTurn.beats[0].text, '"He took the northern road."');

    const secondRegenBrainPrompt = JSON.stringify(calls[6].payload.messages);
    assert.equal(secondRegenBrainPrompt.includes('DISCARDED_SECRET_FACT_42'), false);
    assert.equal(secondRegenBrainPrompt.includes('Redwall'), false);

    const finalState = scribeService.loadState(campaign.id).state;
    const activeTexts = finalState.facts
      .filter((fact) => fact.status === 'InForce')
      .map((fact) => fact.text);
    assert.equal(activeTexts.includes('DISCARDED_SECRET_FACT_42'), false);
    assert.equal(activeTexts.includes('CLEAN_REGEN_FACT_88'), true);
  });

  it('handles deleteLastTurnPair rollback, editTurn dirty marking, sceneChanged prior-scene-only Scribe trigger, and Step 4 warning isolation', async () => {
    const fixture = createWorldFixture({ scribeInterval: 10, pedantEnabled: true });
    const { store, campaign } = fixture;

    const { client, calls } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          pacing: Director.Settings.Pacing.NarratorOnly,
          narratorDirective: 'Scene 1 turn.',
        }),
      },
      buildNarratorStreamEntry('Scene 1 candle flickers.'),
      {
        text: buildTaggedDirectorPlan({
          sceneChanged: true,
          location: 'Courtyard',
          timeLabel: 'Night',
          sceneType: SceneType.Public,
          presentSlugs: ['frost', 'lize'],
          walkOnsEnter: ['Night Watchman'],
          pacing: Director.Settings.Pacing.NarratorOnly,
          narratorDirective: 'Scene 2 courtyard.',
        }),
      },
      buildNarratorStreamEntry('Scene 2 cold mist drifts across the courtyard.'),
      {
        text: '=== FACTS\nFrost | condition | Scene 1 candle noted | #2',
      },
    ], { store });

    const scribeService = new ScribeService({ store, client });
    const pedantService = new PedantService({ store, client, scribeService });
    const engine = new TurnEngine({
      store,
      client,
      scribeService,
      pedantService,
      modelCatalog: createContextCatalog(),
    });

    await engine.runTurn({ campaignId: campaign.id, text: 'Frost lights the candle.' });
    await engine.runTurn({ campaignId: campaign.id, text: 'We step out into the courtyard.' });

    const scribePrompt = JSON.stringify(calls[4].payload.messages);
    assert.equal(scribePrompt.includes('Scene 1 candle flickers'), true);
    assert.equal(scribePrompt.includes('Scene 2 cold mist'), false);
    assert.equal(store.countTurnsSinceScribe(campaign.id), 1);

    const turnsList = store.listTurns(campaign.id).items;
    const sceneOneAssistantTurn = turnsList.find((turn) => turn.seq === 2);
    const edited = engine.editTurn({
      campaignId: campaign.id,
      turnId: sceneOneAssistantTurn.id,
      text: 'Scene 1 lantern glows brightly.',
    });
    assert.equal(edited.beats[0].text, 'Scene 1 lantern glows brightly.');
    assert.equal(store.getScribeBook(campaign.id).dirty, true);

    const deletedPair = engine.deleteLastTurnPair({ campaignId: campaign.id });
    assert.equal(deletedPair.restoredSceneState.location, 'Oak Bedroom');
    assert.equal(deletedPair.restoredSceneState.sceneNumber, 1);

    const failingStep4Engine = new TurnEngine({
      store,
      client: createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            presentSlugs: ['frost', 'lize'],
            pacing: Director.Settings.Pacing.NarratorOnly,
            narratorDirective: 'Check Step 4 resilience.',
          }),
        },
        buildNarratorStreamEntry('Committed despite Step 4 error.'),
      ], { store }).client,
      scribeService: {
        loadState: () => scribeService.loadState(campaign.id),
        updateMemory: async () => {
          throw new Error('Scribe offline');
        },
      },
      pedantService: {
        checkTurn: async () => {
          throw new Error('Pedant offline');
        },
      },
      modelCatalog: createContextCatalog(),
    });

    const events = [];
    const committedTurn = await failingStep4Engine.runTurn({
      campaignId: campaign.id,
      text: 'Narrator: *The wind rattles the shutter.*',
      emit: (eventItem) => {
        events.push(eventItem);
      },
    });
    assert.equal(committedTurn.userTurn.mode, TurnMode.Narrator);
    assert.equal(committedTurn.userTurn.rawText, '*The wind rattles the shutter.*');
    assert.equal(events.some((item) => item.event === TurnEngine.Settings.Event.Committed), true);
    const warnings = events.filter((item) => item.event === TurnEngine.Settings.Event.Warning);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].data.stage, SpendStage.Pedant);

    await assert.rejects(
      () => engine.runTurn({ campaignId: campaign.id, text: '   ', mode: TurnMode.Normal }),
      RangeError,
    );
    await assert.rejects(
      () => engine.runTurn({ campaignId: campaign.id, text: 'Narrator:   ', mode: TurnMode.Normal }),
      RangeError,
    );
  });

  it('commits the turn and warns on [pedant] when the Pedant mandatory prompt overflows the context, without calling the model', async () => {
    const fixture = createWorldFixture({ scribeInterval: 10, pedantEnabled: true });
    const { store, campaign, frost, lize } = fixture;
    try {
      const log = ScribeLogCore.create();
      let state = ScribeReplay.run(log, []);
      for (const participant of [frost, lize]) {
        ScribeLogCore.syncCharacterSubject(log, state, {
          subjectId: participant.scribeSubjectId,
          name: participant.name,
          aliases: participant.aliases,
        });
        state = ScribeReplay.run(log, []);
      }
      store.saveScribeBook(campaign.id, { bookJson: JSON.stringify(log), lastTurnSeq: 0, dirty: false });

      const { client, calls } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            presentSlugs: ['frost', 'lize'],
            pacing: Director.Settings.Pacing.NarratorOnly,
            narratorDirective: 'Pedant overflow check.',
          }),
        },
        buildNarratorStreamEntry('Committed despite the Pedant overflow.'),
      ], { store });

      const scribeService = new ScribeService({ store, client });
      const pedantService = new PedantService({
        store,
        client,
        scribeService,
        modelCatalog: createContextCatalog({ [PEDANT_FIXTURE_MODEL]: DEFAULT_REPLY_RESERVE + PEDANT_TINY_INPUT_TOKENS }),
      });
      const engine = new TurnEngine({
        store,
        client,
        scribeService,
        pedantService,
        modelCatalog: createContextCatalog(),
      });

      const events = [];
      const committedTurn = await engine.runTurn({
        campaignId: campaign.id,
        text: 'Narrator: *The wind rattles the shutter.*',
        emit: (eventItem) => {
          events.push(eventItem);
        },
      });

      assert.equal(store.listTurns(campaign.id).total, 2);
      assert.equal(committedTurn.userTurn.mode, TurnMode.Narrator);
      assert.equal(events.some((item) => item.event === TurnEngine.Settings.Event.Committed), true);
      assert.equal(calls.length, 2);
      const warnings = events.filter((item) => item.event === TurnEngine.Settings.Event.Warning);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].data.stage, SpendStage.Pedant);
      assert.match(warnings[0].data.message, PEDANT_OVERFLOW_PATTERN);
    } finally {
      store.close();
    }
  });

  it('covers Director Encounter override, parent abort cleanup during brain stream, multi-beat editTurn, and deleteLastTurnPair Scribe withdrawal', async () => {
    const fixture = createWorldFixture({ scribeInterval: 1, pedantEnabled: false });
    const { store, campaign, frost, lize } = fixture;

    const { client: encDirClient } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          encounterAccepted: false,
          pacing: Director.Settings.Pacing.NarratorOnly,
          responders: [{ slug: 'lize', beatGoal: 'Should be cleared', length: Director.Settings.Length.Short }],
          narratorDirective: 'Check overrides.',
        }),
      },
    ], { store });
    const forcedEncPlan = await Director.planTurn({
      campaign,
      characters: [frost, lize],
      preState: campaign.sceneState,
      userText: TurnEngine.Settings.EncounterFallbackText,
      mode: TurnMode.Encounter,
      encounterRoll: {
        triggered: true,
        forced: true,
        plausibilityRequired: false,
        targetKind: 'stranger',
        stance: 'enemy',
      },
      model: 'openai/gpt-4.1-mini',
      client: encDirClient,
    });
    assert.equal(forcedEncPlan.plan.encounterAccepted, true);
    assert.ok(forcedEncPlan.plan.encounterBrief.length > 0);
    assert.deepEqual(forcedEncPlan.plan.responders, []);

    const parentController = new AbortController();
    const { client: abortBrainClient } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [{ slug: 'lize', beatGoal: 'Wait for abort', length: Director.Settings.Length.Short }],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      ({ init }) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const abortErr = new Error('Aborted');
          abortErr.name = TurnEngine.Settings.AbortName;
          reject(abortErr);
        }, { once: true });
        parentController.abort('user_cancelled');
      }),
    ], { store });
    const abortEngine = new TurnEngine({
      store,
      client: abortBrainClient,
      scribeService: new ScribeService({ store }),
      modelCatalog: createContextCatalog(),
    });
    await assert.rejects(
      () => abortEngine.runTurn({
        campaignId: campaign.id,
        text: 'Wait.',
        signal: parentController.signal,
      }),
      (error) => error.name === TurnEngine.Settings.AbortName,
    );

    const { client: fullCycleClient } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize', 'collette'],
          encounterAccepted: true,
          encounterBrief: 'Collette arrives at the bedroom door.',
          pacing: Director.Settings.Pacing.GroupBanter,
          responders: [
            { slug: 'lize', beatGoal: 'Answer', length: Director.Settings.Length.Short },
            { slug: 'collette', beatGoal: 'Speak', length: Director.Settings.Length.Short },
          ],
          narratorDirective: 'Narrator introduces encounter first.',
        }),
      },
      buildNarratorStreamEntry('A knock breaks the silence.'),
      buildBrainStreamEntry({ thoughts: 'Fine.', reply: 'Come in.' }),
      buildBrainStreamEntry({ thoughts: 'Phew.', reply: 'Dinner is hot.' }),
      {
        text: '=== FACTS\nCollette | trait | TEMP_BOOK_FACT_TO_WITHDRAW | #2',
      },
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize', 'collette'],
          encounterAccepted: true,
          encounterBrief: 'Collette arrives at the bedroom door.',
          pacing: Director.Settings.Pacing.GroupBanter,
          responders: [
            { slug: 'lize', beatGoal: 'Answer', length: Director.Settings.Length.Short },
            { slug: 'collette', beatGoal: 'Speak', length: Director.Settings.Length.Short },
          ],
          narratorDirective: 'Narrator introduces encounter first.',
        }),
      },
      buildNarratorStreamEntry('A knock breaks the silence.'),
      buildBrainStreamEntry({ thoughts: 'Fine.', reply: 'Come in.' }),
      buildBrainStreamEntry({ thoughts: 'Phew.', reply: 'Dinner is hot.' }),
      {
        text: '=== FACTS\nCollette | trait | EDIT_TURN_FACT_TO_WITHDRAW | #2',
      },
    ], { store });
    const scribeForCycle = new ScribeService({ store, client: fullCycleClient });
    const cycleEngine = new TurnEngine({
      store,
      client: fullCycleClient,
      scribeService: scribeForCycle,
      modelCatalog: createContextCatalog(),
    });

    const firstMultiBeatTurn = await cycleEngine.runTurn({
      campaignId: campaign.id,
      text: 'Hold on, Lize.',
      mode: TurnMode.Encounter,
    });
    assert.equal(firstMultiBeatTurn.userTurn.witnessIds.includes(fixture.collette.id), false);
    assert.equal(firstMultiBeatTurn.assistantTurn.beats[0].witnessIds.includes(fixture.collette.id), true);
    assert.equal(firstMultiBeatTurn.assistantTurn.beats[1].witnessIds.includes(fixture.collette.id), true);
    assert.equal(firstMultiBeatTurn.assistantTurn.beats[2].witnessIds.includes(fixture.collette.id), true);

    cycleEngine.deleteLastTurnPair({ campaignId: campaign.id });
    const afterDeleteState = scribeForCycle.loadState(campaign.id);
    assert.equal(afterDeleteState.lastTurnSeq, 0);
    assert.equal(
      afterDeleteState.state.facts.some((fact) => fact.text === 'TEMP_BOOK_FACT_TO_WITHDRAW' && fact.status === 'InForce'),
      false,
    );

    const secondMultiBeatTurn = await cycleEngine.runTurn({
      campaignId: campaign.id,
      text: 'Hold on, Lize.',
      mode: TurnMode.Encounter,
    });
    assert.throws(
      () => cycleEngine.editTurn({
        campaignId: campaign.id,
        turnId: secondMultiBeatTurn.assistantTurn.id,
        text: 'Missing beatId',
      }),
      RangeError,
    );
    const editedSpecificBeat = cycleEngine.editTurn({
      campaignId: campaign.id,
      turnId: secondMultiBeatTurn.assistantTurn.id,
      beatId: secondMultiBeatTurn.assistantTurn.beats[1].id,
      text: 'Please come in.',
    });
    assert.equal(editedSpecificBeat.beats[1].text, 'Please come in.');
    assert.equal(store.getScribeBook(campaign.id).dirty, true);
    const afterEditState = scribeForCycle.loadState(campaign.id);
    assert.equal(
      afterEditState.state.facts.some((fact) => fact.text === 'EDIT_TURN_FACT_TO_WITHDRAW' && fact.status === 'InForce'),
      false,
    );
  });

  it('validates constructor modelCatalog, checks models before OpenRouter, and handles Encounter blank text fallback', async () => {
    const noDirectorFixture = createWorldFixture({ models: { director: '' } });
    const { client: unusedClient, calls: unusedCalls } = createScriptedClient([], { store: noDirectorFixture.store });
    assert.throws(
      () => new TurnEngine({
        store: noDirectorFixture.store,
        client: unusedClient,
        scribeService: new ScribeService({ store: noDirectorFixture.store }),
        modelCatalog: null,
      }),
      TypeError,
    );
    assert.throws(
      () => new TurnEngine({
        store: noDirectorFixture.store,
        client: unusedClient,
        scribeService: new ScribeService({ store: noDirectorFixture.store }),
        modelCatalog: {},
      }),
      TypeError,
    );

    const noDirectorEngine = new TurnEngine({
      store: noDirectorFixture.store,
      client: unusedClient,
      scribeService: new ScribeService({ store: noDirectorFixture.store }),
      modelCatalog: createContextCatalog(),
    });
    await assert.rejects(
      () => noDirectorEngine.runTurn({ campaignId: noDirectorFixture.campaign.id, text: 'Hello' }),
      /Director model/,
    );
    assert.equal(unusedCalls.length, 0);

    const noMainFixture = createWorldFixture({ models: { main: '' } });
    const { client: step2FailClient, calls: step2Calls } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          encounterAccepted: true,
          encounterBrief: 'A stray hound wanders past.',
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [{ slug: 'lize', beatGoal: 'React', length: Director.Settings.Length.Short }],
          narratorDirective: 'Check model before Step 2.',
        }),
      },
    ], { store: noMainFixture.store });
    const noMainEngine = new TurnEngine({
      store: noMainFixture.store,
      client: step2FailClient,
      scribeService: new ScribeService({ store: noMainFixture.store }),
      random: () => 0.5,
      modelCatalog: createContextCatalog(),
    });
    await assert.rejects(
      () => noMainEngine.runTurn({
        campaignId: noMainFixture.campaign.id,
        text: '   ',
        mode: TurnMode.Encounter,
      }),
      /Model is not configured for Lize/,
    );
    assert.equal(step2Calls.length, 1);
    assert.equal(step2Calls[0].payload.messages[1].content.includes(TurnEngine.Settings.EncounterFallbackText), true);
    assert.equal(noMainFixture.store.listTurns(noMainFixture.campaign.id).total, 0);
  });

  it('rolls back regenerateLastTurn, deleteLastTurnPair, and editTurn atomically when a compound write fails', async () => {
    const fixture = createWorldFixture({ scribeInterval: 1, pedantEnabled: false });
    const { store, campaign } = fixture;
    const { client } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          pacing: Director.Settings.Pacing.NarratorOnly,
          narratorDirective: 'Turn 1.',
        }),
      },
      buildNarratorStreamEntry('Original candle glow.'),
      { text: '=== FACTS\nLize | condition | holding brass key | #2' },
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          pacing: Director.Settings.Pacing.NarratorOnly,
          narratorDirective: 'Regenerate.',
        }),
      },
      buildNarratorStreamEntry('Regenerated reply.'),
    ], { store });

    const scribeService = new ScribeService({ store, client });
    const engine = new TurnEngine({ store, client, scribeService, modelCatalog: createContextCatalog() });
    const initial = await engine.runTurn({ campaignId: campaign.id, text: 'Look at the candle.' });
    store.insertFindings(campaign.id, initial.assistantTurn.id, [
      { kind: FindingKind.Contradiction, summary: 'Key check' },
    ]);
    const bookBeforeFail = store.getScribeBook(campaign.id);

    const originalCommitAssistantTurn = store.commitAssistantTurn.bind(store);
    store.commitAssistantTurn = () => {
      throw new Error('Simulated commitAssistantTurn crash');
    };
    await assert.rejects(
      () => engine.regenerateLastTurn({ campaignId: campaign.id }),
      /Simulated commitAssistantTurn crash/,
    );
    store.commitAssistantTurn = originalCommitAssistantTurn;

    const latestAfterRegenFail = store.getLatestTurnPair(campaign.id);
    assert.equal(latestAfterRegenFail.assistantTurn.id, initial.assistantTurn.id);
    assert.equal(latestAfterRegenFail.assistantTurn.beats[0].text, 'Original candle glow.');
    assert.equal(store.listFindings(campaign.id).total, 1);
    assert.equal(store.getScribeBook(campaign.id).bookJson, bookBeforeFail.bookJson);
    assert.equal(store.getScribeBook(campaign.id).lastTurnSeq, 2);

    const originalSaveScribeBook = store.saveScribeBook.bind(store);
    store.saveScribeBook = () => {
      throw new Error('Simulated book write crash');
    };
    assert.throws(
      () => engine.deleteLastTurnPair({ campaignId: campaign.id }),
      /Simulated book write crash/,
    );
    assert.equal(store.listTurns(campaign.id).total, 2);
    assert.equal(store.getLatestTurnPair(campaign.id).assistantTurn.id, initial.assistantTurn.id);

    assert.throws(
      () => engine.editTurn({
        campaignId: campaign.id,
        turnId: initial.assistantTurn.id,
        text: 'Should rollback',
      }),
      /Simulated book write crash/,
    );
    store.saveScribeBook = originalSaveScribeBook;
    assert.equal(store.getTurn(campaign.id, initial.assistantTurn.id).beats[0].text, 'Original candle glow.');
    assert.equal(store.getScribeBook(campaign.id).dirty, false);
  });

  it('re-synthesizes surviving private scenes on withdrawSources during regenerateLastTurn and deleteLastTurnPair', async () => {
    const fixture = createWorldFixture({ scribeInterval: 1, pedantEnabled: false });
    const { store, campaign, lize, collette } = fixture;

    const { client, calls } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          offscreenNotes: { collette: 'In kitchen' },
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [{ slug: 'lize', beatGoal: 'Hide cipher', length: Director.Settings.Length.Short }],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      buildBrainStreamEntry({ thoughts: 'Safe here.', reply: 'The cipher sits under the loose oak plank.' }),
      { text: '=== FACTS\nLize | belonging | PRIVATE_CIPHER_IN_FLOOR | #2' },
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          offscreenNotes: { collette: 'In kitchen' },
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [{ slug: 'lize', beatGoal: 'React', length: Director.Settings.Length.Short }],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      buildBrainStreamEntry({ thoughts: 'Wait.', reply: 'Someone is outside.' }),
      { text: '=== FACTS\nLize | condition | DISCARDED_TURN2_FACT | #4' },
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize'],
          offscreenNotes: { collette: 'In kitchen' },
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [{ slug: 'lize', beatGoal: 'React again', length: Director.Settings.Length.Short }],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      buildBrainStreamEntry({ thoughts: 'Still safe.', reply: 'All quiet in the hall.' }),
      { text: '=== FACTS\nLize | condition | REGENERATED_TURN2_FACT | #4' },
    ], { store });

    const scribeService = new ScribeService({ store, client });
    const engine = new TurnEngine({ store, client, scribeService, modelCatalog: createContextCatalog() });

    await engine.runTurn({ campaignId: campaign.id, text: 'Where is the cipher?' });
    await engine.runTurn({ campaignId: campaign.id, text: 'Did you hear footsteps?' });

    await engine.regenerateLastTurn({ campaignId: campaign.id });

    const regenBrainCall = calls[7];
    const regenBrainPrompt = JSON.stringify(regenBrainCall.payload.messages);
    assert.equal(regenBrainPrompt.includes('PRIVATE_CIPHER_IN_FLOOR'), true);
    assert.equal(regenBrainPrompt.includes('DISCARDED_TURN2_FACT'), false);

    engine.deleteLastTurnPair({ campaignId: campaign.id });
    const afterDelete = scribeService.loadState(campaign.id);
    assert.equal(afterDelete.lastTurnSeq, 2);
    const recoveredScene = ScribeKnowledge.sceneAt(afterDelete.state, 2);
    assert.notEqual(recoveredScene, null);
    assert.equal(recoveredScene.reach, 'Private');
    const survivingFact = afterDelete.state.facts.find(
      (fact) => fact.text === 'PRIVATE_CIPHER_IN_FLOOR' && fact.status === 'InForce',
    );
    assert.notEqual(survivingFact, undefined);
    assert.equal(ScribeKnowledge.knows(afterDelete.state, lize.scribeSubjectId, survivingFact), true);
    assert.equal(ScribeKnowledge.knows(afterDelete.state, collette.scribeSubjectId, survivingFact), false);
  });

  it('enforces Case A and Case B mid-turn arrival witnessIds and this_turn isolation', async () => {
    const fixture = createWorldFixture({ publicOdds: 1, privateOdds: 1, pedantEnabled: false });
    const { store, campaign, frost, lize, collette, mirra, maya } = fixture;
    store.updateCampaign(campaign.id, {
      sceneState: {
        ...campaign.sceneState,
        sceneType: SceneType.Public,
      },
    });
    const scribeService = new ScribeService({ store });

    const { client, calls } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          sceneType: SceneType.Public,
          presentSlugs: ['frost', 'lize', 'collette'],
          encounterAccepted: true,
          encounterBrief: 'Collette walks up to the door.',
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [
            { slug: 'lize', beatGoal: 'Hide Ember', length: Director.Settings.Length.Short },
            { slug: 'collette', beatGoal: 'Step in', length: Director.Settings.Length.Short },
          ],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      buildNarratorStreamEntry('Collette shuts the door behind her.'),
      buildBrainStreamEntry({ thoughts: 'Close.', reply: 'Got it, Ember is safe.' }),
      buildBrainStreamEntry({ thoughts: 'Cold outside.', reply: 'Evening, you two.' }),
      {
        text: buildTaggedDirectorPlan({
          sceneType: SceneType.Public,
          presentSlugs: ['frost', 'lize'],
          offscreenNotes: { collette: 'Downstairs' },
          pacing: Director.Settings.Pacing.FocusedOne,
          responders: [{ slug: 'lize', beatGoal: 'Whisper', length: Director.Settings.Length.Short }],
          narratorDirective: 'Rain taps the glass.',
        }),
      },
      buildNarratorStreamEntry('Rain taps the glass.'),
      buildBrainStreamEntry({ thoughts: 'Safe.', reply: 'Still secret.' }),
      {
        text: buildTaggedDirectorPlan({
          location: 'Party Wagon',
          timeLabel: 'Night',
          sceneType: SceneType.Public,
          presentSlugs: ['mirra', 'frost', 'maya'],
          encounterAccepted: true,
          encounterBrief: 'Maya dashes up to the wagon.',
          pacing: Director.Settings.Pacing.GroupBanter,
          responders: [
            { slug: 'mirra', beatGoal: 'Welcome Frost', length: Director.Settings.Length.Short },
            { slug: 'maya', beatGoal: 'Deliver message', length: Director.Settings.Length.Short },
          ],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      buildNarratorStreamEntry('Maya dashes up to the wagon door.'),
      buildBrainStreamEntry({ thoughts: 'Glad Frost is here.', reply: 'Glad you are back, Frost.' }),
      buildBrainStreamEntry({ thoughts: 'Out of breath.', reply: 'Message!' }),
    ], { store });

    const engine = new TurnEngine({
      store,
      client,
      scribeService,
      random: () => 0.1,
      modelCatalog: createContextCatalog(),
    });

    const caseA1 = await engine.runTurn({
      campaignId: campaign.id,
      text: 'Keep Ember secret.',
      mode: TurnMode.Normal,
    });
    assert.equal(caseA1.userTurn.witnessIds.includes(collette.id), false);
    assert.equal(calls[3].payload.messages[1].content.includes('Keep Ember secret.'), false);
    assert.equal(calls[3].payload.messages[1].content.includes('Collette shuts the door behind her.'), true);
    for (const beat of caseA1.assistantTurn.beats) {
      assert.equal(beat.witnessIds.includes(collette.id), true);
    }

    store.updateCampaign(campaign.id, {
      sceneState: {
        ...caseA1.sceneState,
        presentIds: [frost.id, lize.id],
        offscreenNotes: { collette: 'Downstairs' },
      },
    });
    const caseA2 = await engine.runTurn({
      campaignId: campaign.id,
      text: 'Still safe?',
      mode: TurnMode.Normal,
    });
    assert.equal(caseA2.assistantTurn.beats[0].witnessIds.includes(collette.id), false);
    assert.equal(caseA2.assistantTurn.beats[1].witnessIds.includes(collette.id), false);

    store.updateCampaign(campaign.id, {
      sceneState: {
        sceneNumber: 2,
        day: 1,
        timeLabel: 'Night',
        location: 'Party Wagon',
        sceneType: SceneType.Public,
        presentIds: [mirra.id],
        remoteIds: [],
        offscreenNotes: { frost: 'Rounding the camp', maya: 'At the gate' },
        activeWalkOns: [],
        style: SceneStyle.None,
        pinnedStyle: null,
      },
    });
    const caseB = await engine.runTurn({
      campaignId: campaign.id,
      text: 'I climb back into the wagon.',
      mode: TurnMode.Normal,
    });
    assert.deepEqual(caseB.userTurn.witnessIds.sort(), [frost.id, mirra.id].sort());
    assert.equal(calls[9].payload.messages[1].content.includes('I climb back into the wagon.'), true);
    assert.equal(calls[10].payload.messages[1].content.includes('I climb back into the wagon.'), false);
    assert.equal(calls[10].payload.messages[1].content.includes('Maya dashes up to the wagon door.'), true);
    for (const beat of caseB.assistantTurn.beats) {
      assert.deepEqual(beat.witnessIds.sort(), [frost.id, maya.id, mirra.id].sort());
    }
  });

  it('parses Director boolean flags strictly and runs unlimited responders in ensemble turns', async () => {
    const fixture = createWorldFixture({ pedantEnabled: false });
    const { store, campaign, frost, lize, collette, viola, mirra } = fixture;
    store.updateCampaign(campaign.id, {
      sceneState: {
        ...campaign.sceneState,
        presentIds: [frost.id, lize.id, collette.id, viola.id, mirra.id],
        offscreenNotes: {},
      },
    });
    const scribeService = new ScribeService({ store });

    const { client } = createScriptedClient([
      {
        text: [
          '<scene changed="false">Oak Bedroom | day 1 | Evening | private</scene>',
          '<input>player</input>',
          '<present>frost, lize, collette, viola, mirra</present>',
          '<remote></remote>',
          '<walkons enter="" leave=""/>',
          '<encounter accepted="false">Should be ignored</encounter>',
          `<pacing>${Director.Settings.Pacing.GroupBanter}</pacing>`,
          '<narrator>All four respond.</narrator>',
          '<direction to="lize" length="short">Speak 1</direction>',
          '<direction to="collette" length="short">Speak 2</direction>',
          '<direction to="viola" length="short">Speak 3</direction>',
          '<direction to="mirra" length="short">Speak 4</direction>',
        ].join('\n'),
      },
    ], { store });

    const strictPlanResult = await Director.planTurn({
      campaign,
      characters: [frost, lize, collette, viola, mirra],
      preState: store.getCampaign(campaign.id).sceneState,
      userText: 'Everyone chime in.',
      mode: TurnMode.Normal,
      encounterRoll: {
        triggered: true,
        forced: false,
        plausibilityRequired: true,
        targetKind: 'stranger',
        stance: 'chatter',
      },
      model: 'openai/gpt-4.1-mini',
      client,
    });
    assert.equal(strictPlanResult.plan.sceneChanged, false);
    assert.equal(strictPlanResult.nextState.sceneNumber, 1);
    assert.equal(strictPlanResult.plan.encounterAccepted, false);
    assert.equal(strictPlanResult.plan.encounterBrief, '');
    assert.equal(strictPlanResult.plan.responders.length, 4);

    const { client: ensembleClient, calls: ensembleCalls } = createScriptedClient([
      {
        text: buildTaggedDirectorPlan({
          presentSlugs: ['frost', 'lize', 'collette', 'viola', 'mirra'],
          pacing: Director.Settings.Pacing.GroupBanter,
          responders: [
            { slug: 'lize', beatGoal: '1', length: Director.Settings.Length.Short },
            { slug: 'collette', beatGoal: '2', length: Director.Settings.Length.Short },
            { slug: 'viola', beatGoal: '3', length: Director.Settings.Length.Short },
            { slug: 'mirra', beatGoal: '4', length: Director.Settings.Length.Short },
          ],
          narratorDirective: Director.Settings.EmptyText,
        }),
      },
      buildBrainStreamEntry({ thoughts: 'T1', reply: 'Lize here.' }),
      buildBrainStreamEntry({ thoughts: 'T2', reply: 'Collette here.' }),
      buildBrainStreamEntry({ thoughts: 'T3', reply: 'Viola here.' }),
      buildBrainStreamEntry({ thoughts: 'T4', reply: 'Mirra here.' }),
    ], { store });

    const ensembleEngine = new TurnEngine({
      store,
      client: ensembleClient,
      scribeService,
      modelCatalog: createContextCatalog(),
    });
    const ensembleTurn = await ensembleEngine.runTurn({
      campaignId: campaign.id,
      text: 'All four of you, sound off.',
      mode: TurnMode.Normal,
    });
    assert.equal(ensembleCalls.length, 5);
    assert.equal(ensembleTurn.plan.responders.length, 4);
    assert.equal(ensembleTurn.assistantTurn.beats.length, 4);
  });
});

describe('Unknown card values reach requests as unknown', () => {
  const directorReply = buildTaggedDirectorPlan({
    presentSlugs: ['frost', 'lize'],
    pacing: Director.Settings.Pacing.FocusedOne,
  });

  /**
   * @param {object} fixture
   * @returns {object}
   * @throws {Error}
   */
  const unknownLize = ({ store, campaign, lize }) => {
    return store.updateCharacter(campaign.id, lize.id, {
      card: { personalitySummary: '...', speakingStyle: '-' },
    });
  };

  /**
   * @param {Array<{payload: {messages: Array<{content: string}>}}>} calls
   * @returns {string}
   */
  const requestText = (calls) => calls.flatMap((call) => call.payload.messages.map((message) => message.content)).join('\n');

  it('shows the Director roster summary as unknown', async () => {
    const fixture = createWorldFixture();
    const lize = unknownLize(fixture);
    assert.equal(lize.card.personalitySummary, '?');
    const { client, calls } = createScriptedClient([{ text: directorReply }], { store: fixture.store });

    await Director.planTurn({
      campaign: fixture.campaign,
      characters: [fixture.frost, lize],
      preState: fixture.campaign.sceneState,
      recentTurns: [],
      userText: 'Hello.',
      mode: TurnMode.Normal,
      encounterRoll: { triggered: false, forced: false, plausibilityRequired: false, targetKind: null, stance: null },
      model: 'openai/gpt-4.1-mini',
      client,
    });

    const text = requestText(calls);
    assert.match(text, /slug: lize .*summary: unknown/);
    assert.doesNotMatch(text, /summary: \?/);
  });

  /**
   * @param {{campaign: object, frost: object, lize: object}} fixture
   * @param {boolean} omniscient
   * @returns {string}
   * @throws {TypeError | RangeError | Error}
   */
  const buildUnknownStoryState = (fixture, omniscient) => {
    const log = ScribeLogCore.create();
    let state = ScribeReplay.run(log, []);
    for (const character of [fixture.frost, fixture.lize]) {
      ScribeLogCore.syncCharacterSubject(log, state, {
        subjectId: null,
        name: character.name,
        aliases: [],
      });
      state = ScribeReplay.run(log, []);
    }
    const lizeSubject = state.subjects.find((subject) => subject.name === fixture.lize.name);
    const frostSubject = state.subjects.find((subject) => subject.name === fixture.frost.name);
    for (const category of [ScribeCategory.Names.Age, ScribeCategory.Names.Hair]) {
      ScribeLogCore.rule(log, state, {
        type: ScribeLogCore.Ruling.AddFact,
        subject: lizeSubject.id,
        category,
        target: null,
        text: CharacterCard.Unknown,
        hidden: false,
        cite: null,
        position: 0,
        decided: true,
      });
      state = ScribeReplay.run(log, []);
    }
    const budget = RequestBudget.create({
      contextLength: null,
      replyReserve: DEFAULT_REPLY_RESERVE,
      charsPerToken: RequestBudget.StartingCharsPerToken,
    });
    const slice = StorySlice.build({
      state,
      viewer: omniscient
        ? { omniscient: true, subjectId: null }
        : { omniscient: false, subjectId: lizeSubject.id, characterId: fixture.lize.id },
      scene: {
        location: fixture.campaign.sceneState.location,
        day: fixture.campaign.sceneState.day,
        timeLabel: fixture.campaign.sceneState.timeLabel,
        sceneType: fixture.campaign.sceneState.sceneType,
        situation: 'Calm.',
      },
      presentSubjectIds: [frostSubject.id, lizeSubject.id],
      budget,
    });
    return slice.text;
  };

  it('shows the CharacterBrain identity and StorySlice facts as unknown', async () => {
    const fixture = createWorldFixture();
    const lize = unknownLize(fixture);
    const settings = fixture.store.getSettings();
    const storyState = buildUnknownStoryState({ ...fixture, lize }, false);
    const { client, calls } = createScriptedClient([
      buildBrainStreamEntry({ thoughts: 'Hm.', reply: '*Waits.* Well.' }),
    ], { store: fixture.store });

    await CharacterBrain.reply({
      campaign: fixture.campaign,
      character: lize,
      card: lize.card,
      playerName: fixture.frost.name,
      storyState,
      history: '',
      thisTurn: `${fixture.frost.name}: Hello.`,
      styleText: '',
      direction: {
        reacting: fixture.frost.name,
        length: Director.Settings.Length.Short,
        beatGoal: 'Respond.',
      },
      model: settings.models.main,
      replyReserve: DEFAULT_REPLY_RESERVE,
      client,
    });

    const text = requestText(calls);
    assert.match(text, new RegExp(`Personality: ${CharacterCard.UnknownLabel}`));
    assert.match(text, new RegExp(`Speaking style: ${CharacterCard.UnknownLabel}`));
    assert.match(text, new RegExp(`${ScribeCategory.Names.Age}:${CharacterCard.UnknownLabel}|${ScribeCategory.Names.Age}: ${CharacterCard.UnknownLabel}`));
    assert.match(text, new RegExp(`${ScribeCategory.Names.Hair}: ${CharacterCard.UnknownLabel}`));
    assert.doesNotMatch(text, /: \?(?=[\n|;]|$)/);
    fixture.store.close();
  });

  it('shows Narrator StorySlice facts as unknown', async () => {
    const fixture = createWorldFixture();
    const lize = unknownLize(fixture);
    const settings = fixture.store.getSettings();
    const storyState = buildUnknownStoryState({ ...fixture, lize }, true);
    const { client, calls } = createScriptedClient([
      buildNarratorStreamEntry('A cold gust.'),
    ], { store: fixture.store });

    await Narrator.narrate({
      campaign: fixture.campaign,
      storyState,
      history: '',
      thisTurn: `${fixture.frost.name}: Look.`,
      styleText: '',
      direction: 'Brief.',
      model: settings.models.composer,
      replyReserve: DEFAULT_REPLY_RESERVE,
      client,
    });

    const text = requestText(calls);
    assert.match(text, new RegExp(`${ScribeCategory.Names.Age}: ${CharacterCard.UnknownLabel}`));
    assert.match(text, new RegExp(`${ScribeCategory.Names.Hair}: ${CharacterCard.UnknownLabel}`));
    assert.doesNotMatch(text, /: \?(?=[\n|;]|$)/);
    fixture.store.close();
  });
});

describe('Player narration beat in the player turn', () => {
  const directorReply = buildTaggedDirectorPlan({
    presentSlugs: ['frost', 'lize'],
    pacing: Director.Settings.Pacing.FocusedOne,
    responders: [{ slug: 'lize', beatGoal: 'React', length: Director.Settings.Length.Short }],
    narratorDirective: 'Keep it close.',
  });

  /**
   * @param {{text: string, narration?: string | null, mode?: string, scribeText?: string | null, prepare?: ((fixture: object) => void) | null}} options
   * @returns {Promise<{fixture: object, result: object, calls: Array<object>, events: Array<{event: string, data: unknown}>}>}
   * @throws {TypeError | RangeError | Error}
   */
  const runTurn = async ({ text, narration = null, mode = TurnMode.Normal, scribeText = null, prepare = null }) => {
    const fixture = createWorldFixture({ scribeInterval: scribeText === null ? 10 : 1, pedantEnabled: false });
    if (prepare !== null) {
      prepare(fixture);
    }
    /** @type {Array<{type?: string, text: string}>} */
    const script = [
      { text: directorReply },
      buildNarratorStreamEntry('The rain settles against the glass.'),
      buildBrainStreamEntry({ thoughts: 'Thinking.', reply: '*Lize looks up.*\nHm.' }),
    ];
    if (scribeText !== null) {
      script.push({ text: scribeText });
    }
    const { client, calls } = createScriptedClient(script, { store: fixture.store });
    const engine = new TurnEngine({
      store: fixture.store,
      client,
      scribeService: new ScribeService({ store: fixture.store, client }),
      modelCatalog: createContextCatalog(),
    });
    const events = [];
    const result = await engine.runTurn({
      campaignId: fixture.campaign.id,
      text,
      mode,
      narration,
      emit: ({ event, data }) => {
        events.push({ event, data });
      },
    });
    return { fixture, result, calls, events };
  };

  /**
   * @param {object} result
   * @returns {Array<{speakerType: string, speakerName: string, text: string, seq: number}>}
   */
  const userBeats = (result) => {
    return result.userTurn.beats.map((beat) => ({
      speakerType: beat.speakerType,
      speakerName: beat.speakerName,
      text: beat.text,
      seq: beat.seq,
    }));
  };

  it('stores the narration field as a narrator beat after the player beat with the same witnesses', async () => {
    const { result } = await runTurn({ text: 'I look at her.', narration: 'Her hair is dyed black.' });

    assert.deepEqual(userBeats(result), [
      { speakerType: SpeakerType.Player, speakerName: 'Frost', text: 'I look at her.', seq: 1 },
      { speakerType: SpeakerType.Narrator, speakerName: 'Narrator', text: 'Her hair is dyed black.', seq: 2 },
    ]);
    assert.equal(result.userTurn.rawText, 'I look at her.');
    assert.deepEqual(result.userTurn.beats[1].witnessIds, result.userTurn.beats[0].witnessIds);
    assert.equal(result.userTurn.beats[1].mindPacket, null);
  });

  it('reads a typed narration tag as the narration part and keeps it out of the player beat', async () => {
    const { result } = await runTurn({ text: 'I look at her. <narration>Her hair is dyed black.</narration>' });

    assert.deepEqual(userBeats(result).map((beat) => [beat.speakerType, beat.text]), [
      [SpeakerType.Player, 'I look at her.'],
      [SpeakerType.Narrator, 'Her hair is dyed black.'],
    ]);
  });

  it('joins a typed tag and the narration field into one narration beat', async () => {
    const { result } = await runTurn({
      text: 'I look at her. <narration>Her hair is dyed black.</narration>',
      narration: 'Her eyes are green.',
    });

    assert.deepEqual(userBeats(result).map((beat) => [beat.speakerType, beat.text]), [
      [SpeakerType.Player, 'I look at her.'],
      [SpeakerType.Narrator, `Her hair is dyed black.${NarrationParts.Settings.Joiner}Her eyes are green.`],
    ]);
  });

  it('ignores an empty narration field and an empty tag', async () => {
    const { result } = await runTurn({ text: 'I look at her. <narration>  </narration>', narration: '   ' });

    assert.deepEqual(userBeats(result).map((beat) => beat.text), ['I look at her.']);
  });

  it('keeps Narrator mode and the Narrator prefix as one narrator beat', async () => {
    const prefixed = await runTurn({ text: '*Narrator: Rain falls.*', mode: TurnMode.Normal });
    assert.equal(prefixed.result.userTurn.mode, TurnMode.Narrator);
    assert.deepEqual(userBeats(prefixed.result).map((beat) => [beat.speakerType, beat.text]), [
      [SpeakerType.Narrator, 'Rain falls.*'],
    ]);

    const moded = await runTurn({ text: 'Rain falls.', mode: TurnMode.Narrator });
    assert.deepEqual(userBeats(moded.result).map((beat) => [beat.speakerType, beat.text]), [
      [SpeakerType.Narrator, 'Rain falls.'],
    ]);
  });

  it('turns narration typed with no player text into a Narrator turn', async () => {
    const { result } = await runTurn({ text: '', narration: 'Her hair is dyed black.' });

    assert.equal(result.userTurn.mode, TurnMode.Narrator);
    assert.deepEqual(userBeats(result).map((beat) => [beat.speakerType, beat.text]), [
      [SpeakerType.Narrator, 'Her hair is dyed black.'],
    ]);
  });

  /**
   * @param {object} fixture
   * @returns {{engine: TurnEngine, calls: Array<{payload: {messages: Array<{content: string}>}}>}}
   * @throws {TypeError | RangeError | Error}
   */
  const regenerationEngine = (fixture) => {
    const { client, calls } = createScriptedClient([
      { text: directorReply },
      buildNarratorStreamEntry('Steady firelight fills the room.'),
      buildBrainStreamEntry({ thoughts: 'Ready.', reply: '*Lize nods.*\nYes.' }),
    ], { store: fixture.store });
    const engine = new TurnEngine({
      store: fixture.store,
      client,
      scribeService: new ScribeService({ store: fixture.store }),
      modelCatalog: createContextCatalog(),
    });
    return { engine, calls };
  };

  /**
   * @param {Array<{payload: {messages: Array<{content: string}>}}>} calls
   * @param {string} directorUserText
   * @param {string} directorNarrationText
   * @param {string} expectedThisTurn
   * @returns {void}
   * @throws {Error}
   */
  const assertEveryModelGotThe = (calls, directorUserText, directorNarrationText, expectedThisTurn) => {
    assert.equal(calls.length, 3);
    const directorUserContent = calls[0].payload.messages[1].content;
    assert.equal(directorUserContent.includes(`userText: ${directorUserText}`), true);
    assert.equal(directorUserContent.includes(`narration: ${directorNarrationText}`), true);
    for (const downstreamCall of calls.slice(1)) {
      assert.equal(downstreamCall.payload.messages.map((message) => message.content).join('\n').includes(expectedThisTurn), true);
    }
  };

  it('keeps the player turn as edited, with the narration once, through every regenerate', async () => {
    const { fixture, result } = await runTurn({ text: 'I look at her.', narration: 'Her hair is dyed black.' });
    regenerationEngine(fixture).engine.editTurn({
      campaignId: fixture.campaign.id,
      turnId: result.userTurn.id,
      beatId: result.userTurn.beats[0].id,
      text: 'I look at her again.',
    });
    const expected = [
      [SpeakerType.Player, 'Frost', 'I look at her again.'],
      [SpeakerType.Narrator, 'Narrator', 'Her hair is dyed black.'],
    ];

    const savedPlayerTurn = fixture.store.getTurn(fixture.campaign.id, result.userTurn.id);
    assert.deepEqual(savedPlayerTurn.beats.map((beat) => [beat.speakerType, beat.speakerName, beat.text]), expected);
    let previousAssistantId = result.assistantTurn.id;
    for (let round = 0; round < 2; round += 1) {
      const { engine, calls } = regenerationEngine(fixture);
      const regenerated = await engine.regenerateLastTurn({ campaignId: fixture.campaign.id });

      assertEveryModelGotThe(
        calls,
        'I look at her again.',
        'Her hair is dyed black.',
        'Frost: I look at her again.\nNarrator: Her hair is dyed black.',
      );
      assert.deepEqual(fixture.store.getTurn(fixture.campaign.id, result.userTurn.id), savedPlayerTurn);
      assert.deepEqual(regenerated.userTurn, savedPlayerTurn);
      assert.notEqual(regenerated.assistantTurn.id, previousAssistantId);
      previousAssistantId = regenerated.assistantTurn.id;
      assert.equal(fixture.store.getTurn(fixture.campaign.id, result.assistantTurn.id), null);
      assert.equal(regenerated.assistantTurn.seq, result.userTurn.seq + 1);
      assert.equal(regenerated.assistantTurn.beats.some((beat) => beat.text.includes('Yes.')), true);
      assert.equal(fixture.store.listTurns(fixture.campaign.id, { limit: 50 }).total, 2);
    }
  });

  it('regenerates a Zeta-shaped player turn with several beats and speakers unchanged', async () => {
    const fixture = createWorldFixture({ scribeInterval: 10, pedantEnabled: false });
    const { store, campaign, frost, lize } = fixture;
    const witnessIds = [frost.id, lize.id];
    const sceneState = { ...campaign.sceneState, presentIds: witnessIds };
    const imported = store.importTurns(campaign.id, [
      {
        role: TurnRole.User,
        mode: TurnMode.Normal,
        rawText: 'She looks up.\n\nRain falls.\n\nShe waits.',
        sceneNumber: 1,
        witnessIds,
        sceneStateBefore: sceneState,
        sceneStateAfter: sceneState,
        beats: [
          { speakerType: SpeakerType.Player, characterId: frost.id, speakerName: 'Frost', text: 'She looks up.' },
          { speakerType: SpeakerType.Narrator, characterId: null, speakerName: 'Narrator', text: 'Rain falls.' },
          { speakerType: SpeakerType.Player, characterId: frost.id, speakerName: 'Frost', text: 'She waits.' },
        ],
      },
      {
        role: TurnRole.Assistant,
        mode: TurnMode.Normal,
        rawText: 'Hm.',
        sceneNumber: 1,
        witnessIds,
        sceneStateBefore: sceneState,
        sceneStateAfter: sceneState,
        beats: [{ speakerType: SpeakerType.Character, characterId: lize.id, speakerName: 'Lize', text: 'Hm.' }],
      },
    ]);
    const saved = /** @type {{beats: Array<object>}} */ (store.getTurn(campaign.id, imported[0].id));
    const { engine, calls } = regenerationEngine(fixture);
    const regenerated = await engine.regenerateLastTurn({ campaignId: campaign.id });

    assertEveryModelGotThe(
      calls,
      'She looks up.\n\nShe waits.',
      'Rain falls.',
      'Frost: She looks up.\nNarrator: Rain falls.\nFrost: She waits.',
    );
    assert.deepEqual(store.getTurn(campaign.id, imported[0].id), saved);
    assert.equal(saved.beats.length, 3);
    assert.equal(store.getTurn(campaign.id, imported[1].id), null);
    assert.equal(regenerated.assistantTurn.beats.some((beat) => beat.text.includes('Yes.')), true);
  });

  it('turns narration alone into one Narrator beat in Normal mode, Narrator mode and with a bare prefix', async () => {
    for (const [text, mode] of [
      ['', TurnMode.Normal],
      ['', TurnMode.Narrator],
      ['Narrator:', TurnMode.Normal],
      ['  Narrator:  ', TurnMode.Narrator],
    ]) {
      const { result } = await runTurn({ text, mode, narration: 'Her hair is dyed black.' });

      assert.equal(result.userTurn.mode, TurnMode.Narrator, `${mode} ${text}`);
      assert.deepEqual(userBeats(result).map((beat) => [beat.speakerType, beat.text]), [
        [SpeakerType.Narrator, 'Her hair is dyed black.'],
      ]);
    }
  });

  it('decides a fact the Scribe takes from the narration beat: black in force, card red Reported', async () => {
    const { fixture, events } = await runTurn({
      text: 'I look at her.',
      narration: "Lize's hair is dyed black.",
      scribeText: ['=== FACTS', 'Lize | hair | black, freshly dyed | #1'].join('\n'),
      prepare: ({ store, campaign, frost, lize, viola, collette, mirra, kira, maya }) => {
        const log = ScribeLogCore.create();
        let state = ScribeReplay.run(log, []);
        for (const character of [frost, lize, viola, collette, mirra, kira, maya]) {
          ScribeLogCore.syncCharacterSubject(log, state, {
            subjectId: character.scribeSubjectId,
            name: character.name,
            aliases: character.aliases,
          });
          state = ScribeReplay.run(log, []);
        }
        ScribeLogCore.rule(log, state, {
          type: ScribeLogCore.Ruling.AddFact,
          subject: lize.scribeSubjectId,
          category: ScribeCategory.Names.Hair,
          target: null,
          text: 'red',
          hidden: false,
          cite: null,
          position: 0,
          decided: true,
        });
        store.saveScribeBook(campaign.id, { bookJson: JSON.stringify(log), lastTurnSeq: 0, dirty: false });
      },
    });
    assert.deepEqual(events.filter((entry) => entry.event === TurnEngine.Settings.Event.Warning), []);
    const loaded = new ScribeService({ store: fixture.store }).loadState(fixture.campaign.id);
    const hair = Object.fromEntries(
      loaded.state.facts.filter((fact) => fact.category === ScribeCategory.Names.Hair).map((fact) => [fact.text, fact.status]),
    );

    assert.deepEqual(hair, { red: ScribeReplay.Status.Reported, 'black, freshly dyed': ScribeReplay.Status.InForce });
    const narrationMessage = loaded.messages.find((message) => message.position === 1);
    assert.deepEqual(narrationMessage.blocks.map((block) => block.role), ['Player', 'Narrator']);
  });
});

describe('RequestBudget', () => {
  it('resolves charsPerToken from model ratio, then overall ratio, then StartingCharsPerToken', () => {
    const store = new SqliteStore(':memory:');
    try {
      const emptyRatio = RequestBudget.charsPerToken({ store, model: 'openai/gpt-4.1' });
      assert.equal(emptyRatio, RequestBudget.StartingCharsPerToken);
      assert.equal(emptyRatio, 3);

      store.recordSpend({
        model: 'other/model',
        stage: SpendStage.Mind,
        promptChars: 350,
        promptTokens: 100,
        completionTokens: 20,
        costUsd: 0.001,
      });
      assert.equal(RequestBudget.charsPerToken({ store, model: 'openai/gpt-4.1' }), 3.5);

      store.recordSpend({
        model: 'openai/gpt-4.1',
        stage: SpendStage.Mind,
        promptChars: 600,
        promptTokens: 150,
        completionTokens: 20,
        costUsd: 0.001,
      });
      store.recordSpend({
        model: 'openai/gpt-4.1',
        stage: SpendStage.Mind,
        promptChars: 250,
        promptTokens: 100,
        completionTokens: 20,
        costUsd: 0.001,
      });
      assert.equal(RequestBudget.charsPerToken({ store, model: ' openai/gpt-4.1 ' }), 2.5);

      store.recordSpend({
        model: 'low/model',
        stage: SpendStage.Mind,
        promptChars: 200,
        promptTokens: 100,
        completionTokens: 20,
        costUsd: 0.001,
      });
      store.recordSpend({
        model: 'high/model',
        stage: SpendStage.Mind,
        promptChars: 400,
        promptTokens: 100,
        completionTokens: 20,
        costUsd: 0.001,
      });
      assert.equal(RequestBudget.charsPerToken({ store, model: 'high/model' }), 4);

      const zeroStore = {
        /**
         * @returns {number}
         */
        lowestCharsPerToken() {
          return 0;
        },
        /**
         * @returns {number}
         */
        lowestCharsPerTokenOverall() {
          return -1;
        },
      };
      assert.equal(RequestBudget.charsPerToken({ store: zeroStore, model: 'a/b' }), 3);
    } finally {
      store.close();
    }
  });

  it('computes limitTokens, estimate, and fits including null contextLength and contextLength <= replyReserve', () => {
    const standard = RequestBudget.create({ contextLength: 4000, replyReserve: 3000, charsPerToken: 3 });
    assert.equal(Object.isFrozen(standard), true);
    assert.equal(standard.limitTokens, 1000);
    assert.equal(standard.estimate(''), 0);
    assert.equal(standard.estimate('a'), 1);
    assert.equal(standard.estimate('abc'), 1);
    assert.equal(standard.estimate('abcd'), 2);
    assert.equal(standard.fits(998, 'abcdef'), true);
    assert.equal(standard.fits(998, 'abcdefg'), false);

    const equalLimit = RequestBudget.create({ contextLength: 3000, replyReserve: 3000, charsPerToken: 3 });
    assert.equal(equalLimit.limitTokens, 0);
    assert.equal(equalLimit.fits(0, ''), true);
    assert.equal(equalLimit.fits(0, 'a'), false);

    const smallerLimit = RequestBudget.create({ contextLength: 1500, replyReserve: 3000, charsPerToken: 3 });
    assert.equal(smallerLimit.limitTokens, 0);

    const unbounded = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });
    assert.equal(unbounded.limitTokens, null);
    assert.equal(unbounded.estimate('abcdef'), 2);
    assert.equal(unbounded.fits(999999, 'x'.repeat(10000)), true);
  });

  it('rejects invalid inputs with TypeError or RangeError', () => {
    const validStore = {
      /**
       * @returns {null}
       */
      lowestCharsPerToken() {
        return null;
      },
      /**
       * @returns {null}
       */
      lowestCharsPerTokenOverall() {
        return null;
      },
    };
    assert.throws(() => RequestBudget.charsPerToken(null), TypeError);
    assert.throws(() => RequestBudget.charsPerToken([]), TypeError);
    assert.throws(() => RequestBudget.charsPerToken({ store: null, model: 'a/b' }), TypeError);
    assert.throws(() => RequestBudget.charsPerToken({ store: [], model: 'a/b' }), TypeError);
    assert.throws(() => RequestBudget.charsPerToken({ store: {}, model: 'a/b' }), TypeError);
    assert.throws(() => RequestBudget.charsPerToken({ store: validStore, model: 123 }), TypeError);
    assert.throws(() => RequestBudget.charsPerToken({ store: validStore, model: '' }), RangeError);
    assert.throws(() => RequestBudget.charsPerToken({ store: validStore, model: '   ' }), RangeError);

    assert.throws(() => RequestBudget.create(null), TypeError);
    assert.throws(() => RequestBudget.create([]), TypeError);
    assert.throws(() => RequestBudget.create({ contextLength: '4000', replyReserve: 3000, charsPerToken: 3 }), TypeError);
    assert.throws(() => RequestBudget.create({ contextLength: 0, replyReserve: 3000, charsPerToken: 3 }), RangeError);
    assert.throws(() => RequestBudget.create({ contextLength: -5, replyReserve: 3000, charsPerToken: 3 }), RangeError);
    assert.throws(() => RequestBudget.create({ contextLength: 4000.5, replyReserve: 3000, charsPerToken: 3 }), RangeError);
    assert.throws(() => RequestBudget.create({ contextLength: Number.NaN, replyReserve: 3000, charsPerToken: 3 }), RangeError);
    assert.throws(() => RequestBudget.create({ contextLength: 4000, replyReserve: '3000', charsPerToken: 3 }), TypeError);
    assert.throws(() => RequestBudget.create({ contextLength: 4000, replyReserve: 0, charsPerToken: 3 }), RangeError);
    assert.throws(() => RequestBudget.create({ contextLength: 4000, replyReserve: 1.5, charsPerToken: 3 }), RangeError);
    assert.throws(() => RequestBudget.create({ contextLength: 4000, replyReserve: 3000, charsPerToken: '3' }), TypeError);
    assert.throws(() => RequestBudget.create({ contextLength: 4000, replyReserve: 3000, charsPerToken: 0 }), RangeError);
    assert.throws(() => RequestBudget.create({ contextLength: 4000, replyReserve: 3000, charsPerToken: -3 }), RangeError);
    assert.throws(() => RequestBudget.create({ contextLength: 4000, replyReserve: 3000, charsPerToken: Number.POSITIVE_INFINITY }), RangeError);

    const budget = RequestBudget.create({ contextLength: 4000, replyReserve: 3000, charsPerToken: 3 });
    assert.throws(() => budget.estimate(42), TypeError);
    assert.throws(() => budget.fits('0', 'hi'), TypeError);
    assert.throws(() => budget.fits(0, 42), TypeError);
    assert.throws(() => budget.fits(-1, 'hi'), RangeError);
    assert.throws(() => budget.fits(Number.NaN, 'hi'), RangeError);
    assert.throws(() => budget.fits(Number.POSITIVE_INFINITY, 'hi'), RangeError);
  });
});

describe('HistoryWindow', () => {
  it('bounds 300 Hero-Gone-scale turns plus StorySlice under 1000 tokens with newest turn intact and no partial turn', () => {
    const log = ScribeLogCore.create();
    let state = ScribeReplay.run(log, []);
    for (const character of [
      { id: 'S1', name: 'Frost' },
      { id: 'S2', name: 'Lize' },
    ]) {
      ScribeLogCore.syncCharacterSubject(log, state, {
        subjectId: null,
        name: character.name,
        aliases: [],
      });
      state = ScribeReplay.run(log, []);
    }
    ScribeLogCore.rule(log, state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: 'S2',
      category: 'hair',
      target: null,
      text: 'red',
      hidden: false,
      cite: null,
      position: 0,
      decided: true,
    });
    state = ScribeReplay.run(log, []);

    const budget = RequestBudget.create({ contextLength: 4000, replyReserve: 3000, charsPerToken: 3 });
    const slice = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: 'S2', characterId: 'c-lize' },
      scene: { location: 'Tavern', day: 1, timeLabel: 'Evening', sceneType: SceneType.Public, situation: 'Calm.' },
      presentSubjectIds: ['S1', 'S2'],
      budget,
      usedTokens: 0,
    });

    const turns = Array.from({ length: 300 }, (unusedEntry, index) => {
      const turnNumber = index + 1;
      const prefix = `Turn ${String(turnNumber).padStart(3, '0')}: `;
      const paddedBody = `${prefix}${'a'.repeat(900 - prefix.length)}`;
      return {
        id: `t-${turnNumber}`,
        seq: turnNumber,
        role: TurnRole.Assistant,
        mode: TurnMode.Normal,
        sceneNumber: 1,
        beats: [
          {
            id: `b-${turnNumber}`,
            seq: 1,
            speakerType: SpeakerType.Character,
            characterId: 'c-lize',
            speakerName: 'Lize',
            text: paddedBody,
            witnessIds: ['c-frost', 'c-lize'],
            mindPacket: { internalThought: 'SECRET_MIND_DATA' },
          },
        ],
      };
    });

    const history = HistoryWindow.build({
      turns,
      characterId: 'c-lize',
      maxTurns: 25,
      budget,
      usedTokens: slice.tokens,
    });

    assert.equal(slice.tokens + history.tokens <= 1000, true);
    assert.equal(history.turnCount >= 1 && history.turnCount <= 3, true);
    assert.equal(history.text.includes('Turn 300: '), true);
    assert.equal(history.text.includes('Turn 001: '), false);
    assert.equal(history.text.includes('SECRET_MIND_DATA'), false);

    const lines = history.text.split('\n');
    assert.equal(lines.length, history.turnCount);
    for (const line of lines) {
      assert.equal(line.length, 'Lize: '.length + 900);
    }
  });

  it('drops monotonically when a large turn blocks an older tiny turn', () => {
    const budget = RequestBudget.create({ contextLength: 3100, replyReserve: 3000, charsPerToken: 3 });
    const turns = [
      {
        id: 't1',
        seq: 1,
        beats: [{ seq: 1, speakerName: 'Frost', text: 'tiny one', witnessIds: ['c-lize'] }],
      },
      {
        id: 't2',
        seq: 2,
        beats: [{ seq: 1, speakerName: 'Lize', text: 'x'.repeat(500), witnessIds: ['c-lize'] }],
      },
      {
        id: 't3',
        seq: 3,
        beats: [{ seq: 1, speakerName: 'Frost', text: 'newest one', witnessIds: ['c-lize'] }],
      },
    ];

    const history = HistoryWindow.build({
      turns,
      characterId: 'c-lize',
      maxTurns: 10,
      budget,
      usedTokens: 0,
    });

    assert.equal(history.turnCount, 1);
    assert.equal(history.text, 'Frost: newest one');
    assert.equal(history.text.includes('tiny one'), false);
  });

  it('trims only by maxTurns when contextLength is null', () => {
    const budget = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });
    const turns = Array.from({ length: 40 }, (unusedEntry, index) => {
      const turnNumber = index + 1;
      return {
        id: `t-${turnNumber}`,
        seq: turnNumber,
        beats: [{ seq: 1, speakerName: 'Frost', text: `Line ${turnNumber}`, witnessIds: ['c-lize'] }],
      };
    });

    const history = HistoryWindow.build({
      turns,
      characterId: 'c-lize',
      maxTurns: 25,
      budget,
      usedTokens: 50000,
    });

    assert.equal(history.turnCount, 25);
    const lines = history.text.split('\n');
    assert.equal(lines.length, 25);
    assert.equal(lines[0], 'Frost: Line 16');
    assert.equal(lines[24], 'Frost: Line 40');

    const unfilteredHistory = HistoryWindow.build({
      turns,
      characterId: null,
      maxTurns: 25,
      budget,
      usedTokens: 50000,
    });

    assert.equal(unfilteredHistory.turnCount, 25);
    const unfilteredLines = unfilteredHistory.text.split('\n');
    assert.equal(unfilteredLines.length, 25);
    assert.equal(unfilteredLines[0], 'Frost: Line 16');
    assert.equal(unfilteredLines[24], 'Frost: Line 40');
  });

  it('isolates mid-turn arrival for specific characterId, includes all beats for null characterId, excludes mindPacket, and renders multi-beat player turns in order', () => {
    const budget = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });
    const turns = [
      {
        id: 't2',
        seq: 2,
        role: TurnRole.Assistant,
        mode: TurnMode.Normal,
        sceneNumber: 1,
        beats: [
          {
            id: 'b2a',
            seq: 1,
            speakerType: SpeakerType.Character,
            characterId: 'c-lize',
            speakerName: 'Lize',
            text: 'Before Viola arrives.',
            witnessIds: ['c-frost', 'c-lize'],
            mindPacket: { internalThought: 'LIZE_PRIVATE_THOUGHT' },
          },
          {
            id: 'b2b',
            seq: 2,
            speakerType: SpeakerType.Character,
            characterId: 'c-viola',
            speakerName: 'Viola',
            text: 'Viola knocks and steps in.',
            witnessIds: ['c-frost', 'c-lize', 'c-viola'],
            mindPacket: { internalThought: 'VIOLA_PRIVATE_THOUGHT' },
          },
        ],
      },
      {
        id: 't1',
        seq: 1,
        role: TurnRole.User,
        mode: TurnMode.Normal,
        sceneNumber: 1,
        beats: [
          {
            id: 'b1b',
            seq: 2,
            speakerType: SpeakerType.Narrator,
            characterId: null,
            speakerName: 'Narrator',
            text: 'Her hair is dyed black.',
            witnessIds: ['c-frost', 'c-lize'],
            mindPacket: null,
          },
          {
            id: 'b1a',
            seq: 1,
            speakerType: SpeakerType.Player,
            characterId: 'c-frost',
            speakerName: 'Frost',
            text: 'I look across the table.',
            witnessIds: ['c-frost', 'c-lize'],
            mindPacket: null,
          },
        ],
      },
    ];

    const violaHistory = HistoryWindow.build({
      turns,
      characterId: 'c-viola',
      maxTurns: 10,
      budget,
      usedTokens: 0,
    });
    assert.equal(violaHistory.turnCount, 1);
    assert.equal(violaHistory.text, 'Viola: Viola knocks and steps in.');
    assert.equal(violaHistory.text.includes('Before Viola arrives.'), false);
    assert.equal(violaHistory.text.includes('PRIVATE_THOUGHT'), false);

    const narratorHistory = HistoryWindow.build({
      turns,
      characterId: null,
      maxTurns: 10,
      budget,
      usedTokens: 0,
    });
    assert.equal(narratorHistory.turnCount, 2);
    assert.equal(
      narratorHistory.text,
      [
        'Frost: I look across the table.',
        'Narrator: Her hair is dyed black.',
        'Lize: Before Viola arrives.',
        'Viola: Viola knocks and steps in.',
      ].join('\n'),
    );
    assert.equal(narratorHistory.text.includes('PRIVATE_THOUGHT'), false);
  });

  it('validates arguments strictly', () => {
    const budget = RequestBudget.create({ contextLength: 4000, replyReserve: 3000, charsPerToken: 3 });
    assert.throws(() => HistoryWindow.build(null), TypeError);
    assert.throws(() => HistoryWindow.build({ turns: 'nope', maxTurns: 5, budget }), TypeError);
    assert.throws(() => HistoryWindow.build({ turns: [], characterId: 5, maxTurns: 5, budget }), TypeError);
    assert.throws(() => HistoryWindow.build({ turns: [], characterId: '  ', maxTurns: 5, budget }), RangeError);
    assert.throws(() => HistoryWindow.build({ turns: [], maxTurns: '5', budget }), TypeError);
    assert.throws(() => HistoryWindow.build({ turns: [], maxTurns: 0, budget }), RangeError);
    assert.throws(() => HistoryWindow.build({ turns: [], maxTurns: 5, budget: null }), TypeError);
    assert.throws(
      () => HistoryWindow.build({ turns: [], maxTurns: 5, budget: { estimate: () => 0, fits: () => true, limitTokens: -1 } }),
      RangeError,
    );
    assert.throws(() => HistoryWindow.build({ turns: [], maxTurns: 5, budget, usedTokens: -1 }), RangeError);
    assert.throws(() => HistoryWindow.build({ turns: [{ seq: 1.5, beats: [] }], maxTurns: 5, budget }), RangeError);
    assert.throws(() => HistoryWindow.build({ turns: [null], maxTurns: 5, budget }), TypeError);
  });
});

describe('StorySlice', () => {
  /**
   * @param {ReadonlyArray<string>} names
   * @param {{aliases?: Record<string, readonly string[]>}} [options]
   * @returns {{log: object, subjects: Record<string, string>}}
   * @throws {Error}
   */
  function createBookWithSubjects(names, { aliases = {} } = {}) {
    const log = ScribeLogCore.create();
    let state = ScribeReplay.run(log, []);
    const subjects = {};
    for (const name of names) {
      const synced = ScribeLogCore.syncCharacterSubject(log, state, {
        subjectId: null,
        name,
        aliases: aliases[name] ?? [],
        kind: ScribeCategory.SubjectKinds.Character,
      });
      subjects[name] = synced.subjectId;
      state = ScribeReplay.run(log, []);
    }
    return { log, subjects };
  }

  /**
   * @param {object} log
   * @param {Array<object>} turns
   * @param {string} playerName
   * @returns {{state: object, intake: object, order: Array<{id: string, position: number}>, fingerprints: Map<string, string>}}
   * @throws {Error}
   */
  function replayBook(log, turns, playerName) {
    const intake = ScribeIntakeAdapter.fromTurns(turns, { playerName });
    const order = turns.map((turn) => ({ id: turn.id, position: turn.seq }));
    const fingerprints = new Map(intake.messages.map((message) => [message.id, message.fingerprint]));
    const state = ScribeReplay.run(log, order, null, fingerprints, null, null, intake.messages);
    return { state, intake, order, fingerprints };
  }

  it('renders Option A fixed-attribute history, excludes undecided Reported hair, isolates build forms, and tracks merged history', () => {
    const { log, subjects } = createBookWithSubjects(['Frost', 'Lize', 'OldLize']);
    const turns = [
      { id: 't1', seq: 1, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Lize dyes her hair black.', sceneNumber: 1, beats: [] },
      { id: 't2', seq: 2, role: TurnRole.Assistant, mode: TurnMode.Normal, rawText: 'Lize blinks.', sceneNumber: 1, beats: [] },
    ];
    let replayed = replayBook(log, turns, 'Frost');

    ScribeLogCore.rule(log, replayed.state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Lize,
      category: 'hair',
      target: null,
      text: 'red',
      hidden: false,
      cite: null,
      position: 0,
      decided: true,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Lize,
      category: 'build',
      target: null,
      text: 'In dragon form she is huge',
      hidden: false,
      cite: null,
      position: 0,
      decided: true,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.OldLize,
      category: 'eyes',
      target: null,
      text: 'amber',
      hidden: false,
      cite: null,
      position: 0,
      decided: true,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.Merge,
      from: subjects.OldLize,
      into: subjects.Lize,
    });

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 1,
          place: 'Tavern',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Tavern',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'hair', target: null, text: 'black', position: 1, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'eyes', target: null, text: 'emerald', position: 1, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'build', target: null, text: 'In dragon form she is tiny', position: 1, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'build', target: null, text: 'In human form she is slim', position: 1, hidden: false },
      ],
      { messages: [replayed.intake.messages[0]], origin: ScribeLogCore.Origin.Story },
    );

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 2,
          place: 'Tavern',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Tavern',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'hair', target: null, text: 'blonde', position: 2, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'skin', target: null, text: 'freckled', position: 2, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'skin', target: null, text: 'pale', position: 2, hidden: false },
      ],
      { messages: [replayed.intake.messages[1]], origin: ScribeLogCore.Origin.Story },
    );

    const finalState = replayBook(log, turns, 'Frost').state;
    const budget = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });
    const slice = StorySlice.build({
      state: finalState,
      viewer: { omniscient: false, subjectId: subjects.Frost },
      scene: { location: 'Tavern', day: 1, timeLabel: 'Evening', sceneType: SceneType.Public, situation: '' },
      presentSubjectIds: [subjects.Frost, subjects.Lize],
      budget,
    });

    assert.equal(slice.text.includes('hair: black (originally red)'), true);
    assert.equal(slice.text.includes('blonde'), false);
    assert.equal(slice.text.includes('eyes: emerald (originally amber)'), true);
    assert.equal(slice.text.includes('build: In dragon form she is tiny (originally In dragon form she is huge)'), true);
    assert.equal(slice.text.includes('build: In human form she is slim'), true);
    assert.equal(slice.text.includes('In human form she is slim (originally'), false);
    assert.equal(slice.text.includes('skin: freckled'), true);
    assert.equal(slice.text.includes('pale'), false);
  });

  it('never leaks hidden or private-scene prior decided facts, maps ? to unknown, and respects told/widened and omniscient hidden filtering', () => {
    const { log, subjects } = createBookWithSubjects(['Frost', 'Lize', 'Viola', 'Collette']);
    const turns = [
      {
        id: 't1',
        seq: 1,
        role: TurnRole.User,
        mode: TurnMode.Normal,
        rawText: 'Private talk.',
        sceneNumber: 1,
        witnessIds: ['c-frost', 'c-lize'],
        beats: [{ id: 'b1', seq: 1, speakerType: SpeakerType.Player, characterId: 'c-frost', speakerName: 'Frost', text: 'Private talk.', witnessIds: ['c-frost', 'c-lize'] }],
      },
      {
        id: 't2',
        seq: 2,
        role: TurnRole.Assistant,
        mode: TurnMode.Normal,
        rawText: 'Lize whispers.',
        sceneNumber: 1,
        witnessIds: ['c-frost', 'c-lize'],
        beats: [{ id: 'b2', seq: 1, speakerType: SpeakerType.Character, characterId: 'c-lize', speakerName: 'Lize', text: 'Lize whispers.', witnessIds: ['c-frost', 'c-lize'] }],
      },
      {
        id: 't3',
        seq: 3,
        role: TurnRole.User,
        mode: TurnMode.Normal,
        rawText: 'Public hall.',
        sceneNumber: 2,
        witnessIds: ['c-frost', 'c-lize', 'c-viola', 'c-collette'],
        beats: [{ id: 'b3', seq: 1, speakerType: SpeakerType.Player, characterId: 'c-frost', speakerName: 'Frost', text: 'Public hall.', witnessIds: ['c-frost', 'c-lize', 'c-viola', 'c-collette'] }],
      },
    ];

    let replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.rule(log, replayed.state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Lize,
      category: 'age',
      target: null,
      text: '?',
      hidden: false,
      cite: null,
      position: 0,
      decided: true,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Lize,
      category: 'eyes',
      target: null,
      text: 'silver',
      hidden: true,
      cite: null,
      position: 0,
      decided: true,
    });

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 2,
          place: 'Bedroom',
          reach: ScribeAnswer.Reach.Private,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Bedroom talk',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'hair', target: null, text: 'red', position: 1, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'location', target: null, text: 'upstairs bedroom', position: 2, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'trait', target: null, text: 'smuggles ciphers', position: 2, hidden: true },
        { type: ScribeAnswer.Type.ThreadOpen, text: 'Find Lize cipher key', position: 2, subject: subjects.Lize },
      ],
      { messages: replayed.intake.messages.slice(0, 2), origin: ScribeLogCore.Origin.Story },
    );

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 3,
          last: 3,
          place: 'Main Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
            { subject: subjects.Viola, label: 'Viola', from: null, until: null },
          ],
          summary: 'Main Hall',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'eyes', target: null, text: 'green', position: 3, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'hair', target: null, text: 'black', position: 3, hidden: false },
      ],
      { messages: [replayed.intake.messages[2]], origin: ScribeLogCore.Origin.Story },
    );

    const stateBeforeTold = replayBook(log, turns, 'Frost').state;
    const secretTrait = stateBeforeTold.facts.find((fact) => fact.text === 'smuggles ciphers');
    const silverEyes = stateBeforeTold.facts.find((fact) => fact.text === 'silver');
    ScribeLogCore.rule(log, stateBeforeTold, {
      type: ScribeLogCore.Ruling.Widen,
      fact: secretTrait.id,
      to: [subjects.Viola],
      exact: true,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.Widen,
      fact: silverEyes.id,
      to: [subjects.Viola],
      exact: true,
    });

    const finalState = replayBook(log, turns, 'Frost').state;
    const turnsById = new Map(turns.map((turn) => [turn.id, turn]));
    const budget = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });
    const scene = { location: 'Main Hall', day: 1, timeLabel: '', sceneType: SceneType.Public, situation: 'Gathering.' };

    const colletteSlice = StorySlice.build({
      state: finalState,
      viewer: { omniscient: false, subjectId: subjects.Collette, characterId: 'c-collette' },
      scene,
      presentSubjectIds: [subjects.Frost, subjects.Lize, subjects.Collette],
      budget,
      turnsById,
    });
    assert.equal(colletteSlice.text.includes('age: unknown'), true);
    assert.equal(colletteSlice.text.includes('?'), false);
    assert.equal(colletteSlice.text.includes('originally silver'), false);
    assert.equal(colletteSlice.text.includes('originally red'), false);
    assert.equal(colletteSlice.text.includes('upstairs bedroom'), false);
    assert.equal(colletteSlice.text.includes('smuggles ciphers'), false);
    assert.equal(colletteSlice.text.includes('Find Lize cipher key'), false);

    const violaSlice = StorySlice.build({
      state: finalState,
      viewer: { omniscient: false, subjectId: subjects.Viola, characterId: 'c-viola' },
      scene,
      presentSubjectIds: [subjects.Frost, subjects.Lize, subjects.Viola],
      budget,
      turnsById,
    });
    assert.equal(violaSlice.text.includes('eyes: green (originally silver)'), true);
    assert.equal(violaSlice.text.includes('smuggles ciphers'), true);
    assert.equal(violaSlice.text.includes('Find Lize cipher key'), false);

    const frostSlice = StorySlice.build({
      state: finalState,
      viewer: { omniscient: false, subjectId: subjects.Frost, characterId: 'c-frost' },
      scene,
      presentSubjectIds: [subjects.Frost, subjects.Lize],
      budget,
      turnsById,
    });
    assert.equal(frostSlice.text.includes('hair: black (originally red)'), true);
    assert.equal(frostSlice.text.includes('Find Lize cipher key'), true);

    const narratorSlice = StorySlice.build({
      state: finalState,
      viewer: { omniscient: true, subjectId: null },
      scene,
      presentSubjectIds: [subjects.Frost, subjects.Lize],
      budget,
      turnsById,
    });
    assert.equal(narratorSlice.text.includes('smuggles ciphers'), false);
    assert.equal(narratorSlice.text.includes('originally silver'), false);
    assert.equal(narratorSlice.text.includes('Find Lize cipher key'), true);
  });

  it('orders rulings before newer story facts, deduplicates viewer, matches aliases safely in Section 6, and stops cleanly at tight budget after Sections 1-3', () => {
    const { log, subjects } = createBookWithSubjects(
      ['Frost', 'Lize', 'Collette', 'Al', 'Mirra'],
      { aliases: { Collette: ['Cook Collette'] } },
    );
    const turns = [
      { id: 't1', seq: 1, role: TurnRole.Assistant, mode: TurnMode.Normal, rawText: 'Turn 1', sceneNumber: 1, beats: [] },
      { id: 't2', seq: 2, role: TurnRole.Assistant, mode: TurnMode.Normal, rawText: 'Turn 2', sceneNumber: 1, beats: [] },
    ];
    let replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.rule(log, replayed.state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Frost,
      category: 'role',
      target: null,
      text: 'caravan scout',
      hidden: false,
      cite: null,
      position: 0,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Lize,
      category: 'role',
      target: null,
      text: 'quartermaster',
      hidden: false,
      cite: null,
      position: 0,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Al,
      category: 'role',
      target: null,
      text: 'blacksmith',
      hidden: false,
      cite: null,
      position: 0,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Mirra,
      category: 'role',
      target: null,
      text: 'cart driver',
      hidden: false,
      cite: null,
      position: 0,
    });

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 2,
          first: 1,
          last: 2,
          place: 'Courtyard',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Courtyard',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Frost', category: 'belonging', target: null, text: 'lantern', position: 2, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'condition', target: null, text: 'tired from watch', position: 2, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Collette', category: 'trait', target: null, text: 'cheerful cook', position: 2, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Frost', category: 'relation', target: 'Lize', text: 'trusts her implicitly', position: 2, hidden: false },
        { type: ScribeAnswer.Type.ThreadOpen, text: 'Inspect Frost and Lize wagon', position: 2 },
      ],
      { messages: replayed.intake.messages, origin: ScribeLogCore.Origin.Story },
    );

    const state = replayBook(log, turns, 'Frost').state;
    const scene = { location: 'Courtyard', day: 2, timeLabel: 'Dusk', sceneType: SceneType.Public, situation: 'Packing.' };
    const unboundedBudget = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });

    const fullSlice = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: subjects.Frost, characterId: 'c-frost' },
      scene,
      presentSubjectIds: [subjects.Frost, subjects.Lize],
      namedText: 'I always ask Collette-chan about supper.',
      playerName: 'Frost',
      budget: unboundedBudget,
    });

    assert.deepEqual(fullSlice.text.match(/^- Frost:/gm), ['- Frost:']);
    assert.equal(
      fullSlice.text.indexOf('role: quartermaster') < fullSlice.text.indexOf('condition: tired from watch'),
      true,
    );
    assert.equal(fullSlice.text.includes('Relations:\n- Frost -> Lize: trusts her implicitly'), true);
    assert.equal(fullSlice.text.includes('Open threads:\n- Inspect Frost and Lize wagon'), true);
    assert.equal(fullSlice.text.includes('Known facts:\n- Collette: trait: cheerful cook'), true);
    assert.equal(fullSlice.text.includes('blacksmith'), false);
    assert.equal(fullSlice.text.includes('cart driver'), false);

    const sectionsOneToThree = [
      '<story_state>',
      'Location: Courtyard | Time: Day 2, Dusk | public',
      'Present: Frost, Lize',
      'Situation: Packing.',
      '- Frost: role: caravan scout | Items: lantern',
      '- Lize: role: quartermaster; condition: tired from watch',
      '</story_state>',
    ].join('\n');
    const exactTokensForOneToThree = Math.ceil(sectionsOneToThree.length / 3);
    const tightBudget = RequestBudget.create({
      contextLength: 3000 + exactTokensForOneToThree,
      replyReserve: 3000,
      charsPerToken: 3,
    });

    const tightSlice = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: subjects.Frost, characterId: 'c-frost' },
      scene,
      presentSubjectIds: [subjects.Frost, subjects.Lize],
      namedText: 'I always ask Collette-chan about supper.',
      playerName: 'Frost',
      budget: tightBudget,
    });

    assert.equal(tightSlice.text, sectionsOneToThree);
    assert.equal(tightSlice.tokens <= exactTokensForOneToThree, true);
    assert.equal(tightSlice.text.includes('Relations:'), false);
    assert.equal(tightSlice.text.includes('Open threads:'), false);
    assert.equal(tightSlice.text.includes('Known facts:'), false);

    const zeroBudget = RequestBudget.create({ contextLength: 3000, replyReserve: 3000, charsPerToken: 3 });
    const emptySlice = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: subjects.Frost },
      scene,
      presentSubjectIds: [subjects.Frost],
      budget: zeroBudget,
    });
    assert.deepEqual(emptySlice, { text: '', tokens: 0 });
  });

  it('validates arguments strictly', () => {
    const budget = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });
    const state = { subjects: [], facts: [], threads: [], scenes: [] };
    const viewer = { omniscient: false, subjectId: null };
    const scene = { location: 'Hall', day: 1, timeLabel: '', sceneType: SceneType.Public, situation: '' };

    assert.throws(() => StorySlice.build(null), TypeError);
    assert.throws(() => StorySlice.build({ state: null, viewer, scene, budget }), TypeError);
    assert.throws(() => StorySlice.build({ state: { subjects: [] }, viewer, scene, budget }), TypeError);
    assert.throws(() => StorySlice.build({ state, viewer: { omniscient: 'yes', subjectId: null }, scene, budget }), TypeError);
    assert.throws(() => StorySlice.build({ state, viewer: { omniscient: false, subjectId: '' }, scene, budget }), RangeError);
    assert.throws(() => StorySlice.build({ state, viewer: { omniscient: false, subjectId: null, characterId: '  ' }, scene, budget }), RangeError);
    assert.throws(() => StorySlice.build({ state, viewer, scene: { ...scene, day: 0 }, budget }), RangeError);
    assert.throws(() => StorySlice.build({ state, viewer, scene: { ...scene, sceneType: 'secret' }, budget }), RangeError);
    assert.throws(() => StorySlice.build({ state, viewer, scene, presentSubjectIds: [5], budget }), TypeError);
    assert.throws(() => StorySlice.build({ state, viewer, scene, remoteSubjectIds: [null], budget }), TypeError);
    assert.throws(() => StorySlice.build({ state, viewer, scene, namedText: 5, budget }), TypeError);
    assert.throws(() => StorySlice.build({ state, viewer, scene, playerName: 5, budget }), TypeError);
    assert.throws(() => StorySlice.build({ state, viewer, scene, budget, usedTokens: -1 }), RangeError);
    assert.throws(() => StorySlice.build({ state, viewer, scene, budget, turnsById: [] }), TypeError);
  });

  it('handles pinned build forms in Option A, remote deduplication, omniscient and alias relations, thread priority with turnsById, and Section 2 overflow packing', () => {
    const { log, subjects } = createBookWithSubjects(['Frost', 'Lize', 'Viola']);
    const turns = [
      { id: 't1', seq: 1, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Dragon shifts.', sceneNumber: 1, beats: [] },
      {
        id: 't2',
        seq: 2,
        role: TurnRole.Assistant,
        mode: TurnMode.Normal,
        rawText: 'Lize speaks.',
        sceneNumber: 1,
        beats: [{ id: 'b2', seq: 1, speakerType: SpeakerType.Character, characterId: 'c-lize', speakerName: 'Lize', text: 'Lize speaks.', witnessIds: ['c-frost', 'c-lize'] }],
      },
    ];

    let replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.rule(log, replayed.state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Frost,
      category: 'role',
      target: null,
      text: 'scout captain',
      hidden: false,
      cite: null,
      position: 0,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Frost,
      category: 'build',
      target: null,
      text: 'In dragon form he is massive',
      hidden: false,
      cite: null,
      position: 0,
      decided: true,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Frost,
      category: 'build',
      target: null,
      text: 'In human form he is wiry',
      hidden: false,
      cite: null,
      position: 0,
      decided: true,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.Pin,
      subject: subjects.Frost,
      category: 'build',
      target: null,
      text: 'In dragon form he is sleek',
      hidden: false,
      winner: null,
    });
    ScribeLogCore.append(
      log,
      replayBook(log, turns, 'Frost').state,
      [{ type: ScribeAnswer.Type.ThreadOpen, text: 'Frost must guard the gate', position: 0 }],
      { messages: [], origin: ScribeLogCore.Origin.Notes },
    );

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 1,
          place: 'Bridge',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
            { subject: subjects.Viola, label: 'Viola', from: null, until: null },
          ],
          summary: 'Bridge',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Frost', category: 'relation', target: 'Lady Lize', text: 'covers her flank', position: 1, hidden: false },
      ],
      { messages: [replayed.intake.messages[0]], origin: ScribeLogCore.Origin.Story },
    );

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 2,
          place: 'Bridge',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
            { subject: subjects.Viola, label: 'Viola', from: null, until: null },
          ],
          summary: 'Bridge',
        },
        { type: ScribeAnswer.Type.Alias, label: 'Lize', name: 'Lady Lize', position: 2 },
        { type: ScribeAnswer.Type.Fact, label: 'Frost', category: 'condition', target: null, text: 'soaked by freezing rain', position: 2, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'relation', target: 'Viola', text: 'owes her a favor', position: 2, hidden: false },
        { type: ScribeAnswer.Type.ThreadOpen, text: 'Unlock Frost seal before dawn', position: 2 },
      ],
      { messages: [replayed.intake.messages[1]], origin: ScribeLogCore.Origin.Story },
    );

    const state = replayBook(log, turns, 'Frost').state;
    const turnsPlain = Object.fromEntries(turns.map((turn) => [turn.id, turn]));
    const scene = { location: 'Bridge', day: 1, timeLabel: 'Dawn', sceneType: SceneType.Public, situation: 'Stand.' };
    const unbounded = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });

    const frostSlice = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: subjects.Frost, characterId: 'c-frost' },
      scene,
      presentSubjectIds: [subjects.Frost, subjects.Lize],
      remoteSubjectIds: [subjects.Lize, subjects.Viola],
      budget: unbounded,
      turnsById: turnsPlain,
    });
    assert.equal(frostSlice.text.includes('Present: Frost, Lize\nRemote: Viola\n'), true);
    assert.equal(frostSlice.text.includes('build: In dragon form he is sleek (originally In dragon form he is massive)'), true);
    assert.equal(frostSlice.text.includes('build: In human form he is wiry'), true);
    assert.equal(frostSlice.text.includes('- Frost -> Lady Lize: covers her flank'), true);
    assert.equal(frostSlice.text.includes('owes her a favor'), false);
    assert.equal(
      frostSlice.text.indexOf('- Frost must guard the gate') < frostSlice.text.indexOf('- Unlock Frost seal before dawn'),
      true,
    );

    const narratorSlice = StorySlice.build({
      state,
      viewer: { omniscient: true, subjectId: null },
      scene,
      presentSubjectIds: [subjects.Lize],
      remoteSubjectIds: [subjects.Viola],
      budget: unbounded,
    });
    assert.equal(narratorSlice.text.includes('- Lize -> Viola: owes her a favor'), true);

    const prefixWithTwoFacts = [
      '<story_state>',
      'Location: Bridge | Time: Day 1, Dawn | public',
      'Present: Frost, Lize',
      'Remote: Viola',
      'Situation: Stand.',
      '- Frost: role: scout captain; build: In human form he is wiry',
      '</story_state>',
    ].join('\n');
    const sec2Budget = RequestBudget.create({
      contextLength: 3000 + Math.ceil(prefixWithTwoFacts.length / 3),
      replyReserve: 3000,
      charsPerToken: 3,
    });
    const sec2OverflowSlice = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: subjects.Frost },
      scene,
      presentSubjectIds: [subjects.Frost, subjects.Lize],
      remoteSubjectIds: [subjects.Viola],
      budget: sec2Budget,
    });
    assert.equal(sec2OverflowSlice.text, prefixWithTwoFacts);
    assert.equal(sec2OverflowSlice.text.includes('sleek'), false);
    assert.equal(sec2OverflowSlice.text.includes('soaked by freezing rain'), false);
    assert.equal(sec2OverflowSlice.text.includes('Relations:'), false);
  });

  it('blocks secret hidden or private-scene aka aliases across Sections 4-6 for character and omniscient viewers', () => {
    const { log, subjects } = createBookWithSubjects(['Frost', 'Lize', 'Viola', 'Collette', 'Shadow']);
    const turns = [
      { id: 't1', seq: 1, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Public rumor.', sceneNumber: 1, beats: [] },
      { id: 't2', seq: 2, role: TurnRole.Assistant, mode: TurnMode.Normal, rawText: 'Private meeting.', sceneNumber: 2, beats: [] },
      { id: 't3', seq: 3, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Hall scene.', sceneNumber: 3, beats: [] },
    ];

    let replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.rule(log, replayed.state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Collette,
      category: 'role',
      target: null,
      text: 'tavern cook',
      hidden: false,
      cite: null,
      position: 0,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Shadow,
      category: 'role',
      target: null,
      text: 'courier',
      hidden: false,
      cite: null,
      position: 0,
    });

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 1,
          place: 'Square',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Viola, label: 'Viola', from: null, until: null },
          ],
          summary: 'Square',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Viola', category: 'relation', target: 'Nightblade', text: 'suspects her secretly', position: 1, hidden: false },
      ],
      { messages: [replayed.intake.messages[0]], origin: ScribeLogCore.Origin.Story },
    );

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 2,
          last: 2,
          place: 'Cellar',
          reach: ScribeAnswer.Reach.Private,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Cellar',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Shadow', category: 'aka', target: null, text: 'Whisper', position: 2, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'aka', target: null, text: 'Raven', position: 2, hidden: false },
      ],
      { messages: [replayed.intake.messages[1]], origin: ScribeLogCore.Origin.Story },
    );

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 3,
          last: 3,
          place: 'Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Viola, label: 'Viola', from: null, until: null },
            { subject: subjects.Collette, label: 'Collette', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Hall',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Collette', category: 'aka', target: null, text: 'Nightblade', position: 3, hidden: true },
        { type: ScribeAnswer.Type.ThreadOpen, text: 'Ask Nightblade about the ledger', position: 3 },
        { type: ScribeAnswer.Type.ThreadOpen, text: 'Track Raven at the docks', position: 3 },
      ],
      { messages: [replayed.intake.messages[2]], origin: ScribeLogCore.Origin.Story },
    );

    const state = replayBook(log, turns, 'Frost').state;
    const budget = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });
    const scene = { location: 'Hall', day: 1, timeLabel: 'Noon', sceneType: SceneType.Public, situation: 'Busy.' };

    const violaSlice = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: subjects.Viola, characterId: 'c-viola' },
      scene,
      presentSubjectIds: [subjects.Viola, subjects.Collette, subjects.Lize],
      namedText: 'I heard Whisper and Nightblade mentioned earlier.',
      budget,
    });
    assert.equal(violaSlice.text.includes('suspects her secretly'), false);
    assert.equal(violaSlice.text.includes('Ask Nightblade about the ledger'), false);
    assert.equal(violaSlice.text.includes('Track Raven at the docks'), false);
    assert.equal(violaSlice.text.includes('courier'), false);

    const frostSlice = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: subjects.Frost, characterId: 'c-frost' },
      scene,
      presentSubjectIds: [subjects.Frost, subjects.Viola, subjects.Lize],
      namedText: 'Look for Whisper and Nightblade.',
      budget,
    });
    assert.equal(frostSlice.text.includes('Track Raven at the docks'), true);
    assert.equal(frostSlice.text.includes('Known facts:\n- Shadow: role: courier'), true);
    assert.equal(frostSlice.text.includes('tavern cook'), false);

    const narratorSlice = StorySlice.build({
      state,
      viewer: { omniscient: true, subjectId: null },
      scene,
      presentSubjectIds: [subjects.Viola, subjects.Collette],
      namedText: 'Search for Whisper and Nightblade.',
      budget,
    });
    assert.equal(narratorSlice.text.includes('suspects her secretly'), false);
    assert.equal(narratorSlice.text.includes('Ask Nightblade about the ledger'), false);
    assert.equal(narratorSlice.text.includes('Known facts:\n- Shadow: role: courier'), true);
  });

  it('suppresses originally on reverted or normalized-identical values, keeps 3-step earliest history, and handles superseded Pin and same-batch player turns', () => {
    const { log, subjects } = createBookWithSubjects(['Frost', 'Lize']);
    const turns = [
      { id: 't1', seq: 1, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Hair black, eyes gray.', sceneNumber: 1, beats: [] },
      { id: 't2', seq: 2, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Hair silver or red.', sceneNumber: 1, beats: [] },
      { id: 't3', seq: 3, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Skin tan.', sceneNumber: 1, beats: [] },
    ];

    let replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.rule(log, replayed.state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Lize,
      category: 'hair',
      target: null,
      text: 'red',
      hidden: false,
      cite: null,
      position: 0,
      decided: true,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Lize,
      category: 'eyes',
      target: null,
      text: 'grey',
      hidden: false,
      cite: null,
      position: 0,
      decided: true,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.Pin,
      subject: subjects.Lize,
      category: 'skin',
      target: null,
      text: 'porcelain',
      hidden: false,
      winner: null,
    });

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 2,
          place: 'Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Hall',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'hair', target: null, text: 'black', position: 1, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'eyes', target: null, text: 'gray', position: 1, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'age', target: null, text: 'twenty', position: 1, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'age', target: null, text: 'twenty-two', position: 2, hidden: false },
      ],
      { messages: replayed.intake.messages.slice(0, 2), origin: ScribeLogCore.Origin.Story },
    );

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 3,
          place: 'Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Hall',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'hair', target: null, text: 'red', position: 3, hidden: false },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'skin', target: null, text: 'sun-tanned', position: 3, hidden: false },
      ],
      { messages: [replayed.intake.messages[2]], origin: ScribeLogCore.Origin.Story },
    );

    const budget = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });
    const scene = { location: 'Hall', day: 1, timeLabel: 'Day', sceneType: SceneType.Public, situation: '' };
    const revertedSlice = StorySlice.build({
      state: replayBook(log, turns, 'Frost').state,
      viewer: { omniscient: false, subjectId: subjects.Frost },
      scene,
      presentSubjectIds: [subjects.Frost, subjects.Lize],
      budget,
    });
    assert.equal(revertedSlice.text.includes('hair: red;'), true);
    assert.equal(revertedSlice.text.includes('hair: red (originally'), false);
    assert.equal(revertedSlice.text.includes('eyes: gray'), true);
    assert.equal(revertedSlice.text.includes('eyes: gray (originally'), false);
    assert.equal(revertedSlice.text.includes('age: twenty-two (originally twenty)'), true);
    assert.equal(revertedSlice.text.includes('skin: sun-tanned (originally porcelain)'), true);

    const threeStepSetup = createBookWithSubjects(['Frost', 'Lize']);
    const threeTurns = [
      { id: 'u1', seq: 1, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Black hair.', sceneNumber: 1, beats: [] },
      { id: 'u2', seq: 2, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Silver hair.', sceneNumber: 1, beats: [] },
    ];
    let threeReplayed = replayBook(threeStepSetup.log, threeTurns, 'Frost');
    ScribeLogCore.rule(threeStepSetup.log, threeReplayed.state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: threeStepSetup.subjects.Lize,
      category: 'hair',
      target: null,
      text: 'red',
      hidden: false,
      cite: null,
      position: 0,
      decided: true,
    });
    threeReplayed = replayBook(threeStepSetup.log, threeTurns, 'Frost');
    ScribeLogCore.append(
      threeStepSetup.log,
      threeReplayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 1,
          place: 'Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: threeStepSetup.subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: threeStepSetup.subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Hall',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'hair', target: null, text: 'black', position: 1, hidden: false },
      ],
      { messages: [threeReplayed.intake.messages[0]], origin: ScribeLogCore.Origin.Story },
    );
    threeReplayed = replayBook(threeStepSetup.log, threeTurns, 'Frost');
    ScribeLogCore.append(
      threeStepSetup.log,
      threeReplayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 2,
          place: 'Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: threeStepSetup.subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: threeStepSetup.subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Hall',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'hair', target: null, text: 'silver', position: 2, hidden: false },
      ],
      { messages: [threeReplayed.intake.messages[1]], origin: ScribeLogCore.Origin.Story },
    );
    const threeSlice = StorySlice.build({
      state: replayBook(threeStepSetup.log, threeTurns, 'Frost').state,
      viewer: { omniscient: false, subjectId: threeStepSetup.subjects.Frost },
      scene,
      presentSubjectIds: [threeStepSetup.subjects.Frost, threeStepSetup.subjects.Lize],
      budget,
    });
    assert.equal(threeSlice.text.includes('hair: silver (originally red)'), true);
  });

  it('matches adjacent RP formatting, enforces turnsById witness authority in public scenes, skips duplicating present subjects in Section 6, and orders story facts newest-first', () => {
    const { log, subjects } = createBookWithSubjects(['Frost', 'Lize', 'Collette', 'Al']);
    const turns = [
      {
        id: 't1',
        seq: 1,
        role: TurnRole.Assistant,
        mode: TurnMode.Normal,
        rawText: 'Quiet chat.',
        sceneNumber: 1,
        witnessIds: ['c-frost', 'c-lize'],
        beats: [{ id: 'b1', seq: 1, speakerType: SpeakerType.Character, characterId: 'c-lize', speakerName: 'Lize', text: 'Quiet chat.', witnessIds: ['c-frost', 'c-lize'] }],
      },
      {
        id: 't2',
        seq: 2,
        role: TurnRole.Assistant,
        mode: TurnMode.Normal,
        rawText: 'Hall talk.',
        sceneNumber: 1,
        witnessIds: ['c-frost', 'c-lize', 'c-collette'],
        beats: [{ id: 'b2', seq: 1, speakerType: SpeakerType.Character, characterId: 'c-collette', speakerName: 'Collette', text: 'Hall talk.', witnessIds: ['c-frost', 'c-lize', 'c-collette'] }],
      },
      {
        id: 't3',
        seq: 3,
        role: TurnRole.Assistant,
        mode: TurnMode.Normal,
        rawText: 'Later talk.',
        sceneNumber: 1,
        witnessIds: ['c-frost', 'c-lize', 'c-collette'],
        beats: [{ id: 'b3', seq: 1, speakerType: SpeakerType.Character, characterId: 'c-lize', speakerName: 'Lize', text: 'Later talk.', witnessIds: ['c-frost', 'c-lize', 'c-collette'] }],
      },
    ];

    let replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.rule(log, replayed.state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Collette,
      category: 'role',
      target: null,
      text: 'camp cook',
      hidden: false,
      cite: null,
      position: 0,
    });
    ScribeLogCore.rule(log, replayBook(log, turns, 'Frost').state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Al,
      category: 'role',
      target: null,
      text: 'stablehand',
      hidden: false,
      cite: null,
      position: 0,
    });

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 1,
          place: 'Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Hall',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'trait', target: null, text: 'quiet early', position: 1, hidden: false },
        { type: ScribeAnswer.Type.ThreadOpen, text: 'Meet "Collette"*waves* at dawn', position: 1 },
      ],
      { messages: [replayed.intake.messages[0]], origin: ScribeLogCore.Origin.Story },
    );

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 3,
          place: 'Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
            { subject: subjects.Collette, label: 'Collette', from: null, until: null },
          ],
          summary: 'Hall',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: 'trait', target: null, text: 'observant later', position: 3, hidden: false },
      ],
      { messages: replayed.intake.messages.slice(1, 3), origin: ScribeLogCore.Origin.Story },
    );

    const state = replayBook(log, turns, 'Frost').state;
    const turnsById = new Map(turns.map((turn) => [turn.id, turn]));
    const budget = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });
    const scene = { location: 'Hall', day: 1, timeLabel: '', sceneType: SceneType.Public, situation: '' };

    const colletteSlice = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: subjects.Collette, characterId: 'c-collette' },
      scene,
      presentSubjectIds: [subjects.Collette, subjects.Lize],
      namedText: 'I always check with Lize.',
      budget,
      turnsById,
    });
    assert.equal(colletteSlice.text.includes('Meet "Collette"*waves* at dawn'), false);
    assert.equal(colletteSlice.text.includes('Known facts:'), false);
    assert.deepEqual(colletteSlice.text.match(/^- Lize:/gm), ['- Lize:']);
    assert.equal(
      colletteSlice.text.indexOf('trait: observant later') < colletteSlice.text.indexOf('trait: quiet early'),
      true,
    );
    assert.equal(colletteSlice.text.includes('stablehand'), false);

    const lizeSlice = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: subjects.Lize, characterId: 'c-lize' },
      scene,
      presentSubjectIds: [subjects.Lize, subjects.Collette],
      budget,
      turnsById,
    });
    assert.equal(lizeSlice.text.includes('Meet "Collette"*waves* at dawn'), true);

    const rpNamedSlice = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: subjects.Lize, characterId: 'c-lize' },
      scene,
      presentSubjectIds: [subjects.Lize],
      namedText: '*smiles at Collette*"Hi!"',
      budget,
      turnsById,
    });
    assert.equal(rpNamedSlice.text.includes('Known facts:\n- Collette: role: camp cook'), true);
    assert.equal(rpNamedSlice.text.includes('stablehand'), false);
  });

  it('preserves card earliest decided sequence on re-Pin over player turn without falsely showing the player override as original', () => {
    const { log, subjects } = createBookWithSubjects(['Frost', 'Lize']);
    const turns = [
      { id: 't-black', seq: 1, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Lize dyes her hair black.', sceneNumber: 1, beats: [] },
      { id: 't-silver', seq: 2, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Lize dyes her hair silver.', sceneNumber: 1, beats: [] },
    ];

    let replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.rule(log, replayed.state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Lize,
      category: ScribeCategory.Names.Hair,
      target: null,
      text: 'red',
      hidden: false,
      cite: null,
      position: 0,
      decided: true,
    });

    replayed = replayBook(log, turns, 'Frost');
    const redFact = replayed.state.facts.find((fact) => fact.text === 'red');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 1,
          place: 'Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Hall',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: ScribeCategory.Names.Hair, target: null, text: 'black', position: 1, hidden: false },
      ],
      { messages: replayed.intake.messages.slice(0, 1), origin: ScribeLogCore.Origin.Story },
    );

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.rule(log, replayed.state, {
      type: ScribeLogCore.Ruling.Pin,
      subject: subjects.Lize,
      category: ScribeCategory.Names.Hair,
      target: null,
      text: 'red',
      hidden: false,
      winner: redFact.id,
    });

    const budget = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });
    const scene = { location: 'Hall', day: 1, timeLabel: '', sceneType: SceneType.Public, situation: '' };
    const repinState = replayBook(log, turns, 'Frost').state;
    const afterRepinSlice = StorySlice.build({
      state: repinState,
      viewer: { omniscient: false, subjectId: subjects.Frost },
      scene,
      presentSubjectIds: [subjects.Frost, subjects.Lize],
      budget,
    });
    assert.equal(afterRepinSlice.text.includes('- Lize: hair: red'), true);
    assert.equal(afterRepinSlice.text.includes('originally'), false);
    assert.equal(afterRepinSlice.text.includes('black'), false);

    ScribeLogCore.append(
      log,
      repinState,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 2,
          place: 'Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Hall',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: ScribeCategory.Names.Hair, target: null, text: 'silver', position: 2, hidden: false },
      ],
      { messages: replayed.intake.messages.slice(1, 2), origin: ScribeLogCore.Origin.Story },
    );

    const silverState = replayBook(log, turns, 'Frost').state;
    const afterSilverSlice = StorySlice.build({
      state: silverState,
      viewer: { omniscient: false, subjectId: subjects.Frost },
      scene,
      presentSubjectIds: [subjects.Frost, subjects.Lize],
      budget,
    });
    assert.equal(afterSilverSlice.text.includes('- Lize: hair: silver (originally red)'), true);
    assert.equal(afterSilverSlice.text.includes('originally black'), false);
  });

  it('retains earliest Pin sequence in pinDecided when a story fact is pinned before and after a player override', () => {
    const { log, subjects } = createBookWithSubjects(['Frost', 'Lize']);
    const turns = [
      { id: 't-story-red', seq: 1, role: TurnRole.Assistant, mode: TurnMode.Normal, rawText: 'Lize has red hair.', sceneNumber: 1, beats: [] },
      { id: 't-player-black', seq: 2, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Lize dyes her hair black.', sceneNumber: 1, beats: [] },
    ];

    let replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 1,
          place: 'Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Hall',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: ScribeCategory.Names.Hair, target: null, text: 'red', position: 1, hidden: false },
      ],
      { messages: replayed.intake.messages.slice(0, 1), origin: ScribeLogCore.Origin.Story },
    );

    replayed = replayBook(log, turns, 'Frost');
    const redFact = replayed.state.facts.find((fact) => fact.text === 'red');
    const firstPinEntry = ScribeLogCore.rule(log, replayed.state, {
      type: ScribeLogCore.Ruling.Pin,
      subject: subjects.Lize,
      category: ScribeCategory.Names.Hair,
      target: null,
      text: 'red',
      hidden: false,
      winner: redFact.id,
    });

    replayed = replayBook(log, turns, 'Frost');
    const playerAppend = ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 2,
          place: 'Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Hall',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Lize', category: ScribeCategory.Names.Hair, target: null, text: 'black', position: 2, hidden: false },
      ],
      { messages: replayed.intake.messages.slice(1, 2), origin: ScribeLogCore.Origin.Story },
    );

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.rule(log, replayed.state, {
      type: ScribeLogCore.Ruling.Pin,
      subject: subjects.Lize,
      category: ScribeCategory.Names.Hair,
      target: null,
      text: 'red',
      hidden: false,
      winner: redFact.id,
    });

    const finalState = replayBook(log, turns, 'Frost').state;
    assert.equal(finalState.decidedFacts[redFact.id], firstPinEntry.sequence);
    assert.equal(finalState.decidedFacts[redFact.id] < playerAppend.entry.sequence, true);

    const budget = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });
    const scene = { location: 'Hall', day: 1, timeLabel: '', sceneType: SceneType.Public, situation: '' };
    const slice = StorySlice.build({
      state: finalState,
      viewer: { omniscient: false, subjectId: subjects.Frost },
      scene,
      presentSubjectIds: [subjects.Frost, subjects.Lize],
      budget,
    });
    assert.equal(slice.text.includes('- Lize: hair: red'), true);
    assert.equal(slice.text.includes('(originally black)'), false);
  });

  it('gates private-scene Story aliases via turnsById across Sections 4-6 for absent, witnessing, and omniscient viewers', () => {
    const { log, subjects } = createBookWithSubjects(['Frost', 'Lize', 'Collette', 'Shadow']);
    const turns = [
      {
        id: 't-public-early',
        seq: 1,
        role: TurnRole.User,
        mode: TurnMode.Normal,
        rawText: 'Hall meeting.',
        sceneNumber: 1,
        witnessIds: ['c-frost', 'c-lize', 'c-collette'],
        beats: [{ id: 'b-early', seq: 1, speakerType: SpeakerType.Player, characterId: 'c-frost', speakerName: 'Frost', text: 'Hall meeting.', witnessIds: ['c-frost', 'c-lize', 'c-collette'] }],
      },
      {
        id: 't-private-alias',
        seq: 2,
        role: TurnRole.Assistant,
        mode: TurnMode.Normal,
        rawText: 'Whispered alias exchange.',
        sceneNumber: 2,
        witnessIds: ['c-frost'],
        beats: [{ id: 'b-priv', seq: 1, speakerType: SpeakerType.Character, characterId: 'c-lize', speakerName: 'Lize', text: 'Call me Nightjar and tell Whisper.', witnessIds: ['c-frost', 'c-lize'] }],
      },
      {
        id: 't-public-thread',
        seq: 3,
        role: TurnRole.User,
        mode: TurnMode.Normal,
        rawText: 'Back in the hall.',
        sceneNumber: 3,
        witnessIds: ['c-frost', 'c-lize', 'c-collette'],
        beats: [{ id: 'b-pub', seq: 1, speakerType: SpeakerType.Player, characterId: 'c-frost', speakerName: 'Frost', text: 'Back in the hall.', witnessIds: ['c-frost', 'c-lize', 'c-collette'] }],
      },
    ];

    let replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.rule(log, replayed.state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: subjects.Shadow,
      category: 'role',
      target: null,
      text: 'courier',
      hidden: false,
      cite: null,
      position: 0,
    });

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 1,
          last: 1,
          place: 'Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
            { subject: subjects.Collette, label: 'Collette', from: null, until: null },
          ],
          summary: 'Hall',
        },
        { type: ScribeAnswer.Type.Fact, label: 'Collette', category: ScribeCategory.Settings.RelationCategory, target: 'Nightjar', text: 'avoids contact', position: 1, hidden: false },
      ],
      { messages: replayed.intake.messages.slice(0, 1), origin: ScribeLogCore.Origin.Story },
    );

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 2,
          last: 2,
          place: 'Cellar',
          reach: ScribeAnswer.Reach.Private,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
          ],
          summary: 'Cellar',
        },
        { type: ScribeAnswer.Type.Alias, label: 'Lize', name: 'Nightjar', position: 2 },
        { type: ScribeAnswer.Type.Alias, label: 'Shadow', name: 'Whisper', position: 2 },
      ],
      { messages: replayed.intake.messages.slice(1, 2), origin: ScribeLogCore.Origin.Story },
    );

    replayed = replayBook(log, turns, 'Frost');
    ScribeLogCore.append(
      log,
      replayed.state,
      [
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 3,
          last: 3,
          place: 'Hall',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: subjects.Frost, label: 'Frost', from: null, until: null },
            { subject: subjects.Lize, label: 'Lize', from: null, until: null },
            { subject: subjects.Collette, label: 'Collette', from: null, until: null },
          ],
          summary: 'Hall',
        },
        { type: ScribeAnswer.Type.ThreadOpen, text: 'Ask Nightjar about the map', position: 3 },
      ],
      { messages: replayed.intake.messages.slice(2, 3), origin: ScribeLogCore.Origin.Story },
    );

    const state = replayBook(log, turns, 'Frost').state;
    const turnsById = new Map(turns.map((turn) => [turn.id, turn]));
    const budget = RequestBudget.create({ contextLength: null, replyReserve: 3000, charsPerToken: 3 });
    const scene = { location: 'Hall', day: 1, timeLabel: '', sceneType: SceneType.Public, situation: '' };

    const colletteSlice = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: subjects.Collette, characterId: 'c-collette' },
      scene,
      presentSubjectIds: [subjects.Lize, subjects.Collette],
      namedText: 'Someone mentioned Whisper.',
      budget,
      turnsById,
    });
    assert.equal(colletteSlice.text.includes('avoids contact'), false);
    assert.equal(colletteSlice.text.includes('Ask Nightjar about the map'), false);
    assert.equal(colletteSlice.text.includes('courier'), false);

    const lizeSlice = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: subjects.Lize, characterId: 'c-lize' },
      scene,
      presentSubjectIds: [subjects.Lize, subjects.Collette],
      namedText: 'Someone mentioned Whisper.',
      budget,
      turnsById,
    });
    assert.equal(lizeSlice.text.includes('- Collette -> Nightjar: avoids contact'), true);
    assert.equal(lizeSlice.text.includes('- Ask Nightjar about the map'), true);
    assert.equal(lizeSlice.text.includes('Known facts:\n- Shadow: role: courier'), true);

    const narratorSlice = StorySlice.build({
      state,
      viewer: { omniscient: true, subjectId: null },
      scene,
      presentSubjectIds: [subjects.Lize, subjects.Collette],
      namedText: 'Someone mentioned Whisper.',
      budget,
      turnsById,
    });
    assert.equal(narratorSlice.text.includes('- Collette -> Nightjar: avoids contact'), true);
    assert.equal(narratorSlice.text.includes('- Ask Nightjar about the map'), true);
    assert.equal(narratorSlice.text.includes('Known facts:\n- Shadow: role: courier'), true);

    const colletteWithoutTurns = StorySlice.build({
      state,
      viewer: { omniscient: false, subjectId: subjects.Collette, characterId: 'c-collette' },
      scene,
      presentSubjectIds: [subjects.Lize, subjects.Collette],
      namedText: 'Someone mentioned Whisper.',
      budget,
      turnsById: null,
    });
    assert.equal(colletteWithoutTurns.text.includes('Known facts:\n- Shadow: role: courier'), true);
  });
});

describe('TagReader', () => {
  const SAMPLE_TAG_SCENE = 'scene';
  const SAMPLE_TAG_DIRECTION = 'direction';
  const SAMPLE_TAG_WALKONS = 'walkons';
  const SAMPLE_TAG_THOUGHTS = 'thoughts';
  const SAMPLE_TAG_NEXT = 'next';
  const SAMPLE_TAG_NARRATOR = 'narrator';

  it('reads paired, self-closing, mixed-case, and nested-looking tags while ignoring single-quoted, unquoted, and forbidden attributes', () => {
    const complexPayload = [
      '<SCENERY>Oak trees</SCENERY>',
      '<scene:extra>Colon name</scene:extra>',
      '<SCENE CHANGED="yes" To="ignore-me" __proto__="evil" constructor="evil" prototype="evil">First | day 1 | Dawn | public</scene   >',
      '<direction TO="lize" to=\'single\' fake=\'to="evil"\' note="a > b" slash="x/>y" unquoted=yes LENGTH="short">Greet <em class="x">Frost</em></direction>',
      '<walkons enter="Guard, Gatekeeper" leave="Bram"/>',
      '<walkons enter="Courier" />',
      '<scene>outer <scene>inner</scene></scene>',
      '<scene attr="unclosed>Broken<scene changed="no">Recovered</scene>',
      '<scene>Trailing unclosed',
    ].join('\n');

    const sceneMatches = TagReader.read(complexPayload, SAMPLE_TAG_SCENE);
    assert.equal(Object.isFrozen(sceneMatches), true);
    assert.equal(sceneMatches.length, 3);
    assert.deepEqual(sceneMatches[0].attributes, { changed: 'yes', to: 'ignore-me' });
    assert.equal(Object.isFrozen(sceneMatches[0]), true);
    assert.equal(Object.isFrozen(sceneMatches[0].attributes), true);
    assert.equal(sceneMatches[0].body, 'First | day 1 | Dawn | public');
    assert.equal(sceneMatches[1].body, 'outer <scene>inner</scene>');
    assert.deepEqual(sceneMatches[2].attributes, { changed: 'no' });
    assert.equal(sceneMatches[2].body, 'Recovered');

    const directionMatches = TagReader.read(complexPayload, SAMPLE_TAG_DIRECTION);
    assert.equal(directionMatches.length, 1);
    assert.deepEqual(directionMatches[0].attributes, {
      to: 'lize',
      note: 'a > b',
      slash: 'x/>y',
      length: 'short',
    });
    assert.equal(Object.hasOwn(directionMatches[0].attributes, 'fake'), false);
    assert.equal(Object.hasOwn(directionMatches[0].attributes, 'unquoted'), false);
    assert.equal(directionMatches[0].body, 'Greet <em class="x">Frost</em>');

    const walkOnMatches = TagReader.read(complexPayload, SAMPLE_TAG_WALKONS);
    assert.equal(walkOnMatches.length, 2);
    assert.deepEqual(walkOnMatches[0], { attributes: { enter: 'Guard, Gatekeeper', leave: 'Bram' }, body: '' });
    assert.deepEqual(walkOnMatches[1], { attributes: { enter: 'Courier' }, body: '' });

    const brokenOuterThenValid = '<scene>broken outer <scene changed="no">valid inner</scene>';
    const recoveredOnlyValid = TagReader.read(brokenOuterThenValid, SAMPLE_TAG_SCENE);
    assert.equal(recoveredOnlyValid.length, 1);
    assert.equal(recoveredOnlyValid[0].body, 'valid inner');

    const nestedOther = '<narrator>Shadows fall over <unknown>the well</unknown>.</narrator>';
    assert.equal(TagReader.read(nestedOther, SAMPLE_TAG_NARRATOR)[0].body, 'Shadows fall over <unknown>the well</unknown>.');
  });

  it('strips matched paired and self-closing tags via outside() while keeping unclosed and unrelated text', () => {
    const text = [
      '<THOUGHTS>I wonder if <next>lize</next> knows</THOUGHTS>',
      'Visible line one.',
      '<NEXT>lize</next>',
      '<scenery>Pine</scenery>',
      '<walkons enter="Guard"/>',
      '<thoughts>Unclosed kept <next>stripped inside unclosed</next>',
    ].join('\n');

    const cleaned = TagReader.outside(text, [SAMPLE_TAG_THOUGHTS, SAMPLE_TAG_NEXT, SAMPLE_TAG_WALKONS]);
    assert.equal(cleaned.includes('I wonder'), false);
    assert.equal(cleaned.includes('Visible line one.'), true);
    assert.equal(cleaned.includes('<scenery>Pine</scenery>'), true);
    assert.equal(cleaned.includes('Guard'), false);
    assert.equal(cleaned.includes('<thoughts>Unclosed kept'), true);
    assert.equal(cleaned.includes('stripped inside unclosed'), false);
    assert.equal(TagReader.outside('  Untouched text  ', []), 'Untouched text');
  });

  it('rejects invalid inputs with TypeError or RangeError', () => {
    for (const badText of [null, 42, {}, []]) {
      assert.throws(() => TagReader.read(badText, SAMPLE_TAG_SCENE), TypeError);
      assert.throws(() => TagReader.outside(badText, [SAMPLE_TAG_SCENE]), TypeError);
    }
    for (const badTagName of [null, 123, {}]) {
      assert.throws(() => TagReader.read('hi', badTagName), TypeError);
      assert.throws(() => TagReader.outside('hi', [badTagName]), TypeError);
    }
    for (const badPatternName of ['', '1scene', 'bad tag', 'bad:tag', ' scene']) {
      assert.throws(() => TagReader.read('hi', badPatternName), RangeError);
      assert.throws(() => TagReader.outside('hi', [badPatternName]), RangeError);
    }
    for (const badList of [null, SAMPLE_TAG_SCENE, {}]) {
      assert.throws(() => TagReader.outside('hi', badList), TypeError);
    }
  });

  it('scans pathological unclosed and repeat tag streams in linear time', () => {
    const repeatCount = 6000;
    const maxLinearMs = 100;
    const unclosedTags = '<scene>'.repeat(repeatCount);
    const unclosedQuotes = '<scene a="'.repeat(repeatCount);

    const tagsStartMs = performance.now();
    const unclosedResult = TagReader.read(unclosedTags, SAMPLE_TAG_SCENE);
    const tagsElapsedMs = performance.now() - tagsStartMs;
    assert.deepEqual(unclosedResult, []);
    assert.ok(tagsElapsedMs < maxLinearMs);

    const quotesStartMs = performance.now();
    const quotesResult = TagReader.read(unclosedQuotes, SAMPLE_TAG_SCENE);
    const quotesElapsedMs = performance.now() - quotesStartMs;
    assert.deepEqual(quotesResult, []);
    assert.ok(quotesElapsedMs < maxLinearMs);

    const nestedWithClose = `${unclosedTags}</scene>`;
    const singleCloseStartMs = performance.now();
    const singleCloseMatches = TagReader.read(nestedWithClose, SAMPLE_TAG_SCENE);
    const singleCloseElapsedMs = performance.now() - singleCloseStartMs;
    assert.equal(singleCloseMatches.length, 1);
    assert.equal(singleCloseMatches[0].body, '');
    assert.ok(singleCloseElapsedMs < maxLinearMs);

    const pathologicalCases = [
      `${'<scene '.repeat(repeatCount)}It's quiet.</narrator>`,
      `${'<scene a="'.repeat(repeatCount)}'>`,
      `${'<scene x="1" a="'.repeat(repeatCount)}'>`,
    ];
    for (const pathologicalInput of pathologicalCases) {
      const caseStartMs = performance.now();
      const caseMatches = TagReader.read(pathologicalInput, SAMPLE_TAG_SCENE);
      const caseElapsedMs = performance.now() - caseStartMs;
      assert.deepEqual(caseMatches, []);
      assert.ok(caseElapsedMs < maxLinearMs);
    }
  });
});

describe('Director tagged parsing, styles, modes, and budgeted recent turns', () => {
  /**
   * @param {string} replyText
   * @param {object} [extraOptions]
   * @returns {Promise<{result: object, calls: Array<{payload: object}>}>}
   * @throws {Error}
   */
  async function runDirectorWithReply(replyText, extraOptions = {}) {
    const ownedFixture = extraOptions.fixture === undefined;
    const fixture = ownedFixture ? createWorldFixture() : extraOptions.fixture;
    const { store, campaign, frost, lize, viola, collette } = fixture;
    const { client, calls } = createScriptedClient([{ text: replyText }], { store });
    try {
      const result = await Director.planTurn({
        campaign,
        characters: extraOptions.characters ?? [frost, lize, viola, collette],
        preState: extraOptions.preState ?? campaign.sceneState,
        recentTurns: extraOptions.recentTurns ?? [],
        userText: extraOptions.userText ?? 'Hello.',
        narrationText: extraOptions.narrationText ?? null,
        mode: extraOptions.mode ?? TurnMode.Normal,
        encounterRoll: extraOptions.encounterRoll ?? {
          triggered: false,
          forced: false,
          plausibilityRequired: false,
          targetKind: null,
          stance: null,
        },
        model: 'openai/gpt-4.1-mini',
        client,
        maxResponders: extraOptions.maxResponders ?? null,
        budget: extraOptions.budget ?? null,
      });
      return { result, calls };
    } finally {
      if (ownedFixture) {
        store.close();
      }
    }
  }

  it('ignores broken and unknown tags, preserves omitted present/remote, and clears empty present before player auto-insert', async () => {
    const fixture = createWorldFixture();
    const { campaign, frost, lize, collette } = fixture;
    const preStateWithRemote = {
      ...campaign.sceneState,
      presentIds: [frost.id, lize.id],
      remoteIds: [collette.id],
    };

    const omittedPresence = await runDirectorWithReply(
      [
        '<unknown>ignored</unknown>',
        '<narrator>Broken unclosed',
        '<situation>Quiet watch.</situation>',
      ].join('\n'),
      { fixture, preState: preStateWithRemote },
    );
    assert.equal(omittedPresence.result.plan.directorMissed, false);
    assert.deepEqual(omittedPresence.result.nextState.presentIds, [frost.id, lize.id]);
    assert.deepEqual(omittedPresence.result.nextState.remoteIds, [collette.id]);
    assert.equal(omittedPresence.result.plan.narratorDirective, '');
    assert.equal(omittedPresence.result.plan.situation, 'Quiet watch.');

    const clearedPresentAutoInsert = await runDirectorWithReply(
      [
        '<present></present>',
        '<remote></remote>',
        '<input>player</input>',
      ].join('\n'),
      { fixture, preState: preStateWithRemote },
    );
    assert.deepEqual(clearedPresentAutoInsert.result.nextState.presentIds, [frost.id]);
    assert.deepEqual(clearedPresentAutoInsert.result.nextState.remoteIds, []);

    const clearedPresentNarrator = await runDirectorWithReply(
      [
        '<present></present>',
        '<remote></remote>',
        '<input>narrator</input>',
      ].join('\n'),
      { fixture, preState: preStateWithRemote },
    );
    assert.deepEqual(clearedPresentNarrator.result.nextState.presentIds, []);
    assert.deepEqual(clearedPresentNarrator.result.nextState.remoteIds, []);
    fixture.store.close();
  });

  it('enforces Narrator and Encounter mode overrides, narrator_only suppression, and maxResponders on full miss', async () => {
    const narratorOverride = await runDirectorWithReply(
      [
        '<input>player</input>',
        '<encounter accepted="yes">Bandits ambush!</encounter>',
        `<pacing>${Director.Settings.Pacing.NarratorOnly}</pacing>`,
        `<direction to="lize" length="${Director.Settings.Length.Short}">Should drop under narrator_only</direction>`,
      ].join('\n'),
      {
        mode: TurnMode.Narrator,
        encounterRoll: { triggered: true, forced: false, plausibilityRequired: false, targetKind: 'cast', stance: 'enemy' },
      },
    );
    assert.equal(narratorOverride.result.plan.userInputKind, Director.Settings.InputKind.NarratorDirection);
    assert.equal(narratorOverride.result.plan.encounterAccepted, false);
    assert.equal(narratorOverride.result.plan.encounterBrief, '');
    assert.deepEqual(narratorOverride.result.plan.responders, []);

    const encounterMiss = await runDirectorWithReply('untagged miss', {
      mode: TurnMode.Encounter,
      encounterRoll: { triggered: true, forced: true, plausibilityRequired: false, targetKind: 'stranger', stance: 'enemy' },
    });
    assert.equal(encounterMiss.result.plan.directorMissed, true);
    assert.equal(encounterMiss.result.plan.encounterAccepted, true);
    assert.ok(encounterMiss.result.plan.encounterBrief.length > 0);
    assert.equal(encounterMiss.result.plan.style, SceneStyle.None);

    const fixture = createWorldFixture();
    const { campaign, frost, lize, viola } = fixture;
    const cappedMiss = await runDirectorWithReply('untagged miss', {
      fixture,
      preState: { ...campaign.sceneState, presentIds: [frost.id, lize.id, viola.id] },
      maxResponders: 1,
    });
    assert.equal(cappedMiss.result.plan.responders.length, 1);
    assert.equal(cappedMiss.result.plan.responders[0].slug, 'lize');
    fixture.store.close();
  });

  it('lists all 8 scene styles in prompt and parses <style> case-insensitively with first-tag and fallback rules', async () => {
    const combatCase = await runDirectorWithReply('<style>  Combat  </style>');
    assert.equal(combatCase.result.plan.style, SceneStyle.Combat);
    const systemPrompt = combatCase.calls[0].payload.messages[0].content;
    for (const styleName of SceneStyle.AllValues) {
      assert.equal(systemPrompt.includes(`- ${styleName}:`), true);
    }

    const unknownStyle = await runDirectorWithReply('<style>dance</style>');
    assert.equal(unknownStyle.result.plan.style, SceneStyle.None);

    const twoStyles = await runDirectorWithReply(
      `<style>${SceneStyle.Explicit}</style>\n<style>${SceneStyle.Banter}</style>`,
    );
    assert.equal(twoStyles.result.plan.style, SceneStyle.Explicit);
  });

  it('drops oldest RECENT TURNS whole when budget is tight and rejects bad budget or narrationText', async () => {
    const fixture = createWorldFixture();
    const { store, campaign, frost, lize } = fixture;
    const { client: probeClient, calls: probeCalls } = createScriptedClient([{ text: '<style>none</style>' }], { store });
    await Director.planTurn({
      campaign,
      characters: [frost, lize],
      preState: campaign.sceneState,
      recentTurns: [],
      userText: 'Probe',
      mode: TurnMode.Normal,
      encounterRoll: { triggered: false, forced: false, plausibilityRequired: false, targetKind: null, stance: null },
      model: 'openai/gpt-4.1-mini',
      client: probeClient,
    });

    const probeBudget = RequestBudget.create({
      contextLength: null,
      replyReserve: 3000,
      charsPerToken: RequestBudget.StartingCharsPerToken,
    });
    const baseTokens = probeBudget.estimate(probeCalls[0].payload.messages[0].content) +
      probeBudget.estimate(probeCalls[0].payload.messages[1].content);
    const tightBudget = RequestBudget.create({
      contextLength: 3000 + baseTokens + 75,
      replyReserve: 3000,
      charsPerToken: RequestBudget.StartingCharsPerToken,
    });

    const turns = [];
    for (let turnSeq = 1; turnSeq <= 10; turnSeq += 1) {
      turns.push({
        id: `turn-${turnSeq}`,
        seq: turnSeq,
        sceneNumber: 1,
        mode: TurnMode.Normal,
        beats: [{ speakerName: 'Frost', text: `UNIQUE_TURN_${turnSeq} ${'w'.repeat(70)}` }],
      });
    }

    const budgeted = await runDirectorWithReply('<style>none</style>', {
      fixture,
      characters: [frost, lize],
      recentTurns: turns,
      userText: 'Probe',
      budget: tightBudget,
    });
    const sentUserPrompt = budgeted.calls[0].payload.messages[1].content;
    const sentSystemPrompt = budgeted.calls[0].payload.messages[0].content;
    assert.equal(sentUserPrompt.includes('UNIQUE_TURN_10'), true);
    assert.equal(sentUserPrompt.includes('UNIQUE_TURN_1 '), false);
    assert.equal(sentUserPrompt.includes('UNIQUE_TURN_2 '), false);
    assert.ok(
      tightBudget.estimate(sentSystemPrompt) + tightBudget.estimate(sentUserPrompt) <= tightBudget.limitTokens,
    );

    const { client: badClient } = createScriptedClient([], { store });
    const baseCall = {
      campaign,
      characters: [frost, lize],
      preState: campaign.sceneState,
      userText: 'Hi',
      mode: TurnMode.Normal,
      encounterRoll: { triggered: false, forced: false, plausibilityRequired: false, targetKind: null, stance: null },
      model: 'openai/gpt-4.1-mini',
      client: badClient,
    };
    await assert.rejects(() => Director.planTurn({ ...baseCall, narrationText: 5 }), TypeError);
    await assert.rejects(() => Director.planTurn({ ...baseCall, budget: {} }), TypeError);
    await assert.rejects(
      () => Director.planTurn({
        ...baseCall,
        budget: {
          limitTokens: -1,
          /**
           * @returns {number}
           */
          estimate() {
            return 0;
          },
          /**
           * @returns {boolean}
           */
          fits() {
            return true;
          },
        },
      }),
      RangeError,
    );
    store.close();
  });

  it('resolves non-participant, self, and player reacting slugs to player', async () => {
    const fixture = createWorldFixture();
    const { campaign, frost, lize, collette } = fixture;
    const preState = {
      ...campaign.sceneState,
      presentIds: [frost.id, lize.id, collette.id],
      remoteIds: [],
    };
    try {
      const absentReacting = await runDirectorWithReply(
        `<direction to="lize" reacting="viola" length="${Director.Settings.Length.Medium}">Watch the hall.</direction>`,
        { fixture, preState },
      );
      assert.equal(absentReacting.result.plan.responders.length, 1);
      assert.equal(absentReacting.result.plan.responders[0].reacting, Director.Settings.ReactingPlayer);

      const selfReacting = await runDirectorWithReply(
        `<direction to="lize" reacting="lize" length="${Director.Settings.Length.Medium}">Steady yourself.</direction>`,
        { fixture, preState },
      );
      assert.equal(selfReacting.result.plan.responders.length, 1);
      assert.equal(selfReacting.result.plan.responders[0].reacting, Director.Settings.ReactingPlayer);

      const playerReacting = await runDirectorWithReply(
        `<direction to="lize" reacting="frost" length="${Director.Settings.Length.Medium}">Answer Frost.</direction>`,
        { fixture, preState },
      );
      assert.equal(playerReacting.result.plan.responders.length, 1);
      assert.equal(playerReacting.result.plan.responders[0].reacting, Director.Settings.ReactingPlayer);

      const participantReacting = await runDirectorWithReply(
        `<direction to="lize" reacting="collette" length="${Director.Settings.Length.Medium}">Answer Collette.</direction>`,
        { fixture, preState },
      );
      assert.equal(participantReacting.result.plan.responders.length, 1);
      assert.equal(participantReacting.result.plan.responders[0].reacting, collette.slug);
    } finally {
      fixture.store.close();
    }
  });

  it('passes player narrationText cleanly from TurnEngine to Director, Narrator, and CharacterBrain on both Send and Regenerate', async () => {
    const fixture = createWorldFixture({ scribeInterval: 10, pedantEnabled: false });
    const { store, campaign } = fixture;
    const directorResponse = buildTaggedDirectorPlan({
      presentSlugs: ['frost', 'lize'],
      pacing: Director.Settings.Pacing.FocusedOne,
      responders: [{ slug: 'lize', beatGoal: 'React', length: Director.Settings.Length.Short }],
      narratorDirective: 'Keep steady.',
    });
    const { client, calls } = createScriptedClient([
      { text: directorResponse },
      buildNarratorStreamEntry('The room goes dark.'),
      buildBrainStreamEntry({ thoughts: 'Okay.', reply: 'Understood.' }),
      { text: directorResponse },
      buildNarratorStreamEntry('The room darkens once more.'),
      buildBrainStreamEntry({ thoughts: 'Ready.', reply: 'Understood again.' }),
    ], { store });

    const engine = new TurnEngine({
      store,
      client,
      scribeService: new ScribeService({ store }),
      modelCatalog: createContextCatalog(),
    });
    await engine.runTurn({
      campaignId: campaign.id,
      text: 'I step forward.',
      narration: 'The lantern goes out.',
      mode: TurnMode.Normal,
    });
    await engine.regenerateLastTurn({ campaignId: campaign.id });

    const sendDirectorPrompt = calls[0].payload.messages[1].content;
    const regenDirectorPrompt = calls[3].payload.messages[1].content;
    assert.equal(sendDirectorPrompt.includes('userText: I step forward.\nnarration: The lantern goes out.'), true);
    assert.equal(regenDirectorPrompt.includes('userText: I step forward.\nnarration: The lantern goes out.'), true);
    const expectedThisTurn = 'Frost: I step forward.\nNarrator: The lantern goes out.';
    for (const downstreamIndex of [1, 2, 4, 5]) {
      assert.equal(calls[downstreamIndex].payload.messages[1].content.includes(expectedThisTurn), true);
    }
    store.close();
  });
});

describe('ReplyStreamSplitter', () => {
  const TAG_REPLY = CharacterBrain.Settings.Tag.Reply;
  const TAG_THOUGHTS = CharacterBrain.Settings.Tag.Thoughts;
  const TAG_NEXT = CharacterBrain.Settings.Tag.Next;
  const EMPTY_TEXT = ReplyStreamSplitter.Settings.EmptyText;

  /**
   * @param {string} rawText
   * @param {string} visibleTag
   * @param {readonly string[]} hiddenTags
   * @returns {{deltas: string[], result: Readonly<{visible: string, raw: string}>}}
   * @throws {TypeError | RangeError}
   */
  function splitOneCharAtATime(rawText, visibleTag, hiddenTags) {
    const splitter = new ReplyStreamSplitter({ visibleTag, hiddenTags });
    const deltas = [];
    for (let charIndex = 0; charIndex < rawText.length; charIndex += 1) {
      const emitted = splitter.push(rawText[charIndex]);
      if (emitted.length > 0) {
        deltas.push(emitted);
      }
    }
    return { deltas, result: splitter.finish() };
  }

  it('extracts visible tag across split tag chunks and 1-char-at-a-time streaming', () => {
    const chunkedSplitter = new ReplyStreamSplitter({ visibleTag: TAG_REPLY, hiddenTags: [TAG_THOUGHTS] });
    const emittedChunks = [
      chunkedSplitter.push('<rep'),
      chunkedSplitter.push('ly>Hi'),
      chunkedSplitter.push(' there</rep'),
      chunkedSplitter.push('ly>'),
    ];
    assert.deepEqual(emittedChunks, ['', 'Hi', ' there', '']);
    const chunkedDone = chunkedSplitter.finish();
    assert.equal(Object.isFrozen(chunkedDone), true);
    assert.deepEqual(chunkedDone, {
      visible: 'Hi there',
      raw: '<reply>Hi there</reply>',
    });

    const complexStream = [
      '<thoughts>Think carefully.</thoughts>',
      '<replying>Wrong tag</replying>',
      '<reply/>',
      '<reply note="a > b">Actual <i>streamed</i> reply.</reply>',
      '<thoughts>Trailing private thought</thoughts>',
    ].join(EMPTY_TEXT);
    const charByChar = splitOneCharAtATime(complexStream, TAG_REPLY, [TAG_THOUGHTS]);
    assert.equal(charByChar.deltas.join(EMPTY_TEXT), 'Actual <i>streamed</i> reply.');
    assert.equal(charByChar.result.visible, 'Actual <i>streamed</i> reply.');
    assert.equal(charByChar.result.raw, complexStream);
  });

  it('never leaks thoughts before, between, after, nested, or containing fake reply tags', () => {
    const hostileInput = [
      '<thoughts>Before thoughts with </reply> and <reply>fake</reply> and ',
      '<thoughts>nested </reply> <reply>nested fake</reply></thoughts> still hidden</thoughts>',
      '<reply>Real visible text.</reply>',
      '<thoughts>Between thoughts</thoughts>',
      '<reply>Second visible part.</reply>',
      '<thoughts>After thoughts</thoughts>',
    ].join(EMPTY_TEXT);

    const singleChunkSplitter = new ReplyStreamSplitter({
      visibleTag: TAG_REPLY,
      hiddenTags: [TAG_THOUGHTS, TAG_NEXT],
    });
    const wholeEmitted = singleChunkSplitter.push(hostileInput);
    const wholeDone = singleChunkSplitter.finish();
    assert.equal(wholeEmitted, 'Real visible text.Second visible part.');
    assert.equal(wholeDone.visible, 'Real visible text.Second visible part.');
    assert.equal(wholeDone.visible.includes('fake'), false);
    assert.equal(wholeDone.visible.includes('Before thoughts'), false);
    assert.equal(wholeDone.visible.includes('still hidden'), false);
    assert.equal(wholeDone.visible.includes('Between thoughts'), false);
    assert.equal(wholeDone.visible.includes('After thoughts'), false);

    const perChar = splitOneCharAtATime(hostileInput, TAG_REPLY, [TAG_THOUGHTS, TAG_NEXT]);
    assert.equal(perChar.deltas.join(EMPTY_TEXT), 'Real visible text.Second visible part.');
    assert.equal(perChar.result.visible, 'Real visible text.Second visible part.');
  });

  it('recovers visible tags after empty closed tags and suppresses hidden tags nested inside visible text', () => {
    const emptyThenTruncated = new ReplyStreamSplitter({
      visibleTag: TAG_REPLY,
      hiddenTags: [TAG_THOUGHTS, TAG_NEXT],
    });
    assert.equal(emptyThenTruncated.push('<reply></reply><reply>Cut off'), 'Cut off');
    assert.equal(emptyThenTruncated.finish().visible, 'Cut off');

    const nestedHiddenStream = [
      '<reply>"Hello." ',
      '<thoughts attr=">">SECRET_NESTED<thoughts>DEEPER</thoughts><thoughts/>',
      '</thoughts>',
      '<next>Collette</next>',
      '<thoughts/>',
      'world!</reply>',
      '<thoughts>TRAILING_SECRET</thoughts>',
    ].join(EMPTY_TEXT);
    const nestedPerChar = splitOneCharAtATime(nestedHiddenStream, TAG_REPLY, [TAG_THOUGHTS, TAG_NEXT]);
    assert.equal(nestedPerChar.deltas.join(EMPTY_TEXT), '"Hello." world!');
    assert.equal(nestedPerChar.result.visible, '"Hello." world!');

    const truncatedHiddenPrefix = new ReplyStreamSplitter({
      visibleTag: TAG_REPLY,
      hiddenTags: [TAG_THOUGHTS, TAG_NEXT],
    });
    assert.equal(truncatedHiddenPrefix.push('<reply>Hi <thou'), 'Hi ');
    assert.equal(truncatedHiddenPrefix.finish().visible, 'Hi ');

    const truncatedNextPrefix = new ReplyStreamSplitter({
      visibleTag: TAG_REPLY,
      hiddenTags: [TAG_THOUGHTS, TAG_NEXT],
    });
    assert.equal(truncatedNextPrefix.push('<reply>Hi <nex'), 'Hi ');
    assert.equal(truncatedNextPrefix.finish().visible, 'Hi ');

    const trailingProseAngle = new ReplyStreamSplitter({
      visibleTag: TAG_REPLY,
      hiddenTags: [TAG_THOUGHTS, TAG_NEXT],
    });
    assert.equal(trailingProseAngle.push('<reply>a <'), 'a ');
    assert.equal(trailingProseAngle.finish().visible, 'a <');
  });

  it('enforces tag-name boundaries, self-closing tags, quotes, and case-insensitive tags', () => {
    const splitter = new ReplyStreamSplitter({ visibleTag: TAG_REPLY, hiddenTags: [TAG_THOUGHTS] });
    const pieces = [
      splitter.push('<reply'),
      splitter.push('ing>nope</replying>'),
      splitter.push('<reply_alt>nope</reply_alt>'),
      splitter.push('<reply /><reply a="1" />'),
      splitter.push('<THOUGHTS attr=">" nested=\'x/>\'>Secret<thoughts/> still secret</tHoUgHtS>'),
      splitter.push('<REPLY attr="x>y">'),
      splitter.push('Hi'),
      splitter.push('</rEpLy   '),
      splitter.push('>'),
    ];
    assert.equal(pieces.join(EMPTY_TEXT), 'Hi');
    assert.equal(splitter.finish().visible, 'Hi');
  });

  it('streams prose less-than and non-matching tags immediately without stalling inside visible text', () => {
    const splitter = new ReplyStreamSplitter({ visibleTag: TAG_REPLY, hiddenTags: [TAG_THOUGHTS] });
    assert.equal(splitter.push('<reply>a < b and '), 'a < b and ');
    assert.equal(splitter.push('<i>hi</i> and '), '<i>hi</i> and ');
    assert.equal(splitter.push('</rep'), '');
    assert.equal(splitter.push('lying>ok</reply>'), '</replying>ok');
    assert.equal(splitter.push(' trailing'), '');
    assert.equal(splitter.finish().visible, 'a < b and <i>hi</i> and </replying>ok');
  });

  it('flushes trailing visible text on truncation while discarding partial closing tag fragments', () => {
    const plainTruncated = new ReplyStreamSplitter({ visibleTag: TAG_REPLY });
    plainTruncated.push('<reply>Cut off mid');
    assert.equal(plainTruncated.finish().visible, 'Cut off mid');

    const partialClose = new ReplyStreamSplitter({ visibleTag: TAG_REPLY });
    partialClose.push('<reply>Cut off</rep');
    assert.equal(partialClose.finish().visible, 'Cut off');

    const slashClose = new ReplyStreamSplitter({ visibleTag: TAG_REPLY });
    slashClose.push('<reply>Cut off</');
    assert.equal(slashClose.finish().visible, 'Cut off');

    const whitespaceClose = new ReplyStreamSplitter({ visibleTag: TAG_REPLY });
    whitespaceClose.push('<reply>Cut off</REPLY   ');
    assert.equal(whitespaceClose.finish().visible, 'Cut off');

    const trailingAngle = new ReplyStreamSplitter({ visibleTag: TAG_REPLY });
    trailingAngle.push('<reply>a <');
    assert.equal(trailingAngle.finish().visible, 'a <');
  });

  it('emits nothing while streaming untagged output and returns raw in finish()', () => {
    const untagged = 'No tags anywhere in this response.';
    const splitter = new ReplyStreamSplitter({ visibleTag: TAG_REPLY, hiddenTags: [TAG_THOUGHTS, TAG_NEXT] });
    assert.equal(splitter.push('No tags '), '');
    assert.equal(splitter.push('anywhere in this response.'), '');
    assert.deepEqual(splitter.finish(), { visible: '', raw: untagged });
  });

  it('scans pathological unclosed tags and quotes in linear time', () => {
    const repeatCount = 6000;
    const maxLinearMs = 150;
    const unclosedStarts = '<reply '.repeat(repeatCount);
    const unclosedQuotes = '<reply attr="'.repeat(repeatCount);
    const openVisibleWithSpaces = `<reply>${'</reply '.repeat(repeatCount)}`;

    const startsStartMs = performance.now();
    const startsSplitter = new ReplyStreamSplitter({ visibleTag: TAG_REPLY, hiddenTags: [TAG_THOUGHTS] });
    for (let offset = 0; offset < unclosedStarts.length; offset += 7) {
      assert.equal(startsSplitter.push(unclosedStarts.slice(offset, offset + 7)), '');
    }
    assert.equal(startsSplitter.finish().visible, '');
    assert.ok(performance.now() - startsStartMs < maxLinearMs);

    const quotesStartMs = performance.now();
    const quotesSplitter = new ReplyStreamSplitter({ visibleTag: TAG_REPLY, hiddenTags: [TAG_THOUGHTS] });
    for (let offset = 0; offset < unclosedQuotes.length; offset += 5) {
      assert.equal(quotesSplitter.push(unclosedQuotes.slice(offset, offset + 5)), '');
    }
    assert.equal(quotesSplitter.finish().visible, '');
    assert.ok(performance.now() - quotesStartMs < maxLinearMs);

    const visibleSpacesStartMs = performance.now();
    const spacesSplitter = new ReplyStreamSplitter({ visibleTag: TAG_REPLY });
    spacesSplitter.push(openVisibleWithSpaces);
    const spacesResult = spacesSplitter.finish();
    assert.equal(spacesResult.visible.length, '</reply '.length * (repeatCount - 1));
    assert.ok(performance.now() - visibleSpacesStartMs < maxLinearMs);
  });

  it('excludes visibleTag from hiddenTags case-insensitively and rejects invalid inputs', () => {
    const upperReplyTag = TAG_REPLY.toUpperCase();
    const overlapSplitter = new ReplyStreamSplitter({
      visibleTag: TAG_REPLY,
      hiddenTags: [upperReplyTag, TAG_THOUGHTS],
    });
    assert.equal(overlapSplitter.push('<thoughts>h</thoughts><reply>v</reply>'), 'v');

    assert.throws(() => new ReplyStreamSplitter(null), TypeError);
    assert.throws(() => new ReplyStreamSplitter([]), TypeError);
    assert.throws(() => new ReplyStreamSplitter({ visibleTag: 42 }), TypeError);
    assert.throws(() => new ReplyStreamSplitter({ visibleTag: '' }), RangeError);
    assert.throws(() => new ReplyStreamSplitter({ visibleTag: '1bad' }), RangeError);
    assert.throws(() => new ReplyStreamSplitter({ visibleTag: TAG_REPLY, hiddenTags: 'thoughts' }), TypeError);
    assert.throws(() => new ReplyStreamSplitter({ visibleTag: TAG_REPLY, hiddenTags: [123] }), TypeError);
    assert.throws(() => new ReplyStreamSplitter({ visibleTag: TAG_REPLY, hiddenTags: ['bad tag'] }), RangeError);

    const validSplitter = new ReplyStreamSplitter({ visibleTag: TAG_REPLY });
    assert.throws(() => validSplitter.push(null), TypeError);
    assert.throws(() => validSplitter.push(42), TypeError);
  });
});

describe('CharacterBrain', () => {
  const TEST_MODEL = 'openai/gpt-4.1';
  const TEST_RESERVE = 3000;
  const CLIENT_ENTRY_STREAM = 'stream';
  const FINISH_REASON_LENGTH = 'length';
  const TAG_SETTINGS = CharacterBrain.Settings.Tag;
  const SHAPE_RULE_LINE = 'Start directly with <thoughts>. Write nothing before <thoughts> or after </next>. Answer in exactly this shape:';
  const OLD_SHAPE_RULE_LINE = 'Answer in exactly this shape and nothing else:';

  it('builds full card prompt with unknown-value mapping for card fields while keeping speechExamples verbatim', async () => {
    const fixture = createWorldFixture();
    const { store, campaign, frost, lize } = fixture;
    try {
      const log = ScribeLogCore.create();
      let state = ScribeReplay.run(log, []);
      for (const participant of [frost, lize]) {
        ScribeLogCore.syncCharacterSubject(log, state, {
          subjectId: participant.scribeSubjectId,
          name: participant.name,
          aliases: participant.aliases,
        });
        state = ScribeReplay.run(log, []);
      }
      ScribeLogCore.rule(log, state, {
        type: ScribeLogCore.Ruling.AddFact,
        subject: lize.scribeSubjectId,
        category: ScribeCategory.Names.Hair,
        target: null,
        text: CharacterCard.Unknown,
        hidden: false,
        cite: null,
        position: 0,
        decided: true,
      });
      state = ScribeReplay.run(log, []);

      const budget = RequestBudget.create({ contextLength: null, replyReserve: TEST_RESERVE, charsPerToken: 3 });
      const slice = StorySlice.build({
        state,
        viewer: { omniscient: false, subjectId: lize.scribeSubjectId, characterId: lize.id },
        scene: {
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: SceneType.Private,
          situation: 'Quiet check-in.',
        },
        presentSubjectIds: [frost.scribeSubjectId, lize.scribeSubjectId],
        budget,
      });

      const fullCard = CharacterCard.fromObject({
        hair: CharacterCard.Unknown,
        traits: CharacterCard.Unknown,
        habits: 'Checks door latches twice',
        behavior: 'Guarded until trust is earned',
        likes: 'Strong tea',
        dislikes: 'Loud bragging',
        sexualityOrientation: 'Bisexual',
        sexualityKinks: 'Teasing control',
        sexualityLikes: 'Whispered praise',
        sexualityDislikes: 'Rushing',
        speakingStyle: 'Measured and wry',
        speakingQuirks: 'Pauses before answering',
        personalitySummary: 'Sharp-eyed quartermaster.',
        scenario: 'Keeps the caravan ledger balanced.',
        characterNote: CharacterCard.Unknown,
        speechExamples: [CharacterCard.Unknown, '"Count the coin before the gate closes."'],
      });

      const recordedSpends = [];
      const spyStore = {
        /**
         * @param {object} spendDto
         * @returns {object}
         * @throws {Error}
         */
        recordSpend(spendDto) {
          recordedSpends.push(spendDto);
          return store.recordSpend(spendDto);
        },
      };

      const { client, calls } = createScriptedClient([
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 4,
          text: [
            `<${TAG_SETTINGS.Thoughts}>She notices the question.</${TAG_SETTINGS.Thoughts}>`,
            `<${TAG_SETTINGS.Reply}>"Watch the ledger." *She slides the slate across.*</${TAG_SETTINGS.Reply}>`,
            `<${TAG_SETTINGS.Next}>Collette</${TAG_SETTINGS.Next}>`,
          ].join('\n'),
        },
      ], { store: spyStore });

      const deltas = [];
      const result = await CharacterBrain.reply({
        campaign,
        character: lize,
        card: fullCard,
        playerName: frost.name,
        storyState: slice.text,
        history: 'Frost: Good evening.',
        thisTurn: 'Frost: What did the gatekeeper say?\nNarrator: A cold draft rattles the shutter.',
        styleText: 'Hold back resolution and watch closely.',
        direction: {
          reacting: frost.slug,
          length: Director.Settings.Length.Medium,
          beatGoal: 'Test Frost without revealing the ledger.',
        },
        model: TEST_MODEL,
        replyReserve: TEST_RESERVE,
        client,
        onDelta: async (deltaChunk) => {
          deltas.push(deltaChunk);
        },
      });

      assert.equal(Object.isFrozen(result), true);
      assert.equal(result.reply, '"Watch the ledger." *She slides the slate across.*');
      assert.equal(result.thoughts, 'She notices the question.');
      assert.equal(result.next, 'Collette');
      assert.equal(result.truncated, false);
      assert.equal(typeof result.spendId, 'string');
      assert.equal(deltas.join(''), '"Watch the ledger." *She slides the slate across.*');

      assert.equal(calls.length, 1);
      const sentPayload = calls[0].payload;
      assert.equal(sentPayload.max_tokens, TEST_RESERVE);
      assert.equal(recordedSpends.length, 1);
      assert.equal(recordedSpends[0].stage, SpendStage.Mind);
      assert.equal(recordedSpends[0].campaignId, campaign.id);

      const systemContent = sentPayload.messages[0].content;
      const userContent = sentPayload.messages[1].content;
      assert.equal(sentPayload.messages[0].role, CharacterBrain.Settings.RoleSystem);
      assert.equal(sentPayload.messages[1].role, CharacterBrain.Settings.RoleUser);

      assert.equal(
        systemContent.includes(`Traits: ${CharacterCard.UnknownLabel} | Habits: Checks door latches twice | Behaviour: Guarded until trust is earned`),
        true,
      );
      assert.equal(
        systemContent.includes('Sexuality: Bisexual | Kinks: Teasing control | Likes: Whispered praise | Dislikes: Rushing'),
        true,
      );
      assert.equal(systemContent.includes(`\n${SHAPE_RULE_LINE}\n`), true);
      assert.equal(systemContent.includes(OLD_SHAPE_RULE_LINE), false);
      assert.equal(systemContent.includes(`<${TAG_SETTINGS.VoiceExamples}>\n${CharacterCard.Unknown}\n"Count the coin before the gate closes."\n</${TAG_SETTINGS.VoiceExamples}>`), true);
      assert.equal(systemContent.includes(`Never speak, act or decide for ${frost.name} or for anyone else.`), true);
      assert.equal(systemContent.includes(`<${TAG_SETTINGS.Next}>the name of who should answer you, or ${frost.name}, or ${CharacterBrain.Settings.NextNone}</${TAG_SETTINGS.Next}>`), true);

      const campaignPos = systemContent.indexOf(`<${TAG_SETTINGS.Campaign}>`);
      const identityPos = systemContent.indexOf(`<${TAG_SETTINGS.Identity}>`);
      const voicePos = systemContent.indexOf(`<${TAG_SETTINGS.VoiceExamples}>`);
      const rulesPos = systemContent.indexOf(`<${TAG_SETTINGS.Rules}>`);
      assert.ok(campaignPos > 0 && identityPos > campaignPos && voicePos > identityPos && rulesPos > voicePos);

      assert.equal(userContent.includes(`hair: ${CharacterCard.UnknownLabel}`), true);
      assert.equal(userContent.includes(`<${TAG_SETTINGS.Portrayal}>\n${CharacterCard.UnknownLabel}\n</${TAG_SETTINGS.Portrayal}>`), true);
      assert.equal(userContent.includes('Narrator: A cold draft rattles the shutter.'), true);
      assert.equal(userContent.split(`<${TAG_SETTINGS.StoryState}>`).length, 2);

      const storyPos = userContent.indexOf(`<${TAG_SETTINGS.StoryState}>`);
      const historyPos = userContent.indexOf(`<${TAG_SETTINGS.History}>`);
      const thisTurnPos = userContent.indexOf(`<${TAG_SETTINGS.ThisTurn}>`);
      const portrayalPos = userContent.indexOf(`<${TAG_SETTINGS.Portrayal}>`);
      const stylePos = userContent.indexOf(`<${TAG_SETTINGS.Style}>`);
      const directionPos = userContent.indexOf(`<${TAG_SETTINGS.Direction}`);
      assert.ok(
        storyPos === 0 &&
          historyPos > storyPos &&
          thisTurnPos > historyPos &&
          portrayalPos > thisTurnPos &&
          stylePos > portrayalPos &&
          directionPos > stylePos,
      );
      const betweenStyleAndDirection = userContent.slice(
        userContent.indexOf(`</${TAG_SETTINGS.Style}>`) + `</${TAG_SETTINGS.Style}>`.length,
        directionPos,
      );
      assert.equal(betweenStyleAndDirection, CharacterBrain.Settings.SectionSeparator);
    } finally {
      store.close();
    }
  });

  it('omits empty card blocks, empty optional sections, and peer thoughts from HistoryWindow', async () => {
    const budget = RequestBudget.create({ contextLength: null, replyReserve: TEST_RESERVE, charsPerToken: 3 });
    const historyWindow = HistoryWindow.build({
      turns: [
        {
          id: 't1',
          seq: 1,
          beats: [
            {
              id: 'b1',
              seq: 1,
              speakerType: SpeakerType.Character,
              characterId: 'c-viola',
              speakerName: 'Viola',
              text: 'I locked the cabinet.',
              witnessIds: ['c-lize', 'c-viola'],
              mindPacket: { thoughts: 'PEER_SECRET_THOUGHT_LEAK', next: 'lize' },
            },
          ],
        },
      ],
      characterId: 'c-lize',
      maxTurns: 25,
      budget,
    });

    const capturedRequests = [];
    const fakeClient = {
      /**
       * @param {object} requestOptions
       * @returns {Promise<{text: string, truncated: boolean, spendId: string | null}>}
       * @throws {Error}
       */
      async stream(requestOptions) {
        capturedRequests.push(requestOptions);
        await requestOptions.onDelta(`<${TAG_SETTINGS.Reply}>Understood.</${TAG_SETTINGS.Reply}>`);
        return {
          text: `<${TAG_SETTINGS.Reply}>Understood.</${TAG_SETTINGS.Reply}>`,
          truncated: false,
          spendId: null,
        };
      },
    };

    await CharacterBrain.reply({
      campaign: { id: 'camp-1', premise: '', styleNotes: '   ' },
      character: { name: 'Lize' },
      card: CharacterCard.empty(),
      playerName: null,
      storyState: 'Location: Hall',
      history: historyWindow.text,
      thisTurn: '',
      styleText: '',
      direction: {
        reacting: Director.Settings.ReactingPlayer,
        length: Director.Settings.Length.Short,
        beatGoal: '',
      },
      model: TEST_MODEL,
      replyReserve: TEST_RESERVE,
      client: fakeClient,
    });

    assert.equal(capturedRequests.length, 1);
    const systemContent = capturedRequests[0].messages[0].content;
    const userContent = capturedRequests[0].messages[1].content;

    assert.equal(systemContent.includes(`<${TAG_SETTINGS.Campaign}>`), false);
    assert.equal(systemContent.includes(`<${TAG_SETTINGS.Identity}>`), false);
    assert.equal(systemContent.includes(`<${TAG_SETTINGS.VoiceExamples}>`), false);
    assert.equal(systemContent.includes('Personality:'), false);
    assert.equal(systemContent.includes('Traits:'), false);
    assert.equal(systemContent.includes('Never speak, act or decide for anyone else.'), true);
    assert.equal(systemContent.includes(`<${TAG_SETTINGS.Next}>the name of who should answer you, or ${CharacterBrain.Settings.NextNone}</${TAG_SETTINGS.Next}>`), true);

    assert.equal(userContent.includes(`<${TAG_SETTINGS.StoryState}>\nLocation: Hall\n</${TAG_SETTINGS.StoryState}>`), true);
    assert.equal(userContent.includes('PEER_SECRET_THOUGHT_LEAK'), false);
    assert.equal(userContent.includes(`<${TAG_SETTINGS.ThisTurn}>`), false);
    assert.equal(userContent.includes(`<${TAG_SETTINGS.Portrayal}>`), false);
    assert.equal(userContent.includes(`<${TAG_SETTINGS.Style}>`), false);
    assert.equal(userContent.includes(`<${TAG_SETTINGS.Direction} ${CharacterBrain.Settings.Attr.Reacting}="${Director.Settings.ReactingPlayer}" ${CharacterBrain.Settings.Attr.Length}="${Director.Settings.Length.Short}"></${TAG_SETTINGS.Direction}>`), true);
  });

  it('streams only reply deltas and handles next variants and format misses without throwing', async () => {
    const fixture = createWorldFixture();
    const { store, campaign, frost, lize } = fixture;
    try {
      const { client } = createScriptedClient([
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 3,
          text: [
            `<${TAG_SETTINGS.Thoughts}>Private plan </${TAG_SETTINGS.Reply}> <${TAG_SETTINGS.Reply}>fake</${TAG_SETTINGS.Reply}></${TAG_SETTINGS.Thoughts}>`,
            `<${TAG_SETTINGS.Reply}>Only real reply.</${TAG_SETTINGS.Reply}>`,
            `<${TAG_SETTINGS.Next}>  NONE  </${TAG_SETTINGS.Next}>`,
          ].join(''),
          finishReason: FINISH_REASON_LENGTH,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 5,
          text: `<${TAG_SETTINGS.Thoughts}>Quiet check.</${TAG_SETTINGS.Thoughts}>\nShe pours another cup.\n<${TAG_SETTINGS.Next}>   </${TAG_SETTINGS.Next}>`,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 4,
          text: `<${TAG_SETTINGS.Thoughts}>Running short.</${TAG_SETTINGS.Thoughts}><${TAG_SETTINGS.Reply}>Cut off mid-sen`,
          finishReason: FINISH_REASON_LENGTH,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 4,
          text: `<${TAG_SETTINGS.Thoughts}>Thinking only.</${TAG_SETTINGS.Thoughts}>`,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 4,
          text: `<${TAG_SETTINGS.Thoughts}>Truncated inside thoughts <${TAG_SETTINGS.Reply}>fake</${TAG_SETTINGS.Reply}><${TAG_SETTINGS.Next}>collette</${TAG_SETTINGS.Next}>`,
          finishReason: FINISH_REASON_LENGTH,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 4,
          text: `<${TAG_SETTINGS.Thoughts}>Empty reply tag.</${TAG_SETTINGS.Thoughts}><${TAG_SETTINGS.Reply}></${TAG_SETTINGS.Reply}>`,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 3,
          text: `<${TAG_SETTINGS.Reply}>"Hello."\n<${TAG_SETTINGS.Thoughts}>SECRET_LEAK</${TAG_SETTINGS.Thoughts}>`,
          finishReason: FINISH_REASON_LENGTH,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 3,
          text: `<${TAG_SETTINGS.Reply}>"Hello."\n<${TAG_SETTINGS.Next}>Collette</${TAG_SETTINGS.Next}>`,
          finishReason: FINISH_REASON_LENGTH,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 3,
          text: `<${TAG_SETTINGS.Reply}>"Hello." <${TAG_SETTINGS.Thoughts}>SECRET_NESTED</${TAG_SETTINGS.Thoughts}></${TAG_SETTINGS.Reply}>`,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 3,
          text: `<${TAG_SETTINGS.Thoughts}>Check.</${TAG_SETTINGS.Thoughts}>\n<${TAG_SETTINGS.Reply}>`,
          finishReason: FINISH_REASON_LENGTH,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 3,
          text: `<${TAG_SETTINGS.Reply}>   \n  `,
          finishReason: FINISH_REASON_LENGTH,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 3,
          text: `<${TAG_SETTINGS.Thoughts}>Check.</${TAG_SETTINGS.Thoughts}>\n<${TAG_SETTINGS.Next}>Collette`,
          finishReason: FINISH_REASON_LENGTH,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 3,
          text: `<${TAG_SETTINGS.Thoughts}>Check.</${TAG_SETTINGS.Thoughts}><${TAG_SETTINGS.Reply}></${TAG_SETTINGS.Reply}><${TAG_SETTINGS.Reply}>Cut off`,
          finishReason: FINISH_REASON_LENGTH,
        },
      ], { store });

      const baseCall = {
        campaign,
        character: lize,
        card: lize.card,
        playerName: frost.name,
        direction: {
          reacting: frost.slug,
          length: Director.Settings.Length.Short,
          beatGoal: 'Answer.',
        },
        model: TEST_MODEL,
        replyReserve: TEST_RESERVE,
        client,
      };

      const streamedChunks = [];
      const normalResult = await CharacterBrain.reply({
        ...baseCall,
        onDelta: (deltaChunk) => {
          streamedChunks.push(deltaChunk);
        },
      });
      assert.equal(streamedChunks.join(''), 'Only real reply.');
      assert.equal(normalResult.reply, 'Only real reply.');
      assert.equal(normalResult.next, null);
      assert.equal(normalResult.truncated, true);

      const untaggedChunks = [];
      const untaggedResult = await CharacterBrain.reply({
        ...baseCall,
        onDelta: (deltaChunk) => {
          untaggedChunks.push(deltaChunk);
        },
      });
      assert.deepEqual(untaggedChunks, []);
      assert.equal(untaggedResult.thoughts, 'Quiet check.');
      assert.equal(untaggedResult.reply, 'She pours another cup.');
      assert.equal(untaggedResult.next, null);

      const truncatedChunks = [];
      const truncatedResult = await CharacterBrain.reply({
        ...baseCall,
        onDelta: (deltaChunk) => {
          truncatedChunks.push(deltaChunk);
        },
      });
      assert.equal(truncatedChunks.join(''), 'Cut off mid-sen');
      assert.equal(truncatedResult.reply, 'Cut off mid-sen');
      assert.equal(truncatedResult.reply.includes(`<${TAG_SETTINGS.Reply}>`), false);
      assert.equal(truncatedResult.thoughts, 'Running short.');
      assert.equal(truncatedResult.truncated, true);

      const thoughtsOnlyResult = await CharacterBrain.reply(baseCall);
      assert.equal(thoughtsOnlyResult.reply, '');
      assert.equal(thoughtsOnlyResult.thoughts, 'Thinking only.');

      const truncatedThoughtsResult = await CharacterBrain.reply(baseCall);
      assert.equal(truncatedThoughtsResult.reply, '');
      assert.equal(truncatedThoughtsResult.next, null);
      assert.equal(truncatedThoughtsResult.truncated, true);

      const emptyReplyTagResult = await CharacterBrain.reply(baseCall);
      assert.equal(emptyReplyTagResult.reply, '');
      assert.equal(emptyReplyTagResult.thoughts, 'Empty reply tag.');

      const unclosedReplyThoughtsDeltas = [];
      const unclosedReplyThoughtsResult = await CharacterBrain.reply({
        ...baseCall,
        onDelta: (deltaChunk) => {
          unclosedReplyThoughtsDeltas.push(deltaChunk);
        },
      });
      assert.equal(unclosedReplyThoughtsDeltas.join('').includes('SECRET_LEAK'), false);
      assert.equal(unclosedReplyThoughtsDeltas.join('').trim(), '"Hello."');
      assert.equal(unclosedReplyThoughtsResult.reply, '"Hello."');
      assert.equal(unclosedReplyThoughtsResult.thoughts, 'SECRET_LEAK');

      const unclosedReplyNextDeltas = [];
      const unclosedReplyNextResult = await CharacterBrain.reply({
        ...baseCall,
        onDelta: (deltaChunk) => {
          unclosedReplyNextDeltas.push(deltaChunk);
        },
      });
      assert.equal(unclosedReplyNextDeltas.join('').includes('Collette'), false);
      assert.equal(unclosedReplyNextDeltas.join('').trim(), '"Hello."');
      assert.equal(unclosedReplyNextResult.reply, '"Hello."');
      assert.equal(unclosedReplyNextResult.next, 'Collette');

      const nestedThoughtsDeltas = [];
      const nestedThoughtsResult = await CharacterBrain.reply({
        ...baseCall,
        onDelta: (deltaChunk) => {
          nestedThoughtsDeltas.push(deltaChunk);
        },
      });
      assert.equal(nestedThoughtsDeltas.join('').includes('SECRET_NESTED'), false);
      assert.equal(nestedThoughtsResult.reply, '"Hello."');
      assert.equal(nestedThoughtsResult.thoughts, 'SECRET_NESTED');

      const truncatedBareReplyResult = await CharacterBrain.reply(baseCall);
      assert.equal(truncatedBareReplyResult.reply, '');
      assert.equal(truncatedBareReplyResult.thoughts, 'Check.');

      const truncatedWhitespaceReplyResult = await CharacterBrain.reply(baseCall);
      assert.equal(truncatedWhitespaceReplyResult.reply, '');

      const truncatedUnclosedNextResult = await CharacterBrain.reply(baseCall);
      assert.equal(truncatedUnclosedNextResult.reply, '');
      assert.equal(truncatedUnclosedNextResult.thoughts, 'Check.');

      const emptyFirstThenTruncatedSecondDeltas = [];
      const emptyFirstThenTruncatedSecondResult = await CharacterBrain.reply({
        ...baseCall,
        onDelta: (deltaChunk) => {
          emptyFirstThenTruncatedSecondDeltas.push(deltaChunk);
        },
      });
      assert.equal(emptyFirstThenTruncatedSecondDeltas.join(''), 'Cut off');
      assert.equal(emptyFirstThenTruncatedSecondResult.reply, 'Cut off');
      assert.equal(emptyFirstThenTruncatedSecondResult.thoughts, 'Check.');

      const nonStreamingFakeClient = {
        /**
         * @returns {Promise<{text: string, truncated: boolean, spendId: null}>}
         */
        async stream() {
          return {
            text: `<${TAG_SETTINGS.Reply}>Fallback truncated without delta`,
            truncated: true,
            spendId: null,
          };
        },
      };
      const nonStreamingResult = await CharacterBrain.reply({
        ...baseCall,
        client: nonStreamingFakeClient,
      });
      assert.equal(nonStreamingResult.reply, 'Fallback truncated without delta');
      assert.equal(nonStreamingResult.truncated, true);

      const partialCardClient = {
        /**
         * @param {{messages: Array<{content: string}>}} requestOptions
         * @returns {Promise<{text: string, truncated: boolean, spendId: null}>}
         * @throws {Error}
         */
        async stream(requestOptions) {
          const systemText = requestOptions.messages[0].content;
          assert.equal(systemText.includes('Habits: Taps ring'), true);
          assert.equal(systemText.includes('Traits:'), false);
          assert.equal(systemText.includes('Behaviour:'), false);
          assert.equal(systemText.includes('Likes: Teasing'), true);
          assert.equal(systemText.includes('Sexuality:'), false);
          assert.equal(systemText.includes(' | '), false);
          return {
            text: `<${TAG_SETTINGS.Next}>Collette</${TAG_SETTINGS.Next}><${TAG_SETTINGS.Reply}>Reordered.</${TAG_SETTINGS.Reply}><${TAG_SETTINGS.Thoughts}>Private.</${TAG_SETTINGS.Thoughts}>`,
            truncated: false,
            spendId: null,
          };
        },
      };
      const partialResult = await CharacterBrain.reply({
        ...baseCall,
        card: { habits: 'Taps ring', sexualityLikes: 'Teasing' },
        client: partialCardClient,
      });
      assert.equal(partialResult.reply, 'Reordered.');
      assert.equal(partialResult.thoughts, 'Private.');
      assert.equal(partialResult.next, 'Collette');
    } finally {
      store.close();
    }
  });

  it('strips nested next and self-closing next tags inside reply while preserving captured next', async () => {
    const fixture = createWorldFixture();
    const { store, campaign, frost, lize } = fixture;
    try {
      const helloDialogue = '"Hello."';
      const nextTargetName = 'Collette';
      const continuationText = 'More.';
      const selfClosingNextTag = `<${TAG_SETTINGS.Next}/>`;
      const beatGoalText = 'Answer.';
      const { client } = createScriptedClient([
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 3,
          text: `<${TAG_SETTINGS.Reply}>${helloDialogue} <${TAG_SETTINGS.Next}>${nextTargetName}</${TAG_SETTINGS.Next}></${TAG_SETTINGS.Reply}>`,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 3,
          text: `<${TAG_SETTINGS.Reply}>${helloDialogue} ${selfClosingNextTag} ${continuationText}</${TAG_SETTINGS.Reply}>`,
        },
      ], { store });

      const baseCall = {
        campaign,
        character: lize,
        card: lize.card,
        playerName: frost.name,
        direction: {
          reacting: frost.slug,
          length: Director.Settings.Length.Short,
          beatGoal: beatGoalText,
        },
        model: TEST_MODEL,
        replyReserve: TEST_RESERVE,
        client,
      };

      const nestedNextDeltas = [];
      const nestedNextResult = await CharacterBrain.reply({
        ...baseCall,
        onDelta: (deltaChunk) => {
          nestedNextDeltas.push(deltaChunk);
        },
      });
      assert.equal(nestedNextDeltas.join('').includes(`<${TAG_SETTINGS.Next}>`), false);
      assert.equal(nestedNextDeltas.join('').includes(nextTargetName), false);
      assert.equal(nestedNextResult.reply, helloDialogue);
      assert.equal(nestedNextResult.next, nextTargetName);

      const selfClosingNextDeltas = [];
      const selfClosingNextResult = await CharacterBrain.reply({
        ...baseCall,
        onDelta: (deltaChunk) => {
          selfClosingNextDeltas.push(deltaChunk);
        },
      });
      assert.equal(selfClosingNextDeltas.join('').includes(selfClosingNextTag), false);
      assert.equal(selfClosingNextResult.reply, `${helloDialogue}  ${continuationText}`);
      assert.equal(selfClosingNextResult.next, null);
    } finally {
      store.close();
    }
  });

  it('aborts before calling client.stream and validates all parameters strictly', async () => {
    let streamCalled = false;
    const fakeClient = {
      /**
       * @returns {Promise<{text: string, truncated: boolean, spendId: null}>}
       */
      async stream() {
        streamCalled = true;
        return { text: '', truncated: false, spendId: null };
      },
    };
    const abortController = new AbortController();
    abortController.abort();

    const validOptions = {
      campaign: { id: 'camp-1' },
      character: { name: 'Lize' },
      card: CharacterCard.empty(),
      direction: {
        reacting: Director.Settings.ReactingPlayer,
        length: Director.Settings.Length.Medium,
        beatGoal: 'Respond.',
      },
      model: TEST_MODEL,
      replyReserve: TEST_RESERVE,
      client: fakeClient,
    };

    await assert.rejects(
      () => CharacterBrain.reply({ ...validOptions, signal: abortController.signal }),
      (caughtError) => caughtError.name === CharacterBrain.Settings.AbortName,
    );
    assert.equal(streamCalled, false);

    await assert.rejects(() => CharacterBrain.reply(null), TypeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, campaign: null }), TypeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, campaign: { id: '  ' } }), RangeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, campaign: { id: 'camp-1', premise: 5 } }), TypeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, character: null }), TypeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, character: { name: '' } }), RangeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, card: { hair: 5 } }), TypeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, playerName: 5 }), TypeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, storyState: 5 }), TypeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, direction: [] }), TypeError);
    await assert.rejects(
      () => CharacterBrain.reply({
        ...validOptions,
        direction: { reacting: '', length: Director.Settings.Length.Medium, beatGoal: '' },
      }),
      RangeError,
    );
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, model: '' }), RangeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, replyReserve: 0 }), RangeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, replyReserve: 1.5 }), RangeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, client: {} }), TypeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, signal: {} }), TypeError);
    await assert.rejects(() => CharacterBrain.reply({ ...validOptions, onDelta: 'nope' }), TypeError);
  });
});

describe('Narrator', () => {
  const TEST_MODEL = 'openai/gpt-4.1';
  const TEST_RESERVE = 3000;
  const CLIENT_ENTRY_STREAM = 'stream';
  const FINISH_REASON_LENGTH = 'length';
  const CATEGORY_ROLE = 'role';
  const CATEGORY_CONDITION = 'condition';
  const TAG_SETTINGS = Narrator.Settings.Tag;

  it('streams narration deltas, excludes hidden StorySlice facts, and places style above direction', async () => {
    const fixture = createWorldFixture();
    const { store, campaign, frost, lize } = fixture;
    try {
      const log = ScribeLogCore.create();
      let state = ScribeReplay.run(log, []);
      for (const participant of [frost, lize]) {
        ScribeLogCore.syncCharacterSubject(log, state, {
          subjectId: participant.scribeSubjectId,
          name: participant.name,
          aliases: participant.aliases,
        });
        state = ScribeReplay.run(log, []);
      }
      ScribeLogCore.rule(log, state, {
        type: ScribeLogCore.Ruling.AddFact,
        subject: lize.scribeSubjectId,
        category: CATEGORY_ROLE,
        target: null,
        text: 'quartermaster',
        hidden: false,
        cite: null,
        position: 0,
      });
      state = ScribeReplay.run(log, []);
      ScribeLogCore.rule(log, state, {
        type: ScribeLogCore.Ruling.AddFact,
        subject: lize.scribeSubjectId,
        category: CATEGORY_CONDITION,
        target: null,
        text: 'SECRET_DAGGER_HIDDEN',
        hidden: true,
        cite: null,
        position: 0,
      });
      state = ScribeReplay.run(log, []);

      const budget = RequestBudget.create({ contextLength: null, replyReserve: TEST_RESERVE, charsPerToken: 3 });
      const narratorSlice = StorySlice.build({
        state,
        viewer: { omniscient: true, subjectId: null },
        scene: {
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: SceneType.Private,
          situation: 'Rain hits the roof.',
        },
        presentSubjectIds: [frost.scribeSubjectId, lize.scribeSubjectId],
        budget,
      });

      const recordedSpends = [];
      const spyStore = {
        /**
         * @param {object} spendDto
         * @returns {object}
         * @throws {Error}
         */
        recordSpend(spendDto) {
          recordedSpends.push(spendDto);
          return store.recordSpend(spendDto);
        },
      };

      const { client, calls } = createScriptedClient([
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 4,
          text: `<${TAG_SETTINGS.Narration}>Rain ticks against the glass while a guard shifts outside.</${TAG_SETTINGS.Narration}>`,
          finishReason: FINISH_REASON_LENGTH,
        },
      ], { store: spyStore });

      const streamedDeltas = [];
      const result = await Narrator.narrate({
        campaign,
        storyState: narratorSlice.text,
        history: 'Frost: Good evening.',
        thisTurn: 'Narrator: Wind pushes open the latch.',
        styleText: 'Keep the pace tense and sensory.',
        direction: 'Describe the weather and walk-on guard.',
        model: TEST_MODEL,
        replyReserve: TEST_RESERVE,
        client,
        onDelta: (deltaChunk) => {
          streamedDeltas.push(deltaChunk);
        },
      });

      assert.equal(Object.isFrozen(result), true);
      assert.equal(result.narration, 'Rain ticks against the glass while a guard shifts outside.');
      assert.equal(streamedDeltas.join(''), 'Rain ticks against the glass while a guard shifts outside.');
      assert.equal(result.truncated, true);
      assert.equal(typeof result.spendId, 'string');

      assert.equal(calls.length, 1);
      assert.equal(calls[0].payload.max_tokens, TEST_RESERVE);
      assert.equal(recordedSpends.length, 1);
      assert.equal(recordedSpends[0].stage, SpendStage.Composer);
      assert.equal(recordedSpends[0].campaignId, campaign.id);

      const systemContent = calls[0].payload.messages[0].content;
      const userContent = calls[0].payload.messages[1].content;
      assert.equal(systemContent.includes(`<${TAG_SETTINGS.Campaign}>`), true);
      assert.equal(systemContent.includes(`<${TAG_SETTINGS.Rules}>`), true);
      assert.equal(systemContent.includes('Narrator:'), true);

      assert.equal(userContent.includes('quartermaster'), true);
      assert.equal(userContent.includes('SECRET_DAGGER_HIDDEN'), false);
      assert.equal(userContent.split(`<${TAG_SETTINGS.StoryState}>`).length, 2);
      assert.equal(userContent.includes('Narrator: Wind pushes open the latch.'), true);

      const thisTurnPos = userContent.indexOf(`<${TAG_SETTINGS.ThisTurn}>`);
      const stylePos = userContent.indexOf(`<${TAG_SETTINGS.Style}>`);
      const directionPos = userContent.indexOf(`<${TAG_SETTINGS.Direction}>`);
      assert.ok(thisTurnPos > 0 && stylePos > thisTurnPos && directionPos > stylePos);
      assert.equal(
        userContent.slice(userContent.indexOf(`</${TAG_SETTINGS.Style}>`) + `</${TAG_SETTINGS.Style}>`.length, directionPos),
        Narrator.Settings.SectionSeparator,
      );
    } finally {
      store.close();
    }
  });

  it('handles untagged narration, truncated narration, omitted style/campaign, abort, and bad args', async () => {
    const fixture = createWorldFixture();
    const { store } = fixture;
    try {
      const plainCampaign = store.createCampaign({
        title: 'Plain Campaign',
        premise: '',
        styleNotes: '',
        sceneState: {
          sceneNumber: 1,
          day: 1,
          timeLabel: 'Dawn',
          location: 'Yard',
          sceneType: SceneType.Public,
          presentIds: [],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        },
      });
      const { client, calls } = createScriptedClient([
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 5,
          text: 'Lantern light pools over wet cobbles.',
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 5,
          text: `<${TAG_SETTINGS.Narration}>Mist creeps under the sill`,
          finishReason: FINISH_REASON_LENGTH,
        },
        {
          type: CLIENT_ENTRY_STREAM,
          chunkSize: 4,
          text: `<${TAG_SETTINGS.Narration}></${TAG_SETTINGS.Narration}><${TAG_SETTINGS.Narration}>Mist rolls in`,
          finishReason: FINISH_REASON_LENGTH,
        },
      ], { store });

      const untaggedChunks = [];
      const untaggedResult = await Narrator.narrate({
        campaign: plainCampaign,
        styleText: '',
        direction: 'Open the scene.',
        model: TEST_MODEL,
        replyReserve: TEST_RESERVE,
        client,
        onDelta: (deltaChunk) => {
          untaggedChunks.push(deltaChunk);
        },
      });
      assert.deepEqual(untaggedChunks, []);
      assert.equal(untaggedResult.narration, 'Lantern light pools over wet cobbles.');
      assert.equal(calls[0].payload.messages[0].content.includes(`<${TAG_SETTINGS.Campaign}>`), false);
      assert.equal(calls[0].payload.messages[1].content.includes(`<${TAG_SETTINGS.Style}>`), false);

      const truncatedChunks = [];
      const truncatedResult = await Narrator.narrate({
        campaign: plainCampaign,
        direction: 'Open the scene.',
        model: TEST_MODEL,
        replyReserve: TEST_RESERVE,
        client,
        onDelta: (deltaChunk) => {
          truncatedChunks.push(deltaChunk);
        },
      });
      assert.equal(truncatedChunks.join(''), 'Mist creeps under the sill');
      assert.equal(truncatedResult.narration, 'Mist creeps under the sill');
      assert.equal(truncatedResult.narration.includes(`<${TAG_SETTINGS.Narration}>`), false);
      assert.equal(truncatedResult.truncated, true);

      const emptyFirstNarrationDeltas = [];
      const emptyFirstNarrationResult = await Narrator.narrate({
        campaign: plainCampaign,
        direction: 'Open the scene.',
        model: TEST_MODEL,
        replyReserve: TEST_RESERVE,
        client,
        onDelta: (deltaChunk) => {
          emptyFirstNarrationDeltas.push(deltaChunk);
        },
      });
      assert.equal(emptyFirstNarrationDeltas.join(''), 'Mist rolls in');
      assert.equal(emptyFirstNarrationResult.narration, 'Mist rolls in');
      assert.equal(emptyFirstNarrationResult.truncated, true);

      const nonStreamingNarratorClient = {
        /**
         * @returns {Promise<{text: string, truncated: boolean, spendId: null}>}
         */
        async stream() {
          return {
            text: `<${TAG_SETTINGS.Narration}>Fallback narration cut off`,
            truncated: true,
            spendId: null,
          };
        },
      };
      const fallbackNarratorResult = await Narrator.narrate({
        campaign: plainCampaign,
        model: TEST_MODEL,
        replyReserve: TEST_RESERVE,
        client: nonStreamingNarratorClient,
      });
      assert.equal(fallbackNarratorResult.narration, 'Fallback narration cut off');

      const emptyTagNarratorClient = {
        /**
         * @returns {Promise<{text: string, truncated: boolean, spendId: null}>}
         */
        async stream() {
          return {
            text: `<${TAG_SETTINGS.Narration}></${TAG_SETTINGS.Narration}>`,
            truncated: false,
            spendId: null,
          };
        },
      };
      const emptyTagNarratorResult = await Narrator.narrate({
        campaign: plainCampaign,
        model: TEST_MODEL,
        replyReserve: TEST_RESERVE,
        client: emptyTagNarratorClient,
      });
      assert.equal(emptyTagNarratorResult.narration, '');

      let abortCalled = false;
      const fakeClient = {
        /**
         * @returns {Promise<{text: string, truncated: boolean, spendId: null}>}
         */
        async stream() {
          abortCalled = true;
          return { text: '', truncated: false, spendId: null };
        },
      };
      const abortController = new AbortController();
      abortController.abort();
      await assert.rejects(
        () => Narrator.narrate({
          campaign: { id: 'camp-plain' },
          model: TEST_MODEL,
          replyReserve: TEST_RESERVE,
          client: fakeClient,
          signal: abortController.signal,
        }),
        (caughtError) => caughtError.name === Narrator.Settings.AbortName,
      );
      assert.equal(abortCalled, false);

      await assert.rejects(() => Narrator.narrate(null), TypeError);
      await assert.rejects(() => Narrator.narrate({ campaign: null, model: TEST_MODEL, replyReserve: TEST_RESERVE, client: fakeClient }), TypeError);
      await assert.rejects(() => Narrator.narrate({ campaign: { id: '' }, model: TEST_MODEL, replyReserve: TEST_RESERVE, client: fakeClient }), RangeError);
      await assert.rejects(() => Narrator.narrate({ campaign: { id: 'c1' }, styleText: 9, model: TEST_MODEL, replyReserve: TEST_RESERVE, client: fakeClient }), TypeError);
      await assert.rejects(() => Narrator.narrate({ campaign: { id: 'c1' }, model: '', replyReserve: TEST_RESERVE, client: fakeClient }), RangeError);
      await assert.rejects(() => Narrator.narrate({ campaign: { id: 'c1' }, model: TEST_MODEL, replyReserve: 0, client: fakeClient }), RangeError);
      await assert.rejects(() => Narrator.narrate({ campaign: { id: 'c1' }, model: TEST_MODEL, replyReserve: TEST_RESERVE, client: {} }), TypeError);
      await assert.rejects(() => Narrator.narrate({ campaign: { id: 'c1' }, model: TEST_MODEL, replyReserve: TEST_RESERVE, client: fakeClient, onDelta: 'bad' }), TypeError);
    } finally {
      store.close();
    }
  });
});

describe('TurnEngine sequential turn pipeline, budgets, handoffs, styles, and failures', () => {
  const HTTP_UNAUTHORIZED = 401;
  const CONTEXT_128K = 131072;
  const CONTEXT_TIGHT = 12000;
  const CONTEXT_TINY = 3010;
  const CONTEXT_DIRECTOR_OVERFLOW = 4000;
  const MODEL_MINI = 'openai/gpt-4.1-mini';
  const MODEL_MAIN = 'openai/gpt-4.1';
  const MODEL_RECURRING_TINY = 'openai/gpt-recurring-tiny';
  const EMPTY_TEXT = TurnEngine.Settings.EmptyText;

  /**
   * @param {Record<string, number>} contextByModel
   * @returns {Promise<import('../src/openrouter/ModelCatalog.mjs').ModelCatalog>}
   * @throws {TypeError | RangeError | Error}
   */
  async function createCatalogForModels(contextByModel) {
    const entries = Object.entries(contextByModel).map(([modelId, lengthValue]) => ({
      id: modelId,
      name: `Model ${modelId}`,
      context_length: lengthValue,
      pricing: { prompt: '0.0000003', completion: '0.0000005' },
      top_provider: { max_completion_tokens: DEFAULT_REPLY_RESERVE },
      supported_parameters: ['temperature', 'max_tokens'],
    }));
    const fakeCatalog = createFakeModelCatalog({
      modelIds: Object.keys(contextByModel),
      answerList: () => new Response(JSON.stringify({ data: entries }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });
    await fakeCatalog.catalog.listModels();
    return fakeCatalog.catalog;
  }

  /**
   * @param {{payload: {messages: ReadonlyArray<{content: string}>}}} callRecord
   * @returns {string}
   */
  function combinedPromptText(callRecord) {
    return callRecord.payload.messages.map((message) => message.content).join('\n');
  }

  /**
   * @param {{store: SqliteStore, campaign: object, frost: object, lize: object, extraWitnessIds?: readonly string[], turnCount: number, bodyChars: number, markerPrefix: string}} options
   * @returns {void}
   * @throws {TypeError | RangeError | Error}
   */
  function importScaledHistory({ store, campaign, frost, lize, extraWitnessIds = [], turnCount, bodyChars, markerPrefix }) {
    const witnessIds = [frost.id, lize.id, ...extraWitnessIds];
    const sceneState = { ...campaign.sceneState, presentIds: witnessIds };
    const rows = Array.from({ length: turnCount }, (unusedSlot, index) => {
      const turnNumber = index + 1;
      const isPlayerTurn = turnNumber % 2 === 1;
      const marker = `${markerPrefix}_${String(turnNumber).padStart(3, '0')}: `;
      const body = `${marker}${'x'.repeat(Math.max(0, bodyChars - marker.length))}`;
      return {
        role: isPlayerTurn ? TurnRole.User : TurnRole.Assistant,
        mode: TurnMode.Normal,
        rawText: body,
        sceneNumber: 1,
        witnessIds,
        sceneStateBefore: sceneState,
        sceneStateAfter: sceneState,
        beats: [
          {
            speakerType: isPlayerTurn ? SpeakerType.Player : SpeakerType.Character,
            characterId: isPlayerTurn ? frost.id : lize.id,
            speakerName: isPlayerTurn ? frost.name : lize.name,
            text: body,
            witnessIds,
          },
        ],
      };
    });
    store.importTurns(campaign.id, rows);
  }

  it('bounds Hero-Gone-scale 300-turn history under ModelCatalog 131072 and trims actively under tight 12000', async () => {
    const largeFixture = createWorldFixture({ pedantEnabled: false });
    try {
      const { store, campaign, frost, lize, collette } = largeFixture;
      store.updateCampaign(campaign.id, {
        sceneState: {
          ...campaign.sceneState,
          presentIds: [frost.id, lize.id, collette.id],
        },
      });
      importScaledHistory({
        store,
        campaign,
        frost,
        lize,
        extraWitnessIds: [collette.id],
        turnCount: 300,
        bodyChars: 900,
        markerPrefix: 'HG_TURN',
      });

      const log = ScribeLogCore.create();
      let scribeState = ScribeReplay.run(log, []);
      for (const character of [frost, lize, collette]) {
        ScribeLogCore.syncCharacterSubject(log, scribeState, {
          subjectId: character.scribeSubjectId,
          name: character.name,
          aliases: character.aliases,
        });
        scribeState = ScribeReplay.run(log, []);
      }
      ScribeLogCore.rule(log, scribeState, {
        type: ScribeLogCore.Ruling.AddFact,
        subject: lize.scribeSubjectId,
        category: ScribeCategory.Names.Hair,
        target: null,
        text: 'chestnut braided',
        hidden: false,
        cite: null,
        position: 0,
        decided: true,
      });
      store.saveScribeBook(campaign.id, { bookJson: JSON.stringify(log), lastTurnSeq: 0, dirty: false });

      const largeCatalog = await createCatalogForModels({
        [MODEL_MINI]: CONTEXT_128K,
        [MODEL_MAIN]: CONTEXT_128K,
      });
      const { client: largeClient, calls: largeCalls } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [
              { slug: 'lize', beatGoal: 'Answer', length: Director.Settings.Length.Short },
              { slug: 'collette', beatGoal: 'Answer', length: Director.Settings.Length.Short },
            ],
            narratorDirective: 'Settle into evening.',
          }),
        },
        buildNarratorStreamEntry('Lampposts flicker down the cobbles.'),
        buildBrainStreamEntry({ thoughts: 'Quiet.', reply: '*Lize warms her hands.*' }),
        buildBrainStreamEntry({ thoughts: 'Ready.', reply: '*Collette leans near.*' }),
      ], { store });

      const largeEngine = new TurnEngine({
        store,
        client: largeClient,
        scribeService: new ScribeService({ store }),
        modelCatalog: largeCatalog,
      });
      await largeEngine.runTurn({
        campaignId: campaign.id,
        text: 'Evening settles.',
      });

      const largeBudget = RequestBudget.create({
        contextLength: CONTEXT_128K,
        replyReserve: DEFAULT_REPLY_RESERVE,
        charsPerToken: RequestBudget.StartingCharsPerToken,
      });
      assert.equal(largeCalls.length, 4);
      for (const callItem of largeCalls) {
        const promptTokens =
          largeBudget.estimate(callItem.payload.messages[0].content) +
          largeBudget.estimate(callItem.payload.messages[1].content);
        assert.equal(promptTokens <= largeBudget.limitTokens, true);
      }

      const lizePrompt = combinedPromptText(largeCalls[2]);
      const collettePrompt = combinedPromptText(largeCalls[3]);
      assert.equal(lizePrompt.includes('HG_TURN_300'), true);
      assert.equal(lizePrompt.includes('HG_TURN_275'), false);
      assert.equal(collettePrompt.includes('HG_TURN_300'), true);
      assert.equal(collettePrompt.includes('HG_TURN_288'), false);
    } finally {
      largeFixture.store.close();
    }

    const tightFixture = createWorldFixture({ pedantEnabled: false });
    try {
      const { store, campaign, frost, lize } = tightFixture;
      store.updateCampaign(campaign.id, {
        sceneState: {
          ...campaign.sceneState,
          presentIds: [frost.id, lize.id],
        },
      });
      importScaledHistory({
        store,
        campaign,
        frost,
        lize,
        turnCount: 30,
        bodyChars: 3000,
        markerPrefix: 'TIGHT_TURN',
      });

      const tightCatalog = await createCatalogForModels({
        [MODEL_MINI]: CONTEXT_TIGHT,
        [MODEL_MAIN]: CONTEXT_TIGHT,
      });
      const tightUsage = { prompt_tokens: 9000, completion_tokens: 40, cost: 0.0011 };
      const { client: tightClient, calls: tightCalls } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            presentSlugs: ['frost', 'lize'],
            pacing: Director.Settings.Pacing.FocusedOne,
            responders: [{ slug: 'lize', beatGoal: 'Answer', length: Director.Settings.Length.Short }],
            narratorDirective: 'Check tight window.',
          }),
          usage: tightUsage,
        },
        buildNarratorStreamEntry('Cold wind crosses the threshold.', { usage: tightUsage }),
        buildBrainStreamEntry({ thoughts: 'Tight.', reply: '*Lize nods once.*', usage: tightUsage }),
      ], { store });

      const tightEngine = new TurnEngine({
        store,
        client: tightClient,
        scribeService: new ScribeService({ store }),
        modelCatalog: tightCatalog,
      });
      await tightEngine.runTurn({
        campaignId: campaign.id,
        text: 'Watch closely.',
      });

      const tightBudget = RequestBudget.create({
        contextLength: CONTEXT_TIGHT,
        replyReserve: DEFAULT_REPLY_RESERVE,
        charsPerToken: RequestBudget.StartingCharsPerToken,
      });
      assert.equal(tightCalls.length, 3);
      for (const callItem of tightCalls) {
        const promptTokens =
          tightBudget.estimate(callItem.payload.messages[0].content) +
          tightBudget.estimate(callItem.payload.messages[1].content);
        assert.equal(promptTokens <= tightBudget.limitTokens, true);
      }
      for (const callItem of tightCalls) {
        const prompt = combinedPromptText(callItem);
        assert.equal(prompt.includes('TIGHT_TURN_001'), false);
        assert.equal(prompt.includes('TIGHT_TURN_030'), true);
      }
    } finally {
      tightFixture.store.close();
    }
  });

  it('stacks sequential boxes in <this_turn> and never leaks thoughts across consecutive turns', async () => {
    const fixture = createWorldFixture({ pedantEnabled: false });
    try {
      const { store, campaign, frost, lize, collette } = fixture;
      store.updateCampaign(campaign.id, {
        sceneState: {
          ...campaign.sceneState,
          presentIds: [frost.id, lize.id, collette.id],
        },
      });
      const catalog = await createCatalogForModels({ [MODEL_MINI]: CONTEXT_128K, [MODEL_MAIN]: CONTEXT_128K });
      const { client, calls } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [
              { slug: 'lize', beatGoal: 'Answer first', length: Director.Settings.Length.Short },
              { slug: 'collette', beatGoal: 'Answer second', length: Director.Settings.Length.Short },
            ],
            narratorDirective: 'Rain patters at the window.',
          }),
        },
        buildNarratorStreamEntry('Mist curls against the sill.'),
        buildBrainStreamEntry({ thoughts: 'LIZE_SECRET_THOUGHT_T1', reply: '*Lize warms the kettle.*' }),
        buildBrainStreamEntry({ thoughts: 'COLLETTE_SECRET_THOUGHT_T1', reply: '"Pour me half a cup."' }),
        {
          text: buildTaggedDirectorPlan({
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [
              { slug: 'lize', beatGoal: 'Continue', length: Director.Settings.Length.Short },
              { slug: 'collette', beatGoal: 'Continue', length: Director.Settings.Length.Short },
            ],
            narratorDirective: EMPTY_TEXT,
          }),
        },
        buildBrainStreamEntry({ thoughts: 'LIZE_SECRET_THOUGHT_T2', reply: '*Lize pours two mugs.*' }),
        buildBrainStreamEntry({ thoughts: 'COLLETTE_SECRET_THOUGHT_T2', reply: '"Thank you."' }),
      ], { store });

      const engine = new TurnEngine({
        store,
        client,
        scribeService: new ScribeService({ store }),
        modelCatalog: catalog,
      });

      const eventsTurnOne = [];
      await engine.runTurn({
        campaignId: campaign.id,
        text: 'Tea is cold.',
        emit: (eventItem) => {
          eventsTurnOne.push(eventItem);
        },
      });

      const phaseSequence = eventsTurnOne
        .filter((item) => item.event === TurnEngine.Settings.Event.Phase)
        .map((item) => (item.data.slug ? `${item.data.phase}:${item.data.slug}` : item.data.phase));
      assert.deepEqual(phaseSequence, [
        TurnEngine.Settings.Phase.Directing,
        TurnEngine.Settings.Phase.DirectorDone,
        TurnEngine.Settings.Phase.Narrating,
        `${TurnEngine.Settings.Phase.Replying}:${lize.slug}`,
        `${TurnEngine.Settings.Phase.Replying}:${collette.slug}`,
      ]);

      const collettePromptTurnOne = combinedPromptText(calls[3]);
      assert.equal(collettePromptTurnOne.includes('Frost: Tea is cold.'), true);
      assert.equal(collettePromptTurnOne.includes('Narrator: Mist curls against the sill.'), true);
      assert.equal(collettePromptTurnOne.includes('Lize: *Lize warms the kettle.*'), true);
      assert.equal(collettePromptTurnOne.includes('LIZE_SECRET_THOUGHT_T1'), false);

      await engine.runTurn({
        campaignId: campaign.id,
        text: 'Another round?',
      });

      for (const turnTwoCall of calls.slice(4)) {
        const prompt = combinedPromptText(turnTwoCall);
        assert.equal(prompt.includes('LIZE_SECRET_THOUGHT_T1'), false);
        assert.equal(prompt.includes('COLLETTE_SECRET_THOUGHT_T1'), false);
        assert.equal(prompt.includes('*Lize warms the kettle.*'), true);
      }
    } finally {
      fixture.store.close();
    }
  });

  it('forces Narrator on mid-turn arrival with empty directive and uses DefaultSceneDirection on silent NarratorOnly', async () => {
    const fixture = createWorldFixture({ pedantEnabled: false });
    try {
      const { store, campaign, frost, lize, maya } = fixture;
      store.updateCampaign(campaign.id, {
        sceneState: {
          ...campaign.sceneState,
          sceneType: SceneType.Public,
          presentIds: [frost.id, lize.id],
        },
      });
      const catalog = await createCatalogForModels({ [MODEL_MINI]: CONTEXT_128K, [MODEL_MAIN]: CONTEXT_128K });
      const { client, calls } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            sceneType: SceneType.Public,
            sceneChanged: false,
            presentSlugs: ['frost', 'lize', 'maya'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [
              { slug: 'lize', beatGoal: 'Answer Frost', length: Director.Settings.Length.Short },
              { slug: 'maya', beatGoal: 'Enter and greet', length: Director.Settings.Length.Short },
            ],
            narratorDirective: EMPTY_TEXT,
          }),
        },
        buildNarratorStreamEntry('Maya unlatches the tavern door.'),
        buildBrainStreamEntry({ thoughts: 'Be brief.', reply: '*Lize taps her sleeve.*' }),
        buildBrainStreamEntry({ thoughts: 'Just got here.', reply: '"Am I interrupting?"' }),
        {
          text: buildTaggedDirectorPlan({
            sceneType: SceneType.Public,
            sceneChanged: false,
            presentSlugs: ['frost', 'lize', 'maya'],
            pacing: Director.Settings.Pacing.NarratorOnly,
            responders: [],
            narratorDirective: EMPTY_TEXT,
          }),
        },
        buildNarratorStreamEntry('Hearth embers settle cleanly.'),
      ], { store });

      const engine = new TurnEngine({
        store,
        client,
        scribeService: new ScribeService({ store }),
        modelCatalog: catalog,
      });

      const arrivalResult = await engine.runTurn({
        campaignId: campaign.id,
        text: 'Secret pre-arrival message.',
      });

      const narratorDirectionPrompt = combinedPromptText(calls[1]);
      assert.equal(narratorDirectionPrompt.includes(maya.name), true);
      const lizePrompt = combinedPromptText(calls[2]);
      assert.equal(lizePrompt.includes('Frost: Secret pre-arrival message.'), true);
      const mayaPrompt = combinedPromptText(calls[3]);
      assert.equal(mayaPrompt.includes('Secret pre-arrival message.'), false);
      assert.equal(mayaPrompt.includes('<this_turn>\nNarrator: Maya unlatches the tavern door.\nLize: *Lize taps her sleeve.*\n</this_turn>'), true);
      assert.equal(arrivalResult.userTurn.witnessIds.includes(maya.id), false);
      for (const assistantBeat of arrivalResult.assistantTurn.beats) {
        assert.equal(assistantBeat.witnessIds.includes(maya.id), true);
      }

      const narratorOnlyResult = await engine.runTurn({
        campaignId: campaign.id,
        text: 'We listen to the quiet.',
      });
      const silentDirectionPrompt = combinedPromptText(calls[5]);
      assert.equal(silentDirectionPrompt.includes(TurnEngine.Settings.DefaultSceneDirection), true);
      assert.equal(narratorOnlyResult.assistantTurn.beats.length, 1);
      assert.equal(narratorOnlyResult.assistantTurn.beats[0].speakerType, SpeakerType.Narrator);
    } finally {
      fixture.store.close();
    }
  });

  it('filters <next> handoffs across exclusions, aliases, remote speakers, reacting slug, and maxRepliesPerCharacter', async () => {
    const fixture = createWorldFixture({ pedantEnabled: false });
    try {
      const { store, campaign, frost, lize, collette, viola, mirra, kira } = fixture;
      store.updateSettings({ maxRepliesPerCharacter: 2 });
      store.updateCharacter(campaign.id, frost.id, { aliases: ['Captain'] });
      store.updateCharacter(campaign.id, collette.id, { aliases: ['Cookie'] });
      store.updateCampaign(campaign.id, {
        sceneState: {
          ...campaign.sceneState,
          sceneType: SceneType.Public,
          presentIds: [frost.id, lize.id, collette.id, mirra.id, kira.id],
          remoteIds: [viola.id],
        },
      });
      const catalog = await createCatalogForModels({ [MODEL_MINI]: CONTEXT_128K, [MODEL_MAIN]: CONTEXT_128K });

      const { client, calls } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            sceneType: SceneType.Public,
            presentSlugs: ['frost', 'lize', 'collette', 'mirra', 'kira'],
            remoteSlugs: ['viola'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [
              { slug: 'lize', beatGoal: 'Check absent', length: Director.Settings.Length.Short },
              { slug: 'collette', beatGoal: 'Check player name', length: Director.Settings.Length.Short },
              { slug: 'mirra', beatGoal: 'Check player alias', length: Director.Settings.Length.Short },
              { slug: 'kira', beatGoal: 'Check self', length: Director.Settings.Length.Short },
            ],
            narratorDirective: EMPTY_TEXT,
          }),
        },
        buildBrainStreamEntry({ thoughts: 'One', reply: 'Maya?', next: 'maya' }),
        buildBrainStreamEntry({ thoughts: 'Two', reply: 'Frost?', next: 'Frost' }),
        buildBrainStreamEntry({ thoughts: 'Three', reply: 'Captain?', next: 'Captain' }),
        buildBrainStreamEntry({ thoughts: 'Four', reply: 'Myself?', next: 'kira' }),

        {
          text: buildTaggedDirectorPlan({
            sceneType: SceneType.Public,
            presentSlugs: ['frost', 'lize', 'collette', 'mirra', 'kira'],
            remoteSlugs: ['viola'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [
              { slug: 'lize', beatGoal: 'Point to Collette', length: Director.Settings.Length.Short },
              { slug: 'collette', beatGoal: 'Call Viola', length: Director.Settings.Length.Short },
            ],
            narratorDirective: EMPTY_TEXT,
          }),
        },
        buildBrainStreamEntry({ thoughts: 'Already queued', reply: 'Collette!', next: 'collette' }),
        buildBrainStreamEntry({ thoughts: 'Call remote', reply: 'Viola on wire!', next: 'viola' }),
        buildBrainStreamEntry({ thoughts: 'Reply by alias', reply: 'Cookie, clarify.', next: 'Cookie' }),
        buildBrainStreamEntry({ thoughts: 'Stop', reply: 'Clear.', next: CharacterBrain.Settings.NextNone }),

        {
          text: buildTaggedDirectorPlan({
            sceneType: SceneType.Public,
            presentSlugs: ['frost', 'lize', 'collette', 'mirra', 'kira'],
            remoteSlugs: ['viola'],
            pacing: Director.Settings.Pacing.FocusedOne,
            responders: [{ slug: 'lize', beatGoal: 'Open cap loop', length: Director.Settings.Length.Short }],
            narratorDirective: EMPTY_TEXT,
          }),
        },
        buildBrainStreamEntry({ thoughts: 'L1', reply: 'Lize turn 1.', next: 'collette' }),
        buildBrainStreamEntry({ thoughts: 'C1', reply: 'Collette turn 1.', next: 'lize' }),
        buildBrainStreamEntry({ thoughts: 'L2', reply: 'Lize turn 2.', next: 'collette' }),
        buildBrainStreamEntry({ thoughts: 'C2', reply: 'Collette turn 2.', next: 'lize' }),
      ], { store });

      const engine = new TurnEngine({
        store,
        client,
        scribeService: new ScribeService({ store }),
        modelCatalog: catalog,
      });

      const exclusionTurn = await engine.runTurn({ campaignId: campaign.id, text: 'Test exclusions.' });
      assert.equal(exclusionTurn.assistantTurn.beats.length, 4);
      assert.equal(calls.length, 5);

      const remoteAndAliasTurn = await engine.runTurn({ campaignId: campaign.id, text: 'Relay check.' });
      assert.deepEqual(
        remoteAndAliasTurn.assistantTurn.beats.map((beat) => beat.speakerName),
        [lize.name, collette.name, viola.name, collette.name],
      );
      assert.equal(calls.length, 10);
      assert.equal(
        combinedPromptText(calls[8]).includes(`<${CharacterBrain.Settings.Tag.Direction} ${CharacterBrain.Settings.Attr.Reacting}="${collette.slug}" ${CharacterBrain.Settings.Attr.Length}="${Director.Settings.Length.Medium}"></${CharacterBrain.Settings.Tag.Direction}>`),
        true,
      );
      assert.equal(
        combinedPromptText(calls[9]).includes(`<${CharacterBrain.Settings.Tag.Direction} ${CharacterBrain.Settings.Attr.Reacting}="${viola.slug}" ${CharacterBrain.Settings.Attr.Length}="${Director.Settings.Length.Medium}"></${CharacterBrain.Settings.Tag.Direction}>`),
        true,
      );

      const capTurn = await engine.runTurn({ campaignId: campaign.id, text: 'Bounce back and forth.' });
      assert.deepEqual(
        capTurn.assistantTurn.beats.map((beat) => beat.speakerName),
        [lize.name, collette.name, lize.name, collette.name],
      );
      assert.equal(calls.length, 15);
    } finally {
      fixture.store.close();
    }
  });

  it('rejects before DB mutation when Narrator or mid-turn CharacterBrain mandatory prompt exceeds budget', async () => {
    const narratorFixture = createWorldFixture({ pedantEnabled: false });
    try {
      const { store, campaign, frost, lize } = narratorFixture;
      store.updateCampaign(campaign.id, {
        sceneState: { ...campaign.sceneState, presentIds: [frost.id, lize.id] },
      });
      const narratorTightCatalog = await createCatalogForModels({
        [MODEL_MINI]: CONTEXT_128K,
        [MODEL_MAIN]: CONTEXT_TINY,
      });
      const { client } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            presentSlugs: ['frost', 'lize'],
            pacing: Director.Settings.Pacing.NarratorOnly,
            narratorDirective: 'Narrator mandatory check.',
          }),
        },
      ], { store });
      const engine = new TurnEngine({
        store,
        client,
        scribeService: new ScribeService({ store }),
        modelCatalog: narratorTightCatalog,
      });

      await assert.rejects(
        () => engine.runTurn({ campaignId: campaign.id, text: 'Test Narrator overflow.' }),
        (error) => error instanceof Error && error.message.includes(SpeakerType.label(SpeakerType.Narrator)) && error.message.includes(MODEL_MAIN),
      );
      assert.equal(store.listTurns(campaign.id).total, 0);
      assert.deepEqual(store.getCampaign(campaign.id).sceneState.presentIds, [frost.id, lize.id]);
    } finally {
      narratorFixture.store.close();
    }

    const brainFixture = createWorldFixture({
      pedantEnabled: false,
      models: { composer: MODEL_MAIN, main: MODEL_MAIN, recurring: MODEL_RECURRING_TINY },
    });
    try {
      const { store, campaign, frost, lize, collette } = brainFixture;
      store.updateCampaign(campaign.id, {
        sceneState: { ...campaign.sceneState, presentIds: [frost.id, lize.id, collette.id] },
      });
      const brainTightCatalog = await createCatalogForModels({
        [MODEL_MINI]: CONTEXT_128K,
        [MODEL_MAIN]: CONTEXT_128K,
        [MODEL_RECURRING_TINY]: CONTEXT_TINY,
      });
      const utcDay = new Date().toISOString().slice(0, 10);
      const spendBefore = store.getDailySpend(utcDay).callCount;
      const { client } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [
              { slug: 'lize', beatGoal: 'Answer first', length: Director.Settings.Length.Short },
              { slug: 'collette', beatGoal: 'Overflow mandatory', length: Director.Settings.Length.Short },
            ],
            narratorDirective: EMPTY_TEXT,
          }),
        },
        buildBrainStreamEntry({ thoughts: 'Ok.', reply: '*Lize answers calmly.*' }),
      ], { store });
      const engine = new TurnEngine({
        store,
        client,
        scribeService: new ScribeService({ store }),
        modelCatalog: brainTightCatalog,
      });

      await assert.rejects(
        () => engine.runTurn({ campaignId: campaign.id, text: 'Test Brain overflow.' }),
        (error) => error instanceof Error && error.message.includes(collette.name) && error.message.includes(MODEL_RECURRING_TINY),
      );
      assert.equal(store.listTurns(campaign.id).total, 0);
      assert.equal(store.getDailySpend(utcDay).callCount, spendBefore + 2);
    } finally {
      brainFixture.store.close();
    }
  });

  it('handles Narrator/Brain API and empty failures, Director failure, 2nd-brain abort, editTurn by beatId, and delete/regenerate state restore', async () => {
    const failureFixture = createWorldFixture({ pedantEnabled: false, scribeInterval: 1 });
    try {
      const { store, campaign, frost, lize, collette } = failureFixture;
      store.updateCampaign(campaign.id, {
        sceneState: {
          ...campaign.sceneState,
          presentIds: [frost.id, lize.id, collette.id],
          style: SceneStyle.Banter,
          pinnedStyle: SceneStyle.Banter,
        },
      });
      const catalog = await createCatalogForModels({ [MODEL_MINI]: CONTEXT_128K, [MODEL_MAIN]: CONTEXT_128K });

      const { client: directorErrClient, calls: directorErrCalls } = createScriptedClient([
        { type: CLIENT_ERROR_ENTRY, status: HTTP_UNAUTHORIZED, message: 'Director unauthorized' },
      ], { store });
      const directorErrEngine = new TurnEngine({
        store,
        client: directorErrClient,
        scribeService: new ScribeService({ store }),
        modelCatalog: catalog,
      });
      await assert.rejects(() => directorErrEngine.runTurn({ campaignId: campaign.id, text: 'Knock.' }));
      assert.equal(directorErrCalls.length, 1);
      assert.equal(store.listTurns(campaign.id).total, 0);

      const { client: narratorErrClient } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.FocusedOne,
            responders: [{ slug: 'lize', beatGoal: 'Continue anyway', length: Director.Settings.Length.Short }],
            narratorDirective: 'Should fail safely.',
          }),
        },
        { type: CLIENT_ERROR_ENTRY, status: HTTP_UNAUTHORIZED, message: 'Narrator down' },
        buildBrainStreamEntry({ thoughts: 'Still here.', reply: '*Lize carries on.*' }),
      ], { store });
      const narratorErrEvents = [];
      const narratorErrEngine = new TurnEngine({
        store,
        client: narratorErrClient,
        scribeService: new ScribeService({ store }),
        modelCatalog: catalog,
      });
      const narratorErrResult = await narratorErrEngine.runTurn({
        campaignId: campaign.id,
        text: 'Keep going.',
        emit: (eventItem) => {
          narratorErrEvents.push(eventItem);
        },
      });
      assert.equal(
        narratorErrEvents.some((item) => item.event === TurnEngine.Settings.Event.Warning && item.data.stage === SpendStage.Composer),
        true,
      );
      const lizeDeltas = narratorErrEvents.filter((item) => item.event === TurnEngine.Settings.Event.BeatDelta);
      assert.equal(lizeDeltas.every((item) => item.data.beatIndex === 0), true);
      assert.equal(narratorErrResult.assistantTurn.beats.length, 1);
      narratorErrEngine.deleteLastTurnPair({ campaignId: campaign.id });

      const { client: emptyMixClient, calls: emptyMixCalls } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [
              { slug: 'lize', beatGoal: 'Return empty', length: Director.Settings.Length.Short },
              { slug: 'collette', beatGoal: 'Cover empty', length: Director.Settings.Length.Short },
            ],
            narratorDirective: 'Return empty narration.',
          }),
        },
        buildNarratorStreamEntry(EMPTY_TEXT),
        buildBrainStreamEntry({ thoughts: 'HIDDEN_EMPTY_THOUGHT', reply: EMPTY_TEXT }),
        buildBrainStreamEntry({ thoughts: 'Fallback.', reply: '*Collette steps in.*' }),
      ], { store });
      const emptyEvents = [];
      const emptyEngine = new TurnEngine({
        store,
        client: emptyMixClient,
        scribeService: new ScribeService({ store }),
        modelCatalog: catalog,
      });
      const emptyResult = await emptyEngine.runTurn({
        campaignId: campaign.id,
        text: 'Try empty replies.',
        emit: (eventItem) => {
          emptyEvents.push(eventItem);
        },
      });
      const warnings = emptyEvents.filter((item) => item.event === TurnEngine.Settings.Event.Warning);
      assert.equal(warnings.some((item) => item.data.stage === SpendStage.Composer), true);
      assert.equal(warnings.some((item) => item.data.stage === SpendStage.Mind && item.data.message.includes(lize.name)), true);
      assert.equal(emptyResult.assistantTurn.beats.length, 1);
      assert.equal(emptyResult.assistantTurn.beats[0].speakerName, collette.name);
      assert.equal(combinedPromptText(emptyMixCalls[3]).includes('HIDDEN_EMPTY_THOUGHT'), false);
      emptyEngine.deleteLastTurnPair({ campaignId: campaign.id });

      const utcDay = new Date().toISOString().slice(0, 10);
      const spendBeforeAbort = store.getDailySpend(utcDay).callCount;
      const abortController = new AbortController();
      const { client: abortClient } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [
              { slug: 'lize', beatGoal: 'Speak before abort', length: Director.Settings.Length.Short },
              { slug: 'collette', beatGoal: 'Abort here', length: Director.Settings.Length.Short },
            ],
            narratorDirective: 'Warm fire.',
          }),
        },
        buildNarratorStreamEntry('Logs crackle.'),
        buildBrainStreamEntry({ thoughts: 'First.', reply: '*Lize nods.*' }),
        ({ init }) => new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const abortError = new Error(TurnEngine.Settings.AbortMessage);
            abortError.name = TurnEngine.Settings.AbortName;
            reject(abortError);
          }, { once: true });
          abortController.abort('cancelled');
        }),
      ], { store });
      const abortEngine = new TurnEngine({
        store,
        client: abortClient,
        scribeService: new ScribeService({ store }),
        modelCatalog: catalog,
      });
      await assert.rejects(
        () => abortEngine.runTurn({ campaignId: campaign.id, text: 'Abort on 2nd.', signal: abortController.signal }),
        (error) => error.name === TurnEngine.Settings.AbortName,
      );
      assert.equal(store.listTurns(campaign.id).total, 0);
      assert.equal(store.getDailySpend(utcDay).callCount, spendBeforeAbort + 3);
      assert.equal(store.getCampaign(campaign.id).sceneState.pinnedStyle, SceneStyle.Banter);

      const { client: lifecycleClient, calls: lifecycleCalls } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            sceneChanged: false,
            location: 'Oak Bedroom',
            sceneType: SceneType.Private,
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [
              { slug: 'lize', beatGoal: 'React first', length: Director.Settings.Length.Short },
              { slug: 'collette', beatGoal: 'React second', length: Director.Settings.Length.Short },
            ],
            style: SceneStyle.Combat,
            narratorDirective: 'Steel rings out.',
          }),
        },
        buildNarratorStreamEntry('Sparks fly across the yard.'),
        buildBrainStreamEntry({ thoughts: 'Move.', reply: '*Lize draws her blade.*' }),
        buildBrainStreamEntry({ thoughts: 'Duck.', reply: '*Collette vaults the barrel.*' }),
        { text: '=== FACTS\nLize | weapon | steel blade | #2' },
        {
          text: buildTaggedDirectorPlan({
            sceneChanged: true,
            location: 'Courtyard',
            sceneType: SceneType.Public,
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [
              { slug: 'lize', beatGoal: 'React first', length: Director.Settings.Length.Short },
              { slug: 'collette', beatGoal: 'React second', length: Director.Settings.Length.Short },
            ],
            style: SceneStyle.Combat,
            narratorDirective: 'Rain sweeps the yard.',
          }),
        },
        buildNarratorStreamEntry('Rain patters on the flagstones.'),
        buildBrainStreamEntry({ thoughts: 'Move.', reply: '*Lize watches the gate.*' }),
        buildBrainStreamEntry({ thoughts: 'Wait.', reply: '*Collette holds the lantern.*' }),
        {
          text: buildTaggedDirectorPlan({
            sceneChanged: true,
            location: 'Courtyard',
            sceneType: SceneType.Public,
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [
              { slug: 'lize', beatGoal: 'React first', length: Director.Settings.Length.Short },
              { slug: 'collette', beatGoal: 'React second', length: Director.Settings.Length.Short },
            ],
            style: SceneStyle.Combat,
            narratorDirective: 'Rain sweeps the yard.',
          }),
        },
        buildNarratorStreamEntry('Rain patters on the flagstones.'),
        buildBrainStreamEntry({ thoughts: 'Move.', reply: '*Lize watches the gate.*' }),
        buildBrainStreamEntry({ thoughts: 'Wait.', reply: '*Collette holds the lantern.*' }),
        {
          text: buildTaggedDirectorPlan({
            sceneChanged: false,
            location: 'Oak Bedroom',
            sceneType: SceneType.Private,
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.FocusedOne,
            responders: [{ slug: 'lize', beatGoal: 'Quiet inquiry', length: Director.Settings.Length.Short }],
            style: SceneStyle.Investigation,
            narratorDirective: 'Candlelight sways.',
          }),
        },
        buildNarratorStreamEntry('Shadows stretch over the hearth.'),
        buildBrainStreamEntry({ thoughts: 'Search.', reply: '*Lize checks the lock.*' }),
      ], { store });

      const lifecycleEngine = new TurnEngine({
        store,
        client: lifecycleClient,
        scribeService: new ScribeService({ store, client: lifecycleClient }),
        modelCatalog: catalog,
      });

      const firstRun = await lifecycleEngine.runTurn({ campaignId: campaign.id, text: 'Draw steel!' });
      assert.equal(firstRun.sceneState.style, SceneStyle.Banter);
      assert.equal(firstRun.sceneState.pinnedStyle, SceneStyle.Banter);
      assert.equal(store.getScribeBook(campaign.id).lastTurnSeq, 2);

      const editedAssistant = lifecycleEngine.editTurn({
        campaignId: campaign.id,
        turnId: firstRun.assistantTurn.id,
        beatId: firstRun.assistantTurn.beats[1].id,
        text: '*Lize raises twin daggers.*',
      });
      assert.equal(editedAssistant.beats[0].text, 'Sparks fly across the yard.');
      assert.equal(editedAssistant.beats[1].text, '*Lize raises twin daggers.*');
      assert.equal(editedAssistant.beats[2].text, '*Collette vaults the barrel.*');
      assert.equal(
        editedAssistant.rawText,
        'Sparks fly across the yard.\n\n*Lize raises twin daggers.*\n\n*Collette vaults the barrel.*',
      );
      assert.equal(store.getScribeBook(campaign.id).dirty, true);

      lifecycleEngine.deleteLastTurnPair({ campaignId: campaign.id });
      assert.equal(store.listTurns(campaign.id).total, 0);
      assert.equal(store.getCampaign(campaign.id).sceneState.style, SceneStyle.Banter);
      assert.equal(store.getCampaign(campaign.id).sceneState.pinnedStyle, SceneStyle.Banter);
      assert.equal(store.getScribeBook(campaign.id).lastTurnSeq, 0);

      const sceneShiftRun = await lifecycleEngine.runTurn({ campaignId: campaign.id, text: 'Step outside!' });
      assert.equal(sceneShiftRun.sceneState.style, SceneStyle.Combat);
      assert.equal(sceneShiftRun.sceneState.pinnedStyle, null);
      lifecycleEngine.deleteLastTurnPair({ campaignId: campaign.id });
      assert.equal(store.getCampaign(campaign.id).sceneState.style, SceneStyle.Banter);
      assert.equal(store.getCampaign(campaign.id).sceneState.pinnedStyle, SceneStyle.Banter);

      const secondShiftRun = await lifecycleEngine.runTurn({ campaignId: campaign.id, text: 'Step outside!' });
      assert.equal(secondShiftRun.sceneState.style, SceneStyle.Combat);
      assert.equal(secondShiftRun.sceneState.pinnedStyle, null);
      const regenerated = await lifecycleEngine.regenerateLastTurn({ campaignId: campaign.id });
      assert.equal(regenerated.sceneState.style, SceneStyle.Banter);
      assert.equal(regenerated.sceneState.pinnedStyle, SceneStyle.Banter);
      assert.equal(combinedPromptText(lifecycleCalls[14]).includes(store.getSettings().sceneStyles[SceneStyle.Banter]), true);
      assert.equal(combinedPromptText(lifecycleCalls[15]).includes(store.getSettings().sceneStyles[SceneStyle.Banter]), true);
    } finally {
      failureFixture.store.close();
    }
  });

  it('applies scene styles, pinnedStyle overrides, sceneChanged pin clearing, none omission, and edited settings.sceneStyles', async () => {
    const fixture = createWorldFixture({ pedantEnabled: false });
    try {
      const { store, campaign, frost, lize, collette } = fixture;
      store.updateCampaign(campaign.id, {
        sceneState: {
          ...campaign.sceneState,
          presentIds: [frost.id, lize.id, collette.id],
          style: SceneStyle.None,
          pinnedStyle: null,
        },
      });
      const defaultStyles = store.getSettings().sceneStyles;
      const catalog = await createCatalogForModels({ [MODEL_MINI]: CONTEXT_128K, [MODEL_MAIN]: CONTEXT_128K });
      const { client, calls } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [{ slug: 'lize', beatGoal: 'Fight', length: Director.Settings.Length.Short }],
            style: SceneStyle.Combat,
            narratorDirective: 'Clashes begin.',
          }),
        },
        buildNarratorStreamEntry('Blades meet.'),
        buildBrainStreamEntry({ thoughts: 'Guard up.', reply: '*Lize parries.*' }),

        {
          text: buildTaggedDirectorPlan({
            sceneChanged: false,
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [{ slug: 'lize', beatGoal: 'Answer', length: Director.Settings.Length.Short }],
            style: SceneStyle.Banter,
            narratorDirective: 'Close tension.',
          }),
        },
        buildNarratorStreamEntry('Breath slows.'),
        buildBrainStreamEntry({ thoughts: 'Close.', reply: '*Lize leans in.*' }),

        {
          text: buildTaggedDirectorPlan({
            sceneChanged: true,
            location: 'Balcony',
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.FocusedOne,
            responders: [{ slug: 'lize', beatGoal: 'Quiet moment', length: Director.Settings.Length.Short }],
            style: SceneStyle.Emotional,
            narratorDirective: 'Moonlight falls.',
          }),
        },
        buildNarratorStreamEntry('Silver light covers the rail.'),
        buildBrainStreamEntry({ thoughts: 'Warm.', reply: '*Lize takes your hand.*' }),

        {
          text: buildTaggedDirectorPlan({
            sceneChanged: false,
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.FocusedOne,
            responders: [{ slug: 'lize', beatGoal: 'Plain exchange', length: Director.Settings.Length.Short }],
            style: SceneStyle.None,
            narratorDirective: 'Plain morning.',
          }),
        },
        buildNarratorStreamEntry('Dawn breaks quietly.'),
        buildBrainStreamEntry({ thoughts: 'Awake.', reply: '*Lize stretches.*' }),

        {
          text: buildTaggedDirectorPlan({
            sceneChanged: false,
            presentSlugs: ['frost', 'lize', 'collette'],
            pacing: Director.Settings.Pacing.FocusedOne,
            responders: [{ slug: 'lize', beatGoal: 'Custom style fight', length: Director.Settings.Length.Short }],
            style: SceneStyle.Combat,
            narratorDirective: 'Ambush.',
          }),
        },
        buildNarratorStreamEntry('Arrows splinter the rail.'),
        buildBrainStreamEntry({ thoughts: 'Cover.', reply: '*Lize drops low.*' }),
      ], { store });

      const engine = new TurnEngine({
        store,
        client,
        scribeService: new ScribeService({ store }),
        modelCatalog: catalog,
      });

      const turnOne = await engine.runTurn({ campaignId: campaign.id, text: 'Engage!' });
      assert.equal(turnOne.sceneState.style, SceneStyle.Combat);
      assert.equal(turnOne.sceneState.pinnedStyle, null);
      assert.equal(combinedPromptText(calls[1]).includes(`<${Narrator.Settings.Tag.Style}>\n${defaultStyles[SceneStyle.Combat]}\n</${Narrator.Settings.Tag.Style}>`), true);
      assert.equal(combinedPromptText(calls[2]).includes(`<${CharacterBrain.Settings.Tag.Style}>\n${defaultStyles[SceneStyle.Combat]}\n</${CharacterBrain.Settings.Tag.Style}>`), true);

      store.updateCampaign(campaign.id, {
        sceneState: { ...turnOne.sceneState, pinnedStyle: SceneStyle.Explicit },
      });
      const turnTwo = await engine.runTurn({ campaignId: campaign.id, text: 'Stay close.' });
      assert.equal(turnTwo.sceneState.style, SceneStyle.Explicit);
      assert.equal(turnTwo.sceneState.pinnedStyle, SceneStyle.Explicit);
      assert.equal(combinedPromptText(calls[4]).includes(defaultStyles[SceneStyle.Explicit]), true);
      assert.equal(combinedPromptText(calls[5]).includes(defaultStyles[SceneStyle.Explicit]), true);

      const turnThree = await engine.runTurn({ campaignId: campaign.id, text: 'Step outside.' });
      assert.equal(turnThree.sceneState.style, SceneStyle.Emotional);
      assert.equal(turnThree.sceneState.pinnedStyle, null);
      assert.equal(combinedPromptText(calls[7]).includes(defaultStyles[SceneStyle.Emotional]), true);
      assert.equal(combinedPromptText(calls[8]).includes(defaultStyles[SceneStyle.Emotional]), true);

      const turnFour = await engine.runTurn({ campaignId: campaign.id, text: 'Morning.' });
      assert.equal(turnFour.sceneState.style, SceneStyle.None);
      assert.equal(combinedPromptText(calls[10]).includes(`<${Narrator.Settings.Tag.Style}>`), false);
      assert.equal(combinedPromptText(calls[11]).includes(`<${CharacterBrain.Settings.Tag.Style}>`), false);

      const customCombatStyle = 'CUSTOM_IRON_BLADE_STYLE_TEXT';
      store.updateSettings({
        sceneStyles: { [SceneStyle.Combat]: customCombatStyle },
      });
      const turnFive = await engine.runTurn({ campaignId: campaign.id, text: 'Ambush!' });
      assert.equal(turnFive.sceneState.style, SceneStyle.Combat);
      assert.equal(combinedPromptText(calls[13]).includes(customCombatStyle), true);
      assert.equal(combinedPromptText(calls[14]).includes(customCombatStyle), true);
    } finally {
      fixture.store.close();
    }
  });

  it('rejects before OpenRouter call or DB mutation when Director mandatory prompt exceeds context budget', async () => {
    const directorFixture = createWorldFixture({ pedantEnabled: false });
    try {
      const { store, campaign, frost, lize } = directorFixture;
      store.updateCampaign(campaign.id, {
        sceneState: { ...campaign.sceneState, presentIds: [frost.id, lize.id] },
      });
      const tightDirectorCatalog = await createCatalogForModels({
        [MODEL_MINI]: CONTEXT_DIRECTOR_OVERFLOW,
        [MODEL_MAIN]: CONTEXT_128K,
      });
      const { client, calls } = createScriptedClient([], { store });
      const engine = new TurnEngine({
        store,
        client,
        scribeService: new ScribeService({ store }),
        modelCatalog: tightDirectorCatalog,
      });

      await assert.rejects(
        () => engine.runTurn({ campaignId: campaign.id, text: 'Test Director mandatory overflow.' }),
        (error) => error instanceof Error && /Director/.test(error.message) && error.message.includes(MODEL_MINI),
      );
      assert.equal(calls.length, 0);
      assert.equal(store.listTurns(campaign.id).total, 0);
    } finally {
      directorFixture.store.close();
    }
  });

  it('links spend_log rows for empty-reply Narrator and thoughts-only CharacterBrain calls when the turn commits', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-engine-spend-link-'));
    const dbPath = path.join(tempDir, 'worlds.sqlite');
    const store = new SqliteStore(dbPath);
    let rawDb = null;
    try {
      store.updateSettings({
        pedantEnabled: false,
        models: {
          director: MODEL_MINI,
          composer: MODEL_MAIN,
          main: MODEL_MAIN,
          recurring: MODEL_MINI,
          scribe: MODEL_MINI,
        },
      });
      const campaign = store.createCampaign({
        title: 'Spend Link Vale',
        premise: 'Caravan spend linking check.',
        styleNotes: 'Concise grounded prose.',
        encounterPublicOdds: 0,
        encounterPrivateOdds: 0,
        scribeInterval: 10,
        sceneState: {
          sceneNumber: 1,
          day: 1,
          timeLabel: 'Evening',
          location: 'Oak Bedroom',
          sceneType: SceneType.Private,
          presentIds: [],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        },
      });
      const frost = store.createCharacter(campaign.id, {
        slug: 'frost',
        scribeSubjectId: 'S1',
        name: 'Frost',
        aliases: [],
        isPlayer: true,
        tier: CharacterTier.Main,
        card: { personalitySummary: 'Caravan scout.', speakingStyle: 'Terse.' },
        avatarToken: AvatarToken.Slate,
      });
      const lize = store.createCharacter(campaign.id, {
        slug: 'lize',
        scribeSubjectId: 'S2',
        name: 'Lize',
        aliases: [],
        isPlayer: false,
        tier: CharacterTier.Main,
        card: { personalitySummary: 'Quartermaster.', speakingStyle: 'Measured.' },
        avatarToken: AvatarToken.Rose,
      });
      const yumi = store.createCharacter(campaign.id, {
        slug: 'yumi',
        scribeSubjectId: 'S3',
        name: 'Yumi',
        aliases: [],
        isPlayer: false,
        tier: CharacterTier.Main,
        card: { personalitySummary: 'Archivist.', speakingStyle: 'Crisp.' },
        avatarToken: AvatarToken.Teal,
      });
      store.updateCampaign(campaign.id, {
        playerCharacterId: frost.id,
        sceneState: {
          ...campaign.sceneState,
          presentIds: [frost.id, lize.id, yumi.id],
        },
      });

      const catalog = await createCatalogForModels({ [MODEL_MINI]: CONTEXT_128K, [MODEL_MAIN]: CONTEXT_128K });
      const { client } = createScriptedClient([
        {
          text: buildTaggedDirectorPlan({
            presentSlugs: ['frost', 'lize', 'yumi'],
            pacing: Director.Settings.Pacing.GroupBanter,
            responders: [
              { slug: 'lize', beatGoal: 'Thoughts only', length: Director.Settings.Length.Short },
              { slug: 'yumi', beatGoal: 'Commit turn', length: Director.Settings.Length.Short },
            ],
            narratorDirective: 'Empty narration check.',
          }),
        },
        buildNarratorStreamEntry(EMPTY_TEXT),
        buildBrainStreamEntry({ thoughts: 'Silent internal thought.', reply: EMPTY_TEXT }),
        buildBrainStreamEntry({ thoughts: 'Answer cleanly.', reply: '*Yumi nods.*\nAll accounted for.' }),
      ], { store });

      const events = [];
      const engine = new TurnEngine({
        store,
        client,
        scribeService: new ScribeService({ store }),
        modelCatalog: catalog,
      });

      const committed = await engine.runTurn({
        campaignId: campaign.id,
        text: 'Status check.',
        emit: (eventItem) => {
          events.push(eventItem);
        },
      });

      const warnings = events.filter((item) => item.event === TurnEngine.Settings.Event.Warning);
      assert.equal(warnings.some((item) => item.data.stage === SpendStage.Composer), true);
      assert.equal(warnings.some((item) => item.data.stage === SpendStage.Mind && item.data.message.includes(lize.name)), true);
      assert.equal(committed.assistantTurn.beats.length, 1);
      assert.equal(committed.assistantTurn.beats[0].speakerName, yumi.name);

      store.close();
      rawDb = new DatabaseSync(dbPath);
      const spendRows = rawDb.prepare('SELECT id, stage, turn_id FROM spend_log ORDER BY rowid ASC').all();
      assert.deepEqual(
        spendRows.map((row) => row.stage),
        [SpendStage.Director, SpendStage.Composer, SpendStage.Mind, SpendStage.Mind],
      );
      for (const spendRow of spendRows) {
        assert.notEqual(spendRow.turn_id, null);
        assert.equal(spendRow.turn_id, committed.assistantTurn.id);
      }
    } finally {
      if (rawDb !== null) {
        rawDb.close();
      }
      store.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
