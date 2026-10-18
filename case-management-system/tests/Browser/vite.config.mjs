import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import original from '../../vite.config.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = resolve(project, 'storage/framework/testing/css-audit-20261018');
const buildName = process.env.CASEFILE_AUDIT_BUILD;

if (!/^(?:baseline|final-[0-9]{2})$/.test(buildName ?? '')) {
    throw new Error('Set a valid CASEFILE_AUDIT_BUILD.');
}

const outDir = resolve(runtime, 'public/build', buildName);
for (const path of [runtime, resolve(runtime, 'public'), resolve(runtime, 'private/environment')]) {
    if (realpathSync(path) !== path) {
        throw new Error(`Audit path contains a symlink: ${path}`);
    }
}
if (existsSync(outDir)) {
    throw new Error(`Audit output already exists: ${outDir}`);
}

export default mergeConfig(original, {
    envDir: resolve(runtime, 'private/environment'),
    cacheDir: resolve(runtime, 'private/vite-cache'),
    publicDir: false,
    base: `/build/${buildName}/`,
    build: { outDir, emptyOutDir: false, manifest: 'manifest.json' },
});
