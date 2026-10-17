<x-app-layout title="Inbox">
    <div class="inbox-page">
        <header>
            <p class="eyebrow">Your mailbox</p>
            <h1>{{ $label === 'all' ? 'All mail' : \App\Enums\MailboxLabel::from($label)->label() }}</h1>
        </header>
        <x-demo-controls :progress="$progress" />
        @if ($errors->any())
            <div class="flash flash-error" role="alert"><x-icon name="alert" /><p>{{ $errors->first() }}</p></div>
        @endif
        <div class="mailbox">
            <nav class="mail-labels glass" aria-label="Mailbox labels">
                @foreach (['inbox' => 'Inbox', 'sent' => 'Sent', 'all' => 'All mail'] as $value => $name)
                    <a class="folder-link" href="{{ route('inbox', ['label' => $value]) }}" @if ($label === $value) aria-current="page" @endif data-pending><x-icon :name="$value === 'sent' ? 'send' : ($value === 'all' ? 'mail' : 'inbox')" />{{ $name }}</a>
                @endforeach
            </nav>
            <section class="mail-list surface" aria-label="Messages">
                <div class="mail-list-heading"><p class="muted">{{ $messages->total() }} {{ $messages->total() === 1 ? 'message' : 'messages' }}</p></div>
                <ul class="mail-rows">
                    @forelse ($messages as $message)
                        @php($case = $message->caseMessage?->case)
                        <x-mail-row :message="$message" :sender="$message->label === \App\Enums\MailboxLabel::Sent ? $case?->trackedSender : $message->sender" :case="$case" :label="$label" />
                    @empty
                        <li class="empty-state"><p class="empty-state-title">No messages here</p><p class="empty-state-body">Emails in this label will appear here.</p></li>
                    @endforelse
                </ul>
                <x-pagination :paginator="$messages" />
            </section>
        </div>
    </div>
</x-app-layout>
