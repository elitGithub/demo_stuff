<?php

namespace Tests\Support;

use App\Enums\AccountRole;
use App\Enums\ProfileStatus;
use App\Models\SandboxMeta;
use App\Models\User;
use App\Services\FixtureService;
use App\Services\SandboxService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

trait BuildsAccountRuntime
{
    use BuildsSandboxRuntime;

    protected string $accountPassword = 'fictional-password-123';

    /**
     * @return void
     */
    protected function buildAccountRuntime(): void
    {
        $this->fixtureDirectory = $this->runtime->path('fixtures');
        mkdir($this->fixtureDirectory, 0700);
        $fixtures = app(FixtureService::class);
        foreach (['registry' => 'registry.sqlite', 'visitor' => 'template.sqlite'] as $connection => $filename) {
            $path = $this->fixtureDirectory.'/'.$filename;
            touch($path);
            $fixtures->configureConnection($connection, $path, config('demo.limits.'.$connection.'_pages'));
            foreach (glob(database_path('migrations/'.$connection.'/*.php')) as $migration) {
                (require $migration)->up();
            }
        }
        foreach (AccountRole::cases() as $role) {
            $user = User::query()->create(['name' => $role->label().' Fictional', 'email' => config('demo.seed_accounts.'.$role->value), 'password' => $this->accountPassword, 'role' => $role]);
            if ($role === AccountRole::Stylist) {
                $user->profile()->create(['display_name' => $user->name, 'city_code' => 'paris', 'timezone' => 'Europe/Paris', 'status' => ProfileStatus::Draft]);
            }
        }
        SandboxMeta::query()->create(['id' => 1, 'generation' => 'template']);
        DB::purge('visitor');
        config(['database.connections.visitor' => null, 'demo.runtime_path' => $this->fixtureDirectory, 'demo.template_path' => $this->fixtureDirectory.'/template.sqlite', 'session.connection' => 'registry', 'session.secure' => false, 'session.path' => '/']);
        app(SandboxService::class)->prepareRegistry();
    }

    /**
     * @return TestResponse
     */
    protected function enterAccountDemo(): TestResponse
    {
        $this->get('/')->assertOk();
        $this->withCookie('strand_city_session', session()->getId());
        $this->post('/demo/enter')->assertRedirect('/demo/ready');
        $this->withCookie('strand_city_session', session()->getId());

        return $this->get('/account')->assertOk();
    }

    /**
     * @param  TestResponse  $response
     * @return string
     */
    protected function formContext(TestResponse $response): string
    {
        $this->assertSame(1, preg_match('/name="_actor_context" value="([^"]+)"/', $response->getContent(), $matches));

        return html_entity_decode($matches[1], ENT_QUOTES);
    }

    /**
     * @return void
     */
    protected function admitAccountFixture(): void
    {
        app(SandboxService::class)->admit(session()->driver(), CarbonImmutable::now());
    }
}
