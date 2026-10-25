<?php

namespace Tests\Feature;

use App\Data\TimeOffInput;
use App\Data\WeeklyInterval;
use App\Data\WeeklySchedule;
use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Enums\ProfileStatus;
use App\Models\Booking;
use App\Models\Service;
use App\Models\Specialty;
use App\Models\StylistProfile;
use App\Models\TimeOff;
use App\Models\User;
use App\Services\AvailabilityService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\BuildsAccountRuntime;
use Tests\TestCase;

class AvailabilityTest extends TestCase
{
    use BuildsAccountRuntime;

    protected StylistProfile $profile;

    protected Service $service;

    protected string $actorContext;

    protected AvailabilityService $availability;

    /** @return void */
    protected function setUp(): void
    {
        parent::setUp();
        $this->buildAccountRuntime();
        $entry = $this->enterAccountDemo();
        $this->post('/demo/role', ['_actor_context' => $this->formContext($entry), 'role' => AccountRole::Stylist->value])->assertRedirect();
        $this->withCookie('strand_city_session', session()->getId());
        $this->actorContext = $this->formContext($this->get('/stylist/availability')->assertOk());
        $this->admitAccountFixture();
        $this->profile = StylistProfile::query()->sole();
        $this->profile->update(['status' => ProfileStatus::Published, 'display_name' => 'Mira Fictional', 'studio_name' => 'Studio Sample', 'biography' => 'A thoughtful cut.', 'address' => '1 Fictional Studio Lane']);
        $specialty = Specialty::query()->create(['name' => 'Cuts', 'slug' => 'cuts', 'enabled' => true]);
        $this->profile->specialties()->attach($specialty);
        $this->service = $this->profile->services()->create(['name' => 'Signature cut', 'specialty_id' => $specialty->id, 'price_cents' => 10000, 'duration_minutes' => 60, 'active' => true]);
        for ($weekday = 0; $weekday < 7; $weekday++) {
            $this->profile->workingHours()->create(['weekday' => $weekday, 'opens_at' => '09:00', 'closes_at' => '18:00']);
        }
        $this->availability = app(AvailabilityService::class);
    }

    /**
     * @param  string  $local
     * @param  BookingStatus  $status
     * @param  ?CarbonImmutable  $deadline
     * @return Booking
     */
    protected function booking(string $local, BookingStatus $status = BookingStatus::Confirmed, ?CarbonImmutable $deadline = null): Booking
    {
        $startsAt = $this->availability->localInstant($local, 'Europe/Paris');

        return Booking::query()->create(['client_id' => User::query()->where('role', AccountRole::Client)->sole()->id, 'profile_id' => $this->profile->id, 'service_id' => $this->service->id, 'request_key' => (string) Str::uuid(), 'input_fingerprint' => str_repeat('a', 64), 'service_name' => $this->service->name, 'price_cents' => 10000, 'duration_minutes' => 60, 'deposit_percent' => 25, 'deposit_cents' => 2500, 'remaining_cents' => 7500, 'currency' => 'EUR', 'timezone' => 'Europe/Paris', 'starts_at' => $startsAt, 'ends_at' => $startsAt->addHour(), 'status' => $status, 'accepted_at' => $deadline?->subMinutes(30) ?? $startsAt->subDay(), 'deposit_deadline' => $deadline ?? $startsAt->subHours(23), 'notification_budget' => 8]);
    }

    /**
     * @param  string  $opensAt
     * @param  string  $closesAt
     * @return array<string, mixed>
     */
    protected function weeklyPayload(string $opensAt = '09:00', string $closesAt = '18:00'): array
    {
        return ['_actor_context' => $this->actorContext, 'days' => collect(range(0, 6))->map(fn (int $weekday): array => ['weekday' => $weekday, 'open' => '1', 'opens_at' => $opensAt, 'closes_at' => $closesAt])->all()];
    }

    /** @return void */
    public function test_half_open_intervals_expired_holds_and_requested_rows(): void
    {
        $now = $this->availability->localInstant('2026-11-02 07:00', 'Europe/Paris');
        $this->booking('2026-11-02 10:00');
        $this->booking('2026-11-02 12:00', BookingStatus::Requested);
        $this->booking('2026-11-02 14:00', BookingStatus::AwaitingDeposit, $now);
        $times = $this->availability->slots($this->service, '2026-11-02', $now)->map(fn ($slot): string => $slot->startsAt->setTimezone('Europe/Paris')->format('H:i'));
        $this->assertTrue($times->contains('11:00'));
        $this->assertFalse($times->contains('10:45'));
        $this->assertTrue($times->contains('12:00'));
        $this->assertTrue($times->contains('14:00'));
        $this->availability->assertAvailable($this->profile, $this->availability->localInstant('2026-11-02 11:00', 'Europe/Paris'), $this->availability->localInstant('2026-11-02 12:00', 'Europe/Paris'), null, $now);
        $this->expectException(ValidationException::class);
        $this->availability->assertAvailable($this->profile, $this->availability->localInstant('2026-11-02 10:45', 'Europe/Paris'), $this->availability->localInstant('2026-11-02 11:45', 'Europe/Paris'), null, $now);
    }

    /** @return void */
    public function test_exact_request_window_boundaries_are_inclusive(): void
    {
        $start = $this->availability->localInstant('2026-11-02 10:00', 'Europe/Paris');
        $contains = fn ($slots): bool => $slots->contains(fn ($slot): bool => $slot->startsAt->equalTo($start));
        $this->assertTrue($contains($this->availability->slots($this->service, '2026-11-02', $start->subHours(2))));
        $this->assertFalse($contains($this->availability->slots($this->service, '2026-11-02', $start->subHours(2)->addMinute())));
        $this->assertTrue($contains($this->availability->slots($this->service, '2026-11-02', $start->subDays(60))));
        $this->assertFalse($contains($this->availability->slots($this->service, '2026-11-02', $start->subDays(60)->subMinute())));
        $this->assertFalse($contains($this->availability->slots($this->service, '2026-11-02', $start->subDays(60)->subMinute()->setTimezone('Europe/Paris'))));
    }

    /** @return void */
    public function test_grid_hours_and_duration_boundaries_and_acceptance_without_restarting_lead_time(): void
    {
        $schedule = $this->availability->currentSchedule($this->profile);
        $start = $this->availability->localInstant('2026-11-02 09:00', 'Europe/Paris');
        $this->assertTrue($this->availability->fitsSchedule($schedule, 'Europe/Paris', $start, $start->addMinutes(15)));
        $this->assertTrue($this->availability->fitsSchedule($schedule, 'Europe/Paris', $start, $start->addMinutes(240)));
        $this->assertFalse($this->availability->fitsSchedule($schedule, 'Europe/Paris', $start, $start->addMinutes(14)));
        $this->assertFalse($this->availability->fitsSchedule($schedule, 'Europe/Paris', $start, $start->addMinutes(241)));
        $this->assertFalse($this->availability->fitsSchedule($schedule, 'Europe/Paris', $start->addMinutes(7), $start->addMinutes(67)));
        $this->assertFalse($this->availability->fitsSchedule($schedule, 'Europe/Paris', $start->setTime(17, 45), $start->setTime(18, 15)));
        $this->availability->assertAvailable($this->profile, $start, $start->addHour(), null, $start->subMinute());
        $this->assertTrue(true);
    }

    /** @return void */
    public function test_fold_grid_excludes_both_ambiguous_start_instants_and_gap_is_skipped(): void
    {
        $this->profile->workingHours()->where('weekday', 0)->update(['opens_at' => '00:00', 'closes_at' => '05:00']);
        $slots = $this->availability->slots($this->service, '2026-10-25', CarbonImmutable::parse('2026-10-24 00:00Z'));
        $localTimes = $slots->map(fn ($slot): string => $slot->startsAt->setTimezone('Europe/Paris')->format('H:i'));
        $this->assertFalse($localTimes->contains('02:30'));
        $this->assertSame($localTimes->count(), $localTimes->unique()->count());
        $spring = $this->availability->slots($this->service, '2027-03-28', CarbonImmutable::parse('2027-03-27 00:00Z'));
        $this->assertFalse($spring->contains(fn ($slot): bool => $slot->startsAt->setTimezone('Europe/Paris')->format('H') === '02'));
        $this->assertTrue($spring->contains(fn ($slot): bool => $slot->startsAt->setTimezone('Europe/Paris')->format('H:i') === '03:00'));
    }

    /** @return void */
    public function test_conflicting_time_off_and_closing_hours_fail_atomically_with_booking_reference(): void
    {
        $localDate = CarbonImmutable::now('Europe/Paris')->addDays(3)->toDateString();
        $booking = $this->booking($localDate.' 10:00');
        $lock = $this->profile->booking_lock_version;
        $this->post('/stylist/time-off', ['_actor_context' => $this->actorContext, 'starts_local' => $localDate.'T10:30', 'ends_local' => $localDate.'T11:30'])->assertStatus(422)->assertSee('Booking #'.$booking->id);
        $this->patch('/stylist/availability', $this->weeklyPayload(closesAt: '10:30'))->assertStatus(422)->assertSee('Booking #'.$booking->id);
        $this->admitAccountFixture();
        $this->assertSame(0, $this->profile->timeOff()->count());
        $this->assertSame(7, $this->profile->workingHours()->where('closes_at', '18:00')->count());
        $this->assertSame($lock, $this->profile->fresh()->booking_lock_version);
        $this->assertSame(BookingStatus::Confirmed, $booking->fresh()->status);
    }

    /** @return void */
    public function test_same_timezone_city_change_succeeds_and_conflicting_timezone_change_rolls_back(): void
    {
        $localDate = CarbonImmutable::now('Europe/Paris')->addDays(3)->toDateString();
        $this->booking($localDate.' 09:00');
        $payload = ['_actor_context' => $this->actorContext, 'display_name' => 'Mira Fictional', 'studio_name' => 'Studio Sample', 'biography' => 'A thoughtful cut.', 'address' => '1 Fictional Studio Lane', 'city_code' => 'berlin', 'deposit_percent' => '30', 'specialty_ids' => [(string) $this->service->specialty_id]];
        $this->patch('/stylist/profile', $payload)->assertRedirect();
        $this->admitAccountFixture();
        $this->assertSame('berlin', $this->profile->fresh()->city_code);
        $this->patch('/stylist/profile', array_replace($payload, ['city_code' => 'lisbon', 'display_name' => 'Must not persist', 'deposit_percent' => '100']))->assertStatus(422)->assertSee('Booking #');
        $this->admitAccountFixture();
        $this->assertSame('berlin', $this->profile->fresh()->city_code);
        $this->assertSame('Mira Fictional', $this->profile->fresh()->display_name);
        $this->assertSame(30, $this->profile->fresh()->deposit_percent);
    }

    /** @return void */
    public function test_time_off_touching_endpoints_removal_pagination_capacity_and_ownership(): void
    {
        $date = CarbonImmutable::now('Europe/Paris')->addDays(3)->toDateString();
        $this->booking($date.' 10:00');
        $this->post('/stylist/time-off', ['_actor_context' => $this->actorContext, 'starts_local' => $date.' 11:00', 'ends_local' => $date.' 12:00'])->assertRedirect();
        $this->admitAccountFixture();
        $interval = $this->profile->timeOff()->sole();
        $owner = User::query()->create(['name' => 'Other Fictional', 'email' => 'other@strand-city.example', 'password' => $this->accountPassword, 'role' => AccountRole::Stylist]);
        $other = $owner->profile()->create(['display_name' => 'Other Fictional', 'city_code' => 'paris', 'timezone' => 'Europe/Paris', 'status' => ProfileStatus::Draft]);
        $foreign = $other->timeOff()->create(['starts_at' => CarbonImmutable::now()->addDays(5), 'ends_at' => CarbonImmutable::now()->addDays(6)]);
        $this->delete('/stylist/time-off/'.$foreign->id, ['_actor_context' => $this->actorContext])->assertNotFound();
        $this->delete('/stylist/time-off/'.$interval->id, ['_actor_context' => $this->actorContext])->assertRedirect();
        $this->admitAccountFixture();
        for ($index = 0; $index < 39; $index++) {
            $this->profile->timeOff()->create(['starts_at' => CarbonImmutable::now()->addDays(10 + $index), 'ends_at' => CarbonImmutable::now()->addDays(11 + $index)]);
        }
        $this->get('/stylist/availability?page=2')->assertOk()->assertSee('39 saved')->assertViewHas('timeOff', fn ($timeOff): bool => count($timeOff->items()) === 12);
        $this->post('/stylist/time-off', ['_actor_context' => $this->actorContext, 'starts_local' => $date.' 12:00', 'ends_local' => $date.' 13:00'])->assertStatus(429);
        $this->admitAccountFixture();
        $this->assertSame(40, TimeOff::query()->count());
    }

    /** @return void */
    public function test_public_service_navigation_and_shape_failures_have_real_destinations(): void
    {
        $this->get('/stylist/setup')->assertOk()->assertSee(route('stylist.availability.edit'));
        $this->get('/stylists/'.$this->profile->id)->assertOk()->assertSee(route('bookings.create', ['service' => $this->service->id]));
        $response = $this->get('/bookings/create?service='.$this->service->id.'&date='.CarbonImmutable::now('Europe/Paris')->addDays(3)->toDateString())->assertOk()->assertSee('Europe/Paris')->assertSee('Find times')->assertSee('#times');
        $this->assertGreaterThan(0, $response->viewData('slots')->count());
        $this->get('/bookings/create?service[]=1')->assertStatus(422);
        $this->get('/bookings/create?service='.$this->service->id.'&date=2026-02-30')->assertStatus(422);
        $this->patch('/stylist/availability', $this->weeklyPayload(opensAt: '09:07'))->assertStatus(422);
        $this->patch('/stylist/availability', $this->weeklyPayload(opensAt: '18:00', closesAt: '09:00'))->assertStatus(422);
        $missingTime = $this->weeklyPayload();
        unset($missingTime['days'][0]['opens_at']);
        $this->patch('/stylist/availability', $missingTime)->assertStatus(422);
        $this->patch('/stylist/availability', array_replace($this->weeklyPayload(), ['page' => ['invalid']]))->assertStatus(422);
        $this->post('/stylist/time-off', ['_actor_context' => $this->actorContext, 'starts_local' => '2027-03-28 02:30', 'ends_local' => '2027-03-28 04:30'])->assertStatus(422);
        $this->post('/stylist/time-off', ['_actor_context' => $this->actorContext, 'starts_local' => '2026-11-02 10:00', 'ends_local' => '2026-11-02 09:00'])->assertStatus(422);
        $this->admitAccountFixture();
        $this->assertSame(0, $this->profile->timeOff()->count());
    }

    /** @return void */
    public function test_active_hold_is_protected_and_past_completed_history_is_not(): void
    {
        $now = CarbonImmutable::now('UTC');
        $date = $now->setTimezone('Europe/Paris')->addDays(3)->toDateString();
        $hold = $this->booking($date.' 10:00', BookingStatus::AwaitingDeposit, $now->addMinutes(30));
        $this->booking($now->setTimezone('Europe/Paris')->subDays(3)->toDateString().' 10:00', BookingStatus::Completed);
        $this->patch('/stylist/availability', $this->weeklyPayload(closesAt: '10:00'))->assertStatus(422);
        $this->admitAccountFixture();
        $hold->update(['status' => BookingStatus::Expired]);
        $this->patch('/stylist/availability', $this->weeklyPayload(closesAt: '10:00'))->assertRedirect();
        $this->admitAccountFixture();
        $this->assertSame(7, $this->profile->workingHours()->where('closes_at', '10:00')->count());
    }

    /** @return void */
    public function test_direct_schedule_domain_rejects_duplicate_days_and_unauthorized_actor(): void
    {
        $schedule = new WeeklySchedule(intervals: collect([new WeeklyInterval(weekday: 1, opensAt: '09:00', closesAt: '18:00'), new WeeklyInterval(weekday: 1, opensAt: '09:00', closesAt: '18:00')]));
        try {
            $this->availability->saveWeekly($this->profile->user, $schedule);
            $this->fail('Duplicate weekdays were accepted.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('weekly_hours', $exception->errors());
        }
        $client = User::query()->where('role', AccountRole::Client)->sole();
        $this->expectException(HttpException::class);
        $this->availability->addTimeOff($client, new TimeOffInput(startsLocal: '2026-11-02 09:00', endsLocal: '2026-11-02 10:00'));
    }
}
