<x-account-shell title="Your demo is ready.">
    @auth
        <p>Welcome, {{ $actor->name }}. Your fictional workspace is private to this browser session.</p>
        <a class="button" href="{{ route('account.edit') }}">Manage your account</a>
    @else
        <p>Your fictional workspace is private to this browser session.</p>
        <a class="button" href="{{ route('login') }}">Sign in</a>
    @endauth
</x-account-shell>
