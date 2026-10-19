<?php

namespace Elsewhere;

final class SandboxRuntime
{
    /** @param string $root @param SandboxConfig $config @param Catalog $catalog @param \Closure $now @throws \TypeError */
    public function __construct(
        public readonly string        $root,
        public readonly SandboxConfig $config,
        public readonly Catalog       $catalog,
        public readonly \Closure      $now
    ) {
        if ($root === '' || !str_starts_with($root, '/') || preg_match('~(?:^|/)\.\.(?:/|$)~', $root) === 1) {
            throw new \TypeError('Explicit absolute runtime root required.');
        }
    }

    /** @param SandboxOperation $operation @param RequestIdentity $identity @param EnquiryInput|StatusChange|EnquiryId|null $command @return ApiResult @throws DemoError */
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
        $registry = new SandboxRegistry(root: $this->root, config: $this->config);
        $registry->begin();
        try {
            $timestamp = ($this->now)();
            if (!is_int($timestamp) || $timestamp < 0 || $timestamp > 9007199254740991 - max(
                    $this->config->idleSeconds,
                    $this->config->rateWindowSeconds
                )) {
                throw new \TypeError('Invalid sandbox clock.');
            }
            $expired = $registry->expire($timestamp);
            $digest = $this->token($identity->sandboxToken) ? hash('sha256', $identity->sandboxToken) : null;
            $record = $digest !== null ? $registry->find($digest) : null;
            $ready = $record !== null && $timestamp < $record->lastActivity + $this->config->idleSeconds;
            $bootstrap = $operation === SandboxOperation::BOOTSTRAP;
            $allocate = $bootstrap && !$ready;
            $authorized = $ready && $this->token(
                    $identity->dashboardToken
                ) && $record->dashboardDigest !== null && $this->same(
                    hash('sha256', $identity->dashboardToken),
                    $record->dashboardDigest
                );
            $action = match (true) {
                $allocate                                       => RateAction::ALLOCATION,
                $operation === SandboxOperation::CREATE_ENQUIRY => RateAction::ENQUIRY,
                $operation === SandboxOperation::LOGIN          => RateAction::LOGIN,
                default                                         => null,
            };
            $rejection = null;
            if (!$bootstrap && (!$ready || !$this->same($identity->contextToken, $record->csrfToken))) {
                $rejection = new DemoError(
                    'Your demo session ended or changed. Start a fresh demo.',
                    409,
                    ErrorCode::SandboxContext
                );
            } elseif (in_array(
                    $operation,
                    [
                        SandboxOperation::LOGOUT,
                        SandboxOperation::OVERVIEW,
                        SandboxOperation::UPDATE_STATUS,
                        SandboxOperation::CREATE_BOOKING
                    ],
                    true
                ) && !$authorized) {
                $rejection = new DemoError('Enter the demo dashboard to continue.', 401, ErrorCode::DashboardAccess);
            } elseif ($allocate && $registry->count() >= $this->config->maxSandboxes) {
                $rejection = new DemoError(
                    'The demo is at capacity. Please try again later.', 503, ErrorCode::Capacity, 60
                );
            } elseif ($action !== null) {
                $rejection = $registry->charge($identity->remoteAddress, $action, $timestamp);
            }
            if ($rejection !== null) {
                $registry->commit();
                $registry->deleteFiles($expired);
                throw $rejection;
            }
            if ($allocate) {
                $sandboxToken = bin2hex(random_bytes(32));
                $record = new SandboxRecord(
                    digest         : hash('sha256', $sandboxToken),
                    csrfToken      : bin2hex(random_bytes(32)),
                    dashboardDigest: null,
                    lastActivity   : $timestamp
                );
                try {
                    (new VisitorStore(
                        path   : $this->root . '/' . $record->digest . '.sqlite',
                        config : $this->config,
                        catalog: $this->catalog,
                        now    : $this->now,
                        create : true
                    ))->close();
                    $registry->insert($record);
                    $registry->commit();
                } catch (\Throwable $error) {
                    $registry->deleteFiles([$record->digest]);
                    $registry->rollback();
                    throw $registry->failure($error);
                }
                $registry->deleteFiles($expired);
                return new ApiResult(
                    payload: $this->bootstrap($record, true),
                    cookies: $this->cookies($sandboxToken, null)
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
                dashboardDigest: match ($operation) {
                    SandboxOperation::LOGIN  => hash('sha256', $dashboardToken),
                    SandboxOperation::LOGOUT => null,
                    default                  => $record->dashboardDigest,
                },
                lastActivity   : $timestamp
            );
            $registry->update($record);
            $registry->commit();
        } catch (\Throwable $error) {
            $registry->rollback();
            throw $error;
        }
        $registry->deleteFiles($expired);
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
                path   : $this->root . '/' . $record->digest . '.sqlite',
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
            $failure = $registry->failure($error);
            $failure->cookies = $cookies;
            throw $failure;
        } finally {
            $store?->close();
        }
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
