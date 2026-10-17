<x-public-layout>
    <section class="hero">
        <div class="hero-copy">
            <p class="eyebrow"><span class="tiny-dot"></span> YOUR HOME. IN GOOD HANDS.</p>
            <h1>A little help.<br>A lot more <span>home.</span></h1>
            <p class="hero-description">From the small fixes to the fresh starts.<br>Find the right people to make your space feel like you.</p>
            <div class="hero-actions"><a class="button primary" href="{{ route('requests.create') }}">Tell us what you need <x-icon name="arrow" /></a><a class="text-link" href="{{ route('professionals.index') }}">Meet the professionals</a></div>
            <div class="hero-notes"><span><x-icon name="check" />Your project, your choice</span><span><x-icon name="check" />Clear quotes, up front</span></div>
        </div>
        <div class="hero-art">
            <div class="hero-orbit orbit-one"></div><div class="hero-orbit orbit-two"></div>
            <img src="{{ asset('images/haven-home.svg') }}" width="640" height="580" alt="An inviting modern home with a garden, warm windows and a bright blue front door">
            <div class="art-note glass-nav"><span class="note-icon"><x-icon name="check" /></span><div><strong>Home feels better, handled.</strong><small>A little less on your list.</small></div></div>
            <span class="art-spark"><x-icon name="sparkles" /></span>
        </div>
    </section>
    <section class="section services-section">
        <div class="section-heading"><div><p class="eyebrow">A PLACE FOR EVERY PROJECT</p><h2>What needs a little care?</h2></div><a class="text-link" href="{{ route('categories.index') }}">All services <x-icon name="arrow" /></a></div>
        <div class="category-grid">
            @foreach($categories as $category)
                <a class="category-card category-tone-{{ $loop->index % 6 }}" href="{{ route('professionals.index', ['category' => $category->id]) }}"><span class="category-icon"><x-icon :name="$category->icon" /></span><h3>{{ $category->name }}</h3><p>{{ $category->description }}</p><x-icon name="arrow" class="category-arrow" /></a>
            @endforeach
        </div>
    </section>
    <section id="how-it-works" class="section how-section">
        <div class="how-intro"><p class="eyebrow">LESS CHASING. MORE LIVING.</p><h2>From “I should”<br>to “all done.”</h2><p>Good help should be easy to find.<br>Here’s how we bring it home.</p></div>
        <div class="steps"><article><span>01</span><div><h3>Make room for your project.</h3><p>Tell us what you need, add a few photos, and choose when works for you.</p></div></article><article><span>02</span><div><h3>Find your kind of professional.</h3><p>Compare thoughtful quotes and talk through the details before you decide.</p></div></article><article><span>03</span><div><h3>Enjoy a little more home.</h3><p>Follow the progress, confirm the finish, and share how it went.</p></div></article></div>
    </section>
    <section class="section"><div class="section-heading"><div><p class="eyebrow">GOOD PEOPLE. GOOD WORK.</p><h2>Meet your next helping hand.</h2></div><a class="text-link" href="{{ route('professionals.index') }}">Find your professional <x-icon name="arrow" /></a></div>
        <div class="professional-grid">@forelse($professionals as $profile)<x-professional-card :profile="$profile" />@empty<x-empty-state title="Good help is on its way" description="Professional profiles will appear here once approved." />@endforelse</div>
    </section>
    <section class="provider-cta"><span class="cta-icon"><x-icon name="wrench" /></span><div><p class="eyebrow">YOUR SKILLS. THEIR HAPPY PLACE.</p><h2>Make yourself at home.</h2><p>Bring your craft to the neighborhood. Build your business with Haven.</p></div><a class="button dark" href="{{ route('register', ['account_type' => 'provider']) }}">Join as a professional <x-icon name="arrow" /></a></section>
</x-public-layout>
