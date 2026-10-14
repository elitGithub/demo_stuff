<v-activities>
    <div class="turnkey-activities"><h1>@lang('turnkey::app.activities.title')</h1><p>@lang('turnkey::app.activities.loading')</p></div>
</v-activities>

@pushOnce('styles')
    <link rel="stylesheet" href="{{ asset('turnkey/activities.css') }}">
@endPushOnce

@pushOnce('scripts')
    <script type="text/x-template" id="v-activities-template">
        <section class="turnkey-activities">
            <header class="ta-page-header">
                <div><span class="ta-eyebrow">{{ config('turnkey.name') }}</span><h1>@lang('turnkey::app.activities.title')</h1><p>@lang('turnkey::app.activities.intro')</p></div>
                <div class="ta-view-switch" role="group" aria-label="@lang('turnkey::app.activities.title')">
                    <button type="button" :aria-pressed="viewType === 'table'" @click="toggleView('table')"><svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 5h11M6 10h11M6 15h11M2 5h1M2 10h1M2 15h1"/></svg>@lang('turnkey::app.activities.list')</button>
                    <button type="button" :aria-pressed="viewType === 'calendar'" @click="toggleView('calendar')"><svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M6 2v4M14 2v4M3 8h14"/></svg>@lang('turnkey::app.activities.calendar')</button>
                </div>
            </header>
            <template v-if="viewType === 'table'">
                {!! view_render_event('admin.activities.index.datagrid.before') !!}
                @include('turnkey::activities.list')
                {!! view_render_event('admin.activities.index.datagrid.after') !!}
            </template>
            <template v-else>
                {!! view_render_event('admin.activities.index.vue_calender.before') !!}
                <v-calendar ref="calendar"></v-calendar>
                {!! view_render_event('admin.activities.index.vue_calender.after') !!}
            </template>
            @include('turnkey::activities.detail')
        </section>
    </script>
    <script type="module">
        app.component('v-activities', {
            template: '#v-activities-template',
            data() {
                const labels = @json(trans('turnkey::app.activities'));
                return {
                    labels,
                    viewType: @json(request('view-type') === 'calendar' ? 'calendar' : 'table'),
                    selected: null,
                    saving: false,
                    detailError: '',
                    listColumns: [
                        { index: 'title', label: labels.activity },
                        { index: 'lead_title', label: labels.opportunity },
                        { index: 'created_by_id', label: labels.owner },
                        { index: 'schedule_from', label: labels.due_date },
                        { index: 'is_done', label: labels.status },
                    ],
                };
            },
            methods: {
                toggleView(type) {
                    this.viewType = type;
                    const url = new URL(window.location);
                    url.searchParams.set('view-type', type);
                    window.history.replaceState({}, '', url);
                },
                openDetails(record) {
                    this.selected = record;
                    this.detailError = '';
                    this.$nextTick(() => this.$refs.detail.showModal());
                },
                initials(name) {
                    return (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => [...part][0]).join('').toUpperCase() || '—';
                },
                kindPath(kind) {
                    return kind === 'call'
                        ? 'M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a13 13 0 0 1-7-7l2-2-2-5Z'
                        : kind === 'lunch' ? 'M5 3v6m3-6v6M3 6h7M6.5 9v12M17 3c-3 5-3 9 0 9h2M19 3v18'
                        : 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM7 3v4M17 3v4M3 11h18M7 15h3';
                },
                editAction(record) {
                    return record.actions?.find(action => action.index === 'edit');
                },
                mobileSortColumn(applied) {
                    return this.listColumns.some(column => column.index === applied.sort.column && column.index !== 'is_done') ? applied.sort.column : 'title';
                },
                async toggleComplete() {
                    if (this.saving || !this.editAction(this.selected)) return;
                    const record = this.selected;
                    this.saving = true;
                    this.detailError = '';
                    try {
                        await this.$axios.put(record.turnkey.update_url, { is_done: !record.is_done });
                        if (this.selected === record) this.$refs.detail.close();
                        if (this.$refs.datagrid) {
                            this.$refs.datagrid.get();
                        } else if (this.$refs.calendar?.lastViewRange) {
                            this.$refs.calendar.getActivities(this.$refs.calendar.lastViewRange);
                        }
                    } catch (error) {
                        if (this.selected === record) {
                            this.detailError = error.response?.data?.message || this.labels.update_failed;
                        }
                    } finally {
                        this.saving = false;
                    }
                },
            },
        });
    </script>
@endPushOnce
