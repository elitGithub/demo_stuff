import { EnquiryRecord } from './EnquiryRecord.mjs';
import { BookingRecord } from './BookingRecord.mjs';
import { Catalog } from './Catalog.mjs';

export class Overview {
  /** @param {{enquiries:EnquiryRecord[],bookings:BookingRecord[],catalog:Catalog}} fields */
  constructor({ enquiries, bookings, catalog }) {
    this.enquiries = Object.freeze([...enquiries]);
    this.bookings = Object.freeze([...bookings]);
    this.catalog = catalog;
    Object.freeze(this);
  }
  /** @returns {object} */
  toJSON() { return { enquiries: this.enquiries, bookings: this.bookings, catalog: this.catalog }; }
}
