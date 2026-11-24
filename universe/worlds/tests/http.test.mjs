import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { WorldsConfig } from '../src/config.mjs';
import { RateLimiter } from '../src/http/RateLimiter.mjs';
import { Security } from '../src/http/Security.mjs';
import { SseStream } from '../src/http/SseStream.mjs';
import { OpenRouterClient } from '../src/openrouter/OpenRouterClient.mjs';
import { ScribeLogCore } from '../src/scribe/ScribeLogCore.mjs';
import { ScribeReplay } from '../src/scribe/ScribeReplay.mjs';
import { WorldsServer } from '../src/server.mjs';
import { AvatarToken } from '../src/store/enums/AvatarToken.mjs';
import { CharacterTier } from '../src/store/enums/CharacterTier.mjs';
import { FindingStatus } from '../src/store/enums/FindingStatus.mjs';
import { TurnMode } from '../src/store/enums/TurnMode.mjs';
import { SqliteStore } from '../src/store/SqliteStore.mjs';

/**
 * @param {string} text
 * @param {{chunkSize?: number, finishReason?: string, usage?: object}} [options]
 * @returns {ReadableStream<Uint8Array>}
 */
function buildSseResponseStream(
  text,
  {
    chunkSize = 16,
    finishReason = 'stop',
    usage = { prompt_tokens: 60, completion_tokens: 30, cost: 0.001 },
  } = {},
) {
  const encoder = new TextEncoder();
  const frames = [];
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    const slice = text.slice(offset, offset + chunkSize);
    frames.push(`data: ${JSON.stringify({ choices: [{ delta: { content: slice } }] })}\n\n`);
  }
  frames.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }], usage })}\n\n`);
  frames.push('data: [DONE]\n\n');

  return new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
}

/**
 * @param {Array<object | ((context: {payload: object, url: string, init: object, callIndex: number}) => Promise<Response> | Response)>} handlers
 * @param {{store: SqliteStore, apiKeyProvider?: () => string | null}} options
 * @returns {{client: OpenRouterClient, calls: Array<{payload: object}>}}
 */
function createScriptedOpenRouterClient(handlers, { store, apiKeyProvider = () => 'sk-test-http-key-999' }) {
  const queue = [...handlers];
  const calls = [];
  const client = new OpenRouterClient({
    apiKeyProvider,
    retryOptions: {
      delaysMs: [0],
      wait: async () => {},
    },
    onSpend: (spendDto) => store.recordSpend(spendDto),
    fetchImpl: async (url, init) => {
      const payload = JSON.parse(init.body);
      const callIndex = calls.length;
      calls.push({ payload });
      const entry = queue.shift();
      if (entry === undefined) {
        throw new Error(`Unexpected OpenRouter call #${callIndex}.`);
      }
      if (typeof entry === 'function') {
        return await entry({ payload, url, init, callIndex });
      }
      if (entry.type === 'stream') {
        return new Response(
          buildSseResponseStream(entry.text, entry),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }
      if (entry.type === 'error') {
        return new Response(
          JSON.stringify({ error: { message: entry.message ?? 'Upstream failure' } }),
          { status: entry.status ?? 400, headers: { 'content-type': 'application/json' } },
        );
      }
      const responseText = typeof entry.json === 'object' ? JSON.stringify(entry.json) : String(entry.text ?? '');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: responseText }, finish_reason: entry.finishReason ?? 'stop' }],
          usage: entry.usage ?? { prompt_tokens: 50, completion_tokens: 25, cost: 0.0005 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  return { client, calls };
}

/**
 * @param {Response} response
 * @returns {Promise<Array<{event: string, data: unknown}>>}
 */
async function readAllSseEvents(response) {
  const text = await response.text();
  const blocks = text.split('\n\n').filter((block) => block.trim().length > 0);
  const events = [];
  for (const block of blocks) {
    let eventName = 'message';
    const dataLines = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) {
        eventName = line.slice(7);
      } else if (line.startsWith('data: ')) {
        dataLines.push(line.slice(6));
      }
    }
    if (dataLines.length > 0) {
      events.push({
        event: eventName,
        data: JSON.parse(dataLines.join('\n')),
      });
    }
  }
  return events;
}

/**
 * @param {Headers} headers
 * @returns {void}
 */
function assertSecurityHeaders(headers) {
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(
    headers.get('content-security-policy'),
    "default-src 'self'; frame-ancestors 'none'; form-action 'none'",
  );
}

/**
 * @param {{envApiKey?: string | null, withPublicDir?: boolean}} [options]
 * @returns {{tempRoot: string, config: object, publicDir: string}}
 */
function createTempEnvironment({ envApiKey = 'sk-env-secret-111', withPublicDir = false } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-http-test-'));
  const localDir = path.join(tempRoot, 'local');
  const publicDir = path.join(tempRoot, 'public');
  fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });
  if (withPublicDir) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  const config = Object.freeze({
    port: 0,
    rootDir: tempRoot,
    localDir,
    dbPath: path.join(localDir, 'worlds.sqlite'),
    secretsPath: path.join(localDir, 'secrets.json'),
    syncStatePath: path.join(localDir, 'sync-state.json'),
    conflictsDir: path.join(localDir, 'conflicts'),
    envApiKey,
    r2: null,
  });
  return { tempRoot, config, publicDir };
}

/**
 * @param {{port: number, pathName: string, method?: string, headers?: Record<string, string>, body?: string}} options
 * @returns {Promise<{statusCode: number, headers: import('node:http').IncomingHttpHeaders, bodyText: string}>}
 */
function sendRawHttpRequest({ port, pathName, method = 'GET', headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathName,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            bodyText: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    if (body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

describe('HTTP Security, RateLimiter, and SseStream primitives', () => {
  it('validates loopback Host, Origin, constant-time CSRF, and secret redaction strictly', () => {
    assert.equal(Security.MaxBodyBytes, 262144);
    assert.equal(Security.isValidLoopbackHost('127.0.0.1:8768', 8768), true);
    assert.equal(Security.isValidLoopbackHost('LOCALHOST:8768', 8768), true);
    assert.equal(Security.isValidLoopbackHost('evil.example:8768', 8768), false);
    assert.equal(Security.isValidLoopbackHost('localhost.evil.example:8768', 8768), false);
    assert.equal(Security.isValidLoopbackHost('0.0.0.0:8768', 8768), false);
    assert.equal(Security.isValidLoopbackHost('localhost.:8768', 8768), false);
    assert.equal(Security.isValidLoopbackHost('127.0.0.1:8769', 8768), false);
    assert.equal(Security.isValidLoopbackHost('127.0.0.1', 8768), false);
    assert.equal(Security.isValidLoopbackHost(undefined, 8768), false);

    assert.equal(Security.isValidLoopbackOrigin('http://127.0.0.1:8768', 8768), true);
    assert.equal(Security.isValidLoopbackOrigin('http://localhost:8768', 8768), true);
    assert.equal(Security.isValidLoopbackOrigin('https://127.0.0.1:8768', 8768), false);
    assert.equal(Security.isValidLoopbackOrigin('http://127.0.0.1:8768/', 8768), false);
    assert.equal(Security.isValidLoopbackOrigin('http://evil.example:8768', 8768), false);
    assert.equal(Security.isValidLoopbackOrigin(undefined, 8768), false);

    const token = Security.generateCsrfToken();
    assert.equal(token.length, 64);
    assert.equal(Security.isValidCsrfToken(token, token), true);
    assert.equal(Security.isValidCsrfToken(`${token}x`, token), false);
    assert.equal(Security.isValidCsrfToken('', ''), false);
    assert.equal(Security.isValidCsrfToken(undefined, token), false);

    assert.equal(Security.redactSecret('Failed with sk-abc and sk-abc', 'sk-abc'), 'Failed with [REDACTED] and [REDACTED]');
    assert.equal(Security.redactSecret('No leak', ''), 'No leak');
  });

  it('enforces RateLimiter sliding windows, lazy pruning, and Retry-After bounds', () => {
    let fakeNow = 100_000;
    const limiter = new RateLimiter({
      nowProvider: () => fakeNow,
      windowMs: 60_000,
      llmLimit: 3,
      apiLimit: 5,
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = limiter.consume('llm', '127.0.0.1');
      assert.equal(result.allowed, true);
      assert.equal(result.remaining, 3 - attempt);
    }

    const blocked = limiter.consume('llm', '127.0.0.1');
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.equal(blocked.retryAfterSeconds, 60);

    const apiResult = limiter.consume('api', '127.0.0.1');
    assert.equal(apiResult.allowed, true);
    assert.equal(apiResult.remaining, 4);

    fakeNow += 60_000;
    const afterWindow = limiter.consume('llm', '127.0.0.1');
    assert.equal(afterWindow.allowed, true);
    assert.equal(afterWindow.remaining, 2);

    assert.throws(() => limiter.consume('unknown'), RangeError);
  });

  it('rejects directory traversal, malformed encodings, and symlink escapes in resolveStaticFile', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-static-test-'));
    try {
      const publicDir = path.join(tempDir, 'public');
      const outsideFile = path.join(tempDir, 'secret.txt');
      fs.mkdirSync(publicDir, { recursive: true });
      fs.writeFileSync(outsideFile, 'top-secret', 'utf8');
      fs.writeFileSync(path.join(publicDir, 'app.css'), 'body { color: inherit; }', 'utf8');
      fs.symlinkSync(outsideFile, path.join(publicDir, 'escape.txt'));

      const validAsset = Security.resolveStaticFile(publicDir, '/app.css');
      assert.notEqual(validAsset, null);
      assert.equal(validAsset.contentType, 'text/css; charset=utf-8');

      assert.equal(Security.resolveStaticFile(publicDir, '/../secret.txt'), null);
      assert.equal(Security.resolveStaticFile(publicDir, '/%2e%2e/secret.txt'), null);
      assert.equal(Security.resolveStaticFile(publicDir, '/%ZZ'), null);
      assert.equal(Security.resolveStaticFile(publicDir, '/..%5csecret.txt'), null);
      assert.equal(Security.resolveStaticFile(publicDir, '/secret%00.txt'), null);
      assert.equal(Security.resolveStaticFile(publicDir, '/escape.txt'), null);
      assert.equal(Security.resolveStaticFile(publicDir, '/'), null);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('never triggers SseStream abort on request.close and cleans up listeners on end()', () => {
    const reqListeners = new Map();
    const resListeners = new Map();
    const fakeReq = {
      on(eventName, handler) {
        reqListeners.set(eventName, handler);
      },
      off(eventName, handler) {
        if (reqListeners.get(eventName) === handler) {
          reqListeners.delete(eventName);
        }
      },
    };
    const fakeRes = {
      writableEnded: false,
      destroyed: false,
      on(eventName, handler) {
        resListeners.set(eventName, handler);
      },
      off(eventName, handler) {
        if (resListeners.get(eventName) === handler) {
          resListeners.delete(eventName);
        }
      },
      writeHead() {},
      flushHeaders() {},
      write() {},
      end() {
        this.writableEnded = true;
      },
    };

    const sse = new SseStream({ request: fakeReq, response: fakeRes });
    assert.equal(reqListeners.has('close'), false);
    assert.equal(reqListeners.has('aborted'), true);
    assert.equal(resListeners.has('close'), true);

    sse.open();
    assert.equal(sse.signal.aborted, false);
    sse.end();
    resListeners.get('close')?.();
    assert.equal(sse.signal.aborted, false);
    assert.equal(reqListeners.size, 0);
    assert.equal(resListeners.size, 0);
  });
});

describe('Hardened WorldsServer HTTP security, body limits, rate limits, and redaction', () => {
  const cleanups = [];

  after(async () => {
    for (const cleanupFn of cleanups) {
      await cleanupFn();
    }
  });

  it('blocks non-loopback Host, bad Origin/CSRF, static escapes, oversized bodies (Content-Length & chunked), and rate limits', async () => {
    const env = createTempEnvironment({ withPublicDir: true });
    const outsideSecret = path.join(env.tempRoot, 'outside.txt');
    fs.writeFileSync(outsideSecret, 'do-not-serve', 'utf8');
    fs.writeFileSync(path.join(env.publicDir, 'styles.css'), 'main { display: block; }\n', 'utf8');
    fs.symlinkSync(outsideSecret, path.join(env.publicDir, 'symlink.txt'));

    const store = new SqliteStore(env.config.dbPath);
    const { client } = createScriptedOpenRouterClient([], { store });
    const rateLimiter = new RateLimiter({ llmLimit: 2, apiLimit: 6, windowMs: 60_000 });
    const server = await WorldsServer.create({
      config: env.config,
      store,
      client,
      publicDir: env.publicDir,
      rateLimiter,
    });
    const started = await server.start();
    cleanups.push(async () => {
      await server.stop();
      store.close();
      fs.rmSync(env.tempRoot, { recursive: true, force: true });
    });

    const baseHeaders = {
      origin: started.url,
      'x-worlds-csrf': started.csrfToken,
      'content-type': 'application/json',
    };

    const validHome = await fetch(`${started.url}/`);
    assert.equal(validHome.status, 200);
    assertSecurityHeaders(validHome.headers);
    const homeHtml = await validHome.text();
    assert.ok(homeHtml.includes(`<meta name="worlds-csrf" content="${started.csrfToken}">`));

    const validStatic = await fetch(`${started.url}/styles.css`);
    assert.equal(validStatic.status, 200);
    assertSecurityHeaders(validStatic.headers);

    for (const evilHost of [
      `evil.example:${started.port}`,
      `localhost.evil.example:${started.port}`,
      `0.0.0.0:${started.port}`,
      `localhost.:${started.port}`,
      `127.0.0.1:${started.port === 8768 ? 8769 : 8768}`,
    ]) {
      const hostRes = await sendRawHttpRequest({
        port: started.port,
        pathName: '/api/health',
        headers: { Host: evilHost },
      });
      assert.equal(hostRes.statusCode, 403);
      assert.equal(hostRes.bodyText.includes(evilHost), false);
      assert.equal(hostRes.headers['cache-control'], 'no-store');
      assert.equal(hostRes.headers['x-content-type-options'], 'nosniff');
    }

    const getRootEvilHost = await sendRawHttpRequest({
      port: started.port,
      pathName: '/',
      headers: { Host: `evil.example:${started.port}` },
    });
    assert.equal(getRootEvilHost.statusCode, 403);

    for (const traversalPath of ['/../local/worlds.sqlite', '/%2e%2e/local/worlds.sqlite', '/symlink.txt']) {
      const escaped = await fetch(`${started.url}${traversalPath}`);
      assert.ok(escaped.status === 403 || escaped.status === 404);
      assertSecurityHeaders(escaped.headers);
    }

    const noCsrfRes = await fetch(`${started.url}/api/campaigns`, {
      method: 'POST',
      headers: { origin: started.url, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Blocked' }),
    });
    assert.equal(noCsrfRes.status, 403);
    assertSecurityHeaders(noCsrfRes.headers);

    const wrongCsrfRes = await fetch(`${started.url}/api/campaigns`, {
      method: 'POST',
      headers: { origin: started.url, 'x-worlds-csrf': '0'.repeat(64), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Blocked' }),
    });
    assert.equal(wrongCsrfRes.status, 403);

    const foreignOriginRes = await fetch(`${started.url}/api/campaigns`, {
      method: 'POST',
      headers: { origin: `http://evil.example:${started.port}`, 'x-worlds-csrf': started.csrfToken, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Blocked' }),
    });
    assert.equal(foreignOriginRes.status, 403);

    const oversizedPayload = JSON.stringify({ title: 'X'.repeat(Security.MaxBodyBytes + 100) });
    const tooLargeByHeader = await fetch(`${started.url}/api/campaigns`, {
      method: 'POST',
      headers: baseHeaders,
      body: oversizedPayload,
    });
    assert.equal(tooLargeByHeader.status, 413);
    assertSecurityHeaders(tooLargeByHeader.headers);

    const chunkedStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('{"title":"'));
        const halfPayload = 'A'.repeat(150 * 1024);
        controller.enqueue(encoder.encode(halfPayload));
        controller.enqueue(encoder.encode(halfPayload));
        controller.enqueue(encoder.encode('"}'));
        controller.close();
      },
    });
    const tooLargeChunked = await fetch(`${started.url}/api/campaigns`, {
      method: 'POST',
      headers: baseHeaders,
      duplex: 'half',
      body: chunkedStream,
    });
    assert.equal(tooLargeChunked.status, 413);
    assertSecurityHeaders(tooLargeChunked.headers);

    const llmUrl = `${started.url}/api/campaigns/missing-camp/turns`;
    for (let count = 0; count < 2; count += 1) {
      const llmProbe = await fetch(llmUrl, {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify({ text: 'hello' }),
      });
      assert.equal(llmProbe.status, 404);
    }
    const rateLimitedLlm = await fetch(llmUrl, {
      method: 'POST',
      headers: baseHeaders,
      body: oversizedPayload,
    });
    assert.equal(rateLimitedLlm.status, 429);
    assert.ok(Number.parseInt(rateLimitedLlm.headers.get('retry-after'), 10) >= 1);

    for (let count = 0; count < 4; count += 1) {
      const apiProbe = await fetch(`${started.url}/api/health`);
      assert.equal(apiProbe.status, 200);
    }
    const rateLimitedApi = await fetch(`${started.url}/api/health`);
    assert.equal(rateLimitedApi.status, 429);
    assert.ok(Number.parseInt(rateLimitedApi.headers.get('retry-after'), 10) >= 1);
  });

  it('enforces PUT /api/settings write-last atomicity and redacts OpenRouter API key everywhere', async () => {
    const env = createTempEnvironment({ envApiKey: 'sk-env-secret-111' });
    const store = new SqliteStore(env.config.dbPath);
    const leakedErrorKey = 'sk-override-secret-222';
    const { client } = createScriptedOpenRouterClient([
      {
        type: 'error',
        status: 401,
        message: `Unauthorized key ${leakedErrorKey} rejected by upstream`,
      },
    ], {
      store,
      apiKeyProvider: () => WorldsConfig.resolveApiKey(env.config).key,
    });

    const server = await WorldsServer.create({
      config: env.config,
      store,
      client,
      publicDir: env.publicDir,
    });
    const started = await server.start();
    cleanups.push(async () => {
      await server.stop();
      store.close();
      fs.rmSync(env.tempRoot, { recursive: true, force: true });
    });

    const headers = {
      origin: started.url,
      'x-worlds-csrf': started.csrfToken,
      'content-type': 'application/json',
    };

    const initialSettingsRes = await fetch(`${started.url}/api/settings`);
    assert.equal(initialSettingsRes.status, 200);
    const initialSettingsText = await initialSettingsRes.text();
    assert.equal(initialSettingsText.includes('sk-env-secret-111'), false);
    const initialSettings = JSON.parse(initialSettingsText);
    assert.deepEqual(initialSettings.apiKey, { configured: true, source: 'env' });

    const invalidAtomicRes = await fetch(`${started.url}/api/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        publicOdds: -5,
        openRouterApiKey: leakedErrorKey,
      }),
    });
    assert.equal(invalidAtomicRes.status, 400);
    assert.equal(fs.existsSync(env.config.secretsPath), false);
    assert.equal((await invalidAtomicRes.text()).includes(leakedErrorKey), false);

    const whitespaceKeyRes = await fetch(`${started.url}/api/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        openRouterApiKey: 'sk-bad key with spaces',
      }),
    });
    assert.equal(whitespaceKeyRes.status, 400);
    assert.equal(fs.existsSync(env.config.secretsPath), false);

    const nonByteKeyRes = await fetch(`${started.url}/api/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        openRouterApiKey: 'sk-bad-\u2603',
      }),
    });
    assert.equal(nonByteKeyRes.status, 400);

    const validUpdateRes = await fetch(`${started.url}/api/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        models: {
          director: 'openrouter/dir',
          composer: 'openrouter/comp',
          main: 'openrouter/main',
          recurring: 'openrouter/rec',
          scribe: 'openrouter/scribe',
        },
        publicOdds: 0,
        privateOdds: 0,
        scribeInterval: 0,
        pedantEnabled: false,
        dailyWarnUsd: 5.5,
        openRouterApiKey: leakedErrorKey,
      }),
    });
    assert.equal(validUpdateRes.status, 200);
    const updatedText = await validUpdateRes.text();
    assert.equal(updatedText.includes(leakedErrorKey), false);
    assert.equal(updatedText.includes('sk-env-secret-111'), false);
    const updatedJson = JSON.parse(updatedText);
    assert.deepEqual(updatedJson.apiKey, { configured: true, source: 'secrets' });
    assert.equal(WorldsConfig.resolveApiKey(env.config).key, leakedErrorKey);

    const campaignRes = await fetch(`${started.url}/api/campaigns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Secret Leak Check' }),
    });
    const campaign = await campaignRes.json();

    const sseErrorRes = await fetch(`${started.url}/api/campaigns/${campaign.id}/turns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Hello.', mode: TurnMode.Normal }),
    });
    assert.equal(sseErrorRes.status, 200);
    const sseEvents = await readAllSseEvents(sseErrorRes);
    const errorEvent = sseEvents.find((item) => item.event === 'error');
    assert.ok(errorEvent !== undefined);
    assert.equal(errorEvent.data.message.includes(leakedErrorKey), false);
    assert.equal(errorEvent.data.message.includes('[REDACTED]'), true);

    const clearKeyRes = await fetch(`${started.url}/api/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ openRouterApiKey: null }),
    });
    assert.equal(clearKeyRes.status, 200);
    const clearedJson = await clearKeyRes.json();
    assert.deepEqual(clearedJson.apiKey, { configured: true, source: 'env' });

    const healthRes = await fetch(`${started.url}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthText = await healthRes.text();
    assert.equal(healthText.includes('sk-env-secret-111'), false);
    assert.equal(healthText.includes(leakedErrorKey), false);
  });
});

describe('Full REST & SSE lifecycle, concurrency, Scribe sync, and client disconnect abort', () => {
  const cleanups = [];

  after(async () => {
    for (const cleanupFn of cleanups) {
      await cleanupFn();
    }
  });

  it('executes complete campaign -> cast -> SSE turn -> 409 lock -> regenerate -> edit -> memory -> tell -> muse -> findings -> delete -> sync lifecycle', async () => {
    const env = createTempEnvironment({ envApiKey: 'sk-e2e-test-key' });
    const store = new SqliteStore(env.config.dbPath);

    let holdDirectorGate = null;
    const directorWaitingPromise = new Promise((resolve) => {
      holdDirectorGate = resolve;
    });
    let releaseTurnGate = null;
    const turnBarrierPromise = new Promise((resolve) => {
      releaseTurnGate = resolve;
    });

    const { client } = createScriptedOpenRouterClient([
      async () => {
        holdDirectorGate();
        await turnBarrierPromise;
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  sceneChanged: false,
                  location: 'Harbor Inn',
                  day: 1,
                  timeLabel: 'Evening',
                  sceneType: 'private',
                  userInputKind: 'player_in_scene',
                  presentSlugs: ['frost', 'lize'],
                  remoteSlugs: [],
                  offscreenNotes: { collette: 'in the library' },
                  walkOnsEnter: [],
                  walkOnsLeave: [],
                  encounterAccepted: false,
                  encounterBrief: '',
                  pacing: 'focused_one',
                  targetChars: 800,
                  responders: [{ slug: 'lize', beatGoal: 'Answer Frost quietly.', length: 'short' }],
                  narratorDirective: 'Keep it quiet.',
                }),
              },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 100, completion_tokens: 40, cost: 0.002 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
      {
        json: {
          internalThought: 'Keep the key secret.',
          physicalAction: 'Lize leans over the table.',
          spokenLines: 'I kept the cellar key safe.',
          tone: 'guarded',
          knowledgeBoundaries: 'Only Frost knows.',
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:narrator]]\nLantern light flickered.\n[[BEAT:lize]]\n*Lize leaned over the table.*\nI kept the cellar key safe.',
      },
      {
        json: {
          sceneChanged: false,
          location: 'Harbor Inn',
          day: 1,
          timeLabel: 'Evening',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: { collette: 'in the library' },
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 800,
          responders: [{ slug: 'lize', beatGoal: 'Speak softly.', length: 'short' }],
          narratorDirective: 'Regenerated beat.',
        },
      },
      {
        json: {
          internalThought: 'Still careful.',
          physicalAction: 'Lize taps the table.',
          spokenLines: 'Nobody else saw the silver lock.',
          tone: 'calm',
          knowledgeBoundaries: 'Private scene.',
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:lize]]\n*Lize tapped the table.*\nNobody else saw the silver lock.',
      },
      {
        text: [
          '=== FACTS',
          'Lize | belonging | keeps the cellar key | #2',
          'Lize | relation to Frost | trusts him with the cellar key | #2',
          '=== THREADS',
          'OPEN | Unlock the old cellar door | #2',
        ].join('\n'),
      },
      {
        text: [
          '=== FACTS',
          'Lize | belonging | keeps the cellar key | #2',
          'Lize | relation to Frost | trusts him with the cellar key | #2',
          '=== THREADS',
          'OPEN | Unlock the old cellar door | #2',
        ].join('\n'),
      },
      {
        text: [
          '=== FACTS',
          'Lize Vance | trait | never leaves the inn unarmed | #2',
        ].join('\n'),
      },
      {
        text: 'LINE: Narrator: A sudden knock echoed from the cellar stairs below.',
      },
    ], { store });

    const server = await WorldsServer.create({
      config: env.config,
      store,
      client,
      publicDir: env.publicDir,
    });
    const started = await server.start();
    cleanups.push(async () => {
      await server.stop();
      store.close();
      fs.rmSync(env.tempRoot, { recursive: true, force: true });
    });

    const rootRes = await fetch(`${started.url}/`);
    assert.equal(rootRes.status, 200);
    const rootHtml = await rootRes.text();
    const csrfMatch = /<meta name="worlds-csrf" content="([a-f0-9]+)">/.exec(rootHtml);
    assert.ok(csrfMatch !== null);
    const csrf = csrfMatch[1];

    const headers = {
      origin: started.url,
      'x-worlds-csrf': csrf,
      'content-type': 'application/json',
    };

    const settingsRes = await fetch(`${started.url}/api/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        models: {
          director: 'openrouter/director',
          composer: 'openrouter/composer',
          main: 'openrouter/main',
          recurring: 'openrouter/recurring',
          scribe: 'openrouter/scribe',
        },
        publicOdds: 0,
        privateOdds: 0,
        scribeInterval: 0,
        pedantEnabled: false,
      }),
    });
    assert.equal(settingsRes.status, 200);

    const createCamp1 = await fetch(`${started.url}/api/campaigns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'First Chronicle', premise: 'Fictional harbor mystery.' }),
    });
    assert.equal(createCamp1.status, 201);
    const campaign1 = await createCamp1.json();

    const createCamp2 = await fetch(`${started.url}/api/campaigns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Second Chronicle' }),
    });
    assert.equal(createCamp2.status, 201);
    const campaign2 = await createCamp2.json();

    const page1Res = await fetch(`${started.url}/api/campaigns?limit=1`);
    assert.equal(page1Res.status, 200);
    const page1 = await page1Res.json();
    assert.equal(page1.total, 2);
    assert.equal(page1.items.length, 1);
    assert.notEqual(page1.nextCursor, null);

    const page2Res = await fetch(`${started.url}/api/campaigns?limit=1&after=${encodeURIComponent(page1.nextCursor)}`);
    const page2 = await page2Res.json();
    assert.equal(page2.items.length, 1);
    assert.equal(page2.nextCursor, null);

    const badQueryRes = await fetch(`${started.url}/api/campaigns?limit=abc`);
    assert.equal(badQueryRes.status, 400);

    const deleteCamp2 = await fetch(`${started.url}/api/campaigns/${campaign2.id}`, {
      method: 'DELETE',
      headers,
    });
    assert.equal(deleteCamp2.status, 200);
    assert.deepEqual(await deleteCamp2.json(), { deleted: true });

    const frostRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'frost',
        name: 'Frost',
        isPlayer: true,
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Slate,
      }),
    });
    assert.equal(frostRes.status, 201);
    const frost = await frostRes.json();

    const lizeRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'lize',
        name: 'Lize',
        aliases: ['Liz'],
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Rose,
      }),
    });
    assert.equal(lizeRes.status, 201);
    const lize = await lizeRes.json();

    const colletteRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'collette',
        name: 'Collette',
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Amber,
      }),
    });
    assert.equal(colletteRes.status, 201);
    const collette = await colletteRes.json();

    const tempCharRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'temp_guard',
        name: 'Temp Guard',
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Teal,
      }),
    });
    assert.equal(tempCharRes.status, 201);
    const tempChar = await tempCharRes.json();

    const dupSlugRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'lize',
        name: 'Lize Twin',
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Plum,
      }),
    });
    assert.equal(dupSlugRes.status, 409);

    const deleteTempCharRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/characters/${tempChar.id}`, {
      method: 'DELETE',
      headers,
    });
    assert.equal(deleteTempCharRes.status, 200);

    const patchCampRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sceneState: {
          ...campaign1.sceneState,
          location: 'Harbor Inn',
          sceneType: 'private',
          presentIds: [frost.id, lize.id],
          offscreenNotes: { [collette.id]: 'in the library' },
        },
      }),
    });
    assert.equal(patchCampRes.status, 200);
    const patchedCamp = await patchCampRes.json();
    assert.equal(patchedCamp.playerCharacterId, frost.id);

    const badTurnRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/turns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: '   ', mode: TurnMode.Normal }),
    });
    assert.equal(badTurnRes.status, 400);

    const turnFetchPromise = fetch(`${started.url}/api/campaigns/${campaign1.id}/turns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Did you bring the key?', mode: TurnMode.Normal }),
    });

    await directorWaitingPromise;

    const busyTurnRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/turns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Another turn', mode: TurnMode.Normal }),
    });
    assert.equal(busyTurnRes.status, 409);
    assert.ok(busyTurnRes.headers.get('content-type').includes('application/json'));

    const busyDeleteCampRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}`, {
      method: 'DELETE',
      headers,
    });
    assert.equal(busyDeleteCampRes.status, 409);

    releaseTurnGate();

    const turnRes = await turnFetchPromise;
    assert.equal(turnRes.status, 200);
    assert.ok(turnRes.headers.get('content-type').includes('text/event-stream'));
    const turnEvents = await readAllSseEvents(turnRes);
    const turnEventNames = turnEvents.map((item) => item.event);
    assert.ok(turnEventNames.includes('phase'));
    assert.ok(turnEventNames.includes('beat_delta'));
    assert.ok(turnEventNames.includes('committed'));
    const doneTurnEvent = turnEvents.find((item) => item.event === 'done');
    assert.ok(doneTurnEvent !== undefined);
    assert.equal(doneTurnEvent.data.assistantTurn.seq, 2);

    const deleteRefCharRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/characters/${lize.id}`, {
      method: 'DELETE',
      headers,
    });
    assert.equal(deleteRefCharRes.status, 409);

    const regenRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/turns/regenerate`, {
      method: 'POST',
      headers,
    });
    assert.equal(regenRes.status, 200);
    const regenEvents = await readAllSseEvents(regenRes);
    const regenDone = regenEvents.find((item) => item.event === 'done');
    assert.ok(regenDone !== undefined);
    assert.ok(regenDone.data.assistantTurn.rawText.includes('silver lock'));

    const turnsPageRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/turns?limit=1`);
    assert.equal(turnsPageRes.status, 200);
    const turnsPage = await turnsPageRes.json();
    assert.equal(turnsPage.total, 2);
    assert.equal(turnsPage.items.length, 1);
    assert.notEqual(turnsPage.nextCursor, null);

    const memUpdateRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/memory/update`, {
      method: 'POST',
      headers,
    });
    assert.equal(memUpdateRes.status, 200);
    const memUpdate = await memUpdateRes.json();
    assert.equal(memUpdate.updated, true);
    assert.equal(memUpdate.lastTurnSeq, 2);
    assert.equal(memUpdate.dirty, false);

    const initialMemRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/memory?section=facts`);
    assert.equal(initialMemRes.status, 200);
    const initialMem = await initialMemRes.json();
    assert.equal(initialMem.dirty, false);
    assert.equal(initialMem.counts.facts, 1);
    assert.equal(initialMem.counts.relations, 1);
    assert.equal(initialMem.counts.threads, 1);
    assert.equal(initialMem.items[0].subjectLabel, 'Lize');
    assert.ok(Array.isArray(initialMem.items[0].knownBy) || initialMem.items[0].knownBy === 'Everyone');

    const editTurnRes = await fetch(
      `${started.url}/api/campaigns/${campaign1.id}/turns/${regenDone.data.assistantTurn.id}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          text: '*Lize tapped the table.*\nNobody else saw the iron lock.',
        }),
      },
    );
    assert.equal(editTurnRes.status, 200);

    const dirtyMemRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/memory?section=facts`);
    assert.equal(dirtyMemRes.status, 200);
    const dirtyMem = await dirtyMemRes.json();
    assert.equal(dirtyMem.dirty, true);

    const repairMemRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/memory/update`, {
      method: 'POST',
      headers,
    });
    assert.equal(repairMemRes.status, 200);
    const repairedMem = await repairMemRes.json();
    assert.equal(repairedMem.dirty, false);

    const postRepairFactsRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/memory?section=facts`);
    assert.equal(postRepairFactsRes.status, 200);
    const postRepairFacts = await postRepairFactsRes.json();
    assert.equal(postRepairFacts.dirty, false);
    assert.equal(postRepairFacts.counts.facts, 1);

    const patchCharWithBookRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/characters/${lize.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        name: 'Lize Vance',
        aliases: ['Liz', 'Miss Vance'],
      }),
    });
    assert.equal(patchCharWithBookRes.status, 200);
    const patchedLize = await patchCharWithBookRes.json();
    assert.equal(patchedLize.name, 'Lize Vance');

    const newCharWithBookRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'marlow',
        name: 'Marlow',
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Indigo,
      }),
    });
    assert.equal(newCharWithBookRes.status, 201);
    const createdMarlow = await newCharWithBookRes.json();
    assert.ok(typeof createdMarlow.scribeSubjectId === 'string' && createdMarlow.scribeSubjectId.startsWith('S'));

    const tellPreviewRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/memory/tell`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'preview',
        instruction: 'Lize Vance never leaves the inn unarmed.',
      }),
    });
    assert.equal(tellPreviewRes.status, 200);
    const previewJson = await tellPreviewRes.json();
    assert.ok(previewJson.operations.length >= 1);

    const tellCommitRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/memory/tell`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'commit',
        operations: previewJson.operations,
      }),
    });
    assert.equal(tellCommitRes.status, 200);

    const rulingsRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/memory?section=rulings&query=unarmed`);
    assert.equal(rulingsRes.status, 200);
    const rulingsJson = await rulingsRes.json();
    assert.equal(rulingsJson.items.length, 1);
    assert.equal(rulingsJson.items[0].subjectLabel, 'Lize Vance');

    const museRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/memory/muse`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    assert.equal(museRes.status, 200);
    const museJson = await museRes.json();
    assert.ok(museJson.suggestion.text.startsWith('Narrator: '));

    const insertedFindings = store.insertFindings(campaign1.id, regenDone.data.assistantTurn.id, [
      {
        kind: 'secret_leak',
        subjectId: patchedLize.scribeSubjectId,
        subjectName: 'Lize Vance',
        speakerCharacterId: collette.id,
        factId: postRepairFacts.items[0].id,
        category: 'belonging',
        bookText: 'keeps the cellar key',
        summary: 'Collette mentioned the cellar key.',
        quote: 'cellar key',
      },
      {
        kind: 'name_mismatch',
        subjectId: patchedLize.scribeSubjectId,
        subjectName: 'Lize Vance',
        speakerCharacterId: frost.id,
        factId: null,
        category: 'aka',
        bookText: 'Lize Vance',
        summary: '"Liza" may be Lize Vance',
        quote: 'Liza',
      },
      {
        kind: 'contradiction',
        subjectId: patchedLize.scribeSubjectId,
        subjectName: 'Lize Vance',
        speakerCharacterId: collette.id,
        factId: postRepairFacts.items[0].id,
        category: 'belonging',
        bookText: 'keeps the cellar key',
        summary: 'Contradicts cellar key.',
        quote: 'lost the cellar key',
      },
    ]);

    const findingsListRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/findings?status=open`);
    assert.equal(findingsListRes.status, 200);
    const findingsList = await findingsListRes.json();
    assert.equal(findingsList.total, 3);

    const resolveToldRes = await fetch(
      `${started.url}/api/campaigns/${campaign1.id}/findings/${insertedFindings[0].id}/resolve`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: FindingStatus.Told }),
      },
    );
    assert.equal(resolveToldRes.status, 200);
    assert.equal((await resolveToldRes.json()).status, FindingStatus.Told);

    const doubleResolveRes = await fetch(
      `${started.url}/api/campaigns/${campaign1.id}/findings/${insertedFindings[0].id}/resolve`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: FindingStatus.Dismissed }),
      },
    );
    assert.equal(doubleResolveRes.status, 409);

    const resolveDismissRes = await fetch(
      `${started.url}/api/campaigns/${campaign1.id}/findings/${insertedFindings[1].id}/resolve`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: FindingStatus.Dismissed }),
      },
    );
    assert.equal(resolveDismissRes.status, 200);

    const resolveRuledRes = await fetch(
      `${started.url}/api/campaigns/${campaign1.id}/findings/${insertedFindings[2].id}/resolve`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: FindingStatus.Ruled,
          replacementText: 'carries the iron cellar key',
        }),
      },
    );
    assert.equal(resolveRuledRes.status, 200);
    assert.equal((await resolveRuledRes.json()).status, FindingStatus.Ruled);

    const deleteLastRes = await fetch(`${started.url}/api/campaigns/${campaign1.id}/turns/last`, {
      method: 'DELETE',
      headers,
    });
    assert.equal(deleteLastRes.status, 200);
    const afterDeleteTurns = await fetch(`${started.url}/api/campaigns/${campaign1.id}/turns`);
    assert.equal((await afterDeleteTurns.json()).total, 0);

    const localSyncSaveRes = await fetch(`${started.url}/api/sync/save`, {
      method: 'POST',
      headers,
    });
    assert.equal(localSyncSaveRes.status, 200);
    assert.deepEqual(await localSyncSaveRes.json(), {
      status: 'local_only',
      saved: false,
      message: 'Cloud sync is not configured.',
    });
  });

  it('aborts in-flight SSE turn cleanly on client disconnect without committing orphan turns', async () => {
    const env = createTempEnvironment({ envApiKey: 'sk-abort-test-key' });
    const store = new SqliteStore(env.config.dbPath);

    let signalComposerStarted = null;
    const composerStartedPromise = new Promise((resolve) => {
      signalComposerStarted = resolve;
    });
    let observedAbortInClient = false;

    const { client } = createScriptedOpenRouterClient([
      {
        json: {
          sceneChanged: false,
          location: 'Study',
          day: 1,
          timeLabel: 'Night',
          sceneType: 'private',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 800,
          responders: [{ slug: 'lize', beatGoal: 'Answer.', length: 'short' }],
          narratorDirective: 'Keep steady.',
        },
      },
      {
        json: {
          internalThought: 'Wait.',
          physicalAction: 'Looks up.',
          spokenLines: 'Hang on.',
          tone: 'calm',
          knowledgeBoundaries: 'None.',
        },
      },
      ({ init }) => {
        signalComposerStarted();
        return new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            observedAbortInClient = true;
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          }, { once: true });
        });
      },
    ], { store });

    const server = await WorldsServer.create({
      config: env.config,
      store,
      client,
      publicDir: env.publicDir,
    });
    const started = await server.start();
    cleanups.push(async () => {
      await server.stop();
      store.close();
      fs.rmSync(env.tempRoot, { recursive: true, force: true });
    });

    const headers = {
      origin: started.url,
      'x-worlds-csrf': started.csrfToken,
      'content-type': 'application/json',
    };

    await fetch(`${started.url}/api/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        models: {
          director: 'openrouter/dir',
          composer: 'openrouter/comp',
          main: 'openrouter/main',
          recurring: 'openrouter/rec',
          scribe: 'openrouter/scribe',
        },
        publicOdds: 0,
        privateOdds: 0,
      }),
    });

    const camp = await (await fetch(`${started.url}/api/campaigns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Abort Check' }),
    })).json();
    const frost = await (await fetch(`${started.url}/api/campaigns/${camp.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'frost',
        name: 'Frost',
        isPlayer: true,
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Slate,
      }),
    })).json();
    const lize = await (await fetch(`${started.url}/api/campaigns/${camp.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'lize',
        name: 'Lize',
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Rose,
      }),
    })).json();
    await fetch(`${started.url}/api/campaigns/${camp.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sceneState: {
          ...camp.sceneState,
          location: 'Study',
          presentIds: [frost.id, lize.id],
        },
      }),
    });

    const clientAbortController = new AbortController();
    const turnResponse = await fetch(`${started.url}/api/campaigns/${camp.id}/turns`, {
      method: 'POST',
      headers,
      signal: clientAbortController.signal,
      body: JSON.stringify({ text: 'Stop mid-stream please.', mode: TurnMode.Normal }),
    });
    assert.equal(turnResponse.status, 200);
    const bodyReadPromise = turnResponse.text();

    await composerStartedPromise;
    clientAbortController.abort();

    await assert.rejects(bodyReadPromise, (error) => error.name === 'AbortError');
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(observedAbortInClient, true);
    assert.equal(server.router !== null, true);
    const turnsAfterAbort = await (await fetch(`${started.url}/api/campaigns/${camp.id}/turns`)).json();
    assert.equal(turnsAfterAbort.total, 0);

    const todayUtc = new Date().toISOString().slice(0, 10);
    const healthAfterAbort = await (await fetch(`${started.url}/api/health`)).json();
    assert.equal(healthAfterAbort.dailySpend.callCount, 2);
    assert.equal(store.getDailySpend(todayUtc).callCount, 2);
  });

  it('wires optional syncService seam into startup pull, health, POST /api/sync/save (200 & 409), and shutdown push', async () => {
    const env = createTempEnvironment({ envApiKey: 'sk-sync-seam-key' });
    const callLog = [];
    let nextPushMode = 'ok';
    let currentSyncStatus = { mode: 'r2', status: 'initializing' };

    const fakeSyncService = {
      getStatus() {
        return currentSyncStatus;
      },
      async pullOnStartup({ dbPath }) {
        callLog.push({ step: 'pullOnStartup', dbExistsBeforePull: fs.existsSync(dbPath) });
        currentSyncStatus = { mode: 'r2', status: 'synced', lastHead: 'head-1' };
        return currentSyncStatus;
      },
      async pushSnapshot({ store, signal }) {
        callLog.push({
          step: 'pushSnapshot',
          hasStore: store !== null,
          aborted: signal?.aborted ?? false,
        });
        if (nextPushMode === 'conflict') {
          currentSyncStatus = { mode: 'r2', status: 'conflict' };
          return { status: 'conflict', message: 'The other PC saved newer changes.' };
        }
        currentSyncStatus = { mode: 'r2', status: 'synced', head: 'head-2' };
        return { status: 'saved', head: 'head-2' };
      },
    };

    const server = await WorldsServer.create({
      config: env.config,
      syncService: fakeSyncService,
      publicDir: env.publicDir,
    });
    const started = await server.start();
    let stopped = false;
    cleanups.push(async () => {
      if (!stopped) {
        await server.stop();
      }
      fs.rmSync(env.tempRoot, { recursive: true, force: true });
    });

    assert.equal(callLog[0].step, 'pullOnStartup');
    assert.equal(callLog[0].dbExistsBeforePull, false);

    const healthJson = await (await fetch(`${started.url}/api/health`)).json();
    assert.deepEqual(healthJson.sync, { mode: 'r2', status: 'synced', lastHead: 'head-1' });

    const headers = {
      origin: started.url,
      'x-worlds-csrf': started.csrfToken,
      'content-type': 'application/json',
    };

    const saveOkRes = await fetch(`${started.url}/api/sync/save`, {
      method: 'POST',
      headers,
    });
    assert.equal(saveOkRes.status, 200);
    const saveOkJson = await saveOkRes.json();
    assert.equal(saveOkJson.saved, true);
    assert.equal(saveOkJson.head, 'head-2');

    nextPushMode = 'conflict';
    const saveConflictRes = await fetch(`${started.url}/api/sync/save`, {
      method: 'POST',
      headers,
    });
    assert.equal(saveConflictRes.status, 409);
    const conflictJson = await saveConflictRes.json();
    assert.equal(conflictJson.status, 'conflict');
    assert.equal(conflictJson.saved, false);

    nextPushMode = 'ok';
    await server.stop();
    await server.stop();
    stopped = true;
    const shutdownPushes = callLog.filter((entry) => entry.step === 'pushSnapshot');
    assert.equal(shutdownPushes.length, 3);
  });
});

describe('Task 6 adversarial review regressions', () => {
  const cleanups = [];

  after(async () => {
    for (const cleanupFn of cleanups) {
      await cleanupFn();
    }
  });

  it('rejects backslash URLs (400) and blocks /%2findex.html from leaking raw __CSRF_TOKEN__', async () => {
    const env = createTempEnvironment({ withPublicDir: true });
    fs.writeFileSync(
      path.join(env.publicDir, 'index.html'),
      '<!DOCTYPE html><html><head><meta name="worlds-csrf" content="__CSRF_TOKEN__"></head><body></body></html>\n',
      'utf8',
    );
    fs.writeFileSync(path.join(env.publicDir, 'styles.css'), 'body { margin: 0; }\n', 'utf8');

    assert.equal(Security.resolveStaticFile(env.publicDir, '/%2findex.html'), null);
    assert.equal(Security.resolveStaticFile(env.publicDir, '/%5cindex.html'), null);

    const store = new SqliteStore(env.config.dbPath);
    const { client } = createScriptedOpenRouterClient([], { store });
    const server = await WorldsServer.create({
      config: env.config,
      store,
      client,
      publicDir: env.publicDir,
    });
    const started = await server.start();
    cleanups.push(async () => {
      await server.stop();
      store.close();
      fs.rmSync(env.tempRoot, { recursive: true, force: true });
    });

    const homeRes = await fetch(`${started.url}/`);
    assert.equal(homeRes.status, 200);
    const homeHtml = await homeRes.text();
    assert.equal(homeHtml.includes('__CSRF_TOKEN__'), false);
    assert.equal(homeHtml.includes(started.csrfToken), true);

    const encodedSlashIndex = await sendRawHttpRequest({
      port: started.port,
      pathName: '/%2findex.html',
      headers: { Host: `127.0.0.1:${started.port}` },
    });
    assert.equal(encodedSlashIndex.statusCode, 404);
    assert.equal(encodedSlashIndex.bodyText.includes('__CSRF_TOKEN__'), false);

    const backslashReq = await sendRawHttpRequest({
      port: started.port,
      pathName: '/\\styles.css',
      headers: { Host: `127.0.0.1:${started.port}` },
    });
    assert.equal(backslashReq.statusCode, 400);
  });

  it('enforces per-campaign exclusive lock during memory/update and active LLM lock during memory/muse', async () => {
    const env = createTempEnvironment({ envApiKey: 'sk-lock-test-key' });
    const store = new SqliteStore(env.config.dbPath);

    let signalScribeWaiting = null;
    const scribeWaitingPromise = new Promise((resolve) => {
      signalScribeWaiting = resolve;
    });
    let releaseScribe = null;
    const scribeGatePromise = new Promise((resolve) => {
      releaseScribe = resolve;
    });

    let signalMuseWaiting = null;
    const museWaitingPromise = new Promise((resolve) => {
      signalMuseWaiting = resolve;
    });
    let releaseMuse = null;
    const museGatePromise = new Promise((resolve) => {
      releaseMuse = resolve;
    });

    const { client } = createScriptedOpenRouterClient([
      {
        json: {
          sceneChanged: false,
          location: 'Vault',
          day: 1,
          timeLabel: 'Noon',
          sceneType: 'public',
          userInputKind: 'player_in_scene',
          presentSlugs: ['frost', 'lize'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'focused_one',
          targetChars: 800,
          responders: [{ slug: 'lize', beatGoal: 'Reply.', length: 'short' }],
          narratorDirective: 'Keep brisk.',
        },
      },
      {
        json: {
          internalThought: 'Careful.',
          physicalAction: 'Nods.',
          spokenLines: 'Let us check the ledger.',
          tone: 'calm',
          knowledgeBoundaries: 'None.',
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:lize]]\n*Lize nodded.*\nLet us check the ledger.',
      },
      async () => {
        signalScribeWaiting();
        await scribeGatePromise;
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: [
                  '=== FACTS',
                  'Lize | trait | checks ledgers carefully | #2',
                  '=== THREADS',
                  'OPEN | Audit the vault | #2',
                ].join('\n'),
              },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 40, completion_tokens: 20, cost: 0.0005 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
      async () => {
        signalMuseWaiting();
        await museGatePromise;
        return new Response(
          JSON.stringify({
            choices: [{
              message: { content: 'LINE: Narrator: A courier arrives asking about the vault audit.' },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 30, completion_tokens: 15, cost: 0.0003 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    ], { store });

    const server = await WorldsServer.create({
      config: env.config,
      store,
      client,
      publicDir: env.publicDir,
    });
    const started = await server.start();
    cleanups.push(async () => {
      await server.stop();
      store.close();
      fs.rmSync(env.tempRoot, { recursive: true, force: true });
    });

    const headers = {
      origin: started.url,
      'x-worlds-csrf': started.csrfToken,
      'content-type': 'application/json',
    };

    await fetch(`${started.url}/api/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        models: {
          director: 'openrouter/dir',
          composer: 'openrouter/comp',
          main: 'openrouter/main',
          recurring: 'openrouter/rec',
          scribe: 'openrouter/scribe',
        },
        publicOdds: 0,
        privateOdds: 0,
        scribeInterval: 0,
        pedantEnabled: false,
      }),
    });

    const camp = await (await fetch(`${started.url}/api/campaigns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Lock Concurrency Check' }),
    })).json();
    const frost = await (await fetch(`${started.url}/api/campaigns/${camp.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'frost',
        name: 'Frost',
        isPlayer: true,
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Slate,
      }),
    })).json();
    const lize = await (await fetch(`${started.url}/api/campaigns/${camp.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'lize',
        name: 'Lize',
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Rose,
      }),
    })).json();
    await fetch(`${started.url}/api/campaigns/${camp.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sceneState: { ...camp.sceneState, location: 'Vault', presentIds: [frost.id, lize.id] },
      }),
    });

    const turnRes = await fetch(`${started.url}/api/campaigns/${camp.id}/turns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Check the ledger.', mode: TurnMode.Normal }),
    });
    const turnEvents = await readAllSseEvents(turnRes);
    const committedTurn = turnEvents.find((item) => item.event === 'done').data.assistantTurn;
    const [finding] = store.insertFindings(camp.id, committedTurn.id, [
      {
        kind: 'contradiction',
        subjectId: null,
        subjectName: 'Lize',
        speakerCharacterId: lize.id,
        factId: null,
        category: 'trait',
        bookText: 'trusts nobody',
        summary: 'Sample finding for lock check.',
        quote: 'check the ledger',
      },
    ]);

    const memUpdatePromise = fetch(`${started.url}/api/campaigns/${camp.id}/memory/update`, {
      method: 'POST',
      headers,
    });
    await scribeWaitingPromise;

    const busyDeleteTurn = await fetch(`${started.url}/api/campaigns/${camp.id}/turns/last`, {
      method: 'DELETE',
      headers,
    });
    assert.equal(busyDeleteTurn.status, 409);

    const busyResolveFinding = await fetch(
      `${started.url}/api/campaigns/${camp.id}/findings/${finding.id}/resolve`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: FindingStatus.Dismissed }),
      },
    );
    assert.equal(busyResolveFinding.status, 409);

    const busyTellPreview = await fetch(`${started.url}/api/campaigns/${camp.id}/memory/tell`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'preview', instruction: 'Test instruction.' }),
    });
    assert.equal(busyTellPreview.status, 409);

    const busyTellCommit = await fetch(`${started.url}/api/campaigns/${camp.id}/memory/tell`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'commit', operations: [] }),
    });
    assert.equal(busyTellCommit.status, 409);

    const busySecondUpdate = await fetch(`${started.url}/api/campaigns/${camp.id}/memory/update`, {
      method: 'POST',
      headers,
    });
    assert.equal(busySecondUpdate.status, 409);

    const busyDeleteDuringUpdate = await fetch(`${started.url}/api/campaigns/${camp.id}`, {
      method: 'DELETE',
      headers,
    });
    assert.equal(busyDeleteDuringUpdate.status, 409);

    releaseScribe();
    const completedUpdate = await memUpdatePromise;
    assert.equal(completedUpdate.status, 200);

    const badTellCommit = await fetch(`${started.url}/api/campaigns/${camp.id}/memory/tell`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'commit',
        operations: [
          {
            type: 'Fact',
            label: 'Nobody',
            category: 'trait',
            text: 'ghost fact',
            position: 999,
            target: null,
            hidden: false,
          },
        ],
      }),
    });
    assert.equal(badTellCommit.status, 400);

    const musePromise = fetch(`${started.url}/api/campaigns/${camp.id}/memory/muse`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    await museWaitingPromise;

    const busyDeleteDuringMuse = await fetch(`${started.url}/api/campaigns/${camp.id}`, {
      method: 'DELETE',
      headers,
    });
    assert.equal(busyDeleteDuringMuse.status, 409);

    releaseMuse();
    const completedMuse = await musePromise;
    assert.equal(completedMuse.status, 200);

    const deleteAfterMuse = await fetch(`${started.url}/api/campaigns/${camp.id}`, {
      method: 'DELETE',
      headers,
    });
    assert.equal(deleteAfterMuse.status, 200);
  });

  it('enforces single active player, archived player clearing, 60-char names, forbidden scribeSubjectId, and homonym separation', async () => {
    const env = createTempEnvironment({ envApiKey: 'sk-cast-invariants-key' });
    const store = new SqliteStore(env.config.dbPath);

    const { client } = createScriptedOpenRouterClient([
      {
        json: {
          sceneChanged: false,
          location: 'Dock',
          day: 1,
          timeLabel: 'Morning',
          sceneType: 'public',
          userInputKind: 'player_in_scene',
          presentSlugs: ['hero_one', 'rowan_one'],
          remoteSlugs: [],
          offscreenNotes: {},
          walkOnsEnter: [],
          walkOnsLeave: [],
          encounterAccepted: false,
          encounterBrief: '',
          pacing: 'narrator_only',
          targetChars: 800,
          responders: [],
          narratorDirective: 'Keep short.',
        },
      },
      {
        type: 'stream',
        text: '[[BEAT:narrator]]\nMorning mist rolled over the dock.',
      },
      {
        text: [
          '=== FACTS',
          'Rowan | trait | speaks softly | #2',
        ].join('\n'),
      },
    ], { store });

    const server = await WorldsServer.create({
      config: env.config,
      store,
      client,
      publicDir: env.publicDir,
    });
    const started = await server.start();
    cleanups.push(async () => {
      await server.stop();
      store.close();
      fs.rmSync(env.tempRoot, { recursive: true, force: true });
    });

    const headers = {
      origin: started.url,
      'x-worlds-csrf': started.csrfToken,
      'content-type': 'application/json',
    };

    await fetch(`${started.url}/api/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        models: {
          director: 'openrouter/dir',
          composer: 'openrouter/comp',
          main: 'openrouter/main',
          recurring: 'openrouter/rec',
          scribe: 'openrouter/scribe',
        },
        publicOdds: 0,
        privateOdds: 0,
        scribeInterval: 0,
        pedantEnabled: false,
      }),
    });

    const camp = await (await fetch(`${started.url}/api/campaigns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Cast Invariants' }),
    })).json();

    const rejectedSubjectIdCreate = await fetch(`${started.url}/api/campaigns/${camp.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'bad_subj',
        name: 'Bad Subj',
        scribeSubjectId: 'S99',
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Slate,
      }),
    });
    assert.equal(rejectedSubjectIdCreate.status, 400);

    const rejectedLongNameCreate = await fetch(`${started.url}/api/campaigns/${camp.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'too_long',
        name: 'A'.repeat(61),
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Slate,
      }),
    });
    assert.equal(rejectedLongNameCreate.status, 400);

    const rejectedArchivedPlayerCreate = await fetch(`${started.url}/api/campaigns/${camp.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'arch_player',
        name: 'Archived Player',
        isPlayer: true,
        archived: true,
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Slate,
      }),
    });
    assert.equal(rejectedArchivedPlayerCreate.status, 400);

    const heroOne = await (await fetch(`${started.url}/api/campaigns/${camp.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'hero_one',
        name: 'Hero One',
        isPlayer: true,
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Slate,
      }),
    })).json();
    assert.equal(heroOne.isPlayer, true);
    assert.equal(store.getCampaign(camp.id).playerCharacterId, heroOne.id);

    const rejectedSubjectIdPatch = await fetch(`${started.url}/api/campaigns/${camp.id}/characters/${heroOne.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ scribeSubjectId: 'S42' }),
    });
    assert.equal(rejectedSubjectIdPatch.status, 400);

    const rejectedLongNamePatch = await fetch(`${started.url}/api/campaigns/${camp.id}/characters/${heroOne.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'B'.repeat(61) }),
    });
    assert.equal(rejectedLongNamePatch.status, 400);

    const heroTwo = await (await fetch(`${started.url}/api/campaigns/${camp.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'hero_two',
        name: 'Hero Two',
        isPlayer: true,
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Rose,
      }),
    })).json();
    assert.equal(heroTwo.isPlayer, true);
    assert.equal(store.getCharacter(camp.id, heroOne.id).isPlayer, false);
    assert.equal(store.getCampaign(camp.id).playerCharacterId, heroTwo.id);

    const archivedHeroTwo = await (await fetch(`${started.url}/api/campaigns/${camp.id}/characters/${heroTwo.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ archived: true }),
    })).json();
    assert.equal(archivedHeroTwo.archived, true);
    assert.equal(archivedHeroTwo.isPlayer, false);
    assert.equal(store.getCampaign(camp.id).playerCharacterId, null);

    const promoteArchivedFail = await fetch(`${started.url}/api/campaigns/${camp.id}/characters/${heroTwo.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ isPlayer: true }),
    });
    assert.equal(promoteArchivedFail.status, 400);

    await fetch(`${started.url}/api/campaigns/${camp.id}/characters/${heroOne.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ isPlayer: true }),
    });
    assert.equal(store.getCampaign(camp.id).playerCharacterId, heroOne.id);

    const setArchivedPlayerFail = await fetch(`${started.url}/api/campaigns/${camp.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ playerCharacterId: heroTwo.id }),
    });
    assert.equal(setArchivedPlayerFail.status, 400);
    assert.equal(store.getCharacter(camp.id, heroOne.id).isPlayer, true);
    assert.equal(store.getCampaign(camp.id).playerCharacterId, heroOne.id);

    const heroThree = await (await fetch(`${started.url}/api/campaigns/${camp.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'hero_three',
        name: 'Hero Three',
        isPlayer: false,
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Teal,
      }),
    })).json();

    const switchPlayerViaCamp = await fetch(`${started.url}/api/campaigns/${camp.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ playerCharacterId: heroThree.id }),
    });
    assert.equal(switchPlayerViaCamp.status, 200);
    assert.equal((await switchPlayerViaCamp.json()).playerCharacterId, heroThree.id);
    assert.equal(store.getCharacter(camp.id, heroOne.id).isPlayer, false);
    assert.equal(store.getCharacter(camp.id, heroThree.id).isPlayer, true);

    const clearPlayerViaCamp = await fetch(`${started.url}/api/campaigns/${camp.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ playerCharacterId: null }),
    });
    assert.equal(clearPlayerViaCamp.status, 200);
    assert.equal((await clearPlayerViaCamp.json()).playerCharacterId, null);
    assert.equal(store.getCharacter(camp.id, heroThree.id).isPlayer, false);

    const restoreHeroOneViaCamp = await fetch(`${started.url}/api/campaigns/${camp.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ playerCharacterId: heroOne.id }),
    });
    assert.equal(restoreHeroOneViaCamp.status, 200);
    assert.equal(store.getCharacter(camp.id, heroOne.id).isPlayer, true);

    const rowanOne = await (await fetch(`${started.url}/api/campaigns/${camp.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'rowan_one',
        name: 'Rowan',
        tier: CharacterTier.Main,
        avatarToken: AvatarToken.Amber,
      }),
    })).json();

    await fetch(`${started.url}/api/campaigns/${camp.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sceneState: { ...camp.sceneState, location: 'Dock', presentIds: [heroOne.id, rowanOne.id] },
      }),
    });

    const turnRes = await fetch(`${started.url}/api/campaigns/${camp.id}/turns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Look around the dock.', mode: TurnMode.Normal }),
    });
    await readAllSseEvents(turnRes);

    const updateRes = await fetch(`${started.url}/api/campaigns/${camp.id}/memory/update`, {
      method: 'POST',
      headers,
    });
    assert.equal(updateRes.status, 200);

    const rowanOneAfterUpdate = store.getCharacter(camp.id, rowanOne.id);
    assert.ok(typeof rowanOneAfterUpdate.scribeSubjectId === 'string');

    const rowanTwoRes = await fetch(`${started.url}/api/campaigns/${camp.id}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'rowan_two',
        name: 'Rowan',
        tier: CharacterTier.Recurring,
        avatarToken: AvatarToken.Teal,
      }),
    });
    assert.equal(rowanTwoRes.status, 201);
    const rowanTwo = await rowanTwoRes.json();
    assert.ok(typeof rowanTwo.scribeSubjectId === 'string');
    assert.notEqual(rowanTwo.scribeSubjectId, rowanOneAfterUpdate.scribeSubjectId);

    const directLog = JSON.parse(store.getScribeBook(camp.id).bookJson);
    assert.equal(store.getCharacter(camp.id, rowanOne.id).scribeSubjectId, rowanOneAfterUpdate.scribeSubjectId);
    assert.ok(directLog.nextSubject >= 4);

    const directState = ScribeReplay.run(directLog, [], null, new Map(), null, null, []);
    const directSyncHomonym = ScribeLogCore.syncCharacterSubject(directLog, directState, {
      name: 'Rowan',
      excludeSubjectIds: new Set([rowanOneAfterUpdate.scribeSubjectId, rowanTwo.scribeSubjectId]),
    });
    assert.notEqual(directSyncHomonym.subjectId, rowanOneAfterUpdate.scribeSubjectId);
    assert.notEqual(directSyncHomonym.subjectId, rowanTwo.scribeSubjectId);
  });

  it('closes owned SqliteStore cleanly in finally on stop() errors and failed start() cleanup', async () => {
    const env = createTempEnvironment({ envApiKey: 'sk-cleanup-key' });
    const blockerServer = http.createServer();
    await new Promise((resolve) => blockerServer.listen(0, '127.0.0.1', resolve));
    const occupiedPort = blockerServer.address().port;

    const failedStartServer = await WorldsServer.create({
      config: { ...env.config, port: occupiedPort },
      publicDir: env.publicDir,
    });

    try {
      await assert.rejects(() => failedStartServer.start());
      await failedStartServer.stop();
      assert.throws(() => failedStartServer.store.getSettings(), /not open/i);
    } finally {
      await new Promise((resolve) => blockerServer.close(resolve));
    }

    const envPushErr = createTempEnvironment({ envApiKey: 'sk-cleanup-push-key' });
    const failingSyncService = {
      async pullOnStartup() {
        return { status: 'local' };
      },
      async pushSnapshot() {
        throw new Error('Simulated R2 outage on shutdown.');
      },
    };
    const pushFailServer = await WorldsServer.create({
      config: envPushErr.config,
      syncService: failingSyncService,
      publicDir: envPushErr.publicDir,
    });
    await pushFailServer.start();

    try {
      await assert.rejects(() => pushFailServer.stop(), /Simulated R2 outage on shutdown/);
      assert.throws(() => pushFailServer.store.getSettings(), /not open/i);
      await assert.rejects(() => pushFailServer.stop(), /Simulated R2 outage on shutdown/);
    } finally {
      fs.rmSync(env.tempRoot, { recursive: true, force: true });
      fs.rmSync(envPushErr.tempRoot, { recursive: true, force: true });
    }
  });
});
