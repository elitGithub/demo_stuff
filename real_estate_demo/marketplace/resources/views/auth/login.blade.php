<x-public-layout title="Welcome back">
    <section class="auth-page">
        <div class="form-card">
            <p class="eyebrow">Your home, in good hands</p>
            <h1>Welcome back.</h1>
            <p>Pick up right where you left off.</p>
            <form method="POST" action="{{ route('login.store') }}" class="stack">
                @csrf
                <x-field name="email" label="Email address" type="email" required autocomplete="email" />
                <x-field name="password" label="Password" type="password" required autocomplete="current-password" />
                @if(!config('demo.read_only'))<label class="check"><input type="checkbox" name="remember" value="1" @checked(old('remember'))> Keep me signed in</label>@endif
                <button type="submit" class="button primary">Sign in</button>
            </form>
            <p>New to Haven? <a href="{{ route('register') }}">Create your account</a></p>
            @if(config('demo.enabled') && (config('demo.read_only') || app()->environment(config('demo.environments'))))
                <div class="demo-entries">
                    <p>Just exploring? Step into the demo.</p>
                    @foreach(config('demo.actors') as $actor)
                        <form method="POST" action="{{ route('demo.login', $actor) }}">
                            @csrf<button type="submit" class="button secondary">Explore as {{ $actor }}</button>
                        </form>
                    @endforeach
                </div>
            @endif
        </div>
    </section>
</x-public-layout>
