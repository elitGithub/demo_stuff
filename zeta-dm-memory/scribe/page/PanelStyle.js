const PanelStyle = (() => {
    const tokens = `:host {
    all: initial;
    --scribe-width: 360px;
    --scribe-tab-width: 3rem;
    --scribe-layer: 2147483000;
    --scribe-surface: #f5f3ee;
    --scribe-panel: #ffffff;
    --scribe-ink: #1f1e1b;
    --scribe-muted: #5c5a54;
    --scribe-line: #d4d0c6;
    --scribe-accent: #2c5a85;
    --scribe-accent-hover: #1f4466;
    --scribe-accent-ink: #ffffff;
    --scribe-danger: #8f2a2a;
    --scribe-focus: #b9561a;
    --scribe-quote: #efece4;
    --scribe-disabled: #9a978f;
    --scribe-shadow: rgba(0, 0, 0, 0.25);
    --scribe-gap: 0.75rem;
    --scribe-gap-small: 0.375rem;
    --scribe-radius: 0.375rem;
    --scribe-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --scribe-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
    :host {
        --scribe-surface: #1b1a18;
        --scribe-panel: #262522;
        --scribe-ink: #ece9e1;
        --scribe-muted: #b0ada4;
        --scribe-line: #45433e;
        --scribe-accent: #8db8e0;
        --scribe-accent-hover: #b3d1ec;
        --scribe-accent-ink: #12202d;
        --scribe-danger: #e39a9a;
        --scribe-focus: #f0a46c;
        --scribe-quote: #302e2a;
        --scribe-disabled: #77746c;
        --scribe-shadow: rgba(0, 0, 0, 0.6);
    }
}
`;
    return Object.freeze({
        Text: `${tokens}
*,
*::before,
*::after {
    box-sizing: border-box;
}

[hidden] {
    display: none !important;
}

p,
li,
span,
label,
summary,
pre,
button,
h2,
h3,
h4 {
    unicode-bidi: isolate;
}

.panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: var(--scribe-layer);
    display: flex;
    flex-direction: column;
    width: min(var(--scribe-width), 100vw);
    background: var(--scribe-panel);
    color: var(--scribe-ink);
    border-left: 1px solid var(--scribe-line);
    box-shadow: -2px 0 8px var(--scribe-shadow);
    font-family: var(--scribe-font);
    font-size: 14px;
    line-height: 1.45;
    text-align: left;
}

.panel.collapsed {
    top: 35vh;
    bottom: auto;
    width: var(--scribe-tab-width);
    border: 1px solid var(--scribe-line);
    border-right: 0;
    border-radius: var(--scribe-radius) 0 0 var(--scribe-radius);
}

.header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--scribe-gap-small);
    padding: var(--scribe-gap-small) var(--scribe-gap);
    border-bottom: 1px solid var(--scribe-line);
    background: var(--scribe-surface);
}

.panel.collapsed .header {
    flex-direction: column;
    flex-wrap: nowrap;
    padding: var(--scribe-gap-small);
    border-bottom: 0;
}

.panel.collapsed .headline,
.panel.collapsed .spend,
.panel.collapsed .outcome,
.panel.collapsed .trouble {
    display: none;
}

#scribe-problems,
#scribe-problem-details {
    flex: 1 1 100%;
    min-width: 0;
    overflow-wrap: anywhere;
}

#scribe-problems p,
#scribe-problem-details p {
    margin: 0 0 var(--scribe-gap-small);
}

.header:has(#scribe-problems:not([hidden])) {
    max-height: 50vh;
    overflow-y: auto;
    flex-shrink: 0;
}

.panel.collapsed:has(#scribe-problems-compact:not([hidden])) {
    width: min(14rem, 100vw);
}

.panel.collapsed .header:has(#scribe-problems-compact:not([hidden])) {
    flex-direction: row;
    flex-wrap: wrap;
}

.panel.collapsed #scribe-problems-compact {
    flex: 1 1 5rem;
    min-width: 0;
    overflow-wrap: anywhere;
}

.panel.collapsed .header:has(#scribe-problems-compact:not([hidden])) .toggle {
    writing-mode: horizontal-tb;
    order: -1;
}

.panel.collapsed .badge,
.panel.collapsed .toggle {
    writing-mode: vertical-rl;
}

.activity {
    flex: 1 1 100%;
    display: flex;
    flex-direction: column;
    gap: var(--scribe-gap-small);
}

.activity p {
    margin: 0;
    color: var(--scribe-muted);
}

.meter {
    width: 100%;
    accent-color: var(--scribe-accent);
}

.hollow {
    margin: 0 0 var(--scribe-gap);
    color: var(--scribe-muted);
}

.panel.collapsed .activity p {
    display: none;
}

.headline {
    flex: 1 1 100%;
    margin: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
}

.choice {
    flex: 1 1 100%;
    min-width: 0;
}

.choice p {
    margin: 0;
    overflow-wrap: anywhere;
}

.panel.collapsed .choice {
    display: none;
}

.badge {
    padding: 0 var(--scribe-gap-small);
    border-radius: var(--scribe-radius);
    background: var(--scribe-accent);
    color: var(--scribe-accent-ink);
    font-weight: 600;
}

.spend {
    color: var(--scribe-muted);
    margin-right: auto;
}

.trouble {
    flex: 1 1 100%;
    margin: 0;
    color: var(--scribe-danger);
    overflow-wrap: anywhere;
}

.body {
    flex: 1 1 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--scribe-gap-small) var(--scribe-gap) var(--scribe-gap);
}

.tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--scribe-gap-small);
    margin-bottom: var(--scribe-gap-small);
}

.tabs [role="tab"][aria-selected="true"] {
    background: var(--scribe-accent);
    border-color: var(--scribe-accent);
    color: var(--scribe-accent-ink);
}

.panel-title {
    font-size: 1.125rem;
    margin: var(--scribe-gap-small) 0;
}

.group + .group {
    margin-top: var(--scribe-gap);
}

.group h3,
.detail h3,
.form h4 {
    font-size: 1rem;
    margin: var(--scribe-gap-small) 0;
}

.field {
    display: flex;
    flex-direction: column;
    gap: var(--scribe-gap-small);
    margin-bottom: var(--scribe-gap-small);
}

.tick {
    display: flex;
    align-items: center;
    gap: var(--scribe-gap-small);
    margin-bottom: var(--scribe-gap-small);
}

.required {
    color: var(--scribe-danger);
    font-weight: 700;
}

input,
textarea,
select,
button {
    font: inherit;
    color: var(--scribe-ink);
    background: var(--scribe-panel);
    border: 1px solid var(--scribe-line);
    border-radius: var(--scribe-radius);
    padding: var(--scribe-gap-small) var(--scribe-gap);
    min-height: 2.25rem;
}

textarea {
    width: 100%;
    min-height: 5rem;
    resize: vertical;
}

input[aria-invalid="true"],
textarea[aria-invalid="true"] {
    border-color: var(--scribe-danger);
}

button {
    cursor: pointer;
    transition: background-color 120ms ease;
}

button:hover:not(:disabled) {
    background: var(--scribe-quote);
}

button.primary {
    background: var(--scribe-accent);
    border-color: var(--scribe-accent);
    color: var(--scribe-accent-ink);
}

button.primary:hover:not(:disabled) {
    background: var(--scribe-accent-hover);
    border-color: var(--scribe-accent-hover);
}

button.danger {
    border-color: var(--scribe-danger);
    color: var(--scribe-danger);
}

button:disabled,
input:disabled,
textarea:disabled,
select:disabled {
    color: var(--scribe-disabled);
    border-color: var(--scribe-line);
    background: var(--scribe-surface);
    cursor: not-allowed;
}

button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible,
summary:focus-visible,
.panel-title:focus-visible {
    outline: 3px solid var(--scribe-focus);
    outline-offset: 2px;
}

.actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--scribe-gap-small);
    margin: var(--scribe-gap-small) 0;
}

.choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--scribe-gap-small);
}

.rows {
    list-style: none;
    margin: 0;
    padding: 0;
}

.rows > li {
    border-bottom: 1px solid var(--scribe-line);
    padding: var(--scribe-gap-small) 0;
    overflow-wrap: anywhere;
}

.rows > li.empty,
.meta,
.place,
details summary {
    color: var(--scribe-muted);
}

.rows p {
    margin: var(--scribe-gap-small) 0;
}

.lines {
    margin: 0;
    padding-left: var(--scribe-gap);
}

.day {
    font-weight: 600;
}

.title {
    font-weight: 600;
}

.problem,
.unreadable {
    color: var(--scribe-danger);
    overflow-wrap: anywhere;
}

.outcome {
    min-height: 1.45em;
    margin: var(--scribe-gap-small) 0;
    overflow-wrap: anywhere;
}

.offer {
    margin: var(--scribe-gap-small) 0;
    padding: var(--scribe-gap-small) var(--scribe-gap);
    background: var(--scribe-quote);
    border-left: 3px solid var(--scribe-accent);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.message {
    margin: var(--scribe-gap-small) 0;
    padding: var(--scribe-gap-small) var(--scribe-gap);
    background: var(--scribe-quote);
    border-left: 3px solid var(--scribe-line);
    font-family: var(--scribe-mono);
    font-size: 0.8125rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--scribe-gap);
    margin-top: var(--scribe-gap-small);
}

.pager .place {
    margin: 0;
}

.form {
    border: 1px solid var(--scribe-line);
    border-radius: var(--scribe-radius);
    margin: var(--scribe-gap) 0;
    padding: var(--scribe-gap);
}

details summary {
    cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
        transition: none !important;
        animation: none !important;
        scroll-behavior: auto !important;
    }
}
`,
        PlotText: `${tokens}
*,
*::before,
*::after {
    box-sizing: border-box;
}

[hidden] {
    display: none !important;
}

p,
button {
    unicode-bidi: isolate;
}

.plot-export {
    position: fixed;
    right: var(--scribe-gap);
    bottom: var(--scribe-gap);
    z-index: var(--scribe-layer);
    max-width: calc(100vw - 1.5rem);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--scribe-gap-small);
    padding: var(--scribe-gap-small) var(--scribe-gap);
    background: var(--scribe-panel);
    color: var(--scribe-ink);
    border: 1px solid var(--scribe-line);
    border-radius: var(--scribe-radius);
    box-shadow: 0 2px 8px var(--scribe-shadow);
    font-family: var(--scribe-font);
    font-size: 14px;
    line-height: 1.45;
    text-align: left;
}

.plot-export-button {
    font: inherit;
    color: var(--scribe-accent-ink);
    background: var(--scribe-accent);
    border: 1px solid var(--scribe-accent);
    border-radius: var(--scribe-radius);
    padding: var(--scribe-gap-small) var(--scribe-gap);
    min-height: 2.25rem;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease;
}

.plot-export-button:hover:not(:disabled) {
    background: var(--scribe-accent-hover);
    border-color: var(--scribe-accent-hover);
}

.plot-export-button:disabled {
    color: var(--scribe-disabled);
    border-color: var(--scribe-line);
    background: var(--scribe-surface);
    cursor: not-allowed;
}

.plot-export-button:focus-visible {
    outline: 3px solid var(--scribe-focus);
    outline-offset: 2px;
}

.plot-export-status {
    margin: 0;
    min-width: 0;
    color: var(--scribe-muted);
    overflow-wrap: anywhere;
}

.plot-export-status.error {
    color: var(--scribe-danger);
}

@media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
        transition: none !important;
        animation: none !important;
        scroll-behavior: auto !important;
    }
}
`,
    });
})();
