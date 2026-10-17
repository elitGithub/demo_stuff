@php
    $status = session('status');
    $error = session('error');
@endphp
@if (is_string($status) && $status !== '')
    <div class="flash flash-status" role="status">
        <x-icon name="check" />
        <p>{{ $status }}</p>
    </div>
@endif
@if (is_string($error) && $error !== '')
    <div class="flash flash-error" role="alert">
        <x-icon name="alert" />
        <p>{{ $error }}</p>
    </div>
@endif
