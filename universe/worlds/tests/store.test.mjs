import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';
import { CharacterCard } from '../src/store/CharacterCard.mjs';
import { SchemaUpgrades } from '../src/store/SchemaUpgrades.mjs';
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
        scribeInterval: 1,
        pedantEnabled: true,
        dailyWarnUsd: null,
        maxRepliesPerCharacter: 1,
        replyReserve: 3000,
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
      for (const invalidValue of [0, 1.5, '3', null, -2]) {
        assert.throws(() => store.updateSettings({ maxRepliesPerCharacter: invalidValue }), RangeError);
        assert.throws(() => store.updateSettings({ replyReserve: invalidValue }), RangeError);
      }
      const reply = store.updateSettings({ maxRepliesPerCharacter: 2, replyReserve: 4096 });
      assert.equal(reply.maxRepliesPerCharacter, 2);
      assert.equal(reply.replyReserve, 4096);
      assert.equal(store.updateSettings({ maxRepliesPerCharacter: 5 }).maxRepliesPerCharacter, 5);
      assert.throws(() => store.updateSettings({ maxRepliesPerCharacter: 6 }), RangeError);
      assert.equal(store.updateSettings({ replyReserve: 1000000 }).replyReserve, 1000000);
      assert.equal(store.getSettings().maxRepliesPerCharacter, 5);
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

describe('SqliteStore.listModelOverrides', () => {
  it('returns the distinct overrides of non-archived characters across campaigns and skips blanks', () => {
    const store = new SqliteStore(':memory:');
    try {
      const campaignAlpha = store.createCampaign({ title: 'Alpha' });
      const campaignBeta = store.createCampaign({ title: 'Beta' });
      assert.deepEqual(store.listModelOverrides(), []);

      store.createCharacter(campaignAlpha.id, { slug: 'one', name: 'One', modelOverride: 'a/shared' });
      store.createCharacter(campaignAlpha.id, { slug: 'two', name: 'Two', modelOverride: '   ' });
      store.createCharacter(campaignAlpha.id, { slug: 'three', name: 'Three' });
      store.createCharacter(campaignBeta.id, { slug: 'four', name: 'Four', modelOverride: '  a/shared  ' });
      store.createCharacter(campaignBeta.id, { slug: 'five', name: 'Five', modelOverride: 'b/other' });
      const archived = store.createCharacter(campaignBeta.id, { slug: 'six', name: 'Six', modelOverride: 'c/archived' });
      store.updateCharacter(campaignBeta.id, archived.id, { archived: true });

      assert.deepEqual(store.listModelOverrides().toSorted(), ['a/shared', 'b/other']);
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

  it('supports nested savepoints via runTransaction, rolls back inner/outer errors atomically, and rejects async operations', async () => {
    const store = new SqliteStore(':memory:');
    try {
      const campaign = store.createCampaign({ title: 'Savepoint Campaign' });
      const initialSeq = store.getLocalChangeSeq();

      assert.throws(() => store.runTransaction('not-a-function'), TypeError);

      assert.throws(() => {
        store.runTransaction(() => {
          store.updateCampaign(campaign.id, { premise: 'Outer update' });
          store.runTransaction(() => {
            store.createCharacter(campaign.id, {
              slug: 'innerchar',
              name: 'Inner Char',
              tier: CharacterTier.Main,
              avatarToken: AvatarToken.Sage,
            });
            throw new Error('Inner boom');
          });
        });
      }, /Inner boom/);

      assert.equal(store.getCampaign(campaign.id).premise, '');
      assert.equal(store.listCharacters(campaign.id).total, 0);
      assert.equal(store.getLocalChangeSeq(), initialSeq);

      const caughtSavepointResult = store.runTransaction(() => {
        store.updateCampaign(campaign.id, { premise: 'Kept outer premise' });
        let caughtInnerMessage = '';
        try {
          store.runTransaction(() => {
            store.createCharacter(campaign.id, {
              slug: 'rolledback',
              name: 'Rolled Back',
              tier: CharacterTier.Recurring,
              avatarToken: AvatarToken.Amber,
            });
            throw new Error('Handled inner failure');
          });
        } catch (innerError) {
          caughtInnerMessage = innerError.message;
        }
        assert.equal(caughtInnerMessage, 'Handled inner failure');
        return store.getCampaign(campaign.id).premise;
      });
      assert.equal(caughtSavepointResult, 'Kept outer premise');
      assert.equal(store.getCampaign(campaign.id).premise, 'Kept outer premise');
      assert.equal(store.listCharacters(campaign.id).total, 0);

      assert.throws(() => {
        store.runTransaction(async () => {
          store.updateCampaign(campaign.id, { title: 'Should Never Commit' });
        });
      }, /synchronous/);
      assert.equal(store.getCampaign(campaign.id).title, 'Savepoint Campaign');

      const seqAfterAsyncRejection = store.runTransaction(() => {
        store.updateCampaign(campaign.id, { title: 'Clean After Error' });
        return store.getCampaign(campaign.id).title;
      });
      assert.equal(seqAfterAsyncRejection, 'Clean After Error');
    } finally {
      store.close();
    }
  });
});

const VERSION_ZERO_FIXTURE = `
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  premise TEXT NOT NULL DEFAULT '',
  style_notes TEXT NOT NULL DEFAULT '',
  player_character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
  scene_state_json TEXT NOT NULL,
  encounter_public_odds INTEGER NOT NULL DEFAULT 8 CHECK (encounter_public_odds >= 0),
  encounter_private_odds INTEGER NOT NULL DEFAULT 30 CHECK (encounter_private_odds >= 0),
  scribe_interval INTEGER NOT NULL DEFAULT 10 CHECK (scribe_interval >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  slug TEXT NOT NULL CHECK (length(slug) > 0),
  scribe_subject_id TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  aliases_json TEXT NOT NULL DEFAULT '[]',
  is_player INTEGER NOT NULL DEFAULT 0 CHECK (is_player IN (0, 1)),
  tier TEXT NOT NULL CHECK (tier IN ('main', 'recurring')),
  model_override TEXT,
  persona TEXT NOT NULL DEFAULT '',
  voice_notes TEXT NOT NULL DEFAULT '',
  avatar_token TEXT NOT NULL CHECK (avatar_token IN ('sage', 'rose', 'amber', 'slate', 'plum', 'teal', 'indigo', 'coral')),
  avatar_initials TEXT NOT NULL CHECK (length(trim(avatar_initials)) > 0),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (campaign_id, slug)
);

CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  mode TEXT NOT NULL CHECK (mode IN ('normal', 'narrator', 'encounter')),
  raw_text TEXT NOT NULL,
  ooc_nudge TEXT,
  scene_number INTEGER NOT NULL CHECK (scene_number >= 1),
  witness_ids_json TEXT NOT NULL DEFAULT '[]',
  scene_state_before_json TEXT,
  scene_state_after_json TEXT,
  director_plan_json TEXT,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, seq)
);

CREATE TABLE spend_log (
  id TEXT PRIMARY KEY,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN ('director', 'mind', 'composer', 'scribe', 'pedant', 'muse')),
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  cost_usd REAL CHECK (cost_usd IS NULL OR cost_usd >= 0),
  created_at TEXT NOT NULL
);
`;

const VERSION_ZERO_CAMPAIGN_ID = 'campaign-old';
const VERSION_ZERO_TIMESTAMP = '2026-01-01T00:00:00.000Z';

/**
 * @param {string} extraSql
 * @returns {string}
 * @throws {Error}
 */
function buildVersionZeroDatabase(extraSql = '') {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-store-upgrade-test-'));
  tempDirs.push(tempDir);
  const dbPath = path.join(tempDir, 'old.sqlite');
  const rawDb = new DatabaseSync(dbPath);
  try {
    rawDb.exec(VERSION_ZERO_FIXTURE);
    rawDb.prepare(
      `INSERT INTO campaigns (id, title, scene_state_json, created_at, updated_at)
       VALUES (?, 'Old Campaign', '{}', ?, ?)`,
    ).run(VERSION_ZERO_CAMPAIGN_ID, VERSION_ZERO_TIMESTAMP, VERSION_ZERO_TIMESTAMP);
    const insertCharacter = rawDb.prepare(
      `INSERT INTO characters (
        id, campaign_id, slug, name, tier, persona, voice_notes, avatar_token, avatar_initials, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'main', ?, ?, 'sage', 'OL', ?, ?)`,
    );
    insertCharacter.run(
      'char-old-1', VERSION_ZERO_CAMPAIGN_ID, 'old-one', 'Old One', 'Wary scout.', 'Terse.',
      VERSION_ZERO_TIMESTAMP, VERSION_ZERO_TIMESTAMP,
    );
    insertCharacter.run(
      'char-old-2', VERSION_ZERO_CAMPAIGN_ID, 'old-two', 'Old Two', '', 'Warm and blunt.',
      VERSION_ZERO_TIMESTAMP, VERSION_ZERO_TIMESTAMP,
    );
    rawDb.prepare(
      `INSERT INTO spend_log (id, campaign_id, stage, model, prompt_tokens, completion_tokens, created_at)
       VALUES ('spend-old', ?, 'mind', 'old/model', 900, 50, ?)`,
    ).run(VERSION_ZERO_CAMPAIGN_ID, VERSION_ZERO_TIMESTAMP);
    if (extraSql.length > 0) {
      rawDb.exec(extraSql);
    }
  } finally {
    rawDb.close();
  }
  return dbPath;
}

/**
 * @param {string} dbPath
 * @returns {number}
 * @throws {Error}
 */
function readUserVersion(dbPath) {
  const rawDb = new DatabaseSync(dbPath);
  try {
    return Number(rawDb.prepare('PRAGMA user_version').get().user_version);
  } finally {
    rawDb.close();
  }
}

describe('SqliteStore schema upgrades', () => {
  it('upgrades a version-0 database and keeps every row', () => {
    const dbPath = buildVersionZeroDatabase();
    assert.equal(readUserVersion(dbPath), 0);

    const firstOpen = new SqliteStore(dbPath);
    try {
      const characters = firstOpen.listCharacters(VERSION_ZERO_CAMPAIGN_ID).items;
      assert.deepEqual(characters.map((character) => character.slug), ['old-one', 'old-two']);
      assert.equal(characters[0].card.personalitySummary, 'Wary scout.');
      assert.equal(characters[0].card.speakingStyle, 'Terse.');
      assert.equal(characters[1].card.personalitySummary, '');
      assert.equal(characters[1].card.speakingStyle, 'Warm and blunt.');
      assert.equal(characters[0].card.hair, '');
      assert.deepEqual(characters[0].card.speechExamples, []);
      assert.equal(Object.hasOwn(characters[0], 'persona'), false);
      assert.equal(Object.hasOwn(characters[0], 'voiceNotes'), false);
      assert.equal(firstOpen.lowestCharsPerToken('old/model'), null);
      assert.equal(firstOpen.getCampaign(VERSION_ZERO_CAMPAIGN_ID).title, 'Old Campaign');
    } finally {
      firstOpen.close();
    }
    assert.equal(readUserVersion(dbPath), 1);

    const rawDb = new DatabaseSync(dbPath);
    try {
      const spendColumns = rawDb.prepare('PRAGMA table_info(spend_log)').all().map((column) => column.name);
      assert.ok(spendColumns.includes('prompt_chars'));
      const spendRows = rawDb.prepare('SELECT id, prompt_chars, prompt_tokens FROM spend_log').all();
      assert.deepEqual(spendRows.map((row) => ({ ...row })), [{ id: 'spend-old', prompt_chars: null, prompt_tokens: 900 }]);
      const legacy = rawDb.prepare('SELECT persona, voice_notes FROM characters WHERE id = ?').get('char-old-1');
      assert.equal(legacy.persona, 'Wary scout.');
      assert.equal(legacy.voice_notes, 'Terse.');
    } finally {
      rawDb.close();
    }

    const secondOpen = new SqliteStore(dbPath);
    try {
      const characters = secondOpen.listCharacters(VERSION_ZERO_CAMPAIGN_ID).items;
      assert.equal(characters.length, 2);
      assert.equal(characters[0].card.personalitySummary, 'Wary scout.');
      assert.equal(secondOpen.getLocalChangeSeq(), 0);
    } finally {
      secondOpen.close();
    }
    assert.equal(readUserVersion(dbPath), 1);
  });

  it('rolls the whole upgrade back when the fill step fails and succeeds once the data is repaired', () => {
    const dbPath = buildVersionZeroDatabase("UPDATE characters SET persona = x'0102' WHERE id = 'char-old-2'");
    assert.throws(() => new SqliteStore(dbPath), /personalitySummary/);
    assert.equal(readUserVersion(dbPath), 0);
    const rawDb = new DatabaseSync(dbPath);
    try {
      const characterColumns = rawDb.prepare('PRAGMA table_info(characters)').all().map((column) => column.name);
      assert.equal(characterColumns.includes('card_json'), false);
      const spendColumns = rawDb.prepare('PRAGMA table_info(spend_log)').all().map((column) => column.name);
      assert.equal(spendColumns.includes('prompt_chars'), false);
      assert.equal(rawDb.prepare('SELECT COUNT(*) AS total FROM characters').get().total, 2);
      rawDb.exec("UPDATE characters SET persona = 'Fixed.' WHERE id = 'char-old-2'");
    } finally {
      rawDb.close();
    }
    const store = new SqliteStore(dbPath);
    try {
      assert.equal(store.getCharacter(VERSION_ZERO_CAMPAIGN_ID, 'char-old-2').card.personalitySummary, 'Fixed.');
    } finally {
      store.close();
    }
    assert.equal(readUserVersion(dbPath), 1);
  });

  it('opens a database whose schema was applied but whose version write never happened', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-store-interrupted-test-'));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, 'interrupted.sqlite');
    const schemaSql = fs.readFileSync(new URL('../src/store/schema.sql', import.meta.url), 'utf8');
    const rawDb = new DatabaseSync(dbPath);
    try {
      rawDb.exec(schemaSql);
      rawDb.prepare(
        `INSERT INTO campaigns (id, title, scene_state_json, created_at, updated_at)
         VALUES ('c-1', 'Kept', '{}', ?, ?)`,
      ).run(VERSION_ZERO_TIMESTAMP, VERSION_ZERO_TIMESTAMP);
    } finally {
      rawDb.close();
    }
    assert.equal(readUserVersion(dbPath), 0);

    const store = new SqliteStore(dbPath);
    try {
      assert.equal(store.getCampaign('c-1').title, 'Kept');
    } finally {
      store.close();
    }
    assert.equal(readUserVersion(dbPath), 1);
  });

  it('upgrades a version-0 database that has characters but no spend_log', () => {
    const dbPath = buildVersionZeroDatabase('DROP TABLE spend_log');
    const store = new SqliteStore(dbPath);
    try {
      assert.equal(store.listCharacters(VERSION_ZERO_CAMPAIGN_ID).total, 2);
      store.recordSpend({ stage: SpendStage.Mind, model: 'm/a', promptChars: 30, promptTokens: 10 });
      assert.equal(store.lowestCharsPerToken('m/a'), 3);
    } finally {
      store.close();
    }
    assert.equal(readUserVersion(dbPath), 1);
  });

  it('never overwrites a card that was already written when an upgrade runs again', () => {
    const dbPath = buildVersionZeroDatabase();
    const first = new SqliteStore(dbPath);
    first.updateCharacter(VERSION_ZERO_CAMPAIGN_ID, 'char-old-1', { card: { hair: 'red', personalitySummary: 'Edited.' } });
    first.close();

    const rawDb = new DatabaseSync(dbPath);
    try {
      rawDb.exec('PRAGMA user_version = 0');
    } finally {
      rawDb.close();
    }
    const second = new SqliteStore(dbPath);
    try {
      const character = second.getCharacter(VERSION_ZERO_CAMPAIGN_ID, 'char-old-1');
      assert.equal(character.card.hair, 'red');
      assert.equal(character.card.personalitySummary, 'Edited.');
    } finally {
      second.close();
    }
    assert.equal(readUserVersion(dbPath), 1);
  });

  it('refuses a database that is newer than this app and says so with both version numbers', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-store-newer-test-'));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, 'newer.sqlite');
    const rawDb = new DatabaseSync(dbPath);
    try {
      rawDb.exec('PRAGMA journal_mode = DELETE');
      rawDb.exec('PRAGMA user_version = 99');
    } finally {
      rawDb.close();
    }
    assert.throws(() => new SqliteStore(dbPath), /version 99 is newer than this app supports \(1\)/);
    assert.equal(readUserVersion(dbPath), 99);
    const inspector = new DatabaseSync(dbPath);
    try {
      assert.equal(inspector.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
    } finally {
      inspector.close();
    }
  });

  it('creates nothing when schema.sql fails on a fresh file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-store-atomic-test-'));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, 'atomic.sqlite');
    const rawDb = new DatabaseSync(dbPath);
    try {
      rawDb.exec('CREATE TABLE beats (id TEXT PRIMARY KEY)');
    } finally {
      rawDb.close();
    }
    assert.throws(() => new SqliteStore(dbPath), /turn_id/);
    const inspector = new DatabaseSync(dbPath);
    try {
      const tableNames = inspector
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => row.name);
      assert.deepEqual(tableNames, ['beats']);
    } finally {
      inspector.close();
    }
    assert.equal(readUserVersion(dbPath), 0);
  });

  it('leaves no open handle after a failed open', () => {
    const dbPath = buildVersionZeroDatabase("UPDATE characters SET persona = x'0102' WHERE id = 'char-old-2'");
    const tempDir = path.dirname(dbPath);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      assert.throws(() => new SqliteStore(dbPath), /personalitySummary/);
    }
    assert.deepEqual(fs.readdirSync(tempDir).filter((name) => name.endsWith('-wal')), []);
    const writer = new DatabaseSync(dbPath);
    try {
      writer.exec("UPDATE campaigns SET title = 'After failures'");
      assert.equal(writer.prepare('SELECT title FROM campaigns').get().title, 'After failures');
    } finally {
      writer.close();
    }
  });

  it('a fresh database declares scribe_interval with default 1 and the newest columns', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-store-schema-test-'));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, 'schema.sqlite');
    new SqliteStore(dbPath).close();
    const rawDb = new DatabaseSync(dbPath);
    try {
      const campaignColumns = rawDb.prepare('PRAGMA table_info(campaigns)').all();
      assert.equal(campaignColumns.find((column) => column.name === 'scribe_interval').dflt_value, '1');
      const characterColumns = rawDb.prepare('PRAGMA table_info(characters)').all().map((column) => column.name);
      assert.ok(characterColumns.includes('card_json'));
      const spendColumns = rawDb.prepare('PRAGMA table_info(spend_log)').all().map((column) => column.name);
      assert.ok(spendColumns.includes('prompt_chars'));
    } finally {
      rawDb.close();
    }
  });

  it('a fresh database starts at the latest version', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-store-fresh-test-'));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, 'fresh.sqlite');
    const store = new SqliteStore(dbPath);
    try {
      assert.equal(store.getSettings().scribeInterval, 1);
      const campaign = store.createCampaign({ title: 'Fresh' });
      assert.equal(campaign.scribeInterval, 1);
      const character = store.createCharacter(campaign.id, { slug: 'fresh-one', name: 'Fresh One' });
      assert.deepEqual(character.card.toObject(), CharacterCard.empty().toObject());
    } finally {
      store.close();
    }
    assert.equal(readUserVersion(dbPath), SchemaUpgrades.Latest);
    assert.equal(SchemaUpgrades.Latest, 1);
    assert.deepEqual(SchemaUpgrades.steps.map((step) => step.version), [1]);
    assert.equal(Object.isFrozen(SchemaUpgrades.steps), true);

    const reopened = new SqliteStore(dbPath);
    reopened.close();
    assert.equal(readUserVersion(dbPath), SchemaUpgrades.Latest);
  });
});

describe('CharacterCard and character card storage', () => {
  it('CharacterCard.fromObject refuses a number in hair and a string speechExamples', () => {
    assert.throws(() => CharacterCard.fromObject({ hair: 5 }), (error) => {
      return error instanceof TypeError && /hair/.test(error.message);
    });
    assert.throws(() => CharacterCard.fromObject({ speechExamples: 'Hello there.' }), (error) => {
      return error instanceof TypeError && /speechExamples/.test(error.message);
    });
    assert.throws(() => CharacterCard.fromObject({ speechExamples: ['ok', 3] }), TypeError);
    assert.throws(() => CharacterCard.fromObject({ persona: 'old key' }), /persona/);
    assert.throws(() => CharacterCard.fromObject(null), TypeError);
    assert.throws(() => CharacterCard.fromObject([]), TypeError);
    assert.throws(() => CharacterCard.fromObject({ filedFactIds: { hair: 7 } }), /filedFactIds\.hair/);
    assert.throws(() => CharacterCard.fromObject({ filedFactIds: { traits: 'F1' } }), /traits/);
    assert.throws(() => CharacterCard.fromObject(JSON.parse('{"__proto__": {"x": "y"}}')), /__proto__/);
  });

  it('CharacterCard refuses sparse arrays, a direct bad constructor call, and non-plain objects', () => {
    const sparse = [];
    sparse[1] = 'a';
    assert.throws(() => CharacterCard.fromObject({ speechExamples: sparse }), TypeError);
    let hairReads = 0;
    const shifting = {
      get hair() {
        hairReads += 1;
        return hairReads === 1 ? 'red' : 5;
      },
    };
    const readOnce = CharacterCard.fromObject(shifting);
    assert.equal(readOnce.hair, 'red');
    assert.equal(hairReads, 1);
    let examplesReads = 0;
    const shiftingExamples = {
      get speechExamples() {
        examplesReads += 1;
        return examplesReads === 1 ? ['a'] : [5];
      },
    };
    assert.deepEqual(CharacterCard.fromObject(shiftingExamples).speechExamples, ['a']);

    let entryReads = 0;
    const shiftingEntries = [];
    Object.defineProperty(shiftingEntries, 0, {
      enumerable: true,
      get() {
        entryReads += 1;
        return entryReads === 1 ? 'a' : 5;
      },
    });
    assert.deepEqual(CharacterCard.fromObject({ speechExamples: shiftingEntries }).speechExamples, ['a']);
    assert.equal(entryReads, 1);

    let filedReads = 0;
    const shiftingFiled = {
      get hair() {
        filedReads += 1;
        return filedReads === 1 ? 'F1' : 5;
      },
    };
    assert.deepEqual(CharacterCard.fromObject({ filedFactIds: shiftingFiled }).filedFactIds, { hair: 'F1' });
    assert.equal(filedReads, 1);

    assert.throws(
      () => CharacterCard.fromObject({ filedFactIds: { [Symbol('hair')]: 'F1' } }),
      (error) => error instanceof TypeError && /filedFactIds/.test(error.message),
    );
    assert.throws(() => new CharacterCard({ hair: 5 }), (error) => error instanceof TypeError && /hair/.test(error.message));
    assert.throws(() => new CharacterCard({ speechExamples: [1] }), TypeError);
    assert.throws(() => new CharacterCard({ filedFactIds: { hair: '' } }), TypeError);
    assert.throws(() => new CharacterCard(null), TypeError);
    assert.throws(() => CharacterCard.fromObject(new Date()), TypeError);
    assert.throws(() => CharacterCard.fromObject(new Map()), TypeError);
    assert.throws(() => CharacterCard.fromObject(new (class Holder { hair = 'red'; })()), TypeError);
    assert.throws(() => CharacterCard.fromObject({ filedFactIds: new Map() }), TypeError);
    assert.equal(CharacterCard.fromObject(Object.create(null)).hair, '');
  });

  it('CharacterCard is frozen, round-trips through toObject, and empty() has every field', () => {
    const card = CharacterCard.fromObject({
      hair: 'red',
      speechExamples: ['Hm.'],
      filedFactIds: { hair: 'F1' },
    });
    assert.equal(Object.isFrozen(card), true);
    assert.equal(Object.isFrozen(card.speechExamples), true);
    assert.equal(Object.isFrozen(card.filedFactIds), true);
    assert.deepEqual(CharacterCard.fromObject(card.toObject()).toObject(), card.toObject());
    const emptyObject = CharacterCard.empty().toObject();
    for (const field of CharacterCard.TextFields) {
      assert.equal(emptyObject[field], '');
    }
    assert.deepEqual(emptyObject.speechExamples, []);
    assert.deepEqual(emptyObject.filedFactIds, {});
    assert.equal(CharacterCard.TextFields.length, 21);
    assert.deepEqual(
      [...CharacterCard.AppearanceFields],
      ['age', 'hair', 'eyes', 'height', 'body', 'face', 'features'],
    );
  });

  it('stores the card on create and update and keeps untouched cards on other patches', () => {
    const store = new SqliteStore(':memory:');
    try {
      const campaign = store.createCampaign({ title: 'Cards' });
      const created = store.createCharacter(campaign.id, {
        slug: 'card-one',
        name: 'Card One',
        card: { hair: 'red', speechExamples: ['Well, then.'] },
      });
      assert.equal(created.card.hair, 'red');
      assert.deepEqual(created.card.speechExamples, ['Well, then.']);

      const renamed = store.updateCharacter(campaign.id, created.id, { name: 'Card Prime' });
      assert.equal(renamed.card.hair, 'red');

      const merged = store.updateCharacter(campaign.id, created.id, { card: { eyes: 'green' } });
      assert.equal(merged.card.eyes, 'green');
      assert.equal(merged.card.hair, 'red');
      assert.deepEqual(merged.card.speechExamples, ['Well, then.']);

      const filed = store.setCardFiledFactIds(campaign.id, created.id, { hair: 'F9' });
      assert.deepEqual(filed.card.filedFactIds, { hair: 'F9' });
      assert.equal(filed.card.eyes, 'green');
      const partial = store.updateCharacter(campaign.id, created.id, {
        card: { hair: 'black', filedFactIds: { eyes: 'F1' } },
      });
      assert.equal(partial.card.hair, 'black');
      assert.equal(partial.card.eyes, 'green');
      assert.deepEqual(partial.card.filedFactIds, { hair: 'F9' });
      const skipped = store.updateCharacter(campaign.id, created.id, {
        card: { hair: undefined, eyes: 'grey' },
      });
      assert.equal(skipped.card.hair, 'black');
      assert.equal(skipped.card.eyes, 'grey');
      let faceReads = 0;
      const shiftingPatch = {
        get face() {
          faceReads += 1;
          return faceReads === 1 ? undefined : 'wide';
        },
      };
      const faceKept = store.updateCharacter(campaign.id, created.id, { card: shiftingPatch });
      assert.equal(faceReads, 1);
      assert.equal(faceKept.card.face, '');
      store.updateCharacter(campaign.id, created.id, { card: { face: 'narrow' } });
      faceReads = 0;
      const faceStillKept = store.updateCharacter(campaign.id, created.id, { card: shiftingPatch });
      assert.equal(faceStillKept.card.face, 'narrow');
      for (const invalidCard of [null, 5, 'text', []]) {
        assert.throws(() => store.updateCharacter(campaign.id, created.id, { card: invalidCard }), TypeError);
      }
      const cleared = store.updateCharacter(campaign.id, created.id, { card: { speechExamples: [] } });
      assert.deepEqual(cleared.card.speechExamples, []);
      assert.equal(cleared.card.hair, 'black');

      assert.throws(() => store.setCardFiledFactIds(campaign.id, created.id, { traits: 'F1' }), /traits/);
      assert.throws(() => store.setCardFiledFactIds(campaign.id, created.id, { hair: 4 }), /filedFactIds\.hair/);
      assert.throws(() => store.setCardFiledFactIds(campaign.id, created.id, 'F1'), TypeError);
      for (const invalidFiled of [undefined, null, []]) {
        assert.throws(() => store.setCardFiledFactIds(campaign.id, created.id, invalidFiled), TypeError);
      }
      assert.deepEqual(store.getCharacter(campaign.id, created.id).card.filedFactIds, { hair: 'F9' });
      const emptied = store.setCardFiledFactIds(campaign.id, created.id, {});
      assert.deepEqual(emptied.card.filedFactIds, {});
      store.setCardFiledFactIds(campaign.id, created.id, { hair: 'F9' });
      assert.equal(store.setCardFiledFactIds(campaign.id, 'missing-id', { hair: 'F1' }), null);
      assert.deepEqual(store.getCharacter(campaign.id, created.id).card.filedFactIds, { hair: 'F9' });

      assert.throws(() => store.createCharacter(campaign.id, { slug: 'bad', name: 'Bad', card: { hair: 5 } }), /hair/);
      assert.throws(
        () => store.createCharacter(campaign.id, { slug: 'old', name: 'Old', persona: 'x' }),
        (error) => error instanceof TypeError && /persona/.test(error.message),
      );
      assert.throws(() => store.createCharacter(campaign.id, { slug: 'old', name: 'Old', voiceNotes: 'x' }), TypeError);
      assert.equal(store.listCharacters(campaign.id).total, 1);
      assert.throws(() => store.updateCharacter(campaign.id, created.id, { card: 'text' }), TypeError);
      assert.equal(store.getCharacter(campaign.id, created.id).card.eyes, 'grey');
    } finally {
      store.close();
    }
  });

  it('updateCharacter refuses persona and voiceNotes', () => {
    const store = new SqliteStore(':memory:');
    try {
      const campaign = store.createCampaign({ title: 'Refusals' });
      const character = store.createCharacter(campaign.id, { slug: 'refuser', name: 'Refuser' });
      assert.throws(() => store.updateCharacter(campaign.id, character.id, { persona: 'Sharp.' }), /persona/);
      assert.throws(() => store.updateCharacter(campaign.id, character.id, { voiceNotes: 'Dry.' }), /voiceNotes/);
      assert.equal(store.getCharacter(campaign.id, character.id).card.personalitySummary, '');
    } finally {
      store.close();
    }
  });
});

describe('SqliteStore measured characters per token', () => {
  it('lowestCharsPerToken returns the minimum ratio and ignores rows without prompt_chars or with zero prompt_chars', () => {
    const store = new SqliteStore(':memory:');
    try {
      assert.equal(store.lowestCharsPerToken('model/a'), null);
      assert.equal(store.lowestCharsPerTokenOverall(), null);
      const spendRows = [
        { model: 'model/a', promptChars: 4000, promptTokens: 1000 },
        { model: 'model/a', promptChars: 3000, promptTokens: 1000 },
        { model: 'model/a', promptChars: null, promptTokens: 500 },
        { model: 'model/a', promptChars: 100, promptTokens: 0 },
        { model: 'model/a', promptChars: 0, promptTokens: 800 },
        { model: 'model/b', promptChars: 1000, promptTokens: 1000 },
        { model: 'model/c', promptChars: 0, promptTokens: 100 },
      ];
      for (const spendRow of spendRows) {
        store.recordSpend({ stage: SpendStage.Mind, ...spendRow });
      }
      assert.equal(store.lowestCharsPerToken('model/a'), 3);
      assert.equal(store.lowestCharsPerToken('model/b'), 1);
      assert.equal(store.lowestCharsPerToken('model/c'), null);
      assert.equal(store.lowestCharsPerToken('model/none'), null);
      assert.equal(store.lowestCharsPerTokenOverall(), 1);
      assert.throws(() => store.lowestCharsPerToken(''), RangeError);
    } finally {
      store.close();
    }
  });

  it('recordSpend stores promptChars, defaults it to null, and refuses bad values', () => {
    const store = new SqliteStore(':memory:');
    try {
      const stored = store.recordSpend({ stage: SpendStage.Composer, model: 'model/a', promptChars: 12, promptTokens: 4 });
      assert.equal(stored.promptChars, 12);
      const unmeasured = store.recordSpend({ stage: SpendStage.Composer, model: 'model/a', promptTokens: 4 });
      assert.equal(unmeasured.promptChars, null);
      for (const invalidValue of [-1, 1.5, '12']) {
        assert.throws(
          () => store.recordSpend({ stage: SpendStage.Composer, model: 'model/a', promptChars: invalidValue }),
          RangeError,
        );
      }
      assert.equal(store.lowestCharsPerToken('model/a'), 3);
    } finally {
      store.close();
    }
  });

  it('labels the Mind stage Brain and the Composer stage Narrator while keeping stored values', () => {
    assert.equal(SpendStage.label('mind'), 'Brain');
    assert.equal(SpendStage.label('composer'), 'Narrator');
    assert.equal(SpendStage.Mind, 'mind');
    assert.equal(SpendStage.Composer, 'composer');
  });
});

describe('SqliteStore.commitTurnPair extra player beats', () => {
  /**
   * @param {SqliteStore} store
   * @param {Array<Record<string, unknown>> | undefined} userExtraBeats
   * @returns {{pair: {userTurn: {id: string, seq: number, beats: Array<object>}, assistantTurn: {id: string}}, campaign: {id: string}}}
   * @throws {Error}
   */
  const commit = (store, userExtraBeats) => {
    const campaign = store.createCampaign({ title: 'Extra Beats', sceneState: buildSceneState('Courtyard', 1, []) });
    const lyra = store.createCharacter(campaign.id, {
      slug: 'lyra',
      name: 'Lyra',
      tier: CharacterTier.Main,
      avatarToken: AvatarToken.Indigo,
    });
    const pair = store.commitTurnPair({
      campaignId: campaign.id,
      userTurn: { mode: TurnMode.Normal, rawText: 'I wave.', witnessIds: [lyra.id] },
      userBeat: { speakerType: SpeakerType.Player, characterId: lyra.id, speakerName: 'Lyra', text: 'I wave.' },
      ...(userExtraBeats === undefined ? {} : { userExtraBeats }),
      assistantTurn: { mode: TurnMode.Normal, rawText: 'Hello.', witnessIds: [lyra.id] },
      assistantBeats: [{ speakerType: SpeakerType.Character, characterId: lyra.id, speakerName: 'Lyra', text: 'Hello.' }],
      nextSceneState: buildSceneState('Courtyard', 1, [lyra.id]),
    });
    return { pair, campaign };
  };

  it('stores extra beats after the player beat from seq 2 with the turn witnesses by default', () => {
    const store = new SqliteStore(':memory:');
    try {
      const { pair } = commit(store, [
        { speakerType: SpeakerType.Narrator, speakerName: ' Narrator ', text: 'Her hair is dyed black.' },
        { speakerType: SpeakerType.Narrator, characterId: null, speakerName: 'Narrator', text: 'Rain.', witnessIds: [] },
      ]);
      const beats = pair.userTurn.beats;

      assert.deepEqual(beats.map((beat) => [beat.seq, beat.speakerType, beat.speakerName, beat.text]), [
        [1, SpeakerType.Player, 'Lyra', 'I wave.'],
        [2, SpeakerType.Narrator, 'Narrator', 'Her hair is dyed black.'],
        [3, SpeakerType.Narrator, 'Narrator', 'Rain.'],
      ]);
      assert.deepEqual(beats[1].witnessIds, pair.userTurn.witnessIds);
      assert.deepEqual(beats[2].witnessIds, []);
      assert.equal(beats[1].mindPacket, null);
      assert.equal(pair.userTurn.rawText, 'I wave.');
    } finally {
      store.close();
    }
  });

  it('replaces only the assistant turn with commitAssistantTurn and leaves the player turn identical', () => {
    const store = new SqliteStore(':memory:');
    try {
      const { pair, campaign } = commit(store, [{ speakerType: SpeakerType.Narrator, speakerName: 'Narrator', text: 'Rain.' }]);
      const savedPlayerTurn = store.getTurn(campaign.id, pair.userTurn.id);
      const deleted = store.deleteLastAssistantTurn(campaign.id);
      assert.equal(deleted.deletedTurnId, pair.assistantTurn.id);

      const replacement = store.commitAssistantTurn({
        campaignId: campaign.id,
        userTurnId: pair.userTurn.id,
        assistantTurn: { mode: TurnMode.Normal, rawText: 'Again.', witnessIds: [] },
        assistantBeats: [{ speakerType: SpeakerType.Narrator, speakerName: 'Narrator', text: 'Again.' }],
        nextSceneState: buildSceneState('Courtyard', 1, []),
        spendIds: [],
      });

      assert.deepEqual(store.getTurn(campaign.id, pair.userTurn.id), savedPlayerTurn);
      assert.equal(replacement.seq, pair.userTurn.seq + 1);
      assert.equal(replacement.role, TurnRole.Assistant);
      assert.equal(store.listTurns(campaign.id, { limit: 50 }).total, 2);
      assert.throws(
        () => store.commitAssistantTurn({
          campaignId: campaign.id,
          userTurnId: pair.userTurn.id,
          assistantTurn: { mode: TurnMode.Normal, rawText: 'Twice.' },
          assistantBeats: [{ speakerType: SpeakerType.Narrator, speakerName: 'Narrator', text: 'Twice.' }],
          nextSceneState: buildSceneState('Courtyard', 1, []),
          spendIds: [],
        }),
        /not the given user turn/,
      );
      assert.equal(store.listTurns(campaign.id, { limit: 50 }).total, 2);
    } finally {
      store.close();
    }
  });

  it('stores one beat without the option or with an empty list', () => {
    const store = new SqliteStore(':memory:');
    try {
      assert.equal(commit(store, undefined).pair.userTurn.beats.length, 1);
      assert.equal(commit(store, []).pair.userTurn.beats.length, 1);
    } finally {
      store.close();
    }
  });

  it('refuses a bad extra beat and rolls the whole commit back', () => {
    const store = new SqliteStore(':memory:');
    try {
      const campaign = store.createCampaign({ title: 'Rollback', sceneState: buildSceneState('Courtyard', 1, []) });
      const lyra = store.createCharacter(campaign.id, {
        slug: 'lyra',
        name: 'Lyra',
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Indigo,
      });
      const narrator = { speakerType: SpeakerType.Narrator, speakerName: 'Narrator', text: 'y' };
      const badLists = [
        'text',
        [null],
        [{ ...narrator, speakerType: 'robot' }],
        [{ ...narrator, speakerName: '' }],
        [{ ...narrator, text: 5 }],
        [narrator, { ...narrator, characterId: 'phantom' }],
      ];
      const changesBefore = store.getLocalChangeSeq();
      for (const bad of badLists) {
        assert.throws(
          () => store.commitTurnPair({
            campaignId: campaign.id,
            userTurn: { mode: TurnMode.Normal, rawText: 'I wave.', witnessIds: [lyra.id] },
            userBeat: { speakerType: SpeakerType.Player, characterId: lyra.id, speakerName: 'Lyra', text: 'I wave.' },
            userExtraBeats: bad,
            assistantTurn: { mode: TurnMode.Normal, rawText: 'Hello.', witnessIds: [lyra.id] },
            assistantBeats: [{ speakerType: SpeakerType.Character, characterId: lyra.id, speakerName: 'Lyra', text: 'Hello.' }],
            nextSceneState: buildSceneState('Courtyard', 1, [lyra.id]),
          }),
          undefined,
          JSON.stringify(bad),
        );
      }
      assert.equal(store.listTurns(campaign.id, { limit: 50 }).total, 0);
      assert.equal(store.getLocalChangeSeq(), changesBefore);
    } finally {
      store.close();
    }
  });
});
