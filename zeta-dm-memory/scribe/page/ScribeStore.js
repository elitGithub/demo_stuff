const ScribeStore = Object.freeze({
    KeyStorageSource: 'Scribe key storage',

    /**
     * @param {*} source
     * @return {boolean}
     */
    localSource(source) {
        return source === 'Scribe' || source === ScribeStore.KeyStorageSource;
    },

    /**
     * @param {*} error
     * @return {string|undefined}
     */
    errorSource(error) {
        return error?.source === 'Scribe' && error.code === ScribeStore.KeyStorageSource ? error.code : error?.source;
    },

    Kind: Object.freeze({
        Campaign: 'campaign',
        Book: 'book',
        Live: 'live',
        Settings: 'settings',
        Setup: 'setup',
    }),

    Settings: Object.freeze({
        Prefix: 'scribe',
        Separator: ':',
        Key: 'key',
        CloudKey: 'cloudkey',
        Browser: 'browser',
        Types: Object.freeze({
            Head: 'head',
            Part: 'part',
            Claim: 'claim',
            Spent: 'spent',
            Synced: 'synced',
            Others: 'others',
            CheckAfter: 'checkafter',
            HistoryPages: 'historypages',
        }),
        Segments: Object.freeze({
            Head: Object.freeze([4]),
            Part: Object.freeze([6, 7, 8]),
            Claim: Object.freeze([3]),
            Spent: Object.freeze([3]),
            Synced: Object.freeze([3]),
            Others: Object.freeze([3]),
            CheckAfter: Object.freeze([3]),
            HistoryPages: Object.freeze([3]),
        }),
        Position: Object.freeze({
            Prefix: 0,
            Type: 1,
            Room: 2,
            Kind: 3,
            Generation: 4,
            Digest: 5,
            Length: 6,
        }),
        Forms: Object.freeze({
            First: 0,
            Digest: 1,
            Sized: 2,
        }),
        PartCharacters: 500000,
        LeastPiece: 2,
        ClaimStaleMs: 90000,
        FirstGeneration: 1,
        NoGeneration: 0,
        FirstPart: 0,
        LeastParts: 1,
        NoCharacters: 0,
        NoSpending: 0,
        FirstAttempt: 1,
        Attempts: 2,
        FirstHighSurrogate: 0xd800,
        LastHighSurrogate: 0xdbff,
        DigestOffset: 0x811c9dc5,
        DigestPrime: 16777619,
        DigestLength: 8,
        DigestPad: '0',
        Hexadecimal: 16,
        Unsigned: 0,
        Nothing: '',
        ObjectType: 'object',
        StringType: 'string',

        /**
         * @return {RegExp}
         */
        get Count() {
            return /^(?:0|[1-9]\d*)$/;
        },

        /**
         * @return {RegExp}
         */
        get DigestPattern() {
            return /^[0-9a-f]{8}$/;
        },

        /**
         * @return {RegExp}
         */
        get BrowserPattern() {
            return /^[0-9A-Za-z-]{16,64}$/;
        },
        Messages: Object.freeze({
            SaveFailed: 'The save failed',
            Unreadable: 'The storage could not be read',
            DamagedPrefix: 'The saved ',
            DamagedSuffix: ' of this chat is damaged',
            KeyFailed: 'The key could not be saved',
            BadArgument: 'The argument is not valid',
            NoGeneration: 'The next generation is out of range',
            PartNotKept: 'A part did not read back as written',
            HeadNotKept: 'The head did not read back as written',
            Overtaken: 'Another save came first',
            AuthorityLost: 'The reader no longer owns this room',
        }),
    }),

    /**
     * @param {boolean} valid
     * @param {string} argument
     * @return {void}
     * @throws {Error}
     */
    check(valid, argument) {
        if (!valid) {
            throw new Error(`${ScribeStore.Settings.Messages.BadArgument}: ${argument}`);
        }
    },

    /**
     * @param {*} roomId
     * @return {string}
     * @throws {Error}
     */
    room(roomId) {
        ScribeStore.check(typeof roomId === ScribeStore.Settings.StringType && roomId.isWellFormed(), 'roomId');
        return encodeURIComponent(roomId);
    },

    /**
     * @param {*} kind
     * @return {void}
     * @throws {Error}
     */
    checkKind(kind) {
        ScribeStore.check(Object.values(ScribeStore.Kind).includes(kind), 'kind');
    },

    /**
     * @param {...(string|number)} segments
     * @return {string}
     */
    name(...segments) {
        const settings = ScribeStore.Settings;
        return [settings.Prefix, ...segments].join(settings.Separator);
    },

    /**
     * @param {string} room
     * @param {string} kind
     * @param {{ generation: number, characters: number, digest: string|null, form: number }} head
     * @param {number} part
     * @return {string}
     */
    partName(room, kind, head, part) {
        const settings = ScribeStore.Settings;
        const type = settings.Types.Part;
        if (head.form === settings.Forms.Sized) {
            return ScribeStore.name(type, room, kind, head.generation, head.digest, head.characters, part);
        }
        if (head.form === settings.Forms.Digest) {
            return ScribeStore.name(type, room, kind, head.generation, head.digest, part);
        }
        return ScribeStore.name(type, room, kind, head.generation, part);
    },

    /**
     * @param {string} text
     * @return {string}
     */
    digest(text) {
        const settings = ScribeStore.Settings;
        const prime = settings.DigestPrime;
        const length = text.length;
        const multiply = Math.imul;
        let hash = settings.DigestOffset;
        for (let index = settings.NoCharacters; index < length; index++) {
            hash = multiply(hash ^ text.charCodeAt(index), prime);
        }
        return (hash >>> settings.Unsigned).toString(settings.Hexadecimal).padStart(settings.DigestLength, settings.DigestPad);
    },

    /**
     * @param {*} name
     * @return {{ name: string, type: string, room: string, roomId: string, kind: string|null, generation: number|null, digest: string|null, part: number|null }|null}
     */
    describe(name) {
        const settings = ScribeStore.Settings;
        const position = settings.Position;
        if (typeof name !== settings.StringType) {
            return null;
        }
        const segments = name.split(settings.Separator);
        if (segments[position.Prefix] !== settings.Prefix) {
            return null;
        }
        let typeName = null;
        for (const [candidate, value] of Object.entries(settings.Types)) {
            if (segments[position.Type] === value) {
                typeName = candidate;
            }
        }
        if (typeName === null || !settings.Segments[typeName].includes(segments.length)) {
            return null;
        }
        const room = segments[position.Room];
        let roomId = null;
        try {
            roomId = decodeURIComponent(room);
        } catch {
            return null;
        }
        if (encodeURIComponent(roomId) !== room) {
            return null;
        }
        const described = {
            name,
            type: settings.Types[typeName],
            room,
            roomId,
            kind: null,
            generation: null,
            digest: null,
            part: null,
        };
        if (segments.length > position.Kind) {
            described.kind = segments[position.Kind];
            if (!Object.values(ScribeStore.Kind).includes(described.kind)) {
                return null;
            }
        }
        if (described.type === settings.Types.Part) {
            const last = segments.length - 1;
            const counts = [segments[position.Generation], segments[last]];
            if (last > position.Length) {
                counts.push(segments[position.Length]);
            }
            for (const count of counts) {
                if (!settings.Count.test(count) || !Number.isSafeInteger(Number(count))) {
                    return null;
                }
            }
            if (last > position.Digest) {
                described.digest = segments[position.Digest];
                if (!settings.DigestPattern.test(described.digest)) {
                    return null;
                }
            }
            described.generation = Number(segments[position.Generation]);
            described.part = Number(segments[last]);
            if (described.generation < settings.FirstGeneration) {
                return null;
            }
        }
        return described;
    },

    /**
     * @param {{ list: Function }} storage
     * @return {Array<{ name: string, type: string, room: string, roomId: string, kind: string|null, generation: number|null, digest: string|null, part: number|null }>}
     * @throws {Error}
     */
    stored(storage) {
        let names = null;
        try {
            names = storage.list();
        } catch (cause) {
            throw new Error(ScribeStore.Settings.Messages.Unreadable, { cause });
        }
        const found = [];
        for (const name of names) {
            const described = ScribeStore.describe(name);
            if (described !== null) {
                found.push(described);
            }
        }
        return found;
    },

    /**
     * @param {{ get: Function }} storage
     * @param {string} name
     * @return {*}
     * @throws {Error}
     */
    fetch(storage, name) {
        try {
            return storage.get(name, null);
        } catch (cause) {
            throw new Error(ScribeStore.Settings.Messages.Unreadable, { cause });
        }
    },

    /**
     * @param {*} text
     * @return {Object|null}
     */
    decode(text) {
        const settings = ScribeStore.Settings;
        if (typeof text !== settings.StringType) {
            return null;
        }
        let value = null;
        try {
            value = JSON.parse(text);
        } catch {
            return null;
        }
        if (typeof value !== settings.ObjectType || value === null || Array.isArray(value)) {
            return null;
        }
        return value;
    },

    /**
     * @param {*} text
     * @return {{ generation: number, parts: number, characters: number, digest: string|null, form: number }|null}
     */
    headOf(text) {
        const settings = ScribeStore.Settings;
        const forms = settings.Forms;
        const head = ScribeStore.decode(text);
        if (
            head === null
            || !Number.isSafeInteger(head.generation)
            || !Number.isSafeInteger(head.parts)
            || !Number.isSafeInteger(head.characters)
            || head.generation < settings.FirstGeneration
            || head.parts < settings.LeastParts
            || head.characters < settings.NoCharacters
        ) {
            return null;
        }
        const digested = head.digest !== undefined;
        if (digested && (typeof head.digest !== settings.StringType || !settings.DigestPattern.test(head.digest))) {
            return null;
        }
        let form = digested ? forms.Digest : forms.First;
        if (head.form !== undefined) {
            if (head.form !== forms.Sized || !digested) {
                return null;
            }
            form = forms.Sized;
        }
        return {
            generation: head.generation,
            parts: head.parts,
            characters: head.characters,
            digest: digested ? head.digest : null,
            form,
        };
    },

    /**
     * @param {*} text
     * @return {{ tabId: string, at: number }|null}
     */
    claimOf(text) {
        const claim = ScribeStore.decode(text);
        if (claim === null || typeof claim.tabId !== ScribeStore.Settings.StringType || !Number.isFinite(claim.at)) {
            return null;
        }
        return { tabId: claim.tabId, at: claim.at };
    },

    /**
     * @param {string} kind
     * @return {Error}
     */
    damaged(kind) {
        const messages = ScribeStore.Settings.Messages;
        const error = new Error(`${messages.DamagedPrefix}${kind}${messages.DamagedSuffix}`);
        error.damaged = true;
        return error;
    },

    /**
     * @param {{ get: Function, list: Function }} storage
     * @param {string} room
     * @param {string} kind
     * @return {{ value: Object, head: { generation: number, parts: number, characters: number, digest: string|null, form: number }, text: string }|null}
     * @throws {Error}
     */
    load(storage, room, kind) {
        const settings = ScribeStore.Settings;
        const types = settings.Types;
        const headName = ScribeStore.name(types.Head, room, kind);
        let text = ScribeStore.fetch(storage, headName);
        for (let attempt = settings.FirstAttempt; ; attempt++) {
            try {
                if (text === null) {
                    for (const described of ScribeStore.stored(storage)) {
                        if (described.type === types.Part && described.room === room && described.kind === kind) {
                            throw ScribeStore.damaged(kind);
                        }
                    }
                    return null;
                }
                const head = ScribeStore.headOf(text);
                if (head === null) {
                    throw ScribeStore.damaged(kind);
                }
                const pieces = [];
                for (let part = settings.FirstPart; part < head.parts; part++) {
                    const piece = ScribeStore.fetch(storage, ScribeStore.partName(room, kind, head, part));
                    if (typeof piece !== settings.StringType) {
                        throw ScribeStore.damaged(kind);
                    }
                    pieces.push(piece);
                }
                const joined = pieces.join(settings.Nothing);
                if (joined.length !== head.characters || (head.digest !== null && ScribeStore.digest(joined) !== head.digest)) {
                    throw ScribeStore.damaged(kind);
                }
                const value = ScribeStore.decode(joined);
                if (value === null) {
                    throw ScribeStore.damaged(kind);
                }
                const redacted = ScribeStore.redactRoomDiagnostics(storage, kind, value);
                return { value, head, text: redacted ? JSON.stringify(value) : joined };
            } catch (error) {
                if (error?.damaged !== true || attempt >= settings.Attempts) {
                    throw error;
                }
                const again = ScribeStore.fetch(storage, headName);
                if (again === text) {
                    throw error;
                }
                text = again;
            }
        }
    },

    /**
     * @param {{ get: Function, set: Function, remove: Function, list: Function }} storage
     * @param {string} roomId
     * @param {string} kind
     * @return {Object|null}
     * @throws {Error}
     */
    read(storage, roomId, kind) {
        const room = ScribeStore.room(roomId);
        ScribeStore.checkKind(kind);
        const loaded = ScribeStore.load(storage, room, kind);
        return loaded === null ? null : loaded.value;
    },

    /**
     * @param {{ get: Function, list: Function }} storage
     * @param {string} roomId
     * @param {string} kind
     * @return {{ text: string, generation: number }|null}
     * @throws {Error}
     */
    snapshot(storage, roomId, kind) {
        const room = ScribeStore.room(roomId);
        ScribeStore.checkKind(kind);
        const loaded = ScribeStore.load(storage, room, kind);
        return loaded === null ? null : { text: loaded.text, generation: loaded.head.generation };
    },

    /**
     * @param {{ get: Function }} storage
     * @param {string} roomId
     * @param {string} kind
     * @return {number|null}
     * @throws {Error}
     */
    generation(storage, roomId, kind) {
        const settings = ScribeStore.Settings;
        const room = ScribeStore.room(roomId);
        ScribeStore.checkKind(kind);
        const text = ScribeStore.fetch(storage, ScribeStore.name(settings.Types.Head, room, kind));
        if (text === null) {
            return settings.NoGeneration;
        }
        const head = ScribeStore.headOf(text);
        return head === null ? null : head.generation;
    },

    /**
     * @param {{ get: Function, set: Function, remove: Function, list: Function }} storage
     * @param {string} roomId
     * @param {string} kind
     * @param {Object} value
     * @param {Function|null} mayPublish
     * @return {number}
     * @throws {Error}
     */
    write(storage, roomId, kind, value, mayPublish = null) {
        let text = null;
        try {
            text = JSON.stringify(value);
        } catch {
            text = null;
        }
        return ScribeStore.writeText(storage, roomId, kind, text, mayPublish);
    },

    /**
     * @param {object} storage
     * @param {string} roomId
     * @param {object|null} campaign
     * @param {object} book
     * @param {Function} mayPublish
     * @return {void}
     * @throws {Error}
     */
    installFork(storage, roomId, campaign, book, mayPublish) {
        const room = ScribeStore.room(roomId);
        const writes = campaign ? [[ScribeStore.Kind.Campaign, campaign], [ScribeStore.Kind.Book, book]] : [[ScribeStore.Kind.Book, book]];
        const previous = new Map(writes.map(([kind]) => {
            const name = ScribeStore.name(ScribeStore.Settings.Types.Head, room, kind);
            return [name, ScribeStore.fetch(storage, name)];
        }));
        const heads = new Map();
        const added = new Map();
        const retired = new Set();
        const staged = {
            get: (name, fallback) => heads.has(name) ? heads.get(name) : storage.get(name, fallback),
            set: (name, value) => {
                if (previous.has(name)) {
                    heads.set(name, value);
                    return;
                }
                const existing = ScribeStore.fetch(storage, name);
                if (existing === null) {
                    added.set(name, value);
                    storage.set(name, value);
                } else if (existing !== value) {
                    throw new Error(ScribeStore.Settings.Messages.Overtaken);
                }
            },
            list: () => storage.list(),
            remove: (name) => retired.add(name),
        };
        const published = new Map();
        let completed = false;
        try {
            for (const [kind, value] of writes) {
                ScribeStore.write(staged, roomId, kind, value, mayPublish);
            }
            if ([...previous].some(([name, value]) => ScribeStore.fetch(storage, name) !== value)) {
                throw new Error(ScribeStore.Settings.Messages.Overtaken);
            }
            for (const [name, value] of heads) {
                if (mayPublish(published) !== true) {
                    throw new Error(ScribeStore.Settings.Messages.AuthorityLost);
                }
                if (ScribeStore.fetch(storage, name) !== previous.get(name)) {
                    throw new Error(ScribeStore.Settings.Messages.Overtaken);
                }
                published.set(name, value);
                try {
                    storage.set(name, value);
                } catch (error) {
                    if (ScribeStore.fetch(storage, name) !== value) {
                        throw error;
                    }
                }
                if (ScribeStore.fetch(storage, name) !== value) {
                    throw new Error(ScribeStore.Settings.Messages.HeadNotKept);
                }
            }
            if (mayPublish(published) !== true) {
                throw new Error(ScribeStore.Settings.Messages.AuthorityLost);
            }
            completed = true;
        } finally {
            if (!completed) {
                try {
                    for (const name of [...published.keys()].reverse()) {
                        if (ScribeStore.fetch(storage, name) === heads.get(name)) {
                            const old = previous.get(name);
                            if (old === null) {
                                storage.remove(name);
                            } else {
                                storage.set(name, old);
                            }
                        }
                    }
                } finally {
                    for (const [name, value] of added) {
                        const {kind, part} = ScribeStore.describe(name);
                        const headName = ScribeStore.name(ScribeStore.Settings.Types.Head, room, kind);
                        const current = ScribeStore.headOf(ScribeStore.fetch(storage, headName));
                        const inUse = current && part < current.parts && name === ScribeStore.partName(room, kind, current, part);
                        if (!inUse && ScribeStore.fetch(storage, name) === value) {
                            storage.remove(name);
                        }
                    }
                }
            }
        }
        for (const name of retired) {
            try {
                storage.remove(name);
            } catch {}
        }
    },

    /**
     * @param {string} text
     * @param {number} size
     * @return {string[]}
     * @throws {Error}
     */
    pieces(text, size) {
        const settings = ScribeStore.Settings;
        ScribeStore.check(typeof text === settings.StringType, 'text');
        ScribeStore.check(Number.isSafeInteger(size) && size >= settings.LeastPiece, 'size');
        const pieces = [];
        for (let start = settings.NoCharacters; start < text.length; ) {
            let end = Math.min(start + size, text.length);
            const last = text.charCodeAt(end - 1);
            if (end < text.length && last >= settings.FirstHighSurrogate && last <= settings.LastHighSurrogate) {
                end--;
            }
            pieces.push(text.slice(start, end));
            start = end;
        }
        return pieces;
    },

    /**
     * @param {{ get: Function, set: Function, remove: Function, list: Function }} storage
     * @param {string} roomId
     * @param {string} kind
     * @param {*} text
     * @param {Function|null} mayPublish
     * @return {number}
     * @throws {Error}
     */
    writeText(storage, roomId, kind, text, mayPublish = null) {
        const settings = ScribeStore.Settings;
        const messages = settings.Messages;
        const types = settings.Types;
        const room = ScribeStore.room(roomId);
        ScribeStore.checkKind(kind);
        const value = ScribeStore.decode(text);
        ScribeStore.check(value !== null, 'value');
        if (ScribeStore.redactRoomDiagnostics(storage, kind, value)) {
            text = JSON.stringify(value);
        }
        const pieces = ScribeStore.pieces(text, settings.PartCharacters);
        const headName = ScribeStore.name(types.Head, room, kind);
        const written = new Map();
        const superseded = [];
        let headText = null;
        let leave = false;
        try {
            const previousText = ScribeStore.fetch(storage, headName);
            const previous = ScribeStore.headOf(previousText);
            let highest = settings.NoGeneration;
            for (const described of ScribeStore.stored(storage)) {
                if (described.type !== types.Part || described.room !== room || described.kind !== kind) {
                    continue;
                }
                highest = Math.max(highest, described.generation);
                if (
                    previous !== null
                    && described.part < previous.parts
                    && described.name === ScribeStore.partName(room, kind, previous, described.part)
                ) {
                    superseded.push(described.name);
                }
            }
            const generation = (previous === null ? highest : previous.generation) + 1;
            if (!Number.isSafeInteger(generation)) {
                throw new Error(messages.NoGeneration);
            }
            const head = {
                generation,
                parts: pieces.length,
                characters: text.length,
                digest: ScribeStore.digest(text),
                form: settings.Forms.Sized,
            };
            headText = JSON.stringify(head);
            for (let part = settings.FirstPart; part < pieces.length; part++) {
                const partName = ScribeStore.partName(room, kind, head, part);
                written.set(partName, pieces[part]);
                storage.set(partName, pieces[part]);
            }
            for (const [partName, piece] of written) {
                if (ScribeStore.fetch(storage, partName) !== piece) {
                    throw new Error(messages.PartNotKept);
                }
            }
            if (mayPublish !== null && mayPublish() !== true) {
                throw new Error(messages.AuthorityLost);
            }
            const standingText = ScribeStore.fetch(storage, headName);
            const standing = ScribeStore.headOf(standingText);
            if ((standing !== null && standing.generation >= generation) || (mayPublish !== null && standingText !== previousText)) {
                leave = mayPublish === null;
                throw new Error(messages.Overtaken);
            }
            if (mayPublish !== null && mayPublish() !== true) {
                throw new Error(messages.AuthorityLost);
            }
            leave = true;
            let refused = null;
            try {
                storage.set(headName, headText);
            } catch (cause) {
                refused = cause;
            }
            if (ScribeStore.fetch(storage, headName) !== headText) {
                throw refused === null ? new Error(messages.HeadNotKept) : refused;
            }
        } catch (cause) {
            if (!leave) {
                let committed = true;
                try {
                    committed = ScribeStore.fetch(storage, headName) === headText;
                } catch {
                    committed = true;
                }
                if (!committed) {
                    for (const [partName, piece] of written) {
                        try {
                            if (storage.get(partName, null) === piece) {
                                storage.remove(partName);
                            }
                        } catch {
                            continue;
                        }
                    }
                }
            }
            throw new Error(messages.SaveFailed, { cause });
        }
        for (const partName of superseded) {
            try {
                storage.remove(partName);
            } catch {
                continue;
            }
        }
        return text.length;
    },

    /**
     * @param {{ get: Function, set: Function, remove: Function, list: Function }} storage
     * @param {string} roomId
     * @return {void}
     * @throws {Error}
     */
    drop(storage, roomId) {
        const room = ScribeStore.room(roomId);
        const heads = [];
        const others = [];
        for (const described of ScribeStore.stored(storage)) {
            if (described.room !== room) {
                continue;
            }
            if (described.type === ScribeStore.Settings.Types.Head) {
                heads.push(described.name);
            } else {
                others.push(described.name);
            }
        }
        for (const name of [...heads, ...others]) {
            storage.remove(name);
        }
    },

    /**
     * @param {{ get: Function, set: Function, remove: Function, list: Function }} storage
     * @return {Array<{ roomId: string, kinds: string[], characters: number, damaged: string[] }>}
     * @throws {Error}
     */
    rooms(storage) {
        const settings = ScribeStore.Settings;
        const found = new Map();
        for (const described of ScribeStore.stored(storage)) {
            if (described.kind === null) {
                continue;
            }
            if (!found.has(described.room)) {
                found.set(described.room, { roomId: described.roomId, kinds: new Set() });
            }
            found.get(described.room).kinds.add(described.kind);
        }
        const listed = [];
        for (const [room, entry] of found) {
            const kinds = [];
            const damaged = [];
            let characters = settings.NoCharacters;
            for (const kind of Object.values(ScribeStore.Kind)) {
                if (!entry.kinds.has(kind)) {
                    continue;
                }
                kinds.push(kind);
                try {
                    const loaded = ScribeStore.load(storage, room, kind);
                    if (loaded !== null) {
                        characters += loaded.head.characters;
                    }
                } catch (error) {
                    if (error?.damaged !== true) {
                        throw error;
                    }
                    damaged.push(kind);
                }
            }
            listed.push({ roomId: entry.roomId, kinds, characters, damaged });
        }
        return listed;
    },

    /**
     * @param {{ get: Function, set: Function, remove: Function, list: Function }} storage
     * @param {string} roomId
     * @return {number}
     * @throws {Error}
     */
    sweep(storage, roomId) {
        const types = ScribeStore.Settings.Types;
        const room = ScribeStore.room(roomId);
        const parts = [];
        const kinds = new Set();
        for (const described of ScribeStore.stored(storage)) {
            if (described.room === room && described.type === types.Part) {
                parts.push(described);
                kinds.add(described.kind);
            }
        }
        const floors = new Map();
        for (const kind of kinds) {
            try {
                const loaded = ScribeStore.load(storage, room, kind);
                if (loaded !== null) {
                    floors.set(kind, loaded.head.generation);
                }
            } catch (error) {
                if (error?.damaged !== true) {
                    throw error;
                }
            }
        }
        let removed = 0;
        for (const described of parts) {
            if (!floors.has(described.kind) || described.generation >= floors.get(described.kind)) {
                continue;
            }
            const standing = ScribeStore.headOf(ScribeStore.fetch(storage, ScribeStore.name(types.Head, room, described.kind)));
            if (standing === null || described.generation >= standing.generation) {
                continue;
            }
            storage.remove(described.name);
            removed++;
        }
        return removed;
    },

    /**
     * @param {{ get: Function }} storage
     * @param {Set<string|null>} known
     * @return {Set<string|null>}
     */
    diagnosticKeys(storage, known = new Set()) {
        try {
            for (const key of [ScribeStore.key(storage), ScribeStore.cloudKey(storage)]) {
                if (key) {
                    known.add(key);
                }
            }
        } catch {
            known.add(null);
        }
        return known;
    },

    /**
     * @param {{ get: Function }} storage
     * @param {Set<string|null>} known
     * @return {(text: string) => string}
     */
    redactor(storage, known = new Set()) {
        ScribeStore.diagnosticKeys(storage, known);
        if (known.has(null)) {
            return () => 'Diagnostic withheld while saved credentials are unavailable.';
        }
        const keys = [...known].sort((first, second) => second.length - first.length);
        return (text) => {
            let masked = text;
            for (const key of keys) {
                masked = masked.replaceAll(key, '[key]');
            }
            return masked.replace(/\bsk-or-[A-Za-z0-9_-]+/gi, '[key]').replace(/\bBearer [^\s;,]+/gi, 'Bearer [key]');
        };
    },

    /**
     * @param {*} value
     * @param {(text: string) => string} mask
     * @return {*}
     */
    diagnosticCopy(value, mask) {
        if (typeof value === 'string') {
            return value === '' ? value : mask(value);
        }
        if (Array.isArray(value)) {
            return Object.freeze(value.map((item) => ScribeStore.diagnosticCopy(item, mask)));
        }
        if (value !== null && typeof value === 'object') {
            const fields = Object.entries(value).map(([name, item]) => [name, ScribeStore.diagnosticCopy(item, mask)]);
            return Object.freeze(Object.fromEntries(fields));
        }
        return value;
    },

    /**
     * @param {{ get: Function }} storage
     * @param {string|null} text
     * @return {string|null}
     */
    diagnostic(storage, text) {
        return text ? ScribeStore.redactor(storage)(text) : text;
    },

    /**
     * @param {{ get: Function }} storage
     * @param {string} kind
     * @param {object} value
     * @return {boolean}
     */
    redactRoomDiagnostics(storage, kind, value) {
        let mask;
        let changed = false;
        const field = (record, key) => {
            if (typeof record?.[key] === 'string' && record[key] !== '') {
                mask ??= ScribeStore.redactor(storage);
                const masked = mask(record[key]);
                if (record[key] !== masked) {
                    record[key] = masked;
                    changed = true;
                }
            }
        };
        if (kind === ScribeStore.Kind.Settings) {
            field(value.stop, 'problem');
        } else if (kind === ScribeStore.Kind.Live) {
            for (const role of ['scene', 'check']) {
                field(value.failing, role);
                field(value.failing?.[role], 'reason');
            }
            field(value.untold, 'reason');
            if (Array.isArray(value.retries)) {
                for (const retry of value.retries) {
                    field(retry, 'reason');
                }
            }
            if (Array.isArray(value.calls)) {
                for (const call of value.calls) {
                    field(call, 'answer');
                    field(call, 'finish');
                    field(call, 'problem');
                }
            }
        }
        return changed;
    },

    /**
     * @param {{ get: Function }} storage
     * @return {string}
     * @throws {Error}
     */
    key(storage) {
        const settings = ScribeStore.Settings;
        const stored = ScribeStore.fetch(storage, ScribeStore.name(settings.Key));
        return typeof stored === settings.StringType ? stored : settings.Nothing;
    },

    /**
     * @param {{ set: Function, remove: Function }} storage
     * @param {string} key
     * @return {void}
     * @throws {Error}
     */
    setKey(storage, key) {
        const settings = ScribeStore.Settings;
        ScribeStore.check(typeof key === settings.StringType, 'key');
        const trimmed = key.trim();
        const name = ScribeStore.name(settings.Key);
        try {
            if (trimmed === settings.Nothing) {
                storage.remove(name);
            } else {
                storage.set(name, trimmed);
            }
        } catch {
            throw new Error(settings.Messages.KeyFailed);
        }
    },

    /**
     * @param {{ get: Function }} storage
     * @return {string}
     * @throws {Error}
     */
    cloudKey(storage) {
        const settings = ScribeStore.Settings;
        const stored = ScribeStore.fetch(storage, ScribeStore.name(settings.CloudKey));
        return typeof stored === settings.StringType ? stored : settings.Nothing;
    },

    /**
     * @param {{ set: Function, remove: Function }} storage
     * @param {string} key
     * @return {void}
     * @throws {Error}
     */
    setCloudKey(storage, key) {
        const settings = ScribeStore.Settings;
        ScribeStore.check(typeof key === settings.StringType, 'key');
        const trimmed = key.trim();
        const name = ScribeStore.name(settings.CloudKey);
        try {
            if (trimmed === settings.Nothing) {
                storage.remove(name);
            } else {
                storage.set(name, trimmed);
            }
        } catch {
            throw new Error(settings.Messages.KeyFailed);
        }
    },

    /**
     * @param {{ get: Function, set: Function }} storage
     * @param {() => string} random
     * @return {string}
     * @throws {Error}
     */
    browserId(storage, random) {
        const settings = ScribeStore.Settings;
        const name = ScribeStore.name(settings.Browser);
        const stored = ScribeStore.fetch(storage, name);
        if (typeof stored === settings.StringType && settings.BrowserPattern.test(stored)) {
            return stored;
        }
        const made = random();
        ScribeStore.check(typeof made === settings.StringType && settings.BrowserPattern.test(made), 'browser');
        storage.set(name, made);
        return made;
    },

    /**
     * @param {{ get: Function, set: Function }} storage
     * @param {string} roomId
     * @param {string} tabId
     * @param {number} now
     * @return {boolean}
     * @throws {Error}
     */
    claim(storage, roomId, tabId, now) {
        const settings = ScribeStore.Settings;
        const name = ScribeStore.name(settings.Types.Claim, ScribeStore.room(roomId));
        ScribeStore.check(typeof tabId === settings.StringType && tabId !== settings.Nothing, 'tabId');
        ScribeStore.check(Number.isFinite(now), 'now');
        const held = ScribeStore.claimOf(ScribeStore.fetch(storage, name));
        if (
            held !== null
            && held.tabId !== tabId
            && now - held.at <= settings.ClaimStaleMs
            && held.at - now <= settings.ClaimStaleMs
        ) {
            return false;
        }
        storage.set(name, JSON.stringify({ tabId, at: now }));
        return true;
    },

    /**
     * @param {{ get: Function, remove: Function }} storage
     * @param {string} roomId
     * @param {string} tabId
     * @return {void}
     * @throws {Error}
     */
    release(storage, roomId, tabId) {
        const name = ScribeStore.name(ScribeStore.Settings.Types.Claim, ScribeStore.room(roomId));
        const first = ScribeStore.fetch(storage, name);
        const held = ScribeStore.claimOf(first);
        if (held === null || held.tabId !== tabId || ScribeStore.fetch(storage, name) !== first) {
            return;
        }
        storage.remove(name);
    },

    /**
     * @param {{ get: Function }} storage
     * @param {string} roomId
     * @param {string} day
     * @return {number}
     * @throws {Error}
     */
    spent(storage, roomId, day) {
        const settings = ScribeStore.Settings;
        const name = ScribeStore.name(settings.Types.Spent, ScribeStore.room(roomId));
        ScribeStore.check(typeof day === settings.StringType, 'day');
        const record = ScribeStore.decode(ScribeStore.fetch(storage, name));
        if (record === null || record.day !== day || !Number.isFinite(record.amount) || record.amount < settings.NoSpending) {
            return settings.NoSpending;
        }
        return record.amount;
    },

    /**
     * @param {{ get: Function, set: Function }} storage
     * @param {string} roomId
     * @param {string} day
     * @param {*} amount
     * @return {number}
     * @throws {Error}
     */
    spend(storage, roomId, day, amount) {
        const settings = ScribeStore.Settings;
        const total = ScribeStore.spent(storage, roomId, day);
        if (!Number.isFinite(amount) || amount <= settings.NoSpending) {
            return total;
        }
        const sum = total + amount;
        storage.set(ScribeStore.name(settings.Types.Spent, ScribeStore.room(roomId)), JSON.stringify({ day, amount: sum }));
        return sum;
    },

    /**
     * @param {*} value
     * @return {boolean}
     */
    whole(value) {
        return Number.isSafeInteger(value) && value >= ScribeStore.Settings.NoGeneration;
    },

    /**
     * @param {{ get: Function }} storage
     * @param {string} roomId
     * @return {Object<string, { revision: number, generation: number }>}
     * @throws {Error}
     */
    synced(storage, roomId) {
        const name = ScribeStore.name(ScribeStore.Settings.Types.Synced, ScribeStore.room(roomId));
        const record = ScribeStore.decode(ScribeStore.fetch(storage, name));
        const kept = {};
        if (record === null) {
            return kept;
        }
        for (const kind of Object.values(ScribeStore.Kind)) {
            const entry = Object.hasOwn(record, kind) ? record[kind] : null;
            if (entry !== null && ScribeStore.whole(entry.revision) && ScribeStore.whole(entry.generation)) {
                kept[kind] = { revision: entry.revision, generation: entry.generation };
            }
        }
        return kept;
    },

    /**
     * @param {{ get: Function, set: Function }} storage
     * @param {string} roomId
     * @param {string} kind
     * @param {*} revision
     * @param {*} generation
     * @return {void}
     * @throws {Error}
     */
    setSynced(storage, roomId, kind, revision, generation) {
        const room = ScribeStore.room(roomId);
        ScribeStore.checkKind(kind);
        ScribeStore.check(ScribeStore.whole(revision), 'revision');
        ScribeStore.check(ScribeStore.whole(generation), 'generation');
        const record = ScribeStore.synced(storage, roomId);
        record[kind] = { revision, generation };
        storage.set(ScribeStore.name(ScribeStore.Settings.Types.Synced, room), JSON.stringify(record));
    },

    /**
     * @param {{ get: Function }} storage
     * @param {string} roomId
     * @param {string} day
     * @return {number}
     * @throws {Error}
     */
    others(storage, roomId, day) {
        const settings = ScribeStore.Settings;
        const name = ScribeStore.name(settings.Types.Others, ScribeStore.room(roomId));
        ScribeStore.check(typeof day === settings.StringType, 'day');
        const record = ScribeStore.decode(ScribeStore.fetch(storage, name));
        const sound =
            record !== null &&
            record.day === day &&
            Number.isFinite(record.amount) &&
            record.amount >= settings.NoSpending;
        return sound ? record.amount : settings.NoSpending;
    },

    /**
     * @param {{ set: Function }} storage
     * @param {string} roomId
     * @param {string} day
     * @param {*} amount
     * @return {void}
     * @throws {Error}
     */
    setOthers(storage, roomId, day, amount) {
        const settings = ScribeStore.Settings;
        const name = ScribeStore.name(settings.Types.Others, ScribeStore.room(roomId));
        ScribeStore.check(typeof day === settings.StringType, 'day');
        ScribeStore.check(Number.isFinite(amount) && amount >= settings.NoSpending, 'amount');
        storage.set(name, JSON.stringify({ day, amount }));
    },

    /**
     * @param {{ get: Function, list: Function }} storage
     * @param {string} roomId
     * @return {string}
     * @throws {Error}
     */
    exportText(storage, roomId) {
        const types = ScribeStore.Settings.Types;
        const room = ScribeStore.room(roomId);
        const bundle = { roomId, generations: {}, damaged: [], raw: {} };
        for (const kind of Object.values(ScribeStore.Kind)) {
            let loaded = null;
            try {
                loaded = ScribeStore.load(storage, room, kind);
            } catch (error) {
                if (error?.damaged !== true) {
                    throw error;
                }
                bundle.damaged.push(kind);
                const parts = [];
                for (const described of ScribeStore.stored(storage)) {
                    if (described.type === types.Part && described.room === room && described.kind === kind) {
                        parts.push({ name: described.name, text: ScribeStore.fetch(storage, described.name) });
                    }
                }
                bundle.raw[kind] = { head: ScribeStore.fetch(storage, ScribeStore.name(types.Head, room, kind)), parts };
            }
            bundle.generations[kind] = loaded === null ? null : loaded.head.generation;
            bundle[kind] = loaded === null ? null : loaded.value;
        }
        return JSON.stringify(bundle);
    },
});
