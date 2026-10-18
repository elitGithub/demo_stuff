export class RateBucket {
  /** @param {{key:string,hits:number,expiresAt:number}} fields */
  constructor({ key, hits, expiresAt }) {
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(hits) || hits < 1 || !Number.isSafeInteger(expiresAt) || expiresAt < 0) { throw new TypeError('Invalid rate bucket.'); }
    Object.assign(this, { key, hits, expiresAt });
    Object.freeze(this);
  }
  /** @returns {object} */
  toJSON() { return { ...this }; }
}
