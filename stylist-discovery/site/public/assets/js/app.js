document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');

    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    const destination = new URL(link.href, window.location.href);

    if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.search === window.location.search) {
        if (destination.hash) {
            const target = document.getElementById(decodeURIComponent(destination.hash.slice(1)));

            if (target) {
                target.setAttribute('tabindex', '-1');
                target.focus({ preventScroll: true });
            }
        }

        return;
    }

    if (destination.origin === window.location.origin && !link.hasAttribute('download') && (!link.target || link.target === '_self')) {
        if (link.getAttribute('aria-busy') === 'true') {
            event.preventDefault();
            return;
        }
        link.setAttribute('aria-busy', 'true');
        document.documentElement.setAttribute('aria-busy', 'true');
        const progress = document.createElement('span');
        progress.className = 'link-progress';
        progress.dataset.linkProgress = '';
        progress.setAttribute('role', 'status');
        progress.textContent = 'Loading…';
        link.append(progress);
    }
});

document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-loading-form]');
    if (!form || event.defaultPrevented) {
        return;
    }
    if (form.getAttribute('aria-busy') === 'true') {
        event.preventDefault();
        return;
    }
    if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
        event.preventDefault();
        return;
    }
    if (form.method.toLowerCase() === 'get') {
        const destination = new URL(form.action, window.location.href);
        destination.search = new URLSearchParams(new FormData(form)).toString();
        if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.search === window.location.search) {
            event.preventDefault();
            if (destination.hash) {
                window.location.hash = destination.hash;
                const target = document.getElementById(decodeURIComponent(destination.hash.slice(1)));
                target?.focus({ preventScroll: true });
                target?.scrollIntoView({ block: 'start' });
            }
            return;
        }
    }
    form.setAttribute('aria-busy', 'true');
    form.querySelectorAll('[data-loading-status]').forEach((status) => {
        status.hidden = false;
        status.setAttribute('aria-live', 'polite');
    });
    form.querySelectorAll('button[type="submit"]').forEach((button) => {
        button.disabled = true;
    });
    if (form.id) {
        document.querySelectorAll(`button[form="${form.id}"]`).forEach((button) => { button.disabled = true; });
        document.querySelectorAll(`[data-loading-for="${form.id}"]`).forEach((status) => { status.hidden = false; });
        document.querySelectorAll(`[data-loading-control-for="${form.id}"]`).forEach((control) => { control.setAttribute('aria-busy', 'true'); });
    }
});

window.addEventListener('pageshow', () => {
    document.documentElement.removeAttribute('aria-busy');
    document.querySelectorAll('[data-loading-form]').forEach((form) => {
        form.removeAttribute('aria-busy');
        form.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = false; });
        if (form.id) {
            document.querySelectorAll(`button[form="${form.id}"]`).forEach((button) => { button.disabled = false; });
            document.querySelectorAll(`[data-loading-for="${form.id}"]`).forEach((status) => { status.hidden = true; });
            document.querySelectorAll(`[data-loading-control-for="${form.id}"]`).forEach((control) => { control.removeAttribute('aria-busy'); });
        }
        form.querySelectorAll('[data-loading-status]').forEach((status) => { status.hidden = true; });
    });

    document.querySelectorAll('a[aria-busy="true"]').forEach((link) => {
        link.removeAttribute('aria-busy');
        link.querySelector('[data-link-progress]')?.remove();
    });

    const errors = document.querySelector('.error-summary, [data-recovery-result]');
    if (errors) {
        errors.focus();
    } else if (window.location.hash === '#save-result') {
        const result = document.querySelector('[data-save-result]');
        result?.focus({ preventScroll: true });
        result?.scrollIntoView({ block: 'start' });
    } else if (window.location.hash === '#portfolio' || window.location.hash === '#times' || window.location.hash === '#time-off' || window.location.hash === '#messages' || window.location.hash.startsWith('#message-')) {
        document.querySelector(window.location.hash)?.focus({ preventScroll: true });
    }
});

document.addEventListener('change', (event) => {
    const control = event.target.closest('[data-submit-form]');
    if (control) {
        document.getElementById(control.dataset.submitForm)?.requestSubmit();
    }
});

const filterDisclosure = document.querySelector('.discovery-filters');
if (filterDisclosure) {
    const desktopFilters = window.matchMedia('(min-width: 1000px)');
    const setDisclosure = () => { filterDisclosure.open = desktopFilters.matches || filterDisclosure.dataset.keepOpen === 'true'; };
    setDisclosure();
    desktopFilters.addEventListener('change', setDisclosure);
}
