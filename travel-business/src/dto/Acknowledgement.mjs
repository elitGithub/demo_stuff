export class Acknowledgement {
  /** @param {{ok?:boolean}} fields */
  constructor({ ok = true } = {}) {
    if (ok !== true) { throw new TypeError('Acknowledgements must be successful.'); }
    this.ok = true;
    Object.freeze(this);
  }
  /** @returns {{ok:boolean}} */
  toJSON() { return { ok: this.ok }; }
}
