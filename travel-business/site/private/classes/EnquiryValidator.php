<?php

namespace Elsewhere;

final class EnquiryValidator
{
    public const Whitespace = '\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}';

    /** @param Catalog $catalog @param \Closure $now */
    public function __construct(public readonly Catalog $catalog, public readonly \Closure $now) {}

    /** @param object $raw @return EnquiryInput */
    public function validate(object $raw): EnquiryInput
    {
        $firstName = $this->text($raw, 'firstName', 60, true);
        $lastName = $this->text($raw, 'lastName', 60, true);
        $email = $this->text($raw, 'email', 160, true);
        if (!preg_match('/^[^'.self::Whitespace.'@]+@[^'.self::Whitespace.'@]+\.[^'.self::Whitespace.'@]+$/uD', $email)) { throw new DemoError('Please enter a valid email address.'); }
        $destination = $this->text($raw, 'destination', 40);
        if ($destination !== '' && !in_array($destination, array_column($this->catalog->destinations, 'id'), true)) { throw new DemoError('Please choose a destination from the list.'); }
        $journey = $this->text($raw, 'journey', 60);
        $selected = null;
        foreach ($this->catalog->journeys as $candidate) { if ($candidate->id === $journey) { $selected = $candidate; } }
        if ($journey !== '' && $selected === null) { throw new DemoError('Please choose a journey from the list.'); }
        if ($selected !== null && $destination !== '' && $selected->destination !== $destination) { throw new DemoError('Please choose a journey that matches your destination, or select a personal journey.'); }
        if ($selected !== null && $destination === '') { $destination = $selected->destination; }
        $departure = $this->text($raw, 'departure', 10);
        if ($departure !== '') {
            $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $departure, new \DateTimeZone('UTC'));
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/D', $departure) || $date === false || $date->format('Y-m-d') !== $departure) { throw new DemoError('Please choose a valid departure date.'); }
            if ($departure < gmdate('Y-m-d', ($this->now)() - 86400)) { throw new DemoError('Please choose a future departure date, or leave it flexible.'); }
        }
        if (!property_exists($raw, 'travelers') || (!is_int($raw->travelers) && !(is_float($raw->travelers) && is_finite($raw->travelers) && floor($raw->travelers) === $raw->travelers)) || $raw->travelers < 1 || $raw->travelers > 12) { throw new DemoError('Please choose between 1 and 12 travellers.'); }
        $budget = $this->text($raw, 'budget', 40);
        if (!in_array($budget, $this->catalog->budgets, true)) { throw new DemoError('Please choose a budget from the list.'); }
        if (!property_exists($raw, 'consent') || $raw->consent !== true) { throw new DemoError('Please acknowledge that this is a demo using fictional details.'); }
        return new EnquiryInput(firstName: $firstName, lastName: $lastName, email: $email, destination: $destination, journey: $journey, departure: $departure, travelers: (int) $raw->travelers, budget: $budget, message: $this->text($raw, 'message', 2000));
    }

    /** @param object $raw @param string $key @param int $maximum @param bool $required @return string */
    public function text(object $raw, string $key, int $maximum, bool $required = false): string
    {
        $field = property_exists($raw, $key) ? $raw->$key : '';
        if (!is_string($field) || preg_match('//u', $field) !== 1) { throw new DemoError('Please check the '.$key.' field.'); }
        $value = preg_replace('/^['.self::Whitespace.']+|['.self::Whitespace.']+$/u', '', $field);
        if (($required && $value === '') || preg_match_all('/./us', $value) > $maximum || preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', $value)) { throw new DemoError('Please check the '.$key.' field.'); }
        return $value;
    }
}
