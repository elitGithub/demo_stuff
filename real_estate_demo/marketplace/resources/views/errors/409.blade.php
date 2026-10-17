<x-public-layout title="Let’s get you up to date">
    <section class="auth-page"><div class="form-card"><p class="eyebrow">SOMETHING CHANGED</p><h1>Let’s get you up to date.</h1><p>{{ $message ?? $exception->getMessage() }}</p><a class="button primary" href="{{ $reloadUrl ?? route('dashboard') }}">Review the latest details <x-icon name="arrow" /></a></div></section>
</x-public-layout>
