export class SandboxOperation {
  static Bootstrap = new SandboxOperation('bootstrap', 'Initialize demo');
  static CreateEnquiry = new SandboxOperation('create_enquiry', 'Create enquiry');
  static Login = new SandboxOperation('login', 'Enter dashboard');
  static Logout = new SandboxOperation('logout', 'Leave dashboard');
  static Overview = new SandboxOperation('overview', 'Read dashboard');
  static UpdateStatus = new SandboxOperation('update_status', 'Update enquiry');
  static CreateBooking = new SandboxOperation('create_booking', 'Create booking');
  /** @param {string} value @param {string} text */
  constructor(value, text) { this.value = value; this.text = text; Object.freeze(this); }
  /** @returns {string} */
  label() { return this.text; }
  /** @returns {string} */
  toJSON() { return this.value; }
}
Object.freeze(SandboxOperation);
