import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, chmod, link, mkdir, readFile, readdir, rename, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TestWorkspace } from './support/TestWorkspace.mjs';
import { SandboxRuntime } from '../src/sandbox/SandboxRuntime.mjs';
import { SandboxRegistry } from '../src/sandbox/SandboxRegistry.mjs';
import { SandboxQueue } from '../src/sandbox/SandboxQueue.mjs';
import { SandboxConfig } from '../src/dto/SandboxConfig.mjs';
import { Catalog } from '../src/dto/Catalog.mjs';
import { RequestIdentity } from '../src/dto/RequestIdentity.mjs';
import { Registry } from '../src/dto/Registry.mjs';
import { SandboxRecord } from '../src/dto/SandboxRecord.mjs';
import { RateBucket } from '../src/dto/RateBucket.mjs';
import { CookieChange } from '../src/dto/CookieChange.mjs';
import { ApiResult } from '../src/dto/ApiResult.mjs';
import { EnquiryId } from '../src/dto/EnquiryId.mjs';
import { StatusChange } from '../src/dto/StatusChange.mjs';
import { EnquiryValidator } from '../src/EnquiryValidator.mjs';
import { InputError } from '../src/InputError.mjs';
import { ErrorCode } from '../src/enums/ErrorCode.mjs';
import { SandboxOperation } from '../src/enums/SandboxOperation.mjs';
import { SandboxState } from '../src/enums/SandboxState.mjs';
import { EnquiryStatus } from '../src/enums/EnquiryStatus.mjs';
import { createStore } from '../src/store.mjs';

const catalog = Catalog.canonical();
const start = 1800000000;
const initialIdentity = () => new RequestIdentity({ remoteAddress: '192.0.2.10' });
const hash = value => createHash('sha256').update(value).digest('hex');
const client = (result, previous = initialIdentity()) => new RequestIdentity({ sandboxToken: result.cookies.find(cookie => cookie.name === 'elsewhere_sandbox_v1')?.value ?? previous.sandboxToken, dashboardToken: result.cookies.find(cookie => cookie.name === 'elsewhere_dashboard_v1')?.value || previous.dashboardToken, contextToken: result.payload.csrfToken ?? previous.contextToken, remoteAddress: previous.remoteAddress });
const code = expected => error => error instanceof InputError && error.code === expected;
const input = () => new EnquiryValidator(catalog, () => start).validate({ firstName: 'Alex', lastName: 'Example', email: 'alex@traveller.example', destination: 'italy', journey: 'italian-slow-days', departure: '', travelers: 2, budget: '', message: 'Private fictional enquiry.', consent: true });
const registryBytes = root => readFile(join(root, 'registry.json'));
const record = (runtime, identity) => runtime.registry.load().sandboxes.get(hash(identity.sandboxToken));

test('two_contexts_and_logout_retention', async () => {
  const workspace = await TestWorkspace.create();
  try {
    const root = workspace.path('runtime');
    const runtime = new SandboxRuntime(root, SandboxConfig.from({}), catalog, () => start);
    const first = await runtime.execute(SandboxOperation.Bootstrap, initialIdentity());
    const second = await runtime.execute(SandboxOperation.Bootstrap, initialIdentity());
    let visitor = client(first);
    let other = client(second);
    assert(first instanceof ApiResult);
    assert(Object.isFrozen(first));
    assert(Object.isFrozen(first.cookies));
    assert(first.cookies.every(cookie => cookie instanceof CookieChange && cookie.maxAge === 14400 && cookie.path === '/' && cookie.secure === false));
    assert.notEqual(visitor.sandboxToken, other.sandboxToken);
    assert.notEqual(visitor.contextToken, other.contextToken);
    assert.notEqual(hash(visitor.sandboxToken), hash(other.sandboxToken));
    assert.equal(first.payload.created, true);
    assert.equal(first.payload.protocolVersion, 1);
    assert.equal(first.payload.pageSize, 20);
    assert.equal(first.payload.expiresAt, start + 14400);
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, hash(visitor.sandboxToken), 'demo.sqlite'))).mode & 0o777, 0o600);
    await assert.rejects(runtime.execute(SandboxOperation.Overview, visitor), code(ErrorCode.DashboardAccess));
    visitor = client(await runtime.execute(SandboxOperation.Login, visitor), visitor);
    other = client(await runtime.execute(SandboxOperation.Login, other), other);
    const ownSeed = (await runtime.execute(SandboxOperation.Overview, visitor)).payload;
    const otherSeed = (await runtime.execute(SandboxOperation.Overview, other)).payload;
    assert.equal(ownSeed.enquiries.length, 4);
    assert.equal(otherSeed.enquiries.length, 4);
    assert.equal(ownSeed.bookings.length, 3);
    const created = (await runtime.execute(SandboxOperation.CreateEnquiry, visitor, input())).payload;
    await runtime.execute(SandboxOperation.UpdateStatus, visitor, new StatusChange({ id: created.id, status: EnquiryStatus.Proposal }));
    await runtime.execute(SandboxOperation.CreateBooking, visitor, new EnquiryId({ id: created.id }));
    const own = (await runtime.execute(SandboxOperation.Overview, visitor)).payload;
    const separate = (await runtime.execute(SandboxOperation.Overview, other)).payload;
    assert.equal(own.enquiries.length, 5);
    assert.equal(own.bookings.length, 4);
    assert.equal(own.enquiries[0].status, EnquiryStatus.Converted);
    assert.equal(separate.enquiries.length, 4);
    assert.equal(separate.bookings.length, 3);
    await assert.rejects(runtime.execute(SandboxOperation.UpdateStatus, other, new StatusChange({ id: created.id, status: EnquiryStatus.Closed })), code(ErrorCode.NotFound));
    const path = join(root, hash(visitor.sandboxToken), 'demo.sqlite');
    const before = await readFile(path);
    const loggedOut = await runtime.execute(SandboxOperation.Logout, visitor);
    assert.equal(loggedOut.cookies.length, 2);
    assert.equal(loggedOut.cookies[1].value, '');
    assert.equal(loggedOut.cookies[1].maxAge, 0);
    assert.deepEqual(await readFile(path), before);
    assert.equal(record(runtime, visitor).dashboardDigest, null);
    await assert.rejects(runtime.execute(SandboxOperation.Overview, visitor), code(ErrorCode.DashboardAccess));
    visitor = client(await runtime.execute(SandboxOperation.Login, visitor), visitor);
    assert.equal((await runtime.execute(SandboxOperation.Overview, visitor)).payload.enquiries.length, 5);
    assert.equal(runtime.registry.load().sandboxes.size, 2);
  } finally { await workspace.close(); }
});

test('exact_idle_boundary_and_sliding_activity', async () => {
  const workspace = await TestWorkspace.create();
  let timestamp = start;
  try {
    const root = workspace.path('runtime');
    const runtime = new SandboxRuntime(root, SandboxConfig.from({}), catalog, () => timestamp);
    const visitor = client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()));
    const before = await registryBytes(root);
    for (const contextToken of [null, 'f'.repeat(64), '../invalid', 'A'.repeat(64)]) {
      await assert.rejects(runtime.execute(SandboxOperation.CreateEnquiry, new RequestIdentity({ ...visitor, contextToken }), input()), code(ErrorCode.SandboxContext));
      assert.deepEqual(await registryBytes(root), before);
    }
    await assert.rejects(runtime.execute(SandboxOperation.Overview, visitor), code(ErrorCode.DashboardAccess));
    assert.deepEqual(await registryBytes(root), before);
    timestamp += 14399;
    const resumed = await runtime.execute(SandboxOperation.Bootstrap, visitor);
    assert.equal(resumed.payload.created, false);
    assert.equal(resumed.payload.expiresAt, start + 28799);
    assert.equal(resumed.payload.csrfToken, visitor.contextToken);
    const path = join(root, hash(visitor.sandboxToken), 'demo.sqlite');
    const bytes = await readFile(path);
    timestamp = start + 28799;
    const originalRemove = runtime.registry.remove.bind(runtime.registry);
    runtime.registry.remove = () => { throw new Error('Simulated deletion failure.'); };
    const quiet = mock.method(console, 'error', () => {});
    try { await assert.rejects(runtime.execute(SandboxOperation.CreateEnquiry, visitor, input()), code(ErrorCode.SandboxContext)); }
    finally { runtime.registry.remove = originalRemove; quiet.mock.restore(); }
    assert.deepEqual(await readFile(path), bytes);
    assert.equal(record(runtime, visitor).lastActivity, start + 14399);
    assert.equal(record(runtime, visitor).state, SandboxState.Failed);
  } finally { await workspace.close(); }
});

test('admitted_business_errors_renew_and_rejected_admission_does_not', async () => {
  const workspace = await TestWorkspace.create();
  let timestamp = start;
  try {
    const root = workspace.path('runtime');
    const runtime = new SandboxRuntime(root, SandboxConfig.from({ maxEnquiries: 4, enquiryLimit: 1 }), catalog, () => timestamp);
    let visitor = client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()));
    visitor = client(await runtime.execute(SandboxOperation.Login, visitor), visitor);
    timestamp += 10;
    await assert.rejects(runtime.execute(SandboxOperation.CreateEnquiry, visitor, input()), error => {
      assert.equal(error.code, ErrorCode.SandboxFull);
      assert.equal(error.cookies.length, 2);
      assert(Object.isFrozen(error.cookies));
      return true;
    });
    assert.equal(record(runtime, visitor).lastActivity, timestamp);
    timestamp += 10;
    const bytes = await registryBytes(root);
    await assert.rejects(runtime.execute(SandboxOperation.CreateEnquiry, visitor, input()), error => {
      assert.equal(error.code, ErrorCode.RateLimited);
      assert.equal(error.cookies.length, 0);
      assert.equal(error.retryAfter, 3590);
      return true;
    });
    assert.deepEqual(await registryBytes(root), bytes);
    await runtime.execute(SandboxOperation.CreateBooking, visitor, new EnquiryId({ id: 1 }));
    timestamp += 10;
    await assert.rejects(runtime.execute(SandboxOperation.CreateBooking, visitor, new EnquiryId({ id: 1 })), error => error.code === ErrorCode.Conflict && error.cookies.length === 2);
    assert.equal(record(runtime, visitor).lastActivity, timestamp);
    const resumed = await runtime.execute(SandboxOperation.Bootstrap, visitor);
    assert.equal(resumed.cookies.length, 2);
    assert.equal(resumed.cookies[1].value, visitor.dashboardToken);
  } finally { await workspace.close(); }
});

test('restart_and_token_binding', async () => {
  const workspace = await TestWorkspace.create();
  let timestamp = start;
  try {
    const root = workspace.path('runtime');
    const config = SandboxConfig.from({});
    let runtime = new SandboxRuntime(root, config, catalog, () => timestamp);
    let visitor = client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()));
    let other = client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()));
    visitor = client(await runtime.execute(SandboxOperation.Login, visitor), visitor);
    other = client(await runtime.execute(SandboxOperation.Login, other), other);
    await runtime.execute(SandboxOperation.UpdateStatus, visitor, new StatusChange({ id: 1, status: EnquiryStatus.Closed }));
    timestamp += 30;
    runtime = new SandboxRuntime(root, config, catalog, () => timestamp);
    assert.equal((await runtime.execute(SandboxOperation.Overview, visitor)).payload.enquiries.find(enquiry => enquiry.id === 1).status, EnquiryStatus.Closed);
    const before = await registryBytes(root);
    await assert.rejects(runtime.execute(SandboxOperation.Overview, new RequestIdentity({ ...visitor, dashboardToken: other.dashboardToken })), code(ErrorCode.DashboardAccess));
    await assert.rejects(runtime.execute(SandboxOperation.Overview, new RequestIdentity({ ...visitor, sandboxToken: other.sandboxToken })), code(ErrorCode.SandboxContext));
    await assert.rejects(runtime.execute(SandboxOperation.Overview, new RequestIdentity({ ...visitor, contextToken: null, dashboardToken: null })), code(ErrorCode.SandboxContext));
    assert.deepEqual(await registryBytes(root), before);
    const old = visitor;
    visitor = client(await runtime.execute(SandboxOperation.Login, visitor), visitor);
    assert.notEqual(visitor.dashboardToken, old.dashboardToken);
    await assert.rejects(runtime.execute(SandboxOperation.Overview, old), code(ErrorCode.DashboardAccess));
    timestamp += 1;
    await runtime.execute(SandboxOperation.Logout, visitor);
    assert.equal(record(runtime, visitor).lastActivity, timestamp);
    assert.equal(record(runtime, visitor).dashboardDigest, null);
    const resumed = await runtime.execute(SandboxOperation.Bootstrap, visitor);
    assert.equal(resumed.cookies.length, 1);
    assert.equal(resumed.payload.created, false);
    assert.equal(resumed.payload.csrfToken, old.contextToken);
    await assert.rejects(runtime.execute(SandboxOperation.Overview, visitor), code(ErrorCode.DashboardAccess));
  } finally { await workspace.close(); }
});

test('parallel_allocation_and_full_capacity', async () => {
  const workspace = await TestWorkspace.create();
  try {
    const root = workspace.path('runtime');
    const config = SandboxConfig.from({ maxSandboxes: 2, allocationLimit: 100 });
    const runtimes = [new SandboxRuntime(root, config, catalog, () => start), new SandboxRuntime(join(root, '..', 'runtime'), config, catalog, () => start)];
    assert.equal(runtimes[0].queue, runtimes[1].queue);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => runtimes[index % 2].execute(SandboxOperation.Bootstrap, initialIdentity())));
    const accepted = results.filter(result => result.status === 'fulfilled');
    assert.equal(accepted.length, 2);
    for (const rejected of results.filter(result => result.status === 'rejected')) { assert.equal(rejected.reason.code, ErrorCode.Capacity); }
    const registry = runtimes[0].registry.load();
    assert.equal(registry.sandboxes.size, 2);
    assert.equal([...registry.rateBuckets.values()][0].hits, 2);
    const first = client(accepted[0].value);
    const before = await readFile(join(root, hash(first.sandboxToken), 'demo.sqlite'));
    await assert.rejects(runtimes[0].execute(SandboxOperation.Bootstrap, initialIdentity()), code(ErrorCode.Capacity));
    assert.deepEqual(await readFile(join(root, hash(first.sandboxToken), 'demo.sqlite')), before);
    assert.equal((await runtimes[0].execute(SandboxOperation.Bootstrap, first)).payload.created, false);
  } finally { await workspace.close(); }
});

test('cleanup_is_bounded_and_safe', async () => {
  const workspace = await TestWorkspace.create();
  let timestamp = start;
  try {
    const root = workspace.path('runtime');
    const runtime = new SandboxRuntime(root, SandboxConfig.from({ allocationLimit: 100 }), catalog, () => timestamp);
    const clients = [];
    for (let index = 0; index < 12; index += 1) { clients.push(client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()))); }
    timestamp += 14399;
    const live = client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()));
    const livePath = join(root, hash(live.sandboxToken), 'demo.sqlite');
    const liveBytes = await readFile(livePath);
    const sentinel = workspace.path('legacy.sqlite');
    await writeFile(sentinel, 'legacy sentinel', { mode: 0o600 });
    timestamp += 1;
    await assert.rejects(runtime.execute(SandboxOperation.CreateEnquiry, clients[11], input()), code(ErrorCode.SandboxContext));
    assert.equal(runtime.registry.load().sandboxes.size, 3);
    await access(join(root, hash(clients[11].sandboxToken), 'demo.sqlite'));
    assert.deepEqual(await readFile(livePath), liveBytes);
    assert.equal(await readFile(sentinel, 'utf8'), 'legacy sentinel');
    await runtime.execute(SandboxOperation.Bootstrap, live);
    assert.equal(runtime.registry.load().sandboxes.size, 1);
    const target = workspace.path('outside');
    await mkdir(target, { mode: 0o700 });
    await writeFile(join(target, 'sentinel'), 'untouched', { mode: 0o600 });
    await symlink(target, join(root, 'f'.repeat(64)));
    await assert.rejects(runtime.execute(SandboxOperation.Bootstrap, live), code(ErrorCode.Unavailable));
    assert.equal(await readFile(join(target, 'sentinel'), 'utf8'), 'untouched');
    assert.equal(await readFile(sentinel, 'utf8'), 'legacy sentinel');
    assert.deepEqual(await readFile(livePath), liveBytes);
  } finally { await workspace.close(); }
});

test('crash_and_delete_failures_stay_charged', async () => {
  const workspace = await TestWorkspace.create();
  const quiet = mock.method(console, 'error', () => {});
  try {
    for (const phase of ['before-mkdir', 'seeded', 'renamed']) {
      const root = workspace.path(phase);
      const config = SandboxConfig.from({ maxSandboxes: 1 });
      const registry = new SandboxRegistry(root, config);
      registry.load();
      const pending = new SandboxRecord({ digest: 'a'.repeat(64), csrfToken: 'b'.repeat(64), dashboardDigest: null, lastActivity: start, state: SandboxState.Pending });
      const bucket = new RateBucket({ key: hash(`allocation${String.fromCharCode(0)}192.0.2.10`), hits: 1, expiresAt: start + 3600 });
      registry.save(new Registry({ sandboxes: new Map([[pending.digest, pending]]), rateBuckets: new Map([[bucket.key, bucket]]) }));
      if (phase !== 'before-mkdir') {
        await mkdir(join(root, pending.digest), { mode: 0o700 });
        const store = createStore(join(root, pending.digest, 'seed.sqlite'), config, catalog, () => start, true);
        store.close();
        if (phase === 'renamed') { await rename(join(root, pending.digest, 'seed.sqlite'), join(root, pending.digest, 'demo.sqlite')); }
      }
      await writeFile(join(root, 'registry.next'), '{"truncated":', { mode: 0o600 });
      const runtime = new SandboxRuntime(root, config, catalog, () => start);
      const originalRemove = runtime.registry.remove.bind(runtime.registry);
      runtime.registry.remove = () => { const error = new Error('Simulated EACCES.'); error.code = 'EACCES'; throw error; };
      await assert.rejects(runtime.execute(SandboxOperation.Bootstrap, initialIdentity()), code(ErrorCode.Capacity));
      const failed = runtime.registry.load();
      assert.equal(failed.sandboxes.size, 1);
      assert.equal(failed.sandboxes.get(pending.digest).state, SandboxState.Failed);
      assert.equal(failed.rateBuckets.get(bucket.key).hits, 1);
      await assert.rejects(runtime.execute(SandboxOperation.Bootstrap, initialIdentity()), code(ErrorCode.Capacity));
      assert.equal(runtime.registry.load().sandboxes.size, 1);
      runtime.registry.remove = originalRemove;
      await runtime.execute(SandboxOperation.Bootstrap, initialIdentity());
      assert.equal(runtime.registry.load().sandboxes.size, 1);
      assert.equal(runtime.registry.load().sandboxes.has(pending.digest), false);
      assert.equal(runtime.registry.load().rateBuckets.get(bucket.key).hits, 2);
    }
    const root = workspace.path('missing-ready');
    const runtime = new SandboxRuntime(root, SandboxConfig.from({}), catalog, () => start);
    const visitor = client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()));
    const path = join(root, hash(visitor.sandboxToken), 'demo.sqlite');
    await unlink(path);
    await assert.rejects(runtime.execute(SandboxOperation.Bootstrap, visitor), code(ErrorCode.Unavailable));
    await assert.rejects(access(path), { code: 'ENOENT' });
    assert.equal(JSON.parse(await registryBytes(root)).sandboxes[hash(visitor.sandboxToken)].state, 'ready');
    const failureRoot = workspace.path('failed-ready-save');
    const failing = new SandboxRuntime(failureRoot, SandboxConfig.from({ maxSandboxes: 1 }), catalog, () => start);
    const originalSave = failing.registry.save.bind(failing.registry);
    failing.registry.save = registry => {
      if ([...registry.sandboxes.values()].some(allocation => allocation.state === SandboxState.Ready)) { const error = new Error('Simulated fsync failure.'); error.code = 'EIO'; throw error; }
      originalSave(registry);
    };
    await assert.rejects(failing.execute(SandboxOperation.Bootstrap, initialIdentity()), error => {
      assert.equal(error.code, ErrorCode.Unavailable);
      assert.equal(error.cause.code, 'EIO');
      assert.equal(Object.getOwnPropertyDescriptor(error, 'cause').enumerable, false);
      return true;
    });
    assert.equal([...failing.registry.load().sandboxes.values()][0].state, SandboxState.Pending);
    const restarted = new SandboxRuntime(failureRoot, SandboxConfig.from({ maxSandboxes: 1 }), catalog, () => start);
    await restarted.execute(SandboxOperation.Bootstrap, initialIdentity());
    assert.equal(restarted.registry.load().sandboxes.size, 1);
  } finally { quiet.mock.restore(); await workspace.close(); }
});

test('failed_real_cleanup_retains_slot_and_all_remaining_bytes', async () => {
  const workspace = await TestWorkspace.create();
  const quiet = mock.method(console, 'error', () => {});
  let timestamp = start;
  let protectedPath;
  try {
    const root = workspace.path('runtime');
    const runtime = new SandboxRuntime(root, SandboxConfig.from({ maxSandboxes: 1 }), catalog, () => timestamp);
    const visitor = client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()));
    protectedPath = join(root, hash(visitor.sandboxToken));
    await writeFile(join(protectedPath, 'demo.sqlite-journal'), Buffer.alloc(4096), { mode: 0o600 });
    await chmod(protectedPath, 0o500);
    if (process.getuid() === 0) { runtime.registry.remove = () => { const error = new Error('Simulated root-only EACCES.'); error.code = 'EACCES'; throw error; }; }
    timestamp += 14400;
    await assert.rejects(runtime.execute(SandboxOperation.Bootstrap, initialIdentity()), code(ErrorCode.Capacity));
    const charged = runtime.registry.load();
    assert.equal(charged.sandboxes.size, 1);
    assert.equal(charged.sandboxes.get(hash(visitor.sandboxToken)).state, SandboxState.Failed);
    assert.equal(runtime.registry.extraBytes(charged), 4096);
    await access(join(protectedPath, 'demo.sqlite'));
    assert.equal(quiet.mock.callCount() > 0, true);
  } finally { if (protectedPath) { await chmod(protectedPath, 0o700); } quiet.mock.restore(); await workspace.close(); }
});

test('reservation_includes_leftovers', async () => {
  const workspace = await TestWorkspace.create();
  try {
    const root = workspace.path('runtime');
    const config = SandboxConfig.from({ maxSandboxes: 2, maxDatabaseBytes: 65536, journalReserveBytes: 131072, stagingReserveBytes: 131072, registryReserveBytes: 2097152, maxRuntimeBytes: 2490368 });
    const runtime = new SandboxRuntime(root, config, catalog, () => start);
    let visitor = client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()));
    visitor = client(await runtime.execute(SandboxOperation.Login, visitor), visitor);
    await runtime.execute(SandboxOperation.Bootstrap, initialIdentity());
    const path = join(root, hash(visitor.sandboxToken));
    await writeFile(join(path, 'demo.sqlite-journal'), Buffer.alloc(8192), { mode: 0o600 });
    await writeFile(join(path, 'seed.sqlite'), Buffer.alloc(4096), { mode: 0o600 });
    const registry = runtime.registry.load();
    assert.equal(runtime.registry.extraBytes(registry), 12288);
    assert.equal(registry.sandboxes.size * config.maxDatabaseBytes + config.registryReserveBytes + config.journalReserveBytes + config.stagingReserveBytes, config.maxRuntimeBytes);
    const before = await registryBytes(root);
    const database = await readFile(join(path, 'demo.sqlite'));
    await assert.rejects(runtime.execute(SandboxOperation.CreateEnquiry, visitor, input()), code(ErrorCode.Capacity));
    await assert.rejects(runtime.execute(SandboxOperation.Overview, visitor), code(ErrorCode.Capacity));
    assert.deepEqual(await registryBytes(root), before);
    assert.deepEqual(await readFile(join(path, 'demo.sqlite')), database);
    assert.equal((await readdir(path)).length, 3);
    await unlink(join(path, 'seed.sqlite'));
    await unlink(join(path, 'demo.sqlite-journal'));
    assert.equal((await runtime.execute(SandboxOperation.Overview, visitor)).payload.enquiries.length, 4);
    await writeFile(join(path, 'demo.sqlite-journal'), Buffer.alloc(config.journalReserveBytes + 1), { mode: 0o600 });
    await assert.rejects(runtime.execute(SandboxOperation.CreateEnquiry, visitor, input()), code(ErrorCode.Unavailable));
    assert.equal((await stat(join(path, 'demo.sqlite-journal'))).size, config.journalReserveBytes + 1);
  } finally { await workspace.close(); }
});

test('hot_journal_restart_preserves_committed_work', async () => {
  const workspace = await TestWorkspace.create();
  try {
    const root = workspace.path('runtime');
    const config = SandboxConfig.from({});
    const runtime = new SandboxRuntime(root, config, catalog, () => start);
    let visitor = client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()));
    visitor = client(await runtime.execute(SandboxOperation.Login, visitor), visitor);
    const created = (await runtime.execute(SandboxOperation.CreateEnquiry, visitor, input())).payload;
    const path = join(root, hash(visitor.sandboxToken), 'demo.sqlite');
    const child = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', "import { DatabaseSync } from 'node:sqlite'; const database = new DatabaseSync(process.argv[1]); database.exec(\"PRAGMA cache_size=1; PRAGMA cache_spill=ON; BEGIN IMMEDIATE; UPDATE enquiries SET message=printf('%02000d', 7);\"); process.exit(0);", path], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.equal((await stat(`${path}-journal`)).size > 0, true);
    assert.equal(runtime.registry.extraBytes(runtime.registry.load()) > 0, true);
    const restarted = new SandboxRuntime(root, config, catalog, () => start + 1);
    const overview = (await restarted.execute(SandboxOperation.Overview, visitor)).payload;
    assert.equal(overview.enquiries.length, 5);
    assert.equal(overview.enquiries[0].reference, created.reference);
    assert.equal(overview.enquiries[0].input.message, 'Private fictional enquiry.');
    assert.equal(restarted.registry.load().sandboxes.size, 1);
  } finally { await workspace.close(); }
});

test('limits_survive_cookie_reset', async () => {
  const workspace = await TestWorkspace.create();
  let timestamp = start;
  try {
    const root = workspace.path('runtime');
    const config = SandboxConfig.from({});
    let runtime = new SandboxRuntime(root, config, catalog, () => timestamp);
    const clients = [];
    for (let index = 0; index < 10; index += 1) { clients.push(client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()))); }
    const before = await registryBytes(root);
    await assert.rejects(runtime.execute(SandboxOperation.Bootstrap, initialIdentity()), error => error.code === ErrorCode.RateLimited && error.retryAfter === 3600);
    assert.deepEqual(await registryBytes(root), before);
    runtime = new SandboxRuntime(root, config, catalog, () => timestamp);
    await assert.rejects(runtime.execute(SandboxOperation.Bootstrap, initialIdentity()), code(ErrorCode.RateLimited));
    let visitor = clients[0];
    for (let index = 0; index < 50; index += 1) { visitor = client(await runtime.execute(SandboxOperation.Login, visitor), visitor); }
    const loginState = await registryBytes(root);
    timestamp += 1;
    await assert.rejects(runtime.execute(SandboxOperation.Login, visitor), error => error.code === ErrorCode.RateLimited && error.retryAfter === 3599 && error.cookies.length === 0);
    assert.deepEqual(await registryBytes(root), loginState);
    for (let index = 0; index < 50; index += 1) { await runtime.execute(SandboxOperation.CreateEnquiry, visitor, input()); }
    const enquiryState = await registryBytes(root);
    await assert.rejects(new SandboxRuntime(root, config, catalog, () => timestamp).execute(SandboxOperation.CreateEnquiry, clients[1], input()), code(ErrorCode.RateLimited));
    assert.deepEqual(await registryBytes(root), enquiryState);
    const other = new RequestIdentity({ remoteAddress: '192.0.2.11' });
    let separate = client(await runtime.execute(SandboxOperation.Bootstrap, other), other);
    separate = client(await runtime.execute(SandboxOperation.Login, separate), separate);
    assert.equal((await runtime.execute(SandboxOperation.Overview, separate)).payload.enquiries.length, 4);
    assert.equal((await runtime.execute(SandboxOperation.Overview, visitor)).payload.enquiries.length, 54);
    timestamp = start + 3600;
    assert.equal((await runtime.execute(SandboxOperation.Bootstrap, initialIdentity())).payload.created, true);
    assert.equal((await runtime.execute(SandboxOperation.Login, visitor)).payload.ok, true);
    timestamp += 1;
    assert.equal((await runtime.execute(SandboxOperation.CreateEnquiry, visitor, input())).payload.id, 55);
  } finally { await workspace.close(); }
});

test('rate_bucket_cap_refuses_new_buckets_without_forgetting_live_limits', async () => {
  const workspace = await TestWorkspace.create();
  let timestamp = start;
  try {
    const root = workspace.path('runtime');
    const config = SandboxConfig.from({ maxRateBuckets: 1 });
    const runtime = new SandboxRuntime(root, config, catalog, () => timestamp);
    const visitor = client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()));
    const before = await registryBytes(root);
    timestamp += 1;
    await assert.rejects(runtime.execute(SandboxOperation.Login, visitor), error => error.code === ErrorCode.RateLimited && error.retryAfter === 3599);
    await assert.rejects(runtime.execute(SandboxOperation.Bootstrap, new RequestIdentity({ remoteAddress: '198.51.100.3' })), code(ErrorCode.RateLimited));
    assert.deepEqual(await registryBytes(root), before);
    assert.equal(runtime.registry.load().rateBuckets.size, 1);
    timestamp = start + 3600;
    assert.equal((await runtime.execute(SandboxOperation.Login, visitor)).payload.ok, true);
    assert.equal(runtime.registry.load().rateBuckets.size, 1);
    const registry = runtime.registry.load();
    const map = registry.rateBuckets;
    map.clear();
    assert.equal(registry.rateBuckets.size, 1);
  } finally { await workspace.close(); }
});

test('queue_timeout_never_runs_later', async () => {
  const workspace = await TestWorkspace.create();
  try {
    const root = workspace.path('runtime');
    const config = SandboxConfig.from({});
    const runtime = new SandboxRuntime(root, config, catalog, () => start);
    const visitor = client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()));
    const before = await registryBytes(root);
    const queue = SandboxQueue.forRoot(root, 2000);
    let release;
    let holding;
    const entered = new Promise(resolveEntered => { holding = resolveEntered; });
    const held = queue.run(() => new Promise(resolveHeld => { release = resolveHeld; holding(); }));
    await entered;
    let calls = 0;
    const waiting = queue.run(() => { calls += 1; });
    const activity = new SandboxRuntime(root, config, catalog, () => start + 10).execute(SandboxOperation.Bootstrap, visitor);
    await Promise.all([assert.rejects(waiting, error => error.code === ErrorCode.Busy && error.retryAfter === 2), assert.rejects(activity, code(ErrorCode.Busy))]);
    release();
    await held;
    await queue.run(() => undefined);
    assert.equal(calls, 0);
    assert.deepEqual(await registryBytes(root), before);
  } finally { await workspace.close(); }
});

test('unsafe_or_corrupt_runtime_is_preserved', async () => {
  const workspace = await TestWorkspace.create();
  try {
    for (const kind of ['missing', 'invalid-json', 'unknown-version', 'unknown-field', 'bad-token', 'bad-state', 'bad-time', 'failed-auth', 'bad-bucket', 'too-many-buckets', 'duplicate-key', 'wrong-map-key', 'too-many-records', 'oversized-image', 'symlink-file', 'symlink-directory', 'unknown-sidecar', 'missing-lock', 'nonregular', 'hardlink', 'public-file', 'public-directory', 'public-root']) {
      const root = workspace.path(kind);
      const config = SandboxConfig.from({ maxSandboxes: 1 });
      const runtime = new SandboxRuntime(root, config, catalog, () => start);
      const visitor = client(await runtime.execute(SandboxOperation.Bootstrap, initialIdentity()));
      const digest = hash(visitor.sandboxToken);
      const path = join(root, digest, 'demo.sqlite');
      const original = await readFile(path);
      const raw = JSON.parse(await registryBytes(root));
      if (kind === 'missing') { await unlink(join(root, 'registry.json')); }
      if (kind === 'invalid-json') { await writeFile(join(root, 'registry.json'), '{', { mode: 0o600 }); }
      if (kind === 'unknown-version') { raw.version = 2; }
      if (kind === 'unknown-field') { raw.extra = true; }
      if (kind === 'bad-token') { raw.sandboxes[digest].csrfToken = '../not-a-token'; }
      if (kind === 'bad-state') { raw.sandboxes[digest].state = 'unknown'; }
      if (kind === 'bad-time') { raw.sandboxes[digest].lastActivity = Number.MAX_SAFE_INTEGER; }
      if (kind === 'failed-auth') { raw.sandboxes[digest].state = 'failed'; raw.sandboxes[digest].dashboardDigest = 'c'.repeat(64); }
      if (kind === 'bad-bucket') { Object.values(raw.rateBuckets)[0].hits = 0; }
      if (kind === 'too-many-buckets') { raw.rateBuckets = Object.fromEntries(Array.from({ length: 1001 }, (_, index) => { const key = hash(String(index)); return [key, { key, hits: 1, expiresAt: start + 3600 }]; })); }
      if (kind === 'wrong-map-key') { raw.sandboxes['a'.repeat(64)] = raw.sandboxes[digest]; delete raw.sandboxes[digest]; }
      if (kind === 'too-many-records') { raw.sandboxes['a'.repeat(64)] = { ...raw.sandboxes[digest], digest: 'a'.repeat(64) }; }
      if (['unknown-version', 'unknown-field', 'bad-token', 'bad-state', 'bad-time', 'failed-auth', 'bad-bucket', 'too-many-buckets', 'wrong-map-key', 'too-many-records'].includes(kind)) { await writeFile(join(root, 'registry.json'), JSON.stringify(raw), { mode: 0o600 }); }
      if (kind === 'duplicate-key') { await writeFile(join(root, 'registry.json'), JSON.stringify(raw).replace('{"version":1,', '{"version":1,"version":1,'), { mode: 0o600 }); }
      if (kind === 'oversized-image') { await writeFile(join(root, 'registry.next'), Buffer.alloc(1048577), { mode: 0o600 }); }
      if (kind === 'symlink-file') { await symlink(path, join(root, 'registry.next')); }
      if (kind === 'symlink-directory') { await rename(join(root, digest), workspace.path('moved-sandbox')); await symlink(workspace.path('moved-sandbox'), join(root, digest)); }
      if (kind === 'unknown-sidecar') { await writeFile(join(root, digest, 'demo.sqlite-wal'), 'unknown', { mode: 0o600 }); }
      if (kind === 'missing-lock') { await unlink(join(root, 'runtime.lock')); }
      if (kind === 'nonregular') { await mkdir(join(root, 'registry.next'), { mode: 0o700 }); }
      if (kind === 'hardlink') { await link(path, join(root, digest, 'seed.sqlite')); }
      if (kind === 'public-file') { await chmod(path, 0o644); }
      if (kind === 'public-directory') { await chmod(join(root, digest), 0o755); }
      if (kind === 'public-root') { await chmod(root, 0o755); }
      const metadata = kind === 'missing' ? null : await registryBytes(root);
      await assert.rejects(runtime.execute(SandboxOperation.Bootstrap, visitor), error => {
        assert.equal(error.code, ErrorCode.Unavailable, kind);
        assert(error.cause, kind);
        assert.equal(Object.getOwnPropertyDescriptor(error, 'cause').enumerable, false);
        assert.equal(JSON.stringify(error).includes(path), false);
        return true;
      });
      assert.deepEqual(await readFile(path), original, kind);
      if (metadata) { assert.deepEqual(await registryBytes(root), metadata, kind); }
    }
    const target = workspace.path('target');
    await mkdir(target, { mode: 0o700 });
    await writeFile(join(target, 'legacy.sqlite'), 'do not touch', { mode: 0o600 });
    await symlink(target, workspace.path('linked-root'));
    const runtime = new SandboxRuntime(join(workspace.path('linked-root'), 'nested'), SandboxConfig.from({}), catalog, () => start);
    await assert.rejects(runtime.execute(SandboxOperation.Bootstrap, initialIdentity()), code(ErrorCode.Unavailable));
    assert.deepEqual(await readdir(target), ['legacy.sqlite']);
    const legacyRoot = workspace.path('nonempty');
    await mkdir(legacyRoot, { mode: 0o700 });
    await writeFile(join(legacyRoot, 'demo.sqlite'), 'legacy bytes', { mode: 0o600 });
    await assert.rejects(new SandboxRuntime(legacyRoot, SandboxConfig.from({}), catalog, () => start).execute(SandboxOperation.Bootstrap, initialIdentity()), code(ErrorCode.Unavailable));
    assert.deepEqual(await readdir(legacyRoot), ['demo.sqlite']);
  } finally { await workspace.close(); }
});
