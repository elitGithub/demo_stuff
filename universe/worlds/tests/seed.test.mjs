import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ScribeAnalyzer } from '../src/scribe/ScribeAnalyzer.mjs';
import { ScribeAnswer } from '../src/scribe/ScribeAnswer.mjs';
import { ScribeCategory } from '../src/scribe/ScribeCategory.mjs';
import { ScribeKnowledge } from '../src/scribe/ScribeKnowledge.mjs';
import { ScribeLogCore } from '../src/scribe/ScribeLogCore.mjs';
import { ScribeReplay } from '../src/scribe/ScribeReplay.mjs';
import { ScribeText } from '../src/scribe/ScribeText.mjs';
import { CharacterCard } from '../src/store/CharacterCard.mjs';
import { CharacterTier } from '../src/store/enums/CharacterTier.mjs';
import { SceneType } from '../src/store/enums/SceneType.mjs';
import { SqliteStore } from '../src/store/SqliteStore.mjs';
import { ZetaSeeder } from '../scripts/seed-from-export.mjs';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SEED_SCRIPT_PATH = path.resolve(CURRENT_DIR, '../scripts/seed-from-export.mjs');

/**
 * @param {import('node:test').TestContext} testContext
 * @returns {string}
 * @throws {Error}
 */
function makeTempDir(testContext) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-seed-test-'));
  testContext.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  return tempDir;
}

/**
 * @param {string} directory
 * @param {string} fileName
 * @param {object} bundle
 * @returns {string}
 * @throws {Error}
 */
function writeBundle(directory, fileName, bundle) {
  const bundlePath = path.join(directory, fileName);
  fs.writeFileSync(bundlePath, JSON.stringify(bundle), 'utf8');
  return bundlePath;
}

/**
 * @param {string} messageId
 * @param {string} speaker
 * @param {string} attribution
 * @param {string} quote
 * @returns {object}
 */
function storyEvidence(messageId, speaker, attribution, quote) {
  return {
    section: 'FACTS',
    row: 1,
    messageNumber: 1,
    messageId,
    fingerprint: `fp-${messageId}`,
    blockNumber: 1,
    speaker,
    quote,
    attribution,
  };
}

/**
 * @returns {object}
 */
function buildScribeBundleFixture() {
  const storyLog = ScribeLogCore.create();
  storyLog.nextSubject = 10;
  storyLog.nextFact = 6;
  storyLog.nextThread = 3;
  storyLog.nextSequence = 3;
  storyLog.revision = 2;
  storyLog.read = { 'msg-obs-1': 1, 'msg-obs-2': 1, 'msg-obs-3': 1 };
  storyLog.entries = [
    {
      sequence: 1,
      kind: ScribeLogCore.Kind.Update,
      origin: ScribeLogCore.Origin.Story,
      messageIds: ['msg-obs-1', 'msg-obs-2', 'msg-obs-3'],
      operations: [
        { type: ScribeAnswer.Type.Subject, subject: 'S1', label: 'Corin Vale', kind: 'character' },
        { type: ScribeAnswer.Type.Subject, subject: 'S2', label: 'Tamsin Locke', kind: 'character' },
        { type: ScribeAnswer.Type.Subject, subject: 'S3', label: 'Bramwell', kind: 'character' },
        { type: ScribeAnswer.Type.Subject, subject: 'S4', label: 'Brass Observatory', kind: 'place' },
        { type: ScribeAnswer.Type.Subject, subject: 'S5', label: 'Old Corin', kind: 'character' },
        { type: ScribeAnswer.Type.Subject, subject: 'S6', label: 'Narrator', kind: 'character' },
        { type: ScribeAnswer.Type.Subject, subject: 'S7', label: 'Wren Ashby', kind: 'character' },
        { type: ScribeAnswer.Type.Subject, subject: 'S8', label: 'Dorian Cross', kind: 'character' },
        { type: ScribeAnswer.Type.Subject, subject: 'S9', label: 'Dorian Cross', kind: 'character' },
        { type: ScribeAnswer.Type.Alias, subject: 'S1', name: 'Night Watchman', cite: 'msg-obs-1', position: 1, other: null },
        { type: ScribeAnswer.Type.Alias, subject: 'S2', name: 'Lantern Keeper', cite: 'msg-obs-2', position: 2, other: null },
        {
          type: ScribeAnswer.Type.Fact,
          fact: 'F1',
          subject: 'S1',
          label: 'Corin Vale',
          category: 'eyes',
          target: null,
          targetText: null,
          other: null,
          text: 'amber',
          cite: 'msg-obs-1',
          position: 1,
          hidden: false,
          evidence: storyEvidence('msg-obs-1', 'Tamsin Locke', 'witnessed', 'His amber eyes caught the lamp.'),
        },
        {
          type: ScribeAnswer.Type.Fact,
          fact: 'F2',
          subject: 'S2',
          label: 'Tamsin Locke',
          category: 'relation',
          target: 'S1',
          targetText: 'Corin Vale',
          other: null,
          text: 'guards the star-chart vault with Corin',
          cite: 'msg-obs-2',
          position: 2,
          hidden: true,
          evidence: { messageId: 'msg-obs-2', fingerprint: 'fp-msg-obs-2' },
        },
        {
          type: ScribeAnswer.Type.Fact,
          fact: 'F3',
          subject: 'S4',
          label: 'Brass Observatory',
          category: 'feature',
          target: null,
          targetText: null,
          other: null,
          text: 'cracked brass dome',
          cite: 'msg-obs-3',
          position: 3,
          hidden: false,
        },
        {
          type: ScribeAnswer.Type.Fact,
          fact: 'F4',
          subject: 'S3',
          label: 'Bramwell',
          category: 'location',
          target: null,
          targetText: null,
          other: null,
          text: 'hiding in the bell tower',
          cite: 'msg-obs-3',
          position: 3,
          hidden: false,
          evidence: storyEvidence('msg-obs-3', 'Tamsin Locke', 'claimed', 'Bramwell is up in the bell tower, I swear it.'),
        },
        {
          type: ScribeAnswer.Type.Fact,
          fact: 'F5',
          subject: 'S7',
          label: 'Wren Ashby',
          category: 'location',
          target: null,
          targetText: null,
          other: null,
          text: 'waiting at the north dock',
          cite: 'msg-obs-1',
          position: 1,
          hidden: false,
        },
        { type: ScribeAnswer.Type.End, fact: 'F5', reason: 'left the dock', cite: 'msg-obs-3', position: 3 },
        { type: ScribeAnswer.Type.Told, fact: 'F2', subject: 'S7', cite: 'msg-obs-3', position: 3 },
        {
          type: ScribeAnswer.Type.ThreadOpen,
          thread: 'T1',
          text: 'Who cracked the astrolabe lens before dawn?',
          cite: 'msg-obs-3',
          position: 3,
          subject: 'S4',
        },
        { type: ScribeAnswer.Type.ThreadOpen, thread: 'T2', text: 'Who paid the bell ringer?', cite: 'msg-obs-1', position: 1 },
        { type: ScribeAnswer.Type.ThreadClose, thread: 'T2', how: 'answered', cite: 'msg-obs-3', position: 3 },
        {
          type: ScribeAnswer.Type.Scene,
          day: 4,
          first: 'msg-obs-1',
          last: 'msg-obs-3',
          firstPosition: 1,
          lastPosition: 3,
          place: 'Brass Observatory',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: 'S1', label: 'Corin Vale', from: null, until: null },
            { subject: 'S5', label: 'Old Corin', from: null, until: null },
            { subject: 'S2', label: 'Tamsin Locke', from: null, until: null },
            { subject: 'S3', label: 'Bramwell', from: null, until: 2 },
          ],
          summary: 'Corin and Tamsin inspect the shattered astrolabe while Bramwell slips away.',
          evidence: { ...storyEvidence('msg-obs-3', 'Corin Vale', 'witnessed', 'The bell struck midnight.'), time: 'Midnight' },
        },
      ],
      withdrawn: false,
    },
    {
      sequence: 2,
      kind: ScribeLogCore.Kind.Operator,
      origin: ScribeLogCore.Origin.Operator,
      messageIds: [],
      operations: [
        { type: ScribeLogCore.Ruling.Merge, from: 'S5', into: 'S1' },
        { type: ScribeLogCore.Ruling.Narrow, scene: 'msg-obs-1' },
      ],
      withdrawn: false,
    },
  ];

  return {
    roomId: 'room-observatory-01',
    generations: { campaign: 1, book: 2, live: null, settings: 1 },
    damaged: [],
    raw: {},
    campaign: {
      messages: [
        { id: 'msg-obs-1', sender: 'narrator@observatory.example', contents: [] },
        { id: 'msg-obs-2', sender: 'narrator@observatory.example', contents: [] },
        { id: 'msg-obs-3', sender: 'narrator@observatory.example', contents: [] },
      ],
      gone: [],
      completeHistory: true,
    },
    book: {
      log: storyLog,
      fingerprints: {
        'msg-obs-1': 'fp-msg-obs-1',
        'msg-obs-2': 'fp-msg-obs-2',
        'msg-obs-3': 'fp-msg-obs-3',
      },
      adopted: true,
      projections: {},
    },
    live: null,
    settings: {},
  };
}

/**
 * @param {object} bundle
 * @returns {object[]}
 */
function storyOperations(bundle) {
  return bundle.book.log.entries[0].operations;
}

/**
 * @param {object} bundle
 * @returns {object}
 */
function sceneOperation(bundle) {
  return storyOperations(bundle).find((operation) => operation.type === ScribeAnswer.Type.Scene);
}

/**
 * @param {object} bundle
 * @returns {string}
 * @throws {TypeError}
 */
function bundleText(bundle) {
  return JSON.stringify(bundle);
}

test('ZetaSeeder enforces the fs.realpathSync path guard against outside paths and symlink escapes', (testContext) => {
  const allowedDir = makeTempDir(testContext);
  const outsideDir = makeTempDir(testContext);
  const outsideFile = writeBundle(outsideDir, 'secret-export.json', buildScribeBundleFixture());

  const symlinkPath = path.join(allowedDir, 'escape-link.json');
  fs.symlinkSync(outsideFile, symlinkPath);

  assert.throws(
    () => ZetaSeeder.resolveSafeExportPath(symlinkPath, [allowedDir]),
    /Security check failed.*resolves outside/,
  );
  assert.throws(
    () => ZetaSeeder.run({ exportPath: symlinkPath, dryRun: true, allowedRoots: [allowedDir] }),
    /Security check failed.*resolves outside/,
  );
  assert.throws(
    () => ZetaSeeder.resolveSafeExportPath('/etc/passwd'),
    /Security check failed|Cannot read export file/,
  );
  assert.throws(
    () => ZetaSeeder.resolveSafeExportPath(allowedDir, [allowedDir]),
    /not a regular file/,
  );
  assert.throws(
    () => ZetaSeeder.resolveSafeExportPath(`${allowedDir}/a\0b.json`, [allowedDir]),
    /non-empty valid filesystem path/,
  );
  assert.equal(
    ZetaSeeder.resolveSafeExportPath(outsideFile, [outsideDir]),
    fs.realpathSync(outsideFile),
  );

  assert.throws(
    () => execFileSync(process.execPath, [SEED_SCRIPT_PATH, '/etc/passwd', '--dry-run'], { encoding: 'utf8', stdio: 'pipe' }),
    (error) => error.status !== 0 && /Security check failed|Cannot read export file/.test(String(error.stderr)),
  );
});

test('ZetaSeeder refuses anything that is not a complete Zeta Scribe export', () => {
  /**
   * @param {(bundle: object) => void} mutate
   * @returns {string}
   * @throws {TypeError}
   */
  const mutated = (mutate) => {
    const bundle = buildScribeBundleFixture();
    mutate(bundle);
    return bundleText(bundle);
  };

  assert.throws(() => ZetaSeeder.parseExport(''), /empty/);
  assert.throws(() => ZetaSeeder.parseExport('{truncated'), /invalid JSON/);
  assert.throws(() => ZetaSeeder.parseExport('[]'), /JSON object/);
  assert.throws(() => ZetaSeeder.parseExport('"bundle"'), /JSON object/);
  assert.throws(() => ZetaSeeder.parseExport('null'), /JSON object/);

  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    delete bundle.damaged;
  })), /damaged list must be an array/);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.damaged = ['book'];
  })), /marks "book" as damaged/);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.damaged = ['live', 'campaign', 'book'];
  })), /marks "campaign", "book" as damaged/);
  assert.equal(
    ZetaSeeder.parseExport(mutated((bundle) => {
      bundle.damaged = ['live', 'settings'];
    })).characters.length,
    6,
  );

  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.book = null;
  })), /book must be an object/);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.book = [bundle.book];
  })), /book must be an object/);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    delete bundle.book.log.read;
  })), /book\.log\.read must be an object/);

  const entriesPattern = /book\.log\.entries must be an array of entry objects, each with an operations array of objects/;
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    delete bundle.book.log;
  })), entriesPattern);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.book.log.entries = {};
  })), entriesPattern);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.book.log.entries.push(null);
  })), entriesPattern);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    delete bundle.book.log.entries[1].operations;
  })), entriesPattern);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.book.log.entries[1].operations.push('Merge');
  })), entriesPattern);

  const messagesPattern = /campaign\.messages must be a non-empty array/;
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.campaign.messages = [];
  })), messagesPattern);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.campaign = null;
  })), messagesPattern);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.messages = bundle.campaign.messages;
    delete bundle.campaign;
  })), messagesPattern);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.campaign.messages = ['msg-obs-1', 'msg-obs-2', 'msg-obs-3'];
  })), /objects with a string id/);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    delete bundle.campaign.completeHistory;
  })), /history is incomplete/);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.campaign.completeHistory = 1;
  })), /history is incomplete/);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.campaign.needsHistory = true;
  })), /needs history/);

  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.campaign.messages = bundle.campaign.messages.slice(0, 2);
  })), /Story entry 1 cites messages missing from campaign\.messages/);
  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    delete bundle.book.log.entries[0].messageIds;
  })), /Story entry 1 cites messages missing/);
  assert.doesNotThrow(() => ZetaSeeder.parseExport(mutated((bundle) => {
    bundle.book.log.entries[0].withdrawn = true;
    bundle.campaign.messages = bundle.campaign.messages.slice(0, 1);
  })));

  assert.throws(
    () => ZetaSeeder.parseExport(mutated((bundle) => {
      bundle.book.log.entries[0].retired = 5;
    })),
    (error) => /^Scribe log could not be replayed: /.test(error.message) && error.cause instanceof TypeError,
  );

  assert.throws(() => ZetaSeeder.parseExport(mutated((bundle) => {
    storyOperations(bundle)[0].label = ['Corin', 'Vale'];
  })), /Subject S1 has no usable label/);
});

test('ZetaSeeder refuses the removed input shapes: pre-replayed books, bare logs, top-level messages, hand-written casts', () => {
  const bundle = buildScribeBundleFixture();
  assert.throws(() => ZetaSeeder.parseExport(bundleText(bundle.book.log)), /damaged list must be an array/);
  assert.throws(() => ZetaSeeder.parseExport(bundleText({ ...bundle.book.log, damaged: [] })), /book must be an object/);
  assert.throws(
    () => ZetaSeeder.parseExport(bundleText({ damaged: [], scribe: { log: bundle.book.log }, campaign: bundle.campaign })),
    /book must be an object/,
  );
  assert.throws(
    () => ZetaSeeder.parseExport(bundleText({
      damaged: [],
      book: { subjects: [{ id: 'S1', label: 'Marlowe', kind: 'character' }], facts: [], adopted: true },
      campaign: bundle.campaign,
    })),
    /book\.log\.entries must be an array/,
  );
  assert.throws(
    () => ZetaSeeder.parseExport(bundleText({
      damaged: [],
      title: 'Hand Cast',
      playerName: 'Marlowe',
      characters: [{ name: 'Marlowe', isPlayer: true }],
    })),
    /book must be an object/,
  );

  const handWritten = buildScribeBundleFixture();
  handWritten.title = 'Ignored Title';
  handWritten.premise = 'Ignored premise.';
  handWritten.playerName = 'Corin Vale';
  handWritten.characters = [{ name: 'Phantom Guest', isPlayer: true, tier: 'main' }];
  handWritten.sceneState = { location: 'Ignored Pier', sceneType: 'public' };
  const parsed = ZetaSeeder.parseExport(bundleText(handWritten));
  assert.equal(parsed.title, 'Seeded Campaign');
  assert.equal(parsed.characters.some((character) => character.isPlayer), false);
  assert.equal(parsed.characters.some((character) => character.name === 'Phantom Guest'), false);
  assert.equal(parsed.initialScene.location, 'Brass Observatory');
  assert.equal(Object.hasOwn(parsed, 'premise'), false);
});

test('ZetaSeeder dry-run summarizes the replayed export without creating the SQLite file', (testContext) => {
  const workDir = makeTempDir(testContext);
  const exportPath = writeBundle(workDir, 'observatory.json', buildScribeBundleFixture());
  const dbPath = path.join(workDir, 'nested', 'never-created.sqlite');

  const summary = ZetaSeeder.run({ exportPath, dbPath, dryRun: true, allowedRoots: [workDir] });
  assert.deepEqual(summary, {
    exportPath: fs.realpathSync(exportPath),
    title: 'Seeded Campaign',
    player: null,
    characters: 6,
    subjects: 7,
    facts: 2,
    relations: 1,
    claims: 1,
    threads: 1,
    turns: 0,
    readThrough: 3,
    chatMessages: 3,
    dryRun: true,
  });
  assert.equal(fs.existsSync(dbPath), false);
  assert.equal(fs.existsSync(path.dirname(dbPath)), false);

  const withPlayer = ZetaSeeder.run({ exportPath, dbPath, dryRun: true, playerRef: 'Lantern Keeper', allowedRoots: [workDir] });
  assert.equal(withPlayer.player, 'Tamsin Locke');
  assert.equal(fs.existsSync(dbPath), false);
});

test('ZetaSeeder seeds campaign, cast and an Operator-only Scribe book that replays with claims, speakers and audiences intact', (testContext) => {
  const workDir = makeTempDir(testContext);
  const exportPath = writeBundle(workDir, 'observatory.json', buildScribeBundleFixture());
  const dbPath = path.join(workDir, 'worlds-seed.sqlite');

  const result = ZetaSeeder.run({
    exportPath,
    dbPath,
    title: 'Observatory Vigil',
    playerRef: 'corin-vale',
    mainRefs: ['wren-ashby'],
    allowedRoots: [workDir],
  });
  assert.equal(result.dryRun, false);
  assert.equal(result.title, 'Observatory Vigil');
  assert.equal(result.player, 'Corin Vale');
  assert.equal(result.replacedExisting, false);

  const store = new SqliteStore(dbPath);
  try {
    const campaign = store.getCampaign(result.campaignId);
    assert.equal(campaign.title, 'Observatory Vigil');
    assert.equal(campaign.sceneState.location, 'Brass Observatory');
    assert.equal(campaign.sceneState.day, 4);
    assert.equal(campaign.sceneState.timeLabel, 'Midnight');
    assert.equal(campaign.sceneState.sceneType, SceneType.Private);

    const castPage = store.listCharacters(campaign.id, { includeArchived: true, limit: 25 });
    assert.equal(castPage.items.length, 6);
    assert.equal(castPage.items.some((character) => character.name === 'Narrator'), false);
    assert.equal(castPage.items.some((character) => character.name === 'Old Corin'), false);
    const bySlug = new Map(castPage.items.map((character) => [character.slug, character]));
    const corin = bySlug.get('corin-vale');
    const tamsin = bySlug.get('tamsin-locke');
    const bramwell = bySlug.get('bramwell');
    const wren = bySlug.get('wren-ashby');
    const dorianFirst = bySlug.get('dorian-cross');
    const dorianSecond = bySlug.get('dorian-cross-2');
    for (const character of [corin, tamsin, bramwell, wren, dorianFirst, dorianSecond]) {
      assert.ok(character);
      assert.match(character.slug, /^[a-z0-9][a-z0-9_-]{0,47}$/);
    }
    assert.equal(corin.scribeSubjectId, 'S1');
    assert.equal(dorianSecond.scribeSubjectId, 'S9');
    assert.equal(corin.isPlayer, true);
    assert.equal(campaign.playerCharacterId, corin.id);
    assert.equal(castPage.items.filter((character) => character.isPlayer).length, 1);
    assert.ok(corin.aliases.includes('Night Watchman'));
    assert.ok(corin.aliases.includes('Old Corin'));
    assert.ok(tamsin.aliases.includes('Lantern Keeper'));
    for (const character of castPage.items) {
      assert.deepEqual(character.card.toObject(), CharacterCard.empty().toObject());
    }
    assert.equal(Object.hasOwn(corin, 'persona'), false);
    assert.equal(corin.tier, CharacterTier.Main);
    assert.equal(tamsin.tier, CharacterTier.Main);
    assert.equal(bramwell.tier, CharacterTier.Main);
    assert.equal(wren.tier, CharacterTier.Main);
    assert.equal(dorianFirst.tier, CharacterTier.Recurring);
    assert.equal(dorianSecond.tier, CharacterTier.Recurring);

    assert.deepEqual([...campaign.sceneState.presentIds].sort(), [corin.id, tamsin.id].sort());

    const bookRecord = store.getScribeBook(campaign.id);
    assert.equal(bookRecord.lastTurnSeq, 0);
    assert.equal(bookRecord.dirty, false);
    const savedLog = JSON.parse(bookRecord.bookJson);
    for (const entry of savedLog.entries) {
      assert.equal(entry.origin, ScribeLogCore.Origin.Operator);
      assert.equal(entry.kind, ScribeLogCore.Kind.Operator);
      assert.deepEqual(entry.messageIds, []);
      for (const operation of entry.operations) {
        if (operation.position !== undefined) {
          assert.equal(operation.position, 0);
        }
        if (operation.cite !== undefined) {
          assert.equal(operation.cite, null);
        }
        if (operation.evidence !== undefined) {
          assert.deepEqual(Object.keys(operation.evidence).sort(), ['attribution', 'speaker']);
        }
      }
    }

    const replayed = ScribeReplay.run(savedLog, []);
    const liveSubjects = replayed.subjects.filter((subject) => subject.mergedInto === null);
    assert.deepEqual(liveSubjects.map((subject) => subject.id).sort(), ['S1', 'S2', 'S3', 'S4', 'S7', 'S8', 'S9']);
    assert.equal(replayed.subjects.some((subject) => subject.label === 'Narrator'), false);

    assert.equal(replayed.facts.length, 4);
    for (const fact of replayed.facts) {
      assert.equal(fact.origin, ScribeLogCore.Origin.Operator);
      assert.equal(fact.position, 0);
      assert.equal(fact.cite, null);
    }
    assert.equal(replayed.facts.some((fact) => fact.text === 'waiting at the north dock'), false);
    assert.equal(replayed.facts.filter((fact) => ScribeReplay.live(fact)).length, 3);

    const labels = ScribeAnalyzer.labels(replayed);
    const claim = replayed.facts.find((fact) => fact.text === 'hiding in the bell tower');
    assert.equal(claim.status, ScribeReplay.Status.Reported);
    assert.equal(claim.subject, 'S3');
    assert.deepEqual(claim.evidence, { attribution: 'claimed', speaker: 'Tamsin Locke' });
    assert.match(ScribeAnalyzer.statement(claim, labels), /\[claimed by Tamsin Locke\]$/);

    const witnessed = replayed.facts.find((fact) => fact.text === 'amber');
    assert.equal(witnessed.status, ScribeReplay.Status.InForce);
    assert.deepEqual(witnessed.evidence, { attribution: 'witnessed', speaker: 'Tamsin Locke' });
    assert.doesNotMatch(ScribeAnalyzer.statement(witnessed, labels), /witnessed by/);

    const vault = replayed.facts.find((fact) => fact.category === 'relation');
    assert.equal(vault.status, ScribeReplay.Status.InForce);
    assert.equal(vault.target, 'S1');
    assert.equal(vault.hidden, true);
    assert.equal(Object.hasOwn(vault, 'evidence'), false);
    assert.equal(ScribeKnowledge.knows(replayed, 'S2', vault), true);
    assert.equal(ScribeKnowledge.knows(replayed, 'S7', vault), true);
    assert.equal(ScribeKnowledge.knows(replayed, 'S3', vault), false);

    assert.equal(replayed.threads.length, 1);
    assert.equal(replayed.threads[0].text, 'Who cracked the astrolabe lens before dawn?');
    assert.equal(replayed.threads[0].subject, 'S4');
    assert.equal(replayed.threads[0].origin, ScribeLogCore.Origin.Operator);
    assert.equal(replayed.threads[0].position, 0);
    assert.equal(replayed.threads[0].cite, null);
  } finally {
    store.close();
  }
});

test('ZetaSeeder refuses a duplicate title unless --title or --force is given', (testContext) => {
  const workDir = makeTempDir(testContext);
  const exportPath = writeBundle(workDir, 'observatory.json', buildScribeBundleFixture());
  const dbPath = path.join(workDir, 'duplicate-guard.sqlite');

  const firstRun = ZetaSeeder.run({ exportPath, dbPath, allowedRoots: [workDir] });
  assert.equal(firstRun.title, 'Seeded Campaign');
  assert.throws(() => ZetaSeeder.run({ exportPath, dbPath, allowedRoots: [workDir] }), /already exists/);

  const distinctTitleRun = ZetaSeeder.run({ exportPath, dbPath, title: '  Observatory Copy  ', allowedRoots: [workDir] });
  assert.equal(distinctTitleRun.title, 'Observatory Copy');
  assert.notEqual(distinctTitleRun.campaignId, firstRun.campaignId);

  const forcedRun = ZetaSeeder.run({ exportPath, dbPath, force: true, allowedRoots: [workDir] });
  assert.equal(forcedRun.replacedExisting, true);
  assert.notEqual(forcedRun.campaignId, firstRun.campaignId);

  const store = new SqliteStore(dbPath);
  try {
    assert.equal(store.listCampaigns({ limit: 50 }).total, 2);
    assert.equal(store.getCampaign(firstRun.campaignId), null);
    assert.ok(store.getCampaign(distinctTitleRun.campaignId));
    assert.equal(store.listCharacters(forcedRun.campaignId, { limit: 25 }).items.length, 6);
  } finally {
    store.close();
  }

  assert.throws(
    () => ZetaSeeder.run({ exportPath, dbPath: `${workDir}/bad\0name.sqlite`, title: 'Nul Path', allowedRoots: [workDir] }),
    /Invalid SQLite database path/,
  );
  assert.throws(() => ZetaSeeder.run({ exportPath, dbPath, title: '   ', allowedRoots: [workDir] }), /title cannot be empty/);
});

test('ZetaSeeder matches --player and --main by slug, name, alias or subject id and refuses misses and ambiguity', () => {
  const fixtureText = bundleText(buildScribeBundleFixture());
  /**
   * @param {object} options
   * @returns {Map<string, object>}
   * @throws {Error}
   */
  const castFor = (options) => {
    return new Map(ZetaSeeder.parseExport(fixtureText, options).characters.map((character) => [character.slug, character]));
  };
  /**
   * @param {object} options
   * @returns {string[]}
   * @throws {Error}
   */
  const playersFor = (options) => {
    return ZetaSeeder.parseExport(fixtureText, options).characters
      .filter((character) => character.isPlayer)
      .map((character) => character.subjectId);
  };

  assert.deepEqual(playersFor({}), []);
  assert.deepEqual(playersFor({ playerRef: 'CORIN-VALE' }), ['S1']);
  assert.deepEqual(playersFor({ playerRef: 'Bramwell' }), ['S3']);
  assert.deepEqual(playersFor({ playerRef: 'the Lantern Keeper-san' }), ['S2']);
  assert.deepEqual(playersFor({ playerRef: 'Old Corin' }), ['S1']);
  assert.deepEqual(playersFor({ playerRef: 's7' }), ['S7']);
  assert.deepEqual(playersFor({ playerRef: 'dorian-cross-2' }), ['S9']);
  assert.deepEqual(playersFor({ playerRef: '  S8  ' }), ['S8']);

  const playerCast = castFor({ playerRef: 's8' });
  assert.equal(playerCast.get('dorian-cross').tier, CharacterTier.Main);
  assert.equal(playerCast.get('wren-ashby').tier, CharacterTier.Recurring);

  assert.throws(
    () => ZetaSeeder.parseExport(fixtureText, { playerRef: 'Dorian Cross' }),
    /Player character "Dorian Cross" is ambiguous.*Dorian Cross \(dorian-cross\), Dorian Cross \(dorian-cross-2\)/,
  );
  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { playerRef: 'Narrator' }), /"Narrator" did not match any character/);
  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { playerRef: 'Brass Observatory' }), /did not match any character/);
  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { playerRef: 'S5' }), /"S5" did not match any character/);
  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { playerRef: 'unknown-wanderer' }), /unknown-wanderer/);
  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { playerRef: '...' }), /normalizes to an empty name/);
  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { playerRef: '' }), /cannot be empty/);
  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { playerRef: '   ' }), /cannot be empty/);
  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { playerRef: 42 }), TypeError);

  const mainCast = castFor({ mainRefs: ['wren-ashby', 'S9'] });
  assert.equal(mainCast.get('wren-ashby').tier, CharacterTier.Main);
  assert.equal(mainCast.get('dorian-cross-2').tier, CharacterTier.Main);
  assert.equal(mainCast.get('dorian-cross').tier, CharacterTier.Recurring);
  assert.equal(mainCast.get('corin-vale').tier, CharacterTier.Main);

  const aliasMain = castFor({ mainRefs: ['Lantern Keeper'], playerRef: 'Wren Ashby' });
  assert.equal(aliasMain.get('tamsin-locke').tier, CharacterTier.Main);
  assert.equal(aliasMain.get('wren-ashby').isPlayer, true);
  assert.equal(aliasMain.get('wren-ashby').tier, CharacterTier.Main);

  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { mainRefs: ['ghost'] }), /Main character "ghost" did not match any character/);
  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { mainRefs: ['wren-ashby', 'ghost'] }), /"ghost"/);
  assert.throws(
    () => ZetaSeeder.parseExport(fixtureText, { mainRefs: ['Dorian Cross'] }),
    /Main character "Dorian Cross" is ambiguous/,
  );
  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { mainRefs: ['...'] }), /normalizes to an empty name/);
  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { mainRefs: [' '] }), /cannot contain empty references/);
  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { mainRefs: 'wren-ashby' }), TypeError);
  assert.throws(() => ZetaSeeder.parseExport(fixtureText, { mainRefs: [7] }), TypeError);
});

test('ZetaSeeder builds the opening scene from the last replayed scene: reach, narrowing, time, departures and fallbacks', (testContext) => {
  /**
   * @param {(bundle: object) => void} mutate
   * @returns {object}
   * @throws {Error}
   */
  const sceneFor = (mutate) => {
    const bundle = buildScribeBundleFixture();
    mutate(bundle);
    return ZetaSeeder.parseExport(bundleText(bundle)).initialScene;
  };

  assert.deepEqual(sceneFor(() => {}), {
    day: 4,
    timeLabel: 'Midnight',
    location: 'Brass Observatory',
    sceneType: SceneType.Private,
    presentSubjectIds: ['S1', 'S2'],
  });

  /**
   * @param {object} bundle
   * @returns {void}
   */
  const unnarrow = (bundle) => {
    bundle.book.log.entries[1].operations = bundle.book.log.entries[1].operations
      .filter((operation) => operation.type !== ScribeLogCore.Ruling.Narrow);
  };
  assert.equal(sceneFor(unnarrow).sceneType, SceneType.Public);
  assert.equal(sceneFor((bundle) => {
    unnarrow(bundle);
    sceneOperation(bundle).reach = ScribeAnswer.Reach.Private;
  }).sceneType, SceneType.Private);

  const plainScene = sceneFor((bundle) => {
    delete sceneOperation(bundle).evidence;
    sceneOperation(bundle).place = '   ';
  });
  assert.equal(plainScene.timeLabel, 'Daytime');
  assert.equal(plainScene.location, 'Opening Scene');

  assert.deepEqual(sceneFor((bundle) => {
    sceneOperation(bundle).present.push({ subject: 'S7', label: 'Wren Ashby', from: 2, until: 3 });
  }).presentSubjectIds, ['S1', 'S2']);

  assert.deepEqual(sceneFor((bundle) => {
    const operations = storyOperations(bundle);
    operations.splice(operations.indexOf(sceneOperation(bundle)), 1);
    unnarrow(bundle);
  }), {
    day: 1,
    timeLabel: 'Daytime',
    location: 'Opening Scene',
    sceneType: SceneType.Public,
    presentSubjectIds: [],
  });

  const workDir = makeTempDir(testContext);
  const emptyPresent = buildScribeBundleFixture();
  sceneOperation(emptyPresent).present = [
    { subject: 'S4', label: 'Brass Observatory', from: null, until: null },
    { subject: 'S3', label: 'Bramwell', from: null, until: 2 },
  ];
  const exportPath = writeBundle(workDir, 'empty-present.json', emptyPresent);
  const dbPath = path.join(workDir, 'empty-present.sqlite');
  const seeded = ZetaSeeder.run({ exportPath, dbPath, allowedRoots: [workDir] });
  const store = new SqliteStore(dbPath);
  try {
    const campaign = store.getCampaign(seeded.campaignId);
    const castPage = store.listCharacters(campaign.id, { limit: 25 });
    const mainIds = castPage.items.filter((character) => character.tier === CharacterTier.Main).map((character) => character.id);
    assert.equal(mainIds.length, 3);
    assert.deepEqual([...campaign.sceneState.presentIds].sort(), mainIds.sort());
    assert.equal(campaign.playerCharacterId, null);
  } finally {
    store.close();
  }
});

test('ZetaSeeder clamps names and aliases without splitting surrogate pairs', () => {
  assert.equal(ZetaSeeder.clampText(`  ${'A'.repeat(59)}\u{1F600}tail  `, 60), 'A'.repeat(59));
  assert.equal(ZetaSeeder.clampText(`${'A'.repeat(58)}\u{1F600}tail`, 60), `${'A'.repeat(58)}\u{1F600}`);
  assert.equal(ZetaSeeder.clampText(`${'A'.repeat(50)}          ${'B'.repeat(20)}`, 60), 'A'.repeat(50));

  const bundle = buildScribeBundleFixture();
  const operations = storyOperations(bundle);
  operations.push(
    { type: ScribeAnswer.Type.Subject, subject: 'S10', label: `  ${'A'.repeat(59)}\u{1F600} Longname`, kind: 'character' },
    { type: ScribeAnswer.Type.Alias, subject: 'S10', name: `${'B'.repeat(59)}\u{1F600}`, cite: 'msg-obs-1', position: 1, other: null },
  );
  const parsed = ZetaSeeder.parseExport(bundleText(bundle), { playerRef: 'S10' });
  const longNamed = parsed.characters.find((character) => character.subjectId === 'S10');
  assert.equal(longNamed.name, 'A'.repeat(59));
  assert.equal(longNamed.isPlayer, true);
  assert.ok(longNamed.aliases.includes('B'.repeat(59)));
  for (const character of parsed.characters) {
    assert.ok(character.name.length <= ScribeAnswer.Settings.MaxLabel);
    assert.equal(/[\uD800-\uDBFF]$/.test(character.name), false);
  }

  const materialized = ZetaSeeder.materializeScribeLog(parsed);
  const subjectsByLabel = new Map(materialized.state.subjects.map((subject) => [subject.label, subject]));
  assert.ok(subjectsByLabel.has('A'.repeat(59)));
  assert.equal(new Set(materialized.state.subjects.map((subject) => subject.id)).size, materialized.state.subjects.length);
});

test('ZetaSeeder CLI parsing rejects repeated flags and empty --main, and accepts dash-led values that are not flags', () => {
  const parsedArgs = ZetaSeeder.parseCliArgs(['bundle.json', '--player', 'dorian-cross-2', '--main', 'wren, ,S3', '--dry-run']);
  assert.equal(parsedArgs.exportPath, 'bundle.json');
  assert.equal(parsedArgs.playerRef, 'dorian-cross-2');
  assert.deepEqual(parsedArgs.mainRefs, ['wren', 'S3']);
  assert.equal(parsedArgs.dryRun, true);
  assert.equal(parsedArgs.force, false);
  assert.equal(parsedArgs.title, null);

  const defaults = ZetaSeeder.parseCliArgs([]);
  assert.equal(defaults.playerRef, null);
  assert.deepEqual(defaults.mainRefs, []);
  assert.match(defaults.exportPath, /hero_gone_latest_updated\.json$/);

  assert.equal(ZetaSeeder.parseCliArgs(['--player', '-x']).playerRef, '-x');
  assert.equal(ZetaSeeder.parseCliArgs(['--title', '-t']).title, '-t');
  assert.equal(ZetaSeeder.parseCliArgs(['--db', '-f']).dbPath, '-f');
  assert.deepEqual(ZetaSeeder.parseCliArgs(['--main', '-m,--x']).mainRefs, ['-m', '--x']);
  assert.equal(ZetaSeeder.parseCliArgs(['--player', ' -v ']).playerRef, '-v');

  for (const flag of ['--title', '--db', '--main', '--player']) {
    assert.throws(() => ZetaSeeder.parseCliArgs([flag]), /requires a non-empty value/);
    assert.throws(() => ZetaSeeder.parseCliArgs([flag, '   ']), /requires a non-empty value/);
    for (const known of ['--title', '--db', '--main', '--player', '--dry-run', '--force', '--help', '-h']) {
      assert.throws(() => ZetaSeeder.parseCliArgs([flag, known]), /requires a non-empty value/);
    }
  }
  assert.throws(() => ZetaSeeder.parseCliArgs(['--player', ' --force ']), /requires a non-empty value/);

  assert.throws(() => ZetaSeeder.parseCliArgs(['--title', 'One', '--title', 'Two']), /--title was given more than once/);
  assert.throws(() => ZetaSeeder.parseCliArgs(['--player', 'a', '--player', 'b']), /--player was given more than once/);
  assert.throws(() => ZetaSeeder.parseCliArgs(['--main', 'a', '--main', 'b']), /--main was given more than once/);
  assert.throws(() => ZetaSeeder.parseCliArgs(['--db', 'a.sqlite', '--db', 'b.sqlite']), /--db was given more than once/);
  assert.throws(() => ZetaSeeder.parseCliArgs(['--dry-run', '--dry-run']), /--dry-run was given more than once/);
  assert.throws(() => ZetaSeeder.parseCliArgs(['--force', '--force']), /--force was given more than once/);
  assert.throws(() => ZetaSeeder.parseCliArgs(['--help', '-h']), /--help was given more than once/);
  assert.throws(() => ZetaSeeder.parseCliArgs(['-h', '-h']), /--help was given more than once/);

  assert.throws(() => ZetaSeeder.parseCliArgs(['--main', ',']), /--main requires at least one non-empty reference/);
  assert.throws(() => ZetaSeeder.parseCliArgs(['--main', ' , ,']), /--main requires at least one non-empty reference/);

  assert.throws(() => ZetaSeeder.parseCliArgs(['--bogus']), /Unknown CLI flag: --bogus/);
  assert.throws(() => ZetaSeeder.parseCliArgs(['a.json', 'b.json']), /Unexpected extra positional argument/);
  assert.throws(() => ZetaSeeder.parseCliArgs([123]), TypeError);
  assert.throws(() => ZetaSeeder.parseCliArgs(['--dry-run', null]), TypeError);
  assert.throws(() => ZetaSeeder.parseCliArgs('--dry-run'), TypeError);

  const helpOutput = execFileSync(process.execPath, [SEED_SCRIPT_PATH, '--help'], { encoding: 'utf8', stdio: 'pipe' });
  assert.match(helpOutput, /\[--player <slugNameAliasOrSubjectId>\]/);
  assert.match(helpOutput, /\[--main <slugNameAliasOrSubjectId,\.\.\.>\]/);
});

test('ZetaSeeder accepts an unadopted book and reports how far the Scribe read the chat', (testContext) => {
  const workDir = makeTempDir(testContext);
  /**
   * @param {(bundle: object) => void} mutate
   * @returns {object}
   * @throws {Error}
   */
  const summaryFor = (mutate) => {
    const bundle = buildScribeBundleFixture();
    bundle.book.adopted = false;
    mutate(bundle);
    const exportPath = writeBundle(workDir, 'unadopted.json', bundle);
    return ZetaSeeder.run({ exportPath, dryRun: true, allowedRoots: [workDir] });
  };

  const complete = summaryFor(() => {});
  assert.equal(complete.readThrough, 3);
  assert.equal(complete.chatMessages, 3);
  assert.equal(complete.facts, 2);
  assert.equal(complete.claims, 1);

  const partial = summaryFor((bundle) => {
    delete bundle.book.log.read['msg-obs-3'];
  });
  assert.equal(partial.readThrough, 2);
  assert.equal(partial.chatMessages, 3);

  const gap = summaryFor((bundle) => {
    delete bundle.book.log.read['msg-obs-2'];
  });
  assert.equal(gap.readThrough, 1);

  const unread = summaryFor((bundle) => {
    delete bundle.book.log.read['msg-obs-1'];
  });
  assert.equal(unread.readThrough, 0);
  assert.equal(unread.chatMessages, 3);

  const nothingRead = summaryFor((bundle) => {
    bundle.book.log.read = {};
  });
  assert.equal(nothingRead.readThrough, 0);
});

test('ZetaSeeder copies Zeta status: a refined InForce fact with claimed evidence stays InForce and a Reported fact stays Reported', () => {
  const bundle = buildScribeBundleFixture();
  const operations = storyOperations(bundle);
  operations.push(
    {
      type: ScribeAnswer.Type.Fact,
      fact: 'F6',
      subject: 'S2',
      label: 'Tamsin Locke',
      category: 'location',
      target: null,
      targetText: null,
      other: null,
      text: 'at the vault',
      cite: 'msg-obs-2',
      position: 2,
      hidden: false,
      evidence: storyEvidence('msg-obs-2', 'Tamsin Locke', 'witnessed', 'She stood at the vault.'),
    },
    {
      type: ScribeAnswer.Type.Refine,
      fact: 'F6',
      becomes: 'F7',
      subject: 'S2',
      label: 'Tamsin Locke',
      category: 'location',
      target: null,
      targetText: null,
      other: null,
      text: 'at the vault door',
      cite: 'msg-obs-3',
      position: 3,
      hidden: false,
      evidence: storyEvidence('msg-obs-3', 'Corin Vale', 'claimed', 'She is at the vault door, I think.'),
    },
  );
  bundle.book.log.nextFact = 8;

  const parsed = ZetaSeeder.parseExport(bundleText(bundle));
  const refined = parsed.facts.find((fact) => fact.text === 'at the vault door');
  assert.equal(refined.reported, false);
  assert.deepEqual(refined.evidence, { attribution: 'claimed', speaker: 'Corin Vale' });
  const claim = parsed.facts.find((fact) => fact.text === 'hiding in the bell tower');
  assert.equal(claim.reported, true);
  assert.deepEqual(claim.evidence, { attribution: 'claimed', speaker: 'Tamsin Locke' });

  const seeded = ZetaSeeder.materializeScribeLog(parsed).state;
  const seededRefined = seeded.facts.find((fact) => fact.text === 'at the vault door');
  assert.equal(seededRefined.status, ScribeReplay.Status.InForce);
  assert.deepEqual(seededRefined.evidence, { attribution: 'claimed', speaker: 'Corin Vale' });
  const seededClaim = seeded.facts.find((fact) => fact.text === 'hiding in the bell tower');
  assert.equal(seededClaim.status, ScribeReplay.Status.Reported);
  assert.deepEqual(seededClaim.evidence, { attribution: 'claimed', speaker: 'Tamsin Locke' });
  assert.equal(seeded.facts.filter((fact) => fact.status === ScribeReplay.Status.Reported).length, 1);
  assert.equal(seeded.facts.filter((fact) => ScribeReplay.live(fact)).length, 4);
});

test('ZetaSeeder seeds a Reported fact without evidence as Reported', () => {
  const parsed = ZetaSeeder.parseExport(bundleText(buildScribeBundleFixture()));
  const withoutEvidence = {
    ...parsed.facts.find((fact) => fact.text === 'hiding in the bell tower'),
    text: 'rumoured to hide in the cellar',
    evidence: null,
  };
  const seeded = ZetaSeeder.materializeScribeLog({ ...parsed, facts: [withoutEvidence] }).state;
  const fact = seeded.facts.find((item) => item.text === 'rumoured to hide in the cellar');
  assert.equal(fact.status, ScribeReplay.Status.Reported);
  assert.equal(Object.hasOwn(fact, 'evidence'), false);
});

/**
 * @param {string} fact
 * @param {string} subject
 * @param {string} label
 * @param {string} category
 * @param {string} text
 * @param {number} position
 * @returns {object}
 */
function audienceFact(fact, subject, label, category, text, position) {
  return {
    type: ScribeAnswer.Type.Fact,
    fact,
    subject,
    label,
    category,
    target: null,
    targetText: null,
    other: null,
    text,
    cite: `msg-aud-${position}`,
    position,
    hidden: false,
  };
}

/**
 * @returns {object}
 */
function buildAudienceBundleFixture() {
  const log = ScribeLogCore.create();
  log.nextSubject = 5;
  log.nextFact = 4;
  log.nextSequence = 2;
  log.revision = 1;
  log.read = { 'msg-aud-1': 1, 'msg-aud-2': 1, 'msg-aud-3': 1, 'msg-aud-4': 1, 'msg-aud-5': 1 };
  log.entries = [
    {
      sequence: 1,
      kind: ScribeLogCore.Kind.Update,
      origin: ScribeLogCore.Origin.Story,
      messageIds: ['msg-aud-1', 'msg-aud-2', 'msg-aud-3', 'msg-aud-4', 'msg-aud-5'],
      operations: [
        { type: ScribeAnswer.Type.Subject, subject: 'S1', label: 'Ayla', kind: 'character' },
        { type: ScribeAnswer.Type.Subject, subject: 'S2', label: 'Brek', kind: 'character' },
        { type: ScribeAnswer.Type.Subject, subject: 'S3', label: 'Cade', kind: 'character' },
        { type: ScribeAnswer.Type.Subject, subject: 'S4', label: 'Dara', kind: null },
        { type: ScribeAnswer.Type.Alias, subject: 'S2', name: 'Brek', cite: 'msg-aud-1', position: 1, other: null },
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 'msg-aud-1',
          last: 'msg-aud-2',
          firstPosition: 1,
          lastPosition: 2,
          place: 'Cellar',
          reach: ScribeAnswer.Reach.Private,
          present: [
            { subject: 'S1', label: 'Ayla', from: null, until: null },
            { subject: 'S2', label: 'Brek', from: null, until: null },
          ],
          summary: 'Ayla and Brek talk in the cellar.',
        },
        {
          type: ScribeAnswer.Type.Scene,
          day: 1,
          first: 'msg-aud-3',
          last: 'msg-aud-4',
          firstPosition: 3,
          lastPosition: 4,
          place: 'Square',
          reach: ScribeAnswer.Reach.Public,
          present: [
            { subject: 'S1', label: 'Ayla', from: null, until: null },
            { subject: 'S2', label: 'Brek', from: null, until: null },
            { subject: 'S3', label: 'Cade', from: null, until: null },
          ],
          summary: 'The square fills with people.',
        },
        audienceFact('F1', 'S1', 'Ayla', 'eyes', 'green', 1),
        audienceFact('F2', 'S3', 'Cade', 'hair', 'black', 3),
        audienceFact('F3', 'S2', 'Brek', 'eyes', 'grey', 5),
      ],
      withdrawn: false,
    },
  ];
  const bundle = buildScribeBundleFixture();
  bundle.campaign.messages = [1, 2, 3, 4, 5].map((number) => {
    return { id: `msg-aud-${number}`, sender: 'narrator@observatory.example', contents: [] };
  });
  bundle.book.log = log;
  bundle.book.fingerprints = {};
  return bundle;
}

test('ZetaSeeder copies who knows each fact: private scene audiences stay named, public ones stay open, a fact outside any scene stays with its subject', () => {
  const bundle = buildAudienceBundleFixture();
  const zeta = ScribeReplay.run(bundle.book.log, bundle.campaign.messages);
  const parsed = ZetaSeeder.parseExport(bundleText(bundle));
  const seeded = ZetaSeeder.materializeScribeLog(parsed).state;
  /**
   * @param {object} state
   * @param {string} text
   * @returns {object}
   */
  const audienceOf = (state, text) => {
    const audience = ScribeKnowledge.audience(state, state.facts.find((fact) => fact.text === text));
    return Array.isArray(audience) ? [...audience].sort() : audience;
  };
  /**
   * @param {string} text
   * @returns {object}
   */
  const factOf = (text) => seeded.facts.find((fact) => fact.text === text);

  assert.deepEqual(audienceOf(seeded, 'green'), ['S1', 'S2']);
  assert.equal(audienceOf(seeded, 'black'), ScribeKnowledge.Everyone);
  assert.deepEqual(audienceOf(seeded, 'grey'), ['S2']);
  for (const text of ['green', 'black', 'grey']) {
    assert.deepEqual(audienceOf(seeded, text), audienceOf(zeta, text));
  }
  assert.equal(ScribeKnowledge.knows(seeded, 'S3', factOf('green')), false);
  assert.equal(ScribeKnowledge.knows(seeded, 'S2', factOf('green')), true);
  assert.equal(ScribeKnowledge.knows(seeded, 'S3', factOf('black')), true);
  assert.equal(ScribeKnowledge.knows(seeded, 'S1', factOf('grey')), false);
  assert.equal(ScribeKnowledge.knows(seeded, 'S2', factOf('grey')), true);
  for (const subject of parsed.characters) {
    const zetaKnown = zeta.facts.filter((fact) => ScribeKnowledge.knows(zeta, subject.subjectId, fact)).length;
    const seededKnown = seeded.facts.filter((fact) => ScribeKnowledge.knows(seeded, subject.subjectId, fact)).length;
    assert.equal(seededKnown, zetaKnown);
  }
});

test('ZetaSeeder keeps a hidden fact that Zeta widened to Everyone known to every character and still hidden', () => {
  const bundle = buildAudienceBundleFixture();
  bundle.book.log.entries[0].operations.push({
    ...audienceFact('F4', 'S2', 'Brek', 'hair', 'red', 5),
    hidden: true,
  });
  const zetaBefore = ScribeReplay.run(bundle.book.log, bundle.campaign.messages);
  ScribeLogCore.rule(bundle.book.log, zetaBefore, {
    type: ScribeLogCore.Ruling.Widen,
    fact: 'F4',
    to: ScribeKnowledge.Everyone,
  });
  const zeta = ScribeReplay.run(bundle.book.log, bundle.campaign.messages);
  assert.equal(ScribeKnowledge.audience(zeta, zeta.facts.find((fact) => fact.id === 'F4')), ScribeKnowledge.Everyone);

  const parsed = ZetaSeeder.parseExport(bundleText(bundle));
  const seeded = ZetaSeeder.materializeScribeLog(parsed).state;
  const widened = seeded.facts.find((fact) => fact.text === 'red');
  assert.equal(widened.hidden, true);
  assert.equal(ScribeKnowledge.audience(seeded, widened), ScribeKnowledge.Everyone);
  for (const character of parsed.characters) {
    assert.equal(ScribeKnowledge.knows(seeded, character.subjectId, widened), true, character.subjectId);
  }
  const narrow = seeded.facts.find((fact) => fact.text === 'grey');
  assert.equal(ScribeKnowledge.knows(seeded, 'S1', narrow), false);
});

test('ZetaSeeder keeps a guessed subject kind guessed and seeds an alias that equals its subject label', () => {
  const bundle = buildAudienceBundleFixture();
  const zeta = ScribeReplay.run(bundle.book.log, bundle.campaign.messages);
  const parsed = ZetaSeeder.parseExport(bundleText(bundle));
  const seeded = ZetaSeeder.materializeScribeLog(parsed).state;

  assert.equal(zeta.subjects.find((subject) => subject.id === 'S4').assumed, true);
  const guessed = seeded.subjects.find((subject) => subject.id === 'S4');
  assert.equal(guessed.assumed, true);
  assert.equal(guessed.kind, 'character');
  assert.equal(parsed.characters.some((character) => character.subjectId === 'S4'), true);
  assert.equal(seeded.subjects.find((subject) => subject.id === 'S1').assumed, false);

  assert.equal(zeta.aliases.some((record) => record.subject === 'S2' && record.name === 'Brek'), true);
  assert.equal(seeded.aliases.some((record) => record.subject === 'S2' && record.name === 'Brek'), true);
  assert.equal(seeded.aliases.length, zeta.aliases.length);
});

test('ZetaSeeder refuses facts it cannot copy faithfully and names the fact', () => {
  /**
   * @param {(bundle: object) => void} mutate
   * @returns {() => unknown}
   * @throws {Error}
   */
  const seedWith = (mutate) => {
    const bundle = buildAudienceBundleFixture();
    mutate(bundle);
    return () => ZetaSeeder.parseExport(bundleText(bundle));
  };
  /**
   * @param {object} bundle
   * @param {string} text
   * @returns {void}
   * @throws {Error}
   */
  const pin = (bundle, text) => {
    const state = ScribeReplay.run(bundle.book.log, bundle.campaign.messages);
    ScribeLogCore.rule(bundle.book.log, state, {
      type: ScribeLogCore.Ruling.Pin,
      subject: 'S1',
      category: 'eyes',
      target: null,
      text,
      hidden: false,
    });
  };

  assert.doesNotThrow(seedWith(() => {}));
  assert.throws(seedWith((bundle) => pin(bundle, 'green')), /Fact F1 is pinned in the export/);
  assert.throws(seedWith((bundle) => pin(bundle, 'blue')), /Fact F1 is disputed in the export/);
  assert.throws(seedWith((bundle) => {
    bundle.book.log.entries[0].operations.push({
      ...audienceFact('F4', 'S1', 'Ayla', 'build', 'tall', 1),
      form: 'human',
      dimension: 'height',
    });
  }), /Fact F4 carries a form or dimension/);
  assert.throws(seedWith((bundle) => {
    bundle.book.log.entries[0].operations.push({
      ...audienceFact('F4', 'S1', 'Ayla', 'relation', 'owes a debt', 1),
      targetText: 'Harbor Guildmaster',
    });
  }), /Relation fact F4 has no target subject/);
});

test('ZetaSeeder names the allowed root it cannot resolve instead of skipping it', (testContext) => {
  const workDir = makeTempDir(testContext);
  const exportPath = writeBundle(workDir, 'observatory.json', buildScribeBundleFixture());
  const missingRoot = path.join(workDir, 'missing-root');
  assert.throws(
    () => ZetaSeeder.resolveSafeExportPath(exportPath, [missingRoot, workDir]),
    (error) => error.message.includes(`Cannot resolve allowed root "${missingRoot}"`) && error.cause instanceof Error,
  );
});

/**
 * @param {string} fact
 * @param {string} text
 * @returns {object}
 */
function hiddenFeature(fact, text) {
  return { ...audienceFact(fact, 'S2', 'Brek', 'feature', text, 5), hidden: true };
}

/**
 * @param {object} bundle
 * @param {object} operation
 * @returns {void}
 * @throws {Error}
 */
function ruleOn(bundle, operation) {
  const state = ScribeReplay.run(bundle.book.log, bundle.campaign.messages);
  const ruling = operation.type === ScribeLogCore.Ruling.EditFact
    ? { ...operation, expected: ScribeLogCore.editExpected(state.facts.find((fact) => fact.id === operation.fact)) }
    : operation;
  ScribeLogCore.rule(bundle.book.log, state, ruling);
}

/**
 * @param {object} bundle
 * @param {object[]} operations
 * @returns {void}
 */
function appendStory(bundle, operations) {
  const log = bundle.book.log;
  log.entries.push({
    sequence: log.nextSequence,
    kind: ScribeLogCore.Kind.Update,
    origin: ScribeLogCore.Origin.Story,
    messageIds: ['msg-aud-5'],
    operations,
    withdrawn: false,
  });
  log.nextSequence += 1;
  log.revision += 1;
}

/**
 * @param {object[]} facts
 * @returns {object}
 */
function buildWidenBundleFixture(facts) {
  const bundle = buildAudienceBundleFixture();
  bundle.book.log.nextFact = 10;
  bundle.book.log.nextSubject = 6;
  bundle.book.log.entries[0].operations.push(...facts);
  return bundle;
}

/**
 * @param {object} state
 * @param {string} factId
 * @returns {string | readonly string[]}
 */
function audienceById(state, factId) {
  return ScribeKnowledge.audience(state, state.facts.find((fact) => fact.id === factId));
}

/**
 * @param {string | readonly string[]} audience
 * @returns {string | string[]}
 */
function sortedAudience(audience) {
  return Array.isArray(audience) ? [...audience].sort() : audience;
}

/**
 * @param {object} bundle
 * @param {Record<string, string | string[]>} expected
 * @returns {{log: object, state: object}}
 * @throws {Error}
 */
function assertSeededAudiences(bundle, expected) {
  const zeta = ScribeReplay.run(bundle.book.log, bundle.campaign.messages);
  const parsed = ZetaSeeder.parseExport(bundleText(bundle));
  const seeded = ZetaSeeder.materializeScribeLog(parsed);
  for (const [zetaId, audience] of Object.entries(expected)) {
    const seededId = `${ScribeLogCore.Settings.FactPrefix}${parsed.facts.findIndex((fact) => fact.id === zetaId) + 1}`;
    assert.deepEqual(sortedAudience(audienceById(zeta, zetaId)), audience, `zeta ${zetaId}`);
    assert.deepEqual(sortedAudience(audienceById(seeded.state, seededId)), audience, `seeded ${zetaId}`);
  }
  const widenings = seeded.log.entries
    .flatMap((entry) => entry.operations)
    .filter((operation) => operation.type === ScribeLogCore.Ruling.Widen);
  assert.equal(widenings.length > 0, true);
  for (const widening of widenings) {
    assert.equal(widening.exact, true);
  }
  return seeded;
}

test('ZetaSeeder seeds a Widen followed by an edit on its own fact only', () => {
  const bundle = buildWidenBundleFixture([hiddenFeature('F4', 'bold')]);
  ruleOn(bundle, { type: ScribeLogCore.Ruling.Widen, fact: 'F4', to: ScribeKnowledge.Everyone });
  ruleOn(bundle, { type: ScribeLogCore.Ruling.EditFact, fact: 'F4', text: 'brave' });
  appendStory(bundle, [hiddenFeature('F5', 'brave')]);
  assertSeededAudiences(bundle, { F4: ScribeKnowledge.Everyone, F5: ['S2'] });
});

test('ZetaSeeder seeds a Widen on one of two same-wording facts when the other was edited away', () => {
  const bundle = buildWidenBundleFixture([hiddenFeature('F4', 'bold'), hiddenFeature('F5', 'bold')]);
  ruleOn(bundle, { type: ScribeLogCore.Ruling.EditFact, fact: 'F5', text: 'brave' });
  ruleOn(bundle, { type: ScribeLogCore.Ruling.Widen, fact: 'F4', to: ScribeKnowledge.Everyone });
  appendStory(bundle, [hiddenFeature('F6', 'brave')]);
  assertSeededAudiences(bundle, { F4: ScribeKnowledge.Everyone, F5: ScribeKnowledge.Everyone, F6: ['S2'] });
});

test('ZetaSeeder seeds a Widen on a fact whose wording another fact was edited onto', () => {
  const bundle = buildWidenBundleFixture([hiddenFeature('F4', 'brave'), hiddenFeature('F5', 'bold')]);
  ruleOn(bundle, { type: ScribeLogCore.Ruling.EditFact, fact: 'F5', text: 'brave' });
  ruleOn(bundle, { type: ScribeLogCore.Ruling.Widen, fact: 'F4', to: ScribeKnowledge.Everyone });
  assertSeededAudiences(bundle, { F4: ScribeKnowledge.Everyone, F5: ['S2'] });
});

test('ZetaSeeder seeds a Widen followed by a Split on the facts it widened only', () => {
  const bundle = buildWidenBundleFixture([hiddenFeature('F4', 'bold')]);
  ruleOn(bundle, { type: ScribeLogCore.Ruling.Widen, fact: 'F4', to: ScribeKnowledge.Everyone });
  ruleOn(bundle, {
    type: ScribeLogCore.Ruling.Split,
    subject: 'S2',
    label: 'Dorn',
    kind: 'character',
    facts: ['F4'],
  });
  appendStory(bundle, [{ ...hiddenFeature('F5', 'bold'), subject: 'S6', label: 'Dorn' }]);
  assertSeededAudiences(bundle, { F4: ScribeKnowledge.Everyone, F5: ['S6'] });
});

test('ZetaSeeder seeds an edit followed by a Widen on its own fact only', () => {
  const bundle = buildWidenBundleFixture([hiddenFeature('F4', 'bold')]);
  ruleOn(bundle, { type: ScribeLogCore.Ruling.EditFact, fact: 'F4', text: 'brave' });
  ruleOn(bundle, { type: ScribeLogCore.Ruling.Widen, fact: 'F4', to: ScribeKnowledge.Everyone });
  appendStory(bundle, [hiddenFeature('F5', 'brave')]);
  assertSeededAudiences(bundle, { F4: ScribeKnowledge.Everyone, F5: ['S2'] });
});

/**
 * @param {object} bundle
 * @param {string} toldId
 * @param {Record<string, string | string[]>} expected
 * @param {string[]} seededOnly
 * @returns {void}
 * @throws {Error}
 */
function assertToldAudiences(bundle, toldId, expected, seededOnly = []) {
  const messages = bundle.campaign.messages;
  const native = structuredClone(bundle.book.log);
  ScribeLogCore.tell(native, ScribeReplay.run(native, messages), { factId: toldId, speakerSubjectId: 'S3' });
  const nativeState = ScribeReplay.run(native, messages);

  const parsed = ZetaSeeder.parseExport(bundleText(bundle));
  const seeded = ZetaSeeder.materializeScribeLog(parsed);
  /**
   * @param {string} zetaId
   * @returns {string}
   */
  const seededIdOf = (zetaId) => {
    return `${ScribeLogCore.Settings.FactPrefix}${parsed.facts.findIndex((fact) => fact.id === zetaId) + 1}`;
  };
  ScribeLogCore.tell(seeded.log, seeded.state, { factId: seededIdOf(toldId), speakerSubjectId: 'S3' });
  const seededState = ScribeReplay.run(seeded.log, []);
  for (const [zetaId, audience] of Object.entries(expected)) {
    if (!seededOnly.includes(zetaId)) {
      assert.deepEqual(sortedAudience(audienceById(nativeState, zetaId)), audience, `worlds ${zetaId}`);
    }
    assert.deepEqual(sortedAudience(audienceById(seededState, seededIdOf(zetaId))), audience, `seeded ${zetaId}`);
  }
}

test('ZetaSeeder keeps a seeded Everyone ruling when a live Told reaches a same-wording fact after an edit and a later fact', () => {
  const bundle = buildWidenBundleFixture([hiddenFeature('F4', 'bold')]);
  ruleOn(bundle, { type: ScribeLogCore.Ruling.Widen, fact: 'F4', to: ScribeKnowledge.Everyone });
  ruleOn(bundle, { type: ScribeLogCore.Ruling.EditFact, fact: 'F4', text: 'brave' });
  appendStory(bundle, [hiddenFeature('F5', 'brave')]);
  assertToldAudiences(bundle, 'F5', { F4: ScribeKnowledge.Everyone, F5: ['S2', 'S3'] });
});

test('ZetaSeeder keeps seeded Everyone rulings on both same-wording facts when a live Told reaches a later fact', () => {
  const bundle = buildWidenBundleFixture([hiddenFeature('F4', 'bold'), hiddenFeature('F5', 'bold')]);
  ruleOn(bundle, { type: ScribeLogCore.Ruling.EditFact, fact: 'F5', text: 'brave' });
  ruleOn(bundle, { type: ScribeLogCore.Ruling.Widen, fact: 'F4', to: ScribeKnowledge.Everyone });
  appendStory(bundle, [hiddenFeature('F6', 'brave')]);
  assertToldAudiences(bundle, 'F6', {
    F4: ScribeKnowledge.Everyone,
    F5: ScribeKnowledge.Everyone,
    F6: ['S2', 'S3'],
  });
});

test('ZetaSeeder keeps a seeded Everyone ruling after an edit then a Widen when a live Told reaches a later fact', () => {
  const bundle = buildWidenBundleFixture([hiddenFeature('F4', 'bold')]);
  ruleOn(bundle, { type: ScribeLogCore.Ruling.EditFact, fact: 'F4', text: 'brave' });
  ruleOn(bundle, { type: ScribeLogCore.Ruling.Widen, fact: 'F4', to: ScribeKnowledge.Everyone });
  appendStory(bundle, [hiddenFeature('F5', 'brave')]);
  assertToldAudiences(bundle, 'F5', { F4: ScribeKnowledge.Everyone, F5: ['S2', 'S3'] });
});

test('ZetaSeeder keeps a seeded Everyone ruling when a live Told reaches the fact edited onto its wording', () => {
  const bundle = buildWidenBundleFixture([hiddenFeature('F4', 'brave'), hiddenFeature('F5', 'bold')]);
  ruleOn(bundle, { type: ScribeLogCore.Ruling.EditFact, fact: 'F5', text: 'brave' });
  ruleOn(bundle, { type: ScribeLogCore.Ruling.Widen, fact: 'F4', to: ScribeKnowledge.Everyone });
  assertToldAudiences(bundle, 'F5', { F4: ScribeKnowledge.Everyone, F5: ['S2', 'S3'] });
});

test('ZetaSeeder keeps the seeded fact Everyone when a live Told reaches a same-wording fact after a Split', () => {
  const bundle = buildWidenBundleFixture([hiddenFeature('F4', 'bold')]);
  ruleOn(bundle, { type: ScribeLogCore.Ruling.Widen, fact: 'F4', to: ScribeKnowledge.Everyone });
  ruleOn(bundle, {
    type: ScribeLogCore.Ruling.Split,
    subject: 'S2',
    label: 'Dorn',
    kind: 'character',
    facts: ['F4'],
  });
  appendStory(bundle, [{ ...hiddenFeature('F5', 'bold'), subject: 'S6', label: 'Dorn' }]);
  assertToldAudiences(bundle, 'F5', { F4: ScribeKnowledge.Everyone, F5: ['S3', 'S6'] }, ['F4']);
});

test('ZetaSeeder keeps a seeded Everyone ruling when a live Told reaches a fact of another subject', () => {
  const bundle = buildWidenBundleFixture([
    hiddenFeature('F4', 'bold'),
    { ...hiddenFeature('F5', 'bold'), subject: 'S1', label: 'Ayla' },
  ]);
  ruleOn(bundle, { type: ScribeLogCore.Ruling.Widen, fact: 'F5', to: ['S3'] });
  ruleOn(bundle, { type: ScribeLogCore.Ruling.Widen, fact: 'F4', to: ScribeKnowledge.Everyone });
  assertToldAudiences(bundle, 'F5', { F4: ScribeKnowledge.Everyone, F5: ['S1', 'S3'] });
});

test('ZetaSeeder keeps an aka fact of 68 characters whole on the character and never files a sync for it', () => {
  const longName = 'The Wanderer Who Walked Out Of The Burning Library At Midnight Alone';
  assert.equal(longName.length, 68);
  const bundle = buildAudienceBundleFixture();
  bundle.book.log.entries[0].operations.push(
    audienceFact('F4', 'S1', 'Ayla', ScribeLogCore.Settings.AkaCategory, longName, 1),
  );
  const zeta = ScribeReplay.run(bundle.book.log, bundle.campaign.messages);
  assert.equal(zeta.aliases.filter((record) => record.subject === 'S1').length, 0);

  const parsed = ZetaSeeder.parseExport(bundleText(bundle), { playerRef: longName });
  const character = parsed.characters.find((row) => row.subjectId === 'S1');
  assert.deepEqual(character.aliases, [longName]);
  assert.equal(character.isPlayer, true);
  assert.deepEqual(parsed.subjects.find((subject) => subject.id === 'S1').recordAliases, []);

  const { log, state } = ZetaSeeder.materializeScribeLog(parsed);
  assert.equal(state.aliases.length, zeta.aliases.length);
  assert.equal(state.aliases.filter((record) => record.subject === 'S1').length, 0);
  const akaForms = new Set(state.subjects.find((subject) => subject.id === 'S1').aka.map((entry) => ScribeText.normaliseName(entry)));
  for (const alias of character.aliases) {
    assert.equal(akaForms.has(ScribeText.normaliseName(alias)), true);
  }
  const akaFact = state.facts.find((fact) => fact.category === ScribeLogCore.Settings.AkaCategory);
  assert.equal(akaFact.text, longName);

  const synced = ScribeLogCore.syncCharacterSubject(log, state, {
    subjectId: character.subjectId,
    name: character.name,
    aliases: character.aliases,
    kind: ScribeCategory.SubjectKinds.Character,
  });
  assert.equal(synced.changed, false);
  assert.equal(ScribeReplay.run(log, []).facts.find((fact) => fact.id === akaFact.id).status, ScribeReplay.Status.InForce);
});

test('ZetaSeeder clamps a long alias that no seeded aka fact gives back, on the character and on the record', () => {
  const longName = 'The Wanderer Who Walked Out Of The Burning Library At Midnight Alone';
  const clamped = longName.slice(0, ScribeAnswer.Settings.MaxLabel).trim();
  const bundle = buildAudienceBundleFixture();
  bundle.book.log.entries[0].operations.push(
    { type: ScribeAnswer.Type.Alias, subject: 'S1', name: longName, cite: 'msg-aud-1', position: 1, other: null },
  );

  const parsed = ZetaSeeder.parseExport(bundleText(bundle));
  const character = parsed.characters.find((row) => row.subjectId === 'S1');
  assert.deepEqual(character.aliases, [clamped]);
  assert.deepEqual(parsed.subjects.find((subject) => subject.id === 'S1').recordAliases, [clamped]);

  const { log, state } = ZetaSeeder.materializeScribeLog(parsed);
  assert.deepEqual(state.aliases.filter((record) => record.subject === 'S1').map((record) => record.name), [clamped]);
  const synced = ScribeLogCore.syncCharacterSubject(log, state, {
    subjectId: character.subjectId,
    name: character.name,
    aliases: character.aliases,
    kind: ScribeCategory.SubjectKinds.Character,
  });
  assert.equal(synced.changed, false);
});

test('ZetaSeeder keeps every seeded character alias, including an aka name, and never loses the aka fact', () => {
  const bundle = buildAudienceBundleFixture();
  bundle.book.log.entries[0].operations.push(
    { type: ScribeAnswer.Type.Alias, subject: 'S1', name: 'Ayla the Bold', cite: 'msg-aud-1', position: 1, other: null },
    audienceFact('F4', 'S1', 'Ayla', ScribeLogCore.Settings.AkaCategory, 'The Wanderer', 1),
  );
  const zeta = ScribeReplay.run(bundle.book.log, bundle.campaign.messages);

  const parsed = ZetaSeeder.parseExport(bundleText(bundle), { playerRef: 'The Wanderer' });
  const character = parsed.characters.find((row) => row.subjectId === 'S1');
  assert.equal(character.aliases.includes('The Wanderer'), true);
  assert.equal(character.isPlayer, true);

  const { log, state } = ZetaSeeder.materializeScribeLog(parsed);
  assert.equal(state.aliases.length, zeta.aliases.length);
  const akaFact = state.facts.find((fact) => fact.text === 'The Wanderer');
  assert.equal(akaFact.status, ScribeReplay.Status.InForce);

  const synced = ScribeLogCore.syncCharacterSubject(log, state, {
    subjectId: character.subjectId,
    name: character.name,
    aliases: character.aliases,
    kind: ScribeCategory.SubjectKinds.Character,
  });
  assert.equal(synced.changed, false);
  const after = ScribeReplay.run(log, []);
  assert.equal(after.facts.find((fact) => fact.id === akaFact.id).status, ScribeReplay.Status.InForce);
});

test('ZetaSeeder copies one alias record for a subject with an Alias op and a live aka fact', () => {
  const bundle = buildAudienceBundleFixture();
  bundle.book.log.entries[0].operations.push(
    { type: ScribeAnswer.Type.Alias, subject: 'S1', name: 'Ayla the Bold', cite: 'msg-aud-1', position: 1, other: null },
    audienceFact('F4', 'S1', 'Ayla', ScribeLogCore.Settings.AkaCategory, 'The Wanderer', 1),
  );
  const zeta = ScribeReplay.run(bundle.book.log, bundle.campaign.messages);
  const zetaRecords = zeta.aliases.filter((record) => record.subject === 'S1');
  assert.equal(zetaRecords.length, 1);
  assert.equal(zeta.subjects.find((subject) => subject.id === 'S1').aka.includes('The Wanderer'), true);

  const parsed = ZetaSeeder.parseExport(bundleText(bundle));
  assert.deepEqual(parsed.subjects.find((subject) => subject.id === 'S1').recordAliases, ['Ayla the Bold']);
  const seeded = ZetaSeeder.materializeScribeLog(parsed).state;
  assert.equal(seeded.aliases.length, zeta.aliases.length);
  assert.deepEqual(seeded.aliases.filter((record) => record.subject === 'S1').map((record) => record.name), ['Ayla the Bold']);
  assert.equal(seeded.subjects.find((subject) => subject.id === 'S1').aka.includes('The Wanderer'), true);
});

test('ZetaSeeder keeps an aka name that no copied aka fact gives back', () => {
  const bundle = buildAudienceBundleFixture();
  bundle.book.log.entries[0].operations.push(
    audienceFact('F4', 'S1', 'Ayla', ScribeLogCore.Settings.AkaCategory, 'The Wanderer', 1),
    {
      ...audienceFact('F5', 'S1', 'Ayla', ScribeLogCore.Settings.AkaCategory, 'The Wandering Knight', 2),
      type: ScribeAnswer.Type.Change,
      fact: 'F4',
      becomes: 'F5',
    },
  );
  const zeta = ScribeReplay.run(bundle.book.log, bundle.campaign.messages);
  assert.equal(zeta.facts.find((fact) => fact.id === 'F4').status, ScribeReplay.Status.Replaced);
  assert.deepEqual(zeta.subjects.find((subject) => subject.id === 'S1').aka, ['The Wanderer', 'The Wandering Knight']);

  const parsed = ZetaSeeder.parseExport(bundleText(bundle));
  assert.deepEqual(parsed.subjects.find((subject) => subject.id === 'S1').recordAliases, ['The Wanderer']);
});

test('ZetaSeeder keeps the name of a merged subject even when a copied aka fact repeats it', () => {
  const bundle = buildAudienceBundleFixture();
  bundle.book.log.entries[0].operations.push(
    audienceFact('F4', 'S1', 'Ayla', ScribeLogCore.Settings.AkaCategory, 'Dara', 1),
  );
  ScribeLogCore.rule(bundle.book.log, ScribeReplay.run(bundle.book.log, bundle.campaign.messages), {
    type: ScribeLogCore.Ruling.Merge,
    from: 'S4',
    into: 'S1',
  });
  const zeta = ScribeReplay.run(bundle.book.log, bundle.campaign.messages);
  assert.equal(zeta.subjects.find((subject) => subject.id === 'S1').aka.includes('Dara'), true);

  const parsed = ZetaSeeder.parseExport(bundleText(bundle));
  assert.deepEqual(parsed.subjects.find((subject) => subject.id === 'S1').recordAliases, ['Dara']);
});

test('ZetaSeeder refuses a look-alike pair it cannot copy and accepts the pair once Zeta ruled it distinct', () => {
  const bundle = buildAudienceBundleFixture();
  bundle.book.log.entries[0].operations.push({
    type: ScribeAnswer.Type.Alias,
    subject: 'S1',
    name: 'Ayla the Bold',
    cite: 'msg-aud-1',
    position: 1,
    other: 'S2',
  });
  assert.equal(ScribeReplay.run(bundle.book.log, bundle.campaign.messages).lookAlikes.length, 1);
  assert.throws(
    () => ZetaSeeder.parseExport(bundleText(bundle)),
    /Subjects S1 and S2 are look-alikes in the export, which the seed cannot copy\./,
  );

  ScribeLogCore.rule(bundle.book.log, ScribeReplay.run(bundle.book.log, bundle.campaign.messages), {
    type: ScribeLogCore.Ruling.Distinct,
    first: 'S1',
    second: 'S2',
  });
  assert.equal(ScribeReplay.run(bundle.book.log, bundle.campaign.messages).lookAlikes.length, 0);
  assert.doesNotThrow(() => ZetaSeeder.parseExport(bundleText(bundle)));
});

test('ZetaSeeder imports chat messages as speaker-tagged turns with scene witnesses and marks read turns', (testContext) => {
  const workDir = makeTempDir(testContext);
  const bundle = buildScribeBundleFixture();
  bundle.campaign.messages = [
    {
      id: 'msg-obs-1',
      sender: { id: 'USER-1', type: 'USER' },
      messageTime: '2026-11-20T10:00:00Z',
      contents: [
        { type: 'TEXT', speakerName: 'Corin Vale', position: 'RIGHT', text: '*Steps inside.*\n' },
        { type: 'TEXT', speakerName: 'Corin Vale', position: 'RIGHT', text: 'Who broke the astrolabe?' },
      ],
    },
    {
      id: 'msg-obs-2',
      sender: { id: 'BOT-1', type: 'BOT' },
      messageTime: '2026-11-20T10:01:00Z',
      contents: [
        { type: 'TEXT', speakerName: 'Narrator', position: 'NARRATOR', text: '*Dust hangs in the lantern beam.*\n' },
        { type: 'TEXT', speakerName: 'Tamsin Locke', position: 'LEFT', text: '*Looks up.*\n' },
        { type: 'TEXT', speakerName: 'Tamsin Locke', position: 'LEFT', text: 'It was shattered before I arrived.' },
        { type: 'TEXT', speakerName: 'Night Guard', position: 'LEFT', text: 'All quiet outside.' },
      ],
    },
    {
      id: 'msg-obs-3',
      sender: { id: 'BOT-1', type: 'BOT' },
      messageTime: '2026-11-20T10:02:00Z',
      contents: [
        { type: 'TEXT', speakerName: 'Tamsin Locke', position: 'LEFT', text: 'Bramwell slipped out a moment ago.' },
      ],
    },
  ];
  const exportPath = writeBundle(workDir, 'with-chat.json', bundle);
  const dbPath = path.join(workDir, 'seeded-chat.sqlite');

  const summary = ZetaSeeder.run({
    exportPath,
    dbPath,
    title: 'Observatory Chat',
    playerRef: 'corin-vale',
    allowedRoots: [workDir],
  });
  assert.equal(summary.turns, 3);

  const store = new SqliteStore(dbPath);
  try {
    const characters = store.listCharacters(summary.campaignId, { limit: 50 }).items;
    const bySubject = new Map(characters.map((character) => [character.scribeSubjectId, character]));
    const corin = bySubject.get('S1');
    const tamsin = bySubject.get('S2');
    const bramwell = bySubject.get('S3');

    const turnsPage = store.listTurns(summary.campaignId, { limit: 50 });
    assert.equal(turnsPage.total, 3);
    const [firstTurn, secondTurn, thirdTurn] = [...turnsPage.items].sort((left, right) => left.seq - right.seq);

    assert.equal(firstTurn.role, 'user');
    assert.equal(firstTurn.beats.length, 1);
    assert.equal(firstTurn.beats[0].speakerType, 'player');
    assert.equal(firstTurn.beats[0].characterId, corin.id);
    assert.equal(firstTurn.beats[0].text, '*Steps inside.*\nWho broke the astrolabe?');
    assert.equal(firstTurn.witnessIds.includes(bramwell.id), true);

    assert.equal(secondTurn.role, 'assistant');
    assert.equal(secondTurn.beats.length, 3);
    assert.equal(secondTurn.beats[0].speakerType, 'narrator');
    assert.equal(secondTurn.beats[1].speakerType, 'character');
    assert.equal(secondTurn.beats[1].characterId, tamsin.id);
    assert.equal(secondTurn.beats[1].text, '*Looks up.*\nIt was shattered before I arrived.');
    assert.equal(secondTurn.beats[2].speakerType, 'narrator');
    assert.equal(secondTurn.beats[2].speakerName, 'Night Guard');

    assert.equal(thirdTurn.witnessIds.includes(bramwell.id), false);
    assert.equal(thirdTurn.witnessIds.includes(corin.id), true);
    assert.equal(thirdTurn.witnessIds.includes(tamsin.id), true);

    const bookRecord = store.getScribeBook(summary.campaignId);
    const savedLog = JSON.parse(bookRecord.bookJson);
    assert.equal(bookRecord.lastTurnSeq, 3);
    assert.equal(savedLog.read[firstTurn.id], 1);
    assert.equal(savedLog.read[secondTurn.id], 1);
    assert.equal(savedLog.read[thirdTurn.id], 1);
  } finally {
    store.close();
  }
});
