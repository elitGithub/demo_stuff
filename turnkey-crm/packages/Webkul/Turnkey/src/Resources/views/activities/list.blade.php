<x-admin::datagrid src="{{ route('admin.activities.get') }}" ref="datagrid" class="turnkey-activity-grid">
    <template #header><span hidden></span></template>
    <template #body="{ isLoading, available, applied, selectAll, sort }">
        <div v-if="isLoading" class="ta-loading" role="status">
            <span class="ta-loading-bar" v-for="n in 5" :key="n"></span>
            <span class="ta-sr-only">@lang('turnkey::app.activities.loading')</span>
        </div>
        <template v-else>
            <div class="ta-mobile-tools">
                <label v-if="available.massActions.length" class="ta-select-label">
                    <input type="checkbox" :checked="applied.massActions.meta.mode === 'all'" :indeterminate="applied.massActions.meta.mode === 'partial'" @change="selectAll">
                    @lang('turnkey::app.activities.select_all')
                </label>
                <div class="ta-mobile-sort-group">
                    <label class="ta-mobile-sort">
                        @lang('turnkey::app.activities.sort')
                        <select :value="mobileSortColumn(applied)" @change="sort(available.columns.find(column => column.index === $event.target.value))">
                            <option v-for="column in available.columns.filter(column => ['title', 'lead_title', 'created_by_id', 'schedule_from'].includes(column.index))" :value="column.index">@{{ column.label }}</option>
                        </select>
                    </label>
                    <button class="ta-sort-direction" type="button" :aria-label="labels.reverse_sort" @click="sort(available.columns.find(column => column.index === mobileSortColumn(applied)))">@{{ applied.sort.order === 'asc' ? '↑' : '↓' }}</button>
                </div>
            </div>
            <table class="ta-table">
                <caption class="ta-sr-only">@lang('turnkey::app.activities.title')</caption>
                <thead>
                    <tr>
                        <th scope="col" class="ta-selection">
                            <input v-if="available.massActions.length" type="checkbox" aria-label="@lang('turnkey::app.activities.select_all')" :checked="applied.massActions.meta.mode === 'all'" :indeterminate="applied.massActions.meta.mode === 'partial'" @change="selectAll">
                        </th>
                        <th v-for="column in listColumns" :key="column.index" scope="col" :class="'ta-col-' + column.index" :aria-sort="applied.sort.column === column.index ? (applied.sort.order === 'asc' ? 'ascending' : 'descending') : 'none'">
                            <button v-if="column.index !== 'is_done'" type="button" @click="sort(available.columns.find(item => item.index === column.index))">
                                @{{ column.label }}
                                <span aria-hidden="true" class="ta-sort-icon">@{{ applied.sort.column === column.index ? (applied.sort.order === 'asc' ? '↑' : '↓') : '↕' }}</span>
                            </button>
                            <span v-else>@{{ column.label }}</span>
                        </th>
                        <th scope="col" class="ta-more"><span class="ta-sr-only">@lang('turnkey::app.activities.details')</span></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="record in available.records" :key="`${record.id}-${record.lead_id || 0}`" :class="{ 'ta-selected': applied.massActions.indices.includes(record.id) }">
                        <td class="ta-selection">
                            <input v-if="available.massActions.length" type="checkbox" :aria-label="labels.select + ': ' + record.title" :value="record.id" v-model="applied.massActions.indices">
                        </td>
                        <td class="ta-activity">
                            <div class="ta-activity-content">
                                <span class="ta-kind-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path :d="kindPath(record.turnkey.kind)"></path></svg></span>
                                <div>
                                    <button type="button" class="ta-title" @click="openDetails(record)">@{{ record.title }}</button>
                                    <span class="ta-secondary">@{{ record.type }}</span>
                                </div>
                            </div>
                        </td>
                        <td class="ta-opportunity" :data-label="labels.opportunity">
                            <a v-if="record.turnkey.lead_url" :href="record.turnkey.lead_url">@{{ record.lead_title }}</a>
                            <span v-else class="ta-muted">@lang('turnkey::app.activities.unlinked')</span>
                        </td>
                        <td class="ta-owner" :data-label="labels.owner">
                            <span class="ta-avatar" aria-hidden="true">@{{ initials(record.created_by_id) }}</span>
                            <span>@{{ record.created_by_id || labels.unassigned }}</span>
                        </td>
                        <td class="ta-due" :data-label="labels.due_date">
                            <span>@{{ record.turnkey.due_date || labels.unscheduled }}</span>
                            <span v-if="record.turnkey.due_time" class="ta-secondary">@{{ record.turnkey.due_time }}</span>
                        </td>
                        <td class="ta-status-cell">
                            <span class="ta-status" :class="'ta-status-' + record.turnkey.status"><span aria-hidden="true">@{{ record.is_done ? '✓' : '•' }}</span> @{{ labels[record.turnkey.status] }}</span>
                        </td>
                        <td class="ta-more">
                            <button type="button" class="ta-icon-button" :aria-label="labels.details + ': ' + record.title" @click="openDetails(record)"><span aria-hidden="true">→</span></button>
                        </td>
                    </tr>
                </tbody>
            </table>
            <div v-if="!available.records.length" class="ta-empty" role="status">
                <span class="ta-empty-icon" aria-hidden="true">✓</span>
                <h2>@lang('turnkey::app.activities.empty')</h2>
                <p>@lang('turnkey::app.activities.empty_hint')</p>
            </div>
        </template>
    </template>
</x-admin::datagrid>
