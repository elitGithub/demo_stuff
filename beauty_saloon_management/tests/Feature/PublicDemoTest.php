<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Invoice;
use App\Models\Stylist;
use App\Models\Subscriber;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PublicDemoTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['studio.public_demo' => true]);
    }

    public function test_public_submissions_are_rejected_without_changing_shared_data(): void
    {
        $subscriber = Subscriber::create(['email' => 'existing@example.test', 'consented_at' => now()]);

        $this->post('/book', ['name' => 'Visitor'])->assertForbidden()->assertSee('browse-only demo');
        $this->postJson('/newsletter', ['email' => 'visitor@example.test', 'consent' => '1'])
            ->assertForbidden()->assertJsonStructure(['message']);
        $this->post('/newsletter/unsubscribe/'.$subscriber->unsubscribe_token)->assertForbidden();

        $this->assertDatabaseCount('appointments', 0);
        $this->assertDatabaseCount('clients', 0);
        $this->assertDatabaseCount('subscribers', 1);
        $this->assertNull($subscriber->fresh()->unsubscribed_at);
    }

    public function test_an_owner_cannot_change_clients_settings_access_or_payments(): void
    {
        config(['studio.demo' => true]);
        $this->seed();
        $owner = User::where('role', 'owner')->firstOrFail();
        $client = Client::firstOrFail();
        $invoice = Invoice::where('status', 'unpaid')->firstOrFail();
        $clientCount = Client::count();
        $originalName = $owner->name;
        $this->actingAs($owner);

        $this->post('/app/clients', ['name' => 'Added visitor'])->assertForbidden();
        $this->put('/app/clients/'.$client->id, ['name' => 'Changed visitor'])->assertForbidden();
        $this->put('/app/content', ['name' => 'Changed brand'])->assertForbidden();
        $this->put('/app/access/'.$owner->id, ['active' => false])->assertForbidden();
        $this->post('/app/profile', ['_method' => 'PUT', 'name' => 'Changed owner'])->assertForbidden();
        $this->post('/app/invoices/'.$invoice->id.'/payment', ['method' => 'cash'])->assertForbidden();
        $this->post('/app/reminders/process')->assertForbidden();

        $this->assertDatabaseCount('clients', $clientCount);
        $this->assertNotSame('Changed visitor', $client->fresh()->name);
        $this->assertSame($originalName, $owner->fresh()->name);
        $this->assertTrue($owner->fresh()->active);
        $this->assertDatabaseMissing('studio_settings', ['value' => 'Changed brand']);
        $this->assertSame('unpaid', $invoice->fresh()->status);
        $this->assertNull($invoice->fresh()->payment);
    }

    public function test_delete_requests_cannot_remove_existing_records(): void
    {
        config(['studio.demo' => true]);
        $this->seed();
        $stylist = Stylist::firstOrFail();
        $timeOff = $stylist->timeOffs()->create(['starts_at' => now()->addDay(), 'ends_at' => now()->addDays(2), 'reason' => 'Training']);

        $this->actingAs(User::firstOrFail())->delete('/app/team/'.$stylist->id.'/time-off/'.$timeOff->id)->assertForbidden();

        $this->assertModelExists($timeOff);
    }

    public function test_demo_login_and_logout_still_work(): void
    {
        config(['studio.demo' => true]);
        $owner = User::factory()->create(['role' => 'owner', 'email' => config('studio.demo_email')]);

        $this->post('/demo-login')->assertRedirect(route('dashboard'));
        $this->assertAuthenticatedAs($owner);
        $this->post('/logout')->assertRedirect(route('home'));
        $this->assertGuest();
    }

    public function test_password_login_still_requires_valid_credentials(): void
    {
        $owner = User::factory()->create(['role' => 'owner']);

        $this->post('/login', ['email' => $owner->email, 'password' => 'wrong'])->assertSessionHasErrors('email');
        $this->assertGuest();
        $this->post('/login', ['email' => $owner->email, 'password' => 'password'])->assertRedirect(route('dashboard'));
        $this->assertAuthenticatedAs($owner);
    }

    public function test_signed_in_visitors_stay_in_the_demo_subdirectory_when_opening_login(): void
    {
        $this->actingAs(User::factory()->create())
            ->withServerVariables([
                'SCRIPT_NAME' => '/studio/index.php',
                'PHP_SELF' => '/studio/index.php',
                'SCRIPT_FILENAME' => public_path('index.php'),
            ])
            ->get('https://demo-sites.infinityfree.me/studio/login')
            ->assertRedirect('https://demo-sites.infinityfree.me/studio/app');
    }

    public function test_public_pages_and_unsubscribe_confirmation_remain_browsable(): void
    {
        $subscriber = Subscriber::create(['email' => 'existing@example.test', 'consented_at' => now()]);

        $this->get('/')->assertOk()->assertSee('Browse-only demo');
        $this->get('/book')->assertOk();
        $this->get('/login')->assertOk()->assertSee('Browse-only demo');
        $this->head('/')->assertOk();
        $this->options('/book')->assertOk();
        $this->get('/newsletter/unsubscribe/'.$subscriber->unsubscribe_token)->assertOk();

        $this->assertNull($subscriber->fresh()->unsubscribed_at);
    }

    public function test_workspace_views_and_sample_pdfs_remain_available(): void
    {
        config(['studio.demo' => true]);
        $this->seed();
        $this->actingAs(User::where('role', 'owner')->firstOrFail());

        foreach (['/app', '/app/appointments', '/app/clients', '/app/pipeline', '/app/services', '/app/team', '/app/retail', '/app/memberships', '/app/invoices', '/app/reports', '/app/reminders', '/app/outreach', '/app/content', '/app/access', '/app/settings', '/app/profile'] as $path) {
            $this->get($path)->assertOk()->assertSee('Browse-only demo');
        }

        $invoice = Invoice::where('status', 'paid')->firstOrFail();
        foreach (['download', 'receipt'] as $document) {
            $response = $this->get('/app/invoices/'.$invoice->id.'/'.$document)->assertOk()->assertHeader('content-type', 'application/pdf');
            $this->assertStringStartsWith('%PDF-', $response->getContent());
        }
    }

    public function test_disabling_public_demo_keeps_the_local_app_editable(): void
    {
        config(['studio.public_demo' => false]);

        $this->get('/')->assertOk()->assertDontSee('Browse-only demo');
        $this->post('/newsletter', ['email' => 'visitor@example.test', 'consent' => '1'])->assertRedirect();
        $this->actingAs(User::factory()->create())->post('/app/clients', ['name' => 'New client'])->assertRedirect()->assertSessionHasNoErrors();

        $this->assertDatabaseHas('subscribers', ['email' => 'visitor@example.test']);
        $this->assertDatabaseHas('clients', ['name' => 'New client']);
    }
}
