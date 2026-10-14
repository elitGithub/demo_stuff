<?php

namespace Webkul\Turnkey\DataGrids;

use Carbon\Carbon;
use Webkul\Admin\DataGrids\Activity\ActivityDataGrid as BaseActivityDataGrid;

class ActivityDataGrid extends BaseActivityDataGrid
{
    public function prepareColumns(): void
    {
        parent::prepareColumns();

        // Keep the original query, filters and ACL scope; render values as Vue text.
        foreach ($this->columns as $column) {
            $index = $column->getIndex();

            if (in_array($index, ['id', 'comment', 'type', 'schedule_to', 'created_at'])) {
                $column->setVisibility(false);
            }

            $closure = match ($index) {
                'is_done' => fn ($row) => (bool) $row->is_done,
                'created_by_id' => fn ($row) => $row->created_by,
                'lead_title' => fn ($row) => $row->lead_title,
                'schedule_from', 'schedule_to', 'created_at' => fn ($row) => $row->{$index}
                    ? Carbon::parse($row->{$index})->format('M j, Y · g:i A') : null,
                default => null,
            };

            if ($closure) {
                $column->setClosure($closure);
            }

            $label = match ($index) {
                'title' => 'activity', 'created_by_id' => 'owner', 'lead_title' => 'opportunity',
                'schedule_from' => 'due_date', 'is_done' => 'status', default => null,
            };

            if ($label) {
                $column->setLabel(trans('turnkey::app.activities.'.$label));
            }
        }
    }

    protected function formatRecords($records): mixed
    {
        foreach ($records as $record) {
            $start = $record->schedule_from ? Carbon::parse($record->schedule_from) : null;
            $end = $record->schedule_to ? Carbon::parse($record->schedule_to) : $start;

            $record->turnkey = [
                'kind' => $record->type,
                'status' => $record->is_done ? 'completed' : ($end?->isPast() ? 'overdue' : 'planned'),
                'due_date' => $start?->format('M j, Y'),
                'due_time' => $start?->format('g:i A'),
                'lead_url' => $record->lead_id ? route('admin.leads.view', $record->lead_id) : null,
                'update_url' => route('admin.activities.update', $record->id),
                'updated_at' => $record->updated_at ? Carbon::parse($record->updated_at)->format('M j, Y · g:i A') : null,
            ];
        }

        return parent::formatRecords($records);
    }

    public function prepareActions(): void
    {
        if (! config('turnkey.read_only')) {
            parent::prepareActions();
        }
    }

    public function prepareMassActions(): void
    {
        if (! config('turnkey.read_only')) {
            parent::prepareMassActions();
        }
    }
}
