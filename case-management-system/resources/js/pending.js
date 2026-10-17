const PENDING_CLASS = 'is-pending';
const LOADING_CLASS = 'loading';
const DISABLED_MARK = 'pendingDisabled';
const RECOVERY_DELAY_MS = 15000;

const recoveryTimers = new Map();

function submitButtons(form) {
    return Array.from(form.elements).filter((element) => element.type === 'submit');
}

function cancelRecovery(element) {
    const timer = recoveryTimers.get(element);

    if (timer !== undefined) {
        window.clearTimeout(timer);
        recoveryTimers.delete(element);
    }
}

function scheduleRecovery(element) {
    cancelRecovery(element);

    const timer = window.setTimeout(() => {
        recoveryTimers.delete(element);
        clearPending(element);
    }, RECOVERY_DELAY_MS);

    recoveryTimers.set(element, timer);
}

function markPending(element, submitter) {
    element.classList.add(PENDING_CLASS);
    element.setAttribute('aria-busy', 'true');

    if (submitter) {
        submitter.classList.add(LOADING_CLASS);
    }

    scheduleRecovery(element);
}

function disableSubmitButtons(form) {
    submitButtons(form).forEach((button) => {
        if (!button.disabled) {
            button.disabled = true;
            button.dataset[DISABLED_MARK] = 'true';
        }
    });
}

function clearPending(element) {
    cancelRecovery(element);
    element.classList.remove(PENDING_CLASS);
    element.removeAttribute('aria-busy');

    if (!(element instanceof HTMLFormElement)) {
        return;
    }

    submitButtons(element).forEach((button) => {
        button.classList.remove(LOADING_CLASS);

        if (button.dataset[DISABLED_MARK] === 'true') {
            button.disabled = false;
            delete button.dataset[DISABLED_MARK];
        }
    });
}

document.addEventListener('submit', (event) => {
    const form = event.target;

    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-pending')) {
        return;
    }

    if (form.classList.contains(PENDING_CLASS)) {
        event.preventDefault();

        return;
    }

    if (event.defaultPrevented) {
        return;
    }

    markPending(form, event.submitter);

    window.setTimeout(() => {
        if (event.defaultPrevented) {
            clearPending(form);

            return;
        }

        disableSubmitButtons(form);
    }, 0);
});

document.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    const link = event.target instanceof Element ? event.target.closest('a[data-pending]') : null;

    if (!(link instanceof HTMLAnchorElement) || (link.target !== '' && link.target !== '_self') || link.hasAttribute('download')) {
        return;
    }

    if (link.classList.contains(PENDING_CLASS)) {
        event.preventDefault();

        return;
    }

    if (event.defaultPrevented) {
        return;
    }

    markPending(link, null);

    window.setTimeout(() => {
        if (event.defaultPrevented) {
            clearPending(link);
        }
    }, 0);
});

window.addEventListener('pagehide', () => {
    recoveryTimers.forEach((timer) => {
        window.clearTimeout(timer);
    });
    recoveryTimers.clear();
});

window.addEventListener('pageshow', (event) => {
    if (!event.persisted) {
        return;
    }

    document.querySelectorAll(`form.${PENDING_CLASS}, a.${PENDING_CLASS}`).forEach(clearPending);
});
