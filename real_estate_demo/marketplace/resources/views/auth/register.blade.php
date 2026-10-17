<x-public-layout title="Create your account">
    <section class="auth-page">
        <div class="form-card">
            <p class="eyebrow">A little help goes a long way</p>
            <h1>Create your account</h1>
            <p>Find a trusted professional, or bring your skills to the neighborhood.</p>
            <form method="POST" action="{{ route('register.store') }}" class="stack">
                @csrf
                <x-field name="name" label="Your name" required autocomplete="name" maxlength="120" />
                <x-field name="email" label="Email address" type="email" required autocomplete="email" maxlength="254" />
                <x-field name="account_type" label="I'm here to" required>
                    <select id="account_type" name="account_type" required>
                        <option value="customer" @selected(old('account_type', request('account_type', 'customer')) === 'customer')>Find help for my home</option>
                        <option value="provider" @selected(old('account_type', request('account_type', 'customer')) === 'provider')>Offer my services</option>
                    </select>
                </x-field>
                <x-field name="password" label="Password · at least 10 characters" type="password" required minlength="10" autocomplete="new-password" />
                <x-field name="password_confirmation" label="Confirm password" type="password" required autocomplete="new-password" />
                <button type="submit" class="button primary">Create account</button>
            </form>
            <p>Already at home here? <a href="{{ route('login') }}">Sign in</a></p>
        </div>
    </section>
</x-public-layout>
