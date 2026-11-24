import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { WorldsConfig } from '../src/config.mjs';

const tempRootDirs = [];

/**
 * @returns {string}
 */
function createTempDir() {
  const createdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-config-test-'));
  tempRootDirs.push(createdDir);
  return createdDir;
}

after(() => {
  for (const tempDir of tempRootDirs) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('WorldsConfig.parseEnvFile', () => {
  it('parses valid entries via dotenv including inline comments, escaped quotes, export tabs, BOM, and CRLF', () => {
    const content = [
      '\uFEFF# Comment header',
      '',
      'WORLDS_PORT=8899 # inline comment',
      'export\tOPENROUTER_API_KEY="sk-or-test=key#hash"',
      'QUOTED_VALUE="prefix\\"inner\\"suffix"',
      "R2_BUCKET='worlds-bucket-1'",
      '   # Indented comment',
    ].join('\r\n');

    const parsed = WorldsConfig.parseEnvFile(content);
    assert.equal(parsed.WORLDS_PORT, '8899');
    assert.equal(parsed.OPENROUTER_API_KEY, 'sk-or-test=key#hash');
    assert.equal(parsed.R2_BUCKET, 'worlds-bucket-1');
    assert.ok(parsed.QUOTED_VALUE.startsWith('prefix'));
    assert.ok(parsed.QUOTED_VALUE.includes('inner'));
    assert.ok(parsed.QUOTED_VALUE.endsWith('suffix'));
  });

  it('throws TypeError when content is not a string', () => {
    assert.throws(() => WorldsConfig.parseEnvFile(null), TypeError);
    assert.throws(() => WorldsConfig.parseEnvFile(123), TypeError);
  });
});

describe('WorldsConfig.load', () => {
  it('returns defaults when .env is absent and env is empty', () => {
    const rootDir = createTempDir();
    const config = WorldsConfig.load({ rootDir, env: {} });
    assert.equal(config.port, 8768);
    assert.equal(config.rootDir, path.resolve(rootDir));
    assert.equal(config.localDir, path.join(path.resolve(rootDir), 'local'));
    assert.equal(config.dbPath, path.join(path.resolve(rootDir), 'local', 'worlds.sqlite'));
    assert.equal(config.secretsPath, path.join(path.resolve(rootDir), 'local', 'secrets.json'));
    assert.equal(config.syncStatePath, path.join(path.resolve(rootDir), 'local', 'sync-state.json'));
    assert.equal(config.conflictsDir, path.join(path.resolve(rootDir), 'local', 'conflicts'));
    assert.equal(config.envApiKey, null);
    assert.equal(config.r2, null);
    assert.equal(Object.isFrozen(config), true);
  });

  it('treats all four blank R2 variables from .env.example as local-only mode', () => {
    const rootDir = createTempDir();
    fs.writeFileSync(
      path.join(rootDir, '.env'),
      [
        'WORLDS_PORT=8768',
        'OPENROUTER_API_KEY=',
        'R2_ACCOUNT_ID=',
        'R2_ACCESS_KEY_ID=',
        'R2_SECRET_ACCESS_KEY=',
        'R2_BUCKET=',
      ].join('\n'),
      'utf8',
    );
    const config = WorldsConfig.load({ rootDir, env: {} });
    assert.equal(config.r2, null);
    assert.equal(config.envApiKey, null);
  });

  it('prefers process env values over .env file values', () => {
    const rootDir = createTempDir();
    fs.writeFileSync(
      path.join(rootDir, '.env'),
      'WORLDS_PORT=9000\nOPENROUTER_API_KEY=from-file\n',
      'utf8',
    );
    const config = WorldsConfig.load({
      rootDir,
      env: {
        WORLDS_PORT: '9100',
        OPENROUTER_API_KEY: 'from-env',
      },
    });
    assert.equal(config.port, 9100);
    assert.equal(config.envApiKey, 'from-env');

    const clearedConfig = WorldsConfig.load({
      rootDir,
      env: { OPENROUTER_API_KEY: '' },
    });
    assert.equal(clearedConfig.port, 9000);
    assert.equal(clearedConfig.envApiKey, null);
  });

  it('rejects out-of-range or malformed WORLDS_PORT values and accepts 1024..65535', () => {
    const rootDir = createTempDir();
    assert.equal(WorldsConfig.load({ rootDir, env: { WORLDS_PORT: '1024' } }).port, 1024);
    assert.equal(WorldsConfig.load({ rootDir, env: { WORLDS_PORT: '65535' } }).port, 65535);

    const invalidPorts = ['0', '80', '1023', '65536', '8768abc', '8768.5', '-8768', ' 8768'];
    for (const badPort of invalidPorts) {
      assert.throws(
        () => WorldsConfig.load({ rootDir, env: { WORLDS_PORT: badPort } }),
        RangeError,
      );
    }
  });

  it('rejects partial, non-string, or malformed R2 credentials and accepts valid all-four credentials', () => {
    const rootDir = createTempDir();
    assert.throws(
      () => WorldsConfig.load({ rootDir, env: { R2_BUCKET: 'worlds-sync' } }),
      /Set all four valid R2 variables/,
    );
    assert.throws(
      () => WorldsConfig.load({
        rootDir,
        env: {
          R2_ACCOUNT_ID: 'acct-123',
          R2_ACCESS_KEY_ID: 'key123',
          R2_BUCKET: 'worlds-sync',
        },
      }),
      /Set all four valid R2 variables/,
    );

    const invalidCredSets = [
      {
        R2_ACCOUNT_ID: 12345,
        R2_ACCESS_KEY_ID: 'key123',
        R2_SECRET_ACCESS_KEY: 'secret-value',
        R2_BUCKET: 'worlds-sync',
      },
      {
        R2_ACCOUNT_ID: 'acct-123',
        R2_ACCESS_KEY_ID: 'key123',
        R2_SECRET_ACCESS_KEY: { toString: () => 'secret' },
        R2_BUCKET: 'worlds-sync',
      },
      {
        R2_ACCOUNT_ID: 'bad/account',
        R2_ACCESS_KEY_ID: 'key123',
        R2_SECRET_ACCESS_KEY: 'secret-value',
        R2_BUCKET: 'worlds-sync',
      },
      {
        R2_ACCOUNT_ID: 'acct-123',
        R2_ACCESS_KEY_ID: 'key-with-dash',
        R2_SECRET_ACCESS_KEY: 'secret-value',
        R2_BUCKET: 'worlds-sync',
      },
      {
        R2_ACCOUNT_ID: 'acct-123',
        R2_ACCESS_KEY_ID: 'key123',
        R2_SECRET_ACCESS_KEY: 'secret with space',
        R2_BUCKET: 'worlds-sync',
      },
      {
        R2_ACCOUNT_ID: 'acct-123',
        R2_ACCESS_KEY_ID: 'key123',
        R2_SECRET_ACCESS_KEY: 'secret-value',
        R2_BUCKET: 'UpperBucket',
      },
      {
        R2_ACCOUNT_ID: 'acct-123',
        R2_ACCESS_KEY_ID: 'key123',
        R2_SECRET_ACCESS_KEY: 'secret-value',
        R2_BUCKET: '-leading-dash',
      },
    ];
    for (const invalidCreds of invalidCredSets) {
      assert.throws(
        () => WorldsConfig.load({ rootDir, env: invalidCreds }),
        /Set all four valid R2 variables/,
      );
    }

    const validConfig = WorldsConfig.load({
      rootDir,
      env: {
        R2_ACCOUNT_ID: 'acct-123ABC',
        R2_ACCESS_KEY_ID: 'Key123ABC',
        R2_SECRET_ACCESS_KEY: 'sec_ret+456/789',
        R2_BUCKET: 'worlds-sync-01',
      },
    });
    assert.deepEqual(validConfig.r2, {
      account: 'acct-123ABC',
      accessKey: 'Key123ABC',
      secret: 'sec_ret+456/789',
      bucket: 'worlds-sync-01',
    });
    assert.equal(Object.isFrozen(validConfig.r2), true);
  });

  it('rejects CR, LF, NUL, or non-string OPENROUTER_API_KEY in load', () => {
    const rootDir = createTempDir();
    const badKeys = ['sk-line\nbreak', 'sk-cr\rvalue', 'sk-nul\0byte', 'sk-trailing\n'];
    for (const badKey of badKeys) {
      assert.throws(
        () => WorldsConfig.load({ rootDir, env: { OPENROUTER_API_KEY: badKey } }),
        RangeError,
      );
    }
    assert.throws(
      () => WorldsConfig.load({ rootDir, env: { OPENROUTER_API_KEY: 12345 } }),
      TypeError,
    );
  });
});

describe('WorldsConfig secrets and API key resolution', () => {
  it('writes secrets atomically with mode 0600, overrides .env, and falls back when cleared', () => {
    const rootDir = createTempDir();
    fs.writeFileSync(path.join(rootDir, '.env'), 'OPENROUTER_API_KEY=env-key-1\n', 'utf8');
    const config = WorldsConfig.load({ rootDir, env: {} });

    assert.deepEqual(WorldsConfig.readSecrets(config.secretsPath), { openRouterApiKey: null });
    assert.deepEqual(WorldsConfig.resolveApiKey(config), { key: 'env-key-1', source: 'env' });

    const written = WorldsConfig.writeSecrets(config.secretsPath, {
      openRouterApiKey: '  secret-ui-key  ',
    });
    assert.deepEqual(written, { openRouterApiKey: 'secret-ui-key' });

    const fileStats = fs.statSync(config.secretsPath);
    assert.equal(fileStats.mode & 0o777, 0o600);
    assert.deepEqual(WorldsConfig.resolveApiKey(config), {
      key: 'secret-ui-key',
      source: 'secrets',
    });

    WorldsConfig.writeSecrets(config.secretsPath, { openRouterApiKey: '   ' });
    assert.deepEqual(WorldsConfig.readSecrets(config.secretsPath), { openRouterApiKey: null });
    assert.deepEqual(WorldsConfig.resolveApiKey(config), { key: 'env-key-1', source: 'env' });

    WorldsConfig.writeSecrets(config.secretsPath, { openRouterApiKey: null });
    const noEnvConfig = WorldsConfig.load({
      rootDir,
      env: { OPENROUTER_API_KEY: '' },
    });
    assert.deepEqual(WorldsConfig.resolveApiKey(noEnvConfig), { key: null, source: 'none' });
  });

  it('rejects symlinks in readSecrets and does not chmod symlink targets in writeSecrets', () => {
    const rootDir = createTempDir();
    const targetFile = path.join(rootDir, 'outside-target.json');
    fs.writeFileSync(targetFile, '{"openRouterApiKey":"victim-key"}\n', { mode: 0o644 });
    fs.chmodSync(targetFile, 0o644);

    const secretsPath = path.join(rootDir, 'local', 'secrets.json');
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.symlinkSync(targetFile, secretsPath);

    assert.throws(
      () => WorldsConfig.readSecrets(secretsPath),
      (error) => error.code === 'ELOOP',
    );

    WorldsConfig.writeSecrets(secretsPath, { openRouterApiKey: 'safe-new-key' });
    const secretsLstat = fs.lstatSync(secretsPath);
    assert.equal(secretsLstat.isSymbolicLink(), false);
    assert.equal(secretsLstat.mode & 0o777, 0o600);
    assert.equal(fs.statSync(targetFile).mode & 0o777, 0o644);
    assert.equal(fs.readFileSync(targetFile, 'utf8'), '{"openRouterApiKey":"victim-key"}\n');
  });

  it('throws loudly on corrupted secrets.json, control characters, or invalid secret payloads', () => {
    const rootDir = createTempDir();
    const secretsPath = path.join(rootDir, 'local', 'secrets.json');
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });

    fs.writeFileSync(secretsPath, '{not valid json', 'utf8');
    assert.throws(() => WorldsConfig.readSecrets(secretsPath), SyntaxError);

    fs.writeFileSync(secretsPath, '[]', 'utf8');
    assert.throws(() => WorldsConfig.readSecrets(secretsPath), /JSON object/);

    fs.writeFileSync(secretsPath, '{"openRouterApiKey": 42}', 'utf8');
    assert.throws(() => WorldsConfig.readSecrets(secretsPath), /string or null/);

    fs.writeFileSync(secretsPath, '{"openRouterApiKey": "sk-bad\\r\\nX-Header: 1"}', 'utf8');
    assert.throws(() => WorldsConfig.readSecrets(secretsPath), RangeError);

    assert.throws(
      () => WorldsConfig.writeSecrets(secretsPath, { openRouterApiKey: 999 }),
      TypeError,
    );
    assert.throws(
      () => WorldsConfig.writeSecrets(secretsPath, { openRouterApiKey: 'sk-bad\n' }),
      RangeError,
    );
    assert.throws(
      () => WorldsConfig.writeSecrets(secretsPath, { openRouterApiKey: 'sk-bad\0' }),
      RangeError,
    );
  });
});
