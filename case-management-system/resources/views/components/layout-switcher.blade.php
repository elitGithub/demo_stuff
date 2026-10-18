@use('App\Enums\WorkspaceLayout')
@props(['layout' => null])
<details class="layout-switcher header-disclosure" data-header-disclosure>
    <summary class="header-utility workspace-trigger" aria-label="Workspace: {{ $layout?->label() ?? 'Choose layout' }}">
        <x-icon name="workspace" class="workspace-icon" />
        <span class="workspace-name">{{ $layout?->label() ?? 'Choose layout' }}</span>
        <x-icon name="chevron" class="workspace-chevron" />
        <span class="header-tooltip" aria-hidden="true">Workspace: {{ $layout?->label() ?? 'Choose layout' }}</span>
    </summary>
    <div class="layout-menu header-menu" aria-label="Workspace layout">
        <div class="header-menu-heading">Workspace layout</div>
        @foreach (WorkspaceLayout::cases() as $choice)
            <form method="POST" action="{{ route('layout.choose') }}" data-pending>
                @csrf
                <input type="hidden" name="layout" value="{{ $choice->value }}">
                <input type="hidden" name="intended" value="{{ request()->routeIs('layout.picker') ? session('layout.intended', route('home')) : request()->fullUrl() }}">
                <button type="submit" class="layout-menu-choice" @if ($choice === $layout) aria-current="true" @endif>
                    <span>{{ $choice->label() }}</span>
                    @if ($choice === $layout)<x-icon name="check" /><span class="sr-only">Current layout</span>@endif
                </button>
            </form>
        @endforeach
        <a href="{{ route('layout.picker') }}" class="layout-menu-choice" data-pending>Compare layouts</a>
        <hr class="header-menu-separator">
        <a href="{{ route('for-real') }}" class="layout-menu-choice" @if (request()->routeIs('for-real')) aria-current="page" @endif data-pending><x-icon name="info" /><span>How this runs for real</span></a>
        <hr class="header-menu-separator">
        @if (\App\Enums\CasefileMode::current()->usesSandboxes())
            <form method="POST" action="{{ route('demo.reset') }}" data-pending data-confirm="This discards everything you changed in your demo and starts a fresh copy. Continue?">
                @csrf
                <button type="submit" class="layout-menu-choice header-menu-danger"><x-icon name="reset" /><span>Reset my demo</span></button>
            </form>
        @endif
        <form method="POST" action="{{ route('sign-out') }}" data-pending>
            @csrf
            <button type="submit" class="layout-menu-choice"><x-icon name="signout" /><span>Sign out</span></button>
        </form>
    </div>
</details>
