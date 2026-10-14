<?php

use Tests\Support\RecordListSandbox;
use Tests\Support\TurnkeyViewSandbox;
use Webkul\Core\Core;
use Webkul\Lead\Repositories\PipelineRepository;
use Webkul\Turnkey\Support\RecordScreens;

afterEach(function () {
    Mockery::close();
    TurnkeyViewSandbox::close();
});

it('keeps Google export only for authorized editable customer installations', function (bool $demo, bool $readOnly, bool $permission, bool $visible) {
    $app = RecordListSandbox::create($demo);
    $app['config']->set('turnkey.read_only', $readOnly);
    $app['config']->set('test.denied_permissions', $permission ? [] : ['contacts.persons.export_google']);
    $html = $app['view']->make('turnkey::records.page', ['recordScreen' => RecordScreens::get('persons')])->render();
    expect(str_contains($html, 'google-contacts-src="http://localhost:8082/admin/contacts/persons/google-export"'))->toBe($visible)
        ->and($app->bound('db'))->toBeFalse();
})->with([
    'customer' => [false, false, true, true],
    'demo' => [true, false, true, false],
    'read-only' => [false, true, true, false],
    'no permission' => [false, false, false, false],
]);

it('does not offer a forbidden contact directory or creation action', function () {
    $app = RecordListSandbox::create();
    $app['config']->set('test.denied_permissions', ['contacts.organizations', 'contacts.persons.create']);
    $html = $app['view']->make('turnkey::records.page', ['recordScreen' => RecordScreens::get('persons')])->render();
    expect($html)->not->toContain('href="http://localhost:8082/admin/contacts/organizations"')
        ->not->toContain('href="http://localhost:8082/admin/contacts/persons/create"')
        ->toContain('href="http://localhost:8082/admin/contacts/persons"');
    expect($app->bound('db'))->toBeFalse();
});

it('preserves optional document upload for authorized customer installations', function (bool $demo, bool $readOnly, bool $permission, bool $visible) {
    $app = RecordListSandbox::create($demo);
    $app['config']->set('turnkey.read_only', $readOnly);
    $app['config']->set('test.denied_permissions', $permission ? [] : ['leads.create']);
    $app->instance('core', new class extends Core
    {
        public function __construct() {}

        public function getConfigData(string $field): mixed
        {
            return $field === 'general.magic_ai.doc_generation.enabled';
        }
    });
    $html = $app['view']->make('turnkey::records.page', [
        'recordScreen' => RecordScreens::get('leads'),
        'pipeline' => $app->make(PipelineRepository::class)->getDefaultPipeline(),
    ])->render();
    expect(str_contains($html, '<v-upload>'))->toBe($visible)->and($app->bound('db'))->toBeFalse();
})->with([
    'customer' => [false, false, true, true],
    'demo' => [true, false, true, false],
    'read-only' => [false, true, true, false],
    'no permission' => [false, false, false, false],
]);
