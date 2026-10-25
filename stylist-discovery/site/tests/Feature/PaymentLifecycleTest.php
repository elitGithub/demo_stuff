<?php

namespace Tests\Feature;

use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Enums\CheckoutOutcome;
use App\Enums\InboxEvent;
use App\Enums\PaymentKind;
use App\Models\Booking;
use App\Models\InboxMessage;
use App\Models\Payment;
use App\Models\User;
use App\Services\PaymentService;
use Closure;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\BuildsBookingRuntime;
use Tests\Support\ConcurrentProcesses;
use Tests\TestCase;

class PaymentLifecycleTest extends TestCase
{
    use BuildsBookingRuntime;

    /** @return void */
    protected function setUp(): void
    {
        parent::setUp();
        $this->buildBookingRuntime();
    }

    /** @return void */
    public function test_success_failure_and_cancelled_checkout(): void
    {
        $booking = $this->held();
        $deadline = $booking->deposit_deadline;
        $checkout = $this->get(route('checkout.show', $booking->id))->assertOk()->assertSee('Simulate successful deposit')->assertSee('Try a failed payment')->assertSee('Leave checkout')->assertDontSee('name="card', false);
        $context = $this->formContext($checkout);
        $this->post(route('checkout.store', $booking->id), ['_actor_context' => $context, 'outcome' => 'failed'])->assertRedirect(route('checkout.show', $booking->id).'#save-result');
        $this->get(route('checkout.show', $booking->id))->assertSee('original hold deadline is unchanged');
        $this->get(route('bookings.show', $booking->id))->assertOk();
        $this->admitAccountFixture();
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(BookingStatus::AwaitingDeposit, $booking->refresh()->status);
        $this->assertTrue($deadline->equalTo($booking->deposit_deadline));
        $this->service->update(['price_cents' => 9000, 'duration_minutes' => 120]);
        foreach (range(1, 2) as $attempt) {
            $this->post(route('checkout.store', $booking->id), ['_actor_context' => $context, 'outcome' => 'succeeded'])->assertRedirect(route('bookings.show', $booking->id).'#save-result');
        }
        $this->get(route('bookings.show', $booking->id))->assertOk()->assertSee('It’s in the diary.')->assertSee('€14.99')->assertSee('View your confirmation');
        $this->admitAccountFixture();
        $this->assertSame(BookingStatus::Confirmed, $booking->refresh()->status);
        $this->assertSame(500, $booking->payments()->where('kind', PaymentKind::Deposit)->sole()->amount_cents);
        $this->assertSame(1, Payment::query()->count());
        $this->assertSame(2, InboxMessage::query()->where('event', InboxEvent::DepositPaid)->count());
        $this->post(route('checkout.store', $booking->id), ['_actor_context' => $context, 'outcome' => 'succeeded', 'client_id' => $this->client->id])->assertStatus(422);
        $this->post(route('checkout.store', $booking->id), ['_actor_context' => $context, 'outcome' => 'real'])->assertStatus(422);
        $this->post(route('checkout.store', $booking->id), ['_actor_context' => 'stale', 'outcome' => 'succeeded'])->assertStatus(409)->assertSee('Your session changed');
        $this->post('/demo/role', ['_actor_context' => $context, 'role' => 'admin'])->assertRedirect();
        $this->withCookie('strand_city_session', session()->getId());
        $this->post(route('checkout.store', $booking->id), ['_actor_context' => $this->formContext($this->get('/account')), 'outcome' => 'succeeded'])->assertNotFound();
        $this->admitAccountFixture();
        $this->assertConflict(fn () => app(PaymentService::class)->checkout(User::query()->where('role', AccountRole::Admin)->sole(), $booking, CheckoutOutcome::Succeeded, $this->now), 403);
    }

    /** @return void */
    public function test_late_payment_never_resurrects_and_http_commits_expiry(): void
    {
        $booking = $this->held();
        $context = $this->formContext($this->get(route('checkout.show', $booking->id)));
        $this->travelTo($booking->deposit_deadline);
        $this->post(route('checkout.store', $booking->id), ['_actor_context' => $context, 'outcome' => 'succeeded'])->assertStatus(409)->assertSee('hold has expired')->assertDontSee('Your session changed');
        $this->admitAccountFixture();
        $this->assertSame(BookingStatus::Expired, $booking->refresh()->status);
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(2, InboxMessage::query()->where('event', InboxEvent::BookingExpired)->count());
        $this->assertSame(0, $booking->notification_budget);
        $this->post(route('checkout.store', $booking->id), ['_actor_context' => $context, 'outcome' => 'failed'])->assertStatus(409);
        $this->admitAccountFixture();
        $this->assertSame(2, InboxMessage::query()->where('event', InboxEvent::BookingExpired)->count());
        $this->travelBack();
    }

    /** @return void */
    public function test_cancel_refunds_exactly_once_and_reserved_messages_survive_admission_exhaustion(): void
    {
        $booking = $this->held();
        app(PaymentService::class)->checkout($this->client, $booking, CheckoutOutcome::Succeeded, $this->now);
        for ($index = 0; $index < 992; $index++) {
            InboxMessage::query()->create(['recipient_id' => $this->client->id, 'booking_id' => $booking->id, 'event' => InboxEvent::RequestReceived, 'event_key' => 'capacity-'.$index, 'subject' => 'Fictional update', 'body' => 'A capacity fixture.']);
        }
        $this->assertSame(1000, InboxMessage::query()->count() + Booking::query()->sum('notification_budget'));
        $this->assertConflict(fn () => $this->bookings->request($this->client, $this->input('12:00'), $this->now), 429);
        $this->bookings->cancel($this->client, $booking, '<b>Plans changed</b>', $this->now);
        $this->bookings->cancel($this->stylist, $booking, 'retry', $this->now->addMinute());
        $this->assertSame(BookingStatus::Cancelled, $booking->fresh()->status);
        $this->assertSame(1, $booking->payments()->where('kind', PaymentKind::Refund)->count());
        $this->assertSame(500, $booking->payments()->where('kind', PaymentKind::Refund)->sole()->amount_cents);
        $this->assertSame(0, Booking::query()->occupying($this->now)->count());
        $this->assertSame(2, InboxMessage::query()->where('event', InboxEvent::BookingCancelled)->count());
        $this->assertSame(2, InboxMessage::query()->where('event', InboxEvent::DepositRefunded)->count());
        $this->assertSame(1000, InboxMessage::query()->count());
        $this->assertSame(0, $booking->refresh()->notification_budget);
        $this->assertConflict(fn () => app(PaymentService::class)->checkout($this->client, $booking, CheckoutOutcome::Succeeded, $this->now));
        $this->get(route('bookings.show', $booking->id))->assertOk()->assertSee('full €5.00 simulated deposit has been refunded')->assertSee('&lt;b&gt;Plans changed&lt;/b&gt;', false);
    }

    /** @return void */
    public function test_cancellation_and_completion_role_and_exact_time_boundaries(): void
    {
        $requested = $this->bookings->request($this->client, $this->input(), $this->now);
        $this->assertConflict(fn () => $this->bookings->cancel($this->stylist, $requested, null, $this->now));
        $this->bookings->cancel($this->client, $requested, null, $this->now);
        $this->assertSame(0, $requested->payments()->count());
        $booking = $this->held('12:00');
        app(PaymentService::class)->checkout($this->client, $booking, CheckoutOutcome::Succeeded, $this->now);
        $this->assertConflict(fn () => $this->bookings->cancel($this->client, $booking, null, $booking->starts_at));
        $this->assertConflict(fn () => $this->bookings->complete($this->client, $booking, $booking->ends_at), 403);
        $this->assertConflict(fn () => $this->bookings->complete($this->stylist, $booking, $booking->ends_at->subSecond()));
        $this->assertSame(BookingStatus::Completed, $this->bookings->complete($this->stylist, $booking, $booking->ends_at)->status);
        $this->assertSame(0, $booking->refresh()->notification_budget);
        $this->assertSame(CheckoutOutcome::Succeeded, app(PaymentService::class)->checkout($this->client, $booking, CheckoutOutcome::Succeeded, $booking->ends_at)->outcome);
        $this->assertSame(1, $booking->payments()->count());
    }

    /** @return void */
    public function test_schedule_recheck_and_message_failure_leave_payment_and_state_atomic(): void
    {
        $booking = $this->held();
        $this->profile->timeOff()->create(['starts_at' => $booking->starts_at, 'ends_at' => $booking->ends_at]);
        foreach (CheckoutOutcome::cases() as $outcome) {
            $this->assertConflict(fn () => app(PaymentService::class)->checkout($this->client, $booking, $outcome, $this->now));
        }
        $this->assertSame(0, Payment::query()->count());
        $this->profile->timeOff()->delete();
        DB::connection('visitor')->statement("CREATE TRIGGER payment_message_failure BEFORE INSERT ON inbox_messages WHEN NEW.event = 'deposit_paid' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
        try {
            app(PaymentService::class)->checkout($this->client, $booking, CheckoutOutcome::Succeeded, $this->now);
            $this->fail('Message failure was ignored');
        } catch (QueryException) {
            $this->assertSame(BookingStatus::AwaitingDeposit, $booking->refresh()->status);
            $this->assertSame(0, Payment::query()->count());
        }
        DB::connection('visitor')->statement('DROP TRIGGER payment_message_failure');
        app(PaymentService::class)->checkout($this->client, $booking, CheckoutOutcome::Succeeded, $this->now);
        DB::connection('visitor')->statement("CREATE TRIGGER refund_message_failure BEFORE INSERT ON inbox_messages WHEN NEW.event = 'deposit_refunded' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
        try {
            $this->bookings->cancel($this->client, $booking, null, $this->now);
            $this->fail('Refund message failure was ignored');
        } catch (QueryException) {
            $this->assertSame(BookingStatus::Confirmed, $booking->refresh()->status);
            $this->assertSame(0, Payment::query()->where('kind', PaymentKind::Refund)->count());
            $this->assertSame(0, InboxMessage::query()->whereIn('event', [InboxEvent::BookingCancelled, InboxEvent::DepositRefunded])->count());
        }
    }

    /** @return void */
    public function test_checkout_reloads_profile_timezone_after_its_write_lock(): void
    {
        $booking = $this->held('09:00');
        $booking->load('profile');
        $this->profile->update(['timezone' => 'Europe/Lisbon']);
        foreach (CheckoutOutcome::cases() as $outcome) {
            $this->assertConflict(fn () => app(PaymentService::class)->checkout($this->client, $booking, $outcome, $this->now));
        }
        $this->assertSame(BookingStatus::AwaitingDeposit, $booking->refresh()->status);
        $this->assertSame(0, $booking->payments()->count());
    }

    /** @return void */
    public function test_real_process_checkout_expiry_and_cancellation_races(): void
    {
        foreach (['expiry', 'cancellation', 'two-cancellations'] as $index => $scenario) {
            $booking = $this->held(['10:00', '12:00', '14:00'][$index]);
            if ($scenario === 'two-cancellations') {
                app(PaymentService::class)->checkout($this->client, $booking, CheckoutOutcome::Succeeded, $this->now);
            }
            $actions = $scenario === 'expiry' ? ['checkout', 'expire'] : ($scenario === 'cancellation' ? ['checkout', 'cancel'] : ['cancel', 'cancel']);
            $arguments = collect($actions)->map(fn (string $action, int $worker): string => json_encode(['root' => $this->fixtureDirectory, 'database' => config('database.connections.visitor.database'), 'booking' => $booking->id, 'actor' => $this->client->id, 'now' => ($scenario === 'expiry' ? ($action === 'checkout' ? $booking->deposit_deadline->subSecond() : $booking->deposit_deadline) : $this->now)->toIso8601String(), 'action' => $action, 'barrier' => 'payment-go-'.$index, 'signal' => 'payment-ready-'.$index.'-'.$worker], JSON_THROW_ON_ERROR));
            DB::purge('visitor');
            $workers = ConcurrentProcesses::run(base_path('tests/Support/booking-worker.php'), $arguments);
            try {
                $this->awaitSignal('payment-ready-'.$index.'-0');
                $this->awaitSignal('payment-ready-'.$index.'-1');
                file_put_contents($this->fixtureDirectory.'/payment-go-'.$index, 'go');
                $statuses = collect();
                foreach ($workers as $worker) {
                    $worker->wait();
                    $this->assertSame(0, $worker->getExitCode(), $worker->getErrorOutput());
                    $status = json_decode($worker->getOutput(), true, flags: JSON_THROW_ON_ERROR)['status'];
                    $this->assertContains($status, [200, 409, 503]);
                    $statuses->push($status);
                }
                $this->assertTrue($statuses->contains(200));
            } finally {
                foreach ($workers as $worker) {
                    if ($worker->isRunning()) {
                        $worker->stop();
                    }
                }
            }
            $this->admitAccountFixture();
            if ($scenario === 'expiry') {
                $this->bookings->expireFor($this->profile, $booking->deposit_deadline);
                $this->assertContains($booking->refresh()->status, [BookingStatus::Expired, BookingStatus::Confirmed]);
                $captured = $booking->status === BookingStatus::Confirmed ? 1 : 0;
                $this->assertSame($captured, $booking->payments()->count());
                $this->assertSame($captured * 2, $booking->messages()->where('event', InboxEvent::DepositPaid)->count());
                $this->assertSame((1 - $captured) * 2, $booking->messages()->where('event', InboxEvent::BookingExpired)->count());
            } else {
                $this->bookings->cancel($this->client, $booking, null, $this->now);
                $this->assertSame(BookingStatus::Cancelled, $booking->refresh()->status);
                $deposits = $booking->payments()->where('kind', PaymentKind::Deposit)->count();
                $this->assertSame($deposits, $booking->payments()->where('kind', PaymentKind::Refund)->count());
                $this->assertSame($deposits * 2, $booking->messages()->where('event', InboxEvent::DepositPaid)->count());
                $this->assertSame($deposits * 2, $booking->messages()->where('event', InboxEvent::DepositRefunded)->count());
                $this->assertSame(2, $booking->messages()->where('event', InboxEvent::BookingCancelled)->count());
            }
        }
    }

    /** @param string $time
     * @return Booking */
    protected function held(string $time = '10:00'): Booking
    {
        return $this->bookings->accept($this->stylist, $this->bookings->request($this->client, $this->input($time), $this->now), $this->now);
    }

    /** @param Closure $operation
     * @param int $status
     * @return void */
    protected function assertConflict(Closure $operation, int $status = 409): void
    {
        try {
            $operation();
            $this->fail('Invalid transition accepted');
        } catch (HttpException $exception) {
            $this->assertSame($status, $exception->getStatusCode());
        } catch (AuthorizationException $exception) {
            $this->assertSame(403, $status);
        }
    }
}
