<div class="theme-control" data-theme-control hidden>
    <details class="header-disclosure appearance-disclosure" data-header-disclosure>
        <summary class="header-utility" data-theme-trigger aria-label="Appearance: System">
            <x-icon name="appearance" />
            <span class="header-tooltip" data-theme-tooltip aria-hidden="true">Appearance: System</span>
        </summary>
        <div class="header-menu appearance-menu">
            <fieldset class="appearance-options" aria-describedby="theme-storage-notice">
                <legend>Appearance</legend>
                <label class="appearance-choice" for="theme-system">
                    <input id="theme-system" type="radio" name="casefile-theme" value="system" data-theme-option checked>
                    <x-icon name="system" />
                    <span class="appearance-copy">System<small>Match your device</small></span>
                    <x-icon name="check" class="appearance-check" />
                </label>
                <label class="appearance-choice" for="theme-light">
                    <input id="theme-light" type="radio" name="casefile-theme" value="light" data-theme-option>
                    <x-icon name="sun" />
                    <span class="appearance-copy">Light</span>
                    <x-icon name="check" class="appearance-check" />
                </label>
                <label class="appearance-choice" for="theme-dark">
                    <input id="theme-dark" type="radio" name="casefile-theme" value="dark" data-theme-option>
                    <x-icon name="moon" />
                    <span class="appearance-copy">Dark</span>
                    <x-icon name="check" class="appearance-check" />
                </label>
            </fieldset>
        </div>
    </details>
    <span id="theme-storage-notice" class="theme-storage-notice" data-theme-notice role="status" aria-live="polite"></span>
</div>
