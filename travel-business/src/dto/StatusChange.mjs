import { InputError } from '../InputError.mjs';
import { EnquiryId } from './EnquiryId.mjs';
import { EnquiryStatus } from '../enums/EnquiryStatus.mjs';

export class StatusChange {
  /** @param {{id:number,status:EnquiryStatus}} fields */
  constructor({ id, status }) {
    this.id = new EnquiryId({ id }).id;
    if (![EnquiryStatus.New, EnquiryStatus.Contacted, EnquiryStatus.Proposal, EnquiryStatus.Closed].includes(status)) { throw new InputError('Please choose a valid enquiry status.'); }
    this.status = status;
    Object.freeze(this);
  }
  /** @returns {{id:number,status:string}} */
  toJSON() { return { id: this.id, status: this.status.value }; }
}
