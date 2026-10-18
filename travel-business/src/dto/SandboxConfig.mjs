import defaults from '../../config/sandbox.json' with { type: 'json' };

export class SandboxConfig {
  /** @param {object} raw */
  constructor(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { throw new TypeError('Invalid sandbox configuration.'); }
    const values = { ...defaults, ...raw };
    if (Object.keys(raw).some(key => !Object.hasOwn(defaults, key))) { throw new TypeError('Unknown sandbox configuration key.'); }
    for (const [key, defaultValue] of Object.entries(defaults)) {
      if (typeof defaultValue === 'number' && (!Number.isSafeInteger(values[key]) || values[key] < 1)) { throw new TypeError(`Invalid configuration value: ${key}.`); }
    }
    if (values.protocolVersion !== 1 || values.sqlitePageBytes !== 4096 || values.maxDatabaseBytes % values.sqlitePageBytes !== 0 || values.maxDatabaseBytes < 32768 || values.maxDatabaseBytes > 1048576 || values.maxEnquiries < 4 || values.maxEnquiries > 100 || values.maxSandboxes > 100 || values.maxRateBuckets > 1000 || values.maxRuntimeBytes > 134217728 || values.cleanupBatch > 10 || values.pageSize !== 20 || values.lockRetryMilliseconds > values.lockWaitMilliseconds) {
      throw new TypeError('Invalid sandbox bounds.');
    }
    const reservation = values.maxSandboxes * values.maxDatabaseBytes + values.registryReserveBytes + values.journalReserveBytes + values.stagingReserveBytes;
    if (!Number.isSafeInteger(reservation) || reservation > values.maxRuntimeBytes || values.registryReserveBytes < 2097152 || values.journalReserveBytes < 2 * values.maxDatabaseBytes || values.stagingReserveBytes < 2 * values.maxDatabaseBytes) {
      throw new TypeError('Insufficient sandbox storage reservation.');
    }
    if (typeof values.sandboxCookie !== 'string' || typeof values.dashboardCookie !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(values.sandboxCookie) || !/^[a-z][a-z0-9_]{0,63}$/.test(values.dashboardCookie) || values.sandboxCookie === values.dashboardCookie) {
      throw new TypeError('Invalid sandbox cookie names.');
    }
    Object.assign(this, values);
    Object.freeze(this);
  }
  /** @param {object} raw @returns {SandboxConfig} */
  static from(raw) { return new SandboxConfig(raw); }
  /** @returns {object} */
  toJSON() { return { ...this }; }
}
