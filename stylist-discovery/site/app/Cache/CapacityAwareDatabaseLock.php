<?php

namespace App\Cache;

use Illuminate\Cache\DatabaseLock;
use Illuminate\Database\QueryException;

class CapacityAwareDatabaseLock extends DatabaseLock
{
    /**
     * @return bool
     */
    public function acquire(): bool
    {
        try {
            return $this->connection->table($this->table)->insert(['key' => $this->name, 'owner' => $this->owner, 'expiration' => $this->expiresAt()]);
        } catch (QueryException $exception) {
            if (str_contains($exception->getMessage(), 'capacity:cache_locks')) {
                throw $exception;
            }

            return parent::acquire();
        }
    }
}
