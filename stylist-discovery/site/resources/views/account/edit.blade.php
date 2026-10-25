<x-account-shell title="Your account.">
    <a class="back-link" href="{{ route('discovery.index') }}">← Find your next stylist</a>
    <p class="account-subtitle">A little introduction goes a long way.</p>
    <p class="account-identity">{{ auth()->user()->email }} · {{ auth()->user()->role->label() }}</p>
    <x-field-errors :errors="$errors" />
    <form action="{{ route('account.update') }}" method="post" class="account-form glass-card" data-loading-form>
        @csrf
        @method('PATCH')
        <x-actor-context />
        <div class="form-field">
            <label for="name">Name <span aria-hidden="true">*</span></label>
            <input id="name" name="name" maxlength="80" required autocomplete="name" value="{{ $values['name'] ?? auth()->user()->name }}" @error('name') aria-invalid="true" aria-describedby="name-error" @enderror>
            <x-field-errors field="name" :errors="$errors" />
        </div>
        <div class="form-actions"><a class="secondary-button" href="{{ route('demo.ready') }}">Cancel</a><x-loading-button label="Save" progress="Saving your name…" /></div>
    </form>
    <div class="account-access">
        <p><a href="{{ route('register') }}">Create an account</a><span aria-hidden="true"> · </span><a href="{{ route('login') }}">Use another account</a></p>
        <form action="{{ route('logout') }}" method="post" class="signout-form" data-loading-form>
            @csrf
            <x-actor-context />
            <button class="text-button" type="submit">Sign out</button><span role="status" data-loading-status hidden>Signing out…</span>
        </form>
    </div>
</x-account-shell>
