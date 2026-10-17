<x-app-layout :title="$list->status?->label() ?? 'All cases'">
    <x-slot:nav>
        <a href="{{ route('home') }}" aria-current="page" data-pending>Cases</a>
    </x-slot:nav>
    <h1 class="sr-only">Cases</h1>
    <div class="desk desk-index">
        <x-case-list :cases="$list->cases" :counts="$list->counts" :status="$list->status" :list-query="$list->query" />
        <section class="desk-detail desk-detail-empty surface" aria-label="Case thread">
            <x-empty-state icon="mail" title="Choose a case to read it.">
                Its emails, replies and status changes appear here.
            </x-empty-state>
        </section>
    </div>
</x-app-layout>
