<x-app-layout title="Professional profile">
    <div class="page-heading"><p class="eyebrow">Make a good first impression</p><h1>Your professional profile</h1></div>
    <div class="form-card">
        <p>Profile status: <strong>{{ $profile->status->label() }}</strong></p>
        <form method="POST" action="{{ route('profile.update') }}" class="stack">
            @csrf @method('PUT')
            <x-field name="business_name" label="Business name" :value="$profile->business_name" required maxlength="120" />
            <x-field name="bio" label="About your services" required>
                <textarea id="bio" name="bio" rows="5" maxlength="5000" required>{{ old('bio', $profile->bio) }}</textarea>
            </x-field>
            <fieldset><legend>Services you offer</legend>
                @foreach($categories as $category)
                    <label class="check"><input type="checkbox" name="category_ids[]" value="{{ $category->id }}" @checked(in_array($category->id, old('category_ids', $profile->categories->modelKeys())))>{{ $category->name }}</label>
                @endforeach
            </fieldset>
            <fieldset><legend>Where you work</legend>
                @foreach(config('marketplace.service_areas') as $area)
                    <label class="check"><input type="checkbox" name="service_areas[]" value="{{ $area }}" @checked(in_array($area, old('service_areas', $profile->service_areas)))>{{ $area }}</label>
                @endforeach
            </fieldset>
            <button type="submit" class="button primary">Save profile</button>
        </form>
    </div>
</x-app-layout>
