import { SandboxRecord } from './SandboxRecord.mjs';
import { RateBucket } from './RateBucket.mjs';

export class Registry {
  #sandboxes;
  #rateBuckets;
  /** @param {{version?:number,sandboxes:Map<string,SandboxRecord>,rateBuckets:Map<string,RateBucket>}} fields */
  constructor({ version = 1, sandboxes, rateBuckets }) {
    if (version !== 1 || !(sandboxes instanceof Map) || !(rateBuckets instanceof Map) || [...sandboxes].some(([key, record]) => !(record instanceof SandboxRecord) || key !== record.digest) || [...rateBuckets].some(([key, bucket]) => !(bucket instanceof RateBucket) || key !== bucket.key)) { throw new TypeError('Invalid registry.'); }
    this.version = version;
    this.#sandboxes = new Map(sandboxes);
    this.#rateBuckets = new Map(rateBuckets);
    Object.freeze(this);
  }
  /** @returns {Map<string,SandboxRecord>} */
  get sandboxes() { return new Map(this.#sandboxes); }
  /** @returns {Map<string,RateBucket>} */
  get rateBuckets() { return new Map(this.#rateBuckets); }
  /** @returns {object} */
  toJSON() { return { version: this.version, sandboxes: Object.fromEntries(this.#sandboxes), rateBuckets: Object.fromEntries(this.#rateBuckets) }; }
}
