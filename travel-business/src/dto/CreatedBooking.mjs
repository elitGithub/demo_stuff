export class CreatedBooking {
  /** @param {{reference:string}} fields */
  constructor({ reference }) { this.reference = reference; Object.freeze(this); }
  /** @returns {object} */
  toJSON() { return { reference: this.reference }; }
}
