@extends('layouts.public')
@section('title', 'Welcome back')
@section('content')<section class="login-wrap">
        <div class="login-art"><span class="eyebrow">THE BUSINESS OF FEELING GOOD</span>
            <h1>More care.<br><em>Less busywork.</em></h1>
            <p>Your clients, your calendar and your next great day.<br>All in one thoughtful workspace.</p>
            <div class="login-art-mark">a.</div>
        </div>
        <div class="login-card"><span class="eyebrow">YOUR STUDIO, CONNECTED</span>
            <h2>Welcome back.</h2>
            <p class="muted">A good day starts with a little clarity.</p>@include('components.notices')<form method="post"
                action="{{ route('login.store') }}" class="stack">@csrf<label>Email address<input type="email"
                        name="email" value="{{ old('email') }}" autocomplete="username" required
                        placeholder="you@yourstudio.com"></label><label>Password<input type="password" name="password"
                        autocomplete="current-password" required placeholder="Your password"></label><button
                    class="button full">Sign in to your studio @include('components.icon', ['name' => 'arrow'])</button></form>
            @if (config('studio.demo'))
                <div class="or-divider"><span>TAKE A LOOK AROUND</span></div>
                <form method="post" action="{{ route('login.demo') }}">@csrf<button class="button secondary full">Explore
                        the demo workspace @include('components.icon', ['name' => 'spark'])</button></form>
                <p class="fine-print">Fictional clients. Working appointments. No real messages or online payments.</p>
            @endif
        </div>
</section>@endsection
