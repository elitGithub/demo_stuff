export const RetryPolicy = Object.freeze({
  DelaysMs: Object.freeze([2000, 5000, 10000]),
  RetryStatuses: Object.freeze([408, 429, 500, 502, 503, 504]),
  NonRetryStatuses: Object.freeze([401, 402, 403]),
  TransientReasons: Object.freeze([
    'Provider returned error',
    'Upstream error',
    'Overloaded',
    'Service unavailable',
    'Too Many Requests',
    'Request Timeout',
    'Internal Server Error',
    'Bad Gateway',
    'Gateway Timeout',
  ]),

  /**
   * @param {{status?: number | null, bodyText?: string | null, error?: unknown, aborted?: boolean, bytesEmitted?: number}} [input]
   * @returns {Readonly<{retryable: boolean, reason: string}>}
   * @throws {TypeError | RangeError}
   */
  classifyFailure(input = {}) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Failure details must be an object.');
    }
    const {
      status = null,
      bodyText = null,
      error = null,
      aborted = false,
      bytesEmitted = 0,
    } = input;

    if (typeof bytesEmitted !== 'number' || !Number.isFinite(bytesEmitted) || bytesEmitted < 0) {
      throw new RangeError('bytesEmitted must be a non-negative finite number.');
    }

    const hasStatus = status !== null && status !== undefined && status !== 0;
    if (hasStatus && (!Number.isInteger(status) || status < 100 || status > 599)) {
      throw new RangeError(`Invalid HTTP status: ${String(status)}`);
    }

    let parsedBody = null;
    if (typeof bodyText === 'string' && bodyText.trim().length > 0) {
      try {
        parsedBody = JSON.parse(bodyText);
      } catch (parseError) {
        if (!(parseError instanceof SyntaxError)) {
          throw parseError;
        }
      }
    }

    let isQuotaError = false;
    if (parsedBody !== null && typeof parsedBody === 'object') {
      const visited = new Set();
      const stack = [parsedBody];
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === null || typeof current !== 'object' || visited.has(current)) {
          continue;
        }
        visited.add(current);
        if (Array.isArray(current)) {
          for (const arrayItem of current) {
            if (arrayItem !== null && typeof arrayItem === 'object') {
              stack.push(arrayItem);
            }
          }
          continue;
        }
        if (
          current.quota_error === true ||
          current.quotaError === true ||
          current.code === 'insufficient_quota' ||
          current.type === 'insufficient_quota'
        ) {
          isQuotaError = true;
          break;
        }
        if (typeof current.raw === 'string' && current.raw.trim().startsWith('{')) {
          try {
            const nestedRaw = JSON.parse(current.raw);
            if (nestedRaw !== null && typeof nestedRaw === 'object') {
              stack.push(nestedRaw);
            }
          } catch (nestedParseError) {
            if (!(nestedParseError instanceof SyntaxError)) {
              throw nestedParseError;
            }
          }
        }
        for (const nestedValue of Object.values(current)) {
          if (nestedValue !== null && typeof nestedValue === 'object') {
            stack.push(nestedValue);
          }
        }
      }
    }

    const firstChoiceError = parsedBody !== null &&
      typeof parsedBody === 'object' &&
      !Array.isArray(parsedBody) &&
      Array.isArray(parsedBody.choices) &&
      parsedBody.choices[0] !== null &&
      typeof parsedBody.choices[0] === 'object' &&
      !Array.isArray(parsedBody.choices[0])
      ? parsedBody.choices[0].error
      : null;
    const bodyError = parsedBody !== null && typeof parsedBody === 'object' && !Array.isArray(parsedBody) &&
      parsedBody.error !== undefined && parsedBody.error !== null
      ? parsedBody.error
      : firstChoiceError;
    let bodyErrorMessage = '';
    let bodyErrorCode = null;
    if (typeof bodyError === 'string') {
      bodyErrorMessage = bodyError.trim();
    } else if (bodyError !== null && typeof bodyError === 'object' && !Array.isArray(bodyError)) {
      if (typeof bodyError.message === 'string') {
        bodyErrorMessage = bodyError.message.trim();
      }
      if (typeof bodyError.code === 'number' && Number.isInteger(bodyError.code)) {
        bodyErrorCode = bodyError.code;
      } else if (typeof bodyError.code === 'string' && /^\d{3}$/.test(bodyError.code.trim())) {
        bodyErrorCode = Number.parseInt(bodyError.code.trim(), 10);
      }
    }

    let errorMessage = '';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error !== null && error !== undefined) {
      errorMessage = String(error);
    }

    const isAbortError = error !== null && typeof error === 'object' && error.name === 'AbortError';
    if (aborted === true || isAbortError) {
      return Object.freeze({
        retryable: false,
        reason: errorMessage.length > 0 ? errorMessage : 'Request aborted',
      });
    }

    if (bytesEmitted > 0) {
      const detail = bodyErrorMessage || errorMessage || (hasStatus ? `HTTP ${status}` : 'stream interrupted');
      return Object.freeze({
        retryable: false,
        reason: `Partial stream failure after output began: ${detail}`,
      });
    }

    if (error !== null && typeof error === 'object' && (error.midStreamError === true || error.retryable === false)) {
      return Object.freeze({
        retryable: false,
        reason: bodyErrorMessage || errorMessage || 'Non-retryable failure',
      });
    }

    if (isQuotaError) {
      return Object.freeze({
        retryable: false,
        reason: bodyErrorMessage.length > 0 ? `Quota error: ${bodyErrorMessage}` : 'Quota error',
      });
    }

    if (hasStatus) {
      if (RetryPolicy.NonRetryStatuses.includes(status)) {
        return Object.freeze({
          retryable: false,
          reason: bodyErrorMessage.length > 0 ? `HTTP ${status}: ${bodyErrorMessage}` : `HTTP ${status}`,
        });
      }
      if (RetryPolicy.RetryStatuses.includes(status)) {
        return Object.freeze({
          retryable: true,
          reason: bodyErrorMessage.length > 0 ? `HTTP ${status}: ${bodyErrorMessage}` : `HTTP ${status}`,
        });
      }
      if (status === 200) {
        if (bodyError !== null && bodyError !== undefined) {
          if (
            bodyErrorCode !== null &&
            bodyErrorCode >= 400 &&
            bodyErrorCode < 500 &&
            !RetryPolicy.RetryStatuses.includes(bodyErrorCode)
          ) {
            return Object.freeze({
              retryable: false,
              reason: bodyErrorMessage.length > 0 ? `HTTP ${bodyErrorCode}: ${bodyErrorMessage}` : `HTTP ${bodyErrorCode}`,
            });
          }
          const lowerMessage = bodyErrorMessage.toLowerCase();
          const matchesTransientReason = RetryPolicy.TransientReasons.some(
            (transientReason) => lowerMessage.includes(transientReason.toLowerCase()),
          );
          const matchesTransientCode = bodyErrorCode !== null && RetryPolicy.RetryStatuses.includes(bodyErrorCode);
          if (matchesTransientReason || matchesTransientCode) {
            return Object.freeze({
              retryable: true,
              reason: bodyErrorMessage.length > 0 ? bodyErrorMessage : `Upstream error ${bodyErrorCode}`,
            });
          }
          return Object.freeze({
            retryable: false,
            reason: bodyErrorMessage.length > 0 ? bodyErrorMessage : 'Provider returned non-transient error',
          });
        }
        return Object.freeze({
          retryable: false,
          reason: errorMessage.length > 0 ? errorMessage : 'HTTP 200 response failure',
        });
      }
      return Object.freeze({
        retryable: false,
        reason: bodyErrorMessage.length > 0 ? `HTTP ${status}: ${bodyErrorMessage}` : `HTTP ${status}`,
      });
    }

    if (error !== null && error !== undefined) {
      return Object.freeze({
        retryable: true,
        reason: errorMessage.length > 0 ? errorMessage : 'Network error',
      });
    }

    return Object.freeze({
      retryable: false,
      reason: 'Unknown failure',
    });
  },

  /**
   * @template ResultType
   * @param {(attempt: number) => Promise<ResultType>} operation
   * @param {{wait?: (delayMs: number, signal?: AbortSignal | null) => Promise<void>, notify?: (info: {attempt: number, maxRetries: number, delayMs: number, reason: string}) => void | Promise<void>, signal?: AbortSignal | null, delaysMs?: ReadonlyArray<number>}} [options]
   * @returns {Promise<ResultType>}
   * @throws {Error}
   */
  async runWithRetry(operation, options = {}) {
    if (typeof operation !== 'function') {
      throw new TypeError('operation must be a function.');
    }
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Retry options must be an object.');
    }

    const {
      wait,
      notify,
      signal = null,
      delaysMs,
    } = options;

    if (wait !== undefined && typeof wait !== 'function') {
      throw new TypeError('wait must be a function.');
    }
    if (notify !== undefined && notify !== null && typeof notify !== 'function') {
      throw new TypeError('notify must be a function.');
    }
    if (signal !== null && signal !== undefined && typeof signal.aborted !== 'boolean') {
      throw new TypeError('signal must be an AbortSignal.');
    }

    const effectiveDelays = delaysMs === undefined ? RetryPolicy.DelaysMs : delaysMs;
    if (!Array.isArray(effectiveDelays)) {
      throw new TypeError('delaysMs must be an array of numbers.');
    }
    for (const delayEntry of effectiveDelays) {
      if (typeof delayEntry !== 'number' || !Number.isFinite(delayEntry) || delayEntry < 0) {
        throw new RangeError('delaysMs entries must be non-negative finite numbers.');
      }
    }

    const waitHandler = wait !== undefined
      ? wait
      : /**
         * @param {number} delayMs
         * @param {AbortSignal | null | undefined} abortSignal
         * @returns {Promise<void>}
         * @throws {Error}
         */
        (delayMs, abortSignal) => {
          if (abortSignal?.aborted) {
            const abortError = new Error('Request aborted');
            abortError.name = 'AbortError';
            return Promise.reject(abortError);
          }
          return new Promise((resolve, reject) => {
            let settled = false;
            let timerId = null;

            /**
             * @returns {void}
             */
            const onAbort = () => {
              if (settled) {
                return;
              }
              settled = true;
              if (timerId !== null) {
                clearTimeout(timerId);
                timerId = null;
              }
              abortSignal?.removeEventListener('abort', onAbort);
              const abortError = new Error('Request aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            };

            timerId = setTimeout(() => {
              if (settled) {
                return;
              }
              settled = true;
              timerId = null;
              abortSignal?.removeEventListener('abort', onAbort);
              resolve();
            }, delayMs);

            if (abortSignal !== null && abortSignal !== undefined) {
              abortSignal.addEventListener('abort', onAbort, { once: true });
            }
          });
        };

    const maxRetries = effectiveDelays.length;

    for (let attempt = 1; ; attempt += 1) {
      if (signal?.aborted) {
        const abortError = new Error('Request aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }

      try {
        return await operation(attempt);
      } catch (caughtError) {
        if (signal?.aborted) {
          if (caughtError instanceof Error && caughtError.name === 'AbortError') {
            throw caughtError;
          }
          const abortError = new Error('Request aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        const isFinalAttempt = attempt > maxRetries;
        let isRetryable = false;
        let reason = caughtError instanceof Error && caughtError.message.length > 0
          ? caughtError.message
          : String(caughtError);

        if (caughtError !== null && typeof caughtError === 'object') {
          const hasEmittedBytes =
            typeof caughtError.bytesEmitted === 'number' &&
            Number.isFinite(caughtError.bytesEmitted) &&
            caughtError.bytesEmitted > 0;
          const isMidStream = caughtError.midStreamError === true;
          const isAbortError = caughtError.name === 'AbortError';
          if (!isAbortError && !hasEmittedBytes && !isMidStream) {
            if (typeof caughtError.retryable === 'boolean') {
              isRetryable = caughtError.retryable;
              if (typeof caughtError.reason === 'string' && caughtError.reason.length > 0) {
                reason = caughtError.reason;
              }
            } else {
              const rawStatus = caughtError.status;
              const sanitizedStatus = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599
                ? rawStatus
                : null;
              const rawBodyText = caughtError.bodyText;
              const sanitizedBodyText = typeof rawBodyText === 'string' ? rawBodyText : null;
              const rawBytesEmitted = caughtError.bytesEmitted;
              const sanitizedBytesEmitted =
                typeof rawBytesEmitted === 'number' && Number.isFinite(rawBytesEmitted) && rawBytesEmitted >= 0
                  ? rawBytesEmitted
                  : 0;
              const classified = RetryPolicy.classifyFailure({
                status: sanitizedStatus,
                bodyText: sanitizedBodyText,
                error: caughtError,
                aborted: false,
                bytesEmitted: sanitizedBytesEmitted,
              });
              isRetryable = classified.retryable;
              reason = classified.reason;
            }
          }
        } else {
          const classified = RetryPolicy.classifyFailure({
            error: caughtError,
            aborted: false,
            bytesEmitted: 0,
          });
          isRetryable = classified.retryable;
          reason = classified.reason;
        }

        if (!isRetryable || isFinalAttempt) {
          throw caughtError;
        }

        const delayMs = effectiveDelays[attempt - 1];
        if (typeof notify === 'function') {
          await notify({
            attempt,
            maxRetries,
            delayMs,
            reason,
          });
        }

        await waitHandler(delayMs, signal);

        if (signal?.aborted) {
          const abortError = new Error('Request aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }
      }
    }
  },
});
