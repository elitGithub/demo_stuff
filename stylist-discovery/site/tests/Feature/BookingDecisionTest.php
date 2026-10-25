<?php

namespace Tests\Feature;

use App\Data\BookingInput;
use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Enums\InboxEvent;
use App\Enums\ProfileStatus;
use App\Models\Booking;
use App\Models\InboxMessage;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\BuildsBookingRuntime;
use Tests\Support\ConcurrentProcesses;
use Tests\TestCase;

class BookingDecisionTest extends TestCase
{
    use BuildsBookingRuntime;

    /** @return void */
    protected function setUp(): void
    {
        parent::setUp();
        $this->buildBookingRuntime();
    }

    /** @return void */
    public function test_amount_rounding_full_deposit_and_immutable_retry(): void
    {
        $input = $this->input(note: '<script>alert(1)</script>');
        $booking = $this->bookings->request($this->client, $input, $this->now);
        $this->assertSame(500, $booking->deposit_cents);
        $this->assertSame(1499, $booking->remaining_cents);
        $this->assertSame(7, $booking->notification_budget);
        $this->service->update(['price_cents' => 7000, 'duration_minutes' => 120]);
        $this->profile->update(['deposit_percent' => 100, 'timezone' => 'Europe/Lisbon']);
        $retry = $this->bookings->request($this->client, $input, $this->now->addDays(100));
        $this->assertSame($booking->id, $retry->id);
        $this->assertSame(1999, $retry->price_cents);
        $this->assertSame('Europe/Paris', $retry->timezone);
        $this->assertSame(60, $retry->duration_minutes);
        $this->profile->update(['timezone' => 'Europe/Paris']);
        $accepted = $this->bookings->accept($this->stylist, $booking, $this->now);
        $this->assertSame(500, $accepted->deposit_cents);
        $this->assertSame(60, $accepted->duration_minutes);
        $this->get('/bookings/'.$booking->id)->assertOk()->assertSee('&lt;script&gt;alert(1)&lt;/script&gt;', false)->assertDontSee('<script>alert(1)</script>', false);
        $this->admitAccountFixture();
        $this->service->update(['price_cents' => 1999, 'duration_minutes' => 60]);
        $full = $this->bookings->request($this->client, $this->input('12:00'), $this->now);
        $this->assertSame(1999, $full->deposit_cents);
        $this->assertSame(0, $full->remaining_cents);
    }

    /** @return void */
    public function test_reused_key_and_second_identical_active_request_conflict(): void
    {
        $input = $this->input();
        $this->bookings->request($this->client, $input, $this->now);
        foreach ([new BookingInput(serviceId: $input->serviceId, startsLocal: $input->startsLocal, requestKey: $input->requestKey, note: 'different'), $this->input()] as $duplicate) {
            try {
                $this->bookings->request($this->client, $duplicate, $this->now);
                $this->fail('Duplicate accepted');
            } catch (HttpException $exception) {
                $this->assertSame(409, $exception->getStatusCode());
            }
        }
        $this->assertSame(1, Booking::query()->count());
    }

    /** @return void */
    public function test_shortened_deadline_idempotence_and_exact_expiry_boundary(): void
    {
        $booking = $this->bookings->request($this->client, $this->input(), $this->now);
        $acceptedAt = $booking->starts_at->subMinutes(12);
        $accepted = $this->bookings->accept($this->stylist, $booking, $acceptedAt);
        $this->assertTrue($accepted->deposit_deadline->equalTo($booking->starts_at));
        $retry = $this->bookings->accept($this->stylist, $booking, $acceptedAt->addMinute());
        $this->assertTrue($retry->deposit_deadline->equalTo($accepted->deposit_deadline));
        $this->assertSame(1, InboxMessage::query()->where('event', InboxEvent::RequestAccepted)->count());
        $this->assertSame(BookingStatus::Expired, $booking->effectiveStatus($booking->starts_at));
        $this->assertSame(1, $this->bookings->expireFor($this->profile, $booking->starts_at));
        $this->assertSame(0, $this->bookings->expireFor($this->profile, $booking->starts_at));
        $this->assertSame(2, InboxMessage::query()->where('event', InboxEvent::BookingExpired)->count());
        $this->assertSame(0, $booking->refresh()->notification_budget);
    }

    /** @return void */
    public function test_two_clients_can_request_and_adjacent_intervals_can_both_be_accepted(): void
    {
        $first = $this->bookings->request($this->client, $this->input(), $this->now);
        $other = User::query()->create(['name' => 'Second Fictional', 'email' => 'other@strand-city.example', 'password' => 'fictional-password-123', 'role' => AccountRole::Client]);
        $second = $this->bookings->request($other, $this->input(), $this->now);
        $this->assertSame(2, Booking::query()->where('status', BookingStatus::Requested)->count());
        $this->bookings->accept($this->stylist, $first, $this->now);
        try {
            $this->bookings->accept($this->stylist, $second, $this->now);
            $this->fail('Overlap accepted');
        } catch (HttpException $exception) {
            $this->assertSame(409, $exception->getStatusCode());
        }
        $adjacent = $this->bookings->request($other, $this->input('11:00'), $this->now);
        $this->bookings->accept($this->stylist, $adjacent, $this->now);
        $this->assertSame(2, Booking::query()->where('status', BookingStatus::AwaitingDeposit)->count());
    }

    /** @return void */
    public function test_message_insert_failure_rolls_back_acceptance(): void
    {
        $booking = $this->bookings->request($this->client, $this->input(), $this->now);
        DB::connection('visitor')->statement("CREATE TRIGGER test_inbox_failure BEFORE INSERT ON inbox_messages BEGIN SELECT RAISE(ABORT, 'test failure'); END");
        try {
            $this->bookings->accept($this->stylist, $booking, $this->now);
            $this->fail('Injected message failure ignored');
        } catch (QueryException) {
            $this->assertSame(BookingStatus::Requested, $booking->refresh()->status);
        }
        $this->assertSame(7, $booking->notification_budget);
        $this->assertNull($booking->deposit_deadline);
    }

    /** @return void */
    public function test_safe_contextual_handoff_stays_on_same_booking_and_rejects_foreign_access(): void
    {
        $input = $this->input();
        $this->get('/bookings/create?service='.$this->service->id.'&date='.substr($input->startsLocal, 0, 10))->assertOk()->assertSee(route('bookings.review', ['service' => $this->service->id, 'starts_local' => $input->startsLocal]));
        $review = $this->get('/bookings/review?'.http_build_query(['service' => $this->service->id, 'starts_local' => $input->startsLocal]))->assertOk()->assertSee('Send booking request');
        $this->post('/bookings', ['_actor_context' => $this->formContext($review), 'service' => $this->service->id, 'starts_local' => $input->startsLocal, 'request_key' => $input->requestKey, 'note' => '<b>hello</b>'])->assertRedirect();
        $this->admitAccountFixture();
        $booking = Booking::query()->sole();
        $detail = $this->get('/bookings/'.$booking->id)->assertOk()->assertSee('Review as the stylist')->assertSee('&lt;b&gt;hello&lt;/b&gt;', false);
        $this->post('/bookings/'.$booking->id.'/perspective', ['_actor_context' => $this->formContext($detail), 'user_id' => $this->stylist->id])->assertStatus(422);
        $this->post('/bookings/'.$booking->id.'/perspective', ['_actor_context' => $this->formContext($detail)])->assertRedirect('/bookings/'.$booking->id);
        $this->withCookie('strand_city_session', session()->getId());
        $stylistView = $this->get('/bookings/'.$booking->id)->assertOk()->assertSee('Accept request');
        $this->post('/bookings/'.$booking->id.'/accept', ['_actor_context' => $this->formContext($stylistView)])->assertRedirect();
        $accepted = $this->get('/bookings/'.$booking->id)->assertOk()->assertSee('Continue as the client');
        $this->post('/bookings/'.$booking->id.'/perspective', ['_actor_context' => $this->formContext($accepted)])->assertRedirect('/bookings/'.$booking->id);
        $this->withCookie('strand_city_session', session()->getId());
        $this->get('/bookings/'.$booking->id)->assertOk()->assertSee('One step from confirmed.');
        $this->admitAccountFixture();
        $foreign = User::query()->create(['name' => 'Foreign Fictional', 'email' => 'foreign@strand-city.example', 'password' => 'fictional-password-123', 'role' => AccountRole::Client]);
        $foreignBooking = $this->bookings->request($foreign, $this->input('12:00'), $this->now);
        $this->get('/bookings/'.$foreignBooking->id)->assertNotFound();
        $this->post('/bookings/'.$foreignBooking->id.'/perspective', ['_actor_context' => $this->formContext($this->get('/account'))])->assertNotFound();
        $this->post('/demo/role', ['_actor_context' => $this->formContext($this->get('/account')), 'role' => 'admin'])->assertRedirect();
        $this->withCookie('strand_city_session', session()->getId());
        $this->post('/bookings/'.$booking->id.'/accept', ['_actor_context' => $this->formContext($this->get('/account'))])->assertNotFound();
    }

    /** @return void */
    public function test_only_one_overlapping_request_can_be_accepted(): void
    {
        $first = $this->bookings->request($this->client, $this->input(), $this->now);
        $other = User::query()->create(['name' => 'Other Fictional', 'email' => 'parallel@strand-city.example', 'password' => 'fictional-password-123', 'role' => AccountRole::Client]);
        $second = $this->bookings->request($other, $this->input(), $this->now);
        $arguments = collect([$first, $second])->map(fn (Booking $booking, int $index): string => json_encode(['root' => $this->fixtureDirectory, 'database' => config('database.connections.visitor.database'), 'booking' => $booking->id, 'actor' => $this->stylist->id, 'now' => $this->now->toIso8601String(), 'signal' => 'booking-ready-'.$index], JSON_THROW_ON_ERROR));
        DB::purge('visitor');
        $workers = ConcurrentProcesses::run(base_path('tests/Support/booking-worker.php'), $arguments);
        try {
            $this->awaitSignal('booking-ready-0');
            $this->awaitSignal('booking-ready-1');
            file_put_contents($this->fixtureDirectory.'/booking-go', 'go');
            $statuses = $workers->map(function ($worker): int {
                $worker->wait();
                $this->assertSame(0, $worker->getExitCode(), $worker->getErrorOutput());

                return json_decode($worker->getOutput(), true, flags: JSON_THROW_ON_ERROR)['status'];
            });
            $this->assertTrue($statuses->contains(200));
            $this->assertTrue($statuses->contains(409) || $statuses->contains(503));
        } finally {
            foreach ($workers as $worker) {
                if ($worker->isRunning()) {
                    $worker->stop();
                }
            }
        }
        $this->admitAccountFixture();
        $this->assertSame(1, Booking::query()->where('status', BookingStatus::AwaitingDeposit)->count());
        $this->assertSame(1, InboxMessage::query()->where('event', InboxEvent::RequestAccepted)->count());
        $loser = Booking::query()->where('status', BookingStatus::Requested)->sole();
        try {
            $this->bookings->accept($this->stylist, $loser, $this->now);
            $this->fail('Losing acceptance retry succeeded.');
        } catch (HttpException $exception) {
            $this->assertSame(409, $exception->getStatusCode());
        }
    }

    /** @return void */
    public function test_foreign_stylist_cannot_view_decide_or_handoff_a_booking(): void
    {
        $other = User::query()->create(['name' => 'Other Stylist', 'email' => 'stylist-other@strand-city.example', 'password' => 'fictional-password-123', 'role' => AccountRole::Stylist]);
        $profile = $other->profile()->create(['display_name' => 'Other Stylist', 'city_code' => 'paris', 'timezone' => 'Europe/Paris', 'status' => ProfileStatus::Published, 'deposit_percent' => 25]);
        $profile->specialties()->attach($this->service->specialty_id);
        $service = $profile->services()->create(['specialty_id' => $this->service->specialty_id, 'name' => 'Other cut', 'price_cents' => 1999, 'duration_minutes' => 60, 'active' => true]);
        foreach (range(0, 6) as $weekday) {
            $profile->workingHours()->create(['weekday' => $weekday, 'opens_at' => '09:00', 'closes_at' => '18:00']);
        }
        $input = new BookingInput(serviceId: $service->id, startsLocal: $this->input()->startsLocal, requestKey: (string) Str::uuid(), note: null);
        $booking = $this->bookings->request($this->client, $input, $this->now);
        $this->assertNull($this->bookings->handoffRole($this->client, $booking));
        $this->post('/demo/role', ['_actor_context' => $this->context, 'role' => 'stylist'])->assertRedirect();
        $this->withCookie('strand_city_session', session()->getId());
        $context = $this->formContext($this->get('/account'));
        $this->get('/bookings/'.$booking->id)->assertNotFound();
        $this->post('/bookings/'.$booking->id.'/accept', ['_actor_context' => $context])->assertNotFound();
        $this->post('/bookings/'.$booking->id.'/perspective', ['_actor_context' => $context])->assertNotFound();
    }

    /** @return void */
    public function test_acceptance_rechecks_service_profile_and_time_off_but_does_not_replace_prices(): void
    {
        $booking = $this->bookings->request($this->client, $this->input(), $this->now);
        $this->service->update(['active' => false]);
        try {
            $this->bookings->accept($this->stylist, $booking, $this->now);
            $this->fail('Inactive service accepted');
        } catch (HttpException $exception) {
            $this->assertSame(409, $exception->getStatusCode());
        }
        $this->service->update(['active' => true, 'price_cents' => 6000]);
        $this->profile->update(['status' => ProfileStatus::Suspended]);
        try {
            $this->bookings->accept($this->stylist, $booking, $this->now);
            $this->fail('Suspended profile accepted');
        } catch (HttpException $exception) {
            $this->assertSame(409, $exception->getStatusCode());
        }
        $this->profile->update(['status' => ProfileStatus::Published]);
        $this->profile->timeOff()->create(['starts_at' => $booking->starts_at, 'ends_at' => $booking->ends_at]);
        try {
            $this->bookings->accept($this->stylist, $booking, $this->now);
            $this->fail('Time off accepted');
        } catch (HttpException $exception) {
            $this->assertSame(409, $exception->getStatusCode());
        }
        $this->assertSame(1999, $booking->refresh()->price_cents);
        $this->assertSame(BookingStatus::Requested, $booking->status);
    }

    /** @return void */
    public function test_duplicate_reviews_show_real_conflict_recovery_and_preserve_expiry(): void
    {
        $input = $this->input();
        $url = route('bookings.review', ['service' => $this->service->id, 'starts_local' => $input->startsLocal]);
        $first = $this->get($url)->assertOk();
        $second = $this->get($url)->assertOk();
        $this->assertNotSame($first->viewData('requestKey'), $second->viewData('requestKey'));
        $this->assertSame(500, $first->viewData('deposit'));
        $this->post(route('bookings.store'), ['_actor_context' => $this->formContext($first), 'service' => $this->service->id, 'starts_local' => $input->startsLocal, 'request_key' => $first->viewData('requestKey')])->assertRedirect();
        $this->admitAccountFixture();
        $oldInput = new BookingInput(serviceId: $this->service->id, startsLocal: $this->now->setTimezone('Europe/Paris')->subDay()->toDateString().' 10:00', requestKey: (string) Str::uuid(), note: null);
        $active = Booking::query()->where('status', BookingStatus::Requested)->sole();
        $expired = $this->bookings->request($this->client, $oldInput, $this->now->subDays(2));
        $this->post(route('bookings.store'), ['_actor_context' => $this->formContext($second), 'service' => $this->service->id, 'starts_local' => $input->startsLocal, 'request_key' => $second->viewData('requestKey')])->assertStatus(409)->assertViewIs('bookings.conflict')->assertSee('You already have an active request')->assertSee('View your request')->assertSee(route('bookings.show', $active->id))->assertSee($this->now->setTimezone('Europe/Paris')->addDays(3)->format('l, d F').' · 10:00')->assertSee(route('discovery.index'))->assertDontSee('Your session changed');
        $this->admitAccountFixture();
        $this->assertSame(BookingStatus::Expired, $expired->refresh()->status);
        $this->assertSame(2, InboxMessage::query()->where('event', InboxEvent::BookingExpired)->count());
        $this->assertSame(1, Booking::query()->where('status', BookingStatus::Requested)->count());
        $this->bookings->accept($this->stylist, $active, $this->now);
        $this->post(route('bookings.store'), ['_actor_context' => $this->formContext($second), 'service' => $this->service->id, 'starts_local' => $input->startsLocal, 'request_key' => (string) Str::uuid()])->assertStatus(409)->assertSee(route('bookings.show', $active->id))->assertSee('View your request');
    }

    /** @return void */
    public function test_review_window_conflict_is_local_while_stale_actor_still_uses_session_response(): void
    {
        $outside = $this->now->setTimezone('Europe/Paris')->addDays(61)->toDateString().' 10:00';
        $this->get(route('bookings.review', ['service' => $this->service->id, 'starts_local' => $outside]))->assertStatus(409)->assertViewIs('bookings.conflict')->assertSee('outside the request window')->assertSee(route('discovery.index'))->assertDontSee('Your session changed');
        $input = $this->input();
        $this->post(route('bookings.store'), ['_actor_context' => 'stale-context', 'service' => $this->service->id, 'starts_local' => $input->startsLocal, 'request_key' => $input->requestKey])->assertStatus(409)->assertSee('Your session changed')->assertDontSee('This request needs another look.');
    }

    /** @return void */
    public function test_expired_inactive_and_suspended_appointments_offer_live_recovery_links(): void
    {
        $booking = $this->bookings->request($this->client, $this->input(), $this->now);
        $this->bookings->expireFor($this->profile, $booking->starts_at);
        $this->service->update(['active' => false]);
        $this->get(route('bookings.show', $booking->id))->assertOk()->assertSee('Find a new appointment')->assertSee(route('discovery.index'))->assertDontSee(route('bookings.create', ['service' => $this->service->id]), false);
        $this->get(route('bookings.create', ['service' => $this->service->id]))->assertNotFound();
        $this->admitAccountFixture();
        $this->profile->update(['status' => ProfileStatus::Suspended]);
        $this->get(route('bookings.show', $booking->id))->assertOk()->assertSee('Find a new appointment')->assertSee('Discover available stylists')->assertDontSee('View studio')->assertDontSee(route('stylists.show', $this->profile->id), false);
        $this->get(route('discovery.index'))->assertOk();
        $this->get(route('stylists.show', $this->profile->id))->assertNotFound();
    }
}
