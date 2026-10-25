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
        $connection = DB::connection('visitor');

        foreach ([
            "CREATE TABLE working_hours (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL REFERENCES stylist_profiles(id) ON DELETE RESTRICT, weekday INTEGER NOT NULL CHECK(typeof(weekday) = 'integer' AND weekday BETWEEN 0 AND 6), opens_at TEXT NOT NULL CHECK(length(opens_at) = 5 AND opens_at GLOB '[0-2][0-9]:[0-5][0-9]' AND opens_at <= '23:45' AND substr(opens_at,4,2) IN ('00','15','30','45')), closes_at TEXT NOT NULL CHECK(length(closes_at) = 5 AND closes_at GLOB '[0-2][0-9]:[0-5][0-9]' AND closes_at <= '23:59'), created_at TEXT, updated_at TEXT, UNIQUE(profile_id,weekday), CHECK(opens_at < closes_at))",
            'CREATE TABLE time_offs (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL REFERENCES stylist_profiles(id) ON DELETE RESTRICT, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL CHECK(ends_at > starts_at), created_at TEXT, updated_at TEXT)',
            'CREATE INDEX time_offs_profile_interval ON time_offs(profile_id,starts_at,ends_at)',
            "CREATE TABLE bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT, profile_id INTEGER NOT NULL REFERENCES stylist_profiles(id) ON DELETE RESTRICT, service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT, request_key TEXT NOT NULL CHECK(length(request_key) = 36), input_fingerprint TEXT NOT NULL CHECK(length(input_fingerprint) = 64), service_name TEXT NOT NULL CHECK(length(service_name) BETWEEN 1 AND 80), price_cents INTEGER NOT NULL CHECK(typeof(price_cents) = 'integer' AND price_cents BETWEEN 100 AND 100000), duration_minutes INTEGER NOT NULL CHECK(typeof(duration_minutes) = 'integer' AND duration_minutes BETWEEN 15 AND 240), deposit_percent INTEGER NOT NULL CHECK(typeof(deposit_percent) = 'integer' AND deposit_percent BETWEEN 10 AND 100), deposit_cents INTEGER NOT NULL CHECK(typeof(deposit_cents) = 'integer' AND deposit_cents = (price_cents * deposit_percent + 50) / 100), remaining_cents INTEGER NOT NULL CHECK(typeof(remaining_cents) = 'integer' AND remaining_cents = price_cents - deposit_cents), currency TEXT NOT NULL CHECK(currency = 'EUR'), timezone TEXT NOT NULL CHECK(timezone IN ('Europe/Paris','Europe/Lisbon','Europe/Madrid','Europe/Berlin')), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL CHECK(ends_at > starts_at AND round((julianday(ends_at)-julianday(starts_at))*1440) = duration_minutes), status TEXT NOT NULL CHECK(status IN ('requested','awaiting_deposit','confirmed','declined','cancelled','expired','completed')), accepted_at TEXT, deposit_deadline TEXT, decline_reason TEXT CHECK(length(decline_reason) <= 500), cancellation_reason TEXT CHECK(length(cancellation_reason) <= 500), note TEXT CHECK(length(note) <= 500), notification_budget INTEGER NOT NULL CHECK(typeof(notification_budget) = 'integer' AND notification_budget BETWEEN 0 AND 10), seed_key TEXT UNIQUE, created_at TEXT, updated_at TEXT, UNIQUE(client_id,request_key), CHECK(status != 'awaiting_deposit' OR (accepted_at IS NOT NULL AND deposit_deadline IS NOT NULL AND accepted_at < starts_at AND deposit_deadline <= starts_at AND deposit_deadline > accepted_at)))",
            'CREATE INDEX bookings_profile_interval_status ON bookings(profile_id,starts_at,ends_at,status)',
            'CREATE INDEX bookings_client_status_start ON bookings(client_id,status,starts_at)',
            "CREATE UNIQUE INDEX bookings_active_request ON bookings(client_id,service_id,starts_at) WHERE status IN ('requested','awaiting_deposit','confirmed')",
            "CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT, kind TEXT NOT NULL CHECK(kind IN ('deposit','refund')), amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents) = 'integer' AND amount_cents > 0 AND amount_cents <= 100000), currency TEXT NOT NULL CHECK(currency = 'EUR'), created_at TEXT, updated_at TEXT, UNIQUE(booking_id,kind))",
            "CREATE TABLE inbox_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT, booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT, event TEXT NOT NULL CHECK(event IN ('request_received','request_accepted','request_declined','deposit_paid','booking_expired','booking_cancelled','deposit_refunded')), event_key TEXT NOT NULL CHECK(length(event_key) <= 120), subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 160), body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), read_at TEXT, created_at TEXT, updated_at TEXT, UNIQUE(recipient_id,event_key))",
            'CREATE INDEX inbox_recipient_read ON inbox_messages(recipient_id,read_at,created_at)',
            'CREATE TABLE sandbox_meta (id INTEGER PRIMARY KEY CHECK(id = 1), generation TEXT NOT NULL, access_lock_version INTEGER NOT NULL DEFAULT 0 CHECK(access_lock_version >= 0), seed_anchor TEXT, created_at TEXT, updated_at TEXT)',
            "CREATE TRIGGER bookings_immutable_snapshots BEFORE UPDATE OF client_id,profile_id,service_id,request_key,input_fingerprint,service_name,price_cents,duration_minutes,deposit_percent,deposit_cents,remaining_cents,currency,timezone,starts_at,ends_at ON bookings WHEN (SELECT seed_anchor FROM sandbox_meta WHERE id = 1) IS NOT NULL BEGIN SELECT RAISE(ABORT, 'immutable:booking_snapshot'); END",
            "CREATE TRIGGER time_offs_capacity BEFORE INSERT ON time_offs WHEN NOT EXISTS (SELECT 1 FROM time_offs WHERE id = NEW.id) AND (SELECT count(*) FROM time_offs) >= 40 BEGIN SELECT RAISE(ABORT, 'capacity:time_offs'); END",
            "CREATE TRIGGER bookings_capacity BEFORE INSERT ON bookings WHEN NOT EXISTS (SELECT 1 FROM bookings WHERE id = NEW.id) AND (SELECT count(*) FROM bookings) >= 150 BEGIN SELECT RAISE(ABORT, 'capacity:bookings'); END",
            "CREATE TRIGGER inbox_messages_capacity BEFORE INSERT ON inbox_messages WHEN NOT EXISTS (SELECT 1 FROM inbox_messages WHERE id = NEW.id) AND (SELECT count(*) FROM inbox_messages) >= 1000 BEGIN SELECT RAISE(ABORT, 'capacity:inbox_messages'); END",
        ] as $statement) {
            $connection->statement($statement);
        }
    }

    /**
     * @return void
     */
    public function down(): void
    {
        $connection = DB::connection('visitor');

        foreach (['sandbox_meta', 'inbox_messages', 'payments', 'bookings', 'time_offs', 'working_hours'] as $table) {
            $connection->statement('DROP TABLE IF EXISTS '.$table);
        }
    }
};
