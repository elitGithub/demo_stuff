import { ErrorCode } from './enums/ErrorCode.mjs';

export class InputError extends Error {
  /** @param {string} message @param {number} status @param {ErrorCode} code @param {?number} retryAfter @param {import('./dto/CookieChange.mjs').CookieChange[]} cookies */
  constructor(message, status = 400, code = ErrorCode.Validation, retryAfter = null, cookies = []) {
    super(message);
    this.name = 'InputError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.cookies = Object.freeze([...cookies]);
  }
}
