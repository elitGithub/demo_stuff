<?php

namespace Tests\Feature;

use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Enums\InboxEvent;
use App\Enums\PaymentKind;
use App\Enums\ProfileStatus;
use App\Models\Booking;
use App\Models\InboxMessage;
use App\Models\Payment;
use App\Models\SandboxMeta;
use App\Models\Service;
use App\Models\Specialty;
use App\Models\StylistProfile;
use App\Models\User;
use App\Services\FixtureService;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class SchemaInvariantTest extends TestCase
{
    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();
        $path = $this->runtime->path('visitor.sqlite');
        touch($path);
        app(FixtureService::class)->configureConnection('visitor', $path, config('demo.limits.visitor_pages'));

        foreach (glob(database_path('migrations/visitor/*.php')) as $migrationPath) {
            (require $migrationPath)->up();
        }

        User::query()->create(['name' => 'Fictional Client', 'email' => 'client@test.example', 'password' => bin2hex(random_bytes(32)), 'role' => AccountRole::Client]);
        $stylist = User::query()->create(['name' => 'Fictional Stylist', 'email' => 'stylist@test.example', 'password' => bin2hex(random_bytes(32)), 'role' => AccountRole::Stylist]);
        $profile = StylistProfile::query()->create(['user_id' => $stylist->id, 'city_code' => 'paris', 'timezone' => 'Europe/Paris', 'status' => ProfileStatus::Published, 'deposit_percent' => 30]);
        $specialty = Specialty::query()->create(['name' => 'Curls', 'slug' => 'curls', 'enabled' => true]);
        Service::query()->create(['profile_id' => $profile->id, 'specialty_id' => $specialty->id, 'name' => 'Fictional cut', 'price_cents' => 10001, 'duration_minutes' => 60, 'active' => true]);
        SandboxMeta::query()->create(['id' => 1, 'generation' => 'test-generation', 'seed_anchor' => CarbonImmutable::now('UTC')]);
    }

    /**
     * @return void
     */
    public function test_identity_and_catalogue_constraints_reject_invalid_values(): void
    {
        $client = User::query()->firstOrFail();
        $this->assertTrue($client->hasRole(AccountRole::Client));
        $this->assertFalse($client->hasRole(AccountRole::Stylist));
        $this->assertTrue($client->is(User::query()->findOrFail($client->id)));
        $this->assertRejected(fn () => DB::connection('visitor')->table('users')->insert(['name' => 'Duplicate', 'email' => $client->email, 'password' => 'unusable', 'role' => 'client']));
        $this->assertRejected(fn () => DB::connection('visitor')->table('users')->insert(['name' => 'Mixed case', 'email' => 'Mixed@test.example', 'password' => 'unusable', 'role' => 'client']));
        $this->assertRejected(fn () => StylistProfile::query()->firstOrFail()->update(['deposit_percent' => 9]));
        $this->assertRejected(fn () => Service::query()->firstOrFail()->update(['duration_minutes' => 14]));
        $this->assertRejected(fn () => Service::query()->firstOrFail()->update(['price_cents' => 100001]));
        $this->assertRejected(fn () => Service::query()->firstOrFail()->update(['price_cents' => 123.5]));
        $this->assertRejected(fn () => DB::connection('visitor')->table('portfolio_images')->insert(['profile_id' => 1, 'seed_asset' => '../evil.svg', 'caption' => 'Invalid']));
        $this->assertRejected(fn () => DB::connection('visitor')->table('working_hours')->insert(['profile_id' => 1, 'weekday' => 7, 'opens_at' => '09:00', 'closes_at' => '18:00']));
        $this->assertRejected(fn () => DB::connection('visitor')->table('working_hours')->insert(['profile_id' => 1, 'weekday' => 1, 'opens_at' => '18:00', 'closes_at' => '09:00']));
    }

    /**
     * @return void
     */
    public function test_duplicate_payment_event_and_active_request_are_rejected(): void
    {
        $booking = $this->booking(BookingStatus::Requested);
        $this->assertRejected(fn () => $this->booking(BookingStatus::Requested));
        $this->assertRejected(fn () => $this->booking(BookingStatus::Requested, $booking->request_key, '2030-06-10 14:00:00'));
        Payment::query()->create(['booking_id' => $booking->id, 'kind' => PaymentKind::Deposit, 'amount_cents' => $booking->deposit_cents, 'currency' => 'EUR']);
        $this->assertRejected(fn () => Payment::query()->create(['booking_id' => $booking->id, 'kind' => PaymentKind::Deposit, 'amount_cents' => $booking->deposit_cents, 'currency' => 'EUR']));
        InboxMessage::query()->create(['booking_id' => $booking->id, 'recipient_id' => 1, 'event' => InboxEvent::RequestAccepted, 'event_key' => 'test-event', 'subject' => 'Subject', 'body' => 'Body']);
        $this->assertRejected(fn () => InboxMessage::query()->create(['booking_id' => $booking->id, 'recipient_id' => 1, 'event' => InboxEvent::RequestAccepted, 'event_key' => 'test-event', 'subject' => 'Subject', 'body' => 'Body']));
        $booking->update(['status' => BookingStatus::Expired]);
        $this->assertSame(BookingStatus::Requested, $this->booking(BookingStatus::Requested)->status);
    }

    /**
     * @return void
     */
    public function test_snapshot_history_survives_catalogue_changes_and_cannot_be_rewritten(): void
    {
        $booking = $this->booking(BookingStatus::Confirmed);
        Service::query()->firstOrFail()->update(['active' => false, 'name' => 'Changed name', 'price_cents' => 30000, 'duration_minutes' => 120]);
        StylistProfile::query()->firstOrFail()->update(['status' => ProfileStatus::Suspended, 'deposit_percent' => 50]);
        $booking->refresh();
        $this->assertSame('Fictional cut', $booking->service_name);
        $this->assertSame(10001, $booking->price_cents);
        $this->assertSame(3000, $booking->deposit_cents);
        $this->assertSame(7001, $booking->remaining_cents);
        $this->assertSame(60, $booking->duration_minutes);
        $this->assertSame(30, $booking->deposit_percent);
        $this->assertInstanceOf(CarbonImmutable::class, $booking->starts_at);
        $this->assertRejected(fn () => $booking->update(['service_name' => 'Forged snapshot']));
        $this->assertRejected(fn () => $booking->service()->delete());
        $this->assertRejected(fn () => $booking->profile()->delete());
    }

    /**
     * @return void
     */
    public function test_effective_status_and_payability_use_exact_deadline_boundaries(): void
    {
        $booking = $this->booking(BookingStatus::AwaitingDeposit);
        $this->assertTrue($booking->isPayable(CarbonImmutable::parse('2030-06-10 09:29:59', 'UTC')));
        $this->assertFalse($booking->isPayable(CarbonImmutable::parse('2030-06-10 09:30:00', 'UTC')));
        $this->assertSame(BookingStatus::Expired, $booking->effectiveStatus(CarbonImmutable::parse('2030-06-10 09:30:00', 'UTC')));
        $booking->update(['status' => BookingStatus::Requested]);
        $this->assertSame(BookingStatus::Requested, $booking->effectiveStatus($booking->starts_at->subSecond()));
        $this->assertSame(BookingStatus::Expired, $booking->effectiveStatus($booking->starts_at));
        $booking->update(['status' => BookingStatus::Confirmed]);
        $this->assertSame(BookingStatus::Confirmed, $booking->effectiveStatus($booking->ends_at->addDay()));
    }

    /**
     * @return void
     */
    public function test_registry_caps_payload_bounds_and_pragmas_are_enforced(): void
    {
        $path = $this->runtime->path('registry.sqlite');
        touch($path);
        app(FixtureService::class)->configureConnection('registry', $path, config('demo.limits.registry_pages'));
        (require database_path('migrations/registry/2026_10_21_000100_create_registry.php'))->up();
        $registry = DB::connection('registry');

        foreach (['sandboxes' => 25, 'sessions' => 250, 'revoked_sessions' => 1000, 'cache' => 2000, 'cache_locks' => 100] as $table => $capacity) {
            $registry->transaction(function () use ($registry, $table, $capacity): void {
                foreach (range(1, $capacity) as $index) {
                    $digest = hash('sha256', $table.$index);
                    $values = match ($table) {
                        'sandboxes' => ['digest' => $digest, 'generation' => 'test', 'status' => 'retiring', 'expires_at' => '2030-01-01', 'allocated_at' => '2030-01-01'],
                        'sessions' => ['id' => $digest, 'payload' => '', 'last_activity' => 1],
                        'revoked_sessions' => ['digest' => $digest, 'expires_at' => '2030-01-01'],
                        'cache' => ['key' => $digest, 'value' => '', 'expiration' => 1],
                        'cache_locks' => ['key' => $digest, 'owner' => 'test', 'expiration' => 1],
                    };
                    $registry->table($table)->insert($values);
                }

                $values[array_key_first($values)] = hash('sha256', 'overflow'.$table);
                $this->assertRejected(fn () => $registry->table($table)->insert($values), 'capacity:'.$table);
            });
        }

        $this->assertRejected(fn () => $registry->table('sessions')->where('id', hash('sha256', 'sessions1'))->update(['payload' => str_repeat('a', 16385)]));
        $this->assertRejected(fn () => $registry->table('sessions')->where('id', hash('sha256', 'sessions1'))->update(['ip_address' => '127.0.0.1']));
        $this->assertRejected(fn () => $registry->table('cache')->where('key', hash('sha256', 'cache1'))->update(['value' => str_repeat('a', 4097)]));
        $digest = hash('sha256', 'sandboxes1');

        foreach (range(1, 8) as $index) {
            $registry->table('sandbox_files')->insert(['sandbox_digest' => $digest, 'storage_key' => hash('sha256', 'image'.$index).'.jpg', 'status' => 'retiring', 'created_at' => '2030-01-01']);
        }

        $this->assertRejected(fn () => $registry->table('sandbox_files')->insert(['sandbox_digest' => $digest, 'storage_key' => hash('sha256', 'ninth').'.jpg', 'status' => 'reserved', 'created_at' => '2030-01-01']), 'capacity:sandbox_uploads');
        $this->assertSame(4096, $registry->selectOne('PRAGMA page_size')->page_size);
        $this->assertSame(4096, $registry->selectOne('PRAGMA max_page_count')->max_page_count);
        $this->assertSame(2000, $registry->selectOne('PRAGMA busy_timeout')->timeout);
        $this->assertSame(1, $registry->selectOne('PRAGMA foreign_keys')->foreign_keys);
        $this->assertSame('delete', $registry->selectOne('PRAGMA journal_mode')->journal_mode);
    }

    /**
     * @param  BookingStatus  $status
     * @param  ?string  $requestKey
     * @param  string  $startsAt
     * @return Booking
     */
    protected function booking(BookingStatus $status, ?string $requestKey = null, string $startsAt = '2030-06-10 12:00:00'): Booking
    {
        $service = Service::query()->firstOrFail();

        return Booking::query()->create([
            'client_id' => 1, 'profile_id' => 1, 'service_id' => $service->id,
            'request_key' => $requestKey ?? (string) Str::uuid(), 'input_fingerprint' => hash('sha256', 'test'),
            'service_name' => $service->name, 'price_cents' => 10001, 'duration_minutes' => 60,
            'deposit_percent' => 30, 'deposit_cents' => 3000, 'remaining_cents' => 7001, 'currency' => 'EUR',
            'timezone' => 'Europe/Paris', 'starts_at' => $startsAt, 'ends_at' => CarbonImmutable::parse($startsAt, 'UTC')->addHour(),
            'status' => $status, 'notification_budget' => 8, 'accepted_at' => '2030-06-10 09:00:00', 'deposit_deadline' => '2030-06-10 09:30:00',
        ]);
    }

    /**
     * @param  Closure  $operation
     * @param  ?string  $message
     * @return void
     */
    protected function assertRejected(Closure $operation, ?string $message = null): void
    {
        try {
            $operation();
            $this->fail('The schema accepted invalid data.');
        } catch (QueryException $exception) {
            $this->assertNotSame('', $exception->getMessage());

            if ($message !== null) {
                $this->assertStringContainsString($message, $exception->getMessage());
            }
        }
    }
}
