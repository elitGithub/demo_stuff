import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../src/store/SqliteStore.mjs';
import { R2Transport } from '../src/sync/R2Transport.mjs';
import { WorldSync } from '../src/sync/WorldSync.mjs';

const TEST_CREDS = {
  account: 'acc123456',
  accessKey: 'AKIAEXAMPLE123',
  secret: 'super-secret-r2-key-value',
  bucket: 'worlds-test-bucket',
};

/**
 * @param {string} raw
 * @returns {string}
 */
function escapeXml(raw) {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * @param {{clock?: Function, maxListKeys?: number, onBeforeControlPut?: Function, failMode?: string}} options
 * @returns {{bucket: Map<string, {body: Buffer, etag: string, lastModified: number, contentType: string}>, fetchImpl: Function, calls: Array<object>, setFailMode: Function}}
 */
function createMockR2({ clock = () => Date.now(), maxListKeys = 100, onBeforeControlPut = null, failMode = null } = {}) {
  const bucket = new Map();
  const calls = [];
  let etagCounter = 1;
  let currentFailMode = failMode;

  /**
   * @param {string} urlString
   * @param {object} init
   * @returns {Promise<Response>}
   */
  const fetchImpl = async (urlString, init = {}) => {
    const parsedUrl = new URL(urlString);
    const method = init.method ?? 'GET';
    const keyPath = parsedUrl.pathname.replace(/^\/[^/]+\/?/, '');
    const key = decodeURIComponent(keyPath);
    const headers = init.headers ?? {};
    calls.push({ method, key, query: parsedUrl.search, headers });

    if (init.signal?.aborted) {
      throw init.signal.reason instanceof Error ? init.signal.reason : new DOMException('Aborted', 'AbortError');
    }

    if (currentFailMode === 'network') {
      const netErr = new TypeError('fetch failed');
      netErr.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      throw netErr;
    }
    if (currentFailMode === 'hang') {
      await new Promise((resolve, reject) => {
        if (init.signal?.aborted) {
          reject(init.signal.reason ?? new DOMException('Aborted', 'AbortError'));
          return;
        }
        init.signal?.addEventListener('abort', () => {
          reject(init.signal.reason ?? new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }
    if (currentFailMode === '503') {
      return new Response('Service Unavailable', { status: 503, headers: { date: new Date(clock()).toUTCString() } });
    }
    if (currentFailMode === '403') {
      return new Response('Forbidden', { status: 403, headers: { date: new Date(clock()).toUTCString() } });
    }

    const nowDateHeader = new Date(clock()).toUTCString();

    if (method === 'GET' && key === '' && parsedUrl.searchParams.get('list-type') === '2') {
      const delimiter = parsedUrl.searchParams.get('delimiter');
      const prefix = parsedUrl.searchParams.get('prefix') ?? '';
      const maxKeysParam = Number(parsedUrl.searchParams.get('max-keys') ?? maxListKeys);
      const token = parsedUrl.searchParams.get('continuation-token');

      if (delimiter === '/') {
        const rootFiles = [];
        const commonFolders = new Set();
        for (const entryKey of [...bucket.keys()].sort()) {
          const slashIndex = entryKey.indexOf('/');
          if (slashIndex === -1) {
            rootFiles.push(bucket.get(entryKey) ? { key: entryKey, ...bucket.get(entryKey) } : null);
          } else {
            commonFolders.add(entryKey.slice(0, slashIndex + 1));
          }
        }
        const prefixesXml = [...commonFolders].sort().slice(0, maxKeysParam)
          .map((folder) => `<CommonPrefixes><Prefix>${escapeXml(folder)}</Prefix></CommonPrefixes>`)
          .join('');
        const contentsXml = rootFiles.slice(0, maxKeysParam)
          .map((entry) => `<Contents><Key>${escapeXml(entry.key)}</Key><LastModified>${new Date(entry.lastModified).toISOString()}</LastModified><Size>${entry.body.length}</Size><ETag>${escapeXml(entry.etag)}</ETag></Contents>`)
          .join('');
        const isTruncated = commonFolders.size + rootFiles.length > maxKeysParam;
        const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${TEST_CREDS.bucket}</Name><IsTruncated>${isTruncated}</IsTruncated>${contentsXml}${prefixesXml}</ListBucketResult>`;
        return new Response(xml, { status: 200, headers: { 'content-type': 'application/xml', date: nowDateHeader } });
      }

      const matchingKeys = [...bucket.keys()].filter((entryKey) => entryKey.startsWith(prefix)).sort();
      const offset = token ? Number.parseInt(token, 10) : 0;
      const slice = matchingKeys.slice(offset, offset + maxKeysParam);
      const isTruncated = offset + maxKeysParam < matchingKeys.length;
      const nextToken = isTruncated ? String(offset + maxKeysParam) : null;
      const contentsXml = slice.map((entryKey) => {
        const obj = bucket.get(entryKey);
        return `<Contents><Key>${escapeXml(entryKey)}</Key><LastModified>${new Date(obj.lastModified).toISOString()}</LastModified><Size>${obj.body.length}</Size><ETag>${escapeXml(obj.etag)}</ETag></Contents>`;
      }).join('');
      const tokenXml = nextToken ? `<NextContinuationToken>${escapeXml(nextToken)}</NextContinuationToken>` : '';
      const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${TEST_CREDS.bucket}</Name><Prefix>${escapeXml(prefix)}</Prefix><IsTruncated>${isTruncated}</IsTruncated>${tokenXml}${contentsXml}</ListBucketResult>`;
      return new Response(xml, { status: 200, headers: { 'content-type': 'application/xml', date: nowDateHeader } });
    }

    if (method === 'GET') {
      const existing = bucket.get(key);
      if (!existing) {
        return new Response('', { status: 404, headers: { date: nowDateHeader } });
      }
      return new Response(existing.body, {
        status: 200,
        headers: {
          etag: existing.etag,
          'last-modified': new Date(existing.lastModified).toUTCString(),
          'content-length': String(existing.body.length),
          'content-type': existing.contentType,
          date: nowDateHeader,
        },
      });
    }

    if (method === 'PUT') {
      if (key.endsWith('/control.json') && typeof onBeforeControlPut === 'function') {
        await onBeforeControlPut({ bucket, clock });
      }
      const existing = bucket.get(key);
      const ifMatch = headers['if-match'];
      const ifNoneMatch = headers['if-none-match'];
      if (ifNoneMatch === '*' && existing !== undefined) {
        return new Response('', { status: 412, headers: { date: nowDateHeader } });
      }
      if (ifMatch !== undefined && (!existing || existing.etag !== ifMatch)) {
        return new Response('', { status: 412, headers: { date: nowDateHeader } });
      }
      const buffer = Buffer.isBuffer(init.body) ? Buffer.from(init.body) : Buffer.from(String(init.body ?? ''), 'utf8');
      etagCounter += 1;
      const newEtag = `"etag-${etagCounter}"`;
      bucket.set(key, {
        body: buffer,
        etag: newEtag,
        lastModified: clock(),
        contentType: headers['content-type'] ?? 'application/octet-stream',
      });
      return new Response('', {
        status: 200,
        headers: { etag: newEtag, date: nowDateHeader },
      });
    }

    if (method === 'DELETE') {
      const existed = bucket.delete(key);
      return new Response(null, { status: existed ? 204 : 404, headers: { date: nowDateHeader } });
    }

    return new Response('', { status: 405, headers: { date: nowDateHeader } });
  };

  return {
    bucket,
    fetchImpl,
    calls,
    setFailMode(nextMode) {
      currentFailMode = nextMode;
    },
  };
}

/**
 * @param {import('node:test').TestContext} testContext
 * @returns {string}
 */
function makeTempDir(testContext) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-sync-test-'));
  testContext.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  return tempDir;
}

test('R2Transport rejects malformed credentials and invalid XML/continuation loops', async () => {
  assert.throws(() => new R2Transport(null), /credentials object/);
  assert.throws(() => new R2Transport({ ...TEST_CREDS, secret: 'bad secret' }), /without whitespace/);
  assert.throws(() => new R2Transport({ ...TEST_CREDS, bucket: 'Bad_Bucket' }), /valid bucket name/);
  assert.throws(() => new R2Transport(TEST_CREDS, { fetchImpl: 'not-a-fn' }), /fetchImpl/);

  const badXmlTransport = new R2Transport(TEST_CREDS, {
    fetchImpl: async () => new Response('<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>bad&entity;.txt</Key><LastModified>2026-11-24T00:00:00Z</LastModified></Contents></ListBucketResult>', {
      status: 200,
      headers: { date: new Date().toUTCString() },
    }),
  });
  await assert.rejects(() => badXmlTransport.listObjects({ prefix: '_worlds/v1/' }), /malformed XML/);

  let pageCalls = 0;
  const loopTransport = new R2Transport(TEST_CREDS, {
    fetchImpl: async () => {
      pageCalls += 1;
      return new Response(
        '<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>same-tok</NextContinuationToken><Contents><Key>_worlds/v1/snapshots/a.sqlite</Key><LastModified>2026-11-24T00:00:00Z</LastModified></Contents></ListBucketResult>',
        { status: 200, headers: { date: new Date().toUTCString() } },
      );
    },
  });
  await assert.rejects(() => loopTransport.listObjects({ prefix: '_worlds/v1/' }), /repeated continuation token/);
  assert.equal(pageCalls, 2);
});

test('R2Transport signs SigV4 headers and cleans up AbortSignal listeners', async () => {
  const mockR2 = createMockR2();
  const transport = new R2Transport(TEST_CREDS, { fetchImpl: mockR2.fetchImpl });
  const controller = new AbortController();

  const origAdd = controller.signal.addEventListener.bind(controller.signal);
  const origRemove = controller.signal.removeEventListener.bind(controller.signal);
  let activeListeners = 0;
  controller.signal.addEventListener = (type, listener, options) => {
    activeListeners += 1;
    return origAdd(type, listener, options);
  };
  controller.signal.removeEventListener = (type, listener, options) => {
    activeListeners = Math.max(0, activeListeners - 1);
    return origRemove(type, listener, options);
  };

  await transport.putObject('_worlds/v1/control.json', JSON.stringify({ hello: 'world' }), {
    contentType: 'application/json',
    ifNoneMatch: '*',
    signal: controller.signal,
  });
  assert.equal(activeListeners, 0);
  const putHeaders = mockR2.calls[0].headers;
  assert.match(putHeaders.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE123\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(putHeaders['if-none-match'], '*');

  const fetched = await transport.getObject('_worlds/v1/control.json', { signal: controller.signal });
  assert.equal(fetched.exists, true);
  assert.equal(activeListeners, 0);
});

test('WorldSync refuses foreign bucket containing _universe/ or root files and never falls back offline', async (testContext) => {
  const workDir = makeTempDir(testContext);
  const dbPath = path.join(workDir, 'worlds.sqlite');
  const syncStatePath = path.join(workDir, 'sync-state.json');
  const conflictsDir = path.join(workDir, 'conflicts');

  const seedStore = new SqliteStore(dbPath);
  seedStore.createCampaign({ title: 'Local World' });
  seedStore.close();

  const mockR2 = createMockR2();
  mockR2.bucket.set('_universe/v2/control.json', {
    body: Buffer.from('{}'),
    etag: '"u1"',
    lastModified: Date.now(),
    contentType: 'application/json',
  });

  const sync = new WorldSync({
    transport: new R2Transport(TEST_CREDS, { fetchImpl: mockR2.fetchImpl }),
    bucket: TEST_CREDS.bucket,
  });

  await assert.rejects(() => sync.pullOnStartup({ dbPath, syncStatePath, conflictsDir }), /non-Worlds objects/);
  const checkStore = new SqliteStore(dbPath);
  try {
    await assert.rejects(() => sync.pushSnapshot({ store: checkStore, syncStatePath }), /non-Worlds objects/);
  } finally {
    checkStore.close();
  }

  mockR2.bucket.clear();
  mockR2.bucket.set('stray-file.txt', {
    body: Buffer.from('foreign'),
    etag: '"f1"',
    lastModified: Date.now(),
    contentType: 'text/plain',
  });
  await assert.rejects(() => sync.pullOnStartup({ dbPath, syncStatePath, conflictsDir }), /non-Worlds objects/);
});

test('WorldSync detects bucket swap via bucketToken, bucket name, and wiped control mismatch', async (testContext) => {
  const workDir = makeTempDir(testContext);
  const dbPath = path.join(workDir, 'worlds.sqlite');
  const syncStatePath = path.join(workDir, 'sync-state.json');
  const conflictsDir = path.join(workDir, 'conflicts');

  const bucketA = createMockR2();
  const syncA = new WorldSync({
    transport: new R2Transport(TEST_CREDS, { fetchImpl: bucketA.fetchImpl }),
    bucket: TEST_CREDS.bucket,
  });
  await syncA.pullOnStartup({ dbPath, syncStatePath, conflictsDir });
  const storeA = new SqliteStore(dbPath);
  try {
    storeA.createCampaign({ title: 'Campaign Alpha' });
    await syncA.pushSnapshot({ store: storeA, syncStatePath });
  } finally {
    storeA.close();
  }

  const bucketB = createMockR2();
  const syncOnEmptyB = new WorldSync({
    transport: new R2Transport(TEST_CREDS, { fetchImpl: bucketB.fetchImpl }),
    bucket: TEST_CREDS.bucket,
  });
  await assert.rejects(
    () => syncOnEmptyB.pullOnStartup({ dbPath, syncStatePath, conflictsDir }),
    /bucket swap or wipe detected/,
  );

  bucketB.bucket.set('_worlds/v1/control.json', {
    body: Buffer.from(JSON.stringify({
      version: 1,
      bucketToken: 'different-bucket-token-999',
      change: '11111111-1111-4111-8111-111111111111',
      head: null,
      updatedAt: new Date().toISOString(),
    })),
    etag: '"b1"',
    lastModified: Date.now(),
    contentType: 'application/json',
  });
  await assert.rejects(
    () => syncOnEmptyB.pullOnStartup({ dbPath, syncStatePath, conflictsDir }),
    /bucket swap detected/,
  );

  const differentNameSync = new WorldSync({
    transport: new R2Transport({ ...TEST_CREDS, bucket: 'other-bucket' }, { fetchImpl: bucketA.fetchImpl }),
    bucket: 'other-bucket',
  });
  await assert.rejects(
    () => differentNameSync.pullOnStartup({ dbPath, syncStatePath, conflictsDir }),
    /belongs to "worlds-test-bucket"/,
  );
});

test('WorldSync syncs between two devices, handles WAL conflict backup & cleanup, and clears sidecars', async (testContext) => {
  const workDir = makeTempDir(testContext);
  const sharedR2 = createMockR2();

  const dev1Db = path.join(workDir, 'dev1', 'worlds.sqlite');
  const dev1State = path.join(workDir, 'dev1', 'sync-state.json');
  const dev1Conflicts = path.join(workDir, 'dev1', 'conflicts');
  const sync1 = new WorldSync({
    transport: new R2Transport(TEST_CREDS, { fetchImpl: sharedR2.fetchImpl }),
    bucket: TEST_CREDS.bucket,
  });

  const initStatus = await sync1.pullOnStartup({ dbPath: dev1Db, syncStatePath: dev1State, conflictsDir: dev1Conflicts });
  assert.equal(initStatus.status, 'initialized');

  const store1 = new SqliteStore(dev1Db);
  const campaign1 = store1.createCampaign({ title: 'First Realm', premise: 'Floating docks' });
  store1.createCharacter(campaign1.id, { slug: 'mara', name: 'Mara' });
  await sync1.pushSnapshot({ store: store1, syncStatePath: dev1State });
  store1.close();

  const dev2Db = path.join(workDir, 'dev2', 'worlds.sqlite');
  const dev2State = path.join(workDir, 'dev2', 'sync-state.json');
  const dev2Conflicts = path.join(workDir, 'dev2', 'conflicts');
  const sync2 = new WorldSync({
    transport: new R2Transport(TEST_CREDS, { fetchImpl: sharedR2.fetchImpl }),
    bucket: TEST_CREDS.bucket,
  });
  const pullDev2 = await sync2.pullOnStartup({ dbPath: dev2Db, syncStatePath: dev2State, conflictsDir: dev2Conflicts });
  assert.equal(pullDev2.status, 'pulled');

  const store2 = new SqliteStore(dev2Db);
  assert.equal(store2.listCampaigns().items[0].title, 'First Realm');
  store2.createCampaign({ title: 'Remote Realm Update' });
  await sync2.pushSnapshot({ store: store2, syncStatePath: dev2State });
  store2.close();

  const dev1Reopen = new SqliteStore(dev1Db);
  dev1Reopen.createCampaign({ title: 'Device1 Offline Exclusive' });
  dev1Reopen.createCampaign({ title: 'Device1 Offline Second' });
  dev1Reopen.close();

  const holdWalConn = new DatabaseSync(dev1Db);
  holdWalConn.exec('PRAGMA wal_autocheckpoint = 0;');
  holdWalConn.exec("UPDATE campaigns SET premise = 'WAL Uncheckpointed Premise' WHERE title = 'Device1 Offline Second';");
  assert.equal(fs.existsSync(`${dev1Db}-wal`), true);
  holdWalConn.close();

  const conflictStatus = await sync1.pullOnStartup({ dbPath: dev1Db, syncStatePath: dev1State, conflictsDir: dev1Conflicts });
  assert.equal(conflictStatus.status, 'conflict_backed_up');
  assert.ok(conflictStatus.conflictBackupPath);
  assert.equal(fs.existsSync(conflictStatus.conflictBackupPath), true);
  assert.equal(fs.existsSync(`${dev1Db}-wal`), false);
  assert.equal(fs.existsSync(`${dev1Db}-shm`), false);

  const backupStore = new SqliteStore(conflictStatus.conflictBackupPath);
  try {
    const backupCampaigns = backupStore.listCampaigns().items;
    const backupTitles = backupCampaigns.map((item) => item.title);
    assert.ok(backupTitles.includes('Device1 Offline Second'));
    const walSecond = backupCampaigns.find((item) => item.title === 'Device1 Offline Second');
    assert.equal(walSecond.premise, 'WAL Uncheckpointed Premise');
  } finally {
    backupStore.close();
  }

  const updatedStore1 = new SqliteStore(dev1Db);
  try {
    const liveTitles = updatedStore1.listCampaigns().items.map((item) => item.title);
    assert.ok(liveTitles.includes('Remote Realm Update'));
    assert.equal(liveTitles.includes('Device1 Offline Second'), false);
  } finally {
    updatedStore1.close();
  }
});

test('WorldSync recovers cleanly from pendingHead crash after R2 commit', async (testContext) => {
  const workDir = makeTempDir(testContext);
  const dbPath = path.join(workDir, 'worlds.sqlite');
  const syncStatePath = path.join(workDir, 'sync-state.json');
  const conflictsDir = path.join(workDir, 'conflicts');

  const mockR2 = createMockR2();
  const sync = new WorldSync({
    transport: new R2Transport(TEST_CREDS, { fetchImpl: mockR2.fetchImpl }),
    bucket: TEST_CREDS.bucket,
  });
  await sync.pullOnStartup({ dbPath, syncStatePath, conflictsDir });

  const store = new SqliteStore(dbPath);
  store.createCampaign({ title: 'Crash Recovery World' });
  const pushResult = await sync.pushSnapshot({ store, syncStatePath });
  const seqAfterPush = store.getLocalChangeSeq();
  store.close();

  const committedState = JSON.parse(fs.readFileSync(syncStatePath, 'utf8'));
  const previousFakeHead = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  fs.writeFileSync(syncStatePath, JSON.stringify({
    ...committedState,
    head: previousFakeHead,
    syncedChangeSeq: 0,
    pendingHead: pushResult.head,
    pendingSeq: seqAfterPush,
  }));

  const recoverySync = new WorldSync({
    transport: new R2Transport(TEST_CREDS, { fetchImpl: mockR2.fetchImpl }),
    bucket: TEST_CREDS.bucket,
  });
  const recoveryStatus = await recoverySync.pullOnStartup({ dbPath, syncStatePath, conflictsDir });
  assert.equal(recoveryStatus.status, 'recovered');
  assert.equal(recoveryStatus.head, pushResult.head);

  const repairedState = JSON.parse(fs.readFileSync(syncStatePath, 'utf8'));
  assert.equal(repairedState.head, pushResult.head);
  assert.equal(repairedState.pendingHead, null);
  assert.equal(repairedState.pendingSeq, null);
  assert.equal(repairedState.syncedChangeSeq, seqAfterPush);
  assert.equal(fs.existsSync(conflictsDir), false);
});

test('WorldSync refuses 412 concurrent modification conflict and cleans orphan snapshot + serializes concurrent pushes', async (testContext) => {
  const workDir = makeTempDir(testContext);
  const dbPath = path.join(workDir, 'worlds.sqlite');
  const syncStatePath = path.join(workDir, 'sync-state.json');
  const conflictsDir = path.join(workDir, 'conflicts');

  let injectConcurrentRace = false;
  const mockR2 = createMockR2({
    onBeforeControlPut: async ({ bucket }) => {
      if (injectConcurrentRace) {
        injectConcurrentRace = false;
        const current = JSON.parse(bucket.get('_worlds/v1/control.json').body.toString('utf8'));
        bucket.set('_worlds/v1/control.json', {
          body: Buffer.from(JSON.stringify({
            ...current,
            head: '99999999-9999-4999-8999-999999999999',
            change: '88888888-8888-4888-8888-888888888888',
          })),
          etag: '"etag-other-device"',
          lastModified: Date.now(),
          contentType: 'application/json',
        });
      }
    },
  });

  const sync = new WorldSync({
    transport: new R2Transport(TEST_CREDS, { fetchImpl: mockR2.fetchImpl }),
    bucket: TEST_CREDS.bucket,
  });
  await sync.pullOnStartup({ dbPath, syncStatePath, conflictsDir });

  const store = new SqliteStore(dbPath);
  try {
    store.createCampaign({ title: 'Base' });
    const firstSave = await sync.pushSnapshot({ store, syncStatePath });
    assert.equal(firstSave.status, 'saved');

    injectConcurrentRace = true;
    store.createCampaign({ title: 'Raced Edit' });
    const snapshotKeysBefore = [...mockR2.bucket.keys()].filter((key) => key.startsWith('_worlds/v1/snapshots/'));
    const conflictResult = await sync.pushSnapshot({ store, syncStatePath });
    assert.equal(conflictResult.status, 'conflict');
    assert.equal(conflictResult.saved, false);

    const snapshotKeysAfter = [...mockR2.bucket.keys()].filter((key) => key.startsWith('_worlds/v1/snapshots/'));
    assert.deepEqual(snapshotKeysAfter, snapshotKeysBefore);
    const savedState = JSON.parse(fs.readFileSync(syncStatePath, 'utf8'));
    assert.equal(savedState.head, firstSave.head);
    assert.equal(savedState.pendingHead, null);

    mockR2.bucket.set('_worlds/v1/control.json', {
      body: Buffer.from(JSON.stringify({
        version: 1,
        bucketToken: savedState.bucketToken,
        change: '77777777-7777-4777-8777-777777777777',
        head: firstSave.head,
        updatedAt: new Date().toISOString(),
      })),
      etag: '"etag-reset"',
      lastModified: Date.now(),
      contentType: 'application/json',
    });

    const [parallelOne, parallelTwo] = await Promise.all([
      sync.pushSnapshot({ store, syncStatePath }),
      sync.pushSnapshot({ store, syncStatePath }),
    ]);
    assert.equal(parallelOne.status, 'saved');
    assert.equal(parallelTwo.status, 'saved');
    assert.notEqual(parallelOne.head, parallelTwo.head);
  } finally {
    store.close();
  }
});

test('WorldSync paginated IsTruncated pruning removes snapshots beyond newest 30 and older than 24h while keeping control.head', async (testContext) => {
  const workDir = makeTempDir(testContext);
  const dbPath = path.join(workDir, 'worlds.sqlite');
  const syncStatePath = path.join(workDir, 'sync-state.json');
  const conflictsDir = path.join(workDir, 'conflicts');

  const nowMs = Date.UTC(2026, 10, 24, 18, 0, 0);
  const mockR2 = createMockR2({
    clock: () => nowMs,
    maxListKeys: 12,
  });

  const sync = new WorldSync({
    transport: new R2Transport(TEST_CREDS, { fetchImpl: mockR2.fetchImpl }),
    bucket: TEST_CREDS.bucket,
    clock: () => nowMs,
  });
  await sync.pullOnStartup({ dbPath, syncStatePath, conflictsDir });

  for (let index = 0; index < 36; index += 1) {
    const isRecent = index < 4;
    const ageHours = isRecent ? index + 1 : 30 + index;
    const key = `_worlds/v1/snapshots/00000000-0000-4000-8000-${String(index).padStart(12, '0')}.sqlite`;
    mockR2.bucket.set(key, {
      body: Buffer.from('SQLite format 3\0old'),
      etag: `"snap-${index}"`,
      lastModified: nowMs - ageHours * 60 * 60 * 1000,
      contentType: 'application/x-sqlite3',
    });
  }

  const store = new SqliteStore(dbPath);
  try {
    store.createCampaign({ title: 'Prune Test' });
    const pushResult = await sync.pushSnapshot({ store, syncStatePath });
    assert.equal(pushResult.status, 'saved');
    assert.match(pushResult.message, /^Saved snapshot /);
    assert.equal(pushResult.prunedCount, 7);

    const remainingSnapshots = [...mockR2.bucket.keys()].filter((key) => key.startsWith('_worlds/v1/snapshots/'));
    assert.equal(remainingSnapshots.length, 30);
    assert.equal(remainingSnapshots.includes(`_worlds/v1/snapshots/${pushResult.head}.sqlite`), true);

    const skewedMockR2 = createMockR2({
      clock: () => nowMs,
      onBeforeControlPut: async ({ bucket }) => {
        for (const [entryKey, entryVal] of bucket.entries()) {
          if (entryKey.startsWith('_worlds/v1/snapshots/') && !entryKey.includes('11111111-1111-4111-8111-')) {
            entryVal.lastModified = nowMs - 48 * 60 * 60 * 1000;
          }
        }
      },
    });
    const skewedSync = new WorldSync({
      transport: new R2Transport(TEST_CREDS, { fetchImpl: skewedMockR2.fetchImpl }),
      bucket: TEST_CREDS.bucket,
      maxSnapshots: 1,
      maxAgeMs: 1000,
      clock: () => nowMs,
    });
    const skewedState = path.join(workDir, 'skewed-sync.json');
    const skewedConflicts = path.join(workDir, 'skewed-conflicts');
    const skewedDb = path.join(workDir, 'skewed.sqlite');
    await skewedSync.pullOnStartup({ dbPath: skewedDb, syncStatePath: skewedState, conflictsDir: skewedConflicts });
    for (let idx = 0; idx < 3; idx += 1) {
      skewedMockR2.bucket.set(`_worlds/v1/snapshots/11111111-1111-4111-8111-${String(idx).padStart(12, '0')}.sqlite`, {
        body: Buffer.from('SQLite format 3\0newer-old'),
        etag: `"n-${idx}"`,
        lastModified: nowMs - 5_000 - idx * 1000,
        contentType: 'application/x-sqlite3',
      });
    }
    const skewedStore = new SqliteStore(skewedDb);
    try {
      skewedStore.createCampaign({ title: 'Preserve Control Head' });
      const preservedPush = await skewedSync.pushSnapshot({ store: skewedStore, syncStatePath: skewedState });
      assert.equal(preservedPush.prunedCount, 2);
      assert.equal(skewedMockR2.bucket.has(`_worlds/v1/snapshots/${preservedPush.head}.sqlite`), true);
      const remainingSkewed = [...skewedMockR2.bucket.keys()].filter((entryKey) => entryKey.startsWith('_worlds/v1/snapshots/'));
      assert.equal(remainingSkewed.length, 2);
    } finally {
      skewedStore.close();
    }
  } finally {
    store.close();
  }
});

test('WorldSync handles offline/timeout fallback when local DB exists and fails loudly when missing or auth errors', async (testContext) => {
  const workDir = makeTempDir(testContext);
  const dbPath = path.join(workDir, 'worlds.sqlite');
  const syncStatePath = path.join(workDir, 'sync-state.json');
  const conflictsDir = path.join(workDir, 'conflicts');

  const mockR2 = createMockR2({ failMode: 'network' });
  const sync = new WorldSync({
    transport: new R2Transport(TEST_CREDS, { fetchImpl: mockR2.fetchImpl }),
    bucket: TEST_CREDS.bucket,
    pullTimeoutMs: 80,
  });

  await assert.rejects(
    () => sync.pullOnStartup({ dbPath, syncStatePath, conflictsDir }),
    /no local database exists/,
  );

  const localStore = new SqliteStore(dbPath);
  localStore.createCampaign({ title: 'Offline Local' });
  localStore.close();

  const offlineStatus = await sync.pullOnStartup({ dbPath, syncStatePath, conflictsDir });
  assert.equal(offlineStatus.status, 'offline');
  assert.equal(offlineStatus.offline, true);
  assert.match(offlineStatus.warning, /continuing in local mode/);

  mockR2.setFailMode('hang');
  const timeoutStatus = await sync.pullOnStartup({ dbPath, syncStatePath, conflictsDir });
  assert.equal(timeoutStatus.status, 'offline');
  assert.equal(timeoutStatus.offline, true);

  mockR2.setFailMode('403');
  await assert.rejects(
    () => sync.pullOnStartup({ dbPath, syncStatePath, conflictsDir }),
    /HTTP 403/,
  );

  mockR2.setFailMode(null);
  mockR2.bucket.set('_worlds/v1/control.json', {
    body: Buffer.from(JSON.stringify({
      version: 1,
      bucketToken: 'tok-corrupt',
      change: '11111111-1111-4111-8111-111111111111',
      head: '22222222-2222-4222-8222-222222222222',
      updatedAt: new Date().toISOString(),
    })),
    etag: '"c-bad"',
    lastModified: Date.now(),
    contentType: 'application/json',
  });
  mockR2.bucket.set('_worlds/v1/snapshots/22222222-2222-4222-8222-222222222222.sqlite', {
    body: Buffer.from('NOT A SQLITE DATABASE AT ALL'),
    etag: '"s-bad"',
    lastModified: Date.now(),
    contentType: 'application/x-sqlite3',
  });

  await assert.rejects(
    () => sync.pullOnStartup({ dbPath, syncStatePath, conflictsDir }),
    /not a valid SQLite database/,
  );
  const untouchedStore = new SqliteStore(dbPath);
  try {
    assert.equal(untouchedStore.listCampaigns().items[0].title, 'Offline Local');
  } finally {
    untouchedStore.close();
  }
});
