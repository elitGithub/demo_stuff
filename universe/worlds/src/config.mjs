import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export const WorldsConfig = Object.freeze({
  /**
   * @param {string} content
   * @returns {Record<string, string>}
   * @throws {TypeError}
   */
  parseEnvFile(content) {
    if (typeof content !== 'string') {
      throw new TypeError('Env file content must be a string.');
    }
    const normalizedContent = content.startsWith('\uFEFF') ? content.slice(1) : content;
    return dotenv.parse(normalizedContent);
  },

  /**
   * @param {{rootDir?: string, env?: Record<string, string | undefined>}} options
   * @returns {Readonly<{port: number, rootDir: string, localDir: string, dbPath: string, secretsPath: string, syncStatePath: string, conflictsDir: string, envApiKey: string | null, r2: Readonly<{account: string, accessKey: string, secret: string, bucket: string}> | null}>}
   * @throws {Error}
   */
  load({ rootDir = path.resolve(import.meta.dirname, '..'), env = process.env } = {}) {
    const resolvedRootDir = path.resolve(rootDir);
    const envFilePath = path.join(resolvedRootDir, '.env');
    let fileValues = {};
    try {
      const rawContent = fs.readFileSync(envFilePath, 'utf8');
      fileValues = WorldsConfig.parseEnvFile(rawContent);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    const merged = { ...fileValues };
    for (const [envKey, envValue] of Object.entries(env)) {
      if (envValue !== undefined) {
        merged[envKey] = envValue;
      }
    }

    let port = 8768;
    const rawPort = merged.WORLDS_PORT;
    if (rawPort !== undefined && rawPort !== '') {
      if (typeof rawPort !== 'string' || !/^\d+$/.test(rawPort)) {
        throw new RangeError(`Invalid WORLDS_PORT: ${String(rawPort)}`);
      }
      const parsedPort = Number.parseInt(rawPort, 10);
      if (parsedPort < 1024 || parsedPort > 65535) {
        throw new RangeError(`WORLDS_PORT out of range (1024..65535): ${parsedPort}`);
      }
      port = parsedPort;
    }

    const r2Values = [
      merged.R2_ACCOUNT_ID,
      merged.R2_ACCESS_KEY_ID,
      merged.R2_SECRET_ACCESS_KEY,
      merged.R2_BUCKET,
    ];
    let r2 = null;
    const allUnsetOrEmpty = r2Values.every((item) => item === undefined || item === '');
    if (!allUnsetOrEmpty) {
      const [account, accessKey, secret, bucket] = r2Values;
      if (
        typeof account !== 'string' ||
        typeof accessKey !== 'string' ||
        typeof secret !== 'string' ||
        typeof bucket !== 'string' ||
        account.length === 0 ||
        accessKey.length === 0 ||
        secret.length === 0 ||
        bucket.length === 0 ||
        !/^[a-z0-9-]+$/i.test(account) ||
        !/^[a-z0-9][a-z0-9-]*$/.test(bucket) ||
        !/^[a-z0-9]+$/i.test(accessKey) ||
        /\s/.test(secret)
      ) {
        throw new Error('Set all four valid R2 variables together or unset all four.');
      }
      r2 = Object.freeze({ account, accessKey, secret, bucket });
    }

    const rawApiKey = merged.OPENROUTER_API_KEY;
    let envApiKey = null;
    if (rawApiKey !== undefined) {
      if (typeof rawApiKey !== 'string') {
        throw new TypeError('OPENROUTER_API_KEY must be a string.');
      }
      if (/[\r\n\0]/.test(rawApiKey)) {
        throw new RangeError('OPENROUTER_API_KEY must not contain CR, LF, or NUL characters.');
      }
      const trimmedApiKey = rawApiKey.trim();
      envApiKey = trimmedApiKey.length > 0 ? trimmedApiKey : null;
    }

    const localDir = path.join(resolvedRootDir, 'local');
    return Object.freeze({
      port,
      rootDir: resolvedRootDir,
      localDir,
      dbPath: path.join(localDir, 'worlds.sqlite'),
      secretsPath: path.join(localDir, 'secrets.json'),
      syncStatePath: path.join(localDir, 'sync-state.json'),
      conflictsDir: path.join(localDir, 'conflicts'),
      envApiKey,
      r2,
    });
  },

  /**
   * @param {string} secretsPath
   * @returns {{openRouterApiKey: string | null}}
   * @throws {Error}
   */
  readSecrets(secretsPath) {
    let fileDescriptor;
    try {
      fileDescriptor = fs.openSync(secretsPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { openRouterApiKey: null };
      }
      throw error;
    }
    let rawContent;
    try {
      rawContent = fs.readFileSync(fileDescriptor, 'utf8');
    } finally {
      fs.closeSync(fileDescriptor);
    }
    const parsed = JSON.parse(rawContent);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Secrets file must contain a JSON object.');
    }
    const rawKey = parsed.openRouterApiKey;
    if (rawKey === undefined || rawKey === null) {
      return { openRouterApiKey: null };
    }
    if (typeof rawKey !== 'string') {
      throw new Error('Secrets openRouterApiKey must be a string or null.');
    }
    if (/[\r\n\0]/.test(rawKey)) {
      throw new RangeError('Secrets openRouterApiKey must not contain CR, LF, or NUL characters.');
    }
    const trimmedKey = rawKey.trim();
    return { openRouterApiKey: trimmedKey.length > 0 ? trimmedKey : null };
  },

  /**
   * @param {string} secretsPath
   * @param {{openRouterApiKey: string | null | undefined}} payload
   * @returns {{openRouterApiKey: string | null}}
   * @throws {Error}
   */
  writeSecrets(secretsPath, { openRouterApiKey }) {
    if (openRouterApiKey !== null && openRouterApiKey !== undefined && typeof openRouterApiKey !== 'string') {
      throw new TypeError('openRouterApiKey must be a string, null, or undefined.');
    }
    if (typeof openRouterApiKey === 'string' && /[\r\n\0]/.test(openRouterApiKey)) {
      throw new RangeError('openRouterApiKey must not contain CR, LF, or NUL characters.');
    }
    const normalizedKey = typeof openRouterApiKey === 'string' && openRouterApiKey.trim().length > 0
      ? openRouterApiKey.trim()
      : null;

    const parentDir = path.dirname(secretsPath);
    fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });

    const tempPath = path.join(parentDir, `.secrets-${process.pid}-${randomUUID()}.tmp`);
    const serialized = `${JSON.stringify({ openRouterApiKey: normalizedKey }, null, 2)}\n`;
    let fileDescriptor = null;
    try {
      fileDescriptor = fs.openSync(tempPath, 'wx', 0o600);
      fs.writeFileSync(fileDescriptor, serialized, 'utf8');
      fs.fsyncSync(fileDescriptor);
      fs.closeSync(fileDescriptor);
      fileDescriptor = null;
      fs.chmodSync(tempPath, 0o600);
      fs.renameSync(tempPath, secretsPath);
    } catch (error) {
      if (fileDescriptor !== null) {
        fs.closeSync(fileDescriptor);
      }
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw error;
    }
    return { openRouterApiKey: normalizedKey };
  },

  /**
   * @param {{secretsPath: string, envApiKey: string | null}} config
   * @returns {{key: string | null, source: 'secrets' | 'env' | 'none'}}
   * @throws {Error}
   */
  resolveApiKey(config) {
    const secrets = WorldsConfig.readSecrets(config.secretsPath);
    if (secrets.openRouterApiKey !== null) {
      return { key: secrets.openRouterApiKey, source: 'secrets' };
    }
    if (typeof config.envApiKey === 'string' && config.envApiKey.trim().length > 0) {
      return { key: config.envApiKey.trim(), source: 'env' };
    }
    return { key: null, source: 'none' };
  },
});
