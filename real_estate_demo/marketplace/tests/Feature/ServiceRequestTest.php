<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\ServiceRequest;
use App\Services\RequestPhotoStorage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class ServiceRequestTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    private function details(Category $category, array $overrides = []): array
    {
        return array_replace([
            'title' => 'Repair a dripping kitchen tap', 'description' => 'The mixer leaks at the base.',
            'category_id' => $category->id, 'service_area' => 'Austin',
            'street_address' => '1842 Juniper Lane',
            'preferred_date' => now('America/Chicago')->addDays(3)->toDateString(),
            'budget' => '250.00',
        ], $overrides);
    }

    public function test_customer_can_publish_a_request_with_a_private_photo(): void
    {
        Storage::fake('request-photos');
        $category = Category::factory()->create();
        $customer = $this->customer();
        $matching = $this->provider($category);
        $unmatched = $this->provider($category, 'Cedar Park');
        $pending = $this->provider($category, status: 'pending');

        $this->actingAs($customer)->post('/requests', $this->details($category, [
            'photos' => [UploadedFile::fake()->image('tap.jpg', 800, 600)],
        ]))->assertRedirect();

        $job = ServiceRequest::where('customer_id', $customer->id)->sole();
        self::assertSame(25000, $job->budget_cents);
        self::assertCount(1, $job->photos);
        self::assertCount(1, $job->events);
        Storage::disk('request-photos')->assertExists($job->photos->first()->path);
        self::assertSame(1, $matching->notifications()->count());
        self::assertSame(0, $unmatched->notifications()->count());
        self::assertSame(0, $pending->notifications()->count());
    }

    #[DataProvider('invalidRequests')]
    public function test_invalid_requests_leave_no_records_or_photos(string $case, string $error): void
    {
        Storage::fake('request-photos');
        $this->freezeTime();
        $category = Category::factory()->create(['is_active' => $case !== 'inactive']);
        $changes = match ($case) {
            'area' => ['service_area' => 'Elsewhere'],
            'date' => ['preferred_date' => now('America/Chicago')->subDay()->toDateString()],
            'title' => ['title' => str_repeat('x', 121)],
            'description' => ['description' => str_repeat('x', 5001)],
            'budget' => ['budget' => '-1'],
            'count' => ['photos' => array_map(fn () => UploadedFile::fake()->image('tap.jpg'), range(1, 6))],
            'size' => ['photos' => [UploadedFile::fake()->image('tap.jpg')->size(5121)]],
            'dimensions' => ['photos' => [UploadedFile::fake()->image('wide.jpg', 4097, 1)]],
            'truncated' => ['photos' => [UploadedFile::fake()->createWithContent('broken.png', substr(file_get_contents(database_path('demo/request-kitchen.png')), 0, 33))]],
            'spoof' => ['photos' => [UploadedFile::fake()->createWithContent('tap.jpg', 'not an image')]],
            'svg' => ['photos' => [UploadedFile::fake()->createWithContent('tap.png', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')]],
            'owner' => ['customer_id' => 999],
            default => [],
        };

        $this->actingAs($this->customer())->postJson('/requests', $this->details($category, $changes))
            ->assertUnprocessable()->assertJsonValidationErrors($error);

        $this->assertDatabaseCount('service_requests', 0);
        $this->assertDatabaseCount('request_photos', 0);
        self::assertSame([], Storage::disk('request-photos')->allFiles());
    }

    public static function invalidRequests(): array
    {
        return [['inactive', 'category_id'], ['area', 'service_area'], ['date', 'preferred_date'],
            ['title', 'title'], ['description', 'description'], ['budget', 'budget'],
            ['count', 'photos'], ['size', 'photos.0'], ['dimensions', 'photos.0'],
            ['spoof', 'photos.0'], ['truncated', 'photos.0'], ['svg', 'photos.0'], ['owner', 'customer_id']];
    }

    public function test_photo_failure_rolls_back_the_request_and_removes_written_files(): void
    {
        Storage::fake('request-photos');
        $category = Category::factory()->create();
        $storage = $this->mock(RequestPhotoStorage::class);
        $calls = 0;
        $storage->shouldReceive('store')->twice()->andReturnUsing(function () use (&$calls): array {
            if (++$calls === 2) {
                throw new RuntimeException('Storage unavailable');
            }
            Storage::disk('request-photos')->put('first.jpg', 'fixture');

            return ['path' => 'first.jpg', 'mime_type' => 'image/jpeg', 'original_name' => 'tap.jpg', 'width' => 10, 'height' => 10];
        });
        $storage->shouldReceive('delete')->once()->with('first.jpg')->andReturnUsing(
            fn () => Storage::disk('request-photos')->delete('first.jpg')
        );

        $this->actingAs($this->customer())->post('/requests', $this->details($category, [
            'photos' => [UploadedFile::fake()->image('one.jpg'), UploadedFile::fake()->image('two.jpg')],
        ]))->assertServerError();

        $this->assertDatabaseCount('service_requests', 0);
        $this->assertDatabaseCount('notifications', 0);
        self::assertSame([], Storage::disk('request-photos')->allFiles());
    }

    public function test_a_photo_that_writes_then_throws_leaves_no_orphan_files(): void
    {
        Storage::fake('request-photos');
        $image = UploadedFile::fake()->image('second.png', 40, 30);
        $failing = new class($image->getRealPath(), 'second.png', 'image/png', null, true) extends UploadedFile
        {
            public function storeAs($path, $name = null, $options = [])
            {
                parent::storeAs($path, $name, $options);
                throw new RuntimeException('Failure after bytes reached the disk.');
            }
        };
        $category = Category::factory()->create();
        $this->actingAs($this->customer())->post('/requests', $this->details($category, [
            'photos' => [UploadedFile::fake()->image('first.png', 40, 30), $failing],
        ]))->assertServerError();
        $this->assertDatabaseCount('service_requests', 0);
        $this->assertDatabaseCount('request_photos', 0);
        self::assertSame([], Storage::disk('request-photos')->allFiles());
    }

    public function test_owner_can_edit_only_before_any_quote(): void
    {
        $category = Category::factory()->create();
        $owner = $this->customer();
        $job = $this->job($owner, $category);
        $this->actingAs($owner)->patch("/requests/{$job->id}", $this->details($category, ['title' => 'Changed scope']))
            ->assertRedirect();
        self::assertSame('Changed scope', $job->fresh()->title);
        $this->quote($job, $this->provider($category));

        $this->patchJson("/requests/{$job->id}", $this->details($category, ['title' => 'Too late']))
            ->assertConflict();
        self::assertSame('Changed scope', $job->fresh()->title);
    }

    public function test_provider_cannot_create_customer_requests(): void
    {
        $category = Category::factory()->create();

        $this->actingAs($this->provider($category))->postJson('/requests', $this->details($category))
            ->assertForbidden();
        $this->assertDatabaseCount('service_requests', 0);
    }

    public function test_candidates_never_receive_private_details_or_unescaped_scope(): void
    {
        $category = Category::factory()->create();
        $owner = $this->customer();
        $job = $this->job($owner, $category, ['description' => '<script>alert("scope")</script>']);
        $provider = $this->provider($category);

        $this->actingAs($provider)->get("/requests/{$job->id}")
            ->assertOk()->assertDontSee('1842 Juniper Lane')->assertDontSee($owner->email)
            ->assertSee('&lt;script&gt;', false)->assertDontSee('<script>alert("scope")</script>', false);
        $this->actingAs($this->customer())->get("/requests/{$job->id}")->assertForbidden();
    }
}
