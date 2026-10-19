<?php

namespace Elsewhere;

enum Icon
{
    case Compass;
    case Pin;
    case Sun;
    case Heart;
    case Leaf;
    case Check;
    case Menu;
    case Search;

    /** @return string */
    public function label(): string
    {
        return $this->name;
    }

    /** @return string */
    public function svg(): string
    {
        return '<svg class="icon " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'.match ($this) {
            self::Compass => '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2"/>',
            self::Pin => '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
            self::Sun => '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
            self::Heart => '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
            self::Leaf => '<path d="M20 3C10 2 2 7 4 15s15 9 16-12Z"/><path d="M3 22 15 10"/>',
            self::Check => '<path d="m5 12 4 4L19 6"/>',
            self::Menu => '<path d="M4 7h16M4 12h16M4 17h16"/>',
            self::Search => '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
        }.'</svg>';
    }
}
