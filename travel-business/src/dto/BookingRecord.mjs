import { BookingStatus } from '../enums/BookingStatus.mjs';

export class BookingRecord {
  /** @param {{id:number,reference:string,enquiryId:?number,firstName:string,lastName:string,destination:string,journey:string,departure:string,travelers:number,value:number,status:BookingStatus,createdAt:string}} fields */
  constructor({ id, reference, enquiryId, firstName, lastName, destination, journey, departure, travelers, value, status, createdAt }) {
    Object.assign(this, { id, reference, enquiryId, firstName, lastName, destination, journey, departure, travelers, value, status, createdAt });
    Object.freeze(this);
  }
  /** @returns {object} */
  toJSON() { return { ...this, status: this.status.value }; }
}
