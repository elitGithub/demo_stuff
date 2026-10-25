<?php

namespace Tests\Feature;

use App\Enums\BookingStatus;
use App\Enums\PaymentKind;
use App\Models\Booking;
use App\Services\SandboxService;
use Carbon\CarbonImmutable;
use DOMDocument;
use DOMElement;
use DOMXPath;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Support\BuildsSandboxRuntime;
use Tests\TestCase;

class FullJourneyTest extends TestCase
{
    use BuildsSandboxRuntime;

    /** @return void */
    public function test_visible_journey_preserves_booking_through_roles_payment_inbox_refund_and_independent_cookies(): void
    {
        $this->buildSandboxRuntime();
        $visitorB = $this->startBrowser();
        $cookieB = session()->getId();
        $tokenB = session()->get('sandbox_token');
        $visitorB->assertSee('Try a booking at Atelier Lune');
        $this->browser(null);
        $discovery = $this->startBrowser();
        $tokenA = session()->get('sandbox_token');
        $this->assertNotSame($tokenB, $tokenA);
        $studio = $this->follow($discovery, 'Try a booking at Atelier Lune');
        $slots = $this->follow($studio, 'Request a time');
        $slots->assertSee('Choose a start time');
        $review = $this->follow($slots, '09:00');
        $created = $this->submit($review, 'Send booking request');
        $created->assertRedirect();
        $appointmentUrl = $created->headers->get('Location');
        $appointment = $this->get($appointmentUrl)->assertOk()->assertSee('Review as the stylist');
        app(SandboxService::class)->admit(session()->driver(), CarbonImmutable::now());
        $booking = Booking::query()->whereNull('seed_key')->sole();
        $requestKey = $booking->request_key;
        $this->assertSame(BookingStatus::Requested, $booking->status);
        $stylist = $this->followRedirect($this->submit($appointment, 'Review as the stylist'));
        $stylist->assertSee('Accept request');
        $accepted = $this->followRedirect($this->submit($stylist, 'Accept request'));
        $client = $this->followRedirect($this->submit($accepted, 'Continue as the client'));
        $checkout = $this->follow($client, 'Continue to simulated deposit');
        $failed = $this->followRedirect($this->submit($checkout, 'Try a failed payment'));
        $failed->assertSee('Simulate successful deposit');
        app(SandboxService::class)->admit(session()->driver(), CarbonImmutable::now());
        $deadline = $booking->refresh()->deposit_deadline;
        $this->assertSame(0, $booking->payments()->count());
        $confirmed = $this->followRedirect($this->submit($failed, 'Simulate successful deposit'));
        $confirmed->assertSee('It’s in the diary.')->assertSee('simulated deposit is recorded');
        app(SandboxService::class)->admit(session()->driver(), CarbonImmutable::now());
        $this->assertEquals($deadline, $booking->refresh()->deposit_deadline);
        $this->assertSame(BookingStatus::Confirmed, $booking->status);
        $inbox = $this->follow($confirmed, 'View your confirmation in the inbox');
        $inbox->assertSee('Simulated deposit confirmed');
        $cancelled = $this->followRedirect($this->submit($this->get($appointmentUrl)->assertOk(), 'Cancel appointment', ['reason' => 'Fictional change of plans']));
        $cancelled->assertSee('simulated deposit has been refunded');
        app(SandboxService::class)->admit(session()->driver(), CarbonImmutable::now());
        $this->assertSame(BookingStatus::Cancelled, $booking->refresh()->status);
        $this->assertSame($booking->deposit_cents, $booking->payments()->where('kind', PaymentKind::Refund)->sole()->amount_cents);
        $cookieA = session()->getId();
        $pathA = DB::connection('visitor')->getDatabaseName();
        $this->assertNotSame($cookieA, $cookieB);
        $this->browser($cookieB);
        $this->get('/workspace')->assertOk()->assertDontSee('Fictional change of plans');
        app(SandboxService::class)->admit(session()->driver(), CarbonImmutable::now());
        $this->assertNotSame($pathA, DB::connection('visitor')->getDatabaseName());
        $this->assertSame(0, Booking::query()->where('request_key', $requestKey)->count());
        $this->assertSame(0, DB::connection('visitor')->table('inbox_messages')->where('booking_id', $booking->id)->count());
        $this->get($appointmentUrl)->assertNotFound();
        $this->browser($cookieA);
        $this->get($appointmentUrl)->assertOk()->assertSee('Fictional change of plans');
        Http::assertNothingSent();
        Mail::assertNothingSent();
    }

    /** @return void */
    public function test_normal_stylist_registers_sets_up_submits_admin_publishes_and_client_requests_through_visible_controls(): void
    {
        $this->buildSandboxRuntime();
        $discovery = $this->startBrowser();
        $account = $this->follow($discovery, 'Alex Morel');
        $registration = $this->follow($account, 'Create an account');
        $setup = $this->followRedirect($this->submit($registration, 'Create account', ['name' => 'Soline Fictional', 'email' => 'soline@studio.example', 'password' => 'fictional-password-123', 'password_confirmation' => 'fictional-password-123', 'role' => 'stylist']));
        $profile = $this->follow($setup, 'Start with your profile');
        $saved = $this->followRedirect($this->submit($profile, 'Save profile', ['display_name' => 'Soline Fictional', 'studio_name' => 'Studio Fictional New', 'biography' => 'A fictional studio for considerate cuts.', 'address' => '24 Fictional Lane', 'city_code' => 'paris', 'deposit_percent' => 25, 'specialty_ids' => [3]]));
        $menu = $this->follow($saved, 'Continue to your service menu');
        $form = $this->follow($menu, 'Add a service');
        $serviceSaved = $this->followRedirect($this->submit($form, 'Save service', ['name' => 'Signature fictional cut', 'specialty_id' => 3, 'price' => '60.00', 'duration_minutes' => 60, 'active' => 1]));
        $checklist = $this->follow($serviceSaved, 'Continue your studio setup');
        $availability = $this->follow($checklist, 'Set your availability');
        $days = [];
        foreach (range(0, 6) as $weekday) {
            $days[] = ['weekday' => $weekday, 'open' => 1, 'opens_at' => '09:00', 'closes_at' => '18:00'];
        }
        $hoursSaved = $this->followRedirect($this->submit($availability, 'Save weekly hours', ['days' => $days]));
        $ready = $this->follow($hoursSaved, 'Continue to your studio checklist');
        $ready->assertSee('3 of 3 essentials ready');
        $pending = $this->followRedirect($this->submit($ready, 'Submit for review'));
        $admin = $this->followRedirect($this->submit($pending, 'Review as demo admin'));
        $application = $this->follow($admin, 'Review Soline Fictional');
        $published = $this->followRedirect($this->submit($application, 'Publish studio'));
        $public = $this->follow($published, 'View in discovery');
        $slots = $this->follow($public, 'Request a time');
        $review = $this->follow($slots, '09:00');
        $clientReview = $this->followRedirect($this->submit($review, 'Continue as the client'));
        $clientReview->assertSee('Signature fictional cut')->assertSee('Send booking request');
        $request = $this->followRedirect($this->submit($clientReview, 'Send booking request'));
        $request->assertSee('Your stylist has the next move.')->assertDontSee('Review as the stylist');
        Http::assertNothingSent();
        Mail::assertNothingSent();
    }

    /** @return void */
    public function test_contextual_client_continuation_preserves_dynamic_time_revalidates_eligibility_and_rejects_forgery_stale_context_and_csrf(): void
    {
        $this->buildSandboxRuntime();
        $page = $this->startBrowser();
        $stylist = $this->followRedirect($this->submit($page, 'Switch', ['role' => 'stylist']));
        $discovery = $this->follow($stylist, 'Discover');
        $review = $this->follow($this->follow($this->follow($discovery, 'Try a booking at Atelier Lune'), 'Request a time'), '09:00');
        $form = $this->form($review, 'Continue as the client');
        $beforeSession = session()->getId();
        $beforeToken = session()->token();
        $beforeRevision = session()->get('actor_revision');
        $this->post($form['action'], array_merge($form['data'], ['return_url' => 'https://untrusted.example']))->assertStatus(422);
        $this->post($form['action'], array_merge($form['data'], ['_actor_context' => 'forged']))->assertStatus(409);
        app()->instance('env', 'csrf-test');
        try {
            $this->post($form['action'], array_merge($form['data'], ['_token' => 'invalid']))->assertStatus(419);
        } finally {
            app()->instance('env', 'testing');
        }
        $response = $this->post($form['action'], $form['data'])->assertRedirect();
        $this->assertNotSame($beforeSession, session()->getId());
        $this->assertNotSame($beforeToken, session()->token());
        $this->assertNotSame($beforeRevision, session()->get('actor_revision'));
        $clientReview = $this->followRedirect($response)->assertSee('Send booking request');
        $clientForm = $this->form($clientReview, 'Send booking request');
        $this->assertSame($form['data']['service'], $clientForm['data']['service']);
        $this->assertSame($form['data']['starts_local'], $clientForm['data']['starts_local']);
        $this->post($form['action'], $form['data'])->assertStatus(409);
        app(SandboxService::class)->admit(session()->driver(), CarbonImmutable::now());
        DB::connection('visitor')->table('services')->where('id', $form['data']['service'])->update(['active' => false]);
        $this->post($form['action'], array_merge($clientForm['data'], ['request_key' => null, 'note' => null]))->assertStatus(422);
        unset($clientForm['data']['request_key'], $clientForm['data']['note']);
        $this->post($form['action'], $clientForm['data'])->assertNotFound();
    }

    /** @param ?string $cookie @return void */
    protected function browser(?string $cookie): void
    {
        $this->defaultCookies = [];
        app('auth')->forgetGuards();
        app('session')->forgetDrivers();
        app()->forgetInstance('session.store');
        if ($cookie !== null) {
            $this->withCookie('strand_city_session', $cookie);
        }
    }

    /** @return TestResponse */
    protected function startBrowser(): TestResponse
    {
        $landing = $this->get('/')->assertOk();

        return $this->followRedirect($this->submit($landing, 'Explore the demo'));
    }

    /** @param TestResponse $response @return TestResponse */
    protected function followRedirect(TestResponse $response): TestResponse
    {
        $response->assertRedirect();
        $this->withCookie('strand_city_session', session()->getId());

        return $this->get($response->headers->get('Location'))->assertOk();
    }

    /** @param TestResponse $page @param string $label @return TestResponse */
    protected function follow(TestResponse $page, string $label): TestResponse
    {
        $document = new DOMDocument;
        @$document->loadHTML($page->getContent());
        $links = (new DOMXPath($document))->query('//a[contains(normalize-space(.), "'.$label.'")]');
        $this->assertGreaterThan(0, $links->length, 'Missing visible link: '.$label);

        return $this->get($links->item(0)->getAttribute('href'))->assertOk();
    }

    /** @param TestResponse $page @param string $label @return array{action:string,data:array<string,string>} */
    protected function form(TestResponse $page, string $label): array
    {
        $document = new DOMDocument;
        @$document->loadHTML($page->getContent());
        $xpath = new DOMXPath($document);
        $forms = $xpath->query('//form[.//button[contains(normalize-space(.), "'.$label.'")]]');
        $this->assertGreaterThan(0, $forms->length, 'Missing visible form: '.$label);
        $form = $forms->item(0);
        $this->assertInstanceOf(DOMElement::class, $form);
        $data = [];
        foreach ($xpath->query('.//input[@type="hidden"]', $form) as $input) {
            if (! str_contains($input->getAttribute('name'), '[')) {
                $data[$input->getAttribute('name')] = $input->getAttribute('value');
            }
        }

        return ['action' => $form->getAttribute('action'), 'data' => $data];
    }

    /** @param TestResponse $page @param string $label @param array<string,mixed> $data @return TestResponse */
    protected function submit(TestResponse $page, string $label, array $data = []): TestResponse
    {
        $form = $this->form($page, $label);

        return $this->post($form['action'], array_merge($form['data'], $data));
    }
}
