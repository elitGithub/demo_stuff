import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SandboxConfig } from '../src/dto/SandboxConfig.mjs';
import { Catalog } from '../src/dto/Catalog.mjs';
import { EnquiryValidator } from '../src/EnquiryValidator.mjs';
import { EnquiryInput } from '../src/dto/EnquiryInput.mjs';
import { EnquiryRecord } from '../src/dto/EnquiryRecord.mjs';
import { BookingRecord } from '../src/dto/BookingRecord.mjs';
import { StatusChange } from '../src/dto/StatusChange.mjs';
import { EnquiryId } from '../src/dto/EnquiryId.mjs';
import { Acknowledgement } from '../src/dto/Acknowledgement.mjs';
import { CreatedEnquiry } from '../src/dto/CreatedEnquiry.mjs';
import { CreatedBooking } from '../src/dto/CreatedBooking.mjs';
import { ErrorCode } from '../src/enums/ErrorCode.mjs';
import { EnquiryStatus } from '../src/enums/EnquiryStatus.mjs';
import { BookingStatus } from '../src/enums/BookingStatus.mjs';
import { InputError } from '../src/InputError.mjs';
import { TestWorkspace } from './support/TestWorkspace.mjs';

const valid = { firstName: 'Alex', lastName: 'Sample', email: 'alex@travel.example', destination: 'italy', journey: 'italian-slow-days', departure: '', travelers: 2, budget: '$3,500–$5,000', message: 'Fictional details.', consent: true };
const validator = new EnquiryValidator(Catalog.canonical(), () => 1792281600);

test('configuration_has_canonical_defaults_and_rejects_unsafe_bounds', async () => {
  const defaults = JSON.parse(await readFile(new URL('../config/sandbox.json', import.meta.url), 'utf8'));
  assert.deepEqual(SandboxConfig.from({}).toJSON(), defaults);
  assert(Object.isFrozen(SandboxConfig.from({})));
  for (const change of [null, [], { maxEnquiries: 3 }, { maxEnquiries: 101 }, { maxSandboxes: 101 }, { sqlitePageBytes: 8192 }, { maxDatabaseBytes: 65537 }, { maxDatabaseBytes: 16384 }, { journalReserveBytes: 1048576 }, { stagingReserveBytes: 1048576 }, { registryReserveBytes: 1048576 }, { maxRuntimeBytes: 1000000 }, { lockWaitMilliseconds: 0 }, { lockRetryMilliseconds: 2001 }, { enquiryLimit: 1.5 }, { allocationLimit: Number.MAX_SAFE_INTEGER + 1 }, { cleanupBatch: 11 }, { sandboxCookie: 'invalid cookie' }, { dashboardCookie: 'elsewhere_sandbox_v1' }, { unexpected: 1 }]) {
    assert.throws(() => SandboxConfig.from(change), TypeError, JSON.stringify(change));
  }
});

test('validator_rejects_invalid_shapes_unicode_dates_consent_and_budgets', () => {
  for (const input of [null, [], true, 'text', 1]) { assert.throws(() => validator.validate(input), InputError); }
  for (const change of [{ firstName: '\ud800' }, { message: '\udfff' }, { lastName: 'a\u0000b' }, { email: 'invalid' }, { travelers: '2' }, { travelers: 2.5 }, { travelers: 0 }, { travelers: 13 }, { consent: 1 }, { consent: 'true' }, { consent: false }, { consent: null }, { departure: '2099-02-29' }, { departure: '2100-02-29' }, { departure: '2026-10-15' }, { departure: '2028-4-01' }, { budget: '$2000' }, { destination: 'bali' }, { journey: 'missing' }, { firstName: null }, { message: 'a'.repeat(2001) }]) {
    assert.throws(() => validator.validate({ ...valid, ...change }), InputError, JSON.stringify(change));
  }
  for (const departure of ['2026-10-17', '2026-10-18', '2028-02-29', '']) { assert.equal(validator.validate({ ...valid, departure }).departure, departure); }
  const input = validator.validate({ ...valid, destination: '', firstName: '  Alex  ' });
  assert(input instanceof EnquiryInput);
  assert.equal(input.firstName, 'Alex');
  assert.equal(input.destination, 'italy');
  assert.equal(Object.hasOwn(input, 'consent'), false);
  assert(Object.isFrozen(input));
  for (const budget of Catalog.canonical().budgets) { assert.equal(validator.validate({ ...valid, budget }).budget, budget); }
});

test('typed_wire_contract_is_frozen_and_preserves_existing_fields', () => {
  const input = validator.validate(valid);
  const enquiry = new EnquiryRecord({ id: 1, reference: 'EW-DEMO-001', input, status: EnquiryStatus.Proposal, createdAt: '2026-10-18T00:00:00.000Z' });
  const raw = JSON.parse(JSON.stringify(enquiry));
  assert.equal(raw.status, 'proposal');
  assert.equal(raw.firstName, 'Alex');
  assert.equal(Object.hasOwn(raw, 'input'), false);
  const booking = new BookingRecord({ id: 1, reference: 'BK-DEMO-001', enquiryId: null, firstName: 'Alex', lastName: 'Sample', destination: 'italy', journey: 'italian-slow-days', departure: '', travelers: 2, value: 6500, status: BookingStatus.Planning, createdAt: raw.createdAt });
  assert.equal(JSON.parse(JSON.stringify(booking)).status, 'planning');
  assert.equal(JSON.parse(JSON.stringify(booking)).enquiryId, null);
  assert.deepEqual(JSON.parse(JSON.stringify(new CreatedEnquiry({ id: 5, reference: 'EW-12345678' }))), { id: 5, reference: 'EW-12345678' });
  assert.deepEqual(JSON.parse(JSON.stringify(new CreatedBooking({ reference: 'BK-12345678' }))), { reference: 'BK-12345678' });
  assert.deepEqual(new Acknowledgement().toJSON(), { ok: true });
  assert.throws(() => new Acknowledgement({ ok: false }), TypeError);
  assert.throws(() => new EnquiryId({ id: Number.MAX_SAFE_INTEGER + 1 }), InputError);
  for (const id of [0, -1, 1.5, '1', NaN, Infinity]) { assert.throws(() => new EnquiryId({ id }), InputError); }
  assert.throws(() => new StatusChange({ id: 1, status: EnquiryStatus.Converted }), InputError);
  assert.throws(() => new StatusChange({ id: 1, status: 'new' }), InputError);
  assert.equal(new StatusChange({ id: 1, status: EnquiryStatus.New }).toJSON().status, 'new');
  const catalog = Catalog.canonical();
  assert(Object.isFrozen(catalog.destinations));
  assert(Object.isFrozen(catalog.journeys[0]));
  assert(Object.isFrozen(catalog.budgets));
  const catalogWire = JSON.parse(JSON.stringify(catalog));
  assert.deepEqual(Object.keys(catalogWire), ['destinations', 'journeys']);
  assert.deepEqual(Object.keys(catalogWire.journeys[0]), ['id', 'title']);
  for (const value of [enquiry, booking, input, EnquiryStatus.New, BookingStatus.Planning, ErrorCode.SandboxFull]) { assert(Object.isFrozen(value)); }
  assert.equal(ErrorCode.SandboxFull.label(), 'Your demo workspace is full.');
  const error = new InputError('Full', 409, ErrorCode.SandboxFull);
  assert.equal(error.status, 409);
  assert.equal(error.code.value, 'sandbox_full');
});

test('test_workspace_confines_paths_and_removes_only_its_fixture', async () => {
  const workspace = await TestWorkspace.create();
  try {
    assert.match(workspace.path('database.sqlite'), /\/travel-business\/storage\/test-runs\/workspace-[^/]+\/database.sqlite$/);
    assert.throws(() => workspace.path('../../outside'), TypeError);
    assert.throws(() => workspace.path('/tmp/outside'), TypeError);
  } finally { await workspace.close(); }
});
