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
