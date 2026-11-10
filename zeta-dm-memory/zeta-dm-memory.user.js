// ==UserScript==
// @name         Zeta AI - Per-Room DM Memory Injector
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Per-chat campaign memory notes & automatic periodic narrator injection for Zeta AI
// @match        https://zeta-ai.io/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @connect      zeta-dm-memory.elit1989.workers.dev
// ==/UserScript==

(function () {
    'use strict';

    let lastPath = '';
    let bypassNextEnter = false;

    /**
     * @param {string} [roomId]
     * @return {string}
     */
    function getRoomKey(roomId = window.location.pathname) {
        return 'zeta_dm_mem_' + roomId;
    }

    /**
     * @param {string} [roomId]
     * @return {object}
     */
    function loadRoomState(roomId = window.location.pathname) {
        try {
            const raw = localStorage.getItem(getRoomKey(roomId));
            if (raw) {
                const state = JSON.parse(raw);
                if (state && typeof state === 'object' && !Array.isArray(state)) {
                    return state;
                }
            }
        } catch {
            console.error('Zeta DM Memory read error');
        }
        return { notes: '', turnCount: 0, interval: 6, forceNext: false, minimized: false };
    }

    /**
     * @param {object} state
     * @param {string} [roomId]
     * @return {boolean}
     */
    function saveRoomState(state, roomId = window.location.pathname) {
        try {
            localStorage.setItem(getRoomKey(roomId), JSON.stringify(state));
            return true;
        } catch {
            console.error('Zeta DM Memory save error');
            return false;
        }
    }

    /**
     * @typedef {Readonly<{roomId: string, revision: number, updatedAt: string}>} MemoryMetadata
     * @typedef {Readonly<MemoryMetadata & {notes: string}>} Memory
     * @typedef {Readonly<{items: ReadonlyArray<MemoryMetadata>, nextCursor: ?string}>} Page
     * @typedef {Readonly<{status: number, data: unknown, retryAfter: number}>} ApiResult
     */
    const cloudSync = {
        Origin: 'https://zeta-dm-memory.elit1989.workers.dev',
        KeyName: 'zeta_dm_api_key',
        QuietMs: 500,
        TimeoutMs: 15000,
        PageSize: 25,
        BackoffMs: Object.freeze([1000, 2000, 4000, 8000, 16000]),
        Status: Object.freeze({
            Setup: 'Local only. Set DM API key in Tampermonkey.',
            Auth: 'Key rejected. Set DM API key in Tampermonkey.',
            Config: 'API configuration error. Check the DM API key.',
            Loading: 'Loading notes…',
            Saving: 'Saving notes…',
            Saved: 'Saved',
            Empty: 'No cloud notes yet.',
            Unsynced: 'Unsynced',
            Conflict: 'Conflict. Choose which notes to keep.',
            InvalidNote: 'Unsynced. Notes must be valid Unicode and at most 65,536 UTF-8 bytes.',
            LocalError: 'Local save failed',
            Retrying: 'Unsynced. Retrying…',
            Stopped: 'Unsynced. Use Retry notes sync in Tampermonkey.',
            Error: 'Unsynced. Request rejected. Use Retry notes sync in Tampermonkey.',
        }),
        Choice: Object.freeze({ UseCloud: 'UseCloud', KeepLocal: 'KeepLocal' }),
        Work: Object.freeze({ Read: 'Read', Save: 'Save' }),
        Transport: Object.freeze({ Network: 0, Rejected: -1, Cancelled: -2 }),
        rooms: new Map(),
        aborters: new Set(),
        generation: 0,
        boundRoom: null,
        shownValue: '',
        shownNotes: '',
        shownConflict: null,
        keyBlock: null,
        picker: null,
        controls: null,

        /**
         * @return {void}
         */
        start() {
            this.keyBlock = this.keyStatus(GM_getValue(this.KeyName, ''));
            GM_registerMenuCommand('Set DM API key', () => {
                const key = window.prompt('Enter DM API key');
                if (key === null) {
                    return;
                }
                if (!this.validKey(key)) {
                    window.alert('Enter 60–254 visible ASCII characters.');
                    return;
                }
                if (key !== GM_getValue(this.KeyName, '')) {
                    GM_setValue(this.KeyName, key);
                    this.rotateKey(key);
                }
            });
            GM_registerMenuCommand('Retry notes sync', () => {
                const roomId = window.location.pathname;
                this.activateRoom(roomId, false);
                if (!this.isChatRoom(roomId)) {
                    return;
                }
                const room = this.room(roomId);
                this.keyBlock = this.keyStatus(GM_getValue(this.KeyName, ''));
                room.blocked = null;
                room.retryCount = 0;
                if (room.draft) {
                    this.persist(roomId, this.localState(roomId));
                }
                void this.synchronize(roomId, true);
            });
            GM_addValueChangeListener(this.KeyName, (name, previous, key, remote) => {
                if (remote && previous !== key) {
                    this.rotateKey(key);
                }
            });
            window.addEventListener('focus', () => {
                const roomId = window.location.pathname;
                this.activateRoom(roomId, false);
                void this.synchronize(roomId, true);
            });
        },

        /**
         * @param {unknown} value
         * @return {boolean}
         */
        validKey(value) {
            return typeof value === 'string' && value.length >= 60 && value.length <= 254
                && !/[^!-~]/.test(value);
        },

        /**
         * @param {unknown} value
         * @return {?string}
         */
        keyStatus(value) {
            if (this.validKey(value)) {
                return null;
            }
            return value ? this.Status.Config : this.Status.Setup;
        },

        /**
         * @param {unknown} key
         * @return {void}
         */
        rotateKey(key) {
            this.generation += 1;
            this.keyBlock = this.keyStatus(key);
            this.picker = null;
            for (const room of this.rooms.values()) {
                clearTimeout(room.timer);
                room.ready = false;
                room.needsRead = false;
                room.retryAt = 0;
                room.retryCount = 0;
                room.blocked = null;
                room.uncertain = null;
                room.rejectedSave = false;
            }
            for (const abort of this.aborters) {
                abort(this.Transport.Cancelled);
            }
            const roomId = window.location.pathname;
            this.activateRoom(roomId, false);
            void this.synchronize(roomId, true);
            this.render(roomId);
        },

        /**
         * @param {string} roomId
         * @return {boolean}
         */
        isChatRoom(roomId) {
            return /^\/(?:[^/]+\/)?rooms\/[^/]+\/?$/.test(roomId) && this.validRoomId(roomId);
        },

        /**
         * @param {unknown} value
         * @return {boolean}
         */
        validRoomId(value) {
            return typeof value === 'string' && value.startsWith('/')
                && !/[\p{White_Space}\p{Cc}\uFEFF\uD800-\uDFFF\\?#]/u.test(value)
                && new TextEncoder().encode(value).length <= 512;
        },

        /**
         * @param {unknown} notes
         * @return {boolean}
         */
        validNotes(notes) {
            return typeof notes === 'string' && !/[\uD800-\uDFFF]/u.test(notes)
                && new TextEncoder().encode(notes).length <= 65536;
        },

        /**
         * @param {unknown} data
         * @return {?MemoryMetadata}
         */
        metadata(data) {
            if (!data || !this.validRoomId(data.roomId)
                || !Number.isSafeInteger(data.revision) || data.revision <= 0
                || typeof data.updatedAt !== 'string'
                || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(data.updatedAt)) {
                return null;
            }
            const date = new Date(data.updatedAt);
            if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 19) !== data.updatedAt.slice(0, 19)) {
                return null;
            }
            return Object.freeze({ roomId: data.roomId, revision: data.revision, updatedAt: data.updatedAt });
        },

        /**
         * @param {unknown} data
         * @param {string} roomId
         * @return {?Memory}
         */
        memory(data, roomId) {
            const metadata = this.metadata(data);
            if (!metadata || metadata.roomId !== roomId || !this.validNotes(data.notes)) {
                return null;
            }
            return Object.freeze({ ...metadata, notes: data.notes });
        },

        /**
         * @param {string} roomId
         * @return {object}
         */
        room(roomId) {
            if (!this.rooms.has(roomId)) {
                this.rooms.set(roomId, {
                    ready: false, needsRead: false, running: null, timer: null, composing: false,
                    blocked: null, retryAt: 0, retryCount: 0, uncertain: null, rejectedSave: false, draft: null,
                    editorEditId: null,
                });
            }
            return this.rooms.get(roomId);
        },

        /**
         * @param {string} roomId
         * @return {object}
         */
        localState(roomId) {
            const state = loadRoomState(roomId);
            const draft = this.rooms.get(roomId)?.draft;
            if (draft) {
                return { ...state, ...draft };
            }
            const notes = typeof state.notes === 'string' ? state.notes : '';
            const sync = state.cloudSync;
            const conflict = this.memory(sync?.conflict, roomId);
            if (sync && (sync.revision === null || (Number.isSafeInteger(sync.revision) && sync.revision >= 0))
                && (sync.revision > 0 ? this.validNotes(sync.baseNotes) : sync.baseNotes === null)
                && typeof sync.dirty === 'boolean' && typeof sync.editId === 'string'
                && Number.isSafeInteger(sync.editedAt) && sync.editedAt >= 0
                && (sync.dirty || notes === (sync.baseNotes ?? ''))
                && (sync.conflict === null || (sync.dirty && conflict))) {
                const { revision, baseNotes, dirty, editId, editedAt } = sync;
                return { ...state, notes, cloudSync: { revision, baseNotes, dirty, editId, editedAt, conflict } };
            }
            return {
                ...state, notes,
                cloudSync: { revision: null, baseNotes: null, dirty: notes !== '', editId: '', editedAt: 0, conflict: null },
            };
        },

        /**
         * @param {string} roomId
         * @param {object} state
         * @return {boolean}
         */
        persist(roomId, state) {
            const room = this.room(roomId);
            const saved = saveRoomState(state, roomId);
            room.draft = saved ? null : { notes: state.notes, cloudSync: state.cloudSync };
            return saved;
        },

        /**
         * @param {string} roomId
         * @param {boolean} [refresh]
         * @return {void}
         */
        activateRoom(roomId, refresh = true) {
            if (roomId === this.boundRoom) {
                return;
            }
            if (this.rooms.get(this.boundRoom)?.composing) {
                this.endComposition(this.boundRoom);
            }
            this.picker = null;
            this.boundRoom = roomId;
            this.showNotes(roomId, this.localState(roomId).notes);
            syncUI();
            if (refresh) {
                void this.synchronize(roomId, true);
            }
        },

        /**
         * @param {string} roomId
         * @param {string} notes
         * @return {void}
         */
        showNotes(roomId, notes) {
            const field = document.getElementById('zeta-dm-notes');
            if (field && roomId === this.boundRoom && roomId === window.location.pathname) {
                if (field.value !== notes) {
                    field.value = notes;
                }
                this.shownValue = field.value;
                this.shownNotes = notes;
            }
        },

        /**
         * @param {string} roomId
         * @param {string} notes
         * @param {?string} editorEditId
         * @return {void}
         */
        showReconciledNotes(roomId, notes, editorEditId) {
            if (roomId !== this.boundRoom || roomId !== window.location.pathname) {
                return;
            }
            const room = this.room(roomId);
            const field = document.getElementById('zeta-dm-notes');
            if (room.composing && this.shownNotes !== notes) {
                room.needsRead = true;
            } else if (!room.composing && room.editorEditId === editorEditId
                && this.shownNotes !== notes && field?.value === this.shownValue) {
                this.showNotes(roomId, notes);
            }
        },

        /**
         * @param {string} roomId
         * @param {string} notes
         * @return {void}
         */
        editNotes(roomId, notes) {
            const state = this.localState(roomId);
            if (notes === state.notes) {
                return;
            }
            const room = this.room(roomId);
            const sync = state.cloudSync;
            const dirty = !room.ready || room.needsRead || Boolean(room.running)
                || room.uncertain !== null || sync.conflict !== null || notes !== sync.baseNotes;
            const editId = crypto.randomUUID();
            room.editorEditId = editId;
            this.persist(roomId, {
                ...state, notes,
                cloudSync: { ...sync, dirty, editId, editedAt: Date.now() },
            });
            if (room.blocked === this.Status.Error) {
                room.blocked = null;
                room.retryAt = 0;
                room.retryCount = 0;
            }
            this.schedule(roomId);
        },

        /**
         * @param {string} roomId
         * @return {void}
         */
        endComposition(roomId) {
            const room = this.room(roomId);
            if (!room.composing) {
                return;
            }
            room.composing = false;
            const state = this.localState(roomId);
            if (state.cloudSync.dirty) {
                const cloudSync = { ...state.cloudSync, editedAt: Date.now() };
                if (room.draft) {
                    room.draft = { notes: state.notes, cloudSync };
                } else {
                    this.persist(roomId, { ...state, cloudSync });
                }
            }
            this.schedule(roomId);
        },

        /**
         * @param {string} roomId
         * @return {void}
         */
        schedule(roomId) {
            const room = this.room(roomId);
            clearTimeout(room.timer);
            this.render(roomId);
            if (!this.isChatRoom(roomId) || this.keyBlock || room.draft || room.running || room.composing || room.blocked) {
                return;
            }
            const { notes, cloudSync: sync } = this.localState(roomId);
            if (!room.needsRead && (!room.ready || !sync.dirty || sync.conflict || !this.validNotes(notes))) {
                return;
            }
            const quietAt = room.needsRead && !room.retryAt ? 0 : sync.editedAt + this.QuietMs;
            const delay = Math.max(quietAt, room.retryAt) - Date.now();
            if (delay > 2147483647) {
                room.blocked = this.Status.Stopped;
                this.render(roomId);
            } else if (delay > 0) {
                room.timer = setTimeout(() => this.schedule(roomId), delay);
            } else {
                void this.synchronize(roomId, false);
            }
        },

        /**
         * @param {string} method
         * @param {string} path
         * @param {object} query
         * @param {?object} body
         * @return {Promise<ApiResult>}
         */
        request(method, path, query, body) {
            const generation = this.generation;
            const key = GM_getValue(this.KeyName, '');
            const url = new URL(path, this.Origin);
            url.search = new URLSearchParams(query).toString();
            return new Promise((resolve) => {
                if (!this.validKey(key)) {
                    resolve({ status: 401, data: null, retryAfter: 0 });
                    return;
                }
                let finished = false;
                let handle;
                let timer;
                /**
                 * @param {number} status
                 * @param {unknown} [data]
                 * @param {number} [retryAfter]
                 * @return {void}
                 */
                const finish = (status, data = null, retryAfter = 0) => {
                    if (finished) {
                        return;
                    }
                    finished = true;
                    clearTimeout(timer);
                    this.aborters.delete(abort);
                    resolve({ status, data, retryAfter });
                };
                /**
                 * @param {number} status
                 * @return {void}
                 */
                const abort = (status) => {
                    finish(status);
                    try {
                        handle?.abort?.();
                    } catch {
                        return;
                    }
                };
                const headers = { Authorization: 'Bearer ' + key };
                const payload = body === null ? {} : { data: JSON.stringify(body) };
                if (body !== null) {
                    headers['Content-Type'] = 'application/json';
                }
                this.aborters.add(abort);
                timer = setTimeout(() => abort(this.Transport.Network), this.TimeoutMs);
                try {
                    handle = GM_xmlhttpRequest({
                        method, url: url.href, headers, ...payload, anonymous: true, redirect: 'error',
                        timeout: this.TimeoutMs,
                        onload: (response) => {
                            if (generation !== this.generation) {
                                finish(this.Transport.Cancelled);
                                return;
                            }
                            try {
                                if (new URL(response.finalUrl).href !== url.href
                                    || (response.status >= 300 && response.status < 400)) {
                                    finish(this.Transport.Rejected);
                                    return;
                                }
                                const retryHeader = /^retry-after:[ \t]*(\d+)[ \t]*\r?$/im.exec(response.responseHeaders);
                                const retryAfter = retryHeader ? Number(retryHeader[1]) * 1000 : 0;
                                let data = null;
                                try {
                                    data = JSON.parse(response.responseText);
                                } catch {
                                    finish(response.status, null, retryAfter);
                                    return;
                                }
                                finish(response.status, data, retryAfter);
                            } catch {
                                finish(this.Transport.Rejected);
                            }
                        },
                        onerror: () => finish(this.Transport.Network),
                        ontimeout: () => finish(this.Transport.Network),
                        onabort: () => finish(this.Transport.Network),
                    });
                } catch {
                    finish(this.Transport.Network);
                }
            });
        },

        /**
         * @param {string} roomId
         * @param {ApiResult} result
         * @return {void}
         */
        failure(roomId, result) {
            const room = this.room(roomId);
            const code = result.data?.error?.code;
            if (result.status === 401 || code === 'configuration_error') {
                this.keyBlock = result.status === 401 ? this.Status.Auth : this.Status.Config;
                this.render(this.boundRoom);
            } else if (result.status === this.Transport.Network || result.status === 429 || result.status >= 500) {
                const backoff = this.BackoffMs[room.retryCount];
                const delay = Math.max(backoff ?? 0, result.status === 429 ? result.retryAfter : 0);
                if (!Number.isSafeInteger(delay) || delay > 2147483647) {
                    room.blocked = this.Status.Stopped;
                    room.retryAt = 0;
                } else if (backoff === undefined) {
                    room.blocked = this.Status.Stopped;
                    room.retryAt = Date.now() + delay;
                } else {
                    room.retryCount += 1;
                    room.retryAt = Date.now() + delay;
                }
            } else {
                room.blocked = this.Status.Error;
            }
        },

        /**
         * @param {string} roomId
         * @param {boolean} refresh
         * @return {Promise<void>}
         */
        async synchronize(roomId, refresh) {
            if (!this.isChatRoom(roomId)) {
                return;
            }
            const room = this.room(roomId);
            if (refresh) {
                if (room.running !== this.Work.Read || !room.ready) {
                    room.needsRead = true;
                }
                this.schedule(roomId);
                return;
            }
            const generation = this.generation;
            const state = this.localState(roomId);
            const snapshot = Object.freeze({
                roomId, notes: state.notes, editId: state.cloudSync.editId, expectedRevision: state.cloudSync.revision,
                editorEditId: room.editorEditId,
            });
            try {
                if (room.needsRead || snapshot.expectedRevision === null) {
                    room.needsRead = false;
                    room.running = this.Work.Read;
                    this.render(roomId);
                    const result = await this.request('GET', '/v1/memory', { roomId }, null);
                    if (generation !== this.generation) {
                        return;
                    }
                    const memory = result.status === 200 ? this.memory(result.data, roomId) : null;
                    const missing = result.status === 404 && result.data?.error?.code === 'memory_not_found';
                    if (memory || missing) {
                        this.reconcile(roomId, memory, snapshot.editId, snapshot.editorEditId);
                    } else {
                        room.needsRead = true;
                        this.failure(roomId, result);
                    }
                } else {
                    if (state.cloudSync.revision > 0 && state.notes === state.cloudSync.baseNotes) {
                        if (this.persist(roomId, { ...state, cloudSync: { ...state.cloudSync, dirty: false } })) {
                            this.showReconciledNotes(roomId, state.notes, snapshot.editorEditId);
                        }
                        room.retryAt = 0;
                        room.retryCount = 0;
                        return;
                    }
                    room.running = this.Work.Save;
                    this.render(roomId);
                    const { notes, expectedRevision } = snapshot;
                    const result = await this.request('PUT', '/v1/memory', { roomId }, { notes, expectedRevision });
                    if (generation !== this.generation) {
                        return;
                    }
                    const memory = result.status === (expectedRevision === 0 ? 201 : 200)
                        ? this.memory(result.data, roomId) : null;
                    if (memory && memory.notes === notes && memory.revision === expectedRevision + 1) {
                        this.accept(roomId, memory, snapshot.editorEditId);
                        room.retryAt = 0;
                        room.retryCount = 0;
                    } else {
                        room.needsRead = true;
                        if (result.status === 409) {
                            room.rejectedSave = true;
                        } else {
                            room.uncertain = snapshot;
                            this.failure(roomId, result);
                        }
                    }
                }
            } finally {
                room.running = null;
                if (generation === this.generation || roomId === this.boundRoom) {
                    this.schedule(roomId);
                }
            }
        },

        /**
         * @param {string} roomId
         * @param {Memory} memory
         * @param {?string} editorEditId
         * @return {void}
         */
        accept(roomId, memory, editorEditId) {
            const room = this.room(roomId);
            const state = this.localState(roomId);
            const sync = state.cloudSync;
            if (sync.revision > memory.revision || sync.conflict?.revision > memory.revision) {
                room.needsRead = true;
                return;
            }
            const cloudSync = { ...sync, revision: memory.revision, baseNotes: memory.notes,
                dirty: state.notes !== memory.notes, conflict: null };
            if (room.draft) {
                room.draft = { notes: state.notes, cloudSync };
                return;
            }
            if (this.persist(roomId, { ...state, cloudSync }) && !cloudSync.dirty) {
                this.showReconciledNotes(roomId, state.notes, editorEditId);
            }
        },

        /**
         * @param {string} roomId
         * @param {?Memory} memory
         * @param {string} readEditId
         * @param {?string} editorEditId
         * @return {void}
         */
        reconcile(roomId, memory, readEditId, editorEditId) {
            const room = this.room(roomId);
            const state = this.localState(roomId);
            const sync = state.cloudSync;
            const revision = memory?.revision ?? 0;
            const baseNotes = memory?.notes ?? null;
            room.needsRead = false;
            if (room.draft) {
                room.needsRead = true;
                return;
            }
            if (memory && (sync.revision > revision || sync.conflict?.revision > revision)) {
                room.needsRead = true;
                room.blocked = this.Status.Error;
                return;
            }
            if (!sync.dirty && memory && state.notes !== memory.notes && (room.composing || sync.editId !== readEditId)) {
                room.needsRead = true;
                return;
            }
            const uncertain = room.uncertain;
            const acknowledged = memory && uncertain && memory.notes === uncertain.notes
                && memory.revision === uncertain.expectedRevision + 1;
            if (memory && sync.dirty && state.notes !== memory.notes && !acknowledged
                && (room.rejectedSave || sync.conflict || sync.revision !== revision || sync.baseNotes !== baseNotes)) {
                this.persist(roomId, { ...state, cloudSync: { ...sync, conflict: memory } });
            } else if (!memory && room.rejectedSave) {
                room.needsRead = true;
                room.blocked = this.Status.Error;
                return;
            } else {
                const notes = !sync.dirty && memory ? memory.notes : state.notes;
                const dirty = memory ? sync.dirty && notes !== baseNotes : sync.dirty || notes !== '';
                if (notes !== state.notes || sync.revision !== revision || sync.baseNotes !== baseNotes
                    || sync.dirty !== dirty || sync.conflict) {
                    this.persist(roomId, {
                        ...state, notes,
                        cloudSync: { ...sync, revision, baseNotes, dirty, conflict: null },
                    });
                }
                if (!dirty) {
                    this.showReconciledNotes(roomId, notes, editorEditId);
                }
            }
            room.ready = true;
            room.rejectedSave = false;
            room.uncertain = null;
            const updated = this.localState(roomId).cloudSync;
            if (!updated.dirty || updated.conflict || acknowledged) {
                room.retryAt = 0;
                room.retryCount = 0;
            }
        },

        /**
         * @param {?object} shown
         * @param {object} state
         * @param {string} roomId
         * @return {boolean}
         */
        matchesShownConflict(shown, state, roomId) {
            const { cloudSync: sync } = state;
            return Boolean(shown && shown.memory.roomId === roomId && shown.generation === this.generation
                && shown.editId === sync.editId && shown.notes === state.notes
                && shown.memory.revision === sync.conflict?.revision && shown.memory.notes === sync.conflict.notes
                && shown.memory.updatedAt === sync.conflict.updatedAt);
        },

        /**
         * @param {string} roomId
         * @param {string} choice
         * @return {Promise<void>}
         */
        async resolveConflict(roomId, choice) {
            const room = this.room(roomId);
            const state = this.localState(roomId);
            const shown = this.shownConflict;
            if (!room.ready || room.draft || room.running || room.composing || this.keyBlock
                || window.location.pathname !== roomId || this.boundRoom !== roomId
                || (choice !== this.Choice.UseCloud && choice !== this.Choice.KeepLocal)) {
                return;
            }
            if (!this.matchesShownConflict(shown, state, roomId)) {
                this.render(roomId);
                return;
            }
            const memory = shown.memory;
            const useCloud = choice === this.Choice.UseCloud;
            if (useCloud && state.notes !== memory.notes && !window.confirm('Replace your notes with the cloud notes?')) {
                return;
            }
            const current = this.localState(roomId);
            const currentSync = current.cloudSync;
            if (window.location.pathname !== roomId || this.boundRoom !== roomId
                || !this.matchesShownConflict(shown, current, roomId)
                || room.draft || room.running || room.composing || this.keyBlock) {
                this.render(roomId);
                return;
            }
            const notes = useCloud ? memory.notes : current.notes;
            this.persist(roomId, {
                ...current, notes,
                cloudSync: { ...currentSync, revision: memory.revision, baseNotes: memory.notes,
                    dirty: notes !== memory.notes, conflict: null },
            });
            if (useCloud) {
                this.showNotes(roomId, notes);
            }
            room.blocked = null;
            room.retryAt = 0;
            room.retryCount = 0;
            this.schedule(roomId);
        },

        /**
         * @param {HTMLElement} widget
         * @return {void}
         */
        attachControls(widget) {
            const panel = document.createElement('div');
            panel.className = 'zeta-dm-cloud';
            panel.innerHTML = `
                <div class="zeta-dm-cloud-row">
                    <span id="zeta-dm-sync-status" role="status" aria-live="polite"></span>
                    <button id="zeta-dm-open-import" type="button" aria-expanded="false" aria-controls="zeta-dm-import">Import</button>
                </div>
                <section id="zeta-dm-import" class="zeta-dm-cloud-section" aria-label="Import notes" hidden>
                    <label for="zeta-dm-import-source">Saved room</label>
                    <select id="zeta-dm-import-source"></select>
                    <div id="zeta-dm-import-status" role="status" aria-live="polite"></div>
                    <div class="zeta-dm-cloud-row">
                        <button id="zeta-dm-import-prev" type="button">Previous</button>
                        <button id="zeta-dm-import-next" type="button">Next</button>
                    </div>
                    <div class="zeta-dm-cloud-actions">
                        <button id="zeta-dm-import-cancel" type="button">Cancel</button>
                        <button id="zeta-dm-import-confirm" type="button">Import</button>
                    </div>
                </section>
                <section id="zeta-dm-conflict" class="zeta-dm-cloud-section" aria-label="Cloud notes conflict" hidden>
                    <div>Cloud notes</div>
                    <pre id="zeta-dm-conflict-notes" tabindex="0"></pre>
                    <div class="zeta-dm-cloud-actions">
                        <button id="zeta-dm-use-cloud" type="button">Use cloud notes</button>
                        <button id="zeta-dm-keep-local" type="button">Keep my notes</button>
                    </div>
                </section>
            `;
            document.getElementById('zeta-dm-body').appendChild(panel);
            const style = document.createElement('style');
            style.textContent = `
                #zeta-dm-widget .zeta-dm-cloud { margin-top: 8px; }
                #zeta-dm-widget .zeta-dm-cloud-row,
                #zeta-dm-widget .zeta-dm-cloud-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
                #zeta-dm-widget .zeta-dm-cloud-row { justify-content: space-between; }
                #zeta-dm-widget .zeta-dm-cloud-actions { justify-content: flex-end; }
                #zeta-dm-widget .zeta-dm-cloud-row span { flex: 1; }
                #zeta-dm-widget .zeta-dm-cloud-section { margin-top: 6px; }
                #zeta-dm-widget .zeta-dm-cloud-section > * { margin-block: 4px; }
                #zeta-dm-widget .zeta-dm-cloud select { width: 100%; }
                #zeta-dm-widget .zeta-dm-cloud pre { max-height: 8em; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
                #zeta-dm-widget .zeta-dm-cloud button:focus-visible,
                #zeta-dm-widget .zeta-dm-cloud select:focus-visible,
                #zeta-dm-widget .zeta-dm-cloud pre:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
            `;
            widget.appendChild(style);
            /**
             * @param {string} id
             * @return {HTMLElement}
             */
            const element = (id) => document.getElementById('zeta-dm-' + id);
            const controls = {
                status: element('sync-status'), open: element('open-import'), import: element('import'),
                source: element('import-source'), importStatus: element('import-status'), previous: element('import-prev'),
                next: element('import-next'), cancel: element('import-cancel'), confirm: element('import-confirm'),
                conflict: element('conflict'), conflictNotes: element('conflict-notes'),
                useCloud: element('use-cloud'), keepLocal: element('keep-local'),
            };
            this.controls = controls;
            controls.open.addEventListener('click', () => void this.openImport(this.boundRoom));
            controls.source.addEventListener('change', () => this.render(this.boundRoom));
            controls.previous.addEventListener('click', () => {
                const picker = this.picker;
                if (picker && picker.index > 0) {
                    void this.loadImportPage(picker.roomId, picker.cursors[picker.index - 1]);
                }
            });
            controls.next.addEventListener('click', () => {
                const picker = this.picker;
                if (picker?.nextCursor) {
                    void this.loadImportPage(picker.roomId, picker.nextCursor);
                }
            });
            controls.cancel.addEventListener('click', () => {
                this.picker = null;
                this.render(this.boundRoom);
                controls.open.focus();
            });
            controls.confirm.addEventListener('click', () => void this.importNotes(this.boundRoom, controls.source.value));
            controls.useCloud.addEventListener('click', () => void this.resolveConflict(this.boundRoom, this.Choice.UseCloud));
            controls.keepLocal.addEventListener('click', () => void this.resolveConflict(this.boundRoom, this.Choice.KeepLocal));
        },

        /**
         * @param {string} roomId
         * @return {void}
         */
        render(roomId) {
            const controls = this.controls;
            if (!controls || roomId !== this.boundRoom || roomId !== window.location.pathname) {
                return;
            }
            const chat = this.isChatRoom(roomId);
            const room = this.rooms.get(roomId);
            const { notes, cloudSync: sync } = this.localState(roomId);
            const settled = room?.ready && !room.composing && !sync.dirty && notes === this.shownNotes
                && document.getElementById('zeta-dm-notes')?.value === this.shownValue;
            const picker = this.picker;
            let status = '';
            if (room?.draft) {
                status = this.Status.LocalError;
            } else if (chat) {
                status = this.keyBlock
                    ?? (room?.running === this.Work.Read ? this.Status.Loading : null)
                    ?? (room?.running === this.Work.Save ? this.Status.Saving : null)
                    ?? (sync.conflict ? this.Status.Conflict : null)
                    ?? (!this.validNotes(notes) ? this.Status.InvalidNote : null)
                    ?? room?.blocked
                    ?? (room?.retryAt > Date.now() ? this.Status.Retrying : null)
                    ?? (settled && sync.revision === 0 ? this.Status.Empty : null)
                    ?? (settled && sync.revision > 0 ? this.Status.Saved : this.Status.Unsynced);
            }
            if (controls.status.textContent !== status) {
                controls.status.textContent = status;
            }
            controls.open.disabled = !chat || Boolean(this.keyBlock) || Boolean(picker);
            controls.open.setAttribute('aria-expanded', String(Boolean(picker)));
            controls.import.hidden = !picker;
            if (picker) {
                controls.importStatus.textContent = picker.message;
                controls.source.disabled = picker.busy || !picker.items.length;
                controls.previous.disabled = picker.busy || picker.index <= 0;
                controls.next.disabled = picker.busy || !picker.nextCursor;
                controls.confirm.disabled = picker.busy || !room?.ready || room.draft || room.composing || sync.conflict
                    || Boolean(this.keyBlock) || !controls.source.value || controls.source.value === roomId;
            } else if (controls.source.options.length) {
                controls.source.replaceChildren();
            }
            controls.conflict.hidden = !sync.conflict;
            const cloudNotes = sync.conflict?.notes ?? '';
            if (controls.conflictNotes.textContent !== cloudNotes) {
                controls.conflictNotes.textContent = cloudNotes;
            }
            this.shownConflict = sync.conflict
                ? { memory: sync.conflict, notes, editId: sync.editId, generation: this.generation } : null;
            controls.useCloud.disabled = controls.keepLocal.disabled = !room?.ready || Boolean(room.running)
                || Boolean(room.draft) || room.composing || Boolean(this.keyBlock);
        },

        /**
         * @param {string} roomId
         * @return {Promise<void>}
         */
        async openImport(roomId) {
            if (!this.isChatRoom(roomId) || this.keyBlock || this.picker || roomId !== window.location.pathname) {
                return;
            }
            this.picker = { roomId, cursors: [null], index: 0, items: [], nextCursor: null, busy: false, message: '' };
            await this.loadImportPage(roomId, null);
        },

        /**
         * @param {string} roomId
         * @param {?string} after
         * @return {Promise<void>}
         */
        async loadImportPage(roomId, after) {
            const picker = this.picker;
            const generation = this.generation;
            if (!picker || picker.roomId !== roomId || roomId !== window.location.pathname || picker.busy || this.keyBlock) {
                return;
            }
            picker.busy = true;
            picker.message = 'Loading saved rooms…';
            this.render(roomId);
            const query = after === null ? { limit: this.PageSize } : { limit: this.PageSize, after };
            const result = await this.request('GET', '/v1/memories', query, null);
            if (this.picker !== picker || roomId !== window.location.pathname || generation !== this.generation) {
                return;
            }
            picker.busy = false;
            const page = result.status === 200 ? this.page(result.data) : null;
            const visitedIndex = picker.cursors.indexOf(after);
            const index = visitedIndex < 0 ? picker.index + 1 : visitedIndex;
            if (!page || (page.nextCursor !== null && (page.nextCursor === after
                || picker.cursors.slice(0, index).includes(page.nextCursor)))) {
                if (result.status === 401 || result.data?.error?.code === 'configuration_error') {
                    this.failure(roomId, result);
                }
                picker.message = 'Could not load saved rooms.';
            } else {
                if (visitedIndex < 0) {
                    picker.cursors.splice(index, picker.cursors.length, after);
                }
                picker.index = index;
                picker.items = page.items;
                picker.nextCursor = page.nextCursor;
                picker.message = page.items.length ? '' : 'No saved rooms on this page.';
                const options = page.items.map((item) => {
                    const option = document.createElement('option');
                    option.value = item.roomId;
                    option.textContent = item.roomId + ' · ' + item.updatedAt;
                    option.disabled = item.roomId === roomId;
                    return option;
                });
                this.controls.source.replaceChildren(...options);
                this.controls.source.value = page.items.find((item) => item.roomId !== roomId)?.roomId ?? '';
            }
            this.render(roomId);
        },

        /**
         * @param {unknown} data
         * @return {?Page}
         */
        page(data) {
            if (!data || !Array.isArray(data.items) || data.items.length > this.PageSize
                || (data.nextCursor !== null && !this.validRoomId(data.nextCursor))) {
                return null;
            }
            const items = data.items.map((item) => this.metadata(item));
            if (items.includes(null) || new Set(items.map((item) => item.roomId)).size !== items.length) {
                return null;
            }
            return Object.freeze({ items: Object.freeze(items), nextCursor: data.nextCursor });
        },

        /**
         * @param {string} destinationRoomId
         * @param {string} sourceRoomId
         * @return {Promise<void>}
         */
        async importNotes(destinationRoomId, sourceRoomId) {
            const picker = this.picker;
            const generation = this.generation;
            const room = this.room(destinationRoomId);
            const state = this.localState(destinationRoomId);
            /**
             * @return {boolean}
             */
            const isCurrent = () => this.picker === picker && destinationRoomId === window.location.pathname
                && destinationRoomId === this.boundRoom && generation === this.generation;
            /**
             * @return {boolean}
             */
            const canApply = () => {
                const current = this.localState(destinationRoomId);
                return isCurrent() && !this.keyBlock && room.ready && !room.draft && !room.composing
                    && !current.cloudSync.conflict && current.cloudSync.revision === state.cloudSync.revision
                    && current.cloudSync.editId === state.cloudSync.editId && current.notes === state.notes;
            };
            if (!picker || picker.busy || picker.roomId !== destinationRoomId || !canApply()
                || sourceRoomId === destinationRoomId || !picker.items.some((item) => item.roomId === sourceRoomId)) {
                return;
            }
            picker.busy = true;
            picker.message = 'Loading source notes…';
            this.render(destinationRoomId);
            const result = await this.request('GET', '/v1/memory', { roomId: sourceRoomId }, null);
            if (!isCurrent()) {
                return;
            }
            picker.busy = false;
            if (!canApply()) {
                picker.message = 'Destination changed. Choose Import to try again.';
            } else {
                const memory = result.status === 200 ? this.memory(result.data, sourceRoomId) : null;
                if (!memory) {
                    if (result.status === 401 || result.data?.error?.code === 'configuration_error') {
                        this.failure(destinationRoomId, result);
                    }
                    picker.message = 'Could not load the source notes.';
                } else if (memory.notes === state.notes || !state.notes || window.confirm('Replace your notes with the source notes?')) {
                    if (canApply()) {
                        this.picker = null;
                        this.editNotes(destinationRoomId, memory.notes);
                        this.showNotes(destinationRoomId, memory.notes);
                    } else if (isCurrent()) {
                        picker.message = 'Destination changed. Choose Import to try again.';
                    }
                } else {
                    picker.message = 'Import canceled.';
                }
            }
            this.render(destinationRoomId);
        },
    };

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
                <strong style="font-size:13px;color:#a78bfa;">🎲 DM Memory v1.3</strong>
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
        cloudSync.attachControls(widget);

        notesEl.addEventListener('input', () => {
            const roomId = cloudSync.boundRoom;
            if (roomId !== window.location.pathname) {
                cloudSync.activateRoom(window.location.pathname);
                return;
            }
            if (notesEl.value !== cloudSync.shownValue) {
                cloudSync.shownValue = notesEl.value;
                cloudSync.shownNotes = notesEl.value;
                cloudSync.editNotes(roomId, notesEl.value);
            }
        });

        notesEl.addEventListener('compositionstart', () => {
            const roomId = cloudSync.boundRoom;
            if (roomId !== window.location.pathname) {
                cloudSync.activateRoom(window.location.pathname);
                return;
            }
            cloudSync.room(roomId).composing = true;
            cloudSync.schedule(roomId);
        });

        notesEl.addEventListener('compositionend', () => {
            const roomId = cloudSync.boundRoom;
            if (roomId !== window.location.pathname) {
                cloudSync.activateRoom(window.location.pathname);
                return;
            }
            cloudSync.endComposition(roomId);
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

        const state = cloudSync.localState(window.location.pathname);
        const notesEl = document.getElementById('zeta-dm-notes');
        const counterEl = document.getElementById('zeta-dm-counter');
        const intervalEl = document.getElementById('zeta-dm-interval');
        const forceEl = document.getElementById('zeta-dm-force');
        const bodyEl = document.getElementById('zeta-dm-body');
        const toggleBtn = document.getElementById('zeta-dm-toggle');

        if (document.activeElement !== notesEl) {
            cloudSync.showNotes(window.location.pathname, state.notes);
        }
        intervalEl.value = state.interval || 6;
        forceEl.checked = Boolean(state.forceNext);

        const willFireNext = state.forceNext || (state.turnCount + 1 >= state.interval);
        counterEl.textContent = `${state.turnCount} / ${state.interval}`;
        counterEl.style.color = willFireNext ? '#facc15' : '#4ade80';

        bodyEl.style.display = state.minimized ? 'none' : 'block';
        toggleBtn.textContent = state.minimized ? '▢' : '—';
        cloudSync.render(window.location.pathname);
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

    cloudSync.start();

    setInterval(() => {
        buildWidget();
        if (window.location.pathname !== lastPath) {
            lastPath = window.location.pathname;
            cloudSync.activateRoom(lastPath);
        }
    }, 800);
})();
