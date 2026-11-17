import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, constants, mkdir, mkdtemp, open, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { handle, Settings } from '../scribe/bench/serve.mjs';

const goodHost = 'localhost:8766';
const goodOrigin = 'http://localhost:8766';
const scriptText = 'export const marker = 1;\n';
const pageText = '<!doctype html><title>bench</title>\n';
const policy =
    "default-src 'self'; connect-src 'self' https://openrouter.ai; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * @param {Function} body
 * @return {Promise<void>}
 */
async function withRoot(body) {
    const base = await mkdtemp(path.join(tmpdir(), 'scribe-serve-'));
    const root = path.join(base, 'root');
    await mkdir(path.join(root, 'core'), { recursive: true });
    await mkdir(path.join(root, 'bench'), { recursive: true });
    await writeFile(path.join(root, 'core', 'ScribeText.js'), scriptText);
    await writeFile(path.join(root, 'bench', 'adopt.html'), pageText);
    try {
        await body(root, base);
    } finally {
        await rm(base, { recursive: true, force: true });
    }
}

/**
 * @param {string} root
 * @param {object} options
 * @return {Promise<{ status: number, headers: object, body: Buffer, pulled: boolean }>}
 */
async function call(root, options) {
    const state = { pulled: false };
    const chunks = options.chunks ?? [];
    const request = {
        method: options.method ?? 'GET',
        url: options.url,
        headers: 'headers' in options ? options.headers : { host: goodHost, origin: goodOrigin },
        async *[Symbol.asyncIterator]() {
            state.pulled = true;
            if (options.source !== undefined) {
                yield* options.source();
                return;
            }
            for (const chunk of chunks) {
                yield chunk;
            }
        },
    };
    const result = { status: 0, headers: {}, body: Buffer.alloc(0) };
    const response = {
        writeHead(status, headers) {
            result.status = status;
            result.headers = headers;
        },
        end(body) {
            result.body = Buffer.from(body ?? '');
        },
    };
    await handle(request, response, root);
    return {
        status: result.status,
        headers: result.headers,
        body: result.body,
        get pulled() {
            return state.pulled;
        },
    };
}

/**
 * @param {string} root
 * @param {string} url
 * @param {string|Buffer} body
 * @param {object} extra
 * @return {Promise<*>}
 */
function post(root, url, body, extra = {}) {
    return call(root, {
        method: 'POST',
        url,
        headers: { host: goodHost, origin: goodOrigin, ...extra },
        chunks: [Buffer.from(body)],
    });
}

/**
 * @param {string} folder
 * @return {Promise<string[]>}
 */
async function tree(folder) {
    const entries = await readdir(folder, { recursive: true });
    return entries.sort();
}

/**
 * @param {string} root
 * @param {string} name
 * @param {string} text
 * @return {Promise<void>}
 */
async function seed(root, name, text) {
    await mkdir(path.join(root, 'private'), { recursive: true });
    await writeFile(path.join(root, 'private', name), text);
}

test('pages and core files are served', async () => {
    await withRoot(async (root) => {
        const script = await call(root, { url: '/core/ScribeText.js' });
        assert.equal(script.status, 200);
        assert.equal(script.headers['Content-Type'], 'text/javascript; charset=utf-8');
        assert.equal(script.body.toString(), scriptText);
        const page = await call(root, { url: '/bench/adopt.html?x=1' });
        assert.equal(page.status, 200);
        assert.equal(page.headers['Content-Type'], 'text/html; charset=utf-8');
        assert.equal(page.body.toString(), pageText);
        const home = await call(root, { url: '/' });
        assert.equal(home.status, 302);
        assert.equal(home.headers.Location, '/bench/adopt.html');
    });
});

test('every response carries the two headers', async () => {
    await withRoot(async (root) => {
        const answers = [
            [200, await call(root, { url: '/core/ScribeText.js' })],
            [302, await call(root, { url: '/' })],
            [403, await call(root, { url: '/', headers: { host: 'evil.example' } })],
            [404, await call(root, { url: '/private/missing.json' })],
            [405, await call(root, { method: 'DELETE', url: '/private/a.json' })],
            [
                413,
                await call(root, {
                    method: 'POST',
                    url: '/private/a.json',
                    headers: { host: goodHost, origin: goodOrigin, 'content-length': String(Settings.MaxBodyBytes + 1) },
                }),
            ],
        ];
        for (const [status, answer] of answers) {
            assert.equal(answer.status, status);
            assert.equal(answer.headers['Cache-Control'], 'no-store', `status ${status}`);
            assert.equal(answer.headers['X-Content-Type-Options'], 'nosniff', `status ${status}`);
        }
    });
});

test('saving and reading back', async () => {
    await withRoot(async (root) => {
        const first = 'café — 序 {"a":1}';
        const saved = await post(root, '/private/log-a.json', first);
        assert.equal(saved.status, 200);
        assert.equal(saved.headers['Content-Type'], 'application/json; charset=utf-8');
        assert.deepEqual(JSON.parse(saved.body.toString()), { saved: 'log-a.json', bytes: Buffer.byteLength(first) });
        assert.deepEqual(await tree(path.join(root, 'private')), ['log-a.json']);
        const read = await call(root, { url: '/private/log-a.json' });
        assert.equal(read.status, 200);
        assert.equal(read.body.toString('utf8'), first);
        await post(root, '/private/log-a.json', 'second');
        const again = await call(root, { url: '/private/log-a.json' });
        assert.equal(again.body.toString(), 'second');
        assert.deepEqual(await tree(path.join(root, 'private')), ['log-a.json']);
    });
});

test('the listing shows only data files', async () => {
    await withRoot(async (root) => {
        const empty = await call(root, { url: '/private/' });
        assert.equal(empty.status, 200);
        assert.deepEqual(JSON.parse(empty.body.toString()), []);
        const folder = path.join(root, 'private');
        await mkdir(path.join(folder, 'x.json'), { recursive: true });
        await writeFile(path.join(folder, 'b.txt'), 'b');
        await writeFile(path.join(folder, 'a.json'), 'a');
        await writeFile(path.join(folder, 'run.sh'), 'x');
        await writeFile(path.join(folder, '.hidden.json'), 'x');
        const listing = await call(root, { url: '/private/' });
        assert.deepEqual(JSON.parse(listing.body.toString()), ['a.json', 'b.txt']);
    });
});

test('a save must carry an allowed origin', async () => {
    await withRoot(async (root) => {
        await seed(root, 'a.json', 'old');
        const refused = [
            undefined,
            'null',
            '',
            'https://localhost:8766',
            'http://localhost:8766/',
            'http://localhost:8766.evil.example',
            'http://LOCALHOST:8766',
            'https://evil.example',
        ];
        for (const origin of refused) {
            const answer = await call(root, {
                method: 'POST',
                url: '/private/a.json',
                headers: { host: goodHost, origin },
                chunks: [Buffer.from('new')],
            });
            assert.equal(answer.status, 403, String(origin));
            assert.equal(await readFile(path.join(root, 'private', 'a.json'), 'utf8'), 'old', String(origin));
        }
        assert.deepEqual(await tree(path.join(root, 'private')), ['a.json']);
        for (const origin of ['http://localhost:8766', 'http://127.0.0.1:8766']) {
            const saved = await post(root, '/private/a.json', `ok ${origin}`, { origin });
            assert.equal(saved.status, 200, origin);
            assert.equal(await readFile(path.join(root, 'private', 'a.json'), 'utf8'), `ok ${origin}`);
        }
    });
});

test('a foreign host is refused', async () => {
    await withRoot(async (root) => {
        await seed(root, 'book.json', 'BOOK-CONTENT');
        const hosts = [
            { host: 'evil.example' },
            { host: 'localhost:9999' },
            {},
            { host: 'evil.example:8766' },
            { host: 'localhost.evil.example:8766' },
            { host: 'LOCALHOST:8766' },
            { host: 'localhost:8766.' },
            { host: '[::1]:8766' },
            { host: '127.0.0.1' },
        ];
        for (const headers of hosts) {
            for (const url of ['/private/', '/core/ScribeText.js', '/private/book.json']) {
                const answer = await call(root, { url, headers });
                assert.equal(answer.status, 403, `${JSON.stringify(headers)} ${url}`);
                assert.equal(answer.body.toString().includes('BOOK-CONTENT'), false);
            }
        }
        const allowed = await call(root, { url: '/private/book.json', headers: { host: '127.0.0.1:8766' } });
        assert.equal(allowed.status, 200);
    });
});

test('only post writes', async () => {
    await withRoot(async (root) => {
        await seed(root, 'book.json', 'keep');
        for (const method of ['OPTIONS', 'PUT', 'PATCH']) {
            const answer = await call(root, { method, url: '/private/book.json', chunks: [Buffer.from('changed')] });
            assert.equal(answer.status, 405, method);
        }
        assert.equal((await post(root, '/core/ScribeText.js', 'changed')).status, 404);
        assert.equal((await post(root, '/bench/adopt.html', 'changed')).status, 404);
        assert.equal(await readFile(path.join(root, 'private', 'book.json'), 'utf8'), 'keep');
        assert.equal(await readFile(path.join(root, 'core', 'ScribeText.js'), 'utf8'), scriptText);
        assert.equal(await readFile(path.join(root, 'bench', 'adopt.html'), 'utf8'), pageText);
        assert.deepEqual(await tree(path.join(root, 'private')), ['book.json']);
    });
});

test('a save is whole or nothing', async () => {
    await withRoot(async (root) => {
        await seed(root, 'book.json', 'OLD');
        const target = path.join(root, 'private', 'book.json');
        const before = await stat(target);
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const big = 'N'.repeat(2000000);
        const pending = call(root, {
            method: 'POST',
            url: '/private/book.json',
            headers: { host: goodHost, origin: goodOrigin },
            async *source() {
                yield Buffer.from(big.slice(0, 1000000));
                await gate;
                yield Buffer.from(big.slice(1000000));
            },
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        const during = await call(root, { url: '/private/book.json' });
        assert.equal(during.body.toString(), 'OLD');
        release();
        const saved = await pending;
        assert.equal(saved.status, 200);
        const after = await call(root, { url: '/private/book.json' });
        assert.equal(after.body.toString(), big);
        assert.notEqual((await stat(target)).ino, before.ino);

        await mkdir(path.join(root, 'private', 'dir.json'));
        await writeFile(path.join(root, 'private', 'dir.json', 'inner.txt'), 'inner');
        const failed = await post(root, '/private/dir.json', 'data');
        assert.equal(failed.status, 500);
        const names = await tree(path.join(root, 'private'));
        assert.deepEqual(names, ['book.json', 'dir.json', 'dir.json/inner.txt']);
        const listing = await call(root, { url: '/private/' });
        assert.deepEqual(JSON.parse(listing.body.toString()), ['book.json']);

        const bodyA = 'A'.repeat(1500000);
        const bodyB = 'B'.repeat(1500000);
        const [first, second] = await Promise.all([
            post(root, '/private/one.json', bodyA),
            post(root, '/private/two.json', bodyB),
        ]);
        assert.equal(first.status, 200);
        assert.equal(second.status, 200);
        assert.equal(await readFile(path.join(root, 'private', 'one.json'), 'utf8'), bodyA);
        assert.equal(await readFile(path.join(root, 'private', 'two.json'), 'utf8'), bodyB);
    });
});

test('private data is written private', async () => {
    await withRoot(async (root) => {
        await post(root, '/private/secret.json', 'x');
        assert.equal((await stat(path.join(root, 'private'))).mode & 0o777, 0o700);
        assert.equal((await stat(path.join(root, 'private', 'secret.json'))).mode & 0o777, 0o600);
        await post(root, '/private/secret.json', 'y');
        assert.equal((await stat(path.join(root, 'private', 'secret.json'))).mode & 0o777, 0o600);
    });
});

test('data names are data names', async () => {
    await withRoot(async (root) => {
        await seed(root, 'book.json', 'keep');
        const before = await tree(root);
        for (const name of ['run.js', 'page.html', 'a.sh', 'a.json.sh']) {
            assert.equal((await post(root, `/private/${name}`, 'x')).status, 404, name);
        }
        for (const method of ['GET', 'POST']) {
            const answer = await call(root, {
                method,
                url: '/private/book.json/extra',
                chunks: [Buffer.from('x')],
            });
            assert.ok([400, 404].includes(answer.status), `${method} gave ${answer.status}`);
        }
        assert.deepEqual(await tree(root), before);
        assert.equal(await readFile(path.join(root, 'private', 'book.json'), 'utf8'), 'keep');
    });
});

test('names cannot escape the folder', async () => {
    await withRoot(async (root, base) => {
        const secret = 'TOP-SECRET-MARKER';
        await writeFile(path.join(base, 'secret.js'), secret);
        await writeFile(path.join(root, 'secret.js'), secret);
        await writeFile(path.join(root, 'serve.mjs'), secret);
        await writeFile(path.join(root, 'bench', 'serve.mjs'), secret);
        await writeFile(path.join(root, 'core', 'a..b.js'), secret);
        await seed(root, 'a..b.json', secret);
        for (const url of ['/core/a..b.js', '/private/a..b.json']) {
            const answer = await call(root, { url });
            assert.equal(answer.status, 400, url);
            assert.equal(answer.body.toString().includes(secret), false, url);
        }
        const urls = [
            '/private/..%2Fserve.mjs',
            '/private/%2e%2e/serve.mjs',
            '/private/a/b.json',
            '/core/../bench/serve.mjs',
            '/bench/serve.mjs',
            '/core/..%5Csecret.js',
            '/private/a%00.json',
            '/private/%E0%A4%A.json',
        ];
        const before = await tree(base);
        for (const url of urls) {
            for (const method of ['GET', 'POST']) {
                const answer = await call(root, { method, url, chunks: [Buffer.from('payload')] });
                assert.ok([400, 404].includes(answer.status), `${method} ${url} gave ${answer.status}`);
                assert.equal(answer.body.toString().includes(secret), false, `${method} ${url}`);
            }
        }
        assert.deepEqual(await tree(base), before);
    });
});

test('links and folders are not served', async () => {
    await withRoot(async (root, base) => {
        const folder = path.join(root, 'private');
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(base, 'outside.json'), 'OUTSIDE');
        await symlink(path.join(base, 'outside.json'), path.join(folder, 'link.json'));
        await mkdir(path.join(folder, 'x.json'));
        await writeFile(path.join(folder, 'real.json'), 'real');
        const linked = await call(root, { url: '/private/link.json' });
        assert.equal(linked.status, 404);
        assert.equal(linked.body.toString().includes('OUTSIDE'), false);
        const directory = await call(root, { url: '/private/x.json' });
        assert.equal(directory.status, 404);
        const listing = await call(root, { url: '/private/' });
        assert.deepEqual(JSON.parse(listing.body.toString()), ['real.json']);
    });
});

test('a link swapped in is not followed', async () => {
    await withRoot(async (root, base) => {
        await writeFile(path.join(base, 'outside.json'), 'OUTSIDE');
        await mkdir(path.join(root, 'private'));
        await symlink(path.join(base, 'outside.json'), path.join(root, 'private', 'a.json'));
        const linked = await call(root, { url: '/private/a.json' });
        assert.equal(linked.status, 404);
        assert.equal(linked.body.toString().includes('OUTSIDE'), false);
    });
    await withRoot(async (root) => {
        await mkdir(path.join(root, 'private'));
        const pipe = path.join(root, 'private', 'a.json');
        await promisify(execFile)('mkfifo', [pipe]);
        let timer;
        const timeout = new Promise((resolve) => {
            timer = setTimeout(() => resolve('hung'), 2000);
        });
        const outcome = await Promise.race([call(root, { url: '/private/a.json' }), timeout]);
        clearTimeout(timer);
        const unblock = await open(pipe, constants.O_RDWR | constants.O_NONBLOCK);
        await unblock.close();
        assert.notEqual(outcome, 'hung');
        assert.equal(outcome.status, 404);
    });
});

test('oversized bodies are refused', async () => {
    await withRoot(async (root) => {
        const folder = path.join(root, 'private');
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, 'keep.json'), 'old');
        const declared = await call(root, {
            method: 'POST',
            url: '/private/keep.json',
            headers: { host: goodHost, origin: goodOrigin, 'content-length': String(Settings.MaxBodyBytes + 1) },
            chunks: [Buffer.from('new')],
        });
        assert.equal(declared.status, 413);
        assert.equal(declared.pulled, false);
        const piece = Buffer.alloc(10000000);
        const streamed = await call(root, {
            method: 'POST',
            url: '/private/keep.json',
            headers: { host: goodHost, origin: goodOrigin },
            chunks: [piece, piece, piece, piece],
        });
        assert.equal(streamed.status, 413);
        const fresh = await call(root, {
            method: 'POST',
            url: '/private/fresh.json',
            headers: { host: goodHost, origin: goodOrigin },
            chunks: [piece, piece, piece, piece],
        });
        assert.equal(fresh.status, 413);
        assert.deepEqual(await tree(folder), ['keep.json']);
        assert.equal(await readFile(path.join(folder, 'keep.json'), 'utf8'), 'old');
    });
});

test('the limit is exact', async () => {
    await withRoot(async (root) => {
        const piece = Buffer.alloc(10000000, 'z');
        const refused = await call(root, {
            method: 'POST',
            url: '/private/big.json',
            headers: { host: goodHost, origin: goodOrigin, 'content-length': '30000001' },
            chunks: [Buffer.from('x')],
        });
        assert.equal(refused.status, 413);
        assert.deepEqual((await readdir(root)).sort(), ['bench', 'core']);
        const streamedOver = await call(root, {
            method: 'POST',
            url: '/private/big.json',
            headers: { host: goodHost, origin: goodOrigin },
            chunks: [piece, piece, piece, Buffer.from('x')],
        });
        assert.equal(streamedOver.status, 413);
        assert.deepEqual((await readdir(root)).sort(), ['bench', 'core']);
        const exact = await call(root, {
            method: 'POST',
            url: '/private/big.json',
            headers: { host: goodHost, origin: goodOrigin, 'content-length': '30000000' },
            chunks: [piece, piece, piece],
        });
        assert.equal(exact.status, 200);
        assert.deepEqual(JSON.parse(exact.body.toString()), { saved: 'big.json', bytes: 30000000 });
        assert.equal((await stat(path.join(root, 'private', 'big.json'))).size, 30000000);
    });
});

test('content types', async () => {
    await withRoot(async (root) => {
        await writeFile(path.join(root, 'bench', 'site.css'), 'body{}');
        await seed(root, 'note.txt', 'plain');
        await seed(root, 'data.json', '{}');
        const css = await call(root, { url: '/bench/site.css' });
        assert.equal(css.headers['Content-Type'], 'text/css; charset=utf-8');
        const text = await call(root, { url: '/private/note.txt' });
        assert.equal(text.headers['Content-Type'], 'text/plain; charset=utf-8');
        const json = await call(root, { url: '/private/data.json' });
        assert.equal(json.headers['Content-Type'], 'application/json; charset=utf-8');
        const listing = await call(root, { url: '/private/' });
        assert.equal(listing.headers['Content-Type'], 'application/json; charset=utf-8');
    });
});

test('html cannot be framed', async () => {
    await withRoot(async (root) => {
        const page = await call(root, { url: '/bench/adopt.html' });
        assert.equal(page.headers['Content-Security-Policy'], policy);
        assert.equal(page.headers['X-Frame-Options'], 'DENY');
    });
});

test('other methods and paths', async () => {
    await withRoot(async (root) => {
        assert.equal((await call(root, { method: 'PUT', url: '/private/a.json' })).status, 405);
        assert.equal((await call(root, { method: 'DELETE', url: '/private/a.json' })).status, 405);
        assert.equal((await post(root, '/core/x.js', 'x')).status, 404);
        assert.equal((await post(root, '/private/', 'x')).status, 404);
        assert.equal((await post(root, '/private/bad.sh', 'x')).status, 404);
        assert.equal((await post(root, '/', 'x')).status, 404);
        assert.equal((await call(root, { url: '/private/missing.json' })).status, 404);
        assert.equal((await call(root, { url: '/other' })).status, 404);
        await assert.rejects(readdir(path.join(root, 'private')));
        await assert.rejects(readFile(path.join(root, 'core', 'x.js')));
    });
});

test('errors do not echo the request', async () => {
    await withRoot(async (root, base) => {
        await seed(root, 'locked.json', 'LOCKED');
        await chmod(path.join(root, 'private', 'locked.json'), 0o000);
        const markers = ['zzmarker', 'PURGE', 'locked', root, base, tmpdir()];
        const cases = [
            [400, { url: '/private/zzmarker/../x' }],
            [403, { url: '/core/zzmarker.js', headers: { host: 'zzmarker.example' } }],
            [
                403,
                {
                    method: 'POST',
                    url: '/private/zzmarker.json',
                    headers: { host: goodHost, origin: 'https://zzmarker.example' },
                },
            ],
            [404, { url: '/private/zzmarker.sh' }],
            [404, { url: '/zzmarker' }],
            [405, { method: 'PURGE', url: '/private/zzmarker.json' }],
            [
                413,
                {
                    method: 'POST',
                    url: '/private/zzmarker.json',
                    headers: { host: goodHost, origin: goodOrigin, 'content-length': '30000001' },
                },
            ],
        ];
        if (process.getuid() !== 0) {
            cases.push([500, { url: '/private/locked.json' }]);
        }
        for (const [status, options] of cases) {
            const answer = await call(root, options);
            assert.equal(answer.status, status);
            for (const marker of markers) {
                assert.equal(answer.body.toString().includes(marker), false, `${status} echoes ${marker}`);
            }
            assert.equal(answer.headers['Cache-Control'], 'no-store', `status ${status}`);
            assert.equal(answer.headers['X-Content-Type-Options'], 'nosniff', `status ${status}`);
        }
        await chmod(path.join(root, 'private', 'locked.json'), 0o600);
    });
});

test('handle never rejects', async () => {
    await withRoot(async (root) => {
        const request = { method: 'GET', url: '/core/ScribeText.js', headers: { host: goodHost } };
        const writes = [];
        const endThrowsOnce = {
            headersSent: false,
            writeHead() {
                writes.push('head');
                this.headersSent = true;
            },
            end() {
                writes.push('end');
                if (writes.filter((entry) => entry === 'end').length === 1) {
                    throw new Error('end failed');
                }
            },
        };
        await handle(request, endThrowsOnce, root);
        assert.deepEqual(writes, ['head', 'end']);
        const headThrows = {
            headersSent: false,
            writeHead() {
                throw new Error('head failed');
            },
            end() {},
        };
        await handle(request, headThrows, root);
    });
});

test('a missing private folder', async () => {
    await withRoot(async (root) => {
        await writeFile(path.join(root, 'private'), 'not a folder');
        const listing = await call(root, { url: '/private/' });
        assert.equal(listing.status, 200);
        assert.deepEqual(JSON.parse(listing.body.toString()), []);
        const read = await call(root, { url: '/private/a.json' });
        assert.equal(read.status, 404);
    });
});

test('the server module does not listen when imported', () => {
    assert.equal(typeof handle, 'function');
    assert.equal(process.getActiveResourcesInfo().includes('TCPServerWrap'), false);
});
