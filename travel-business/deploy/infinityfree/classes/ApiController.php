<?php

namespace Elsewhere;

use JsonException;

final readonly class ApiController
{
    public bool             $secure;
    public EnquiryValidator $validator;

    /** @param SandboxRuntime $runtime @param Catalog $catalog @param SandboxConfig $config @param string $origin @param \Closure $now */
    public function __construct(
        public SandboxRuntime $runtime,
        Catalog               $catalog,
        public SandboxConfig  $config,
        public string         $origin,
        \Closure              $now
    ) {
        $parsed = parse_url($origin);
        if ($parsed === false || !isset($parsed['scheme'], $parsed['host']) || !in_array(
                $parsed['scheme'],
                ['http', 'https'],
                true
            ) || isset($parsed['path']) || isset($parsed['user']) || isset($parsed['pass']) || isset($parsed['query']) || isset($parsed['fragment']) || !preg_match(
                '~^https?://(?:\[[a-fA-F0-9:]+\]|[a-zA-Z0-9.-]+)(?::[0-9]+)?$~D',
                $origin
            )) {
            throw new \TypeError('Configured origin must be an exact HTTP(S) origin.');
        }
        $this->secure = $parsed['scheme'] === 'https';
        $this->validator = new EnquiryValidator(catalog: $catalog, now: $now);
    }

    /** @return void */
    public function run(): void
    {
        try {
            $route = $_GET['route'] ?? '';
            if (!is_string($route)) {
                throw new DemoError('API route not found.', 404, ErrorCode::NotFound);
            }
            $fixed = [
                'sandbox'        => ['POST', SandboxOperation::BOOTSTRAP],
                'enquiries'      => ['POST', SandboxOperation::CREATE_ENQUIRY],
                'admin/login'    => ['POST', SandboxOperation::LOGIN],
                'admin/logout'   => ['POST', SandboxOperation::LOGOUT],
                'admin/overview' => ['GET', SandboxOperation::OVERVIEW],
            ];
            $matched = [];
            $recordRoute = preg_match('~^admin/enquiries/([^/]+)(/booking)?$~D', $route, $matched) === 1;
            $selected = $fixed[$route] ?? ($recordRoute ? [
                isset($matched[2]) ? 'POST' : 'PATCH',
                isset($matched[2]) ? SandboxOperation::CREATE_BOOKING : SandboxOperation::UPDATE_STATUS
            ] : null);
            if ($selected === null) {
                throw new DemoError('API route not found.', 404, ErrorCode::NotFound);
            }
            [$method, $operation] = $selected;
            if ($_SERVER['REQUEST_METHOD'] !== $method) {
                $this->send(
                           405,
                           (object)['error' => 'Method not allowed.', 'code' => ErrorCode::Validation->value],
                    extra: ['Allow' => $method]
                );
                return;
            }
            $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
            if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site' || ($method !== 'GET' ? $origin !== $this->origin : $origin !== null && $origin !== $this->origin)) {
                throw new DemoError('Cross-origin requests are not allowed.', 403, ErrorCode::Origin);
            }
            $tokens = [];
            foreach (explode(';', $_SERVER['HTTP_COOKIE'] ?? '') as $part) {
                $pieces = explode('=', $part, 2);
                $name = trim($pieces[0]);
                if (!in_array($name, [$this->config->sandboxCookie, $this->config->dashboardCookie], true)) {
                    continue;
                }
                if (array_key_exists($name, $tokens)) {
                    throw new DemoError('Duplicate identity cookies are not allowed.');
                }
                $tokens[$name] = isset($pieces[1]) ? trim($pieces[1]) : '';
            }
            $context = $_SERVER['HTTP_X_ELSEWHERE_CONTEXT'] ?? null;
            if ($operation !== SandboxOperation::BOOTSTRAP && (!is_string($context) || !preg_match(
                        '/^[a-f0-9]{64}$/D',
                        $context
                    ))) {
                throw new DemoError(
                    'Your demo session ended or changed. Start a fresh demo.',
                    409,
                    ErrorCode::SandboxContext
                );
            }
            $identifier = null;
            if ($recordRoute) {
                if (!preg_match('/^[1-9][0-9]*$/D', $matched[1]) || strlen($matched[1]) > 16 || (strlen(
                                                                                                     $matched[1]
                                                                                                 ) === 16 && strcmp(
                                                                                                                 $matched[1],
                                                                                                                 '9007199254740991'
                                                                                                             ) > 0)) {
                    throw new DemoError('Invalid enquiry ID.');
                }
                $identifier = new EnquiryId(id: (int)$matched[1]);
            }
            $command = null;
            if ($method === 'GET') {
                if (isset($_SERVER['HTTP_TRANSFER_ENCODING']) || (isset($_SERVER['CONTENT_LENGTH']) && $_SERVER['CONTENT_LENGTH'] !== '0')) {
                    throw new DemoError('This request does not accept a body.');
                }
            } else {
                $input = $this->body();
                $keys = array_keys(get_object_vars($input));
                if ($operation === SandboxOperation::CREATE_ENQUIRY) {
                    if (array_diff(
                            $keys,
                            [
                                'firstName',
                                'lastName',
                                'email',
                                'destination',
                                'journey',
                                'departure',
                                'travelers',
                                'budget',
                                'message',
                                'consent'
                            ]
                        ) !== []) {
                        throw new DemoError('Unexpected enquiry fields.');
                    }
                    $command = $this->validator->validate($input);
                } elseif ($operation === SandboxOperation::UPDATE_STATUS) {
                    if ($keys !== ['status'] || !is_string($input->status) || EnquiryStatus::tryFrom(
                            $input->status
                        ) === null) {
                        throw new DemoError('Please provide only a valid enquiry status.');
                    }
                    $command = new StatusChange(id: $identifier->id, status: EnquiryStatus::from($input->status));
                } else {
                    if ($keys !== []) {
                        throw new DemoError('This action requires an empty JSON object.');
                    }
                    if ($operation === SandboxOperation::CREATE_BOOKING) {
                        $command = $identifier;
                    }
                }
            }
            $identity = new RequestIdentity(
                remoteAddress : $_SERVER['REMOTE_ADDR'],
                sandboxToken  : $tokens[$this->config->sandboxCookie] ?? null,
                dashboardToken: $tokens[$this->config->dashboardCookie] ?? null,
                contextToken  : $context
            );
            $result = $this->runtime->execute($operation, $identity, $command);
            $this->send(
                in_array(
                    $operation,
                    [SandboxOperation::CREATE_ENQUIRY, SandboxOperation::CREATE_BOOKING],
                    true
                ) ? 201 : 200,
                $result->payload,
                $result->cookies
            );
        } catch (DemoError $error) {
            if ($error->getPrevious() !== null) {
                error_log('API storage failed: ' . $error->getPrevious());
            }
            $this->send(
                $error->status,
                (object)['error' => $error->getMessage(), 'code' => $error->errorCode->value],
                $error->cookies,
                $error->retryAfter === null ? [] : ['Retry-After' => (string)$error->retryAfter]
            );
        } catch (\Throwable $error) {
            error_log('API request failed: ' . $error);
            $this->send(500, (object)['error' => ErrorCode::Internal->label(), 'code' => ErrorCode::Internal->value]);
        }
    }

    /** @return object */
    public function body(): object
    {
        if (!preg_match('/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/iD', $_SERVER['CONTENT_TYPE'] ?? '')) {
            throw new DemoError('Please send JSON data.', 415, ErrorCode::ContentType);
        }
        if ((float)($_SERVER['CONTENT_LENGTH'] ?? 0) > 16384) {
            throw new DemoError('That submission is too large.', 413, ErrorCode::BodyTooLarge);
        }
        $raw = file_get_contents('php://input', false, null, 0, 16385);
        if ($raw === false || strlen($raw) > 16384) {
            throw new DemoError('That submission is too large.', 413, ErrorCode::BodyTooLarge);
        }
        try {
            $value = json_decode($raw, depth: 64, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new DemoError('The submitted data is not a valid UTF-8 JSON object.');
        }
        if (!$value instanceof \stdClass) {
            throw new DemoError('Please send a JSON object.');
        }
        return $value;
    }

    /**
     * @param int $status
     * @param object $payload
     * @param array $cookies
     * @param array $extra
     * @return void
     * @throws JsonException
     */
    public function send(int $status, object $payload, array $cookies = [], array $extra = []): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        foreach ($cookies as $cookie) {
            $final = new CookieChange(
                name  : $cookie->name,
                value : $cookie->value,
                path  : '/travel-agency-demo/',
                maxAge: $cookie->maxAge,
                secure: $this->secure
            );
            header(
                'Set-Cookie: ' . $final->name . '=' . $final->value . '; Path=' . $final->path . '; HttpOnly; SameSite=Strict; Max-Age=' . $final->maxAge . ($final->secure ? '; Secure' : ''),
                false
            );
        }
        foreach ($extra as $name => $value) {
            header($name . ': ' . $value);
        }
        echo json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
