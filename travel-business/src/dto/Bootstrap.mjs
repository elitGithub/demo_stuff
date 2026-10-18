export class Bootstrap {
  /** @param {{csrfToken:string,expiresAt:number,created:boolean,protocolVersion:number,idleSeconds:number,pageSize:number}} fields */
  constructor({ csrfToken, expiresAt, created, protocolVersion, idleSeconds, pageSize }) {
    Object.assign(this, { csrfToken, expiresAt, created, protocolVersion, idleSeconds, pageSize });
    Object.freeze(this);
  }
  /** @returns {object} */
  toJSON() { return { ...this }; }
}
