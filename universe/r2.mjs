import { createHash, createHmac } from 'node:crypto';

export const credentialNames = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{account: string, accessKey: string, secret: string, bucket: string} | null}
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
 */
export function createTransport(config) {
  const host = `${config.account}.r2.cloudflarestorage.com`;
  return (method, key, { body = '', match, absent, list = false } = {}) => {
    const path = `/${config.bucket}${key ? `/${key}` : ''}`;
    const query = list ? 'list-type=2&max-keys=1' : '';
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
    return fetch(`https://${host}${path}${query ? `?${query}` : ''}`, {
      method,
      headers: method === 'GET' ? { ...headers, 'accept-encoding': 'identity' } : headers,
      body: method === 'PUT' ? body : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  };
}
