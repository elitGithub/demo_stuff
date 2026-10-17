<?php

namespace Tests\Unit;

use App\Enums\CasefileMode;
use PHPUnit\Framework\Attributes\DataProvider;
use stdClass;
use Tests\TestCase;
use ValueError;

class CasefileModeTest extends TestCase
{
    /**
     * @return array<string, array{string, CasefileMode}>
     */
    public static function configuredModes(): array
    {
        return [
            'local' => ['local', CasefileMode::Local],
            'demo' => ['demo', CasefileMode::Demo],
            'production' => ['production', CasefileMode::Production],
        ];
    }

    /**
     * @return array<string, array{mixed}>
     */
    public static function unknownModes(): array
    {
        return [
            'upper case' => ['LOCAL'],
            'title case' => ['Demo'],
            'leading space' => [' local'],
            'trailing space' => ['production '],
            'abbreviation' => ['prod'],
            'other environment name' => ['staging'],
            'laravel environment name' => ['testing'],
            'empty string' => [''],
            'null' => [null],
            'integer' => [1],
            'boolean' => [true],
            'array holding a valid mode' => [['local']],
            'object' => [new stdClass],
        ];
    }

    /**
     * @return array<string, array{CasefileMode, bool, bool, string}>
     */
    public static function truthTable(): array
    {
        return [
            'local' => [CasefileMode::Local, true, false, 'Local'],
            'demo' => [CasefileMode::Demo, true, true, 'Demo'],
            'production' => [CasefileMode::Production, false, false, 'Production'],
        ];
    }

    /**
     * @see CasefileMode::current()
     */
    #[DataProvider('configuredModes')]
    public function test_current_maps_each_configured_value(string $configured, CasefileMode $expected): void
    {
        config(['casefile.mode' => $configured]);

        $this->assertSame($expected, CasefileMode::current());
    }

    /**
     * @see CasefileMode::current()
     */
    #[DataProvider('unknownModes')]
    public function test_current_rejects_unknown_values(mixed $configured): void
    {
        config(['casefile.mode' => $configured]);

        $this->expectException(ValueError::class);
        $this->expectExceptionMessage('Use one of: local, demo, production.');

        CasefileMode::current();
    }

    /**
     * @see CasefileMode::current()
     */
    public function test_current_rejects_a_missing_mode_key(): void
    {
        $settings = config('casefile');
        unset($settings['mode']);
        config(['casefile' => $settings]);

        $this->expectException(ValueError::class);

        CasefileMode::current();
    }

    /**
     * @see CasefileMode::demoControlsEnabled()
     * @see CasefileMode::usesSandboxes()
     * @see CasefileMode::label()
     */
    #[DataProvider('truthTable')]
    public function test_capabilities_follow_the_truth_table(
        CasefileMode $mode,
        bool $demoControls,
        bool $sandboxes,
        string $label,
    ): void {
        $this->assertSame($demoControls, $mode->demoControlsEnabled());
        $this->assertSame($sandboxes, $mode->usesSandboxes());
        $this->assertSame($label, $mode->label());
    }

    /**
     * @see CasefileMode::cases()
     */
    public function test_the_truth_table_covers_every_mode(): void
    {
        $covered = array_map(fn (array $row): CasefileMode => $row[0], array_values(self::truthTable()));

        $this->assertEqualsCanonicalizing(CasefileMode::cases(), $covered);
        $this->assertSame(['local', 'demo', 'production'], array_column(CasefileMode::cases(), 'value'));
    }

    /**
     * @see CasefileMode::usesSandboxes()
     * @see CasefileMode::demoControlsEnabled()
     */
    public function test_only_demo_mode_uses_sandboxes_and_production_never_shows_demo_controls(): void
    {
        $sandboxed = array_filter(CasefileMode::cases(), fn (CasefileMode $mode): bool => $mode->usesSandboxes());

        $this->assertSame([CasefileMode::Demo], array_values($sandboxed));
        $this->assertFalse(CasefileMode::Production->demoControlsEnabled());
    }

    /**
     * @see config/casefile.php
     */
    public function test_mode_defaults_to_local_when_the_environment_is_silent(): void
    {
        $previous = getenv('CASEFILE_MODE');
        $previousEnv = $_ENV['CASEFILE_MODE'] ?? null;
        $previousServer = $_SERVER['CASEFILE_MODE'] ?? null;

        putenv('CASEFILE_MODE');
        unset($_ENV['CASEFILE_MODE'], $_SERVER['CASEFILE_MODE']);

        try {
            $settings = require config_path('casefile.php');
        } finally {
            if ($previous !== false) {
                putenv('CASEFILE_MODE='.$previous);
            }

            if ($previousEnv !== null) {
                $_ENV['CASEFILE_MODE'] = $previousEnv;
            }

            if ($previousServer !== null) {
                $_SERVER['CASEFILE_MODE'] = $previousServer;
            }
        }

        $this->assertSame('local', $settings['mode']);
        $this->assertSame('local', env('CASEFILE_MODE'));
    }

    /**
     * @see config/casefile.php
     */
    public function test_casefile_config_carries_the_documented_defaults(): void
    {
        $this->assertSame('Dana Whitfield', config('casefile.owner.name'));
        $this->assertSame('dana@casefile.example', config('casefile.owner.email'));
        $this->assertSame(storage_path('app/sandboxes'), config('casefile.sandbox.directory'));
        $this->assertSame(storage_path('app/template/casefile-template.sqlite'), config('casefile.sandbox.template'));
        $this->assertSame(24, config('casefile.sandbox.ttl_hours'));
        $this->assertSame(50, config('casefile.sandbox.cap'));
        $this->assertSame(5, config('casefile.sandbox.provisions_per_hour'));
        $this->assertSame('casefile_sandbox', config('casefile.sandbox.session_key'));
        $this->assertSame('casefile_layout', config('casefile.layout.cookie'));
        $this->assertSame('desk', config('casefile.layout.default'));
        $this->assertSame(20, config('casefile.demo.auto_reply_delay_seconds'));
    }
}
