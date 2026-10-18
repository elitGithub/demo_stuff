import { SandboxState } from '../enums/SandboxState.mjs';

export class SandboxRecord {
  /** @param {{digest:string,csrfToken:string,dashboardDigest:?string,lastActivity:number,state:SandboxState}} fields */
  constructor({ digest, csrfToken, dashboardDigest, lastActivity, state }) {
    if (![digest, csrfToken].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) || (dashboardDigest !== null && (typeof dashboardDigest !== 'string' || !/^[a-f0-9]{64}$/.test(dashboardDigest))) || !Number.isSafeInteger(lastActivity) || lastActivity < 0 || ![SandboxState.Pending, SandboxState.Ready, SandboxState.Failed].includes(state)) { throw new TypeError('Invalid sandbox record.'); }
    Object.assign(this, { digest, csrfToken, dashboardDigest, lastActivity, state });
    Object.freeze(this);
  }
  /** @returns {object} */
  toJSON() { return { ...this, state: this.state.value }; }
}
