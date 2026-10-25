@component('layouts.app', ['title' => 'Your portfolio'])
    <a class="back-link" href="{{ route('stylist.onboarding') }}">← Your studio checklist</a>
    <section class="studio-menu-heading"><div><p class="eyebrow">YOUR PORTFOLIO</p><h1>Let your work<br><em>tell the story.</em></h1><p>Add a thoughtful detail, a favourite shape, a little of your point of view.</p></div><div><span class="specialty-tag">{{ $profile->status->label() }}</span><p>{{ $images->total() }} {{ $images->total() === 1 ? 'image' : 'images' }} in your portfolio</p></div></section>
    @if($savedImage !== null)
        <section id="save-result" class="portfolio-saved" data-save-result tabindex="-1" aria-labelledby="saved-title"><img src="{{ route('portfolio.show', $savedImage->id) }}" alt="{{ $savedImage->caption }}" width="96" height="120"><div><p class="eyebrow">SAVED TO YOUR PORTFOLIO</p><h2 id="saved-title">A new part of your story.</h2><p>{{ $savedImage->caption }}</p><a class="compact-button" href="{{ $profile->status === \App\Enums\ProfileStatus::Published ? route('stylists.show', $profile->id).'#portfolio' : '#portfolio' }}">{{ $profile->status === \App\Enums\ProfileStatus::Published ? 'View on your profile' : 'View your portfolio' }} <span aria-hidden="true">→</span></a></div></section>
    @else
        @if(session('status'))<div id="save-result" data-save-result tabindex="-1"><x-status /></div>@endif
    @endif
    <x-field-errors :errors="$errors" />
    <section class="portfolio-editor" aria-labelledby="upload-title">
        <div><p class="eyebrow">A NEW PERSPECTIVE</p><h2 id="upload-title">Share an image.</h2><p>Choose a detail that feels like you.</p><p>{{ max(0, config('demo.limits.images') - $uploadCount) }} image {{ config('demo.limits.images') - $uploadCount === 1 ? 'space' : 'spaces' }} remaining.</p></div>
        <form action="{{ route('stylist.portfolio.store') }}" method="post" enctype="multipart/form-data" data-loading-form>
            @csrf<x-actor-context />
            <div class="form-field"><label for="portfolio-image">Image <span aria-hidden="true">*</span></label><input id="portfolio-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" required aria-describedby="image-help @error('image') image-error @enderror" @error('image') aria-invalid="true" @enderror><p id="image-help" class="field-help">JPG, PNG or WebP. Maximum 5 MB.</p>@error('image')<p class="field-error" id="image-error">{{ $message }}</p>@enderror</div>
            <div class="form-field"><label for="portfolio-caption">Caption <span aria-hidden="true">*</span></label><input id="portfolio-caption" name="caption" type="text" maxlength="160" value="{{ $caption ?? '' }}" required @error('caption') aria-describedby="caption-error" aria-invalid="true" @enderror>@error('caption')<p class="field-error" id="caption-error">{{ $message }}</p>@enderror</div>
            <div class="form-actions"><a class="secondary-button" href="{{ route('stylist.onboarding') }}">Cancel</a><x-loading-button label="Save image" progress="Preparing your image…" /></div>
        </form>
    </section>
    <section class="portfolio-section" id="portfolio" aria-labelledby="portfolio-title"><p class="eyebrow">THE COMPLETE PICTURE</p><h2 id="portfolio-title">Your portfolio preview.</h2><div class="portfolio-grid">
        @forelse($images as $image)
            <figure><img src="{{ $image->seed_asset !== null ? asset('assets/seed/'.$image->seed_asset) : route('portfolio.show', $image->id) }}" alt="{{ $image->caption }}" loading="lazy"><figcaption>{{ $image->caption }}</figcaption>
                @if($image->seed_asset === null)
                    <form action="{{ route('stylist.portfolio.destroy', $image->id) }}" method="post" data-loading-form data-confirm="Remove this image from your portfolio?">@csrf @method('DELETE')<x-actor-context /><x-loading-button label="Remove image" progress="Removing…" /></form>
                @else
                    <p class="portfolio-image-kind">Original sample illustration</p>
                @endif
            </figure>
        @empty
            <x-empty-state title="Your story starts here." message="Save your first image to bring your portfolio to life." />
        @endforelse
    </div><x-pagination :paginator="$images" fragment="portfolio" label="Your portfolio" /></section>
@endcomponent
