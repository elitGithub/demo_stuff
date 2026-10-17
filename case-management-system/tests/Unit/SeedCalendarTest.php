<?php

namespace Tests\Unit;

use App\Sandbox\SeedCalendar;
use Carbon\CarbonImmutable;
use Carbon\Exceptions\InvalidFormatException;
use Illuminate\Support\Facades\File;
use Pdo\Sqlite;
use PDOException;
use RuntimeException;
use Tests\Support\BuildsTemplateFile;
use Tests\TestCase;

class SeedCalendarTest extends TestCase
{
    use BuildsTemplateFile;

    private const string FORMAT = 'Y-m-d H:i:s';

    private const array SHIFTED = [
        'cases' => ['received_at', 'closed_at', 'created_at', 'updated_at'],
        'case_messages' => ['sent_at', 'created_at', 'updated_at'],
        'case_events' => ['occurred_at', 'created_at', 'updated_at'],
        'mailbox_messages' => ['received_at', 'created_at', 'updated_at'],
        'notifications' => ['created_at', 'updated_at', 'read_at'],
    ];

    private string $path;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();

        $template = $this->buildTemplate();
        $this->path = config('casefile.sandbox.directory').'/calendar.sqlite';

        File::ensureDirectoryExists(dirname($this->path));
        File::copy($template, $this->path);
    }

    /**
     * @return Sqlite
     */
    private function open(): Sqlite
    {
        return new Sqlite('sqlite:'.$this->path);
    }

    /**
     * @param  string  $table
     * @param  string  $column
     * @return array<int|string, ?string>
     */
    private function column(string $table, string $column): array
    {
        return $this->open()->query(sprintf('select id, %s from %s order by id', $column, $table))->fetchAll(Sqlite::FETCH_KEY_PAIR);
    }

    /**
     * @param  string  $table
     * @return list<array<string, mixed>>
     */
    private function rows(string $table): array
    {
        return $this->open()->query(sprintf('select * from %s order by rowid', $table))->fetchAll(Sqlite::FETCH_ASSOC);
    }

    /**
     * @return CarbonImmutable
     */
    private function seededAt(): CarbonImmutable
    {
        return CarbonImmutable::createFromFormat(self::FORMAT, $this->open()->query('select seeded_at from installation_meta')->fetchColumn());
    }

    /**
     * @param  string  $wallClock
     * @return CarbonImmutable
     */
    private function pinSeed(string $wallClock): CarbonImmutable
    {
        $this->open()->prepare('update installation_meta set seeded_at = :seeded')->execute(['seeded' => $wallClock]);

        return $this->seededAt();
    }

    /**
     * @param  string  $value
     * @param  int  $seconds
     * @return string
     */
    private function naive(string $value, int $seconds): string
    {
        return CarbonImmutable::createFromFormat(self::FORMAT, $value, 'UTC')->addSeconds($seconds)->format(self::FORMAT);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return int
     */
    private function insertScriptEntry(array $payload): int
    {
        $database = $this->open();
        $database->prepare("insert into script_entries (kind, position, thread_id, payload, delivered_at, created_at, updated_at) values ('scripted_reply', null, 'thread-calendar', :payload, null, '2026-10-01 08:00:00', '2026-10-01 08:00:00')")
            ->execute(['payload' => json_encode($payload)]);

        return (int) $database->lastInsertId();
    }

    /**
     * @see App\Sandbox\SeedCalendar::shift()
     */
    public function test_shifting_by_thirty_days_moves_every_received_at_by_exactly_thirty_days(): void
    {
        $seededAt = $this->seededAt();
        $now = $seededAt->addDays(30);
        $cases = $this->column('cases', 'received_at');
        $mailbox = $this->column('mailbox_messages', 'received_at');

        $this->assertCount(16, $cases);
        $this->assertCount(43, $mailbox);

        (new SeedCalendar)->shift($this->path, $now);

        foreach (['cases' => $cases, 'mailbox_messages' => $mailbox] as $table => $before) {
            $after = $this->column($table, 'received_at');

            foreach ($before as $id => $value) {
                $this->assertSame(
                    CarbonImmutable::createFromFormat(self::FORMAT, $value)->addDays(30)->format(self::FORMAT),
                    $after[$id],
                    $table.' row '.$id,
                );
            }
        }

        $meta = $this->rows('installation_meta')[0];
        $this->assertSame($now->format(self::FORMAT), $meta['dates_shifted_to']);
        $this->assertSame($seededAt->format(self::FORMAT), $meta['seeded_at']);
    }

    /**
     * @see App\Sandbox\SeedCalendar::shift()
     */
    public function test_every_listed_column_moves_by_the_same_amount_and_nothing_else_changes(): void
    {
        $database = $this->open();
        $database->exec("insert into notifications (id, type, notifiable_type, notifiable_id, data, read_at, created_at, updated_at) values ('5b0c3e2a-0000-4000-8000-000000000001', 'App\\Notifications\\CaseCreated', 'App\\Models\\User', 1, '{}', '2026-10-02 10:00:00', '2026-10-02 09:00:00', '2026-10-02 09:30:00')");
        $database->exec("insert into notifications (id, type, notifiable_type, notifiable_id, data, read_at, created_at, updated_at) values ('5b0c3e2a-0000-4000-8000-000000000002', 'App\\Notifications\\CaseCreated', 'App\\Models\\User', 1, '{}', null, '2026-10-03 09:00:00', '2026-10-03 09:00:00')");
        $tables = $database->query("select name from sqlite_master where type = 'table' order by name")->fetchAll(Sqlite::FETCH_COLUMN);
        $seededAt = $this->pinSeed('2026-09-10 12:00:00');
        $before = array_combine($tables, array_map(fn (string $table): array => $this->rows($table), $tables));
        $offset = 4 * 86400 + 3 * 3600 + 25 * 60 + 9;

        (new SeedCalendar)->shift($this->path, $seededAt->addSeconds($offset));

        $nulls = 0;
        $moved = 0;

        foreach ($tables as $table) {
            $after = $this->rows($table);
            $this->assertCount(count($before[$table]), $after, $table);

            foreach ($before[$table] as $index => $row) {
                foreach ($row as $column => $value) {
                    $shifted = in_array($column, self::SHIFTED[$table] ?? [], true);

                    if ($shifted && $value === null) {
                        $nulls++;
                        $this->assertNull($after[$index][$column], $table.'.'.$column);
                    } elseif ($shifted) {
                        $moved++;
                        $this->assertSame($this->naive($value, $offset), $after[$index][$column], $table.'.'.$column);
                    } elseif ($table !== 'installation_meta' || $column !== 'dates_shifted_to') {
                        $this->assertSame($value, $after[$index][$column], $table.'.'.$column);
                    }
                }
            }
        }

        $this->assertGreaterThan(300, $moved);
        $this->assertGreaterThan(0, $nulls);
        $notificationId = '5b0c3e2a-0000-4000-8000-000000000001';
        $beforeReadAt = array_column($before['notifications'], 'read_at', 'id')[$notificationId];
        $this->assertSame('2026-10-02 10:00:00', $beforeReadAt);
        $this->assertSame($this->naive($beforeReadAt, $offset), $this->column('notifications', 'read_at')[$notificationId]);
    }

    /**
     * @see App\Sandbox\SeedCalendar::shift()
     */
    public function test_payload_dates_move_when_present_and_other_payloads_stay_byte_identical(): void
    {
        $seeded = $this->column('script_entries', 'payload');
        $dated = $this->insertScriptEntry(['thread_id' => 'thread-calendar', 'received_at' => '2026-10-01 08:30:00', 'sent_at' => '2026-10-02 09:00:00', 'body_text' => 'Kept / as "is" é']);
        $partial = $this->insertScriptEntry(['thread_id' => 'thread-calendar', 'received_at' => null, 'sent_at' => '2026-10-03 07:45:00']);

        (new SeedCalendar)->shift($this->path, $this->pinSeed('2026-09-10 12:00:00')->addDays(2)->addHours(3));

        $after = $this->column('script_entries', 'payload');

        foreach ($seeded as $id => $payload) {
            $this->assertSame($payload, $after[$id]);
        }

        $this->assertSame(
            ['thread_id' => 'thread-calendar', 'received_at' => '2026-10-03 11:30:00', 'sent_at' => '2026-10-04 12:00:00', 'body_text' => 'Kept / as "is" é'],
            json_decode($after[$dated], true),
        );
        $this->assertSame(
            ['thread_id' => 'thread-calendar', 'received_at' => null, 'sent_at' => '2026-10-05 10:45:00'],
            json_decode($after[$partial], true),
        );
        $this->assertSame(['2026-10-01 08:00:00', '2026-10-01 08:00:00'], array_values($this->open()->query("select created_at, updated_at from script_entries where id = {$dated}")->fetch(Sqlite::FETCH_ASSOC)));
    }

    /**
     * @see App\Sandbox\SeedCalendar::shift()
     */
    public function test_shifting_twice_to_the_same_now_equals_shifting_once(): void
    {
        $now = $this->pinSeed('2026-09-10 12:00:00')->addDays(5)->addMinutes(17);
        $tables = $this->open()->query("select name from sqlite_master where type = 'table' order by name")->fetchAll(Sqlite::FETCH_COLUMN);
        $calendar = new SeedCalendar;

        $calendar->shift($this->path, $now);
        $once = array_map(fn (string $table): array => $this->rows($table), $tables);
        $calendar->shift($this->path, $now);

        $this->assertSame($once, array_map(fn (string $table): array => $this->rows($table), $tables));

        $cases = $this->column('cases', 'received_at');
        $calendar->shift($this->path, $now->addHours(2));

        foreach ($this->column('cases', 'received_at') as $id => $value) {
            $this->assertSame($this->naive($cases[$id], 7200), $value);
        }

        $this->assertSame('2026-09-15 14:17:00', $this->rows('installation_meta')[0]['dates_shifted_to']);
        $this->assertSame('2026-09-10 12:00:00', $this->rows('installation_meta')[0]['seeded_at']);
    }

    /**
     * @see App\Sandbox\SeedCalendar::shift()
     */
    public function test_a_now_before_the_seed_moves_dates_back(): void
    {
        $cases = $this->column('cases', 'received_at');

        (new SeedCalendar)->shift($this->path, $this->pinSeed('2026-09-10 12:00:00')->subDays(3)->subMinutes(10));

        foreach ($this->column('cases', 'received_at') as $id => $value) {
            $this->assertSame($this->naive($cases[$id], -(3 * 86400 + 600)), $value);
        }

        $this->assertSame('2026-09-07 11:50:00', $this->rows('installation_meta')[0]['dates_shifted_to']);
    }

    /**
     * @see App\Sandbox\SeedCalendar::shift()
     */
    public function test_wall_clock_times_survive_a_daylight_saving_change_and_now_is_read_in_the_app_zone(): void
    {
        $this->pinSeed('2026-10-20 12:00:00');
        $this->open()->exec("update cases set received_at = '2026-10-20 23:15:00' where id = 1");

        (new SeedCalendar)->shift($this->path, CarbonImmutable::parse('2026-11-19 17:00:00', 'UTC'));

        $this->assertSame('2026-11-19 23:15:00', $this->column('cases', 'received_at')[1]);
        $this->assertSame('2026-11-19 12:00:00', $this->rows('installation_meta')[0]['dates_shifted_to']);
    }

    /**
     * @see App\Sandbox\SeedCalendar::shift()
     */
    public function test_a_bad_payload_date_rolls_the_whole_shift_back(): void
    {
        $this->insertScriptEntry(['thread_id' => 'thread-calendar', 'sent_at' => 'yesterday']);
        $cases = $this->column('cases', 'received_at');

        try {
            (new SeedCalendar)->shift($this->path, $this->seededAt()->addDay());
            $this->fail('A payload date in another format should stop the shift.');
        } catch (InvalidFormatException) {
            $this->assertSame($cases, $this->column('cases', 'received_at'));
            $this->assertNull($this->rows('installation_meta')[0]['dates_shifted_to']);
        }
    }

    /**
     * @see App\Sandbox\SeedCalendar::shift()
     */
    public function test_a_database_without_a_seed_time_is_refused(): void
    {
        $this->open()->exec('delete from installation_meta');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('has no installation_meta.seeded_at to shift from.');

        (new SeedCalendar)->shift($this->path, CarbonImmutable::now());
    }

    /**
     * @see App\Sandbox\SeedCalendar::shift()
     */
    public function test_a_missing_file_fails_and_is_not_created(): void
    {
        $missing = config('casefile.sandbox.directory').'/missing.sqlite';

        try {
            (new SeedCalendar)->shift($missing, CarbonImmutable::now());
            $this->fail('Shifting a missing file should fail.');
        } catch (PDOException) {
            $this->assertFileDoesNotExist($missing);
        }
    }
}
