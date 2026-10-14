<?php

use Carbon\Carbon;
use Tests\Support\TurnkeyViewSandbox;
use Webkul\Admin\DataGrids\Activity\ActivityDataGrid as BaseActivityDataGrid;
use Webkul\Turnkey\DataGrids\ActivityDataGrid;

it('presents activities as plain data with accurate dates and status without database access', function () {
    $app = TurnkeyViewSandbox::create(true);
    Carbon::setTestNow('2026-10-14 12:00:00');

    try {
        expect($app->make(BaseActivityDataGrid::class))->toBeInstanceOf(ActivityDataGrid::class);
        $app['router']->get('admin/leads/view/{id}', fn () => null)->name('admin.leads.view');
        $app['router']->put('admin/activities/edit/{id}', fn () => null)->name('admin.activities.update');
        $app['router']->getRoutes()->refreshNameLookups();
        $grid = $app->make(BaseActivityDataGrid::class);
        $grid->prepareColumns();

        $rows = [];
        foreach ([['0', '2026-10-13 09:00:00'], ['1', '2026-10-13 09:00:00'], [0, null]] as $index => [$done, $date]) {
            $rows[] = (object) [
                'id' => $index + 1, 'title' => 'Review scope', 'type' => 'call',
                'created_by_id' => 7, 'created_by' => '<b>Avery Taylor</b>',
                'lead_id' => null, 'lead_title' => null, 'is_done' => $done,
                'schedule_from' => $date, 'schedule_to' => $date,
                'created_at' => '2026-10-01 09:00:00', 'updated_at' => null,
                'comment' => '<script>alert(1)</script> Follow up.',
            ];
        }
        $rows[1]->lead_id = 42;
        $rows[1]->lead_title = '<b>Website refresh</b>';
        $records = (new ReflectionMethod($grid, 'formatRecords'))->invoke($grid, $rows);

        expect($records[0]->created_by_id)->toBe('Avery Taylor')
            ->and($records[0]->is_done)->toBeFalse()
            ->and($records[0]->turnkey['status'])->toBe('overdue')
            ->and($records[1]->turnkey['status'])->toBe('completed')
            ->and($records[2]->turnkey['status'])->toBe('planned')
            ->and($records[2]->turnkey['due_date'])->toBeNull()
            ->and($records[2]->schedule_from)->toBeNull()
            ->and($records[0]->turnkey['lead_url'])->toBeNull()
            ->and($records[1]->turnkey['lead_url'])->toEndWith('/admin/leads/view/42')
            ->and($records[1]->lead_title)->toBe('Website refresh')
            ->and($records[0]->turnkey['due_date'])->toBe('Oct 13, 2026')
            ->and($records[0]->turnkey['due_time'])->toBe('9:00 AM')
            ->and($records[0]->comment)->not->toContain('<script>')
            ->and($app->bound('db'))->toBeFalse();
    } finally {
        Carbon::setTestNow();
        TurnkeyViewSandbox::close();
    }
});

it('exposes no write actions for read-only activities', function () {
    $app = TurnkeyViewSandbox::create(true);

    try {
        $app['config']->set('turnkey.read_only', true);
        $grid = $app->make(BaseActivityDataGrid::class);
        expect($grid)->toBeInstanceOf(ActivityDataGrid::class);
        $grid->prepareActions();
        $grid->prepareMassActions();
        expect($grid->getActions())->toBe([])
            ->and($grid->getMassActions())->toBe([])
            ->and($app->bound('db'))->toBeFalse();
    } finally {
        TurnkeyViewSandbox::close();
    }
});
