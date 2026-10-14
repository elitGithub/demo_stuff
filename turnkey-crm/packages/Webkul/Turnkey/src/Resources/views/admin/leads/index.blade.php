<x-admin::layouts>
    <x-slot:title>@lang('turnkey::app.records.leads.title')</x-slot>
    {!! view_render_event('admin.leads.index.header.before') !!}
    @include('turnkey::records.page', ['recordScreen' => \Webkul\Turnkey\Support\RecordScreens::get('leads')])
    {!! view_render_event('admin.leads.index.content.after') !!}
</x-admin::layouts>
