import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ScribeKnowledge } from '../src/scribe/ScribeKnowledge.mjs';
import { ScribeLogCore } from '../src/scribe/ScribeLogCore.mjs';
import { ScribeReplay } from '../src/scribe/ScribeReplay.mjs';
import { CharacterTier } from '../src/store/enums/CharacterTier.mjs';
import { SceneType } from '../src/store/enums/SceneType.mjs';
import { SqliteStore } from '../src/store/SqliteStore.mjs';
import { ZetaSeeder } from '../scripts/seed-from-export.mjs';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SEED_SCRIPT_PATH = path.resolve(CURRENT_DIR, '../scripts/seed-from-export.mjs');

/**
 * @param {import('node:test').TestContext} testContext
 * @returns {string}
 */
function makeTempDir(testContext) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-seed-test-'));
  testContext.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  return tempDir;
}

/**
 * @returns {object}
 */
function buildRichZetaFixture() {
  return {
    title: 'Hero Gone: Harbor Watch',
    premise: 'Smugglers control the drowned lighthouse while the magistrate sleeps.',
    styleNotes: 'Terse, sensory, maritime noir.',
    playerName: 'Rowan Hale',
    sceneState: {
      location: 'Lantern Pier',
      day: 3,
      timeLabel: 'Midnight',
      sceneType: 'private',
    },
    characters: [
      {
        name: 'Rowan Hale',
        slug: 'Rowan!#',
        subjectId: 'S10',
        aliases: ['Watchman Rowan'],
        tier: 'main',
        persona: 'Disgraced harbor inspector carrying an iron key.',
      },
      {
        name: 'Rowan Vane',
        slug: 'rowan',
        subjectId: 'S11',
        persona: 'His estranged cousin claiming the same family name.',
      },
      {
        name: 'Vesper',
        subjectId: 'S20',
        role: 'recurring',
        persona: 'Quiet apothecary near the locks.',
      },
      {
        name: 'Old Fen',
        subjectId: 'S30',
        archived: true,
      },
    ],
    book: {
      subjects: [
        { id: 'S10', label: 'Rowan Hale', kind: 'character', aka: ['Inspector Hale'], mergedInto: null },
        { id: 'S10_DUP', label: 'Rowan of the Pier', kind: 'character', aka: ['Greycoat'], mergedInto: 'S10' },
        { id: 'S11', label: 'Rowan Vane', kind: 'character', aka: [], mergedInto: null },
        { id: 'S20', label: 'Vesper', kind: 'character', aka: ['Lady Vesper'], mergedInto: null },
        { id: 'S25', label: 'Mara', kind: 'character', aka: ['Captain Mara'], mergedInto: null },
        { id: 'S30', label: 'Old Fen', kind: 'character', aka: [], mergedInto: null },
        { id: 'S40', label: 'Drowned Lighthouse', kind: 'place', aka: ['North Beacon'], mergedInto: null },
        { id: 'S99', label: 'Narrator', kind: 'character', aka: [], mergedInto: null },
      ],
      facts: [
        {
          id: 'F1',
          subject: 'S10',
          category: 'eyes',
          target: null,
          text: 'slate grey',
          hidden: false,
          status: 'InForce',
        },
        {
          id: 'F2',
          subject: 'S25',
          category: 'background',
          target: null,
          text: 'forged the magistrate customs seal in secret',
          hidden: true,
          widened: ['S20'],
          told: [],
          status: 'InForce',
        },
        {
          id: 'F3',
          subject: 'S10_DUP',
          category: 'belonging',
          target: null,
          text: 'brass harbor whistle',
          hidden: false,
          status: 'InForce',
        },
        {
          id: 'F4',
          subject: 'S20',
          category: 'status',
          target: null,
          text: 'missing at sea',
          hidden: false,
          status: 'Ended',
        },
        {
          id: 'F5',
          subject: 'S40',
          category: 'feature',
          target: null,
          text: 'submerged bell tolls only at low tide',
          hidden: false,
          status: 'InForce',
        },
      ],
      relations: [
        {
          id: 'F6',
          subject: 'S25',
          target: 'S10',
          targetText: 'Rowan Hale',
          text: 'owes Rowan a blood debt after the seawall collapse',
          hidden: false,
          status: 'InForce',
        },
        {
          id: 'F7',
          subject: 'S20',
          target: null,
          targetText: 'Harbor Guildmaster',
          text: 'secretly supplies laudanum to the Guildmaster',
          hidden: true,
          status: 'InForce',
        },
      ],
      threads: [
        { id: 'T1', text: 'Who extinguished the North Beacon before the wreck?', closed: null, subject: 'S40' },
        { id: 'T2', text: 'Closed subplot from day one', closed: { how: 'resolved' } },
      ],
      scenes: [
        {
          id: 'SC1',
          day: 3,
          place: 'Lantern Pier',
          reach: 'private',
          present: [{ subject: 'S10', label: 'Rowan Hale' }, { subject: 'S25', label: 'Mara' }],
        },
      ],
    },
  };
}

test('ZetaSeeder enforces fs.realpathSync path guard against outside paths and symlink escapes', (testContext) => {
  const allowedDir = makeTempDir(testContext);
  const outsideDir = makeTempDir(testContext);
  const outsideFile = path.join(outsideDir, 'secret-export.json');
  fs.writeFileSync(outsideFile, JSON.stringify(buildRichZetaFixture()), 'utf8');

  const symlinkPath = path.join(allowedDir, 'escape-link.json');
  fs.symlinkSync(outsideFile, symlinkPath);

  assert.throws(
    () => ZetaSeeder.resolveSafeExportPath(symlinkPath, [allowedDir]),
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
    () => execFileSync(process.execPath, [SEED_SCRIPT_PATH, '/etc/passwd', '--dry-run'], { encoding: 'utf8', stdio: 'pipe' }),
    (error) => error.status !== 0 && /Security check failed|Cannot read export file/.test(String(error.stderr)),
  );
});

test('ZetaSeeder rejects corrupt, truncated, or invalid Zeta export payloads at parse boundary', () => {
  assert.throws(() => ZetaSeeder.parseExport(''), /empty/);
  assert.throws(() => ZetaSeeder.parseExport('{truncated'), /invalid JSON/);
  assert.throws(() => ZetaSeeder.parseExport('[]'), /JSON object/);
  assert.throws(() => ZetaSeeder.parseExport('{}'), /does not contain recognizable/);
  assert.throws(
    () => ZetaSeeder.parseExport(JSON.stringify({ book: { subjects: [{ id: 'S1', label: '   ' }] } })),
    /missing a label or name/,
  );
  assert.throws(
    () => ZetaSeeder.parseExport(JSON.stringify({
      book: {
        subjects: [{ id: 'S1', label: 'Mara', kind: 'character' }],
        facts: [{ id: 'F1', subject: 'S999', category: 'eyes', text: 'blue' }],
      },
    })),
    /unknown subject/,
  );
  assert.throws(
    () => ZetaSeeder.parseExport(JSON.stringify({
      book: {
        subjects: [{ id: 'S1', label: 'Mara', kind: 'character' }],
        relations: [{ id: 'F1', subject: 'S1', target: null, targetText: null, text: 'knows nobody' }],
      },
    })),
    /valid target or targetText/,
  );
});

test('ZetaSeeder dry-run validates and summarizes without creating SQLite file', (testContext) => {
  const workDir = makeTempDir(testContext);
  const exportPath = path.join(workDir, 'fixture.json');
  const dbPath = path.join(workDir, 'never-created.sqlite');
  fs.writeFileSync(exportPath, JSON.stringify(buildRichZetaFixture()), 'utf8');

  const summary = ZetaSeeder.run({
    exportPath,
    dbPath,
    dryRun: true,
    mainRefs: ['vesper'],
    allowedRoots: [workDir],
  });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.title, 'Hero Gone: Harbor Watch');
  assert.equal(summary.threads, 1);
  assert.equal(summary.relations, 2);
  assert.equal(summary.facts, 4);
  assert.equal(fs.existsSync(dbPath), false);
});

test('ZetaSeeder preseeds campaign, cast, Scribe Operator log (position 0, cite null), and replays cleanly', (testContext) => {
  const workDir = makeTempDir(testContext);
  const exportPath = path.join(workDir, 'hero-export.json');
  const dbPath = path.join(workDir, 'worlds-seed.sqlite');
  fs.writeFileSync(exportPath, JSON.stringify(buildRichZetaFixture()), 'utf8');

  const result = ZetaSeeder.run({
    exportPath,
    dbPath,
    mainRefs: ['vesper'],
    allowedRoots: [workDir],
  });
  assert.equal(result.dryRun, false);
  assert.ok(result.campaignId);

  const store = new SqliteStore(dbPath);
  try {
    const campaign = store.getCampaign(result.campaignId);
    assert.equal(campaign.title, 'Hero Gone: Harbor Watch');
    assert.equal(campaign.premise, 'Smugglers control the drowned lighthouse while the magistrate sleeps.');
    assert.equal(campaign.styleNotes, 'Terse, sensory, maritime noir.');
    assert.equal(campaign.sceneState.location, 'Lantern Pier');
    assert.equal(campaign.sceneState.day, 3);
    assert.equal(campaign.sceneState.sceneType, SceneType.Private);

    const castPage = store.listCharacters(campaign.id, { includeArchived: true, limit: 25 });
    const rowanOne = castPage.items.find((char) => char.scribeSubjectId && char.isPlayer);
    const rowanTwo = castPage.items.find((char) => char.name === 'Rowan Vane' && !char.isPlayer);
    const vesper = castPage.items.find((char) => char.name === 'Vesper');
    const mara = castPage.items.find((char) => char.name === 'Mara');
    const oldFen = castPage.items.find((char) => char.name === 'Old Fen');

    assert.ok(rowanOne);
    assert.equal(campaign.playerCharacterId, rowanOne.id);
    assert.match(rowanOne.slug, /^[a-z0-9][a-z0-9_-]{0,47}$/);
    assert.ok(rowanOne.aliases.includes('Watchman Rowan'));
    assert.ok(rowanOne.aliases.includes('Rowan of the Pier'));
    assert.ok(rowanOne.aliases.includes('Greycoat'));

    assert.ok(rowanTwo);
    assert.notEqual(rowanTwo.slug, rowanOne.slug);
    assert.match(rowanTwo.slug, /^rowan/);

    assert.ok(vesper);
    assert.equal(vesper.tier, CharacterTier.Main);
    assert.ok(mara);
    assert.ok(oldFen);
    assert.equal(oldFen.archived, true);

    assert.deepEqual(
      new Set(campaign.sceneState.presentIds),
      new Set([rowanOne.id, mara.id]),
    );

    const bookRecord = store.getScribeBook(campaign.id);
    assert.equal(bookRecord.lastTurnSeq, 0);
    assert.equal(bookRecord.dirty, false);

    const savedLog = JSON.parse(bookRecord.bookJson);
    for (const entry of savedLog.entries) {
      assert.equal(entry.origin, ScribeLogCore.Origin.Operator);
      assert.equal(entry.kind, ScribeLogCore.Kind.Operator);
      for (const operation of entry.operations) {
        if (operation.position !== undefined) {
          assert.equal(operation.position, 0);
        }
        if (operation.cite !== undefined) {
          assert.equal(operation.cite, null);
        }
      }
    }

    const replayed = ScribeReplay.run(savedLog, []);
    const activeFacts = replayed.facts.filter((fact) => ScribeReplay.live(fact));
    assert.equal(activeFacts.some((fact) => fact.text === 'missing at sea'), false);
    assert.equal(activeFacts.length, 6);
    for (const fact of activeFacts) {
      assert.equal(fact.position, 0);
      assert.equal(fact.cite, null);
      assert.equal(fact.origin, ScribeLogCore.Origin.Operator);
    }

    const secretSealFact = activeFacts.find((fact) => fact.text.includes('customs seal'));
    assert.ok(secretSealFact);
    assert.equal(ScribeKnowledge.knows(replayed, mara.scribeSubjectId, secretSealFact), true);
    assert.equal(ScribeKnowledge.knows(replayed, vesper.scribeSubjectId, secretSealFact), true);
    assert.equal(ScribeKnowledge.knows(replayed, rowanOne.scribeSubjectId, secretSealFact), false);

    assert.equal(replayed.threads.length, 1);
    assert.equal(replayed.threads[0].position, 0);
    assert.equal(replayed.threads[0].cite, null);
    assert.equal(replayed.threads[0].origin, ScribeLogCore.Origin.Operator);
  } finally {
    store.close();
  }
});

test('ZetaSeeder imports raw Scribe log format and guards duplicate campaigns unless --force or --title is passed', (testContext) => {
  const workDir = makeTempDir(testContext);
  const rawLog = ScribeLogCore.create();
  let state = ScribeReplay.run(rawLog, []);
  ScribeLogCore.syncCharacterSubject(rawLog, state, {
    subjectId: null,
    name: 'Kestrel',
    aliases: ['The Falcon'],
    kind: 'character',
  });
  state = ScribeReplay.run(rawLog, []);
  ScribeLogCore.rule(rawLog, state, {
    type: ScribeLogCore.Ruling.AddFact,
    subject: 'S1',
    category: 'role',
    target: null,
    text: 'courier for the Bell Tower',
    hidden: false,
    cite: null,
    position: 0,
  });

  const rawExportPath = path.join(workDir, 'raw-log-export.json');
  const dbPath = path.join(workDir, 'duplicate-guard.sqlite');
  fs.writeFileSync(rawExportPath, JSON.stringify({
    title: 'Raw Log World',
    scribe: { log: rawLog },
  }), 'utf8');

  const firstRun = ZetaSeeder.run({
    exportPath: rawExportPath,
    dbPath,
    allowedRoots: [workDir],
  });

  assert.throws(
    () => ZetaSeeder.run({ exportPath: rawExportPath, dbPath, allowedRoots: [workDir] }),
    /already exists/,
  );

  const distinctTitleRun = ZetaSeeder.run({
    exportPath: rawExportPath,
    dbPath,
    title: 'Raw Log World Copy',
    allowedRoots: [workDir],
  });
  assert.notEqual(distinctTitleRun.campaignId, firstRun.campaignId);

  const forcedRun = ZetaSeeder.run({
    exportPath: rawExportPath,
    dbPath,
    force: true,
    allowedRoots: [workDir],
  });
  assert.notEqual(forcedRun.campaignId, firstRun.campaignId);

  const store = new SqliteStore(dbPath);
  try {
    const campaigns = store.listCampaigns({ limit: 50 });
    assert.equal(campaigns.total, 2);
    assert.equal(store.getCampaign(firstRun.campaignId), null);
    assert.ok(store.getCampaign(distinctTitleRun.campaignId));
    const replacedChars = store.listCharacters(forcedRun.campaignId);
    assert.equal(replacedChars.items[0].name, 'Kestrel');
    assert.equal(replacedChars.items[0].persona, 'role: courier for the Bell Tower');
  } finally {
    store.close();
  }
});
