import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createStore } from '../src/store.mjs';
import { destinations, journeys } from '../src/data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const value = (flag, fallback) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : fallback; };
const output = resolve(value('--output', join(root, 'storage', 'travel-demo')));
const origin = value('--origin', 'https://demo-sites.infinityfree.me');
const basePath = '/travel-agency-demo';
if (new URL(origin).origin !== origin) throw new Error('Origin must be a complete HTTP(S) origin without a trailing slash.');
if (!/^https?:/.test(origin)) throw new Error('Unsupported origin.');
try { if ((await readdir(output)).length) throw new Error('Output directory must be new or empty.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const build = spawnSync(process.execPath, [join(root, 'build.mjs')], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) throw new Error('Site build failed.');
const site = join(output, 'htdocs', basePath);
const privateDir = join(site, 'private');
await mkdir(privateDir, { recursive: true });
await cp(join(root, 'public'), site, { recursive: true });
for (const file of await readdir(site)) {
  if (!file.endsWith('.html')) continue;
  const page = await readFile(join(site, file), 'utf8');
  await writeFile(join(site, file), page.replace('<head>', '<head><meta name="api-endpoint" content="api.php">'));
}
await cp(join(root, 'deploy/infinityfree/website.htaccess'), join(site, '.htaccess'));
await cp(join(root, 'deploy/infinityfree/api.php'), join(privateDir, 'api.php'));
await writeFile(join(privateDir, '.htaccess'), 'Require all denied\n');
await writeFile(join(site, 'api.php'), "<?php\ndeclare(strict_types=1);\nrequire __DIR__.'/private/api.php';\n");
await writeFile(join(privateDir, 'config.php'), `<?php\nreturn ['origin' => ${JSON.stringify(origin)}, 'base_path' => '${basePath}'];\n`);
const seedPath = join(output, 'seed-build.sqlite');
const store = createStore(seedPath);
const seed = store.overview();
store.close();
const seedDB = new DatabaseSync(seedPath);
const schema = seedDB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.sql.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ') + ';').join('\n');
seedDB.close();
await writeFile(join(privateDir, 'schema.sql'), schema + '\nCREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires INTEGER NOT NULL);\n');
await writeFile(join(privateDir, 'seed.json'), JSON.stringify({ enquiries: seed.enquiries, bookings: seed.bookings }));
await writeFile(join(privateDir, 'catalog.json'), JSON.stringify({ destinations: destinations.map(({ id, name }) => ({ id, name })), journeys: journeys.map(({ id, title, destination, price }) => ({ id, title, destination, price })) }));
await cp(join(root, 'deploy/infinityfree/root-index.html'), join(output, 'htdocs', 'index.html'));
const zip = spawnSync('python3', ['-c', 'import pathlib,sys,zipfile; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(root.parent/"travel-demo.zip","w",zipfile.ZIP_DEFLATED); [z.write(p,p.relative_to(root)) for p in sorted(root.rglob("*")) if p.is_file()]; z.close()', join(output, 'htdocs')], { stdio: 'inherit' });
if (zip.status !== 0) throw new Error('Archive creation failed.');
console.log(`Prepared ${output}/travel-demo.zip for ${origin}${basePath}/`);
