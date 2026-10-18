import { EnquiryInput } from './EnquiryInput.mjs';
import { EnquiryStatus } from '../enums/EnquiryStatus.mjs';

export class EnquiryRecord {
  /** @param {{id:number,reference:string,input:EnquiryInput,status:EnquiryStatus,createdAt:string}} fields */
  constructor({ id, reference, input, status, createdAt }) {
    Object.assign(this, { id, reference, input, status, createdAt });
    Object.freeze(this);
  }
  /** @returns {object} */
  toJSON() { return { id: this.id, reference: this.reference, ...this.input.toJSON(), status: this.status.value, createdAt: this.createdAt }; }
}
