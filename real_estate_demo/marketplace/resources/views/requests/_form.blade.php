<div class="form-section"><p class="eyebrow">01 · THE BIG PICTURE</p>
    <x-field name="title" label="What can we help with?" :value="$job->title ?? ''" required maxlength="120" placeholder="e.g. Give our living room a fresh coat of paint" />
    <div class="form-grid"><x-field name="category_id" label="Choose a service" required><select id="category_id" name="category_id" required><option value="">Select a service</option>@foreach($categories as $category)<option value="{{ $category->id }}" @selected(old('category_id', $job->category_id ?? request('category')) == $category->id)>{{ $category->name }}</option>@endforeach</select></x-field>
    <x-field name="budget" label="Your budget (USD, optional)" :value="isset($job) && $job->budget_cents !== null ? intdiv($job->budget_cents, 100).'.'.str_pad((string) ($job->budget_cents % 100), 2, '0', STR_PAD_LEFT) : ''" inputmode="decimal" placeholder="250.00" /></div>
    <x-field name="description" label="Tell us a little more" required><textarea name="description" id="description" rows="5" maxlength="5000" required placeholder="The details, the little quirks, and what a great result looks like.">{{ old('description', $job->description ?? '') }}</textarea></x-field>
</div>
<div class="form-section"><p class="eyebrow">02 · WHERE & WHEN</p>
    <div class="form-grid"><x-field name="service_area" label="Your neighborhood" required><select id="service_area" name="service_area" required><option value="">Choose your area</option>@foreach(config('marketplace.service_areas') as $area)<option @selected(old('service_area', $job->service_area ?? '') === $area)>{{ $area }}</option>@endforeach</select></x-field>
    <x-field name="preferred_date" label="Preferred date" type="date" :value="isset($job) ? $job->preferred_date->format('Y-m-d') : ''" :min="now(config('marketplace.timezone'))->toDateString()" required /></div>
    <x-field name="street_address" label="Street address" :value="$job->street_address ?? ''" required maxlength="255" autocomplete="street-address" />
    <p class="field-hint"><x-icon name="check" />Only the professional you hire receives your address.</p>
</div>
@if(!isset($job))
<div class="form-section"><p class="eyebrow">03 · THE DETAILS THAT HELP</p><label class="upload-zone" for="photos"><span class="empty-icon"><x-icon name="plus" /></span><strong>A picture makes it easier.</strong><span>Up to 5 JPEG, PNG or WebP photos · 5 MB each</span><input type="file" id="photos" name="photos[]" accept="image/jpeg,image/png,image/webp" multiple data-photo-input></label><div class="photo-previews" data-photo-previews aria-live="polite"></div></div>
@endif
<button class="button primary" type="submit">{{ isset($job) ? 'Save your changes' : 'Share your request' }}<x-icon name="arrow" /></button>
@if(config('demo.read_only'))<p class="field-hint">You’re exploring a read-only demo. Submitting won’t change the sample data.</p>@endif
