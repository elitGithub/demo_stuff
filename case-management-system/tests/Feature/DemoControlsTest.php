<?php

namespace Tests\Feature;

use App\Contracts\MailboxConnector;
use App\Contracts\SignInProvider;
use App\Demo\InboxScript;
use App\Enums\MessageDirection;
use App\Http\Middleware\UseSandboxDatabase;
use App\Models\CaseMessage;
use App\Models\CaseRecord;
use App\Models\ScriptEntry;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class DemoControlsTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
    }

    /**
     * @return array<string, array{string}>
     */
    public static function mutations(): array
    {
        return [
            'next' => ['/demo/deliver-next'],
            'reply' => ['/demo/deliver-reply'],
            'auto' => ['/demo/cases/CASE-0010/auto-reply'],
        ];
    }

    /**
     * @param  string  $path
     * @return void
     */
    #[DataProvider('mutations')]
    public function test_all_mutations_require_authentication(string $path): void
    {
        $this->post($path)->assertRedirect('/sign-in');
        $this->assertSame(0, ScriptEntry::query()->whereNotNull('delivered_at')->count());
    }

    /**
     * @param  string  $path
     * @return void
     */
    #[DataProvider('mutations')]
    public function test_all_mutations_are_hidden_in_production_with_providers_stubbed(string $path): void
    {
        $this->app->instance(MailboxConnector::class, Mockery::mock(MailboxConnector::class));
        $this->app->instance(SignInProvider::class, Mockery::mock(SignInProvider::class));
        config(['casefile.mode' => 'production']);

        $this->actingAs(User::query()->sole())->post($path)->assertNotFound();
        $this->assertSame(0, ScriptEntry::query()->whereNotNull('delivered_at')->count());
    }

    /**
     * @param  string  $path
     * @return void
     */
    #[DataProvider('mutations')]
    public function test_all_mutations_enforce_csrf_when_framework_test_bypass_is_disabled(string $path): void
    {
        $this->actingAs(User::query()->sole());
        $this->app['env'] = 'csrf-check';
        $this->withSession(['_token' => 'expected-csrf-token'])->post($path)->assertStatus(419);
        $this->assertSame(0, ScriptEntry::query()->whereNotNull('delivered_at')->count());
    }

    /**
     * @param  string  $path
     * @return void
     */
    #[DataProvider('mutations')]
    public function test_all_mutations_are_post_only(string $path): void
    {
        $this->actingAs(User::query()->sole())->get($path)->assertStatus(405);
    }

    /**
     * @return void
     */
    public function test_delivery_and_reply_redirect_back_with_the_report_summary(): void
    {
        $this->actingAs(User::query()->sole())
            ->from('/cases/CASE-0016')->post(route('demo.deliver-next'))
            ->assertRedirect('/cases/CASE-0016')
            ->assertSessionHas('status', 'New case CASE-0017 from Marcus Leblanc');
        $this->post(route('demo.deliver-next'))->assertSessionHas('status', 'Added to CASE-0016');
        $this->from('/cases/CASE-0016')->post(route('demo.deliver-reply'), ['case' => 'CASE-0016'])
            ->assertRedirect('/cases/CASE-0016')->assertSessionHas('status', 'Added to CASE-0016');
        $this->post(route('demo.deliver-reply'), ['case' => 'CASE-0016'])->assertSessionHas('status', 'No scripted replies are available.');
    }

    /**
     * @return void
     */
    public function test_reply_without_a_case_is_optional_and_empty_delivery_has_a_summary(): void
    {
        $this->actingAs(User::query()->sole())->post(route('demo.deliver-reply'))->assertRedirect()->assertSessionHas('status');
        $script = app(InboxScript::class);

        while ($script->deliverNext() !== null) {
        }

        $this->post(route('demo.deliver-next'))->assertSessionHas('status', 'All scripted messages have been delivered.');
    }

    /**
     * @return void
     */
    public function test_reply_case_input_rejects_invalid_shape_and_unknown_number_without_consuming(): void
    {
        $this->actingAs(User::query()->sole());

        foreach ([['CASE-0016'], 16, '16', 'CASE-0016<script>', str_repeat('A', 40)] as $number) {
            $this->postJson(route('demo.deliver-reply'), ['case' => $number])->assertUnprocessable()->assertJsonValidationErrors('case');
        }

        $this->postJson(route('demo.deliver-reply'), ['case' => 'CASE-9999'])->assertNotFound();
        $this->postJson('/demo/cases/CASE-9999/auto-reply')->assertNotFound();
        $this->assertSame(0, ScriptEntry::query()->whereNotNull('delivered_at')->count());
    }

    /**
     * @return void
     */
    public function test_auto_reply_returns_actual_boolean_and_summary_for_both_results(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0010')->sole();
        CaseMessage::factory()->create(['case_id' => $case->id, 'direction' => MessageDirection::Inbound, 'sent_at' => CarbonImmutable::now()]);
        $this->actingAs(User::query()->sole())->postJson(route('demo.auto-reply', $case))
            ->assertOk()->assertExactJson(['delivered' => false, 'summary' => 'No scripted reply is available.']);
        CaseMessage::factory()->create(['case_id' => $case->id, 'direction' => MessageDirection::Outbound, 'sent_at' => CarbonImmutable::now()->addMinute()]);
        $this->postJson(route('demo.auto-reply', $case))->assertOk()
            ->assertExactJson(['delivered' => true, 'summary' => 'Added to CASE-0010']);
        $this->postJson(route('demo.auto-reply', $case))->assertOk()
            ->assertExactJson(['delivered' => false, 'summary' => 'No scripted reply is available.']);
    }

    /**
     * @return void
     */
    public function test_demo_mode_enables_controls_after_sandbox_middleware_attaches_a_database(): void
    {
        $this->withoutMiddleware(UseSandboxDatabase::class);
        config(['casefile.mode' => 'demo']);
        $this->actingAs(User::query()->sole())->post(route('demo.deliver-next'))
            ->assertRedirect()->assertSessionHas('status', 'New case CASE-0017 from Marcus Leblanc');
    }

    /**
     * @return void
     */
    public function test_all_mutations_share_a_configurable_rate_limit(): void
    {
        config(['casefile.demo.attempts_per_minute' => 2]);
        $this->actingAs(User::query()->sole())->postJson('/demo/cases/CASE-0010/auto-reply')->assertOk();
        $this->post('/demo/deliver-reply', ['case' => 'CASE-0010'])->assertRedirect();
        $this->postJson('/demo/deliver-next')->assertTooManyRequests()->assertHeader('Retry-After');
        $this->assertSame(1, ScriptEntry::query()->whereNotNull('delivered_at')->count());
    }
}
