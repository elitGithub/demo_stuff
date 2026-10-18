import { InputError } from './InputError.mjs';
import { EnquiryValidator } from './EnquiryValidator.mjs';
import { RequestIdentity } from './dto/RequestIdentity.mjs';
import { CookieChange } from './dto/CookieChange.mjs';
import { EnquiryId } from './dto/EnquiryId.mjs';
import { StatusChange } from './dto/StatusChange.mjs';
import { EnquiryStatus } from './enums/EnquiryStatus.mjs';
import { ErrorCode } from './enums/ErrorCode.mjs';
import { SandboxOperation } from './enums/SandboxOperation.mjs';

export class ApiController {
  /** @param {import('./sandbox/SandboxRuntime.mjs').SandboxRuntime} runtime @param {import('./dto/Catalog.mjs').Catalog} catalog @param {import('./dto/SandboxConfig.mjs').SandboxConfig} config @param {string} origin @param {()=>number} now */
  constructor(runtime, catalog, config, origin, now) {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) { throw new TypeError('PUBLIC_ORIGIN must be an exact HTTP(S) origin.'); }
    this.runtime = runtime;
    this.config = config;
    this.origin = origin;
    this.secure = parsed.protocol === 'https:';
    this.validator = new EnquiryValidator(catalog, now);
  }

  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response @returns {Promise<void>} */
  async handle(request, response) {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const fixed = new Map([
        ['/api/sandbox', ['POST', SandboxOperation.Bootstrap]],
        ['/api/enquiries', ['POST', SandboxOperation.CreateEnquiry]],
        ['/api/admin/login', ['POST', SandboxOperation.Login]],
        ['/api/admin/logout', ['POST', SandboxOperation.Logout]],
        ['/api/admin/overview', ['GET', SandboxOperation.Overview]]
      ]);
      const matched = pathname.match(/^\/api\/admin\/enquiries\/([^/]+)(\/booking)?$/);
      const route = fixed.get(pathname) || (matched ? [matched[2] ? 'POST' : 'PATCH', matched[2] ? SandboxOperation.CreateBooking : SandboxOperation.UpdateStatus] : null);
      if (!route) { throw new InputError('API route not found.', 404, ErrorCode.NotFound); }
      const [method, operation] = route;
      if (request.method !== method) { this.send(response, 405, { error: 'Method not allowed.', code: ErrorCode.Validation.value }, [], { Allow: method }); return; }
      if (request.headers['sec-fetch-site'] === 'cross-site' || (method !== 'GET' ? request.headers.origin !== this.origin : request.headers.origin !== undefined && request.headers.origin !== this.origin)) { throw new InputError('Cross-origin requests are not allowed.', 403, ErrorCode.Origin); }
      const tokens = new Map();
      for (const part of (request.headers.cookie || '').split(';')) {
        const separator = part.indexOf('=');
        const name = (separator < 0 ? part : part.slice(0, separator)).trim();
        if (![this.config.sandboxCookie, this.config.dashboardCookie].includes(name)) { continue; }
        if (tokens.has(name)) { throw new InputError('Duplicate identity cookies are not allowed.'); }
        tokens.set(name, separator < 0 ? '' : part.slice(separator + 1).trim());
      }
      const contextToken = request.headers['x-elsewhere-context'];
      if (operation !== SandboxOperation.Bootstrap && (typeof contextToken !== 'string' || !/^[a-f0-9]{64}$/.test(contextToken))) { throw new InputError('Your demo session ended or changed. Start a fresh demo.', 409, ErrorCode.SandboxContext); }
      let id = null;
      if (matched) {
        if (!/^[1-9]\d*$/.test(matched[1])) { throw new InputError('Invalid enquiry ID.'); }
        id = new EnquiryId({ id: Number(matched[1]) });
      }
      let command = null;
      if (method === 'GET') {
        if (request.headers['transfer-encoding'] || (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')) { throw new InputError('This request does not accept a body.'); }
      } else {
        const input = await this.body(request);
        const keys = Object.keys(input);
        if (operation === SandboxOperation.CreateEnquiry) {
          const fields = ['firstName', 'lastName', 'email', 'destination', 'journey', 'departure', 'travelers', 'budget', 'message', 'consent'];
          if (keys.some(key => !fields.includes(key))) { throw new InputError('Unexpected enquiry fields.'); }
          command = this.validator.validate(input);
        } else if (operation === SandboxOperation.UpdateStatus) {
          if (keys.length !== 1 || keys[0] !== 'status') { throw new InputError('Please provide only an enquiry status.'); }
          command = new StatusChange({ id: id.id, status: Object.values(EnquiryStatus).find(status => status.value === input.status) });
        } else {
          if (keys.length !== 0) { throw new InputError('This action requires an empty JSON object.'); }
          if (operation === SandboxOperation.CreateBooking) { command = id; }
        }
      }
      const identity = new RequestIdentity({ sandboxToken: tokens.get(this.config.sandboxCookie) ?? null, dashboardToken: tokens.get(this.config.dashboardCookie) ?? null, contextToken: typeof contextToken === 'string' ? contextToken : null, remoteAddress: request.socket.remoteAddress });
      const result = await this.runtime.execute(operation, identity, command);
      this.send(response, [SandboxOperation.CreateEnquiry, SandboxOperation.CreateBooking].includes(operation) ? 201 : 200, result.payload, result.cookies);
    } catch (error) {
      if (request.aborted || response.destroyed) { return; }
      if (error instanceof InputError) {
        if (error.cause) { console.error('API storage failed:', error.cause); }
        this.send(response, error.status, { error: error.message, code: error.code.value }, error.cookies, error.retryAfter === null ? {} : { 'Retry-After': String(error.retryAfter) });
        return;
      }
      console.error('API request failed:', error);
      this.send(response, 500, { error: ErrorCode.Internal.label(), code: ErrorCode.Internal.value });
    }
  }

  /** @param {import('node:http').IncomingMessage} request @returns {Promise<object>} */
  body(request) {
    if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(request.headers['content-type'] || '')) { return Promise.reject(new InputError('Please send JSON data.', 415, ErrorCode.ContentType)); }
    if (Number(request.headers['content-length'] || 0) > 16384) { return Promise.reject(new InputError('That submission is too large.', 413, ErrorCode.BodyTooLarge)); }
    return new Promise((resolve, reject) => {
      const chunks = [];
      let bytes = 0;
      let settled = false;
      request.on('data', chunk => {
        if (settled) { return; }
        bytes += chunk.length;
        if (bytes > 16384) { settled = true; reject(new InputError('That submission is too large.', 413, ErrorCode.BodyTooLarge)); return; }
        chunks.push(chunk);
      });
      request.once('end', () => {
        if (settled) { return; }
        settled = true;
        try {
          const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
          if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new InputError('Please send a JSON object.'); }
          resolve(value);
        } catch { reject(new InputError('The submitted data is not a valid UTF-8 JSON object.')); }
      });
      request.once('error', error => { if (!settled) { settled = true; reject(error); } });
      request.once('aborted', () => { if (!settled) { settled = true; reject(new InputError('The request was aborted.')); } });
    });
  }

  /** @param {import('node:http').ServerResponse} response @param {number} status @param {object} payload @param {CookieChange[]} cookies @param {object} extra @returns {void} */
  send(response, status, payload, cookies = [], extra = {}) {
    const encoded = cookies.map(cookie => {
      const finalCookie = new CookieChange({ ...cookie, path: '/', secure: this.secure });
      return `${finalCookie.name}=${finalCookie.value}; Path=${finalCookie.path}; HttpOnly; SameSite=Strict; Max-Age=${finalCookie.maxAge}${finalCookie.secure ? '; Secure' : ''}`;
    });
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(encoded.length ? { 'Set-Cookie': encoded } : {}), ...extra });
    response.end(JSON.stringify(payload));
  }
}
