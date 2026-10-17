<?php

namespace Tests\Feature;

use App\Enums\CasefileMode;
use App\Exceptions\ModeNotConfigured;
use App\Providers\AppServiceProvider;
use App\Support\ModeGuard;
use Illuminate\Container\Container;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Facade;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;
use ValueError;

class ModeGuardTest extends TestCase
{
    private const PRODUCTION_MESSAGE = 'CASEFILE_MODE=production needs a real sign-in provider and mailbox connector; none is configured in this build.';

    /**
     * @return array<string, array{CasefileMode}>
     */
    public static function runnableModes(): array
    {
        return [
            'local' => [CasefileMode::Local],
            'demo' => [CasefileMode::Demo],
        ];
    }

    /**
     * @see ModeGuard::assertRunnable()
     */
    public function test_production_throws_with_the_exact_message(): void
    {
        try {
            ModeGuard::assertRunnable(CasefileMode::Production);
        } catch (ModeNotConfigured $exception) {
            $this->assertSame(self::PRODUCTION_MESSAGE, $exception->getMessage());
            $this->assertInstanceOf(RuntimeException::class, $exception);

            return;
        }

        $this->fail('Production mode was allowed to run without a sign-in provider or mailbox connector.');
    }

    /**
     * @see ModeGuard::assertRunnable()
     */
    #[DataProvider('runnableModes')]
    public function test_local_and_demo_are_allowed_to_run(CasefileMode $mode): void
    {
        ModeGuard::assertRunnable($mode);

        $this->addToAssertionCount(1);
    }

    /**
     * @see ModeGuard::assertRunnable()
     */
    public function test_only_production_is_refused(): void
    {
        $refused = [];

        foreach (CasefileMode::cases() as $mode) {
            try {
                ModeGuard::assertRunnable($mode);
            } catch (ModeNotConfigured) {
                $refused[] = $mode;
            }
        }

        $this->assertSame([CasefileMode::Production], $refused);
    }

    /**
     * @see ModeGuard::assertRunnable()
     */
    public function test_demo_refuses_a_default_connection_other_than_sqlite(): void
    {
        config(['database.default' => 'mysql']);

        try {
            ModeGuard::assertRunnable(CasefileMode::Demo);
            $this->fail('Demo mode ran without the sqlite connection as the default.');
        } catch (ModeNotConfigured $exception) {
            $this->assertSame('CASEFILE_MODE=demo requires the sqlite connection as the default.', $exception->getMessage());
        }

        ModeGuard::assertRunnable(CasefileMode::Local);

        config(['database.default' => 'sqlite', 'casefile.mode' => 'demo']);
        (new AppServiceProvider($this->app))->boot();

        config(['database.default' => 'pgsql']);
        $this->expectException(ModeNotConfigured::class);
        $this->expectExceptionMessage('CASEFILE_MODE=demo requires the sqlite connection as the default.');

        (new AppServiceProvider($this->app))->boot();
    }

    /**
     * @see bootstrap/providers.php
     */
    public function test_the_app_service_provider_is_registered(): void
    {
        $this->assertNotEmpty($this->app->getProviders(AppServiceProvider::class));
    }

    /**
     * @see AppServiceProvider::boot()
     */
    public function test_provider_boot_refuses_production(): void
    {
        config(['casefile.mode' => 'production']);

        $this->expectException(ModeNotConfigured::class);
        $this->expectExceptionMessage(self::PRODUCTION_MESSAGE);

        (new AppServiceProvider($this->app))->boot();
    }

    /**
     * @see AppServiceProvider::boot()
     */
    public function test_provider_boot_refuses_an_unknown_mode(): void
    {
        config(['casefile.mode' => 'Production']);

        $this->expectException(ValueError::class);

        (new AppServiceProvider($this->app))->boot();
    }

    /**
     * @see AppServiceProvider::boot()
     */
    #[DataProvider('runnableModes')]
    public function test_provider_boot_allows_local_and_demo(CasefileMode $mode): void
    {
        config(['casefile.mode' => $mode->value]);

        (new AppServiceProvider($this->app))->boot();

        $this->addToAssertionCount(1);
    }

    /**
     * @see AppServiceProvider::boot()
     */
    public function test_a_fresh_boot_with_production_in_the_environment_fails_loudly(): void
    {
        $previous = getenv('CASEFILE_MODE');
        $previousEnv = $_ENV['CASEFILE_MODE'] ?? null;
        $previousServer = $_SERVER['CASEFILE_MODE'] ?? null;
        $caught = null;

        putenv('CASEFILE_MODE=production');
        $_ENV['CASEFILE_MODE'] = 'production';
        $_SERVER['CASEFILE_MODE'] = 'production';

        try {
            $application = require $this->app->bootstrapPath('app.php');
            $application->make(Kernel::class)->bootstrap();
        } catch (ModeNotConfigured $exception) {
            $caught = $exception;
        } finally {
            if ($previous === false) {
                putenv('CASEFILE_MODE');
            } else {
                putenv('CASEFILE_MODE='.$previous);
            }

            if ($previousEnv === null) {
                unset($_ENV['CASEFILE_MODE']);
            } else {
                $_ENV['CASEFILE_MODE'] = $previousEnv;
            }

            if ($previousServer === null) {
                unset($_SERVER['CASEFILE_MODE']);
            } else {
                $_SERVER['CASEFILE_MODE'] = $previousServer;
            }

            Container::setInstance($this->app);
            Facade::clearResolvedInstances();
            Facade::setFacadeApplication($this->app);
        }

        $this->assertInstanceOf(ModeNotConfigured::class, $caught, 'A production boot was allowed to finish.');
        $this->assertSame(self::PRODUCTION_MESSAGE, $caught->getMessage());
        $this->assertSame('local', env('CASEFILE_MODE'));
    }
}
