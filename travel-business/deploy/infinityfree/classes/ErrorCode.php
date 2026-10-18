<?php

namespace Elsewhere;

enum ErrorCode: string
{
    case SandboxContext  = 'sandbox_context';
    case DashboardAccess = 'dashboard_access';
    case Capacity        = 'capacity';
    case Busy            = 'busy';
    case SandboxFull     = 'sandbox_full';
    case RateLimited     = 'rate_limited';
    case Validation      = 'validation';
    case Origin          = 'origin';
    case BodyTooLarge    = 'body_too_large';
    case ContentType     = 'content_type';
    case NotFound        = 'not_found';
    case Conflict        = 'conflict';
    case Unavailable     = 'unavailable';
    case Internal        = 'internal';

    /** @return string */
    public function label(): string
    {
        return match ($this) {
            self::SandboxContext  => 'Your demo session ended or changed.',
            self::DashboardAccess => 'Enter the demo dashboard to continue.',
            self::Capacity        => 'The demo is at capacity.',
            self::Busy            => 'The demo is busy.',
            self::SandboxFull     => 'Your demo workspace is full.',
            self::RateLimited     => 'Please try again later.',
            self::Validation      => 'Please check the submitted details.',
            self::Origin          => 'Cross-origin requests are not allowed.',
            self::BodyTooLarge    => 'That submission is too large.',
            self::ContentType     => 'Please send JSON data.',
            self::NotFound        => 'Record not found.',
            self::Conflict        => 'This record has already been converted.',
            self::Unavailable     => 'The demo storage is unavailable.',
            self::Internal        => 'The demo could not complete that request.',
        };
    }
}
