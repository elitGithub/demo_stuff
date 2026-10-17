<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class PhotoAccessTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    #[DataProvider('readers')]
    public function test_private_photos_are_served_only_to_authorized_readers(string $reader, int $status): void
    {
        Storage::fake('request-photos');
        $category = Category::factory()->create();
        $owner = $this->customer();
        $job = $this->job($owner, $category);
        $path = UploadedFile::fake()->image('tap.jpg', 40, 30)->store('requests', 'request-photos');
        $photo = $job->photos()->create([
            'path' => $path, 'mime_type' => 'image/jpeg', 'original_name' => 'tap.jpg', 'width' => 40, 'height' => 30,
        ]);
        $actor = match ($reader) {
            'owner' => $owner,
            'eligible' => $this->provider($category),
            'unrelated' => $this->customer(),
            'mismatching' => $this->provider($category, 'Cedar Park'),
            'admin' => User::factory()->admin()->create(),
            default => null,
        };
        if ($actor) {
            $this->actingAs($actor);
        }

        $response = $this->get('/photos/'.$photo->id)->assertStatus($status);

        if ($status === 200) {
            $response->assertHeader('Content-Type', 'image/jpeg')
                ->assertHeader('X-Content-Type-Options', 'nosniff');
            self::assertStringContainsString('private', $response->headers->get('Cache-Control'));
        } elseif ($reader === 'guest') {
            $response->assertRedirect('/login');
        }
    }

    public static function readers(): array
    {
        return [['owner', 200], ['eligible', 200], ['unrelated', 403],
            ['mismatching', 403], ['admin', 200], ['guest', 302]];
    }
}
