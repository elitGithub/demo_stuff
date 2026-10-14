<?php

use Carbon\Carbon;
use Tests\Support\TurnkeyViewSandbox;
use Webkul\Turnkey\Support\RecordPresentation;

beforeEach(function () {
    $this->app = TurnkeyViewSandbox::create(true);
    $this->app['config']->set('app.currency', 'USD');
    Carbon::setTestNow('2026-10-14 15:00:00');
});

afterEach(function () {
    expect($this->app->bound('db'))->toBeFalse();
    Carbon::setTestNow();
    TurnkeyViewSandbox::close();
});

it('presents contact details without losing secondary numbers or exposing markup', function () {
    $record = (object) ['id' => 3, 'person_name' => '<b>Alex Morgan</b>', 'organization' => null,
        'emails' => '[{"value":"alex@customer.example"},{"value":"hello@customer.example"}]',
        'contact_numbers' => null, 'tag_name' => null];
    $result = RecordPresentation::make('persons', $record);
    expect($result['title'])->toBe('Alex Morgan')
        ->and($result['cells']['emails']['text'])->toBe('alex@customer.example')
        ->and($result['cells']['emails']['secondary'])->toBe('+1 more')
        ->and($result['cells']['contact_numbers']['text'])->toBe('—')
        ->and($result['details'][0]['value'])->toContain('hello@customer.example');
});

it('handles missing or malformed contact arrays', function ($value) {
    $result = RecordPresentation::make('persons', (object) ['id' => 1, 'person_name' => 'Sam', 'emails' => $value]);
    expect($result['cells']['emails']['text'])->toBe('—');
})->with([null, '', 'invalid', '{}', '[null,{"label":"work"}]']);

it('shows quote validity without inventing a sales status or making null dates current', function ($expiry, $tone, $label) {
    $result = RecordPresentation::make('quotes', (object) ['id' => 2, 'subject' => 'Service review', 'expired_at' => $expiry,
        'grand_total' => 0, 'person_name' => null]);
    expect($result['cells']['validity']['tone'])->toBe($tone)
        ->and($result['cells']['validity']['text'])->toBe($label)
        ->and($result['cells']['grand_total']['text'])->toBe('$0.00');
    if ($expiry === null) {
        expect($result['cells']['expired_at']['text'])->toBe('—');
    }
})->with([[null, 'neutral', 'No expiry'], ['2026-10-14 00:00:00', 'blue', 'Active'], ['2026-10-13', 'amber', 'Expired']]);

it('uses the actual opportunity stage and keeps financial precision', function () {
    $result = RecordPresentation::make('leads', (object) ['id' => 4, 'title' => 'New branch', 'stage' => 'Won',
        'stage_code' => 'won', 'lead_value' => 1234.56, 'expected_close_date' => null]);
    expect($result['cells']['stage']['text'])->toBe('Won')
        ->and($result['cells']['stage']['tone'])->toBe('blue')
        ->and($result['cells']['lead_value']['text'])->toBe('$1,234.56')
        ->and($result['cells']['expected_close_date']['text'])->toBe('—');
});

it('summarizes a company address and preserves zero contacts', function () {
    $result = RecordPresentation::make('organizations', (object) ['id' => 1, 'name' => 'Maple & Co',
        'address' => '{"address":["12 Main Street"],"city":"Bristol","postcode":"BS1 1AA","country":"GB"}',
        'persons_count' => 0]);
    expect($result['cells']['location']['text'])->toBe('Bristol, GB')
        ->and($result['cells']['persons_count']['text'])->toBe('0')
        ->and($result['details'][0]['value'])->toContain('12 Main Street', 'BS1 1AA');
});
