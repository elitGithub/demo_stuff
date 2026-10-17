@props(['name', 'label', 'type' => 'text', 'value' => '', 'required' => false])
<div class="field">
    <label for="{{ $name }}">{{ $label }}@if($required)<span aria-hidden="true"> *</span>@endif</label>
    @if($slot->isNotEmpty())
        {{ $slot }}
    @else
        <input id="{{ $name }}" name="{{ $name }}" type="{{ $type }}"
            @if($type !== 'password') value="{{ old($name, $value) }}" @endif
            @required($required) @error($name) aria-invalid="true" aria-describedby="{{ $name }}-error" @enderror
            {{ $attributes }}>
    @endif
    @error($name)<p class="field-error" id="{{ $name }}-error">{{ $message }}</p>@enderror
</div>
