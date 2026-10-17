@use('App\Support\DisplayDate')
<x-app-layout title="Notifications">
    <x-slot:nav><a href="{{ route('home') }}" data-pending>Cases</a></x-slot:nav>
    <section class="notifications surface" aria-labelledby="notifications-heading">
        <header class="notification-heading">
            <h1 id="notifications-heading">Notifications</h1>
            <form method="POST" action="{{ route('notifications.read') }}" data-pending>
                @csrf
                <button type="submit" class="btn">Mark all as read</button>
            </form>
        </header>
        @if ($notifications->isEmpty())
            <x-empty-state icon="bell" title="No notifications on this page." />
        @else
            <ol class="notification-list">
                @foreach ($notifications as $notification)
                    <li @class(['notification-item', 'notification-unread' => $notification->read_at === null])>
                        <a href="{{ route('cases.show', ['case' => $notification->data['number']]) }}" data-pending>
                            <span class="mono">{{ $notification->data['number'] }}</span>
                            <span>{{ $notification->data['subject'] }}</span>
                            <time class="muted" datetime="{{ DisplayDate::iso($notification->created_at->toImmutable()) }}">{{ DisplayDate::date($notification->created_at->toImmutable()) }} · {{ DisplayDate::time($notification->created_at->toImmutable()) }}</time>
                            @if ($notification->read_at === null)<span class="notification-read-label">Unread</span>@endif
                        </a>
                    </li>
                @endforeach
            </ol>
        @endif
        <x-pagination :paginator="$notifications" />
    </section>
</x-app-layout>
