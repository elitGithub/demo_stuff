<?php

namespace Elsewhere;

final class VisitorStore
{
    private ?\PDO $database = null;

    /** @param string $path @param SandboxConfig $config @param Catalog $catalog @param \Closure $now @param bool $create */
    public function __construct(string $path, public readonly SandboxConfig $config, public readonly Catalog $catalog, public readonly \Closure $now, bool $create)
    {
        try {
            $options = [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_STRINGIFY_FETCHES => false, \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC];
            if (!$create) { $options[\Pdo\Sqlite::ATTR_OPEN_FLAGS] = \Pdo\Sqlite::OPEN_READWRITE; }
            $this->database = new \PDO('sqlite:'.$path, options: $options);
            $this->database->exec('PRAGMA busy_timeout = '.$config->lockWaitMilliseconds);
            if ($create) { $this->database->exec('PRAGMA page_size = '.$config->sqlitePageBytes); }
            $this->database->exec('PRAGMA journal_mode = DELETE');
            $this->database->exec('PRAGMA foreign_keys = ON');
            $this->database->exec('PRAGMA temp_store = MEMORY');
            $this->database->exec('PRAGMA max_page_count = '.intdiv($config->maxDatabaseBytes, $config->sqlitePageBytes));
            if ($create) {
                $dataDirectory = is_file(dirname(__DIR__).'/schema.sql') ? dirname(__DIR__) : dirname(__DIR__, 3).'/src';
                $schema = file_get_contents($dataDirectory.'/schema.sql');
                $seed = json_decode(file_get_contents($dataDirectory.'/demo-seed.json'), flags: JSON_THROW_ON_ERROR);
                $this->transaction(function () use ($schema, $seed): void {
                    $this->database->exec($schema);
                    $allocatedAt = ($this->now)();
                    $createdAt = gmdate('Y-m-d\TH:i:s', $allocatedAt).'.000Z';
                    foreach ($seed->enquiries as $enquiry) {
                        $this->query('INSERT INTO enquiries (id, reference, firstName, lastName, email, destination, journey, departure, travelers, budget, message, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [$enquiry->id, $enquiry->reference, $enquiry->firstName, $enquiry->lastName, $enquiry->email, $enquiry->destination, $enquiry->journey, gmdate('Y-m-d', $allocatedAt + $enquiry->departureDays * 86400), $enquiry->travelers, $enquiry->budget, $enquiry->message, $enquiry->status, $createdAt]);
                    }
                    foreach ($seed->bookings as $booking) {
                        $this->query('INSERT INTO bookings (id, reference, firstName, lastName, destination, journey, departure, travelers, value, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [$booking->id, $booking->reference, $booking->firstName, $booking->lastName, $booking->destination, $booking->journey, gmdate('Y-m-d', $allocatedAt + $booking->departureDays * 86400), $booking->travelers, $booking->value, $booking->status, $createdAt]);
                    }
                });
            }
        } catch (\Throwable $error) {
            $this->close();
            $failure = $this->failure($error);
            if ($failure instanceof DemoError) { throw $failure; }
            throw new DemoError('The sandbox database is unavailable.', 503, ErrorCode::Unavailable, previous: $error);
        }
    }

    /** @param string $sql @param array<int, mixed> $values @return \PDOStatement */
    public function query(string $sql, array $values): \PDOStatement
    {
        $statement = $this->database->prepare($sql);
        $statement->execute($values);
        return $statement;
    }

    /** @param EnquiryInput $input @return CreatedEnquiry */
    public function createEnquiry(EnquiryInput $input): CreatedEnquiry
    {
        return $this->transaction(function () use ($input): CreatedEnquiry {
            if ($this->database->query('SELECT count(*) FROM enquiries')->fetchColumn() >= $this->config->maxEnquiries) { throw new DemoError('Your demo workspace has reached its enquiry limit.', 409, ErrorCode::SandboxFull); }
            $reference = 'EW-'.strtoupper(bin2hex(random_bytes(4)));
            $this->query('INSERT INTO enquiries (reference, firstName, lastName, email, destination, journey, departure, travelers, budget, message, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [$reference, $input->firstName, $input->lastName, $input->email, $input->destination, $input->journey, $input->departure, $input->travelers, $input->budget, $input->message, EnquiryStatus::New->value, gmdate('Y-m-d\TH:i:s', ($this->now)()).'.000Z']);
            return new CreatedEnquiry(id: (int) $this->database->lastInsertId(), reference: $reference);
        });
    }

    /** @return Overview */
    public function overview(): Overview
    {
        $enquiries = [];
        foreach ($this->database->query('SELECT * FROM enquiries ORDER BY id DESC') as $row) {
            $enquiries[] = new EnquiryRecord(id: $row['id'], reference: $row['reference'], input: new EnquiryInput(firstName: $row['firstName'], lastName: $row['lastName'], email: $row['email'], destination: $row['destination'], journey: $row['journey'], departure: $row['departure'], travelers: $row['travelers'], budget: $row['budget'], message: $row['message']), status: EnquiryStatus::from($row['status']), createdAt: $row['createdAt']);
        }
        $bookings = [];
        foreach ($this->database->query('SELECT * FROM bookings ORDER BY id DESC') as $row) {
            $bookings[] = new BookingRecord(id: $row['id'], reference: $row['reference'], enquiryId: $row['enquiryId'], firstName: $row['firstName'], lastName: $row['lastName'], destination: $row['destination'], journey: $row['journey'], departure: $row['departure'], travelers: $row['travelers'], value: $row['value'], status: BookingStatus::from($row['status']), createdAt: $row['createdAt']);
        }
        return new Overview(enquiries: $enquiries, bookings: $bookings, catalog: $this->catalog);
    }

    /** @param StatusChange $command @return Acknowledgement */
    public function updateStatus(StatusChange $command): Acknowledgement
    {
        return $this->transaction(function () use ($command): Acknowledgement {
            $enquiry = $this->query('SELECT status FROM enquiries WHERE id = ?', [$command->id])->fetch();
            if ($enquiry === false) { throw new DemoError('Enquiry not found.', 404, ErrorCode::NotFound); }
            if ($enquiry['status'] === EnquiryStatus::Converted->value) { throw new DemoError('This enquiry already has a demo booking record.', 409, ErrorCode::Conflict); }
            $this->query('UPDATE enquiries SET status = ? WHERE id = ?', [$command->status->value, $command->id]);
            return new Acknowledgement();
        });
    }

    /** @param EnquiryId $command @return CreatedBooking */
    public function convert(EnquiryId $command): CreatedBooking
    {
        return $this->transaction(function () use ($command): CreatedBooking {
            $enquiry = $this->query('SELECT * FROM enquiries WHERE id = ?', [$command->id])->fetch();
            if ($enquiry === false) { throw new DemoError('Enquiry not found.', 404, ErrorCode::NotFound); }
            if ($enquiry['status'] === EnquiryStatus::Converted->value || $this->query('SELECT id FROM bookings WHERE enquiryId = ?', [$command->id])->fetch() !== false) { throw new DemoError('A demo booking already exists for this enquiry.', 409, ErrorCode::Conflict); }
            if ($this->database->query('SELECT count(*) FROM bookings')->fetchColumn() >= $this->config->maxEnquiries + 3) { throw new DemoError('Your demo workspace has reached its booking limit.', 409, ErrorCode::SandboxFull); }
            $reference = 'BK-'.strtoupper(bin2hex(random_bytes(4)));
            $price = 0;
            foreach ($this->catalog->journeys as $journey) { if ($journey->id === $enquiry['journey']) { $price = $journey->price; } }
            $this->query('INSERT INTO bookings (reference, enquiryId, firstName, lastName, destination, journey, departure, travelers, value, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [$reference, $command->id, $enquiry['firstName'], $enquiry['lastName'], $enquiry['destination'], $enquiry['journey'], $enquiry['departure'], $enquiry['travelers'], $price * $enquiry['travelers'], BookingStatus::Planning->value, gmdate('Y-m-d\TH:i:s', ($this->now)()).'.000Z']);
            $this->query('UPDATE enquiries SET status = ? WHERE id = ?', [EnquiryStatus::Converted->value, $command->id]);
            return new CreatedBooking(reference: $reference);
        });
    }

    /** @param \Closure $action @return mixed */
    public function transaction(\Closure $action): mixed
    {
        try {
            $this->database->exec('BEGIN IMMEDIATE');
            $result = $action();
            $this->database->exec('COMMIT');
            return $result;
        } catch (\Throwable $error) {
            if ($this->database->inTransaction()) { $this->database->exec('ROLLBACK'); }
            throw $this->failure($error);
        }
    }

    /** @param \Throwable $error @return \Throwable */
    public function failure(\Throwable $error): \Throwable
    {
        $code = $error instanceof \PDOException && isset($error->errorInfo[1]) ? $error->errorInfo[1] : null;
        if ($code === 13) { return new DemoError('Your demo workspace has reached its storage limit.', 409, ErrorCode::SandboxFull, previous: $error); }
        if ($code === 5) { return new DemoError('The demo is busy. Please try again.', 503, ErrorCode::Busy, 2); }
        return $error;
    }

    /** @return void */
    public function close(): void { $this->database = null; }
}
