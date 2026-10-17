@php
    $demoControls = \App\Enums\CasefileMode::current()->demoControlsEnabled();
@endphp
<x-app-layout title="Sign in">
    <section class="glass sign-in" aria-labelledby="sign-in-heading">
        <p class="eyebrow">Sign in</p>
        <h1 id="sign-in-heading">Casefile</h1>
        <p>Turns emails from the people you choose into cases you can track.</p>
        @if ($demoControls)
            <p class="muted">This is a demonstration. The mailbox is simulated and nothing here is real email.</p>
            <p class="muted">You get your own private copy of the data; nothing you do is seen by anyone else.</p>
        @endif
        <form method="POST" action="{{ route('sign-in.google') }}" data-pending>
            @csrf
            <button type="submit" class="btn btn-primary">{{ $demoControls ? 'Continue with Google (simulated)' : 'Continue with Google' }}</button>
        </form>
    </section>
</x-app-layout>
