import { ReplyRetrySettings } from './ReplyRetrySettings.js';

export const ReplyRetry = Object.freeze({
  /**
   * @param {function(RequestInfo|URL, RequestInit=): Promise<Response>} send
   * @param {{wait: function(number, AbortSignal=): Promise<void>, notify: function(string): void}} handlers
   * @returns {function(RequestInfo|URL, RequestInit=): Promise<Response>}
   * @throws {TypeError}
   */
  wrap(send, { wait, notify }) {
    const { Endpoint, DelaysMs, RetryStatuses, RetryReasons } = ReplyRetrySettings;

    /**
     * @param {RequestInfo|URL} input
     * @param {RequestInit} [options]
     * @returns {Promise<Response>}
     * @throws {*}
     */
    async function sendWithRetry(input, options) {
      const address = input instanceof URL ? input.href : input;
      const retryable = typeof address === 'string' && options?.method?.toUpperCase() === 'POST' &&
        (URL.canParse(address) ? new URL(address).pathname : address.split(/[?#]/, 1)[0]) === Endpoint;
      if (!retryable) {
        return send(input, options);
      }
      for (let attempt = 1; ; attempt++) {
        const final = attempt > DelaysMs.length;
        let response = null;
        let reason = null;
        try {
          response = await send(input, options);
        } catch (error) {
          if (final || options.signal?.aborted) {
            throw error;
          }
          reason = error instanceof Error ? error.message : String(error);
        }
        if (response !== null) {
          if (final) {
            return response;
          }
          if (RetryStatuses.includes(response.status)) {
            reason = `HTTP ${response.status}`;
          } else if (response.status === 200 &&
              response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() === 'application/json') {
            let answer = null;
            try {
              answer = JSON.parse(await response.clone().text());
            } catch (error) {
              if (!(error instanceof SyntaxError)) {
                throw error;
              }
            }
            const message = answer?.error?.message;
            if (answer?.quota_error !== true && RetryReasons.includes(message)) {
              reason = message;
            }
          }
          if (reason === null) {
            return response;
          }
        }
        notify(`Reply failed (${reason}). Retrying ${attempt} of ${DelaysMs.length}...`);
        await wait(DelaysMs[attempt - 1], options.signal);
      }
    }

    return sendWithRetry;
  },
});
