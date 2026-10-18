import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants, closeSync, fsyncSync, mkdirSync, openSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createStore } from '../store.mjs';
import { InputError } from '../InputError.mjs';
import { ErrorCode } from '../enums/ErrorCode.mjs';
import { SandboxState } from '../enums/SandboxState.mjs';
import { SandboxOperation } from '../enums/SandboxOperation.mjs';
import { RateAction } from '../enums/RateAction.mjs';
import { SandboxConfig } from '../dto/SandboxConfig.mjs';
import { Catalog } from '../dto/Catalog.mjs';
import { RequestIdentity } from '../dto/RequestIdentity.mjs';
import { EnquiryInput } from '../dto/EnquiryInput.mjs';
import { StatusChange } from '../dto/StatusChange.mjs';
import { EnquiryId } from '../dto/EnquiryId.mjs';
import { Registry } from '../dto/Registry.mjs';
import { SandboxRecord } from '../dto/SandboxRecord.mjs';
import { RateBucket } from '../dto/RateBucket.mjs';
import { Bootstrap } from '../dto/Bootstrap.mjs';
import { CookieChange } from '../dto/CookieChange.mjs';
import { ApiResult } from '../dto/ApiResult.mjs';
import { Acknowledgement } from '../dto/Acknowledgement.mjs';
import { SandboxQueue } from './SandboxQueue.mjs';
import { SandboxRegistry } from './SandboxRegistry.mjs';

export class SandboxRuntime {
  /** @param {string} root @param {SandboxConfig} config @param {Catalog} catalog @param {()=>number} now */
  constructor(root, config, catalog, now = () => Math.floor(Date.now() / 1000)) {
    if (!(config instanceof SandboxConfig) || !(catalog instanceof Catalog) || typeof now !== 'function') { throw new TypeError('Explicit runtime configuration is required.'); }
    this.registry = new SandboxRegistry(root, config);
    this.queue = SandboxQueue.forRoot(this.registry.root, config.lockWaitMilliseconds);
    this.config = config;
    this.catalog = catalog;
    this.now = now;
  }

  /** @param {SandboxOperation} operation @param {RequestIdentity} identity @param {EnquiryInput|StatusChange|EnquiryId|null} command @returns {Promise<ApiResult>} */
  async execute(operation, identity, command = null) {
    if (!Object.values(SandboxOperation).includes(operation) || !(identity instanceof RequestIdentity)) { throw new TypeError('Invalid sandbox operation.'); }
    const commandType = operation === SandboxOperation.CreateEnquiry ? EnquiryInput : operation === SandboxOperation.UpdateStatus ? StatusChange : operation === SandboxOperation.CreateBooking ? EnquiryId : null;
    if ((commandType && !(command instanceof commandType)) || (!commandType && command !== null)) { throw new InputError('Invalid action details.'); }
    return this.queue.run(() => {
      const timestamp = this.now();
      if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isSafeInteger(timestamp + Math.max(this.config.idleSeconds, this.config.rateWindowSeconds))) { throw new TypeError('Invalid sandbox clock.'); }
      let registry = this.reconcile(this.registry.load(), timestamp);
      const digest = this.token(identity.sandboxToken) ? this.digest(identity.sandboxToken) : null;
      let record = registry.sandboxes.get(digest);
      const ready = record && record.state === SandboxState.Ready && timestamp < record.lastActivity + this.config.idleSeconds;
      const bootstrap = operation === SandboxOperation.Bootstrap;
      if (!bootstrap && (!ready || !this.same(identity.contextToken, record.csrfToken))) { throw new InputError('Your demo session ended or changed. Start a fresh demo.', 409, ErrorCode.SandboxContext); }
      const authorized = ready && this.token(identity.dashboardToken) && record.dashboardDigest !== null && this.same(this.digest(identity.dashboardToken), record.dashboardDigest);
      if ([SandboxOperation.Logout, SandboxOperation.Overview, SandboxOperation.UpdateStatus, SandboxOperation.CreateBooking].includes(operation) && !authorized) { throw new InputError('Enter the demo dashboard to continue.', 401, ErrorCode.DashboardAccess); }
      if (bootstrap && !ready) {
        if (registry.sandboxes.size >= this.config.maxSandboxes) { throw new InputError('The demo is at capacity. Please try again later.', 503, ErrorCode.Capacity, 60); }
        this.admit(registry, 1);
        registry = this.charge(registry, identity.remoteAddress, RateAction.Allocation, timestamp);
        const sandboxToken = this.random();
        record = new SandboxRecord({ digest: this.digest(sandboxToken), csrfToken: this.random(), dashboardDigest: null, lastActivity: timestamp, state: SandboxState.Pending });
        const allocations = registry.sandboxes;
        if (allocations.has(record.digest)) { throw new InputError('The demo storage is unavailable.', 503, ErrorCode.Unavailable); }
        allocations.set(record.digest, record);
        this.registry.save(new Registry({ sandboxes: allocations, rateBuckets: registry.rateBuckets }));
        let seed;
        try {
          const directory = join(this.registry.root, record.digest);
          mkdirSync(directory, { mode: 0o700 });
          seed = createStore(join(directory, 'seed.sqlite'), this.config, this.catalog, this.now, true);
          seed.close();
          seed = null;
          renameSync(join(directory, 'seed.sqlite'), join(directory, 'demo.sqlite'));
          const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
          record = new SandboxRecord({ ...record, state: SandboxState.Ready });
          allocations.set(record.digest, record);
          this.registry.save(new Registry({ sandboxes: allocations, rateBuckets: registry.rateBuckets }));
          return new ApiResult({ payload: this.bootstrap(record, true), cookies: this.cookies(sandboxToken, null) });
        } catch (error) { throw this.registry.unavailable(error); }
        finally { if (seed) { seed.close(); } }
      }
      this.admit(registry, 0);
      if (operation === SandboxOperation.CreateEnquiry || operation === SandboxOperation.Login) { registry = this.charge(registry, identity.remoteAddress, operation === SandboxOperation.Login ? RateAction.Login : RateAction.Enquiry, timestamp); }
      let dashboardToken = authorized ? identity.dashboardToken : null;
      if (operation === SandboxOperation.Login) { dashboardToken = this.random(); }
      if (operation === SandboxOperation.Logout) { dashboardToken = null; }
      record = new SandboxRecord({ ...record, lastActivity: timestamp, dashboardDigest: operation === SandboxOperation.Login ? this.digest(dashboardToken) : operation === SandboxOperation.Logout ? null : record.dashboardDigest });
      const records = registry.sandboxes;
      records.set(record.digest, record);
      registry = new Registry({ sandboxes: records, rateBuckets: registry.rateBuckets });
      this.registry.save(registry);
      const cookies = this.cookies(identity.sandboxToken, dashboardToken);
      if (operation === SandboxOperation.Logout) { cookies.push(new CookieChange({ name: this.config.dashboardCookie, value: '', path: '/', maxAge: 0, secure: false })); }
      if (bootstrap) { return new ApiResult({ payload: this.bootstrap(record, false), cookies }); }
      if (operation === SandboxOperation.Login || operation === SandboxOperation.Logout) { return new ApiResult({ payload: new Acknowledgement(), cookies }); }
      let store;
      try {
        store = createStore(join(this.registry.root, record.digest, 'demo.sqlite'), this.config, this.catalog, this.now, false);
        const payload = operation === SandboxOperation.CreateEnquiry ? store.createEnquiry(command) : operation === SandboxOperation.Overview ? store.overview() : operation === SandboxOperation.UpdateStatus ? store.updateStatus(command) : store.convert(command);
        return new ApiResult({ payload, cookies });
      } catch (error) {
        if (error instanceof InputError) { error.cookies = Object.freeze([...cookies]); throw error; }
        const unavailable = this.registry.unavailable(error);
        unavailable.cookies = Object.freeze([...cookies]);
        throw unavailable;
      } finally { if (store) { store.close(); } }
    });
  }

  /** @param {Registry} registry @param {number} timestamp @returns {Registry} */
  reconcile(registry, timestamp) {
    const rateBuckets = registry.rateBuckets;
    const records = registry.sandboxes;
    let changed = false;
    for (const [key, bucket] of rateBuckets) { if (timestamp >= bucket.expiresAt) { rateBuckets.delete(key); changed = true; } }
    for (const [key, record] of records) {
      if (record.state === SandboxState.Pending) { records.set(key, new SandboxRecord({ ...record, state: SandboxState.Failed })); changed = true; }
    }
    let cleaned = 0;
    for (const [key, record] of records) {
      if (cleaned >= this.config.cleanupBatch) { break; }
      if (record.state === SandboxState.Failed || timestamp >= record.lastActivity + this.config.idleSeconds) {
        const failed = new SandboxRecord({ ...record, state: SandboxState.Failed, dashboardDigest: null });
        records.set(key, failed);
        this.registry.save(new Registry({ sandboxes: records, rateBuckets }));
        cleaned += 1;
        try { this.registry.remove(failed); records.delete(key); }
        catch (error) { console.error('Sandbox cleanup failed.', error); }
        changed = true;
      }
    }
    if (changed) { registry = new Registry({ sandboxes: records, rateBuckets }); this.registry.save(registry); }
    return registry;
  }

  /** @param {Registry} registry @param {number} additionalSlots @returns {void} */
  admit(registry, additionalSlots) {
    const required = (registry.sandboxes.size + additionalSlots) * this.config.maxDatabaseBytes + this.config.registryReserveBytes + this.config.journalReserveBytes + this.config.stagingReserveBytes + this.registry.extraBytes(registry);
    if (required > this.config.maxRuntimeBytes) { throw new InputError('The demo is at capacity. Please try again later.', 503, ErrorCode.Capacity, 60); }
  }

  /** @param {Registry} registry @param {string} address @param {RateAction} action @param {number} timestamp @returns {Registry} */
  charge(registry, address, action, timestamp) {
    const key = this.digest(`${action.value}\0${address}`);
    const buckets = registry.rateBuckets;
    const previous = buckets.get(key);
    const limit = action === RateAction.Allocation ? this.config.allocationLimit : action === RateAction.Enquiry ? this.config.enquiryLimit : this.config.loginLimit;
    if ((previous && previous.hits >= limit) || (!previous && buckets.size >= this.config.maxRateBuckets)) {
      const retryAfter = previous ? previous.expiresAt - timestamp : Math.min(...[...buckets.values()].map(bucket => bucket.expiresAt - timestamp));
      throw new InputError('Please wait before trying this action again.', 429, ErrorCode.RateLimited, retryAfter);
    }
    buckets.set(key, new RateBucket({ key, hits: previous ? previous.hits + 1 : 1, expiresAt: previous ? previous.expiresAt : timestamp + this.config.rateWindowSeconds }));
    return new Registry({ sandboxes: registry.sandboxes, rateBuckets: buckets });
  }

  /** @param {SandboxRecord} record @param {boolean} created @returns {Bootstrap} */
  bootstrap(record, created) { return new Bootstrap({ csrfToken: record.csrfToken, expiresAt: record.lastActivity + this.config.idleSeconds, created, protocolVersion: this.config.protocolVersion, idleSeconds: this.config.idleSeconds, pageSize: this.config.pageSize }); }
  /** @param {string} sandboxToken @param {?string} dashboardToken @returns {CookieChange[]} */
  cookies(sandboxToken, dashboardToken) {
    const cookies = [new CookieChange({ name: this.config.sandboxCookie, value: sandboxToken, path: '/', maxAge: this.config.idleSeconds, secure: false })];
    if (dashboardToken) { cookies.push(new CookieChange({ name: this.config.dashboardCookie, value: dashboardToken, path: '/', maxAge: this.config.idleSeconds, secure: false })); }
    return cookies;
  }
  /** @param {?string} value @returns {boolean} */
  token(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
  /** @param {?string} left @param {?string} right @returns {boolean} */
  same(left, right) { return this.token(left) && this.token(right) && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex')); }
  /** @param {string} value @returns {string} */
  digest(value) { return createHash('sha256').update(value).digest('hex'); }
  /** @returns {string} */
  random() { return randomBytes(32).toString('hex'); }
}
