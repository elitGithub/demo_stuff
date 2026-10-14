<aside id="admin-sidebar" ref="sidebar" class="turnkey-sidebar">
    <v-turnkey-sidebar></v-turnkey-sidebar>
</aside>

@pushOnce('scripts')
    @php($navigationItems = menu()->getItems('admin'))
    <script type="text/x-template" id="v-turnkey-sidebar-template">
        <div class="ts-inner">
            <nav class="ts-navigation">
                @foreach ($navigationItems as $menuItem)
                    @php($hasSubmenu = $menuItem->haveChildren() && ! in_array($menuItem->getKey(), ['settings', 'configuration']))
                    @if ($hasSubmenu)
                        <details class="ts-group" data-menu-key="{{ $menuItem->getKey() }}" :open="!isCollapsed && expandedMenus.includes({{ json_encode($menuItem->getKey()) }})">
                            <summary class="ts-link {{ $menuItem->isActive() ? 'ts-active-group' : '' }}" title="{{ $menuItem->getName() }}" aria-label="{{ $menuItem->getName() }}" @click.prevent="toggleMenu($event)">
                                <span class="ts-icon {{ $menuItem->getIcon() }}" aria-hidden="true"></span>
                                <span class="ts-label">{{ $menuItem->getName() }}</span>
                                <svg class="ts-chevron" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m5 3 5 5-5 5" /></svg>
                            </summary>
                            <div class="ts-submenu">
                                @foreach ($menuItem->getChildren() as $subMenuItem)
                                    <a href="{{ $subMenuItem->getUrl() }}" @if($subMenuItem->isActive()) aria-current="page" @endif>{{ $subMenuItem->getName() }}</a>
                                @endforeach
                            </div>
                        </details>
                    @else
                        <a class="ts-link" href="{{ $menuItem->getUrl() }}" title="{{ $menuItem->getName() }}" aria-label="{{ $menuItem->getName() }}" @if($menuItem->isActive()) aria-current="page" @endif>
                            <span class="ts-icon {{ $menuItem->getIcon() }}" aria-hidden="true"></span>
                            <span class="ts-label">{{ $menuItem->getName() }}</span>
                        </a>
                    @endif
                @endforeach
            </nav>

            {!! view_render_event('admin.layout.sidebar.toggle.before') !!}
            <button type="button" class="ts-collapse" :aria-label="isCollapsed ? labels.expand : labels.collapse" :title="isCollapsed ? labels.expand : labels.collapse" @click="setCollapsed(!isCollapsed)">
                <span class="icon-left-arrow ts-collapse-icon" :class="{ 'ts-reversed': isCollapsed }" aria-hidden="true"></span>
                <span class="ts-label">@lang('admin::app.layouts.sidebar.collapse')</span>
            </button>
            {!! view_render_event('admin.layout.sidebar.toggle.after') !!}
        </div>
    </script>

    <script type="module">
        app.component('v-turnkey-sidebar', {
            template: '#v-turnkey-sidebar-template',
            data() {
                return {
                    isCollapsed: @json((bool) request()->cookie('sidebar_collapsed', false)),
                    expandedMenus: @json($navigationItems->filter(fn ($item) => $item->haveChildren() && $item->isActive())->map(fn ($item) => $item->getKey())->values()->all()),
                    labels: @json(['expand' => trans('admin::app.layouts.sidebar.expand'), 'collapse' => trans('admin::app.layouts.sidebar.collapse')]),
                };
            },
            methods: {
                setCollapsed(collapsed) {
                    this.isCollapsed = collapsed;
                    const layout = this.$root.$refs.appLayout;
                    layout.classList.toggle('sidebar-collapsed', collapsed);
                    layout.classList.toggle('sidebar-not-collapsed', !collapsed);
                    const expires = new Date();
                    expires.setMonth(expires.getMonth() + 1);
                    document.cookie = `sidebar_collapsed=${collapsed ? 1 : 0}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;
                },
                toggleMenu(event) {
                    const key = event.currentTarget.parentElement.dataset.menuKey;
                    if (this.isCollapsed) {
                        this.setCollapsed(false);
                        if (!this.expandedMenus.includes(key)) this.expandedMenus.push(key);
                    } else {
                        this.expandedMenus = this.expandedMenus.includes(key)
                            ? this.expandedMenus.filter(item => item !== key)
                            : [...this.expandedMenus, key];
                    }
                },
            },
        });
    </script>
@endPushOnce
