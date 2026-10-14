<?php

use Webkul\Contact\Repositories\PersonRepository;
use Webkul\Turnkey\Support\DemoDataset;

it('passes email-only demo contacts through the native person sanitizer', function () {
    $contact = DemoDataset::build(new DateTimeImmutable('2026-10-14'))['contacts'][0];
    $payload = DemoDataset::personAttributes($contact, 10, 20);
    $repository = (new ReflectionClass(PersonRepository::class))->newInstanceWithoutConstructor();
    $sanitize = new ReflectionMethod(PersonRepository::class, 'sanitizeRequestedPersonData');
    $result = $sanitize->invoke($repository, $payload);

    expect($result['unique_id'])->toBe('20|10|alex.morgan@customer.example');
    expect($result['emails'][0]['value'])->toBe($contact['email']);
});

it('builds a connected fictional sales story with current dates', function () {
    $data = DemoDataset::build(new DateTimeImmutable('2026-10-14 09:00:00'));
    expect($data['companies'])->toHaveCount(8);
    expect($data['contacts'])->toHaveCount(12);
    expect($data['leads'])->toHaveCount(12);
    expect($data['activities'])->toHaveCount(16);
    expect($data['quotes'])->toHaveCount(4);
    foreach ($data['contacts'] as $person) {
        expect($person['company'])->toBeLessThan(count($data['companies']));
        expect($person['email'])->toEndWith('.example');
    }
    foreach ($data['leads'] as $lead) {
        expect($lead['contact'])->toBeLessThan(count($data['contacts']));
    }
    expect(array_unique(array_column($data['leads'], 'stage')))->toHaveCount(6);
    expect($data['activities'][0]['schedule_from'])->toBe('2026-10-13 09:00:00');
    expect($data['activities'][1]['schedule_from'])->toBe('2026-10-14 09:00:00');
    expect($data['quotes'][0]['expired_at'])->toBe('2026-10-28 09:00:00');
});

it('moves the entire demo story when seeded on a later date', function () {
    $data = DemoDataset::build(new DateTimeImmutable('2027-02-01 09:00:00'));
    expect($data['activities'][0]['schedule_from'])->toBe('2027-01-31 09:00:00');
    expect($data['quotes'][0]['expired_at'])->toBe('2027-02-15 09:00:00');
    foreach ($data['quotes'] as $quote) {
        expect($quote['quantity'] * $data['services'][$quote['service']]['price'])->toBeGreaterThan(0);
    }
});
