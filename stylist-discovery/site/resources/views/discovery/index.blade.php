@component('layouts.app', ['title' => 'Find your kind of stylist'])
    <x-status />
    @if(!$errors->any())
    <section class="discovery-hero" aria-labelledby="hero-heading">
        <div>
            <p class="eyebrow">GOOD HAIR. GREAT COMPANY.</p>
            <h1 id="hero-heading">Your style.<br>Your <em>kind of stylist.</em></h1>
            <p class="intro">Find independent hair artists who understand you. Explore their work, find your match, and make time for yourself.</p>
            @if($demoStylist)<a class="button hero-journey-action" href="{{ route('stylists.show', $demoStylist->id) }}">Try a booking at {{ $demoStylist->studio_name }} <span aria-hidden="true">↗</span></a>@endif
            <div class="hero-meta"><span>Independent artists</span><span>Clear pricing</span><span>Space for your style</span></div>
        </div>
        <div class="discovery-art" aria-hidden="true"><img src="{{ asset('assets/seed/stylist-01.svg') }}" alt="" width="480" height="600"><span class="discovery-art-note">A little<br><em>you-time.</em></span><span class="art-label">Find your next good hair day.</span></div>
    </section>
    @else
        <section class="filter-correction" aria-labelledby="correction-title">
            <p class="eyebrow">A LITTLE ADJUSTMENT</p>
            <h1 id="correction-title">Let's find your stylist.</h1>
            <div class="error-summary" role="alert" tabindex="-1">
                <h2>Please check your filters.</h2>
                <ul>
                    @foreach($errors->getMessages() as $field => $messages)
                        @foreach($messages as $message)
                            <li><a href="#{{ $field }}">{{ $message }}</a></li>
                        @endforeach
                    @endforeach
                </ul>
            </div>
        </section>
    @endif
    <form action="{{ route('discovery.index') }}#results" method="get" id="discovery-filter" class="discovery-search" data-loading-form>
        <div class="form-field"><label for="city">Where are you looking?</label><select id="city" name="city" @error('city') aria-invalid="true" aria-describedby="city-error" @enderror><option value="">Every city</option>@foreach(config('demo.locations') as $cityCode => $location)<option value="{{ $cityCode }}" @selected($values['city'] === $cityCode)>{{ $location['city'] }}, {{ $location['country'] }}</option>@endforeach</select><x-field-errors field="city" :errors="$errors" /></div>
        <div class="form-field"><label for="specialty">What feels like you?</label><select id="specialty" name="specialty" @error('specialty') aria-invalid="true" aria-describedby="specialty-error" @enderror><option value="">All specialties</option>@foreach($specialties as $specialty)<option value="{{ $specialty->id }}" @selected($values['specialty'] === (string) $specialty->id)>{{ $specialty->name }}</option>@endforeach</select><x-field-errors field="specialty" :errors="$errors" /></div>
        <button class="search-button" type="submit">Find my stylist <span aria-hidden="true">↗</span></button>
        <p class="search-progress" role="status" data-loading-status hidden>Finding your stylists…</p>
    </form>
    @if($demoStylist && !$errors->any())
        <aside class="demo-journey"><span class="journey-number" aria-hidden="true">01</span><div><strong>Your next good hair day starts at {{ $demoStylist->studio_name }}.</strong><p>Request a visit with {{ $demoStylist->display_name }}. Switch to Stylist to accept, then return as Client for the simulated deposit, confirmation and inbox.</p></div><a href="{{ route('stylists.show', $demoStylist->id) }}">Meet {{ $demoStylist->display_name }} <span aria-hidden="true">↗</span></a></aside>
    @endif
    <section class="discovery-results" id="results" aria-labelledby="results-heading">
        <div class="results-heading"><div><h2 id="results-heading">Meet your next stylist.</h2>@if($profiles !== null)<p>{{ $profiles->total() }} {{ $profiles->total() === 1 ? 'artist' : 'artists' }}{{ $profiles->count() ? ' · Showing '.$profiles->firstItem().'–'.$profiles->lastItem() : '' }}. A style for every version of you.</p>@else<p>Adjust the highlighted filters to find your match.</p>@endif</div><div class="sort-control"><label for="sort">Sort by</label><div class="sort-options"><select id="sort" name="sort" form="discovery-filter" data-submit-form="discovery-filter" data-loading-control-for="discovery-filter" aria-describedby="sort-progress{{ $errors->has('sort') ? ' sort-error' : '' }}" @error('sort') aria-invalid="true" @enderror>@foreach(\App\Enums\DiscoverySort::cases() as $sort)<option value="{{ $sort->value }}" @selected(($values['sort'] === '' ? \App\Enums\DiscoverySort::Name->value : $values['sort']) === $sort->value)>{{ $sort->label() }}</option>@endforeach</select><x-field-errors field="sort" :errors="$errors" /><p id="sort-progress" class="sort-progress" role="status" aria-live="polite" data-loading-for="discovery-filter" hidden>Sorting stylists…</p></div></div></div>
        <div class="results-layout">
            <details class="discovery-filters" data-keep-open="{{ $errors->any() ? 'true' : 'false' }}" open>
                <summary>Make it yours <span aria-hidden="true">+</span></summary>
                <div class="filter-fields">
                    <div class="form-field"><label for="search">Name or studio</label><input id="search" name="search" form="discovery-filter" maxlength="80" value="{{ $values['search'] }}" placeholder="Find someone special" @error('search') aria-invalid="true" aria-describedby="search-error" @enderror><x-field-errors field="search" :errors="$errors" /></div>
                    <div class="form-field"><label for="country">Country</label><select id="country" name="country" form="discovery-filter" @error('country') aria-invalid="true" aria-describedby="country-error" @enderror><option value="">Every country</option>@foreach(config('demo.locations') as $location)<option value="{{ $location['country_code'] }}" @selected($values['country'] === $location['country_code'])>{{ $location['country'] }}</option>@endforeach</select><x-field-errors field="country" :errors="$errors" /></div>
                    <fieldset class="price-filter"><legend>Service price (€)</legend><div class="form-field"><label for="minimum">Minimum</label><input id="minimum" name="minimum" form="discovery-filter" type="number" inputmode="decimal" min="0" max="1000" step="0.01" value="{{ $values['minimum'] }}" placeholder="0" @error('minimum') aria-invalid="true" aria-describedby="minimum-error" @enderror><x-field-errors field="minimum" :errors="$errors" /></div><div class="form-field"><label for="maximum">Maximum</label><input id="maximum" name="maximum" form="discovery-filter" type="number" inputmode="decimal" min="0" max="1000" step="0.01" value="{{ $values['maximum'] }}" placeholder="1000" @error('maximum') aria-invalid="true" aria-describedby="maximum-error" @enderror><x-field-errors field="maximum" :errors="$errors" /></div></fieldset>
                    <button class="filter-apply" type="submit" form="discovery-filter">Apply filters</button>
                    <p class="filter-progress" role="status" aria-live="polite" data-loading-for="discovery-filter" hidden>Finding your stylists…</p>
                    <a class="reset-filters" href="{{ route('discovery.index') }}#results">Clear filters</a>
                    <p class="filter-note">Find your stylist.<br>Request your time.<br>Pay a simulated deposit after acceptance.</p>
                </div>
            </details>
            <div>
                @if($profiles !== null)
                <div class="stylist-grid">@forelse($profiles as $profile)<x-stylist-card :profile="$profile" />@empty<x-empty-state title="A fresh search, a new possibility." message="No stylists match these filters. Try another city, specialty or price range."><a class="text-link" href="{{ route('discovery.index') }}#results">See all stylists</a></x-empty-state>@endforelse</div>
                <x-pagination :paginator="$profiles" fragment="results" label="Stylists" />
                @else
                    <div class="filter-recovery"><h3>Your choices are still here.</h3><p>Update the highlighted fields, then apply your filters to continue exploring.</p></div>
                @endif
            </div>
        </div>
    </section>
@endcomponent
