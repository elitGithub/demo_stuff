@extends('layouts.app')
@section('title', 'Website content')
@section('content')
    <div class="page-heading"><div><span class="eyebrow">YOUR STUDIO, YOUR WORDS</span><h1>Website content</h1><p>Update the welcome, your story and the practical details.</p></div><a class="button secondary" href="{{ route('home') }}">View website ↗</a></div>
    <form class="stack" action="{{ route('content.update') }}" method="post">
        @csrf @method('PUT')
        <div class="detail-grid">
            <section class="panel stack">
                <h2>Welcome & story</h2><p class="field-help">All content is plain text. Links, HTML and scripts are displayed as text.</p>
                <label>Studio name<input name="name" value="{{ old('name', $content['name']) }}" required maxlength="80"></label>
                <label>Hero headline<input name="hero_title" value="{{ old('hero_title', $content['hero_title']) }}" required maxlength="120"></label>
                <label>Hero description<textarea name="hero_subtitle" rows="3" required maxlength="500">{{ old('hero_subtitle', $content['hero_subtitle']) }}</textarea></label>
                <label>About heading<input name="about_title" value="{{ old('about_title', $content['about_title']) }}" required maxlength="120"></label>
                <label>About your studio<textarea name="about_body" rows="7" required maxlength="3000">{{ old('about_body', $content['about_body']) }}</textarea></label>
            </section>
            <section class="panel stack">
                <h2>Contact details</h2>
                <label>Address<textarea name="address" rows="3" required maxlength="300">{{ old('address', $content['address']) }}</textarea></label>
                <label>Phone<input name="phone" value="{{ old('phone', $content['phone']) }}" required maxlength="40"></label>
                <label>Contact email<input type="email" name="contact_email" value="{{ old('contact_email', $content['contact_email']) }}" required maxlength="200"></label>
                <label>Opening hours<input name="opening_hours" value="{{ old('opening_hours', $content['opening_hours']) }}" required maxlength="200"></label>
            </section>
        </div>
        <button class="button align-self-end">Save website text</button>
    </form>
@endsection
