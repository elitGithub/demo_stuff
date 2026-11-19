# Clear errors in the Scribe panel

Proposed for operator approval, 19 November 2026.

## What the operator sees

In the expanded panel, keep current activity on its own line. While the reader pulls a room, for example, show “Reading chat history from Zeta · 155 messages”. Directly below it, show each active problem once. Use separate text elements that wrap on a phone. In the collapsed phone strip, show a short summary such as “OpenRouter key rejected” or “2 problems” when two independent causes are active. The existing expand control reveals the full notices.

For the reported OpenRouter 401 affecting both live calls, show:

> OpenRouter rejected the saved API key. Scene updates and story checks could not run. Open Settings, enter your current OpenRouter key, and press Save key.

Name only the affected work. If the scene succeeds and only the check has an error, the notice names story checks alone. Include the story recap if its call shares the same cause. Remove resolved problems on the next redraw. Saving a key uses the existing recovery path.

## How to explain other errors

Identify the service from the operation. Zeta reads chat history, the Cloudflare Worker syncs the saved book, and OpenRouter handles model calls. Explain a Worker credential rejection with its own action, Tampermonkey → Zeta Scribe → Set DM API key. A Zeta login problem points to signing in to Zeta. Two services returning the same status produce two distinct notices.

For model errors, distinguish a rejected key, insufficient credits, a rate limit, service unavailability, and an incomplete or unusable answer when the evidence identifies the cause. Group only equivalent problems from the same service. Use plain language for the affected operation when the cause is unknown. Show retry guidance only when it matches the actual retry state. Preserve the existing masked diagnostic for troubleshooting in Progress, including a useful provider reason. Omit empty fields such as “finish none” from the main notice.

## A saved OpenRouter key applies to every Scribe tab

The existing Save key action writes to the userscript's shared Tampermonkey storage, then invokes recovery only in the tab that saved it. A model call reads the key at its start. The missing behavior is notifying other open tabs, including tabs in different rooms, and invalidating work that captured the previous key.

After a successful save, every Zeta Scribe tab in the same browser profile adopts the latest saved key without a reload. Each pane clears any older unsaved key input and reports that a key is saved. Keep the input blank. A dormant tab reconciles when it wakes, before using an old credential or saving a stale field. A newly opened tab uses the latest saved key. Closely spaced saves converge on the last successful save.

Use only userscript-local storage and local change detection for propagation. No credential, fingerprint, or key material goes into page or frame messages, cloud records, diagnostics, or synchronization requests. Only the existing authenticated model requests to OpenRouter use the credential. No network request is needed to distribute or validate the change.

Each active reader resumes eligible blocked work through its existing recovery path. Other tabs respect the existing reader lock and budgets. An old request that finishes after the change cannot restore a stale key warning or issue a retry with the previous key. A successful save takes effect even when a different room or a hidden tab received the original 401.

## Implementation boundaries and acceptance

The current headline appends live failure strings to the activity text. Render the activity and active notices separately and handle previously saved failure strings on first display. Progress shows the saved, masked reason for an active failure even after the in-memory call history clears on reload. Keep existing book data, authentication, retry scheduling, and key storage compatible.

- Replay the reported 155-message pull and two identical 401s. Expect one Zeta activity line, one actionable OpenRouter warning, and no duplicate on redraw or reload.
- Exercise single-role, partial recovery, simultaneous unrelated errors, and full recovery. A currently failing role remains visible until its existing failure state clears.
- Show simultaneous Cloudflare and OpenRouter credential failures with the correct key action for each. Distinguish a Zeta login failure from both.
- Check the expanded and collapsed panel, including on a narrow screen, and the packed userscript path. Verify masked diagnostic detail, genuine unknown errors, and continued visibility of book and sync status.
- With two rooms and a second tab watching one room, change the key once. Verify the new key on the next permitted model request from either room, single recovery per reader, stale-field clearing, and recovery from a delayed old 401. Repeat with a sleeping tab, a reopened tab, a failed save, and two rapid saves. Inspect simulated network, cloud payloads, page/frame messages and rendered output for test key leakage.
- Hold a model request in the existing retry delay after a 503, save a new key in another tab, then release the delay. Every subsequent outbound attempt must use the current saved key.
