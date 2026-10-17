<x-public-layout title="This action isn’t available">
    <section class="auth-page"><div class="form-card"><p class="eyebrow">{{ config('demo.read_only') ? 'EXPLORE AT YOUR OWN PACE' : 'A PRIVATE SPACE' }}</p><h1>{{ config('demo.read_only') ? 'You’re in the demo.' : 'This action isn’t available.' }}</h1><p>{{ $exception->getMessage() ?: 'Your account does not have access to this page or action.' }}</p><a class="button primary" href="{{ auth()->check() ? route('dashboard') : route('home') }}">Keep exploring <x-icon name="arrow" /></a></div></section>
</x-public-layout>
