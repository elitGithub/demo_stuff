<?php

namespace Webkul\Turnkey\Support;

final class RecordScreens
{
    public static function get(string $screen): array
    {
        $definitions = [
            'persons' => ['route' => 'contacts.persons', 'primary' => 'person_name', 'columns' => ['organization' => 'company', 'emails' => 'email', 'contact_numbers' => 'phone', 'tag_name' => 'tag']],
            'organizations' => ['route' => 'contacts.organizations', 'primary' => 'name', 'columns' => ['location' => 'location', 'persons_count' => 'contacts']],
            'leads' => ['route' => 'leads', 'primary' => 'title', 'columns' => ['person_name' => 'customer', 'lead_value' => 'value', 'stage' => 'stage', 'sales_person' => 'owner', 'expected_close_date' => 'expected_close']],
            'quotes' => ['route' => 'quotes', 'primary' => 'subject', 'columns' => ['person_name' => 'customer', 'grand_total' => 'total', 'expired_at' => 'valid_until', 'sales_person' => 'owner', 'validity' => 'validity']],
        ];
        $config = $definitions[$screen];
        $config['key'] = $screen;
        $config['title'] = trans('turnkey::app.records.'.$screen.'.title');
        $config['intro'] = trans('turnkey::app.records.'.$screen.'.intro');
        $config['create'] = trans('turnkey::app.records.'.$screen.'.create');
        $config['primary_label'] = trans('turnkey::app.records.'.$screen.'.singular');
        $config['columns'] = array_map(fn ($index, $label) => ['index' => $index, 'label' => trans('turnkey::app.records.'.$label)], array_keys($config['columns']), $config['columns']);

        return $config;
    }
}
