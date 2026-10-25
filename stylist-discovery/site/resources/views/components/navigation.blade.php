<header class="app-navigation shell">
    <a class="wordmark" href="{{ route('discovery.index') }}" aria-label="Strand and City, discover stylists">strand<span>&amp;</span>city<span class="brand-dot" aria-hidden="true">.</span></a>
    <nav class="app-links" aria-label="Main navigation">
        <a href="{{ route('discovery.index') }}" @if(request()->routeIs('discovery.index', 'demo.ready', 'stylists.show')) aria-current="page" @endif>Discover</a>
        @if(auth()->user() && !auth()->user()->hasRole(\App\Enums\AccountRole::Admin))<a href="{{ route('workspace.index') }}" @if(request()->routeIs('workspace.*', 'stylist.*', 'bookings.*', 'checkout.*')) aria-current="page" @endif>Workspace</a>@endif
        @if(auth()->user()?->hasRole(\App\Enums\AccountRole::Admin))<a href="{{ route('admin.index') }}" @if(request()->routeIs('admin.*')) aria-current="page" @endif>Admin</a>@elseif(auth()->check())<a href="{{ route('inbox.index') }}" @if(request()->routeIs('inbox.*')) aria-current="page" @endif>Inbox</a>@endif
    </nav>
    @auth
        <div class="navigation-account">
            <a class="actor-name" href="{{ route('account.edit') }}">{{ auth()->user()->name }}</a>
            <form action="{{ route('role.update') }}" method="post" class="role-switch" data-loading-form>
                @csrf
                <x-actor-context />
                <label for="navigation-role">Try a role</label>
                <select id="navigation-role" name="role" aria-label="Demo perspective">
                    @foreach (\App\Enums\AccountRole::cases() as $role)
                        <option value="{{ $role->value }}" @selected(auth()->user()->role === $role)>{{ $role->label() }}</option>
                    @endforeach
                </select>
                <button type="submit" class="compact-button">Switch</button>
                <span class="navigation-progress" role="status" data-loading-status hidden>Switching…</span>
            </form>
        </div>
    @else
        <div class="navigation-account"><a class="compact-button" href="{{ route('login') }}">Sign in</a><a class="navigation-register" href="{{ route('register') }}">Join the demo</a></div>
    @endauth
</header>
