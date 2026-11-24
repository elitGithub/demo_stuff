import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const Security = Object.freeze({
  MaxBodyBytes: 256 * 1024,

  SecurityHeaders: Object.freeze({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; form-action 'none'",
  }),

  /**
   * @returns {string}
   */
  generateCsrfToken() {
    return randomBytes(32).toString('hex');
  },

  /**
   * @param {unknown} hostHeader
   * @param {number} port
   * @returns {boolean}
   */
  isValidLoopbackHost(hostHeader, port) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return false;
    }
    if (typeof hostHeader !== 'string') {
      return false;
    }
    const normalizedHost = hostHeader.trim().toLowerCase();
    return normalizedHost === `127.0.0.1:${port}` || normalizedHost === `localhost:${port}`;
  },

  /**
   * @param {unknown} originHeader
   * @param {number} port
   * @returns {boolean}
   */
  isValidLoopbackOrigin(originHeader, port) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return false;
    }
    if (typeof originHeader !== 'string') {
      return false;
    }
    const normalizedOrigin = originHeader.trim().toLowerCase();
    return normalizedOrigin === `http://127.0.0.1:${port}` || normalizedOrigin === `http://localhost:${port}`;
  },

  /**
   * @param {unknown} receivedHeader
   * @param {unknown} expectedToken
   * @returns {boolean}
   */
  isValidCsrfToken(receivedHeader, expectedToken) {
    if (typeof receivedHeader !== 'string' || typeof expectedToken !== 'string') {
      return false;
    }
    if (receivedHeader.length === 0 || expectedToken.length === 0) {
      return false;
    }
    const receivedBuffer = Buffer.from(receivedHeader, 'utf8');
    const expectedBuffer = Buffer.from(expectedToken, 'utf8');
    if (receivedBuffer.length === 0 || receivedBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return timingSafeEqual(receivedBuffer, expectedBuffer);
  },

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {{maxBytes?: number, allowEmpty?: boolean}} [options]
   * @returns {Promise<Record<string, unknown>>}
   * @throws {Error}
   */
  readJsonBody(request, { maxBytes = Security.MaxBodyBytes, allowEmpty = false } = {}) {
    if (request === null || typeof request !== 'object' || typeof request.on !== 'function') {
      return Promise.reject(new TypeError('request must be a readable HTTP request stream.'));
    }
    if (!Number.isInteger(maxBytes) || maxBytes < 0) {
      return Promise.reject(new RangeError('maxBytes must be a non-negative integer.'));
    }
    if (typeof allowEmpty !== 'boolean') {
      return Promise.reject(new TypeError('allowEmpty must be a boolean.'));
    }

    /**
     * @param {number} statusCode
     * @param {string} message
     * @returns {Error}
     */
    const createBodyError = (statusCode, message) => {
      const bodyError = new Error(message);
      bodyError.statusCode = statusCode;
      return bodyError;
    };

    const rawContentLength = request.headers?.['content-length'];
    if (rawContentLength !== undefined) {
      if (typeof rawContentLength !== 'string' || !/^\d+$/.test(rawContentLength.trim())) {
        return Promise.reject(createBodyError(400, 'Invalid Content-Length header.'));
      }
      const declaredLength = Number.parseInt(rawContentLength.trim(), 10);
      if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
        return Promise.reject(createBodyError(413, 'Request body exceeds maximum allowed size.'));
      }
    }

    if (request.aborted || request.destroyed) {
      const abortError = new Error('Request stream was aborted.');
      abortError.name = 'AbortError';
      abortError.statusCode = 400;
      return Promise.reject(abortError);
    }

    return new Promise((resolve, reject) => {
      const chunks = [];
      let totalBytes = 0;
      let settled = false;

      /**
       * @returns {void}
       */
      const cleanup = () => {
        request.off('data', onData);
        request.off('end', onEnd);
        request.off('aborted', onAborted);
        request.off('error', onError);
        request.off('close', onClose);
      };

      /**
       * @param {Buffer | string} chunk
       * @returns {void}
       */
      const onData = (chunk) => {
        if (settled) {
          return;
        }
        const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += chunkBuffer.length;
        if (totalBytes > maxBytes) {
          settled = true;
          cleanup();
          if (typeof request.pause === 'function') {
            request.pause();
          }
          reject(createBodyError(413, 'Request body exceeds maximum allowed size.'));
          return;
        }
        chunks.push(chunkBuffer);
      };

      /**
       * @returns {void}
       */
      const onEnd = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        const rawText = Buffer.concat(chunks).toString('utf8');
        if (rawText.trim().length === 0) {
          if (allowEmpty) {
            resolve({});
            return;
          }
          reject(createBodyError(400, 'Request body must not be empty.'));
          return;
        }
        let parsedBody;
        try {
          parsedBody = JSON.parse(rawText);
        } catch {
          reject(createBodyError(400, 'Malformed JSON request body.'));
          return;
        }
        if (parsedBody === null || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
          reject(createBodyError(400, 'Request body must be a JSON object.'));
          return;
        }
        resolve(parsedBody);
      };

      /**
       * @returns {void}
       */
      const onAborted = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        const abortError = new Error('Request stream was aborted.');
        abortError.name = 'AbortError';
        abortError.statusCode = 400;
        reject(abortError);
      };

      /**
       * @param {Error} streamError
       * @returns {void}
       */
      const onError = (streamError) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        const rejectionError = streamError instanceof Error ? streamError : new Error(String(streamError));
        if (!Number.isInteger(rejectionError.statusCode)) {
          rejectionError.statusCode = 400;
        }
        reject(rejectionError);
      };

      /**
       * @returns {void}
       */
      const onClose = () => {
        if (settled || request.complete) {
          return;
        }
        settled = true;
        cleanup();
        const abortError = new Error('Request stream closed before completion.');
        abortError.name = 'AbortError';
        abortError.statusCode = 400;
        reject(abortError);
      };

      request.on('data', onData);
      request.on('end', onEnd);
      request.on('aborted', onAborted);
      request.on('error', onError);
      request.on('close', onClose);
    });
  },

  /**
   * @param {string} publicDir
   * @param {string} urlPathname
   * @returns {Readonly<{filePath: string, contentType: string}> | null}
   */
  resolveStaticFile(publicDir, urlPathname) {
    if (typeof publicDir !== 'string' || publicDir.trim().length === 0) {
      return null;
    }
    if (
      typeof urlPathname !== 'string' ||
      urlPathname.includes('\0') ||
      urlPathname.includes('\\') ||
      /%2f/i.test(urlPathname) ||
      /%5c/i.test(urlPathname)
    ) {
      return null;
    }

    let decodedPathname;
    try {
      decodedPathname = decodeURIComponent(urlPathname);
    } catch {
      return null;
    }

    if (decodedPathname.includes('\0') || decodedPathname.includes('\\')) {
      return null;
    }

    const segments = decodedPathname.split('/');
    if (segments.some((segment) => segment === '..')) {
      return null;
    }

    const relativePath = decodedPathname.replace(/^\/+/, '');
    if (relativePath.length === 0) {
      return null;
    }

    const rootDir = path.resolve(publicDir);
    const rootPrefix = rootDir.endsWith(path.sep) ? rootDir : `${rootDir}${path.sep}`;
    const resolvedPath = path.resolve(rootDir, relativePath);
    if (!resolvedPath.startsWith(rootPrefix)) {
      return null;
    }

    let realRootDir;
    let realFilePath;
    let fileStats;
    try {
      realRootDir = fs.realpathSync(rootDir);
      realFilePath = fs.realpathSync(resolvedPath);
      const realRootPrefix = realRootDir.endsWith(path.sep) ? realRootDir : `${realRootDir}${path.sep}`;
      if (!realFilePath.startsWith(realRootPrefix)) {
        return null;
      }
      fileStats = fs.statSync(realFilePath);
    } catch {
      return null;
    }

    if (!fileStats.isFile()) {
      return null;
    }

    const extension = path.extname(realFilePath).toLowerCase();
    let contentType;
    switch (extension) {
      case '.html': {
        contentType = 'text/html; charset=utf-8';
        break;
      }
      case '.css': {
        contentType = 'text/css; charset=utf-8';
        break;
      }
      case '.mjs':
      case '.js': {
        contentType = 'application/javascript; charset=utf-8';
        break;
      }
      case '.json': {
        contentType = 'application/json; charset=utf-8';
        break;
      }
      case '.svg': {
        contentType = 'image/svg+xml';
        break;
      }
      case '.png': {
        contentType = 'image/png';
        break;
      }
      case '.jpg':
      case '.jpeg': {
        contentType = 'image/jpeg';
        break;
      }
      case '.webp': {
        contentType = 'image/webp';
        break;
      }
      case '.ico': {
        contentType = 'image/x-icon';
        break;
      }
      case '.txt': {
        contentType = 'text/plain; charset=utf-8';
        break;
      }
      default: {
        contentType = 'application/octet-stream';
        break;
      }
    }

    return Object.freeze({
      filePath: realFilePath,
      contentType,
    });
  },

  /**
   * @param {unknown} text
   * @param {unknown} secret
   * @returns {string}
   */
  redactSecret(text, secret) {
    const safeText = typeof text === 'string' ? text : String(text ?? '');
    if (typeof secret === 'string' && secret.length > 0) {
      return safeText.replaceAll(secret, '[REDACTED]');
    }
    return safeText;
  },
});
