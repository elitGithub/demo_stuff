<?php

use Tests\Support\RecordListSandbox;
use Tests\Support\TurnkeyViewSandbox;
use Webkul\Turnkey\Support\RecordScreens;

it('integrates each record presenter with native formatting and read-only actions', function (string $screen) {
    $app = RecordListSandbox::create();
    try {
        foreach ([false, true] as $readOnly) {
            $app['config']->set('turnkey.read_only', $readOnly);
            $grid = $app->make(RecordListSandbox::classes()[$screen]);
            $grid->prepareColumns();
            $grid->prepareActions();
            $grid->prepareMassActions();
            $record = (new ReflectionMethod($grid, 'formatRecords'))->invoke($grid, [RecordListSandbox::row($screen)])[0];
            expect($record->turnkey['title'])->not->toBeEmpty();
            foreach (RecordScreens::get($screen)['columns'] as $column) {
                expect($record->turnkey['cells'])->toHaveKey($column['index']);
            }
            expect(array_filter($record->actions, fn ($action) => $action['index'] === 'mail'))->toBe([]);
            if ($readOnly) {
                expect($grid->getMassActions())->toBe([]);
                foreach ($record->actions as $action) {
                    expect($action['icon'])->toBeIn(['icon-eye', 'icon-print']);
                }
            }
            if (property_exists($record, 'expired_at')) {
                expect($record->expired_at)->toBeNull();
            }
        }
        expect($app->bound('db'))->toBeFalse();
    } finally {
        Mockery::close();
        TurnkeyViewSandbox::close();
    }
})->with(['persons', 'organizations', 'leads', 'quotes']);

it('preserves permission checks on record actions', function () {
    $app = RecordListSandbox::create();
    try {
        $app['config']->set('test.denied_permissions', ['contacts.persons.view', 'contacts.persons.edit', 'contacts.persons.delete']);
        $grid = $app->make(RecordListSandbox::classes()['persons']);
        $grid->prepareActions();
        $grid->prepareMassActions();
        expect($grid->getActions())->toBe([])->and($grid->getMassActions())->toBe([])->and($app->bound('db'))->toBeFalse();
    } finally {
        Mockery::close();
        TurnkeyViewSandbox::close();
    }
});
