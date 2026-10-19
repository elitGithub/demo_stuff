<?php

namespace Elsewhere;

enum SitePage: string
{
    case Home = 'index.php';
    case Destinations = 'destinations.php';
    case Journeys = 'journeys.php';
    case About = 'about.php';
    case Journal = 'journal.php';
    case Contact = 'contact.php';
    case Admin = 'admin.php';

    /** @return string */
    public function label(): string
    {
        return match ($this) {
            self::Home => 'Home',
            self::Destinations => 'Destinations',
            self::Journeys => 'Journeys',
            self::About => 'Our story',
            self::Journal => 'Journal',
            self::Contact => 'Contact',
            self::Admin => 'Demo dashboard',
        };
    }

    /** @return string */
    public function slug(): string
    {
        return basename($this->value, '.php');
    }

    /** @return self[] */
    public static function navigation(): array
    {
        return [self::Home, self::Destinations, self::Journeys, self::About, self::Journal, self::Contact];
    }
}
