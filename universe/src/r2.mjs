import { createHash, createHmac } from 'node:crypto';

export const credentialNames = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{account: string, accessKey: string, secret: string, bucket: string} | null}
 * @throws {Error}
 */
export function readCredentials(env) {
  const values = credentialNames.map((name) => env[name]);
  if (values.every((value) => value === undefined)) {
    return null;
  }
  const [account, accessKey, secret, bucket] = values;
  if (!account || !accessKey || !secret || !bucket || !/^[a-z0-9-]+$/i.test(account) ||
      !/^[a-z0-9][a-z0-9-]*$/.test(bucket) || !/^[a-z0-9]+$/i.test(accessKey) || /\s/.test(secret)) {
    throw new Error('Set all four valid R2 variables together or unset all four.');
  }
  return { account, accessKey, secret, bucket };
}

/**
 * @param {Buffer | string} bytes
 * @returns {string}
 */
export function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {Buffer | string} key
 * @param {string} value
 * @returns {Buffer}
 */
function sign(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

/**
 * @param {ReturnType<typeof readCredentials>} config
 * @returns {Function}
 * @throws {TypeError}
 */
export function createTransport(config) {
  const host = `${config.account}.r2.cloudflarestorage.com`;
  /**
   * @param {string} method
   * @param {string} key
   * @param {{body?: Buffer | string, match?: string, absent?: boolean, list?: boolean, folders?: boolean, prefix?: string, token?: string, timeoutMs?: number, bodyTimeoutMs?: Function, signal?: AbortSignal}} options
   * @returns {Promise<Response>}
   * @throws {Error}
   */
  return async (method, key, {
    body = '', match, absent, list = false, folders = false, prefix, token, timeoutMs = 15_000, bodyTimeoutMs, signal,
  } = {}) => {
    const path = `/${config.bucket}${key ? `/${key}` : ''}`;
    const parameters = !list ? {} : folders ? { delimiter: '/', 'list-type': '2', 'max-keys': '2' } :
      prefix === undefined ? { 'list-type': '2', 'max-keys': '1' } : { 'continuation-token': token, 'list-type': '2', prefix };
    const query = Object.keys(parameters).filter((name) => parameters[name] !== undefined).sort()
      .map((name) => `${name}=${encodeURIComponent(parameters[name]).replace(/[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`)
      .join('&');
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const payloadHash = digest(body);
    const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    if (match !== undefined) {
      headers['if-match'] = match;
    }
    if (absent) {
      headers['if-none-match'] = '*';
    }
    const names = Object.keys(headers).sort();
    const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
    const signedHeaders = names.join(';');
    const canonical = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${date}/auto/s3/aws4_request`;
    const signingKey = sign(sign(sign(sign(`AWS4${config.secret}`, date), 'auto'), 's3'), 'aws4_request');
    const signature = sign(signingKey, `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${digest(canonical)}`).toString('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const url = `https://${host}${path}${query ? `?${query}` : ''}`;
    const request = {
      method,
      headers: method === 'GET' ? { ...headers, 'accept-encoding': 'identity' } : headers,
      body: method === 'PUT' ? body : undefined,
      redirect: 'error',
    };
    const timeout = AbortSignal.timeout(timeoutMs);
    if (bodyTimeoutMs === undefined) {
      return fetch(url, { ...request, signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) });
    }
    const phase = new AbortController();
    /**
     * @returns {void}
     */
    const stopWaiting = () => phase.abort(timeout.reason);
    timeout.addEventListener('abort', stopWaiting, { once: true });
    try {
      const response = await fetch(url, { ...request, signal: signal === undefined ? phase.signal : AbortSignal.any([signal, phase.signal]) });
      const bodyTimeout = AbortSignal.timeout(bodyTimeoutMs(response.headers.get('content-length')));
      bodyTimeout.addEventListener('abort', () => phase.abort(bodyTimeout.reason), { once: true });
      return response;
    } finally {
      timeout.removeEventListener('abort', stopWaiting);
    }
  };
}
