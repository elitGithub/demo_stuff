import { InputError } from '../InputError.mjs';

export class EnquiryId {
  /** @param {{id:number}} fields */
  constructor({ id }) {
    if (!Number.isSafeInteger(id) || id < 1) { throw new InputError('Invalid enquiry ID.'); }
    this.id = id;
    Object.freeze(this);
  }
  /** @returns {{id:number}} */
  toJSON() { return { id: this.id }; }
}
