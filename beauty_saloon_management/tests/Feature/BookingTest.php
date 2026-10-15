<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Service;
use App\Models\Stylist;
use App\Services\BookingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class BookingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now()->setDate(2026, 10, 15)->startOfDay());
    }

    private function booking(): array
    {
        $service = Service::create(['name' => 'Signature cut', 'category' => 'Hair', 'price' => 6500, 'duration' => 45]);
        $stylist = Stylist::create(['name' => 'Alex', 'title' => 'Stylist', 'working_days' => [0, 1, 2, 3, 4, 5, 6], 'start_time' => '09:00', 'end_time' => '18:00']);
        $stylist->services()->attach($service);

        return ['service_ids' => [$service->id], 'stylist_id' => $stylist->id, 'date' => '2026-10-16', 'time' => '10:00', 'name' => 'Test Client', 'email' => 'client@example.test', 'phone' => '+15551234567', 'channels' => ['email']];
    }

    public function test_booking_uses_catalogue_price_and_duration(): void
    {
        $data = $this->booking();
        $appointment = app(BookingService::class)->book($data + ['total' => 1]);
        $this->assertSame(6500, $appointment->total);
        $this->assertEquals(45, $appointment->starts_at->diffInMinutes($appointment->ends_at));
        $this->assertSame('Signature cut', $appointment->items->first()->name);
        $this->assertCount(1, $appointment->reminders);
    }

    public function test_overlap_is_rejected_but_adjacent_slot_is_allowed(): void
    {
        $data = $this->booking();
        $service = app(BookingService::class);
        $service->book($data);
        try {
            $service->book(array_replace($data, ['time' => '10:30']));
            $this->fail('Overlapping booking was accepted');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('time', $exception->errors());
        }
        $service->book(array_replace($data, ['time' => '10:45']));
        $this->assertSame(2, Appointment::count());
    }

    public function test_out_of_hours_booking_is_rejected(): void
    {
        $data = $this->booking();
        $this->expectException(ValidationException::class);
        app(BookingService::class)->book(array_replace($data, ['time' => '17:45']));
    }

    public function test_unqualified_stylist_is_rejected(): void
    {
        $data = $this->booking();
        Stylist::find($data['stylist_id'])->services()->detach();
        $this->expectException(ValidationException::class);
        app(BookingService::class)->book($data);
    }

    public function test_inactive_service_is_rejected(): void
    {
        $data = $this->booking();
        Service::find($data['service_ids'][0])->update(['active' => false]);
        $this->expectException(ValidationException::class);
        app(BookingService::class)->book($data);
    }

    public function test_cancelled_appointment_releases_its_slot(): void
    {
        $data = $this->booking();
        $service = app(BookingService::class);
        $appointment = $service->book($data);
        $service->transition($appointment, 'cancelled');
        $replacement = $service->book($data);
        $this->assertNotEquals($appointment->id, $replacement->id);
        $this->assertSame('cancelled', $appointment->reminders()->first()->status);
    }

    public function test_rescheduling_preserves_prices_and_moves_reminders(): void
    {
        $data = $this->booking();
        $booking = app(BookingService::class);
        $appointment = $booking->book($data);
        Service::first()->update(['price' => 99900, 'duration' => 120]);
        $booking->reschedule($appointment, '2026-10-20', '12:00');
        $appointment->refresh();
        $this->assertSame(6500, $appointment->total);
        $this->assertSame('12:45', $appointment->localEnd()->format('H:i'));
        $this->assertSame('2026-10-19 12:00', $appointment->reminders()->first()->scheduled_at->setTimezone(config('studio.timezone'))->format('Y-m-d H:i'));
        $this->assertContains('10:00', $booking->slots($appointment->stylist, $data['service_ids'], $data['date']));
    }

    public function test_time_off_blocks_booking_and_future_visits_cannot_be_completed(): void
    {
        $data = $this->booking();
        $booking = app(BookingService::class);
        $appointment = $booking->book($data);
        $appointment->stylist->timeOffs()->create(['starts_at' => $appointment->starts_at->addHour(), 'ends_at' => $appointment->starts_at->addHours(2)]);
        $this->assertNotContains('11:00', $booking->slots($appointment->stylist, $data['service_ids'], $data['date']));
        $this->expectException(ValidationException::class);
        $booking->transition($appointment, 'completed');
    }
}
