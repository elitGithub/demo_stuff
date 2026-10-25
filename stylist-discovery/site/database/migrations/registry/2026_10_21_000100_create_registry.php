<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * @return void
     */
    public function up(): void
    {
        $connection = DB::connection('registry');

        foreach ([
            "CREATE TABLE sandboxes (digest TEXT PRIMARY KEY CHECK(length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'), generation TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('allocating','active','retiring')), expires_at TEXT NOT NULL, allocated_at TEXT NOT NULL)",
            'CREATE INDEX sandboxes_status_expiry ON sandboxes(status,expires_at)',
            "CREATE TABLE sandbox_files (id INTEGER PRIMARY KEY AUTOINCREMENT, sandbox_digest TEXT NOT NULL REFERENCES sandboxes(digest) ON DELETE RESTRICT, storage_key TEXT NOT NULL UNIQUE CHECK(length(storage_key) = 68 AND substr(storage_key,1,64) NOT GLOB '*[^0-9a-f]*' AND substr(storage_key,65) IN ('.jpg','.png')), status TEXT NOT NULL CHECK(status IN ('reserved','attached','retiring')), created_at TEXT NOT NULL, updated_at TEXT)",
            'CREATE INDEX sandbox_files_status_created ON sandbox_files(status,created_at)',
            "CREATE TABLE revoked_sessions (digest TEXT PRIMARY KEY CHECK(length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'), expires_at TEXT NOT NULL)",
            'CREATE INDEX revoked_sessions_expiry ON revoked_sessions(expires_at)',
            'CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER, ip_address TEXT CHECK(ip_address IS NULL), user_agent TEXT CHECK(length(user_agent) <= 500), payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB)) <= 16384), last_activity INTEGER NOT NULL)',
            'CREATE INDEX sessions_last_activity ON sessions(last_activity)',
            'CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(length(CAST(value AS BLOB)) <= 4096), expiration INTEGER NOT NULL)',
            'CREATE INDEX cache_expiration ON cache(expiration)',
            'CREATE TABLE cache_locks (key TEXT PRIMARY KEY, owner TEXT NOT NULL CHECK(length(owner) <= 255), expiration INTEGER NOT NULL)',
            'CREATE INDEX cache_locks_expiration ON cache_locks(expiration)',
            "CREATE TRIGGER sandbox_files_per_sandbox_capacity BEFORE INSERT ON sandbox_files WHEN (SELECT count(*) FROM sandbox_files WHERE sandbox_digest = NEW.sandbox_digest) >= 8 BEGIN SELECT RAISE(ABORT, 'capacity:sandbox_uploads'); END",
            "CREATE TRIGGER sandbox_files_per_sandbox_update_capacity BEFORE UPDATE OF sandbox_digest ON sandbox_files WHEN NEW.sandbox_digest != OLD.sandbox_digest AND (SELECT count(*) FROM sandbox_files WHERE sandbox_digest = NEW.sandbox_digest) >= 8 BEGIN SELECT RAISE(ABORT, 'capacity:sandbox_uploads'); END",
            "CREATE TRIGGER sandboxes_capacity BEFORE INSERT ON sandboxes WHEN NOT EXISTS (SELECT 1 FROM sandboxes WHERE digest = NEW.digest) AND (SELECT count(*) FROM sandboxes) >= 25 BEGIN SELECT RAISE(ABORT, 'capacity:sandboxes'); END",
            "CREATE TRIGGER sandbox_files_capacity BEFORE INSERT ON sandbox_files WHEN NOT EXISTS (SELECT 1 FROM sandbox_files WHERE id = NEW.id) AND (SELECT count(*) FROM sandbox_files) >= 200 BEGIN SELECT RAISE(ABORT, 'capacity:sandbox_files'); END",
            "CREATE TRIGGER revoked_sessions_capacity BEFORE INSERT ON revoked_sessions WHEN NOT EXISTS (SELECT 1 FROM revoked_sessions WHERE digest = NEW.digest) AND (SELECT count(*) FROM revoked_sessions) >= 1000 BEGIN SELECT RAISE(ABORT, 'capacity:revoked_sessions'); END",
            "CREATE TRIGGER sessions_capacity BEFORE INSERT ON sessions WHEN NOT EXISTS (SELECT 1 FROM sessions WHERE id = NEW.id) AND (SELECT count(*) FROM sessions) >= 250 BEGIN SELECT RAISE(ABORT, 'capacity:sessions'); END",
            "CREATE TRIGGER cache_capacity BEFORE INSERT ON cache WHEN NOT EXISTS (SELECT 1 FROM cache WHERE key = NEW.key) AND (SELECT count(*) FROM cache) >= 2000 BEGIN SELECT RAISE(ABORT, 'capacity:cache'); END",
            "CREATE TRIGGER cache_locks_capacity BEFORE INSERT ON cache_locks WHEN NOT EXISTS (SELECT 1 FROM cache_locks WHERE key = NEW.key) AND (SELECT count(*) FROM cache_locks) >= 100 BEGIN SELECT RAISE(ABORT, 'capacity:cache_locks'); END",
        ] as $statement) {
            $connection->statement($statement);
        }
    }

    /**
     * @return void
     */
    public function down(): void
    {
        $connection = DB::connection('registry');

        foreach (['cache_locks', 'cache', 'sessions', 'revoked_sessions', 'sandbox_files', 'sandboxes'] as $table) {
            $connection->statement('DROP TABLE IF EXISTS '.$table);
        }
    }
};
