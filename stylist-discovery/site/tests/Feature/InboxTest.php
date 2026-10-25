<?php

namespace Tests\Feature;

use App\Data\BookingInput;
use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Enums\InboxEvent;
use App\Models\Booking;
use App\Models\InboxMessage;
use App\Models\Registry\Sandbox;
use App\Services\InboxService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\BuildsBookingRuntime;
use Tests\TestCase;

class InboxTest extends TestCase
{
    use BuildsBookingRuntime;

    /** @return void */
    protected function setUp(): void
    {
        parent::setUp();
        $this->buildBookingRuntime();
    }

    /** @return void */
    public function test_recipient_isolation_read_counts_and_single_event_after_retry(): void
    {
        $booking = $this->bookings->request($this->client, $this->input(), $this->now);
        $received = InboxMessage::query()->sole();
        $this->get('/inbox')->assertOk()->assertSee('0 unread')->assertSee('0 messages')->assertDontSee('Request Received');
        $this->post('/inbox/'.$received->id.'/read', ['_actor_context' => $this->context])->assertNotFound();
        $this->admitAccountFixture();
        $this->bookings->accept($this->stylist, $booking, $this->now);
        $this->bookings->accept($this->stylist, $booking, $this->now->addMinute());
        $this->assertSame(2, InboxMessage::query()->count());
        $accepted = InboxMessage::query()->where('event', InboxEvent::RequestAccepted)->sole();
        $page = $this->get('/inbox')->assertOk()->assertSee('1 unread')->assertSee('1 message')->assertSee('Request Accepted')->assertDontSee('Request Received');
        $this->post('/inbox/'.$accepted->id.'/read', ['_actor_context' => $this->formContext($page), 'page' => []])->assertStatus(422);
        $this->post('/inbox/'.$accepted->id.'/read', ['_actor_context' => $this->formContext($page)])->assertRedirect();
        $this->get('/inbox')->assertOk()->assertSee('0 unread')->assertDontSee('Mark as read');
        $this->admitAccountFixture();
        $this->assertNotNull($accepted->refresh()->read_at);
        $this->post('/demo/role', ['_actor_context' => $this->formContext($this->get('/account')), 'role' => AccountRole::Admin->value])->assertRedirect();
        $this->withCookie('strand_city_session', session()->getId());
        $this->get('/inbox')->assertOk()->assertSee('0 messages');
        $this->post('/inbox/'.$accepted->id.'/read', ['_actor_context' => $this->formContext($this->get('/account'))])->assertNotFound();
    }

    /** @return void */
    public function test_reserved_capacity_can_complete_and_new_requests_cannot_consume_it(): void
    {
        $booking = $this->bookings->request($this->client, $this->input(), $this->now);
        for ($index = 0; $index < 992; $index++) {
            InboxMessage::query()->create(['recipient_id' => $this->client->id, 'booking_id' => $booking->id, 'event' => InboxEvent::RequestReceived, 'event_key' => 'capacity-'.$index, 'subject' => 'Fictional update', 'body' => 'A capacity fixture.']);
        }
        $this->assertSame(1000, InboxMessage::query()->count() + Booking::query()->sum('notification_budget'));
        try {
            $this->bookings->request($this->client, $this->input('12:00'), $this->now);
            $this->fail('Reservation was overcommitted');
        } catch (HttpException $exception) {
            $this->assertSame(429, $exception->getStatusCode());
        }
        $this->bookings->accept($this->stylist, $booking, $this->now);
        $this->assertSame(BookingStatus::AwaitingDeposit, $booking->refresh()->status);
        $this->assertSame(6, $booking->notification_budget);
        $this->assertSame(1, $this->bookings->expireFor($this->profile, $this->now->addMinutes(30)));
        $this->assertSame(996, InboxMessage::query()->count());
        $this->assertSame(0, $booking->refresh()->notification_budget);
        $page = $this->get('/inbox?page=2')->assertOk()->assertViewHas('messages', fn ($messages): bool => count($messages->items()) === 12);
        $message = $page->viewData('messages')->getCollection()->first();
        $this->post('/inbox/'.$message->id.'/read', ['_actor_context' => $this->formContext($page), 'page' => 2, 'appointments_page' => 1])->assertRedirect(route('inbox.index', ['page' => 2, 'appointments_page' => 1]).'#message-'.$message->id);
    }

    /** @return void */
    public function test_decline_and_requested_expiry_are_idempotent_and_release_budget(): void
    {
        $booking = $this->bookings->request($this->client, $this->input(), $this->now);
        $this->bookings->decline($this->stylist, $booking, '<b>Unavailable</b>', $this->now);
        $this->bookings->decline($this->stylist, $booking, 'retry', $this->now);
        $this->assertSame(0, $booking->refresh()->notification_budget);
        $this->assertSame(1, InboxMessage::query()->where('event', InboxEvent::RequestDeclined)->count());
        $pending = $this->bookings->request($this->client, $this->input('12:00'), $this->now);
        $this->assertSame(1, $this->bookings->expireFor($this->profile, $pending->starts_at));
        $this->assertSame(0, $this->bookings->expireFor($this->profile, $pending->starts_at));
        $this->assertSame(2, InboxMessage::query()->where('event', InboxEvent::BookingExpired)->count());
        $this->get('/bookings/'.$booking->id)->assertOk()->assertSee('&lt;b&gt;Unavailable&lt;/b&gt;', false);
    }

    /** @return void */
    public function test_expired_decision_returns_local_conflict_and_commits_expiry_notifications(): void
    {
        $this->travelTo($this->now->setTimezone('Europe/Paris')->setTime(8, 0));
        $this->now = CarbonImmutable::now('UTC');
        $this->admitAccountFixture();
        Sandbox::query()->update(['expires_at' => $this->now->addHours(4)]);
        $input = new BookingInput(serviceId: $this->service->id, startsLocal: $this->now->setTimezone('Europe/Paris')->format('Y-m-d').' 11:00', requestKey: (string) Str::uuid(), note: null);
        $booking = $this->bookings->request($this->client, $input, $this->now);
        $this->post('/demo/role', ['_actor_context' => $this->context, 'role' => 'stylist'])->assertRedirect();
        $this->withCookie('strand_city_session', session()->getId());
        $context = $this->formContext($this->get('/bookings/'.$booking->id));
        $this->travelTo($booking->starts_at);
        $this->post('/bookings/'.$booking->id.'/accept', ['_actor_context' => $context])->assertStatus(409)->assertSee('has expired');
        $this->admitAccountFixture();
        $this->assertSame(BookingStatus::Expired, $booking->refresh()->status);
        $this->assertSame(2, InboxMessage::query()->where('event', InboxEvent::BookingExpired)->count());
        $this->travelBack();
    }

    /** @return void */
    public function test_prefixed_event_retry_with_zero_budget_returns_original_without_consumption(): void
    {
        $booking = $this->bookings->request($this->client, $this->input(), $this->now);
        $message = InboxMessage::query()->sole();
        $this->assertSame('booking:'.$booking->id.':'.InboxEvent::RequestReceived->value, $message->event_key);
        $booking->update(['notification_budget' => 0]);
        $retry = app(InboxService::class)->record($booking, $this->stylist, InboxEvent::RequestReceived);
        $this->assertSame($message->id, $retry->id);
        $this->assertSame(1, InboxMessage::query()->count());
        $this->assertSame(0, $booking->refresh()->notification_budget);
    }

    /** @return void */
    public function test_inbox_reconciles_the_current_clients_related_expired_requests(): void
    {
        $input = new BookingInput(serviceId: $this->service->id, startsLocal: $this->now->setTimezone('Europe/Paris')->subDay()->toDateString().' 10:00', requestKey: (string) Str::uuid(), note: null);
        $booking = $this->bookings->request($this->client, $input, $this->now->subDays(2));
        $this->get('/inbox')->assertOk()->assertSee('Booking Expired')->assertSee('1 unread');
        $this->admitAccountFixture();
        $this->assertSame(BookingStatus::Expired, $booking->refresh()->status);
        $this->assertSame(2, InboxMessage::query()->where('event', InboxEvent::BookingExpired)->count());
    }
}
