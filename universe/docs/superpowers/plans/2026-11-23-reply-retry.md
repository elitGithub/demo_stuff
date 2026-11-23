# Reply retry plan

Design: `docs/superpowers/specs/2026-11-22-reply-retry-design.md`.

Operator rulings, 2026-11-23: plan approved; option B (below) added to the design's definition of a complete failure.

## Conventions

Those of `docs/superpowers/plans/2026-11-22-sync-rewrite.md`: browser code uses no dependency; one exported declaration per file (a frozen object); tag-only docblocks on every function, method and named callback, tests included; braces always; no single-letter or throwaway names; no swallowed errors; code first, then tests that try to break it; each test file run on its own with the sync plan's command. No agent runs `npm start`, `npm ci` or `npm run build` against the project, touches `universe/local/` or reads `.env`.

## Option B (verified in SillyTavern 1.19.1)

With streaming off (SillyTavern's default), an error answer from OpenRouter reaches the browser as HTTP 200 with `{error: {message}, quota_error}`, where `message` is OpenRouter's reason phrase (`src/endpoints/backends/chat-completions.js:2710`). A connection failure answers 502 (`:2724`). With streaming on, OpenRouter's status is passed through (`src/util.js` `forwardFetchResponse`).

A 200 answer counts as a complete failure when its `content-type` is `application/json`, its body has an `error` object, `quota_error` is not true, and `error.message` is one of `RetryReasons`. Any other 200 answer is returned untouched; a streamed answer (`text/event-stream`) is never read by the wrapper.

## Task: reply retry

Files:

- `extension/package.json`: `{"type": "module"}`, so Node loads the extension files as modules without a warning. Not copied into the build.
- `extension/universe-retry/ReplyRetrySettings.js`, frozen:

| Name | Value |
| --- | --- |
| `Endpoint` | `/api/backends/chat-completions/generate` |
| `DelaysMs` | 2000, 5000, 10000 |
| `RetryStatuses` | 408, 429, 500, 502, 503, 504 |
| `RetryReasons` | `Too Many Requests`, `Request Timeout`, `Internal Server Error`, `Bad Gateway`, `Service Unavailable`, `Gateway Timeout` |

- `extension/universe-retry/ReplyRetry.js`, frozen: `wrap(send, {wait, notify}): (input, options) => Promise<Response>`.
  - Only a `POST` whose URL path is `Endpoint` is retried; anything else is passed to `send` unchanged and its result returned unchanged.
  - Every attempt calls `send(input, options)` with the same arguments, so the body is byte-identical.
  - A complete failure is a status in `RetryStatuses`, an option-B answer, or a rejection of `send` while `options.signal` is not aborted. A rejection while the signal is aborted is returned at once.
  - Before retry `n` (1 to 3): `notify('Reply failed (<reason>). Retrying <n> of 3...')`, where the reason is `HTTP <status>`, the option-B `error.message`, or the rejection's message; then `await wait(DelaysMs[n - 1], options.signal)`.
  - `wait` rejects with `signal.reason` when the signal aborts during the wait; no further request is sent.
  - After the fourth complete failure the last response is returned, or the last rejection rethrown, unchanged. A response read for option B is read through `clone()`; the original is returned unread.
- `extension/universe-retry/index.js`: `window.fetch = ReplyRetry.wrap(window.fetch.bind(window), {wait, notify})`, where `wait` is a timer that honours the signal and `notify` is `toastr.warning`.
- `extension/universe-retry/manifest.json`: `display_name` `Universe: Reply Retry`, `loading_order` 1, `requires` [], `optional` [], `js` `index.js`, `author` `Universe`, `version` `1.0.0`.
- `scripts/build.mjs`: copies `manifest.json`, `index.js`, `ReplyRetry.js` and `ReplyRetrySettings.js` from `extension/universe-retry/` to `node_modules/sillytavern/public/scripts/extensions/third-party/universe-retry/` in the build; the four files join the build inputs and the required files; signature `Universe local build v7`, with v6 recognised as a previous build to replace.

Tests that try to break it:

- `tests/reply-retry.test.mjs`, with a fake `send`, a recording `wait` and `notify`:
  - a 502 then a 200 returns the 200 after one wait of 2000;
  - four 502s return the fourth 502 after waits of 2000, 5000 and 10000, and the toasts count 1, 2 and 3 of 3;
  - a rejection `TypeError('Failed to fetch')` then a 200 returns the 200;
  - 400, 401, 402, 403 and 404 return at once with no wait;
  - a 200 JSON answer `{error: {message: 'Service Unavailable'}}` then a reply returns the reply;
  - a 200 JSON answer with `error.message` `Payment Required`, and one with `quota_error: true` and `Too Many Requests`, return at once;
  - a 200 `text/event-stream` answer is returned with its body unread (`bodyUsed` false);
  - an abort during a wait rejects with the abort reason and sends no further request;
  - a rejection while the signal is already aborted is not retried;
  - a GET to `Endpoint` and a POST to any other path pass through with one call each;
  - every attempt receives the identical body string.
- `tests/build.test.mjs`: a v7 build holds the four extension files and not `extension/package.json`; a v6 output is replaced.
