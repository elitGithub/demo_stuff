const ScribeGateway = Object.freeze({
    Endpoint: 'https://openrouter.ai/api/v1/chat/completions',

    Settings: Object.freeze({
        Method: 'POST',
        AuthorizationHeader: 'Authorization',
        BearerPrefix: 'Bearer ',
        ContentTypeHeader: 'Content-Type',
        JsonType: 'application/json',
        Temperature: 0.2,
        ReasoningEffort: 'low',
        SystemRole: 'system',
        UserRole: 'user',
        Finish: Object.freeze({
            Stop: 'stop',
            Length: 'length',
            Error: 'error',
        }),
        FirstSuccess: 200,
        LastSuccess: 299,
        FirstStatus: 100,
        TimedOut: 408,
        RateLimited: 429,
        FirstServerError: 500,
        MaxReasonLength: 300,
        MaxFinishLength: 40,
        TimeoutMs: 180000,
        PauseMs: 10000,
        MillisecondsPerSecond: 1000,
        FirstAttempt: 1,
        NoPause: 0,
        KeyMask: '[key]',
        Space: ' ',
        Nothing: '',
        ByteOrderMark: '﻿',
        ObjectType: 'object',
        NumberType: 'number',
        StringType: 'string',
        FunctionType: 'function',
        NoStatus: 'no response',
        NoFinish: 'none',

        /**
         * @return {RegExp}
         */
        get Whitespace() {
            return /\s+/g;
        },

        /**
         * @return {RegExp}
         */
        get ForbiddenInKey() {
            return /[\s\u0000-\u001f\u007f]/;
        },

        /**
         * @return {RegExp}
         */
        get Digits() {
            return /^\d+$/;
        },
        Messages: Object.freeze({
            Network: 'request failed',
            NoResponse: 'no usable response',
            NoReader: 'response has no readable body',
            Unreadable: 'response body could not be read',
            BadStatus: 'unexpected HTTP status',
            NotObject: 'response body is not a JSON object',
            ProviderError: 'provider reported an error',
            Cut: 'answer was cut off',
            Errored: 'answer ended in an error',
            WrongFinish: 'answer did not finish with stop',
            Empty: 'answer has no usable content',
            BadArgument: 'invalid argument',
            BadSleep: 'sleep is not a function',
            TimeoutPrefix: 'no answer within ',
            TimeoutSuffix: ' seconds',
        }),
    }),

    /**
     * @param {string|null} key
     * @param {string} text
     * @return {string}
     */
    mask(key, text) {
        const settings = ScribeGateway.Settings;
        if (typeof key !== settings.StringType || key === settings.Nothing) {
            return text;
        }
        return text.replaceAll(key, settings.KeyMask);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    isObject(value) {
        return typeof value === ScribeGateway.Settings.ObjectType && value !== null && !Array.isArray(value);
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    filled(value) {
        const settings = ScribeGateway.Settings;
        return typeof value === settings.StringType && value !== settings.Nothing;
    },

    /**
     * @param {number} status
     * @return {boolean}
     */
    transient(status) {
        const settings = ScribeGateway.Settings;
        return status === settings.TimedOut || status === settings.RateLimited || status >= settings.FirstServerError;
    },

    /**
     * @param {string|null} key
     * @param {*} value
     * @return {string|null}
     */
    finishOf(key, value) {
        const settings = ScribeGateway.Settings;
        if (typeof value !== settings.StringType) {
            return null;
        }
        return ScribeGateway.mask(key, value).slice(0, settings.MaxFinishLength);
    },

    /**
     * @param {*} value
     * @return {{ code: number|null, reason: string|null }|null}
     */
    reported(value) {
        const settings = ScribeGateway.Settings;
        if (typeof value === settings.StringType) {
            return value === settings.Nothing ? null : { code: null, reason: value };
        }
        if (!ScribeGateway.isObject(value)) {
            return null;
        }
        const hasCode = value.code !== undefined && value.code !== null;
        const hasMessage = value.message !== undefined && value.message !== null;
        if (!hasCode && !hasMessage) {
            return null;
        }
        let code = null;
        if (typeof value.code === settings.NumberType) {
            code = value.code;
        } else if (typeof value.code === settings.StringType && settings.Digits.test(value.code)) {
            code = Number(value.code);
        }
        return { code, reason: typeof value.message === settings.StringType ? value.message : null };
    },

    /**
     * @param {string|null} key
     * @param {string} what
     * @param {{ retryable: boolean, status: number|null, finish: string|null, reason: string|null }} detail
     * @return {Error}
     */
    failure(key, what, detail) {
        const settings = ScribeGateway.Settings;
        const status = detail.status === null ? settings.NoStatus : String(detail.status);
        const finish = detail.finish === null ? settings.NoFinish : detail.finish;
        let message = `${what}; status ${status}; finish ${finish}`;
        if (detail.reason !== null) {
            const masked = ScribeGateway.mask(key, detail.reason);
            message += `; reason: ${masked.slice(0, settings.MaxReasonLength)}`;
        }
        const error = new Error(ScribeGateway.mask(key, message).replace(settings.Whitespace, settings.Space));
        error.retryable = detail.retryable;
        error.status = detail.status;
        error.finish = detail.finish === null ? null : ScribeGateway.mask(key, detail.finish);
        return error;
    },

    /**
     * @param {{ fetch: Function, sleep: Function, key: string, model: string, system: string, user: string, maxTokens: number, timeoutMs?: number, signal?: object }} request
     * @return {Promise<{ text: string, tokensIn: number, tokensOut: number, cost: number|null }>}
     */
    async call(request) {
        const settings = ScribeGateway.Settings;
        const checks = [
            ['fetch', typeof request.fetch === settings.FunctionType],
            ['sleep', typeof request.sleep === settings.FunctionType],
            ['key', ScribeGateway.filled(request.key) && !settings.ForbiddenInKey.test(request.key)],
            ['model', ScribeGateway.filled(request.model)],
            ['system', ScribeGateway.filled(request.system)],
            ['user', ScribeGateway.filled(request.user)],
            ['maxTokens', Number.isSafeInteger(request.maxTokens) && request.maxTokens > 0],
        ];
        for (const [name, valid] of checks) {
            if (!valid) {
                throw ScribeGateway.failure(null, `${settings.Messages.BadArgument}: ${name}`, {
                    retryable: false,
                    status: null,
                    finish: null,
                    reason: null,
                });
            }
        }
        const key = request.key;
        const send = request.fetch;
        const timeoutMs = Number.isFinite(request.timeoutMs) && request.timeoutMs > 0 ? request.timeoutMs : settings.TimeoutMs;
        const options = {
            method: settings.Method,
            headers: {
                [settings.AuthorizationHeader]: `${settings.BearerPrefix}${key}`,
                [settings.ContentTypeHeader]: settings.JsonType,
            },
            body: JSON.stringify({
                model: request.model,
                temperature: settings.Temperature,
                max_tokens: request.maxTokens,
                reasoning: { effort: settings.ReasoningEffort },
                usage: { include: true },
                messages: [
                    { role: settings.SystemRole, content: request.system },
                    { role: settings.UserRole, content: request.user },
                ],
            }),
        };
        if (request.signal !== undefined && request.signal !== null) {
            options.signal = request.signal;
        }

        /**
         * @return {Promise<{ status: number, raw: string }>}
         */
        const exchange = async () => {
            let response = null;
            try {
                response = await send(ScribeGateway.Endpoint, options);
            } catch (cause) {
                throw ScribeGateway.failure(key, settings.Messages.Network, {
                    retryable: true,
                    status: null,
                    finish: null,
                    reason: typeof cause?.message === settings.StringType ? cause.message : null,
                });
            }
            if (!ScribeGateway.isObject(response) || !Number.isFinite(response.status) || response.status < settings.FirstStatus) {
                throw ScribeGateway.failure(key, settings.Messages.NoResponse, {
                    retryable: true,
                    status: null,
                    finish: null,
                    reason: null,
                });
            }
            const received = response.status;
            if (typeof response.text !== settings.FunctionType) {
                throw ScribeGateway.failure(key, settings.Messages.NoReader, {
                    retryable: false,
                    status: received,
                    finish: null,
                    reason: null,
                });
            }
            try {
                return { status: received, raw: await response.text() };
            } catch (cause) {
                throw ScribeGateway.failure(key, settings.Messages.Unreadable, {
                    retryable: true,
                    status: received,
                    finish: null,
                    reason: typeof cause?.message === settings.StringType ? cause.message : null,
                });
            }
        };

        const exchanged = exchange();
        const timer = Promise.resolve(request.sleep(timeoutMs)).then(() => null);
        const outcome = await Promise.race([exchanged, timer]);
        if (outcome === null) {
            const seconds = timeoutMs / settings.MillisecondsPerSecond;
            throw ScribeGateway.failure(key, `${settings.Messages.TimeoutPrefix}${seconds}${settings.Messages.TimeoutSuffix}`, {
                retryable: true,
                status: null,
                finish: null,
                reason: null,
            });
        }
        const status = outcome.status;
        if (status < settings.FirstSuccess || status > settings.LastSuccess) {
            throw ScribeGateway.failure(key, settings.Messages.BadStatus, {
                retryable: ScribeGateway.transient(status),
                status,
                finish: null,
                reason: null,
            });
        }
        let parsed = null;
        try {
            const text = outcome.raw.startsWith(settings.ByteOrderMark) ? outcome.raw.slice(settings.ByteOrderMark.length) : outcome.raw;
            parsed = JSON.parse(text);
        } catch {
            parsed = null;
        }
        if (!ScribeGateway.isObject(parsed)) {
            throw ScribeGateway.failure(key, settings.Messages.NotObject, {
                retryable: true,
                status,
                finish: null,
                reason: null,
            });
        }
        const choice = Array.isArray(parsed.choices) && ScribeGateway.isObject(parsed.choices[0]) ? parsed.choices[0] : null;
        const finish = ScribeGateway.finishOf(key, choice?.finish_reason);
        for (const candidate of [parsed.error, choice?.error]) {
            const provider = ScribeGateway.reported(candidate);
            if (provider !== null) {
                throw ScribeGateway.failure(key, settings.Messages.ProviderError, {
                    retryable: provider.code !== null && ScribeGateway.transient(provider.code),
                    status,
                    finish,
                    reason: provider.reason,
                });
            }
        }
        if (finish === settings.Finish.Length) {
            throw ScribeGateway.failure(key, settings.Messages.Cut, { retryable: false, status, finish, reason: null });
        }
        if (finish === settings.Finish.Error) {
            throw ScribeGateway.failure(key, settings.Messages.Errored, { retryable: true, status, finish, reason: null });
        }
        if (finish !== settings.Finish.Stop) {
            throw ScribeGateway.failure(key, settings.Messages.WrongFinish, { retryable: false, status, finish, reason: null });
        }
        const content = choice.message?.content;
        if (typeof content !== settings.StringType || content.trim() === settings.Nothing) {
            throw ScribeGateway.failure(key, settings.Messages.Empty, { retryable: true, status, finish, reason: null });
        }
        const usage = ScribeGateway.isObject(parsed.usage) ? parsed.usage : {};
        return {
            text: content,
            tokensIn: Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens >= 0 ? usage.prompt_tokens : 0,
            tokensOut: Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens >= 0 ? usage.completion_tokens : 0,
            cost: Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : null,
        };
    },

    /**
     * @param {() => Promise<object>} attempt
     * @param {{ attempts: number, pauseMs: number, sleep: (milliseconds: number) => Promise<void> }} options
     * @return {Promise<object>}
     * @throws {Error}
     */
    async retry(attempt, options) {
        const settings = ScribeGateway.Settings;
        const given = ScribeGateway.isObject(options) ? options : {};
        if (typeof given.sleep !== settings.FunctionType) {
            throw ScribeGateway.failure(null, settings.Messages.BadSleep, {
                retryable: false,
                status: null,
                finish: null,
                reason: null,
            });
        }
        const requested = Number(given.attempts);
        const limit = Number.isFinite(requested) && requested >= settings.FirstAttempt ? Math.floor(requested) : settings.FirstAttempt;
        const pause = Number.isFinite(given.pauseMs) && given.pauseMs >= settings.NoPause ? given.pauseMs : settings.PauseMs;
        for (let number = settings.FirstAttempt; ; number++) {
            try {
                return await attempt();
            } catch (error) {
                if (error?.retryable !== true || number >= limit) {
                    throw error;
                }
                await given.sleep(pause * number);
            }
        }
    },
});
