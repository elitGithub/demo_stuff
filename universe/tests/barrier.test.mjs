import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path, { resolve, join } from 'node:path';
import { Duplex } from 'node:stream';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { prepareHooks } from '../src/integration/pinned-hooks.mjs';
import { CaptureGate } from '../src/classes/capture-gate.mjs';

/**
 * @param {CaptureGate} gate
 * @param {string} owner
 * @returns {Function}
 */
function client(gate, owner = 'test-profile') {
  const tab = randomUUID();
  const send = (command, extra) => gate.control(owner, { command, tab, ...extra });
  assert.equal(send('join').status, 200);
  assert.equal(send('admit').admitted, true);
  return send;
}

/**
 * @param {object} context
 * @param {Function} transfer
 * @returns {Promise<object>}
 */
async function browserFixture(context, transfer) {
  const gate = new CaptureGate();
  const events = new EventEmitter();
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    const send = () => {
      const { status, ...state } = gate.control('test-profile', body);
      return Response.json(state, { status });
    };
    return transfer ? transfer(body, send) : send();
  });
  const original = globalThis.window;
  globalThis.window = { addEventListener: events.on.bind(events), fetch: globalThis.fetch };
  context.after(() => {
    events.emit('pagehide');
    globalThis.window = original;
  });
  const browser = await import(`../src/integration/browser-bridge.js?test=${randomUUID()}`);
  const connecting = browser.connect(() => ({}), () => false);
  const capture = async () => {
    const id = randomUUID();
    const state = await gate.acquire(id, 3000);
    gate.release(id);
    return state;
  };
  return { gate, browser, events, connecting, capture };
}

/**
 * @param {string} module
 * @param {string} debounce
 * @param {string[]} names
 * @param {object} bindings
 * @returns {object}
 */
function pinnedFunctions(module, debounce, names, bindings) {
  const timer = debounce ? module.split('\n').find(line => line.startsWith('const ' + debounce + ' =')) : '';
  assert.ok(!debounce || timer);
  const declarations = names.map(name => {
    const definition = new RegExp('^(?:export )?(async function ' + name + '\\([^\\n]*[\\s\\S]*?^\\}$)', 'm').exec(module);
    assert.ok(definition, name);
    return definition[1];
  });
  return runInNewContext([timer, ...declarations, '({' + names.join(',') + '})'].join('\n'),
    { debounce_timeout: { relaxed: 30_000 }, getRequestHeaders: () => ({}), ...bindings });
}

/**
 * @param {object} context
 * @param {Function} intercept
 * @param {boolean} approve
 * @returns {Promise<object>}
 */
async function renameFixture(context, intercept, approve = true) {
  const page = await browserFixture(context);
  await page.connecting;
  const { assets } = await prepareHooks(resolve('node_modules/sillytavern'));
  const files = new Map([['East', { revision: 0 }]]);
  const worldNames = ['East'];
  const cards = [];
  const merges = [];
  const prompts = { name: 0, links: 0 };
  const story = pinnedFunctions(assets.get('/scripts/world-info.js'), 'saveWorldDebounced',
    ['saveWorldInfo', '_save', 'renameWorldInfo', 'deleteWorldInfo', 'updateWorldInfoLinks'], {
      universe: page.browser, world_names: worldNames, worldInfoCache: new Map(), selected_world_info: [],
      chat_metadata: {}, METADATA_KEY: 'lore', power_user: { personas: {} }, world_info: {}, characters: cards, this_chid: -1,
      t: String.raw, POPUP_RESULT: { AFFIRMATIVE: true }, Popup: { show: {
        input() { prompts.name++; return 'West'; },
        confirm() { prompts.links++; return approve; },
      } },
      equalsIgnoreCaseAndAccents: (left, right) => left.toLowerCase() === right.toLowerCase(),
      toastr: { error() {}, success() {} }, console: { error() {} }, eventSource: { emit() {} }, event_types: {},
      $: () => ({ trigger() {}, val() { return this; } }),
      updateWorldInfoList() { worldNames.splice(0, worldNames.length, ...files.keys()); },
      getOneCharacter() {},
      async fetch(url, options) {
        const body = options.body ? JSON.parse(options.body) : {};
        const injected = await intercept?.(url, body);
        if (injected) {
          return injected;
        }
        if (url === '/api/worldinfo/list') {
          return Response.json([...files.keys()].map(file_id => ({ file_id })));
        }
        if (url === '/api/worldinfo/edit') {
          files.set(body.name, body.data);
        } else if (url === '/api/worldinfo/delete') {
          files.delete(body.name);
        } else if (url === '/api/characters/merge-attributes') {
          const card = cards.find(candidate => candidate.avatar === body.avatar);
          card.data.extensions.world = body.data.extensions.world;
          merges.push(body.avatar);
        } else {
          assert.fail('Unexpected story request ' + url);
        }
        return Response.json({ ok: true });
      },
    });
  return { ...page, story, files, cards, merges, prompts };
}

test('ten original tabs and a late arrival must all finish the current epoch', async () => {
  const gate = new CaptureGate();
  const tabs = Array.from({ length: 10 }, () => client(gate));
  const id = randomUUID();
  const acquire = gate.acquire(id);
  const epoch = tabs[0]('poll').epoch;
  tabs.slice(0, 9).forEach(send => send('ack', { epoch }));
  const late = client(gate, 'other-profile');
  tabs[9]('ack', { epoch });
  assert.equal(gate.request.held, false);
  late('ack', { epoch: randomUUID() });
  assert.equal(gate.request.held, false);
  late('ack', { epoch });
  assert.equal(await acquire, 'held');
  let writing = false;
  const response = { end() {} };
  const write = gate.guard({ method: 'POST' }, response, () => { writing = true; response.end(); });
  assert.equal(writing, false);
  gate.release(randomUUID());
  assert.equal(writing, false);
  gate.release(id);
  await write;
  assert.equal(writing, true);
});

test('a disconnected client still owns its admitted write until the handler ends', async () => {
  const gate = new CaptureGate();
  const response = Object.assign(new EventEmitter(), { end() {}, destroyed: false });
  await gate.guard({ method: 'POST' }, response, () => {});
  const id = randomUUID();
  const attempt = gate.acquire(id);
  response.destroyed = true;
  response.emit('close');
  assert.equal(gate.writers, 1);
  assert.equal(gate.request.held, false);
  response.end();
  assert.equal(await attempt, 'held');
  assert.equal(gate.writers, 0);
  const waitingResponse = { destroyed: true, end() {} };
  const waiting = gate.guard({ method: 'POST' }, waitingResponse, () => assert.fail('aborted write admitted'));
  gate.release(id);
  await waiting;
  assert.equal(gate.writers, 0);
});

test('profile writes, thumbnail generation and deferred settings backups finish before capture', async () => {
  const gate = new CaptureGate();
  const { loader, assets } = await prepareHooks(resolve('node_modules/sillytavern'));
  assert.ok(loader.source.indexOf('universe.mountWrites(app)') < loader.source.indexOf('app.use(multer('));
  assert.ok(loader.source.indexOf('universe.mountWrites(app)') < loader.source.indexOf("app.use('/api/users', usersPublicRouter)"));
  const settings = [...loader.modules].find(([url]) => url.endsWith('/endpoints/settings.js'))[1];
  const hooks = settings.split('\n').filter(line => line.startsWith('const AUTOSAVE_FUNCTIONS =') || line.startsWith('universe.registerFlush('));
  let diskBackup = 'old settings';
  runInNewContext([...hooks, "AUTOSAVE_FUNCTIONS.set('alpha', backup);"].join('\n'), {
    universe: { registerFlush: flush => gate.flushes.add(flush) },
    backup: { flush() { diskBackup = 'saved settings'; } },
  });
  assert.match(assets.get('/script.js'), /saveSettingsDebounced = universe\.debounce\('settings',/);
  for (const path of ['/api/users/login', '/api/characters/all', '/api/settings/get']) {
    const bootstrap = { method: 'POST', path, headers: { 'sec-fetch-site': 'same-origin' } };
    const response = { end() {} };
    await gate.guard(bootstrap, response, () => response.end());
  }
  assert.equal(gate.unknownBrowser, false);
  const upload = { end() {} };
  const generation = Promise.withResolvers();
  await gate.guard({ method: 'POST', path: '/api/avatars/upload' }, upload, () => {});
  const thumbnail = gate.background(() => generation.promise);
  const id = randomUUID();
  const waiting = gate.acquire(id);
  upload.end();
  assert.equal(gate.request.held, false);
  assert.equal(diskBackup, 'old settings');
  generation.resolve();
  await thumbnail;
  assert.equal(await waiting, 'held');
  assert.equal(diskBackup, 'saved settings');
  let statsUpdated = false;
  const update = gate.background(() => { statsUpdated = true; });
  assert.equal(statsUpdated, false);
  gate.release(id);
  await update;
  assert.equal(statsUpdated, true);
});

test('deleting a persona waits for the portrait response, chat save and debounced settings, including a lost-response retry', { timeout: 15_000 }, async context => {
  const polled = Promise.withResolvers();
  const page = await browserFixture(context, async (body, send) => {
    const state = send();
    if (body.command === 'poll' && (await state.clone().json()).epoch) {
      polled.resolve();
    }
    return state;
  });
  await page.connecting;
  const { assets } = await prepareHooks(resolve('node_modules/sillytavern'));
  const power = { personas: { 'A.png': 'A', 'B.png': 'B' }, persona_descriptions: { 'A.png': 'A', 'B.png': 'B' }, default_persona: 'A.png' };
  const metadata = { persona: 'A.png' };
  const portraits = new Set(['A.png', 'B.png']);
  const disk = { settings: Object.keys(power.personas), metadata: 'A.png' };
  const removed = Promise.withResolvers();
  const deliver = Promise.withResolvers();
  const savingChat = Promise.withResolvers();
  const savedChat = Promise.withResolvers();
  let failMetadata = false;
  let loseReply = false;
  let denyList = true;
  const controlFetch = globalThis.fetch;
  context.mock.method(globalThis, 'fetch', (url, options) => {
    if (url === '/api/avatars/get') {
      return Promise.resolve(denyList ? new Response(null, { status: 503 }) : Response.json([...portraits]));
    }
    return controlFetch(url, options);
  });
  const editor = pinnedFunctions(assets.get('/scripts/personas.js'), null, ['deletePersona'], {
    universe: page.browser, power_user: power, chat_metadata: metadata, getRequestHeaders: () => ({}),
    characters: [{ avatar: 'Viola.png' }], this_chid: 0, getCurrentChatId: () => 'tavern', selected_group: null,
    saveSettingsDebounced: page.browser.debounce('settings', async () => { disk.settings = Object.keys(power.personas); }, 30_000),
    async saveMetadata() {
      savingChat.resolve();
      await savedChat.promise;
      const settle = page.browser.track('public/script.js/saveChat' + JSON.stringify(['Viola.png', 'tavern']));
      settle(failMetadata);
      if (failMetadata) return;
      disk.metadata = metadata.persona;
    },
    eventSource: { emit: async () => {} }, event_types: {}, uuidv4: randomUUID, loadPersonaForCurrentChat: async () => {},
    async fetch(url, options) {
      assert.equal(url, '/api/avatars/delete');
      const { avatar } = JSON.parse(options.body);
      let status;
      const response = { end() {} };
      await page.gate.guard({ method: 'POST', path: url }, response, () => {
        status = portraits.delete(avatar) ? 200 : 404;
        response.end();
      });
      removed.resolve();
      await deliver.promise;
      if (loseReply) throw new Error('lost deletion response');
      return new Response(null, { status });
    },
  });
  const deleting = editor.deletePersona('A.png', { silent: true });
  await removed.promise;
  const id = randomUUID();
  const acquiring = page.gate.acquire(id);
  await polled.promise;
  await pause(10);
  assert.equal(page.gate.request.held, false);
  assert.equal(portraits.has('A.png'), false);
  assert.equal(disk.metadata, 'A.png');
  deliver.resolve();
  await savingChat.promise;
  assert.equal(page.gate.request.held, false);
  savedChat.resolve();
  assert.equal(await deleting, true);
  assert.equal(await acquiring, 'held');
  assert.equal(disk.metadata, undefined);
  assert.deepEqual(disk.settings, ['B.png']);
  page.gate.release(id);

  metadata.persona = disk.metadata = 'B.png';
  loseReply = true;
  await assert.rejects(editor.deletePersona('B.png', { silent: true }), /lost deletion response/);
  assert.equal(await page.capture(), 'pending');
  loseReply = false;
  assert.equal(await editor.deletePersona('B.png', { silent: true }), false);
  assert.equal(await page.capture(), 'pending');
  denyList = false;
  failMetadata = true;
  await assert.rejects(editor.deletePersona('B.png', { silent: true }), /could not be removed from this chat/);
  assert.equal(metadata.persona, 'B.png');
  assert.equal(power.personas['B.png'], 'B');
  assert.equal(await page.capture(), 'pending');
  failMetadata = false;
  assert.equal(await editor.deletePersona('B.png', { silent: true }), true);
  assert.equal(await page.capture(), 'held');
  assert.deepEqual(disk.settings, []);
  assert.equal(disk.metadata, undefined);
});

test('a busy pinned saveMetadata resumes deletion only in the original chat when both chats link to Frost', { timeout: 10_000 }, async context => {
  const page = await browserFixture(context);
  await page.connecting;
  const { assets } = await prepareHooks(resolve('node_modules/sillytavern'));
  const avatar = 'Frost.png';
  const power = { personas: { [avatar]: 'Frost' }, persona_descriptions: { [avatar]: 'The farmer' }, default_persona: avatar };
  const disk = new Map([['Tavern', JSON.stringify({ persona: avatar, location: 'tavern' })],
    ['Farm', JSON.stringify({ persona: avatar, location: 'farm' })]]);
  const originalFarm = disk.get('Farm');
  const character = { avatar: 'Viola.png', name: 'Viola', chat: 'Tavern' };
  const metadata = JSON.parse(disk.get(character.chat));
  const shared = { universe: page.browser, characters: [character], this_chid: 0, selected_group: null, chat_metadata: metadata,
    getCurrentChatId: () => character.chat, getRequestHeaders: () => ({}) };
  let busy = true;
  let attempts = 0;
  let portraits = [avatar];
  let deletes = 0;
  let savedSettings;
  const chat = pinnedFunctions(assets.get('/script.js'), null, ['saveMetadata', 'saveChatConditional', 'saveChat'], {
    ...shared, DEFAULT_SAVE_EDIT_TIMEOUT: 2, isChatSaving: false, cancelDebouncedChatSave() {},
    async waitUntilCondition() {
      attempts++;
      if (busy) throw new Error('busy');
    },
    chat: [], name2: 'Viola', neutralCharacterName: 'System', compressRequest: async value => value,
    saveTokenCache() {}, saveItemizedPrompts() {},
    async fetch(url, request) {
      assert.equal(url, '/api/chats/save');
      const body = JSON.parse(request.body);
      disk.set(body.file_name, JSON.stringify(body.chat[0].chat_metadata));
      return new Response(null);
    },
  });
  const controlFetch = globalThis.fetch;
  context.mock.method(globalThis, 'fetch', (url, options) =>
    url === '/api/avatars/get' ? Promise.resolve(Response.json(portraits)) : controlFetch(url, options));
  const editor = pinnedFunctions(assets.get('/scripts/personas.js'), null, ['deletePersona'], {
    ...shared, power_user: power, saveMetadata: chat.saveMetadata,
    saveSettingsDebounced: page.browser.debounce('settings', () => { savedSettings = Object.keys(power.personas); }, 30_000),
    eventSource: { emit: async () => {} }, event_types: {}, uuidv4: randomUUID, loadPersonaForCurrentChat: async () => {},
    async fetch(url) {
      assert.equal(url, '/api/avatars/delete');
      deletes++;
      const present = portraits.includes(avatar);
      portraits = [];
      return new Response(null, { status: present ? 200 : 404 });
    },
  });
  await assert.rejects(editor.deletePersona(avatar, { silent: true }), /could not be removed from this chat/);
  assert.equal(attempts, 1);
  assert.equal(deletes, 1);
  assert.equal(metadata.persona, avatar);
  assert.equal(JSON.parse(disk.get('Tavern')).persona, avatar);
  assert.equal(await page.capture(), 'pending');
  character.chat = 'Farm';
  Object.assign(metadata, JSON.parse(originalFarm));
  busy = false;
  await assert.rejects(editor.deletePersona(avatar, { silent: true }), /original chat/);
  assert.equal(deletes, 1);
  assert.equal(attempts, 1);
  assert.equal(metadata.persona, avatar);
  assert.equal(disk.get('Farm'), originalFarm);
  assert.equal(await page.capture(), 'pending');
  character.chat = 'Tavern';
  Object.assign(metadata, JSON.parse(disk.get('Tavern')));
  delete metadata.persona;
  assert.equal(await editor.deletePersona(avatar, { silent: true }), true);
  assert.equal(attempts, 2);
  assert.equal(deletes, 2);
  assert.equal(await page.capture(), 'held');
  assert.deepEqual(JSON.parse(disk.get('Tavern')), { location: 'tavern' });
  assert.equal(disk.get('Farm'), originalFarm);
  assert.deepEqual(savedSettings, []);
});

test('an aborted Express thumbnail stream releases the writer only after thumbnail generation finishes', { timeout: 5000 }, async context => {
  const gate = new CaptureGate();
  const root = await mkdtemp(join(tmpdir(), 'universe-thumbnail-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const cache = join(root, 'cache');
  await mkdir(cache);
  for (const file of ['animated.webp', 'cached.png', 'generate.png']) {
    await writeFile(join(root, file), Buffer.alloc(256 * 1024));
  }
  await writeFile(join(cache, 'cached.png'), Buffer.alloc(256 * 1024));
  const { loader } = await prepareHooks(resolve('node_modules/sillytavern'));
  const source = [...loader.modules].find(([url]) => url.endsWith('/endpoints/thumbnails.js'))[1];
  const route = /^publicRouter\.get\('\/', async function [\s\S]*?^\}\);/m.exec(source)[0];
  const express = createRequire(resolve('node_modules/sillytavern/package.json'))('express');
  const started = Promise.withResolvers();
  const finishWrite = Promise.withResolvers();
  let handler;
  runInNewContext(route, {
    publicRouter: { get(routePath, callback) { handler = callback; } },
    universe: { background: work => gate.background(work) }, sanitize: name => name,
    fs: { existsSync }, path, getOriginalFolder: () => root, getThumbnailFolder: () => cache, thumbnailsEnabled: true,
    SKIPPED_EXTENSIONS: new Set(['.webp']), invalidateFirefoxCache() {},
    async generateThumbnail(directories, type, file) {
      started.resolve();
      await finishWrite.promise;
      const destination = join(cache, file);
      await writeFile(destination, Buffer.alloc(256 * 1024));
      return { path: destination };
    },
  });
  for (const file of ['animated.webp', 'cached.png', 'generate.png']) {
    const socket = new Duplex({
      read() {},
      write(chunk, encoding, done) { this.destroy(); done(); },
    });
    const closed = once(socket, 'close');
    const request = new IncomingMessage(socket);
    Object.assign(request, {
      method: 'GET', url: '/thumbnail', path: '/thumbnail', query: { file, type: 'persona', animated: 'true' },
      user: { directories: {} }, next(error) { if (error) throw error; },
    });
    const response = new ServerResponse(request);
    Object.setPrototypeOf(response, express.response);
    response.assignSocket(socket);
    let served;
    await gate.guard(request, response, () => { served = handler(request, response); });
    const id = randomUUID();
    if (file === 'generate.png') {
      await started.promise;
      socket.destroy();
      await closed;
      const waiting = gate.acquire(id);
      assert.equal(gate.request.held, false);
      assert.equal(gate.writers, 1);
      finishWrite.resolve();
      assert.equal(await waiting, 'held');
      assert.equal(existsSync(join(cache, file)), true);
    } else {
      await closed;
      assert.equal(response.writableEnded, false);
      assert.equal(await gate.acquire(id, 100), 'held');
    }
    await served;
    assert.equal(gate.writers, 0);
    gate.release(id);
  }
});

test('timeout releases responsive tabs, rejects stale acknowledgements and signals one retry on idle', async () => {
  let retries = 0;
  const gate = new CaptureGate(() => { retries++; });
  const send = client(gate);
  const id = randomUUID();
  const first = gate.acquire(id, 20);
  const stale = send('poll').epoch;
  assert.equal(await first, 'pending');
  assert.equal(send('poll').epoch, null);
  send('idle');
  send('idle');
  assert.equal(retries, 1);
  const next = gate.acquire(id);
  send('ack', { epoch: stale });
  assert.equal(gate.request.held, false);
  send('ack', { epoch: send('poll').epoch });
  assert.equal(await next, 'held');
  gate.release(id);
});

test('failed flush and lost tab leave the last capture pending', async () => {
  const gate = new CaptureGate();
  const send = client(gate);
  const failed = gate.acquire(randomUUID());
  send('failed', { epoch: send('poll').epoch });
  assert.equal(await failed, 'pending');
  const interrupted = gate.acquire(randomUUID());
  send('leave', { clean: true });
  assert.equal(await interrupted, 'pending');
  const another = client(gate);
  const dirty = gate.acquire(randomUUID());
  another('leave', { clean: false });
  assert.equal(await dirty, 'pending');
  assert.equal(await gate.acquire(randomUUID()), 'pending');
});

test('control requires profile ownership, valid commands, and a bounded request rate', () => {
  const gate = new CaptureGate();
  const tab = randomUUID();
  assert.equal(gate.control(null, { command: 'join', tab }).status, 400);
  assert.equal(gate.control('owner', { command: 'join', tab }).status, 200);
  assert.equal(gate.control('owner', { command: 'admit', tab }).admitted, true);
  assert.equal(gate.control('visitor', { command: 'poll', tab }).status, 404);
  assert.equal(gate.control('owner', { command: 'ack', tab, epoch: {} }).status, 400);
  assert.equal(gate.control('owner', { command: 'other', tab }).status, 400);
  let status;
  for (let count = 0; count < 51; count++) {
    status = gate.control('owner', { command: 'poll', tab }).status;
  }
  assert.equal(status, 429);
});

test('an unregistered browser can save locally while live captures stay unavailable', async () => {
  const gate = new CaptureGate();
  const send = client(gate);
  const id = randomUUID();
  const acquiring = gate.acquire(id);
  const response = { end() {} };
  const request = { method: 'POST', user: { profile: { handle: 'test-profile' } }, headers: { 'sec-fetch-site': 'same-origin' } };
  await gate.guard(request, response, () => response.end());
  assert.equal(await acquiring, 'pending');
  assert.equal(send('poll').epoch, null);
  assert.equal(await gate.acquire(randomUUID()), 'unavailable');
});

test('the installed sources match the pinned adapter and a changed server is refused', async context => {
  const root = resolve('node_modules/sillytavern');
  const { assets, loader } = await prepareHooks(root);
  assert.ok(loader.source.indexOf('universe.mountGate(app)') > loader.source.indexOf('app.use(requireLoginMiddleware)'));
  assert.ok(loader.source.indexOf('universe.mountGate(app)') < loader.source.indexOf('setupPrivateEndpoints(app);'));
  assert.ok(loader.source.indexOf('universe.mountAssets(app)') < loader.source.indexOf('app.use(express.static'));
  for (const url of ['/script.js', '/scripts/group-chats.js', '/scripts/world-info.js']) {
    assert.match(assets.get(url), /universe\.enter\(\)/);
  }
  const directory = resolve('local');
  await mkdir(directory, { recursive: true });
  const fixture = await mkdtemp(join(directory, 'hook-test-'));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  await mkdir(join(fixture, 'src'));
  await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'sillytavern', version: '1.19.1' }));
  await writeFile(join(fixture, 'src/server-main.js'), 'console.log("unexpected version")');
  await assert.rejects(prepareHooks(fixture), /Unrecognized SillyTavern source/);
});

test('debounced work drains before a browser acknowledges and stays queued during the hold', async context => {
  const gate = new CaptureGate();
  const events = new EventEmitter();
  let joins = 0;
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    if (JSON.parse(options.body).command === 'join' && ++joins === 1) {
      return Response.json({}, { status: 503 });
    }
    const { status, ...state } = gate.control('test-profile', JSON.parse(options.body));
    return Response.json(state, { status });
  });
  const original = globalThis.window;
  globalThis.window = { addEventListener: events.on.bind(events), fetch: globalThis.fetch };
  context.after(() => { globalThis.window = original; });
  const browser = await import(`../src/integration/browser-bridge.js?test=${randomUUID()}`);
  await browser.connect(() => ({}), () => false);
  assert.equal(joins, 2);
  const failed = browser.track('world/bay');
  const racing = browser.track('world/bay');
  failed(true);
  racing(false);
  browser.track('world/other')(false);
  assert.equal(await gate.acquire(randomUUID(), 1500), 'pending');
  browser.track('world/bay')(false);
  let edits = 0;
  const edit = browser.debounce('world', () => { edits++; }, 30_000);
  edit();
  const id = randomUUID();
  try {
    assert.equal(await gate.acquire(id, 2500), 'held');
    assert.equal(edits, 1);
    const waiting = browser.enter().then(leave => { edits++; leave(); });
    await pause(10);
    assert.equal(edits, 1);
    gate.release(id);
    await waiting;
    assert.equal(edits, 2);
  } finally {
    gate.release(id);
    events.emit('pagehide');
  }
});

test('group transcripts and deferred metadata keep separate jobs per group and coalesce repeat edits', async context => {
  const page = await browserFixture(context);
  await page.connecting;
  const { assets } = await prepareHooks(resolve('node_modules/sillytavern'));
  const groups = [{ id: 'east', chat_id: 'east-chat' }, { id: 'west', chat_id: 'west-chat' }];
  const writes = [];
  const story = pinnedFunctions(assets.get('/scripts/group-chats.js'), 'saveGroupDebounced',
    ['saveGroupChat', 'editGroup', '_save'], {
      universe: page.browser, groups, chat_metadata: {}, chat: [], compressRequest: request => request,
      fetch(url, request) {
        writes.push({ url, ...JSON.parse(request.body) });
        return Response.json({ ok: true });
      },
    });
  await story.saveGroupChat('east', true);
  await story.saveGroupChat('west', true);
  groups[0].name = 'final east name';
  await story.editGroup('east', false, false);
  assert.equal(await page.capture(), 'held');
  assert.deepEqual(writes.filter(write => write.url === '/api/chats/group/save').map(write => write.id), ['east-chat', 'west-chat']);
  const metadata = writes.filter(write => write.url === '/api/groups/edit');
  assert.deepEqual(metadata.map(write => write.id).sort(), ['east', 'west']);
  assert.equal(metadata.find(write => write.id === 'east').name, 'final east name');
});

test('immediate lore saves cancel only their own queued edit while other lorebooks flush', async context => {
  const page = await browserFixture(context);
  await page.connecting;
  const { assets } = await prepareHooks(resolve('node_modules/sillytavern'));
  const writes = [];
  const story = pinnedFunctions(assets.get('/scripts/world-info.js'), 'saveWorldDebounced',
    ['saveWorldInfo', '_save'], {
      universe: page.browser, world_names: [], worldInfoCache: new Map(), eventSource: { emit() {} }, event_types: {},
      fetch(url, request) { writes.push(JSON.parse(request.body)); return Response.json({ ok: true }); },
    });
  await story.saveWorldInfo('east', { turn: 1 });
  await story.saveWorldInfo('west', { turn: 2 });
  await story.saveWorldInfo('east', { turn: 3 });
  await story.saveWorldInfo('south', { turn: 4 });
  await story.saveWorldInfo('south', { turn: 5 }, true);
  assert.equal(await page.capture(), 'held');
  assert.equal(writes.length, 3);
  assert.deepEqual(Object.fromEntries(writes.map(write => [write.name, write.data.turn])), { east: 3, west: 2, south: 5 });
});

test('an immediate group write recovers only after the failing group is saved', async context => {
  const page = await browserFixture(context);
  await page.connecting;
  const { assets } = await prepareHooks(resolve('node_modules/sillytavern'));
  let rejectEast = true;
  const story = pinnedFunctions(assets.get('/scripts/group-chats.js'), 'saveGroupDebounced',
    ['editGroup', '_save'], {
      universe: page.browser, groups: [{ id: 'east' }, { id: 'west' }],
      fetch(url, request) {
        if (JSON.parse(request.body).id === 'east' && rejectEast) {
          throw new Error('Synthetic group failure');
        }
        return Response.json({ ok: true });
      },
    });
  await assert.rejects(story.editGroup('east', true, false), /Synthetic group failure/);
  await story.editGroup('west', true, false);
  assert.equal(await page.capture(), 'pending');
  rejectEast = false;
  await story.editGroup('east', true, false);
  assert.equal(await page.capture(), 'held');
});

test('a rejected old-lore deletion keeps the rename pending and defers relinking until a matching retry', async context => {
  const page = await browserFixture(context);
  await page.connecting;
  const { assets } = await prepareHooks(resolve('node_modules/sillytavern'));
  const files = new Set(['east']);
  const relinks = [];
  let rejectDelete = true;
  const story = pinnedFunctions(assets.get('/scripts/world-info.js'), 'saveWorldDebounced',
    ['saveWorldInfo', '_save', 'renameWorldInfo', 'deleteWorldInfo'], {
      universe: page.browser, world_names: ['east'], worldInfoCache: new Map(), event_types: {}, eventSource: { emit() {} },
      selected_world_info: [], power_user: {}, Popup: { show: { input: () => 'west' } },
      equalsIgnoreCaseAndAccents: (oldName, newName) => oldName === newName,
      toastr: { error() {} }, updateWorldInfoList() {}, $: () => ({ trigger() {}, val() {} }),
      updateWorldInfoLinks: (...args) => relinks.push(args),
      fetch(url, request) {
        if (url === '/api/worldinfo/list') {
          return Response.json([...files].map(file_id => ({ file_id })));
        }
        const { name } = JSON.parse(request.body);
        if (url === '/api/worldinfo/edit') {
          files.add(name);
        } else if (rejectDelete) {
          return new Response(null, { status: 503 });
        } else {
          files.delete(name);
        }
        return Response.json({ ok: true });
      },
    });
  await story.renameWorldInfo('east', {});
  assert.deepEqual([...files], ['east', 'west']);
  assert.equal(relinks.length, 0);
  await story.saveWorldInfo('west', {}, true);
  assert.equal(await page.capture(), 'pending');
  rejectDelete = false;
  await story.renameWorldInfo('east', {});
  assert.equal(relinks.length, 1);
  assert.deepEqual([...files], ['west']);
  assert.equal(await page.capture(), 'held');
});

test('a tab closing before the initial join response cannot leave a blocking registration', async context => {
  const joined = Promise.withResolvers();
  const response = Promise.withResolvers();
  const left = Promise.withResolvers();
  let admissions = 0;
  const page = await browserFixture(context, async (body, send) => {
    const result = send();
    if (body.command === 'join') {
      joined.resolve();
      await response.promise;
    } else if (body.command === 'leave') {
      left.resolve();
    } else if (body.command === 'admit') {
      admissions++;
    }
    return result;
  });
  await joined.promise;
  assert.equal(await page.capture(), 'held');
  page.events.emit('pagehide');
  await left.promise;
  response.resolve();
  await pause(10);
  assert.equal(admissions, 0);
  assert.equal(page.gate.tabs.size, 0);
  assert.equal(await page.capture(), 'held');
});

test('a delayed registration cannot admit a new participant into a held capture or erase an early dirty departure', async () => {
  const gate = new CaptureGate();
  const tab = randomUUID();
  const send = (command, extra) => gate.control('owner', { command, tab, ...extra });
  send('leave', { clean: true });
  send('join');
  const id = randomUUID();
  assert.equal(await gate.acquire(id), 'held');
  assert.equal(send('admit').admitted, false);
  gate.release(id);
  assert.equal(send('admit').admitted, true);
  send('leave', { clean: true });
  send('leave', { clean: false });
  send('join');
  assert.equal(send('admit').admitted, false);
  assert.equal(await gate.acquire(randomUUID()), 'pending');
});

test('rename drains earlier source and destination writes before replacing both with the current version', async context => {
  const oldWrite = Promise.withResolvers();
  const destinationWrite = Promise.withResolvers();
  const started = { East: Promise.withResolvers(), West: Promise.withResolvers() };
  const fixture = await renameFixture(context, async (url, body) => {
    if (url === '/api/worldinfo/edit' && body.data.revision === 1) {
      started[body.name].resolve();
      await (body.name === 'East' ? oldWrite.promise : destinationWrite.promise);
    }
  });
  const east = fixture.story.saveWorldInfo('East', { revision: 1 }, true);
  const west = fixture.story.saveWorldInfo('West', { revision: 1 }, true);
  await Promise.all([started.East.promise, started.West.promise]);
  const rename = fixture.story.renameWorldInfo('East', { revision: 2 });
  await pause(10);
  oldWrite.resolve();
  await east;
  assert.equal(fixture.files.get('East').revision, 1);
  destinationWrite.resolve();
  await Promise.all([west, rename]);
  assert.deepEqual([...fixture.files.entries()], [['West', { revision: 2 }]]);
  assert.equal(await fixture.capture(), 'held');
});

test('confirmed rename supersedes only the old book write failure', async context => {
  const fixture = await renameFixture(context, (url, body) =>
    url === '/api/worldinfo/edit' && body.data.revision === 1 ? new Response(null, { status: 503 }) : null);
  assert.equal(await fixture.story.saveWorldInfo('East', { revision: 1 }, true), false);
  assert.equal(await fixture.story.saveWorldInfo('Other', { revision: 1 }, true), false);
  await fixture.story.renameWorldInfo('East', { revision: 2 });
  assert.deepEqual([...fixture.files.keys()], ['West']);
  assert.equal(await fixture.capture(), 'pending');
  await fixture.story.saveWorldInfo('Other', { revision: 2 }, true);
  assert.equal(await fixture.capture(), 'held');
});

test('approved card relinks retry only the intended unfinished avatars after source removal', async context => {
  let rejectCard = true;
  const fixture = await renameFixture(context, (url, body) =>
    rejectCard && url === '/api/characters/merge-attributes' && body.avatar === 'second.png' ? new Response(null, { status: 503 }) : null);
  for (const avatar of ['first.png', 'second.png']) {
    fixture.cards.push({ name: avatar, avatar, data: { extensions: { world: 'East' } } });
  }
  await fixture.story.renameWorldInfo('East', { revision: 2 });
  assert.deepEqual([...fixture.files.keys()], ['West']);
  assert.deepEqual(fixture.merges, ['first.png']);
  assert.equal(await fixture.capture(), 'pending');
  fixture.cards.push({ name: 'new', avatar: 'new.png', data: { extensions: { world: 'East' } } });
  rejectCard = false;
  await fixture.story.renameWorldInfo('West', { revision: 3 });
  assert.deepEqual(fixture.prompts, { name: 1, links: 1 });
  assert.deepEqual(fixture.merges, ['first.png', 'second.png']);
  assert.equal(fixture.cards[2].data.extensions.world, 'East');
  assert.equal(fixture.files.get('West').revision, 2);
  assert.equal(await fixture.capture(), 'held');
});

test('declining primary card relinks completes the lore rename and preserves the card', async context => {
  const fixture = await renameFixture(context, null, false);
  fixture.cards.push({ name: 'first', avatar: 'first.png', data: { extensions: { world: 'East' } } });
  await fixture.story.renameWorldInfo('East', { revision: 2 });
  assert.deepEqual(fixture.prompts, { name: 1, links: 1 });
  assert.deepEqual(fixture.merges, []);
  assert.equal(await fixture.capture(), 'held');
});

test('a retry verifies a missing source after a lost delete response without rewriting its destination', async context => {
  let deletes = 0;
  const fixture = await renameFixture(context, url => {
    if (url === '/api/worldinfo/delete') {
      deletes++;
      fixture.files.delete('East');
      throw new Error('Synthetic lost response after deletion');
    }
  });
  await assert.rejects(fixture.story.renameWorldInfo('East', { revision: 2 }), /Synthetic lost response/);
  assert.equal(await fixture.capture(), 'pending');
  assert.deepEqual([...fixture.files.keys()], ['West']);
  await fixture.story.renameWorldInfo('West', { revision: 3 });
  assert.equal(deletes, 1);
  assert.equal(fixture.files.get('West').revision, 2);
  assert.equal(await fixture.capture(), 'held');
});

test('overlapping source and destination updates cannot resurrect a successfully renamed book', async context => {
  const writing = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const fixture = await renameFixture(context, async (url, body) => {
    if (url === '/api/worldinfo/edit' && body.name === 'West' && body.data.revision === 2) {
      writing.resolve();
      await resume.promise;
    }
  });
  const rename = fixture.story.renameWorldInfo('East', { revision: 2 });
  await writing.promise;
  const stale = assert.rejects(fixture.story.saveWorldInfo('East', { revision: 3 }, true), /changed names/);
  const fresh = fixture.story.saveWorldInfo('West', { revision: 4 }, true);
  await pause(10);
  resume.resolve();
  await Promise.all([rename, stale, fresh]);
  assert.deepEqual([...fixture.files.entries()], [['West', { revision: 4 }]]);
  assert.equal(await fixture.capture(), 'pending');
});
