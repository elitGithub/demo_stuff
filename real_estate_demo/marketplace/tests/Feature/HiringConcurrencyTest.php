<?php

namespace Tests\Feature;

use PHPUnit\Framework\TestCase;
use Tests\Support\ConcurrentHiring;

class HiringConcurrencyTest extends TestCase
{
    public function test_simultaneous_acceptance_has_exactly_one_winner(): void
    {
        if (getenv('HAVEN_CONCURRENCY_APPROVED') !== '1') {
            $this->markTestSkipped('Requires explicit approval for isolated file SQLite and child processes.');
        }
        $directory = dirname(__DIR__, 2).'/storage/framework/testing';
        if (! is_dir($directory)) {
            mkdir($directory, 0700, true);
        }
        $path = $directory.'/hiring-'.bin2hex(random_bytes(8)).'.sqlite';
        try {
            $fixture = ConcurrentHiring::prepare($path);
            $results = ConcurrentHiring::race($path, $fixture);
            $statuses = array_column($results, 'status');
            sort($statuses);
            self::assertSame([200, 409], $statuses);
            $state = ConcurrentHiring::inspect($path);
            self::assertSame(1, $state['accepted_count']);
            self::assertSame(1, $state['booked_event_count']);
            self::assertContains($state['accepted_quote_id'], [$fixture['first_quote_id'], $fixture['second_quote_id']]);
        } finally {
            ConcurrentHiring::cleanup($path);
        }
    }
}
