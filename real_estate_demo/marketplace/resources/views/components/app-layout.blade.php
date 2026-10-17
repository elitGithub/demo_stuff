@props(['title' => 'Your Haven'])
<x-public-layout :title="$title" :workspace="true">
    <div class="workspace-grid">
        <aside class="workspace-sidebar">
            <div class="workspace-person"><span class="avatar">{{ mb_substr(auth()->user()->name, 0, 1) }}</span><div><strong>{{ auth()->user()->name }}</strong><small>{{ auth()->user()->role->label() }} workspace</small></div></div>
            @php
                $links = [['dashboard', 'grid', 'Overview']];
                if (auth()->user()->role === \App\Enums\Role::Customer) {
                    $links[] = ['requests.create', 'plus', 'New request'];
                } elseif (auth()->user()->role === \App\Enums\Role::Provider) {
                    $links[] = ['opportunities.index', 'search', 'Opportunities'];
                    $links[] = ['profile.edit', 'user', 'My profile'];
                } else {
                    $links[] = ['admin.providers.index', 'user', 'Professionals'];
                    $links[] = ['admin.categories.index', 'grid', 'Services'];
                    $links[] = ['admin.jobs.index', 'home', 'All jobs'];
                }
                if (auth()->user()->role !== \App\Enums\Role::Admin) {
                    $links[] = ['messages.index', 'chat', 'Messages'];
                }
                $links[] = ['notifications.index', 'bell', 'Notifications'];
            @endphp
            <nav aria-label="Workspace">
                @foreach($links as [$routeName, $icon, $label])
                    @if(\Illuminate\Support\Facades\Route::has($routeName))
                        <a href="{{ route($routeName) }}" @class(['sidebar-link', 'active' => request()->routeIs($routeName)])><x-icon :name="$icon" /><span>{{ $label }}</span>@if($routeName === 'notifications.index' && ($unread = auth()->user()->unreadNotifications()->count()))<b class="unread-count">{{ $unread }}</b>@endif</a>
                    @endif
                @endforeach
            </nav>
            <div class="sidebar-bottom"><p>A little less to do.<br>A little more life.</p><form method="POST" action="{{ route('logout') }}">@csrf<button class="text-button" type="submit">Sign out</button></form></div>
        </aside>
        <section class="workspace-content">{{ $slot }}</section>
    </div>
</x-public-layout>
