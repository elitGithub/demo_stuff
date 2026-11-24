import { Security } from './Security.mjs';

export class SseStream {
  #request;
  #response;
  #headers;
  #abortController = new AbortController();
  #opened = false;
  #ended = false;
  #onRequestAborted;
  #onResponseClose;

  /**
   * @param {{request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, headers?: Record<string, string>}} options
   * @throws {TypeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('SseStream options must be a plain object.');
    }

    const {
      request,
      response,
      headers = Security.SecurityHeaders,
    } = options;

    if (
      request === null ||
      typeof request !== 'object' ||
      typeof request.on !== 'function' ||
      typeof request.off !== 'function'
    ) {
      throw new TypeError('request must be an HTTP IncomingMessage.');
    }
    if (
      response === null ||
      typeof response !== 'object' ||
      typeof response.on !== 'function' ||
      typeof response.off !== 'function' ||
      typeof response.writeHead !== 'function' ||
      typeof response.write !== 'function' ||
      typeof response.end !== 'function' ||
      typeof response.flushHeaders !== 'function'
    ) {
      throw new TypeError('response must be an HTTP ServerResponse.');
    }
    if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) {
      throw new TypeError('headers must be a plain object.');
    }

    this.#request = request;
    this.#response = response;
    this.#headers = { ...headers };

    this.#onRequestAborted = () => {
      if (!this.#abortController.signal.aborted) {
        this.#abortController.abort();
      }
    };
    this.#onResponseClose = () => {
      if (!this.#response.writableEnded && !this.#abortController.signal.aborted) {
        this.#abortController.abort();
      }
    };

    this.#request.on('aborted', this.#onRequestAborted);
    this.#response.on('close', this.#onResponseClose);
  }

  /**
   * @returns {AbortSignal}
   */
  get signal() {
    return this.#abortController.signal;
  }

  /**
   * @returns {void}
   * @throws {Error}
   */
  open() {
    if (this.#ended) {
      throw new Error('Cannot open an SseStream after end().');
    }
    if (this.#opened) {
      throw new Error('SseStream is already open.');
    }
    this.#opened = true;
    this.#response.writeHead(200, {
      ...this.#headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    this.#response.flushHeaders();
  }

  /**
   * @param {string} eventName
   * @param {unknown} data
   * @returns {void}
   * @throws {RangeError}
   */
  send(eventName, data) {
    if (typeof eventName !== 'string' || eventName.length === 0 || /[\r\n\0]/.test(eventName)) {
      throw new RangeError('SSE eventName must be a non-empty single-line string.');
    }
    if (
      !this.#opened ||
      this.#ended ||
      this.#response.writableEnded ||
      this.#response.destroyed ||
      this.#abortController.signal.aborted
    ) {
      return;
    }
    const serializedData = JSON.stringify(data === undefined ? null : data);
    this.#response.write(`event: ${eventName}\ndata: ${serializedData}\n\n`);
  }

  /**
   * @returns {void}
   */
  abort() {
    if (!this.#abortController.signal.aborted) {
      this.#abortController.abort();
    }
  }

  /**
   * @returns {void}
   */
  end() {
    this.#request.off('aborted', this.#onRequestAborted);
    this.#response.off('close', this.#onResponseClose);
    if (this.#ended) {
      return;
    }
    this.#ended = true;
    if (!this.#response.writableEnded && !this.#response.destroyed) {
      this.#response.end();
    }
  }
}
