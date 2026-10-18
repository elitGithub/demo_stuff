<?php

require dirname(__DIR__, 2).'/deploy/infinityfree/autoload.php';

use Elsewhere\{SandboxConfig, Catalog, CatalogDestination, CatalogJourney, SandboxRuntime, RequestIdentity, SandboxOperation, EnquiryInput, EnquiryId, StatusChange, EnquiryStatus, DemoError, ErrorCode, VisitorStore, SandboxRecord, SandboxState, Registry, RateBucket};

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
        $this->catalog = new Catalog(destinations: [new CatalogDestination(id: 'italy', name: 'Italy')], journeys: [new CatalogJourney(id: 'italian-slow-days', title: 'Italian Slow Days', destination: 'italy', price: 3250)], budgets: json_decode(file_get_contents(dirname(__DIR__, 2).'/config/enquiry-budgets.json'), flags: JSON_THROW_ON_ERROR));
    }

    /** @param array<string, int> $overrides @return SandboxConfig */
    public function config(array $overrides = []): SandboxConfig { return SandboxConfig::from((object) $overrides); }
    /** @param string $name @param ?SandboxConfig $config @return SandboxRuntime */
    public function runtime(string $name, ?SandboxConfig $config = null): SandboxRuntime { return new SandboxRuntime(root: $this->workspace.'/'.$name, config: $config ?? $this->config(), catalog: $this->catalog, now: fn (): int => $this->clock); }
    /** @param SandboxRuntime $runtime @param string $address @return RequestIdentity */
    public function visitor(SandboxRuntime $runtime, string $address = '127.0.0.1'): RequestIdentity
    {
        $bootstrap = $runtime->execute(SandboxOperation::Bootstrap, new RequestIdentity(remoteAddress: $address));
        $this->check($bootstrap->payload->created && $bootstrap->payload->protocolVersion === 1 && $bootstrap->payload->pageSize === 20 && $bootstrap->payload->idleSeconds === $runtime->config->idleSeconds, 'bootstrap protocol');
        return new RequestIdentity(remoteAddress: $address, sandboxToken: $bootstrap->cookies[0]->value, contextToken: $bootstrap->payload->csrfToken);
    }
    /** @param SandboxRuntime $runtime @param RequestIdentity $identity @return RequestIdentity */
    public function login(SandboxRuntime $runtime, RequestIdentity $identity): RequestIdentity
    {
        $result = $runtime->execute(SandboxOperation::Login, $identity);
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
    /** @param SandboxRuntime $runtime @return Registry */
    public function registry(SandboxRuntime $runtime): Registry
    {
        $lock = $runtime->registry->acquire();
        try { return $runtime->registry->load(); } finally { flock($lock, LOCK_UN); fclose($lock); }
    }
    /** @param SandboxRuntime $runtime @param Registry $registry @return void */
    public function save(SandboxRuntime $runtime, Registry $registry): void
    {
        $lock = $runtime->registry->acquire();
        try { $runtime->registry->save($registry); } finally { flock($lock, LOCK_UN); fclose($lock); }
    }

    /** @return void */
    public function lifecycle(): void
    {
        $runtime = $this->runtime('lifecycle');
        $first = $this->login($runtime, $this->visitor($runtime));
        $second = $this->login($runtime, $this->visitor($runtime, '127.0.0.2'));
        $initial = $runtime->execute(SandboxOperation::Overview, $first)->payload;
        $encoded = json_decode(json_encode($initial, JSON_THROW_ON_ERROR), flags: JSON_THROW_ON_ERROR);
        $this->check(count($encoded->enquiries) === 4 && count($encoded->bookings) === 3 && is_int($encoded->enquiries[0]->id) && is_int($encoded->bookings[0]->value), 'seed counts and JSON types');
        $this->check($encoded->enquiries[3]->departure === gmdate('Y-m-d', $this->clock + 75 * 86400), 'relative seed date');
        $this->check($encoded->bookings[0]->enquiryId === null && !isset($encoded->catalog->journeys[0]->price) && !isset($encoded->catalog->budgets), 'wire field parity');
        $created = $runtime->execute(SandboxOperation::CreateEnquiry, $first, $this->input())->payload;
        $this->check($created->id === 5 && preg_match('/^EW-[A-F0-9]{8}$/D', $created->reference) === 1, 'created record wire contract');
        $this->check(count($runtime->execute(SandboxOperation::Overview, $second)->payload->enquiries) === 4, 'two contexts isolated');
        $runtime->execute(SandboxOperation::UpdateStatus, $first, new StatusChange(id: 5, status: EnquiryStatus::Contacted));
        $runtime->execute(SandboxOperation::CreateBooking, $first, new EnquiryId(id: 5));
        $this->clock += 10;
        $conflict = $this->failure(fn () => $runtime->execute(SandboxOperation::CreateBooking, $first, new EnquiryId(id: 5)), ErrorCode::Conflict);
        $this->check(count($conflict->cookies) === 2 && $this->registry($runtime)->sandboxes[hash('sha256', $first->sandboxToken)]->lastActivity === $this->clock, 'admitted business error renews cookie and lease');
        $this->failure(fn () => $runtime->execute(SandboxOperation::UpdateStatus, $first, new StatusChange(id: 5, status: EnquiryStatus::New)), ErrorCode::Conflict);
        $this->failure(fn () => $runtime->execute(SandboxOperation::CreateBooking, $first, new EnquiryId(id: 999)), ErrorCode::NotFound);
        $logout = $runtime->execute(SandboxOperation::Logout, $first);
        $this->check($logout->cookies[1]->maxAge === 0 && $logout->cookies[1]->name === $runtime->config->dashboardCookie, 'logout clears dashboard only');
        $this->failure(fn () => $runtime->execute(SandboxOperation::Overview, $first), ErrorCode::DashboardAccess);
        $restarted = $this->runtime('lifecycle');
        $first = $this->login($restarted, $first);
        $this->check(count($restarted->execute(SandboxOperation::Overview, $first)->payload->enquiries) === 5, 'restart/logout retain records');
        $forged = new RequestIdentity(remoteAddress: '127.0.0.1', sandboxToken: $second->sandboxToken, dashboardToken: $first->dashboardToken, contextToken: $second->contextToken);
        $this->failure(fn () => $runtime->execute(SandboxOperation::Overview, $forged), ErrorCode::DashboardAccess);
        $stale = new RequestIdentity(remoteAddress: '127.0.0.1', sandboxToken: $second->sandboxToken, dashboardToken: $second->dashboardToken, contextToken: $first->contextToken);
        $before = $this->registry($runtime)->sandboxes[hash('sha256', $second->sandboxToken)]->lastActivity;
        $this->clock += 5;
        $this->failure(fn () => $runtime->execute(SandboxOperation::Overview, $stale), ErrorCode::SandboxContext);
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
        $path = $runtime->registry->root.'/'.$digest.'/demo.sqlite';
        $databaseBefore = file_get_contents($path);
        $registryBefore = file_get_contents($runtime->registry->root.'/registry.json');
        $leaseBefore = $this->registry($runtime)->sandboxes[$digest]->lastActivity;
        $this->clock += 10;
        $error = $this->failure(fn () => $runtime->execute(SandboxOperation::UpdateStatus, $original, new StatusChange(id: 1, status: EnquiryStatus::Contacted)), ErrorCode::DashboardAccess);
        $this->check($error->cookies === [] && $this->registry($runtime)->sandboxes[$digest]->lastActivity === $leaseBefore, 'superseded dashboard token cannot renew lease or cookies');
        $this->check(file_get_contents($path) === $databaseBefore && file_get_contents($runtime->registry->root.'/registry.json') === $registryBefore, 'superseded dashboard token cannot mutate registry or database');
        $overview = $runtime->execute(SandboxOperation::Overview, $current)->payload;
        $this->check($overview->enquiries[3]->status === EnquiryStatus::New, 'current rotated token retains access and original record status');
    }

    /** @return void */
    public function exactRateWindowBoundary(): void
    {
        $runtime = $this->runtime('rate-boundary', $this->config(['allocationLimit' => 1, 'loginLimit' => 1, 'enquiryLimit' => 1]));
        $startedAt = $this->clock;
        $identity = $this->login($runtime, $this->visitor($runtime));
        $runtime->execute(SandboxOperation::CreateEnquiry, $identity, $this->input());
        $digest = hash('sha256', $identity->sandboxToken);
        $path = $runtime->registry->root.'/'.$digest.'/demo.sqlite';
        $databaseBefore = file_get_contents($path);
        $registryBefore = file_get_contents($runtime->registry->root.'/registry.json');
        $this->clock = $startedAt + $runtime->config->rateWindowSeconds - 1;
        $actions = [
            fn () => $runtime->execute(SandboxOperation::Bootstrap, new RequestIdentity(remoteAddress: $identity->remoteAddress)),
            fn () => $runtime->execute(SandboxOperation::Login, $identity),
            fn () => $runtime->execute(SandboxOperation::CreateEnquiry, $identity, $this->input()),
        ];
        foreach ($actions as $action) {
            $error = $this->failure($action, ErrorCode::RateLimited);
            $this->check($error->retryAfter === 1 && $error->cookies === [], 'rate action denied one second before exact rollover');
        }
        $this->check(file_get_contents($path) === $databaseBefore && file_get_contents($runtime->registry->root.'/registry.json') === $registryBefore, 'rate-window denials preserve lease, buckets and database');
        $this->clock++;
        $this->visitor($runtime);
        $identity = $this->login($runtime, $identity);
        $created = $runtime->execute(SandboxOperation::CreateEnquiry, $identity, $this->input())->payload;
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
        $path = $runtime->registry->root.'/'.$digest.'/demo.sqlite';
        $targetBefore = $this->registry($runtime)->sandboxes[$digest];
        $databaseBefore = file_get_contents($path);
        $this->clock += $runtime->config->idleSeconds - 1;
        $live = $this->login($runtime, $this->visitor($runtime, '192.0.2.13'));
        $livePath = $runtime->registry->root.'/'.hash('sha256', $live->sandboxToken).'/demo.sqlite';
        $liveBefore = file_get_contents($livePath);
        $this->clock++;
        $error = $this->failure(fn () => $runtime->execute(SandboxOperation::UpdateStatus, $target, new StatusChange(id: 1, status: EnquiryStatus::Contacted)), ErrorCode::SandboxContext);
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
        $runtime->execute(SandboxOperation::Overview, $identity);
        $this->clock += 14399;
        $this->check(!$runtime->execute(SandboxOperation::Bootstrap, $identity)->payload->created, 'sliding lease admitted at boundary minus one');
        $this->clock += 14400;
        $this->failure(fn () => $runtime->execute(SandboxOperation::Overview, $identity), ErrorCode::SandboxContext);
        $fresh = $runtime->execute(SandboxOperation::Bootstrap, $identity);
        $this->check($fresh->payload->created && $fresh->payload->csrfToken !== $identity->contextToken, 'exact expiry requires new allocation');
    }

    /** @return void */
    public function limits(): void
    {
        $runtime = $this->runtime('limits', $this->config(['maxSandboxes' => 2, 'maxEnquiries' => 4]));
        $first = $this->visitor($runtime);
        $this->visitor($runtime);
        $this->failure(fn () => $this->visitor($runtime), ErrorCode::Capacity);
        $this->failure(fn () => $runtime->execute(SandboxOperation::CreateEnquiry, $first, $this->input()), ErrorCode::SandboxFull);
        $rate = $this->runtime('rates', $this->config(['allocationLimit' => 1, 'loginLimit' => 1, 'enquiryLimit' => 1]));
        $identity = $this->visitor($rate);
        $blocked = $this->failure(fn () => $this->visitor($rate), ErrorCode::RateLimited);
        $this->check($blocked->retryAfter === 3600 && $blocked->cookies === [], 'allocation limit survives reset');
        $identity = $this->login($rate, $identity);
        $this->failure(fn () => $rate->execute(SandboxOperation::Login, $identity), ErrorCode::RateLimited);
        $rate->execute(SandboxOperation::CreateEnquiry, $identity, $this->input());
        $lease = $this->registry($rate)->sandboxes[hash('sha256', $identity->sandboxToken)]->lastActivity;
        $this->clock++;
        $this->failure(fn () => $rate->execute(SandboxOperation::CreateEnquiry, $identity, $this->input()), ErrorCode::RateLimited);
        $this->check($this->registry($rate)->sandboxes[hash('sha256', $identity->sandboxToken)]->lastActivity === $lease, 'rate denial has no activity');
        $buckets = $this->runtime('buckets', $this->config(['maxRateBuckets' => 1]));
        $this->visitor($buckets);
        $this->failure(fn () => $this->visitor($buckets, '127.0.0.2'), ErrorCode::RateLimited);
        $this->check(count($this->registry($buckets)->rateBuckets) === 1, 'bucket cap retains live limits');
    }

    /** @return void */
    public function cleanup(): void
    {
        $runtime = $this->runtime('cleanup');
        for ($index = 0; $index < 12; $index++) { $this->visitor($runtime, '127.0.0.'.($index + 1)); }
        $inode = fileinode($runtime->registry->root.'/runtime.lock');
        $this->clock += 14400;
        $this->visitor($runtime);
        $this->check(count($this->registry($runtime)->sandboxes) === 3, 'cleanup deletes no more than ten per request');
        $this->check(fileinode($runtime->registry->root.'/runtime.lock') === $inode, 'persistent lock inode retained');
        $crash = $this->runtime('crash');
        $identity = $this->visitor($crash);
        $registry = $this->registry($crash);
        $record = $registry->sandboxes[hash('sha256', $identity->sandboxToken)];
        $pending = new SandboxRecord(digest: $record->digest, csrfToken: $record->csrfToken, dashboardDigest: null, lastActivity: $this->clock, state: SandboxState::Pending);
        $this->save($crash, new Registry(sandboxes: [$record->digest => $pending], rateBuckets: $registry->rateBuckets));
        $directory = $crash->registry->root.'/'.$record->digest;
        rename($directory.'/demo.sqlite', $directory.'/seed.sqlite');
        chmod($directory, 0500);
        $fresh = $this->visitor($crash, '127.0.0.2');
        $after = $this->registry($crash);
        $this->check(count($after->sandboxes) === 2 && $after->sandboxes[$record->digest]->state === SandboxState::Failed && file_exists($directory.'/seed.sqlite'), 'failed actual cleanup remains charged');
        chmod($directory, 0700);
        $crash->execute(SandboxOperation::Bootstrap, $fresh);
        $this->check(!file_exists($directory) && count($this->registry($crash)->sandboxes) === 1, 'pending crash artifact eventually reclaimed');
    }

    /** @return void */
    public function storage(): void
    {
        $cap = 2097152 + 4 * 32768 + 2 * 32768;
        $runtime = $this->runtime('leftovers', $this->config(['maxSandboxes' => 2, 'maxDatabaseBytes' => 32768, 'journalReserveBytes' => 65536, 'stagingReserveBytes' => 65536, 'maxRuntimeBytes' => $cap]));
        $first = $this->visitor($runtime);
        $this->visitor($runtime, '127.0.0.2');
        $journal = $runtime->registry->root.'/'.hash('sha256', $first->sandboxToken).'/demo.sqlite-journal';
        file_put_contents($journal, str_repeat('x', 4096)); chmod($journal, 0600);
        $this->failure(fn () => $runtime->execute(SandboxOperation::Bootstrap, $first), ErrorCode::Capacity);
        unlink($journal);
        $quota = $this->runtime('quota', $this->config(['maxDatabaseBytes' => 32768, 'enquiryLimit' => 100]));
        $identity = $this->login($quota, $this->visitor($quota));
        $filled = false;
        for ($index = 0; $index < 96; $index++) {
            try { $quota->execute(SandboxOperation::CreateEnquiry, $identity, $this->input(str_repeat('界', 2000))); }
            catch (DemoError $error) { $this->check($error->errorCode === ErrorCode::SandboxFull, 'multibyte page cap maps only quota'); $filled = true; break; }
        }
        $this->check($filled, 'small page cap reached');
        $before = $quota->execute(SandboxOperation::Overview, $identity)->payload;
        $path = $quota->registry->root.'/'.hash('sha256', $identity->sandboxToken).'/demo.sqlite';
        $this->check(filesize($path) <= 32768, 'database never exceeds page cap');
        $database = new PDO('sqlite:'.$path);
        $database->exec("CREATE TRIGGER reject_conversion BEFORE UPDATE OF status ON enquiries WHEN NEW.status = 'converted' BEGIN SELECT RAISE(ABORT, 'fixture IO failure'); END");
        $database = null;
        $error = $this->failure(fn () => $quota->execute(SandboxOperation::CreateBooking, $identity, new EnquiryId(id: 1)), ErrorCode::Unavailable);
        $this->check($error->getPrevious() === null, 'complete schema rejection is fail closed');
        $database = new PDO('sqlite:'.$path); $database->exec('DROP TRIGGER reject_conversion'); $database = null;
        $after = $quota->execute(SandboxOperation::Overview, $identity)->payload;
        $this->check(count($after->bookings) === count($before->bookings) && $after->enquiries[count($after->enquiries) - 1]->status === EnquiryStatus::New, 'failed mutation leaves no partial records');
        $io = $this->runtime('io');
        $owner = $this->visitor($io);
        chmod($io->registry->root, 0500);
        $error = $this->failure(fn () => $io->execute(SandboxOperation::Bootstrap, $owner), ErrorCode::Unavailable);
        $this->check($error->getPrevious() !== null && $error->status === 503, 'IO error retains private cause and is not quota');
        chmod($io->registry->root, 0700);
        $reopen = new VisitorStore(path: $path, config: $quota->config, catalog: $this->catalog, now: fn (): int => $this->clock, create: false);
        $reopen->close();
        $atomic = $this->runtime('atomic');
        $owner = $this->login($atomic, $this->visitor($atomic));
        $path = $atomic->registry->root.'/'.hash('sha256', $owner->sandboxToken).'/demo.sqlite';
        $store = new VisitorStore(path: $path, config: $atomic->config, catalog: $this->catalog, now: fn (): int => $this->clock, create: false);
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
    public function unsafe(): void
    {
        $runtime = $this->runtime('nonempty');
        mkdir($runtime->registry->root, 0700);
        file_put_contents($runtime->registry->root.'/sentinel', 'preserve');
        $this->failure(fn () => $runtime->execute(SandboxOperation::Bootstrap, new RequestIdentity(remoteAddress: '127.0.0.1')), ErrorCode::Unavailable);
        $this->check(file_get_contents($runtime->registry->root.'/sentinel') === 'preserve' && !file_exists($runtime->registry->root.'/runtime.lock'), 'nonempty root preserved without initialization');
        foreach (['unknown', 'corrupt', 'missing-registry', 'missing', 'schema', 'symlink', 'hardlink'] as $kind) {
            $runtime = $this->runtime('unsafe-'.$kind);
            $identity = $this->visitor($runtime);
            $root = $runtime->registry->root;
            $path = $root.'/'.hash('sha256', $identity->sandboxToken).'/demo.sqlite';
            if ($kind === 'unknown') { file_put_contents($root.'/surprise', 'sentinel'); chmod($root.'/surprise', 0600); }
            if ($kind === 'corrupt') { file_put_contents($root.'/registry.json', '{}'); }
            if ($kind === 'missing-registry') { rename($root.'/registry.json', $this->workspace.'/missing-registry.json'); }
            if ($kind === 'missing') { rename($path, $this->workspace.'/missing-database'); }
            if ($kind === 'schema') { $database = new PDO('sqlite:'.$path); $database->exec('CREATE VIEW surprise AS SELECT id FROM enquiries'); $database = null; }
            if ($kind === 'symlink') { rename($path, $this->workspace.'/linked-database'); symlink($this->workspace.'/linked-database', $path); }
            if ($kind === 'hardlink') { link($path, $this->workspace.'/hardlink-database'); }
            $action = $kind === 'schema' ? SandboxOperation::CreateEnquiry : SandboxOperation::Bootstrap;
            $this->failure(fn () => $runtime->execute($action, $identity, $kind === 'schema' ? $this->input() : null), ErrorCode::Unavailable);
            $this->check($kind === 'missing-registry' ? !file_exists($root.'/registry.json') && is_file($path) : file_exists($root.'/registry.json'), 'unsafe state preserved: '.$kind);
        }
    }

    /** @return void */
    public function crashPhases(): void
    {
        foreach (['before-mkdir', 'seeded', 'renamed'] as $phase) {
            $runtime = $this->runtime('phase-'.$phase, $this->config(['maxSandboxes' => 1]));
            $owner = $this->visitor($runtime);
            $registry = $this->registry($runtime);
            $record = $registry->sandboxes[hash('sha256', $owner->sandboxToken)];
            $directory = $runtime->registry->root.'/'.$record->digest;
            if ($phase === 'before-mkdir') { unlink($directory.'/demo.sqlite'); rmdir($directory); }
            if ($phase === 'seeded') { rename($directory.'/demo.sqlite', $directory.'/seed.sqlite'); }
            $pending = new SandboxRecord(digest: $record->digest, csrfToken: $record->csrfToken, dashboardDigest: null, lastActivity: $record->lastActivity, state: SandboxState::Pending);
            $this->save($runtime, new Registry(sandboxes: [$record->digest => $pending], rateBuckets: $registry->rateBuckets));
            file_put_contents($runtime->registry->root.'/registry.next', '{"truncated":');
            chmod($runtime->registry->root.'/registry.next', 0600);
            $fresh = $this->visitor($runtime);
            $this->check($fresh->sandboxToken !== $owner->sandboxToken && count($this->registry($runtime)->sandboxes) === 1 && !is_dir($directory), 'crash phase recovered without reseeding: '.$phase);
            $this->check(array_values($this->registry($runtime)->rateBuckets)[0]->hits === 2, 'crash phase retains allocation charge: '.$phase);
        }
        $root = $this->workspace.'/ready-save-failure';
        $calls = 0;
        $clock = function () use (&$calls, $root): int { $calls++; if ($calls === 2) { chmod($root, 0500); } return $this->clock; };
        $runtime = new SandboxRuntime(root: $root, config: $this->config(['maxSandboxes' => 1]), catalog: $this->catalog, now: $clock);
        try { $error = $this->failure(fn () => $runtime->execute(SandboxOperation::Bootstrap, new RequestIdentity(remoteAddress: '127.0.0.1')), ErrorCode::Unavailable); }
        finally { chmod($root, 0700); }
        $this->check($error->getPrevious() !== null, 'failed ready registry save retains private IO cause');
        $registry = $this->registry($runtime);
        $record = array_values($registry->sandboxes)[0];
        $this->check($record->state === SandboxState::Pending && is_file($root.'/'.$record->digest.'/demo.sqlite'), 'failed ready save retains pending and renamed database');
        $restart = $this->runtime('ready-save-failure', $runtime->config);
        $this->visitor($restart);
        $this->check(count($this->registry($restart)->sandboxes) === 1 && !is_dir($root.'/'.$record->digest), 'restart reclaims failed ready save before allocation');
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
        $database = new PDO('sqlite:'.$path); $database->exec("DELETE FROM metadata WHERE key = 'seeded'"); $database = null;
        $before = file_get_contents($path);
        $this->failure(fn () => new VisitorStore(path: $path, config: $this->config(), catalog: $this->catalog, now: fn (): int => $this->clock, create: false), ErrorCode::Unavailable);
        $this->check(file_get_contents($path) === $before, 'incomplete seed is preserved without repair');
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
    foreach (['lifecycle', 'loginRotationRejectsOldAuthorization', 'exactRateWindowBoundary', 'expiredTargetOutsideCleanupBatch', 'expiry', 'limits', 'cleanup', 'storage', 'unsafe', 'validation', 'crashPhases', 'storeBoundaries'] as $method) { $tests->$method(); echo 'PASS '.$method.PHP_EOL; }
    echo $tests->assertions.' PHP runtime assertions passed.'.PHP_EOL;
} finally { $tests->removeFixture($tests->workspace); }
