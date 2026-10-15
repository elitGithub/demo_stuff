<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Client;
use App\Models\Invoice;
use App\Models\Service;
use App\Models\Stylist;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class WorkspaceTest extends TestCase
{
    use RefreshDatabase;

    public function test_private_workspace_and_mutations_require_login(): void
    {
        $this->get('/app')->assertRedirect('/login');
        $this->get('/app/clients')->assertRedirect('/login');
        $this->post('/app/clients', ['name' => 'Intruder'])->assertRedirect('/login');
        $this->assertDatabaseCount('clients', 0);
    }

    public function test_demo_login_is_disabled_outside_demo_mode(): void
    {
        config(['studio.demo' => false]);
        $this->post('/demo-login')->assertNotFound();
        $this->assertGuest();
    }

    public function test_demo_workspace_pages_render(): void
    {
        config(['studio.demo' => true]);
        $this->seed();
        $this->actingAs(User::first());
        foreach (['/app', '/app/appointments', '/app/appointments/create', '/app/clients', '/app/services', '/app/team', '/app/reminders', '/app/invoices', '/app/settings'] as $path) {
            $this->get($path)->assertOk();
        }
        $this->get('/app/clients/'.Client::first()->id)->assertOk();
        $this->get('/app/appointments/'.Appointment::first()->id)->assertOk();
    }

    public function test_public_booking_cannot_attach_to_private_client_record(): void
    {
        $this->travelTo(now()->setDate(2026, 10, 15)->startOfDay());
        $private = Client::create(['name' => 'Private', 'email' => 'private@example.test', 'style_notes' => 'SECRET PRIVATE NOTE']);
        $stylist = Stylist::create(['name' => 'Alex', 'title' => 'Stylist', 'working_days' => [0, 1, 2, 3, 4, 5, 6]]);
        $service = Service::create(['name' => 'Cut', 'category' => 'Hair', 'price' => 6000, 'duration' => 45]);
        $stylist->services()->attach($service);
        $response = $this->post('/book', ['client_id' => $private->id, 'name' => 'Visitor', 'email' => 'visitor@example.test', 'phone' => '+15550001111', 'stylist_id' => $stylist->id, 'service_ids' => [$service->id], 'date' => '2026-10-16', 'time' => '11:00', 'channels' => []]);
        $response->assertRedirect();
        $appointment = Appointment::firstOrFail();
        $this->assertNotEquals($private->id, $appointment->client_id);
        $this->get('/booking/'.$appointment->reference)->assertOk()->assertDontSee('SECRET PRIVATE NOTE');
    }

    public function test_staff_can_save_style_and_rebook_services(): void
    {
        config(['studio.demo' => true]);
        $this->seed();
        $this->actingAs(User::first());
        $client = Client::first();
        $this->put('/app/clients/'.$client->id, ['name' => $client->name, 'email' => $client->email, 'style_name' => 'Textured crop', 'style_notes' => 'Keep the sides soft', 'maintenance_weeks' => 4, 'preferred_services' => [Service::first()->id], 'channels' => ['email']])->assertSessionHasNoErrors()->assertRedirect();
        $this->assertSame('Textured crop', $client->fresh()->style_name);
        $this->get('/app/appointments/create?client='.$client->id)->assertOk()->assertSee('Textured crop');
    }

    public function test_service_link_selects_a_qualified_stylist(): void
    {
        config(['studio.demo' => true]);
        $this->seed();
        $service = Service::where('name', 'Lived-in colour')->firstOrFail();
        $response = $this->get('/book?service='.$service->id)->assertOk();
        $response->assertViewHas('selectedStylist', fn ($id) => $service->stylists()->whereKey($id)->exists());
        $response->assertViewHas('selectedServices', [$service->id]);
    }

    public function test_repeat_keeps_inactive_services_visible_and_warns_about_inactive_stylist(): void
    {
        config(['studio.demo' => true]);
        $this->seed();
        $appointment = Appointment::with('items')->firstOrFail();
        Service::whereKey($appointment->items->pluck('service_id'))->update(['active' => false]);
        $appointment->stylist->update(['active' => false]);
        $this->actingAs(User::first())->get('/app/appointments/create?repeat='.$appointment->id)
            ->assertOk()->assertSee('The original stylist is unavailable')
            ->assertSee('No longer offered')->assertViewHas('selectedServices', $appointment->items->pluck('service_id')->all());
    }

    public function test_cancelled_public_booking_link_does_not_claim_a_confirmed_visit(): void
    {
        config(['studio.demo' => true]);
        $this->seed();
        $appointment = Appointment::firstOrFail();
        $appointment->update(['status' => 'cancelled']);
        $this->get('/booking/'.$appointment->reference)->assertOk()->assertSee('This visit was cancelled')->assertDontSee('See you in the chair');
    }

    public function test_time_off_can_be_removed_only_from_its_own_stylist(): void
    {
        config(['studio.demo' => true]);
        $this->seed();
        $stylist = Stylist::first();
        $other = Stylist::whereKeyNot($stylist->id)->first();
        $timeOff = $stylist->timeOffs()->create(['starts_at' => now()->addDays(2), 'ends_at' => now()->addDays(3), 'reason' => 'Training']);
        $this->actingAs(User::first());
        $this->delete('/app/team/'.$other->id.'/time-off/'.$timeOff->id)->assertNotFound();
        $this->assertModelExists($timeOff);
        $this->delete('/app/team/'.$stylist->id.'/time-off/'.$timeOff->id)->assertRedirect();
        $this->assertModelMissing($timeOff);
    }

    public function test_calendar_expands_to_cover_configured_working_hours(): void
    {
        config(['studio.demo' => true]);
        $this->seed();
        Stylist::first()->update(['start_time' => '06:30', 'end_time' => '22:30']);
        $this->actingAs(User::first())->get('/app/appointments')->assertOk()->assertViewHas('startHour', 6)->assertViewHas('endHour', 23)->assertSee('--hours:17', false);
    }

    public function test_invoice_and_receipt_are_real_pdfs_and_unpaid_receipts_are_blocked(): void
    {
        config(['studio.demo' => true]);
        $this->seed();
        $invoice = Invoice::where('status', 'unpaid')->firstOrFail();
        $this->get('/app/invoices/'.$invoice->id.'/download')->assertRedirect('/login');
        $this->actingAs(User::first());
        $pdf = $this->get('/app/invoices/'.$invoice->id.'/download')->assertOk()->assertHeader('content-type', 'application/pdf');
        $this->assertStringStartsWith('%PDF-', $pdf->getContent());
        $this->get('/app/invoices/'.$invoice->id.'/receipt')->assertNotFound();
        $this->post('/app/invoices/'.$invoice->id.'/payment', ['method' => 'cash'])->assertSessionHasNoErrors()->assertRedirect();
        $receipt = $this->get('/app/invoices/'.$invoice->id.'/receipt')->assertOk()->assertHeader('content-type', 'application/pdf');
        $this->assertStringStartsWith('%PDF-', $receipt->getContent());
    }

    public function test_style_images_remain_private_and_active_content_is_rejected(): void
    {
        Storage::fake('local');
        $client = Client::create(['name' => 'Image fixture']);
        $this->actingAs(User::factory()->create());
        $this->put('/app/clients/'.$client->id, [
            'name' => $client->name, 'maintenance_weeks' => 4,
            'style_photo' => UploadedFile::fake()->createWithContent('style.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        ])->assertSessionHasErrors('style_photo');
        $this->assertNull($client->fresh()->style_photo);

        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=');
        $this->put('/app/clients/'.$client->id, ['name' => $client->name, 'maintenance_weeks' => 4, 'style_photo' => UploadedFile::fake()->createWithContent('style.png', $png)])->assertSessionHasNoErrors();
        Storage::disk('local')->assertExists($client->fresh()->style_photo);
        $this->get('/app/clients/'.$client->id.'/photo')->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->post('/logout');
        $this->get('/app/clients/'.$client->id.'/photo')->assertRedirect('/login');
    }
}
