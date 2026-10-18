export class RateAction {
  static Allocation = new RateAction('allocation', 'Allocation');
  static Enquiry = new RateAction('enquiry', 'Enquiry');
  static Login = new RateAction('login', 'Login');
  /** @param {string} value @param {string} text */
  constructor(value, text) { this.value = value; this.text = text; Object.freeze(this); }
  /** @returns {string} */
  label() { return this.text; }
  /** @returns {string} */
  toJSON() { return this.value; }
}
Object.freeze(RateAction);
