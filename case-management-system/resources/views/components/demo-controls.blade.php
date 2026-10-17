@props(['progress'])
@if (\App\Enums\CasefileMode::current()->demoControlsEnabled() && $progress !== null)
    <section class="demo-controls glass" aria-label="Simulated mailbox controls">
        <div>
            <p><strong>Simulated mailbox. Nothing here is real email.</strong></p>
            <p class="muted">{{ $progress->delivered }} of {{ $progress->total }} delivered</p>
            @if ($progress->finished)
                <p>{{ \App\Enums\CasefileMode::current()->usesSandboxes() ? 'Script finished. Reset the demo to replay.' : 'Script finished. All scripted emails have been delivered.' }}</p>
            @endif
        </div>
        <div class="mail-actions">
            @if (! $progress->finished)
                <form method="POST" action="{{ route('demo.deliver-next') }}" data-pending>
                    @csrf
                    <button type="submit" class="btn btn-primary">Deliver next email</button>
                </form>
            @elseif (\App\Enums\CasefileMode::current()->usesSandboxes())
                <form method="POST" action="{{ route('demo.reset') }}" data-pending data-confirm="This discards everything you changed in your demo and starts a fresh copy. Continue?">
                    @csrf
                    <button type="submit" class="btn btn-danger">Reset my demo</button>
                </form>
            @endif
            <form method="POST" action="{{ route('demo.deliver-reply') }}" data-pending>
                @csrf
                <button type="submit" class="btn">Deliver a reply</button>
            </form>
        </div>
    </section>
@endif
