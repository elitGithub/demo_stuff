<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Client;
use App\Models\Reminder;
use App\Models\Stylist;
use App\Models\User;
use App\Services\ReminderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class ReminderTest extends TestCase
{
    use RefreshDatabase;

    private function appointment(): Appointment
    {
        $client = Client::create(['name' => 'Jo', 'email' => 'jo@example.test', 'phone' => '+15550101234', 'channels' => ['email', 'sms', 'whatsapp']]);
        $stylist = Stylist::create(['name' => 'Alex', 'title' => 'Stylist']);

        return Appointment::create(['client_id' => $client->id, 'stylist_id' => $stylist->id, 'starts_at' => now()->addHours(5), 'ends_at' => now()->addHours(6), 'total' => 6000]);
    }

    public function test_due_reminders_are_simulated_once_without_outbound_delivery(): void
    {
        $this->freezeTime();
        Http::preventStrayRequests();
        Mail::fake();
        $service = app(ReminderService::class);
        $appointment = $this->appointment();
        $service->schedule($appointment);
        $this->assertSame(3, $service->processDue());
        $this->assertSame(0, $service->processDue());
        $this->assertSame(3, $appointment->reminders()->where('status', 'simulated')->count());
        Http::assertNothingSent();
        Mail::assertNothingSent();
    }

    public function test_withdrawn_consent_suppresses_existing_reminders(): void
    {
        $this->freezeTime();
        $appointment = $this->appointment();
        $service = app(ReminderService::class);
        $service->schedule($appointment);
        $appointment->client->update(['channels' => []]);
        $this->assertSame(0, $service->processDue());
        $this->assertSame(3, $appointment->reminders()->where('status', 'cancelled')->count());
    }

    public function test_contact_edits_reconcile_upcoming_reminders_without_repeating_processed_channels(): void
    {
        $this->freezeTime();
        $appointment = $this->appointment();
        $appointment->client->update(['channels' => ['email', 'sms']]);
        app(ReminderService::class)->schedule($appointment);
        $appointment->reminders()->where('channel', 'sms')->update(['status' => 'simulated', 'attempts' => 1, 'processed_at' => now()]);

        $this->actingAs(User::factory()->create())->put('/app/clients/'.$appointment->client_id, [
            'name' => 'Jo Updated', 'email' => 'corrected@example.test', 'phone' => '+15550009999',
            'maintenance_weeks' => 4, 'channels' => ['email', 'sms', 'whatsapp'],
        ])->assertSessionHasNoErrors()->assertRedirect();

        $this->assertDatabaseHas('reminders', ['appointment_id' => $appointment->id, 'channel' => 'email', 'recipient' => 'corrected@example.test', 'status' => 'pending']);
        $this->assertDatabaseHas('reminders', ['appointment_id' => $appointment->id, 'channel' => 'whatsapp', 'recipient' => '+15550009999', 'status' => 'pending']);
        $this->assertDatabaseHas('reminders', ['appointment_id' => $appointment->id, 'channel' => 'sms', 'status' => 'simulated', 'attempts' => 1]);

        $this->put('/app/clients/'.$appointment->client_id, ['name' => 'Jo', 'maintenance_weeks' => 4, 'channels' => []])->assertSessionHasNoErrors();
        $this->assertSame(0, $appointment->reminders()->where('status', 'pending')->count());
    }

    public function test_a_reminder_rescheduled_between_selection_and_claim_is_not_processed_early(): void
    {
        $this->freezeTime();
        $appointment = $this->appointment();
        app(ReminderService::class)->schedule($appointment);
        $moved = false;
        Reminder::retrieved(function () use (&$moved, $appointment) {
            if (! $moved) {
                $moved = true;
                $appointment->reminders()->update(['scheduled_at' => now()->addDays(2)]);
            }
        });
        try {
            $this->assertSame(0, app(ReminderService::class)->processDue());
            $this->assertSame(3, $appointment->reminders()->where('status', 'pending')->count());
        } finally {
            Reminder::flushEventListeners();
        }
    }
}
