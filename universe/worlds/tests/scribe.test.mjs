import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { OpenRouterClient } from '../src/openrouter/OpenRouterClient.mjs';
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
 */
function createFakeClient(responses, { store = null } = {}) {
  const queue = [...responses];
  const calls = [];
  const client = new OpenRouterClient({
    apiKeyProvider: () => 'sk-test-fake-scribe-key',
    onSpend: store === null ? null : (spendDto) => store.recordSpend(spendDto),
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
    assert.equal(files.length, 11);
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
        apiKeyProvider: () => 'sk-test-fake-scribe-key',
        onSpend: (spendDto) => store.recordSpend(spendDto),
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
        apiKeyProvider: () => 'sk-test-fake-scribe-key',
        onSpend: (spendDto) => store.recordSpend(spendDto),
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
