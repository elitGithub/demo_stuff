<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>{{ $title }} | {{ config('demo.brand') }}</title>
    <link rel="stylesheet" href="{{ asset('assets/css/app.css') }}">
    <script src="{{ asset('assets/js/app.js') }}" defer></script>
</head>
<body class="app-body">
    <a class="skip-link" href="#main">Skip to content</a>
    <x-navigation />
    <main id="main" class="shell app-main">{{ $slot }}</main>
    <footer class="site-footer shell" id="demo-information">
        <span>{{ config('demo.brand') }} · A fictional portfolio experience.</span>
        <span>Original sample illustrations. Simulated payments. No real email is sent.</span>
    </footer>
</body>
</html>
