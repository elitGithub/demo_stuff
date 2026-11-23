# Retry a reply request that failed completely

Status: draft for operator approval.

## Why

On 2026-11-22 a reply failed with `Generation failed FetchError: request to https://openrouter.ai/api/v1/chat/completions failed, reason: ETIMEDOUT`: the laptop's connection dropped. SillyTavern 1.19.1 has no retry setting and its OpenRouter address is fixed (`src/endpoints/backends/chat-completions.js`, no reverse-proxy option for OpenRouter), so the operator had to regenerate by hand.

## Operator ruling (2026-11-22)

"If the response is a complete failure, just retry the last request."

## Behaviour

- A complete failure is a reply request that returns no reply at all: SillyTavern's `POST /api/backends/chat-completions/generate` answers with HTTP 408, 429, 500, 502, 503 or 504, or the browser's request to SillyTavern itself fails with a network error. When OpenRouter cannot be reached, SillyTavern answers 502 (`chat-completions.js` near line 2718).
- On a complete failure the same request, with the identical body, is sent again after 2, 5 and 10 seconds: three retries, four attempts in all. A toast shows **Reply failed (<reason>). Retrying 1 of 3...**. If the last attempt also fails, SillyTavern receives that failure and shows its normal error.
- Not retried: HTTP 400, 401, 402, 403 and 404 (a bad request, a bad key, no credits; retrying cannot help), a reply that fails part-way after text has started streaming (the partial text stays and the operator regenerates), and a request the operator stopped (its abort signal is honoured during the wait too).
- Cost: if OpenRouter received the request before the connection died, a retry can be billed again. That is the price of retrying complete failures.

## Where it lives

A small SillyTavern extension owned by Universe, `universe/extension/universe-retry/` (`manifest.json`, `index.js`), copied by the build into SillyTavern's `public/scripts/extensions/third-party/` the same way Scenario Builder and Vocalia are. In the page it wraps `window.fetch` for that one endpoint only. It changes no SillyTavern file, needs no server hook and runs alongside Vocalia, which only sees a slower reply.

## Tests

Node's test runner with a fake `window.fetch`: a 502 followed by a 200 returns the 200 after one wait; four 502s return the last 502 after three waits; a 401 returns at once; an aborted signal during a wait stops at once without another request; a request to any other endpoint passes through untouched; the retried body is byte-identical to the first.

## Plan placement

A new task after Task 3 of the sync rewrite plan (Task 3 rewrites `scripts/build.mjs`, which this task also changes).
