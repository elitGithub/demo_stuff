<v-turnkey-records :screen='@json($recordScreen)' src="{{ route('admin.'.$recordScreen['route'].'.index', request()->only('pipeline_id')) }}">
    <div class="ta-loading" role="status">@lang('turnkey::app.records.loading')</div>
</v-turnkey-records>

@pushOnce('scripts')
    <script type="text/x-template" id="v-turnkey-records-template">
        <div>
            <x-admin::datagrid ::src="src" ref="datagrid" class="turnkey-activity-grid">
                <template #header><span hidden></span></template>
                <template #body="{ isLoading, available, applied, selectAll, sort, performAction }">
                    <div v-if="isLoading" class="ta-loading" role="status"><span class="ta-loading-bar" v-for="n in 5" :key="n"></span><span class="ta-sr-only">@lang('turnkey::app.records.loading')</span></div>
                    <template v-else>
                        <div class="ta-mobile-tools">
                            <label v-if="available.massActions.length" class="ta-select-label"><input type="checkbox" :checked="applied.massActions.meta.mode === 'all'" :indeterminate="applied.massActions.meta.mode === 'partial'" @change="selectAll" :disabled="!available.records.length">@lang('turnkey::app.records.select_all')</label>
                            <div class="ta-mobile-sort-group">
                                <label class="ta-mobile-sort">@lang('turnkey::app.records.sort')<select :value="sortIndex(applied, available)" @change="sort(columnFor($event.target.value, available))"><option v-for="column in sortableColumns(available)" :key="column.index" :value="column.index">@{{ column.label }}</option></select></label>
                                <button type="button" class="ta-sort-direction" aria-label="@lang('turnkey::app.records.reverse_sort')" @click="sort(columnFor(sortIndex(applied, available), available))">@{{ applied.sort.order === 'asc' ? '↑' : '↓' }}</button>
                            </div>
                        </div>
                        <table class="ta-table tr-table">
                            <caption class="ta-sr-only">@{{ screen.title }}</caption>
                            <thead><tr>
                                <th scope="col" class="ta-selection"><input v-if="available.massActions.length" type="checkbox" aria-label="@lang('turnkey::app.records.select_all')" :checked="applied.massActions.meta.mode === 'all'" :indeterminate="applied.massActions.meta.mode === 'partial'" @change="selectAll" :disabled="!available.records.length"></th>
                                <th v-for="column in displayColumns" :key="column.index" scope="col" :class="{ 'tr-primary-column': column.index === screen.primary }" :aria-sort="applied.sort.column === column.index ? (applied.sort.order === 'asc' ? 'ascending' : 'descending') : 'none'">
                                    <button v-if="columnFor(column.index, available)?.sortable" type="button" @click="sort(columnFor(column.index, available))">@{{ column.label }}<span class="ta-sort-icon" aria-hidden="true">@{{ applied.sort.column === column.index ? (applied.sort.order === 'asc' ? '↑' : '↓') : '↕' }}</span></button><span v-else>@{{ column.label }}</span>
                                </th>
                                <th scope="col" class="ta-more"><span class="ta-sr-only">@lang('turnkey::app.records.details')</span></th>
                            </tr></thead>
                            <tbody><tr v-for="record in available.records" :key="record.id" :class="{ 'ta-selected': applied.massActions.indices.includes(record.id) }">
                                <td class="ta-selection"><input v-if="available.massActions.length" type="checkbox" :aria-label="labels.select + ': ' + record.turnkey.title" :value="record.id" v-model="applied.massActions.indices"></td>
                                <td class="tr-record-title">
                                    <div class="ta-activity-content">
                                        <span v-if="screen.key === 'persons'" class="tr-contact-avatar" aria-hidden="true">@{{ initials(record.turnkey.title) }}</span>
                                        <span v-else class="ta-kind-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path :d="recordIcon"></path></svg></span>
                                        <div><button type="button" class="ta-title" @click="openDetails(record, performAction)">@{{ record.turnkey.title }}</button><span v-if="record.turnkey.subtitle" class="ta-secondary">@{{ record.turnkey.subtitle }}</span></div>
                                    </div>
                                </td>
                                <td v-for="column in screen.columns" :key="column.index" :data-label="column.label" :class="['tr-field', 'tr-field-' + column.index]">
                                    <div class="tr-cell" :class="'tr-cell-' + record.turnkey.cells[column.index].kind">
                                        <span v-if="record.turnkey.cells[column.index].kind === 'owner' && record.turnkey.cells[column.index].text !== '—'" class="ta-avatar" aria-hidden="true">@{{ initials(record.turnkey.cells[column.index].text) }}</span>
                                        <span :class="cellClass(record.turnkey.cells[column.index])">@{{ record.turnkey.cells[column.index].text }}</span>
                                        <span v-if="record.turnkey.cells[column.index].secondary" class="ta-secondary">@{{ record.turnkey.cells[column.index].secondary }}</span>
                                    </div>
                                </td>
                                <td class="ta-more"><button type="button" class="ta-icon-button" :aria-label="labels.details + ': ' + record.turnkey.title" @click="openDetails(record, performAction)"><span aria-hidden="true">→</span></button></td>
                            </tr></tbody>
                        </table>
                        <div v-if="!available.records.length" class="ta-empty" role="status"><span class="ta-empty-icon" aria-hidden="true">⌕</span><h2>@lang('turnkey::app.records.empty')</h2><p>@lang('turnkey::app.records.empty_hint')</p></div>
                    </template>
                </template>
            </x-admin::datagrid>
            @include('turnkey::records.detail')
        </div>
    </script>
    <script type="module">
        app.component('v-turnkey-records', {
            template: '#v-turnkey-records-template',
            props: ['screen', 'src'],
            data() { return { labels: @json(trans('turnkey::app.records')), selected: null, performRecordAction: null }; },
            computed: {
                displayColumns() { return [{ index: this.screen.primary, label: this.screen.primary_label }, ...this.screen.columns]; },
                recordIcon() {
                    return this.screen.key === 'organizations' ? 'M4 21V3h12v18M16 9h4v12M8 7h4M8 11h4M8 15h4M8 21v-3h4v3M2 21h20'
                        : this.screen.key === 'leads' ? 'M4 19 10 13l4 4 7-10M15 7h6v6M3 3v18h18'
                        : 'M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8M8 16h5';
                },
            },
            methods: {
                initials(name) { return (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => [...part][0]).join('').toUpperCase(); },
                columnFor(index, available) { return available.columns.find(column => column.index === index); },
                sortableColumns(available) { return this.displayColumns.filter(column => this.columnFor(column.index, available)?.sortable); },
                sortIndex(applied, available) { return this.sortableColumns(available).some(column => column.index === applied.sort.column) ? applied.sort.column : this.screen.primary; },
                cellClass(cell) { return cell.kind === 'badge' && cell.text !== '—' ? 'ta-status tr-badge-' + cell.tone : (cell.text === '—' ? 'ta-muted' : ''); },
                openDetails(record, performAction) { this.selected = record; this.performRecordAction = performAction; this.$nextTick(() => this.$refs.detail.showModal()); },
                runAction(action) { const perform = this.performRecordAction; this.$refs.detail.close(); perform(action); },
                isLink(action) { return action.method.toUpperCase() === 'GET'; },
            },
        });
    </script>
@endPushOnce
