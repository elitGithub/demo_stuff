<?php

namespace Elsewhere;

final class SandboxRuntime
{
    public readonly SandboxRegistry $registry;

    /** @param string $root @param SandboxConfig $config @param Catalog $catalog @param \Closure $now */
    public function __construct(
        string                        $root,
        public readonly SandboxConfig $config,
        public readonly Catalog       $catalog,
        public readonly \Closure      $now
    ) {
        $this->registry = new SandboxRegistry(root: $root, config: $config);
    }

    /** @param SandboxOperation $operation @param RequestIdentity $identity @param EnquiryInput|StatusChange|EnquiryId|null $command @return ApiResult */
    public function execute(
        SandboxOperation                         $operation,
        RequestIdentity                          $identity,
        EnquiryInput|StatusChange|EnquiryId|null $command = null
    ): ApiResult {
        $validCommand = match ($operation) {
            SandboxOperation::CREATE_ENQUIRY => $command instanceof EnquiryInput,
            SandboxOperation::UPDATE_STATUS  => $command instanceof StatusChange,
            SandboxOperation::CREATE_BOOKING => $command instanceof EnquiryId,
            default                          => $command === null,
        };
        if (!$validCommand) {
            throw new DemoError('Invalid action details.');
        }
        $lock = $this->registry->acquire();
        try {
            $timestamp = ($this->now)();
            if (!is_int($timestamp) || $timestamp < 0 || $timestamp > 9007199254740991 - max(
                    $this->config->idleSeconds,
                    $this->config->rateWindowSeconds
                )) {
                throw new \TypeError('Invalid sandbox clock.');
            }
            $registry = $this->reconcile($this->registry->load(), $timestamp);
            $digest = $this->token($identity->sandboxToken) ? hash('sha256', $identity->sandboxToken) : null;
            $record = $digest !== null && isset($registry->sandboxes[$digest]) ? $registry->sandboxes[$digest] : null;
            $ready = $record !== null && $record->state === SandboxState::Ready && $timestamp < $record->lastActivity + $this->config->idleSeconds;
            $bootstrap = $operation === SandboxOperation::BOOTSTRAP;
            if (!$bootstrap && (!$ready || !$this->same($identity->contextToken, $record->csrfToken))) {
                throw new DemoError(
                    'Your demo session ended or changed. Start a fresh demo.',
                    409,
                    ErrorCode::SandboxContext
                );
            }
            $authorized = $ready && $this->token(
                    $identity->dashboardToken
                ) && $record->dashboardDigest !== null && $this->same(
                    hash('sha256', $identity->dashboardToken),
                    $record->dashboardDigest
                );
            if (in_array(
                    $operation,
                    [
                        SandboxOperation::LOGOUT,
                        SandboxOperation::OVERVIEW,
                        SandboxOperation::UPDATE_STATUS,
                        SandboxOperation::CREATE_BOOKING
                    ],
                    true
                ) && !$authorized) {
                throw new DemoError('Enter the demo dashboard to continue.', 401, ErrorCode::DashboardAccess);
            }
            if ($bootstrap && !$ready) {
                if (count($registry->sandboxes) >= $this->config->maxSandboxes) {
                    throw new DemoError(
                        'The demo is at capacity. Please try again later.', 503, ErrorCode::Capacity, 60
                    );
                }
                $this->admit($registry, 1);
                $registry = $this->charge($registry, $identity->remoteAddress, RateAction::ALLOCATION, $timestamp);
                $sandboxToken = bin2hex(random_bytes(32));
                $record = new SandboxRecord(
                    digest         : hash('sha256', $sandboxToken),
                    csrfToken      : bin2hex(random_bytes(32)),
                    dashboardDigest: null,
                    lastActivity   : $timestamp,
                    state          : SandboxState::Pending
                );
                $allocations = $registry->sandboxes;
                if (isset($allocations[$record->digest])) {
                    throw new DemoError('The demo storage is unavailable.', 503, ErrorCode::Unavailable);
                }
                $allocations[$record->digest] = $record;
                $this->registry->save(new Registry(sandboxes: $allocations, rateBuckets: $registry->rateBuckets));
                $seed = null;
                try {
                    $directory = $this->registry->root . '/' . $record->digest;
                    if (!mkdir($directory, 0700)) {
                        throw new \RuntimeException('Cannot create sandbox directory.');
                    }
                    $seed = new VisitorStore(
                        path   : $directory . '/seed.sqlite',
                        config : $this->config,
                        catalog: $this->catalog,
                        now    : $this->now,
                        create : true
                    );
                    $seed->close();
                    $seed = null;
                    if (!rename($directory . '/seed.sqlite', $directory . '/demo.sqlite')) {
                        throw new \RuntimeException('Cannot publish sandbox seed.');
                    }
                    $this->registry->syncDirectory($directory);
                    $record = new SandboxRecord(
                        digest         : $record->digest,
                        csrfToken      : $record->csrfToken,
                        dashboardDigest: null,
                        lastActivity   : $timestamp,
                        state          : SandboxState::Ready
                    );
                    $allocations[$record->digest] = $record;
                    $this->registry->save(new Registry(sandboxes: $allocations, rateBuckets: $registry->rateBuckets));
                    return new ApiResult(
                        payload: $this->bootstrap($record, true), cookies: $this->cookies(
                        $sandboxToken,
                        null
                    )
                    );
                } catch (\Throwable $error) {
                    throw $this->registry->unavailable($error);
                } finally {
                    if ($seed !== null) {
                        $seed->close();
                    }
                }
            }
            $this->admit($registry, 0);
            if ($operation === SandboxOperation::CREATE_ENQUIRY || $operation === SandboxOperation::LOGIN) {
                $registry = $this->charge(
                    $registry,
                    $identity->remoteAddress,
                    $operation === SandboxOperation::LOGIN ? RateAction::LOGIN : RateAction::ENQUIRY,
                    $timestamp
                );
            }
            $dashboardToken = $authorized ? $identity->dashboardToken : null;
            if ($operation === SandboxOperation::LOGIN) {
                $dashboardToken = bin2hex(random_bytes(32));
            }
            if ($operation === SandboxOperation::LOGOUT) {
                $dashboardToken = null;
            }
            $record = new SandboxRecord(
                digest         : $record->digest,
                csrfToken      : $record->csrfToken,
                dashboardDigest: $operation === SandboxOperation::LOGIN ? hash(
                'sha256',
                $dashboardToken
            ) : ($operation === SandboxOperation::LOGOUT ? null : $record->dashboardDigest),
                lastActivity   : $timestamp,
                state          : $record->state
            );
            $records = $registry->sandboxes;
            $records[$record->digest] = $record;
            $this->registry->save(new Registry(sandboxes: $records, rateBuckets: $registry->rateBuckets));
            $cookies = $this->cookies($identity->sandboxToken, $dashboardToken);
            if ($operation === SandboxOperation::LOGOUT) {
                $cookies[] = new CookieChange(
                    name  : $this->config->dashboardCookie,
                    value : '',
                    path  : '/',
                    maxAge: 0,
                    secure: false
                );
            }
            if ($bootstrap) {
                return new ApiResult(payload: $this->bootstrap($record, false), cookies: $cookies);
            }
            if ($operation === SandboxOperation::LOGIN || $operation === SandboxOperation::LOGOUT) {
                return new ApiResult(payload: new Acknowledgement(), cookies: $cookies);
            }
            $store = null;
            try {
                $store = new VisitorStore(
                    path   : $this->registry->root . '/' . $record->digest . '/demo.sqlite',
                    config : $this->config,
                    catalog: $this->catalog,
                    now    : $this->now,
                    create : false
                );
                $payload = match ($operation) {
                    SandboxOperation::CREATE_ENQUIRY => $store->createEnquiry($command),
                    SandboxOperation::OVERVIEW       => $store->overview(),
                    SandboxOperation::UPDATE_STATUS  => $store->updateStatus($command),
                    SandboxOperation::CREATE_BOOKING => $store->convert($command),
                    default                          => throw new \Exception('Unexpected match value'),
                };
                return new ApiResult(payload: $payload, cookies: $cookies);
            } catch (\Throwable $error) {
                $failure = $this->registry->unavailable($error);
                $failure->cookies = $cookies;
                throw $failure;
            } finally {
                $store?->close();
            }
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** @param Registry $registry @param int $timestamp @return Registry */
    public function reconcile(Registry $registry, int $timestamp): Registry
    {
        $buckets = $registry->rateBuckets;
        $records = $registry->sandboxes;
        $changed = false;
        foreach ($buckets as $key => $bucket) {
            if ($timestamp >= $bucket->expiresAt) {
                unset($buckets[$key]);
                $changed = true;
            }
        }
        foreach ($records as $key => $record) {
            if ($record->state === SandboxState::Pending) {
                $records[$key] = new SandboxRecord(
                    digest         : $record->digest,
                    csrfToken      : $record->csrfToken,
                    dashboardDigest: null,
                    lastActivity   : $record->lastActivity,
                    state          : SandboxState::Failed
                );
                $changed = true;
            }
        }
        $cleaned = 0;
        foreach ($records as $key => $record) {
            if ($cleaned >= $this->config->cleanupBatch) {
                break;
            }
            if ($record->state === SandboxState::Failed || $timestamp >= $record->lastActivity + $this->config->idleSeconds) {
                $failed = new SandboxRecord(
                    digest         : $record->digest,
                    csrfToken      : $record->csrfToken,
                    dashboardDigest: null,
                    lastActivity   : $record->lastActivity,
                    state          : SandboxState::Failed
                );
                $records[$key] = $failed;
                $this->registry->save(new Registry(sandboxes: $records, rateBuckets: $buckets));
                $cleaned++;
                try {
                    $this->registry->remove($failed);
                    unset($records[$key]);
                } catch (\Throwable $error) {
                    error_log('Sandbox cleanup failed: ' . $error);
                }
                $changed = true;
            }
        }
        if ($changed) {
            $registry = new Registry(sandboxes: $records, rateBuckets: $buckets);
            $this->registry->save($registry);
        }
        return $registry;
    }

    /** @param Registry $registry @param int $additionalSlots @return void */
    public function admit(Registry $registry, int $additionalSlots): void
    {
        $required = (count(
                         $registry->sandboxes
                     ) + $additionalSlots) * $this->config->maxDatabaseBytes + $this->config->registryReserveBytes + $this->config->journalReserveBytes + $this->config->stagingReserveBytes + $this->registry->extraBytes(
                $registry
            );
        if ($required > $this->config->maxRuntimeBytes) {
            throw new DemoError('The demo is at capacity. Please try again later.', 503, ErrorCode::Capacity, 60);
        }
    }

    /** @param Registry $registry @param string $address @param RateAction $action @param int $timestamp @return Registry */
    public function charge(Registry $registry, string $address, RateAction $action, int $timestamp): Registry
    {
        $key = hash('sha256', $action->value . "\0" . $address);
        $buckets = $registry->rateBuckets;
        $previous = $buckets[$key] ?? null;
        $limit = match ($action) {
            RateAction::ALLOCATION => $this->config->allocationLimit,
            RateAction::ENQUIRY    => $this->config->enquiryLimit,
            RateAction::LOGIN      => $this->config->loginLimit
        };
        if (($previous !== null && $previous->hits >= $limit) || ($previous === null && count(
                                                                                            $buckets
                                                                                        ) >= $this->config->maxRateBuckets)) {
            $retryAfter = $previous !== null ? $previous->expiresAt - $timestamp : min(
                array_map(fn(RateBucket $bucket): int => $bucket->expiresAt - $timestamp, $buckets)
            );
            throw new DemoError(
                'Please wait before trying this action again.', 429, ErrorCode::RateLimited, $retryAfter
            );
        }
        $buckets[$key] = new RateBucket(
            key      : $key,
            hits     : $previous !== null ? $previous->hits + 1 : 1,
            expiresAt: $previous !== null ? $previous->expiresAt : $timestamp + $this->config->rateWindowSeconds
        );
        return new Registry(sandboxes: $registry->sandboxes, rateBuckets: $buckets);
    }

    /** @param SandboxRecord $record @param bool $created @return Bootstrap */
    public function bootstrap(SandboxRecord $record, bool $created): Bootstrap
    {
        return new Bootstrap(
            csrfToken      : $record->csrfToken,
            expiresAt      : $record->lastActivity + $this->config->idleSeconds,
            created        : $created,
            protocolVersion: $this->config->protocolVersion,
            idleSeconds    : $this->config->idleSeconds,
            pageSize       : $this->config->pageSize
        );
    }

    /** @param string $sandboxToken @param ?string $dashboardToken @return CookieChange[] */
    public function cookies(string $sandboxToken, ?string $dashboardToken): array
    {
        $cookies = [
            new CookieChange(
                name  : $this->config->sandboxCookie,
                value : $sandboxToken,
                path  : '/',
                maxAge: $this->config->idleSeconds,
                secure: false
            )
        ];
        if ($dashboardToken !== null) {
            $cookies[] = new CookieChange(
                name  : $this->config->dashboardCookie,
                value : $dashboardToken,
                path  : '/',
                maxAge: $this->config->idleSeconds,
                secure: false
            );
        }
        return $cookies;
    }

    /** @param ?string $value @return bool */
    public function token(?string $value): bool
    {
        return $value !== null && preg_match('/^[a-f0-9]{64}$/D', $value) === 1;
    }

    /** @param ?string $left @param ?string $right @return bool */
    public function same(?string $left, ?string $right): bool
    {
        return $this->token($left) && $this->token($right) && hash_equals($left, $right);
    }
}
