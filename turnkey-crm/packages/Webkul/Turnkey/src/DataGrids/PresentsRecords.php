<?php

namespace Webkul\Turnkey\DataGrids;

use Webkul\Turnkey\Support\RecordPresentation;

trait PresentsRecords
{
    public function prepareColumns(): void
    {
        parent::prepareColumns();

        foreach ($this->columns as $column) {
            $index = $column->getIndex();
            if ($index === 'person_name') {
                $column->setClosure(fn ($row) => $row->person_name ?? null);
            } elseif (in_array($index, ['emails', 'contact_numbers'])) {
                $column->setClosure(fn ($row) => collect(json_decode($row->{$index} ?? '[]', true) ?? [])->pluck('value')->join(', '));
            } elseif (in_array($index, ['expired_at', 'created_at']) && $closure = $column->getClosure()) {
                $column->setClosure(fn ($row) => empty($row->{$index}) ? null : $closure($row));
            }
        }
    }

    protected function formatRecords($records): mixed
    {
        $original = array_map(fn ($record) => clone $record, $records);
        $records = parent::formatRecords($records);
        foreach ($records as $index => $record) {
            // The company contact count is supplied by the upstream formatter.
            $original[$index]->persons_count = $record->persons_count ?? 0;
            $record->turnkey = RecordPresentation::make($this->screen, $original[$index]);
        }

        return $records;
    }

    public function prepareActions(): void
    {
        parent::prepareActions();
        $this->actions = array_values(array_filter($this->actions, fn ($action) => (! config('turnkey.read_only') || in_array($action->icon, ['icon-eye', 'icon-print']))
            && (! config('turnkey.demo') || $action->index !== 'mail')
        ));
    }

    public function prepareMassActions(): void
    {
        if (config('turnkey.read_only')) {
            return;
        }

        parent::prepareMassActions();
        $unique = [];
        foreach ($this->massActions as $action) {
            $unique[$action->method.' '.$action->url.' '.$action->title] = $action;
        }
        $this->massActions = array_values($unique);
    }
}
