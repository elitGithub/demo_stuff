<dialog ref="detail" class="ta-detail" aria-labelledby="ta-detail-title" @close="selected = null; detailError = ''" @click.self="$refs.detail.close()">
    <template v-if="selected">
        <header class="ta-detail-header">
            <span class="ta-eyebrow">@lang('turnkey::app.activities.details')</span>
            <button type="button" class="ta-icon-button" aria-label="@lang('turnkey::app.activities.close')" @click="$refs.detail.close()" autofocus>×</button>
        </header>
        <div class="ta-detail-body">
            <span class="ta-secondary">@{{ selected.type }}</span>
            <h2 id="ta-detail-title">@{{ selected.title }}</h2>
            <span class="ta-status" :class="'ta-status-' + selected.turnkey.status"><span aria-hidden="true">@{{ selected.is_done ? '✓' : '•' }}</span> @{{ labels[selected.turnkey.status] }}</span>
            <dl class="ta-detail-relations">
                <div><dt>@lang('turnkey::app.activities.opportunity')</dt><dd><a v-if="selected.turnkey.lead_url" :href="selected.turnkey.lead_url">@{{ selected.lead_title }}</a><span v-else>@lang('turnkey::app.activities.unlinked')</span></dd></div>
                <div><dt>@lang('turnkey::app.activities.owner')</dt><dd class="ta-person"><span class="ta-avatar" aria-hidden="true">@{{ initials(selected.created_by_id) }}</span>@{{ selected.created_by_id || labels.unassigned }}</dd></div>
            </dl>
            <section class="ta-detail-section">
                <h3>@lang('turnkey::app.activities.comments')</h3>
                <p class="ta-comment" :class="{ 'ta-muted': !selected.comment }">@{{ selected.comment || labels.no_comments }}</p>
            </section>
            <section class="ta-detail-section">
                <h3>@lang('turnkey::app.activities.schedule')</h3>
                <dl class="ta-detail-dates">
                    <div><dt>@lang('turnkey::app.activities.starts')</dt><dd>@{{ selected.schedule_from || labels.unscheduled }}</dd></div>
                    <div><dt>@lang('turnkey::app.activities.ends')</dt><dd>@{{ selected.schedule_to || labels.unscheduled }}</dd></div>
                </dl>
            </section>
            <section class="ta-detail-section ta-history">
                <h3>@lang('turnkey::app.activities.history')</h3>
                <dl class="ta-detail-dates">
                    <div><dt>@lang('turnkey::app.activities.reference')</dt><dd>#@{{ selected.id }}</dd></div>
                    <div><dt>@lang('turnkey::app.activities.created')</dt><dd>@{{ selected.created_at || '—' }}</dd></div>
                    <div><dt>@lang('turnkey::app.activities.updated')</dt><dd>@{{ selected.turnkey.updated_at || '—' }}</dd></div>
                </dl>
            </section>
        </div>
        <footer class="ta-detail-footer">
            <p v-if="detailError" class="ta-detail-error" role="alert">@{{ detailError }}</p>
            @if (config('turnkey.read_only'))
                <p class="ta-muted">@lang('turnkey::app.activities.read_only')</p>
            @else
                <div v-if="editAction(selected)" class="ta-detail-actions">
                    <a :href="editAction(selected).url" class="ta-secondary-button">@lang('turnkey::app.activities.edit')</a>
                    <button type="button" class="ta-primary-button" :disabled="saving" @click="toggleComplete">@{{ saving ? labels.saving : (selected.is_done ? labels.mark_open : labels.mark_complete) }}</button>
                </div>
            @endif
        </footer>
    </template>
</dialog>
