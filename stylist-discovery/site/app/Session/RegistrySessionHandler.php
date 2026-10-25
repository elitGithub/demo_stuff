<?php

namespace App\Session;

use Carbon\CarbonImmutable;
use Illuminate\Session\DatabaseSessionHandler;
use Symfony\Component\HttpKernel\Exception\HttpException;

class RegistrySessionHandler extends DatabaseSessionHandler
{
    /**
     * @param  string  $sessionId
     * @param  string  $data
     * @return bool
     */
    public function write($sessionId, $data): bool
    {
        $this->assertNotRevoked($sessionId);
        if (strlen(base64_encode($data)) > config('demo.limits.session_bytes')) {
            throw new HttpException(429, 'This demo session is too large.');
        }
        $payload = ['payload' => base64_encode($data), 'last_activity' => CarbonImmutable::now()->timestamp];
        $this->connection->table($this->table)->upsert([['id' => $sessionId, ...$payload]], ['id'], ['payload', 'last_activity']);
        $this->exists = true;

        return true;
    }

    /**
     * @param  string  $sessionId
     * @return string|false
     */
    public function read($sessionId): string|false
    {
        $this->assertNotRevoked($sessionId);

        return parent::read($sessionId);
    }

    /**
     * @param  \stdClass  $session
     * @return bool
     */
    protected function expired($session): bool
    {
        return isset($session->last_activity) && $session->last_activity <= CarbonImmutable::now()->subMinutes($this->minutes)->timestamp;
    }

    /**
     * @param  string  $sessionId
     * @return void
     */
    public function assertNotRevoked(string $sessionId): void
    {
        if ($this->connection->table('revoked_sessions')->where('digest', hash('sha256', $sessionId))->where('expires_at', '>', CarbonImmutable::now()->utc()->toDateTimeString())->exists()) {
            throw new HttpException(409, 'Your session changed. Refresh this page.');
        }
    }

    /**
     * @param  int  $lifetime
     * @return int
     */
    public function gc($lifetime): int
    {
        $keys = $this->getQuery()->where('last_activity', '<=', CarbonImmutable::now()->timestamp - $lifetime)->orderBy('last_activity')->limit(config('demo.limits.cleanup_rows'))->pluck('id');

        return $this->getQuery()->whereIn('id', $keys)->delete();
    }
}
