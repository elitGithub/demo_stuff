import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { constants, mkdir, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const Settings = Object.freeze({
    Port: 8766,
    Host: '127.0.0.1',
    AllowedHosts: Object.freeze(['localhost:8766', '127.0.0.1:8766']),
    AllowedOrigins: Object.freeze(['http://localhost:8766', 'http://127.0.0.1:8766']),
    AllowedMethods: Object.freeze(['GET', 'POST']),
    MaxBodyBytes: 30000000,
    MaxSegments: 3,
    HomePath: '/',
    HomeTarget: '/bench/adopt.html',
    PageFolders: Object.freeze(['bench', 'core']),
    PrivateFolder: 'private',
    PageName: /^[A-Za-z][A-Za-z0-9.-]{0,80}\.(html|js|css)$/,
    DataName: /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(json|txt)$/,
    UnsafePath: /\.\.|\\|\0/,
    TempPrefix: '.tmp-',
    TempBytes: 12,
    FolderMode: 0o700,
    FileMode: 0o600,
    HtmlType: 'text/html; charset=utf-8',
    HtmlHeaders: Object.freeze({
        'Content-Security-Policy':
            "default-src 'self'; connect-src 'self' https://openrouter.ai; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        'X-Frame-Options': 'DENY',
    }),
    GoneCodes: Object.freeze(['ENOENT', 'ENOTDIR', 'ELOOP']),
    JsonType: 'application/json; charset=utf-8',
    TextType: 'text/plain; charset=utf-8',
    Types: Object.freeze({
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8',
    }),
    Headers: Object.freeze({
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    }),
    Messages: Object.freeze({
        400: 'Bad request',
        403: 'Forbidden',
        404: 'Not found',
        405: 'Method not allowed',
        413: 'Body too large',
        500: 'Server error',
    }),
});

/**
 * @param {object} response
 * @param {number} status
 * @param {string} type
 * @param {string|Buffer} body
 * @param {object} extra
 * @return {void}
 */
function send(response, status, type, body, extra = {}) {
    response.writeHead(status, { ...Settings.Headers, 'Content-Type': type, ...extra });
    response.end(body);
}

/**
 * @param {object} response
 * @param {number} status
 * @return {void}
 */
function fail(response, status) {
    send(response, status, Settings.TextType, Settings.Messages[status]);
}

/**
 * @param {string} filePath
 * @return {Promise<Buffer|null>}
 * @throws {Error}
 */
async function readRegular(filePath) {
    let descriptor;
    try {
        descriptor = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
        if (Settings.GoneCodes.includes(error.code)) {
            return null;
        }
        throw error;
    }
    try {
        const stats = await descriptor.stat();
        if (!stats.isFile()) {
            return null;
        }
        return await descriptor.readFile();
    } finally {
        await descriptor.close();
    }
}

/**
 * @param {object} response
 * @param {string} folder
 * @param {string} name
 * @return {Promise<void>}
 * @throws {Error}
 */
async function serveFile(response, folder, name) {
    const content = await readRegular(path.join(folder, name));
    if (content === null) {
        fail(response, 404);
        return;
    }
    const type = Settings.Types[path.extname(name)];
    send(response, 200, type, content, type === Settings.HtmlType ? Settings.HtmlHeaders : {});
}

/**
 * @param {object} response
 * @param {string} folder
 * @return {Promise<void>}
 * @throws {Error}
 */
async function serveListing(response, folder) {
    let entries;
    try {
        entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
            throw error;
        }
        entries = [];
    }
    const names = entries
        .filter(
            /**
             * @param {object} entry
             * @return {boolean}
             */
            (entry) => entry.isFile() && Settings.DataName.test(entry.name),
        )
        .map(
            /**
             * @param {object} entry
             * @return {string}
             */
            (entry) => entry.name,
        )
        .sort();
    send(response, 200, Settings.JsonType, JSON.stringify(names));
}

/**
 * @param {object} request
 * @return {Promise<Buffer|null>}
 */
async function readBody(request) {
    const declared = Number(request.headers['content-length']);
    if (declared > Settings.MaxBodyBytes) {
        return null;
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of request) {
        total += chunk.length;
        if (total > Settings.MaxBodyBytes) {
            return null;
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

/**
 * @param {object} request
 * @param {object} response
 * @param {string} folder
 * @param {string} name
 * @return {Promise<void>}
 * @throws {Error}
 */
async function saveFile(request, response, folder, name) {
    const body = await readBody(request);
    if (body === null) {
        fail(response, 413);
        return;
    }
    await mkdir(folder, { recursive: true, mode: Settings.FolderMode });
    const temporary = path.join(folder, `${Settings.TempPrefix}${randomBytes(Settings.TempBytes).toString('hex')}`);
    try {
        await writeFile(temporary, body, { mode: Settings.FileMode, flag: 'wx' });
        await rename(temporary, path.join(folder, name));
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
    send(response, 200, Settings.JsonType, JSON.stringify({ saved: name, bytes: body.length }));
}

/**
 * @param {object} request
 * @param {object} response
 * @param {string} root
 * @return {Promise<void>}
 */
export async function handle(request, response, root) {
    try {
        if (!Settings.AllowedHosts.includes(request.headers.host)) {
            fail(response, 403);
            return;
        }
        if (!Settings.AllowedMethods.includes(request.method)) {
            fail(response, 405);
            return;
        }
        const isPost = request.method === 'POST';
        if (isPost && !Settings.AllowedOrigins.includes(request.headers.origin)) {
            fail(response, 403);
            return;
        }
        let decoded;
        try {
            decoded = decodeURIComponent(request.url.split('?')[0]);
        } catch {
            fail(response, 400);
            return;
        }
        const segments = decoded.split('/');
        if (Settings.UnsafePath.test(decoded) || segments.length > Settings.MaxSegments) {
            fail(response, 400);
            return;
        }
        const isGet = request.method === 'GET';
        if (isGet && decoded === Settings.HomePath) {
            send(response, 302, Settings.TextType, '', { Location: Settings.HomeTarget });
            return;
        }
        const [lead, area, name] = segments;
        if (lead !== '' || name === undefined) {
            fail(response, 404);
            return;
        }
        if (isGet && Settings.PageFolders.includes(area) && Settings.PageName.test(name)) {
            await serveFile(response, path.join(root, area), name);
            return;
        }
        if (area === Settings.PrivateFolder) {
            const folder = path.join(root, Settings.PrivateFolder);
            if (isGet && name === '') {
                await serveListing(response, folder);
                return;
            }
            if (Settings.DataName.test(name)) {
                if (isPost) {
                    await saveFile(request, response, folder, name);
                    return;
                }
                if (isGet) {
                    await serveFile(response, folder, name);
                    return;
                }
            }
        }
        fail(response, 404);
    } catch {
        try {
            if (!response.headersSent) {
                fail(response, 500);
            }
        } catch {
            return;
        }
    }
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && (await realpath(process.argv[1])) === (await realpath(modulePath))) {
    const root = path.resolve(path.dirname(modulePath), '..');
    createServer(
        /**
         * @param {object} request
         * @param {object} response
         * @return {Promise<void>}
         */
        (request, response) =>
            handle(request, response, root).catch(
                /**
                 * @return {void}
                 */
                () => {
                    response.destroy();
                },
            ),
    ).listen(
        Settings.Port,
        Settings.Host,
        /**
         * @return {void}
         */
        () => {
            console.log(`Scribe bench: http://localhost:${Settings.Port}/`);
        },
    );
}
