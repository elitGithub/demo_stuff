<x-account-shell title="Welcome back.">
    <p>Sign in to an account created in this private demo, or <a href="{{ route('register') }}">create an account</a>.</p>
    <x-field-errors :errors="$errors" />
    <form action="{{ route('login.store') }}" method="post" class="account-form glass-card" data-loading-form>
        @csrf
        <x-actor-context />
        <div class="form-field">
            <label for="email">Email <span aria-hidden="true">*</span></label>
            <input id="email" name="email" type="email" maxlength="254" required autocomplete="email" value="{{ $values['email'] ?? '' }}" @error('email') aria-invalid="true" aria-describedby="email-error" @enderror>
            <x-field-errors field="email" :errors="$errors" />
        </div>
        <div class="form-field">
            <label for="password">Password <span aria-hidden="true">*</span></label>
            <input id="password" name="password" type="password" minlength="12" maxlength="128" required autocomplete="current-password" @error('password') aria-invalid="true" aria-describedby="password-error" @enderror>
            <x-field-errors field="password" :errors="$errors" />
        </div>
        <div class="form-actions"><a class="secondary-button" href="{{ route('demo.ready') }}">Cancel</a><x-loading-button label="Sign in" progress="Signing in…" /></div>
    </form>
</x-account-shell>
