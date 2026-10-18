export class ErrorCode {
  static SandboxContext = new ErrorCode('sandbox_context', 'Your demo session ended or changed.');
  static DashboardAccess = new ErrorCode('dashboard_access', 'Enter the demo dashboard to continue.');
  static Capacity = new ErrorCode('capacity', 'The demo is at capacity.');
  static Busy = new ErrorCode('busy', 'The demo is busy.');
  static SandboxFull = new ErrorCode('sandbox_full', 'Your demo workspace is full.');
  static RateLimited = new ErrorCode('rate_limited', 'Please try again later.');
  static Validation = new ErrorCode('validation', 'Please check the submitted details.');
  static Origin = new ErrorCode('origin', 'Cross-origin requests are not allowed.');
  static BodyTooLarge = new ErrorCode('body_too_large', 'That submission is too large.');
  static ContentType = new ErrorCode('content_type', 'Please send JSON data.');
  static NotFound = new ErrorCode('not_found', 'Record not found.');
  static Conflict = new ErrorCode('conflict', 'This record has already been converted.');
  static Unavailable = new ErrorCode('unavailable', 'The demo is temporarily unavailable.');
  static Internal = new ErrorCode('internal', 'The demo could not complete that request.');

  /** @param {string} value @param {string} text */
  constructor(value, text) { this.value = value; this.text = text; Object.freeze(this); }
  /** @returns {string} */
  label() { return this.text; }
  /** @returns {string} */
  toJSON() { return this.value; }
}
Object.freeze(ErrorCode);
