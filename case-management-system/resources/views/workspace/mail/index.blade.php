<x-app-layout title="Mail">
    <h1 class="sr-only">Mail</h1>
    <div class="mail-workspace mail-index">
        <x-mail-case-list :list="$list" />
        <section class="mail-reading mail-reading-empty" aria-label="Case message"><x-empty-state icon="mail" title="Choose a case to read it.">Its conversation and case details appear here.</x-empty-state></section>
    </div>
</x-app-layout>
