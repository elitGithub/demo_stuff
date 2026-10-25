<?php

namespace Tests\Feature;

use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Enums\CheckoutOutcome;
use App\Enums\InboxEvent;
use App\Models\Booking;
use App\Models\InboxMessage;
use App\Models\User;
use App\Services\BookingService;
use App\Services\FixtureService;
use App\Services\InboxService;
use App\Services\PaymentService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use Tests\Support\BuildsBookingRuntime;
use Tests\TestCase;

class WorkspaceTest extends TestCase
{
    use BuildsBookingRuntime;

    /** @return void */
    public function test_counts_filters_pagination_and_active_first_order_agree(): void
    {
        $this->buildBookingRuntime();
        config(['demo.pagination' => 2]);
        $history = $this->bookings->request($this->client, $this->input('09:00'), $this->now);
        $this->bookings->decline($this->stylist, $history, null, $this->now);
        $requested = $this->bookings->request($this->client, $this->input('10:00'), $this->now);
        $held = $this->bookings->accept($this->stylist, $this->bookings->request($this->client, $this->input('11:00'), $this->now), $this->now);
        $confirmed = $this->bookings->accept($this->stylist, $this->bookings->request($this->client, $this->input('12:00'), $this->now), $this->now);
        app(PaymentService::class)->checkout($this->client, $confirmed, CheckoutOutcome::Succeeded, $this->now);
        $page = $this->get('/workspace')->assertOk()->assertSee('Filter diary');
        $this->assertSame(4, $page->viewData('counts')->sum());
        $this->assertSame(4, $page->viewData('appointments')->total());
        $this->assertSame([$requested->id, $held->id], $page->viewData('appointments')->getCollection()->modelKeys());
        $page->assertSee('€14.99')->assertDontSee('@else');
        $second = $this->get('/workspace?page=2')->assertOk();
        $this->assertSame([$confirmed->id, $history->id], $second->viewData('appointments')->getCollection()->modelKeys());
        $second->assertSee('No balance due')->assertDontSee('@else');
        $this->get('/workspace?status=awaiting_deposit')->assertOk()->assertViewHas('appointments', fn ($appointments): bool => $appointments->total() === 1 && $appointments->first()->id === $held->id)->assertSee('Deposit due')->assertSee('€14.99');
        $date = $held->starts_at->setTimezone($held->timezone)->toDateString();
        $this->get('/workspace?status=confirmed&date='.$date)->assertOk()->assertViewHas('appointments', fn ($appointments): bool => $appointments->total() === 1 && $appointments->first()->id === $confirmed->id);
        $this->get('/workspace?date='.$this->now->addDays(8)->toDateString())->assertOk()->assertViewHas('appointments', fn ($appointments): bool => $appointments->total() === 0);
        $this->get('/workspace?status=unknown')->assertStatus(422);
        $this->get('/workspace?date=2026-02-30')->assertStatus(422);
        $this->get('/workspace?page=10001')->assertStatus(422);
        $this->get('/workspace?client_id=1')->assertStatus(422);
    }

    /** @return void */
    public function test_workspace_reconciles_expiry_and_enforces_actor_and_role_boundaries(): void
    {
        $this->buildBookingRuntime();
        $held = $this->bookings->accept($this->stylist, $this->bookings->request($this->client, $this->input(), $this->now), $this->now);
        $other = User::query()->create(['name' => 'Private Client', 'email' => 'private@strand-city.example', 'password' => 'fictional-password-123', 'role' => AccountRole::Client]);
        $foreign = $this->bookings->request($other, $this->input('12:00'), $this->now);
        $this->travelTo($held->deposit_deadline);
        $page = $this->get('/workspace?status=expired')->assertOk()->assertSee('Expired')->assertSee('No balance due');
        $this->assertSame(1, $page->viewData('counts')->sum());
        $this->assertSame(1, $page->viewData('counts')->get(BookingStatus::Expired->value));
        $this->assertSame([$held->id], $page->viewData('appointments')->getCollection()->modelKeys());
        $this->get('/bookings/'.$foreign->id)->assertNotFound();
        $this->post('/demo/role', ['_actor_context' => $this->formContext($page), 'role' => 'stylist'])->assertRedirect('/workspace');
        $this->withCookie('strand_city_session', session()->getId());
        $stylist = $this->get('/workspace')->assertOk()->assertSee('A considered')->assertSee('Review request');
        $this->assertSame(2, $stylist->viewData('appointments')->total());
        $this->post('/demo/role', ['_actor_context' => $this->formContext($stylist), 'role' => 'admin'])->assertRedirect('/admin');
        $this->withCookie('strand_city_session', session()->getId());
        $this->get('/workspace')->assertForbidden();
        $this->get('/inbox')->assertOk()->assertSee('0 messages');
        $this->travelBack();
    }

    /** @return void */
    public function test_connected_request_accept_failure_retry_confirmation_inbox_and_cancellation(): void
    {
        $this->buildBookingRuntime();
        $input = $this->input();
        $review = $this->get(route('bookings.review', ['service' => $input->serviceId, 'starts_local' => $input->startsLocal]))->assertOk();
        $this->post(route('bookings.store'), ['_actor_context' => $this->formContext($review), 'service' => $input->serviceId, 'starts_local' => $input->startsLocal, 'request_key' => $review->viewData('requestKey')])->assertRedirect();
        $this->admitAccountFixture();
        $booking = Booking::query()->sole();
        $detail = $this->get(route('bookings.show', $booking->id))->assertOk()->assertSee('Review as the stylist');
        $this->post(route('bookings.handoff', $booking->id), ['_actor_context' => $this->formContext($detail)])->assertRedirect(route('bookings.show', $booking->id));
        $this->withCookie('strand_city_session', session()->getId());
        $stylist = $this->get(route('bookings.show', $booking->id))->assertOk()->assertSee('Accept request');
        $this->post(route('bookings.accept', $booking->id), ['_actor_context' => $this->formContext($stylist)])->assertRedirect();
        $accepted = $this->get(route('bookings.show', $booking->id))->assertOk()->assertSee('Continue as the client');
        $this->post(route('bookings.handoff', $booking->id), ['_actor_context' => $this->formContext($accepted)])->assertRedirect(route('bookings.show', $booking->id));
        $this->withCookie('strand_city_session', session()->getId());
        $this->get(route('bookings.show', $booking->id))->assertOk()->assertSee(route('checkout.show', $booking->id));
        $checkout = $this->get(route('checkout.show', $booking->id))->assertOk();
        $this->post(route('checkout.store', $booking->id), ['_actor_context' => $this->formContext($checkout), 'outcome' => 'failed'])->assertRedirect();
        $retry = $this->get(route('checkout.show', $booking->id))->assertOk()->assertSee('simulated payment failed');
        $this->post(route('checkout.store', $booking->id), ['_actor_context' => $this->formContext($retry), 'outcome' => 'succeeded'])->assertRedirect();
        $confirmed = $this->get(route('bookings.show', $booking->id))->assertOk()->assertSee('It’s in the diary.');
        $confirmationUrl = $confirmed->viewData('confirmationUrl');
        $this->assertStringContainsString('#message-', $confirmationUrl);
        $this->get($confirmationUrl)->assertOk()->assertSee('Deposit Paid')->assertDontSee('Your appointments');
        $this->post(route('bookings.cancel', $booking->id), ['_actor_context' => $this->formContext($confirmed), 'reason' => 'New plans'])->assertRedirect();
        $this->get(route('bookings.show', $booking->id))->assertOk()->assertSee('simulated deposit has been refunded')->assertSee('Remaining amount due')->assertSee('€0.00')->assertDontSee('Balance at the studio');
    }

    /** @return void */
    public function test_confirmation_link_uses_recipient_page_and_ignores_other_recipients(): void
    {
        $this->buildBookingRuntime();
        $booking = $this->bookings->accept($this->stylist, $this->bookings->request($this->client, $this->input(), $this->now), $this->now);
        app(PaymentService::class)->checkout($this->client, $booking, CheckoutOutcome::Succeeded, $this->now);
        $confirmation = InboxMessage::query()->ownedBy($this->client->id)->where('event', InboxEvent::DepositPaid)->sole();
        foreach ([$this->client, $this->stylist] as $recipient) {
            foreach (range(1, 13) as $index) {
                InboxMessage::query()->create(['recipient_id' => $recipient->id, 'booking_id' => $booking->id, 'event' => InboxEvent::RequestReceived, 'event_key' => 'later-'.$index, 'subject' => 'Later update', 'body' => 'Fictional update.']);
            }
        }
        $url = app(InboxService::class)->confirmationUrl($this->client, $booking);
        $this->assertSame(route('inbox.index', ['page' => 2]).'#message-'.$confirmation->id, $url);
        $this->get($url)->assertOk()->assertSee('id="message-'.$confirmation->id.'"', false);
    }

    /** @return void */
    public function test_studio_date_filter_uses_snapshot_timezone_and_half_open_day(): void
    {
        $this->buildBookingRuntime();
        $source = $this->bookings->request($this->client, $this->input(), $this->now);
        $date = $source->starts_at->setTimezone('Europe/Paris')->toDateString();
        foreach (['00:00', '23:00'] as $index => $time) {
            $copy = $source->replicate();
            $copy->request_key = (string) Str::uuid();
            $copy->timezone = 'Europe/Lisbon';
            $copy->starts_at = CarbonImmutable::parse($date.' '.$time, 'Europe/Lisbon')->utc()->addDays($index);
            $copy->ends_at = $copy->starts_at->addMinutes($copy->duration_minutes);
            $copy->status = BookingStatus::Declined;
            $copy->notification_budget = 0;
            $copy->save();
        }
        $this->profile->update(['timezone' => 'Europe/Berlin']);
        $page = $this->get('/workspace?date='.$date)->assertOk();
        $this->assertSame(2, $page->viewData('appointments')->total());
        $this->assertSame(['Europe/Paris', 'Europe/Lisbon'], $page->viewData('appointments')->getCollection()->pluck('timezone')->all());
        $next = $this->get('/workspace?date='.CarbonImmutable::parse($date)->addDay()->toDateString())->assertOk();
        $this->assertSame(1, $next->viewData('appointments')->total());
    }

    /** @return void */
    public function test_actual_seeded_completed_history_and_upcoming_workspaces(): void
    {
        $directory = $this->runtime->path('seeded');
        $fixtures = app(FixtureService::class);
        $fixtures->build($directory);
        $fixtures->configureConnection('visitor', $directory.'/template.sqlite', config('demo.limits.visitor_pages'));
        $now = CarbonImmutable::now('UTC');
        $fixtures->initializeVisitor($now);
        $client = User::query()->where('email', config('demo.seed_accounts.client'))->sole();
        $bookings = app(BookingService::class);
        $history = $bookings->forActor($client, BookingStatus::Completed, null, 1, $now);
        $this->assertSame(1, $history->total());
        $this->assertSame(1, $bookings->countForActor($client, BookingStatus::Completed, $now));
        $this->assertSame(1, $history->first()->payments()->count());
        $all = $bookings->forActor($client, null, null, 1, $now);
        $this->assertNotSame(BookingStatus::Completed, $all->first()->status);
        $this->assertSame(BookingStatus::Completed, $all->last()->status);
        $this->assertSame(4, $all->total());
    }
}
