import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkDirectory, claimBuild, inspect, readRegular, releaseBuild } from './build-state.mjs';

const project = dirname(import.meta.dirname);
const output = join(project, 'dist');
const previous = join(project, '.universe-build-previous');
const legacyLock = join(project, '.universe-build-lock');
const marker = '.universe-build';
const legacySignature = 'Universe local build v1\n';
const scenarioBuilderSignature = 'Universe local build v2\n';
const vocaliaSignature = 'Universe local build v3\n';
const fullProfileSignature = 'Universe local build v4\n';
const checkpointSignature = 'Universe local build v5\n';
const signature = 'Universe local build v6\n';
const checkpointSources = [
  'server.mjs', 'launcher.mjs', 'child.mjs', 'child-preload.mjs', 'checkpoint-store.mjs', 'local-session.mjs',
  'r2.mjs', 'story-files.mjs', 'classes/capture-gate.mjs', 'classes/cloud-save.mjs',
  'integration/browser-bridge.js', 'integration/pinned-hooks.mjs', 'integration/server-bridge.mjs',
];
const sources = ['server.mjs', 'launcher.mjs', 'child.mjs', 'child-watchdog.mjs', 'r2.mjs', 'wrapper-home.html', ...[
  'CloudStore.mjs', 'FileErrors.mjs', 'ProfileScan.mjs', 'ProfileSync.mjs', 'Retry.mjs', 'SaveOutcome.mjs', 'SaveReason.mjs',
  'SyncPhase.mjs', 'SyncScope.mjs', 'SyncSettings.mjs', 'SyncState.mjs',
].map(file => `sync/${file}`)];
const runtime = 'node_modules/sillytavern';
const runtimeFiles = [
  'package.json', 'server.js', 'src/server-main.js', 'public/index.html', 'public/script.js',
  'public/scripts/group-chats.js', 'public/scripts/world-info.js', 'node_modules/express/package.json',
].map(file => join(runtime, file));
const extensionDirectory = join(runtime, 'public/scripts/extensions/third-party');
const scenarioBuilder = join(extensionDirectory, 'tavernScenarioBuilder');
const vocalia = join(extensionDirectory, 'st-aspect-vocalia');
const packageInputs = ['package.json', 'package-lock.json',
  'packages/tavern-scenario-builder-1.1.0.tgz', 'packages/st-aspect-vocalia-1.0.4.tgz'];
const buildInputs = [...sources.map(file => join('src', file)), ...packageInputs];
const scenarioBuilderFiles = [
  'manifest.json', 'index.js', 'style.css', 'templates/workspace.html', 'modules/creation.js', 'modules/entries.js',
  'modules/generation.js', 'modules/state.js', 'modules/utils.js', 'modules/workspace.js',
].map(file => join(scenarioBuilder, file));
const vocaliaFiles = [join(vocalia, 'manifest.json'), join(vocalia, 'index.js')];
const fullProfileFiles = [join(runtime, 'public/scripts/personas.js'), join(runtime, 'src/endpoints/thumbnails.js')];
const legacyRequired = [...checkpointSources, ...runtimeFiles];
const scenarioBuilderRequired = [...legacyRequired, ...scenarioBuilderFiles];
const vocaliaRequired = [...scenarioBuilderRequired, ...vocaliaFiles];
const fullProfileRequired = [...vocaliaRequired, ...fullProfileFiles];
const checkpointRequired = [...fullProfileRequired, 'wrapper-home.html'];
const required = [...sources, ...runtimeFiles, ...scenarioBuilderFiles, ...vocaliaFiles, ...fullProfileFiles];
const requiredBySignature = new Map([
  [legacySignature, legacyRequired], [scenarioBuilderSignature, scenarioBuilderRequired], [vocaliaSignature, vocaliaRequired],
  [fullProfileSignature, fullProfileRequired], [checkpointSignature, checkpointRequired], [signature, required],
]);

/**
 * @param {string} directory
 * @returns {Promise<string|null>}
 */
async function buildSignature(directory) {
  const entry = inspect(directory);
  if (!entry) {
    return null;
  }
  const value = entry.isDirectory() && (await readRegular(join(directory, marker)))?.toString();
  if (!requiredBySignature.has(value)) {
    throw new Error(`Unrecognized dist output at ${directory}. Preserve it before building Universe.`);
  }
  return value;
}

/**
 * @param {string} directory
 * @param {string[]} files
 * @returns {boolean}
 */
function hasFiles(directory, files) {
  for (const file of files) {
    const path = join(directory, file);
    if (!checkDirectory(dirname(path)) || !inspect(path)?.isFile()) {
      return false;
    }
  }
  return true;
}

/**
 * @param {string} directory
 * @returns {Promise<boolean>}
 */
async function canReuse(directory) {
  const value = await buildSignature(directory);
  if (!value || (value !== signature && hasFiles(project, buildInputs))) {
    return false;
  }
  return hasFiles(directory, requiredBySignature.get(value));
}

/**
 * @param {string} source
 * @param {string} destination
 * @returns {Promise<void>}
 */
async function copyInput(source, destination) {
  const bytes = await readRegular(source);
  if (bytes === null) {
    throw new Error(`Missing build input: ${source}`);
  }
  await writeFile(destination, bytes, { flag: 'wx' });
}

/**
 * @returns {Promise<void>}
 */
async function recoverLegacyBuild() {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (!inspect(legacyLock)) {
      return;
    }
    await delay(100);
  }
  if (!checkDirectory(legacyLock) || (await readdir(legacyLock)).length) {
    throw new Error('Unrecognized build lock. Preserve it before retrying.');
  }
  const candidates = [];
  for (const entry of await readdir(project, { withFileTypes: true })) {
    if (entry.isDirectory() && /^\.universe-build-[a-zA-Z0-9]{6}$/.test(entry.name)) {
      const backup = join(project, entry.name, 'previous');
      if (await buildSignature(backup)) {
        candidates.push(backup);
      }
    }
  }
  const promoted = await buildSignature(previous);
  if (inspect(output) || candidates.length !== (promoted ? 0 : 1) ||
      !hasFiles(promoted ? previous : candidates[0], legacyRequired)) {
    throw new Error('Cannot identify a single interrupted legacy build. Preserve the build directories before retrying.');
  }
  if (!promoted) {
    await rename(candidates[0], previous);
  }
  await rmdir(legacyLock);
}

/**
 * @returns {Promise<void>}
 */
async function build() {
  const reuse = process.argv.includes('--if-missing');
  if (reuse && await canReuse(output)) {
    return;
  }
  const owner = await claimBuild(join(project, '.universe-build-owners'));
  try {
    await recoverLegacyBuild();
    if (!await buildSignature(output)) {
      const backup = await buildSignature(previous);
      if (backup) {
        if (!hasFiles(previous, requiredBySignature.get(backup))) {
          throw new Error('The previous Universe build is incomplete. Preserve it before retrying.');
        }
        await rename(previous, output);
      }
    }
    if (!reuse || !await canReuse(output)) {
      await assemble();
    }
  } finally {
    await releaseBuild(owner);
  }
}

/**
 * @returns {Promise<void>}
 */
async function assemble() {
  const temporary = await mkdtemp(join(project, '.universe-build-'));
  const next = join(temporary, 'next');
  try {
    await mkdir(join(next, 'sync'), { recursive: true });
    for (const file of sources) {
      await copyInput(join(project, 'src', file), join(next, file));
    }
    await mkdir(join(temporary, 'packages'));
    for (const file of packageInputs) {
      await copyInput(join(project, file), join(temporary, file));
    }
    const npm = spawnSync(process.execPath, [process.env.npm_execpath, 'ci', '--install-strategy=shallow',
      '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund', '--cache', join(project, 'local', 'npm-cache')], {
      cwd: temporary, stdio: 'inherit',
    });
    if (npm.error || npm.status !== 0) {
      throw npm.error ?? new Error('npm ci failed while assembling the locked runtime.');
    }
    await rename(join(temporary, 'node_modules'), join(next, 'node_modules'));
    await mkdir(join(next, extensionDirectory), { recursive: true });
    await rename(join(next, 'node_modules/tavern-scenario-builder'), join(next, scenarioBuilder));
    await rename(join(next, 'node_modules/st-aspect-vocalia'), join(next, vocalia));
    if (!hasFiles(next, required)) {
      throw new Error('Incomplete Universe build. A required entry point is missing.');
    }
    await writeFile(join(next, marker), signature, { flag: 'wx' });
    if (await buildSignature(previous)) {
      await rename(previous, join(temporary, 'retired'));
    }
    const replacing = await buildSignature(output);
    if (replacing) {
      await rename(output, previous);
    }
    try {
      await rename(next, output);
    } catch (error) {
      if (replacing && !inspect(output)) {
        await rename(previous, output);
      }
      throw error;
    }
    if (replacing) {
      await rename(previous, join(temporary, 'replaced'));
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

build().catch(error => {
  console.error(`[universe] ${error.message}`);
  process.exitCode = 1;
});
