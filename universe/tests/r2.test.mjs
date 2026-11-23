import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import { createTransport, readCredentials } from '../src/r2.mjs';
import { CloudStore } from '../src/sync/CloudStore.mjs';

const secret = 'synthetic-secret';
const host = 'https://testaccount.r2.cloudflarestorage.com/test-bucket';
const blobsPrefix = '_universe/v2/blobs/';
const emptyHash = createHash('sha256').update('').digest('hex');
const originalFetch = globalThis.fetch;
const sent = [];
let answers = [];

/**
 * @returns {Function}
 * @throws {Error}
 */
function transport() {
  return createTransport(readCredentials({
    R2_ACCOUNT_ID: 'testaccount', R2_ACCESS_KEY_ID: 'testkey', R2_SECRET_ACCESS_KEY: secret, R2_BUCKET: 'test-bucket',
  }));
}

/**
 * @param {Buffer | string} key
 * @param {string} value
 * @returns {Buffer}
 */
function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

/**
 * @param {{url: string, init: object}} request
 * @returns {void}
 * @throws {Error}
 */
function assertSignedAsSent(request) {
  const [address, query = ''] = request.url.split('?');
  const headers = request.init.headers;
  const signedNames = /SignedHeaders=([^,]+),/.exec(headers.authorization)[1].split(';');
  const canonical = [
    request.init.method, new URL(address).pathname, query, signedNames.map((name) => `${name}:${headers[name]}\n`).join(''),
    signedNames.join(';'), headers['x-amz-content-sha256'],
  ].join('\n');
  const day = headers['x-amz-date'].slice(0, 8);
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), 'auto'), 's3'), 'aws4_request');
  const expected = hmac(signingKey, `AWS4-HMAC-SHA256\n${headers['x-amz-date']}\n${day}/auto/s3/aws4_request\n` +
    `${createHash('sha256').update(canonical).digest('hex')}`).toString('hex');
  assert.equal(/Signature=([0-9a-f]{64})$/.exec(headers.authorization)[1], expected, request.url);
}

beforeEach(() => {
  sent.length = 0;
  answers = [];
  /**
   * @param {string} url
   * @param {object} init
   * @returns {Promise<Response>}
   */
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init });
    return answers.shift() ?? new Response('', { headers: { date: new Date().toUTCString() } });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('a paged listing sorts its query by name, encodes every value by RFC 3986 and signs exactly the query it sends', async () => {
  const send = transport();
  await send('GET', '', { list: true, prefix: blobsPrefix });
  await send('GET', '', { list: true, prefix: blobsPrefix, token: "1a+b/c=d!e'f(g)h*i j~k&l" });
  assert.deepEqual(sent.map((request) => request.url), [
    `${host}?list-type=2&prefix=_universe%2Fv2%2Fblobs%2F`,
    `${host}?continuation-token=1a%2Bb%2Fc%3Dd%21e%27f%28g%29h%2Ai%20j~k%26l&list-type=2&prefix=_universe%2Fv2%2Fblobs%2F`,
  ]);
  for (const request of sent) {
    assert.equal(request.init.method, 'GET');
    assert.equal(request.init.body, undefined);
    assertSignedAsSent(request);
  }
});

test('listObjects sends the token of each page, decoded from the XML, on the next request', async () => {
  const headers = { date: new Date().toUTCString() };
  answers = [
    new Response('<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
      `<IsTruncated>true</IsTruncated><Contents><Key>${blobsPrefix}one</Key><LastModified>2026-11-20T10:00:00.000Z</LastModified></Contents>` +
      '<NextContinuationToken>tok+en/with=&amp;</NextContinuationToken></ListBucketResult>', { headers }),
    new Response('<ListBucketResult><IsTruncated>false</IsTruncated>' +
      `<Contents><Key>${blobsPrefix}two</Key><LastModified>2026-11-21T10:00:00Z</LastModified></Contents></ListBucketResult>`, { headers }),
  ];
  const listed = await new CloudStore(transport()).listObjects(blobsPrefix);
  assert.deepEqual(listed, [
    { key: `${blobsPrefix}one`, lastModified: Date.parse('2026-11-20T10:00:00.000Z') },
    { key: `${blobsPrefix}two`, lastModified: Date.parse('2026-11-21T10:00:00Z') },
  ]);
  assert.deepEqual(sent.map((request) => request.url), [
    `${host}?list-type=2&prefix=_universe%2Fv2%2Fblobs%2F`,
    `${host}?continuation-token=tok%2Ben%2Fwith%3D%26&list-type=2&prefix=_universe%2Fv2%2Fblobs%2F`,
  ]);
  sent.forEach(assertSignedAsSent);
});

test('the hasForeignObjects folder listing keeps its query byte for byte', async () => {
  answers = [new Response('<ListBucketResult></ListBucketResult>', { headers: { date: new Date().toUTCString() } })];
  assert.equal(await new CloudStore(transport()).hasForeignObjects(), false);
  assert.deepEqual(sent.map((request) => request.url), [`${host}?delimiter=%2F&list-type=2&max-keys=2`]);
  assertSignedAsSent(sent[0]);
  await transport()('GET', '', { list: true, folders: true });
  assert.equal(sent[1].url, `${host}?delimiter=%2F&list-type=2&max-keys=2`);
});

test('DELETE goes out without a body or a condition, signed over the empty payload', async () => {
  const key = `${blobsPrefix}${'c'.repeat(64)}`;
  answers = [new Response(null, { status: 204, headers: { date: new Date().toUTCString() } })];
  await new CloudStore(transport()).deleteObject(key);
  await transport()('DELETE', key);
  for (const request of sent) {
    assert.equal(request.url, `${host}/${key}`);
    assert.equal(request.init.method, 'DELETE');
    assert.equal(request.init.body, undefined);
    assert.equal(request.init.headers['x-amz-content-sha256'], emptyHash);
    assert.deepEqual(Object.keys(request.init.headers).sort(), ['authorization', 'host', 'x-amz-content-sha256', 'x-amz-date']);
    assertSignedAsSent(request);
  }
  assert.equal(sent.length, 2);
});
