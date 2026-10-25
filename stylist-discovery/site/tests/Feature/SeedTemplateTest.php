<?php

namespace Tests\Feature;

use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Enums\PaymentKind;
use App\Enums\ProfileStatus;
use App\Models\Booking;
use App\Models\InboxMessage;
use App\Models\Payment;
use App\Models\PortfolioImage;
use App\Models\SandboxMeta;
use App\Models\Service;
use App\Models\Specialty;
use App\Models\StylistProfile;
use App\Models\User;
use App\Services\FixtureService;
use App\Services\InboxService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

class SeedTemplateTest extends TestCase
{
    /** @return void */
    public function test_seeded_event_retries_return_original_messages_even_with_zero_budget(): void
    {
        $fixtures = app(FixtureService::class);
        $directory = $this->runtime->path('fixtures');
        $fixtures->build($directory);
        $fixtures->configureConnection('visitor', $directory.'/template.sqlite', config('demo.limits.visitor_pages'));
        $messages = InboxMessage::query()->with(['booking', 'recipient'])->orderBy('id')->get();
        $count = $messages->count();
        $zeroBudgetRetries = 0;
        foreach ($messages as $message) {
            $budget = $message->booking->notification_budget;
            $retry = app(InboxService::class)->record($message->booking, $message->recipient, $message->event);
            $this->assertSame($message->id, $retry->id);
            $this->assertSame($budget, $message->booking->refresh()->notification_budget);
            $this->assertSame($count, InboxMessage::query()->count());
            if ($budget === 0) {
                $zeroBudgetRetries++;
            }
        }
        $this->assertGreaterThan(0, $zeroBudgetRetries);
    }

    /**
     * @return void
     */
    public function test_pristine_template_has_the_exact_catalogue_and_unusable_credentials(): void
    {
        $fixtures = app(FixtureService::class);
        $directory = $this->runtime->path('fixtures');
        $fixtures->build($directory);
        $fixtures->configureConnection('visitor', $directory.'/template.sqlite', config('demo.limits.visitor_pages'));
        $fixtures->configureConnection('registry', $directory.'/registry.sqlite', config('demo.limits.registry_pages'));
        $this->assertSame(16, User::query()->count());
        $this->assertSame(12, User::query()->where('role', AccountRole::Stylist)->count());
        $this->assertSame(3, User::query()->where('role', AccountRole::Client)->count());
        $this->assertSame(1, User::query()->where('role', AccountRole::Admin)->count());
        $this->assertSame(12, StylistProfile::query()->where('status', ProfileStatus::Published)->count());
        $this->assertSame(36, Service::query()->count());
        $this->assertSame(36, PortfolioImage::query()->whereNotNull('seed_asset')->whereNull('storage_key')->count());
        $this->assertSame(6, Specialty::query()->count());

        foreach (config('demo.locations') as $city => $location) {
            $this->assertSame(3, StylistProfile::query()->where('city_code', $city)->where('timezone', $location['timezone'])->count());
        }

        foreach (User::query()->get() as $user) {
            $this->assertStringEndsWith('.example', $user->email);
            $this->assertSame('argon2id', password_get_info($user->getRawOriginal('password'))['algoName']);
            $this->assertNotSame('plaintext', password_get_info($user->getRawOriginal('password'))['algoName']);
            $this->assertNotSame('unknown', password_get_info($user->getRawOriginal('password'))['algoName']);
            $this->assertFalse(Hash::check('password', $user->getRawOriginal('password')));
            $this->assertFalse(Hash::check($user->email, $user->getRawOriginal('password')));
        }

        $this->assertSame(16, User::query()->get()->pluck('password')->unique()->count());
        $this->assertNull(SandboxMeta::query()->sole()->seed_anchor);
        $this->assertSame('', SandboxMeta::query()->sole()->generation);
        $this->assertSame(4, Booking::query()->count());
        $this->assertSame(2, Payment::query()->where('kind', PaymentKind::Deposit)->count());
        $this->assertSame(11, InboxMessage::query()->count());

        foreach (['sandboxes', 'sandbox_files', 'sessions', 'revoked_sessions', 'cache', 'cache_locks'] as $table) {
            $this->assertSame(0, DB::connection('registry')->table($table)->count());
        }

        foreach (StylistProfile::query()->get() as $profile) {
            $this->assertTrue($profile->isPublished());
            $this->assertSame(3, $profile->services()->count());
            $this->assertSame(3, $profile->portfolioImages()->count());
            $this->assertSame(7, $profile->workingHours()->count());
            $this->assertFileExists(public_path('assets/seed/'.$profile->portrait_asset));
        }

        foreach (PortfolioImage::query()->get() as $image) {
            $this->assertFileExists(public_path('assets/seed/'.$image->seed_asset));
            $this->assertStringContainsString('not a photograph', file_get_contents(public_path('assets/seed/'.$image->seed_asset)));
        }

        $this->assertSame(1024, DB::connection('visitor')->selectOne('PRAGMA max_page_count')->max_page_count);
        $this->assertLessThanOrEqual(4194304, filesize($directory.'/template.sqlite'));
        $this->assertLessThanOrEqual(16777216, filesize($directory.'/registry.sqlite'));
    }

    /**
     * @return void
     */
    public function test_two_allocation_anchors_initialize_only_copies_and_preserve_snapshot_history(): void
    {
        $fixtures = app(FixtureService::class);
        $directory = $this->runtime->path('fixtures');
        $fixtures->build($directory);
        $template = $directory.'/template.sqlite';
        $templateHash = hash_file('sha256', $template);

        foreach (['2030-03-30 23:45:00', '2030-10-26 23:45:00'] as $index => $instant) {
            $copy = $this->runtime->path('visitor-'.$index.'.sqlite');
            copy($template, $copy);
            $fixtures->configureConnection('visitor', $copy, config('demo.limits.visitor_pages'));
            $anchor = CarbonImmutable::parse($instant, 'UTC');
            $fixtures->initializeVisitor($anchor);
            $this->assertTrue($anchor->equalTo(SandboxMeta::query()->sole()->seed_anchor));

            foreach (Booking::query()->with(['profile', 'payments', 'messages'])->get() as $booking) {
                $definition = config('demo.seed.bookings.'.$booking->seed_key);
                $localStart = $booking->starts_at->setTimezone($booking->timezone);
                $this->assertSame($definition['hour'], $localStart->hour);
                $this->assertSame(0, $localStart->minute);
                $this->assertSame($anchor->setTimezone($booking->timezone)->addDays($definition['days'])->toDateString(), $localStart->toDateString());
                $this->assertSame($booking->duration_minutes, (int) $booking->starts_at->diffInMinutes($booking->ends_at));
                $this->assertSame($booking->price_cents, $booking->deposit_cents + $booking->remaining_cents);
                $this->assertSame(intdiv($booking->price_cents * $booking->deposit_percent + 50, 100), $booking->deposit_cents);
                $this->assertSame($definition['budget'], $booking->notification_budget);
                $this->assertSame($booking->timezone, $booking->profile->timezone);
                $this->assertSame('09:00', $booking->profile->workingHours()->where('weekday', $localStart->dayOfWeek)->sole()->opens_at);
                $this->assertTrue($booking->created_at->lessThanOrEqualTo($anchor));

                foreach ($booking->messages as $message) {
                    $this->assertTrue($message->created_at->lessThanOrEqualTo($anchor));
                    $this->assertTrue($message->created_at->greaterThanOrEqualTo($booking->created_at));
                }

                if ($booking->accepted_at !== null) {
                    $this->assertTrue($booking->accepted_at->lessThanOrEqualTo($anchor));
                    $this->assertTrue($booking->accepted_at->greaterThanOrEqualTo($booking->created_at));
                }

                if ($booking->status === BookingStatus::Completed) {
                    $this->assertTrue($booking->ends_at->lessThan($anchor));
                } else {
                    $this->assertTrue($booking->starts_at->greaterThan($anchor->addHours(2)));
                    $this->assertTrue($booking->starts_at->lessThan($anchor->addDays(60)));
                }

                if ($booking->status === BookingStatus::AwaitingDeposit) {
                    $this->assertTrue($booking->accepted_at->equalTo($anchor));
                    $this->assertTrue($booking->deposit_deadline->equalTo($anchor->addMinutes(30)));
                    $this->assertTrue($booking->isPayable($anchor));
                    $this->assertFalse($booking->isPayable($anchor->addMinutes(30)));
                }

                if (in_array($booking->status, [BookingStatus::Confirmed, BookingStatus::Completed], true)) {
                    $this->assertSame($booking->deposit_cents, $booking->payments->sole()->amount_cents);
                }
            }

            DB::purge('visitor');
            $this->assertSame($templateHash, hash_file('sha256', $template));
        }
    }

    /**
     * @return void
     */
    public function test_builder_refuses_existing_output_and_reinitialization(): void
    {
        $fixtures = app(FixtureService::class);
        $directory = $this->runtime->path('fixtures');
        $fixtures->build($directory);
        $before = hash_file('sha256', $directory.'/template.sqlite');

        try {
            $fixtures->build($directory);
            $this->fail('Existing fixture output was overwritten.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('new directory', $exception->getMessage());
            $this->assertSame($before, hash_file('sha256', $directory.'/template.sqlite'));
        }

        $copy = $this->runtime->path('visitor.sqlite');
        copy($directory.'/template.sqlite', $copy);
        $fixtures->configureConnection('visitor', $copy, config('demo.limits.visitor_pages'));
        $fixtures->initializeVisitor(CarbonImmutable::parse('2030-01-01', 'UTC'));
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Only a pristine template copy can be initialized.');
        $fixtures->initializeVisitor(CarbonImmutable::parse('2031-01-01', 'UTC'));
    }
}
