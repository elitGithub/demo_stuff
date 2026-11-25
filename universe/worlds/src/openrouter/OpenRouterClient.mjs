import { SpendStage } from '../store/enums/SpendStage.mjs';
import { ReplyStatus } from './ReplyStatus.mjs';
import { RetryPolicy } from './RetryPolicy.mjs';

export class OpenRouterClient {
  #replyLog;
  #apiKeyProvider;
  #fetchImpl;
  #baseUrl;
  #retryWait;
  #retryNotify;
  #retryDelaysMs;
  #onSpend;
  #appTitle;
  #appReferer;

  /**
   * @param {{apiKeyProvider: () => string | null | undefined | Promise<string | null | undefined>, fetchImpl?: typeof fetch, baseUrl?: string, retryOptions?: {wait?: (delayMs: number, signal?: AbortSignal | null) => Promise<void>, notify?: (info: {attempt: number, maxRetries: number, delayMs: number, reason: string}) => void | Promise<void>, delaysMs?: ReadonlyArray<number>}, onSpend?: ((dto: {campaignId: string | null, turnId: null, stage: string, model: string, promptTokens: number, completionTokens: number, costUsd: number | null}) => {id?: string} | null | undefined | Promise<{id?: string} | null | undefined>) | null, appTitle?: string, appReferer?: string, replyLog?: import('./ReplyLog.mjs').ReplyLog | null}} options
   * @throws {TypeError | RangeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('OpenRouterClient options must be a plain object.');
    }

    const {
      apiKeyProvider,
      fetchImpl = fetch,
      baseUrl = 'https://openrouter.ai/api/v1',
      retryOptions = {},
      onSpend = null,
      appTitle = 'Worlds',
      appReferer = 'http://127.0.0.1',
      replyLog = null,
    } = options;

    if (replyLog !== null && (typeof replyLog !== 'object' || typeof replyLog.append !== 'function')) {
      throw new TypeError('replyLog must be null or provide append().');
    }

    if (typeof apiKeyProvider !== 'function') {
      throw new TypeError('apiKeyProvider must be a function.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('fetchImpl must be a function.');
    }
    if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
      throw new TypeError('baseUrl must be a non-empty string.');
    }
    if (/[\r\n\0]/.test(baseUrl)) {
      throw new RangeError('baseUrl must not contain CR, LF, or NUL characters.');
    }

    const trimmedBaseUrl = baseUrl.trim();
    let parsedBaseUrl;
    try {
      parsedBaseUrl = new URL(trimmedBaseUrl);
    } catch {
      throw new RangeError(`Invalid baseUrl: ${trimmedBaseUrl}`);
    }
    if (parsedBaseUrl.protocol !== 'http:' && parsedBaseUrl.protocol !== 'https:') {
      throw new RangeError(`baseUrl must use http or https protocol: ${trimmedBaseUrl}`);
    }
    if (parsedBaseUrl.search.length > 0 || parsedBaseUrl.hash.length > 0) {
      throw new RangeError('baseUrl must not contain query parameters or hash fragments.');
    }

    if (retryOptions === null || typeof retryOptions !== 'object' || Array.isArray(retryOptions)) {
      throw new TypeError('retryOptions must be a plain object.');
    }
    if (retryOptions.wait !== undefined && typeof retryOptions.wait !== 'function') {
      throw new TypeError('retryOptions.wait must be a function.');
    }
    if (retryOptions.notify !== undefined && retryOptions.notify !== null && typeof retryOptions.notify !== 'function') {
      throw new TypeError('retryOptions.notify must be a function.');
    }
    if (retryOptions.delaysMs !== undefined) {
      if (!Array.isArray(retryOptions.delaysMs)) {
        throw new TypeError('retryOptions.delaysMs must be an array.');
      }
      for (const delayEntry of retryOptions.delaysMs) {
        if (typeof delayEntry !== 'number' || !Number.isFinite(delayEntry) || delayEntry < 0) {
          throw new RangeError('retryOptions.delaysMs entries must be non-negative finite numbers.');
        }
      }
    }

    if (onSpend !== null && onSpend !== undefined && typeof onSpend !== 'function') {
      throw new TypeError('onSpend must be null or a function.');
    }
    const forbiddenHeaderChars = /[\u0000-\u001f\u007f]|[^\u0000-\u00ff]/;
    if (typeof appTitle !== 'string' || appTitle.trim().length === 0 || forbiddenHeaderChars.test(appTitle)) {
      throw new RangeError('appTitle must be a non-empty valid ByteString header value.');
    }
    if (typeof appReferer !== 'string' || appReferer.trim().length === 0 || forbiddenHeaderChars.test(appReferer)) {
      throw new RangeError('appReferer must be a non-empty valid ByteString header value.');
    }

    this.#replyLog = replyLog;
    this.#apiKeyProvider = apiKeyProvider;
    this.#fetchImpl = fetchImpl;
    this.#baseUrl = trimmedBaseUrl.replace(/\/+$/, '');
    this.#retryWait = retryOptions.wait;
    this.#retryNotify = retryOptions.notify ?? null;
    this.#retryDelaysMs = retryOptions.delaysMs;
    this.#onSpend = onSpend ?? null;
    this.#appTitle = appTitle.trim();
    this.#appReferer = appReferer.trim();
  }

  /**
   * @param {{model: string, messages: Array<{role: string, content: string}>, temperature?: number | null, maxTokens?: number | null, responseFormat?: Record<string, unknown> | null, signal?: AbortSignal | null, stage: string, campaignId?: string | null, onRetry?: ((info: {attempt: number, maxRetries: number, delayMs: number, reason: string}) => void | Promise<void>) | null}} requestOptions
   * @returns {Promise<Readonly<{text: string, finishReason: string | null, usage: Readonly<{promptTokens: number, completionTokens: number, costUsd: number | null}>, truncated: boolean, spendId: string | null}>>}
   * @throws {Error}
   */
  async complete(requestOptions = {}) {
    const prepared = await this.#prepareRequest(requestOptions, false);
    const serializedBody = JSON.stringify(prepared.payload);

    const completionResult = await RetryPolicy.runWithRetry(
      async () => {
        const fetchInit = {
          method: 'POST',
          headers: prepared.headers,
          body: serializedBody,
        };
        if (prepared.signal !== null) {
          fetchInit.signal = prepared.signal;
        }

        let response;
        try {
          response = await this.#fetchImpl(prepared.url, fetchInit);
        } catch (fetchError) {
          throw this.#sanitizeError(fetchError, prepared.apiKey);
        }
        if (prepared.signal?.aborted) {
          const abortError = new Error('Request aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        let bodyText;
        try {
          bodyText = await response.text();
        } catch (readError) {
          throw this.#sanitizeError(readError, prepared.apiKey);
        }
        if (prepared.signal?.aborted) {
          const abortError = new Error('Request aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        if (!response.ok) {
          this.#logBody(prepared, response.status, bodyText);
          throw this.#createHttpError(response.status, bodyText, prepared.signal, prepared.apiKey);
        }

        let parsedBody;
        try {
          parsedBody = JSON.parse(bodyText);
        } catch (parseError) {
          this.#logBody(prepared, response.status, bodyText);
          const safeParseMessage = this.#redactSecret(parseError.message, prepared.apiKey);
          const malformedError = new Error(`Malformed JSON response from OpenRouter: ${safeParseMessage}`);
          malformedError.retryable = false;
          throw malformedError;
        }

        if (parsedBody === null || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
          this.#logBody(prepared, response.status, bodyText);
          const invalidShapeError = new Error('OpenRouter response JSON must be an object.');
          invalidShapeError.retryable = false;
          throw invalidShapeError;
        }

        const firstChoice = Array.isArray(parsedBody.choices) &&
          parsedBody.choices[0] !== null &&
          typeof parsedBody.choices[0] === 'object' &&
          !Array.isArray(parsedBody.choices[0])
          ? parsedBody.choices[0]
          : null;

        if (
          (parsedBody.error !== undefined && parsedBody.error !== null) ||
          (firstChoice !== null && firstChoice.error !== undefined && firstChoice.error !== null)
        ) {
          this.#logBody(prepared, response.status, bodyText);
          throw this.#createHttpError(response.status, bodyText, prepared.signal, prepared.apiKey);
        }

        const rawContent = firstChoice?.message?.content;
        const refusalText = typeof firstChoice?.message?.refusal === 'string'
          ? firstChoice.message.refusal
          : null;
        let messageContent = null;
        if (typeof rawContent === 'string') {
          messageContent = rawContent.length === 0 && refusalText !== null && refusalText.length > 0
            ? refusalText
            : rawContent;
        } else if (Array.isArray(rawContent)) {
          const joinedParts = rawContent.map((part) => {
            if (typeof part === 'string') {
              return part;
            }
            if (part !== null && typeof part === 'object' && part.type === 'refusal' && typeof part.refusal === 'string') {
              return part.refusal;
            }
            if (
              part !== null &&
              typeof part === 'object' &&
              typeof part.text === 'string' &&
              (!part.type || part.type === 'text' || part.type === 'output_text')
            ) {
              return part.text;
            }
            return '';
          }).join('');
          messageContent = joinedParts.length === 0 && refusalText !== null && refusalText.length > 0
            ? refusalText
            : joinedParts;
        } else if (refusalText !== null) {
          messageContent = refusalText;
        }

        if (typeof messageContent !== 'string') {
          this.#logBody(prepared, response.status, bodyText);
          const missingContentError = new Error('OpenRouter response is missing choices[0].message.content string.');
          missingContentError.retryable = false;
          throw missingContentError;
        }

        const finishReason = typeof firstChoice.finish_reason === 'string' && firstChoice.finish_reason.length > 0
          ? firstChoice.finish_reason
          : null;
        const usage = this.#extractUsage(parsedBody.usage);
        this.#logReply(prepared, {
          status: ReplyStatus.Ok,
          finishReason,
          usage: parsedBody.usage !== undefined && parsedBody.usage !== null ? usage : null,
          text: messageContent,
        });

        return {
          text: messageContent,
          finishReason,
          usage,
        };
      },
      {
        wait: this.#retryWait,
        notify: prepared.notify,
        signal: prepared.signal,
        delaysMs: this.#retryDelaysMs,
      },
    );

    const spendId = await this.#recordSpend({
      campaignId: prepared.campaignId,
      stage: prepared.stage,
      model: prepared.model,
      usage: completionResult.usage,
    });

    return Object.freeze({
      text: completionResult.text,
      finishReason: completionResult.finishReason,
      usage: Object.freeze(completionResult.usage),
      truncated: completionResult.finishReason === 'length',
      spendId,
    });
  }

  /**
   * @param {{model: string, messages: Array<{role: string, content: string}>, temperature?: number | null, maxTokens?: number | null, signal?: AbortSignal | null, stage: string, campaignId?: string | null, onDelta?: ((delta: string) => void | Promise<void>) | null, onRetry?: ((info: {attempt: number, maxRetries: number, delayMs: number, reason: string}) => void | Promise<void>) | null}} requestOptions
   * @returns {Promise<Readonly<{text: string, finishReason: string | null, usage: Readonly<{promptTokens: number, completionTokens: number, costUsd: number | null}>, truncated: boolean, spendId: string | null}>>}
   * @throws {Error}
   */
  async stream(requestOptions = {}) {
    const prepared = await this.#prepareRequest(requestOptions, true);
    const onDelta = prepared.onDelta;
    const serializedBody = JSON.stringify(prepared.payload);

    const streamResult = await RetryPolicy.runWithRetry(
      async () => {
        const fetchInit = {
          method: 'POST',
          headers: prepared.headers,
          body: serializedBody,
        };
        if (prepared.signal !== null) {
          fetchInit.signal = prepared.signal;
        }

        let response;
        try {
          response = await this.#fetchImpl(prepared.url, fetchInit);
        } catch (fetchError) {
          throw this.#sanitizeError(fetchError, prepared.apiKey);
        }
        if (prepared.signal?.aborted) {
          const abortError = new Error('Request aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        if (!response.ok) {
          let bodyText;
          try {
            bodyText = await response.text();
          } catch (readBodyError) {
            throw this.#sanitizeError(readBodyError, prepared.apiKey);
          }
          if (prepared.signal?.aborted) {
            const abortError = new Error('Request aborted');
            abortError.name = 'AbortError';
            throw abortError;
          }
          this.#logBody(prepared, response.status, bodyText);
          throw this.#createHttpError(response.status, bodyText, prepared.signal, prepared.apiKey);
        }

        const rawContentType = response.headers?.get?.('content-type') ?? '';
        const mimeType = rawContentType.split(';', 1)[0].trim().toLowerCase();
        if (mimeType === 'application/json' || mimeType === 'text/json') {
          let bodyText;
          try {
            bodyText = await response.text();
          } catch (readBodyError) {
            throw this.#sanitizeError(readBodyError, prepared.apiKey);
          }
          if (prepared.signal?.aborted) {
            const abortError = new Error('Request aborted');
            abortError.name = 'AbortError';
            throw abortError;
          }
          this.#logBody(prepared, response.status, bodyText);
          throw this.#createHttpError(response.status, bodyText, prepared.signal, prepared.apiKey);
        }

        if (response.body === null || response.body === undefined || typeof response.body.getReader !== 'function') {
          const missingBodyError = new Error('OpenRouter streaming response has no readable body.');
          missingBodyError.retryable = false;
          throw missingBodyError;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: false });
        const maxNonSseBufferChars = 65536;
        let lineBuffer = '';
        let skipNextNewline = false;
        let eventDataLines = [];
        let sawSseFrame = false;
        let bufferedNonSseText = '';
        let accumulatedText = '';
        let finishReason = null;
        let usage = {
          promptTokens: 0,
          completionTokens: 0,
          costUsd: null,
        };
        let receivedUsage = false;
        let bytesEmitted = 0;
        let readerClosed = false;
        let readerCancelled = false;
        let streamDone = false;
        let readFailed = false;

        try {
          while (!streamDone) {
            if (prepared.signal?.aborted) {
              const abortError = new Error('Request aborted');
              abortError.name = 'AbortError';
              throw abortError;
            }

            let readResult;
            try {
              readResult = await reader.read();
            } catch (readError) {
              readFailed = true;
              throw this.#sanitizeError(readError, prepared.apiKey);
            }

            const { value, done } = readResult;
            if (done) {
              readerClosed = true;
            }

            let decodedText = '';
            if (value !== undefined) {
              decodedText = typeof value === 'string'
                ? value
                : decoder.decode(value, { stream: !done });
            }
            if (done) {
              decodedText += decoder.decode();
            }

            const completedLines = [];
            for (let charIndex = 0; charIndex < decodedText.length; charIndex += 1) {
              const currentChar = decodedText[charIndex];
              if (skipNextNewline) {
                skipNextNewline = false;
                if (currentChar === '\n') {
                  continue;
                }
              }
              if (currentChar === '\r') {
                completedLines.push(lineBuffer);
                lineBuffer = '';
                skipNextNewline = true;
              } else if (currentChar === '\n') {
                completedLines.push(lineBuffer);
                lineBuffer = '';
              } else {
                lineBuffer += currentChar;
              }
            }
            if (done && lineBuffer.length > 0) {
              completedLines.push(lineBuffer);
              lineBuffer = '';
            }
            if (done) {
              completedLines.push('');
            }

            for (const line of completedLines) {
              if (line.length === 0) {
                if (eventDataLines.length === 0) {
                  continue;
                }
                if (prepared.signal?.aborted) {
                  const abortError = new Error('Request aborted');
                  abortError.name = 'AbortError';
                  throw abortError;
                }

                const payloadText = eventDataLines.join('\n');
                eventDataLines = [];
                if (payloadText.trim().length === 0) {
                  continue;
                }
                if (payloadText.trim() === '[DONE]') {
                  sawSseFrame = true;
                  streamDone = true;
                  if (!readerClosed && !readerCancelled) {
                    readerCancelled = true;
                    await this.#cancelReaderSafely(reader);
                  }
                  break;
                }

                let frame;
                try {
                  frame = JSON.parse(payloadText);
                } catch (parseError) {
                  const safeParseMessage = this.#redactSecret(parseError.message, prepared.apiKey);
                  const malformedFrameError = new Error(`Malformed SSE JSON frame from OpenRouter: ${safeParseMessage}`);
                  malformedFrameError.retryable = false;
                  malformedFrameError.bytesEmitted = bytesEmitted;
                  throw malformedFrameError;
                }

                if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) {
                  const invalidFrameError = new Error('OpenRouter SSE frame must be a JSON object.');
                  invalidFrameError.retryable = false;
                  invalidFrameError.bytesEmitted = bytesEmitted;
                  throw invalidFrameError;
                }

                sawSseFrame = true;

                const choice = Array.isArray(frame.choices) &&
                  frame.choices[0] !== null &&
                  typeof frame.choices[0] === 'object' &&
                  !Array.isArray(frame.choices[0])
                  ? frame.choices[0]
                  : null;
                const streamErrorPayload = frame.error !== undefined && frame.error !== null
                  ? frame.error
                  : (choice !== null && choice.error !== undefined && choice.error !== null ? choice.error : null);

                if (streamErrorPayload !== null) {
                  let rawMessage = 'OpenRouter mid-stream error';
                  if (typeof streamErrorPayload === 'string' && streamErrorPayload.trim().length > 0) {
                    rawMessage = streamErrorPayload.trim();
                  } else if (typeof streamErrorPayload?.message === 'string' && streamErrorPayload.message.trim().length > 0) {
                    rawMessage = streamErrorPayload.message.trim();
                  } else if (streamErrorPayload?.code !== undefined) {
                    rawMessage = `OpenRouter mid-stream error (${String(streamErrorPayload.code)})`;
                  }
                  const midStreamError = new Error(this.#redactSecret(rawMessage, prepared.apiKey));
                  midStreamError.retryable = false;
                  midStreamError.midStreamError = true;
                  midStreamError.bytesEmitted = bytesEmitted;
                  throw midStreamError;
                }

                if (frame.usage !== undefined && frame.usage !== null) {
                  usage = this.#extractUsage(frame.usage);
                  receivedUsage = true;
                }

                if (choice !== null) {
                  if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) {
                    finishReason = choice.finish_reason;
                  }
                  const delta = choice.delta?.content;
                  if (typeof delta === 'string' && delta.length > 0) {
                    accumulatedText += delta;
                    bytesEmitted += Buffer.byteLength(delta, 'utf8');
                    if (onDelta !== null) {
                      try {
                        await onDelta(delta);
                      } catch (callbackError) {
                        const sanitizedCallbackError = this.#sanitizeError(callbackError, prepared.apiKey);
                        if (
                          sanitizedCallbackError !== null &&
                          typeof sanitizedCallbackError === 'object' &&
                          Object.isExtensible(sanitizedCallbackError)
                        ) {
                          sanitizedCallbackError.retryable = false;
                          sanitizedCallbackError.bytesEmitted = bytesEmitted;
                        }
                        throw sanitizedCallbackError;
                      }
                      if (prepared.signal?.aborted) {
                        const abortError = new Error('Request aborted');
                        abortError.name = 'AbortError';
                        throw abortError;
                      }
                    }
                  }
                }
                continue;
              }

              if (line.startsWith(':')) {
                continue;
              }
              if (line.startsWith('data:')) {
                const afterColon = line.slice(5);
                const fieldValue = afterColon.startsWith(' ') ? afterColon.slice(1) : afterColon;
                if (eventDataLines.length === 0 && fieldValue.trim() === '[DONE]') {
                  sawSseFrame = true;
                  streamDone = true;
                  if (!readerClosed && !readerCancelled) {
                    readerCancelled = true;
                    await this.#cancelReaderSafely(reader);
                  }
                  break;
                }
                eventDataLines.push(fieldValue);
                continue;
              }
              if (line.startsWith('event:') || line.startsWith('id:') || line.startsWith('retry:')) {
                continue;
              }

              if (!sawSseFrame && bufferedNonSseText.length < maxNonSseBufferChars) {
                const separator = bufferedNonSseText.length > 0 ? '\n' : '';
                const remainingCapacity = maxNonSseBufferChars - bufferedNonSseText.length;
                bufferedNonSseText += `${separator}${line}`.slice(0, remainingCapacity);
              }
            }

            if (done) {
              streamDone = true;
            }
          }

          if (prepared.signal?.aborted) {
            const abortError = new Error('Request aborted');
            abortError.name = 'AbortError';
            throw abortError;
          }

          if (!sawSseFrame) {
            const trimmedNonSse = bufferedNonSseText.trim();
            if (trimmedNonSse.length > 0) {
              let parsedNonSse = null;
              try {
                parsedNonSse = JSON.parse(trimmedNonSse);
              } catch (parseError) {
                if (!(parseError instanceof SyntaxError)) {
                  throw parseError;
                }
              }
              const hasTopLevelError =
                parsedNonSse !== null &&
                typeof parsedNonSse === 'object' &&
                !Array.isArray(parsedNonSse) &&
                parsedNonSse.error !== undefined &&
                parsedNonSse.error !== null;
              const hasChoiceError =
                parsedNonSse !== null &&
                typeof parsedNonSse === 'object' &&
                !Array.isArray(parsedNonSse) &&
                Array.isArray(parsedNonSse.choices) &&
                parsedNonSse.choices[0] !== null &&
                typeof parsedNonSse.choices[0] === 'object' &&
                parsedNonSse.choices[0].error !== undefined &&
                parsedNonSse.choices[0].error !== null;

              this.#logBody(prepared, response.status, trimmedNonSse);
              if (hasTopLevelError || hasChoiceError) {
                throw this.#createHttpError(response.status, trimmedNonSse, prepared.signal, prepared.apiKey);
              }

              const nonSseError = new Error(
                `OpenRouter returned non-SSE response: ${this.#redactSecret(trimmedNonSse.slice(0, 300), prepared.apiKey)}`,
              );
              nonSseError.retryable = false;
              throw nonSseError;
            }

            const emptyStreamError = new Error('OpenRouter SSE stream ended before any data frame.');
            emptyStreamError.retryable = bytesEmitted === 0;
            throw emptyStreamError;
          }

          this.#logReply(prepared, {
            status: ReplyStatus.Ok,
            finishReason,
            usage: receivedUsage ? usage : null,
            text: accumulatedText,
          });

          return {
            text: accumulatedText,
            finishReason,
            usage,
          };
        } catch (streamError) {
          if (!readerClosed && !readerCancelled) {
            readerCancelled = true;
            await this.#cancelReaderSafely(reader);
          }
          const sanitizedError = this.#sanitizeError(streamError, prepared.apiKey);
          const isAborted = streamError?.name === 'AbortError' || prepared.signal?.aborted === true;
          if (accumulatedText.length > 0 || streamError?.midStreamError === true) {
            let failureStatus = ReplyStatus.StreamError;
            if (isAborted) {
              failureStatus = ReplyStatus.Aborted;
            } else if (readFailed) {
              failureStatus = ReplyStatus.NetworkError;
            }
            this.#logReply(prepared, {
              status: failureStatus,
              finishReason,
              usage: receivedUsage ? usage : null,
              text: accumulatedText,
              errorMessage: this.#redactSecret(String(sanitizedError?.message ?? sanitizedError), prepared.apiKey),
            });
          }
          if (receivedUsage) {
            await this.#recordSpend({
              campaignId: prepared.campaignId,
              stage: prepared.stage,
              model: prepared.model,
              usage,
            });
          }
          if (bytesEmitted > 0) {
            if (
              sanitizedError !== null &&
              typeof sanitizedError === 'object' &&
              Object.isExtensible(sanitizedError)
            ) {
              sanitizedError.retryable = false;
              sanitizedError.bytesEmitted = bytesEmitted;
              throw sanitizedError;
            }
            const wrappedError = new Error(this.#redactSecret(String(sanitizedError), prepared.apiKey));
            wrappedError.retryable = false;
            wrappedError.bytesEmitted = bytesEmitted;
            throw wrappedError;
          }
          throw sanitizedError;
        } finally {
          reader.releaseLock();
        }
      },
      {
        wait: this.#retryWait,
        notify: prepared.notify,
        signal: prepared.signal,
        delaysMs: this.#retryDelaysMs,
      },
    );

    const spendId = await this.#recordSpend({
      campaignId: prepared.campaignId,
      stage: prepared.stage,
      model: prepared.model,
      usage: streamResult.usage,
    });

    return Object.freeze({
      text: streamResult.text,
      finishReason: streamResult.finishReason,
      usage: Object.freeze(streamResult.usage),
      truncated: streamResult.finishReason === 'length',
      spendId,
    });
  }

  /**
   * @param {Record<string, unknown>} requestOptions
   * @param {boolean} isStream
   * @returns {Promise<{url: string, apiKey: string, model: string, stage: string, campaignId: string | null, signal: AbortSignal | null, onDelta: ((delta: string) => void | Promise<void>) | null, notify: ((info: {attempt: number, maxRetries: number, delayMs: number, reason: string}) => Promise<void>) | undefined, headers: Record<string, string>, payload: Record<string, unknown>}>}
   * @throws {Error}
   */
  async #prepareRequest(requestOptions, isStream) {
    if (requestOptions === null || typeof requestOptions !== 'object' || Array.isArray(requestOptions)) {
      throw new TypeError('Request options must be a plain object.');
    }

    const {
      model,
      messages,
      temperature,
      maxTokens,
      responseFormat,
      onDelta = null,
      signal = null,
      stage,
      campaignId = null,
      onRetry = null,
    } = requestOptions;

    if (typeof model !== 'string' || model.trim().length === 0 || /[\r\n\0]/.test(model)) {
      throw new RangeError('model must be a non-empty single-line string.');
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new RangeError('messages must be a non-empty array.');
    }

    const normalizedMessages = [];
    for (const messageEntry of messages) {
      if (messageEntry === null || typeof messageEntry !== 'object' || Array.isArray(messageEntry)) {
        throw new TypeError('Each message must be a plain object.');
      }
      if (typeof messageEntry.role !== 'string' || messageEntry.role.trim().length === 0) {
        throw new RangeError('Each message must have a non-empty role string.');
      }
      if (typeof messageEntry.content !== 'string') {
        throw new TypeError('Each message must have a string content.');
      }
      normalizedMessages.push({
        role: messageEntry.role.trim(),
        content: messageEntry.content,
      });
    }

    SpendStage.label(stage);

    let normalizedCampaignId = null;
    if (campaignId !== null && campaignId !== undefined) {
      if (typeof campaignId !== 'string' || campaignId.trim().length === 0) {
        throw new RangeError('campaignId must be null or a non-empty string.');
      }
      normalizedCampaignId = campaignId.trim();
    }

    if (temperature !== undefined && temperature !== null) {
      if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0) {
        throw new RangeError('temperature must be a non-negative finite number.');
      }
    }
    if (maxTokens !== undefined && maxTokens !== null) {
      if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
        throw new RangeError('maxTokens must be a positive integer.');
      }
    }
    if (!isStream && responseFormat !== undefined && responseFormat !== null) {
      if (typeof responseFormat !== 'object' || Array.isArray(responseFormat)) {
        throw new TypeError('responseFormat must be a plain object.');
      }
    }
    if (isStream && onDelta !== null && typeof onDelta !== 'function') {
      throw new TypeError('onDelta must be null or a function.');
    }
    if (signal !== null && signal !== undefined) {
      if (typeof signal !== 'object' || typeof signal.aborted !== 'boolean') {
        throw new TypeError('signal must be an AbortSignal.');
      }
    }
    if (onRetry !== null && onRetry !== undefined && typeof onRetry !== 'function') {
      throw new TypeError('onRetry must be null or a function.');
    }

    const rawApiKey = await this.#apiKeyProvider();
    if (typeof rawApiKey !== 'string' || rawApiKey.trim().length === 0) {
      throw new Error('OpenRouter API key is missing.');
    }
    if (/[\s\u0000-\u001f\u007f]|[^\u0000-\u00ff]/.test(rawApiKey)) {
      throw new RangeError('OpenRouter API key contains invalid characters.');
    }
    const apiKey = rawApiKey;

    const normalizedModel = model.trim();
    const payload = {
      model: normalizedModel,
      messages: normalizedMessages,
      stream: isStream,
      usage: { include: true },
    };
    if (temperature !== undefined && temperature !== null) {
      payload.temperature = temperature;
    }
    if (maxTokens !== undefined && maxTokens !== null) {
      payload.max_tokens = maxTokens;
    }
    if (!isStream && responseFormat !== undefined && responseFormat !== null) {
      payload.response_format = responseFormat;
    }

    const hasRetryNotify = typeof this.#retryNotify === 'function';
    const hasCallOnRetry = typeof onRetry === 'function';
    const notify = hasRetryNotify || hasCallOnRetry
      ? /**
         * @param {{attempt: number, maxRetries: number, delayMs: number, reason: string}} retryInfo
         * @returns {Promise<void>}
         */
        async (retryInfo) => {
          const safeRetryInfo = {
            ...retryInfo,
            reason: this.#redactSecret(retryInfo.reason, apiKey),
          };
          if (hasRetryNotify) {
            await this.#retryNotify(safeRetryInfo);
          }
          if (hasCallOnRetry) {
            await onRetry(safeRetryInfo);
          }
        }
      : undefined;

    return {
      url: `${this.#baseUrl}/chat/completions`,
      apiKey,
      model: normalizedModel,
      stage,
      campaignId: normalizedCampaignId,
      signal: signal ?? null,
      onDelta: isStream ? onDelta : null,
      notify,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.#appReferer,
        'X-Title': this.#appTitle,
      },
      payload,
    };
  }

  /**
   * @param {{stage: string, campaignId: string | null, model: string, apiKey: string}} prepared
   * @param {{status: string, finishReason?: string | null, usage?: {promptTokens: number, completionTokens: number} | null, text: string, errorMessage?: string | null}} record
   * @returns {void}
   * @throws {Error}
   */
  #logReply(prepared, { status, finishReason = null, usage = null, text, errorMessage = null }) {
    if (this.#replyLog === null) {
      return;
    }
    this.#replyLog.append({
      stage: prepared.stage,
      campaignId: prepared.campaignId,
      model: prepared.model,
      status,
      finishReason,
      usage,
      text,
      errorMessage,
    });
  }

  /**
   * @param {{stage: string, campaignId: string | null, model: string, apiKey: string}} prepared
   * @param {number} httpStatus
   * @param {string} bodyText
   * @returns {void}
   * @throws {Error}
   */
  #logBody(prepared, httpStatus, bodyText) {
    this.#logReply(prepared, {
      status: ReplyStatus.http(httpStatus),
      text: this.#redactSecret(bodyText, prepared.apiKey),
    });
  }

  /**
   * @param {ReadableStreamDefaultReader<Uint8Array>} reader
   * @returns {Promise<void>}
   */
  async #cancelReaderSafely(reader) {
    try {
      await reader.cancel();
    } catch {
    }
  }

  /**
   * @param {number} status
   * @param {string} bodyText
   * @param {AbortSignal | null} signal
   * @param {string} apiKey
   * @returns {Error}
   */
  #createHttpError(status, bodyText, signal, apiKey) {
    const classification = RetryPolicy.classifyFailure({
      status,
      bodyText,
      aborted: Boolean(signal?.aborted),
      bytesEmitted: 0,
    });
    const safeReason = this.#redactSecret(classification.reason, apiKey);
    const failure = new Error(safeReason);
    failure.retryable = classification.retryable;
    failure.reason = safeReason;
    failure.status = status;
    failure.bodyText = this.#redactSecret(bodyText, apiKey);
    return failure;
  }

  /**
   * @param {unknown} rawUsage
   * @returns {{promptTokens: number, completionTokens: number, costUsd: number | null}}
   */
  #extractUsage(rawUsage) {
    if (rawUsage === undefined || rawUsage === null || typeof rawUsage !== 'object' || Array.isArray(rawUsage)) {
      return {
        promptTokens: 0,
        completionTokens: 0,
        costUsd: null,
      };
    }
    const rawPrompt = rawUsage.prompt_tokens;
    const truncatedPrompt = typeof rawPrompt === 'number' && Number.isFinite(rawPrompt) && rawPrompt >= 0
      ? Math.trunc(rawPrompt)
      : 0;
    const promptTokens = truncatedPrompt === 0 ? 0 : truncatedPrompt;

    const rawCompletion = rawUsage.completion_tokens;
    const truncatedCompletion = typeof rawCompletion === 'number' && Number.isFinite(rawCompletion) && rawCompletion >= 0
      ? Math.trunc(rawCompletion)
      : 0;
    const completionTokens = truncatedCompletion === 0 ? 0 : truncatedCompletion;

    const rawCost = rawUsage.cost;
    let costUsd = null;
    if (typeof rawCost === 'number' && Number.isFinite(rawCost) && rawCost >= 0) {
      costUsd = rawCost === 0 ? 0 : rawCost;
    }
    return {
      promptTokens,
      completionTokens,
      costUsd,
    };
  }

  /**
   * @param {{campaignId: string | null, stage: string, model: string, usage: {promptTokens: number, completionTokens: number, costUsd: number | null}}} spendInput
   * @returns {Promise<string | null>}
   */
  async #recordSpend({ campaignId, stage, model, usage }) {
    if (this.#onSpend === null) {
      return null;
    }
    const spendResult = await this.#onSpend({
      campaignId,
      turnId: null,
      stage,
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: usage.costUsd,
    });
    return spendResult?.id ?? null;
  }

  /**
   * @param {string} text
   * @param {string} apiKey
   * @returns {string}
   */
  #redactSecret(text, apiKey) {
    if (typeof text !== 'string' || text.length === 0 || typeof apiKey !== 'string' || apiKey.length === 0) {
      return text;
    }
    return text.replaceAll(apiKey, '[REDACTED]');
  }

  /**
   * @param {unknown} error
   * @param {string} apiKey
   * @param {Map<object, unknown> | null} [visited]
   * @returns {unknown}
   */
  #sanitizeError(error, apiKey, visited = null) {
    if (error === null || error === undefined || typeof apiKey !== 'string' || apiKey.length === 0) {
      return error;
    }
    if (typeof error === 'string') {
      if (visited === null) {
        return error.includes(apiKey) ? new Error(this.#redactSecret(error, apiKey)) : error;
      }
      return this.#redactSecret(error, apiKey);
    }
    if (typeof error !== 'object') {
      return error;
    }
    const isErrorLike =
      error instanceof Error ||
      typeof error.message === 'string' ||
      typeof error.reason === 'string' ||
      typeof error.bodyText === 'string' ||
      typeof error.stack === 'string' ||
      error.cause !== undefined ||
      Array.isArray(error.errors);
    if (!isErrorLike) {
      return error;
    }

    if (visited === null) {
      let containsSecret = false;
      const scanVisited = new Set();
      const scanStack = [error];
      while (scanStack.length > 0) {
        const current = scanStack.pop();
        if (current === null || current === undefined) {
          continue;
        }
        if (typeof current === 'string') {
          if (current.includes(apiKey)) {
            containsSecret = true;
            break;
          }
          continue;
        }
        if (typeof current !== 'object' || scanVisited.has(current)) {
          continue;
        }
        scanVisited.add(current);
        if (
          (typeof current.message === 'string' && current.message.includes(apiKey)) ||
          (typeof current.reason === 'string' && current.reason.includes(apiKey)) ||
          (typeof current.bodyText === 'string' && current.bodyText.includes(apiKey)) ||
          (typeof current.stack === 'string' && current.stack.includes(apiKey))
        ) {
          containsSecret = true;
          break;
        }
        if (current.cause !== undefined) {
          scanStack.push(current.cause);
        }
        if (Array.isArray(current.errors)) {
          for (const nestedError of current.errors) {
            scanStack.push(nestedError);
          }
        }
      }
      if (!containsSecret) {
        return error;
      }
      visited = new Map();
    }

    if (visited.has(error)) {
      return visited.get(error);
    }

    const rawMessage = typeof error.message === 'string' ? error.message : '';
    const redactedMessage = this.#redactSecret(rawMessage, apiKey);
    const replacement = error instanceof AggregateError
      ? new AggregateError([], redactedMessage)
      : new Error(redactedMessage);

    visited.set(error, replacement);

    if (typeof error.name === 'string' && error.name.length > 0) {
      replacement.name = error.name;
    }
    if (typeof error.retryable === 'boolean') {
      replacement.retryable = error.retryable;
    }
    if (typeof error.bytesEmitted === 'number') {
      replacement.bytesEmitted = error.bytesEmitted;
    }
    if (error.midStreamError === true) {
      replacement.midStreamError = true;
    }
    if (error.status !== undefined) {
      replacement.status = error.status;
    }
    if (typeof error.reason === 'string') {
      replacement.reason = this.#redactSecret(error.reason, apiKey);
    }
    if (typeof error.bodyText === 'string') {
      replacement.bodyText = this.#redactSecret(error.bodyText, apiKey);
    }
    if (typeof error.stack === 'string') {
      replacement.stack = this.#redactSecret(error.stack, apiKey);
    }
    if (error.cause !== undefined) {
      replacement.cause = this.#sanitizeError(error.cause, apiKey, visited);
    }
    if (Array.isArray(error.errors)) {
      replacement.errors = error.errors.map((nestedError) => this.#sanitizeError(nestedError, apiKey, visited));
    }

    return replacement;
  }
}
