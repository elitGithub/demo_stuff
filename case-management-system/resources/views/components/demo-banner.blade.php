@if (\App\Enums\CasefileMode::current()->demoControlsEnabled())
    <div class="demo-banner glass" role="note">
        <x-icon name="mail" />
        <span>Simulated mailbox. Nothing here is real email.</span>
    </div>
@endif
