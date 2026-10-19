<?php

require dirname(__DIR__, 2).'/site/private/autoload.php';

use Elsewhere\{SandboxConfig, Catalog, CatalogDestination, CatalogJourney, SandboxRuntime, RequestIdentity, SandboxOperation, EnquiryInput, EnquiryId, StatusChange, EnquiryStatus, DemoError, ErrorCode, VisitorStore, SandboxRecord};

set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    if ((error_reporting() & $severity) !== 0) { throw new ErrorException($message, 0, $severity, $file, $line); }
    return false;
});

final class SandboxRuntimeTest
{
    public int $clock = 2000000000;
    public int $assertions = 0;
    public readonly string $workspace;
    public readonly Catalog $catalog;

    /** @return void */
    public function __construct()
    {
        $this->workspace = dirname(__DIR__, 2).'/storage/test-runs/php-'.bin2hex(random_bytes(8));
        mkdir($this->workspace, 0700, true);
        $this->catalog = new Catalog(destinations: [new CatalogDestination(id: 'italy', name: 'Italy')], journeys: [new CatalogJourney(id: 'italian-slow-days', title: 'Italian Slow Days', destination: 'italy', price: 3250)], budgets: json_decode(file_get_contents(dirname(__DIR__, 2).'/site/private/enquiry-budgets.json'), flags: JSON_THROW_ON_ERROR));
    }

    /** @param array<string, int> $overrides @return SandboxConfig */
    public function config(array $overrides = []): SandboxConfig { return SandboxConfig::from((object) $overrides); }
    /** @param string $name @param ?SandboxConfig $config @return SandboxRuntime */
    public function runtime(string $name, ?SandboxConfig $config = null): SandboxRuntime
    {
        $root = $this->workspace.'/'.$name;
        if (!is_dir($root)) { mkdir($root, 0700); }
        return new SandboxRuntime(root: $root, config: $config ?? $this->config(), catalog: $this->catalog, now: fn (): int => $this->clock);
    }
    /** @param SandboxRuntime $runtime @param string $address @return RequestIdentity */
    public function visitor(SandboxRuntime $runtime, string $address = '127.0.0.1'): RequestIdentity
    {
        $bootstrap = $runtime->execute(SandboxOperation::BOOTSTRAP, new RequestIdentity(remoteAddress: $address));
        $this->check($bootstrap->payload->created && $bootstrap->payload->protocolVersion === 1 && $bootstrap->payload->pageSize === 20 && $bootstrap->payload->idleSeconds === $runtime->config->idleSeconds, 'bootstrap protocol');
        return new RequestIdentity(remoteAddress: $address, sandboxToken: $bootstrap->cookies[0]->value, contextToken: $bootstrap->payload->csrfToken);
    }
    /** @param SandboxRuntime $runtime @param RequestIdentity $identity @return RequestIdentity */
    public function login(SandboxRuntime $runtime, RequestIdentity $identity): RequestIdentity
    {
        $result = $runtime->execute(SandboxOperation::LOGIN, $identity);
        return new RequestIdentity(remoteAddress: $identity->remoteAddress, sandboxToken: $identity->sandboxToken, dashboardToken: $result->cookies[1]->value, contextToken: $identity->contextToken);
    }
    /** @param string $message @return EnquiryInput */
    public function input(string $message = 'Fictional enquiry'): EnquiryInput { return new EnquiryInput(firstName: 'Taylor', lastName: 'Demo', email: 'taylor@travel.example', destination: 'italy', journey: 'italian-slow-days', departure: '', travelers: 2, budget: '', message: $message); }
    /** @param bool $condition @param string $description @return void */
    public function check(bool $condition, string $description): void { if (!$condition) { throw new RuntimeException($description); } $this->assertions++; }
    /** @param \Closure $action @param ErrorCode $expected @return DemoError */
    public function failure(Closure $action, ErrorCode $expected): DemoError
    {
        try { $action(); } catch (DemoError $error) { $this->check($error->errorCode === $expected, 'Expected '.$expected->value.', got '.$error->errorCode->value.': '.$error); return $error; }
        throw new RuntimeException('Expected '.$expected->value);
    }
    /** @param SandboxRuntime $runtime @param RequestIdentity $identity @return string */
    public function databasePath(SandboxRuntime $runtime, RequestIdentity $identity): string { return $runtime->root.'/'.hash('sha256', $identity->sandboxToken).'.sqlite'; }
    /** @param SandboxRuntime $runtime @return object */
    public function registry(SandboxRuntime $runtime): object
    {
        $database = new PDO('sqlite:'.$runtime->root.'/registry.sqlite', options: [Pdo\Sqlite::ATTR_OPEN_FLAGS => Pdo\Sqlite::OPEN_READONLY, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        $sandboxes = [];
        foreach ($database->query('SELECT digest, csrfToken, dashboardDigest, lastActivity FROM sandboxes ORDER BY rowid') as $row) {
            $sandboxes[$row['digest']] = new SandboxRecord(digest: $row['digest'], csrfToken: $row['csrfToken'], dashboardDigest: $row['dashboardDigest'], lastActivity: $row['lastActivity']);
        }
        $rateBuckets = [];
        foreach ($database->query('SELECT key, hits, expiresAt FROM rate_buckets ORDER BY key', PDO::FETCH_OBJ) as $bucket) { $rateBuckets[$bucket->key] = $bucket; }
        return (object) ['sandboxes' => $sandboxes, 'rateBuckets' => $rateBuckets];
    }
    /** @param SandboxRuntime $runtime @param SandboxRecord $record @return void */
    public function save(SandboxRuntime $runtime, SandboxRecord $record): void
    {
        $database = new PDO('sqlite:'.$runtime->root.'/registry.sqlite', options: [Pdo\Sqlite::ATTR_OPEN_FLAGS => Pdo\Sqlite::OPEN_READWRITE]);
        $statement = $database->prepare('UPDATE sandboxes SET csrfToken = ?, dashboardDigest = ?, lastActivity = ? WHERE digest = ?');
        $statement->execute([$record->csrfToken, $record->dashboardDigest, $record->lastActivity, $record->digest]);
        $this->check($statement->rowCount() === 1, 'fixture registry row saved');
    }

    /** @return void */
    public function lifecycle(): void
    {
        $runtime = $this->runtime('lifecycle');
        $first = $this->login($runtime, $this->visitor($runtime));
        $second = $this->login($runtime, $this->visitor($runtime, '127.0.0.2'));
        $initial = $runtime->execute(SandboxOperation::OVERVIEW, $first)->payload;
        $encoded = json_decode(json_encode($initial, JSON_THROW_ON_ERROR), flags: JSON_THROW_ON_ERROR);
        $this->check(count($encoded->enquiries) === 4 && count($encoded->bookings) === 3 && is_int($encoded->enquiries[0]->id) && is_int($encoded->bookings[0]->value), 'seed counts and JSON types');
        $this->check($encoded->enquiries[3]->departure === gmdate('Y-m-d', $this->clock + 75 * 86400), 'relative seed date');
        $this->check($encoded->bookings[0]->enquiryId === null && !isset($encoded->catalog->journeys[0]->price) && !isset($encoded->catalog->budgets), 'wire field parity');
        $created = $runtime->execute(SandboxOperation::CREATE_ENQUIRY, $first, $this->input())->payload;
        $this->check($created->id === 5 && preg_match('/^EW-[A-F0-9]{8}$/D', $created->reference) === 1, 'created record wire contract');
        $this->check(count($runtime->execute(SandboxOperation::OVERVIEW, $second)->payload->enquiries) === 4, 'two contexts isolated');
        $runtime->execute(SandboxOperation::UPDATE_STATUS, $first, new StatusChange(id: 5, status: EnquiryStatus::Contacted));
        $runtime->execute(SandboxOperation::CREATE_BOOKING, $first, new EnquiryId(id: 5));
        $this->clock += 10;
        $conflict = $this->failure(fn () => $runtime->execute(SandboxOperation::CREATE_BOOKING, $first, new EnquiryId(id: 5)), ErrorCode::Conflict);
        $this->check(count($conflict->cookies) === 2 && $this->registry($runtime)->sandboxes[hash('sha256', $first->sandboxToken)]->lastActivity === $this->clock, 'admitted business error renews cookie and lease');
        $this->failure(fn () => $runtime->execute(SandboxOperation::UPDATE_STATUS, $first, new StatusChange(id: 5, status: EnquiryStatus::New)), ErrorCode::Conflict);
        $this->failure(fn () => $runtime->execute(SandboxOperation::CREATE_BOOKING, $first, new EnquiryId(id: 999)), ErrorCode::NotFound);
        $logout = $runtime->execute(SandboxOperation::LOGOUT, $first);
        $this->check($logout->cookies[1]->maxAge === 0 && $logout->cookies[1]->name === $runtime->config->dashboardCookie, 'logout clears dashboard only');
        $this->failure(fn () => $runtime->execute(SandboxOperation::OVERVIEW, $first), ErrorCode::DashboardAccess);
        $restarted = $this->runtime('lifecycle');
        $first = $this->login($restarted, $first);
        $this->check(count($restarted->execute(SandboxOperation::OVERVIEW, $first)->payload->enquiries) === 5, 'restart/logout retain records');
        $forged = new RequestIdentity(remoteAddress: '127.0.0.1', sandboxToken: $second->sandboxToken, dashboardToken: $first->dashboardToken, contextToken: $second->contextToken);
        $this->failure(fn () => $runtime->execute(SandboxOperation::OVERVIEW, $forged), ErrorCode::DashboardAccess);
        $stale = new RequestIdentity(remoteAddress: '127.0.0.1', sandboxToken: $second->sandboxToken, dashboardToken: $second->dashboardToken, contextToken: $first->contextToken);
        $before = $this->registry($runtime)->sandboxes[hash('sha256', $second->sandboxToken)]->lastActivity;
        $this->clock += 5;
        $this->failure(fn () => $runtime->execute(SandboxOperation::OVERVIEW, $stale), ErrorCode::SandboxContext);
        $this->check($this->registry($runtime)->sandboxes[hash('sha256', $second->sandboxToken)]->lastActivity === $before, 'rejected generation does not renew');
    }

    /** @return void */
    public function loginRotationRejectsOldAuthorization(): void
    {
        $runtime = $this->runtime('login-rotation');
        $original = $this->login($runtime, $this->visitor($runtime));
        $this->clock++;
        $current = $this->login($runtime, $original);
        $this->check($current->dashboardToken !== $original->dashboardToken, 'authorized login rotates dashboard token');
        $digest = hash('sha256', $current->sandboxToken);
        $path = $this->databasePath($runtime, $current);
        $databaseBefore = file_get_contents($path);
        $registryBefore = $this->registry($runtime);
        $leaseBefore = $registryBefore->sandboxes[$digest]->lastActivity;
        $this->clock += 10;
        $error = $this->failure(fn () => $runtime->execute(SandboxOperation::UPDATE_STATUS, $original, new StatusChange(id: 1, status: EnquiryStatus::Contacted)), ErrorCode::DashboardAccess);
        $this->check($error->cookies === [] && $this->registry($runtime)->sandboxes[$digest]->lastActivity === $leaseBefore, 'superseded dashboard token cannot renew lease or cookies');
        $this->check(file_get_contents($path) === $databaseBefore && $this->registry($runtime) == $registryBefore, 'superseded dashboard token cannot mutate registry or database');
        $overview = $runtime->execute(SandboxOperation::OVERVIEW, $current)->payload;
        $this->check($overview->enquiries[3]->status === EnquiryStatus::New, 'current rotated token retains access and original record status');
    }

    /** @return void */
    public function exactRateWindowBoundary(): void
    {
        $runtime = $this->runtime('rate-boundary', $this->config(['allocationLimit' => 1, 'loginLimit' => 1, 'enquiryLimit' => 1]));
        $startedAt = $this->clock;
        $identity = $this->login($runtime, $this->visitor($runtime));
        $runtime->execute(SandboxOperation::CREATE_ENQUIRY, $identity, $this->input());
        $path = $this->databasePath($runtime, $identity);
        $databaseBefore = file_get_contents($path);
        $registryBefore = $this->registry($runtime);
        $this->clock = $startedAt + $runtime->config->rateWindowSeconds - 1;
        $actions = [
            fn () => $runtime->execute(SandboxOperation::BOOTSTRAP, new RequestIdentity(remoteAddress: $identity->remoteAddress)),
            fn () => $runtime->execute(SandboxOperation::LOGIN, $identity),
            fn () => $runtime->execute(SandboxOperation::CREATE_ENQUIRY, $identity, $this->input()),
        ];
        foreach ($actions as $action) {
            $error = $this->failure($action, ErrorCode::RateLimited);
            $this->check($error->retryAfter === 1 && $error->cookies === [], 'rate action denied one second before exact rollover');
        }
        $this->check(file_get_contents($path) === $databaseBefore && $this->registry($runtime) == $registryBefore, 'rate-window denials preserve lease, buckets and database');
        $this->clock++;
        $this->visitor($runtime);
        $identity = $this->login($runtime, $identity);
        $created = $runtime->execute(SandboxOperation::CREATE_ENQUIRY, $identity, $this->input())->payload;
        $this->check($created->id === 6, 'enquiry admitted exactly at rate-window expiry');
        $registry = $this->registry($runtime);
        $this->check(count($registry->rateBuckets) === 3, 'exact rollover preserves separate action buckets');
        foreach ($registry->rateBuckets as $bucket) {
            $this->check($bucket->hits === 1 && $bucket->expiresAt === $startedAt + 2 * $runtime->config->rateWindowSeconds, 'new fixed rate window starts with exactly one hit');
        }
    }

    /** @return void */
    public function expiredTargetOutsideCleanupBatch(): void
    {
        $runtime = $this->runtime('expiry-beyond-cleanup');
        $visitors = [];
        for ($index = 0; $index < 12; $index++) { $visitors[] = $this->login($runtime, $this->visitor($runtime, '192.0.2.'.($index + 1))); }
        $target = $visitors[11];
        $digest = hash('sha256', $target->sandboxToken);
        $path = $this->databasePath($runtime, $target);
        $targetBefore = $this->registry($runtime)->sandboxes[$digest];
        $databaseBefore = file_get_contents($path);
        $this->clock += $runtime->config->idleSeconds - 1;
        $live = $this->login($runtime, $this->visitor($runtime, '192.0.2.13'));
        $livePath = $this->databasePath($runtime, $live);
        $liveBefore = file_get_contents($livePath);
        $this->clock++;
        $error = $this->failure(fn () => $runtime->execute(SandboxOperation::UPDATE_STATUS, $target, new StatusChange(id: 1, status: EnquiryStatus::Contacted)), ErrorCode::SandboxContext);
        $registry = $this->registry($runtime);
        $this->check(count($registry->sandboxes) === 3 && isset($registry->sandboxes[$digest]) && is_file($path), 'expired target remains physically present beyond ten-item cleanup batch');
        $this->check($registry->sandboxes[$digest] == $targetBefore && $error->cookies === [], 'expired undeleted target cannot renew lease or authorization');
        $this->check(file_get_contents($path) === $databaseBefore && file_get_contents($livePath) === $liveBefore, 'expired target request mutates neither expired nor live database');
    }

    /** @return void */
    public function expiry(): void
    {
        $runtime = $this->runtime('expiry');
        $identity = $this->login($runtime, $this->visitor($runtime));
        $this->clock += 14399;
        $runtime->execute(SandboxOperation::OVERVIEW, $identity);
        $this->clock += 14399;
        $this->check(!$runtime->execute(SandboxOperation::BOOTSTRAP, $identity)->payload->created, 'sliding lease admitted at boundary minus one');
        $this->clock += 14400;
        $this->failure(fn () => $runtime->execute(SandboxOperation::OVERVIEW, $identity), ErrorCode::SandboxContext);
        $fresh = $runtime->execute(SandboxOperation::BOOTSTRAP, $identity);
        $this->check($fresh->payload->created && $fresh->payload->csrfToken !== $identity->contextToken, 'exact expiry requires new allocation');
    }

    /** @return void */
    public function limits(): void
    {
        $runtime = $this->runtime('limits', $this->config(['maxSandboxes' => 2, 'maxEnquiries' => 4]));
        $first = $this->visitor($runtime);
        $this->visitor($runtime);
        $this->failure(fn () => $this->visitor($runtime), ErrorCode::Capacity);
        $this->failure(fn () => $runtime->execute(SandboxOperation::CREATE_ENQUIRY, $first, $this->input()), ErrorCode::SandboxFull);
        $rate = $this->runtime('rates', $this->config(['allocationLimit' => 1, 'loginLimit' => 1, 'enquiryLimit' => 1]));
        $identity = $this->visitor($rate);
        $blocked = $this->failure(fn () => $this->visitor($rate), ErrorCode::RateLimited);
        $this->check($blocked->retryAfter === 3600 && $blocked->cookies === [], 'allocation limit survives reset');
        $identity = $this->login($rate, $identity);
        $this->failure(fn () => $rate->execute(SandboxOperation::LOGIN, $identity), ErrorCode::RateLimited);
        $rate->execute(SandboxOperation::CREATE_ENQUIRY, $identity, $this->input());
        $lease = $this->registry($rate)->sandboxes[hash('sha256', $identity->sandboxToken)]->lastActivity;
        $this->clock++;
        $this->failure(fn () => $rate->execute(SandboxOperation::CREATE_ENQUIRY, $identity, $this->input()), ErrorCode::RateLimited);
        $this->check($this->registry($rate)->sandboxes[hash('sha256', $identity->sandboxToken)]->lastActivity === $lease, 'rate denial has no activity');
        $buckets = $this->runtime('buckets', $this->config(['maxRateBuckets' => 1]));
        $this->visitor($buckets);
        $this->failure(fn () => $this->visitor($buckets, '127.0.0.2'), ErrorCode::RateLimited);
        $this->check(count($this->registry($buckets)->rateBuckets) === 1, 'bucket cap retains live limits');
        $quota = $this->runtime('quota', $this->config(['maxDatabaseBytes' => 32768, 'enquiryLimit' => 100]));
        $owner = $this->login($quota, $this->visitor($quota));
        $filled = false;
        for ($index = 0; $index < 96; $index++) {
            try { $quota->execute(SandboxOperation::CREATE_ENQUIRY, $owner, $this->input(str_repeat('界', 2000))); }
            catch (DemoError $error) { $this->check($error->errorCode === ErrorCode::SandboxFull, 'multibyte page cap maps only quota'); $filled = true; break; }
        }
        $this->check($filled, 'small page cap reached');
        $this->check(filesize($this->databasePath($quota, $owner)) <= 32768, 'database never exceeds page cap');
    }

    /** @return void */
    public function cleanup(): void
    {
        $runtime = $this->runtime('cleanup');
        $digests = [];
        for ($index = 0; $index < 12; $index++) { $digests[] = hash('sha256', $this->visitor($runtime, '127.0.0.'.($index + 1))->sandboxToken); }
        $this->clock += 14400;
        $fresh = $this->visitor($runtime);
        $freshDigest = hash('sha256', $fresh->sandboxToken);
        $this->check(array_keys($this->registry($runtime)->sandboxes) === [$digests[10], $digests[11], $freshDigest], 'cleanup deletes the ten oldest rows and no more per request');
        foreach (array_slice($digests, 0, 10) as $digest) { $this->check(!file_exists($runtime->root.'/'.$digest.'.sqlite'), 'cleanup deletes expired visitor file'); }
        $this->check(count(glob($runtime->root.'/*')) === 4 && is_file($runtime->root.'/'.$digests[10].'.sqlite') && is_file($runtime->root.'/'.$freshDigest.'.sqlite'), 'only registry and remaining visitor files stay');
        $this->check(!$runtime->execute(SandboxOperation::BOOTSTRAP, $fresh)->payload->created, 'live sandbox renewed during cleanup');
        $this->check(array_keys($this->registry($runtime)->sandboxes) === [$freshDigest] && glob($runtime->root.'/*') === [$runtime->root.'/'.$freshDigest.'.sqlite', $runtime->root.'/registry.sqlite'], 'remaining expired rows and files reclaimed by the next request');
    }

    /** @return void */
    public function storeBoundaries(): void
    {
        $root = $this->workspace.'/stores'; mkdir($root, 0700);
        $path = $root.'/missing.sqlite';
        $this->failure(fn () => new VisitorStore(path: $path, config: $this->config(), catalog: $this->catalog, now: fn (): int => $this->clock, create: false), ErrorCode::Unavailable);
        $this->check(!file_exists($path), 'open missing never creates a database');
        $path = $root.'/first.sqlite';
        $store = new VisitorStore(path: $path, config: $this->config(), catalog: $this->catalog, now: fn (): int => $this->clock, create: true);
        $first = $store->overview(); $store->close();
        $before = file_get_contents($path);
        $this->failure(fn () => new VisitorStore(path: $path, config: $this->config(), catalog: $this->catalog, now: fn (): int => $this->clock, create: true), ErrorCode::Unavailable);
        $this->check(file_get_contents($path) === $before, 'create refuses existing database byte-identically');
        $later = new VisitorStore(path: $root.'/later.sqlite', config: $this->config(), catalog: $this->catalog, now: fn (): int => $this->clock + 86400, create: true);
        $this->check(strtotime($later->overview()->enquiries[3]->input->departure) - strtotime($first->enquiries[3]->input->departure) === 86400, 'later seed clock moves departures exactly one day');
        $later->close();
        foreach ($first->enquiries as $enquiry) { $this->check(str_ends_with($enquiry->input->email, '.example'), 'seed email reserved domain'); }
        $store = new VisitorStore(path: $path, config: $this->config(), catalog: $this->catalog, now: fn (): int => $this->clock, create: false);
        $database = new PDO('sqlite:'.$path);
        $database->exec("CREATE TRIGGER abort_status BEFORE UPDATE OF status ON enquiries WHEN NEW.status = 'converted' BEGIN SELECT RAISE(ABORT, 'fixture rejected update'); END");
        $database = null;
        try { $store->convert(new EnquiryId(id: 1)); throw new RuntimeException('Expected forced failure after booking insert.'); }
        catch (PDOException $error) { $this->check($error->errorInfo[1] === 19, 'non-quota error remains original SQLite error'); }
        $view = $store->overview();
        $this->check(count($view->bookings) === 3 && $view->enquiries[3]->status === EnquiryStatus::New, 'failure after insert rolls back booking and status together');
        $store->close();
    }

    /** @return void */
    public function validation(): void
    {
        $validator = new Elsewhere\EnquiryValidator(catalog: $this->catalog, now: fn (): int => $this->clock);
        $raw = (object) [...$this->input()->jsonSerialize(), 'consent' => true];
        $raw->firstName = str_repeat('界', 60);
        $raw->message = str_repeat('界', 2000);
        $this->check($validator->validate($raw)->firstName === $raw->firstName, 'Unicode code-point limits');
        foreach (['firstName' => str_repeat('界', 61), 'message' => str_repeat('界', 2001), 'departure' => '2099-02-30', 'email' => 'invalid', 'travelers' => '2', 'consent' => false] as $key => $value) {
            $invalid = clone $raw; $invalid->$key = $value;
            $this->failure(fn () => $validator->validate($invalid), ErrorCode::Validation);
        }
        $this->failure(fn () => new EnquiryId(id: 9007199254740992), ErrorCode::Validation);
        $this->failure(fn () => new StatusChange(id: 1, status: EnquiryStatus::Converted), ErrorCode::Validation);
        $raw->firstName = "\u{0085}Taylor\u{0085}";
        $raw->travelers = 2.0;
        $this->check($validator->validate($raw)->firstName === $raw->firstName && $validator->validate($raw)->travelers === 2, 'ECMAScript whitespace and integer-valued JSON numbers');
    }

    /** @return void */
    public function missingVisitorFileIsUnavailable(): void
    {
        $runtime = $this->runtime('missing-visitor-file');
        $identity = $this->login($runtime, $this->visitor($runtime));
        $path = $this->databasePath($runtime, $identity);
        unlink($path);
        $error = $this->failure(fn () => $runtime->execute(SandboxOperation::OVERVIEW, $identity), ErrorCode::Unavailable);
        $this->check($error->status === 503 && $error->getPrevious() !== null && !file_exists($path), 'missing live visitor file is unavailable and not recreated');
        $this->failure(fn () => $runtime->execute(SandboxOperation::CREATE_ENQUIRY, $identity, $this->input()), ErrorCode::Unavailable);
        $this->check(!file_exists($path) && !file_exists($path.'-journal'), 'write to missing visitor file never recreates it');
    }

    /** @return void */
    public function busyRegistryReturnsBusy(): void
    {
        $runtime = $this->runtime('busy-registry', $this->config(['busyTimeoutMilliseconds' => 200]));
        $identity = $this->visitor($runtime);
        $holder = new PDO('sqlite:'.$runtime->root.'/registry.sqlite');
        $holder->exec('BEGIN IMMEDIATE');
        $started = hrtime(true);
        $error = $this->failure(fn () => $runtime->execute(SandboxOperation::BOOTSTRAP, $identity), ErrorCode::Busy);
        $elapsed = intdiv(hrtime(true) - $started, 1000000);
        $this->check($error->status === 503 && $error->retryAfter === 2 && $error->cookies === [], 'held registry write lock maps to busy with retry');
        $this->check($elapsed >= 150 && $elapsed < 2000, 'registry busy wait bounded by configured timeout');
        $holder->exec('ROLLBACK');
        $holder = null;
        $this->check(!$runtime->execute(SandboxOperation::BOOTSTRAP, $identity)->payload->created, 'released registry lock admits the live sandbox');
    }

    /** @return void */
    public function busyVisitorDatabaseReturnsBusy(): void
    {
        $runtime = $this->runtime('busy-visitor', $this->config(['busyTimeoutMilliseconds' => 200]));
        $identity = $this->login($runtime, $this->visitor($runtime));
        $holder = new PDO('sqlite:'.$this->databasePath($runtime, $identity));
        $holder->exec('BEGIN IMMEDIATE');
        $this->clock++;
        $error = $this->failure(fn () => $runtime->execute(SandboxOperation::CREATE_ENQUIRY, $identity, $this->input()), ErrorCode::Busy);
        $this->check($error->status === 503 && $error->retryAfter === 2 && count($error->cookies) === 2, 'held visitor write lock maps to busy with renewed cookies');
        $this->check($this->registry($runtime)->sandboxes[hash('sha256', $identity->sandboxToken)]->lastActivity === $this->clock, 'registry renewal committed before visitor operation');
        $holder->exec('ROLLBACK');
        $holder = null;
        $this->check($runtime->execute(SandboxOperation::CREATE_ENQUIRY, $identity, $this->input())->payload->id === 5, 'released visitor lock admits the write');
    }

    /** @return void */
    public function failedFileDeleteIsLoggedAndRowRemoved(): void
    {
        $runtime = $this->runtime('failed-delete');
        $expired = $this->visitor($runtime);
        $digest = hash('sha256', $expired->sandboxToken);
        $path = $this->databasePath($runtime, $expired);
        unlink($path);
        mkdir($path, 0700);
        file_put_contents($path.'/occupant', 'FICTIONAL ORPHAN SENTINEL');
        $record = $this->registry($runtime)->sandboxes[$digest];
        $this->save($runtime, new SandboxRecord(digest: $record->digest, csrfToken: $record->csrfToken, dashboardDigest: $record->dashboardDigest, lastActivity: $this->clock - $runtime->config->idleSeconds));
        $log = $this->workspace.'/failed-delete.log';
        $previousLog = ini_set('error_log', $log);
        try { $other = $this->visitor($runtime, '127.0.0.2'); } finally { ini_set('error_log', $previousLog); }
        $registry = $this->registry($runtime);
        $this->check(array_keys($registry->sandboxes) === [hash('sha256', $other->sandboxToken)], 'expired row removed and request succeeds despite failed file delete');
        $this->check(is_dir($path) && str_contains(file_get_contents($log), 'Sandbox cleanup failed'), 'failed file delete logged and orphan left in place');
        $this->failure(fn () => $runtime->execute(SandboxOperation::CREATE_ENQUIRY, $expired, $this->input()), ErrorCode::SandboxContext);
        $fresh = $runtime->execute(SandboxOperation::BOOTSTRAP, $expired);
        $this->check($fresh->payload->created && hash('sha256', $fresh->cookies[0]->value) !== $digest, 'orphaned file never reattached');
    }

    /** @return void */
    public function invalidRootFailsAtConstruction(): void
    {
        foreach (['', 'relative/sandboxes', $this->workspace.'/../escape', '/'.basename($this->workspace).'/..'] as $root) {
            try { new SandboxRuntime(root: $root, config: $this->config(), catalog: $this->catalog, now: fn (): int => $this->clock); }
            catch (TypeError $error) { $this->check($error->getMessage() === 'Explicit absolute runtime root required.', 'invalid sandbox root rejected at construction: '.$root); continue; }
            throw new RuntimeException('Expected invalid sandbox root rejection: '.$root);
        }
        $this->check(!file_exists(dirname($this->workspace).'/escape'), 'rejected traversal root creates nothing');
    }

    /** @param string $directory @return void */
    public function removeFixture(string $directory): void
    {
        foreach (new FilesystemIterator($directory) as $entry) {
            if ($entry->isDir() && !$entry->isLink()) { chmod($entry->getPathname(), 0700); $this->removeFixture($entry->getPathname()); }
            else { unlink($entry->getPathname()); }
        }
        rmdir($directory);
    }
}

$tests = new SandboxRuntimeTest();
try {
    foreach (['lifecycle', 'loginRotationRejectsOldAuthorization', 'exactRateWindowBoundary', 'expiredTargetOutsideCleanupBatch', 'expiry', 'limits', 'cleanup', 'validation', 'storeBoundaries', 'missingVisitorFileIsUnavailable', 'busyRegistryReturnsBusy', 'busyVisitorDatabaseReturnsBusy', 'failedFileDeleteIsLoggedAndRowRemoved', 'invalidRootFailsAtConstruction'] as $method) { $tests->$method(); echo 'PASS '.$method.PHP_EOL; }
    echo $tests->assertions.' PHP runtime assertions passed.'.PHP_EOL;
} finally { $tests->removeFixture($tests->workspace); }
