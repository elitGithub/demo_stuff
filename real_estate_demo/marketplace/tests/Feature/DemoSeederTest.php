<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Payment;
use App\Models\ProviderProfile;
use App\Models\RequestPhoto;
use App\Models\ServiceRequest;
use App\Models\User;
use App\Support\DemoActors;
use Database\Seeders\DemoSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class DemoSeederTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    public function test_setup_refuses_existing_data_without_changing_it(): void
    {
        $existing = $this->customer();
        try {
            $this->seed(DemoSeeder::class);
            self::fail('Expected populated-database refusal.');
        } catch (RuntimeException $exception) {
            self::assertStringContainsString('empty', $exception->getMessage());
        }
        self::assertSame(1, User::count());
        self::assertSame($existing->id, User::sole()->id);
        self::assertSame(0, Category::count());
    }

    public function test_category_only_data_also_prevents_seeding(): void
    {
        Category::factory()->create();
        try {
            $this->seed(DemoSeeder::class);
            self::fail('Expected populated-database refusal.');
        } catch (RuntimeException $exception) {
            self::assertStringContainsString('empty', $exception->getMessage());
        }
        self::assertSame(0, User::count());
        self::assertSame(1, Category::count());
    }

    public function test_fixtures_cover_roles_stages_and_consistent_agreements(): void
    {
        Storage::fake('request-photos');
        $this->seed(DemoSeeder::class);
        self::assertSame(6, Category::count());
        self::assertSame(8, ProviderProfile::count());
        self::assertSame(8, ServiceRequest::count());
        self::assertSame(['admin', 'customer', 'provider'], User::whereNotNull('demo_key')->orderBy('demo_key')->pluck('demo_key')->all());
        foreach (['open', 'booked', 'in_progress', 'awaiting_confirmation', 'completed', 'cancelled'] as $status) {
            self::assertTrue(ServiceRequest::where('status', $status)->exists());
        }
        foreach (Payment::with('serviceRequest.acceptedQuote', 'serviceRequest.review')->get() as $payment) {
            self::assertSame($payment->serviceRequest->acceptedQuote->amount_cents, $payment->amount_cents);
            self::assertSame($payment->serviceRequest->customer_id, $payment->customer_id);
            self::assertSame($payment->serviceRequest->acceptedQuote->provider_id, $payment->serviceRequest->review->provider_id);
        }
        $photo = RequestPhoto::sole();
        Storage::disk('request-photos')->assertExists($photo->path);
        self::assertSame(['customer', 'provider', 'admin'], DemoActors::keys());
        self::assertSame('Alex Morgan', DemoActors::find('customer')->name);
        $snapshot = [User::count(), ServiceRequest::count(), Payment::count(), $photo->path];
        try {
            $this->seed(DemoSeeder::class);
            self::fail('Second seed must refuse.');
        } catch (RuntimeException $exception) {
            self::assertStringContainsString('empty', $exception->getMessage());
        }
        self::assertSame($snapshot, [User::count(), ServiceRequest::count(), Payment::count(), RequestPhoto::sole()->path]);
        foreach (['customer', 'provider', 'admin'] as $actor) {
            config(['demo.enabled' => true]);
            $this->post('/demo/'.$actor)->assertRedirect('/dashboard');
            $this->get('/dashboard')->assertOk();
        }
    }

    public function test_seeded_public_demo_screens_are_inspectable_without_database_writes(): void
    {
        Storage::fake('request-photos');
        $this->seed(DemoSeeder::class);
        config(['demo.read_only' => true, 'demo.enabled' => true]);
        $this->get('/')->assertOk();
        $this->get('/services')->assertOk();
        $this->get('/professionals')->assertOk();
        foreach (ProviderProfile::where('status', 'approved')->get() as $profile) {
            $this->get('/professionals/'.$profile->slug)->assertOk();
        }
        foreach (DemoActors::keys() as $actor) {
            $this->post('/demo/'.$actor)->assertRedirect();
            $this->get('/dashboard')->assertOk();
            $this->get('/notifications')->assertOk();
            if ($actor !== 'admin') {
                $this->get('/messages')->assertOk();
            }
        }
        $this->get('/admin/providers')->assertOk();
        $this->get('/admin/categories')->assertOk();
        $this->get('/admin/jobs')->assertOk();
        $this->post('/demo/customer')->assertRedirect();
        foreach (DemoActors::find('customer')->requests as $job) {
            $this->get('/requests/'.$job->id)->assertOk();
        }
        // Disable guard before RefreshDatabase's teardown, never change the DB connection.
        config(['demo.read_only' => false]);
    }
}
