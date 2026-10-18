export class CreatedEnquiry {
  /** @param {{id:number,reference:string}} fields */
  constructor({ id, reference }) { Object.assign(this, { id, reference }); Object.freeze(this); }
  /** @returns {object} */
  toJSON() { return { id: this.id, reference: this.reference }; }
}
