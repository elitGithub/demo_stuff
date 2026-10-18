import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');

test('package_is_only_elsewhere_and_database_free', () => {
  const parent = join(root, 'storage/test-runs');
  mkdirSync(parent, { recursive: true });
  const fixture = mkdtempSync(join(parent, 'package-'));
  try {
    const output = join(fixture, 'package');
    const command = spawnSync(process.execPath, ['bin/package-infinityfree.mjs', '--output', output], { cwd: root, encoding: 'utf8' });
    assert.equal(command.status, 0, command.stderr);
    assert.doesNotMatch(command.stderr, /SQLite|ExperimentalWarning/);
    assert.deepEqual(readdirSync(join(output, 'htdocs')), ['travel-agency-demo']);
    const source = readFileSync(join(root, 'bin/package-infinityfree.mjs'), 'utf8');
    assert.doesNotMatch(source, /node:sqlite|createStore|seed-build|root-index/);
    const inspect = spawnSync('python3', ['-c', 'import sys,zipfile,json; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', join(output, 'travel-demo.zip')], { encoding: 'utf8' });
    assert.equal(inspect.status, 0, inspect.stderr);
    const files = JSON.parse(inspect.stdout);
    assert.ok(files.length > 30);
    assert.ok(files.every(name => name.startsWith('travel-agency-demo/')));
    assert.ok(files.every(name => !/\.sqlite(?:-|$)|\.db$|registry\.|runtime|preflight|test-runs|\/tests\//.test(name)));
    const site = join(output, 'htdocs/travel-agency-demo');
    for (const [sourceFile, target] of [['src/schema.sql', 'schema.sql'], ['src/demo-seed.json', 'demo-seed.json'], ['config/sandbox.json', 'sandbox.json'], ['config/enquiry-budgets.json', 'enquiry-budgets.json']]) {
      assert.equal(readFileSync(join(site, 'private', target), 'utf8'), readFileSync(join(root, sourceFile), 'utf8'));
    }
    assert.match(readFileSync(join(site, 'contact.html'), 'utf8'), /<meta name="api-endpoint" content="api.php">/);
    assert.equal(readFileSync(join(site, 'private/.htaccess'), 'utf8'), 'Require all denied\n');
    const config = readFileSync(join(site, 'private/config.php'), 'utf8');
    assert.match(config, /sandbox_root.*__DIR__.*\/runtime\/sandbox-runtime/);
    assert.doesNotMatch(config, /test|clock|visitor|csrfToken/);
    const web = join(fixture, 'web'); mkdirSync(web);
    writeFileSync(join(web, 'index.html'), 'ROOT HUB SENTINEL');
    const extraction = spawnSync('python3', ['-c', 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', join(output, 'travel-demo.zip'), web], { encoding: 'utf8' });
    assert.equal(extraction.status, 0, extraction.stderr);
    assert.equal(readFileSync(join(web, 'index.html'), 'utf8'), 'ROOT HUB SENTINEL');
    const refused = spawnSync(process.execPath, ['bin/package-infinityfree.mjs', '--output', output], { cwd: root, encoding: 'utf8' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /new or empty/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
