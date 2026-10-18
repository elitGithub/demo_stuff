export class CatalogDestination {
  /** @param {{id:string,name:string}} fields */
  constructor({ id, name }) { Object.assign(this, { id, name }); Object.freeze(this); }
  /** @returns {object} */
  toJSON() { return { id: this.id, name: this.name }; }
}
