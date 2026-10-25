<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Find your kind of stylist. Explore Strand &amp; City, a fictional stylist discovery and booking experience.">
    <title>Strand &amp; City — A little more you.</title>
    <link rel="stylesheet" href="{{ asset('assets/css/app.css') }}">
    <script src="{{ asset('assets/js/app.js') }}" defer></script>
</head>
<body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header shell">
        <a class="wordmark" href="#main" aria-label="Strand &amp; City home">strand<span>&amp;</span>city<span class="brand-dot" aria-hidden="true">.</span></a>
        <nav aria-label="Main navigation">
            <a href="#the-idea">The idea</a>
            <a href="#demo-notes">About this demo</a>
        </nav>
    </header>
    <main id="main" class="shell">
        <section class="hero" aria-labelledby="hero-title">
            <div class="hero-copy">
                <p class="eyebrow">GOOD HAIR. YOUR KIND OF PEOPLE.</p>
                <h1 id="hero-title">A fresh look.<br>A little more <em>you.</em></h1>
                <p class="intro">Great hair starts with a connection. Strand &amp; City is a place for discovering independent stylists who understand your style.</p>
                <form method="post" action="{{ route('demo.enter') }}" data-loading-form>
                    @csrf
                    <button class="button" type="submit">Explore the demo</button>
                    <p role="status" data-loading-status hidden>Opening your demo…</p>
                </form>
                <p class="release-note">Your own fictional workspace, available for four hours of inactivity.</p>
            </div>
            <div class="hero-art" aria-hidden="true">
                <div class="art-orbit orbit-one"></div>
                <div class="art-orbit orbit-two"></div>
                <div class="art-frame">
                    <div class="strand strand-one"></div>
                    <div class="strand strand-two"></div>
                    <div class="strand strand-three"></div>
                    <div class="art-caption">YOUR NEXT<br><em>good hair day.</em></div>
                </div>
                <div class="glass-note"><span class="note-line"></span>Individual style.<br>Personal connection.</div>
                <div class="art-stamp">MADE FOR<br>YOUR NEXT CHAPTER</div>
            </div>
        </section>
        <section id="the-idea" class="idea-section" aria-labelledby="idea-title">
            <div class="section-heading">
                <p class="eyebrow">A MORE PERSONAL KIND OF DISCOVERY</p>
                <h2 id="idea-title">Find your people.<br>Then find your look.</h2>
            </div>
            <div class="idea-grid">
                <article class="glass-card"><span class="card-number">01</span><h3>Style with a point of view</h3><p>A space for the craft, personality and individual approach behind every stylist.</p></article>
                <article class="glass-card"><span class="card-number">02</span><h3>Room for a conversation</h3><p>A thoughtful appointment begins with understanding what feels right for you.</p></article>
                <article class="glass-card"><span class="card-number">03</span><h3>A clear next step</h3><p>Explore services and transparent prices, then follow a fictional appointment from request to confirmation.</p></article>
            </div>
        </section>
        <section id="demo-notes" class="demo-note" aria-labelledby="demo-title">
            <p class="eyebrow">ABOUT THIS DEMO</p>
            <h2 id="demo-title">A little space to explore.</h2>
            <p>Meet fictional stylists, discover their work and try the appointment journey in your own private demo. Switch between Client, Stylist and Admin to see each perspective. Original sample illustrations bring the studios to life; payments and inbox messages are simulated. No real payment is taken and no real email is sent.</p>
            <a class="text-link" href="#main">Back to the beginning <span aria-hidden="true">↑</span></a>
        </section>
    </main>
    <footer class="site-footer shell"><span>Strand &amp; City</span><span>Fictional people. Real attention to detail.</span></footer>
</body>
</html>
