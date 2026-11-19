CREATE TABLE IF NOT EXISTS room_memories (
    room_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
        CHECK (length(CAST(room_id AS BLOB)) BETWEEN 1 AND 512 AND substr(room_id, 1, 1) = '/'),
    notes TEXT NOT NULL CHECK (length(CAST(notes AS BLOB)) <= 65536),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
    updated_at TEXT NOT NULL CHECK (length(updated_at) = 24)
) STRICT;

CREATE TABLE IF NOT EXISTS api_rate_limit (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    window_start INTEGER NOT NULL CHECK (window_start >= 0 AND window_start % 60 = 0),
    request_count INTEGER NOT NULL CHECK (request_count BETWEEN 0 AND 180)
) STRICT;

CREATE TABLE IF NOT EXISTS scribe_kinds (
    room_id TEXT NOT NULL COLLATE BINARY
        CHECK (length(CAST(room_id AS BLOB)) BETWEEN 1 AND 512 AND substr(room_id, 1, 1) = '/'),
    kind TEXT NOT NULL CHECK (kind IN ('settings', 'book', 'live')),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
    parts INTEGER NOT NULL CHECK (parts BETWEEN 1 AND 10),
    updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
    PRIMARY KEY (room_id, kind)
) STRICT;

CREATE TABLE IF NOT EXISTS scribe_parts (
    room_id TEXT NOT NULL COLLATE BINARY
        CHECK (length(CAST(room_id AS BLOB)) BETWEEN 1 AND 512 AND substr(room_id, 1, 1) = '/'),
    kind TEXT NOT NULL CHECK (kind IN ('settings', 'book', 'live')),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
    part INTEGER NOT NULL CHECK (part BETWEEN 0 AND 9),
    text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 400000 AND length(CAST(text AS BLOB)) <= 1200000),
    digest TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
    PRIMARY KEY (room_id, kind, revision, part)
) STRICT;

CREATE TABLE IF NOT EXISTS scribe_spent (
    room_id TEXT NOT NULL COLLATE BINARY
        CHECK (length(CAST(room_id AS BLOB)) BETWEEN 1 AND 512 AND substr(room_id, 1, 1) = '/'),
    day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(day) IS day),
    browser TEXT NOT NULL CHECK (length(browser) BETWEEN 16 AND 64),
    total REAL NOT NULL CHECK (total BETWEEN 0 AND 1000000),
    PRIMARY KEY (room_id, day, browser)
) STRICT;

CREATE TABLE IF NOT EXISTS scribe_lease (
    room_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
        CHECK (length(CAST(room_id AS BLOB)) BETWEEN 1 AND 512 AND substr(room_id, 1, 1) = '/'),
    browser TEXT NOT NULL CHECK (length(browser) BETWEEN 16 AND 64),
    expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
    wanted TEXT CHECK (wanted IS NULL OR length(wanted) BETWEEN 16 AND 64),
    wanted_until INTEGER CHECK (wanted_until IS NULL OR wanted_until >= 0),
    asked INTEGER NOT NULL DEFAULT 0 CHECK (asked IN (0, 1)),
    CHECK ((wanted IS NULL) = (wanted_until IS NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS scribe_asks (
    room_id TEXT NOT NULL COLLATE BINARY
        CHECK (length(CAST(room_id AS BLOB)) BETWEEN 1 AND 512 AND substr(room_id, 1, 1) = '/'),
    id TEXT NOT NULL CHECK (length(id) BETWEEN 16 AND 64),
    browser TEXT NOT NULL CHECK (length(browser) BETWEEN 16 AND 64),
    action TEXT NOT NULL CHECK (length(CAST(action AS BLOB)) BETWEEN 2 AND 8192),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    PRIMARY KEY (room_id, id)
) STRICT;

CREATE TABLE IF NOT EXISTS scribe_rate_limit (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    window_start INTEGER NOT NULL CHECK (window_start >= 0 AND window_start % 60 = 0),
    request_count INTEGER NOT NULL CHECK (request_count BETWEEN 0 AND 600)
) STRICT;
