<x-app-layout title="A little update">
    <div class="page-heading"><p class="eyebrow">GOOD TO KNOW</p><h1>A little update.</h1><p>Proposals, messages and milestones, all in one place.</p></div>
    <nav class="filter-tabs" aria-label="Notification filters">@foreach(['all' => 'All activity', 'unread' => 'Unread', 'read' => 'Read'] as $key => $label)<a @class(['active' => request('filter', 'all') === $key]) href="{{ route('notifications.index', ['filter' => $key]) }}">{{ $label }}</a>@endforeach</nav>
    <div class="content-panel notification-list">
    @forelse($notifications as $notification)
        <article @class(['notification-row', 'unread' => !$notification->read_at])><span class="notification-icon"><x-icon name="bell" /></span><div class="grow"><a href="{{ \App\Support\NotificationLink::for($notification->data) }}"><h3>{{ $notification->data['title'] ?? 'New activity' }}</h3><p>{{ $notification->data['body'] ?? '' }}</p></a><small>{{ $notification->created_at->timezone(config('marketplace.timezone'))->format('M j · g:i a') }}</small></div>@if(!$notification->read_at)<form method="POST" action="{{ route('notifications.read', $notification->id) }}">@csrf<button class="icon-button" type="submit" aria-label="Mark notification as read" @disabled(config('demo.read_only'))><x-icon name="check" /></button></form>@endif</article>
    @empty<x-empty-state title="You’re all caught up" description="Your next update will find its way here." icon="bell" />@endforelse
    </div><div class="pagination">{{ $notifications->links() }}</div>
</x-app-layout>
