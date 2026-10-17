<x-app-layout title="Manage professionals">
    <div class="page-heading"><p class="eyebrow">THE PEOPLE BEHIND THE WORK</p><h1>Our professionals</h1><p>Welcome capable people. Keep the community in good hands.</p></div>
    <form method="get" class="filter-bar content-panel"><label class="search-field"><x-icon name="search" /><input type="search" name="q" value="{{ request('q') }}" placeholder="Search businesses" aria-label="Search businesses"></label><select name="status" aria-label="Provider status"><option value="">Every status</option>@foreach(\App\Enums\ProviderStatus::cases() as $state)<option value="{{ $state->value }}" @selected(request('status') === $state->value)>{{ $state->label() }}</option>@endforeach</select><button class="button secondary">Filter</button></form>
    <div class="stack section">@forelse($profiles as $profile)<article class="content-panel padded">
        <div class="row-between"><div class="professional-heading"><span class="avatar tone-{{ $profile->id % 4 }}">{{ mb_substr($profile->business_name, 0, 1) }}</span><div><h2>{{ $profile->business_name }}</h2><p class="muted">{{ $profile->user->name }} · {{ $profile->user->email }}</p></div></div><x-status-badge :status="$profile->status" /></div>
        <p>{{ $profile->bio ?: 'This professional has not added a bio yet.' }}</p><p class="icon-line muted"><x-icon name="pin" />{{ implode(' · ', $profile->service_areas) ?: 'No service areas selected' }}</p><div class="tag-list">@forelse($profile->categories as $category)<span class="tag">{{ $category->name }}{{ $category->is_active ? '' : ' · inactive' }}</span>@empty<span class="muted">No categories selected</span>@endforelse</div>
        <div class="admin-actions">
            @if($profile->user->demo_key)<span class="field-hint"><x-icon name="lock" /> Protected demo profile</span>
            @else
                @php $target = $profile->status === \App\Enums\ProviderStatus::Approved ? 'suspended' : 'approved'; @endphp
                <form method="post" action="{{ route('admin.providers.status', $profile) }}">@csrf @method('PATCH')<input type="hidden" name="status" value="{{ $target }}"><button class="button {{ $target === 'approved' ? 'primary' : 'secondary' }}" @disabled(config('demo.read_only'))>{{ $target === 'approved' ? 'Approve professional' : 'Suspend profile' }}</button></form>
            @endif
            @if($profile->status === \App\Enums\ProviderStatus::Approved)<a class="text-link" href="{{ route('professionals.show', $profile) }}">View public profile →</a>@endif
        </div>
    </article>@empty<x-empty-state title="No professionals found" description="Try a different search or status." icon="user" />@endforelse</div>{{ $profiles->links() }}
</x-app-layout>
