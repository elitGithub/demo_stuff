<x-app-layout title="Board">
    <h1>Cases</h1>
    <nav class="board-tabs glass" aria-label="Board columns" data-board-tabs>
        @foreach ($board->columns as $column)
            <a href="#board-{{ $column->status->value }}" class="btn" data-board-tab>{{ $column->status->label() }} <span>{{ $column->cases->total() }}</span></a>
        @endforeach
    </nav>
    <div class="board-columns" data-board-columns>
        @foreach ($board->columns as $column)
            <section id="board-{{ $column->status->value }}" class="board-column glass" aria-labelledby="heading-{{ $column->status->value }}" data-board-status="{{ $column->status->value }}">
                <header class="board-column-heading"><h2 id="heading-{{ $column->status->value }}">{{ $column->status->label() }}</h2><span class="board-count">{{ $column->cases->total() }}</span></header>
                <ol class="board-cards">
                    @forelse ($column->cases as $case)
                        <li><x-board-card :case="$case" :pages="$board->query" /></li>
                    @empty
                        <li><x-empty-state title="No cases here yet.">Cases appear here when they reach this status.</x-empty-state></li>
                    @endforelse
                </ol>
                <x-pagination :paginator="$column->cases" />
            </section>
        @endforeach
    </div>
</x-app-layout>
