document.querySelectorAll('[data-auto-reply]').forEach((element) => {
    const status = element.querySelector('[data-auto-reply-status]');
    const retry = element.querySelector('[data-auto-reply-retry]');
    const showReply = element.querySelector('[data-auto-reply-show]');
    const token = document.querySelector('meta[name="csrf-token"]')?.content;
    let stopped = false;
    let activeRequest = null;
    let retryTimer = null;
    let delayTimer = null;

    async function deliver() {
        if (stopped || activeRequest) {
            return;
        }

        status.textContent = 'Checking for a reply…';
        retry.hidden = true;
        element.setAttribute('aria-busy', 'true');
        const controller = new AbortController();
        activeRequest = controller;
        const timeout = window.setTimeout(() => controller.abort(), 20000);

        try {
            if (!token) {
                throw new Error('Missing session token.');
            }

            const response = await fetch(element.dataset.url, {
                method: 'POST',
                headers: { 'X-CSRF-TOKEN': token, Accept: 'application/json' },
                credentials: 'same-origin',
                signal: controller.signal,
            });

            if (stopped) {
                return;
            }

            if (response.status === 429) {
                const seconds = Math.max(1, Number(response.headers.get('Retry-After')) || 60);
                status.textContent = `Too many requests. Try again in ${seconds} seconds.`;
                retry.hidden = false;
                retry.disabled = true;
                retryTimer = window.setTimeout(() => { retry.disabled = false; }, seconds * 1000);

                return;
            }

            if (!response.ok) {
                throw new Error('Reply request failed.');
            }

            const result = await response.json();

            if (stopped) {
                return;
            }

            if (result.delivered === true && typeof result.summary === 'string') {
                const hasDrafts = Array.from(document.querySelectorAll('[data-draft-form] [data-original-value]'))
                    .some((control) => control.value !== control.dataset.originalValue);

                if (hasDrafts) {
                    status.textContent = `${result.summary}. Your unsaved edits are still here. Save or copy them, or discard them below to show the reply.`;
                    showReply.hidden = false;

                    return;
                }

                status.textContent = result.summary;
                location.reload();

                return;
            }

            status.textContent = typeof result.summary === 'string' ? result.summary : 'No reply was delivered.';
            retry.hidden = false;
        } catch {
            if (!stopped) {
                status.textContent = 'Could not check for a reply. Check your connection and try again.';
                retry.hidden = false;
            }
        } finally {
            window.clearTimeout(timeout);
            activeRequest = null;
            element.removeAttribute('aria-busy');
        }
    }

    function stop() {
        stopped = true;
        window.clearTimeout(delayTimer);
        window.clearTimeout(retryTimer);
        activeRequest?.abort();
        retry.hidden = true;
        showReply.hidden = true;
        status.textContent = 'Automatic reply paused.';
        element.removeAttribute('aria-busy');
    }

    retry.addEventListener('click', deliver);
    showReply.addEventListener('click', (event) => {
        if (event.defaultPrevented) {
            return;
        }

        event.preventDefault();

        if (stopped) {
            return;
        }

        status.textContent = 'Showing the received reply…';
        element.setAttribute('aria-busy', 'true');
        location.reload();
    });
    delayTimer = window.setTimeout(deliver, Math.max(0, Number(element.dataset.delay) || 0) * 1000);
    window.addEventListener('pagehide', stop, { once: true });
    document.addEventListener('submit', (event) => {
        if (!event.defaultPrevented) {
            stop();
        }
    });
});
