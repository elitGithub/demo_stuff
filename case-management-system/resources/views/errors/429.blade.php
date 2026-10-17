<x-app-layout title="Too many attempts">
    <section class="glass sign-in" aria-labelledby="too-many-heading">
        <p class="eyebrow">Slow down</p>
        <h1 id="too-many-heading">Casefile</h1>
        <p>{{ $notice ?? 'Too many attempts from this address. Try again in a minute.' }}</p>
    </section>
</x-app-layout>
