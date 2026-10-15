<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\MarketingMessage;
use App\Models\StudioSetting;
use App\Models\Subscriber;
use App\Models\User;
use App\Services\OutreachService;
use Carbon\CarbonImmutable;
use Database\Seeders\OutreachSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

class OutreachTest extends TestCase
{
    use RefreshDatabase;

    private function birthdayClient(array $attributes = []): Client
    {
        return Client::create($attributes + ['name' => 'Birthday Guest', 'email' => 'birthday@example.test', 'phone' => '+15550101111', 'birthday' => '1990-10-15', 'anniversary' => '2010-10-15', 'channels' => ['email'], 'marketing_channels' => ['email']]);
    }

    public function test_occasion_previews_require_separate_consent_and_deduplicate_each_year(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-15 10:00:00', 'Asia/Jerusalem'));
        $this->birthdayClient();
        $this->birthdayClient(['name' => 'Reminder only', 'email' => 'reminders@example.test', 'marketing_channels' => []]);
        $service = app(OutreachService::class);

        $this->assertSame(2, $service->generateDue());
        $this->assertSame(0, $service->generateDue());
        $this->assertDatabaseCount('marketing_messages', 2);
        $this->assertDatabaseMissing('marketing_messages', ['recipient' => 'reminders@example.test']);
        $this->travelTo(CarbonImmutable::parse('2027-10-15 10:00:00', 'Asia/Jerusalem'));
        $this->assertSame(2, $service->generateDue());
        $this->assertDatabaseCount('marketing_messages', 4);
    }

    public function test_processing_suppresses_revoked_consent_changed_contacts_and_stale_dates(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-15 10:00:00', 'Asia/Jerusalem'));
        $revoked = $this->birthdayClient();
        $changed = $this->birthdayClient(['email' => 'changed@example.test']);
        $dateChanged = $this->birthdayClient(['email' => 'date@example.test']);
        $service = app(OutreachService::class);
        $service->generateDue();
        $revoked->update(['marketing_channels' => []]);
        $changed->update(['email' => 'replacement@example.test']);
        $dateChanged->update(['birthday' => '1990-11-20', 'anniversary' => null]);

        $this->assertSame(0, $service->processDue());
        $this->assertSame(6, MarketingMessage::where('status', 'cancelled')->count());
    }

    public function test_command_simulates_once_without_real_delivery(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-15 10:00:00', 'Asia/Jerusalem'));
        Http::preventStrayRequests();
        Mail::fake();
        $this->birthdayClient();

        $this->artisan('outreach:process')->assertSuccessful();
        $this->artisan('outreach:process')->assertSuccessful();

        $this->assertSame(2, MarketingMessage::where('status', 'simulated')->where('attempts', 1)->count());
        Http::assertNothingSent();
        Mail::assertNothingSent();
    }

    public function test_signup_requires_explicit_consent_and_does_not_expose_a_token(): void
    {
        $this->post('/newsletter', ['email' => 'guest@example.test'])->assertSessionHasErrors('consent');
        $this->assertDatabaseCount('subscribers', 0);

        $this->post('/newsletter', ['email' => 'GUEST@example.test', 'consent' => '1'])->assertRedirect(route('home'));
        $subscriber = Subscriber::sole();
        $this->assertSame('guest@example.test', $subscriber->email);
        $this->assertNotNull($subscriber->consented_at);
        $this->assertSame(64, strlen($subscriber->unsubscribe_token));
        $this->get('/')->assertOk()->assertDontSee($subscriber->unsubscribe_token);
    }

    public function test_token_confirmation_unsubscribes_and_suppresses_queued_newsletter(): void
    {
        $this->post('/newsletter', ['email' => 'guest@example.test', 'consent' => '1']);
        $subscriber = Subscriber::sole();
        $key = (string) Str::uuid();
        $this->actingAs(User::factory()->create(['role' => 'owner']))->post('/app/outreach/newsletter', ['subject' => 'Studio news', 'body' => 'A new season.', 'campaign_key' => $key])->assertSessionHasNoErrors()->assertRedirect();
        $this->post('/app/outreach/newsletter', ['subject' => 'Studio news', 'body' => 'A new season.', 'campaign_key' => $key])->assertRedirect();
        $this->assertDatabaseCount('marketing_messages', 1);
        $url = '/newsletter/unsubscribe/'.$subscriber->unsubscribe_token;

        $this->get($url)->assertOk();
        $this->assertNull($subscriber->fresh()->unsubscribed_at);
        $this->post($url)->assertOk();
        $this->assertNotNull($subscriber->fresh()->unsubscribed_at);
        $this->assertSame(0, app(OutreachService::class)->processDue());
        $this->assertDatabaseHas('marketing_messages', ['subscriber_id' => $subscriber->id, 'status' => 'cancelled']);
        $this->post('/newsletter', ['email' => 'guest@example.test', 'consent' => '1'])->assertRedirect();
        $this->assertNotNull($subscriber->fresh()->unsubscribed_at);
        $this->post('/newsletter/unsubscribe/'.str_repeat('x', 64))->assertNotFound();
    }

    public function test_staff_cannot_change_website_or_queue_campaigns(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'staff']));
        $this->put('/app/content', ['name' => 'Changed'])->assertForbidden();
        $this->post('/app/outreach/generate')->assertForbidden();
        $this->post('/app/outreach/process')->assertForbidden();
        $this->post('/app/outreach/newsletter', ['subject' => 'News', 'body' => 'Text', 'campaign_key' => (string) Str::uuid()])->assertForbidden();
        $this->assertDatabaseCount('studio_settings', 0);
        $this->assertDatabaseCount('marketing_messages', 0);
    }

    public function test_website_editor_escapes_plain_text_and_ignores_security_config_keys(): void
    {
        $payload = ['name' => '<script>brand()</script>', 'hero_title' => '<img src=x onerror=alert(1)>', 'hero_subtitle' => 'Care & colour', 'about_title' => 'Our studio', 'about_body' => '<script>about()</script>', 'address' => '24 Olive Street', 'phone' => '+15550102400', 'contact_email' => 'studio@example.test', 'opening_hours' => 'Monday–Saturday 9–6', 'demo' => true, 'stripe_enabled' => true];
        $this->actingAs(User::factory()->create(['role' => 'owner']))->put('/app/content', $payload)->assertSessionHasNoErrors()->assertRedirect();

        $this->get('/')->assertOk()->assertSee($payload['name'])->assertSee($payload['hero_title'])->assertSee($payload['about_body'])->assertDontSee($payload['name'], false)->assertDontSee($payload['hero_title'], false)->assertDontSee($payload['about_body'], false);
        $this->assertDatabaseMissing('studio_settings', ['key' => 'demo']);
        $this->assertDatabaseMissing('studio_settings', ['key' => 'stripe_enabled']);
        StudioSetting::create(['key' => 'stripe_enabled', 'value' => '1']);
        StudioSetting::create(['key' => 'demo', 'value' => '1']);
        config(['studio.demo' => false]);
        $this->get('/')->assertOk()->assertDontSee('A fictional salon, a working demo.');
        $this->assertFalse(config('studio.stripe_enabled'));
    }

    public function test_staff_can_edit_client_dates_and_marketing_consent_independently(): void
    {
        $client = $this->birthdayClient();
        $this->actingAs(User::factory()->create(['role' => 'staff']))->put('/app/clients/'.$client->id, ['name' => $client->name, 'email' => $client->email, 'maintenance_weeks' => 4, 'channels' => ['email'], 'marketing_channels' => ['sms'], 'birthday' => '1995-03-04', 'anniversary' => '', 'segment' => 'b2b', 'company' => 'Studio Partners'])->assertSessionHasNoErrors()->assertRedirect();

        $this->assertSame(['email'], $client->fresh()->channels);
        $this->assertSame(['sms'], $client->fresh()->marketing_channels);
        $this->assertSame('1995-03-04', $client->fresh()->birthday->toDateString());
        $this->assertNull($client->fresh()->anniversary);
        $this->assertSame('b2b', $client->fresh()->segment);
    }

    public function test_command_uses_the_saved_studio_name_and_outbox_escapes_preview_content(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-15 10:00:00', 'Asia/Jerusalem'));
        StudioSetting::create(['key' => 'name', 'value' => '<script>Studio</script>']);
        $this->birthdayClient(['name' => '<img src=x onerror=alert(1)>']);

        $this->artisan('outreach:process')->assertSuccessful();

        $this->assertDatabaseHas('marketing_messages', ['subject' => 'Happy birthday from <script>Studio</script>', 'status' => 'simulated']);
        $this->actingAs(User::factory()->create(['role' => 'manager']))->get('/app/outreach')->assertOk()->assertSee('<script>Studio</script>')->assertSee('<img src=x onerror=alert(1)>')->assertDontSee('<script>Studio</script>', false)->assertDontSee('<img src=x onerror=alert(1)>', false);
        $this->get('/app/content')->assertOk()->assertSee('<script>Studio</script>');
    }

    public function test_processing_ignores_future_messages_and_cancels_missed_occasion_dates(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-15 10:00:00', 'Asia/Jerusalem'));
        $this->birthdayClient();
        $service = app(OutreachService::class);
        $service->generateDue();
        MarketingMessage::where('kind', 'anniversary')->update(['due_date' => '2026-10-17']);
        $this->travelTo(CarbonImmutable::parse('2026-10-16 10:00:00', 'Asia/Jerusalem'));

        $this->assertSame(0, $service->processDue());
        $this->assertDatabaseHas('marketing_messages', ['kind' => 'birthday', 'status' => 'cancelled']);
        $this->assertDatabaseHas('marketing_messages', ['kind' => 'anniversary', 'status' => 'pending', 'attempts' => 0]);
    }

    public function test_consented_newsletter_is_simulated_once_and_retry_cannot_change_its_content(): void
    {
        $this->post('/newsletter', ['email' => 'news@example.test', 'consent' => '1']);
        $key = (string) Str::uuid();
        $this->actingAs(User::factory()->create(['role' => 'owner']));
        $this->post('/app/outreach/newsletter', ['subject' => 'News', 'body' => 'Original content', 'campaign_key' => $key])->assertSessionHasNoErrors();
        $this->post('/app/outreach/newsletter', ['subject' => 'News', 'body' => 'Replacement content', 'campaign_key' => $key])->assertSessionHasErrors('campaign_key');

        $this->post('/app/outreach/process')->assertRedirect();
        $this->post('/app/outreach/process')->assertRedirect();

        $this->assertDatabaseCount('marketing_messages', 1);
        $this->assertDatabaseHas('marketing_messages', ['body' => 'Original content', 'status' => 'simulated', 'attempts' => 1]);
    }

    public function test_public_signup_is_throttled_and_admin_pages_require_authentication(): void
    {
        $this->get('/app/outreach')->assertRedirect(route('login'));
        $this->get('/app/content')->assertRedirect(route('login'));
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $this->post('/newsletter', ['email' => 'news@example.test', 'consent' => '1'])->assertRedirect();
        }

        $this->post('/newsletter', ['email' => 'other@example.test', 'consent' => '1'])->assertTooManyRequests();
        $this->assertDatabaseCount('subscribers', 1);
    }

    public function test_demo_seeding_is_repeatable_and_preserves_withdrawn_consent_and_saved_content(): void
    {
        config(['studio.demo' => true]);
        $this->seed(OutreachSeeder::class);
        $client = Client::where('email', 'occasion.guest@outreach.example.test')->sole();
        $client->update(['marketing_channels' => [], 'name' => 'Edited demo guest']);
        Subscriber::query()->update(['unsubscribed_at' => now()]);
        StudioSetting::create(['key' => 'name', 'value' => 'My saved studio']);

        $this->seed(OutreachSeeder::class);

        $this->assertDatabaseCount('clients', 1);
        $this->assertDatabaseCount('subscribers', 2);
        $this->assertSame(2, Subscriber::whereNotNull('unsubscribed_at')->count());
        $this->assertSame([], $client->fresh()->marketing_channels);
        $this->assertSame('Edited demo guest', $client->fresh()->name);
        $this->assertDatabaseHas('studio_settings', ['key' => 'name', 'value' => 'My saved studio']);
    }
}
