// ==UserScript==
// @name         Zeta AI - Per-Room DM Memory Injector
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Per-chat campaign memory notes & automatic periodic narrator injection for Zeta AI
// @match        https://zeta-ai.io/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let lastPath = '';
    let bypassNextEnter = false;

    function getRoomKey() {
        return 'zeta_dm_mem_' + window.location.pathname;
    }

    function loadRoomState() {
        try {
            const raw = localStorage.getItem(getRoomKey());
            if (raw) return JSON.parse(raw);
        } catch (e) {
            console.error('Zeta DM Memory read error:', e);
        }
        return { notes: '', turnCount: 0, interval: 6, forceNext: false, minimized: false };
    }

    function saveRoomState(state) {
        try {
            localStorage.setItem(getRoomKey(), JSON.stringify(state));
        } catch (e) {
            console.error('Zeta DM Memory save error:', e);
        }
    }

    // Wrap each non-empty line in its own *...* on its own line (no parentheses)
    function formatNotesAsNarrator(rawNotes) {
        return (rawNotes || '')
            .split(/\r?\n/)
            .map(line => line.trim().replace(/^\*+|\*+$/g, '').trim())
            .filter(line => line.length > 0)
            .map(line => `*${line}*`)
            .join('\n');
    }

    // Force React 18+ controlled textarea to commit the updated multi-line string
    function setReactInputValue(el, value) {
        const prototype = el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

        const tracker = el._valueTracker;
        if (tracker) {
            tracker.setValue(el.value);
        }

        if (nativeSetter) {
            nativeSetter.call(el, value);
        } else {
            el.value = value;
        }

        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function findChatInput() {
        return (
            document.querySelector('textarea[name="message"]') ||
            document.querySelector('textarea:not(#zeta-dm-notes)') ||
            document.querySelector('input[type="text"]:not(#zeta-dm-interval)')
        );
    }

    function buildWidget() {
        if (document.getElementById('zeta-dm-widget')) return;

        const widget = document.createElement('div');
        widget.id = 'zeta-dm-widget';
        Object.assign(widget.style, {
            position: 'fixed',
            bottom: '85px',
            right: '20px',
            width: '290px',
            backgroundColor: 'rgba(22, 22, 28, 0.96)',
            color: '#f1f1f3',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            borderRadius: '10px',
            padding: '10px 12px',
            zIndex: '2147483647',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '12px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(6px)'
        });

        widget.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;cursor:pointer;" id="zeta-dm-header">
                <strong style="font-size:13px;color:#a78bfa;">🎲 DM Memory v1.2</strong>
                <button id="zeta-dm-toggle" type="button" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:14px;padding:0 4px;">—</button>
            </div>
            <div id="zeta-dm-body">
                <textarea id="zeta-dm-notes" rows="4" placeholder="One fact per line (each line gets wrapped in *...* on a new line)..." style="width:100%;box-sizing:border-box;background:#111116;color:#eee;border:1px solid #3f3f4e;border-radius:6px;padding:6px;font-size:12px;resize:vertical;margin-bottom:8px;"></textarea>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span>Turn counter: <strong id="zeta-dm-counter" style="color:#4ade80;">0 / 6</strong></span>
                    <label style="display:flex;align-items:center;gap:4px;">
                        Every
                        <input id="zeta-dm-interval" type="number" min="1" max="30" style="width:42px;background:#111116;color:#fff;border:1px solid #3f3f4e;border-radius:4px;padding:2px 4px;text-align:center;">
                    </label>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                    <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
                        <input id="zeta-dm-force" type="checkbox"> Inject on next message
                    </label>
                    <button id="zeta-dm-InsertNow" type="button" title="Paste into chat box right now" style="background:#3b3b4f;color:#fff;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:11px;">+ Paste</button>
                </div>
            </div>
        `;

        document.body.appendChild(widget);

        const notesEl = document.getElementById('zeta-dm-notes');
        const intervalEl = document.getElementById('zeta-dm-interval');
        const forceEl = document.getElementById('zeta-dm-force');
        const headerEl = document.getElementById('zeta-dm-header');
        const insertNowBtn = document.getElementById('zeta-dm-InsertNow');

        notesEl.addEventListener('input', () => {
            const state = loadRoomState();
            state.notes = notesEl.value;
            saveRoomState(state);
        });

        intervalEl.addEventListener('change', () => {
            const state = loadRoomState();
            state.interval = Math.max(1, parseInt(intervalEl.value, 10) || 6);
            saveRoomState(state);
            syncUI();
        });

        forceEl.addEventListener('change', () => {
            const state = loadRoomState();
            state.forceNext = forceEl.checked;
            saveRoomState(state);
            syncUI();
        });

        headerEl.addEventListener('click', () => {
            const state = loadRoomState();
            state.minimized = !state.minimized;
            saveRoomState(state);
            syncUI();
        });

        insertNowBtn.addEventListener('click', () => {
            const input = findChatInput();
            const state = loadRoomState();
            const formatted = formatNotesAsNarrator(state.notes);
            if (!input || !formatted) return;

            if (!input.value.includes(formatted)) {
                const currentText = input.value.trimEnd();
                const combined = currentText ? `${currentText}\n\n${formatted}` : formatted;
                setReactInputValue(input, combined);
                state.turnCount = 0;
                state.forceNext = false;
                saveRoomState(state);
                syncUI();
            }
        });

        syncUI();
    }

    function syncUI() {
        const widget = document.getElementById('zeta-dm-widget');
        if (!widget) return;

        const isChatPage = window.location.pathname.includes('/rooms/') || Boolean(findChatInput());
        widget.style.display = isChatPage ? 'block' : 'none';
        if (!isChatPage) return;

        const state = loadRoomState();
        const notesEl = document.getElementById('zeta-dm-notes');
        const counterEl = document.getElementById('zeta-dm-counter');
        const intervalEl = document.getElementById('zeta-dm-interval');
        const forceEl = document.getElementById('zeta-dm-force');
        const bodyEl = document.getElementById('zeta-dm-body');
        const toggleBtn = document.getElementById('zeta-dm-toggle');

        if (document.activeElement !== notesEl) {
            notesEl.value = state.notes || '';
        }
        intervalEl.value = state.interval || 6;
        forceEl.checked = Boolean(state.forceNext);

        const willFireNext = state.forceNext || (state.turnCount + 1 >= state.interval);
        counterEl.textContent = `${state.turnCount} / ${state.interval}`;
        counterEl.style.color = willFireNext ? '#facc15' : '#4ade80';

        bodyEl.style.display = state.minimized ? 'none' : 'block';
        toggleBtn.textContent = state.minimized ? '▢' : '—';
    }

    // Returns true if text was modified so the caller knows whether to delay submission by 1 frame
    function checkAndInject(inputEl) {
        if (!inputEl || !inputEl.value.trim()) return false;

        const state = loadRoomState();
        const formatted = formatNotesAsNarrator(state.notes);
        if (!formatted) return false;

        state.turnCount += 1;
        const shouldInject = state.forceNext || state.turnCount >= state.interval;
        let didModify = false;

        if (shouldInject) {
            if (!inputEl.value.includes(formatted)) {
                const currentText = inputEl.value.trimEnd();
                setReactInputValue(inputEl, `${currentText}\n\n${formatted}`);
                didModify = true;
            }
            state.turnCount = 0;
            state.forceNext = false;
        }

        saveRoomState(state);
        syncUI();
        return didModify;
    }

    // Intercept Enter keypress: pause native submit for 25ms when injecting so React state commits the newline
    window.addEventListener('keydown', (e) => {
        if (bypassNextEnter) return;

        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            const active = document.activeElement;
            if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') && active.id !== 'zeta-dm-notes' && active.id !== 'zeta-dm-interval') {
                const modified = checkAndInject(active);
                if (modified) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    setTimeout(() => {
                        bypassNextEnter = true;
                        active.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true,
                            cancelable: true
                        }));
                        bypassNextEnter = false;
                    }, 25);
                }
            }
        }
    }, true);

    // Intercept clicking the Send button with the mouse (pointerdown fires before click, giving React time to update)
    window.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('button');
        const input = findChatInput();
        if (!btn || !input || !input.value.trim()) return;
        if (btn.closest('#zeta-dm-widget')) return;

        if (btn.type === 'submit' || btn.querySelector('svg')) {
            const rect = btn.getBoundingClientRect();
            if (rect.bottom > window.innerHeight - 180) {
                checkAndInject(input);
            }
        }
    }, true);

    setInterval(() => {
        buildWidget();
        if (window.location.pathname !== lastPath) {
            lastPath = window.location.pathname;
            syncUI();
        }
    }, 800);
})();
