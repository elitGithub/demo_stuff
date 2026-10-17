<script>
(() => {
    const storageKey = 'casefile.theme';
    const preferences = Object.freeze({ system: 'system', light: 'light', dark: 'dark' });
    const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
    let preference = preferences.system;
    let storageFailed = false;
    let unsavedChoice = false;
    let control = null;
    let choices = [];
    let notice = null;
    let trigger = null;
    let tooltip = null;

    /**
     * @param {unknown} value
     * @return {'system'|'light'|'dark'}
     */
    function normalizePreference(value) {
        return value === preferences.light || value === preferences.dark ? value : preferences.system;
    }

    /**
     * @param {unknown} error
     * @return {boolean}
     */
    function isStorageFailure(error) {
        return error instanceof DOMException && (error.name === 'SecurityError' || error.name === 'QuotaExceededError');
    }

    /**
     * @return {'system'|'light'|'dark'|null}
     */
    function readStoredPreference() {
        try {
            const value = window.localStorage.getItem(storageKey);
            storageFailed = false;
            return normalizePreference(value);
        } catch (error) {
            if (!isStorageFailure(error)) {
                throw error;
            }

            storageFailed = true;
            return null;
        }
    }

    /**
     * @return {void}
     */
    function renderTheme() {
        document.documentElement.dataset.theme = preference === preferences.system
            ? (darkMedia.matches ? preferences.dark : preferences.light)
            : preference;

        choices.forEach((choice) => {
            choice.checked = choice.value === preference;
        });

        const label = 'Appearance: ' + preference.charAt(0).toUpperCase() + preference.slice(1);
        if (trigger) {
            trigger.setAttribute('aria-label', label);
            trigger.setAttribute('title', label);
        }
        if (tooltip) {
            tooltip.textContent = label;
        }

        if (notice) {
            notice.textContent = storageFailed ? 'This choice applies to this page only.' : '';
        }
    }

    const savedPreference = readStoredPreference();
    preference = savedPreference === null ? preferences.system : savedPreference;
    renderTheme();

    document.addEventListener('DOMContentLoaded', () => {
        control = document.querySelector('[data-theme-control]');
        choices = Array.from(control.querySelectorAll('[data-theme-option]'));
        notice = control.querySelector('[data-theme-notice]');
        trigger = control.querySelector('[data-theme-trigger]');
        tooltip = control.querySelector('[data-theme-tooltip]');

        choices.forEach((choice) => {
            choice.addEventListener('click', (event) => {
                if (event.detail > 0) {
                    choice.closest('[data-header-disclosure]').open = false;
                    trigger.focus({ preventScroll: true });
                }
            });

            choice.addEventListener('change', () => {
                if (!choice.checked) {
                    return;
                }

                preference = normalizePreference(choice.value);
                renderTheme();

                try {
                    window.localStorage.setItem(storageKey, preference);
                    storageFailed = false;
                    unsavedChoice = false;
                } catch (error) {
                    if (!isStorageFailure(error)) {
                        throw error;
                    }

                    storageFailed = true;
                    unsavedChoice = true;
                }

                renderTheme();
            });
        });

        renderTheme();
        control.removeAttribute('hidden');
    });

    darkMedia.addEventListener('change', () => {
        if (preference === preferences.system) {
            renderTheme();
        }
    });

    window.addEventListener('storage', (event) => {
        if (event.key !== storageKey && event.key !== null) {
            return;
        }

        try {
            if (event.storageArea !== window.localStorage) {
                return;
            }
        } catch (error) {
            if (!isStorageFailure(error)) {
                throw error;
            }

            storageFailed = true;
            renderTheme();
            return;
        }

        preference = normalizePreference(event.newValue);
        unsavedChoice = false;
        storageFailed = false;
        renderTheme();
    });

    window.addEventListener('pageshow', (event) => {
        if (!event.persisted || unsavedChoice) {
            return;
        }

        const restoredPreference = readStoredPreference();
        if (restoredPreference !== null) {
            preference = restoredPreference;
        }
        renderTheme();
    });
})();
</script>
