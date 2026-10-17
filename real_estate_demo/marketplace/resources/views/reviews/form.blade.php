<x-app-layout title="Leave a review">
    <a class="back-link" href="{{ route('requests.show', $job) }}">← Back to your project</a>
    <div class="page-heading"><p class="eyebrow">A LITTLE APPRECIATION</p><h1>How did it go?</h1><p>Your experience helps the next neighbor choose with confidence.</p></div>
    <form method="post" action="{{ route('reviews.store', $job) }}" class="content-panel padded form-panel stack">@csrf
        <div><h2>{{ $job->acceptedQuote->provider->profile->business_name }}</h2><p class="muted">{{ $job->title }}</p></div>
        <fieldset class="rating-field"><legend>Your rating</legend><div class="rating-options">@for($rating = 1; $rating <= 5; $rating++)<label><input type="radio" name="rating" value="{{ $rating }}" @checked((int)old('rating') === $rating) required><span>{{ $rating }} ★</span></label>@endfor</div>@error('rating')<p class="field-error">{{ $message }}</p>@enderror</fieldset>
        <x-field name="body" label="Tell us about your experience"><textarea id="body" name="body" rows="5" maxlength="2000" required placeholder="What went well? What should a neighbor know?">{{ old('body') }}</textarea></x-field>
        <p class="field-hint">Your review appears on the professional’s public profile. One review per completed project.</p><button class="button primary" @disabled(config('demo.read_only'))>Publish review<x-icon name="arrow" /></button>
    </form>
</x-app-layout>
