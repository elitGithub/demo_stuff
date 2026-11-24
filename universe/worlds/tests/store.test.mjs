import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';
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

const tempDirs = [];

/**
 * @param {string} location
 * @param {number} sceneNumber
 * @param {Array<string>} presentIds
 * @param {Array<string>} remoteIds
 * @returns {object}
 */
function buildSceneState(location, sceneNumber, presentIds, remoteIds = []) {
  return {
    sceneNumber,
    day: 1,
    timeLabel: 'Evening',
    location,
    sceneType: SceneType.Public,
    presentIds,
    remoteIds,
    offscreenNotes: {},
    activeWalkOns: [],
  };
}

after(() => {
  for (const tempDir of tempDirs) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('Store enums', () => {
  it('freezes all enums, labels valid values, and throws RangeError on invalid values', () => {
    const enumEntries = [
      { enumObject: CharacterTier, expectedCases: ['main', 'recurring'] },
      { enumObject: AvatarToken, expectedCases: ['sage', 'rose', 'amber', 'slate', 'plum', 'teal', 'indigo', 'coral'] },
      { enumObject: TurnRole, expectedCases: ['user', 'assistant'] },
      { enumObject: TurnMode, expectedCases: ['normal', 'narrator', 'encounter'] },
      { enumObject: SpeakerType, expectedCases: ['narrator', 'character', 'player'] },
      { enumObject: SceneType, expectedCases: ['public', 'private'] },
      { enumObject: FindingKind, expectedCases: ['contradiction', 'secret_leak', 'name_mismatch'] },
      { enumObject: FindingStatus, expectedCases: ['open', 'dismissed', 'ruled', 'told'] },
      { enumObject: SpendStage, expectedCases: ['director', 'mind', 'composer', 'scribe', 'pedant', 'muse'] },
    ];

    for (const entry of enumEntries) {
      assert.equal(Object.isFrozen(entry.enumObject), true);
      for (const caseValue of entry.expectedCases) {
        const label = entry.enumObject.label(caseValue);
        assert.equal(typeof label, 'string');
        assert.ok(label.length > 0);
      }
      assert.throws(() => entry.enumObject.label('invalid_case'), RangeError);
      assert.throws(() => entry.enumObject.label('toString'), RangeError);
      assert.throws(() => entry.enumObject.label('__proto__'), RangeError);
      assert.throws(() => entry.enumObject.label(null), RangeError);
    }
  });
});

describe('SqliteStore settings and campaigns', () => {
  it('manages settings defaults, ignores undefined keys, and rejects API keys or invalid numbers', () => {
    const store = new SqliteStore(':memory:');
    try {
      assert.equal(store.getLocalChangeSeq(), 0);

      const defaults = store.getSettings();
      assert.deepEqual(defaults, {
        models: { director: '', composer: '', main: '', recurring: '', scribe: '' },
        publicOdds: 8,
        privateOdds: 30,
        scribeInterval: 10,
        pedantEnabled: true,
        dailyWarnUsd: null,
      });

      const updated = store.updateSettings({
        models: { director: 'openrouter/fast', main: 'openrouter/main', composer: undefined },
        publicOdds: 0,
        privateOdds: undefined,
        scribeInterval: 0,
        pedantEnabled: false,
        dailyWarnUsd: 2.5,
      });
      assert.equal(updated.models.director, 'openrouter/fast');
      assert.equal(updated.models.main, 'openrouter/main');
      assert.equal(updated.models.composer, '');
      assert.equal(updated.publicOdds, 0);
      assert.equal(updated.privateOdds, 30);
      assert.equal(updated.scribeInterval, 0);
      assert.equal(updated.pedantEnabled, false);
      assert.equal(updated.dailyWarnUsd, 2.5);
      assert.equal(store.getLocalChangeSeq(), 1);

      const noOpUndefined = store.updateSettings({
        publicOdds: undefined,
        models: { director: undefined },
      });
      assert.equal(noOpUndefined.publicOdds, 0);
      assert.equal(noOpUndefined.models.director, 'openrouter/fast');
      assert.equal(store.getLocalChangeSeq(), 1);

      const secondUpdate = store.updateSettings({ models: { scribe: 'openrouter/scribe' } });
      assert.equal(secondUpdate.models.director, 'openrouter/fast');
      assert.equal(secondUpdate.models.scribe, 'openrouter/scribe');

      assert.throws(() => store.updateSettings({ openRouterApiKey: 'sk-leak' }), RangeError);
      assert.throws(() => store.updateSettings({ publicOdds: -1 }), RangeError);
      assert.throws(() => store.updateSettings({ dailyWarnUsd: Number.NaN }), RangeError);
      assert.throws(() => store.updateSettings({ dailyWarnUsd: -0.01 }), RangeError);
      assert.throws(() => store.updateSettings({ models: { unknown: 'x' } }), RangeError);
    } finally {
      store.close();
    }
  });

  it('paginates campaigns, validates scene state invariants, and deletes campaigns cleanly', () => {
    const store = new SqliteStore(':memory:');
    try {
      store.updateSettings({ publicOdds: 12, privateOdds: 40, scribeInterval: 5 });
      const createdIds = [];
      for (let index = 0; index < 30; index += 1) {
        const campaign = store.createCampaign({
          title: `Chronicle ${index + 1}`,
          premise: 'Fictional frontier tale.',
        });
        assert.equal(campaign.encounterPublicOdds, 12);
        assert.equal(campaign.encounterPrivateOdds, 40);
        assert.equal(campaign.scribeInterval, 5);
        createdIds.push(campaign.id);
      }

      const firstPage = store.listCampaigns({ limit: 20 });
      assert.equal(firstPage.total, 30);
      assert.equal(firstPage.items.length, 20);
      assert.notEqual(firstPage.nextCursor, null);

      const secondPage = store.listCampaigns({ limit: 20, after: firstPage.nextCursor });
      assert.equal(secondPage.total, 30);
      assert.equal(secondPage.items.length, 10);
      assert.equal(secondPage.nextCursor, null);

      const collectedIds = new Set([
        ...firstPage.items.map((item) => item.id),
        ...secondPage.items.map((item) => item.id),
      ]);
      assert.equal(collectedIds.size, 30);

      const targetId = createdIds[0];
      const otherId = createdIds[1];
      const hero = store.createCharacter(targetId, {
        slug: 'rowan',
        name: 'Rowan',
        isPlayer: true,
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Sage,
      });
      const outsider = store.createCharacter(otherId, {
        slug: 'rowan',
        name: 'Rowan Other',
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Rose,
      });

      assert.throws(
        () => store.updateCampaign(targetId, { playerCharacterId: outsider.id }),
        RangeError,
      );
      assert.throws(
        () => store.updateCampaign(targetId, {
          sceneState: buildSceneState('Harbor', 1, [hero.id], [hero.id]),
        }),
        /both present and remote/,
      );
      assert.throws(
        () => store.updateCampaign(targetId, {
          sceneState: buildSceneState('Harbor', 1, [hero.id, hero.id]),
        }),
        /duplicate entry/,
      );
      assert.throws(
        () => store.updateCampaign(targetId, {
          sceneState: { activeWalkOns: ['   '] },
        }),
        /non-empty strings/,
      );

      const updatedTarget = store.updateCampaign(targetId, { playerCharacterId: hero.id });
      assert.equal(updatedTarget.playerCharacterId, hero.id);

      const spendRow = store.recordSpend({
        campaignId: targetId,
        stage: SpendStage.Director,
        model: 'openrouter/director',
        promptTokens: 100,
        completionTokens: 50,
        costUsd: 0.015,
        createdAt: '2026-11-24T12:00:00.000Z',
      });

      store.commitTurnPair({
        campaignId: targetId,
        userTurn: { mode: TurnMode.Normal, rawText: 'Hello.', witnessIds: [hero.id] },
        userBeat: {
          speakerType: SpeakerType.Player,
          characterId: hero.id,
          speakerName: 'Rowan',
          text: 'Hello.',
        },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Wind blows.', witnessIds: [hero.id] },
        assistantBeats: [
          {
            speakerType: SpeakerType.Character,
            characterId: hero.id,
            speakerName: 'Rowan',
            text: 'Silence.',
          },
        ],
        nextSceneState: buildSceneState('Harbor', 1, [hero.id]),
        spendIds: [spendRow.id],
      });

      assert.equal(store.deleteCampaign(targetId), true);
      assert.equal(store.deleteCampaign(targetId), false);
      assert.equal(store.getCampaign(targetId), null);
      assert.deepEqual(store.getDailySpend('2026-11-24'), {
        totalUsd: 0.015,
        unpricedCount: 0,
        callCount: 1,
      });
    } finally {
      store.close();
    }
  });
});

describe('SqliteStore characters and deletion guards', () => {
  it('enforces unique slug per campaign and blocks deleting characters referenced anywhere', () => {
    const store = new SqliteStore(':memory:');
    try {
      const campaignAlpha = store.createCampaign({ title: 'Alpha' });
      const campaignBeta = store.createCampaign({ title: 'Beta' });

      const lyra = store.createCharacter(campaignAlpha.id, {
        slug: 'lyra_01',
        name: 'Lyra Vance',
        aliases: ['Lye'],
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Plum,
      });
      assert.equal(lyra.avatarInitials, 'LV');

      const lyraBeta = store.createCharacter(campaignBeta.id, {
        slug: 'lyra_01',
        name: 'Lyra Twin',
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Teal,
      });
      assert.equal(lyraBeta.slug, 'lyra_01');

      assert.throws(
        () => store.createCharacter(campaignAlpha.id, {
          slug: 'lyra_01',
          name: 'Duplicate Slug',
          tier: CharacterTier.Main,
          avatarToken: AvatarToken.Amber,
        }),
        /UNIQUE constraint failed/,
      );

      const badSlugs = ['', 'Upper', '-dash', '_under', 'has space', 'a'.repeat(49)];
      for (const badSlug of badSlugs) {
        assert.throws(
          () => store.createCharacter(campaignAlpha.id, {
            slug: badSlug,
            name: 'Invalid',
            tier: CharacterTier.Main,
            avatarToken: AvatarToken.Sage,
          }),
          RangeError,
        );
      }

      assert.throws(
        () => store.createCharacter(campaignAlpha.id, {
          slug: 'bram',
          name: 'Bram',
          tier: 'walkon',
          avatarToken: AvatarToken.Sage,
        }),
        RangeError,
      );
      assert.throws(
        () => store.createCharacter(campaignAlpha.id, {
          slug: 'bram',
          name: 'Bram',
          tier: CharacterTier.Main,
          avatarToken: 'neon-pink',
        }),
        RangeError,
      );

      const presentChar = store.createCharacter(campaignAlpha.id, {
        slug: 'corin',
        name: 'Corin',
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Coral,
      });
      const remoteChar = store.createCharacter(campaignAlpha.id, {
        slug: 'mira',
        name: 'Mira',
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Rose,
      });
      const turnWitnessChar = store.createCharacter(campaignAlpha.id, {
        slug: 'dara',
        name: 'Dara',
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Amber,
      });
      const beatWitnessChar = store.createCharacter(campaignAlpha.id, {
        slug: 'owen',
        name: 'Owen',
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Slate,
      });
      const findingSpeakerChar = store.createCharacter(campaignAlpha.id, {
        slug: 'sable',
        name: 'Sable',
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Indigo,
      });
      const unreferenced = store.createCharacter(campaignAlpha.id, {
        slug: 'tessa',
        name: 'Tessa',
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Coral,
      });
      assert.equal(store.deleteCharacter(campaignAlpha.id, unreferenced.id), true);

      const pair = store.commitTurnPair({
        campaignId: campaignAlpha.id,
        userTurn: {
          mode: TurnMode.Narrator,
          rawText: 'Night falls.',
          witnessIds: [turnWitnessChar.id],
        },
        userBeat: {
          speakerType: SpeakerType.Narrator,
          characterId: null,
          speakerName: 'Narrator',
          text: 'Night falls.',
          witnessIds: [],
        },
        assistantTurn: {
          mode: TurnMode.Narrator,
          rawText: 'Lyra nods.',
          witnessIds: [],
        },
        assistantBeats: [
          {
            speakerType: SpeakerType.Character,
            characterId: lyra.id,
            speakerName: 'Lyra Vance',
            text: 'We move at dawn.',
            witnessIds: [beatWitnessChar.id],
          },
        ],
        nextSceneState: buildSceneState('Camp', 1, [presentChar.id], [remoteChar.id]),
      });

      store.insertFindings(campaignAlpha.id, pair.assistantTurn.id, [
        {
          kind: FindingKind.SecretLeak,
          speakerCharacterId: findingSpeakerChar.id,
          summary: 'Spoke about unseen letter.',
        },
      ]);

      const referencedIds = [
        lyra.id,
        presentChar.id,
        remoteChar.id,
        turnWitnessChar.id,
        beatWitnessChar.id,
        findingSpeakerChar.id,
      ];
      for (const referencedId of referencedIds) {
        assert.throws(
          () => store.deleteCharacter(campaignAlpha.id, referencedId),
          /Cannot delete referenced character/,
        );
      }

      const archivedLyra = store.updateCharacter(campaignAlpha.id, lyra.id, { archived: true });
      assert.equal(archivedLyra.archived, true);
      assert.equal(store.listCharacters(campaignAlpha.id).total, 5);
      assert.equal(store.listCharacters(campaignAlpha.id, { includeArchived: true }).total, 6);
    } finally {
      store.close();
    }
  });
});

describe('SqliteStore turns, beat editing, rollback, pagination, and Scribe tracking', () => {
  it('rolls back commitTurnPair completely on beat FK failure or invalid spendIds linking', () => {
    const store = new SqliteStore(':memory:');
    try {
      const initialSceneState = buildSceneState('Courtyard', 1, []);
      const campaign = store.createCampaign({
        title: 'Rollback Proof',
        sceneState: initialSceneState,
      });
      const otherCampaign = store.createCampaign({ title: 'Other' });
      const lyra = store.createCharacter(campaign.id, {
        slug: 'lyra',
        name: 'Lyra',
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Indigo,
      });
      const spend = store.recordSpend({
        campaignId: campaign.id,
        stage: SpendStage.Mind,
        model: 'openrouter/main',
        costUsd: 0.02,
      });
      const otherSpend = store.recordSpend({
        campaignId: otherCampaign.id,
        stage: SpendStage.Mind,
        model: 'openrouter/main',
        costUsd: 0.03,
      });
      const unscopedSpend = store.recordSpend({
        campaignId: null,
        stage: SpendStage.Director,
        model: 'openrouter/fast',
        costUsd: 0.01,
      });
      const seqBeforeFailure = store.getLocalChangeSeq();

      assert.throws(
        () => store.commitTurnPair({
          campaignId: campaign.id,
          userTurn: { mode: TurnMode.Normal, rawText: 'Walk inside.', witnessIds: [lyra.id] },
          userBeat: {
            speakerType: SpeakerType.Narrator,
            characterId: null,
            speakerName: 'Narrator',
            text: 'Walk inside.',
          },
          assistantTurn: {
            mode: TurnMode.Normal,
            rawText: 'Lyra speaks then phantom fails.',
            witnessIds: [lyra.id],
          },
          assistantBeats: [
            {
              speakerType: SpeakerType.Character,
              characterId: lyra.id,
              speakerName: 'Lyra',
              text: 'Wait here.',
            },
            {
              speakerType: SpeakerType.Character,
              characterId: 'nonexistent-character-uuid',
              speakerName: 'Phantom',
              text: 'Should trigger FK rollback.',
            },
          ],
          nextSceneState: buildSceneState('Hallway', 2, [lyra.id]),
          spendIds: [spend.id],
        }),
        /FOREIGN KEY constraint failed/,
      );

      const badSpendLists = [
        ['missing-spend-id'],
        [otherSpend.id],
        [spend.id, spend.id],
      ];
      for (const badSpendList of badSpendLists) {
        assert.throws(
          () => store.commitTurnPair({
            campaignId: campaign.id,
            userTurn: { mode: TurnMode.Normal, rawText: 'Retry.' },
            userBeat: {
              speakerType: SpeakerType.Narrator,
              characterId: null,
              speakerName: 'Narrator',
              text: 'Retry.',
            },
            assistantTurn: { mode: TurnMode.Normal, rawText: 'Reply.' },
            assistantBeats: [
              {
                speakerType: SpeakerType.Narrator,
                characterId: null,
                speakerName: 'Narrator',
                text: 'Reply.',
              },
            ],
            nextSceneState: buildSceneState('Hallway', 2, [lyra.id]),
            spendIds: badSpendList,
          }),
          /Unable to link spend entry/,
        );
      }

      assert.equal(store.listTurns(campaign.id).total, 0);
      assert.equal(store.getLatestTurnPair(campaign.id), null);
      assert.deepEqual(store.getCampaign(campaign.id).sceneState, initialSceneState);
      assert.equal(store.getLocalChangeSeq(), seqBeforeFailure);

      const committed = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Good turn.' },
        userBeat: {
          speakerType: SpeakerType.Narrator,
          characterId: null,
          speakerName: 'Narrator',
          text: 'Good turn.',
        },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Good reply.' },
        assistantBeats: [
          {
            speakerType: SpeakerType.Narrator,
            characterId: null,
            speakerName: 'Narrator',
            text: 'Good reply.',
          },
        ],
        nextSceneState: buildSceneState('Hallway', 2, [lyra.id]),
        spendIds: [spend.id, unscopedSpend.id],
      });
      assert.equal(committed.assistantTurn.seq, 2);

      assert.throws(
        () => store.commitTurnPair({
          campaignId: campaign.id,
          userTurn: { mode: TurnMode.Normal, rawText: 'Reuse spend.' },
          userBeat: {
            speakerType: SpeakerType.Narrator,
            characterId: null,
            speakerName: 'Narrator',
            text: 'Reuse spend.',
          },
          assistantTurn: { mode: TurnMode.Normal, rawText: 'Should fail.' },
          assistantBeats: [
            {
              speakerType: SpeakerType.Narrator,
              characterId: null,
              speakerName: 'Narrator',
              text: 'Should fail.',
            },
          ],
          nextSceneState: buildSceneState('Hallway', 2, [lyra.id]),
          spendIds: [spend.id],
        }),
        /Unable to link spend entry/,
      );
    } finally {
      store.close();
    }
  });

  it('edits single-beat and multi-beat turns via updateBeatText and clamps scribe_books.last_turn_seq on deletes', () => {
    const store = new SqliteStore(':memory:');
    try {
      const stateZero = buildSceneState('Gate', 1, []);
      const campaign = store.createCampaign({ title: 'Restore Test', sceneState: stateZero });
      const otherCampaign = store.createCampaign({ title: 'Other Campaign' });
      const bram = store.createCharacter(campaign.id, {
        slug: 'bram',
        name: 'Bram',
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Amber,
      });

      const stateOne = buildSceneState('Inn', 1, [bram.id]);
      const pairOne = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Enter inn.', witnessIds: [bram.id] },
        userBeat: {
          speakerType: SpeakerType.Narrator,
          characterId: null,
          speakerName: 'Narrator',
          text: 'Enter inn.',
        },
        assistantTurn: {
          mode: TurnMode.Normal,
          rawText: 'The fire crackles.\n\nWelcome in.',
          witnessIds: [bram.id],
        },
        assistantBeats: [
          {
            speakerType: SpeakerType.Narrator,
            characterId: null,
            speakerName: 'Narrator',
            text: 'The fire crackles.',
          },
          {
            speakerType: SpeakerType.Character,
            characterId: bram.id,
            speakerName: 'Bram',
            text: 'Welcome in.',
          },
        ],
        nextSceneState: stateOne,
      });

      const editedUser = store.updateBeatText(
        campaign.id,
        pairOne.userTurn.beats[0].id,
        'Step quietly into the inn.',
      );
      assert.equal(editedUser.rawText, 'Step quietly into the inn.');
      assert.equal(editedUser.beats[0].text, 'Step quietly into the inn.');

      const editedMulti = store.updateBeatText(
        campaign.id,
        pairOne.assistantTurn.beats[1].id,
        'Sit by the hearth.',
      );
      assert.equal(editedMulti.beats[0].text, 'The fire crackles.');
      assert.equal(editedMulti.beats[1].text, 'Sit by the hearth.');
      assert.equal(editedMulti.rawText, 'The fire crackles.\n\nSit by the hearth.');
      assert.equal(
        store.updateBeatText(otherCampaign.id, pairOne.assistantTurn.beats[1].id, 'Hijack'),
        null,
      );

      const stateTwo = buildSceneState('Cellar', 2, [bram.id]);
      const pairTwo = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Encounter, rawText: 'Head downstairs.', witnessIds: [bram.id] },
        userBeat: {
          speakerType: SpeakerType.Narrator,
          characterId: null,
          speakerName: 'Narrator',
          text: 'Head downstairs.',
        },
        assistantTurn: { mode: TurnMode.Encounter, rawText: 'A noise echoes.', witnessIds: [bram.id] },
        assistantBeats: [
          {
            speakerType: SpeakerType.Narrator,
            characterId: null,
            speakerName: 'Narrator',
            text: 'A noise echoes.',
          },
        ],
        nextSceneState: stateTwo,
      });

      assert.equal(store.countTurnsSinceScribe(campaign.id), 2);
      assert.equal(store.markScribeDirty(campaign.id), false);

      assert.throws(
        () => store.saveScribeBook(campaign.id, { bookJson: 'null', lastTurnSeq: 0 }),
        TypeError,
      );
      assert.throws(
        () => store.saveScribeBook(campaign.id, { bookJson: '[]', lastTurnSeq: 0 }),
        TypeError,
      );
      assert.throws(
        () => store.saveScribeBook(campaign.id, { bookJson: '123', lastTurnSeq: 0 }),
        TypeError,
      );

      store.saveScribeBook(campaign.id, {
        bookJson: JSON.stringify({ version: 1, entries: [] }),
        lastTurnSeq: pairTwo.assistantTurn.seq,
        dirty: false,
      });
      assert.equal(store.countTurnsSinceScribe(campaign.id), 0);
      assert.equal(store.markScribeDirty(campaign.id), true);
      assert.equal(store.getScribeBook(campaign.id).dirty, true);

      store.insertFindings(campaign.id, pairTwo.assistantTurn.id, [
        {
          kind: FindingKind.SecretLeak,
          subjectId: 'S1',
          subjectName: 'Bram',
          speakerCharacterId: bram.id,
          factId: 'F1',
          summary: 'Mentioned hidden cellar key.',
        },
      ]);
      assert.equal(store.listFindings(campaign.id).total, 1);

      const deletedPair = store.deleteLastTurnPair(campaign.id);
      assert.deepEqual(deletedPair.deletedSeqs, [pairTwo.userTurn.seq, pairTwo.assistantTurn.seq]);
      assert.deepEqual(deletedPair.restoredSceneState, stateOne);
      assert.deepEqual(store.getCampaign(campaign.id).sceneState, stateOne);
      assert.equal(store.getScribeBook(campaign.id).lastTurnSeq, pairOne.assistantTurn.seq);
      assert.equal(store.listFindings(campaign.id).total, 0);

      const replacementPair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Ask Bram about the cellar.' },
        userBeat: {
          speakerType: SpeakerType.Narrator,
          characterId: null,
          speakerName: 'Narrator',
          text: 'Ask Bram about the cellar.',
        },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'He shakes his head.' },
        assistantBeats: [
          {
            speakerType: SpeakerType.Character,
            characterId: bram.id,
            speakerName: 'Bram',
            text: 'Stay clear of those stairs.',
          },
        ],
        nextSceneState: stateOne,
      });
      assert.equal(store.countTurnsSinceScribe(campaign.id), 1);

      store.saveScribeBook(campaign.id, {
        bookJson: JSON.stringify({ version: 1, entries: [] }),
        lastTurnSeq: replacementPair.assistantTurn.seq,
        dirty: false,
      });
      const deletedAssistant = store.deleteLastAssistantTurn(campaign.id);
      assert.equal(deletedAssistant.deletedTurnId, replacementPair.assistantTurn.id);
      assert.equal(store.getScribeBook(campaign.id).lastTurnSeq, replacementPair.userTurn.seq);

      assert.throws(() => store.deleteLastAssistantTurn(campaign.id), /not an assistant turn/);
      assert.throws(() => store.deleteLastTurnPair(campaign.id), /complete user and assistant pair/);
    } finally {
      store.close();
    }
  });

  it('paginates accurately across 60 turns with SQL ordering and cursors', () => {
    const store = new SqliteStore(':memory:');
    try {
      const campaign = store.createCampaign({ title: 'Sixty Turns' });
      for (let pairIndex = 0; pairIndex < 30; pairIndex += 1) {
        store.commitTurnPair({
          campaignId: campaign.id,
          userTurn: { mode: TurnMode.Normal, rawText: `User turn ${pairIndex + 1}` },
          userBeat: {
            speakerType: SpeakerType.Narrator,
            characterId: null,
            speakerName: 'Narrator',
            text: `User turn ${pairIndex + 1}`,
          },
          assistantTurn: { mode: TurnMode.Normal, rawText: `Assistant turn ${pairIndex + 1}` },
          assistantBeats: [
            {
              speakerType: SpeakerType.Narrator,
              characterId: null,
              speakerName: 'Narrator',
              text: `Beat A ${pairIndex + 1}`,
            },
            {
              speakerType: SpeakerType.Narrator,
              characterId: null,
              speakerName: 'Narrator',
              text: `Beat B ${pairIndex + 1}`,
            },
          ],
          nextSceneState: buildSceneState('Road', 1, []),
        });
      }

      const pageOne = store.listTurns(campaign.id, { limit: 25 });
      assert.equal(pageOne.total, 60);
      assert.equal(pageOne.items.length, 25);
      assert.equal(pageOne.items[0].seq, 60);
      assert.equal(pageOne.items[24].seq, 36);
      assert.equal(pageOne.nextCursor, 36);
      assert.equal(pageOne.items[0].beats.length, 2);
      assert.equal(pageOne.items[0].beats[0].seq, 1);
      assert.equal(pageOne.items[0].beats[1].seq, 2);

      const pageTwo = store.listTurns(campaign.id, { limit: 25, beforeSeq: pageOne.nextCursor });
      assert.equal(pageTwo.total, 60);
      assert.equal(pageTwo.items.length, 25);
      assert.equal(pageTwo.items[0].seq, 35);
      assert.equal(pageTwo.items[24].seq, 11);
      assert.equal(pageTwo.nextCursor, 11);

      const pageThree = store.listTurns(campaign.id, { limit: 25, beforeSeq: pageTwo.nextCursor });
      assert.equal(pageThree.total, 60);
      assert.equal(pageThree.items.length, 10);
      assert.equal(pageThree.items[0].seq, 10);
      assert.equal(pageThree.items[9].seq, 1);
      assert.equal(pageThree.nextCursor, null);

      assert.throws(() => store.listTurns(campaign.id, { limit: 0 }), RangeError);
      assert.throws(() => store.listTurns(campaign.id, { limit: 51 }), RangeError);
      assert.throws(() => store.listTurns(campaign.id, { beforeSeq: 0 }), RangeError);
    } finally {
      store.close();
    }
  });
});

describe('SqliteStore findings, spend aggregation, and vacuumInto', () => {
  it('filters findings by status, blocks cross-campaign speakerCharacterId, and resolves findings', () => {
    const store = new SqliteStore(':memory:');
    try {
      const campaign = store.createCampaign({ title: 'Pedant Test' });
      const otherCampaign = store.createCampaign({ title: 'Other Campaign' });
      const outsider = store.createCharacter(otherCampaign.id, {
        slug: 'outsider',
        name: 'Outsider',
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Rose,
      });
      const pair = store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Ask about map.' },
        userBeat: { speakerType: SpeakerType.Narrator, characterId: null, speakerName: 'Narrator', text: 'Ask about map.' },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Map is burned.' },
        assistantBeats: [{ speakerType: SpeakerType.Narrator, characterId: null, speakerName: 'Narrator', text: 'Map is burned.' }],
        nextSceneState: buildSceneState('Study', 1, []),
      });

      const inserted = store.insertFindings(campaign.id, pair.assistantTurn.id, [
        { kind: FindingKind.Contradiction, summary: 'Map was intact yesterday.' },
        { kind: FindingKind.NameMismatch, summary: 'Called Rowan by wrong name.' },
      ]);
      assert.equal(inserted.length, 2);

      const ruled = store.resolveFinding(campaign.id, inserted[0].id, FindingStatus.Ruled);
      assert.equal(ruled.status, FindingStatus.Ruled);

      const openPage = store.listFindings(campaign.id, { status: FindingStatus.Open });
      assert.equal(openPage.total, 1);
      assert.equal(openPage.items[0].id, inserted[1].id);

      assert.throws(
        () => store.insertFindings(campaign.id, pair.assistantTurn.id, [{ kind: 'bogus', summary: 'x' }]),
        RangeError,
      );
      assert.throws(
        () => store.resolveFinding(campaign.id, inserted[1].id, 'bogus'),
        RangeError,
      );
      assert.throws(
        () => store.insertFindings(otherCampaign.id, pair.assistantTurn.id, [
          { kind: FindingKind.Contradiction, summary: 'Cross-campaign turn.' },
        ]),
        RangeError,
      );
      assert.throws(
        () => store.insertFindings(campaign.id, pair.assistantTurn.id, [
          {
            kind: FindingKind.SecretLeak,
            speakerCharacterId: outsider.id,
            summary: 'Cross-campaign speaker.',
          },
        ]),
        /Speaker character does not belong to campaign/,
      );
      assert.throws(
        () => store.recordSpend({
          campaignId: otherCampaign.id,
          turnId: pair.assistantTurn.id,
          stage: SpendStage.Pedant,
          model: 'openrouter/a',
          costUsd: 0.01,
        }),
        /Turn does not belong to campaign/,
      );
      assert.throws(
        () => store.recordSpend({
          campaignId: campaign.id,
          turnId: 'nonexistent-turn-id',
          stage: SpendStage.Pedant,
          model: 'openrouter/a',
          costUsd: 0.01,
        }),
        /Turn not found/,
      );
    } finally {
      store.close();
    }
  });

  it('aggregates daily spend across UTC day boundaries including 9999-12-31 and null costUsd calls', () => {
    const store = new SqliteStore(':memory:');
    try {
      store.recordSpend({
        stage: SpendStage.Director,
        model: 'openrouter/a',
        promptTokens: 50,
        completionTokens: 20,
        costUsd: 0.1,
        createdAt: '2026-11-23T23:59:59.999Z',
      });
      store.recordSpend({
        stage: SpendStage.Mind,
        model: 'openrouter/b',
        promptTokens: 200,
        completionTokens: 80,
        costUsd: 0.25,
        createdAt: '2026-11-24T00:00:00.000Z',
      });
      store.recordSpend({
        stage: SpendStage.Composer,
        model: 'openrouter/c',
        promptTokens: 300,
        completionTokens: 150,
        costUsd: null,
        createdAt: '2026-11-24T23:59:59Z',
      });
      store.recordSpend({
        stage: SpendStage.Scribe,
        model: 'openrouter/d',
        promptTokens: 120,
        completionTokens: 40,
        costUsd: 0.15,
        createdAt: '2026-11-24T23:59:59.999Z',
      });
      store.recordSpend({
        stage: SpendStage.Muse,
        model: 'openrouter/e',
        promptTokens: 60,
        completionTokens: 30,
        costUsd: 0.5,
        createdAt: '2026-11-25T00:00:00.000Z',
      });
      store.recordSpend({
        stage: SpendStage.Pedant,
        model: 'openrouter/f',
        promptTokens: 10,
        completionTokens: 10,
        costUsd: 0.07,
        createdAt: '9999-12-31T23:59:59.999Z',
      });

      const daySpend = store.getDailySpend('2026-11-24');
      assert.ok(Math.abs(daySpend.totalUsd - 0.4) < 1e-9);
      assert.equal(daySpend.unpricedCount, 1);
      assert.equal(daySpend.callCount, 3);

      const maxDateSpend = store.getDailySpend('9999-12-31');
      assert.ok(Math.abs(maxDateSpend.totalUsd - 0.07) < 1e-9);
      assert.equal(maxDateSpend.unpricedCount, 0);
      assert.equal(maxDateSpend.callCount, 1);

      assert.deepEqual(store.getDailySpend('2026-11-26'), {
        totalUsd: 0,
        unpricedCount: 0,
        callCount: 0,
      });

      assert.throws(() => store.getDailySpend('2026-02-30'), RangeError);
      assert.throws(() => store.getDailySpend('not-a-date'), RangeError);
      assert.throws(() => store.recordSpend({ stage: 'invalid', model: 'm' }), RangeError);
      assert.throws(() => store.recordSpend({ stage: SpendStage.Pedant, model: 'm', costUsd: -1 }), RangeError);
      assert.throws(() => store.recordSpend({ stage: SpendStage.Pedant, model: 'm', costUsd: Number.NaN }), RangeError);
    } finally {
      store.close();
    }
  });

  it('produces standalone WAL-complete snapshots via vacuumInto and blocks SQL injection or overwrite', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-store-test-'));
    tempDirs.push(tempDir);
    const liveDbPath = path.join(tempDir, 'live.sqlite');
    const store = new SqliteStore(liveDbPath);
    try {
      const campaign = store.createCampaign({ title: 'WAL Snapshot Campaign' });
      store.commitTurnPair({
        campaignId: campaign.id,
        userTurn: { mode: TurnMode.Normal, rawText: 'Uncheckpointed WAL turn.' },
        userBeat: {
          speakerType: SpeakerType.Narrator,
          characterId: null,
          speakerName: 'Narrator',
          text: 'Uncheckpointed WAL turn.',
        },
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Captured in snapshot.' },
        assistantBeats: [
          {
            speakerType: SpeakerType.Narrator,
            characterId: null,
            speakerName: 'Narrator',
            text: 'Captured in snapshot.',
          },
        ],
        nextSceneState: buildSceneState('Dock', 1, []),
      });

      const snapshotPath = path.join(tempDir, 'snapshot.sqlite');
      store.vacuumInto(snapshotPath);

      assert.throws(() => store.vacuumInto(snapshotPath), /already exists/);
      assert.throws(() => store.vacuumInto(`${snapshotPath}\0bad`), RangeError);

      const injectedPath = path.join(tempDir, "evil'; DROP TABLE campaigns; --.sqlite");
      store.vacuumInto(injectedPath);
      assert.equal(fs.existsSync(injectedPath), true);
      assert.equal(store.getCampaign(campaign.id).title, 'WAL Snapshot Campaign');

      const isolatedCopyPath = path.join(tempDir, 'isolated-copy.sqlite');
      fs.copyFileSync(snapshotPath, isolatedCopyPath);
      const snapshotDb = new DatabaseSync(isolatedCopyPath, { readOnly: true });
      try {
        const campaignRow = snapshotDb.prepare('SELECT title FROM campaigns WHERE id = ?').get(campaign.id);
        const turnCountRow = snapshotDb.prepare('SELECT COUNT(*) AS turn_count FROM turns WHERE campaign_id = ?').get(campaign.id);
        assert.equal(campaignRow.title, 'WAL Snapshot Campaign');
        assert.equal(Number(turnCountRow.turn_count), 2);
      } finally {
        snapshotDb.close();
      }
    } finally {
      store.close();
    }
  });
});
