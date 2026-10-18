export class EnquiryStatus {
  static New = new EnquiryStatus('new', 'New');
  static Contacted = new EnquiryStatus('contacted', 'Contacted');
  static Proposal = new EnquiryStatus('proposal', 'Proposal');
  static Converted = new EnquiryStatus('converted', 'Converted');
  static Closed = new EnquiryStatus('closed', 'Closed');

  /** @param {string} value @param {string} text */
  constructor(value, text) { this.value = value; this.text = text; Object.freeze(this); }
  /** @param {string} value @returns {EnquiryStatus} */
  static from(value) {
    const status = [this.New, this.Contacted, this.Proposal, this.Converted, this.Closed].find(candidate => candidate.value === value);
    if (!status) { throw new TypeError('Invalid enquiry status.'); }
    return status;
  }
  /** @returns {string} */
  label() { return this.text; }
  /** @returns {string} */
  toJSON() { return this.value; }
}
Object.freeze(EnquiryStatus);
