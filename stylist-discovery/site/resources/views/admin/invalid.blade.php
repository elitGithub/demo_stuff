@component('layouts.app', ['title' => 'Check your selection'])
    <section class="booking-heading"><p class="eyebrow">ADMIN WORKSPACE</p><h1>Check your <em>selection.</em></h1></section>
    @include('admin.navigation')
    <x-field-errors :errors="$errors" />
    <a class="text-link" href="{{ route('admin.index') }}">Return to overview →</a>
@endcomponent
