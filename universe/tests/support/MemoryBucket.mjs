import { digest } from '../../src/r2.mjs';

export class MemoryBucket {
  objects = new Map();
  requests = [];
  failures = 0;
  loseReply = false;
  forced = new Map();
  contentsOnlyKeyCount = false;
  omitContentLength = false;
  transport = this.request.bind(this);

  /**
   * @param {number} count
   * @returns {void}
   */
  failNext(count) {
    this.failures += count;
  }

  /**
   * @returns {void}
   */
  loseReplyNext() {
    this.loseReply = true;
  }

  /**
   * @param {string} key
   * @param {number} code
   * @returns {void}
   */
  status(key, code) {
    this.forced.set(key, [...(this.forced.get(key) ?? []), code]);
  }

  /**
   * @param {string} key
   * @param {Buffer | string} body
   * @returns {void}
   */
  seed(key, body) {
    const bytes = Buffer.from(body);
    this.objects.set(key, { body: bytes, etag: `"${digest(bytes)}"`, lastModified: new Date().toUTCString() });
  }

  /**
   * @param {string} method
   * @param {string} key
   * @param {{body?: Buffer | string, match?: string, absent?: boolean, list?: boolean, timeoutMs: number, bodyTimeoutMs?: Function, signal?: AbortSignal}} options
   * @returns {Promise<Response>}
   * @throws {Error}
   */
  async request(method, key, options) {
    this.requests.push({ method, key, options });
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error(`Request without a timeout: ${method} ${key}`);
    }
    options.signal?.throwIfAborted();
    if (this.failures > 0) {
      this.failures -= 1;
      throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
    }
    const headers = { date: new Date().toUTCString() };
    const forced = this.forced.get(key) ?? [];
    if (forced.length > 0) {
      return new Response(null, { status: forced.shift(), headers });
    }
    if (options.list === true) {
      const names = [...this.objects.keys()].sort();
      const tops = options.folders === true ? [...new Set(names.map((name) => name.slice(0, name.indexOf('/') + 1) || name))].slice(0, 2) : names.slice(0, 1);
      const prefixes = options.folders === true ? tops.filter((top) => top.endsWith('/')) : [];
      const contents = tops.filter((top) => !prefixes.includes(top));
      const count = this.contentsOnlyKeyCount ? contents.length : tops.length;
      const listed = [
        ...contents.map((key) => `<Contents><Key>${key}</Key></Contents>`),
        ...prefixes.map((prefix) => `<CommonPrefixes><Prefix>${prefix}</Prefix></CommonPrefixes>`),
      ];
      return new Response(`<ListBucketResult><KeyCount>${count}</KeyCount>${listed.join('')}</ListBucketResult>`, { headers });
    }
    const current = this.objects.get(key);
    if (method === 'GET') {
      if (current === undefined) {
        return new Response(null, { status: 404, headers });
      }
      const length = this.omitContentLength ? {} : { 'content-length': String(current.body.length) };
      const response = new Response(current.body, { headers: { ...headers, ...length, etag: current.etag, 'last-modified': current.lastModified } });
      const bodyMs = options.bodyTimeoutMs?.(response.headers.get('content-length'));
      if (options.bodyTimeoutMs !== undefined && (!Number.isSafeInteger(bodyMs) || bodyMs <= 0)) {
        throw new Error(`Body read without a timeout: ${method} ${key}`);
      }
      return response;
    }
    if (method !== 'PUT' || (options.match === undefined && options.absent !== true)) {
      throw new Error(`Unsupported or unconditional request: ${method} ${key}`);
    }
    let response = new Response(null, { status: 412, headers });
    if ((options.match === undefined || current?.etag === options.match) && (options.absent !== true || current === undefined)) {
      this.seed(key, options.body);
      response = new Response(null, { headers: { ...headers, etag: this.objects.get(key).etag } });
    }
    if (this.loseReply) {
      this.loseReply = false;
      throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
    }
    return response;
  }
}
