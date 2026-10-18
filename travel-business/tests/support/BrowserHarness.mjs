import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { TestWorkspace } from './TestWorkspace.mjs';
import { Catalog } from '../../src/dto/Catalog.mjs';
import { SandboxConfig } from '../../src/dto/SandboxConfig.mjs';
import { SandboxRuntime } from '../../src/sandbox/SandboxRuntime.mjs';
import { ApiController } from '../../src/ApiController.mjs';

const workspace = await TestWorkspace.create();
const controlPath = workspace.path('browser-control.json');
await writeFile(controlPath, JSON.stringify({ offsetSeconds: 0, delayMilliseconds: 0 }, null, 2), { mode: 0o600 });
const initialSeconds = Math.floor(Date.now() / 1000);
let offsetSeconds = 0;
const now = () => initialSeconds + offsetSeconds;
const config = SandboxConfig.from({ maxSandboxes: 2 });
const catalog = Catalog.canonical();
const runtime = new SandboxRuntime(workspace.path('runtime'), config, catalog, now);
const publicRoot = resolve(fileURLToPath(new URL('../../public/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };
const servers = [];
let stopping = false;

/** @returns {Promise<void>} */
async function stop() {
  if (stopping) { return; }
  stopping = true;
  await Promise.all(servers.map(server => new Promise(resolveClose => { server.close(resolveClose); server.closeAllConnections(); })));
  await workspace.close();
}

try {
  for (const hostname of ['127.0.0.1', '127.0.0.2', '127.0.0.3']) {
    let controller;
    const server = createServer(async (request, response) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      try {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (pathname.startsWith('/api/')) {
          const control = JSON.parse(await readFile(controlPath, 'utf8'));
          if (!Number.isSafeInteger(control.offsetSeconds) || control.offsetSeconds < 0 || control.offsetSeconds > 31536000 || !Number.isSafeInteger(control.delayMilliseconds) || control.delayMilliseconds < 0 || control.delayMilliseconds > 5000 || Object.keys(control).some(key => !['offsetSeconds', 'delayMilliseconds'].includes(key))) { throw new TypeError('Invalid browser fixture control.'); }
          offsetSeconds = control.offsetSeconds;
          if (control.delayMilliseconds) { await delay(control.delayMilliseconds); }
          await controller.handle(request, response);
          return;
        }
        if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
        const decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
        const path = resolve(publicRoot, `.${decoded}`);
        if (!path.startsWith(publicRoot + sep) || decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(segment => segment.startsWith('.')) || !types[extname(path)] || !(await stat(path)).isFile()) { response.writeHead(404); response.end(); return; }
        response.writeHead(200, { 'Content-Type': types[extname(path)] });
        response.end(request.method === 'HEAD' ? undefined : await readFile(path));
      } catch (error) {
        if (!response.headersSent) { response.writeHead(500, { 'Content-Type': 'application/json' }); }
        response.end(JSON.stringify({ error: 'Browser fixture request failed.' }));
        console.error(error.message);
      }
    });
    servers.push(server);
    await new Promise((resolveListen, rejectListen) => { server.once('error', rejectListen); server.listen(0, hostname, resolveListen); });
    const origin = `http://${hostname}:${server.address().port}`;
    controller = new ApiController(runtime, catalog, config, origin, now);
    console.log(origin);
  }
  console.log(`Fixture: ${workspace.directory}`);
  console.log(`Control: ${controlPath}`);
  process.on('SIGINT', () => { stop().catch(error => { console.error(error.message); process.exitCode = 1; }); });
  process.on('SIGTERM', () => { stop().catch(error => { console.error(error.message); process.exitCode = 1; }); });
} catch (error) {
  await stop();
  throw error;
}
