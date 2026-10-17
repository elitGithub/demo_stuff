<section class="surface settings-section" aria-labelledby="connected-mailbox-heading">
    <h2 id="connected-mailbox-heading" class="section-title">Connected mailbox: {{ config('casefile.owner.email') }}{{ \App\Enums\CasefileMode::current()->demoControlsEnabled() ? ' (simulated)' : '' }}</h2>
    <p class="muted">A real connection reads mail from your tracked senders and sends your replies in the same Gmail conversations.</p>
</section>
