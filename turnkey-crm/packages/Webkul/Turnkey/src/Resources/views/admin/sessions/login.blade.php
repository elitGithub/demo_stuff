<x-admin::layouts.anonymous>
    <x-slot:title>{{ config('turnkey.name') }} · Sign in</x-slot>

    <main class="turnkey-login">
        <section class="turnkey-story" aria-labelledby="demo-headline">
            <img src="{{ asset('turnkey/logo-dark.svg?v=customcrm') }}" width="230" height="48" alt="{{ config('turnkey.name') }}">
            <div class="turnkey-story-copy">
                <span class="turnkey-eyebrow">A little more clarity. Every day.</span>
                <h1 id="demo-headline">@lang('turnkey::app.headline')</h1>
                <p>@lang('turnkey::app.intro')</p>
                <div class="turnkey-workflow" aria-label="Your customer journey">
                    <span>01 <b>Connect</b><small>Know every customer</small></span>
                    <span>02 <b>Follow through</b><small>Keep the next step clear</small></span>
                    <span>03 <b>Grow</b><small>Turn conversations into work</small></span>
                </div>
            </div>
            <p class="turnkey-story-footer">Built for people who run a business.</p>
        </section>

        <section class="turnkey-login-panel" aria-labelledby="login-heading">
            <div class="turnkey-login-card">
                <span class="turnkey-eyebrow">YOUR WORKSPACE</span>
                <h2 id="login-heading">@lang('turnkey::app.welcome')</h2>
                <p class="turnkey-muted">@lang('turnkey::app.sign_in')</p>

                <form method="POST" action="{{ route('admin.session.store') }}" class="turnkey-login-form">
                    @csrf
                    <label for="email">@lang('turnkey::app.email')</label>
                    <input id="email" name="email" type="email" value="{{ old('email') }}" autocomplete="username" required placeholder="you@company.com">
                    @error('email')<p class="turnkey-error">{{ $message }}</p>@enderror
                    <label for="password">@lang('turnkey::app.password')</label>
                    <input id="password" name="password" type="password" autocomplete="current-password" required>
                    @error('password')<p class="turnkey-error">{{ $message }}</p>@enderror
                    @unless(config('turnkey.demo'))
                        <a class="turnkey-forgot" href="{{ route('admin.forgot_password.create') }}">@lang('turnkey::app.forgot')</a>
                    @endunless
                    <button type="submit" class="turnkey-submit">@lang('turnkey::app.submit') <span aria-hidden="true">→</span></button>
                </form>

                @if(config('turnkey.demo'))
                    <aside class="turnkey-demo-card">
                        <span class="turnkey-demo-pill">@lang('turnkey::app.demo')</span>
                        <p>@lang('turnkey::app.demo_hint')</p>
                        <dl><dt>Email</dt><dd>{{ config('turnkey.demo_email') }}</dd><dt>Password</dt><dd>{{ config('turnkey.demo_password') }}</dd></dl>
                        <button type="button" id="use-demo-account">@lang('turnkey::app.use_demo') <span aria-hidden="true">↗</span></button>
                    </aside>
                @endif
                <p class="turnkey-login-footer">@lang('turnkey::app.footer')</p>
            </div>
        </section>
    </main>

    @if(config('turnkey.demo'))
        @push('scripts')
            <script>
                document.addEventListener('click', function (event) {
                    if (!event.target.closest('#use-demo-account')) return;
                    document.getElementById('email').value = @json(config('turnkey.demo_email'));
                    document.getElementById('password').value = @json(config('turnkey.demo_password'));
                    document.querySelector('.turnkey-submit').focus();
                });
            </script>
        @endpush
    @endif
</x-admin::layouts.anonymous>
