import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, stat, access } from 'node:fs/promises';
import { VisitorStore } from '../src/VisitorStore.mjs';
import { createStore } from '../src/store.mjs';
import { SandboxConfig } from '../src/dto/SandboxConfig.mjs';
import { Catalog } from '../src/dto/Catalog.mjs';
import { EnquiryId } from '../src/dto/EnquiryId.mjs';
import { StatusChange } from '../src/dto/StatusChange.mjs';
import { Overview } from '../src/dto/Overview.mjs';
import { EnquiryRecord } from '../src/dto/EnquiryRecord.mjs';
import { BookingRecord } from '../src/dto/BookingRecord.mjs';
import { CreatedEnquiry } from '../src/dto/CreatedEnquiry.mjs';
import { EnquiryStatus } from '../src/enums/EnquiryStatus.mjs';
import { ErrorCode } from '../src/enums/ErrorCode.mjs';
import { InputError } from '../src/InputError.mjs';
import { EnquiryValidator } from '../src/EnquiryValidator.mjs';
import { TestWorkspace } from './support/TestWorkspace.mjs';
import seed from '../src/demo-seed.json' with { type: 'json' };

const now = () => 1792281600;
const catalog = Catalog.canonical();
const validator = new EnquiryValidator(catalog, now);
const valid = { firstName: 'Alex', lastName: 'Sample', email: 'alex@travel.example', destination: 'italy', journey: 'italian-slow-days', departure: '', travelers: 2, budget: '$3,500–$5,000', message: 'Fictional details.', consent: true };

test('canonical_seed_is_relative_and_private', async () => {
  const workspace = await TestWorkspace.create();
  const first = new VisitorStore(workspace.path('first.sqlite'), SandboxConfig.from({}), catalog, now, true);
  const later = new VisitorStore(workspace.path('later.sqlite'), SandboxConfig.from({}), catalog, () => now() + 86400, true);
  try {
    const overview = first.overview();
    const next = later.overview();
    assert(overview instanceof Overview);
    assert.equal(overview.enquiries.length, 4);
    assert.equal(overview.bookings.length, 3);
    assert(Object.isFrozen(overview.enquiries));
    for (const record of overview.enquiries) {
      assert(record instanceof EnquiryRecord);
      const canonical = seed.enquiries.find(enquiry => enquiry.id === record.id);
      assert.equal(record.reference, canonical.reference);
      assert.equal(record.input.email, canonical.email);
      assert.match(record.input.email, /@[^@]+\.example$/);
      assert.equal(record.input.departure, new Date((now() + canonical.departureDays * 86400) * 1000).toISOString().slice(0, 10));
      assert.equal(new Date(next.enquiries.find(enquiry => enquiry.id === record.id).input.departure) - new Date(record.input.departure), 86400000);
      assert.equal(record.createdAt, '2026-10-18T00:00:00.000Z');
    }
    for (const record of overview.bookings) {
      assert(record instanceof BookingRecord);
      const canonical = seed.bookings.find(booking => booking.id === record.id);
      assert.equal(record.departure, new Date((now() + canonical.departureDays * 86400) * 1000).toISOString().slice(0, 10));
      assert.equal(new Date(next.bookings.find(booking => booking.id === record.id).departure) - new Date(record.departure), 86400000);
    }
    assert.deepEqual(overview.enquiries.map(enquiry => enquiry.id), [4, 3, 2, 1]);
  } finally { first.close(); later.close(); await workspace.close(); }
});

test('open_existing_never_seeds', async () => {
  const workspace = await TestWorkspace.create();
  try {
    const missing = workspace.path('missing.sqlite');
    assert.throws(() => createStore(missing, SandboxConfig.from({}), catalog, now, false), error => {
      assert.equal(error.message, 'The sandbox database is unavailable.');
      assert.equal(error.status, 503);
      assert.equal(error.code, ErrorCode.Unavailable);
      assert.equal(error.cause.code, 'ENOENT');
      assert.equal(error.cause.path, missing);
      assert.equal(Object.getOwnPropertyDescriptor(error, 'cause').enumerable, false);
      assert.equal(JSON.stringify(error).includes(missing), false);
      assert.equal(JSON.stringify(error).includes('cause'), false);
      return true;
    });
    await assert.rejects(access(missing), { code: 'ENOENT' });
    for (const kind of ['malformed', 'empty', 'schema-less', 'incomplete-marker', 'missing-seed', 'wrong-schema', 'extra-trigger', 'extra-view', 'extra-index']) {
      const path = workspace.path(`${kind}.sqlite`);
      if (kind === 'malformed') { await writeFile(path, 'not a SQLite database'); }
      if (kind === 'empty') { await writeFile(path, ''); }
      if (kind === 'schema-less') { const database = new DatabaseSync(path); database.exec('CREATE TABLE unrelated (id INTEGER)'); database.close(); }
      if (['incomplete-marker', 'missing-seed', 'wrong-schema', 'extra-trigger', 'extra-view', 'extra-index'].includes(kind)) {
        const store = createStore(path, SandboxConfig.from({}), catalog, now, true);
        if (kind === 'incomplete-marker') { store.database.exec("DELETE FROM metadata WHERE key = 'seeded'"); }
        if (kind === 'missing-seed') { store.database.exec('DELETE FROM enquiries WHERE id = 4'); }
        if (kind === 'wrong-schema') { store.database.exec('ALTER TABLE enquiries ADD COLUMN unexpected TEXT'); }
        if (kind === 'extra-trigger') { store.database.exec("CREATE TRIGGER extra_row AFTER INSERT ON enquiries BEGIN INSERT INTO enquiries (reference, firstName, lastName, email, travelers, createdAt) VALUES (hex(randomblob(8)), NEW.firstName, NEW.lastName, NEW.email, NEW.travelers, NEW.createdAt); END"); }
        if (kind === 'extra-view') { store.database.exec('CREATE VIEW extra_view AS SELECT * FROM enquiries'); }
        if (kind === 'extra-index') { store.database.exec('CREATE INDEX extra_index ON enquiries(firstName)'); }
        store.close();
      }
      const before = await readFile(path);
      assert.throws(() => createStore(path, SandboxConfig.from({}), catalog, now, false), error => {
        assert(error instanceof InputError);
        assert.equal(error.code, ErrorCode.Unavailable);
        if (kind === 'malformed') {
          assert.equal(error.message, 'The sandbox database is unavailable.');
          assert.equal(error.status, 503);
          assert.equal(error.cause.code, 'ERR_SQLITE_ERROR');
          assert.equal(error.cause.errcode, 26);
          assert.equal(Object.getOwnPropertyDescriptor(error, 'cause').enumerable, false);
        }
        return true;
      }, kind);
      assert.deepEqual(await readFile(path), before, kind);
      assert.throws(() => createStore(path, SandboxConfig.from({}), catalog, now, true), error => error.code === ErrorCode.Unavailable, `${kind}: create must refuse`);
      assert.deepEqual(await readFile(path), before, kind);
    }
  } finally { await workspace.close(); }
});

test('record_cap_is_transactional', async () => {
  const workspace = await TestWorkspace.create();
  const store = createStore(workspace.path('records.sqlite'), SandboxConfig.from({ maxEnquiries: 5 }), catalog, now, true);
  try {
    const created = store.createEnquiry(validator.validate(valid));
    assert(created instanceof CreatedEnquiry);
    assert.equal(created.id, 5);
    assert.throws(() => store.createEnquiry(validator.validate(valid)), error => error.code === ErrorCode.SandboxFull && error.status === 409);
    assert.equal(store.overview().enquiries.length, 5);
    assert.equal(store.database.isTransaction, false);
    assert.equal(store.updateStatus(new StatusChange({ id: 5, status: EnquiryStatus.Contacted })).ok, true);
  } finally { store.close(); await workspace.close(); }
});

test('conversion_rolls_back_and_is_unique', async () => {
  const workspace = await TestWorkspace.create();
  const store = createStore(workspace.path('conversion.sqlite'), SandboxConfig.from({}), catalog, now, true);
  try {
    const converted = store.convert(new EnquiryId({ id: 1 }));
    assert.match(converted.reference, /^BK-[A-F0-9]{8}$/);
    assert.throws(() => store.convert(new EnquiryId({ id: 1 })), error => error.code === ErrorCode.Conflict);
    assert.throws(() => store.updateStatus(new StatusChange({ id: 1, status: EnquiryStatus.New })), error => error.code === ErrorCode.Conflict);
    const before = JSON.stringify(store.overview());
    store.database.exec("CREATE TRIGGER force_conversion_failure AFTER UPDATE OF status ON enquiries WHEN NEW.id = 2 BEGIN SELECT RAISE(ABORT, 'forced conversion failure'); END;");
    assert.throws(() => store.convert(new EnquiryId({ id: 2 })), error => error.code !== ErrorCode.SandboxFull && /forced conversion failure/.test(error.message));
    assert.equal(JSON.stringify(store.overview()), before);
    assert.equal(store.database.isTransaction, false);
    assert.throws(() => store.convert(new EnquiryId({ id: 999 })), error => error.code === ErrorCode.NotFound);
  } finally { store.close(); await workspace.close(); }
});

test('unicode_and_page_limit', async () => {
  const workspace = await TestWorkspace.create();
  const config = SandboxConfig.from({ maxSandboxes: 1, maxDatabaseBytes: 65536 });
  const store = createStore(workspace.path('limited.sqlite'), config, catalog, now, true);
  try {
    const astral = String.fromCodePoint(0x1f642);
    const input = validator.validate({ ...valid, firstName: astral.repeat(60), lastName: astral.repeat(60), message: astral.repeat(2000) });
    assert.equal([...input.message].length, 2000);
    assert.throws(() => validator.validate({ ...valid, message: astral.repeat(2001) }), InputError);
    assert.throws(() => validator.validate({ ...valid, firstName: astral.repeat(61) }), InputError);
    let reachedLimit = false;
    let accepted = 4;
    while (!reachedLimit && accepted < config.maxEnquiries) {
      const before = JSON.stringify(store.overview());
      try { store.createEnquiry(input); accepted += 1; }
      catch (error) {
        assert.equal(error.code, ErrorCode.SandboxFull);
        assert.match(error.message, /storage limit/);
        assert.equal(JSON.stringify(store.overview()), before);
        reachedLimit = true;
      }
      assert((await stat(workspace.path('limited.sqlite'))).size <= config.maxDatabaseBytes);
    }
    assert.equal(reachedLimit, true, 'must force actual SQLite page exhaustion');
    assert.equal(store.overview().enquiries.length, accepted);
    assert.equal(store.database.isTransaction, false);
    assert.equal(store.database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { store.close(); await workspace.close(); }
});

test('settings_and_typed_wire_contract', async () => {
  const workspace = await TestWorkspace.create();
  const path = workspace.path('settings.sqlite');
  const config = SandboxConfig.from({ maxSandboxes: 1, maxDatabaseBytes: 65536 });
  let store = createStore(path, config, catalog, now, true);
  try {
    for (let connection = 0; connection < 2; connection += 1) {
      for (const [setting, expected] of Object.entries({ journal_mode: 'delete', page_size: 4096, foreign_keys: 1, max_page_count: 16, temp_store: 2, cache_spill: 0, cache_size: 16 })) { assert.equal(store.database.prepare(`PRAGMA ${setting}`).get()[setting], expected); }
      assert.throws(() => store.database.exec("INSERT INTO bookings (reference, enquiryId, firstName, lastName, travelers, createdAt) VALUES ('invalid-link', 999, 'Test', 'Sample', 1, '2026-10-18')"), /FOREIGN KEY constraint/);
      assert.equal(store.database.isTransaction, false);
      if (connection === 0) { store.close(); store = createStore(path, config, catalog, now, false); }
    }
    const wire = JSON.parse(JSON.stringify(store.overview()));
    assert.equal(wire.enquiries[0].status, 'new');
    assert.equal(wire.enquiries[0].input, undefined);
    assert.equal(wire.enquiries[0].firstName, 'Noah');
    assert.equal(wire.bookings[0].status, 'confirmed');
    assert.equal(wire.catalog.budgets, undefined);
    assert.throws(() => createStore(workspace.path('invalid-config.sqlite'), {}, catalog, now, true), TypeError);
    await assert.rejects(access(workspace.path('invalid-config.sqlite')), { code: 'ENOENT' });
  } finally { store.close(); await workspace.close(); }
});
