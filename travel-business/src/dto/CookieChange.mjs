export class CookieChange {
  /** @param {{name:string,value:string,path:string,maxAge:number,secure:boolean}} fields */
  constructor({ name, value, path, maxAge, secure }) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(name) || typeof value !== 'string' || (value !== '' && !/^[a-f0-9]{64}$/.test(value)) || typeof path !== 'string' || !path.startsWith('/') || /[\r\n;]/.test(path) || !Number.isSafeInteger(maxAge) || maxAge < 0 || typeof secure !== 'boolean') { throw new TypeError('Invalid cookie change.'); }
    Object.assign(this, { name, value, path, maxAge, secure });
    Object.freeze(this);
  }
}
