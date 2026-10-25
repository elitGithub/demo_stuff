<x-account-shell title="Make it your own.">
    <p>Create a fictional account in your private demo. Use an address ending in .example.</p>
    <x-field-errors :errors="$errors" />
    <form action="{{ route('register.store') }}" method="post" class="account-form glass-card" data-loading-form>
        @csrf
        <x-actor-context />
        <div class="form-field">
            <label for="name">Name <span aria-hidden="true">*</span></label>
            <input id="name" name="name" maxlength="80" required autocomplete="name" value="{{ $values['name'] ?? '' }}" @error('name') aria-invalid="true" aria-describedby="name-error" @enderror>
            <x-field-errors field="name" :errors="$errors" />
        </div>
        <div class="form-field">
            <label for="email">Email <span aria-hidden="true">*</span></label>
            <input id="email" name="email" type="email" maxlength="254" required autocomplete="email" value="{{ $values['email'] ?? '' }}" @error('email') aria-invalid="true" aria-describedby="email-error" @enderror>
            <x-field-errors field="email" :errors="$errors" />
        </div>
        <div class="form-field">
            <label for="role">I am a <span aria-hidden="true">*</span></label>
            <select id="role" name="role" required @error('role') aria-invalid="true" aria-describedby="role-error" @enderror>
                @foreach ([\App\Enums\AccountRole::Client, \App\Enums\AccountRole::Stylist] as $role)
                    <option value="{{ $role->value }}" @selected(($values['role'] ?? 'client') === $role->value)>{{ $role->label() }}</option>
                @endforeach
            </select>
            <x-field-errors field="role" :errors="$errors" />
        </div>
        <div class="form-field">
            <label for="password">Password <span aria-hidden="true">*</span></label>
            <p id="password-hint">Use 12–128 characters. Choose a password only for this demo.</p>
            <input id="password" name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password" aria-describedby="password-hint{{ $errors->has('password') ? ' password-error' : '' }}" @error('password') aria-invalid="true" @enderror>
            <x-field-errors field="password" :errors="$errors" />
        </div>
        <div class="form-field">
            <label for="password_confirmation">Confirm password <span aria-hidden="true">*</span></label>
            <input id="password_confirmation" name="password_confirmation" type="password" minlength="12" maxlength="128" required autocomplete="new-password">
        </div>
        <div class="form-actions"><a class="secondary-button" href="{{ route('login') }}">Cancel</a><x-loading-button label="Create account" progress="Creating account…" /></div>
    </form>
</x-account-shell>
