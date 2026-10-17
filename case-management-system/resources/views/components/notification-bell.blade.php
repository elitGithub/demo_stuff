@php($unreadCount = auth()->user()->unreadNotifications()->count())
<div class="header-utility-wrap">
    <a href="{{ route('notifications') }}" class="header-utility notification-bell" aria-label="Notifications: {{ $unreadCount }} unread" data-pending>
        <x-icon name="bell" />
        <span class="notification-count" data-unread-count="{{ $unreadCount }}">{{ $unreadCount }}</span>
    </a>
    <span class="header-tooltip" aria-hidden="true">Notifications: {{ $unreadCount }} unread</span>
</div>
