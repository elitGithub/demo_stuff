@extends('layouts.public')
@section('title', 'Newsletter preferences')
@section('content')
    <section class="public-section">
        <div class="panel stack" style="max-width: 620px; margin: 0 auto">
            <span class="eyebrow">YOUR PREFERENCES</span>
            @if ($unsubscribed)
                <h1>You're opted out.</h1><p>We have stopped newsletter previews for this subscription. Your appointment reminder preferences are separate.</p>
            @else
                <h1>Leave the newsletter?</h1><p>Confirm below to withdraw newsletter consent. This leaves your appointment reminder preferences unchanged.</p>
                <form method="post" action="{{ route('newsletter.unsubscribe.confirm', $token) }}">@csrf<button class="button">Unsubscribe from the newsletter</button></form>
            @endif
            <a href="{{ route('home') }}" class="text-link">Back to the studio ↗</a>
        </div>
    </section>
@endsection
