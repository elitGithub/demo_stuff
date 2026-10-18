<?php

namespace Elsewhere;

final readonly class SandboxRecord implements \JsonSerializable
{
    /** @param string $digest @param string $csrfToken @param ?string $dashboardDigest @param int $lastActivity @param SandboxState $state */
    public function __construct(
        public string       $digest,
        public string       $csrfToken,
        public ?string      $dashboardDigest,
        public int          $lastActivity,
        public SandboxState $state
    ) {
        if (!preg_match('/^[a-f0-9]{64}$/D', $digest) || !preg_match(
                '/^[a-f0-9]{64}$/D',
                $csrfToken
            ) || ($dashboardDigest !== null && !preg_match(
                    '/^[a-f0-9]{64}$/D',
                    $dashboardDigest
                )) || $lastActivity < 0 || $lastActivity > 9007199254740991) {
            throw new \TypeError('Invalid sandbox record.');
        }
    }

    /** @return array<string, mixed> */
    public function jsonSerialize(): array
    {
        return [...get_object_vars($this), 'state' => $this->state->value];
    }
}
