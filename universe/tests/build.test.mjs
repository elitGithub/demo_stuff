import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { SyncPhase } from '../src/sync/SyncPhase.mjs';

const project = dirname(import.meta.dirname);
const execute = promisify(execFile);
const npmCli = process.env.npm_execpath ?? join(dirname(dirname(process.execPath)), 'lib/node_modules/npm/bin/npm-cli.js');
const npmEnvironment = { ...process.env, npm_config_offline: 'true', npm_config_update_notifier: 'false' };
const removedFiles = [
  'child-preload.mjs', 'checkpoint-store.mjs', 'local-session.mjs', 'story-files.mjs', 'classes/capture-gate.mjs',
  'classes/cloud-save.mjs', 'integration/browser-bridge.js', 'integration/pinned-hooks.mjs', 'integration/server-bridge.mjs',
];

/**
 * @param {string} directory
 * @param {...string} args
 * @returns {Promise<object>}
 * @throws {Error}
 */
function npm(directory, ...args) {
  return execute(process.execPath, [npmCli, '--offline', '--ignore-scripts',
    '--no-audit', '--no-fund', '--cache', join(directory, 'local', 'npm-cache'), ...args], {
    cwd: directory, timeout: 30_000, env: npmEnvironment,
  });
}

/**
 * @param {string} directory
 * @param {string} signature
 * @returns {Promise<void>}
 * @throws {Error}
 */
async function asOlderBuild(directory, signature) {
  await writeFile(join(directory, '.universe-build'), signature);
  await rm(join(directory, 'sync'), { recursive: true });
  for (const file of removedFiles) {
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await writeFile(join(directory, file), 'previous build file');
  }
}

/**
 * @param {import('node:test').TestContext} context
 * @returns {Promise<string>}
 * @throws {Error}
 */
async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'universe-build-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['src', 'scripts', 'packages', '.npmrc']) {
    await cp(join(project, name), join(directory, name), { recursive: true });
  }
  const upstream = join(directory, 'upstream');
  await mkdir(join(upstream, 'src/endpoints'), { recursive: true });
  await mkdir(join(upstream, 'public/scripts'), { recursive: true });
  await mkdir(join(upstream, 'node_modules/express'), { recursive: true });
  await writeFile(join(upstream, 'node_modules/express/package.json'), JSON.stringify({ name: 'express', version: '0.0.1' }));
  await writeFile(join(upstream, 'package.json'), JSON.stringify({
    name: 'sillytavern', version: '1.19.1', dependencies: { express: '0.0.1' }, bundledDependencies: ['express'],
    scripts: { postinstall: 'node -e "process.exit(19)"' },
  }));
  for (const file of ['src/server-main.js', 'public/index.html', 'public/script.js', 'public/scripts/group-chats.js',
    'public/scripts/world-info.js', 'public/scripts/personas.js', 'src/endpoints/thumbnails.js']) {
    await writeFile(join(upstream, file), 'locked upstream asset');
  }
  await writeFile(join(upstream, 'server.js'), `
    const fs = require('node:fs');
    const { join } = require('node:path');
    const data = process.argv[process.argv.indexOf('--dataRoot') + 1];
    const config = process.argv[process.argv.indexOf('--configPath') + 1];
    const { port } = JSON.parse(fs.readFileSync(config));
    setTimeout(() => process.exit(20), 5_000);
    fetch('http://127.0.0.1:' + port + '/status').then(response => response.json()).then(status => {
      process.on('SIGTERM', () => {
        fs.writeFileSync(join(data, 'observed.json'), JSON.stringify({ cwd: process.cwd(), config, data, status }));
        process.exit(0);
      });
      process.kill(process.ppid, 'SIGTERM');
    });
  `);
  await npm(upstream, 'pack', '--pack-destination', directory);
  const metadata = JSON.parse(await readFile(join(project, 'package.json')));
  metadata.dependencies.sillytavern = 'file:' + join(directory, 'sillytavern-1.19.1.tgz');
  await writeFile(join(directory, 'package.json'), JSON.stringify(metadata));
  await npm(directory, 'install', '--package-lock-only', '--install-strategy=shallow');
  return directory;
}

test('locked extensions install in a fresh project and build into the global extensions directory', async context => {
  const directory = await fixture(context);
  const extensions = [
    { name: 'tavern-scenario-builder', folder: 'tavernScenarioBuilder', title: 'Tavern Scenario Builder', version: '1.1.0' },
    { name: 'st-aspect-vocalia', folder: 'st-aspect-vocalia', title: 'Aspect: Vocalia', version: '1.0.4' },
  ];
  for (const command of ['install', 'ci']) {
    await npm(directory, command);
    for (const extension of extensions) {
      const manifest = JSON.parse(await readFile(join(directory, 'node_modules', extension.name, 'manifest.json')));
      assert.equal(manifest.display_name, extension.title);
      assert.equal(manifest.version, extension.version);
    }
    await rename(join(directory, 'node_modules'), join(directory, command + '-dependencies'));
  }
  await npm(directory, 'run', 'build');
  const globalExtensions = join(directory, 'dist/node_modules/sillytavern/public/scripts/extensions/third-party');
  for (const extension of extensions) {
    const cleanInstall = join(directory, 'ci-dependencies', extension.name);
    for (const file of await readdir(cleanInstall, { recursive: true })) {
      if ((await stat(join(cleanInstall, file))).isFile()) {
        assert.deepEqual(await readFile(join(globalExtensions, extension.folder, file)), await readFile(join(cleanInstall, file)));
      }
    }
  }
  for (const asset of ['tavernScenarioBuilder/templates/workspace.html', 'st-aspect-vocalia/index.js']) {
    await rm(join(globalExtensions, asset));
    await npm(directory, 'run', 'build', '--', '--if-missing');
    assert.equal((await stat(join(globalExtensions, asset))).isFile(), true);
  }
});

test('a pre-extension backup survives missing sources and upgrades when its build inputs return', async context => {
  const directory = await fixture(context);
  const output = join(directory, 'dist');
  const backup = join(directory, '.universe-build-previous');
  const extension = 'node_modules/sillytavern/public/scripts/extensions/third-party/tavernScenarioBuilder';
  await npm(directory, 'run', 'build');
  await rename(output, backup);
  await rm(join(backup, extension), { recursive: true });
  await rm(join(backup, dirname(extension), 'st-aspect-vocalia'), { recursive: true });
  await asOlderBuild(backup, 'Universe local build v1\n');
  await rename(join(directory, 'src'), join(directory, 'unavailable-src'));
  await npm(directory, 'run', 'build', '--', '--if-missing');
  assert.equal(await readFile(join(output, '.universe-build'), 'utf8'), 'Universe local build v1\n');
  await rename(join(directory, 'unavailable-src'), join(directory, 'src'));
  await npm(directory, 'run', 'build', '--', '--if-missing');
  assert.equal(JSON.parse(await readFile(join(output, extension, 'manifest.json'))).version, '1.1.0');
});

test('the previous scenario-builder layout recovers without the Vocalia package and upgrades when it returns', async context => {
  const directory = await fixture(context);
  const output = join(directory, 'dist');
  const backup = join(directory, '.universe-build-previous');
  const archive = join(directory, 'packages/st-aspect-vocalia-1.0.4.tgz');
  const extension = 'node_modules/sillytavern/public/scripts/extensions/third-party/st-aspect-vocalia';
  await npm(directory, 'run', 'build');
  await rename(output, backup);
  await rm(join(backup, extension), { recursive: true });
  await asOlderBuild(backup, 'Universe local build v2\n');
  await rename(archive, archive + '.unavailable');
  await npm(directory, 'run', 'build', '--', '--if-missing');
  assert.equal(await readFile(join(output, '.universe-build'), 'utf8'), 'Universe local build v2\n');
  await rename(archive + '.unavailable', archive);
  await npm(directory, 'run', 'build', '--', '--if-missing');
  assert.equal(JSON.parse(await readFile(join(output, extension, 'manifest.json'))).version, '1.0.4');
});

test('the npm startup build step recovers a v3 backup and installs the profile sync when sources return', async context => {
  const directory = await fixture(context);
  const output = join(directory, 'dist');
  const backup = join(directory, '.universe-build-previous');
  await npm(directory, 'run', 'build');
  await rename(output, backup);
  await asOlderBuild(backup, 'Universe local build v3\n');
  await writeFile(join(backup, 'launcher.mjs'), 'previous v3 launcher');
  await rename(join(directory, 'src'), join(directory, 'unavailable-src'));
  await npm(directory, 'run', 'build', '--', '--if-missing');
  assert.equal(await readFile(join(output, 'launcher.mjs'), 'utf8'), 'previous v3 launcher');
  await rename(join(directory, 'unavailable-src'), join(directory, 'src'));
  await npm(directory, 'run', 'build', '--', '--if-missing');
  assert.equal(await readFile(join(output, '.universe-build'), 'utf8'), 'Universe local build v6\n');
  for (const file of ['launcher.mjs', 'child.mjs', 'sync/ProfileSync.mjs', 'sync/CloudStore.mjs']) {
    assert.deepEqual(await readFile(join(output, file)), await readFile(join(directory, 'src', file)));
  }
});

test('wrapper startup build step recovers a v4 backup and upgrades its home page when source returns', async context => {
  const directory = await fixture(context);
  const output = join(directory, 'dist');
  const backup = join(directory, '.universe-build-previous');
  await npm(directory, 'run', 'build');
  await rename(output, backup);
  await asOlderBuild(backup, 'Universe local build v4\n');
  await rm(join(backup, 'wrapper-home.html'));
  await writeFile(join(backup, 'server.mjs'), 'previous v4 server');
  await rename(join(directory, 'src'), join(directory, 'unavailable-src'));
  await npm(directory, 'run', 'build', '--', '--if-missing');
  assert.equal(await readFile(join(output, 'server.mjs'), 'utf8'), 'previous v4 server');
  await rename(join(directory, 'unavailable-src'), join(directory, 'src'));
  await npm(directory, 'run', 'build', '--', '--if-missing');
  assert.equal(await readFile(join(output, '.universe-build'), 'utf8'), 'Universe local build v6\n');
  for (const name of ['server.mjs', 'launcher.mjs', 'wrapper-home.html']) {
    assert.deepEqual(await readFile(join(output, name)), await readFile(join(directory, 'src', name)));
  }
});

test('a v5 checkpoint build runs while sources are missing and is replaced by v6 without any removed file', async context => {
  const directory = await fixture(context);
  const output = join(directory, 'dist');
  const backup = join(directory, '.universe-build-previous');
  await npm(directory, 'run', 'build');
  await rename(output, backup);
  await asOlderBuild(backup, 'Universe local build v5\n');
  await rename(join(directory, 'src'), join(directory, 'unavailable-src'));
  await npm(directory, 'run', 'build', '--', '--if-missing');
  assert.equal(await readFile(join(output, '.universe-build'), 'utf8'), 'Universe local build v5\n');
  assert.equal(await readFile(join(output, 'checkpoint-store.mjs'), 'utf8'), 'previous build file');
  await rename(join(directory, 'unavailable-src'), join(directory, 'src'));
  await npm(directory, 'run', 'build', '--', '--if-missing');
  assert.equal(await readFile(join(output, '.universe-build'), 'utf8'), 'Universe local build v6\n');
  const names = await readdir(output, { recursive: true });
  for (const file of [...removedFiles, 'classes', 'integration']) {
    assert.ok(!names.includes(file), `${file} must not survive in the v6 build`);
  }
  for (const file of ['server.mjs', 'launcher.mjs', 'LauncherLog.mjs', 'child.mjs', 'child-watchdog.mjs', 'r2.mjs', 'sync/ProfileSync.mjs', 'sync/SyncSettings.mjs']) {
    assert.deepEqual(await readFile(join(output, file)), await readFile(join(directory, 'src', file)));
  }
  assert.deepEqual((await readdir(directory)).filter(name => name.startsWith('.universe-build')), ['.universe-build-owners']);
});

test('npm start prepares a missing build and shuts down using the project settings and bundled child', async context => {
  const directory = await fixture(context);
  const socket = createServer();
  await new Promise((listening, reject) => socket.once('error', reject).listen(0, '127.0.0.1', listening));
  const { port } = socket.address();
  await new Promise(closed => socket.close(closed));
  await writeFile(join(directory, '.env'), `UNIVERSE_PORT=${port}\n`);
  const local = join(directory, 'local');
  const config = join(local, 'config.yaml');
  const data = join(local, 'data');
  await writeFile(config, JSON.stringify({ port }));
  await mkdir(data);
  await mkdir(join(directory, 'node_modules/sillytavern'), { recursive: true });
  await writeFile(join(directory, 'node_modules/sillytavern/server.js'), 'process.exit(21)');
  const { stdout } = await npm(directory, 'start');
  assert.ok(stdout.includes(`http://127.0.0.1:${port}/`));
  assert.ok(stdout.includes('[universe] Cloud save is not configured.'));
  const observed = JSON.parse(await readFile(join(data, 'observed.json')));
  assert.equal(observed.cwd, join(directory, 'dist/node_modules/sillytavern'));
  assert.equal(observed.config, config);
  assert.equal(observed.data, data);
  assert.equal(observed.status.phase, SyncPhase.Disabled);
  assert.equal(observed.status.error, 'Cloud save is not configured.');
  assert.equal(observed.status.ok, false);
  const logged = (await readFile(join(local, 'logs', 'launcher.log'), 'utf8')).trimEnd().split('\n');
  assert.deepEqual(logged.map(entry => entry.slice(entry.indexOf(' ') + 1)), [`http://127.0.0.1:${port}/`, '[universe] Cloud save is not configured.']);
  await rm(join(data, 'observed.json'));
  await rename(join(directory, 'src'), join(directory, 'unavailable-src'));
  assert.ok((await npm(directory, 'start')).stdout.includes(`http://127.0.0.1:${port}/`));
  assert.equal(JSON.parse(await readFile(join(data, 'observed.json'))).status.phase, SyncPhase.Disabled);
  await assert.rejects(stat(join(local, 'data.universe')), { code: 'ENOENT' });
});

test('rebuilds only publish completed application files from locked inputs', async context => {
  const directory = await fixture(context);
  const output = join(directory, 'dist');
  const privateFile = 'private-story.json';
  for (const path of ['local/data', 'tests/fixtures', 'src', 'node_modules/sillytavern']) {
    await mkdir(join(directory, path), { recursive: true });
    await writeFile(join(directory, path, privateFile), 'private');
  }
  await writeFile(join(directory, '.env'), 'private');
  await npm(directory, 'run', 'build');
  const names = await readdir(output, { recursive: true });
  assert.ok(names.includes('server.mjs'));
  assert.ok(names.includes('sync/ProfileSync.mjs'));
  assert.ok(names.includes('node_modules/sillytavern/node_modules/express/package.json'));
  assert.ok(!names.some(name => name.endsWith(privateFile) || ['.env', 'tests', 'local'].includes(name)));
  assert.ok(!names.some(name => [...removedFiles, 'classes', 'integration'].includes(name)));
  const entry = join(output, 'server.mjs');
  const original = await readFile(entry, 'utf8');
  const updated = original + '\n';
  await writeFile(join(directory, 'src/server.mjs'), updated);
  await npm(directory, 'run', 'build', '--', '--if-missing');
  assert.equal(await readFile(entry, 'utf8'), original);
  await npm(directory, 'run', 'build');
  assert.equal(await readFile(entry, 'utf8'), updated);

  const syncModule = join(output, 'sync/ProfileSync.mjs');
  await rm(syncModule);
  await npm(directory, 'run', 'build', '--', '--if-missing');
  assert.ok((await stat(syncModule)).isFile());

  const lockfile = join(directory, 'package-lock.json');
  const validLock = await readFile(lockfile);
  await writeFile(lockfile, 'invalid lock');
  await assert.rejects(npm(directory, 'run', 'build'), /npm ci failed/);
  assert.equal(await readFile(entry, 'utf8'), updated);
  assert.deepEqual((await readdir(directory)).filter(name => name.startsWith('.universe-build-')), ['.universe-build-owners']);
  await npm(directory, 'run', 'build', '--', '--if-missing');
  await writeFile(lockfile, validLock);
  await writeFile(join(directory, 'src/server.mjs'), original);
  await npm(directory, 'run', 'build');
  assert.equal(await readFile(entry, 'utf8'), original);
  await writeFile(join(output, '.universe-build'), 'unrecognized output');
  await assert.rejects(npm(directory, 'run', 'build'), /Unrecognized dist output/);
  assert.equal(await readFile(join(output, '.universe-build'), 'utf8'), 'unrecognized output');
  assert.equal(await readFile(entry, 'utf8'), original);
});

test('npm start restores the single complete legacy backup and preserves ambiguous candidates', async context => {
  const directory = await fixture(context);
  const source = join(directory, 'src/server.mjs');
  const good = 'console.log("legacy build launched");\n';
  await writeFile(source, good);
  await npm(directory, 'run', 'build');
  const interrupted = await mkdtemp(join(directory, '.universe-build-'));
  const previous = join(interrupted, 'previous');
  const output = join(directory, 'dist');
  await rename(output, previous);
  await asOlderBuild(previous, 'Universe local build v1\n');
  await mkdir(join(directory, '.universe-build-lock'));
  await writeFile(join(interrupted, 'keep'), 'unrelated contents');
  await rename(join(directory, 'src'), join(directory, 'unavailable-src'));
  await writeFile(join(directory, 'package-lock.json'), 'fresh installation is impossible');
  const ambiguous = await mkdtemp(join(directory, '.universe-build-'));
  await cp(previous, join(ambiguous, 'previous'), { recursive: true });
  await assert.rejects(npm(directory, 'start'), /Cannot identify a single interrupted legacy build/);
  for (const candidate of [interrupted, ambiguous]) {
    assert.equal(await readFile(join(candidate, 'previous/server.mjs'), 'utf8'), good);
  }
  await rename(join(ambiguous, 'previous'), join(ambiguous, 'preserved'));
  assert.match((await npm(directory, 'start')).stdout, /legacy build launched/);
  assert.equal(await readFile(join(output, 'server.mjs'), 'utf8'), good);
  assert.equal(await readFile(join(interrupted, 'keep'), 'utf8'), 'unrelated contents');
});

test('a live publisher retains ownership and npm start recovers its exact previous build after termination', async context => {
  const directory = await fixture(context);
  const source = join(directory, 'src/server.mjs');
  const output = join(directory, 'dist');
  const previous = join(directory, '.universe-build-previous');
  const good = 'console.log("original build launched");\n';
  const replacement = 'console.log("replacement build launched");\n';
  await writeFile(source, good);
  await npm(directory, 'run', 'build');
  await writeFile(source, replacement);
  const pauseHook = join(directory, 'pause-publisher.mjs');
  const paused = join(directory, 'paused-pid');
  await writeFile(pauseHook, `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      await rename(from, to);
      if (from === ${JSON.stringify(output)} && to === ${JSON.stringify(previous)}) {
        await fs.writeFile(${JSON.stringify(paused)}, String(process.pid));
        await new Promise(() => setInterval(() => {}, 1000));
      }
    };
    syncBuiltinESMExports();
  `);
  const publishing = execute(process.execPath, [npmCli, '--offline', 'run', 'build'], {
    cwd: directory, env: { ...npmEnvironment, NODE_OPTIONS: '--import=' + pathToFileURL(pauseHook).href }, timeout: 30_000,
  }).then(() => 0, error => error.code);
  let pid;
  try {
    for (let attempt = 0; attempt < 200 && !pid; attempt++) {
      const record = await readFile(paused, 'utf8').catch(error => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      });
      pid = Number(record);
      if (!pid) {
        await delay(25);
      }
    }
    assert.ok(pid > 0, 'publisher reached the rename before termination');
    await rename(join(directory, 'src'), join(directory, 'unavailable-src'));
    await assert.rejects(npm(directory, 'start'), /already in use/);
    assert.equal(await readFile(join(previous, 'server.mjs'), 'utf8'), good);
    await assert.rejects(stat(output), { code: 'ENOENT' });
  } finally {
    if (pid > 0) {
      process.kill(pid, 'SIGKILL');
    }
  }
  assert.notEqual(await publishing, 0);
  const lockfile = join(directory, 'package-lock.json');
  const validLock = await readFile(lockfile);
  await writeFile(lockfile, 'fresh installation is impossible');
  assert.match((await npm(directory, 'start')).stdout, /original build launched/);
  assert.equal(await readFile(join(output, 'server.mjs'), 'utf8'), good);
  await rename(join(directory, 'unavailable-src'), join(directory, 'src'));
  await writeFile(lockfile, validLock);
  await npm(directory, 'run', 'build');
  assert.match((await npm(directory, 'start')).stdout, /replacement build launched/);
});

test('startup with no application sources rejects linked owner records and backup markers', async context => {
  const directory = await fixture(context);
  const output = join(directory, 'dist');
  const backup = join(directory, '.universe-build-previous');
  const good = 'console.log("verified backup launched");\n';
  await writeFile(join(directory, 'src/server.mjs'), good);
  await npm(directory, 'run', 'build');
  await rename(output, backup);
  await rename(join(directory, 'src'), join(directory, 'unavailable-src'));

  const released = join(directory, '.universe-build-owners/owner-1/released');
  const marker = join(backup, '.universe-build');
  for (const file of [released, marker]) {
    const preserved = join(directory, 'preserved-file');
    await rename(file, preserved);
    await symlink(preserved, file);
    await assert.rejects(npm(directory, 'start'), /Unsafe build file/);
    await assert.rejects(stat(output), { code: 'ENOENT' });
    assert.equal(await readFile(join(backup, 'server.mjs'), 'utf8'), good);
    await rm(file);
    await rename(preserved, file);
  }
  assert.match((await npm(directory, 'start')).stdout, /verified backup launched/);
  assert.equal(await readFile(join(output, 'server.mjs'), 'utf8'), good);
});
