<?php

namespace Tests\Feature;

use App\Enums\CasefileMode;
use App\Enums\CaseStatus;
use App\Enums\WorkspaceLayout;
use App\Models\CaseRecord;
use App\Models\User;
use App\Notifications\CaseCreated;
use Dom\HTMLDocument;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\View;
use Illuminate\View\ViewException;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use Tests\TestCase;
use Throwable;
use ValueError;

class ChromeTest extends TestCase
{
    use RefreshDatabase;

    private const NOTICE = 'Simulated mailbox. Nothing here is real email.';

    private const INLINE_STYLE = '/[\s:"\'\/]style\s*=|@style\s*\(|->\s*style\s*\(|["\']style["\']\s*=>/i';

    private const HEX = '#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])';

    private const STYLE_BLOCK = '~<style\b[^>]*>(.*?)</style>~is';

    private const COLOUR_CONTEXT = '~(?:[:=\[]\s*|["\']\s*|=>\s*|\[[^\]\s"\'<>]*[_,(])$~';

    private const URL_NAME = '(?:href|src|action|formaction|xlink:href|data-[\w-]*(?:url|href))';

    private const URL_ATTRIBUTE_OPENING = '~(?<![\w-])(?:[:@]|[xv]-bind:)?'.self::URL_NAME.'\s*=\s*(?:["\']\s*){0,2}$~i';

    private const URL_ARRAY_KEY_OPENING = '~["\']'.self::URL_NAME.'["\']\s*=>\s*(?:["\']\s*)?$~i';

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->withCookie(config('casefile.layout.cookie'), 'desk');
    }

    /**
     * @return array<string, array{string}>
     */
    public static function demoControlModes(): array
    {
        return [
            'local' => ['local'],
            'demo' => ['demo'],
        ];
    }

    /**
     * @return array<string, array{string}>
     */
    public static function emptySlots(): array
    {
        return [
            'nothing between the tags' => [''],
            'whitespace only' => ["   \n   "],
            'comments only' => ['<!-- arrives later --> {{-- and this --}}'],
        ];
    }

    /**
     * @return array<string, array{string}>
     */
    public static function inlineStyleForms(): array
    {
        return [
            'plain attribute' => ['<div style="color: red">'],
            'spaced attribute' => ['<div style = "color: red">'],
            'attribute on a new line' => ["<div\nstyle=\"color: red\">"],
            'bound attribute' => ['<div :style="$styles">'],
            'framework bound attribute' => ['<div x-bind:style="styles">'],
            'blade directive' => ["<div @style(['color: red' => \$warn])>"],
            'blade directive with a space' => ["<div @style (['color: red'])>"],
            'attribute bag merge' => ["<div {{ \$attributes->merge(['style' => 'color: red']) }}>"],
            'attribute bag style method' => ["<div {{ \$attributes->style(['color: red']) }}>"],
            'attribute glued to a quote' => ['<div class="a"style="color: red">'],
            'attribute after a slash' => ['<div/style="color: red">'],
        ];
    }

    /**
     * @return array<string, array{string}>
     */
    public static function styleFreeMarkup(): array
    {
        return [
            'stylesheet link' => ['<link rel="stylesheet" href="/build/app.css">'],
            'data attribute' => ['<div data-style="compact">'],
            'class name' => ['<div class="style-note">'],
            'prose' => ['<p>The house style says no inline styles.</p>'],
            'attribute value naming style' => ['<x-icon name="style" />'],
            'array value starting with style' => ["{{ \$attributes->merge(['class' => 'styles']) }}"],
            'array value that only resembles style' => ["{{ \$attributes->merge(['class' => 'stylish']) }}"],
        ];
    }

    /**
     * @return array<string, array{string}>
     */
    public static function rawHexColours(): array
    {
        return [
            'style block' => ['<style>.note { color: #a12f2f; }</style>'],
            'declaration in a style attribute' => ['<div style="color: #abcdef">'],
            'svg fill attribute' => ['<rect fill="#ff0000" />'],
            'svg stroke with alpha' => ['<path stroke="#11223344" />'],
            'meta theme colour' => ['<meta name="theme-color" content="#f6f4f0">'],
            'tailwind arbitrary value' => ['<div class="bg-[#123456]">'],
            'component prop default' => ["@props(['colour' => '#abcdef'])"],
            'attribute bag merge' => ["{{ \$attributes->merge(['fill' => '#ff0000']) }}"],
            'bound attribute' => ['<rect :fill="\'#ff0000\'" />'],
            'bound component prop' => ['<x-pill :colour="\'#abcdef\'" />'],
            'script object value' => ['<div x-data="{ colour: \'#abcdef\' }">'],
            'unquoted attribute value' => ['<rect fill=#ff0000 />'],
            'tailwind arbitrary value after an underscore' => ['<div class="border-[1px_solid_#abc]">'],
            'tailwind arbitrary value inside a function' => ['<div class="bg-[linear-gradient(#abc,#def)]">'],
        ];
    }

    /**
     * @return array<string, array{string}>
     */
    public static function hexLookalikes(): array
    {
        return [
            'fragment link' => ['<a href="#add">Add a case</a>'],
            'upper case fragment link' => ['<a HREF="#add">Add a case</a>'],
            'single quoted fragment link' => ["<a href='#add'>Add a case</a>"],
            'unquoted fragment link' => ['<a href=#add>Add a case</a>'],
            'fragment link in an attribute bag' => ["{{ \$attributes->merge(['href' => '#add']) }}"],
            'data url attribute' => ['<div data-url="#fade">'],
            'skip link' => ['<a href="#main" class="skip-link">Skip to content</a>'],
            'fragment on a path' => ['<a href="/cases#deface">Jump</a>'],
            'bound fragment link' => ['<a :href="\'#cafe\'">Jump</a>'],
            'svg fragment reference' => ['<use xlink:href="#bead" />'],
            'id attribute' => ['<section id="add">'],
            'html entity' => ['Dana&#039;s case'],
            'case number' => ['<span class="mono">CASE-0001</span>'],
        ];
    }

    /**
     * @see resources/views/components/app-layout.blade.php
     */
    public function test_home_renders_the_casefile_chrome(): void
    {
        $response = $this->actingAs(User::factory()->create())->get('/');

        $response->assertOk();
        $response->assertSee('<title>All cases · Casefile</title>', false);
        $response->assertSee('<html lang="en-CA">', false);
        $response->assertSeeInOrder([
            '<a href="#main" class="skip-link">',
            '<header class="app-bar glass-nav">',
            '<main id="main" class="app-main"',
        ], false);

        $this->assertSame(1, preg_match('~<header\b[^>]*>(.*?)</header>~s', $response->getContent(), $header));
        $this->assertMatchesRegularExpression(
            '~<a href="[^"]+" class="brand"[^>]*>\s*<span class="brand-mark">.*?</span>\s*<span>Casefile</span>\s*</a>~s',
            $header[1],
        );
    }

    /**
     * @see resources/views/components/demo-banner.blade.php
     */
    public function test_home_shows_the_simulated_mailbox_notice_in_local_mode(): void
    {
        $this->assertSame('local', config('casefile.mode'));

        $this->actingAs(User::factory()->create())->get('/')->assertOk()->assertSee(self::NOTICE);
    }

    /**
     * @see resources/views/components/demo-banner.blade.php
     */
    #[DataProvider('demoControlModes')]
    public function test_the_notice_is_present_whenever_demo_controls_are_on(string $mode): void
    {
        config(['casefile.mode' => $mode]);

        $this->view('auth.sign-in')->assertSee(self::NOTICE);
    }

    /**
     * @see resources/views/components/demo-banner.blade.php
     */
    public function test_production_mode_omits_the_notice(): void
    {
        config(['casefile.mode' => 'production']);

        $view = $this->view('auth.sign-in');

        $view->assertSee('Casefile');
        $view->assertDontSee(self::NOTICE);
        $view->assertDontSee('demo-banner', false);
    }

    /**
     * @see resources/views/components/demo-banner.blade.php
     */
    public function test_the_banner_component_guards_itself_wherever_it_is_used(): void
    {
        config(['casefile.mode' => 'production']);
        $this->assertSame('', trim(Blade::render('<x-demo-banner />')));

        config(['casefile.mode' => 'local']);
        $this->assertStringContainsString(self::NOTICE, Blade::render('<x-demo-banner />'));
    }

    /**
     * @see CasefileMode::current()
     */
    public function test_an_unknown_mode_breaks_the_render_instead_of_guessing(): void
    {
        config(['casefile.mode' => 'staging']);

        $failure = $this->renderFailure(fn () => $this->view('auth.sign-in'));

        $this->assertInstanceOf(ValueError::class, $failure);
    }

    /**
     * @see resources/views/components/app-layout.blade.php
     */
    public function test_the_layout_places_the_nav_and_actions_slots_in_the_top_bar(): void
    {
        $html = Blade::render(<<<'BLADE'
            <x-app-layout title="Search">
                <x-slot:nav><a href="/search">Find a case</a></x-slot:nav>
                <x-slot:actions><button type="submit">Sign out</button></x-slot:actions>
                <p>Page body</p>
            </x-app-layout>
            BLADE);

        $this->assertStringContainsString('<title>Search · Casefile</title>', $html);
        $this->assertMatchesRegularExpression(
            '~<header class="app-bar glass-nav">.*<nav class="app-nav" aria-label="Main"><a href="/search">Find a case</a></nav>.*<div class="app-extra-actions"><button type="submit">Sign out</button></div>.*<div class="app-actions">.*data-theme-control hidden.*</header>~s',
            $html,
        );
        $this->assertMatchesRegularExpression('~<main id="main"[^>]*>.*<p>Page body</p>.*</main>~s', $html);
    }

    /**
     * @see resources/views/components/app-layout.blade.php
     */
    public function test_the_layout_leaves_out_nav_and_keeps_guest_theme_when_no_slot_is_passed(): void
    {
        $view = $this->view('auth.sign-in');

        $view->assertDontSee('<nav', false);
        $view->assertSee('class="app-actions"', false);
        $view->assertSee('data-theme-control hidden', false);
    }

    /**
     * @see resources/views/components/app-layout.blade.php
     */
    #[DataProvider('emptySlots')]
    public function test_the_layout_treats_an_empty_slot_as_absent(string $contents): void
    {
        $html = Blade::render(<<<BLADE
            <x-app-layout title="Empty">
                <x-slot:nav>{$contents}</x-slot:nav>
                <x-slot:actions>{$contents}</x-slot:actions>
                <p>Page body</p>
            </x-app-layout>
            BLADE);

        $this->assertStringContainsString('<p>Page body</p>', $html);
        $this->assertStringNotContainsString('<nav', $html);
        $this->assertStringNotContainsString('class="app-extra-actions"', $html);
        $this->assertStringContainsString('class="app-actions"', $html);
        $this->assertStringContainsString('data-theme-control hidden', $html);
    }

    /**
     * @see resources/views/components/app-layout.blade.php
     */
    #[DataProvider('demoControlModes')]
    public function test_workspace_keeps_each_layout_and_account_action_in_one_native_disclosure(string $mode): void
    {
        config(['casefile.mode' => $mode]);
        $this->actingAs(User::factory()->create());

        foreach (WorkspaceLayout::cases() as $layout) {
            View::share('layout', $layout);
            $html = Blade::render('<x-app-layout>Body</x-app-layout>');
            $document = HTMLDocument::createFromString($html, LIBXML_NOERROR);
            $this->assertCount(2, $document->querySelectorAll('.app-bar details[data-header-disclosure]'));
            $workspace = $document->querySelector('.layout-switcher');
            $this->assertSame('Workspace: '.$layout->label(), $workspace->querySelector('summary')->getAttribute('aria-label'));
            $choices = $workspace->querySelectorAll('form input[name="layout"]');
            $this->assertCount(4, $choices);
            foreach (WorkspaceLayout::cases() as $choice) {
                $input = $workspace->querySelector('input[name="layout"][value="'.$choice->value.'"]');
                $form = $input->parentElement;
                $this->assertSame(route('layout.choose'), $form->getAttribute('action'));
                $this->assertSame('POST', $form->getAttribute('method'));
                $this->assertTrue($form->hasAttribute('data-pending'));
                $this->assertNotNull($form->querySelector('input[name="_token"]'));
                $this->assertNotNull($form->querySelector('input[name="intended"]'));
                $this->assertStringContainsString($choice->label(), $form->textContent);
                $this->assertSame($choice === $layout, $form->querySelector('button')->hasAttribute('aria-current'));
            }
            foreach (['layout.picker', 'for-real'] as $destination) {
                $links = $document->querySelectorAll('a[href="'.route($destination).'"]');
                $this->assertCount(1, $links);
                $this->assertTrue($workspace->contains($links->item(0)));
                $this->assertTrue($links->item(0)->hasAttribute('data-pending'));
            }
            $signOut = $document->querySelectorAll('form[action="'.route('sign-out').'"]');
            $this->assertCount(1, $signOut);
            $this->assertTrue($workspace->contains($signOut->item(0)));
            $this->assertSame('POST', $signOut->item(0)->getAttribute('method'));
            $this->assertTrue($signOut->item(0)->hasAttribute('data-pending'));
            $this->assertFalse($signOut->item(0)->hasAttribute('data-confirm'));
            $this->assertNotNull($signOut->item(0)->querySelector('input[name="_token"]'));
            $reset = $document->querySelectorAll('form[action="'.route('demo.reset').'"]');
            $this->assertCount($mode === 'demo' ? 1 : 0, $reset);
            if ($mode === 'demo') {
                $this->assertTrue($workspace->contains($reset->item(0)));
                $this->assertSame('POST', $reset->item(0)->getAttribute('method'));
                $this->assertTrue($reset->item(0)->hasAttribute('data-pending'));
                $this->assertSame('This discards everything you changed in your demo and starts a fresh copy. Continue?', $reset->item(0)->getAttribute('data-confirm'));
                $this->assertNotNull($reset->item(0)->querySelector('input[name="_token"]'));
            }
            $this->assertSame('Notifications: 0 unread', $document->querySelector('.notification-bell')->getAttribute('aria-label'));
            $this->assertSame('0', $document->querySelector('.notification-count')->getAttribute('data-unread-count'));
            $this->assertCount(3, $document->querySelectorAll('[data-theme-option]'));
            $this->assertSame('Appearance: System', $document->querySelector('[data-theme-trigger]')->getAttribute('aria-label'));
            $this->assertFalse($document->querySelector('.appearance-disclosure')->contains($document->querySelector('[data-theme-notice]')));
            $this->assertCount(4, $document->querySelectorAll('.app-nav a'));
        }
    }

    /**
     * @return void
     */
    public function test_guest_appearance_has_one_control_and_no_account_actions(): void
    {
        $html = Blade::render('<x-app-layout>Body</x-app-layout>');
        $document = HTMLDocument::createFromString($html, LIBXML_NOERROR);

        $this->assertCount(1, $document->querySelectorAll('.app-bar details[data-header-disclosure]'));
        $this->assertCount(0, $document->querySelectorAll('.layout-switcher, .notification-bell, .app-extra-actions'));
        $this->assertCount(3, $document->querySelectorAll('[data-theme-option]'));
        $this->assertSame('theme-system', $document->querySelector('[data-theme-option]:checked')->getAttribute('id'));
    }

    /**
     * @return void
     */
    public function test_positive_unread_count_remains_on_the_notification_link(): void
    {
        $owner = User::factory()->create();
        $owner->notify(new CaseCreated(case: CaseRecord::factory()->create()));
        $this->actingAs($owner);
        $document = HTMLDocument::createFromString(Blade::render('<x-notification-bell />'), LIBXML_NOERROR);
        $link = $document->querySelector('.notification-bell');

        $this->assertSame('Notifications: 1 unread', $link->getAttribute('aria-label'));
        $this->assertSame(route('notifications'), $link->getAttribute('href'));
        $this->assertTrue($link->hasAttribute('data-pending'));
        $badge = $link->querySelector('.notification-count');
        $this->assertSame('1', $badge->getAttribute('data-unread-count'));
        $this->assertSame('1', $badge->textContent);
    }

    /**
     * @return void
     */
    public function test_a_blank_title_falls_back_to_the_product_name(): void
    {
        $html = Blade::render('<x-app-layout title="">Body</x-app-layout>');

        $this->assertStringContainsString('<title>Casefile</title>', $html);
    }

    /**
     * @see resources/views/components/app-layout.blade.php
     */
    public function test_the_title_is_escaped(): void
    {
        $html = Blade::render('<x-app-layout :title="$title">Body</x-app-layout>', [
            'title' => '<script>alert(1)</script>',
        ]);

        $this->assertStringNotContainsString('<script>alert(1)</script>', $html);
        $this->assertStringContainsString('&lt;script&gt;alert(1)&lt;/script&gt; · Casefile', $html);
    }

    /**
     * @see resources/views/components/flash.blade.php
     */
    public function test_flash_shows_status_and_error_from_the_session(): void
    {
        $response = $this->actingAs(User::factory()->create())->withSession([
            'status' => 'Case saved.',
            'error' => 'That case could not be found.',
        ])->get('/');

        $response->assertOk();
        $response->assertSeeInOrder([
            '<div class="flash flash-status" role="status">',
            'Case saved.',
            '<div class="flash flash-error" role="alert">',
            'That case could not be found.',
        ], false);
    }

    /**
     * @see resources/views/components/flash.blade.php
     */
    public function test_flash_escapes_markup(): void
    {
        $response = $this->actingAs(User::factory()->create())->withSession([
            'status' => '<b>bold</b>',
            'error' => '<img src=x onerror=alert(1)>',
        ])->get('/');

        $response->assertOk();
        $response->assertDontSee('<img src=x onerror=alert(1)>', false);
        $response->assertDontSee('<b>bold</b>', false);
        $response->assertSee('&lt;img src=x onerror=alert(1)&gt;', false);
    }

    /**
     * @see resources/views/components/flash.blade.php
     */
    public function test_flash_ignores_empty_and_non_string_values(): void
    {
        $response = $this->actingAs(User::factory()->create())->withSession([
            'status' => '',
            'error' => ['not', 'a', 'message'],
        ])->get('/');

        $response->assertOk();
        $response->assertDontSee('class="flash', false);
    }

    /**
     * @see resources/views/components/flash.blade.php
     */
    public function test_no_flash_renders_without_session_messages(): void
    {
        $this->actingAs(User::factory()->create())->get('/')->assertOk()->assertDontSee('class="flash', false);
    }

    /**
     * @see config/session.php
     */
    public function test_the_session_cookie_is_named_for_casefile(): void
    {
        $this->assertSame('casefile_session', config('session.cookie'));

        $this->actingAs(User::factory()->create())->get('/')->assertCookie('casefile_session');
    }

    /**
     * @see config/app.php
     */
    public function test_the_application_runs_on_toronto_time(): void
    {
        $this->assertSame('America/Toronto', config('app.timezone'));
        $this->assertSame('America/Toronto', date_default_timezone_get());
        $this->assertSame('America/Toronto', now()->getTimezone()->getName());
    }

    /**
     * @see resources/views/components/icon.blade.php
     */
    public function test_icons_render_as_decorative_line_svgs(): void
    {
        $html = Blade::render('<x-icon name="mail" class="extra" />');

        $this->assertStringContainsString('<svg class="icon extra"', $html);
        $this->assertStringContainsString('aria-hidden="true"', $html);
        $this->assertStringContainsString('stroke="currentColor"', $html);
    }

    /**
     * @see resources/views/components/icon.blade.php
     */
    public function test_an_unknown_icon_name_fails_loudly(): void
    {
        $failure = $this->renderFailure(fn () => Blade::render('<x-icon name="no-such-icon" />'));

        $this->assertInstanceOf(InvalidArgumentException::class, $failure);
        $this->assertSame('Unknown icon [no-such-icon].', $failure->getMessage());
    }

    /**
     * @see ChromeTest::hasInlineStyle()
     */
    #[DataProvider('inlineStyleForms')]
    public function test_the_style_guard_catches_every_inline_style_form(string $markup): void
    {
        $this->assertTrue($this->hasInlineStyle($markup));
    }

    /**
     * @see ChromeTest::hasInlineStyle()
     */
    #[DataProvider('styleFreeMarkup')]
    public function test_the_style_guard_ignores_markup_that_only_mentions_style(string $markup): void
    {
        $this->assertFalse($this->hasInlineStyle($markup));
    }

    /**
     * @see ChromeTest::hasRawHexColour()
     */
    #[DataProvider('rawHexColours')]
    public function test_the_hex_guard_flags_raw_colours(string $markup): void
    {
        $this->assertTrue($this->hasRawHexColour($markup));
    }

    /**
     * @see ChromeTest::hasRawHexColour()
     */
    #[DataProvider('hexLookalikes')]
    public function test_the_hex_guard_leaves_anchors_and_lookalikes_alone(string $markup): void
    {
        $this->assertFalse($this->hasRawHexColour($markup));
    }

    /**
     * @see resources/css/app.css
     */
    public function test_views_carry_no_inline_styles_or_raw_hex_colours(): void
    {
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(resource_path('views')));
        $offences = [];

        foreach ($files as $file) {
            if (! $file->isFile() || ! str_ends_with($file->getFilename(), '.blade.php')) {
                continue;
            }

            $contents = file_get_contents($file->getPathname());
            $relative = str_replace(resource_path().'/', '', $file->getPathname());

            if ($this->hasInlineStyle($contents)) {
                $offences[] = $relative.': inline style';
            }

            if ($this->hasRawHexColour($contents)) {
                $offences[] = $relative.': raw hex colour';
            }
        }

        $this->assertSame([], $offences);
    }

    /**
     * @see resources/js/pending.js
     */
    public function test_the_script_bundle_loads_the_pending_state_module(): void
    {
        $app = file_get_contents(resource_path('js/app.js'));
        $pending = file_get_contents(resource_path('js/pending.js'));

        $this->assertStringContainsString("import './pending.js';", $app);
        $this->assertStringContainsString("hasAttribute('data-pending')", $pending);
        $this->assertStringContainsString("'is-pending'", $pending);
        $this->assertStringContainsString('button.disabled = true', $pending);
        $this->assertStringContainsString('const RECOVERY_DELAY_MS = 15000;', $pending);
        $this->assertStringContainsString("addEventListener('pagehide'", $pending);
    }

    /**
     * @see resources/js/pending.js
     */
    public function test_the_pending_module_marks_links_that_load_a_page(): void
    {
        $pending = file_get_contents(resource_path('js/pending.js'));
        $styles = file_get_contents(resource_path('css/app.css'));

        $this->assertStringContainsString("document.addEventListener('click'", $pending);
        $this->assertStringContainsString("closest('a[data-pending]')", $pending);
        $this->assertStringContainsString("link.target !== '_self'", $pending);
        $this->assertStringContainsString('event.metaKey || event.ctrlKey || event.shiftKey || event.altKey', $pending);
        $this->assertStringContainsString('markPending(link, null);', $pending);
        $this->assertStringContainsString('`form.${PENDING_CLASS}, a.${PENDING_CLASS}`', $pending);
        $this->assertStringContainsString('if (!(element instanceof HTMLFormElement))', $pending);
        $this->assertMatchesRegularExpression('~a\.is-pending\s*\{\s*opacity:\s*0\.55;~', $styles);
    }

    /**
     * @see resources/css/app.css
     */
    public function test_the_stylesheet_scans_only_the_application_views(): void
    {
        preg_match_all("~^@source\s+'([^']+)';~m", file_get_contents(resource_path('css/app.css')), $sources);

        $this->assertSame(['../views/**/*.blade.php'], $sources[1]);
    }

    /**
     * @see resources/css/app.css
     */
    public function test_the_phone_folder_chips_wrap_instead_of_scrolling(): void
    {
        $this->assertSame(1, preg_match('~\n    \.desk-folders \{([^}]*)\}~', file_get_contents(resource_path('css/app.css')), $rule));

        $this->assertStringContainsString('flex-wrap: wrap;', $rule[1]);
        $this->assertStringNotContainsString('overflow', $rule[1]);
        $this->assertStringNotContainsString('scrollbar-width', $rule[1]);
    }

    /**
     * @return void
     */
    public function test_sample_routes_in_every_layout_render_without_inline_styles_and_mark_page_requests_pending(): void
    {
        $this->seed();
        $this->actingAs(User::query()->findOrFail(1));

        foreach (['desk', 'tracker', 'mail', 'board'] as $layout) {
            $this->withCookie(config('casefile.layout.cookie'), $layout);
            foreach (['/', '/search', '/settings', '/inbox', '/how-it-runs', '/layout', '/cases/CASE-0016', '/notifications'] as $path) {
                $response = $this->get($path)->assertOk()->assertDontSee(' style="', false);
                $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
                $this->assertCount(0, $document->querySelectorAll('[style]'), $layout.' '.$path);
                foreach ($document->querySelectorAll('form') as $form) {
                    $this->assertTrue($form->hasAttribute('data-pending'), $layout.' '.$path.' '.$form->getAttribute('action'));
                }
                foreach ($document->querySelectorAll('a[href]') as $link) {
                    $href = $link->getAttribute('href');
                    if (str_starts_with($href, '#') || $link->getAttribute('target') === '_blank' || $link->hasAttribute('download')) {
                        continue;
                    }
                    $this->assertTrue($link->hasAttribute('data-pending'), $layout.' '.$path.' '.$href);
                }
                $this->assertNotNull($document->querySelector('.brand[data-pending]'));
            }
        }
    }

    /**
     * @return void
     */
    public function test_a_combined_search_result_retains_its_return_context_in_every_layout(): void
    {
        $this->seed();
        $this->actingAs(User::query()->findOrFail(1));
        $case = CaseRecord::query()->where('number', 'CASE-0016')->sole();
        $case->update(['subject' => 'Bathroom fan', 'status' => CaseStatus::Closed]);
        $parameters = ['q' => 'Bathroom fan', 'status' => ['closed'], 'sender' => (string) $case->tracked_sender_id];

        foreach (['desk', 'tracker', 'mail', 'board'] as $layout) {
            $this->withCookie(config('casefile.layout.cookie'), $layout);
            $results = $this->get(route('search', $parameters))->assertOk()->assertSee('1 case match.');
            $document = HTMLDocument::createFromString($results->getContent(), LIBXML_NOERROR);
            $result = $document->querySelector('.search-result-list .case-row');
            $this->assertNotNull($result);
            $caseResponse = $this->get($result->getAttribute('href'))->assertOk()->assertSee('Back to search');
            $caseDocument = HTMLDocument::createFromString($caseResponse->getContent(), LIBXML_NOERROR);
            $back = $caseDocument->querySelector('.back-link[data-pending]');
            $this->assertNotNull($back);
            $this->assertSame('Back to search', trim($back->textContent));
            $this->assertSame(route('search'), strtok($back->getAttribute('href'), '?'));
            parse_str(parse_url($back->getAttribute('href'), PHP_URL_QUERY), $returnedParameters);
            $this->assertEquals([...$parameters, 'page' => 1], $returnedParameters);
            $returned = $this->get($back->getAttribute('href'))->assertOk()->assertSee('1 case match.');
            $this->assertSame($case->id, $returned->viewData('cases')->sole()->id);
        }
    }

    /**
     * @param  string  $contents
     * @return bool
     */
    private function hasInlineStyle(string $contents): bool
    {
        return preg_match(self::INLINE_STYLE, $contents) === 1;
    }

    /**
     * @param  string  $contents
     * @return bool
     */
    private function hasRawHexColour(string $contents): bool
    {
        preg_match_all(self::STYLE_BLOCK, $contents, $blocks);

        foreach ($blocks[1] as $block) {
            if (preg_match('~'.self::HEX.'~i', $block) === 1) {
                return true;
            }
        }

        preg_match_all('~'.self::HEX.'~i', $contents, $candidates, PREG_OFFSET_CAPTURE);

        foreach ($candidates[0] as [, $offset]) {
            $before = substr($contents, max(0, $offset - 160), min($offset, 160));

            if (preg_match(self::COLOUR_CONTEXT, $before) !== 1) {
                continue;
            }

            if (preg_match(self::URL_ATTRIBUTE_OPENING, $before) === 1 || preg_match(self::URL_ARRAY_KEY_OPENING, $before) === 1) {
                continue;
            }

            return true;
        }

        return false;
    }

    /**
     * @param  callable(): mixed  $render
     * @return Throwable
     */
    private function renderFailure(callable $render): Throwable
    {
        try {
            $render();
        } catch (Throwable $throwable) {
            while ($throwable instanceof ViewException && $throwable->getPrevious() !== null) {
                $throwable = $throwable->getPrevious();
            }

            return $throwable;
        }

        $this->fail('The render was expected to fail but completed.');
    }
}
