@component('layouts.app', ['title' => 'Check your diary filters'])
    <section class="booking-recovery" data-recovery-result tabindex="-1"><p class="eyebrow">YOUR WORKSPACE</p><h1>Check your diary filters.</h1><x-field-errors :errors="$errors" /><div class="form-actions"><a class="button" href="{{ route('workspace.index') }}">Show all appointments →</a></div></section>
@endcomponent
