export class EnquiryInput {
  /** @param {{firstName:string,lastName:string,email:string,destination:string,journey:string,departure:string,travelers:number,budget:string,message:string}} fields */
  constructor({ firstName, lastName, email, destination, journey, departure, travelers, budget, message }) {
    Object.assign(this, { firstName, lastName, email, destination, journey, departure, travelers, budget, message });
    Object.freeze(this);
  }
  /** @returns {object} */
  toJSON() { return { ...this }; }
}
