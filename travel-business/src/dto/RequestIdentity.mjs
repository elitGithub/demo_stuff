export class RequestIdentity {
  /** @param {{sandboxToken:?string,dashboardToken:?string,contextToken:?string,remoteAddress:string}} fields */
  constructor({ sandboxToken = null, dashboardToken = null, contextToken = null, remoteAddress }) {
    if ([sandboxToken, dashboardToken, contextToken].some(value => value !== null && typeof value !== 'string') || typeof remoteAddress !== 'string' || remoteAddress.length < 1 || remoteAddress.length > 255) { throw new TypeError('Invalid request identity.'); }
    Object.assign(this, { sandboxToken, dashboardToken, contextToken, remoteAddress });
    Object.freeze(this);
  }
}
