<x-admin::layouts>
    <x-slot:title>@lang('turnkey::app.activities.title')</x-slot>
    {!! view_render_event('admin.activities.index.activities.before') !!}
    @include('turnkey::activities.screen')
    @include('turnkey::activities.calendar')
    {!! view_render_event('admin.activities.index.activities.after') !!}
</x-admin::layouts>
