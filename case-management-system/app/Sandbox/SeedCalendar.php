<?php

namespace App\Sandbox;

use Carbon\CarbonImmutable;
use Carbon\Exceptions\InvalidFormatException;
use Illuminate\Database\Eloquent\Casts\Json;
use Pdo\Sqlite;
use PDOException;
use RuntimeException;
use Throwable;

final class SeedCalendar
{
    private const string FORMAT = 'Y-m-d H:i:s';

    private const array COLUMNS = [
        'cases' => ['received_at', 'closed_at', 'created_at', 'updated_at'],
        'case_messages' => ['sent_at', 'created_at', 'updated_at'],
        'case_events' => ['occurred_at', 'created_at', 'updated_at'],
        'mailbox_messages' => ['received_at', 'created_at', 'updated_at'],
        'notifications' => ['created_at', 'updated_at', 'read_at'],
    ];

    private const array PAYLOAD_KEYS = ['received_at', 'sent_at'];

    /**
     * @param  string  $databasePath
     * @param  CarbonImmutable  $now
     * @return void
     *
     * @throws PDOException
     * @throws RuntimeException
     * @throws InvalidFormatException
     * @throws Throwable
     */
    public function shift(string $databasePath, CarbonImmutable $now): void
    {
        $database = new Sqlite('sqlite:'.$databasePath, null, null, [Sqlite::ATTR_OPEN_FLAGS => Sqlite::OPEN_READWRITE]);
        $meta = $database->query('select seeded_at, dates_shifted_to from installation_meta')->fetch(Sqlite::FETCH_ASSOC);
        $shiftedFrom = is_array($meta) ? ($meta['dates_shifted_to'] ?? $meta['seeded_at']) : null;

        if (! is_string($shiftedFrom)) {
            throw new RuntimeException('The database at '.$databasePath.' has no installation_meta.seeded_at to shift from.');
        }

        $target = $now->setTimezone(config('app.timezone'))->format(self::FORMAT);
        $seconds = $this->wallClock($target)->getTimestamp() - $this->wallClock($shiftedFrom)->getTimestamp();
        $modifier = sprintf('%+d seconds', $seconds);

        $database->beginTransaction();

        try {
            foreach (self::COLUMNS as $table => $columns) {
                $assignments = array_map(fn (string $column): string => sprintf('%1$s = datetime(%1$s, :modifier)', $column), $columns);
                $database->prepare(sprintf('update %s set %s', $table, implode(', ', $assignments)))->execute(['modifier' => $modifier]);
            }

            $updatePayload = $database->prepare('update script_entries set payload = :payload where id = :id');

            foreach ($database->query('select id, payload from script_entries order by id')->fetchAll(Sqlite::FETCH_ASSOC) as $entry) {
                $payload = Json::decode($entry['payload']);
                $dates = array_filter(
                    array_intersect_key($payload, array_flip(self::PAYLOAD_KEYS)),
                    fn (mixed $value): bool => $value !== null,
                );

                if ($dates === []) {
                    continue;
                }

                foreach ($dates as $key => $value) {
                    $payload[$key] = $this->wallClock($value)->addSeconds($seconds)->format(self::FORMAT);
                }

                $updatePayload->execute(['payload' => Json::encode($payload), 'id' => $entry['id']]);
            }

            $database->prepare('update installation_meta set dates_shifted_to = :target')->execute(['target' => $target]);
            $database->commit();
        } catch (Throwable $exception) {
            $database->rollBack();

            throw $exception;
        }
    }

    /**
     * @param  string  $value
     * @return CarbonImmutable
     *
     * @throws InvalidFormatException
     */
    private function wallClock(string $value): CarbonImmutable
    {
        return CarbonImmutable::createFromFormat(self::FORMAT, $value, 'UTC');
    }
}
