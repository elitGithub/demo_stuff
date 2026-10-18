export class CatalogJourney {
  /** @param {{id:string,title:string,destination:string,price:number}} fields */
  constructor({ id, title, destination, price }) { Object.assign(this, { id, title, destination, price }); Object.freeze(this); }
  /** @returns {object} */
  toJSON() { return { id: this.id, title: this.title }; }
}
