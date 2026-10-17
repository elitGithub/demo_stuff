<?php

namespace Tests\Feature;

use App\Support\DisplayDate;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class DisplayDateTest extends TestCase
{
    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->travelTo(CarbonImmutable::parse('2026-10-14 15:00:00', 'America/Toronto'));
    }

    /**
     * @return array<string, array{string, string, string}>
     */
    public static function listDays(): array
    {
        return [
            'start of today' => ['2026-10-14 00:00:00', 'America/Toronto', 'Today'],
            'end of today' => ['2026-10-14 23:59:59', 'America/Toronto', 'Today'],
            'end of yesterday' => ['2026-10-13 23:59:59', 'America/Toronto', 'Yesterday'],
            'start of yesterday' => ['2026-10-13 00:00:00', 'America/Toronto', 'Yesterday'],
            'two days ago' => ['2026-10-12 23:59:59', 'America/Toronto', 'Oct 12'],
            'single digit day' => ['2026-09-03 08:00:00', 'America/Toronto', 'Sep 3'],
            'late tonight in Toronto stored as UTC' => ['2026-10-15 03:30:00', 'UTC', 'Today'],
            'early today in UTC but yesterday in Toronto' => ['2026-10-14 02:00:00', 'UTC', 'Yesterday'],
        ];
    }

    /**
     * @return array<string, array{string, string}>
     */
    public static function times(): array
    {
        return [
            'morning' => ['2026-10-14 09:05:00', '9:05 am'],
            'noon' => ['2026-10-14 12:00:00', '12:00 pm'],
            'afternoon' => ['2026-10-14 13:25:00', '1:25 pm'],
            'midnight' => ['2026-10-14 00:00:00', '12:00 am'],
        ];
    }

    /**
     * @see DisplayDate::day()
     */
    #[DataProvider('listDays')]
    public function test_the_list_day_says_today_yesterday_or_month_and_day(string $moment, string $zone, string $expected): void
    {
        $this->assertSame($expected, DisplayDate::day(CarbonImmutable::parse($moment, $zone)));
    }

    /**
     * @see DisplayDate::time()
     */
    #[DataProvider('times')]
    public function test_times_use_a_twelve_hour_clock(string $moment, string $expected): void
    {
        $this->assertSame($expected, DisplayDate::time(CarbonImmutable::parse($moment, 'America/Toronto')));
    }

    /**
     * @see DisplayDate::date()
     */
    public function test_dates_are_canadian_style_month_day_year(): void
    {
        $this->assertSame('Oct 14, 2026', DisplayDate::date(CarbonImmutable::parse('2026-10-14 15:00:00', 'America/Toronto')));
        $this->assertSame('Jan 2, 2027', DisplayDate::date(CarbonImmutable::parse('2027-01-02 08:00:00', 'America/Toronto')));
    }

    /**
     * @see DisplayDate::date()
     */
    public function test_a_utc_moment_is_shown_in_toronto_time(): void
    {
        $moment = CarbonImmutable::parse('2026-10-15 02:30:00', 'UTC');

        $this->assertSame('Oct 14, 2026', DisplayDate::date($moment));
        $this->assertSame('10:30 pm', DisplayDate::time($moment));
        $this->assertSame('2026-10-14T22:30:00-04:00', DisplayDate::iso($moment));
        $this->assertSame('UTC', $moment->getTimezone()->getName());
    }

    /**
     * @see DisplayDate::iso()
     */
    public function test_the_machine_date_carries_the_offset_across_daylight_saving(): void
    {
        $this->assertSame('2026-12-01T09:00:00-05:00', DisplayDate::iso(CarbonImmutable::parse('2026-12-01 09:00:00', 'America/Toronto')));
        $this->assertSame('2026-07-01T09:00:00-04:00', DisplayDate::iso(CarbonImmutable::parse('2026-07-01 09:00:00', 'America/Toronto')));
    }
}
