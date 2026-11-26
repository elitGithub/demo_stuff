import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { OpenRouterClient } from '../src/openrouter/OpenRouterClient.mjs';
import { CardFiling } from '../src/scribe/CardFiling.mjs';
import { MuseService } from '../src/scribe/MuseService.mjs';
import { PedantService } from '../src/scribe/PedantService.mjs';
import { ScribeAnalyzer } from '../src/scribe/ScribeAnalyzer.mjs';
import { ScribeAnswer } from '../src/scribe/ScribeAnswer.mjs';
import { ScribeCategory } from '../src/scribe/ScribeCategory.mjs';
import { ScribeIntakeAdapter } from '../src/scribe/ScribeIntakeAdapter.mjs';
import { ScribeKnowledge } from '../src/scribe/ScribeKnowledge.mjs';
import { ScribeLogCore } from '../src/scribe/ScribeLogCore.mjs';
import { ScribeReplay } from '../src/scribe/ScribeReplay.mjs';
import { ScribeService } from '../src/scribe/ScribeService.mjs';
import { ScribeText } from '../src/scribe/ScribeText.mjs';
import { CharacterCard } from '../src/store/CharacterCard.mjs';
import { AvatarToken } from '../src/store/enums/AvatarToken.mjs';
import { CharacterTier } from '../src/store/enums/CharacterTier.mjs';
import { FindingKind } from '../src/store/enums/FindingKind.mjs';
import { FindingStatus } from '../src/store/enums/FindingStatus.mjs';
import { SceneType } from '../src/store/enums/SceneType.mjs';
import { SpeakerType } from '../src/store/enums/SpeakerType.mjs';
import { SpendStage } from '../src/store/enums/SpendStage.mjs';
import { TurnMode } from '../src/store/enums/TurnMode.mjs';
import { TurnRole } from '../src/store/enums/TurnRole.mjs';
import { SqliteStore } from '../src/store/SqliteStore.mjs';

/**
 * @param {Array<string | ((payload: object) => string)>} responses
 * @param {{store?: SqliteStore | null}} [options]
 * @returns {{client: OpenRouterClient, calls: Array<object>}}
 * @throws {TypeError | RangeError}
 */
function createFakeClient(responses, { store = null } = {}) {
  const queue = [...responses];
  const calls = [];
  const client = new OpenRouterClient({
    /**
     * @returns {string}
     */
    apiKeyProvider: () => 'sk-test-fake-scribe-key',
    onSpend: store === null
      ? null
      /**
       * @param {object} spendDto
       * @returns {void}
       * @throws {Error}
       */
      : (spendDto) => store.recordSpend(spendDto),
    /**
     * @param {string} url
     * @param {{body: string}} init
     * @returns {Promise<Response>}
     * @throws {Error}
     */
    fetchImpl: async (url, init) => {
      const parsedBody = JSON.parse(init.body);
      calls.push(parsedBody);
      const responder = queue.shift();
      if (responder === undefined) {
        throw new Error('Unexpected OpenRouter call with empty scripted queue.');
      }
      const text = typeof responder === 'function' ? responder(parsedBody) : responder;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: 45, cost: 0.0012 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  return { client, calls };
}

/**
 * @param {{scribeModel?: string}} [options]
 * @returns {{store: SqliteStore, campaign: object, rowan: object, mara: object, vesper: object, corin: object}}
 * @throws {Error}
 */
function createSeededCampaign({ scribeModel = 'openai/gpt-4.1-mini' } = {}) {
  const store = new SqliteStore(':memory:');
  store.updateSettings({
    models: {
      director: 'openai/gpt-4.1-mini',
      composer: 'openai/gpt-4.1',
      main: 'openai/gpt-4.1',
      recurring: 'openai/gpt-4.1-mini',
      scribe: scribeModel,
    },
  });

  const campaign = store.createCampaign({
    title: 'Harbor Watch',
    premise: 'A quiet port town hiding contraband vaults.',
    styleNotes: 'Grounded low fantasy.',
    sceneState: {
      sceneNumber: 1,
      day: 1,
      timeLabel: 'Night',
      location: 'Lantern Bedroom',
      sceneType: SceneType.Private,
      presentIds: [],
      remoteIds: [],
      offscreenNotes: {},
      activeWalkOns: [],
    },
  });

  const rowan = store.createCharacter(campaign.id, {
    slug: 'rowan',
    scribeSubjectId: 'S1',
    name: 'Rowan',
    aliases: ['Watchman Rowan'],
    isPlayer: true,
    tier: CharacterTier.Main,
    avatarToken: AvatarToken.Slate,
  });
  const mara = store.createCharacter(campaign.id, {
    slug: 'mara',
    scribeSubjectId: 'S2',
    name: 'Mara',
    aliases: ['Lady Mara'],
    isPlayer: false,
    tier: CharacterTier.Main,
    avatarToken: AvatarToken.Rose,
  });
  const vesper = store.createCharacter(campaign.id, {
    slug: 'vesper',
    scribeSubjectId: 'S3',
    name: 'Vesper',
    aliases: ['Clerk Vesper'],
    isPlayer: false,
    tier: CharacterTier.Recurring,
    avatarToken: AvatarToken.Teal,
  });
  const corin = store.createCharacter(campaign.id, {
    slug: 'corin',
    scribeSubjectId: 'S4',
    name: 'Corin',
    aliases: [],
    isPlayer: false,
    tier: CharacterTier.Recurring,
    avatarToken: AvatarToken.Amber,
  });

  const updatedCampaign = store.updateCampaign(campaign.id, {
    playerCharacterId: rowan.id,
    sceneState: {
      sceneNumber: 1,
      day: 1,
      timeLabel: 'Night',
      location: 'Lantern Bedroom',
      sceneType: SceneType.Private,
      presentIds: [rowan.id, mara.id],
      remoteIds: [vesper.id],
      offscreenNotes: { corin: 'Asleep at the barracks' },
      activeWalkOns: [],
    },
  });

  return { store, campaign: updatedCampaign, rowan, mara, vesper, corin };
}

describe('Surgical Scribe core extraction', () => {
  it('preserves Operator seeded subjects, aliases, public/hidden facts, and threads at position 0 with empty turns and alongside seq >= 1', () => {
    const log = ScribeLogCore.create();
    let state = ScribeReplay.run(log, []);

    const firstSync = ScribeLogCore.syncCharacterSubject(log, state, {
      subjectId: null,
      name: 'Rowan',
      aliases: ['Watchman Rowan'],
      kind: ScribeCategory.SubjectKinds.Character,
    });
    assert.equal(firstSync.subjectId, 'S1');
    assert.equal(firstSync.changed, true);
    state = ScribeReplay.run(log, []);

    const idempotentSync = ScribeLogCore.syncCharacterSubject(log, state, {
      subjectId: 'S1',
      name: 'Rowan',
      aliases: ['Watchman Rowan'],
      kind: ScribeCategory.SubjectKinds.Character,
    });
    assert.equal(idempotentSync.changed, false);

    const secondSync = ScribeLogCore.syncCharacterSubject(log, state, {
      subjectId: null,
      name: 'Mara',
      aliases: ['Lady Mara'],
      kind: ScribeCategory.SubjectKinds.Character,
    });
    assert.equal(secondSync.subjectId, 'S2');
    state = ScribeReplay.run(log, []);

    ScribeLogCore.rule(log, state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: 'S1',
      category: 'eyes',
      target: null,
      text: 'grey',
      hidden: false,
      cite: null,
      position: 0,
    });
    state = ScribeReplay.run(log, []);

    ScribeLogCore.rule(log, state, {
      type: ScribeLogCore.Ruling.AddFact,
      subject: 'S2',
      category: 'background',
      target: null,
      text: 'smuggled royal seals out of the citadel',
      hidden: true,
      cite: null,
      position: 0,
    });

    log.entries.push({
      sequence: log.nextSequence,
      kind: ScribeLogCore.Kind.Operator,
      origin: ScribeLogCore.Origin.Operator,
      messageIds: [],
      operations: [
        {
          type: ScribeAnswer.Type.ThreadOpen,
          thread: `T${log.nextThread}`,
          text: 'Who tipped off the harbor patrol?',
          cite: null,
          position: 0,
        },
      ],
      withdrawn: false,
    });
    log.nextThread += 1;
    log.nextSequence += 1;
    log.revision += 1;

    const emptyTurnsState = ScribeReplay.run(log, []);
    assert.equal(emptyTurnsState.subjects.length, 2);
    assert.deepEqual(emptyTurnsState.subjects[0].aka, ['Watchman Rowan']);
    assert.equal(emptyTurnsState.facts.length, 2);
    assert.equal(emptyTurnsState.facts[0].position, 0);
    assert.equal(emptyTurnsState.facts[0].origin, ScribeLogCore.Origin.Operator);
    assert.equal(emptyTurnsState.threads.length, 1);
    assert.equal(emptyTurnsState.threads[0].position, 0);
    assert.equal(emptyTurnsState.threads[0].cite, null);

    const publicFact = emptyTurnsState.facts[0];
    const hiddenFact = emptyTurnsState.facts[1];
    assert.equal(ScribeKnowledge.knows(emptyTurnsState, 'S1', publicFact), true);
    assert.equal(ScribeKnowledge.knows(emptyTurnsState, 'S2', publicFact), true);
    assert.equal(ScribeKnowledge.knows(emptyTurnsState, 'S1', hiddenFact), false);
    assert.equal(ScribeKnowledge.knows(emptyTurnsState, 'S2', hiddenFact), true);

    ScribeLogCore.syncCharacterSubject(log, emptyTurnsState, {
      subjectId: 'S1',
      name: 'Rowan Hale',
      aliases: ['Ser Rowan'],
      kind: ScribeCategory.SubjectKinds.Character,
    });
    const renamedState = ScribeReplay.run(log, []);
    const rowanAfterRename = renamedState.subjects.find((subject) => subject.id === 'S1');
    assert.equal(rowanAfterRename.label, 'Rowan Hale');
    assert.deepEqual(rowanAfterRename.aka, ['Ser Rowan']);

    const turnOneId = 'turn-1';
    const turnTwoId = 'turn-2';
    const intake = ScribeIntakeAdapter.fromTurns([
      {
        id: turnOneId,
        seq: 1,
        role: TurnRole.User,
        mode: TurnMode.Normal,
        rawText: 'Rowan checks the shutter.',
        sceneNumber: 1,
        witnessIds: ['char-1'],
        sceneStateAfter: null,
        beats: [
          {
            seq: 1,
            speakerType: SpeakerType.Player,
            characterId: 'char-1',
            speakerName: 'Rowan Hale',
            text: 'Rowan checks the shutter.',
            witnessIds: ['char-1'],
          },
        ],
      },
      {
        id: turnTwoId,
        seq: 2,
        role: TurnRole.Assistant,
        mode: TurnMode.Normal,
        rawText: 'Mara nods quietly.',
        sceneNumber: 1,
        witnessIds: ['char-1', 'char-2'],
        sceneStateAfter: null,
        beats: [
          {
            seq: 1,
            speakerType: SpeakerType.Character,
            characterId: 'char-2',
            speakerName: 'Mara',
            text: 'The lock holds.',
            witnessIds: ['char-1', 'char-2'],
          },
        ],
      },
    ]);

    ScribeLogCore.append(
      log,
      renamedState,
      [
        {
          type: ScribeAnswer.Type.Fact,
          label: 'Mara',
          category: 'trait',
          target: null,
          text: 'checks every door twice',
          position: 2,
          hidden: false,
        },
      ],
      { messages: intake.messages, origin: ScribeLogCore.Origin.Story },
    );

    const mixedState = ScribeReplay.run(log, [turnOneId, turnTwoId]);
    assert.equal(mixedState.facts.length, 3);
    assert.equal(mixedState.facts[0].position, 0);
    assert.equal(mixedState.facts[1].position, 0);
    assert.equal(mixedState.facts[2].position, 2);
    assert.equal(mixedState.threads[0].position, 0);
  });

  it('rejects unordered turns and normalizes text utilities strictly', () => {
    assert.equal(ScribeText.normaliseName('The "Rowan-san"'), 'rowan');
    assert.deepEqual(ScribeText.words('Grey armour colour'), ['gray', 'armor', 'color']);
    assert.equal(ScribeText.resembles('Mirella', 'Mirela'), true);
    assert.equal(ScribeText.bytes('hello'), 5);

    const parsedCategory = ScribeCategory.parse('relation to Mara');
    assert.equal(parsedCategory.category, 'relation');
    assert.equal(parsedCategory.target, 'Mara');

    assert.throws(() => {
      ScribeIntakeAdapter.fromTurns([
        { id: 't2', seq: 2, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Second', sceneNumber: 1, beats: [] },
        { id: 't1', seq: 1, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'First', sceneNumber: 1, beats: [] },
      ]);
    }, /oldest first/i);
  });
});

describe('ScribeService synthesis, knowledge packets, updates, tell preview/commit, and dirty repair', () => {
  it('propagates private-scene facts to present and remote characters while hiding them from absent characters, and filters threads/relationships', async () => {
    const { store, campaign, rowan, mara, vesper, corin } = createSeededCampaign();
    try {
      const log = ScribeLogCore.create();
      let state = ScribeReplay.run(log, []);
      for (const character of [rowan, mara, vesper, corin]) {
        ScribeLogCore.syncCharacterSubject(log, state, {
          subjectId: character.scribeSubjectId,
          name: character.name,
          aliases: character.aliases,
        });
        state = ScribeReplay.run(log, []);
      }
      ScribeLogCore.rule(log, state, {
        type: ScribeLogCore.Ruling.AddFact,
        subject: 'S1',
        category: 'role',
        target: null,
        text: 'harbor watchman',
        hidden: false,
        cite: null,
        position: 0,
      });
      log.entries.push({
        sequence: log.nextSequence,
        kind: ScribeLogCore.Kind.Operator,
        origin: ScribeLogCore.Origin.Operator,
        messageIds: [],
        operations: [
          {
            type: ScribeAnswer.Type.ThreadOpen,
            thread: `T${log.nextThread}`,
            text: 'Public harbor blockade order',
            cite: null,
            position: 0,
          },
        ],
        withdrawn: false,
      });
      log.nextThread += 1;
      log.nextSequence += 1;
      log.revision += 1;
      store.saveScribeBook(campaign.id, { bookJson: JSON.stringify(log), lastTurnSeq: 0, dirty: false });

      const pairOne = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: {
          mode: TurnMode.Normal,
          rawText: 'I pull the cedar box from beneath the floorboards.',
          sceneNumber: 1,
          witnessIds: [rowan.id, mara.id, vesper.id],
        },
        userBeat: {
          speakerType: SpeakerType.Player,
          characterId: rowan.id,
          speakerName: rowan.name,
          text: 'I pull the cedar box from beneath the floorboards.',
          witnessIds: [rowan.id, mara.id, vesper.id],
        },
        assistantTurn: {
          mode: TurnMode.Normal,
          rawText: 'Mara gasps as Vesper listens through the vent.',
          sceneNumber: 1,
          witnessIds: [rowan.id, mara.id, vesper.id],
        },
        assistantBeats: [
          {
            speakerType: SpeakerType.Character,
            characterId: mara.id,
            speakerName: mara.name,
            text: 'You kept the brass key under the floorboards all winter.',
            witnessIds: [rowan.id, mara.id, vesper.id],
          },
          {
            speakerType: SpeakerType.Character,
            characterId: vesper.id,
            speakerName: vesper.name,
            text: 'I can hear you both clearly through the grate.',
            witnessIds: [rowan.id, mara.id, vesper.id],
          },
        ],
        nextSceneState: campaign.sceneState,
      });

      const { client } = createFakeClient([
        [
          '=== SCENES',
          'Day 99 | #1-#2 | Hallucinated Tavern | public | present: Corin | Fake scene that must be ignored',
          '=== FACTS',
          'Rowan | belonging | hides a brass key under the bedroom floorboards | #2',
          'Mara | relation to Rowan | trusts him with the vault secret | #2',
          'Mara | relation to Corin | distrusts his patrols | #2',
          '=== THREADS',
          'OPEN | Move the cedar box before dawn | #2',
        ].join('\n'),
      ], { store });

      const scribeService = new ScribeService({ store, client });
      const updateResult = await scribeService.updateMemory({ campaignId: campaign.id });
      assert.equal(updateResult.updated, true);
      assert.equal(updateResult.scenesAdded, 1);

      const loaded = scribeService.loadState(campaign.id);
      assert.equal(loaded.state.scenes.length, 1);
      assert.equal(loaded.state.scenes[0].place, 'Lantern Bedroom');
      assert.equal(loaded.state.scenes[0].reach, ScribeAnswer.Reach.Private);
      assert.equal(loaded.state.scenes[0].present.some((entry) => entry.subject === vesper.scribeSubjectId), true);
      assert.equal(loaded.state.scenes[0].present.some((entry) => entry.subject === corin.scribeSubjectId), false);

      const brassKeyFact = loaded.state.facts.find((fact) => fact.text.includes('brass key'));
      assert.ok(brassKeyFact);
      assert.equal(brassKeyFact.hidden, false);
      assert.equal(ScribeKnowledge.knows(loaded.state, rowan.scribeSubjectId, brassKeyFact), true);
      assert.equal(ScribeKnowledge.knows(loaded.state, mara.scribeSubjectId, brassKeyFact), true);
      assert.equal(ScribeKnowledge.knows(loaded.state, vesper.scribeSubjectId, brassKeyFact), true);
      assert.equal(ScribeKnowledge.knows(loaded.state, corin.scribeSubjectId, brassKeyFact), false);

      const turnsById = new Map(loaded.turns.map((turn) => [turn.id, turn]));
      const maraPacket = scribeService.characterKnowledgePacket({
        state: loaded.state,
        character: mara,
        presentCharacters: [rowan, mara, vesper],
        turnsById,
      });
      assert.equal(maraPacket.knownFacts.some((fact) => fact.id === brassKeyFact.id), true);
      assert.equal(maraPacket.relationships.some((fact) => fact.target === rowan.scribeSubjectId), true);
      assert.equal(maraPacket.relationships.some((fact) => fact.target === corin.scribeSubjectId), false);
      assert.equal(maraPacket.visibleThreads.length, 2);
      assert.equal(maraPacket.rulings.some((fact) => fact.text === 'harbor watchman'), true);

      const corinPacket = scribeService.characterKnowledgePacket({
        state: loaded.state,
        character: corin,
        presentCharacters: [corin],
        turnsById,
      });
      assert.equal(corinPacket.knownFacts.some((fact) => fact.id === brassKeyFact.id), false);
      assert.equal(corinPacket.visibleThreads.length, 1);
      assert.equal(corinPacket.visibleThreads[0].position, 0);
      assert.equal(pairOne.assistantTurn.seq, 2);
    } finally {
      store.close();
    }
  });

  it('tracks mid-scene arrivals and departures with exact from/until bounds in synthesizeSceneOperations', () => {
    const { store, rowan, mara, vesper } = createSeededCampaign();
    try {
      const scribeService = new ScribeService({ store });
      const chars = new Map([
        [rowan.id, rowan],
        [mara.id, mara],
        [vesper.id, vesper],
      ]);

      const ops = scribeService.synthesizeSceneOperations([
        {
          id: 't1',
          seq: 1,
          role: TurnRole.User,
          sceneNumber: 1,
          witnessIds: [rowan.id, mara.id],
          sceneStateBefore: { presentIds: [rowan.id, mara.id], remoteIds: [] },
          sceneStateAfter: {
            sceneNumber: 1,
            day: 1,
            timeLabel: 'Morning',
            location: 'Courtyard',
            sceneType: SceneType.Public,
            presentIds: [rowan.id, mara.id, vesper.id],
            remoteIds: [],
          },
        },
        {
          id: 't2',
          seq: 2,
          role: TurnRole.Assistant,
          sceneNumber: 1,
          witnessIds: [rowan.id, mara.id, vesper.id],
          sceneStateBefore: { presentIds: [rowan.id, mara.id], remoteIds: [] },
          sceneStateAfter: {
            sceneNumber: 1,
            day: 1,
            timeLabel: 'Morning',
            location: 'Courtyard',
            sceneType: SceneType.Public,
            presentIds: [rowan.id, mara.id, vesper.id],
            remoteIds: [],
          },
        },
        {
          id: 't3',
          seq: 3,
          role: TurnRole.Assistant,
          sceneNumber: 1,
          witnessIds: [rowan.id, vesper.id],
          sceneStateBefore: { presentIds: [rowan.id, mara.id, vesper.id], remoteIds: [] },
          sceneStateAfter: {
            sceneNumber: 1,
            day: 1,
            timeLabel: 'Morning',
            location: 'Courtyard',
            sceneType: SceneType.Public,
            presentIds: [rowan.id],
            remoteIds: [vesper.id],
          },
        },
      ], chars);

      assert.equal(ops.length, 1);
      const scene = ops[0];
      assert.equal(scene.first, 1);
      assert.equal(scene.last, 3);
      assert.equal(scene.reach, ScribeAnswer.Reach.Public);

      const rowanEntry = scene.present.find((entry) => entry.subject === rowan.scribeSubjectId);
      const maraEntry = scene.present.find((entry) => entry.subject === mara.scribeSubjectId);
      const vesperEntry = scene.present.find((entry) => entry.subject === vesper.scribeSubjectId);

      assert.deepEqual({ from: rowanEntry.from, until: rowanEntry.until }, { from: null, until: null });
      assert.deepEqual({ from: maraEntry.from, until: maraEntry.until }, { from: null, until: 2 });
      assert.deepEqual({ from: vesperEntry.from, until: vesperEntry.until }, { from: 2, until: null });
    } finally {
      store.close();
    }
  });

  it('performs one repair retry on unparseable updateMemory output and throws if still unparseable', async () => {
    const { store, campaign, rowan, mara } = createSeededCampaign();
    try {
      store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Hello Mara.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Hello Mara.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Mara waves.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'Good evening.' }],
        nextSceneState: campaign.sceneState,
      });

      const { client: repairSuccessClient, calls: successCalls } = createFakeClient([
        'I cannot process this without more context.',
        '=== FACTS\nMara | trait | speaks softly at night | #2',
      ], { store });
      const scribeService = new ScribeService({ store, client: repairSuccessClient });
      const result = await scribeService.updateMemory({ campaignId: campaign.id });
      assert.equal(result.updated, true);
      assert.equal(successCalls.length, 2);

      store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'What now?', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'What now?' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Silence.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'Wait.' }],
        nextSceneState: campaign.sceneState,
      });

      const { client: brokenClient, calls: failCalls } = createFakeClient([
        'Bad output one.',
        'Still bad output two.',
      ], { store });
      const failingService = new ScribeService({ store, client: brokenClient });
      await assert.rejects(() => failingService.updateMemory({ campaignId: campaign.id }), /repair retry/i);
      assert.equal(failCalls.length, 2);
    } finally {
      store.close();
    }
  });

  it('previews tell instructions without mutating SQLite and commits Notes + Rulings cleanly', async () => {
    const { store, campaign } = createSeededCampaign();
    try {
      const { client } = createFakeClient([
        '=== SUBJECTS\nRowan | character\n=== FACTS\nRowan | hair | copper-red | #1',
      ], { store });
      const scribeService = new ScribeService({ store, client });

      const preview = await scribeService.tellPreview({
        campaignId: campaign.id,
        instruction: 'Rowan has copper-red hair.',
      });
      assert.equal(preview.operations.length, 2);
      assert.equal(preview.refused.length, 0);
      assert.ok(preview.changes.some((line) => line.includes('copper-red')));
      assert.equal(store.getScribeBook(campaign.id), null);

      const committed = scribeService.tellCommit({
        campaignId: campaign.id,
        operations: [
          ...preview.operations,
          {
            type: ScribeLogCore.Ruling.Pin,
            subject: 'S1',
            category: 'hair',
            target: null,
            text: 'copper-red',
            hidden: false,
          },
        ],
      });
      assert.equal(committed.state.facts.some((fact) => fact.text === 'copper-red' && fact.pinned), true);
      assert.notEqual(store.getScribeBook(campaign.id), null);

      const reloaded = scribeService.loadState(campaign.id);
      assert.equal(reloaded.state.facts.some((fact) => fact.text === 'copper-red' && fact.pinned), true);
    } finally {
      store.close();
    }
  });

  it('cleanly withdraws rolled-back turns and repairs edited dirty turns without corrupting earlier turns', async () => {
    const { store, campaign, rowan, mara } = createSeededCampaign();
    try {
      const pairOne = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Turn one user.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Turn one user.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Mara wears a green scarf.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'My green scarf is warm.' }],
        nextSceneState: campaign.sceneState,
      });

      const pairTwo = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Turn two user.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Turn two user.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Mara drops an iron locket.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'Oh, my iron locket!' }],
        nextSceneState: campaign.sceneState,
      });

      const { client } = createFakeClient([
        '=== FACTS\nMara | appearance | always wears a green scarf | #2\nMara | belonging | carries an iron locket | #4\n=== THREADS\nOPEN | Why is the locket engraved? | #4',
        '=== FACTS\nMara | belonging | carries a silver compass | #4',
      ], { store });

      const scribeService = new ScribeService({ store, client });
      await scribeService.updateMemory({ campaignId: campaign.id });

      let loaded = scribeService.loadState(campaign.id);
      assert.equal(loaded.state.facts.length, 2);
      assert.equal(loaded.state.threads.length, 1);

      store.updateBeatText(campaign.id, pairTwo.assistantTurn.beats[0].id, 'Oh, my silver compass!');
      ScribeLogCore.withdrawSources(loaded.log, new Set([pairTwo.assistantTurn.id]));
      store.saveScribeBook(campaign.id, {
        bookJson: JSON.stringify(loaded.log),
        lastTurnSeq: loaded.lastTurnSeq,
        dirty: true,
      });

      loaded = scribeService.loadState(campaign.id);
      assert.equal(loaded.dirty, true);
      assert.equal(loaded.state.facts.some((fact) => fact.text.includes('green scarf')), true);
      assert.equal(loaded.state.facts.some((fact) => fact.text.includes('iron locket')), false);
      assert.equal(loaded.state.threads.length, 0);

      const repaired = await scribeService.updateMemory({ campaignId: campaign.id });
      assert.equal(repaired.updated, true);
      assert.equal(repaired.state.facts.some((fact) => fact.text.includes('green scarf')), true);
      assert.equal(repaired.state.facts.some((fact) => fact.text.includes('silver compass')), true);
      assert.equal(store.getScribeBook(campaign.id).dirty, false);
      assert.equal(pairOne.assistantTurn.seq, 2);
    } finally {
      store.close();
    }
  });
});

describe('PedantService leak detection (non-hidden private scenes & >60k chars) and finding resolution', () => {
  it('flags a non-hidden private-scene fact leaked by an absent speaker even with >60k chars unread, and skips false leaks for knowers', async () => {
    const { store, campaign, rowan, mara, corin } = createSeededCampaign();
    try {
      const log = ScribeLogCore.create();
      let state = ScribeReplay.run(log, []);
      for (const character of [rowan, mara, corin]) {
        ScribeLogCore.syncCharacterSubject(log, state, {
          subjectId: character.scribeSubjectId,
          name: character.name,
          aliases: character.aliases,
        });
        state = ScribeReplay.run(log, []);
      }
      store.saveScribeBook(campaign.id, { bookJson: JSON.stringify(log), lastTurnSeq: 0, dirty: false });

      const privatePair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Close the bedroom door.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Close the bedroom door.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Mara whispers her vault code.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'The vault code is seven-four-nine.' }],
        nextSceneState: {
          ...campaign.sceneState,
          presentIds: [rowan.id, mara.id],
          remoteIds: [],
        },
      });

      const scribeService = new ScribeService({ store });
      const loadedForAppend = scribeService.loadState(campaign.id);
      const sceneOps = scribeService.synthesizeSceneOperations(
        loadedForAppend.turns,
        new Map([[rowan.id, rowan], [mara.id, mara], [corin.id, corin]]),
      );
      ScribeLogCore.append(
        loadedForAppend.log,
        loadedForAppend.state,
        [
          ...sceneOps,
          {
            type: ScribeAnswer.Type.Fact,
            label: 'Mara',
            category: 'trait',
            target: null,
            text: 'uses vault code seven-four-nine',
            position: 2,
            hidden: false,
          },
        ],
        { messages: loadedForAppend.messages, origin: ScribeLogCore.Origin.Story },
      );
      store.saveScribeBook(campaign.id, {
        bookJson: JSON.stringify(loadedForAppend.log),
        lastTurnSeq: privatePair.assistantTurn.seq,
        dirty: false,
      });

      const longFiller = 'The rain drums steadily against the harbor stones. '.repeat(1400);
      assert.ok(longFiller.length > 65000);
      store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: longFiller, sceneNumber: 2, witnessIds: [rowan.id, corin.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: longFiller },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Corin glances around.', sceneNumber: 2, witnessIds: [rowan.id, corin.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: corin.id, speakerName: corin.name, text: 'Still quiet.' }],
        nextSceneState: {
          sceneNumber: 2,
          day: 1,
          timeLabel: 'Midnight',
          location: 'Barracks',
          sceneType: SceneType.Public,
          presentIds: [rowan.id, corin.id],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        },
      });

      const leakPair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Any news Corin?', sceneNumber: 2, witnessIds: [rowan.id, mara.id, corin.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Any news Corin?' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Corin speaks up.', sceneNumber: 2, witnessIds: [rowan.id, mara.id, corin.id] },
        assistantBeats: [
          { speakerType: SpeakerType.Character, characterId: corin.id, speakerName: corin.name, text: 'I know Mara uses seven-four-nine on the vault.' },
          { speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'That code is seven-four-nine.' },
        ],
        nextSceneState: {
          sceneNumber: 2,
          day: 1,
          timeLabel: 'Midnight',
          location: 'Barracks',
          sceneType: SceneType.Public,
          presentIds: [rowan.id, mara.id, corin.id],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        },
      });

      let capturedPedantUserPrompt = '';
      const { client } = createFakeClient([
        (payload) => {
          capturedPedantUserPrompt = payload.messages[1].content;
          return [
            '=== LEAKS',
            'F1 | Corin | I know Mara uses seven-four-nine on the vault.',
            'F1 | Mara | That code is seven-four-nine.',
          ].join('\n');
        },
      ], { store });

      const pedantService = new PedantService({ store, client, scribeService });
      const refreshedState = scribeService.loadState(campaign.id).state;
      assert.equal(pedantService.isRestricted(refreshedState, refreshedState.facts[0]), true);

      const savedFindings = await pedantService.checkTurn({
        campaignId: campaign.id,
        turn: leakPair.assistantTurn,
      });

      assert.match(capturedPedantUserPrompt, /Corin does not know F1/);
      assert.doesNotMatch(capturedPedantUserPrompt, /\(too long to show\)/);
      assert.equal(savedFindings.length, 1);
      assert.equal(savedFindings[0].kind, FindingKind.SecretLeak);
      assert.equal(savedFindings[0].speakerCharacterId, corin.id);
      assert.equal(savedFindings[0].factId, 'F1');

      const spendCheck = store.getDailySpend(new Date().toISOString().slice(0, 10));
      assert.equal(spendCheck.callCount, 1);
    } finally {
      store.close();
    }
  });

  it('resolves findings via ruled (overriding conflicting story facts), told (only to speaker), and dismissed', async () => {
    const { store, campaign, rowan, mara, vesper, corin } = createSeededCampaign();
    try {
      const log = ScribeLogCore.create();
      let state = ScribeReplay.run(log, []);
      for (const character of [rowan, mara, vesper, corin]) {
        ScribeLogCore.syncCharacterSubject(log, state, {
          subjectId: character.scribeSubjectId,
          name: character.name,
          aliases: character.aliases,
        });
        state = ScribeReplay.run(log, []);
      }
      store.saveScribeBook(campaign.id, { bookJson: JSON.stringify(log), lastTurnSeq: 0, dirty: false });

      const firstPair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Inspecting Mara.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Inspecting Mara.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Mara has raven hair and hides a ledger.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'I keep a second ledger.' }],
        nextSceneState: {
          ...campaign.sceneState,
          sceneType: SceneType.Public,
          presentIds: [rowan.id, mara.id],
          remoteIds: [],
        },
      });

      const scribeService = new ScribeService({ store });
      let loaded = scribeService.loadState(campaign.id);
      const sceneOps = scribeService.synthesizeSceneOperations(
        loaded.turns,
        new Map([[rowan.id, rowan], [mara.id, mara], [vesper.id, vesper], [corin.id, corin]]),
      );
      ScribeLogCore.append(
        loaded.log,
        loaded.state,
        [
          ...sceneOps,
          {
            type: ScribeAnswer.Type.Fact,
            label: 'Mara',
            category: 'hair',
            target: null,
            text: 'raven',
            position: 2,
            hidden: false,
          },
          {
            type: ScribeAnswer.Type.Fact,
            label: 'Mara',
            category: 'belonging',
            target: null,
            text: 'keeps a second ledger',
            position: 2,
            hidden: true,
          },
          {
            type: ScribeAnswer.Type.Fact,
            label: 'Mara',
            category: 'trait',
            target: null,
            text: 'never drinks tea',
            position: 2,
            hidden: false,
          },
        ],
        { messages: loaded.messages, origin: ScribeLogCore.Origin.Story },
      );
      store.saveScribeBook(campaign.id, {
        bookJson: JSON.stringify(loaded.log),
        lastTurnSeq: firstPair.assistantTurn.seq,
        dirty: false,
      });

      const secondPair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Corin speaks.', sceneNumber: 2, witnessIds: [rowan.id, mara.id, corin.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Corin speaks.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Corin mentions chestnut hair and second ledger.', sceneNumber: 2, witnessIds: [rowan.id, mara.id, corin.id] },
        assistantBeats: [
          {
            speakerType: SpeakerType.Character,
            characterId: corin.id,
            speakerName: corin.name,
            text: 'With her chestnut hair, Mara keeps a second ledger and loves tea.',
          },
        ],
        nextSceneState: {
          sceneNumber: 2,
          day: 1,
          timeLabel: 'Dawn',
          location: 'Pier',
          sceneType: SceneType.Public,
          presentIds: [rowan.id, mara.id, corin.id],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        },
      });

      const { client } = createFakeClient([
        [
          '=== CONTRADICTIONS',
          'F1 | Mara | hair | chestnut hair',
          'F3 | Mara | trait | loves tea',
          '=== LEAKS',
          'F2 | Corin | Mara keeps a second ledger',
        ].join('\n'),
      ], { store });

      const pedantService = new PedantService({ store, client, scribeService });
      const findings = await pedantService.checkTurn({
        campaignId: campaign.id,
        turn: secondPair.assistantTurn,
      });
      assert.equal(findings.length, 3);

      const hairFinding = findings.find((item) => item.factId === 'F1');
      const leakFinding = findings.find((item) => item.factId === 'F2');
      const teaFinding = findings.find((item) => item.factId === 'F3');

      const ruledHair = pedantService.resolveFinding({
        campaignId: campaign.id,
        findingId: hairFinding.id,
        action: FindingStatus.Ruled,
        replacementText: 'chestnut',
      });
      assert.equal(ruledHair.status, FindingStatus.Ruled);

      loaded = scribeService.loadState(campaign.id);
      const laterPair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Still raven?', sceneNumber: 2, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Still raven?' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Story claims raven again.', sceneNumber: 2, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'My raven hair.' }],
        nextSceneState: {
          sceneNumber: 2,
          day: 1,
          timeLabel: 'Dawn',
          location: 'Pier',
          sceneType: SceneType.Public,
          presentIds: [rowan.id, mara.id],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        },
      });
      loaded = scribeService.loadState(campaign.id);
      const unreadAfterConflict = loaded.messages.filter((message) => !Object.hasOwn(loaded.log.read, message.id));
      ScribeLogCore.append(
        loaded.log,
        loaded.state,
        [
          {
            type: ScribeAnswer.Type.Fact,
            label: 'Mara',
            category: 'hair',
            target: null,
            text: 'raven',
            position: laterPair.assistantTurn.seq,
            hidden: false,
          },
        ],
        { messages: unreadAfterConflict, origin: ScribeLogCore.Origin.Story },
      );
      store.saveScribeBook(campaign.id, {
        bookJson: JSON.stringify(loaded.log),
        lastTurnSeq: laterPair.assistantTurn.seq,
        dirty: false,
      });

      const replayedAfterConflict = scribeService.loadState(campaign.id).state;
      const inForceHair = replayedAfterConflict.facts.filter(
        (fact) => fact.subject === mara.scribeSubjectId && fact.category === 'hair' && fact.status === ScribeReplay.Status.InForce,
      );
      assert.equal(inForceHair.length, 1);
      assert.equal(inForceHair[0].text, 'chestnut');
      assert.equal(inForceHair[0].pinned, true);

      const toldResolved = pedantService.resolveFinding({
        campaignId: campaign.id,
        findingId: leakFinding.id,
        action: FindingStatus.Told,
      });
      assert.equal(toldResolved.status, FindingStatus.Told);

      const stateAfterTell = scribeService.loadState(campaign.id).state;
      const ledgerFact = stateAfterTell.facts.find((fact) => fact.id === 'F2');
      assert.equal(ScribeKnowledge.knows(stateAfterTell, corin.scribeSubjectId, ledgerFact), true);
      assert.equal(ScribeKnowledge.knows(stateAfterTell, vesper.scribeSubjectId, ledgerFact), false);

      const dismissedResolved = pedantService.resolveFinding({
        campaignId: campaign.id,
        findingId: teaFinding.id,
        action: FindingStatus.Dismissed,
      });
      assert.equal(dismissedResolved.status, FindingStatus.Dismissed);

      const stateBeforeTeaRule = JSON.stringify(scribeService.loadState(campaign.id).log);
      assert.equal(
        scribeService.loadState(campaign.id).state.facts.find((fact) => fact.id === 'F3').status,
        ScribeReplay.Status.InForce,
      );

      const removedFindings = store.insertFindings(campaign.id, secondPair.assistantTurn.id, [
        {
          kind: FindingKind.Contradiction,
          subjectId: mara.scribeSubjectId,
          subjectName: mara.name,
          speakerCharacterId: corin.id,
          factId: 'F3',
          category: 'trait',
          bookText: 'never drinks tea',
          summary: 'Remove wrong tea fact',
          quote: 'loves tea',
        },
      ]);
      const ruledRemove = pedantService.resolveFinding({
        campaignId: campaign.id,
        findingId: removedFindings[0].id,
        action: FindingStatus.Ruled,
      });
      assert.equal(ruledRemove.status, FindingStatus.Ruled);
      const stateAfterRemove = scribeService.loadState(campaign.id).state;
      assert.equal(stateAfterRemove.facts.find((fact) => fact.id === 'F3').status, ScribeReplay.Status.Removed);
      assert.ok(stateBeforeTeaRule.length > 0);
    } finally {
      store.close();
    }
  });

  it('catches leaks by a newly added cast character not yet in scribe_books and resolves NameMismatch findings', async () => {
    const { store, campaign, rowan, mara } = createSeededCampaign();
    try {
      const firstPair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Only us in the cellar.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Only us in the cellar.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Mara hides a sapphire.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'My sapphire is under the cask.' }],
        nextSceneState: {
          ...campaign.sceneState,
          presentIds: [rowan.id, mara.id],
          remoteIds: [],
        },
      });

      const { client: scribeClient } = createFakeClient([
        '=== FACTS\nMara | belonging | hides a sapphire under the cellar cask | #2',
      ], { store });
      const scribeService = new ScribeService({ store, client: scribeClient });
      await scribeService.updateMemory({ campaignId: campaign.id });
      assert.equal(firstPair.assistantTurn.seq, 2);

      const brenna = store.createCharacter(campaign.id, {
        slug: 'brenna',
        scribeSubjectId: null,
        name: 'Brenna',
        aliases: [],
        isPlayer: false,
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Plum,
      });

      const secondPair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Brenna arrives.', sceneNumber: 2, witnessIds: [rowan.id, brenna.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Brenna arrives.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Brenna mentions Mra and the sapphire.', sceneNumber: 2, witnessIds: [rowan.id, brenna.id] },
        assistantBeats: [
          { speakerType: SpeakerType.Character, characterId: brenna.id, speakerName: brenna.name, text: 'I told Mra about the sapphire under the cask.' },
        ],
        nextSceneState: {
          sceneNumber: 2,
          day: 1,
          timeLabel: 'Morning',
          location: 'Dock',
          sceneType: SceneType.Public,
          presentIds: [rowan.id, brenna.id],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        },
      });

      let pedantPrompt = '';
      const { client: pedantClient } = createFakeClient([
        (payload) => {
          pedantPrompt = payload.messages[1].content;
          return [
            '=== LEAKS',
            'F1 | Brenna | the sapphire under the cask',
            '=== MISSPELLINGS',
            'Mra | S2',
          ].join('\n');
        },
      ], { store });

      const pedantService = new PedantService({ store, client: pedantClient, scribeService });
      const findings = await pedantService.checkTurn({
        campaignId: campaign.id,
        turn: secondPair.assistantTurn,
      });

      assert.match(pedantPrompt, /Brenna does not know F1/);
      assert.equal(findings.length, 2);
      const leak = findings.find((item) => item.kind === FindingKind.SecretLeak);
      const mismatch = findings.find((item) => item.kind === FindingKind.NameMismatch);
      assert.equal(leak.speakerCharacterId, brenna.id);
      assert.equal(mismatch.subjectId, 'S2');
      assert.equal(mismatch.quote, 'Mra');

      const ruledMismatch = pedantService.resolveFinding({
        campaignId: campaign.id,
        findingId: mismatch.id,
        action: FindingStatus.Ruled,
      });
      assert.equal(ruledMismatch.status, FindingStatus.Ruled);
      const reloaded = scribeService.loadState(campaign.id).state;
      assert.equal(reloaded.subjects.find((subject) => subject.id === 'S2').aka.includes('Mra'), true);
    } finally {
      store.close();
    }
  });
});

describe('MuseService thread revival and static codebase invariants', () => {
  it('picks a matching open thread, returns a Narrator-prefixed suggestion without mutating DB, and returns null when none remain', async () => {
    const { store, campaign, rowan, mara } = createSeededCampaign();
    try {
      const log = ScribeLogCore.create();
      let state = ScribeReplay.run(log, []);
      ScribeLogCore.syncCharacterSubject(log, state, { subjectId: rowan.scribeSubjectId, name: rowan.name, aliases: rowan.aliases });
      state = ScribeReplay.run(log, []);
      ScribeLogCore.syncCharacterSubject(log, state, { subjectId: mara.scribeSubjectId, name: mara.name, aliases: mara.aliases });
      log.entries.push({
        sequence: log.nextSequence,
        kind: ScribeLogCore.Kind.Operator,
        origin: ScribeLogCore.Origin.Operator,
        messageIds: [],
        operations: [
          { type: ScribeAnswer.Type.ThreadOpen, thread: 'T1', text: 'Distant harbor storm warning', cite: null, position: 0 },
          { type: ScribeAnswer.Type.ThreadOpen, thread: 'T2', text: 'Mara promised to return the silver seal', cite: null, position: 0 },
        ],
        withdrawn: false,
      });
      log.nextThread = 3;
      log.nextSequence += 1;
      log.revision += 1;
      store.saveScribeBook(campaign.id, { bookJson: JSON.stringify(log), lastTurnSeq: 0, dirty: false });

      const { client } = createFakeClient([
        'LINE: Narrator: A courier slips a sealed envelope beneath the bedroom door.',
      ], { store });
      const scribeService = new ScribeService({ store, client });
      const museService = new MuseService({ store, client, scribeService });

      const suggestion = await museService.suggestDevelopment({ campaignId: campaign.id });
      assert.equal(suggestion.threadId, 'T2');
      assert.equal(suggestion.threadTitle, 'Mara promised to return the silver seal');
      assert.equal(suggestion.text, 'Narrator: A courier slips a sealed envelope beneath the bedroom door.');
      assert.equal(store.listTurns(campaign.id).total, 0);

      const emptySuggestion = await museService.suggestDevelopment({
        campaignId: campaign.id,
        excludeThreadIds: ['T1', 'T2'],
      });
      assert.equal(emptySuggestion, null);
    } finally {
      store.close();
    }
  });

  it('contains zero background timers (setInterval/setTimeout) across src/scribe/', () => {
    const scribeDir = path.resolve('/var/www/demo_stuff/universe/worlds/src/scribe');
    const files = fs.readdirSync(scribeDir).filter((fileName) => fileName.endsWith('.mjs'));
    assert.equal(files.length, 12);
    for (const fileName of files) {
      const content = fs.readFileSync(path.join(scribeDir, fileName), 'utf8');
      assert.equal(/\bset(?:Interval|Timeout)\b/.test(content), false, `Timer found in ${fileName}`);
    }
  });

  it('uses SpendStage.Scribe, SpendStage.Pedant, and SpendStage.Muse cleanly', () => {
    assert.equal(SpendStage.Scribe, 'scribe');
    assert.equal(SpendStage.Pedant, 'pedant');
    assert.equal(SpendStage.Muse, 'muse');
  });
});

describe('Task 3 adversarial review regressions', () => {
  it('recovers Scene 1 after boundary turn deletion across Scene 2 and with empty unreadTurns or empty-text turns (Findings 1 & 5)', async () => {
    const { store, campaign, rowan, mara } = createSeededCampaign();
    try {
      const pairOne = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Entering the bedroom.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Entering the bedroom.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Mara locks the door.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'We are alone now.' }],
        nextSceneState: {
          ...campaign.sceneState,
          presentIds: [rowan.id, mara.id],
          remoteIds: [],
        },
      });
      const pairTwo = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Check the desk.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Check the desk.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Nothing inside.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'Empty.' }],
        nextSceneState: {
          ...campaign.sceneState,
          presentIds: [rowan.id, mara.id],
          remoteIds: [],
        },
      });

      const { client: initialClient } = createFakeClient(['=== FACTS\nMara | trait | locks doors carefully | #2'], { store });
      const initialService = new ScribeService({ store, client: initialClient });
      await initialService.updateMemory({ campaignId: campaign.id });
      assert.equal(initialService.loadState(campaign.id).state.scenes.length, 1);

      const deleted = store.deleteLastTurnPair(campaign.id);
      assert.equal(deleted.deletedUserTurnId, pairTwo.userTurn.id);
      const afterDeleteLoaded = initialService.loadState(campaign.id);
      ScribeLogCore.withdrawSources(
        afterDeleteLoaded.log,
        new Set([pairTwo.userTurn.id, pairTwo.assistantTurn.id]),
      );
      store.saveScribeBook(campaign.id, {
        bookJson: JSON.stringify(afterDeleteLoaded.log),
        lastTurnSeq: pairOne.assistantTurn.seq,
        dirty: true,
      });

      const { client: zeroLlmClient, calls: zeroLlmCalls } = createFakeClient([], { store });
      const recoveryOnlyService = new ScribeService({ store, client: zeroLlmClient });
      const zeroUnreadRecovery = await recoveryOnlyService.updateMemory({ campaignId: campaign.id });
      assert.equal(zeroUnreadRecovery.updated, true);
      assert.equal(zeroUnreadRecovery.scenesAdded, 1);
      assert.equal(zeroLlmCalls.length, 0);
      assert.equal(zeroUnreadRecovery.state.scenes.length, 1);
      assert.equal(zeroUnreadRecovery.state.scenes[0].firstPosition, 1);
      assert.equal(zeroUnreadRecovery.state.scenes[0].lastPosition, 2);

      const stateBeforeSecondDrop = recoveryOnlyService.loadState(campaign.id);
      ScribeLogCore.withdrawSources(stateBeforeSecondDrop.log, new Set([pairOne.assistantTurn.id]));
      store.saveScribeBook(campaign.id, {
        bookJson: JSON.stringify(stateBeforeSecondDrop.log),
        lastTurnSeq: pairOne.userTurn.seq,
        dirty: true,
      });
      store.deleteLastTurnPair(campaign.id);

      store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: '', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: '' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Quiet breathing.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'Quiet.' }],
        nextSceneState: {
          ...campaign.sceneState,
          presentIds: [rowan.id, mara.id],
          remoteIds: [],
        },
      });
      store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Out to the pier.', sceneNumber: 2, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Out to the pier.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Wind blows off the bay.', sceneNumber: 2, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Narrator, characterId: null, speakerName: 'Narrator', text: 'Gulls circle above.' }],
        nextSceneState: {
          sceneNumber: 2,
          day: 1,
          timeLabel: 'Dawn',
          location: 'Harbor Pier',
          sceneType: SceneType.Public,
          presentIds: [rowan.id, mara.id],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        },
      });

      const { client: sceneTwoClient } = createFakeClient(['=== FACTS\n(none)'], { store });
      const fullService = new ScribeService({ store, client: sceneTwoClient });
      const res = await fullService.updateMemory({ campaignId: campaign.id });
      assert.equal(res.scenesAdded, 2);
      assert.equal(res.state.scenes.length, 2);
      assert.equal(res.state.scenes[0].firstPosition, 1);
      assert.equal(res.state.scenes[0].lastPosition, 2);
      assert.equal(res.state.scenes[0].reach, ScribeAnswer.Reach.Private);
      assert.equal(res.state.scenes[1].firstPosition, 3);
      assert.equal(res.state.scenes[1].lastPosition, 4);
      assert.equal(res.state.scenes[1].place, 'Harbor Pier');
    } finally {
      store.close();
    }
  });

  it('includes departing assistant-turn beat witnesses in scene spans (Finding 2)', async () => {
    const { store, campaign, rowan, mara } = createSeededCampaign();
    try {
      store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Speak before you go.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Speak before you go.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Mara answers and departs.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [
          {
            speakerType: SpeakerType.Character,
            characterId: mara.id,
            speakerName: mara.name,
            text: 'The ledger key is hidden behind the loose brick.',
            witnessIds: [rowan.id, mara.id],
          },
          {
            speakerType: SpeakerType.Narrator,
            characterId: null,
            speakerName: 'Narrator',
            text: 'Mara slips out into the hallway, leaving Rowan alone.',
            witnessIds: [rowan.id],
          },
        ],
        nextSceneState: {
          ...campaign.sceneState,
          presentIds: [rowan.id],
          remoteIds: [],
        },
      });

      const { client } = createFakeClient([
        '=== FACTS\nRowan | belonging | holds the loose-brick ledger key | #2',
      ], { store });
      const scribeService = new ScribeService({ store, client });
      const updated = await scribeService.updateMemory({ campaignId: campaign.id });
      const keyFact = updated.state.facts.find((fact) => fact.text.includes('loose-brick'));
      assert.ok(keyFact);
      assert.equal(ScribeKnowledge.knows(updated.state, mara.scribeSubjectId, keyFact), true);
    } finally {
      store.close();
    }
  });

  it('links Tell Scribe subjects without duplicates and syncs character name and alias edits in updateMemory (Findings 3 & 10.2)', async () => {
    const store = new SqliteStore(':memory:');
    try {
      store.updateSettings({
        models: {
          director: 'openai/gpt-4.1-mini',
          composer: 'openai/gpt-4.1',
          main: 'openai/gpt-4.1',
          recurring: 'openai/gpt-4.1-mini',
          scribe: 'openai/gpt-4.1-mini',
        },
      });
      const campaign = store.createCampaign({
        title: 'Subject Link Test',
        premise: 'Port watch',
      });
      const rowan = store.createCharacter(campaign.id, {
        slug: 'rowan',
        scribeSubjectId: null,
        name: 'Rowan',
        aliases: ['Watchman Rowan'],
        isPlayer: true,
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Slate,
      });
      store.updateCampaign(campaign.id, {
        playerCharacterId: rowan.id,
        sceneState: {
          sceneNumber: 1,
          day: 1,
          timeLabel: 'Morning',
          location: 'Gate',
          sceneType: SceneType.Public,
          presentIds: [rowan.id],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        },
      });

      const { client } = createFakeClient([
        '=== SUBJECTS\nRowan | character\n=== FACTS\nRowan | eyes | slate-grey | #1',
      ], { store });
      const scribeService = new ScribeService({ store, client });

      const preview = await scribeService.tellPreview({
        campaignId: campaign.id,
        instruction: 'Rowan has slate-grey eyes.',
      });
      scribeService.tellCommit({ campaignId: campaign.id, operations: preview.operations });

      await scribeService.updateMemory({ campaignId: campaign.id });
      const refreshedChar = store.getCharacter(campaign.id, rowan.id);
      assert.equal(refreshedChar.scribeSubjectId, 'S1');

      let loaded = scribeService.loadState(campaign.id);
      assert.equal(loaded.state.subjects.filter((subject) => subject.mergedInto === null).length, 1);
      assert.equal(loaded.state.subjects[0].aka.includes('Watchman Rowan'), true);

      store.updateCharacter(campaign.id, rowan.id, {
        name: 'Rowan Vance',
        aliases: ['Watchman Rowan', 'Captain Vance'],
      });
      await scribeService.updateMemory({ campaignId: campaign.id });
      loaded = scribeService.loadState(campaign.id);
      assert.equal(loaded.state.subjects[0].label, 'Rowan Vance');
      assert.equal(loaded.state.subjects[0].aka.includes('Captain Vance'), true);
    } finally {
      store.close();
    }
  });

  it('handles PedantService told resolution for scribeSubjectId null characters, enforces finding guardrails, and blocks double resolution (Findings 4, 6, 7, 10.4, 10.5)', async () => {
    const { store, campaign, rowan, mara, corin } = createSeededCampaign();
    try {
      const log = ScribeLogCore.create();
      let state = ScribeReplay.run(log, []);
      for (const character of [rowan, mara]) {
        ScribeLogCore.syncCharacterSubject(log, state, {
          subjectId: character.scribeSubjectId,
          name: character.name,
          aliases: character.aliases,
        });
        state = ScribeReplay.run(log, []);
      }
      store.saveScribeBook(campaign.id, { bookJson: JSON.stringify(log), lastTurnSeq: 0, dirty: false });

      const firstPair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Secret room.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Secret room.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Mara reveals her cipher.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'The cipher is amber-four.' }],
        nextSceneState: {
          ...campaign.sceneState,
          presentIds: [rowan.id, mara.id],
          remoteIds: [],
        },
      });

      const scribeService = new ScribeService({ store });
      let loaded = scribeService.loadState(campaign.id);
      const sceneOps = scribeService.synthesizeSceneOperations(
        loaded.turns,
        new Map([[rowan.id, rowan], [mara.id, mara]]),
      );
      ScribeLogCore.append(
        loaded.log,
        loaded.state,
        [
          ...sceneOps,
          {
            type: ScribeAnswer.Type.Fact,
            label: 'Mara',
            category: 'trait',
            target: null,
            text: 'uses cipher amber-four',
            position: 2,
            hidden: false,
          },
          {
            type: ScribeAnswer.Type.Fact,
            label: 'Mara',
            category: 'appearance',
            target: null,
            text: 'wears a red cloak',
            position: 2,
            hidden: true,
          },
        ],
        { messages: loaded.messages, origin: ScribeLogCore.Origin.Story },
      );
      store.saveScribeBook(campaign.id, {
        bookJson: JSON.stringify(loaded.log),
        lastTurnSeq: firstPair.assistantTurn.seq,
        dirty: false,
      });

      const unlinkedSpeaker = store.createCharacter(campaign.id, {
        slug: 'lyra',
        scribeSubjectId: null,
        name: 'Lyra',
        aliases: [],
        isPlayer: false,
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Indigo,
      });

      const secondPair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'On the pier.', sceneNumber: 2, witnessIds: [rowan.id, mara.id, unlinkedSpeaker.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'On the pier.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Multiple speakers.', sceneNumber: 2, witnessIds: [rowan.id, mara.id, unlinkedSpeaker.id] },
        assistantBeats: [
          { speakerType: SpeakerType.Narrator, characterId: null, speakerName: 'Narrator', text: 'Somewhere an absent guard murmurs amber-four.' },
          { speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'My cloak is blue today.' },
          { speakerType: SpeakerType.Character, characterId: unlinkedSpeaker.id, speakerName: unlinkedSpeaker.name, text: 'I heard amber-four earlier.' },
        ],
        nextSceneState: {
          sceneNumber: 2,
          day: 1,
          timeLabel: 'Dawn',
          location: 'Pier',
          sceneType: SceneType.Public,
          presentIds: [rowan.id, mara.id, unlinkedSpeaker.id],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        },
      });

      const { client: pedantClient } = createFakeClient([
        [
          '=== CONTRADICTIONS',
          'F2 | Mara | appearance | cloak is blue',
          '=== LEAKS',
          'F1 | Corin | amber-four',
          'F1 | Mara | amber-four',
          'F1 | Lyra | amber-four',
        ].join('\n'),
        [
          '=== CONTRADICTIONS',
          'F1 | Mara | trait | red',
        ].join('\n'),
      ], { store });

      const pedantService = new PedantService({ store, client: pedantClient, scribeService });
      const validFindings = await pedantService.checkTurn({
        campaignId: campaign.id,
        turn: secondPair.assistantTurn,
      });
      assert.equal(validFindings.length, 1);
      assert.equal(validFindings[0].kind, FindingKind.SecretLeak);
      assert.equal(validFindings[0].speakerCharacterId, unlinkedSpeaker.id);

      const toldResult = pedantService.resolveFinding({
        campaignId: campaign.id,
        findingId: validFindings[0].id,
        action: FindingStatus.Told,
      });
      assert.equal(toldResult.status, FindingStatus.Told);
      const updatedLyra = store.getCharacter(campaign.id, unlinkedSpeaker.id);
      assert.ok(updatedLyra.scribeSubjectId);
      const stateAfterTell = scribeService.loadState(campaign.id).state;
      const cipherFact = stateAfterTell.facts.find((fact) => fact.id === 'F1');
      assert.equal(ScribeKnowledge.knows(stateAfterTell, updatedLyra.scribeSubjectId, cipherFact), true);
      assert.equal(ScribeKnowledge.knows(stateAfterTell, corin.scribeSubjectId, cipherFact), false);

      assert.throws(() => {
        pedantService.resolveFinding({
          campaignId: campaign.id,
          findingId: validFindings[0].id,
          action: FindingStatus.Dismissed,
        });
      }, /already resolved/i);

      const preWidenLoaded = scribeService.loadState(campaign.id);
      ScribeLogCore.rule(preWidenLoaded.log, preWidenLoaded.state, {
        type: ScribeLogCore.Ruling.Widen,
        fact: 'F1',
        to: ScribeLogCore.Settings.Everyone,
      });
      store.saveScribeBook(campaign.id, {
        bookJson: JSON.stringify(preWidenLoaded.log),
        lastTurnSeq: preWidenLoaded.lastTurnSeq,
        dirty: false,
      });

      const { client: openClient } = createFakeClient([
        [
          '=== CONTRADICTIONS',
          'F1 | Mara | trait | red',
        ].join('\n'),
      ], { store });
      const disambigPedant = new PedantService({ store, client: openClient, scribeService });
      const explicitFindings = await disambigPedant.checkTurn({
        campaignId: campaign.id,
        turn: secondPair.assistantTurn,
        beats: [
          {
            speakerType: SpeakerType.Character,
            characterId: unlinkedSpeaker.id,
            speakerName: unlinkedSpeaker.name,
            text: 'The sunset is red tonight.',
          },
          {
            speakerType: SpeakerType.Character,
            characterId: mara.id,
            speakerName: mara.name,
            text: 'Mara has red ink on her hands.',
          },
        ],
      });
      assert.equal(explicitFindings.length, 1);
      assert.equal(explicitFindings[0].speakerCharacterId, mara.id);
    } finally {
      store.close();
    }
  });

  it('rejects refused tellCommit ops, keeps Tell Scribe threads visible, handles non-live relation rulings, and enforces packet/Muse edge cases (Findings 8, 9, 10)', async () => {
    const { store, campaign, rowan, mara, corin } = createSeededCampaign();
    try {
      const log = ScribeLogCore.create();
      let state = ScribeReplay.run(log, []);
      for (const character of [rowan, mara, corin]) {
        ScribeLogCore.syncCharacterSubject(log, state, {
          subjectId: character.scribeSubjectId,
          name: character.name,
          aliases: character.aliases,
        });
        state = ScribeReplay.run(log, []);
      }
      store.saveScribeBook(campaign.id, { bookJson: JSON.stringify(log), lastTurnSeq: 0, dirty: false });

      const privatePair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Behind closed doors.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Behind closed doors.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Secret talk.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [{ speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'Corin must not hear.' }],
        nextSceneState: {
          ...campaign.sceneState,
          presentIds: [rowan.id, mara.id],
          remoteIds: [],
        },
      });

      const scribeService = new ScribeService({ store });
      let loaded = scribeService.loadState(campaign.id);
      const sceneOps = scribeService.synthesizeSceneOperations(
        loaded.turns,
        new Map([[rowan.id, rowan], [mara.id, mara], [corin.id, corin]]),
      );
      ScribeLogCore.append(
        loaded.log,
        loaded.state,
        [
          ...sceneOps,
          {
            type: ScribeAnswer.Type.ThreadOpen,
            text: 'Private thread about Corin',
            subject: corin.scribeSubjectId,
            position: 2,
          },
          {
            type: ScribeAnswer.Type.Fact,
            label: 'Mara',
            category: 'relation',
            target: 'Rowan',
            text: 'wary allies',
            position: 2,
            hidden: false,
          },
          {
            type: ScribeAnswer.Type.Fact,
            label: 'Mara',
            category: 'relation',
            target: 'Ghost Stranger',
            text: 'owes a debt',
            position: 2,
            hidden: false,
          },
        ],
        { messages: loaded.messages, origin: ScribeLogCore.Origin.Story },
      );
      store.saveScribeBook(campaign.id, {
        bookJson: JSON.stringify(loaded.log),
        lastTurnSeq: privatePair.assistantTurn.seq,
        dirty: false,
      });

      const beforeRefusedJson = store.getScribeBook(campaign.id).bookJson;
      assert.throws(() => {
        scribeService.tellCommit({
          campaignId: campaign.id,
          operations: [
            {
              type: ScribeAnswer.Type.Fact,
              label: 'UnknownSubject',
              category: 'trait',
              target: null,
              text: 'bad citation fact',
              position: 99,
              hidden: false,
            },
          ],
        });
      }, /refused/i);
      assert.equal(store.getScribeBook(campaign.id).bookJson, beforeRefusedJson);

      const committedNoteThread = scribeService.tellCommit({
        campaignId: campaign.id,
        operations: [
          {
            type: ScribeAnswer.Type.ThreadOpen,
            text: 'Operator note: Winter storm approaches the harbor',
            position: 2,
          },
        ],
      });

      const turnsById = new Map(scribeService.loadState(campaign.id).turns.map((turn) => [turn.id, turn]));
      const corinPacket = scribeService.characterKnowledgePacket({
        state: committedNoteThread.state,
        character: corin,
        presentCharacters: [mara, corin],
        turnsById,
      });
      assert.equal(corinPacket.visibleThreads.some((thread) => thread.text.includes('Winter storm')), true);
      assert.equal(corinPacket.visibleThreads.some((thread) => thread.text.includes('Private thread about Corin')), false);

      const ghostCharacter = {
        id: 'ghost-char-id',
        scribeSubjectId: null,
        name: 'Ghost Stranger',
        aliases: [],
      };
      const rowanPacket = scribeService.characterKnowledgePacket({
        state: committedNoteThread.state,
        character: rowan,
        presentCharacters: [rowan, mara],
        turnsById,
      });
      assert.equal(rowanPacket.relationships.some((fact) => fact.text === 'wary allies'), true);

      const unresolvedRelLog = ScribeLogCore.create();
      let relState = ScribeReplay.run(unresolvedRelLog, []);
      ScribeLogCore.syncCharacterSubject(unresolvedRelLog, relState, { subjectId: 'S1', name: 'Mara', aliases: [] });
      relState = ScribeReplay.run(unresolvedRelLog, []);
      const dummyIntake = ScribeIntakeAdapter.fromTurns([
        { id: 'u1', seq: 1, role: TurnRole.User, mode: TurnMode.Normal, rawText: 'Hi', sceneNumber: 1, beats: [] },
      ]);
      ScribeLogCore.append(
        unresolvedRelLog,
        relState,
        [
          {
            type: ScribeAnswer.Type.Scene,
            day: 1,
            first: 1,
            last: 1,
            place: 'Pier',
            reach: ScribeAnswer.Reach.Public,
            present: [{ subject: 'S1', label: 'Mara', from: null, until: null }],
            summary: 'Day 1 at Pier with Mara',
          },
          {
            type: ScribeAnswer.Type.Fact,
            label: 'Mara',
            category: 'relation',
            target: 'Ghost Stranger',
            text: 'owes Ghost Stranger silver',
            position: 1,
            hidden: false,
          },
        ],
        { messages: dummyIntake.messages, origin: ScribeLogCore.Origin.Story },
      );
      relState = ScribeReplay.run(unresolvedRelLog, ['u1']);
      const ghostPacket = scribeService.characterKnowledgePacket({
        state: relState,
        character: ghostCharacter,
        presentCharacters: [{ id: mara.id, scribeSubjectId: 'S1', name: 'Mara', aliases: [] }],
      });
      assert.equal(ghostPacket.relationships.length, 0);

      const resolvedPacket = scribeService.characterKnowledgePacket({
        state: relState,
        character: { id: 'ghost-char-id', scribeSubjectId: 'S2', name: 'Ghost Stranger', aliases: [] },
        presentCharacters: [{ id: mara.id, scribeSubjectId: 'S1', name: 'Mara', aliases: [] }],
      });
      assert.equal(resolvedPacket.relationships.length, 1);
      assert.equal(resolvedPacket.relationships[0].text, 'owes Ghost Stranger silver');

      const pedantService = new PedantService({ store, scribeService });
      const relFindings = store.insertFindings(campaign.id, privatePair.assistantTurn.id, [
        {
          kind: FindingKind.Contradiction,
          subjectId: 'S2',
          subjectName: 'Mara',
          speakerCharacterId: mara.id,
          factId: 'F1',
          category: 'relation',
          bookText: 'wary allies',
          summary: 'Relation changed',
          quote: 'sworn allies',
        },
      ]);
      const stateBeforeRemoveRel = scribeService.loadState(campaign.id);
      ScribeLogCore.rule(stateBeforeRemoveRel.log, stateBeforeRemoveRel.state, {
        type: ScribeLogCore.Ruling.RemoveFact,
        fact: 'F1',
      });
      store.saveScribeBook(campaign.id, {
        bookJson: JSON.stringify(stateBeforeRemoveRel.log),
        lastTurnSeq: stateBeforeRemoveRel.lastTurnSeq,
        dirty: false,
      });

      const ruledRel = pedantService.resolveFinding({
        campaignId: campaign.id,
        findingId: relFindings[0].id,
        action: FindingStatus.Ruled,
        replacementText: 'sworn allies',
      });
      assert.equal(ruledRel.status, FindingStatus.Ruled);
      assert.equal(
        scribeService.loadState(campaign.id).state.facts.some((fact) => fact.text === 'sworn allies' && fact.status === ScribeReplay.Status.InForce),
        true,
      );

      const missingTargetFindings = store.insertFindings(campaign.id, privatePair.assistantTurn.id, [
        {
          kind: FindingKind.Contradiction,
          subjectId: 'S2',
          subjectName: 'Mara',
          speakerCharacterId: mara.id,
          factId: null,
          category: 'relation',
          bookText: '',
          summary: 'Missing target relation',
          quote: 'enemies',
        },
      ]);
      assert.throws(() => {
        pedantService.resolveFinding({
          campaignId: campaign.id,
          findingId: missingTargetFindings[0].id,
          action: FindingStatus.Ruled,
          replacementText: 'enemies',
        });
      }, /target subject/i);

      assert.equal(MuseService.line('LINE:   \n   '), null);
      assert.equal(MuseService.line('LINE:'), null);
      assert.equal(
        MuseService.line('LINE: First line arrives.\nSecond line settles.'),
        'First line arrives.\nSecond line settles.',
      );

      const { client: blankMuseClient } = createFakeClient(['LINE:   \n   '], { store });
      const museService = new MuseService({ store, client: blankMuseClient, scribeService });
      await assert.rejects(() => museService.suggestDevelopment({ campaignId: campaign.id }), /empty suggestion/i);
    } finally {
      store.close();
    }
  });

  it('defers scribeSubjectId DB writes past fallible steps and rejects blank Pedant quotes at parse time', async () => {
    const { store, campaign, rowan, mara } = createSeededCampaign();
    try {
      const lyra = store.createCharacter(campaign.id, {
        slug: 'lyra',
        scribeSubjectId: null,
        name: 'Lyra',
        aliases: [],
        isPlayer: false,
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Amber,
      });

      const firstPair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Meet at the quay.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Meet at the quay.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Mara never drinks tea and speaks softly.', sceneNumber: 1, witnessIds: [rowan.id, mara.id] },
        assistantBeats: [
          { speakerType: SpeakerType.Character, characterId: mara.id, speakerName: mara.name, text: 'Tea dulls my senses.' },
        ],
        nextSceneState: {
          sceneNumber: 1,
          day: 1,
          timeLabel: 'Morning',
          location: 'Open Quay',
          sceneType: SceneType.Public,
          presentIds: [rowan.id, mara.id],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        },
      });

      const httpErrorClient = new OpenRouterClient({
        /**
         * @returns {string}
         */
        apiKeyProvider: () => 'sk-test-fake-scribe-key',
        /**
         * @param {object} spendDto
         * @returns {void}
         * @throws {Error}
         */
        onSpend: (spendDto) => store.recordSpend(spendDto),
        /**
         * @returns {Promise<Response>}
         */
        fetchImpl: async () => {
          return new Response(
            JSON.stringify({ error: { message: 'Unauthorized key' } }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          );
        },
      });
      const httpFailingScribeService = new ScribeService({ store, client: httpErrorClient });
      assert.equal(store.getScribeBook(campaign.id), null);
      await assert.rejects(() => httpFailingScribeService.updateMemory({ campaignId: campaign.id }));
      assert.equal(store.getCharacter(campaign.id, lyra.id).scribeSubjectId, null);
      assert.equal(store.getScribeBook(campaign.id), null);

      const failingClient = new OpenRouterClient({
        /**
         * @returns {string}
         */
        apiKeyProvider: () => 'sk-test-fake-scribe-key',
        /**
         * @param {object} spendDto
         * @returns {void}
         * @throws {Error}
         */
        onSpend: (spendDto) => store.recordSpend(spendDto),
        /**
         * @returns {Promise<Response>}
         */
        fetchImpl: async () => {
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'completely unparseable story response' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0.0001 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      });
      const failingScribeService = new ScribeService({ store, client: failingClient });
      await assert.rejects(
        () => failingScribeService.updateMemory({ campaignId: campaign.id }),
        /unparseable output/i,
      );
      assert.equal(store.getCharacter(campaign.id, lyra.id).scribeSubjectId, null);
      assert.equal(store.getScribeBook(campaign.id), null);

      const { client: okClient } = createFakeClient(
        ['=== FACTS\nMara | trait | never drinks tea | #2'],
        { store },
      );
      const okScribeService = new ScribeService({ store, client: okClient });
      const baseUpdate = await okScribeService.updateMemory({ campaignId: campaign.id });
      const lyraSubjectIdBeforeDelete = store.getCharacter(campaign.id, lyra.id).scribeSubjectId;
      assert.ok(lyraSubjectIdBeforeDelete);
      const publicFact = baseUpdate.state.facts.find((fact) => fact.text === 'never drinks tea');
      assert.ok(publicFact);

      const secondPair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Listen closely.', sceneNumber: 1, witnessIds: [rowan.id, mara.id, lyra.id] },
        userBeat: { speakerType: SpeakerType.Player, characterId: rowan.id, speakerName: rowan.name, text: 'Listen closely.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Lyra pours tea.', sceneNumber: 1, witnessIds: [rowan.id, mara.id, lyra.id] },
        assistantBeats: [
          { speakerType: SpeakerType.Character, characterId: lyra.id, speakerName: lyra.name, text: 'Mara loves tea and carries salt.' },
        ],
        nextSceneState: {
          sceneNumber: 1,
          day: 1,
          timeLabel: 'Morning',
          location: 'Open Quay',
          sceneType: SceneType.Public,
          presentIds: [rowan.id, mara.id, lyra.id],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        },
      });

      const { client: blankPedantClient } = createFakeClient(
        [
          [
            '=== CONTRADICTIONS',
            `${publicFact.id} | Mara | trait |   `,
            `${publicFact.id} | Mara | trait |`,
            '=== LEAKS',
            `${publicFact.id} | Lyra |   `,
            `${publicFact.id} | Lyra |`,
          ].join('\n'),
        ],
        { store },
      );
      const blankPedantService = new PedantService({ store, client: blankPedantClient, scribeService: okScribeService });
      const blankQuoteFindings = await blankPedantService.checkTurn({
        campaignId: campaign.id,
        turn: secondPair.assistantTurn,
      });
      assert.equal(blankQuoteFindings.length, 0);
      assert.equal(store.listFindings(campaign.id, { limit: 50 }).items.length, 0);

      const unlinkedAfterReset = store.updateCharacter(campaign.id, lyra.id, { scribeSubjectId: null });
      assert.equal(unlinkedAfterReset.scribeSubjectId, null);
      const loadedBeforeTellFail = okScribeService.loadState(campaign.id);
      const tellSafeLog = ScribeLogCore.create();
      let tellSafeState = ScribeReplay.run(tellSafeLog, []);
      for (const castMember of [rowan, mara]) {
        ScribeLogCore.syncCharacterSubject(tellSafeLog, tellSafeState, {
          subjectId: castMember.scribeSubjectId,
          name: castMember.name,
          aliases: castMember.aliases,
        });
        tellSafeState = ScribeReplay.run(tellSafeLog, []);
      }
      const firstIntakeMessages = loadedBeforeTellFail.messages.filter((message) => {
        return [firstPair.userTurn.id, firstPair.assistantTurn.id].includes(message.id);
      });
      ScribeLogCore.append(
        tellSafeLog,
        tellSafeState,
        [
          {
            type: ScribeAnswer.Type.Scene,
            day: 1,
            first: firstPair.userTurn.seq,
            last: firstPair.assistantTurn.seq,
            place: 'Open Quay',
            reach: ScribeAnswer.Reach.Public,
            present: [{ subject: mara.scribeSubjectId, label: mara.name, from: null, until: null }],
            summary: 'Day 1 at Open Quay',
          },
          {
            type: ScribeAnswer.Type.Fact,
            label: mara.name,
            category: 'trait',
            target: null,
            text: 'never drinks tea',
            position: firstPair.assistantTurn.seq,
            hidden: false,
          },
        ],
        { messages: firstIntakeMessages, origin: ScribeLogCore.Origin.Story },
      );
      const beforeFailedTellBookJson = JSON.stringify(tellSafeLog);
      store.saveScribeBook(campaign.id, {
        bookJson: beforeFailedTellBookJson,
        lastTurnSeq: firstPair.assistantTurn.seq,
        dirty: false,
      });

      const failedTellFindings = store.insertFindings(campaign.id, secondPair.assistantTurn.id, [
        {
          kind: FindingKind.SecretLeak,
          subjectId: mara.scribeSubjectId,
          subjectName: mara.name,
          speakerCharacterId: lyra.id,
          factId: 'F1',
          category: 'trait',
          bookText: 'never drinks tea',
          summary: 'Everyone already knows this public trait',
          quote: 'Mara never drinks tea',
        },
      ]);

      assert.throws(() => {
        blankPedantService.resolveFinding({
          campaignId: campaign.id,
          findingId: failedTellFindings[0].id,
          action: FindingStatus.Told,
        });
      }, /already known to everyone/i);

      assert.equal(store.getCharacter(campaign.id, lyra.id).scribeSubjectId, null);
      assert.equal(store.getScribeBook(campaign.id).bookJson, beforeFailedTellBookJson);
      assert.equal(
        store.listFindings(campaign.id, { limit: 50 }).items.find((item) => item.id === failedTellFindings[0].id).status,
        FindingStatus.Open,
      );

      const tellCommitRes = okScribeService.tellCommit({
        campaignId: campaign.id,
        operations: [
          {
            type: ScribeAnswer.Type.Subject,
            label: 'Kestrel',
            kind: ScribeCategory.SubjectKinds.Character,
          },
        ],
      });
      const kestrelSubject = tellCommitRes.state.subjects.find((subject) => subject.label === 'Kestrel');
      assert.ok(kestrelSubject);
      assert.equal(store.getCharacter(campaign.id, lyra.id).scribeSubjectId, null);

      const nonConflictingState = okScribeService.loadState(campaign.id).state;
      assert.equal(
        nonConflictingState.subjects.some((subject) => subject.label === 'Lyra'),
        false,
      );
    } finally {
      store.close();
    }
  });
});

describe('AddFact evidence and the Reported rule for ruled facts', () => {
  /**
   * @returns {{log: object, state: object}}
   * @throws {Error}
   */
  const buildCastLog = () => {
    const log = ScribeLogCore.create();
    let state = ScribeReplay.run(log, []);
    for (const name of ['Ilse Marrow', 'Garrick Fenn', 'Odo Brask']) {
      ScribeLogCore.syncCharacterSubject(log, state, {
        subjectId: null,
        name,
        aliases: [],
        kind: ScribeCategory.SubjectKinds.Character,
      });
      state = ScribeReplay.run(log, []);
    }
    return { log, state };
  };

  const landingRuling = Object.freeze({
    type: ScribeLogCore.Ruling.AddFact,
    subject: 'S1',
    category: 'location',
    target: null,
    text: 'at the ferry landing',
    hidden: false,
    cite: null,
    position: 0,
  });

  it('stores only a valid {attribution, speaker} evidence on AddFact and refuses every other evidence value', () => {
    const { log, state } = buildCastLog();
    const view = ScribeLogCore.view(state);

    const plain = { counters: { nextFact: 1 }, stored: null };
    assert.equal(ScribeLogCore.Rulers.AddFact(landingRuling, view, plain), null);
    assert.equal(Object.hasOwn(plain.stored, 'evidence'), false);

    for (const attribution of ['witnessed', 'claimed', 'inferred', 'promised', 'ruled']) {
      const outcome = { counters: { nextFact: 1 }, stored: null };
      const evidence = { attribution, speaker: 'Garrick Fenn' };
      assert.equal(ScribeLogCore.Rulers.AddFact({ ...landingRuling, evidence }, view, outcome), null);
      assert.deepEqual(outcome.stored.evidence, evidence);
      assert.notEqual(outcome.stored.evidence, evidence);
    }

    const refusedEvidence = [
      null,
      [],
      'claimed',
      0,
      {},
      { attribution: 'claimed' },
      { speaker: 'Garrick Fenn' },
      { attribution: 'rumoured', speaker: 'Garrick Fenn' },
      { attribution: 'Claimed', speaker: 'Garrick Fenn' },
      { attribution: 'claimed', speaker: '' },
      { attribution: 'claimed', speaker: '   ' },
      { attribution: 'claimed', speaker: 7 },
      { attribution: 'claimed', speaker: null },
      { attribution: 'claimed', speaker: 'Garrick Fenn', messageId: 'msg-ferry-1' },
      { attribution: 'claimed', speaker: 'Garrick Fenn', quote: 'He waits at the landing.' },
      Object.create({ attribution: 'claimed', speaker: 'Garrick Fenn' }),
    ];
    for (const evidence of refusedEvidence) {
      const outcome = { counters: { nextFact: 1 }, stored: null };
      assert.equal(
        ScribeLogCore.Rulers.AddFact({ ...landingRuling, evidence }, view, outcome),
        ScribeLogCore.Settings.InvalidOperation,
        JSON.stringify(evidence),
      );
      assert.equal(outcome.stored, null);
    }

    const entriesBefore = log.entries.length;
    assert.throws(
      () => ScribeLogCore.rule(log, state, { ...landingRuling, evidence: { attribution: 'claimed', speaker: ' ' } }),
      /InvalidOperation/,
    );
    assert.equal(log.entries.length, entriesBefore);
    const entry = ScribeLogCore.rule(log, state, {
      ...landingRuling,
      evidence: { attribution: 'claimed', speaker: 'Garrick Fenn' },
    });
    assert.deepEqual(entry.operations[0].evidence, { attribution: 'claimed', speaker: 'Garrick Fenn' });
    assert.equal(entry.origin, ScribeLogCore.Origin.Operator);
  });

  it('accepts reported only as true or absent, stores it on the operation and refuses every other value', () => {
    const { log, state } = buildCastLog();
    const view = ScribeLogCore.view(state);

    const absent = { counters: { nextFact: 1 }, stored: null };
    assert.equal(ScribeLogCore.Rulers.AddFact(landingRuling, view, absent), null);
    assert.equal(Object.hasOwn(absent.stored, 'reported'), false);

    const accepted = { counters: { nextFact: 1 }, stored: null };
    assert.equal(ScribeLogCore.Rulers.AddFact({ ...landingRuling, reported: true }, view, accepted), null);
    assert.equal(accepted.stored.reported, true);

    for (const reported of [false, 'true', 1, null]) {
      const outcome = { counters: { nextFact: 1 }, stored: null };
      assert.equal(
        ScribeLogCore.Rulers.AddFact({ ...landingRuling, reported }, view, outcome),
        ScribeLogCore.Settings.InvalidOperation,
        JSON.stringify(reported),
      );
      assert.equal(outcome.stored, null);
    }

    const entriesBefore = log.entries.length;
    assert.throws(() => ScribeLogCore.rule(log, state, { ...landingRuling, reported: 1 }), /InvalidOperation/);
    assert.equal(log.entries.length, entriesBefore);
  });

  it('files an AddFact as Reported only when reported is true, whatever its evidence says', () => {
    const { log } = buildCastLog();
    const rulings = [
      { subject: 'S1', category: 'location', text: 'at the ferry landing', reported: true, evidence: { attribution: 'claimed', speaker: 'Garrick Fenn' } },
      { subject: 'S2', category: 'role', text: 'harbor pilot', reported: true },
      { subject: 'S3', category: 'status', text: 'sworn to the watch', evidence: { attribution: 'promised', speaker: 'Odo Brask' } },
      { subject: 'S1', category: 'eyes', text: 'grey', evidence: { attribution: 'claimed', speaker: 'Garrick Fenn' } },
      { subject: 'S3', category: 'role', text: 'ferryman' },
    ];
    for (const ruling of rulings) {
      ScribeLogCore.rule(log, ScribeReplay.run(log, []), { ...landingRuling, ...ruling });
    }
    const state = ScribeReplay.run(log, []);
    const labels = ScribeAnalyzer.labels(state);
    /**
     * @param {string} text
     * @returns {object}
     */
    const factNamed = (text) => state.facts.find((fact) => fact.text === text);

    for (const text of ['at the ferry landing', 'harbor pilot']) {
      assert.equal(factNamed(text).status, ScribeReplay.Status.Reported, text);
      assert.equal(ScribeReplay.live(factNamed(text)), false, text);
      assert.equal(factNamed(text).origin, ScribeLogCore.Origin.Operator, text);
    }
    for (const text of ['sworn to the watch', 'grey', 'ferryman']) {
      assert.equal(factNamed(text).status, ScribeReplay.Status.InForce, text);
    }

    assert.deepEqual(factNamed('at the ferry landing').evidence, { attribution: 'claimed', speaker: 'Garrick Fenn' });
    assert.match(ScribeAnalyzer.statement(factNamed('at the ferry landing'), labels), / \[claimed by Garrick Fenn\]$/);
    assert.equal(Object.hasOwn(factNamed('harbor pilot'), 'evidence'), false);
    assert.match(ScribeAnalyzer.statement(factNamed('grey'), labels), / \[claimed by Garrick Fenn\]$/);
    assert.equal(Object.hasOwn(factNamed('ferryman'), 'evidence'), false);
  });

  it('still files Story-origin Moving facts with claimed, inferred or promised evidence as Reported', () => {
    const log = ScribeLogCore.create();
    log.read = { 'msg-1': 1 };
    log.entries = [
      {
        sequence: 1,
        kind: ScribeLogCore.Kind.Update,
        origin: ScribeLogCore.Origin.Story,
        messageIds: ['msg-1'],
        operations: [
          { type: ScribeAnswer.Type.Subject, subject: 'S1', label: 'Ilse Marrow', kind: 'character' },
          ...['claimed', 'witnessed'].map((attribution, index) => ({
            type: ScribeAnswer.Type.Fact,
            fact: `F${index + 1}`,
            subject: 'S1',
            label: 'Ilse Marrow',
            category: 'location',
            target: null,
            targetText: null,
            other: null,
            text: `place ${attribution}`,
            cite: 'msg-1',
            position: 1,
            hidden: false,
            evidence: {
              section: 'FACTS',
              row: index + 1,
              messageNumber: 1,
              messageId: 'msg-1',
              fingerprint: 'fp-msg-1',
              blockNumber: 1,
              speaker: 'Garrick Fenn',
              quote: 'q',
              attribution,
            },
          })),
        ],
        withdrawn: false,
      },
    ];
    const state = ScribeReplay.run(log, [{ id: 'msg-1', sender: 'narrator@ferry.example', contents: [] }]);
    assert.equal(state.facts.find((fact) => fact.text === 'place claimed').status, ScribeReplay.Status.Reported);
    assert.equal(state.facts.find((fact) => fact.text === 'place witnessed').status, ScribeReplay.Status.InForce);
  });
});

describe('AddFact audience for ruled facts', () => {
  /**
   * @returns {{log: object, state: object}}
   * @throws {Error}
   */
  const buildCastLog = () => {
    const log = ScribeLogCore.create();
    let state = ScribeReplay.run(log, []);
    for (const name of ['Ilse Marrow', 'Garrick Fenn', 'Odo Brask', 'Pell Dunmore', 'Ruth Quill']) {
      ScribeLogCore.syncCharacterSubject(log, state, {
        subjectId: null,
        name,
        aliases: [],
        kind: ScribeCategory.SubjectKinds.Character,
      });
      state = ScribeReplay.run(log, []);
    }
    return { log, state };
  };

  const landingRuling = Object.freeze({
    type: ScribeLogCore.Ruling.AddFact,
    subject: 'S1',
    category: 'location',
    target: null,
    text: 'at the ferry landing',
    hidden: false,
    cite: null,
    position: 0,
  });

  /**
   * @param {object} state
   * @returns {object}
   */
  const landing = (state) => state.facts.find((fact) => fact.text === 'at the ferry landing');

  it('stores a copy of a valid audience and refuses every other audience value', () => {
    const { log, state } = buildCastLog();
    const view = ScribeLogCore.view(state);
    const audience = ['S2', 'S3'];

    const accepted = { counters: { nextFact: 1 }, stored: null };
    assert.equal(ScribeLogCore.Rulers.AddFact({ ...landingRuling, audience }, view, accepted), null);
    assert.deepEqual(accepted.stored.audience, audience);
    assert.notEqual(accepted.stored.audience, audience);

    const absent = { counters: { nextFact: 1 }, stored: null };
    assert.equal(ScribeLogCore.Rulers.AddFact(landingRuling, view, absent), null);
    assert.equal(Object.hasOwn(absent.stored, 'audience'), false);

    for (const refused of [[], ['S2', 'S2'], [''], ['  '], ['S2', ' '], ['S99'], ['S2', 7], 'S2', null, {}, 'Everyone']) {
      const outcome = { counters: { nextFact: 1 }, stored: null };
      assert.equal(
        ScribeLogCore.Rulers.AddFact({ ...landingRuling, audience: refused }, view, outcome),
        ScribeLogCore.Settings.InvalidOperation,
        JSON.stringify(refused),
      );
      assert.equal(outcome.stored, null);
    }

    const entriesBefore = log.entries.length;
    assert.throws(() => ScribeLogCore.rule(log, state, { ...landingRuling, audience: ['S99'] }), /InvalidOperation/);
    assert.equal(log.entries.length, entriesBefore);

    ScribeLogCore.rule(log, state, { ...landingRuling, audience });
    assert.deepEqual(landing(ScribeReplay.run(log, [])).audience, ['S2', 'S3']);
  });

  it('makes a non-hidden Operator fact with an audience known only to its subject, audience, told and widened subjects', () => {
    const { log, state } = buildCastLog();
    ScribeLogCore.rule(log, state, { ...landingRuling, audience: ['S2'] });
    const fact = landing(ScribeReplay.run(log, []));
    log.entries.push({
      sequence: log.nextSequence,
      kind: ScribeLogCore.Kind.Operator,
      origin: ScribeLogCore.Origin.Operator,
      messageIds: [],
      operations: [{ type: ScribeAnswer.Type.Told, fact: fact.id, subject: 'S3', cite: null, position: 0 }],
      withdrawn: false,
    });
    log.nextSequence += 1;
    log.revision += 1;
    ScribeLogCore.rule(log, ScribeReplay.run(log, []), { type: ScribeLogCore.Ruling.Widen, fact: fact.id, to: ['S4'] });

    const replayed = ScribeReplay.run(log, []);
    const known = ['S1', 'S2', 'S3', 'S4', 'S5'].filter((id) => ScribeKnowledge.knows(replayed, id, landing(replayed)));
    assert.deepEqual(known, ['S1', 'S2', 'S3', 'S4']);
    assert.deepEqual([...ScribeKnowledge.audience(replayed, landing(replayed))].sort(), ['S1', 'S2', 'S3', 'S4']);
  });

  it('lets a widening to Everyone reach all and keeps an Operator fact without an audience known to everyone', () => {
    const { log, state } = buildCastLog();
    ScribeLogCore.rule(log, state, { ...landingRuling, audience: ['S2'] });
    ScribeLogCore.rule(log, ScribeReplay.run(log, []), { ...landingRuling, category: 'role', text: 'harbor pilot' });
    let replayed = ScribeReplay.run(log, []);
    const narrowed = landing(replayed);
    const open = replayed.facts.find((fact) => fact.text === 'harbor pilot');
    assert.equal(ScribeKnowledge.knows(replayed, 'S5', narrowed), false);
    assert.equal(ScribeKnowledge.audience(replayed, open), ScribeKnowledge.Everyone);
    assert.equal(ScribeKnowledge.knows(replayed, 'S5', open), true);

    ScribeLogCore.rule(log, replayed, { type: ScribeLogCore.Ruling.Widen, fact: narrowed.id, to: ScribeKnowledge.Everyone });
    replayed = ScribeReplay.run(log, []);
    assert.equal(ScribeKnowledge.audience(replayed, landing(replayed)), ScribeKnowledge.Everyone);
    for (const id of ['S1', 'S2', 'S3', 'S4', 'S5']) {
      assert.equal(ScribeKnowledge.knows(replayed, id, landing(replayed)), true, id);
    }
  });
});

describe('Exact Widen, Pin audience and audience ids through merges', () => {
  const everyone = ScribeKnowledge.Everyone;

  const baseRuling = Object.freeze({
    type: ScribeLogCore.Ruling.AddFact,
    subject: 'S1',
    category: 'eyes',
    target: null,
    text: 'amber',
    hidden: false,
    cite: null,
    position: 0,
  });

  /**
   * @returns {{log: object, state: object}}
   * @throws {Error}
   */
  const buildCastLog = () => {
    const log = ScribeLogCore.create();
    let state = ScribeReplay.run(log, []);
    for (const name of ['Ilse Marrow', 'Garrick Fenn', 'Odo Brask', 'Pell Dunmore', 'Ruth Quill']) {
      ScribeLogCore.syncCharacterSubject(log, state, {
        subjectId: null,
        name,
        aliases: [],
        kind: ScribeCategory.SubjectKinds.Character,
      });
      state = ScribeReplay.run(log, []);
    }
    return { log, state };
  };

  /**
   * @param {object} log
   * @param {object} operation
   * @returns {object}
   * @throws {Error}
   */
  const rule = (log, operation) => {
    ScribeLogCore.rule(log, ScribeReplay.run(log, []), operation);
    return ScribeReplay.run(log, []);
  };

  /**
   * @param {object} state
   * @param {string} factId
   * @returns {object}
   */
  const factOf = (state, factId) => state.facts.find((fact) => fact.id === factId);

  /**
   * @param {object} state
   * @param {string} factId
   * @returns {string[]}
   */
  const knowers = (state, factId) => {
    return ['S1', 'S2', 'S3', 'S4', 'S5'].filter((id) => ScribeKnowledge.knows(state, id, factOf(state, factId)));
  };

  describe('Widen exact', () => {
    const bold = Object.freeze({ ...baseRuling, category: 'feature', text: 'bold', hidden: true });

    /**
     * @returns {{log: object, state: object}}
     * @throws {Error}
     */
    const buildTwins = () => {
      const { log } = buildCastLog();
      rule(log, bold);
      return { log, state: rule(log, { ...bold, position: 1 }) };
    };

    it('widens only its own fact when exact is true and stores exact on the operation', () => {
      const { log, state } = buildTwins();
      assert.deepEqual([...ScribeKnowledge.audience(state, factOf(state, 'F2'))], ['S1']);
      const widened = rule(log, { type: ScribeLogCore.Ruling.Widen, fact: 'F1', to: everyone, exact: true });

      assert.equal(log.entries.at(-1).operations[0].exact, true);
      assert.equal(ScribeKnowledge.audience(widened, factOf(widened, 'F1')), everyone);
      assert.deepEqual([...ScribeKnowledge.audience(widened, factOf(widened, 'F2'))], ['S1']);
      assert.deepEqual(knowers(widened, 'F2'), ['S1']);
    });

    it('lets a Widen without exact spread to the same wording as before and stores no exact key', () => {
      const { log, state } = buildTwins();
      assert.equal(state.facts.length, 2);
      const widened = rule(log, { type: ScribeLogCore.Ruling.Widen, fact: 'F1', to: everyone });

      assert.equal(Object.hasOwn(log.entries.at(-1).operations[0], 'exact'), false);
      assert.equal(ScribeKnowledge.audience(widened, factOf(widened, 'F1')), everyone);
      assert.equal(ScribeKnowledge.audience(widened, factOf(widened, 'F2')), everyone);
    });

    it('refuses every exact value other than true and leaves the log unchanged', () => {
      const { log, state } = buildTwins();
      const entriesBefore = log.entries.length;
      for (const refused of [false, 1, 0, 'true', null, {}, []]) {
        const outcome = { counters: { nextFact: 3 }, stored: null };
        assert.equal(
          ScribeLogCore.Rulers.Widen(
            { type: ScribeLogCore.Ruling.Widen, fact: 'F1', to: everyone, exact: refused },
            ScribeLogCore.view(state),
            outcome,
          ),
          ScribeLogCore.Settings.InvalidOperation,
          JSON.stringify(refused),
        );
        assert.equal(outcome.stored, null);
        assert.throws(
          () => ScribeLogCore.rule(log, state, { type: ScribeLogCore.Ruling.Widen, fact: 'F1', to: everyone, exact: refused }),
          /InvalidOperation/,
        );
      }
      assert.equal(log.entries.length, entriesBefore);
    });

    it('keeps an exact Widen to named subjects on its own fact too', () => {
      const { log, state } = buildTwins();
      assert.equal(state.facts.length, 2);
      const widened = rule(log, { type: ScribeLogCore.Ruling.Widen, fact: 'F1', to: ['S3'], exact: true });
      assert.deepEqual(knowers(widened, 'F1'), ['S1', 'S3']);
      assert.deepEqual(knowers(widened, 'F2'), ['S1']);
    });

    it('keeps an exact Everyone ruling on its fact when a later named Widen reaches a same-wording fact', () => {
      const { log } = buildTwins();
      rule(log, { type: ScribeLogCore.Ruling.Widen, fact: 'F1', to: everyone, exact: true });
      const told = rule(log, { type: ScribeLogCore.Ruling.Widen, fact: 'F2', to: ['S3'] });

      assert.equal(ScribeKnowledge.audience(told, factOf(told, 'F1')), everyone);
      assert.deepEqual(knowers(told, 'F1'), ['S1', 'S2', 'S3', 'S4', 'S5']);
      assert.deepEqual(knowers(told, 'F2'), ['S1', 'S3']);
    });

    it('lets a later non-exact ruling on the same fact replace the exact one', () => {
      const { log } = buildTwins();
      rule(log, { type: ScribeLogCore.Ruling.Widen, fact: 'F1', to: everyone, exact: true });
      const replaced = rule(log, { type: ScribeLogCore.Ruling.Widen, fact: 'F1', to: ['S3'] });

      assert.deepEqual(knowers(replaced, 'F1'), ['S1', 'S3']);
      assert.deepEqual(knowers(replaced, 'F2'), ['S1', 'S3']);
    });

    it('lets a later named Widen on a same-wording fact narrow a plain Everyone ruling as before', () => {
      const { log } = buildTwins();
      rule(log, { type: ScribeLogCore.Ruling.Widen, fact: 'F1', to: everyone });
      const told = rule(log, { type: ScribeLogCore.Ruling.Widen, fact: 'F2', to: ['S3'] });

      assert.deepEqual(knowers(told, 'F1'), ['S1', 'S3']);
      assert.deepEqual(knowers(told, 'F2'), ['S1', 'S3']);
    });

    it('applies a Widen after an edit to its own fact only and leaves a later same-wording fact alone', () => {
      const messages = [{ id: 'msg-edit-1', sender: 'narrator@worlds.example', contents: [] }];
      const log = ScribeLogCore.create();
      log.nextSubject = 2;
      log.nextFact = 2;
      log.nextSequence = 2;
      log.revision = 1;
      log.read = { 'msg-edit-1': 1 };
      log.entries = [{
        sequence: 1,
        kind: ScribeLogCore.Kind.Update,
        origin: ScribeLogCore.Origin.Story,
        messageIds: ['msg-edit-1'],
        operations: [
          { type: ScribeAnswer.Type.Subject, subject: 'S1', label: 'Ayla', kind: 'character' },
          {
            type: ScribeAnswer.Type.Fact,
            fact: 'F1',
            subject: 'S1',
            label: 'Ayla',
            category: 'feature',
            target: null,
            targetText: null,
            other: null,
            text: 'bold',
            cite: 'msg-edit-1',
            position: 1,
            hidden: true,
          },
        ],
        withdrawn: false,
      }];
      /**
       * @param {object} operation
       * @returns {void}
       * @throws {Error}
       */
      const ruleEdited = (operation) => {
        const state = ScribeReplay.run(log, messages, null, null, null, null, messages);
        ScribeLogCore.rule(log, state, operation);
      };
      ruleEdited({
        type: ScribeLogCore.Ruling.EditFact,
        fact: 'F1',
        text: 'brave',
        expected: ScribeLogCore.editExpected(
          ScribeReplay.run(log, messages, null, null, null, null, messages).facts.find((fact) => fact.id === 'F1'),
        ),
      });
      ruleEdited({ type: ScribeLogCore.Ruling.Widen, fact: 'F1', to: everyone });
      log.entries.push({
        sequence: log.nextSequence,
        kind: ScribeLogCore.Kind.Update,
        origin: ScribeLogCore.Origin.Story,
        messageIds: ['msg-edit-1'],
        operations: [{
          type: ScribeAnswer.Type.Fact,
          fact: 'F2',
          subject: 'S1',
          label: 'Ayla',
          category: 'feature',
          target: null,
          targetText: null,
          other: null,
          text: 'brave',
          cite: 'msg-edit-1',
          position: 1,
          hidden: true,
        }],
        withdrawn: false,
      });
      log.nextSequence += 1;
      log.revision += 1;
      log.nextFact = 3;
      const state = ScribeReplay.run(log, messages, null, null, null, null, messages);

      assert.equal(log.entries.some((entry) => entry.operations.some((operation) => operation.editedSource)), true);
      assert.equal(ScribeKnowledge.audience(state, factOf(state, 'F1')), everyone);
      assert.deepEqual([...ScribeKnowledge.audience(state, factOf(state, 'F2'))], ['S1']);
    });
  });

  describe('Pin keeps the audience', () => {
    /**
     * @param {object | undefined} audience
     * @returns {{log: object, state: object}}
     * @throws {Error}
     */
    const buildPinned = (audience) => {
      const { log } = buildCastLog();
      rule(log, { ...baseRuling, ...(audience === undefined ? {} : { audience }) });
      const state = rule(log, {
        type: ScribeLogCore.Ruling.Pin,
        subject: 'S1',
        category: 'eyes',
        target: null,
        text: 'amber',
        hidden: false,
      });
      return { log, state };
    };

    it('copies the audience onto the stored Pin and the pinned original stays as it was', () => {
      const { log, state } = buildPinned(['S1', 'S2']);
      const stored = log.entries.at(-1).operations[0];
      assert.deepEqual(stored.audience, ['S1', 'S2']);
      assert.equal(state.facts.length, 1);
      assert.equal(factOf(state, 'F1').pinned, true);
      assert.deepEqual(knowers(state, 'F1'), ['S1', 'S2']);
    });

    it('carries the audience onto the copy that survives when the original is removed', () => {
      const { log } = buildPinned(['S1', 'S2']);
      const state = rule(log, { type: ScribeLogCore.Ruling.RemoveFact, fact: 'F1' });
      const copy = state.facts.find((fact) => fact.made);

      assert.equal(copy.pinned, true);
      assert.deepEqual(copy.audience, ['S1', 'S2']);
      assert.deepEqual(knowers(state, copy.id), ['S1', 'S2']);
      assert.equal(ScribeKnowledge.knows(state, 'S3', copy), false);
    });

    it('adds no audience key to the stored Pin or to the copy when the fact had none', () => {
      const { log } = buildPinned(undefined);
      assert.equal(Object.hasOwn(log.entries.at(-1).operations[0], 'audience'), false);
      const state = rule(log, { type: ScribeLogCore.Ruling.RemoveFact, fact: 'F1' });
      const copy = state.facts.find((fact) => fact.made);

      assert.equal(Object.hasOwn(copy, 'audience'), false);
      assert.equal(ScribeKnowledge.audience(state, copy), everyone);
    });

    it('resolves a copied audience through a merge that comes after the Pin without duplicates', () => {
      const { log } = buildPinned(['S2', 'S4']);
      rule(log, { type: ScribeLogCore.Ruling.RemoveFact, fact: 'F1' });
      const state = rule(log, { type: ScribeLogCore.Ruling.Merge, from: 'S2', into: 'S4' });
      const copy = state.facts.find((fact) => fact.made);

      assert.deepEqual(copy.audience, ['S4']);
      assert.equal(ScribeKnowledge.knows(state, 'S4', copy), true);
      assert.deepEqual(knowers(state, copy.id), ['S1', 'S2', 'S4']);
    });
  });

  describe('audience ids resolve through merges', () => {
    it('lets the survivor know the fact when the merge comes after the AddFact', () => {
      const { log } = buildCastLog();
      rule(log, { ...baseRuling, audience: ['S2'] });
      const state = rule(log, { type: ScribeLogCore.Ruling.Merge, from: 'S2', into: 'S4' });

      assert.deepEqual(factOf(state, 'F1').audience, ['S4']);
      assert.equal(ScribeKnowledge.knows(state, 'S4', factOf(state, 'F1')), true);
      assert.deepEqual(knowers(state, 'F1'), ['S1', 'S2', 'S4']);
    });

    it('lets the survivor know the fact when the merge comes before the AddFact', () => {
      const { log } = buildCastLog();
      rule(log, { type: ScribeLogCore.Ruling.Merge, from: 'S2', into: 'S4' });
      const state = rule(log, { ...baseRuling, audience: ['S2'] });

      assert.deepEqual(factOf(state, 'F1').audience, ['S4']);
      assert.equal(ScribeKnowledge.knows(state, 'S4', factOf(state, 'F1')), true);
      assert.deepEqual(knowers(state, 'F1'), ['S1', 'S2', 'S4']);
    });

    it('keeps order and drops the duplicate when the audience names both sides of a merge', () => {
      const { log } = buildCastLog();
      rule(log, { ...baseRuling, audience: ['S3', 'S2', 'S4'] });
      const state = rule(log, { type: ScribeLogCore.Ruling.Merge, from: 'S2', into: 'S4' });

      assert.deepEqual(factOf(state, 'F1').audience, ['S3', 'S4']);
      assert.deepEqual(knowers(state, 'F1'), ['S1', 'S2', 'S3', 'S4']);
    });
  });
});

describe('Decided AddFact and the latest decision in a slot', () => {
  const decidedHair = Object.freeze({
    type: ScribeLogCore.Ruling.AddFact,
    subject: 'S1',
    category: 'hair',
    target: null,
    text: 'red',
    hidden: false,
    cite: null,
    position: 0,
    decided: true,
  });

  /**
   * @returns {{log: object, state: object}}
   * @throws {Error}
   */
  const buildCastLog = () => {
    const log = ScribeLogCore.create();
    let state = ScribeReplay.run(log, []);
    for (const name of ['Ilse Marrow', 'Garrick Fenn']) {
      ScribeLogCore.syncCharacterSubject(log, state, {
        subjectId: null,
        name,
        aliases: [],
        kind: ScribeCategory.SubjectKinds.Character,
      });
      state = ScribeReplay.run(log, []);
    }
    return { log, state };
  };

  /**
   * @param {object} log
   * @param {object} ruling
   * @returns {object}
   * @throws {Error}
   */
  const rule = (log, ruling) => {
    ScribeLogCore.rule(log, ScribeReplay.run(log, []), ruling);
    return ScribeReplay.run(log, []);
  };

  /**
   * @param {object} state
   * @param {string} text
   * @returns {object}
   */
  const factNamed = (state, text) => state.facts.find((fact) => fact.text === text);

  it('stores decided true on a fixed or moving AddFact and nothing when it is absent', () => {
    const { state } = buildCastLog();
    const view = ScribeLogCore.view(state);
    for (const category of ['hair', 'age', 'build', 'location', 'status', 'role']) {
      const outcome = { counters: { nextFact: 1 }, stored: null };
      assert.equal(ScribeLogCore.Rulers.AddFact({ ...decidedHair, category }, view, outcome), null, category);
      assert.equal(outcome.stored.decided, true, category);
    }
    const plain = { counters: { nextFact: 1 }, stored: null };
    const { decided, ...undecided } = decidedHair;
    assert.equal(decided, true);
    assert.equal(ScribeLogCore.Rulers.AddFact(undecided, view, plain), null);
    assert.equal(Object.hasOwn(plain.stored, 'decided'), false);
  });

  it('refuses decided unless it is true on a fixed or moving category without reported', () => {
    const { log, state } = buildCastLog();
    const view = ScribeLogCore.view(state);
    const refused = [
      { decided: false },
      { decided: 'yes' },
      { decided: 1 },
      { decided: null },
      { decided: true, category: 'feature' },
      { decided: true, category: 'appearance' },
      { decided: true, category: 'aka' },
      { decided: true, category: 'condition' },
      { decided: true, category: 'scar' },
      { decided: true, category: 'relation', target: 'S2' },
      { decided: true, reported: true },
    ];
    for (const override of refused) {
      const outcome = { counters: { nextFact: 1 }, stored: null };
      assert.equal(
        ScribeLogCore.Rulers.AddFact({ ...decidedHair, ...override }, view, outcome),
        ScribeLogCore.Settings.InvalidOperation,
        JSON.stringify(override),
      );
      assert.equal(outcome.stored, null);
    }
    const entriesBefore = log.entries.length;
    assert.throws(() => ScribeLogCore.rule(log, state, { ...decidedHair, decided: 'yes' }), /InvalidOperation/);
    assert.equal(log.entries.length, entriesBefore);
  });

  it('keeps only the latest decided fixed value in force and reports the older one', () => {
    const { log } = buildCastLog();
    rule(log, { ...decidedHair, text: 'red' });
    const state = rule(log, { ...decidedHair, text: 'black' });

    assert.equal(factNamed(state, 'black').status, ScribeReplay.Status.InForce);
    assert.equal(factNamed(state, 'red').status, ScribeReplay.Status.Reported);
    assert.equal(ScribeReplay.live(factNamed(state, 'red')), false);
  });

  it('keeps only the latest decided moving value in force and reports the older one', () => {
    const { log } = buildCastLog();
    const landing = { ...decidedHair, category: 'location' };
    rule(log, { ...landing, text: 'the harbor' });
    const state = rule(log, { ...landing, text: 'the tower' });

    assert.equal(factNamed(state, 'the tower').status, ScribeReplay.Status.InForce);
    assert.equal(factNamed(state, 'the harbor').status, ScribeReplay.Status.Reported);
  });

  it('reports an undecided operator value in the slot and leaves other slots and subjects alone', () => {
    const { log } = buildCastLog();
    const { decided, ...undecided } = decidedHair;
    assert.equal(decided, true);
    rule(log, { ...undecided, text: 'brown' });
    rule(log, { ...undecided, text: 'green', category: 'eyes' });
    rule(log, { ...undecided, text: 'grey', subject: 'S2' });
    const state = rule(log, { ...decidedHair, text: 'red' });

    assert.equal(factNamed(state, 'brown').status, ScribeReplay.Status.Reported);
    assert.equal(factNamed(state, 'red').status, ScribeReplay.Status.InForce);
    assert.equal(factNamed(state, 'green').status, ScribeReplay.Status.InForce);
    assert.equal(factNamed(state, 'grey').status, ScribeReplay.Status.InForce);
  });

  it('orders an operator edit by the log entry of the edit, against the card entry that came later', () => {
    const { log } = buildCastLog();
    const { decided, ...undecided } = decidedHair;
    assert.equal(decided, true);
    rule(log, { ...undecided, text: 'brown' });
    let state = ScribeReplay.run(log, []);
    ScribeLogCore.rule(log, state, {
      type: ScribeLogCore.Ruling.EditFact,
      fact: factNamed(state, 'brown').id,
      text: 'chestnut',
      expected: ScribeLogCore.editExpected(factNamed(state, 'brown')),
    });
    state = ScribeReplay.run(log, []);
    assert.equal(factNamed(state, 'chestnut').status, ScribeReplay.Status.InForce);

    state = rule(log, { ...decidedHair, text: 'red' });
    assert.equal(factNamed(state, 'red').status, ScribeReplay.Status.InForce);
    assert.equal(factNamed(state, 'chestnut').status, ScribeReplay.Status.Reported);

    ScribeLogCore.rule(log, state, {
      type: ScribeLogCore.Ruling.EditFact,
      fact: factNamed(state, 'red').id,
      text: 'auburn',
      expected: ScribeLogCore.editExpected(factNamed(state, 'red')),
    });
    state = ScribeReplay.run(log, []);
    assert.equal(factNamed(state, 'auburn').status, ScribeReplay.Status.InForce);
    assert.equal(factNamed(state, 'chestnut').status, ScribeReplay.Status.Reported);

    state = rule(log, { ...decidedHair, text: 'black' });
    assert.equal(factNamed(state, 'black').status, ScribeReplay.Status.InForce);
    assert.equal(factNamed(state, 'auburn').status, ScribeReplay.Status.Reported);
  });

  it('gives the same statuses when the same log is replayed twice or copied', () => {
    const { log } = buildCastLog();
    rule(log, { ...decidedHair, text: 'red' });
    rule(log, { ...decidedHair, text: 'black' });
    rule(log, { ...decidedHair, text: 'the harbor', category: 'location' });
    rule(log, { ...decidedHair, text: 'the tower', category: 'location' });
    /**
     * @param {object} replayLog
     * @returns {Array<[string, string]>}
     * @throws {TypeError}
     */
    const statuses = (replayLog) => ScribeReplay.run(replayLog, []).facts.map((fact) => [fact.id, fact.status]);

    const first = statuses(log);
    assert.deepEqual(statuses(log), first);
    assert.deepEqual(statuses(structuredClone(log)), first);
    assert.deepEqual(
      first.map(([, status]) => status),
      [
        ScribeReplay.Status.Reported,
        ScribeReplay.Status.InForce,
        ScribeReplay.Status.Reported,
        ScribeReplay.Status.InForce,
      ],
    );
  });

  it('keeps a model-written Change of a decided fact as a Reported second value and the decided one in force', () => {
    const { log } = buildCastLog();
    const state = rule(log, { ...decidedHair, text: 'red' });
    const decided = factNamed(state, 'red');
    const becomes = ScribeLogCore.nextFactId(log);
    log.entries.push({
      sequence: log.nextSequence,
      kind: ScribeLogCore.Kind.Update,
      origin: ScribeLogCore.Origin.Story,
      messageIds: ['msg-1'],
      operations: [
        {
          type: ScribeAnswer.Type.Change,
          fact: decided.id,
          becomes,
          subject: 'S1',
          label: 'Ilse Marrow',
          category: 'hair',
          target: null,
          targetText: null,
          other: null,
          text: 'blonde',
          cite: 'msg-1',
          position: 1,
          hidden: false,
        },
      ],
      withdrawn: false,
    });
    log.read['msg-1'] = log.nextSequence;
    log.nextSequence += 1;
    log.revision += 1;

    const replayed = ScribeReplay.run(log, [{ id: 'msg-1', position: 1 }]);
    assert.equal(factNamed(replayed, 'red').status, ScribeReplay.Status.InForce);
    assert.equal(factNamed(replayed, 'blonde').status, ScribeReplay.Status.Reported);
  });

  const hairPin = Object.freeze({
    type: ScribeLogCore.Ruling.Pin,
    subject: 'S1',
    category: 'hair',
    target: null,
    hidden: false,
  });

  /**
   * @param {object} state
   * @returns {Array<[string, string]>}
   */
  const hairIn = (state) => {
    return state.facts.filter((fact) => fact.category === 'hair').map((fact) => [fact.text, fact.status]);
  };

  it('lets a later decided value win over an older Pin of the same slot', () => {
    const { log } = buildCastLog();
    rule(log, { ...decidedHair, text: 'black' });
    rule(log, { ...hairPin, text: 'black' });
    const state = rule(log, { ...decidedHair, text: 'white' });

    assert.deepEqual(hairIn(state), [
      ['black', ScribeReplay.Status.Reported],
      ['white', ScribeReplay.Status.InForce],
    ]);
  });

  it('lets a Pin newer than every decided value win over the card value', () => {
    const { log } = buildCastLog();
    rule(log, { ...decidedHair, text: 'black' });
    const state = rule(log, { ...hairPin, text: 'red' });

    assert.equal(factNamed(state, 'red').status, ScribeReplay.Status.InForce);
    assert.equal(factNamed(state, 'black').status, ScribeReplay.Status.Disputed);
  });

  it('lets a decided value win over an older Pin of another value', () => {
    const { log } = buildCastLog();
    rule(log, { ...hairPin, text: 'red' });
    const state = rule(log, { ...decidedHair, text: 'black' });

    assert.deepEqual(hairIn(state), [['black', ScribeReplay.Status.InForce]]);
  });

  it('keeps the Pin behaviour when the slot holds no decided value', () => {
    const { log } = buildCastLog();
    const { decided, ...undecided } = decidedHair;
    assert.equal(decided, true);
    rule(log, { ...undecided, text: 'brown' });
    rule(log, { ...undecided, text: 'grey' });
    const state = rule(log, { ...hairPin, text: 'grey' });

    assert.equal(factNamed(state, 'grey').status, ScribeReplay.Status.InForce);
    assert.equal(factNamed(state, 'grey').pinned, true);
    assert.equal(factNamed(state, 'brown').status, ScribeReplay.Status.Disputed);
  });

  it('settles the order of an edit against a later subject merge with the edit entry, not the first entry', () => {
    const { log } = buildCastLog();
    rule(log, { ...decidedHair, text: 'red' });
    rule(log, { ...decidedHair, text: 'black', subject: 'S2' });
    let state = ScribeReplay.run(log, []);
    ScribeLogCore.rule(log, state, {
      type: ScribeLogCore.Ruling.EditFact,
      fact: factNamed(state, 'red').id,
      text: 'auburn',
      expected: ScribeLogCore.editExpected(factNamed(state, 'red')),
    });
    state = rule(log, { type: ScribeLogCore.Ruling.Merge, from: 'S2', into: 'S1' });

    assert.deepEqual(hairIn(state), [
      ['auburn', ScribeReplay.Status.InForce],
      ['black', ScribeReplay.Status.Reported],
    ]);
  });

  it('keeps the build slot of one form apart from the card build and drops the word-derived dimension', () => {
    const { log } = buildCastLog();
    const build = { ...decidedHair, category: 'build' };
    const { decided, ...undecided } = build;
    assert.equal(decided, true);
    rule(log, { ...undecided, text: 'dragon form: 60 feet long' });
    rule(log, { ...undecided, text: 'slim and athletic' });
    rule(log, { ...undecided, text: 'tall with curvy figure' });
    const state = rule(log, { ...build, text: 'average height; stocky' });
    const statuses = Object.fromEntries(state.facts.map((fact) => [fact.text, fact.status]));

    assert.deepEqual(statuses, {
      'dragon form: 60 feet long': ScribeReplay.Status.InForce,
      'slim and athletic': ScribeReplay.Status.Reported,
      'tall with curvy figure': ScribeReplay.Status.Reported,
      'average height; stocky': ScribeReplay.Status.InForce,
    });
  });

  it('reports a model-written build with the word tall beside the card build', () => {
    const { log } = buildCastLog();
    const state = rule(log, { ...decidedHair, category: 'build', text: 'slim' });
    const becomes = ScribeLogCore.nextFactId(log);
    log.entries.push({
      sequence: log.nextSequence,
      kind: ScribeLogCore.Kind.Update,
      origin: ScribeLogCore.Origin.Story,
      messageIds: ['msg-1'],
      operations: [
        {
          type: ScribeAnswer.Type.Fact,
          fact: becomes,
          subject: 'S1',
          label: 'Ilse Marrow',
          category: 'build',
          target: null,
          targetText: null,
          other: null,
          text: 'She is very tall',
          cite: 'msg-1',
          position: 1,
          hidden: false,
        },
      ],
      withdrawn: false,
    });
    log.read['msg-1'] = log.nextSequence;
    log.nextSequence += 1;
    log.revision += 1;

    const replayed = ScribeReplay.run(log, [{ id: 'msg-1', position: 1 }]);
    assert.equal(factNamed(state, 'slim').status, ScribeReplay.Status.InForce);
    assert.equal(factNamed(replayed, 'slim').status, ScribeReplay.Status.InForce);
    assert.equal(factNamed(replayed, 'She is very tall').status, ScribeReplay.Status.Reported);
  });

  it('accepts exactly the unknown value besides worded text in an AddFact', () => {
    const { state } = buildCastLog();
    const view = ScribeLogCore.view(state);
    for (const [text, expected] of [
      ['?', null],
      ['red', null],
      ['??', ScribeLogCore.Settings.InvalidOperation],
      ['-', ScribeLogCore.Settings.InvalidOperation],
      ['...', ScribeLogCore.Settings.InvalidOperation],
      ['', ScribeLogCore.Settings.InvalidOperation],
    ]) {
      const outcome = { counters: { nextFact: 1 }, stored: null };
      assert.equal(ScribeLogCore.Rulers.AddFact({ ...decidedHair, text }, view, outcome), expected, text);
    }
  });

  it('removes a fact exactly without striking the wording of other facts', () => {
    const { log } = buildCastLog();
    const { decided, ...undecided } = decidedHair;
    assert.equal(decided, true);
    const feature = { ...undecided, category: 'feature' };
    let state = rule(log, { ...feature, text: 'freckles' });
    ScribeLogCore.rule(log, state, {
      type: ScribeLogCore.Ruling.RemoveFact,
      fact: factNamed(state, 'freckles').id,
      exact: true,
    });
    assert.equal(log.entries.at(-1).operations[0].exact, true);
    state = rule(log, { ...feature, text: 'Freckles' });
    assert.equal(factNamed(state, 'Freckles').status, ScribeReplay.Status.InForce);
    assert.equal(factNamed(state, 'freckles').status, ScribeReplay.Status.Removed);
    for (const exact of [false, 'yes', 1, null]) {
      assert.throws(
        () => ScribeLogCore.rule(log, state, { type: ScribeLogCore.Ruling.RemoveFact, fact: factNamed(state, 'Freckles').id, exact }),
        /InvalidOperation/,
        String(exact),
      );
    }
  });
});

describe('Card filing into the book', () => {
  /**
   * @returns {{store: SqliteStore, campaign: object, rowan: object, mara: object, campaignId: string, service: ScribeService, card: CharacterCard}}
   * @throws {Error}
   */
  const createCardWorld = () => {
    const { store, campaign, rowan, mara } = createSeededCampaign();
    const service = new ScribeService({ store });
    const loaded = service.loadState(campaign.id);
    ScribeLogCore.syncCharacterSubject(loaded.log, loaded.state, { subjectId: 'S2', name: 'Mara' });
    store.saveScribeBook(campaign.id, { bookJson: JSON.stringify(loaded.log), lastTurnSeq: 0 });
    return { store, campaign, rowan, mara, campaignId: campaign.id, service, card: CharacterCard.empty() };
  };

  /**
   * @param {{store: SqliteStore, campaign: object, rowan: object, mara: object, campaignId: string, service: ScribeService}} world
   * @param {ReadonlyArray<object>} operations
   * @returns {void}
   * @throws {Error}
   */
  const addStory = (world, operations) => {
    const sceneNumber = loadBook(world).turns.length + 1;
    const pair = world.store.commitTurnPair({
      campaignId: world.campaignId,
      userTurn: { mode: TurnMode.Normal, rawText: 'Go on.', sceneNumber, witnessIds: [world.rowan.id, world.mara.id] },
      userBeat: { speakerType: SpeakerType.Player, characterId: world.rowan.id, speakerName: world.rowan.name, text: 'Go on.' },
      assistantTurn: { mode: TurnMode.Normal, rawText: 'Mara waits.', sceneNumber, witnessIds: [world.rowan.id, world.mara.id] },
      assistantBeats: [
        { speakerType: SpeakerType.Character, characterId: world.mara.id, speakerName: world.mara.name, text: 'Mara waits.' },
      ],
      nextSceneState: { ...world.campaign.sceneState, sceneNumber },
    });
    changeBook(world, ({ log }) => {
      log.entries.push({
        sequence: log.nextSequence,
        kind: ScribeLogCore.Kind.Update,
        origin: ScribeLogCore.Origin.Story,
        messageIds: [pair.assistantTurn.id],
        operations: operations.map((operation) => ({
          subject: 'S2',
          label: 'Mara',
          target: null,
          targetText: null,
          other: null,
          hidden: false,
          cite: pair.assistantTurn.id,
          position: pair.assistantTurn.seq,
          ...(operation.type === ScribeAnswer.Type.Refine
            ? { becomes: ScribeLogCore.nextFactId(log) }
            : { fact: ScribeLogCore.nextFactId(log) }),
          ...operation,
        })),
        withdrawn: false,
      });
      log.read[pair.assistantTurn.id] = log.nextSequence;
      log.nextSequence += 1;
      log.revision += 1;
    });
  };

  /**
   * @param {{service: ScribeService, campaignId: string, card: CharacterCard}} world
   * @param {Record<string, unknown>} fields
   * @returns {CharacterCard}
   * @throws {Error}
   */
  const saveCard = (world, fields) => {
    const after = CharacterCard.fromObject({ ...world.card.toObject(), ...fields });
    world.card = world.service.fileCardAppearance({
      campaignId: world.campaignId,
      subjectId: 'S2',
      before: world.card,
      after,
    });
    return world.card;
  };

  /**
   * @param {{service: ScribeService, campaignId: string}} world
   * @returns {object}
   * @throws {Error}
   */
  const loadBook = (world) => world.service.loadState(world.campaignId);

  /**
   * @param {{service: ScribeService, store: SqliteStore, campaignId: string}} world
   * @param {(loaded: object) => void} change
   * @returns {void}
   * @throws {Error}
   */
  const changeBook = (world, change) => {
    const loaded = loadBook(world);
    change(loaded);
    world.store.saveScribeBook(world.campaignId, { bookJson: JSON.stringify(loaded.log), lastTurnSeq: 0 });
  };

  /**
   * @param {{service: ScribeService, store: SqliteStore, campaignId: string}} world
   * @param {Record<string, unknown>} fields
   * @returns {void}
   * @throws {Error}
   */
  const addOperatorFact = (world, fields) => {
    changeBook(world, ({ log, state }) => {
      ScribeLogCore.rule(log, state, {
        type: ScribeLogCore.Ruling.AddFact,
        subject: 'S2',
        target: null,
        hidden: false,
        cite: null,
        position: 0,
        ...fields,
      });
    });
  };

  /**
   * @param {object} state
   * @param {string} category
   * @returns {Array<[string, string]>}
   */
  const factsIn = (state, category) => {
    return state.facts
      .filter((fact) => fact.subject === 'S2' && fact.category === category)
      .map((fact) => [fact.text, fact.status]);
  };

  /**
   * @param {object} log
   * @param {string} type
   * @returns {Array<object>}
   */
  const operationsOf = (log, type) => log.entries.flatMap((entry) => entry.operations).filter((op) => op.type === type);

  const { InForce, Reported, Removed } = ScribeReplay.Status;
  const fullCard = Object.freeze({
    age: '29',
    hair: 'red',
    eyes: 'green',
    height: "5'6",
    body: 'slim',
    face: 'freckled',
    features: 'a scar',
  });

  it('files the seven appearance values as six facts, combines build, and decides only the fixed ones', () => {
    const world = createCardWorld();
    const card = saveCard(world, fullCard);
    const { state, log } = loadBook(world);

    assert.deepEqual(
      state.facts.filter((fact) => fact.subject === 'S2').map((fact) => [fact.category, fact.text, fact.status]),
      [
        ['age', '29', InForce],
        ['hair', 'red', InForce],
        ['eyes', 'green', InForce],
        ['build', "5'6; slim", InForce],
        ['appearance', 'freckled', InForce],
        ['feature', 'a scar', InForce],
      ],
    );
    const added = operationsOf(log, ScribeLogCore.Ruling.AddFact);
    assert.deepEqual(
      added.map((op) => [op.category, op.decided === true, op.position, op.cite, op.hidden, op.target]),
      [
        ['age', true, 0, null, false, null],
        ['hair', true, 0, null, false, null],
        ['eyes', true, 0, null, false, null],
        ['build', true, 0, null, false, null],
        ['appearance', false, 0, null, false, null],
        ['feature', false, 0, null, false, null],
      ],
    );
    assert.deepEqual(card.filedFactIds, {
      face: added.find((op) => op.category === 'appearance').fact,
      features: added.find((op) => op.category === 'feature').fact,
    });
    assert.deepEqual(world.service.bookAppearance({ state, subjectId: 'S2' }), {
      age: '29',
      hair: 'red',
      eyes: 'green',
      build: "5'6; slim",
      face: 'freckled',
      features: 'a scar',
    });
  });

  it('puts the card hair in force over an undecided operator hair and reports the old value', () => {
    const world = createCardWorld();
    addOperatorFact(world, { category: 'hair', text: 'brown' });
    assert.deepEqual(factsIn(loadBook(world).state, 'hair'), [['brown', InForce]]);

    saveCard(world, { hair: 'red' });
    assert.deepEqual(factsIn(loadBook(world).state, 'hair'), [['brown', Reported], ['red', InForce]]);
  });

  it('files only the changed field on a second save and reports the first card value', () => {
    const world = createCardWorld();
    saveCard(world, fullCard);
    const before = loadBook(world);
    const idsBefore = before.state.facts.map((fact) => fact.id);

    saveCard(world, { hair: 'black' });
    const after = loadBook(world);
    const added = operationsOf(after.log, ScribeLogCore.Ruling.AddFact);
    assert.equal(added.length, 7);
    assert.equal(added.at(-1).category, 'hair');
    assert.equal(after.log.revision, before.log.revision + 1);
    assert.deepEqual(factsIn(after.state, 'hair'), [['red', Reported], ['black', InForce]]);
    assert.deepEqual(after.state.facts.slice(0, idsBefore.length).map((fact) => fact.id), idsBefore);
    for (const category of ['age', 'eyes', 'build', 'appearance', 'feature']) {
      assert.equal(factsIn(after.state, category).length, 1, category);
    }
  });

  it('files nothing when no appearance field changed, whitespace differences and other card fields included', () => {
    const world = createCardWorld();
    saveCard(world, { hair: 'red' });
    const revision = loadBook(world).log.revision;

    saveCard(world, { hair: 'red' });
    saveCard(world, { hair: '  red ' });
    saveCard(world, { traits: 'bold', personalitySummary: 'Quick.' });
    assert.equal(loadBook(world).log.revision, revision);
    assert.equal(operationsOf(loadBook(world).log, ScribeLogCore.Ruling.AddFact).length, 1);
  });

  it('lets a later card save win over an operator edit of the card value, and an earlier edit lose to the card', () => {
    const world = createCardWorld();
    addOperatorFact(world, { category: 'hair', text: 'brown' });
    changeBook(world, ({ log, state }) => {
      const fact = state.facts.find((item) => item.text === 'brown');
      ScribeLogCore.rule(log, state, {
        type: ScribeLogCore.Ruling.EditFact,
        fact: fact.id,
        text: 'chestnut',
        expected: ScribeLogCore.editExpected(fact),
      });
    });
    assert.deepEqual(factsIn(loadBook(world).state, 'hair'), [['chestnut', InForce]]);

    saveCard(world, { hair: 'red' });
    assert.deepEqual(factsIn(loadBook(world).state, 'hair'), [['chestnut', Reported], ['red', InForce]]);

    changeBook(world, ({ log, state }) => {
      const fact = state.facts.find((item) => item.text === 'red');
      ScribeLogCore.rule(log, state, {
        type: ScribeLogCore.Ruling.EditFact,
        fact: fact.id,
        text: 'auburn',
        expected: ScribeLogCore.editExpected(fact),
      });
    });
    assert.deepEqual(factsIn(loadBook(world).state, 'hair'), [['chestnut', Reported], ['auburn', InForce]]);

    saveCard(world, { hair: 'black' });
    assert.deepEqual(
      factsIn(loadBook(world).state, 'hair'),
      [['chestnut', Reported], ['auburn', Reported], ['black', InForce]],
    );
  });

  it('keeps the card value in force when a model-written Change of the hair comes from the story', () => {
    const world = createCardWorld();
    saveCard(world, { hair: 'red' });
    const { log, state } = loadBook(world);
    const card = state.facts.find((fact) => fact.text === 'red');
    log.entries.push({
      sequence: log.nextSequence,
      kind: ScribeLogCore.Kind.Update,
      origin: ScribeLogCore.Origin.Story,
      messageIds: ['msg-1'],
      operations: [
        {
          type: ScribeAnswer.Type.Change,
          fact: card.id,
          becomes: ScribeLogCore.nextFactId(log),
          subject: 'S2',
          label: 'Mara',
          category: 'hair',
          target: null,
          targetText: null,
          other: null,
          text: 'blonde',
          cite: 'msg-1',
          position: 1,
          hidden: false,
        },
      ],
      withdrawn: false,
    });
    log.read['msg-1'] = log.nextSequence;
    log.nextSequence += 1;
    log.revision += 1;

    const replayed = ScribeReplay.run(log, [{ id: 'msg-1', position: 1 }]);
    assert.deepEqual(factsIn(replayed, 'hair'), [['red', InForce], ['blonde', Reported]]);
    assert.deepEqual(world.service.bookAppearance({ state: replayed, subjectId: 'S2' }), { hair: 'red' });
  });

  it('keeps exactly one card-filed feature when features change twice, and leaves other features alone', () => {
    const world = createCardWorld();
    saveCard(world, { features: 'a scar' });
    addOperatorFact(world, { category: 'feature', text: 'a tattoo' });
    saveCard(world, { features: 'a scar; a burn' });
    const second = world.card.filedFactIds.features;
    saveCard(world, { features: 'a burn' });

    const { state } = loadBook(world);
    assert.deepEqual(factsIn(state, 'feature'), [
      ['a scar', Removed],
      ['a tattoo', InForce],
      ['a scar; a burn', Removed],
      ['a burn', InForce],
    ]);
    assert.notEqual(world.card.filedFactIds.features, second);
    assert.equal(state.facts.find((fact) => fact.id === world.card.filedFactIds.features).text, 'a burn');
    assert.deepEqual(world.service.bookAppearance({ state, subjectId: 'S2' }), {
      features: 'a tattoo; a burn',
    });
  });

  it('files the new feature without an error when the remembered fact was removed in the Book tab', () => {
    const world = createCardWorld();
    saveCard(world, { features: 'a scar' });
    const removed = world.card.filedFactIds.features;
    changeBook(world, ({ log, state }) => {
      ScribeLogCore.rule(log, state, { type: ScribeLogCore.Ruling.RemoveFact, fact: removed });
    });
    const removals = operationsOf(loadBook(world).log, ScribeLogCore.Ruling.RemoveFact).length;

    saveCard(world, { features: 'a burn' });
    const { state, log } = loadBook(world);
    assert.deepEqual(factsIn(state, 'feature'), [['a scar', Removed], ['a burn', InForce]]);
    assert.equal(operationsOf(log, ScribeLogCore.Ruling.RemoveFact).length, removals);
    assert.notEqual(world.card.filedFactIds.features, removed);
    assert.equal(state.facts.find((fact) => fact.id === world.card.filedFactIds.features).text, 'a burn');
  });

  it('removes the remembered feature and its key when features is cleared, and drops a stale key too', () => {
    const world = createCardWorld();
    saveCard(world, { features: 'a scar', face: 'freckled' });
    assert.deepEqual(Object.keys(world.card.filedFactIds).sort(), ['face', 'features']);

    saveCard(world, { features: '' });
    const { state } = loadBook(world);
    assert.deepEqual(factsIn(state, 'feature'), [['a scar', Removed]]);
    assert.deepEqual(Object.keys(world.card.filedFactIds), ['face']);
    assert.equal(Object.hasOwn(world.service.bookAppearance({ state, subjectId: 'S2' }), 'features'), false);

    saveCard(world, { face: 'pale' });
    changeBook(world, ({ log, state: current }) => {
      ScribeLogCore.rule(log, current, { type: ScribeLogCore.Ruling.RemoveFact, fact: world.card.filedFactIds.face });
    });
    const revision = loadBook(world).log.revision;
    saveCard(world, { face: '' });
    assert.equal(loadBook(world).log.revision, revision);
    assert.deepEqual(world.card.filedFactIds, {});
  });

  it('files nothing and keeps the book hair when hair is cleared', () => {
    const world = createCardWorld();
    saveCard(world, { hair: 'red', age: '29' });
    const revision = loadBook(world).log.revision;

    saveCard(world, { hair: '' });
    const { state, log } = loadBook(world);
    assert.equal(log.revision, revision);
    assert.deepEqual(factsIn(state, 'hair'), [['red', InForce]]);
    assert.equal(world.card.hair, '');
  });

  it('files the height alone when body is empty, the body alone when height is empty, and nothing when both are empty', () => {
    const world = createCardWorld();
    saveCard(world, { height: "5'6" });
    assert.deepEqual(factsIn(loadBook(world).state, 'build'), [["5'6", InForce]]);

    saveCard(world, { height: '' });
    const revision = loadBook(world).log.revision;
    assert.deepEqual(factsIn(loadBook(world).state, 'build'), [["5'6", InForce]]);
    assert.equal(operationsOf(loadBook(world).log, ScribeLogCore.Ruling.AddFact).length, 1);

    saveCard(world, { body: 'slim' });
    assert.deepEqual(factsIn(loadBook(world).state, 'build'), [["5'6", Reported], ['slim', InForce]]);

    saveCard(world, { height: "5'7" });
    assert.deepEqual(
      factsIn(loadBook(world).state, 'build'),
      [["5'6", Reported], ['slim', Reported], ["5'7; slim", InForce]],
    );
    assert.equal(loadBook(world).log.revision, revision + 2);

    const empty = createCardWorld();
    saveCard(empty, { height: '  ', body: '' });
    assert.equal(operationsOf(loadBook(empty).log, ScribeLogCore.Ruling.AddFact).length, 0);
  });

  it('builds the filing steps as card-position, public, uncited operator facts with decided only on fixed slots', () => {
    const { state } = loadBook(createCardWorld());
    const steps = CardFiling.operations({
      state,
      subjectId: 'S2',
      before: CharacterCard.empty(),
      after: CharacterCard.fromObject({ hair: ' red ', face: 'pale', height: '6 ft' }),
    });
    const type = ScribeLogCore.Ruling.AddFact;
    assert.deepEqual(steps.map((step) => step.field), ['hair', 'build', 'face']);
    assert.deepEqual(steps.map((step) => step.operation), [
      { type, subject: 'S2', category: 'hair', target: null, text: 'red', hidden: false, cite: null, position: 0, decided: true },
      { type, subject: 'S2', category: 'build', target: null, text: '6 ft', hidden: false, cite: null, position: 0, decided: true },
      { type, subject: 'S2', category: 'appearance', target: null, text: 'pale', hidden: false, cite: null, position: 0 },
    ]);
    assert.deepEqual(CardFiling.changedFields(CharacterCard.empty(), CharacterCard.fromObject({ hair: ' ', eyes: 'x' })), ['eyes']);
  });

  it('refuses a save whose subject is unknown and leaves the stored book as it was', () => {
    const world = createCardWorld();
    const revision = loadBook(world).log.revision;
    assert.throws(
      () => world.service.fileCardAppearance({
        campaignId: world.campaignId,
        subjectId: 'S99',
        before: CharacterCard.empty(),
        after: CharacterCard.fromObject({ hair: 'red', eyes: 'green' }),
      }),
      /Reference/,
    );
    assert.equal(loadBook(world).log.revision, revision);
  });

  it('joins two in-force features with a semicolon and leaves out Reported values in bookAppearance', () => {
    const world = createCardWorld();
    addOperatorFact(world, { category: 'feature', text: 'a scar' });
    addOperatorFact(world, { category: 'feature', text: 'a tattoo' });
    addOperatorFact(world, { category: 'hair', text: 'red', decided: true });
    addOperatorFact(world, { category: 'hair', text: 'black', decided: true });
    const { state } = loadBook(world);

    assert.deepEqual(world.service.bookAppearance({ state, subjectId: 'S2' }), {
      hair: 'black',
      features: 'a scar; a tattoo',
    });
    assert.deepEqual(world.service.bookAppearance({ state, subjectId: 'S4' }), {});
  });

  it('puts the card build in force over imported builds even when a word like tall scopes them', () => {
    const world = createCardWorld();
    addOperatorFact(world, { category: 'build', text: 'slim and athletic' });
    addOperatorFact(world, { category: 'build', text: 'tall with curvy figure' });
    saveCard(world, { height: 'average height', body: 'stocky' });

    assert.deepEqual(factsIn(loadBook(world).state, 'build'), [
      ['slim and athletic', Reported],
      ['tall with curvy figure', Reported],
      ['average height; stocky', InForce],
    ]);
  });

  it('keeps only the newer card build in force when the second one contains tall or long', () => {
    const world = createCardWorld();
    saveCard(world, { height: "5'6\"", body: 'slim' });
    saveCard(world, { height: 'tall' });
    let { state } = loadBook(world);
    assert.deepEqual(factsIn(state, 'build'), [["5'6\"; slim", Reported], ['tall; slim', InForce]]);
    assert.equal(world.service.bookAppearance({ state, subjectId: 'S2' }).build, 'tall; slim');

    saveCard(world, { body: 'long-legged and lean' });
    ({ state } = loadBook(world));
    assert.deepEqual(factsIn(state, 'build').map(([, status]) => status), [Reported, Reported, InForce]);
    assert.equal(world.service.bookAppearance({ state, subjectId: 'S2' }).build, 'tall; long-legged and lean');
  });

  it('files an unknown card value as the unknown value and keeps it in force', () => {
    const world = createCardWorld();
    saveCard(world, { age: '-', hair: '...', features: '~' });

    const { state } = loadBook(world);
    assert.deepEqual(factsIn(state, 'age'), [['?', InForce]]);
    assert.deepEqual(factsIn(state, 'hair'), [['?', InForce]]);
    assert.deepEqual(factsIn(state, 'feature'), [['?', InForce]]);
    assert.deepEqual(world.service.bookAppearance({ state, subjectId: 'S2' }), { age: '?', hair: '?', features: '?' });
    assert.equal(world.card.age, '?');
  });

  it('keeps a story fact with the same wording when the card replaces its own value, now and later', () => {
    const world = createCardWorld();
    saveCard(world, { features: 'freckles' });
    addStory(world, [{ type: ScribeAnswer.Type.Fact, category: 'feature', text: 'Freckles' }]);
    saveCard(world, { features: 'a tattoo' });
    addStory(world, [{ type: ScribeAnswer.Type.Fact, category: 'feature', text: 'freckles' }]);

    assert.deepEqual(factsIn(loadBook(world).state, 'feature'), [
      ['freckles', Removed],
      ['a tattoo', InForce],
      ['Freckles', InForce],
      ['freckles', InForce],
    ]);
  });

  it('replaces a card feature the story refined, following the refinement to its current fact', () => {
    const world = createCardWorld();
    saveCard(world, { features: 'a scar on her cheek' });
    addStory(world, [
      {
        type: ScribeAnswer.Type.Refine,
        fact: world.card.filedFactIds.features,
        category: 'feature',
        text: 'a long sword scar on her left cheek',
      },
    ]);
    assert.deepEqual(factsIn(loadBook(world).state, 'feature'), [
      ['a scar on her cheek', ScribeReplay.Status.Replaced],
      ['a long sword scar on her left cheek', InForce],
    ]);

    saveCard(world, { features: 'no scars' });
    assert.deepEqual(factsIn(loadBook(world).state, 'feature'), [
      ['a scar on her cheek', Removed],
      ['no scars', InForce],
      ['a long sword scar on her left cheek', Removed],
    ]);
    assert.equal(
      loadBook(world).state.facts.find((fact) => fact.id === world.card.filedFactIds.features).text,
      'no scars',
    );
  });

  it('does not file a card list value that a live fact of the subject already holds, and does not adopt it', () => {
    const world = createCardWorld();
    addOperatorFact(world, { category: 'feature', text: 'a scar' });
    saveCard(world, { features: 'a scar' });

    assert.deepEqual(factsIn(loadBook(world).state, 'feature'), [['a scar', InForce]]);
    assert.deepEqual(world.card.filedFactIds, {});
    assert.equal(operationsOf(loadBook(world).log, ScribeLogCore.Ruling.AddFact).length, 1);
  });

  it('replaces its own fact with a differently written value of the same wording', () => {
    const world = createCardWorld();
    saveCard(world, { features: 'a scar' });
    saveCard(world, { features: 'A SCAR' });

    assert.deepEqual(factsIn(loadBook(world).state, 'feature'), [['a scar', Removed], ['A SCAR', InForce]]);
    assert.equal(
      loadBook(world).state.facts.find((fact) => fact.id === world.card.filedFactIds.features).text,
      'A SCAR',
    );
  });

  it('replaces its own fact after the card subject was merged into another subject', () => {
    const world = createCardWorld();
    saveCard(world, { features: 'a scar' });
    changeBook(world, ({ log, state }) => {
      ScribeLogCore.syncCharacterSubject(log, state, { subjectId: 'S3', name: 'Vesper' });
    });
    changeBook(world, ({ log, state }) => {
      ScribeLogCore.rule(log, state, { type: ScribeLogCore.Ruling.Merge, from: 'S2', into: 'S3' });
    });

    saveCard(world, { features: 'a burn' });
    const { state } = loadBook(world);
    assert.deepEqual(
      state.facts.filter((fact) => fact.category === 'feature').map((fact) => [fact.text, fact.subject, fact.status]),
      [['a scar', 'S3', Removed], ['a burn', 'S3', InForce]],
    );
  });

  it('leaves a remembered fact the story ended as it is and files the new value beside it', () => {
    const world = createCardWorld();
    saveCard(world, { features: 'a scar' });
    addStory(world, [{ type: ScribeAnswer.Type.End, fact: world.card.filedFactIds.features, reason: 'healed' }]);
    assert.deepEqual(factsIn(loadBook(world).state, 'feature'), [['a scar', ScribeReplay.Status.Ended]]);

    saveCard(world, { features: 'a burn' });
    assert.deepEqual(factsIn(loadBook(world).state, 'feature'), [
      ['a scar', ScribeReplay.Status.Ended],
      ['a burn', InForce],
    ]);
  });

  it('removes a remembered fact only while it still belongs to this subject', () => {
    const world = createCardWorld();
    saveCard(world, { features: 'a scar' });
    const remembered = world.card.filedFactIds.features;
    changeBook(world, ({ log, state }) => {
      ScribeLogCore.rule(log, state, {
        type: ScribeLogCore.Ruling.Split,
        subject: 'S2',
        label: 'Mara Shade',
        kind: ScribeCategory.SubjectKinds.Character,
        facts: [remembered],
      });
    });
    assert.notEqual(loadBook(world).state.facts.find((fact) => fact.id === remembered).subject, 'S2');

    saveCard(world, { features: 'a burn' });
    const { state } = loadBook(world);
    const split = state.facts.find((fact) => fact.id === remembered);
    assert.equal(split.status, InForce);
    assert.notEqual(split.subject, 'S2');
    assert.deepEqual(factsIn(state, 'feature'), [['a burn', InForce]]);
  });

  it('shows an unknown fact value as unknown in a Scribe statement and in the Pedant ledger', async () => {
    const world = createCardWorld();
    saveCard(world, { age: '?', hair: 'red' });
    const { state } = loadBook(world);
    const unknownFact = state.facts.find((fact) => fact.category === 'age');
    const statement = ScribeAnalyzer.statement(unknownFact, ScribeAnalyzer.labels(state));
    assert.match(statement, /^age: unknown/);

    const pair = world.store.commitTurnPair({
      campaignId: world.campaignId,
      userTurn: { mode: TurnMode.Normal, rawText: 'Well?', sceneNumber: 1, witnessIds: [world.rowan.id, world.mara.id] },
      userBeat: { speakerType: SpeakerType.Player, characterId: world.rowan.id, speakerName: world.rowan.name, text: 'Well?' },
      assistantTurn: { mode: TurnMode.Normal, rawText: 'Mara nods.', sceneNumber: 1, witnessIds: [world.rowan.id, world.mara.id] },
      assistantBeats: [
        { speakerType: SpeakerType.Character, characterId: world.mara.id, speakerName: world.mara.name, text: 'I am here.' },
      ],
      nextSceneState: world.campaign.sceneState,
    });
    let ledgerPrompt = '';
    const { client } = createFakeClient([
      (payload) => {
        ledgerPrompt = payload.messages[1].content;
        return '=== CONTRADICTIONS\n(none)';
      },
    ], { store: world.store });
    const pedantService = new PedantService({ store: world.store, client, scribeService: world.service });
    await pedantService.checkTurn({ campaignId: world.campaignId, turn: pair.assistantTurn });

    assert.match(ledgerPrompt, /F\d+ \| Mara \| age \| unknown/);
    assert.doesNotMatch(ledgerPrompt, /\| age \| \?/);
  });

  it('turns every text field of a card that has no letter or digit into the unknown value, except speech examples', () => {
    const card = CharacterCard.fromObject({
      age: '-',
      hair: '  ...  ',
      eyes: '',
      body: '   ',
      traits: 'bold',
      scenario: '?',
      speechExamples: ['...', '-'],
    });

    assert.equal(card.age, CharacterCard.Unknown);
    assert.equal(card.hair, CharacterCard.Unknown);
    assert.equal(card.scenario, CharacterCard.Unknown);
    assert.equal(card.eyes, '');
    assert.equal(card.body, '   ');
    assert.equal(card.traits, 'bold');
    assert.deepEqual(card.speechExamples, ['...', '-']);
    assert.equal(CharacterCard.fromObject(card.toObject()).age, '?');
    assert.equal(CharacterCard.requestValue(' ? '), CharacterCard.UnknownLabel);
    assert.equal(CharacterCard.requestValue('?!'), '?!');
  });
});

