export class BookingStatus {
  static Planning = new BookingStatus('planning', 'Planning');
  static Confirmed = new BookingStatus('confirmed', 'Confirmed');
  static Cancelled = new BookingStatus('cancelled', 'Cancelled');

  /** @param {string} value @param {string} text */
  constructor(value, text) { this.value = value; this.text = text; Object.freeze(this); }
  /** @param {string} value @returns {BookingStatus} */
  static from(value) {
    const status = [this.Planning, this.Confirmed, this.Cancelled].find(candidate => candidate.value === value);
    if (!status) { throw new TypeError('Invalid booking status.'); }
    return status;
  }
  /** @returns {string} */
  label() { return this.text; }
  /** @returns {string} */
  toJSON() { return this.value; }
}
Object.freeze(BookingStatus);
