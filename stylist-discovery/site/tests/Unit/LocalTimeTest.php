<?php

namespace Tests\Unit;

use App\Services\AvailabilityService;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class LocalTimeTest extends TestCase
{
    /** @return void */
    public function test_dst_gap_and_fold_are_rejected(): void
    {
        $availability = app(AvailabilityService::class);
        foreach (['2027-03-28 02:30', '2026-10-25 02:30'] as $local) {
            try {
                $availability->localInstant($local, 'Europe/Paris');
                $this->fail('A skipped or repeated local time was accepted.');
            } catch (ValidationException $exception) {
                $this->assertArrayHasKey('starts_local', $exception->errors());
            }
        }
        $this->assertSame('2026-10-25 02:30', $availability->localInstant('2026-10-25 03:30', 'Europe/Paris')->format('Y-m-d H:i'));
        $this->assertSame('UTC', $availability->localInstant('2026-10-25 03:30', 'Europe/Paris')->timezoneName);
    }

    /** @return void */
    public function test_invalid_dates_shapes_offsets_and_zones_are_rejected(): void
    {
        $availability = app(AvailabilityService::class);
        foreach (['2026-02-30 09:00', '2026-02-29 09:00', '0000-01-01 09:00', '2026-10-25 24:00', '2026-10-25 09:60', '2026-10-25 09:00+02:00', '2026-10-25T09:00', '2026-1-1 09:00', '2026-10-25 09:00:00'] as $local) {
            try {
                $availability->localInstant($local, 'Europe/Paris');
                $this->fail('Invalid local input accepted: '.$local);
            } catch (ValidationException $exception) {
                $this->assertArrayHasKey('starts_local', $exception->errors());
            }
        }
        $this->expectException(ValidationException::class);
        $availability->localInstant('2026-10-25 09:00', '+02:00');
    }
}
