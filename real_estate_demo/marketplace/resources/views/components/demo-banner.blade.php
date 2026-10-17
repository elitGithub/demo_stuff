@if(config('demo.enabled') && (config('demo.read_only') || app()->environment(config('demo.environments'))))
    <div class="demo-bar glass-nav">
        <div class="demo-caption"><span class="demo-dot"></span><strong>{{ config('demo.read_only') ? 'Read-only demo' : 'Portfolio demo' }}</strong><span class="demo-description">{{ config('demo.read_only') ? 'Explore the experience. Sample data stays unchanged.' : 'Fictional people. Real workflows. No real charges.' }}</span></div>
        <div class="demo-roles" aria-label="Explore a demo role">
            @foreach(config('demo.actors') as $actor)
                <form method="POST" action="{{ route('demo.login', $actor) }}">@csrf
                    <button type="submit" @class(['demo-role', 'selected' => auth()->user()?->demo_key === $actor])>{{ ucfirst($actor) }}</button>
                </form>
            @endforeach
        </div>
    </div>
@endif
