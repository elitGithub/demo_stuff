<x-admin::layouts>
    <x-slot:title>@lang('turnkey::app.records.organizations.title')</x-slot>
    {!! view_render_event('admin.organizations.datagrid.index.before') !!}
    @include('turnkey::records.page', ['recordScreen' => \Webkul\Turnkey\Support\RecordScreens::get('organizations')])
    {!! view_render_event('admin.organizations.datagrid.index.after') !!}
</x-admin::layouts>
