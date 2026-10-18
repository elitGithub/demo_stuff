window.ElsewhereSandboxClient = class ElsewhereSandboxClient {
  /** @param {Function} endpointForPath @param {Function} fetchImplementation */
  constructor(endpointForPath, fetchImplementation = window.fetch.bind(window)) {
    this.endpointForPath = endpointForPath;
    this.fetchImplementation = fetchImplementation;
    this.context = null;
    this.epoch = 0;
  }

  /** @returns {Promise<object>} */
  async initialize() {
    this.invalidate();
    const epoch = this.epoch;
    return this.send('/api/sandbox', { method: 'POST', body: {} }, epoch, null);
  }

  /** @param {string} path @param {object} options @returns {Promise<object>} */
  async request(path, { method = 'GET', body } = {}) {
    if (!this.context) {
      throw Object.assign(new Error('Your demo session ended or changed. Start a fresh demo to continue.'), { code: 'sandbox_context', status: 409 });
    }
    if (path === '/api/sandbox') {
      throw new Error('Use the explicit demo restart control.');
    }
    return this.send(path, { method, body }, this.epoch, this.context);
  }

  /** @returns {void} */
  invalidate() {
    this.context = null;
    this.epoch += 1;
  }

  /** @returns {void} */
  cancelPending() {
    this.epoch += 1;
  }

  /** @param {string} path @param {object} options @param {number} epoch @param {?string} context @returns {Promise<object>} */
  async send(path, { method, body }, epoch, context) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (context) { headers['X-Elsewhere-Context'] = context; }
      const response = await this.fetchImplementation(this.endpointForPath(path), {
        method, headers, credentials: 'same-origin', cache: 'no-store',
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const payload = await response.json();
      if (epoch !== this.epoch) { throw new DOMException('Superseded demo request.', 'AbortError'); }
      const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
      if (!object(payload)) { throw new Error('The demo server returned an invalid response. Please try again.'); }
      if (!response.ok) {
        const codes = ['sandbox_context', 'dashboard_access', 'capacity', 'busy', 'sandbox_full', 'rate_limited', 'validation', 'origin', 'body_too_large', 'content_type', 'not_found', 'conflict', 'unavailable', 'internal'];
        if (typeof payload.error !== 'string' || !codes.includes(payload.code)) { throw new Error('The demo server returned an invalid error. Please try again.'); }
        if (payload.code === 'sandbox_context') { this.invalidate(); }
        throw Object.assign(new Error(payload.error), { code: payload.code, status: response.status, retryAfter: response.headers?.get('Retry-After') });
      }
      const positive = value => Number.isSafeInteger(value) && value > 0;
      const strings = (value, names) => object(value) && names.every(name => typeof value[name] === 'string');
      let valid = false;
      if (path === '/api/sandbox') {
        valid = typeof payload.csrfToken === 'string' && /^[a-f0-9]{64}$/.test(payload.csrfToken)
          && positive(payload.expiresAt) && typeof payload.created === 'boolean' && payload.protocolVersion === 1
          && positive(payload.idleSeconds) && positive(payload.pageSize);
        if (valid) { this.context = payload.csrfToken; }
      } else if (path === '/api/admin/overview') {
        const common = record => strings(record, ['reference', 'firstName', 'lastName', 'destination', 'journey', 'departure', 'createdAt', 'status'])
          && positive(record.id) && positive(record.travelers) && Number.isFinite(Date.parse(record.createdAt))
          && (record.departure === '' || /^\d{4}-\d{2}-\d{2}$/.test(record.departure) && Number.isFinite(Date.parse(record.departure)));
        valid = Array.isArray(payload.enquiries) && payload.enquiries.length <= 100 && payload.enquiries.every(record => common(record)
          && strings(record, ['email', 'budget', 'message']) && ['new', 'contacted', 'proposal', 'converted', 'closed'].includes(record.status))
          && Array.isArray(payload.bookings) && payload.bookings.length <= 103 && payload.bookings.every(record => common(record)
            && (record.enquiryId === null || positive(record.enquiryId)) && Number.isSafeInteger(record.value) && record.value >= 0
            && ['planning', 'confirmed', 'cancelled'].includes(record.status))
          && object(payload.catalog) && Array.isArray(payload.catalog.destinations) && payload.catalog.destinations.length <= 100
          && payload.catalog.destinations.every(record => strings(record, ['id', 'name']))
          && Array.isArray(payload.catalog.journeys) && payload.catalog.journeys.length <= 100
          && payload.catalog.journeys.every(record => strings(record, ['id', 'title', 'destination']) && positive(record.price));
      } else if (path === '/api/enquiries') {
        valid = positive(payload.id) && strings(payload, ['reference']);
      } else if (/^\/api\/admin\/enquiries\/[1-9]\d*\/booking$/.test(path)) {
        valid = strings(payload, ['reference']);
      } else if (path === '/api/admin/login' || path === '/api/admin/logout' || /^\/api\/admin\/enquiries\/[1-9]\d*$/.test(path)) {
        valid = payload.ok === true;
      }
      if (!valid) { throw new Error('The demo server returned an invalid response. Please try again.'); }
      return payload;
    } catch (error) {
      if (epoch !== this.epoch && error.code !== 'sandbox_context') { throw new DOMException('Superseded demo request.', 'AbortError'); }
      throw error;
    }
  }
};
