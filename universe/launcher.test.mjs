import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { CloudSave } from './cloud-save.mjs';
import { configuration, projectConfiguration, runLauncher } from './launcher.mjs';
import { createTransport, digest, readCredentials } from './r2.mjs';
import { respond } from './server.mjs';

const credentials = {
  R2_ACCOUNT_ID: 'testaccount',
  R2_ACCESS_KEY_ID: 'testkey',
  R2_SECRET_ACCESS_KEY: 'synthetic-cloud-secret',
  R2_BUCKET: 'test-bucket',
};
const controlKey = '_universe/v2/control.json';
const story = 'default-user/chats/Character/story.jsonl';
const sideStory = 'default-user/group chats/Secrets.jsonl';
const privateFile = 'default-user/secrets.json';

test('project configuration uses local paths and settings even when the shell has overrides', () => {
  const system = {
    PATH: 'test-path', ST_DIR: 'elsewhere', ST_DATA_ROOT: 'another-root', R2_BUCKET: 'other-bucket',
    UNIVERSE_PORT: '9000', NODE_OPTIONS: 'external', SILLYTAVERN_CONFIGPATH: 'elsewhere',
    SILLYTAVERN_PORT: '7000', SILLYTAVERN_BROWSERLAUNCH_ENABLED: 'false',
  };
  const contents = Object.entries(credentials).map(([name, value]) => `${name}="${value}"`).join('\r\n');
  const config = projectConfiguration(`${contents}\nUNIVERSE_PORT=9001`, system);
  const defaults = configuration({});
  assert.equal(config.port, 9001);
  assert.equal(config.sillyTavern, defaults.sillyTavern);
  assert.equal(config.sillyTavern, join(dirname(dirname(defaults.dataRoot)), 'node_modules', 'sillytavern'));
  assert.equal(config.configPath, join(dirname(defaults.dataRoot), 'config.yaml'));
  assert.equal(config.dataRoot, defaults.dataRoot);
  assert.equal(config.stateRoot, defaults.stateRoot);
  assert.deepEqual(config.credentials, readCredentials(credentials));
  assert.deepEqual(config.env, {
    PATH: 'test-path', HOME: dirname(defaults.dataRoot), TMPDIR: dirname(defaults.dataRoot),
    SILLYTAVERN_LISTEN: 'false', SILLYTAVERN_PORT: '8000',
  });
  assert.equal(projectConfiguration('', system).credentials, null);
  assert.equal(projectConfiguration('', system).port, 8767);
});

test('project configuration catches incomplete cloud credentials and invalid settings', () => {
  const empty = Object.keys(credentials).map((name) => `${name}=`).join('\n');
  assert.equal(projectConfiguration(empty, {}).credentials, null);
  assert.throws(() => projectConfiguration('R2_ACCESS_KEY_ID=abc', {}), /all four/);
  assert.throws(() => projectConfiguration('R2_ACCOUNT', {}), /line 1/);
  assert.throws(() => projectConfiguration('ST_DIR=elsewhere', {}), /line 1/);
  assert.throws(() => projectConfiguration('UNIVERSE_PORT=9000\nUNIVERSE_PORT=9999', {}), /line 2/);
  assert.throws(() => projectConfiguration('UNIVERSE_PORT=8000', {}), /SillyTavern port/);
});

test('project startup rejects a missing installation before touching a saved journal or R2', async (context) => {
  const directory = await fixture(context);
  const settings = Object.entries(credentials).map(([name, value]) => `${name}=${value}`).join('\n');
  const config = projectConfiguration(settings, {});
  config.sillyTavern = join(directory, 'missing');
  config.dataRoot = join(directory, 'data');
  config.stateRoot = join(directory, 'data.universe');
  await write(config.stateRoot, 'journal.json', 'unread journal sentinel');
  await assert.rejects(runLauncher(config, new AbortController().signal, () => {}, {
    transport: () => assert.fail('cloud request before installation check'),
  }), /Run npm install/);
  assert.deepEqual(await readdir(config.stateRoot), ['journal.json']);
  assert.equal(await readFile(join(config.stateRoot, 'journal.json'), 'utf8'), 'unread journal sentinel');
});

/**
 * @returns {object}
 */
function memoryCloud() {
  const objects = new Map();
  let now = Date.now();
  const store = {
    objects,
    hook: null,
    /**
     * @param {number} milliseconds
     * @returns {void}
     */
    advance(milliseconds) {
      now += milliseconds;
    },
    /**
     * @returns {object}
     */
    control() {
      return JSON.parse(objects.get(controlKey).body);
    },
    /**
     * @param {string} method
     * @param {string} key
     * @param {object} options
     * @returns {Promise<Response>}
     */
    async transport(method, key, options = {}) {
      const headers = { date: new Date(now).toUTCString() };
      const request = {
        method, key, options, response() {
          if (options.list) {
            return new Response(`<ListBucketResult><KeyCount>${Number(objects.size > 0)}</KeyCount></ListBucketResult>`, { headers });
          }
          const current = objects.get(key);
          if (method === 'GET') {
            return current ? new Response(current.body, { headers: { ...headers, etag: current.etag } }) :
              new Response(null, { status: 404, headers });
          }
          assert.ok(options.absent || options.match !== undefined, 'every write must be conditional');
          if ((options.match !== undefined && current?.etag !== options.match) || (options.absent && current)) {
            return new Response(null, { status: 412, headers });
          }
          const etag = `"${digest(options.body)}"`;
          objects.set(key, { body: Buffer.from(options.body), etag });
          return new Response(null, { headers: { ...headers, etag } });
        },
      };
      return store.hook?.(request) ?? request.response();
    },
  };
  return store;
}

/**
 * @param {import('node:test').TestContext} context
 * @returns {Promise<string>}
 */
async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'universe-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/**
 * @param {string} root
 * @param {string} path
 * @param {string} bytes
 * @returns {Promise<void>}
 */
async function write(root, path, bytes) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

/**
 * @param {string} root
 * @param {string} name
 * @param {object} [extra]
 * @returns {Promise<object>}
 */
async function PC(root, name, extra = {}) {
  const machine = join(root, name);
  const application = join(machine, 'SillyTavern');
  await write(application, 'server.js', '');
  return configuration({
    ...process.env,
    ...credentials,
    ST_DIR: application,
    ST_DATA_ROOT: join(machine, 'data'),
    ...extra,
  });
}

/**
 * @param {object} config
 * @param {object} cloud
 * @param {Function} whileRunning
 * @param {Function} onChildExit
 * @returns {Promise<void>}
 */
async function run(config, cloud, whileRunning = async () => {}, onChildExit = async () => {}) {
  const controller = new AbortController();
  const states = [];
  const task = runLauncher(config, controller.signal, (state) => {
    states.push(state);
    if (state.phase === 'running') {
      controller.abort();
    }
  }, {
    transport: cloud.transport,
    startChild: () => ({
      pid: 1,
      finished: new Promise(() => {}),
      allowEdits: () => whileRunning(config.dataRoot),
      async stop() {
        await onChildExit(config.dataRoot);
        return { code: 0 };
      },
    }),
  });
  await task;
  assert.equal(states.at(-1).phase, 'saved');
}

test('transfers final exit writes and deletions across two launchers, preserves each machine’s credentials', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  const beta = await PC(root, 'beta');
  await write(alpha.dataRoot, privateFile, 'alpha-private');
  await write(beta.dataRoot, privateFile, 'beta-private');
  await run(alpha, cloud, async (data) => {
    const journal = JSON.parse(await readFile(join(alpha.stateRoot, 'journal.json')));
    assert.equal(journal.phase, 'editing');
    await write(data, story, 'first turn');
    await write(data, sideStory, 'another chat');
  }, (data) => write(data, story, 'exit turn'));
  assert.equal(cloud.control().lease, null);
  await run(beta, cloud, async (data) => {
    assert.equal(await readFile(join(data, story), 'utf8'), 'exit turn');
    assert.equal(await readFile(join(data, sideStory), 'utf8'), 'another chat');
    assert.equal(await readFile(join(data, privateFile), 'utf8'), 'beta-private');
    await unlink(join(data, sideStory));
  }, (data) => write(data, story, 'second exit'));
  await run(alpha, cloud, async (data) => {
    assert.equal(await readFile(join(data, story), 'utf8'), 'second exit');
    await assert.rejects(readFile(join(data, sideStory)), { code: 'ENOENT' });
    assert.equal(await readFile(join(data, privateFile), 'utf8'), 'alpha-private');
  });
  assert.ok([...cloud.objects.values()].every(({ body }) => !/alpha-private|beta-private|synthetic-cloud-secret/.test(body)));
});

test('recovers a failed publish before a new child starts', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  cloud.hook = ({ method, key }) => method === 'PUT' && key.includes('/blobs/') ? new Response(null, { status: 503 }) : undefined;
  await assert.rejects(run(alpha, cloud, async () => {}, (data) => write(data, story, 'unsent turn')), /503/);
  assert.equal(cloud.control().head, null);
  const pending = JSON.parse(await readFile(join(alpha.stateRoot, 'journal.json')));
  assert.equal(pending.phase, 'publishing');
  cloud.hook = null;
  await run(alpha, cloud, async (data) => {
    assert.equal(cloud.control().head, pending.manifest.id);
    assert.equal(await readFile(join(data, story), 'utf8'), 'unsent turn');
  });
});

test('recognizes a lost acknowledgement in remote ancestry', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  const beta = await PC(root, 'beta');
  let lost = false;
  let failedRead = false;
  cloud.hook = ({ method, key, options, response }) => {
    if (method === 'PUT' && key === controlKey && JSON.parse(options.body).lease === null) {
      assert.ok(response().ok);
      lost = true;
      throw new Error('injected missing acknowledgement');
    }
    if (lost && !failedRead && method === 'GET' && key === controlKey) {
      failedRead = true;
      throw new Error('injected unavailable confirmation');
    }
  };
  await assert.rejects(run(alpha, cloud, (data) => write(data, story, 'first commit')), /missing acknowledgement/);
  const original = cloud.control().head;
  const pending = JSON.parse(await readFile(join(alpha.stateRoot, 'journal.json')));
  assert.equal(pending.manifest.id, original);
  cloud.hook = null;
  await run(beta, cloud, (data) => write(data, story, 'later commit'));
  assert.notEqual(cloud.control().head, original);
  const latest = cloud.control().head;
  await write(alpha.dataRoot, story, 'newer local edit');
  await assert.rejects(run(alpha, cloud, () => assert.fail('newer local bytes must survive')), /reconcile manually/);
  assert.equal(cloud.control().head, latest);
  assert.equal(await readFile(join(alpha.dataRoot, story), 'utf8'), 'newer local edit');
  assert.equal(JSON.parse(await readFile(join(alpha.stateRoot, 'journal.json'))).base, original);
  await write(alpha.dataRoot, story, 'first commit');
  await run(alpha, cloud, async (data) => {
    assert.equal(await readFile(join(data, story), 'utf8'), 'later commit');
  });
});

test('preserves both sides of a stale-base conflict', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  const beta = await PC(root, 'beta');
  await run(alpha, cloud, (data) => write(data, story, 'common revision'));
  cloud.hook = ({ method, key }) => method === 'PUT' && key.includes('/blobs/') ? new Response(null, { status: 503 }) : undefined;
  await assert.rejects(run(alpha, cloud, (data) => write(data, story, 'unsent alpha')), /503/);
  cloud.hook = null;
  await run(beta, cloud, (data) => write(data, story, 'committed beta'));
  const remote = cloud.control().head;
  await assert.rejects(run(alpha, cloud, () => assert.fail('child must not start on conflict')), /diverged/);
  assert.equal(cloud.control().head, remote);
  assert.equal(cloud.control().lease, null);
  assert.equal(await readFile(join(alpha.dataRoot, story), 'utf8'), 'unsent alpha');
  assert.equal(await readFile(join(beta.dataRoot, story), 'utf8'), 'committed beta');
});

test('confirms an acknowledged v1 manifest before reconciling its live files with a descendant', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  const beta = await PC(root, 'beta');
  const metadata = 'default-user/groups/scene.json';
  await run(alpha, cloud, async (data) => {
    await write(data, sideStory, 'original transcript');
    await write(data, metadata, 'original group');
  });
  const journalPath = join(alpha.stateRoot, 'journal.json');
  const { rootId, bucket, base } = JSON.parse(await readFile(journalPath));
  const manifest = JSON.parse(cloud.objects.get(`_universe/v2/manifests/${base}.json`).body);
  const legacy = { version: 1, phase: 'publishing', rootId, bucket, base: manifest.parent, manifest };
  await run(beta, cloud, async (data) => {
    await write(data, sideStory, 'descendant transcript');
    await write(data, metadata, 'descendant group');
  });
  const descendant = cloud.control().head;
  cloud.hook = ({ method, key }) => {
    if (method === 'PUT' && key !== controlKey) {
      assert.fail('an acknowledged operation must not upload again');
    }
  };
  await writeFile(journalPath, JSON.stringify(legacy));
  await write(alpha.dataRoot, sideStory, 'descendant transcript');
  await assert.rejects(run(alpha, cloud, () => assert.fail('mixed group must block startup')), /reconcile manually/);
  const acknowledged = JSON.parse(await readFile(journalPath));
  assert.equal(acknowledged.version, 2);
  assert.equal(acknowledged.base, manifest.id);
  assert.deepEqual(acknowledged.files, manifest.files);
  assert.equal(await readFile(join(alpha.dataRoot, sideStory), 'utf8'), 'descendant transcript');
  assert.equal(await readFile(join(alpha.dataRoot, metadata), 'utf8'), 'original group');
  assert.equal(cloud.control().lease, null);
  assert.equal(cloud.control().head, descendant);

  await write(alpha.dataRoot, metadata, 'descendant group');
  for (const pending of [acknowledged, legacy]) {
    await writeFile(journalPath, JSON.stringify(pending));
    await run(alpha, cloud, async (data) => {
      assert.equal(JSON.parse(await readFile(journalPath)).base, descendant);
      assert.equal(await readFile(join(data, sideStory), 'utf8'), 'descendant transcript');
      assert.equal(await readFile(join(data, metadata), 'utf8'), 'descendant group');
    });
    assert.equal(cloud.control().head, descendant);
  }

  for (const [proposal, error] of [
    [{ ...manifest, id: randomUUID() }, /diverged/],
    [{ ...manifest, files: [] }, /different story content/],
  ]) {
    const pending = { ...legacy, manifest: proposal };
    await writeFile(journalPath, JSON.stringify(pending));
    await assert.rejects(run(alpha, cloud), error);
    assert.deepEqual(JSON.parse(await readFile(journalPath)), pending);
    assert.equal(await readFile(join(alpha.dataRoot, sideStory), 'utf8'), 'descendant transcript');
    assert.equal(cloud.control().head, descendant);
    assert.equal(cloud.control().lease, null);
  }
});

test('resumes an interrupted restore and fails closed on an unrecognized bucket', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  const beta = await PC(root, 'beta');
  cloud.objects.set('default-user/chats/legacy.jsonl', { body: Buffer.from('legacy'), etag: '"legacy"' });
  await assert.rejects(run(alpha, cloud), /legacy or unrecognized/);
  assert.equal(cloud.objects.get('default-user/chats/legacy.jsonl').body.toString(), 'legacy');
  cloud.objects.clear();
  await run(alpha, cloud, async (data) => {
    await write(data, story, 'first download');
    await write(data, sideStory, 'second download');
  });
  cloud.hook = ({ method, key }) => method === 'GET' && key.endsWith(digest('second download')) ?
    new Response(null, { status: 503 }) : undefined;
  await assert.rejects(run(beta, cloud), /503/);
  assert.equal(await readFile(join(beta.dataRoot, story), 'utf8'), 'first download');
  assert.equal(JSON.parse(await readFile(join(beta.stateRoot, 'journal.json'))).phase, 'restoring');
  cloud.hook = null;
  await run(beta, cloud, async (data) => {
    assert.equal(await readFile(join(data, story), 'utf8'), 'first download');
    assert.equal(await readFile(join(data, sideStory), 'utf8'), 'second download');
  });
});

test('excludes stale owners and serializes concurrent lease claims', async () => {
  const store = memoryCloud();
  const alpha = new CloudSave(store.transport);
  const beta = new CloudSave(store.transport);
  const contenders = await Promise.allSettled([alpha.acquire(), beta.acquire()]);
  assert.equal(contenders.filter((result) => result.status === 'fulfilled').length, 1);
  const owner = contenders[0].status === 'fulfilled' ? alpha : beta;
  const replacement = new CloudSave(store.transport);
  store.advance(300_001);
  await replacement.acquire();
  await owner.release();
  await assert.rejects(owner.commit({ version: 1, id: randomUUID(), parent: null, files: [] }, true), /lease was lost/);
  await assert.rejects(owner.update('renew'), /lease was lost/);
  assert.equal(store.control().lease.owner, replacement.owner);
  assert.equal(store.control().head, null);
});

test('a lease takeover during staged upload leaves the stale checkpoint pending', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  await run(alpha, cloud, (data) => write(data, story, 'confirmed'));
  const confirmed = cloud.control().head;
  const replacement = new CloudSave(cloud.transport);
  cloud.hook = async ({ method, key, response }) => {
    if (method === 'PUT' && key.endsWith(digest('stale turn'))) {
      cloud.advance(300_001);
      await replacement.acquire();
    }
    return response();
  };
  await assert.rejects(run(alpha, cloud, (data) => write(data, story, 'stale turn')), /lease was lost/);
  assert.equal(cloud.control().head, confirmed);
  assert.equal(cloud.control().lease.owner, replacement.owner);
  const marker = JSON.parse(await readFile(join(alpha.stateRoot, 'journal.json')));
  assert.equal(marker.base, confirmed);
  assert.equal(await readFile(join(alpha.stateRoot, 'checkpoints', marker.manifest.id, digest('stale turn')), 'utf8'), 'stale turn');
});

test('R2 transport requests identity and uses the strong control ETag across claim and publish', async (context) => {
  const store = memoryCloud();
  const initial = JSON.stringify({ version: 1, change: randomUUID(), head: null, lease: null });
  store.objects.set(controlKey, { body: Buffer.from(initial), etag: '"initial"' });
  const transport = createTransport(readCredentials(credentials));
  const matches = [];
  let controlReads = 0;
  let overrideValidator;
  context.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://testaccount.r2.cloudflarestorage.com');
    assert.ok(url.pathname.startsWith('/test-bucket/_universe/v2/'));
    const key = url.pathname.slice('/test-bucket/'.length);
    const headers = new Headers(init.headers);
    const match = headers.get('if-match') ?? undefined;
    const absent = headers.get('if-none-match') === '*';
    if (init.method === 'PUT' && key === controlKey) {
      assert.equal(match, store.objects.get(controlKey).etag);
      assert.match(headers.get('authorization'), /SignedHeaders=[^,]*;if-match;/);
      matches.push(match);
    }
    const response = await store.transport(init.method, key, { body: init.body, match, absent });
    if (init.method !== 'GET' || key !== controlKey) {
      return response;
    }
    controlReads += 1;
    if (overrideValidator !== undefined) {
      if (overrideValidator === null) {
        response.headers.delete('etag');
      } else {
        response.headers.set('etag', overrideValidator);
      }
    } else if (headers.get('accept-encoding') !== 'identity') {
      response.headers.set('content-encoding', 'gzip');
      response.headers.set('etag', `W/${response.headers.get('etag')}`);
    }
    return response;
  });
  const owner = new CloudSave(transport);
  assert.equal(await owner.acquire(), null);
  const claimed = store.objects.get(controlKey).etag;
  const manifest = { version: 1, id: randomUUID(), parent: null, files: [] };
  await owner.commit(manifest, true);
  assert.deepEqual(matches, ['"initial"', claimed]);
  assert.equal(controlReads, 2);
  assert.equal(store.control().head, manifest.id);
  assert.equal(store.control().lease, null);

  for (const invalid of ['W/"compressed"', 'unquoted', null]) {
    overrideValidator = invalid;
    await assert.rejects(new CloudSave(transport).acquire(), /requires a strong ETag/);
  }
  assert.equal(matches.length, 2);
});

test('rejects an unsupported story name without acknowledging a save', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  await assert.rejects(run(alpha, cloud, (data) => write(data, 'default-user/group chats/Cafe\u0301.jsonl', 'story')), /portable story path/);
  assert.equal(cloud.control().head, null);
});

test('rejects symlinked story directories without reading outside the effective root', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const beta = await PC(root, 'beta');
  const outside = join(root, 'outside');
  await write(outside, 'world.json', 'external fixture');
  await mkdir(join(beta.dataRoot, 'default-user'), { recursive: true });
  try {
    await symlink(outside, join(beta.dataRoot, 'default-user', 'worlds'), 'junction');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      context.skip('Windows sandbox disallows symlink fixtures');
      return;
    }
    throw error;
  }
  await assert.rejects(run(beta, cloud, () => assert.fail('unsafe root must block child startup')), /Unsafe path component/);
  assert.equal(cloud.control().head, null);
  assert.equal(await readFile(join(outside, 'world.json'), 'utf8'), 'external fixture');
});

test('keeps a partially saved group local after an abnormal child termination', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  await run(alpha, cloud, async (data) => {
    await write(data, sideStory, 'confirmed transcript');
    await write(data, 'default-user/groups/group.json', 'confirmed metadata');
  });
  const confirmed = cloud.control().head;
  await assert.rejects(runLauncher(alpha, new AbortController().signal, () => {}, {
    transport: cloud.transport,
    startChild: () => ({
      pid: 1,
      finished: Promise.resolve({ code: null, signal: 'SIGKILL' }),
      allowEdits: () => write(alpha.dataRoot, sideStory, 'partial update'),
    }),
  }), /did not stop cleanly/);
  assert.equal(cloud.control().head, confirmed);
  assert.equal(JSON.parse(await readFile(join(alpha.stateRoot, 'journal.json'))).phase, 'editing');
  await assert.rejects(run(alpha, cloud, () => assert.fail('partial group must block startup')), /reconcile manually/);
  assert.equal(await readFile(join(alpha.dataRoot, sideStory), 'utf8'), 'partial update');
  const beta = await PC(root, 'beta');
  await run(beta, cloud, async (data) => {
    assert.equal(await readFile(join(data, sideStory), 'utf8'), 'confirmed transcript');
    assert.equal(await readFile(join(data, 'default-user/groups/group.json'), 'utf8'), 'confirmed metadata');
  });
  assert.equal(cloud.control().head, confirmed);
});

test('retries the completed capture after a blob failure and preserves subsequent local writes', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  const beta = await PC(root, 'beta');
  cloud.hook = ({ method, key }) => method === 'PUT' && key.includes('/blobs/') ? new Response(null, { status: 503 }) : undefined;
  await assert.rejects(run(alpha, cloud, (data) => write(data, story, 'staged')), /503/);
  const journalPath = join(alpha.stateRoot, 'journal.json');
  const marker = JSON.parse(await readFile(journalPath));
  assert.equal(marker.version, 2);
  assert.equal(marker.base, null);
  await write(alpha.dataRoot, story, 'newer local edit');
  cloud.hook = null;
  await assert.rejects(run(alpha, cloud, () => assert.fail('uncertain newer edit must block startup')), /reconcile manually/);
  assert.equal(cloud.control().head, marker.manifest.id);
  assert.equal(JSON.parse(await readFile(journalPath)).base, marker.manifest.id);
  assert.equal(await readFile(join(alpha.dataRoot, story), 'utf8'), 'newer local edit');
  await run(beta, cloud, async (data) => {
    assert.equal(await readFile(join(data, story), 'utf8'), 'staged');
  });
});

test('migrates v1 clean, restoring and verified publishing journals, and preserves a v1 editing tree', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  await write(alpha.dataRoot, story, 'before first launch');
  await run(alpha, cloud);
  const path = join(alpha.stateRoot, 'journal.json');
  const clean = JSON.parse(await readFile(path));
  assert.ok(clean.base);
  const legacy = { ...clean, version: 1 };
  await writeFile(path, JSON.stringify(legacy));
  await run(alpha, cloud);
  assert.equal(JSON.parse(await readFile(path)).version, 2);
  assert.equal(cloud.control().head, clean.base);
  const beta = await PC(root, 'beta');
  await run(beta, cloud, (data) => write(data, story, 'remote update'));
  const target = cloud.control().head;
  await writeFile(path, JSON.stringify({ ...legacy, phase: 'restoring', target }));
  await run(alpha, cloud, async (data) => assert.equal(await readFile(join(data, story), 'utf8'), 'remote update'));
  const manifest = { version: 1, id: randomUUID(), parent: target, files: [{ path: story, hash: digest('legacy capture') }] };
  const original = { version: 1, bucket: legacy.bucket, rootId: legacy.rootId, base: target };
  await writeFile(path, JSON.stringify({ ...original, phase: 'publishing', manifest }));
  await assert.rejects(run(alpha, cloud), /changed after a legacy save/);
  assert.equal(cloud.control().head, target);
  assert.equal(JSON.parse(await readFile(path)).version, 1);
  await write(alpha.dataRoot, story, 'legacy capture');
  await run(alpha, cloud, async () => assert.equal(cloud.control().head, manifest.id));
  const edit = { ...original, base: manifest.id, phase: 'editing', operation: randomUUID() };
  await writeFile(path, JSON.stringify(edit));
  await write(alpha.dataRoot, sideStory, 'partial group write');
  await assert.rejects(run(alpha, cloud, () => assert.fail('v1 edit must block startup')), /legacy editing.*reconcile/);
  assert.deepEqual(JSON.parse(await readFile(path)), edit);
  assert.equal(await readFile(join(alpha.dataRoot, sideStory), 'utf8'), 'partial group write');
  assert.equal(cloud.control().head, manifest.id);
});

test('refuses pending save recovery when the original effective story root was moved or replaced', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  await run(alpha, cloud, (data) => write(data, story, 'original cloud turn'));
  const originalHead = cloud.control().head;
  await assert.rejects(runLauncher(alpha, new AbortController().signal, () => {}, {
    transport: cloud.transport,
    startChild: () => ({
      pid: 1,
      finished: Promise.resolve({ code: null, signal: 'SIGKILL' }),
      allowEdits: () => write(alpha.dataRoot, story, 'original pending turn'),
    }),
  }), /did not stop cleanly/);
  const held = join(root, 'original-root');
  await rename(alpha.dataRoot, held);
  await assert.rejects(run(alpha, cloud), /missing or was replaced/);
  await assert.rejects(readdir(alpha.dataRoot), { code: 'ENOENT' });
  await mkdir(alpha.dataRoot);
  await assert.rejects(run(alpha, cloud), /missing or was replaced/);
  assert.equal(cloud.control().head, originalHead);
  assert.equal(await readFile(join(held, story), 'utf8'), 'original pending turn');
});

test('final save refuses a replaced root but publishes an intentional deletion of the last story', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  await run(alpha, cloud, (data) => write(data, story, 'story'));
  const before = cloud.control().head;
  const held = join(root, 'held');
  await assert.rejects(run(alpha, cloud, async () => {}, async (data) => {
    await rename(data, held);
    await mkdir(data);
  }), /missing or was replaced/);
  assert.equal(cloud.control().head, before);
  await rename(alpha.dataRoot, join(root, 'unrelated'));
  await rename(held, alpha.dataRoot);
  await run(alpha, cloud, (data) => unlink(join(data, story)));
  const manifest = JSON.parse(cloud.objects.get(`_universe/v2/manifests/${cloud.control().head}.json`).body);
  assert.deepEqual(manifest.files, []);
});

test('restores a case-only directory and filename transition after interruption and preserves local-only files', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  const beta = await PC(root, 'beta');
  await run(alpha, cloud, (data) => write(data, story, 'original casing'));
  await run(beta, cloud, (data) => write(data, 'default-user/chats/Character/device.txt', 'local-only'));
  await run(alpha, cloud, async (data) => {
    await rename(join(data, 'default-user/chats/Character'), join(data, 'default-user/chats/intermediate'));
    await rename(join(data, 'default-user/chats/intermediate'), join(data, 'default-user/chats/character'));
    await rename(join(data, 'default-user/chats/character/story.jsonl'), join(data, 'default-user/chats/character/intermediate'));
    await rename(join(data, 'default-user/chats/character/intermediate'), join(data, 'default-user/chats/character/Story.jsonl'));
    await write(data, 'default-user/chats/character/Story.jsonl', 'updated casing');
  });
  cloud.hook = ({ method, key }) => method === 'GET' && key.endsWith(digest('updated casing')) ?
    new Response(null, { status: 503 }) : undefined;
  await assert.rejects(run(beta, cloud), /503/);
  assert.equal(JSON.parse(await readFile(join(beta.stateRoot, 'journal.json'))).phase, 'restoring');
  assert.deepEqual(await readdir(join(beta.dataRoot, 'default-user/chats')), ['character']);
  cloud.hook = null;
  await run(beta, cloud, async (data) => {
    assert.deepEqual((await readdir(join(data, 'default-user/chats/character'))).sort(), ['Story.jsonl', 'device.txt']);
    assert.equal(await readFile(join(data, 'default-user/chats/character/Story.jsonl'), 'utf8'), 'updated casing');
    assert.equal(await readFile(join(data, 'default-user/chats/character/device.txt'), 'utf8'), 'local-only');
  });
});

test('reuses the case variant of an empty leftover story directory and preserves an untracked nonempty one', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  const beta = await PC(root, 'beta');
  const gamma = await PC(root, 'gamma');
  const originalDirectory = 'default-user/chats/Character';
  const pathAfterRename = 'default-user/chats/character/new.jsonl';
  await run(alpha, cloud, (data) => write(data, story, 'original'));
  await run(beta, cloud);
  await run(gamma, cloud);
  await run(alpha, cloud, (data) => unlink(join(data, story)));
  await run(beta, cloud, async (data) => {
    assert.deepEqual(await readdir(join(data, originalDirectory)), []);
  });
  await run(gamma, cloud, (data) => write(data, `${originalDirectory}/device.txt`, 'local-only'));
  await run(alpha, cloud, async (data) => {
    const temporary = join(data, 'default-user/chats/intermediate');
    await rename(join(data, originalDirectory), temporary);
    await rename(temporary, join(data, 'default-user/chats/character'));
    await write(data, pathAfterRename, 'new chat');
  });
  await run(beta, cloud, async (data) => {
    assert.deepEqual(await readdir(join(data, 'default-user/chats')), ['character']);
    assert.equal(await readFile(join(data, pathAfterRename), 'utf8'), 'new chat');
  });
  const beforeConflict = cloud.control().head;
  await assert.rejects(run(gamma, cloud, () => assert.fail('nonempty untracked directory must remain untouched')), /conflict with a cloud case-only rename/);
  assert.equal(cloud.control().head, beforeConflict);
  assert.deepEqual(await readdir(join(gamma.dataRoot, 'default-user/chats')), ['Character']);
  assert.equal(await readFile(join(gamma.dataRoot, originalDirectory, 'device.txt'), 'utf8'), 'local-only');
});

test('background staging uploads immutable bytes while the cloud head stays unpublished', { timeout: 5000 }, async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  const controller = new AbortController();
  const staged = digest('draft during play');
  cloud.hook = ({ method, key, response }) => {
    if (method === 'PUT' && key.endsWith(staged)) {
      const result = response();
      assert.equal(cloud.control().head, null);
      controller.abort();
      return result;
    }
  };
  await runLauncher(alpha, controller.signal, () => {}, {
    transport: cloud.transport,
    stageEveryMs: 5,
    startChild: () => ({
      pid: 1,
      finished: new Promise(() => {}),
      allowEdits: () => write(alpha.dataRoot, story, 'draft during play'),
      async stop() {
        await write(alpha.dataRoot, story, 'durable exit turn');
        return { code: 0 };
      },
    }),
  });
  const manifest = JSON.parse(cloud.objects.get(`_universe/v2/manifests/${cloud.control().head}.json`).body);
  assert.equal(manifest.files[0].hash, digest('durable exit turn'));
});

test('existing machine configuration is copied once outside node_modules', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  const local = join(root, 'local');
  alpha.configPath = join(local, 'config.yaml');
  await write(local, 'SillyTavern/config.yaml', 'language: fr\n');
  await run(alpha, cloud);
  assert.equal(await readFile(alpha.configPath, 'utf8'), 'language: fr\n');
  await writeFile(alpha.configPath, 'language: en\n');
  await run(alpha, cloud);
  assert.equal(await readFile(alpha.configPath, 'utf8'), 'language: en\n');
});

test('actual child receives local paths, and its workers start without a launcher handshake', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  alpha.configPath = join(root, 'config.yaml');
  await write(alpha.sillyTavern, 'server.js', `
    const path = require('node:path');
    const fs = require('node:fs');
    const { execFileSync } = require('node:child_process');
    const worker = execFileSync(process.execPath, [...process.execArgv, '-e', 'process.stdout.write("ready")'],
      { encoding: 'utf8', timeout: 5000 });
    const data = process.argv[process.argv.indexOf('--dataRoot') + 1];
    const config = process.argv[process.argv.indexOf('--configPath') + 1];
    const directory = path.join(data, 'default-user', 'worlds');
    fs.mkdirSync(directory, { recursive: true });
    const leaked = Object.keys(process.env).filter((name) => /^R2_/i.test(name));
    fs.writeFileSync(path.join(directory, 'child.json'), JSON.stringify({ data, config, worker, leaked }));
  `);
  await runLauncher(alpha, new AbortController().signal, () => {}, { transport: cloud.transport });
  const output = JSON.parse(await readFile(join(alpha.dataRoot, 'default-user', 'worlds', 'child.json')));
  assert.equal(output.data, alpha.dataRoot);
  assert.equal(output.config, alpha.configPath);
  assert.equal(output.worker, 'ready');
  assert.deepEqual(output.leaked, []);
  assert.ok(cloud.control().head);
});

test('the actual Ubuntu child writes its last turn on SIGTERM before publication',
  { skip: process.platform !== 'linux', timeout: 10_000 }, async (context) => {
    const root = await fixture(context);
    const cloud = memoryCloud();
    const alpha = await PC(root, 'alpha');
    await write(alpha.sillyTavern, 'server.js', `
      const path = require('node:path');
      const fs = require('node:fs');
      const data = process.argv[process.argv.indexOf('--dataRoot') + 1];
      process.on('SIGTERM', () => {
        const target = path.join(data, ${JSON.stringify(story)});
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'written on SIGTERM');
        process.exit(0);
      });
      fs.writeFileSync(path.join(data, 'fixture-ready'), '');
      setInterval(() => {}, 500);
    `);
    const controller = new AbortController();
    context.after(() => controller.abort());
    const task = runLauncher(alpha, controller.signal, () => {}, { transport: cloud.transport });
    const ready = (async () => {
      let found = false;
      for (let attempt = 0; attempt < 100 && !found; attempt += 1) {
        found = await readFile(join(alpha.dataRoot, 'fixture-ready')).then(() => true, (error) => {
          if (error.code === 'ENOENT') {
            return false;
          }
          throw error;
        });
        if (!found) {
          await pause(15);
        }
      }
      controller.abort();
      assert.ok(found, 'synthetic child should install the exit handler');
    })();
    await Promise.all([task, ready]);
    const manifest = JSON.parse(cloud.objects.get(`_universe/v2/manifests/${cloud.control().head}.json`).body);
    assert.equal(manifest.files[0].hash, digest('written on SIGTERM'));
  });

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`an Ubuntu child terminated by ${signal} between group writes preserves the confirmed revision`,
    { skip: process.platform !== 'linux', timeout: 10_000 }, async (context) => {
      const root = await fixture(context);
      const cloud = memoryCloud();
      const alpha = await PC(root, 'alpha');
      const metadata = 'default-user/groups/scene.json';
      await run(alpha, cloud, async (data) => {
        await write(data, sideStory, 'confirmed transcript');
        await write(data, metadata, 'confirmed group');
      });
      const confirmed = cloud.control().head;
      await write(alpha.sillyTavern, 'server.js', `
        const path = require('node:path');
        const fs = require('node:fs');
        const data = process.argv[process.argv.indexOf('--dataRoot') + 1];
        fs.writeFileSync(path.join(data, ${JSON.stringify(sideStory)}), 'partial transcript');
        process.kill(process.pid, ${JSON.stringify(signal)});
      `);
      await assert.rejects(runLauncher(alpha, new AbortController().signal, () => {}, { transport: cloud.transport }), /did not stop cleanly/);
      assert.equal(cloud.control().head, confirmed);
      assert.equal(cloud.control().lease, null);
      const pending = JSON.parse(await readFile(join(alpha.stateRoot, 'journal.json')));
      assert.equal(pending.phase, 'editing');
      assert.equal(pending.base, confirmed);
      assert.equal(await readFile(join(alpha.dataRoot, sideStory), 'utf8'), 'partial transcript');
      assert.equal(await readFile(join(alpha.dataRoot, metadata), 'utf8'), 'confirmed group');
      await assert.rejects(run(alpha, cloud), /reconcile manually/);
      assert.equal(cloud.control().head, confirmed);
    });
}

test('one effective local root cannot be opened by two launchers', async (context) => {
  const root = await fixture(context);
  const cloud = memoryCloud();
  const alpha = await PC(root, 'alpha');
  const controller = new AbortController();
  let confirmRunning;
  const running = new Promise((resolve) => { confirmRunning = resolve; });
  const task = runLauncher(alpha, controller.signal, ({ phase }) => {
    if (phase === 'running') {
      confirmRunning();
    }
  }, {
    transport: cloud.transport,
    startChild: () => ({
      pid: 1,
      finished: new Promise(() => {}),
      allowEdits: async () => {},
      stop: async () => ({ code: 0 }),
    }),
  });
  try {
    await Promise.race([running, task]);
    await assert.rejects(run(alpha, cloud, () => assert.fail('second child must not start')), /already in use/);
  } finally {
    controller.abort();
    await task;
  }
});

test('clean standalone and fail-loud credentials without touching the network', async (context) => {
  const root = await fixture(context);
  const defaults = configuration({});
  assert.match(defaults.dataRoot, /local[/\\]data$/);
  assert.throws(() => configuration({ R2_ACCESS_KEY_ID: 'test' }), /all four/);
  const config = { ...defaults, sillyTavern: join(root, 'absent'), dataRoot: join(root, 'data'), stateRoot: join(root, 'sidecar') };
  const controller = new AbortController();
  await runLauncher(config, controller.signal, ({ phase }) => {
    assert.equal(phase, 'standalone');
    controller.abort();
  }, { transport: () => assert.fail('standalone must not use transport') });
  await assert.rejects(readFile(join(config.stateRoot, 'journal.json')), { code: 'ENOENT' });
});

test('status and root retain exact fixed routes and expose launcher state only', () => {
  const state = { phase: 'saving', pending: true };
  const call = (url, method = 'GET') => {
    const result = {};
    respond(state, { url, method }, {
      writeHead(code, headers) {
        Object.assign(result, { code, headers });
        return this;
      },
      end(body) {
        result.body = body;
      },
    });
    return result;
  };
  assert.equal(call('/?check=1').body, 'Universe launcher is running.\n');
  assert.equal(call('HTTPS://example.test').code, 200);
  assert.equal(call('http://example.test/./').code, 404);
  assert.equal(call('//status').code, 404);
  assert.equal(call('/local/data/default-user/secrets.json').code, 404);
  assert.equal(call('/', 'POST').headers.Allow, 'GET, HEAD');
  assert.equal(call('/status', 'HEAD').body, undefined);
  assert.deepEqual(JSON.parse(call('/status').body), { phase: 'saving', pending: true, ok: false });
});
