import { createHash, createHmac } from 'node:crypto';

const STRONG_ETAG_REGEX = /^"[\x21\x23-\x7e\x80-\xff]*"$/;
const DEFAULT_TIMEOUT_MS = 15_000;
const OBJECT_TIMEOUT_MS = 120_000;
const UNKNOWN_SIZE_TIMEOUT_MS = 60_000;
const OBJECT_BYTES_PER_SECOND = 25_000;
const MAX_TIMER_MS = 600_000;

export class R2Transport {
  #account;
  #accessKey;
  #secret;
  #bucket;
  #host;
  #fetch;
  #defaultTimeoutMs;

  /**
   * @param {{account: string, accessKey: string, secret: string, bucket: string}} credentials
   * @param {{fetchImpl?: Function, timeoutMs?: number}} options
   * @throws {Error}
   */
  constructor(credentials, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (credentials === null || typeof credentials !== 'object') {
      throw new Error('R2Transport requires a valid credentials object.');
    }
    const { account, accessKey, secret, bucket } = credentials;
    if (typeof account !== 'string' || !/^[a-z0-9-]+$/i.test(account)) {
      throw new Error('R2Transport credentials.account must be a valid alphanumeric/hyphen account id.');
    }
    if (typeof accessKey !== 'string' || !/^[a-z0-9]+$/i.test(accessKey)) {
      throw new Error('R2Transport credentials.accessKey must be a valid alphanumeric key.');
    }
    if (typeof secret !== 'string' || secret.length === 0 || /\s/.test(secret)) {
      throw new Error('R2Transport credentials.secret must be a non-empty string without whitespace.');
    }
    if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(bucket)) {
      throw new Error('R2Transport credentials.bucket must be a valid bucket name.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('R2Transport options.fetchImpl must be a function.');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('R2Transport options.timeoutMs must be a positive finite number.');
    }
    this.#account = account;
    this.#accessKey = accessKey;
    this.#secret = secret;
    this.#bucket = bucket;
    this.#host = `${account}.r2.cloudflarestorage.com`;
    this.#fetch = fetchImpl;
    this.#defaultTimeoutMs = Math.min(Math.ceil(timeoutMs), MAX_TIMER_MS);
  }

  /**
   * @returns {string}
   */
  get bucket() {
    return this.#bucket;
  }

  /**
   * @param {Buffer | string} bytes
   * @returns {string}
   */
  static digest(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
  }

  /**
   * @param {unknown} etag
   * @returns {boolean}
   */
  static isStrongEtag(etag) {
    return typeof etag === 'string' && STRONG_ETAG_REGEX.test(etag);
  }

  /**
   * @param {{allowedPrefix?: string, timeoutMs?: number, signal?: AbortSignal}} options
   * @returns {Promise<boolean>}
   * @throws {Error}
   */
  async hasForeignObjects({ allowedPrefix = '_worlds/', timeoutMs = this.#defaultTimeoutMs, signal } = {}) {
    if (typeof allowedPrefix !== 'string' || allowedPrefix.length === 0 || !allowedPrefix.endsWith('/')) {
      throw new Error('allowedPrefix must be a non-empty trailing-slash prefix.');
    }
    const opened = await this.#openResponse('GET', '', {
      queryParams: {
        delimiter: '/',
        'list-type': '2',
        'max-keys': '5',
      },
      timeoutMs,
      signal,
    });
    const text = await this.#readTextResponse(opened, 'R2 root bucket listing');
    if (!/^\s*(?:<\?xml[^>]*\?>\s*)?<ListBucketResult(?:\s[^>]*)?>[\s\S]*<\/ListBucketResult>\s*$/.test(text)) {
      throw new Error('Cloud bucket root listing was not a valid ListBucketResult XML response.');
    }
    if (/<Contents>/.test(text)) {
      return true;
    }
    const truncatedMatch = /<IsTruncated>(true|false)<\/IsTruncated>/.exec(text);
    if (truncatedMatch !== null && truncatedMatch[1] === 'true') {
      return true;
    }
    for (const prefixMatch of text.matchAll(/<CommonPrefixes>\s*<Prefix>([^<]*)<\/Prefix>\s*<\/CommonPrefixes>/g)) {
      const folderName = this.#decodeXmlText(prefixMatch[1]);
      if (folderName !== allowedPrefix) {
        return true;
      }
    }
    return false;
  }

  /**
   * @param {{prefix: string, timeoutMs?: number, signal?: AbortSignal}} options
   * @returns {Promise<Array<{key: string, lastModified: number, size: ?number, etag: ?string}>>}
   * @throws {Error}
   */
  async listObjects({ prefix, timeoutMs = this.#defaultTimeoutMs, signal } = {}) {
    if (typeof prefix !== 'string' || prefix.length === 0) {
      throw new Error('listObjects requires a non-empty prefix string.');
    }
    const entries = [];
    const seenTokens = new Set();
    let continuationToken;
    do {
      const opened = await this.#openResponse('GET', '', {
        queryParams: {
          'continuation-token': continuationToken,
          'list-type': '2',
          prefix,
        },
        timeoutMs,
        signal,
      });
      const text = await this.#readTextResponse(opened, `R2 listing of ${prefix}`);
      const truncatedMatch = /<IsTruncated>(true|false)<\/IsTruncated>/.exec(text);
      if (!/^\s*(?:<\?xml[^>]*\?>\s*)?<ListBucketResult(?:\s[^>]*)?>[\s\S]*<\/ListBucketResult>\s*$/.test(text) || truncatedMatch === null) {
        throw new Error(`Cloud listing of ${prefix} was not a valid ListBucketResult XML response.`);
      }
      for (const contentMatch of text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const block = contentMatch[1];
        const keyMatch = /<Key>([^<]+)<\/Key>/.exec(block);
        const modifiedMatch = /<LastModified>(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)<\/LastModified>/.exec(block);
        const lastModified = modifiedMatch === null ? Number.NaN : Date.parse(modifiedMatch[1]);
        if (keyMatch === null || !Number.isFinite(lastModified)) {
          throw new Error(`Cloud listing of ${prefix} contains an entry without a valid Key or LastModified.`);
        }
        const sizeMatch = /<Size>(\d+)<\/Size>/.exec(block);
        const etagMatch = /<ETag>([^<]+)<\/ETag>/.exec(block);
        const parsedSize = sizeMatch === null ? null : Number(sizeMatch[1]);
        entries.push({
          key: this.#decodeXmlText(keyMatch[1]),
          lastModified,
          size: parsedSize !== null && Number.isSafeInteger(parsedSize) ? parsedSize : null,
          etag: etagMatch === null ? null : this.#decodeXmlText(etagMatch[1]),
        });
      }
      if (truncatedMatch[1] === 'true') {
        const nextMatch = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(text);
        if (nextMatch === null) {
          throw new Error(`Cloud listing of ${prefix} is truncated without a NextContinuationToken.`);
        }
        const nextToken = this.#decodeXmlText(nextMatch[1]);
        if (seenTokens.has(nextToken)) {
          throw new Error(`Cloud listing of ${prefix} repeated continuation token.`);
        }
        seenTokens.add(nextToken);
        continuationToken = nextToken;
      } else {
        continuationToken = undefined;
      }
    } while (continuationToken !== undefined);
    return entries;
  }

  /**
   * @param {string} key
   * @param {{timeoutMs?: number, signal?: AbortSignal}} options
   * @returns {Promise<{exists: boolean, status: number, body: ?Buffer, etag: ?string, lastModified: ?number, date: ?number}>}
   * @throws {Error}
   */
  async getObject(key, { timeoutMs = this.#defaultTimeoutMs, signal } = {}) {
    this.#assertValidKey(key);
    const { response, cleanup, phaseController } = await this.#openResponse('GET', key, {
      timeoutMs,
      signal,
    });
    try {
      const serverDateHeader = response.headers.get('date');
      const parsedDate = serverDateHeader === null ? Number.NaN : Date.parse(serverDateHeader);
      const serverDate = Number.isFinite(parsedDate) ? parsedDate : null;
      if (response.status === 404) {
        await this.#discardBody(response);
        return {
          exists: false,
          status: 404,
          body: null,
          etag: null,
          lastModified: null,
          date: serverDate,
        };
      }
      if (!response.ok) {
        await this.#discardBody(response);
        throw this.#httpError(`Cloud read of ${key}`, response.status);
      }
      const etag = response.headers.get('etag');
      const lastModifiedHeader = response.headers.get('last-modified');
      const parsedLastModified = lastModifiedHeader === null ? Number.NaN : Date.parse(lastModifiedHeader);
      const lastModified = Number.isFinite(parsedLastModified) ? parsedLastModified : null;
      const bodyBuffer = await this.#readBufferWithBodyTimeout(response, phaseController);
      return {
        exists: true,
        status: response.status,
        body: bodyBuffer,
        etag,
        lastModified,
        date: serverDate,
      };
    } finally {
      cleanup();
    }
  }

  /**
   * @param {string} key
   * @param {Buffer | string} body
   * @param {{contentType?: string, ifMatch?: string, ifNoneMatch?: string, timeoutMs?: number, signal?: AbortSignal}} options
   * @returns {Promise<{ok: boolean, status: number, preconditionFailed: boolean, etag: ?string, date: ?number}>}
   * @throws {Error}
   */
  async putObject(key, body, { contentType, ifMatch, ifNoneMatch, timeoutMs, signal } = {}) {
    this.#assertValidKey(key);
    const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    const sizedTimeoutMs = timeoutMs !== undefined
      ? timeoutMs
      : Math.min(OBJECT_TIMEOUT_MS + Math.ceil(bodyBuffer.length / OBJECT_BYTES_PER_SECOND) * 1000, MAX_TIMER_MS);
    const { response, cleanup } = await this.#openResponse('PUT', key, {
      body: bodyBuffer,
      contentType,
      ifMatch,
      ifNoneMatch,
      timeoutMs: sizedTimeoutMs,
      signal,
    });
    try {
      const serverDateHeader = response.headers.get('date');
      const parsedDate = serverDateHeader === null ? Number.NaN : Date.parse(serverDateHeader);
      const serverDate = Number.isFinite(parsedDate) ? parsedDate : null;
      await this.#discardBody(response);
      if (response.status === 412 || response.status === 409) {
        return {
          ok: false,
          status: response.status,
          preconditionFailed: true,
          etag: null,
          date: serverDate,
        };
      }
      if (!response.ok) {
        throw this.#httpError(`Cloud upload of ${key}`, response.status);
      }
      return {
        ok: true,
        status: response.status,
        preconditionFailed: false,
        etag: response.headers.get('etag'),
        date: serverDate,
      };
    } finally {
      cleanup();
    }
  }

  /**
   * @param {string} key
   * @param {{timeoutMs?: number, signal?: AbortSignal}} options
   * @returns {Promise<{deleted: boolean, status: number}>}
   * @throws {Error}
   */
  async deleteObject(key, { timeoutMs = this.#defaultTimeoutMs, signal } = {}) {
    this.#assertValidKey(key);
    const { response, cleanup } = await this.#openResponse('DELETE', key, {
      timeoutMs,
      signal,
    });
    try {
      await this.#discardBody(response);
      if (response.status === 404) {
        return { deleted: false, status: 404 };
      }
      if (response.status !== 200 && response.status !== 204) {
        throw this.#httpError(`Cloud delete of ${key}`, response.status);
      }
      return { deleted: true, status: response.status };
    } finally {
      cleanup();
    }
  }

  /**
   * @param {string} key
   * @returns {void}
   * @throws {Error}
   */
  #assertValidKey(key) {
    if (typeof key !== 'string' || key.length === 0 || key.startsWith('/')) {
      throw new Error(`Invalid R2 object key: ${JSON.stringify(key)}`);
    }
  }

  /**
   * @param {string} action
   * @param {number} status
   * @returns {Error}
   */
  #httpError(action, status) {
    const error = new Error(`${action} failed (HTTP ${status}).`);
    error.statusCode = status;
    return error;
  }

  /**
   * @param {string} value
   * @returns {string}
   */
  #encodeRfc3986(value) {
    return encodeURIComponent(value).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  /**
   * @param {string} raw
   * @returns {string}
   * @throws {Error}
   */
  #decodeXmlText(raw) {
    if (/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/.test(raw)) {
      throw new Error(`Cloud listing holds malformed XML text: ${JSON.stringify(raw)}`);
    }
    const namedEntities = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&apos;': "'",
    };
    return raw.replace(/&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g, (entity) => {
      if (Object.hasOwn(namedEntities, entity)) {
        return namedEntities[entity];
      }
      const codePoint = entity.startsWith('&#x')
        ? Number.parseInt(entity.slice(3, -1), 16)
        : Number.parseInt(entity.slice(2, -1), 10);
      if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        throw new Error(`Cloud listing holds out-of-range XML entity: ${entity}`);
      }
      return String.fromCodePoint(codePoint);
    });
  }

  /**
   * @param {Buffer | string} signingKey
   * @param {string} payload
   * @returns {Buffer}
   */
  #hmacSha256(signingKey, payload) {
    return createHmac('sha256', signingKey).update(payload).digest();
  }

  /**
   * @param {string} method
   * @param {string} key
   * @param {{body?: Buffer | string, contentType?: string, queryParams?: object, ifMatch?: string, ifNoneMatch?: string, timeoutMs?: number, signal?: AbortSignal}} options
   * @returns {Promise<{response: Response, cleanup: Function, phaseController: AbortController}>}
   * @throws {Error}
   */
  async #openResponse(method, key, {
    body = '',
    contentType,
    queryParams = {},
    ifMatch,
    ifNoneMatch,
    timeoutMs = this.#defaultTimeoutMs,
    signal,
  } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('timeoutMs must be a positive finite number.');
    }
    const encodedKey = key.length === 0
      ? ''
      : key.split('/').map((segment) => this.#encodeRfc3986(segment)).join('/');
    const canonicalUri = `/${this.#bucket}${encodedKey ? `/${encodedKey}` : ''}`;
    const canonicalQuery = Object.keys(queryParams)
      .filter((paramName) => queryParams[paramName] !== undefined)
      .sort()
      .map((paramName) => `${this.#encodeRfc3986(paramName)}=${this.#encodeRfc3986(String(queryParams[paramName]))}`)
      .join('&');
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const shortDate = amzDate.slice(0, 8);
    const payloadHash = R2Transport.digest(body);
    const headers = {
      host: this.#host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (contentType !== undefined) {
      headers['content-type'] = contentType;
    }
    if (ifMatch !== undefined) {
      headers['if-match'] = ifMatch;
    }
    if (ifNoneMatch !== undefined) {
      headers['if-none-match'] = ifNoneMatch;
    }
    const sortedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
    const signedHeaders = sortedHeaderNames.join(';');
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const credentialScope = `${shortDate}/auto/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      R2Transport.digest(canonicalRequest),
    ].join('\n');
    const dateKey = this.#hmacSha256(`AWS4${this.#secret}`, shortDate);
    const regionKey = this.#hmacSha256(dateKey, 'auto');
    const serviceKey = this.#hmacSha256(regionKey, 's3');
    const signingKey = this.#hmacSha256(serviceKey, 'aws4_request');
    const signature = this.#hmacSha256(signingKey, stringToSign).toString('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.#accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const requestHeaders = method === 'GET' ? { ...headers, 'accept-encoding': 'identity' } : headers;
    const url = `https://${this.#host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`;

    const boundedTimeoutMs = Math.min(Math.ceil(timeoutMs), MAX_TIMER_MS);
    const phaseController = new AbortController();
    let onParentAbort = null;
    if (signal !== undefined) {
      if (signal.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
      }
      onParentAbort = () => {
        phaseController.abort(signal.reason);
      };
      signal.addEventListener('abort', onParentAbort, { once: true });
    }
    const headerTimeout = AbortSignal.timeout(boundedTimeoutMs);
    const onHeaderTimeout = () => {
      phaseController.abort(headerTimeout.reason ?? new Error(`R2 request timed out after ${boundedTimeoutMs}ms.`));
    };
    headerTimeout.addEventListener('abort', onHeaderTimeout, { once: true });
    let cleaned = false;
    const cleanup = () => {
      if (!cleaned) {
        cleaned = true;
        headerTimeout.removeEventListener('abort', onHeaderTimeout);
        if (onParentAbort !== null && signal !== undefined) {
          signal.removeEventListener('abort', onParentAbort);
        }
      }
    };
    try {
      const response = await this.#fetch(url, {
        method,
        headers: requestHeaders,
        body: method === 'PUT' ? body : undefined,
        redirect: 'error',
        signal: phaseController.signal,
      });
      headerTimeout.removeEventListener('abort', onHeaderTimeout);
      return { response, cleanup, phaseController };
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  /**
   * @param {Response} response
   * @returns {Promise<void>}
   */
  async #discardBody(response) {
    if (response.body !== null && response.body !== undefined && typeof response.body.cancel === 'function') {
      try {
        await response.body.cancel();
      } catch {
      }
    }
  }

  /**
   * @param {{response: Response, cleanup: Function, phaseController: AbortController}} opened
   * @param {string} action
   * @returns {Promise<string>}
   * @throws {Error}
   */
  async #readTextResponse(opened, action) {
    const { response, cleanup, phaseController } = opened;
    try {
      if (!response.ok) {
        await this.#discardBody(response);
        throw this.#httpError(action, response.status);
      }
      const buffer = await this.#readBufferWithBodyTimeout(response, phaseController);
      return buffer.toString('utf8');
    } finally {
      cleanup();
    }
  }

  /**
   * @param {Response} response
   * @param {AbortController} phaseController
   * @returns {Promise<Buffer>}
   * @throws {Error}
   */
  async #readBufferWithBodyTimeout(response, phaseController) {
    const contentLengthHeader = response.headers.get('content-length');
    const contentLength = /^\d+$/.test(String(contentLengthHeader)) ? Number(contentLengthHeader) : Number.NaN;
    const rawBodyTimeoutMs = Number.isSafeInteger(contentLength)
      ? OBJECT_TIMEOUT_MS + Math.ceil(contentLength / OBJECT_BYTES_PER_SECOND) * 1000
      : UNKNOWN_SIZE_TIMEOUT_MS;
    const boundedBodyTimeoutMs = Math.min(rawBodyTimeoutMs, MAX_TIMER_MS);
    const bodyTimeout = AbortSignal.timeout(boundedBodyTimeoutMs);
    const onBodyTimeout = () => {
      phaseController.abort(bodyTimeout.reason ?? new Error(`R2 body download timed out after ${boundedBodyTimeoutMs}ms.`));
    };
    bodyTimeout.addEventListener('abort', onBodyTimeout, { once: true });
    let onAbortReject = null;
    try {
      const abortPromise = new Promise((_, reject) => {
        if (phaseController.signal.aborted) {
          reject(phaseController.signal.reason instanceof Error
            ? phaseController.signal.reason
            : new DOMException('Aborted', 'AbortError'));
          return;
        }
        onAbortReject = () => {
          reject(phaseController.signal.reason instanceof Error
            ? phaseController.signal.reason
            : new DOMException('Aborted', 'AbortError'));
        };
        phaseController.signal.addEventListener('abort', onAbortReject, { once: true });
      });
      const arrayBufferPromise = response.arrayBuffer();
      arrayBufferPromise.catch(() => {});
      const arrayBuffer = await Promise.race([arrayBufferPromise, abortPromise]);
      return Buffer.from(arrayBuffer);
    } finally {
      bodyTimeout.removeEventListener('abort', onBodyTimeout);
      if (onAbortReject !== null) {
        phaseController.signal.removeEventListener('abort', onAbortReject);
      }
    }
  }
}
