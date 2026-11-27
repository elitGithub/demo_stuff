import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BeatParser } from '../src/engine/BeatParser.mjs';
import { CharacterMind } from '../src/engine/CharacterMind.mjs';
import { Director } from '../src/engine/Director.mjs';
import { EncounterRoller } from '../src/engine/EncounterRoller.mjs';
import { HistoryWindow } from '../src/engine/HistoryWindow.mjs';
import { NarrationParts } from '../src/engine/NarrationParts.mjs';
import { NarratorComposer } from '../src/engine/NarratorComposer.mjs';
import { RequestBudget } from '../src/engine/RequestBudget.mjs';
import { StorySlice } from '../src/engine/StorySlice.mjs';
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
import { AvatarToken } from '../src/store/enums/AvatarToken.mjs';
import { CharacterTier } from '../src/store/enums/CharacterTier.mjs';
import { FindingKind } from '../src/store/enums/FindingKind.mjs';
import { SceneType } from '../src/store/enums/SceneType.mjs';
import { SpeakerType } from '../src/store/enums/SpeakerType.mjs';
import { SpendStage } from '../src/store/enums/SpendStage.mjs';
import { TurnMode } from '../src/store/enums/TurnMode.mjs';
import { TurnRole } from '../src/store/enums/TurnRole.mjs';
import { SqliteStore } from '../src/store/SqliteStore.mjs';

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

describe('BeatParser', () => {
  it('parses 1-char-per-chunk streams identically, handles brackets, remaps player tags, strips post-tag newline, and flushes unclosed tags', () => {
    const sample = [
      'The rain drums on the roof [sighs].\n',
      '[[BEAT:lize]]\r\n',
      '*She glances up [[other]] calmly.*\n',
      'We wait until dawn.\n',
      '[[BEAT:frost]]\n',
      '*Frost checks his blade.*\n',
      '[[BEAT:Lady Lize]]\n',
      'Still listening.\n',
      '[[BEAT:unknown_guard]]\n',
      'Boots crunch outside.',
    ].join('');

    const parserConfig = {
      validSlugs: ['lize', 'collette', 'frost'],
      nameToSlug: {
        Lize: 'lize',
        'Lady Lize': 'lize',
        Frost: 'frost',
      },
      slugToName: {
        lize: 'Lize',
        collette: 'Collette',
      },
      playerSlug: 'frost',
    };

    const singleParser = new BeatParser(parserConfig);
    const singleDeltas = [...singleParser.push(sample), ...singleParser.flush()];

    const charParser = new BeatParser(parserConfig);
    const charDeltas = [];
    for (let charIndex = 0; charIndex < sample.length; charIndex += 1) {
      charDeltas.push(...charParser.push(sample[charIndex]));
    }
    charDeltas.push(...charParser.flush());

    assert.deepEqual(charParser.getBeats(), singleParser.getBeats());
    assert.equal(charParser.wasPlayerBeatRemapped(), true);
    assert.equal(singleParser.wasPlayerBeatRemapped(), true);

    const reconstructedSingle = singleDeltas.map((item) => item.delta).join('');
    const reconstructedChar = charDeltas.map((item) => item.delta).join('');
    assert.equal(reconstructedChar, reconstructedSingle);
    assert.equal(reconstructedChar.includes('[[BEAT:'), false);
    assert.equal(reconstructedChar.includes('[sighs]'), true);
    assert.equal(reconstructedChar.includes('[[other]]'), true);

    const beats = charParser.getBeats();
    assert.equal(beats[0].speakerType, SpeakerType.Narrator);
    assert.equal(beats[0].text, 'The rain drums on the roof [sighs].');
    assert.equal(beats[1].speakerType, SpeakerType.Character);
    assert.equal(beats[1].slug, 'lize');
    assert.equal(beats[1].speakerName, 'Lize');
    assert.equal(beats[1].text, '*She glances up [[other]] calmly.*\nWe wait until dawn.');
    assert.equal(beats[2].speakerType, SpeakerType.Narrator);
    assert.equal(beats[2].text, '*Frost checks his blade.*');
    assert.equal(beats[3].speakerType, SpeakerType.Character);
    assert.equal(beats[3].slug, 'lize');
    assert.equal(beats[3].text, 'Still listening.');
    assert.equal(beats[4].speakerType, SpeakerType.Narrator);
    assert.equal(beats[4].text, 'Boots crunch outside.');

    const stallParser = new BeatParser(parserConfig);
    const longUnclosed = `[[BEAT:${'x'.repeat(130)}`;
    const emittedBeforeFlush = stallParser.push(longUnclosed);
    assert.ok(emittedBeforeFlush.length > 0);
    const tailFlush = stallParser.flush();
    assert.equal(
      [...emittedBeforeFlush, ...tailFlush].map((item) => item.delta).join(''),
      longUnclosed,
    );

    const eofParser = new BeatParser(parserConfig);
    assert.deepEqual(eofParser.push('[[BEAT:partial'), []);
    const eofFlushed = eofParser.flush();
    assert.equal(eofFlushed.map((item) => item.delta).join(''), '[[BEAT:partial');
  });
});

describe('Director invariants and repair retry', () => {
  it('enforces disjoint slugs, player responder exclusion, walk-on resets, offscreen clearing, targetChars clamping, and JSON repair retry', async () => {
    const fixture = createWorldFixture();
    const { store, campaign, frost, lize, viola, collette } = fixture;
    const preState = {
      ...campaign.sceneState,
      activeWalkOns: ['Innkeeper Bram', 'Guard'],
    };

    const { client, calls } = createScriptedClient([
      { text: 'Sure, here is the plan: {not valid json' },
      {
        text: '```json\n' + JSON.stringify({
          sceneChanged: true,
          location: '  Market Square  ',
          day: 0,
          timeLabel: '',
          sceneType: 'invalid_type',
          userInputKind: 'player_in_scene',
          presentSlugs: ['FROST', 'lize', 'unknown_ghost', 'lize'],
          remoteSlugs: ['lize', 'collette'],
          offscreenNotes: {
            __proto__: 'polluted',
            constructor: 'polluted',
            frost: 'Should be cleared because frost is present',
            viola: '  Sorting dried herbs  ',
            unknown_slug: 'Should be dropped',
          },
          walkOnsEnter: ['Guard', 'guard', 'Peddler'],
          walkOnsLeave: ['Guard'],
          encounterAccepted: true,
          encounterBrief: 'A wild wolf appears',
          pacing: 'group_banter',
          targetChars: 99999,
          responders: [
            { slug: 'frost', beatGoal: 'Never player', length: 'short' },
            { slug: 'viola', beatGoal: 'Absent char cannot respond', length: 'long' },
            { slug: 'lize', beatGoal: 'Check prices', length: 'short' },
            { slug: 'lize', beatGoal: 'Duplicate dropped', length: 'long' },
            { slug: 'collette', beatGoal: 'Call over the stall', length: 'weird' },
          ],
          narratorDirective: 'Keep banter brisk.',
        }) + '\n```',
      },
    ], { store });

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

    assert.equal(calls.length, 2);
    assert.equal(result.spendIds.length, 2);
    assert.equal(result.nextState.sceneNumber, 2);
    assert.equal(result.nextState.day, 1);
    assert.equal(result.nextState.timeLabel, 'Evening');
    assert.equal(result.nextState.location, 'Market Square');
    assert.equal(result.nextState.sceneType, SceneType.Private);
    assert.deepEqual(result.nextState.presentIds, [frost.id, lize.id]);
    assert.deepEqual(result.nextState.remoteIds, [collette.id]);
    assert.deepEqual(result.nextState.activeWalkOns, ['Peddler']);
    assert.deepEqual(result.nextState.offscreenNotes, { viola: 'Sorting dried herbs' });
    assert.equal(Object.hasOwn(result.nextState.offscreenNotes, 'frost'), false);
    assert.equal(Object.hasOwn(result.nextState.offscreenNotes, '__proto__'), false);
    assert.equal(result.plan.encounterAccepted, false);
    assert.equal(result.plan.encounterBrief, '');
    assert.equal(result.plan.targetChars, 2200);
    assert.equal(result.plan.responders.length, 2);
    assert.equal(result.plan.responders[0].slug, 'lize');
    assert.equal(result.plan.responders[1].slug, 'collette');
    assert.equal(result.plan.responders[1].length, 'medium');

    const failFixture = createWorldFixture();
    const { client: failClient } = createScriptedClient([
      { text: 'broken json 1' },
      { text: '["array", "not", "object"]' },
    ], { store: failFixture.store });

    let caughtError = null;
    try {
      await Director.planTurn({
        campaign: failFixture.campaign,
        characters: [failFixture.frost, failFixture.lize],
        preState: failFixture.campaign.sceneState,
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
        client: failClient,
      });
    } catch (error) {
      caughtError = error;
    }
    assert.notEqual(caughtError, null);
    assert.equal(caughtError.spendIds.length, 2);
    const utcDay = new Date().toISOString().slice(0, 10);
    assert.equal(failFixture.store.getDailySpend(utcDay).callCount, 2);
  });
});

describe('TurnEngine end-to-end regressions and adversarial invariants', () => {
  it('keeps Viola absent on mention ("I need to get vegetables to Viola") and never invokes Viola Mind', async () => {
    const fixture = createWorldFixture();
    const { store, campaign, frost, lize, viola } = fixture;
    const scribeService = new ScribeService({ store });

    const { client, calls } = createScriptedClient([
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: { viola: 'At the apothecary stall' },
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 900,
          responders: [{ slug: 'lize', beatGoal: 'Offer to check the pantry', length: 'short' }],
          narratorDirective: 'Keep Viola offscreen.',
        },
      },
      {
        json: {
          internalThought: 'Frost is thinking of Viola again.',
          physicalAction: 'Lize ties her apron strings.',
          spokenLines: 'There are turnips in the cellar crate if you hurry.',
          tone: 'practical',
          knowledgeBoundaries: ['Does not know what Viola is doing right now'],
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:lize]]\n*Lize ties her apron strings.*\nThere are turnips in the cellar crate if you hurry.',
      },
    ], { store });

    const engine = new TurnEngine({ store, client, scribeService });
    const result = await engine.runTurn({
      campaignId: campaign.id,
      text: 'I need to get vegetables to Viola.',
      mode: TurnMode.Normal,
    });

    assert.equal(calls.length, 3);
    assert.deepEqual(result.sceneState.presentIds, [frost.id, lize.id]);
    assert.equal(result.sceneState.presentIds.includes(viola.id), false);
    assert.equal(result.assistantTurn.beats.some((beat) => beat.characterId === viola.id), false);
    assert.equal(calls[1].payload.messages[0].content.includes('Lize'), true);
    assert.equal(calls[1].payload.messages[0].content.includes('Viola'), false);
  });

  it('isolates absent Collette from private bedroom scene facts and sibling internalThought', async () => {
    const fixture = createWorldFixture({ scribeInterval: 1, pedantEnabled: false });
    const { store, campaign, frost, lize, collette } = fixture;

    const { client, calls } = createScriptedClient([
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: { collette: 'In the tavern kitchen' },
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'intimate_deep',
          targetChars: 1000,
          responders: [{ slug: 'lize', beatGoal: 'Confess the cipher location', length: 'medium' }],
          narratorDirective: 'Keep it quiet.',
        },
      },
      {
        json: {
          internalThought: 'SECRET_LIZE_THOUGHT_999',
          physicalAction: 'Lize leans close to the hearth.',
          spokenLines: 'I hid the silver cipher key inside the ash drawer.',
          tone: 'hushed',
          knowledgeBoundaries: ['Only Frost heard this'],
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:lize]]\n*Lize leans close to the hearth.*\nI hid the silver cipher key inside the ash drawer.',
      },
      {
        text: [
          '=== FACTS',
          'Lize | belonging | keeps the silver cipher key hidden in the ash drawer | #2',
        ].join('\n'),
      },
      {
        json: {
          sceneChanged: true,
          location: 'Tavern Kitchen',
          day: 1,
          timeLabel: 'Late Evening',
          sceneType: 'public',
          userInputKind: 'narrator_direction',
          presentSlugs: ['collette'],
          remoteSlugs: [],
          offscreenNotes: { frost: 'Upstairs in Oak Bedroom', lize: 'Upstairs in Oak Bedroom' },
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 900,
          responders: [{ slug: 'collette', beatGoal: 'Taste the stew', length: 'short' }],
          narratorDirective: 'Show Collette alone.',
        },
      },
      {
        json: {
          internalThought: 'Needs more salt.',
          physicalAction: 'Collette stirs the kettle.',
          spokenLines: 'Almost ready for supper.',
          tone: 'cheerful',
          knowledgeBoundaries: ['Knows nothing from upstairs'],
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:collette]]\n*Collette stirs the kettle.*\nAlmost ready for supper.',
      },
    ], { store });

    const scribeService = new ScribeService({ store, client });
    const engine = new TurnEngine({ store, client, scribeService });

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

    const colletteMindCall = calls[5];
    const collettePrompt = JSON.stringify(colletteMindCall.payload.messages);
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
        json: {
          sceneChanged: true,
          location: 'Party Wagon',
          day: 1,
          timeLabel: 'Night',
          sceneType: 'public',
          userInputKind: 'narrator_direction',
          presentSlugs: ['mirra', 'kira', 'maya'],
          remoteSlugs: [],
          offscreenNotes: { frost: 'doing his rounds' },
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'narrator_only',
          targetChars: 800,
          responders: [],
          narratorDirective: 'Set the wagon scene without Frost.',
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:narrator]]\nMaya raps sharply on the wagon door while Mirra and Kira trade glances.',
      },
      {
        json: {
          sceneChanged: false,
          location: 'Party Wagon',
          day: 1,
          timeLabel: 'Night',
          sceneType: 'public',
          userInputKind: 'player_in_scene',
          presentSlugs: ['mirra', 'kira', 'maya'],
          remoteSlugs: [],
          offscreenNotes: { frost: 'doing his rounds' },
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 800,
          responders: [{ slug: 'mirra', beatGoal: 'Greet Frost', length: 'short' }],
          narratorDirective: 'Mirra answers Frost.',
        },
      },
      {
        json: {
          internalThought: 'Back already.',
          physicalAction: 'Mirra unlatches the shutter.',
          spokenLines: 'Quiet rounds tonight, Frost?',
          tone: 'curious',
          knowledgeBoundaries: [],
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:mirra]]\n*Mirra unlatches the shutter.*\nQuiet rounds tonight, Frost?',
      },
      {
        json: {
          sceneChanged: true,
          location: 'Watchtower Gate',
          day: 1,
          timeLabel: 'Midnight',
          sceneType: 'public',
          userInputKind: 'player_in_scene',
          presentSlugs: ['mirra'],
          remoteSlugs: ['kira'],
          offscreenNotes: { frost: 'At the gatehouse' },
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 800,
          responders: [{ slug: 'mirra', beatGoal: 'Should be dropped', length: 'short' }],
          narratorDirective: 'Cut back.',
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:narrator]]\nFrost stands alone beneath the watchtower lantern.',
      },
    ], { store });

    const engine = new TurnEngine({ store, client, scribeService });

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

  it('isolates mid-turn encounter arrival from private pre-arrival user dialogue and witness_ids', async () => {
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
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'public',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize', 'collette'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: true,
          encounterBrief: 'Collette knocks and steps inside carrying fresh bread.',
          pacing: 'group_banter',
          targetChars: 1100,
          responders: [
            { slug: 'lize', beatGoal: 'Respond to Frost then pause', length: 'short' },
            { slug: 'collette', beatGoal: 'Offer the bread upon entering', length: 'short' },
          ],
          narratorDirective: 'Lize replies before Collette enters.',
        },
      },
      {
        json: {
          internalThought: 'Keep Ember secret.',
          physicalAction: 'Lize whispers quickly.',
          spokenLines: 'Got it, Ember.',
          tone: 'guarded',
          knowledgeBoundaries: [],
        },
      },
      {
        json: {
          internalThought: 'Smells warm in here.',
          physicalAction: 'Collette holds out the loaf.',
          spokenLines: 'Brought fresh bread for you two.',
          tone: 'bright',
          knowledgeBoundaries: ['Missed what was said before knocking'],
        },
      },
      {
        type: 'stream',
        text: [
          '[[BEAT:lize]]\n*Lize whispers quickly.*\nGot it, Ember.\n',
          '[[BEAT:collette]]\n*Collette holds out the loaf.*\nBrought fresh bread for you two.',
        ].join(''),
      },
    ], { store });

    const engine = new TurnEngine({
      store,
      client,
      scribeService,
      random: () => 0.1,
    });

    const result = await engine.runTurn({
      campaignId: campaign.id,
      text: 'Lize, the secret passphrase is Ember.',
      mode: TurnMode.Normal,
    });

    const lizeMindPrompt = JSON.stringify(calls[1].payload.messages);
    const colletteMindPrompt = JSON.stringify(calls[2].payload.messages);
    assert.equal(lizeMindPrompt.includes('Ember'), true);
    assert.equal(colletteMindPrompt.includes('Collette knocks and steps inside carrying fresh bread.'), true);
    assert.equal(colletteMindPrompt.includes('Ember'), false);

    assert.equal(result.userTurn.witnessIds.includes(collette.id), false);
    assert.deepEqual(result.userTurn.witnessIds.sort(), [frost.id, lize.id].sort());
    assert.equal(result.assistantTurn.beats[0].witnessIds.includes(collette.id), false);
    assert.equal(result.assistantTurn.beats[1].witnessIds.includes(collette.id), true);
  });

  it('aborts sibling Minds immediately on failure, leaves zero orphan turns on Mind or Composer failure, and preserves intermediate spend_log', async () => {
    const fixture = createWorldFixture({ pedantEnabled: false });
    const { store, campaign, lize, collette } = fixture;
    store.updateCampaign(campaign.id, {
      sceneState: {
        ...campaign.sceneState,
        presentIds: [fixture.frost.id, lize.id, collette.id],
        offscreenNotes: {},
      },
    });
    const scribeService = new ScribeService({ store });

    let siblingAborted = false;
    const { client: mindFailClient } = createScriptedClient([
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize', 'collette'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'group_banter',
          targetChars: 1000,
          responders: [
            { slug: 'lize', beatGoal: 'Fail quickly', length: 'short' },
            { slug: 'collette', beatGoal: 'Wait on sibling', length: 'short' },
          ],
          narratorDirective: 'Test abort.',
        },
      },
      { type: 'error', status: 401, message: 'Bad key' },
      ({ init }) => new Promise((resolve, reject) => {
        if (init.signal?.aborted) {
          siblingAborted = true;
          const abortErr = new Error('Aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
          return;
        }
        init.signal?.addEventListener('abort', () => {
          siblingAborted = true;
          const abortErr = new Error('Aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        }, { once: true });
      }),
    ], { store });

    const engine = new TurnEngine({ store, client: mindFailClient, scribeService });
    await assert.rejects(
      () => engine.runTurn({ campaignId: campaign.id, text: 'Everyone ready?' }),
      /401/,
    );
    assert.equal(siblingAborted, true);
    assert.equal(store.listTurns(campaign.id).total, 0);
    assert.deepEqual(store.getCampaign(campaign.id).sceneState.presentIds, [fixture.frost.id, lize.id, collette.id]);
    const utcDay = new Date().toISOString().slice(0, 10);
    assert.equal(store.getDailySpend(utcDay).callCount, 1);

    const { client: streamFailClient } = createScriptedClient([
      {
        json: {
          sceneChanged: false,
          location: 'Tavern',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'public',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 800,
          responders: [{ slug: 'lize', beatGoal: 'Speak', length: 'short' }],
          narratorDirective: 'Stream fails mid-flight.',
        },
      },
      {
        json: {
          internalThought: 'Fine.',
          physicalAction: 'Nods.',
          spokenLines: 'Wait.',
          tone: 'calm',
          knowledgeBoundaries: [],
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:lize]]\nPartial line before crash',
        midStreamError: 'Upstream dropped',
      },
    ], { store });

    const engineTwo = new TurnEngine({ store, client: streamFailClient, scribeService });
    await assert.rejects(
      () => engineTwo.runTurn({ campaignId: campaign.id, text: 'Let us go.' }),
      /Upstream dropped/,
    );
    assert.equal(store.listTurns(campaign.id).total, 0);
    assert.equal(store.getCampaign(campaign.id).sceneState.location, 'Oak Bedroom');
    assert.equal(store.getDailySpend(utcDay).callCount, 3);
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
                content: JSON.stringify({
                  sceneChanged: false,
                  location: 'Oak Bedroom',
                  day: 1,
                  timeLabel: 'Evening',
                  sceneType: 'private',
                  userInputKind: 'player_in_scene',
                  presentSlugs: ['frost', 'lize'],
                  remoteSlugs: [],
                  offscreenNotes: {},
                  walkOnsEnter: [],
                  walkOnsLeave: [],
                  encounterAccepted: false,
                  encounterBrief: '',
                  pacing: 'narrator_only',
                  targetChars: 800,
                  responders: [],
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
      {
        type: 'stream',
        text: '[[BEAT:narrator]]\nQuiet settles.',
      },
    ], { store });

    const engine = new TurnEngine({ store, client, scribeService });
    const firstTurnPromise = engine.runTurn({ campaignId: campaign.id, text: 'Wait here.' });

    await assert.rejects(
      () => engine.runTurn({ campaignId: campaign.id, text: 'Overlapping call.' }),
      (error) => error.name === 'ConflictError' && error.statusCode === 409,
    );
    assert.throws(
      () => engine.deleteLastTurnPair({ campaignId: campaign.id }),
      (error) => error.name === 'ConflictError' && error.statusCode === 409,
    );

    releaseDirector();
    await firstTurnPromise;

    const deleted = engine.deleteLastTurnPair({ campaignId: campaign.id });
    assert.deepEqual(deleted.deletedSeqs, [1, 2]);
  });

  it('withdraws discarded Scribe facts before Mind calls during regenerateLastTurn and preserves prior pair on regenerate abort', async () => {
    const fixture = createWorldFixture({ scribeInterval: 1, pedantEnabled: false });
    const { store, campaign, frost, lize } = fixture;

    const { client, calls } = createScriptedClient([
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 900,
          responders: [{ slug: 'lize', beatGoal: 'Answer', length: 'short' }],
          narratorDirective: 'Keep short.',
        },
      },
      {
        json: {
          internalThought: 'First attempt.',
          physicalAction: 'Taps table.',
          spokenLines: 'My brother went to Redwall.',
          tone: 'flat',
          knowledgeBoundaries: [],
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:lize]]\nMy brother went to Redwall.',
      },
      {
        text: '=== FACTS\nLize | trait | DISCARDED_SECRET_FACT_42 | #2',
      },
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 900,
          responders: [{ slug: 'lize', beatGoal: 'Answer differently', length: 'short' }],
          narratorDirective: 'Regenerate.',
        },
      },
      {
        json: {
          internalThought: 'Fresh take.',
          physicalAction: 'Sighs.',
          spokenLines: 'Wait.',
          tone: 'calm',
          knowledgeBoundaries: [],
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:lize]]\nPartial fail',
        midStreamError: 'Dropped mid regen',
      },
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 900,
          responders: [{ slug: 'lize', beatGoal: 'Answer differently', length: 'short' }],
          narratorDirective: 'Second regen succeeds.',
        },
      },
      {
        json: {
          internalThought: 'Clean state.',
          physicalAction: 'Smiles.',
          spokenLines: 'He took the northern road.',
          tone: 'steady',
          knowledgeBoundaries: [],
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:lize]]\nHe took the northern road.',
      },
      {
        text: '=== FACTS\nLize | trait | CLEAN_REGEN_FACT_88 | #2',
      },
    ], { store });

    const scribeService = new ScribeService({ store, client });
    const engine = new TurnEngine({ store, client, scribeService });

    const initialTurn = await engine.runTurn({
      campaignId: campaign.id,
      text: 'Where is your brother?',
      mode: TurnMode.Normal,
    });
    assert.equal(store.listTurns(campaign.id).total, 2);

    await assert.rejects(
      () => engine.regenerateLastTurn({ campaignId: campaign.id }),
      /Dropped mid regen/,
    );
    const afterFailedRegen = store.getLatestTurnPair(campaign.id);
    assert.equal(afterFailedRegen.assistantTurn.id, initialTurn.assistantTurn.id);
    assert.equal(afterFailedRegen.assistantTurn.beats[0].text, 'My brother went to Redwall.');

    const regenResult = await engine.regenerateLastTurn({ campaignId: campaign.id });
    assert.equal(regenResult.assistantTurn.beats[0].text, 'He took the northern road.');

    const secondRegenMindPrompt = JSON.stringify(calls[8].payload.messages);
    assert.equal(secondRegenMindPrompt.includes('DISCARDED_SECRET_FACT_42'), false);
    assert.equal(secondRegenMindPrompt.includes('Redwall'), false);

    const finalState = scribeService.loadState(campaign.id).state;
    const activeTexts = finalState.facts
      .filter((fact) => fact.status === 'InForce')
      .map((fact) => fact.text);
    assert.equal(activeTexts.includes('DISCARDED_SECRET_FACT_42'), false);
    assert.equal(activeTexts.includes('CLEAN_REGEN_FACT_88'), true);
  });

  it('handles deleteLastTurnPair rollback, editTurn dirty marking, sceneChanged prior-scene-only Scribe trigger, and Step 4 warning isolation', async () => {
    const fixture = createWorldFixture({ scribeInterval: 10, pedantEnabled: true });
    const { store, campaign, frost, lize } = fixture;

    const { client, calls } = createScriptedClient([
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'narrator_only',
          targetChars: 800,
          responders: [],
          narratorDirective: 'Scene 1 turn.',
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:narrator]]\nScene 1 candle flickers.',
      },
      {
        json: {
          sceneChanged: true,
          location: 'Courtyard',
          day: 1,
          timeLabel: 'Night',
          sceneType: 'public',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: ['Night Watchman'],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'narrator_only',
          targetChars: 800,
          responders: [],
          narratorDirective: 'Scene 2 courtyard.',
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:narrator]]\nScene 2 cold mist drifts across the courtyard.',
      },
      {
        text: '=== FACTS\nFrost | condition | Scene 1 candle noted | #2',
      },
    ], { store });

    const scribeService = new ScribeService({ store, client });
    const pedantService = new PedantService({ store, client, scribeService });
    const engine = new TurnEngine({ store, client, scribeService, pedantService });

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
          json: {
            sceneChanged: false,
            location: 'Oak Bedroom',
            day: 1,
            timeLabel: 'Evening',
            sceneType: 'private',
            userInputKind: 'player_in_scene',
            presentSlugs: ['frost', 'lize'],
            remoteSlugs: [],
            offscreenNotes: {},
            walkOnsEnter: [],
            walkOnsLeave: [],
            encounterAccepted: false,
            encounterBrief: '',
            pacing: 'narrator_only',
            targetChars: 800,
            responders: [],
            narratorDirective: 'Check Step 4 resilience.',
          },
        },
        { type: 'stream', text: '[[BEAT:narrator]]\nCommitted despite Step 4 error.' },
      ], { store }).client,
      scribeService: {
        loadState: () => scribeService.loadState(campaign.id),
        characterKnowledgePacket: (args) => scribeService.characterKnowledgePacket(args),
        updateMemory: async () => {
          throw new Error('Scribe offline');
        },
      },
      pedantService: {
        checkTurn: async () => {
          throw new Error('Pedant offline');
        },
      },
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
    assert.equal(events.some((item) => item.event === 'committed'), true);
    const warnings = events.filter((item) => item.event === 'warning');
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

  it('covers CharacterMind repair retry, NarratorComposer zero-beat guard and truncation, Director mode overrides, BeatParser split CRLF, parent abort cleanup, multi-beat editTurn, and deleteLastTurnPair Scribe withdrawal', async () => {
    const crlfParser = new BeatParser({
      validSlugs: ['lize'],
      slugToName: { lize: 'Lize' },
      playerSlug: 'frost',
    });
    const partA = crlfParser.push('[[BEAT:lize]]\r');
    const partB = crlfParser.push('\nHello there');
    const partC = crlfParser.flush();
    assert.equal(partA.length, 0);
    assert.equal([...partB, ...partC].map((entry) => entry.delta).join(''), 'Hello there');

    const fixture = createWorldFixture({ scribeInterval: 1, pedantEnabled: false });
    const { store, campaign, frost, lize, collette } = fixture;

    const { client: mindRetryClient } = createScriptedClient([
      { text: 'not json' },
      {
        json: {
          internalThought: 'Guarded.',
          physicalAction: 'Steps back.',
          spokenLines: 'Who goes there?',
          tone: 'wary',
          knowledgeBoundaries: 'Unknown visitor',
        },
      },
    ], { store });

    const mindPacket = await CharacterMind.think({
      character: lize,
      campaign,
      nextState: campaign.sceneState,
      presentCharacters: [frost, lize],
      witnessedHistory: [],
      knowledgePacket: {
        knownFacts: [],
        relationships: [],
        visibleThreads: [{ id: 'T1', text: 'Missing ledger' }],
        rulings: [],
      },
      currentInput: 'PRIVATE_PRE_ARRIVAL_SECRET',
      isArriving: true,
      encounterBrief: 'A lantern flickers in the doorway.',
      model: 'openai/gpt-4.1',
      client: mindRetryClient,
    });
    assert.equal(mindPacket.spendIds.length, 2);
    assert.deepEqual(mindPacket.knowledgeBoundaries, ['Unknown visitor']);

    const { client: emptyComposerClient } = createScriptedClient([
      { type: 'stream', text: '[[BEAT:lize]]   \n   ' },
    ], { store });
    await assert.rejects(
      () => NarratorComposer.compose({
        campaign,
        characters: [frost, lize],
        nextState: campaign.sceneState,
        recentSceneTurns: [
          {
            id: 'other-scene',
            seq: 1,
            sceneNumber: 99,
            beats: [{ speakerName: 'Viola', text: 'OTHER_SCENE_LEAK' }],
          },
        ],
        userBeat: { speakerType: SpeakerType.Player, speakerName: 'Frost', text: 'Hello.' },
        directorPlan: {
          pacing: 'narrator_only',
          targetChars: 800,
          narratorDirective: '',
          encounterAccepted: false,
          encounterBrief: '',
        },
        mindPackets: [],
        model: 'openai/gpt-4.1',
        client: emptyComposerClient,
      }),
      /zero non-empty beats/,
    );

    const { client: truncClient, calls: truncCalls } = createScriptedClient([
      {
        type: 'stream',
        text: '[[BEAT:narrator]]\nA cold gust.\n[[BEAT:lize]]\nWait—',
        finishReason: 'length',
      },
    ], { store });
    const composedTrunc = await NarratorComposer.compose({
      campaign,
      characters: [frost, lize],
      nextState: campaign.sceneState,
      recentSceneTurns: [
        {
          id: 'wrong-scene',
          seq: 1,
          sceneNumber: 99,
          beats: [{ speakerName: 'Viola', text: 'WRONG_SCENE_TEXT' }],
        },
      ],
      userBeat: { speakerType: SpeakerType.Player, speakerName: 'Frost', text: 'Look.' },
      directorPlan: {
        pacing: 'focused_one',
        targetChars: 800,
        narratorDirective: 'Brief.',
        encounterAccepted: false,
        encounterBrief: '',
      },
      mindPackets: [mindPacket],
      model: 'openai/gpt-4.1',
      client: truncClient,
    });
    assert.equal(composedTrunc.truncated, true);
    assert.equal(JSON.stringify(truncCalls[0].payload.messages).includes('WRONG_SCENE_TEXT'), false);
    assert.equal(composedTrunc.beats[0].mindPacket, null);
    assert.equal(composedTrunc.beats[1].mindPacket.internalThought, 'Guarded.');
    assert.equal(Object.hasOwn(composedTrunc.beats[1].mindPacket, 'spendIds'), false);

    const { client: encDirClient } = createScriptedClient([
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'narrator_only',
          targetChars: 800,
          responders: [{ slug: 'lize', beatGoal: 'Should be cleared', length: 'short' }],
          narratorDirective: 'Check overrides.',
        },
      },
    ], { store });
    const forcedEncPlan = await Director.planTurn({
      campaign,
      characters: [frost, lize],
      preState: campaign.sceneState,
      userText: '*(Encounter)*',
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
    const { client: abortMindClient } = createScriptedClient([
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 800,
          responders: [{ slug: 'lize', beatGoal: 'Wait for abort', length: 'short' }],
          narratorDirective: 'Abort test.',
        },
      },
      ({ init }) => new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const abortErr = new Error('Aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        }, { once: true });
        parentController.abort('user_cancelled');
      }),
    ], { store });
    const abortEngine = new TurnEngine({
      store,
      client: abortMindClient,
      scribeService: new ScribeService({ store }),
    });
    await assert.rejects(
      () => abortEngine.runTurn({
        campaignId: campaign.id,
        text: 'Wait.',
        signal: parentController.signal,
      }),
      (error) => error.name === 'AbortError',
    );

    const { client: fullCycleClient } = createScriptedClient([
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize', 'collette'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: true,
          encounterBrief: 'Collette arrives at the bedroom door.',
          pacing: 'group_banter',
          targetChars: 1000,
          responders: [
            { slug: 'lize', beatGoal: 'Answer', length: 'short' },
            { slug: 'collette', beatGoal: 'Speak', length: 'short' },
          ],
          narratorDirective: 'Narrator introduces encounter first.',
        },
      },
      {
        json: {
          internalThought: 'Fine.',
          physicalAction: 'Looks up.',
          spokenLines: 'Come in.',
          tone: 'calm',
          knowledgeBoundaries: [],
        },
      },
      {
        json: {
          internalThought: 'Phew.',
          physicalAction: 'Steps in.',
          spokenLines: 'Dinner is hot.',
          tone: 'warm',
          knowledgeBoundaries: [],
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:narrator]]\nA knock breaks the silence.\n[[BEAT:lize]]\nCome in.\n[[BEAT:collette]]\nDinner is hot.',
      },
      {
        text: '=== FACTS\nCollette | trait | TEMP_BOOK_FACT_TO_WITHDRAW | #2',
      },
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize', 'collette'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: true,
          encounterBrief: 'Collette arrives at the bedroom door.',
          pacing: 'group_banter',
          targetChars: 1000,
          responders: [
            { slug: 'lize', beatGoal: 'Answer', length: 'short' },
            { slug: 'collette', beatGoal: 'Speak', length: 'short' },
          ],
          narratorDirective: 'Narrator introduces encounter first.',
        },
      },
      {
        json: {
          internalThought: 'Fine.',
          physicalAction: 'Looks up.',
          spokenLines: 'Come in.',
          tone: 'calm',
          knowledgeBoundaries: [],
        },
      },
      {
        json: {
          internalThought: 'Phew.',
          physicalAction: 'Steps in.',
          spokenLines: 'Dinner is hot.',
          tone: 'warm',
          knowledgeBoundaries: [],
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:narrator]]\nA knock breaks the silence.\n[[BEAT:lize]]\nCome in.\n[[BEAT:collette]]\nDinner is hot.',
      },
      {
        text: '=== FACTS\nCollette | trait | EDIT_TURN_FACT_TO_WITHDRAW | #2',
      },
    ], { store });
    const scribeForCycle = new ScribeService({ store, client: fullCycleClient });
    const cycleEngine = new TurnEngine({ store, client: fullCycleClient, scribeService: scribeForCycle });

    const firstMultiBeatTurn = await cycleEngine.runTurn({
      campaignId: campaign.id,
      text: 'Hold on, Lize.',
      mode: TurnMode.Encounter,
    });
    assert.equal(firstMultiBeatTurn.userTurn.witnessIds.includes(collette.id), false);
    assert.equal(firstMultiBeatTurn.assistantTurn.beats[0].witnessIds.includes(collette.id), false);
    assert.equal(firstMultiBeatTurn.assistantTurn.beats[1].witnessIds.includes(collette.id), false);
    assert.equal(firstMultiBeatTurn.assistantTurn.beats[2].witnessIds.includes(collette.id), true);

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

  it('validates models before OpenRouter and handles Encounter blank text fallback', async () => {
    const noDirectorFixture = createWorldFixture({ models: { director: '' } });
    const { client: unusedClient, calls: unusedCalls } = createScriptedClient([], { store: noDirectorFixture.store });
    const noDirectorEngine = new TurnEngine({
      store: noDirectorFixture.store,
      client: unusedClient,
      scribeService: new ScribeService({ store: noDirectorFixture.store }),
    });
    await assert.rejects(
      () => noDirectorEngine.runTurn({ campaignId: noDirectorFixture.campaign.id, text: 'Hello' }),
      /Director model/,
    );
    assert.equal(unusedCalls.length, 0);

    const noMainFixture = createWorldFixture({ models: { main: '' } });
    const { client: step2FailClient, calls: step2Calls } = createScriptedClient([
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: true,
          encounterBrief: 'A stray hound wanders past.',
          pacing: 'focused_one',
          targetChars: 800,
          responders: [{ slug: 'lize', beatGoal: 'React', length: 'short' }],
          narratorDirective: 'Check model before Step 2.',
        },
      },
    ], { store: noMainFixture.store });
    const noMainEngine = new TurnEngine({
      store: noMainFixture.store,
      client: step2FailClient,
      scribeService: new ScribeService({ store: noMainFixture.store }),
      random: () => 0.5,
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
    assert.equal(step2Calls[0].payload.messages[1].content.includes('*(Encounter)*'), true);
    assert.equal(noMainFixture.store.listTurns(noMainFixture.campaign.id).total, 0);
  });

  it('rolls back regenerateLastTurn, deleteLastTurnPair, and editTurn atomically when a compound write fails', async () => {
    const fixture = createWorldFixture({ scribeInterval: 1, pedantEnabled: false });
    const { store, campaign } = fixture;
    const { client } = createScriptedClient([
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'narrator_only',
          targetChars: 800,
          responders: [],
          narratorDirective: 'Turn 1.',
        },
      },
      { type: 'stream', text: '[[BEAT:narrator]]\nOriginal candle glow.' },
      { text: '=== FACTS\nLize | condition | holding brass key | #2' },
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'narrator_only',
          targetChars: 800,
          responders: [],
          narratorDirective: 'Regenerate.',
        },
      },
      { type: 'stream', text: '[[BEAT:narrator]]\nRegenerated reply.' },
    ], { store });

    const scribeService = new ScribeService({ store, client });
    const engine = new TurnEngine({ store, client, scribeService });
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
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: { collette: 'In kitchen' },
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 900,
          responders: [{ slug: 'lize', beatGoal: 'Hide cipher', length: 'short' }],
          narratorDirective: 'Turn 1.',
        },
      },
      {
        json: {
          internalThought: 'Safe here.',
          physicalAction: 'Lifts floorboard.',
          spokenLines: 'The cipher sits under the loose oak plank.',
          tone: 'quiet',
          knowledgeBoundaries: [],
        },
      },
      { type: 'stream', text: '[[BEAT:lize]]\nThe cipher sits under the loose oak plank.' },
      { text: '=== FACTS\nLize | belonging | PRIVATE_CIPHER_IN_FLOOR | #2' },
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: { collette: 'In kitchen' },
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 900,
          responders: [{ slug: 'lize', beatGoal: 'React', length: 'short' }],
          narratorDirective: 'Turn 2.',
        },
      },
      {
        json: {
          internalThought: 'Wait.',
          physicalAction: 'Listens.',
          spokenLines: 'Someone is outside.',
          tone: 'tense',
          knowledgeBoundaries: [],
        },
      },
      { type: 'stream', text: '[[BEAT:lize]]\nSomeone is outside.' },
      { text: '=== FACTS\nLize | condition | DISCARDED_TURN2_FACT | #4' },
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: { collette: 'In kitchen' },
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 900,
          responders: [{ slug: 'lize', beatGoal: 'React again', length: 'short' }],
          narratorDirective: 'Regenerate turn 2.',
        },
      },
      {
        json: {
          internalThought: 'Still safe.',
          physicalAction: 'Nods.',
          spokenLines: 'All quiet in the hall.',
          tone: 'calm',
          knowledgeBoundaries: [],
        },
      },
      { type: 'stream', text: '[[BEAT:lize]]\nAll quiet in the hall.' },
      { text: '=== FACTS\nLize | condition | REGENERATED_TURN2_FACT | #4' },
    ], { store });

    const scribeService = new ScribeService({ store, client });
    const engine = new TurnEngine({ store, client, scribeService });

    await engine.runTurn({ campaignId: campaign.id, text: 'Where is the cipher?' });
    await engine.runTurn({ campaignId: campaign.id, text: 'Did you hear footsteps?' });

    await engine.regenerateLastTurn({ campaignId: campaign.id });

    const regenMindCall = calls[9];
    const regenMindPrompt = JSON.stringify(regenMindCall.payload.messages);
    assert.equal(regenMindPrompt.includes('PRIVATE_CIPHER_IN_FLOOR'), true);
    assert.equal(regenMindPrompt.includes('DISCARDED_TURN2_FACT'), false);

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

  it('enforces Case A and Case B mid-turn arrival witnessIds isolation', async () => {
    const fixture = createWorldFixture({ publicOdds: 1, privateOdds: 1, pedantEnabled: false });
    const { store, campaign, frost, lize, collette, mirra, maya } = fixture;
    store.updateCampaign(campaign.id, {
      sceneState: {
        ...campaign.sceneState,
        sceneType: SceneType.Public,
      },
    });
    const scribeService = new ScribeService({ store });

    const { client } = createScriptedClient([
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'public',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize', 'collette'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: true,
          encounterBrief: 'Collette walks up to the door.',
          pacing: 'focused_one',
          targetChars: 900,
          responders: [{ slug: 'lize', beatGoal: 'Hide Ember', length: 'short' }],
          narratorDirective: 'Lize speaks first, then Narrator describes Collette.',
        },
      },
      {
        json: {
          internalThought: 'Close.',
          physicalAction: 'Nods.',
          spokenLines: 'Got it, Ember is safe.',
          tone: 'hushed',
          knowledgeBoundaries: [],
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:lize]]\nGot it, Ember is safe.\n[[BEAT:narrator]]\nCollette shuts the door.',
      },
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'public',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize', 'collette'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: true,
          encounterBrief: 'Collette approaches outside.',
          pacing: 'focused_one',
          targetChars: 900,
          responders: [{ slug: 'lize', beatGoal: 'Whisper', length: 'short' }],
          narratorDirective: 'Collette never enters in beats.',
        },
      },
      {
        json: {
          internalThought: 'Safe.',
          physicalAction: 'Glances at window.',
          spokenLines: 'Still secret.',
          tone: 'low',
          knowledgeBoundaries: [],
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:lize]]\nStill secret.\n[[BEAT:narrator]]\nRain taps the glass.',
      },
      {
        json: {
          sceneChanged: false,
          location: 'Party Wagon',
          day: 1,
          timeLabel: 'Night',
          sceneType: 'public',
          userInputKind: 'player_in_scene',
          presentSlugs: ['mirra', 'frost', 'maya'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: true,
          encounterBrief: 'Maya dashes up to the wagon.',
          pacing: 'group_banter',
          targetChars: 900,
          responders: [
            { slug: 'mirra', beatGoal: 'Welcome Frost', length: 'short' },
            { slug: 'maya', beatGoal: 'Deliver message', length: 'short' },
          ],
          narratorDirective: 'Mirra greets Frost before Maya arrives.',
        },
      },
      {
        json: {
          internalThought: 'Glad Frost is here.',
          physicalAction: 'Waves Frost in.',
          spokenLines: 'Glad you are back, Frost.',
          tone: 'relieved',
          knowledgeBoundaries: [],
        },
      },
      {
        json: {
          internalThought: 'Out of breath.',
          physicalAction: 'Holds up scroll.',
          spokenLines: 'Message!',
          tone: 'urgent',
          knowledgeBoundaries: [],
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:mirra]]\nGlad you are back, Frost.\n[[BEAT:maya]]\nMessage!',
      },
    ], { store });

    const engine = new TurnEngine({ store, client, scribeService, random: () => 0.1 });

    const caseA1 = await engine.runTurn({
      campaignId: campaign.id,
      text: 'Keep Ember secret.',
      mode: TurnMode.Normal,
    });
    assert.equal(caseA1.userTurn.witnessIds.includes(collette.id), false);
    assert.equal(caseA1.assistantTurn.beats[0].witnessIds.includes(collette.id), false);
    assert.equal(caseA1.assistantTurn.beats[1].witnessIds.includes(collette.id), true);

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
      },
    });
    const caseB = await engine.runTurn({
      campaignId: campaign.id,
      text: 'I climb back into the wagon.',
      mode: TurnMode.Normal,
    });
    assert.deepEqual(caseB.userTurn.witnessIds.sort(), [frost.id, mirra.id].sort());
    assert.deepEqual(caseB.assistantTurn.beats[0].witnessIds.sort(), [frost.id, mirra.id].sort());
    assert.deepEqual(caseB.assistantTurn.beats[1].witnessIds.sort(), [frost.id, maya.id, mirra.id].sort());
  });

  it('maintains strict 1:1 beatIndex parity in BeatParser across leading whitespace, whitespace-only beats, consecutive aliases, and player remapping', () => {
    const parser = new BeatParser({
      validSlugs: ['lize', 'collette'],
      nameToSlug: {
        Lize: 'lize',
        'Lady Lize': 'lize',
        Frost: 'frost',
      },
      slugToName: {
        lize: 'Lize',
        collette: 'Collette',
      },
      playerSlug: 'frost',
    });

    const rawOutput = [
      '  \n  ',
      '[[BEAT:lize]]\n   \n',
      '[[BEAT:Lady Lize]]\nFirst line.\n',
      '[[BEAT:lize]]\nSecond line.\n',
      '[[BEAT:collette]]\n   \n',
      '[[BEAT:frost]]\nFrost whispers.\n',
      '[[BEAT:narrator]]\nWind howls.',
    ].join('');

    const deltas = [];
    for (let charIndex = 0; charIndex < rawOutput.length; charIndex += 1) {
      deltas.push(...parser.push(rawOutput[charIndex]));
    }
    deltas.push(...parser.flush());

    const beats = parser.getBeats();
    assert.equal(beats.length, 2);
    assert.equal(beats[0].slug, 'lize');
    assert.equal(beats[0].text, 'First line.\n\nSecond line.');
    assert.equal(beats[1].speakerType, SpeakerType.Narrator);
    assert.equal(beats[1].text, 'Frost whispers.\n\nWind howls.');
    assert.equal(parser.wasPlayerBeatRemapped(), true);

    const emittedIndices = [...new Set(deltas.map((item) => item.beatIndex))];
    assert.deepEqual(emittedIndices, [0, 1]);
    for (let index = 0; index < beats.length; index += 1) {
      const streamedForBeat = deltas
        .filter((item) => item.beatIndex === index)
        .map((item) => item.delta)
        .join('')
        .trim();
      assert.equal(streamedForBeat, beats[index].text);
    }
  });

  it('preserves root-cause error from second Mind responder instead of sibling AbortError', async () => {
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

    let responderZeroAborted = false;
    const { client } = createScriptedClient([
      {
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize', 'collette'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'group_banter',
          targetChars: 900,
          responders: [
            { slug: 'lize', beatGoal: 'Slow mind', length: 'short' },
            { slug: 'collette', beatGoal: 'Fails with 401', length: 'short' },
          ],
          narratorDirective: 'Check root cause.',
        },
      },
      ({ init }) => new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          responderZeroAborted = true;
          const abortErr = new Error('Aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        }, { once: true });
      }),
      { type: 'error', status: 401, message: 'Unauthorized responder key' },
    ], { store });

    const engine = new TurnEngine({ store, client, scribeService });
    await assert.rejects(
      () => engine.runTurn({ campaignId: campaign.id, text: 'Both speak.' }),
      (error) => error.name !== 'AbortError' && /401/.test(error.message),
    );
    assert.equal(responderZeroAborted, true);
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
        json: {
          sceneChanged: 'false',
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize', 'collette', 'viola', 'mirra'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: 'false',
          encounterBrief: 'Should be ignored',
          pacing: 'group_banter',
          targetChars: 1400,
          responders: [
            { slug: 'lize', beatGoal: 'Speak 1', length: 'short' },
            { slug: 'collette', beatGoal: 'Speak 2', length: 'short' },
            { slug: 'viola', beatGoal: 'Speak 3', length: 'short' },
            { slug: 'mirra', beatGoal: 'Speak 4', length: 'short' },
          ],
          narratorDirective: 'All four respond.',
        },
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
        json: {
          sceneChanged: false,
          location: 'Oak Bedroom',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize', 'collette', 'viola', 'mirra'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'group_banter',
          targetChars: 1400,
          responders: [
            { slug: 'lize', beatGoal: '1', length: 'short' },
            { slug: 'collette', beatGoal: '2', length: 'short' },
            { slug: 'viola', beatGoal: '3', length: 'short' },
            { slug: 'mirra', beatGoal: '4', length: 'short' },
          ],
          narratorDirective: 'All four reply.',
        },
      },
      { json: { internalThought: 'T1', physicalAction: 'A1', spokenLines: 'Lize here.', tone: 'calm', knowledgeBoundaries: [] } },
      { json: { internalThought: 'T2', physicalAction: 'A2', spokenLines: 'Collette here.', tone: 'warm', knowledgeBoundaries: [] } },
      { json: { internalThought: 'T3', physicalAction: 'A3', spokenLines: 'Viola here.', tone: 'cool', knowledgeBoundaries: [] } },
      { json: { internalThought: 'T4', physicalAction: 'A4', spokenLines: 'Mirra here.', tone: 'steady', knowledgeBoundaries: [] } },
      {
        type: 'stream',
        text: [
          '[[BEAT:lize]]\nLize here.\n',
          '[[BEAT:collette]]\nCollette here.\n',
          '[[BEAT:viola]]\nViola here.\n',
          '[[BEAT:mirra]]\nMirra here.',
        ].join(''),
      },
    ], { store });

    const ensembleEngine = new TurnEngine({ store, client: ensembleClient, scribeService });
    const ensembleTurn = await ensembleEngine.runTurn({
      campaignId: campaign.id,
      text: 'All four of you, sound off.',
      mode: TurnMode.Normal,
    });
    assert.equal(ensembleCalls.length, 6);
    assert.equal(ensembleTurn.plan.responders.length, 4);
    assert.equal(ensembleTurn.assistantTurn.beats.length, 4);
  });
});

describe('Unknown card values reach requests as unknown', () => {
  const directorReply = Object.freeze({
    sceneChanged: false,
    location: 'Oak Bedroom',
    day: 1,
    timeLabel: 'Evening',
    sceneType: 'private',
    userInputKind: 'player_in_scene',
    presentSlugs: ['frost', 'lize'],
    remoteSlugs: [],
    offscreenNotes: {},
    walkOnsEnter: [],
    walkOnsLeave: [],
    encounterAccepted: false,
    encounterBrief: '',
    pacing: 'focused_one',
    targetChars: 800,
    responders: [],
    narratorDirective: '',
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
    const { client, calls } = createScriptedClient([{ json: directorReply }], { store: fixture.store });

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

  it('shows the CharacterMind identity and known facts as unknown', async () => {
    const fixture = createWorldFixture();
    const lize = unknownLize(fixture);
    const { client, calls } = createScriptedClient([
      {
        json: {
          internalThought: 'Hm.',
          physicalAction: 'Waits.',
          spokenLines: 'Well.',
          tone: 'dry',
          knowledgeBoundaries: ['none'],
        },
      },
    ], { store: fixture.store });

    await CharacterMind.think({
      character: lize,
      campaign: fixture.campaign,
      nextState: fixture.campaign.sceneState,
      presentCharacters: [fixture.frost, lize],
      witnessedHistory: [],
      knowledgePacket: {
        knownFacts: [{ subject: 'S2', category: 'age', target: null, targetText: null, text: '?' }],
        relationships: [],
        visibleThreads: [],
        rulings: [{ subject: 'S2', category: 'hair', target: null, targetText: null, text: '?' }],
      },
      currentInput: 'Hello.',
      model: 'openai/gpt-4.1',
      client,
    });

    const text = requestText(calls);
    assert.match(text, /Persona: unknown/);
    assert.match(text, /Voice notes: unknown/);
    assert.match(text, /\| age: unknown/);
    assert.match(text, /\| hair: unknown/);
    assert.doesNotMatch(text, /: \?(\n|$)/);
  });

  it('shows the NarratorComposer cast voice as unknown', async () => {
    const fixture = createWorldFixture();
    const lize = unknownLize(fixture);
    const { client, calls } = createScriptedClient([
      { type: 'stream', text: '[[BEAT:narrator]]\nA cold gust.' },
    ], { store: fixture.store });

    await NarratorComposer.compose({
      campaign: fixture.campaign,
      characters: [fixture.frost, lize],
      nextState: { ...fixture.campaign.sceneState, presentIds: [fixture.frost.id, lize.id] },
      recentSceneTurns: [],
      userBeat: { speakerType: SpeakerType.Player, speakerName: 'Frost', text: 'Look.' },
      directorPlan: {
        pacing: 'narrator_only',
        targetChars: 800,
        narratorDirective: 'Brief.',
        encounterAccepted: false,
        encounterBrief: '',
      },
      mindPackets: [],
      model: 'openai/gpt-4.1',
      client,
    });

    const text = requestText(calls);
    assert.match(text, /voice: unknown/);
    assert.doesNotMatch(text, /voice: \?/);
  });
});

describe('Player narration beat in the player turn', () => {
  const directorPlan = Object.freeze({
    sceneChanged: false,
    location: 'Oak Bedroom',
    day: 1,
    timeLabel: 'Evening',
    sceneType: 'private',
    userInputKind: 'player_in_scene',
    presentSlugs: ['frost', 'lize'],
    remoteSlugs: [],
    offscreenNotes: {},
    walkOnsEnter: [],
    walkOnsLeave: [],
    encounterAccepted: false,
    encounterBrief: '',
    pacing: 'focused_one',
    targetChars: 900,
    responders: [{ slug: 'lize', beatGoal: 'React', length: 'short' }],
    narratorDirective: 'Keep it close.',
  });
  const mindReply = Object.freeze({
    internalThought: 'Thinking.',
    physicalAction: 'Lize looks up.',
    spokenLines: 'Hm.',
    tone: 'dry',
    knowledgeBoundaries: [],
  });

  /**
   * @param {{text: string, narration?: string | null, mode?: string, scribeText?: string | null, prepare?: ((fixture: object) => void) | null}} options
   * @returns {Promise<{fixture: object, result: object, calls: Array<object>, events: Array<{event: string, data: unknown}>}>}
   * @throws {Error}
   */
  const runTurn = async ({ text, narration = null, mode = TurnMode.Normal, scribeText = null, prepare = null }) => {
    const fixture = createWorldFixture({ scribeInterval: scribeText === null ? 10 : 1, pedantEnabled: false });
    if (prepare !== null) {
      prepare(fixture);
    }
    /** @type {Array<{json?: object, type?: string, text?: string}>} */
    const script = [
      { json: directorPlan },
      { json: mindReply },
      { type: 'stream', text: '[[BEAT:lize]]\n*Lize looks up.*\nHm.' },
    ];
    if (scribeText !== null) {
      script.push({ text: scribeText });
    }
    const { client, calls } = createScriptedClient(script, { store: fixture.store });
    const engine = new TurnEngine({
      store: fixture.store,
      client,
      scribeService: new ScribeService({ store: fixture.store, client }),
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
   * @throws {Error}
   */
  const regenerationEngine = (fixture) => {
    const { client, calls } = createScriptedClient([
      { json: directorPlan },
      { json: mindReply },
      { type: 'stream', text: '[[BEAT:lize]]\n*Lize nods.*\nYes.' },
    ], { store: fixture.store });
    const engine = new TurnEngine({ store: fixture.store, client, scribeService: new ScribeService({ store: fixture.store }) });
    return { engine, calls };
  };

  /**
   * @param {Array<{payload: {messages: Array<{content: string}>}}>} calls
   * @param {string} wholeMessage
   * @returns {void}
   * @throws {Error}
   */
  const assertEveryModelGotThe = (calls, wholeMessage) => {
    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.equal(call.payload.messages.map((message) => message.content).join('\n').includes(wholeMessage), true);
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

      assertEveryModelGotThe(calls, 'I look at her again.\n\nHer hair is dyed black.');
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

    assertEveryModelGotThe(calls, 'She looks up.\n\nRain falls.\n\nShe waits.');
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
          category: 'hair',
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
    assert.deepEqual(events.filter((entry) => entry.event === 'warning'), []);
    const loaded = new ScribeService({ store: fixture.store }).loadState(fixture.campaign.id);
    const hair = Object.fromEntries(
      loaded.state.facts.filter((fact) => fact.category === 'hair').map((fact) => [fact.text, fact.status]),
    );

    assert.deepEqual(hair, { red: 'Reported', 'black, freshly dyed': 'InForce' });
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
