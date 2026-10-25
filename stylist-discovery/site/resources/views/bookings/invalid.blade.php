@component('layouts.app', ['title' => 'Check your appointment details'])
    <section class="account-intro"><p class="eyebrow">ONE SMALL DETAIL</p><h1>Let’s check<br><em>those details.</em></h1><x-field-errors :errors="$errors" /><a class="text-link" href="{{ route('discovery.index') }}">Choose a stylist →</a>@if(auth()->user()?->hasRole(\App\Enums\AccountRole::Stylist))<a class="text-link" href="{{ route('stylist.availability.edit') }}">Return to your availability →</a>@endif</section>
@endcomponent
