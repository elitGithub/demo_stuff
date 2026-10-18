export class ApiClient {
  /** @param {string} baseUrl */
  constructor(baseUrl) { this.baseUrl = baseUrl; this.origin = baseUrl; this.cookies = new Map(); this.context = null; }
  /** @returns {string} */
  cookieHeader() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '); }
  /** @returns {Promise<Response>} */
  async initialize() {
    const response = await this.request('POST', '/api/sandbox', {});
    if (response.ok) { this.context = (await response.clone().json()).csrfToken; }
    return response;
  }
  /** @param {string} method @param {string} path @param {?object} body @param {?object} overrides @returns {Promise<Response>} */
  async request(method, path, body = null, overrides = null) {
    const headers = { Origin: this.origin, Cookie: this.cookieHeader(), ...(this.context ? { 'X-Elsewhere-Context': this.context } : {}), ...(body !== null ? { 'Content-Type': 'application/json' } : {}), ...(overrides?.headers || {}) };
    for (const [name, value] of Object.entries(headers)) { if (value === null) { delete headers[name]; } }
    const response = await fetch(this.baseUrl + path, { method, headers, ...(body !== null ? { body: JSON.stringify(body) } : {}), ...(overrides?.body !== undefined ? { body: overrides.body } : {}) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0];
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      if (/Max-Age=0(?:;|$)/.test(cookie)) { this.cookies.delete(name); } else { this.cookies.set(name, pair.slice(separator + 1)); }
    }
    return response;
  }
}
