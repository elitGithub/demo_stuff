<x-admin::layouts>
    <x-slot:title>@lang('turnkey::app.records.quotes.title')</x-slot>
    {!! view_render_event('admin.quotes.index.datagrid.before') !!}
    @include('turnkey::records.page', ['recordScreen' => \Webkul\Turnkey\Support\RecordScreens::get('quotes')])
    {!! view_render_event('admin.quotes.index.datagrid.after') !!}
</x-admin::layouts>
