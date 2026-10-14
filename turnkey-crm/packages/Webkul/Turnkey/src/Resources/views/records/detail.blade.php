<dialog ref="detail" class="ta-detail tr-detail" aria-labelledby="tr-detail-title" @close="selected = null" @click.self="$refs.detail.close()">
    <template v-if="selected">
        <header class="ta-detail-header"><span class="ta-eyebrow">@{{ screen.primary_label }} · @lang('turnkey::app.records.details')</span><button type="button" class="ta-icon-button" aria-label="@lang('turnkey::app.records.close')" @click="$refs.detail.close()" autofocus>×</button></header>
        <div class="ta-detail-body">
            <span v-if="selected.turnkey.subtitle" class="ta-secondary">@{{ selected.turnkey.subtitle }}</span>
            <h2 id="tr-detail-title">@{{ selected.turnkey.title }}</h2>
            <section class="ta-detail-section">
                <h3>@lang('turnkey::app.records.summary')</h3>
                <dl class="ta-detail-dates tr-detail-fields"><div v-for="column in screen.columns" :key="column.index"><dt>@{{ column.label }}</dt><dd><span :class="cellClass(selected.turnkey.cells[column.index])">@{{ selected.turnkey.cells[column.index].text }}</span></dd></div></dl>
            </section>
            <section class="ta-detail-section"><h3>@lang('turnkey::app.records.record_details')</h3><dl class="ta-detail-dates tr-detail-fields"><div v-for="field in selected.turnkey.details" :key="field.label"><dt>@{{ field.label }}</dt><dd class="tr-detail-value">@{{ field.value }}</dd></div></dl></section>
        </div>
        <footer class="ta-detail-footer">
            @if (config('turnkey.read_only'))<p class="ta-muted tr-read-only">@lang('turnkey::app.records.read_only')</p>@endif
            <div class="ta-detail-actions" v-if="selected.actions?.length" aria-label="@lang('turnkey::app.records.actions')">
                <template v-for="action in selected.actions" :key="action.index">
                    <a v-if="isLink(action)" :href="action.url" class="ta-secondary-button" :class="{ 'tr-print-action': action.index === 'print' }">@{{ action.title }}</a>
                    <button v-else type="button" class="ta-secondary-button" :class="{ 'tr-delete-action': action.method.toUpperCase() === 'DELETE' }" @click="runAction(action)">@{{ action.title }}</button>
                </template>
            </div>
        </footer>
    </template>
</dialog>
