const sheet = document.querySelector('[data-details-sheet]');

if (sheet) {
    const openers = document.querySelectorAll('[data-details-open]');
    let opener = openers[0];
    const close = sheet.querySelector('[data-details-close]');
    const wide = window.matchMedia('(min-width: 1500px)');
    const targets = ['case-details', 'case-issue', 'case-status', 'case-notes'];
    let initialized = false;
    let wasWide = wide.matches;
    let returnFocus = false;

    /**
     * @param {HTMLElement|null} preferredTarget
     * @return {void}
     */
    function openSheet(preferredTarget = null) {
        if (!wide.matches && !sheet.open) {
            sheet.showModal();
        }

        returnFocus = !wide.matches;

        openers.forEach((control) => control.setAttribute('aria-expanded', 'true'));
        const hashTarget = targets.includes(location.hash.slice(1)) ? document.getElementById(location.hash.slice(1)) : null;
        const firstField = document.getElementById('case-issue');
        const focusTarget = preferredTarget
            ? (preferredTarget.getClientRects().length > 0 ? preferredTarget : firstField)
            : sheet.querySelector('[aria-invalid="true"]') || hashTarget || firstField;
        focusTarget.focus();
    }

    /**
     * @return {void}
     */
    function configure() {
        const focusedField = sheet.contains(document.activeElement) ? document.activeElement : null;
        const keepOpen = initialized && sheet.open && (!wasWide || focusedField !== null);
        returnFocus = false;

        if (sheet.open) {
            sheet.close();
        }

        if (wide.matches) {
            sheet.setAttribute('role', 'complementary');
            sheet.removeAttribute('aria-modal');
            sheet.open = true;
            openers.forEach((control) => control.setAttribute('aria-expanded', 'true'));

            if (keepOpen || sheet.dataset.hasErrors === 'true' || targets.includes(location.hash.slice(1))) {
                openSheet(focusedField);
            }
        } else {
            sheet.setAttribute('role', 'dialog');
            sheet.setAttribute('aria-modal', 'true');
            openers.forEach((control) => control.setAttribute('aria-expanded', 'false'));

            if (keepOpen || sheet.dataset.hasErrors === 'true' || targets.includes(location.hash.slice(1))) {
                openSheet(focusedField);
            }
        }

        if (keepOpen && sheet.contains(document.activeElement)) {
            document.activeElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }

        initialized = true;
        wasWide = wide.matches;
    }

    openers.forEach((control) => control.addEventListener('click', (event) => {
        event.preventDefault();
        opener = control;
        openSheet(control.dataset.detailsFocus ? document.getElementById(control.dataset.detailsFocus) : null);
    }));
    close.addEventListener('click', () => sheet.close());
    sheet.addEventListener('close', () => {
        if (returnFocus && !wide.matches && !sheet.open) {
            openers.forEach((control) => control.setAttribute('aria-expanded', 'false'));
            opener.focus();
            returnFocus = false;
        }
    });
    window.addEventListener('hashchange', () => {
        if (targets.includes(location.hash.slice(1))) {
            openSheet();
        }
    });
    wide.addEventListener('change', configure);
    configure();
}
