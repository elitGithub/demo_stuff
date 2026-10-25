@props(['field' => null, 'errors'])
@if ($field !== null)
    @error($field)<p id="{{ $field }}-error" class="field-error">{{ $message }}</p>@enderror
@elseif ($errors->any())
    <div class="error-summary" role="alert" tabindex="-1">
        <h2>Please check your details</h2>
        <ul>@foreach ($errors->all() as $message)<li>{{ $message }}</li>@endforeach</ul>
    </div>
@endif
