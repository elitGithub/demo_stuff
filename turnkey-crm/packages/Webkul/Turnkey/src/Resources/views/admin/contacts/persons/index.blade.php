<x-admin::layouts>
    <x-slot:title>@lang('turnkey::app.records.persons.title')</x-slot>
    {!! view_render_event('admin.persons.index.datagrid.before') !!}
    @include('turnkey::records.page', ['recordScreen' => \Webkul\Turnkey\Support\RecordScreens::get('persons')])
    {!! view_render_event('admin.persons.index.datagrid.after') !!}
</x-admin::layouts>
