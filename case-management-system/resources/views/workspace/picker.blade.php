@use('App\Enums\WorkspaceLayout')
<x-app-layout title="Choose your layout">
    <section class="layout-picker" aria-labelledby="picker-heading">
        <header>
            <p class="eyebrow">Make yourself at home</p>
            <h1 id="picker-heading">Choose how you like to work.</h1>
            <p>Same cases, four ways to see them. Switch at any time from the top bar.</p>
            <p class="muted">On a phone every layout shows one pane at a time.</p>
        </header>
        @if ($errors->hasAny(['layout', 'intended']))
            <div class="flash flash-error" role="alert">
                @error('layout')<p>{{ $message }}</p>@enderror
                @error('intended')<p>{{ $message }}</p>@enderror
            </div>
        @endif
        <div class="layout-options">
            @foreach (WorkspaceLayout::cases() as $choice)
                <form class="layout-choice surface" method="POST" action="{{ route('layout.choose') }}" data-pending>
                    @csrf
                    <input type="hidden" name="layout" value="{{ $choice->value }}">
                    <input type="hidden" name="intended" value="{{ $intended }}">
                    <x-layout-thumbnail :layout="$choice" />
                    <h2>{{ $choice->label() }} @if ($choice === WorkspaceLayout::default())<span class="pill">Default</span>@endif</h2>
                    <p>{{ match ($choice) {
                        WorkspaceLayout::Tracker => 'Dense rows, status views and filters, with each case on its own page.',
                        WorkspaceLayout::Desk => 'Folders, conversations and a thread, with a details rail and floating composer.',
                        WorkspaceLayout::Mail => 'A quiet message list and reading pane, with case facts and a floating toolbar.',
                        WorkspaceLayout::Board => 'Three status columns of cards, with a status control on every case.',
                    } }}</p>
                    <button type="submit" class="btn btn-primary">Choose {{ $choice->label() }}</button>
                </form>
            @endforeach
        </div>
    </section>
</x-app-layout>
