<?php

namespace Tests\Support;

use App\Data\BookingInput;
use App\Enums\AccountRole;
use App\Enums\ProfileStatus;
use App\Models\Service;
use App\Models\Specialty;
use App\Models\StylistProfile;
use App\Models\User;
use App\Services\BookingService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

trait BuildsBookingRuntime
{
    use BuildsAccountRuntime;

    protected User $client;

    protected User $stylist;

    protected StylistProfile $profile;

    protected Service $service;

    protected BookingService $bookings;

    protected CarbonImmutable $now;

    protected string $context;

    /** @return void */
    protected function buildBookingRuntime(): void
    {
        $this->buildAccountRuntime();
        $this->context = $this->formContext($this->enterAccountDemo());
        $this->admitAccountFixture();
        $this->client = User::query()->where('role', AccountRole::Client)->sole();
        $this->stylist = User::query()->where('role', AccountRole::Stylist)->sole();
        $this->profile = $this->stylist->profile;
        $this->profile->update(['status' => ProfileStatus::Published, 'deposit_percent' => 25, 'studio_name' => 'Studio Fictional']);
        $specialty = Specialty::query()->create(['name' => 'Cuts', 'slug' => 'cuts', 'enabled' => true]);
        $this->profile->specialties()->attach($specialty);
        $this->service = $this->profile->services()->create(['specialty_id' => $specialty->id, 'name' => 'Signature cut', 'price_cents' => 1999, 'duration_minutes' => 60, 'active' => true]);
        foreach (range(0, 6) as $weekday) {
            $this->profile->workingHours()->create(['weekday' => $weekday, 'opens_at' => '09:00', 'closes_at' => '18:00']);
        }
        $this->now = CarbonImmutable::now('UTC');
        $this->bookings = app(BookingService::class);
    }

    /**
     * @param  string  $time
     * @param  ?string  $note
     * @return BookingInput
     */
    protected function input(string $time = '10:00', ?string $note = null): BookingInput
    {
        return new BookingInput(serviceId: $this->service->id, startsLocal: $this->now->setTimezone('Europe/Paris')->addDays(3)->toDateString().' '.$time, requestKey: (string) Str::uuid(), note: $note);
    }
}
