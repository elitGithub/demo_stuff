<x-public-layout title="Find your professional">
    <section class="page-heading"><p class="eyebrow">NEIGHBORHOOD KNOW-HOW</p><h1>Good people. Great at home.</h1><p>A helping hand for the projects that matter to you.</p></section>
    <form method="GET" action="{{ route('professionals.index') }}" class="filter-bar content-panel">
        <x-field name="q" label="Find a business" :value="request('q')" placeholder="Search professionals" />
        <x-field name="category" label="Service"><select id="category" name="category"><option value="">All services</option>@foreach($categories as $category)<option value="{{ $category->id }}" @selected(request('category') == $category->id)>{{ $category->name }}</option>@endforeach</select></x-field>
        <x-field name="area" label="Your neighborhood"><select id="area" name="area"><option value="">All areas</option>@foreach(config('marketplace.service_areas') as $area)<option @selected(request('area') === $area)>{{ $area }}</option>@endforeach</select></x-field>
        <button class="button primary" type="submit"><x-icon name="search" />Find help</button>
    </form>
    <p class="results-count">{{ $professionals->total() }} {{ \Illuminate\Support\Str::plural('professional', $professionals->total()) }} to get to know</p>
    <div class="professional-grid">@forelse($professionals as $profile)<x-professional-card :profile="$profile" />@empty<x-empty-state title="No matches just yet" description="Try another service or neighborhood." icon="search" />@endforelse</div>
    <div class="pagination">{{ $professionals->links() }}</div>
</x-public-layout>
