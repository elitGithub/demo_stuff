@php($board = $recordScreen['key'] === 'leads' && request('view_type', 'table') === 'kanban')
@pushOnce('styles')
    <link rel="stylesheet" href="{{ asset('turnkey/activities.css') }}">
    <link rel="stylesheet" href="{{ asset('turnkey/records.css') }}">
@endPushOnce

<section class="turnkey-activities turnkey-records tr-{{ $recordScreen['key'] }}">
    <header class="ta-page-header">
        <div>
            <span class="ta-eyebrow">{{ config('turnkey.name') }}</span>
            <h1>{{ $recordScreen['title'] }}</h1>
            <p>{{ $recordScreen['intro'] }}</p>
        </div>
        <div class="tr-page-actions">
            @if ($recordScreen['key'] === 'leads' && ! config('turnkey.demo') && ! config('turnkey.read_only') && bouncer()->hasPermission('leads.create') && core()->getConfigData('general.magic_ai.doc_generation.enabled'))
                @include('admin::leads.index.upload')
            @endif
            @if (in_array($recordScreen['key'], ['persons', 'leads']) && ! $board)
                <x-admin::datagrid.export
                    :src="route('admin.'.$recordScreen['route'].'.index', request()->only('pipeline_id'))"
                    :google-contacts-src="$recordScreen['key'] === 'persons' && ! config('turnkey.demo') && ! config('turnkey.read_only') && bouncer()->hasPermission('contacts.persons.export_google') ? route('admin.contacts.persons.google_export.store') : null"
                />
            @endif
            @if (! config('turnkey.read_only') && bouncer()->hasPermission($recordScreen['route'].'.create'))
                <a href="{{ route('admin.'.$recordScreen['route'].'.create', $recordScreen['key'] === 'leads' ? request()->only('pipeline_id') : []) }}" class="ta-primary-button"><span aria-hidden="true">＋</span> {{ $recordScreen['create'] }}</a>
            @endif
        </div>
    </header>

    @if (in_array($recordScreen['key'], ['persons', 'organizations']))
        <nav class="tr-tabs" aria-label="@lang('turnkey::app.records.contacts')">
            @if (bouncer()->hasPermission('contacts.persons'))
            <a href="{{ route('admin.contacts.persons.index') }}" @if($recordScreen['key'] === 'persons') aria-current="page" @endif>@lang('turnkey::app.records.people')</a>
            @endif
            @if (bouncer()->hasPermission('contacts.organizations'))
            <a href="{{ route('admin.contacts.organizations.index') }}" @if($recordScreen['key'] === 'organizations') aria-current="page" @endif>@lang('turnkey::app.records.companies')</a>
            @endif
        </nav>
    @endif

    @if ($recordScreen['key'] === 'leads')
        <div class="tr-pipeline-toolbar">
            <x-admin::dropdown>
                <x-slot:toggle><button type="button" class="ta-secondary-button tr-pipeline-button"><span class="ta-muted">@lang('turnkey::app.records.pipeline')</span> {{ $pipeline->name }} <span aria-hidden="true">⌄</span></button></x-slot>
                <x-slot:content>
                    @foreach (app(\Webkul\Lead\Repositories\PipelineRepository::class)->all() as $option)
                        <a class="tr-pipeline-option" href="{{ route('admin.leads.index', array_merge(request()->query(), ['pipeline_id' => $option->id])) }}" @if($pipeline->id === $option->id) aria-current="true" @endif>{{ $option->name }}</a>
                    @endforeach
                </x-slot>
            </x-admin::dropdown>
            <nav class="ta-view-switch tr-view-switch" aria-label="{{ $recordScreen['title'] }}">
                <a href="{{ route('admin.leads.index', array_merge(request()->query(), ['view_type' => 'table'])) }}" @if(! $board) aria-current="page" @endif><span class="icon-list" aria-hidden="true"></span>@lang('turnkey::app.records.list')</a>
                <a href="{{ route('admin.leads.index', array_merge(request()->query(), ['view_type' => 'kanban'])) }}" @if($board) aria-current="page" @endif><span class="icon-kanban" aria-hidden="true"></span>@lang('turnkey::app.records.board')</a>
            </nav>
        </div>
    @endif

    @if ($board)
        <div class="tr-board">@include('admin::leads.index.kanban')</div>
    @else
        @include('turnkey::records.grid')
    @endif
</section>
