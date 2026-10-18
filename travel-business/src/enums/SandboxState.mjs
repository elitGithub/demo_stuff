export class SandboxState {
  static Pending = new SandboxState('pending', 'Pending');
  static Ready = new SandboxState('ready', 'Ready');
  static Failed = new SandboxState('failed', 'Failed');
  /** @param {string} value @param {string} text */
  constructor(value, text) { this.value = value; this.text = text; Object.freeze(this); }
  /** @param {string} value @returns {SandboxState} */
  static from(value) {
    const state = [this.Pending, this.Ready, this.Failed].find(candidate => candidate.value === value);
    if (!state) { throw new TypeError('Invalid sandbox state.'); }
    return state;
  }
  /** @returns {string} */
  label() { return this.text; }
  /** @returns {string} */
  toJSON() { return this.value; }
}
Object.freeze(SandboxState);
