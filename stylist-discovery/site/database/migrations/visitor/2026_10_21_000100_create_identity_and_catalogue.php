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
            "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), email TEXT NOT NULL UNIQUE CHECK(email = lower(trim(email)) AND length(email) <= 254), password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('client','stylist','admin')), remember_token TEXT, email_verified_at TEXT, created_at TEXT, updated_at TEXT)",
            'CREATE TABLE specialties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), slug TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), created_at TEXT, updated_at TEXT)',
            "CREATE TABLE stylist_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT, display_name TEXT NOT NULL DEFAULT '' CHECK(length(display_name) <= 80), studio_name TEXT NOT NULL DEFAULT '' CHECK(length(studio_name) <= 80), biography TEXT NOT NULL DEFAULT '' CHECK(length(biography) <= 1200), address TEXT NOT NULL DEFAULT '' CHECK(length(address) <= 180), city_code TEXT NOT NULL CHECK(city_code IN ('paris','lisbon','barcelona','berlin')), timezone TEXT NOT NULL CHECK(timezone IN ('Europe/Paris','Europe/Lisbon','Europe/Madrid','Europe/Berlin')), status TEXT NOT NULL CHECK(status IN ('draft','pending','published','suspended')), deposit_percent INTEGER NOT NULL DEFAULT 25 CHECK(typeof(deposit_percent) = 'integer' AND deposit_percent BETWEEN 10 AND 100), booking_lock_version INTEGER NOT NULL DEFAULT 0 CHECK(booking_lock_version >= 0), portrait_asset TEXT, created_at TEXT, updated_at TEXT)",
            'CREATE TABLE profile_specialty (profile_id INTEGER NOT NULL REFERENCES stylist_profiles(id) ON DELETE RESTRICT, specialty_id INTEGER NOT NULL REFERENCES specialties(id) ON DELETE RESTRICT, PRIMARY KEY(profile_id,specialty_id))',
            "CREATE TABLE services (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL REFERENCES stylist_profiles(id) ON DELETE RESTRICT, specialty_id INTEGER NOT NULL REFERENCES specialties(id) ON DELETE RESTRICT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), price_cents INTEGER NOT NULL CHECK(typeof(price_cents) = 'integer' AND price_cents BETWEEN 100 AND 100000), duration_minutes INTEGER NOT NULL CHECK(typeof(duration_minutes) = 'integer' AND duration_minutes BETWEEN 15 AND 240), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT, updated_at TEXT)",
            'CREATE INDEX services_profile_active ON services(profile_id,active)',
            "CREATE TABLE portfolio_images (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL REFERENCES stylist_profiles(id) ON DELETE RESTRICT, seed_asset TEXT UNIQUE, storage_key TEXT UNIQUE, caption TEXT NOT NULL CHECK(length(caption) <= 160), position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0), created_at TEXT, updated_at TEXT, CHECK((seed_asset IS NOT NULL AND storage_key IS NULL AND seed_asset GLOB 'work-[0-9][0-9].svg' AND length(seed_asset) = 11) OR (seed_asset IS NULL AND storage_key IS NOT NULL AND length(storage_key) = 68 AND substr(storage_key,1,64) NOT GLOB '*[^0-9a-f]*' AND substr(storage_key,65) IN ('.jpg','.png'))))",
            "CREATE TRIGGER users_capacity BEFORE INSERT ON users WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.id) AND (SELECT count(*) FROM users) >= 40 BEGIN SELECT RAISE(ABORT, 'capacity:users'); END",
            "CREATE TRIGGER stylist_profiles_capacity BEFORE INSERT ON stylist_profiles WHEN NOT EXISTS (SELECT 1 FROM stylist_profiles WHERE id = NEW.id) AND (SELECT count(*) FROM stylist_profiles) >= 20 BEGIN SELECT RAISE(ABORT, 'capacity:stylist_profiles'); END",
            "CREATE TRIGGER services_capacity BEFORE INSERT ON services WHEN NOT EXISTS (SELECT 1 FROM services WHERE id = NEW.id) AND (SELECT count(*) FROM services) >= 120 BEGIN SELECT RAISE(ABORT, 'capacity:services'); END",
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

        foreach (['portfolio_images', 'services', 'profile_specialty', 'stylist_profiles', 'specialties', 'users'] as $table) {
            $connection->statement('DROP TABLE IF EXISTS '.$table);
        }
    }
};
